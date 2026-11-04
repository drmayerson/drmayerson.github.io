// @ts-check
// Bicubic Hermite evaluation of the baked tables, line for line the same as shaders/glsl/trace.glsl
// (lookupTables), in double precision: used by the tests and the grid-error study.
// The polar argument is the GPU's pole-distance state (delta, hemi), see shaders/glsl/common.glsl.
import { backgroundG } from './bake.js';

/** @param {number} t */
const basis = (t) => {
  const t2 = t * t, t3 = t2 * t;
  return {
    h0: 2 * t3 - 3 * t2 + 1, h1: -2 * t3 + 3 * t2, g0: t3 - 2 * t2 + t, g1: t3 - t2,
    dh0: 6 * t2 - 6 * t, dh1: -6 * t2 + 6 * t, dg0: 3 * t2 - 4 * t + 1, dg1: 3 * t2 - 2 * t,
  };
};

/**
 * Values and derivatives of G0..G4 at (x, delta) in hemisphere `hemi`.
 * @param {import('./bake.js').BakedTables} T
 * @param {number} x @param {number} delta @param {number} hemi
 * @returns {{v: Float64Array, dx: Float64Array, dd: Float64Array}}  dd = derivative with respect to delta
 */
export function lookupTables(T, x, delta, hemi) {
  const g = T.grid;
  // table angle and the factor d(table angle)/d(delta)
  let th, m;
  if (g.symmetric) { th = delta; m = 1; }
  else { th = hemi > 0 ? delta : Math.PI - delta; m = hemi; }
  if (th < 0) { th = -th; m = -m; }                       // mirror through the axis (RK stages)
  if (th > g.thMax) { th = 2 * g.thMax - th; m = -m; }    // through the equator (half table) or the south axis
  const fu = (x - g.xMin) / g.dx, fv = th / g.dth;
  const i = Math.min(Math.max(Math.floor(fu), 0), g.nx - 2), j = Math.min(Math.max(Math.floor(fv), 0), g.nth - 2);
  const u = Math.min(Math.max(fu - i, 0), 1), w = Math.min(Math.max(fv - j, 0), 1);
  const bu = basis(u), bv = basis(w);
  const hu = [bu.h0, bu.h1], gu = [bu.g0, bu.g1], dhu = [bu.dh0, bu.dh1], dgu = [bu.dg0, bu.dg1];
  const hv = [bv.h0, bv.h1], gv = [bv.g0, bv.g1], dhv = [bv.dh0, bv.dh1], dgv = [bv.dg0, bv.dg1];
  const v = new Float64Array(5), dx = new Float64Array(5), dd = new Float64Array(5);
  const layer = g.nx * g.nth * 4;
  for (let l = 0; l < 5; l++) {
    let p = 0, px = 0, pt = 0;
    for (let b = 0; b < 2; b++) for (let a = 0; a < 2; a++) {
      const o = l * layer + ((j + b) * g.nx + (i + a)) * 4;
      const F = T.data[o], X = T.data[o + 1] * g.dx, Th = T.data[o + 2] * g.dth, XT = T.data[o + 3] * g.dx * g.dth;
      p += F * hu[a] * hv[b] + X * gu[a] * hv[b] + Th * hu[a] * gv[b] + XT * gu[a] * gv[b];
      px += F * dhu[a] * hv[b] + X * dgu[a] * hv[b] + Th * dhu[a] * gv[b] + XT * dgu[a] * gv[b];
      pt += F * hu[a] * dhv[b] + X * gu[a] * dhv[b] + Th * hu[a] * dgv[b] + XT * gu[a] * dgv[b];
    }
    v[l] = p; dx[l] = px / g.dx; dd[l] = m * pt / g.dth;
  }
  // add the analytic background (functions of r only)
  const bg = backgroundG(g.r0 + Math.exp(x), g.r0, g.M);
  for (let l = 0; l < 5; l++) { v[l] += bg.B[l]; dx[l] += bg.dB[l]; }
  return { v, dx, dd };
}

/** Equatorial emitter (u^t, Omega) at x: 1/u^t and Omega linear in x (shaders/glsl/trace.glsl). @param {import('./bake.js').BakedTables} T @param {number} x */
export function lookupEquator(T, x) {
  const g = T.grid;
  const f = Math.min(Math.max((x - g.xMin) / g.dxEq, 0), g.nEq - 1);
  const i = Math.min(Math.floor(f), g.nEq - 2), u = f - i;
  const e = T.equator;
  if (!(e[4 * i] >= 0 && e[4 * i + 4] >= 0)) return { ut: 0, Om: 0 };   // no circular orbit in this cell
  const iut = e[4 * i] * (1 - u) + e[4 * i + 4] * u;
  return { ut: iut > 0 ? 1 / iut : 0, Om: e[4 * i + 1] * (1 - u) + e[4 * i + 5] * u };
}
