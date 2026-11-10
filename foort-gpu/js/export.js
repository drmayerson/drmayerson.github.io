// @ts-check
// Stage 1B B9 export (plan 5.5): PNG snapshots with the view state embedded, and videos at a fixed observer-time step.
//  - PNG: the displayed image at trace resolution, optionally with the scale bar, clock and legend burned in; the view's
//    URL in a tEXt chunk (keyword "foort-gpu-url"), so a saved image can be traced again.
//  - Video: canvas.captureStream(0) + requestFrame() + MediaRecorder (WebM VP9 / VP8, or MP4 where the browser offers
//    it). The caller draws each frame at the next observer time; frames are paced at the chosen rate, so the video plays
//    smoothly whatever the GPU speed (the display pass is cheap: the records are not re-traced).

/** CRC-32 (PNG) */
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
/** @param {Uint8Array} b */
export function crc32(b) {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Insert a tEXt chunk (Latin-1 keyword and text) right after the IHDR chunk of a PNG.
 * @param {ArrayBuffer} png @param {string} keyword @param {string} text @returns {Uint8Array}
 */
export function pngWithText(png, keyword, text) {
  const src = new Uint8Array(png);
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  if (!sig.every((v, i) => src[i] === v)) throw new Error('not a PNG');
  const ihdrLen = (src[8] << 24) | (src[9] << 16) | (src[10] << 8) | src[11];
  const at = 8 + 12 + ihdrLen;   // after the IHDR chunk (length, type, data, CRC)
  const enc = (/** @type {string} */ s) => Uint8Array.from(s, (ch) => { const c = ch.charCodeAt(0); return c < 256 ? c : 63; });
  const data = new Uint8Array([...enc(keyword), 0, ...enc(text)]);
  const chunk = new Uint8Array(12 + data.length);
  const dv = new DataView(chunk.buffer);
  dv.setUint32(0, data.length);
  chunk.set(enc('tEXt'), 4);
  chunk.set(data, 8);
  dv.setUint32(8 + data.length, crc32(chunk.subarray(4, 8 + data.length)));
  const out = new Uint8Array(src.length + chunk.length);
  out.set(src.subarray(0, at), 0);
  out.set(chunk, at);
  out.set(src.subarray(at), at + chunk.length);
  return out;
}

/** The tEXt chunks of a PNG, keyword -> text (tests, and reading a saved view back). @param {ArrayBuffer|Uint8Array} png */
export function pngTexts(png) {
  const b = png instanceof Uint8Array ? png : new Uint8Array(png);
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  /** @type {Record<string, string>} */
  const out = {};
  for (let p = 8; p + 12 <= b.length;) {
    const len = dv.getUint32(p), type = String.fromCharCode(...b.subarray(p + 4, p + 8));
    if (type === 'tEXt') {
      const d = b.subarray(p + 8, p + 8 + len), z = d.indexOf(0);
      out[String.fromCharCode(...d.subarray(0, z))] = String.fromCharCode(...d.subarray(z + 1));
    }
    if (type === 'IEND') break;
    p += 12 + len;
  }
  return out;
}

/** a download of a blob @param {Blob} blob @param {string} name */
export function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/**
 * PNG of the canvas, with optional burned-in overlays (lines of text at the bottom, a scale bar), and the URL embedded.
 * @param {HTMLCanvasElement} canvas the WebGL canvas (drawn with preserveDrawingBuffer)
 * @param {{url: string, overlay?: {lines: string[], bar?: {frac: number, label: string}}}} o
 * @returns {Promise<Uint8Array>}
 */
export async function snapshotPng(canvas, o) {
  let src = canvas;
  if (o.overlay) {
    const c = document.createElement('canvas');
    c.width = canvas.width; c.height = canvas.height;
    const g = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'));
    g.drawImage(canvas, 0, 0);
    const fs = Math.max(10, Math.round(c.height / 45));
    g.font = `${fs}px system-ui, sans-serif`;
    g.fillStyle = '#fff'; g.shadowColor = '#000'; g.shadowBlur = 3;
    const lines = o.overlay.lines.filter(Boolean);
    lines.forEach((l, k) => g.fillText(l, fs * 0.6, c.height - fs * 0.6 - (lines.length - 1 - k) * fs * 1.3 - (o.overlay?.bar ? fs * 2 : 0)));
    if (o.overlay.bar) {
      const w = o.overlay.bar.frac * c.width, y = c.height - fs * 1.6;
      g.fillRect(fs * 0.6, y, w, Math.max(2, fs / 5));
      g.fillText(o.overlay.bar.label, fs * 0.6, y + fs * 1.15);
    }
    src = c;
  }
  const blob = await new Promise((res, rej) => src.toBlob((b) => (b ? res(b) : rej(new Error('toBlob failed'))), 'image/png'));
  return pngWithText(await /** @type {Blob} */ (blob).arrayBuffer(), 'foort-gpu-url', o.url);
}

/** the best recording format this browser offers (null: none) */
export function videoFormat() {
  if (typeof MediaRecorder === 'undefined') return null;
  for (const [mime, ext] of [['video/webm;codecs=vp9', 'webm'], ['video/webm;codecs=vp8', 'webm'], ['video/webm', 'webm'], ['video/mp4;codecs=avc1', 'mp4'], ['video/mp4', 'mp4']]) {
    if (MediaRecorder.isTypeSupported(mime)) return { mime, ext };
  }
  return null;
}

/**
 * Record a video of `frames` frames at `fps`: drawFrame(k) draws frame k (the caller sets the observer time), the
 * frame is then pushed to the stream. Cancellable; progress per frame.
 * @param {HTMLCanvasElement} canvas
 * @param {{frames: number, fps: number, drawFrame: (k: number) => void, onProgress?: (k: number) => void, cancelled?: () => boolean, bitsPerSecond?: number}} o
 * @returns {Promise<{blob: Blob, ext: string, mime: string}|null>} null if cancelled
 */
export async function recordVideo(canvas, o) {
  const fmt = videoFormat();
  if (!fmt) throw new Error('this browser cannot record video (no MediaRecorder for WebM or MP4)');
  const stream = /** @type {any} */ (canvas).captureStream(0);
  const track = stream.getVideoTracks()[0];
  const rec = new MediaRecorder(stream, { mimeType: fmt.mime, videoBitsPerSecond: o.bitsPerSecond ?? 12e6 });
  /** @type {Blob[]} */
  const parts = [];
  rec.ondataavailable = (e) => { if (e.data.size) parts.push(e.data); };
  const stopped = new Promise((res) => { rec.onstop = () => res(undefined); });
  rec.start();
  const dt = 1000 / o.fps;
  let next = performance.now();
  for (let k = 0; k < o.frames; k++) {
    if (o.cancelled?.()) { rec.stop(); await stopped; track.stop(); return null; }
    o.drawFrame(k);
    track.requestFrame();
    o.onProgress?.(k + 1);
    next += dt;
    const wait = next - performance.now();
    await new Promise((r) => setTimeout(r, Math.max(0, wait)));
  }
  rec.stop();
  await stopped;
  track.stop();
  return { blob: new Blob(parts, { type: fmt.mime.split(';')[0] }), ext: fmt.ext, mime: fmt.mime };
}
