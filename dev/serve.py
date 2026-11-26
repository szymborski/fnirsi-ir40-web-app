"""Local dev server with no cache. Run: python3 dev/serve.py [port]. Open http://localhost:8640/?demo"""
import http.server
import os
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8640


class NoCache(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, ".js": "text/javascript", ".webmanifest": "application/manifest+json"}

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
http.server.ThreadingHTTPServer(("127.0.0.1", PORT), NoCache).serve_forever()
