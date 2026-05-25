#!/usr/bin/env python3
"""Dev HTTP server with no-cache headers (LAN-friendly)."""

from __future__ import annotations

import argparse
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class DevHandler(SimpleHTTPRequestHandler):
    def end_headers(self) -> None:
        # Avoid stale JS/CSS/data in browser during development
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        self.send_header("Pragma", "no-cache")
        super().end_headers()

    def log_message(self, format: str, *args) -> None:
        if args and isinstance(args[0], str) and args[1] == "404":
            super().log_message(format, *args)


def make_handler(root: Path):
    root_str = str(root)

    class BoundHandler(DevHandler):
        def __init__(self, request, client_address, server):
            super().__init__(request, client_address, server, directory=root_str)

    return BoundHandler


def main() -> int:
    parser = argparse.ArgumentParser(description="JuFo dev server")
    parser.add_argument("--port", type=int, default=8080)
    parser.add_argument("--directory", type=Path, default=Path("dist"))
    parser.add_argument("--bind", default="0.0.0.0")
    args = parser.parse_args()

    root = args.directory.resolve()
    if not (root / "index.html").is_file():
        print(f"Fehler: {root}/index.html fehlt — zuerst build.py ausführen.", flush=True)
        return 1

    server = ThreadingHTTPServer((args.bind, args.port), make_handler(root))
    print(f"Serving {root} on http://{args.bind}:{args.port}/", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nBeendet.", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
