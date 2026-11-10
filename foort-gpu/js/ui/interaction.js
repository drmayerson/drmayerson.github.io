// @ts-check
// Stage 1B B7 (plan 5.2): interaction on the image and keyboard shortcuts.
//  - drag: horizontally the azimuth (display-only, instant), vertically the viewing angle (preview while dragging, full
//    trace on release); shift-drag or a two-finger drag pans; in split-screen compare a drag that starts on the divider
//    moves it;
//  - wheel or pinch: zoom (the caller shows an instant digital zoom while it re-traces; final trace after a pause);
//  - keys: space play/pause, f fullscreen, h hide panel, s snapshot, r record, e expert/normal, c compare, b blink A/B,
//    arrows azimuth / viewing angle, + and - zoom, ? help, Esc close.
// DOM-only glue: the caller supplies what each gesture does.

/**
 * @typedef {Object} InteractionApi
 * @property {(dDeg:number) => void} azimuth                    add to the azimuth (display only)
 * @property {(dDeg:number, final:boolean) => void} inclination  add to the viewing angle
 * @property {(factor:number, final:boolean) => void} zoom       multiply the field of view (factor < 1 zooms in)
 * @property {(dxFrac:number, dyFrac:number, final:boolean) => void} pan  move the screen centre by fractions of the field
 * @property {() => number|null} divider                         split-screen divider position (0..1) or null
 * @property {(f:number) => void} setDivider
 * @property {Record<string, () => void>} keys                   single-key actions (' ', 'f', 'h', 's', 'r', 'e', 'c', 'b', '?', 'Escape')
 */

/**
 * @param {HTMLCanvasElement} canvas @param {InteractionApi} api
 */
export function attachInteraction(canvas, api) {
  /** @type {Map<number, {x:number, y:number}>} */
  const pts = new Map();
  /** @type {'none'|'rotate'|'pan'|'divider'|'pinch'} */
  let mode = 'none';
  let incMoved = false, panMoved = false, zoomMoved = false;
  let pinchD = 0, pinchMid = { x: 0, y: 0 };
  const rect = () => canvas.getBoundingClientRect();
  const DEG_PER_PX_AZ = 0.5, DEG_PER_PX_INC = 0.3;

  const midDist = () => {
    const [a, b] = [...pts.values()];
    return { mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, d: Math.hypot(a.x - b.x, a.y - b.y) };
  };

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2) {
      mode = 'pinch';
      const m = midDist(); pinchD = m.d; pinchMid = m.mid;
      return;
    }
    const r = rect(), div = api.divider();
    if (div !== null && Math.abs(e.clientX - (r.left + div * r.width)) < 14) mode = 'divider';
    else mode = e.shiftKey ? 'pan' : 'rotate';
    incMoved = panMoved = zoomMoved = false;
  });

  canvas.addEventListener('pointermove', (e) => {
    const p = pts.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    const r = rect();
    if (mode === 'pinch' && pts.size === 2) {
      const m = midDist();
      if (pinchD > 0 && m.d > 0) { api.zoom(pinchD / m.d, false); zoomMoved = true; }
      api.pan(-(m.mid.x - pinchMid.x) / r.width, (m.mid.y - pinchMid.y) / r.height, false); panMoved = true;
      pinchD = m.d; pinchMid = m.mid;
    } else if (mode === 'divider') {
      api.setDivider(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)));
    } else if (mode === 'pan') {
      api.pan(-dx / r.width, dy / r.height, false); panMoved = true;
    } else if (mode === 'rotate') {
      if (dx) api.azimuth(-dx * DEG_PER_PX_AZ);
      if (dy) { api.inclination(-dy * DEG_PER_PX_INC, false); incMoved = true; }
    }
  });

  const end = (/** @type {PointerEvent} */ e) => {
    if (!pts.has(e.pointerId)) return;
    pts.delete(e.pointerId);
    if (pts.size > 0) return;
    // one full trace for the whole gesture
    if (incMoved) api.inclination(0, true);
    else if (zoomMoved) api.zoom(1, true);
    else if (panMoved) api.pan(0, 0, true);
    mode = 'none';
    incMoved = panMoved = zoomMoved = false;
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);

  // wheel: zoom with a short pause before the full trace
  /** @type {ReturnType<typeof setTimeout>|null} */
  let wheelTimer = null;
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    api.zoom(Math.exp(e.deltaY * 0.0015), false);
    if (wheelTimer) clearTimeout(wheelTimer);
    wheelTimer = setTimeout(() => { wheelTimer = null; api.zoom(1, true); }, 300);
  }, { passive: false });

  window.addEventListener('keydown', (e) => {
    const t = /** @type {HTMLElement|null} */ (e.target);
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA') && e.key !== 'Escape') return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    if (k === 'ArrowLeft' || k === 'ArrowRight') { api.azimuth(k === 'ArrowLeft' ? -5 : 5); e.preventDefault(); return; }
    if (k === 'ArrowUp' || k === 'ArrowDown') { api.inclination(k === 'ArrowUp' ? -2 : 2, true); e.preventDefault(); return; }
    if (k === '+' || k === '=') { api.zoom(0.8, true); return; }
    if (k === '-' || k === '_') { api.zoom(1.25, true); return; }
    const a = api.keys[k === ' ' ? ' ' : k.length === 1 ? k.toLowerCase() : k];
    if (a) { e.preventDefault(); a(); }
  });
}
