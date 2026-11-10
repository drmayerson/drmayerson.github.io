// @ts-check
// Stage 1B B8 science readouts drawn on 2D canvases: the light-curve strip chart and the pixel inspector's ray plots
// and table. DOM-only helpers.
import { formatDuration } from '../units.js';

const css = (/** @type {string} */ v, /** @type {string} */ d) => getComputedStyle(document.documentElement).getPropertyValue(v).trim() || d;

/**
 * Strip chart of the light curve: flux / mean flux of the window against observer time (the last noise period, at
 * least 50 M), with the period marked; per image order (n = 1, 2, >= 3 + tail) on request.
 * @param {HTMLCanvasElement} cv @param {number[][]} series  rows (t, total, n1, n2, n3+)
 * @param {{period:number, units:{tS:number}|null, orders:boolean}} o
 */
export function drawLightCurve(cv, series, o) {
  const g = /** @type {CanvasRenderingContext2D} */ (cv.getContext('2d'));
  const W = cv.width, H = cv.height, padL = 46, padR = 10, padT = 10, padB = 30;
  g.clearRect(0, 0, W, H);
  const fg = css('--fg', '#222'), soft = css('--soft', '#777'), line = css('--line', '#ccc'), accent = css('--accent', '#b5482b');
  g.font = '11px system-ui, sans-serif';
  g.fillStyle = soft;
  if (series.length < 2) { g.fillText('light curve: play the animation (the flux of each frame, summed on the GPU)', padL, H / 2); return; }
  const tEnd = series[series.length - 1][0];
  const win = Math.max(o.period || 0, 50);
  const pts = series.filter((r) => r[0] >= tEnd - win);
  const tStart = Math.max(pts[0][0], tEnd - win);
  const mean = pts.reduce((a, r) => a + r[1], 0) / pts.length || 1;
  const curves = [[1, accent, 'total']];
  if (o.orders) curves.push([2, '#4a90d9', 'n = 1'], [3, '#e09a2c', 'n = 2'], [4, '#3fa66a', 'n ≥ 3']);
  let lo = Infinity, hi = -Infinity;
  for (const r of pts) for (const [c] of curves) { const v = r[/** @type {number} */ (c)] / mean; lo = Math.min(lo, v); hi = Math.max(hi, v); }
  if (!(hi > lo)) { hi = lo + 0.01; lo -= 0.01; }
  const padY = 0.08 * (hi - lo); lo -= padY; hi += padY;
  const X = (/** @type {number} */ t) => padL + ((t - tStart) / Math.max(tEnd - tStart, 1e-9)) * (W - padL - padR);
  const Y = (/** @type {number} */ v) => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);
  // axes and period marks
  g.strokeStyle = line; g.lineWidth = 1;
  g.strokeRect(padL, padT, W - padL - padR, H - padT - padB);
  if (o.period > 0) {
    g.setLineDash([3, 3]);
    for (let k = Math.ceil(tStart / o.period); k * o.period <= tEnd; k++) { const x = X(k * o.period); g.beginPath(); g.moveTo(x, padT); g.lineTo(x, H - padB); g.stroke(); }
    g.setLineDash([]);
  }
  g.fillStyle = soft;
  for (const v of [lo + padY, (lo + hi) / 2, hi - padY]) g.fillText(v.toFixed(3), 4, Y(v) + 4);
  const tl = (/** @type {number} */ t) => `${t.toFixed(0)} M${o.units ? ` (${formatDuration(t * o.units.tS)})` : ''}`;
  g.fillText(tl(tStart), padL, H - 12);
  const te = tl(tEnd); g.fillText(te, W - padR - g.measureText(te).width, H - 12);
  g.fillText(`flux / mean${o.period ? ` · dashed: the noise period T = ${o.period} M` : ''}`, padL + 120, H - 12);
  for (const [c, col, name] of curves) {
    g.strokeStyle = /** @type {string} */ (col); g.lineWidth = c === 1 ? 2 : 1.2;
    g.beginPath();
    pts.forEach((r, k) => { const x = X(r[0]), y = Y(r[/** @type {number} */ (c)] / mean); if (k) g.lineTo(x, y); else g.moveTo(x, y); });
    g.stroke();
    if (o.orders) { g.fillStyle = /** @type {string} */ (col); g.fillText(String(name), W - padR - 60, padT + 12 + 12 * (/** @type {number} */ (c) - 1)); }
  }
  g.fillStyle = fg;
}

/**
 * The inspected rays in the camera's meridional plane (X = r sin(theta) cos(phi - phi_cam), z = r cos(theta)) and the
 * equatorial plane (x, y), units of M, with the horizon or the fuzzball's singularities, and the disc crossings.
 * @param {HTMLCanvasElement} rz @param {HTMLCanvasElement} xy @param {{cpu:any, color:string}[]} rays
 */
