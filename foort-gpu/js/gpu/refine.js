// @ts-check
// Adaptive refinement (Stage 1B B6, plan 4.2-2; after FOORT's SquareSubdivisionMesh, Mesh.h). From a coarse level of
// stride s (pixel centres at fine pixel s i + (s - 1)/2), each cell between four coarse samples is traced at full
// resolution when
//  - its corners differ in termination class or number of disc crossings, or a corner did not escape or fall in cleanly
//    (time-outs, singularities, NaN): never interpolate across topologies;
//  - the interpolation error estimated at a corner exceeds the thresholds. Bilinear interpolation errs by about 1/8 of the
//    second difference of the coarse samples; for the escape direction this is converted to fine pixels through the
//    local Jacobian (first differences / s), as the quality gate measures sky errors; for the crossings' r and g it is
//    relative, for the delays absolute (units of M). A threshold on first differences instead would mark every lensed
//    region, where the mapping is steep but smooth.
// All other fine pixels are interpolated from the corners (backendWebGL2.js interpolateLevel). Pure math, DOM-free.

import { RECORD_FLOATS } from './traceConfig.js';

/**
 * @typedef {Object} RefineParams
 * @property {number} sky   estimated interpolation error of the escape direction, in fine pixels
 * @property {number} r     estimated relative interpolation error of crossing radii
 * @property {number} g     estimated relative interpolation error of redshifts
 * @property {number} dt    estimated interpolation error of delays, in units of M
 */

const TERM_ESCAPE = 2, TERM_HORIZON = 1;

/**
 * Fine pixels to trace.
 * @param {Float32Array} coarse  records of the coarse level (RECORD_FLOATS per pixel), cw x ch
 * @param {number} cw @param {number} ch @param {number} stride  coarse stride s
 * @param {number} W @param {number} H  fine image size
 * @param {RefineParams} p
 * @param {number} _spacingRad  (unused; kept for the call signature)
 * @param {number} M  mass unit for dt
 * @returns {{list: Int32Array, cells: number, marked: number}}  fine pixel indices i + W j, sorted
 */
export function refineList(coarse, cw, ch, stride, W, H, p, _spacingRad, M) {
  const F = RECORD_FLOATS;
  const n = cw * ch;
  const term = new Int32Array(n), passes = new Int32Array(n);
  const dir = new Float64Array(3 * n);
  for (let k = 0; k < n; k++) {
    const c = Math.round(coarse[F * k]);
    term[k] = c & 15; passes[k] = c >> 4;
    const th = coarse[F * k + 2], ph = coarse[F * k + 3];
    dir[3 * k] = Math.sin(th) * Math.cos(ph); dir[3 * k + 1] = Math.sin(th) * Math.sin(ph); dir[3 * k + 2] = Math.cos(th);
  }
  const same = (/** @type {number} */ a, /** @type {number} */ b) => term[a] === term[b] && passes[a] === passes[b];
  const clean = (/** @type {number} */ k) => term[k] === TERM_ESCAPE || term[k] === TERM_HORIZON;
  // per coarse sample: does bilinear interpolation around it err beyond the thresholds? (second differences along x
  // and y, where both neighbours have the same topology)
  const curved = new Uint8Array(n);
  const q = (/** @type {number} */ k, /** @type {number} */ c, /** @type {number} */ f) => coarse[F * k + 4 + 4 * c + f];
  for (let j = 0; j < ch; j++) for (let i = 0; i < cw; i++) {
    const k = j * cw + i;
    if (!clean(k)) continue;
    for (const [a, b] of [[i > 0 && i < cw - 1 ? k - 1 : -1, i > 0 && i < cw - 1 ? k + 1 : -1], [j > 0 && j < ch - 1 ? k - cw : -1, j > 0 && j < ch - 1 ? k + cw : -1]]) {
      if (a < 0 || !same(a, k) || !same(b, k)) continue;
      if (term[k] === TERM_ESCAPE) {
        // second difference of the direction (rad) over the first difference per fine pixel
        let d2 = 0, d1 = 0;
        for (let e = 0; e < 3; e++) {
          d2 += (dir[3 * a + e] - 2 * dir[3 * k + e] + dir[3 * b + e]) ** 2;
          d1 += ((dir[3 * b + e] - dir[3 * a + e]) / 2) ** 2;
        }
        const errPx = (Math.sqrt(d2) / 8) / Math.max(Math.sqrt(d1) / stride, 1e-30);
        if (errPx > p.sky) { curved[k] = 1; break; }
      }
      for (let c = 0; c < Math.min(passes[k], 3); c++) {
        const r = q(k, c, 0), g = q(k, c, 3);
        const er = Math.abs(q(a, c, 0) - 2 * r + q(b, c, 0)) / 8 / r;
        const eg = Math.abs(q(a, c, 3) - 2 * g + q(b, c, 3)) / 8 / g;
        const et = Math.abs(q(a, c, 2) - 2 * q(k, c, 2) + q(b, c, 2)) / 8 / M;
        if (!(er <= p.r) || !(eg <= p.g) || !(et <= p.dt)) { curved[k] = 1; break; }
      }
      if (curved[k]) break;
    }
  }
  const nx = Math.max(1, cw - 1), ny = Math.max(1, ch - 1);
  const marked = new Uint8Array(nx * ny);
  let nMarked = 0;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const ks = [j * cw + i, j * cw + Math.min(i + 1, cw - 1), Math.min(j + 1, ch - 1) * cw + i, Math.min(j + 1, ch - 1) * cw + Math.min(i + 1, cw - 1)];
    let m = false;
    for (const k of ks) if (!same(k, ks[0]) || !clean(k) || curved[k]) { m = true; break; }
    if (m) { marked[j * nx + i] = 1; nMarked++; }
  }
  // fine pixels of marked cells: cell i covers fine x in [s i + (s-1)/2, s (i+1) + (s-1)/2); the border pixels before the
  // first and after the last coarse sample belong to the first and last cell
  const off = (stride - 1) / 2;
  const cellOf = (/** @type {number} */ x, /** @type {number} */ nn) => Math.min(nn - 1, Math.max(0, Math.floor((x - off) / stride)));
  const list = [];
  for (let y = 0; y < H; y++) {
    const cj = cellOf(y, ny);
    for (let x = 0; x < W; x++) if (marked[cj * nx + cellOf(x, nx)]) list.push(y * W + x);
  }
  return { list: Int32Array.from(list), cells: nx * ny, marked: nMarked };
}
