#!/usr/bin/env python3
"""Screenshots of an app at visitor device sizes, including states reached by clicking.

Drives a locally installed Chrome, Edge or Chromium (headless) over the DevTools protocol.
Standard library only. WebGL works (SwiftShader), so canvas/WebGL apps render too.

    python capture.py <url-or-local-folder> <out_dir> [--sizes phone,laptop] [--query lang=nl]
                      [--steps STEPS] [--root .] [--fake-camera] [--lang nl]

<url-or-local-folder>: a URL, or a folder (relative to --root, default ".") that the script serves itself.
--sizes: phone 390x844 · small-phone 360x640 · tablet 1024x768 · laptop 1366x768 · desktop/kiosk 1920x1080
         (phones and tablet are emulated as touch devices).
--steps: a JSON list, inline or a path to a .json file, run in order for every size, e.g.
         '[{"wait": 3000}, {"shot": "S1"}, {"js": "document.querySelector(\\"#start\\").click()"},
           {"wait": 2000}, {"shot": "S2"}, {"scroll": 800}, {"shot": "S2-below"}]'
         Default: [{"wait": 3000}, {"shot": "first"}].
         Step kinds: wait (ms) · js (code, awaited if it returns a promise; add "print": true to
         print its result) · shot (name) · scroll (px to scroll the window to) · click (CSS selector).
         Tip: {"js": "<contents of inspect-screen.js>", "print": true} measures a screen.
--lang: browser language (navigator.language), e.g. nl, fr-BE. Default: en.
--fake-camera: grant camera/microphone and feed Chrome's synthetic test video and beep.
Files: <out_dir>/<shot>_<size>.png. Paths are printed; JS errors are printed and do not stop the run.
"""
import argparse
import base64
import functools
import json
import os
import platform
import re
import shutil
import socket
import struct
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit, urlunsplit

SIZES = {
    "phone": (390, 844, True),
    "small-phone": (360, 640, True),
    "tablet": (1024, 768, True),
    "laptop": (1366, 768, False),
    "desktop": (1920, 1080, False),
    "kiosk": (1920, 1080, False),
}


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


def find_browser():
    env = os.environ.get("CHROME_PATH")
    if env and os.path.exists(env):
        return env
    for name in ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "chrome", "msedge", "microsoft-edge"):
        p = shutil.which(name)
        if p:
            return p
    candidates = []
    if platform.system() == "Windows":
        for base in (os.environ.get("PROGRAMFILES", r"C:\Program Files"),
                     os.environ.get("PROGRAMFILES(X86)", r"C:\Program Files (x86)"),
                     os.environ.get("LOCALAPPDATA", "")):
            candidates += [os.path.join(base, r"Google\Chrome\Application\chrome.exe"),
                           os.path.join(base, r"Microsoft\Edge\Application\msedge.exe")]
    elif platform.system() == "Darwin":
        candidates += ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
                       "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
                       "/Applications/Chromium.app/Contents/MacOS/Chromium"]
    return next((c for c in candidates if c and os.path.exists(c)), None)


# ---------- minimal WebSocket client (enough for the DevTools protocol) ----------
class WS:
    def __init__(self, url):
        u = urlsplit(url)
        self.s = socket.create_connection((u.hostname, u.port), timeout=60)
        key = base64.b64encode(os.urandom(16)).decode()
        req = (f"GET {u.path} HTTP/1.1\r\nHost: {u.hostname}:{u.port}\r\nUpgrade: websocket\r\n"
               f"Connection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n")
        self.s.sendall(req.encode())
        buf = b""
        while b"\r\n\r\n" not in buf:
            chunk = self.s.recv(4096)
            if not chunk:
                raise ConnectionError("websocket handshake failed")
            buf += chunk
        if b" 101 " not in buf.split(b"\r\n", 1)[0]:
            raise ConnectionError(buf.split(b"\r\n", 1)[0].decode(errors="replace"))
        self.rest = buf.split(b"\r\n\r\n", 1)[1]

    def _read(self, n):
        while len(self.rest) < n:
            chunk = self.s.recv(max(65536, n - len(self.rest)))
            if not chunk:
                raise ConnectionError("websocket closed")
            self.rest += chunk
        out, self.rest = self.rest[:n], self.rest[n:]
        return out

    def send(self, text):
        data = text.encode()
        head = bytearray([0x81])
        n = len(data)
        if n < 126:
            head.append(0x80 | n)
        elif n < 65536:
            head.append(0x80 | 126); head += struct.pack(">H", n)
        else:
            head.append(0x80 | 127); head += struct.pack(">Q", n)
        mask = os.urandom(4)
        self.s.sendall(bytes(head) + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(data)))

    def recv(self):
        msg = b""
        while True:
            b0, b1 = self._read(2)
            n = b1 & 0x7F
            if n == 126:
                n = struct.unpack(">H", self._read(2))[0]
            elif n == 127:
                n = struct.unpack(">Q", self._read(8))[0]
            payload = self._read(n)
            op = b0 & 0x0F
            if op == 0x8:
                raise ConnectionError("websocket closed by browser")
            if op in (0x9, 0xA):  # ping/pong: ignore
                continue
            msg += payload
            if b0 & 0x80:
                return msg.decode("utf-8", errors="replace")