export function drawInspector(rz, xy, rays) {
  const ok = rays.filter((r) => r.cpu && !r.cpu.error);
  // extent: 4 times the rays' closest approach (the fuzzball's cap lies at r << M), at least twice the horizon, at most 40 M
  let rmin = Infinity;
  for (const r of ok) { const p = r.cpu.path; for (let k = 0; k < p.length; k += 3) rmin = Math.min(rmin, p[k]); }
  const hz = ok[0]?.cpu.horizon?.kind === 'sphere' ? ok[0].cpu.horizon.r : 0;
  const ext = Math.min(40, Math.max(4 * (Number.isFinite(rmin) ? rmin : 10), 2 * hz, 0.01));
  for (const [cv, merid] of /** @type {[HTMLCanvasElement, boolean][]} */ ([[rz, true], [xy, false]])) {
    const g = /** @type {CanvasRenderingContext2D} */ (cv.getContext('2d'));
    const S = cv.width, c = S / 2, sc = (S / 2) / ext;
    g.fillStyle = '#0c0c10'; g.fillRect(0, 0, S, S);
    g.strokeStyle = '#333'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(0, c); g.lineTo(S, c); g.moveTo(c, 0); g.lineTo(c, S); g.stroke();
    g.fillStyle = '#888'; g.font = '11px system-ui, sans-serif';
    g.fillText(`${ext.toPrecision(2)} M`, S - 52, c - 4);
    const first = ok[0]?.cpu;
    if (first) {
      // the horizon, or the fuzzball's singularities (points on the axis, the equatorial ring)
      if (first.horizon?.kind === 'sphere') { g.fillStyle = '#000'; g.strokeStyle = '#777'; g.beginPath(); g.arc(c, c, first.horizon.r * sc, 0, 2 * Math.PI); g.fill(); g.stroke(); }
      g.fillStyle = '#ff5c8a'; g.strokeStyle = '#ff5c8a';
      for (const sg of first.singularities ?? []) {
        if (sg.kind === 'point') {
          const z = sg.r * Math.cos(sg.theta);
          if (merid) { g.beginPath(); g.arc(c, c - z * sc, 3, 0, 2 * Math.PI); g.fill(); }
          else { g.beginPath(); g.arc(c, c, 3, 0, 2 * Math.PI); g.fill(); }
        } else if (sg.kind === 'ring') {
          if (merid) for (const sx of [-1, 1]) { g.beginPath(); g.arc(c + sx * sg.r * sc, c, 3, 0, 2 * Math.PI); g.fill(); }
          else { g.beginPath(); g.arc(c, c, sg.r * sc, 0, 2 * Math.PI); g.stroke(); }
        }
      }
    }
    for (const r of ok) {
      const p = r.cpu.path, phi0 = p[2];
      g.strokeStyle = r.color; g.lineWidth = 1.5;
      g.beginPath();
      for (let k = 0; k < p.length; k += 3) {
        const R = p[k], th = p[k + 1], ph = p[k + 2];
        const u = merid ? R * Math.sin(th) * Math.cos(ph - phi0) : R * Math.sin(th) * Math.cos(ph);
        const v = merid ? R * Math.cos(th) : R * Math.sin(th) * Math.sin(ph);
        const x = c + u * sc, y = c - v * sc;
        if (k) g.lineTo(x, y); else g.moveTo(x, y);
      }
      g.stroke();
      g.fillStyle = r.color;
      for (const cr of r.cpu.crossings) {
        const u = merid ? cr.r * Math.cos(cr.phi - phi0) : cr.r * Math.cos(cr.phi), v = merid ? 0 : cr.r * Math.sin(cr.phi);
        g.beginPath(); g.arc(c + u * sc, c - v * sc, 3.5, 0, 2 * Math.PI); g.fill();
      }
    }
  }
}

const TERM = /** @type {Record<number, string>} */ ({ 1: 'horizon / inner cut', 2: 'escaped', 3: 'time out', 4: 'NaN', 6: 'singularity' });
const f = (/** @type {number} */ x, /** @type {number} */ d = 4) => (Number.isFinite(x) ? x.toPrecision(d) : '—');

/** the inspected rays: CPU (double) next to the GPU record @param {{i:number, j:number, cpu:any, gpu:any, color:string}[]} rays */
export function inspectorTable(rays) {
  if (!rays.length) return '';
  const rows = ['<tr><th></th><th>pixel</th><th>termination CPU / GPU</th><th>steps CPU / GPU</th><th>escape θ, φ CPU / GPU</th><th>crossings r, g, dt (M): CPU / GPU</th></tr>'];
  for (const r of rays) {
    const c = r.cpu, g = r.gpu;
    if (c?.error) { rows.push(`<tr><td style="color:${r.color}">●</td><td>(${r.i}, ${r.j})</td><td colspan="4">${c.error}</td></tr>`); continue; }
    const cr = [0, 1, 2].map((k) => {
      const a = c.crossings[k], b = g.crossings[k];
      if (!a && !b) return '';
      return `${a ? `${f(a.r)}, ${f(a.g)}, ${f(a.dt, 5)}` : '—'} / ${b ? `${f(b.r)}, ${f(b.g)}, ${f(b.dt, 5)}` : '—'}`;
    }).filter(Boolean).join('<br>');
    rows.push(`<tr><td style="color:${r.color}">●</td><td>(${r.i}, ${r.j})</td><td>${TERM[c.term] ?? c.term} / ${TERM[g.term] ?? g.term}</td><td>${c.steps} / ${g.steps}</td>`
      + `<td>${c.term === 2 ? `${f(c.theta)}, ${f(c.phi)}` : '—'} / ${g.term === 2 ? `${f(g.theta)}, ${f(g.phi)}` : '—'}</td><td>${cr || 'no crossings'}</td></tr>`);
  }
  return rows.join('');
}
