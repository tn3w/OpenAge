import base64
import hashlib
import hmac as hmac_mod
import json
import os
import secrets
import struct
import subprocess
import threading
import time
import uuid
from pathlib import Path

from cryptography.hazmat.primitives.ciphers import Cipher, algorithms
from flask import Flask, abort, jsonify, request, send_from_directory
from flask_sock import Sock

ROOT = Path(__file__).parent
WASM_DIR = ROOT / "wasm"
BUILD_DIR = WASM_DIR / "build"
STATIC_DIR = ROOT / "static"
VM_OUT_DIR = STATIC_DIR / "vm"

REBUILD_INTERVAL = 600
MAX_BUILDS = 3
CHALLENGE_TTL = 60
MAX_ROUNDS = 3
SESSION_TTL = 300
SUPPORTED_TRANSPORTS = ["websocket", "poll"]
AGE_THRESHOLD = 18
FAIL_FLOOR = 15
AGE_ADJUSTMENT = 2
REQUIRED_LIVENESS_PASSES = 2

LIVENESS_TASKS = [
    "turn-left",
    "turn-right",
    "nod",
    "blink-twice",
    "move-closer",
]

app = Flask(__name__)
sock = Sock(app)
server_secret = secrets.token_bytes(32)

builds = {}
current_build_id = None
build_lock = threading.Lock()

sessions = {}
session_lock = threading.Lock()


def chacha20_crypt(data, key, nonce):
    counter = struct.pack("<I", 1)
    cipher = Cipher(algorithms.ChaCha20(key, counter + nonce), mode=None)
    encryptor = cipher.encryptor()
    return encryptor.update(data) + encryptor.finalize()


def hmac_sign(key, data):
    return hmac_mod.new(key, data, hashlib.sha256).digest()


def hmac_verify(key, data, expected):
    computed = hmac_sign(key, data)
    return hmac_mod.compare_digest(computed, expected)


def sign_token(token):
    payload = json.dumps(token, sort_keys=True, separators=(",", ":")).encode()
    return hmac_sign(server_secret, payload).hex()


def verify_token_sig(token, signature_hex):
    payload = json.dumps(token, sort_keys=True, separators=(",", ":")).encode()
    expected = hmac_sign(server_secret, payload)
    try:
        return hmac_mod.compare_digest(bytes.fromhex(signature_hex), expected)
    except ValueError:
        return False


def pick_tasks(nonce, count=3):
    digest = hashlib.sha256(nonce.encode()).digest()
    chosen = []
    for i in range(count):
        idx = digest[i] % len(LIVENESS_TASKS)
        while idx in [LIVENESS_TASKS.index(t) for t in chosen]:
            idx = (idx + 1) % len(LIVENESS_TASKS)
        chosen.append(LIVENESS_TASKS[idx])
    return chosen


def decrypt_vm_response(response_bytes, encrypt_key, sign_key):
    if len(response_bytes) < 52:
        return None

    magic = struct.unpack("<I", response_bytes[:4])[0]
    if magic != 0x564D5250:
        return None

    total_len = struct.unpack("<I", response_bytes[4:8])[0]
    if total_len != len(response_bytes):
        return None

    nonce = response_bytes[8:20]
    ct_len = total_len - 8 - 12 - 32
    if ct_len < 0:
        return None

    ciphertext = response_bytes[20 : 20 + ct_len]
    mac = response_bytes[20 + ct_len : 20 + ct_len + 32]

    signed_data = response_bytes[8 : 20 + ct_len]
    if not hmac_verify(sign_key, signed_data, mac):
        return None

    plaintext = chacha20_crypt(ciphertext, encrypt_key, nonce)
    return plaintext.decode("utf-8", errors="replace")


