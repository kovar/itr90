#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# ///
"""
Local dev server — serves the app at http://localhost:8001
Required because ES modules don't load over file:// URLs.

Usage:
    uv run serve.py
    open http://localhost:8001
"""
import http.server
import os
import webbrowser

PORT = 8001
os.chdir(os.path.dirname(os.path.abspath(__file__)))
server = http.server.HTTPServer(("", PORT), http.server.SimpleHTTPRequestHandler)
print(f"Serving at http://localhost:{PORT}")
webbrowser.open(f"http://localhost:{PORT}")
server.serve_forever()
