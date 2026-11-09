#!/usr/bin/env python3
"""Local server that resolves URLs the way the deployment does.

vercel.json sets cleanUrls, so /aia/article/50 is aia/article/50.html and /aia
is aia/index.html, and an unknown path gets 404.html. The reader puts those
extensionless paths in the address bar, so a plain `python3 -m http.server`
404s on reload.

    python3 build/serve.py [port]
"""

from __future__ import annotations

import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parent.parent


class Handler(SimpleHTTPRequestHandler):
    def send_head(self):
        rel = unquote(urlsplit(self.path).path).strip("/")
        target = ROOT / rel
        if not target.is_file():
            for candidate in (ROOT / (rel + ".html"), target / "index.html"):
                if rel and candidate.is_file() or candidate == ROOT / "index.html":
                    self.path = "/" + candidate.relative_to(ROOT).as_posix()
                    break
            else:
                return self.not_found()
        return super().send_head()

    def not_found(self):
        body = (ROOT / "404.html").read_bytes()
        self.send_response(404)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        return __import__("io").BytesIO(body)


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 4173
    server = ThreadingHTTPServer(("127.0.0.1", port), partial(Handler, directory=str(ROOT)))
    print("http://127.0.0.1:%d" % port)
    server.serve_forever()