def rebuild_wasm():
    global current_build_id
    VM_OUT_DIR.mkdir(parents=True, exist_ok=True)

    result = subprocess.run(
        [
            "node",
            "scripts/build.js",
            "--out-dir",
            str(VM_OUT_DIR),
        ],
        cwd=str(WASM_DIR),
        capture_output=True,
        text=True,
        timeout=300,
    )

    if result.returncode != 0:
        output = result.stdout.strip()
        errors = result.stderr.strip()
        if output:
            print(output)
        if errors:
            print(f"WASM build failed:\n{errors}")
        else:
            print("WASM build failed with no stderr output")
        return False

    manifest_path = BUILD_DIR / "manifest.json"
    if not manifest_path.exists():
        print("No manifest.json after build")
        return False

    manifest = json.loads(manifest_path.read_text())
    build_id = manifest["buildId"]

    with build_lock:
        builds[build_id] = manifest
        current_build_id = build_id

        if len(builds) > MAX_BUILDS:
            oldest = sorted(
                builds.keys(),
                key=lambda k: builds[k]["timestamp"],
            )
            for old in oldest[: len(builds) - MAX_BUILDS]:
                del builds[old]

    print(f"WASM build complete: {build_id}")
    return True


def rebuild_loop():
    while True:
        time.sleep(REBUILD_INTERVAL)
        try:
            rebuild_wasm()
        except Exception as error:
            print(f"Rebuild error: {error}")


def cleanup_sessions():
    now = time.time()
    with session_lock:
        expired = [
            sid for sid, s in sessions.items() if now - s["created_at"] > SESSION_TTL
        ]
        for sid in expired:
            del sessions[sid]


def negotiate_transport(client_transports):
    if not isinstance(client_transports, list):
        return "poll"
    for transport in client_transports:
        if transport in SUPPORTED_TRANSPORTS:
            return transport
    return "poll"


def build_challenge(session_id, session):
    round_num = session["current_round"]
    nonce = secrets.token_hex(16)
    task = session["tasks"][round_num % len(session["tasks"])]

    token = {
        "session_id": session_id,
        "nonce": nonce,
        "build_id": session["build_id"],
        "round": round_num,
        "task": task,
        "issued_at": time.time(),
        "ttl": CHALLENGE_TTL,
    }
    token_sig = sign_token(token)
    session["current_token"] = token

    return {
        "type": "challenge",
        "round": round_num,
        "task": task,
        "token": token,
        "tokenSignature": token_sig,
    }


