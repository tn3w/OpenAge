import json
import sys
from http.server import HTTPServer, SimpleHTTPRequestHandler
from pathlib import Path

STATIC_DIR = Path(__file__).parent / "static"

MIME_OVERRIDES = {
    ".mjs": "application/javascript",
    ".wasm": "application/wasm",
    ".json": "application/json",
}


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(STATIC_DIR), **kwargs)

    def do_GET(self):
        if self.path == "/":
            self.path = "/index.html"
        super().do_GET()

    def do_POST(self):
        if self.path != "/api/result":
            self.send_error(404)
            return

        length = int(self.headers.get("Content-Length", 0))
        if length > 10_000:
            self.send_error(413)
            return

        body = self.rfile.read(length)
        try:
            data = json.loads(body)
        except json.JSONDecodeError:
            self.send_error(400)
            return

        allowed_keys = {
            "modelVersion", "decision", "errorCode",
            "livenessTasksCompleted", "retryCount", "timestamp",
        }
        filtered = {
            k: v for k, v in data.items()
            if k in allowed_keys and isinstance(v, (str, int, float))
        }

        print(json.dumps(filtered), flush=True)

        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(b'{"ok":true}')

    def guess_type(self, path):
        suffix = Path(path).suffix.lower()
        if suffix in MIME_OVERRIDES:
            return MIME_OVERRIDES[suffix]
        return super().guess_type(path)

    def end_headers(self):
        self.send_header(
            "Cache-Control", "no-cache, no-store, must-revalidate"
        )
        super().end_headers()


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    server = HTTPServer(("0.0.0.0", port), Handler)
    print(f"OpenAge server running at http://localhost:{port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
