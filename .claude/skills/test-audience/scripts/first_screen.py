#!/usr/bin/env python3
"""Save PNG screenshots of an app's first screen at visitor device sizes.

Uses a locally installed Chrome, Edge or Chromium in headless mode; no packages needed.

    python first_screen.py <url-or-local-folder> <out_dir> [--sizes phone,laptop,kiosk] [--query kiosk=1] [--wait 4000] [--root .]

A local folder (e.g. "chirp-karaoke", relative to --root) is served by the script itself on 127.0.0.1.

Sizes: phone 390x844, small-phone 360x640, tablet 1024x768, laptop 1366x768,
desktop 1920x1080, kiosk 1920x1080. Writes <out_dir>/first_<size>.png and prints the paths.
Phone sizes are plain window sizes (no device emulation): good for layout, not for UA-specific behaviour.
"""
import argparse
import functools
import os
import platform
import re
import shutil
import subprocess
import sys
import tempfile
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from html import escape
from urllib.parse import parse_qs, quote, urlsplit, urlunsplit


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        parts = urlsplit(self.path)
        if parts.path != "/__frame":
            return super().do_GET()
        q = parse_qs(parts.query)
        w, h, src = int(q["w"][0]), int(q["h"][0]), q["src"][0]
        body = (f'<!doctype html><html><body style="margin:0;overflow:hidden;background:#fff">'
                f'<iframe src="{escape(src)}" allow="autoplay; microphone; camera" '
                f'style="position:fixed;left:0;top:0;width:{w}px;height:{h}px;border:0"></iframe>'
                f'</body></html>').encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

SIZES = {
    "phone": (390, 844),
    "small-phone": (360, 640),
    "tablet": (1024, 768),
    "laptop": (1366, 768),
    "desktop": (1920, 1080),
    "kiosk": (1920, 1080),
}


def find_browser():
    env = os.environ.get("CHROME_PATH")
    if env and os.path.exists(env):
        return env
    for name in ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "chrome", "msedge", "microsoft-edge"):
        p = shutil.which(name)
        if p:
            return p
    candidates = []
    system = platform.system()
    if system == "Windows":
        for base in (os.environ.get("PROGRAMFILES", r"C:\Program Files"),
                     os.environ.get("PROGRAMFILES(X86)", r"C:\Program Files (x86)"),
                     os.environ.get("LOCALAPPDATA", "")):
            candidates += [os.path.join(base, r"Google\Chrome\Application\chrome.exe"),
                           os.path.join(base, r"Microsoft\Edge\Application\msedge.exe")]
    elif system == "Darwin":
        candidates += ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
                       "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
                       "/Applications/Chromium.app/Contents/MacOS/Chromium"]
    for c in candidates:
        if c and os.path.exists(c):
            return c
    return None


def add_query(url, query):
    if not query:
        return url
    parts = urlsplit(url)
    q = parts.query + ("&" if parts.query else "") + query
    return urlunsplit((parts.scheme, parts.netloc, parts.path, q, parts.fragment))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("url")
    ap.add_argument("out_dir")
    ap.add_argument("--sizes", default="phone,laptop")
    ap.add_argument("--query", default="", help="extra query string, e.g. kiosk=1&lang=nl")
    ap.add_argument("--wait", type=int, default=4000, help="virtual time budget in ms before the shot")
    ap.add_argument("--root", default=".", help="folder to serve when <url> is a local path (default: current folder)")
    args = ap.parse_args()

    browser = find_browser()
    if not browser:
        print("No Chrome/Edge/Chromium found (set CHROME_PATH). Skip screenshots and describe the first screen in the dossier.", file=sys.stderr)
        sys.exit(2)

    os.makedirs(args.out_dir, exist_ok=True)
    # Local server: serves --root (for local folders) and /__frame, a wrapper page that shows the app in an
    # iframe of exactly the requested size. Headless Chrome lays pages out at least ~500 px wide whatever
    # --window-size says, so phone widths need the iframe to get a true phone layout.
    handler = functools.partial(QuietHandler, directory=os.path.abspath(args.root))
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{server.server_address[1]}"
    url = args.url
    if not re.match(r"^https?://", url):
        url = f"{base}/{url.strip('/').replace(os.sep, '/')}/"
        print(f"serving {os.path.abspath(args.root)} at {url}")
    url = add_query(url, args.query)
    ok = True
    for size in [s.strip() for s in args.sizes.split(",") if s.strip()]:
        if size not in SIZES:
            print(f"unknown size '{size}' (known: {', '.join(SIZES)})", file=sys.stderr)
            ok = False
            continue
        w, h = SIZES[size]
        out = os.path.abspath(os.path.join(args.out_dir, f"first_{size}.png"))
        frame = f"{base}/__frame?w={w}&h={h}&src={quote(url, safe='')}"
        with tempfile.TemporaryDirectory() as profile:
            cmd = [browser, "--headless=new", "--disable-gpu", "--hide-scrollbars", "--mute-audio",
                   "--no-first-run", "--no-default-browser-check", f"--user-data-dir={profile}",
                   f"--window-size={w},{h}", f"--virtual-time-budget={args.wait}",
                   f"--screenshot={out}", frame]
            try:
                subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=90)
            except subprocess.TimeoutExpired:
                print(f"timeout for {size}", file=sys.stderr)
        if os.path.exists(out):
            print(f"{size} {w}x{h}: {out}")
        else:
            print(f"failed: {size}", file=sys.stderr)
            ok = False
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
