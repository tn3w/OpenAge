import base64
import hashlib
import hmac as hmac_mod
import json
import os
import secrets
import struct
import subprocess
import time
from pathlib import Path
from threading import Lock

from cryptography.hazmat.primitives.ciphers import Cipher, algorithms
from flask import Flask, abort, jsonify, render_template, request, send_from_directory

ROOT = Path(__file__).parent
WASM_DIR = ROOT / "wasm"
BUILD_DIR = WASM_DIR / "build"
VM_DIR = WASM_DIR / "web"
DIST_DIR = ROOT.parent / "dist"
TEMPLATES_DIR = ROOT / "templates"

CHALLENGE_TTL = 60
MAX_ROUNDS = 3
SESSION_TTL = 300
RESPONSE_TOKEN_TTL = 300
REQUIRED_LIVENESS_PASSES = 2

LIVENESS_TASKS = [
    "turn-left",
    "turn-right",
    "nod",
    "blink-twice",
    "move-closer",
]

MIME_TYPES = {
    ".enc": "application/octet-stream",
    ".mjs": "application/javascript",
    ".vmbc": "application/octet-stream",
    ".wasm": "application/wasm",
}

app = Flask(__name__, template_folder=str(TEMPLATES_DIR), static_folder=None)

server_secret = secrets.token_bytes(32)
SITEKEY = os.environ.get("OPENAGE_SITEKEY", "ag_test_default")
SECRET_KEY = os.environ.get("OPENAGE_SECRET", secrets.token_hex(32))

build_manifest = None
build_lock = Lock()

sessions = {}
session_lock = Lock()


def vm_assets_ready():
    required = ["vm.js", "vm.wasm", "loader.js", "challenge.vmbc"]
    return all((VM_DIR / name).is_file() for name in required)


def chacha20_crypt(data, key, nonce):
    counter = struct.pack("<I", 1)
    cipher = Cipher(algorithms.ChaCha20(key, counter + nonce), mode=None)
    encryptor = cipher.encryptor()
    return encryptor.update(data) + encryptor.finalize()


def sign_bytes(key, data):
    return hmac_mod.new(key, data, hashlib.sha256).digest()


def sign_payload(payload):
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
    return sign_bytes(server_secret, encoded).hex()


def verify_payload(payload, signature):
    if not isinstance(signature, str):
        return False

    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
    expected = sign_bytes(server_secret, encoded)

    try:
        provided = bytes.fromhex(signature)
    except ValueError:
        return False

    return hmac_mod.compare_digest(provided, expected)


def create_session_id():
    token = base64.urlsafe_b64encode(secrets.token_bytes(12)).decode()
    return token.rstrip("=")


def pick_task(session_id, round_number):
    ordered = sorted(
        LIVENESS_TASKS,
        key=lambda task: sign_bytes(server_secret, f"{session_id}:{task}".encode()),
    )
    return ordered[round_number % len(ordered)]


def decrypt_vm_response(response_bytes, encrypt_key, sign_key):
    if len(response_bytes) < 52:
        return None

    magic = struct.unpack("<I", response_bytes[:4])[0]
    if magic != 0x564D5250:
        return None

    total_length = struct.unpack("<I", response_bytes[4:8])[0]
    if total_length != len(response_bytes):
        return None

    nonce = response_bytes[8:20]
    ciphertext_length = total_length - 8 - 12 - 32
    if ciphertext_length < 0:
        return None

    ciphertext = response_bytes[20 : 20 + ciphertext_length]
    signature = response_bytes[20 + ciphertext_length : 20 + ciphertext_length + 32]
    signed = response_bytes[8 : 20 + ciphertext_length]

    if not hmac_mod.compare_digest(sign_bytes(sign_key, signed), signature):
        return None

    plaintext = chacha20_crypt(ciphertext, encrypt_key, nonce)
    return plaintext.decode("utf-8", errors="replace")