class CDP:
    def __init__(self, ws_url):
        self.ws, self.n = WS(ws_url), 0

    def call(self, method, **params):
        self.n += 1
        my = self.n
        self.ws.send(json.dumps({"id": my, "method": method, "params": params}))
        while True:
            m = json.loads(self.ws.recv())
            if m.get("id") == my:
                if "error" in m:
                    raise RuntimeError(f"{method}: {m['error'].get('message')}")
                return m.get("result", {})


def add_query(url, query):
    if not query:
        return url
    p = urlsplit(url)
    return urlunsplit((p.scheme, p.netloc, p.path, p.query + ("&" if p.query else "") + query, p.fragment))


def run_size(browser, url, size, steps, out_dir, lang, fake_camera):
    w, h, touch = SIZES[size]
    shots = []
    with tempfile.TemporaryDirectory() as profile:
        cmd = [browser, "--headless=new", "--remote-debugging-port=0", "--remote-allow-origins=*",
               f"--user-data-dir={profile}", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
               "--hide-scrollbars", "--mute-audio", "--no-first-run", "--no-default-browser-check",
               "--autoplay-policy=no-user-gesture-required", f"--lang={lang}", f"--window-size={w},{h}"]
        if fake_camera:
            cmd += ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"]
        cmd.append("about:blank")
        proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            port_file = os.path.join(profile, "DevToolsActivePort")
            for _ in range(200):
                if os.path.exists(port_file) and open(port_file).read().strip():
                    break
                time.sleep(0.05)
            port = int(open(port_file).read().split()[0])
            targets = json.load(urllib.request.urlopen(f"http://127.0.0.1:{port}/json/list"))
            page = next(t for t in targets if t.get("type") == "page")
            c = CDP(page["webSocketDebuggerUrl"])
            c.call("Page.enable")
            c.call("Emulation.setDeviceMetricsOverride", width=w, height=h, deviceScaleFactor=1, mobile=touch)
            if touch:
                c.call("Emulation.setTouchEmulationEnabled", enabled=True, maxTouchPoints=5)
            c.call("Emulation.setLocaleOverride", locale=lang)
            c.call("Network.setUserAgentOverride", userAgent=c.call("Browser.getVersion")["userAgent"].replace("HeadlessChrome", "Chrome"),
                   acceptLanguage=lang)
            c.call("Page.navigate", url=url)
            for step in steps:
                if "wait" in step:
                    time.sleep(step["wait"] / 1000)
                elif "js" in step or "click" in step:
                    code = step.get("js") or f"document.querySelector({json.dumps(step['click'])}).click()"
                    r = c.call("Runtime.evaluate", expression=code, awaitPromise=True, returnByValue=True, userGesture=True)
                    if "exceptionDetails" in r:
                        print(f"[{size}] js error: {r['exceptionDetails'].get('exception', {}).get('description', r['exceptionDetails'].get('text'))}", file=sys.stderr)
                    elif step.get("print"):
                        v = r.get("result", {}).get("value")
                        print(f"[{size}] {v if isinstance(v, str) else json.dumps(v, ensure_ascii=False)}")
                elif "scroll" in step:
                    c.call("Runtime.evaluate", expression=f"window.scrollTo(0,{int(step['scroll'])})")
                    time.sleep(0.3)
                elif "shot" in step:
                    data = c.call("Page.captureScreenshot", format="png")["data"]
                    out = os.path.abspath(os.path.join(out_dir, f"{step['shot']}_{size}.png"))
                    with open(out, "wb") as fh:
                        fh.write(base64.b64decode(data))
                    shots.append(out)
                    print(f"{size} {w}x{h}: {out}")
        finally:
            proc.terminate()
            try:
                proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                proc.kill()
    return shots


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("url")
    ap.add_argument("out_dir")
    ap.add_argument("--sizes", default="phone,laptop")
    ap.add_argument("--query", default="")
    ap.add_argument("--steps", default="")
    ap.add_argument("--root", default=".")
    ap.add_argument("--lang", default="en")
    ap.add_argument("--fake-camera", action="store_true")
    args = ap.parse_args()
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:  # noqa: BLE001
        pass

    browser = find_browser()
    if not browser:
        print("No Chrome/Edge/Chromium found (set CHROME_PATH). Describe the screens in the dossier instead.", file=sys.stderr)
        sys.exit(2)
    steps = [{"wait": 3000}, {"shot": "first"}]
    if args.steps:
        steps = json.load(open(args.steps, encoding="utf-8")) if os.path.exists(args.steps) else json.loads(args.steps)

    os.makedirs(args.out_dir, exist_ok=True)
    url = args.url
    if not re.match(r"^https?://", url):
        handler = functools.partial(QuietHandler, directory=os.path.abspath(args.root))
        server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        url = f"http://127.0.0.1:{server.server_address[1]}/{url.strip('/').replace(os.sep, '/')}/"
        print(f"serving {os.path.abspath(args.root)} at {url}")
    url = add_query(url, args.query)

    ok = True
    for size in [s.strip() for s in args.sizes.split(",") if s.strip()]:
        if size not in SIZES:
            print(f"unknown size '{size}' (known: {', '.join(SIZES)})", file=sys.stderr)
            ok = False
            continue
        try:
            run_size(browser, url, size, steps, args.out_dir, args.lang, args.fake_camera)
        except Exception as e:  # noqa: BLE001
            print(f"[{size}] failed: {e}", file=sys.stderr)
            ok = False
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