def validate_liveness(task, motion_history):
    if not motion_history or len(motion_history) < 5:
        return False

    poses = [f.get("headPose", {}) for f in motion_history]
    blendshapes = [f.get("blendshapes", {}) for f in motion_history]

    if task in ("turn-left", "turn-right"):
        yaws = [p.get("yaw", 0) for p in poses]
        base = yaws[0]
        sign = 1 if task == "turn-left" else -1
        return any((y - base) * sign > 20 for y in yaws)

    if task == "nod":
        pitches = [p.get("pitch", 0) for p in poses]
        base = pitches[0]
        went_down = any(p - base > 15 for p in pitches)
        came_back = any(abs(p - base) < 8 for p in pitches[len(pitches) // 2 :])
        return went_down and came_back

    if task == "blink-twice":
        blink_count = 0
        eyes_closed = False
        for bs in blendshapes:
            left = bs.get("eyeBlinkLeft", 0)
            right = bs.get("eyeBlinkRight", 0)
            both = left > 0.6 and right > 0.6
            if both and not eyes_closed:
                blink_count += 1
                eyes_closed = True
            elif not both:
                eyes_closed = False
        return blink_count >= 2

    if task == "move-closer":
        boxes = [f.get("boundingBox", {}) for f in motion_history]
        areas = [b.get("area", 0) for b in boxes if b]
        if len(areas) < 5 or areas[0] == 0:
            return False
        base = areas[0]
        went_closer = any(a / base > 1.3 for a in areas)
        came_back = any(a / base < 1.15 for a in areas[len(areas) // 2 :])
        return went_closer and came_back

    return False


def compute_trimmed_mean(values):
    if not values:
        return None

    ordered = sorted(values)
    trimmed = ordered[1:-1] if len(ordered) >= 3 else ordered
    return sum(trimmed) / len(trimmed)


def build_verdict(outcome, estimated_age=None, reason=None, raw_estimated_age=None):
    verdict = {
        "outcome": outcome,
        "reason": reason,
        "passThreshold": AGE_THRESHOLD,
        "ageAdjustment": AGE_ADJUSTMENT,
    }

    if estimated_age is not None:
        verdict["estimatedAge"] = round(estimated_age, 1)

    if raw_estimated_age is not None:
        verdict["rawEstimatedAge"] = round(raw_estimated_age, 1)

    return verdict


def compute_verdict(results):
    adjusted_ages = [
        r["age"] for r in results if isinstance(r.get("age"), (int, float))
    ]
    raw_ages = [
        r["rawAge"] for r in results if isinstance(r.get("rawAge"), (int, float))
    ]

    estimated_age = compute_trimmed_mean(adjusted_ages)
    raw_estimated_age = compute_trimmed_mean(raw_ages)

    liveness_passed = sum(1 for r in results if r.get("liveness_ok"))
    if liveness_passed < REQUIRED_LIVENESS_PASSES:
        reason = (
            f"Only {liveness_passed} of {MAX_ROUNDS} liveness checks passed. "
            f"{REQUIRED_LIVENESS_PASSES} are required"
        )
        return build_verdict("fail", estimated_age, reason, raw_estimated_age)

    if estimated_age is None:
        return build_verdict(
            "retry",
            reason="No reliable age estimate was produced",
            raw_estimated_age=raw_estimated_age,
        )

    if estimated_age >= AGE_THRESHOLD:
        return build_verdict("pass", estimated_age, None, raw_estimated_age)

    if estimated_age < FAIL_FLOOR:
        reason = (
            f"Pass threshold stays at {AGE_THRESHOLD}. Estimated age is the "
            f"scorer result minus {AGE_ADJUSTMENT}, and values below "
            f"{FAIL_FLOOR} fail"
        )
        return build_verdict("fail", estimated_age, reason, raw_estimated_age)

    reason = (
        f"Pass threshold stays at {AGE_THRESHOLD}. Estimated age is the "
        f"scorer result minus {AGE_ADJUSTMENT}"
    )
    return build_verdict("retry", estimated_age, reason, raw_estimated_age)


@app.route("/")
def index():
    return send_from_directory(str(STATIC_DIR), "index.html")


@app.route("/<path:filename>")
def static_files(filename):
    full = STATIC_DIR / filename
    if not full.is_file():
        abort(404)
    mime = None
    suffix = full.suffix.lower()
    if suffix == ".wasm":
        mime = "application/wasm"
    elif suffix == ".mjs":
        mime = "application/javascript"
    elif suffix == ".vmbc":
        mime = "application/octet-stream"
    return send_from_directory(str(full.parent), full.name, mimetype=mime)


@app.route("/api/session", methods=["POST"])
def create_session():
    cleanup_sessions()

    body = request.get_json(silent=True) or {}
    transport = negotiate_transport(body.get("supportedTransports", []))

    with build_lock:
        if not current_build_id:
            abort(
                503,
                description="No WASM build available",
            )
        build_id = current_build_id
        manifest = builds[build_id]

    session_id = str(uuid.uuid4())
    session_nonce = secrets.token_hex(16)
    tasks = pick_tasks(session_nonce)

    challenge_ready = threading.Event()
    challenge_ready.set()

    with session_lock:
        sessions[session_id] = {
            "build_id": build_id,
            "nonce": session_nonce,
            "tasks": tasks,
            "current_round": 0,
            "results": [],
            "created_at": time.time(),
            "completed": False,
            "verdict": None,
            "challenge_ready": challenge_ready,
            "current_token": None,
            "transport": transport,
        }

    model_urls = {}
    models_info = manifest.get("models", {})
    for model_id, info in models_info.items():
        model_urls[model_id] = {
            "url": f"/vm/models/{info['file']}",
            "originalName": info["originalName"],
            "size": info["size"],
        }

    return jsonify(
        {
            "sessionId": session_id,
            "buildId": build_id,
            "wasmJs": "/vm/vm.js",
            "wasmBin": "/vm/vm.wasm",
            "loaderJs": "/vm/loader.js",
            "challengeVmbc": "/vm/challenge.vmbc",
            "rounds": MAX_ROUNDS,
            "tasks": tasks,
            "exports": manifest["exports"],
            "models": model_urls,
            "transport": transport,
        }
    )


@app.route("/api/poll/<session_id>")
def poll_challenge(session_id):
    with session_lock:
        session = sessions.get(session_id)
    if not session:
        abort(404, description="Session not found")

    if session["completed"]:
        return jsonify(
            {
                "type": "verdict",
                "verdict": session["verdict"],
            }
        )

    ready = session["challenge_ready"].wait(timeout=30)
    if not ready:
        return jsonify({"type": "timeout"})

    with session_lock:
        challenge = build_challenge(session_id, session)

    return jsonify(challenge)


@app.route("/api/verify/<session_id>", methods=["POST"])
def verify_round(session_id):
    with session_lock:
        session = sessions.get(session_id)
    if not session:
        abort(404, description="Session not found")
    if session["completed"]:
        abort(400, description="Session completed")

    body = request.get_json()
    if not body:
        abort(400, description="Invalid body")

    token = body.get("token")
    token_sig = body.get("tokenSignature")
    response_b64 = body.get("response")

    if not all([token, token_sig, response_b64]):
        abort(400, description="Missing fields")

    if not verify_token_sig(token, token_sig):
        abort(403, description="Invalid token")

    issued = token.get("issued_at", 0)
    if time.time() - issued > CHALLENGE_TTL:
        abort(403, description="Challenge expired")

    if token.get("session_id") != session_id:
        abort(403, description="Session mismatch")

    build_id = session["build_id"]
    with build_lock:
        manifest = builds.get(build_id)
    if not manifest:
        abort(410, description="Build expired")

    response_bytes = base64.b64decode(response_b64)
    encrypt_key = bytes.fromhex(manifest["keys"]["encrypt"])
    sign_key = bytes.fromhex(manifest["keys"]["sign"])

    plaintext = decrypt_vm_response(response_bytes, encrypt_key, sign_key)
    if not plaintext:
        abort(403, description="VM verification failed")

    result = json.loads(plaintext)
    if not isinstance(result, dict):
        abort(400, description="Invalid payload")

    print(
        f"[verify] round={result.get('round')} "
        f"age={result.get('age')} "
        f"liveness={result.get('livenessOk')} "
        f"error={result.get('error')} "
        f"motion_len={len(result.get('motionHistory', []))}"
    )

    if result.get("nonce") != token.get("nonce"):
        abort(403, description="Nonce mismatch")

    expected_round = token.get("round")
    if result.get("round") != expected_round:
        abort(403, description="Round mismatch")

    if result.get("error"):
        with session_lock:
            session["current_round"] += 1
            next_challenge = build_challenge(session_id, session)
        return jsonify(
            {
                "accepted": False,
                "error": result["error"],
                "round": session["current_round"],
                "complete": False,
                "nextChallenge": next_challenge,
            }
        )

    task = token.get("task", "")
    motion = result.get("motionHistory", [])
    server_liveness = validate_liveness(task, motion)
    vm_liveness = result.get("livenessOk", False)
    liveness_ok = server_liveness and vm_liveness
    result["liveness_ok"] = liveness_ok

    integrity = result.get("integrity")
    if not isinstance(integrity, (int, float)):
        abort(403, description="Missing integrity")
    result["integrity"] = int(integrity)

    with session_lock:
        if session["current_round"] != expected_round:
            abort(
                409,
                description="Round already submitted",
            )
        session["results"].append(result)
        session["current_round"] += 1

        if session["current_round"] >= MAX_ROUNDS:
            session["completed"] = True
            session["verdict"] = compute_verdict(session["results"])
            return jsonify(
                {
                    "accepted": True,
                    "complete": True,
                    "verdict": session["verdict"],
                }
            )

        next_challenge = build_challenge(session_id, session)

    return jsonify(
        {
            "accepted": True,
            "complete": False,
            "round": session["current_round"],
            "nextChallenge": next_challenge,
        }
    )


@sock.route("/api/ws/<session_id>")
def ws_challenge(ws, session_id):
    with session_lock:
        session = sessions.get(session_id)
    if not session:
        ws.send(json.dumps({"error": "Session not found"}))
        return
    if session["transport"] != "websocket":
        ws.send(json.dumps({"error": "WebSocket not negotiated"}))
        return

    with session_lock:
        challenge = build_challenge(session_id, session)
    ws.send(json.dumps(challenge))

    while True:
        raw = ws.receive(timeout=CHALLENGE_TTL)
        if raw is None:
            return

        try:
            body = json.loads(raw)
        except (json.JSONDecodeError, TypeError):
            ws.send(json.dumps({"error": "Invalid JSON"}))
            return

        with session_lock:
            session = sessions.get(session_id)
        if not session:
            ws.send(json.dumps({"error": "Session expired"}))
            return

        result = process_verify(session_id, session, body)
        ws.send(json.dumps(result))

        if result.get("complete"):
            return
        if result.get("error") and not result.get("accepted", True):
            return


def process_verify(session_id, session, body):
    if session["completed"]:
        return {"error": "Session completed"}

    token = body.get("token")
    token_sig = body.get("tokenSignature")
    response_b64 = body.get("response")

    if not all([token, token_sig, response_b64]):
        return {"error": "Missing fields"}

    if not verify_token_sig(token, token_sig):
        return {"error": "Invalid token"}

    issued = token.get("issued_at", 0)
    if time.time() - issued > CHALLENGE_TTL:
        return {"error": "Challenge expired"}

    if token.get("session_id") != session_id:
        return {"error": "Session mismatch"}

    build_id = session["build_id"]
    with build_lock:
        manifest = builds.get(build_id)
    if not manifest:
        return {"error": "Build expired"}

    response_bytes = base64.b64decode(response_b64)
    encrypt_key = bytes.fromhex(manifest["keys"]["encrypt"])
    sign_key = bytes.fromhex(manifest["keys"]["sign"])

    plaintext = decrypt_vm_response(response_bytes, encrypt_key, sign_key)
    if not plaintext:
        return {"error": "VM verification failed"}

    result = json.loads(plaintext)
    if not isinstance(result, dict):
        return {"error": "Invalid payload"}

    print(
        f"[verify] round={result.get('round')} "
        f"age={result.get('age')} "
        f"liveness={result.get('livenessOk')} "
        f"error={result.get('error')} "
        f"motion_len={len(result.get('motionHistory', []))}"
    )

    if result.get("nonce") != token.get("nonce"):
        return {"error": "Nonce mismatch"}

    expected_round = token.get("round")
    if result.get("round") != expected_round:
        return {"error": "Round mismatch"}

    if result.get("error"):
        with session_lock:
            session["current_round"] += 1
            next_challenge = build_challenge(session_id, session)
        return {
            "accepted": False,
            "error": result["error"],
            "round": session["current_round"],
            "complete": False,
            "nextChallenge": next_challenge,
        }

    task = token.get("task", "")
    motion = result.get("motionHistory", [])
    server_liveness = validate_liveness(task, motion)
    vm_liveness = result.get("livenessOk", False)
    liveness_ok = server_liveness and vm_liveness
    result["liveness_ok"] = liveness_ok

    integrity = result.get("integrity")
    if not isinstance(integrity, (int, float)):
        return {"error": "Missing integrity"}
    result["integrity"] = int(integrity)

    with session_lock:
        if session["current_round"] != expected_round:
            return {"error": "Round already submitted"}
        session["results"].append(result)
        session["current_round"] += 1

        if session["current_round"] >= MAX_ROUNDS:
            session["completed"] = True
            session["verdict"] = compute_verdict(session["results"])
            return {
                "accepted": True,
                "complete": True,
                "verdict": session["verdict"],
            }

        next_challenge = build_challenge(session_id, session)

    return {
        "accepted": True,
        "complete": False,
        "round": session["current_round"],
        "nextChallenge": next_challenge,
    }


@app.after_request
def security_headers(response):
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    return response


def main():
    print("Building WASM VM...")
    if not rebuild_wasm():
        print(
            "Initial build failed. "
            "Ensure emscripten SDK is sourced: "
            "source /path/to/emsdk/emsdk_env.sh"
        )
        raise SystemExit(1)

    rebuild_thread = threading.Thread(target=rebuild_loop, daemon=True)
    rebuild_thread.start()

    port = int(os.environ.get("PORT", "8000"))
    print(f"OpenAge server at http://localhost:{port}")
    app.run(host="0.0.0.0", port=port, debug=False, threaded=True)


if __name__ == "__main__":
    main()