def cleanup_sessions():
    now = time.time()

    with session_lock:
        expired = [
            session_id
            for session_id, session in sessions.items()
            if now - session["created_at"] > SESSION_TTL
        ]

        for session_id in expired:
            del sessions[session_id]


def get_session(session_id):
    cleanup_sessions()

    with session_lock:
        return sessions.get(session_id)


def require_session(session_id):
    session = get_session(session_id)
    if session is None:
        abort(404)
    return session


def build_challenge(session_id, session):
    round_number = session["current_round"]
    token = {
        "build_id": session["build_id"],
        "issued_at": time.time(),
        "nonce": secrets.token_hex(16),
        "round": round_number,
        "session_id": session_id,
        "task": pick_task(session_id, round_number),
        "ttl": CHALLENGE_TTL,
    }

    return {
        "type": "challenge",
        "token": token,
        "tokenSignature": sign_payload(token),
    }


def validate_liveness(task, motion_history):
    if not motion_history or len(motion_history) < 5:
        return False

    poses = [frame.get("headPose", {}) for frame in motion_history]
    blendshapes = [frame.get("blendshapes", {}) for frame in motion_history]

    if task in ("turn-left", "turn-right"):
        yaws = [pose.get("yaw", 0) for pose in poses]
        base = yaws[0]
        direction = 1 if task == "turn-left" else -1
        return any((yaw - base) * direction > 20 for yaw in yaws)

    if task == "nod":
        pitches = [pose.get("pitch", 0) for pose in poses]
        base = pitches[0]
        went_down = any(pitch - base > 15 for pitch in pitches)
        came_back = any(abs(pitch - base) < 8 for pitch in pitches[len(pitches) // 2 :])
        return went_down and came_back

    if task == "blink-twice":
        blink_count = 0
        eyes_closed = False

        for shape in blendshapes:
            left = shape.get("eyeBlinkLeft", 0)
            right = shape.get("eyeBlinkRight", 0)
            both_closed = left > 0.6 and right > 0.6

            if both_closed and not eyes_closed:
                blink_count += 1
                eyes_closed = True
            elif not both_closed:
                eyes_closed = False

        return blink_count >= 2

    if task == "move-closer":
        boxes = [frame.get("boundingBox", {}) for frame in motion_history]
        areas = [box.get("area", 0) for box in boxes if box]

        if len(areas) < 5 or areas[0] == 0:
            return False

        base = areas[0]
        went_closer = any(area / base > 1.3 for area in areas)
        came_back = any(area / base < 1.15 for area in areas[len(areas) // 2 :])
        return went_closer and came_back

    return False


def compute_trimmed_mean(values):
    if not values:
        return None

    ordered = sorted(values)
    trimmed = ordered[1:-1] if len(ordered) >= 3 else ordered
    return sum(trimmed) / len(trimmed)


def create_response_token(estimated_age, sitekey=None):
    payload = {
        "ageConfirmed": True,
        "estimatedAge": round(estimated_age, 1) if estimated_age else None,
        "issuedAt": time.time(),
        "nonce": secrets.token_hex(8),
        "sitekey": sitekey,
        "ttl": RESPONSE_TOKEN_TTL,
    }
    signature = sign_payload(payload)
    encoded = base64.urlsafe_b64encode(
        json.dumps(payload, separators=(",", ":")).encode()
    ).decode()
    return f"{encoded.rstrip('=')}.{signature}"


def verify_response_token(token_string):
    parts = token_string.split(".", 1)
    if len(parts) != 2:
        return None

    padded = parts[0] + "=" * ((4 - len(parts[0]) % 4) % 4)

    try:
        payload = json.loads(base64.urlsafe_b64decode(padded))
    except (ValueError, json.JSONDecodeError):
        return None

    if not verify_payload(payload, parts[1]):
        return None

    issued_at = payload.get("issuedAt", 0)
    ttl = payload.get("ttl", RESPONSE_TOKEN_TTL)
    if time.time() - issued_at > ttl:
        return None

    return payload


def compute_verdict(results, sitekey=None):
    estimated_ages = [
        result["age"]
        for result in results
        if result.get("liveness_ok") and isinstance(result.get("age"), (int, float))
    ]
    estimated_age = compute_trimmed_mean(estimated_ages)
    passes = sum(1 for result in results if result.get("liveness_ok"))

    if passes >= REQUIRED_LIVENESS_PASSES and estimated_age is not None:
        return {"token": create_response_token(estimated_age, sitekey)}

    return {}


def load_build():
    global build_manifest

    manifest_path = BUILD_DIR / "manifest.json"
    if not manifest_path.exists():
        return False
    if not vm_assets_ready():
        return False

    try:
        manifest = json.loads(manifest_path.read_text())
    except (OSError, json.JSONDecodeError, KeyError) as error:
        print(f"Failed to load existing build: {error}")
        return False

    with build_lock:
        build_manifest = manifest

    print(f"Loaded existing build: {manifest['buildId']}")
    return True


def rebuild_wasm():
    global build_manifest

    result = subprocess.run(
        ["node", "scripts/build.cjs"],
        cwd=str(WASM_DIR),
        capture_output=True,
        text=True,
        timeout=300,
    )

    if result.returncode != 0:
        if result.stdout.strip():
            print(result.stdout.strip())
        if result.stderr.strip():
            print(f"WASM build failed:\n{result.stderr.strip()}")
        else:
            print("WASM build failed with no stderr output")
        return False

    manifest_path = BUILD_DIR / "manifest.json"
    if not manifest_path.exists():
        print("No manifest.json after build")
        return False

    manifest = json.loads(manifest_path.read_text())

    with build_lock:
        build_manifest = manifest

    print(f"WASM build complete: {manifest['buildId']}")
    return True


def current_build():
    with build_lock:
        return build_manifest


def require_build():
    build = current_build()
    if build is None:
        abort(503)
    return build


def session_response(session_id, session):
    if session["current_round"] >= MAX_ROUNDS:
        session["completed"] = True
        session["verdict"] = compute_verdict(session["results"], session.get("sitekey"))
        return {"complete": True, "verdict": session["verdict"]}

    return {"complete": False, "nextChallenge": build_challenge(session_id, session)}


def verify_submission(session_id, session, body):
    token = body.get("token")
    token_signature = body.get("tokenSignature")
    response_b64 = body.get("response")

    if not isinstance(token, dict):
        abort(400)
    if not all([token_signature, response_b64]):
        abort(400)
    if not verify_payload(token, token_signature):
        abort(403)
    if time.time() - token.get("issued_at", 0) > CHALLENGE_TTL:
        abort(403)
    if token.get("session_id") != session_id:
        abort(403)
    if token.get("build_id") != session["build_id"]:
        abort(403)

    build = current_build()
    if build is None or build.get("buildId") != session["build_id"]:
        abort(410)
    assert build is not None

    response_bytes = b""
    try:
        response_bytes = base64.b64decode(response_b64, validate=True)
    except ValueError:
        abort(400)

    encrypt_key = bytes.fromhex(build["keys"]["encrypt"])
    sign_key = bytes.fromhex(build["keys"]["sign"])
    plaintext = decrypt_vm_response(response_bytes, encrypt_key, sign_key)
    if plaintext is None:
        abort(403)

    result = None
    try:
        result = json.loads(plaintext)
    except json.JSONDecodeError:
        abort(400)

    if not isinstance(result, dict):
        abort(400)
    if result.get("nonce") != token.get("nonce"):
        abort(403)

    expected_round = token.get("round")
    if result.get("round") != expected_round:
        abort(403)

    with session_lock:
        if session["completed"]:
            abort(400)
        if session["current_round"] != expected_round:
            abort(409)

        if result.get("error"):
            session["current_round"] += 1
            return session_response(session_id, session)

        task = token.get("task", "")
        motion = result.get("motionHistory", [])
        server_liveness = validate_liveness(task, motion)
        vm_liveness = bool(result.get("livenessOk", False))
        result["liveness_ok"] = server_liveness and vm_liveness

        integrity = result.get("integrity")
        if not isinstance(integrity, (int, float)):
            abort(403)

        result["integrity"] = int(integrity)
        session["results"].append(result)
        session["current_round"] += 1
        return session_response(session_id, session)


def send_safe_file(base_dir, filename):
    path = (base_dir / filename).resolve()
    base = base_dir.resolve()

    if not path.is_relative_to(base):
        abort(403)
    if not path.is_file():
        abort(404)

    return send_from_directory(
        str(path.parent),
        path.name,
        mimetype=MIME_TYPES.get(path.suffix.lower()),
    )


@app.route("/")
def index():
    return render_template("index.html", sitekey=SITEKEY, secret_key=SECRET_KEY)


@app.route("/dist/<path:filename>")
def dist_files(filename):
    return send_safe_file(DIST_DIR, filename)


@app.route("/vm/<path:filename>")
def vm_files(filename):
    return send_safe_file(VM_DIR, filename)


@app.route("/api/session", methods=["POST"])
def create_session():
    body = request.get_json(silent=True) or {}
    if body.get("sitekey") != SITEKEY:
        abort(403)

    build = require_build()

    session_id = create_session_id()
    session = {
        "build_id": build["buildId"],
        "completed": False,
        "created_at": time.time(),
        "current_round": 0,
        "results": [],
        "sitekey": SITEKEY,
        "verdict": None,
    }

    with session_lock:
        sessions[session_id] = session

    models = {
        model_id: {"url": f"/vm/models/{info['file']}"}
        for model_id, info in build.get("models", {}).items()
    }

    return jsonify(
        {
            "challengeVmbc": "/vm/challenge.vmbc",
            "exports": build["exports"],
            "loaderJs": "/vm/loader.js",
            "models": models,
            "rounds": MAX_ROUNDS,
            "sessionId": session_id,
            "transport": "poll",
            "wasmBin": "/vm/vm.wasm",
            "wasmJs": "/vm/vm.js",
        }
    )


@app.route("/api/poll/<session_id>")
def poll_challenge(session_id):
    session = require_session(session_id)

    if session["completed"]:
        return jsonify({"type": "verdict", "verdict": session["verdict"]})

    return jsonify(build_challenge(session_id, session))


@app.route("/api/verify/<session_id>", methods=["POST"])
def verify_round(session_id):
    session = require_session(session_id)

    body = request.get_json(silent=True) or {}
    if not body:
        abort(400)

    return jsonify(verify_submission(session_id, session, body))


@app.route("/api/token/verify", methods=["POST"])
def verify_token_route():
    body = request.get_json(silent=True) or {}
    secret = body.get("secret")
    response_token = body.get("token")

    if not secret or not hmac_mod.compare_digest(secret, SECRET_KEY):
        abort(403)
    if not response_token:
        abort(400)

    payload = verify_response_token(response_token)
    if payload is None:
        return jsonify({"success": False})

    return jsonify(
        {
            "success": True,
            "ageConfirmed": payload.get("ageConfirmed"),
            "estimatedAge": payload.get("estimatedAge"),
            "sitekey": payload.get("sitekey"),
        }
    )


@app.after_request
def security_headers(response):
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    return response


def main():
    if not load_build():
        print("Building WASM VM...")
        if not rebuild_wasm():
            print(
                "Initial build failed. Ensure emscripten SDK is sourced: "
                "source /path/to/emsdk/emsdk_env.sh"
            )
            raise SystemExit(1)

    port = int(os.environ.get("PORT", "8000"))
    print(f"OpenAge server at http://localhost:{port}")
    print(f"  Index page:  http://localhost:{port}/")
    print(f"  Sitekey:     {SITEKEY}")
    print(f"  Secret key:  {SECRET_KEY}")
    app.run(host="0.0.0.0", port=port, debug=False, threaded=True)


if __name__ == "__main__":
    main()
