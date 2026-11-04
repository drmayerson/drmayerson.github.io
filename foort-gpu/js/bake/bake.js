// @ts-check
// Metric tables for the GPU (plan Section 3.4), baked in double precision.
// Functions on an (x, theta) grid, x = log(r - r0):
//   G0 = g^tt, G1 = g^tphi, G2 = sin^2(theta) g^phiphi, G3 = g^xx = g^rr / (r - r0)^2, G4 = g^thth.
// One metric evaluation per node; derivatives by 4th-order finite differences on the grid
// (one-sided in x at the ends; in theta, mirror ghost nodes: every G_k is even about the axis,
// and about the equator for equatorially symmetric metrics, whose tables cover [0, pi/2] only).
// The tables hold residuals G_k - B_k over an analytic background B_k(r) (backgroundG, also in the
// shader): float32 storage rounds |G| at ~6e-8 relative, which at large r is larger than the
// geometric terms of H (g^tt p_t^2 and g^xx p_x^2 cancel down to ~b^2 / r^2); the residuals are
// small there. The background is regular for r > r0 and has the large-r behaviour of a mass M = M_ADM:
//   B0 = -(1 + 2M/r + 4M^2/r^2), B1 = 0, B2 = B4 = 1/r^2, B3 = r / ((r + 2M) ((r - r0)^2 + M^2)).
// Packed per node as the Hermite data (f, f_x, f_theta, f_xtheta) of each function: a 5-layer
// RGBA32F array, layer k = G_k, row j = theta node, column i = x node.
// Also a 1D equatorial table (1/u^t, Omega) of prograde circular orbits for the redshift placeholder,
// on its own finer x grid (EQUATOR_NODES over the same x range); 1/u^t -> 0 continuously at the photon
// orbit (u^t itself diverges there), -1 marks radii without circular orbits.
// Pure math, DOM-free (runs in a Web Worker and in node).
import { EPS_HORIZON, inverseMetric, pointValidity } from '../metrics/common.js';

/** Nodes of the 1D equatorial table. */
export const EQUATOR_NODES = 2048;

/**
 * Closest approach to the axis at which the metric is evaluated (its formulas are 0 * inf on it).
 * The axis nodes take G(AXIS_EPS) for the even G(0): a relative error ~AXIS_EPS^2, below float32;
 * smaller values lose digits in Manko-Novikov's prolate coordinates (1 - cos^2 theta).
 */
const AXIS_EPS = 1e-4;

/**
 * @typedef {Object} GridSpec
 * @property {number} nx           x nodes
 * @property {number} nth          theta nodes per hemisphere, axis to equator inclusive
 * @property {number} [rMax]       outer radius covered (default 1100)
 * @property {number} [rTerm]      inner radius (default: terminationRadius(m))
 * @property {boolean} [float64]   store the tables in double precision (studies only; the GPU needs float32)
 *
 * @typedef {Object} TableGrid
 * @property {number} nx @property {number} nth   theta nodes of the table (2 nth - 1 if full)
 * @property {number} xMin @property {number} dx @property {number} thMax @property {number} dth
 * @property {number} r0           x = log(r - r0)
 * @property {number} rTerm        termination radius (= r at xMin)
 * @property {number} rMax
 * @property {boolean} symmetric   table covers [0, pi/2] (equatorially symmetric metric)
 * @property {number} M            mass of the analytic background (M_ADM)
 * @property {number} nEq @property {number} dxEq   nodes and spacing of the equatorial table
 *
 * @typedef {Object} BakedTables
 * @property {TableGrid} grid
 * @property {Float32Array|Float64Array} data  5 * nth * nx * 4 floats, [layer][j][i][f, f_x, f_theta, f_xtheta]
 * @property {Float32Array} equator   EQUATOR_NODES * 4 floats, [i][1/u^t, Omega, 0, 0] (1/u^t = -1: no circular orbit)
 * @property {{ok:boolean, messages:string[], invalidNodes:number}} validation
 * @property {{evalMs:number, totalMs:number}} timing
 */

/**
 * Analytic background of the tables (functions of r only) and its x-derivatives, x = log(r - r0).
 * @param {number} r @param {number} r0 @param {number} M
 * @returns {{B: number[], dB: number[]}}
 */
export function backgroundG(r, r0, M) {
  const e = r - r0, ir = 1 / r, ir2 = ir * ir;
  const D2 = e * e + M * M, D = (r + 2 * M) * D2;
  const dD = D2 + (r + 2 * M) * 2 * e;
  const B = [-(1 + 2 * M * ir + 4 * M * M * ir2), 0, ir2, r / D, ir2];
  const dBdr = [2 * M * ir2 + 8 * M * M * ir2 * ir, 0, -2 * ir2 * ir, (D - r * dD) / (D * D), -2 * ir2 * ir];
  return { B, dB: dBdr.map((d) => e * d) };
}

/** Termination radius of a metric for horizon-terminated rays. @param {import('../metrics/common.js').StationaryAxisymmetricMetric} m */
export function terminationRadius(m) {
  if (m.horizon.kind !== 'sphere') return 0;
  return m.terminationRadius?.() ?? m.horizon.r * (1 + EPS_HORIZON);
}

/** Table outer radius: the next of 1.1e3, 1.1e4, ... at or beyond `r`, so camera changes rarely force a re-bake. @param {number} r */
export const tableRadiusFor = (r) => 1.1 * 10 ** Math.max(3, Math.ceil(Math.log10(r / 1.1)));

/** 4th-order first derivative along a strided line of n values (one-sided at the ends). */
function derivLine(f, off, stride, n, h, out) {
  const at = (k) => f[off + k * stride];
  for (let k = 0; k < n; k++) {
    let d;
    if (k >= 2 && k <= n - 3) d = at(k - 2) - 8 * at(k - 1) + 8 * at(k + 1) - at(k + 2);
    else if (k === 0) d = -25 * at(0) + 48 * at(1) - 36 * at(2) + 16 * at(3) - 3 * at(4);
    else if (k === 1) d = -3 * at(0) - 10 * at(1) + 18 * at(2) - 6 * at(3) + at(4);
    else if (k === n - 1) d = 25 * at(n - 1) - 48 * at(n - 2) + 36 * at(n - 3) - 16 * at(n - 4) + 3 * at(n - 5);
    else d = 3 * at(n - 1) + 10 * at(n - 2) - 18 * at(n - 3) + 6 * at(n - 4) - at(n - 5);
    out[off + k * stride] = d / (12 * h);
  }
}

/** 4th-order central derivative along theta with mirror (even) ghost nodes at both ends. */
function derivLineEven(f, off, stride, n, h, out) {
  const at = (k) => f[off + (k < 0 ? -k : k > n - 1 ? 2 * (n - 1) - k : k) * stride];
  for (let k = 0; k < n; k++) out[off + k * stride] = (at(k - 2) - 8 * at(k - 1) + 8 * at(k + 1) - at(k + 2)) / (12 * h);
}

/**
 * Prograde circular equatorial orbit at radius r: Omega and u^t from g_dd and its r-derivatives
 * (4th-order finite differences). u^t = 0 where no timelike circular orbit exists.
 * @param {import('../metrics/common.js').StationaryAxisymmetricMetric} m
 */
export function keplerOrbit(m) {
  const th = Math.PI / 2;
  return (/** @type {number} */ r) => {
    const h = 1e-4 * r;
    const g = (/** @type {number} */ rr) => m.g_dd(rr, th);
    const g2 = g(r - 2 * h), g1 = g(r - h), g3 = g(r + h), g4 = g(r + 2 * h);
    const d = (/** @type {'gtt'|'gtphi'|'gphiphi'} */ k) => (g2[k] - 8 * g1[k] + 8 * g3[k] - g4[k]) / (12 * h);
    const tt = d('gtt'), tp = d('gtphi'), pp = d('gphiphi');
    const disc = tp * tp - tt * pp;
    if (!(disc >= 0) || pp === 0) return { ut: 0, Om: 0 };
    const Om = (-tp + Math.sqrt(disc)) / pp;
    const g0 = g(r);
    const n = -(g0.gtt + 2 * Om * g0.gtphi + Om * Om * g0.gphiphi);
    return n > 0 ? { ut: 1 / Math.sqrt(n), Om } : { ut: 0, Om };
  };
}

/** Redshift g = 1 / (u^t (p_t + Omega p_phi)) of the equatorial emitter (FOORT convention, p_t = 1 past-pointing). */
export const emitterRedshift = (/** @type {{ut:number, Om:number}} */ o, /** @type {number} */ pt, /** @type {number} */ pphi) =>
  (o.ut > 0 ? 1 / (o.ut * (pt + o.Om * pphi)) : 0);

/**
 * Bake the tables of a metric.
 * @param {import('../metrics/common.js').StationaryAxisymmetricMetric} m
 * @param {GridSpec} spec
 * @returns {BakedTables}
 */
export function bakeTables(m, spec) {
  const t0 = performance.now();
  const r0 = m.horizon.kind === 'sphere' ? m.horizon.r : 0;
  const rTerm = spec.rTerm ?? terminationRadius(m);
  if (m.horizon.kind !== 'sphere') throw new Error('bakeTables: horizonless metrics arrive in M6');
  if (!(rTerm > r0)) throw new Error(`bakeTables: termination radius ${rTerm} is not outside r0 = ${r0}`);
  const rMax = spec.rMax ?? 1100;
  const symmetric = !!m.equatoriallySymmetric;
  const nx = spec.nx, nth = symmetric ? spec.nth : 2 * spec.nth - 1;
  const xMin = Math.log(rTerm - r0), xMax = Math.log(rMax - r0);
  const dx = (xMax - xMin) / (nx - 1);
  const thMax = symmetric ? Math.PI / 2 : Math.PI;
  const dth = thMax / (nth - 1);
  const guu = inverseMetric(m);
  const M = m.massADM;

  const n = nx * nth;
  const F = Array.from({ length: 5 }, () => new Float64Array(n));
  let invalid = 0, firstBad = '';
  for (let j = 0; j < nth; j++) {
    const th = Math.min(Math.max(j * dth, AXIS_EPS), Math.PI - AXIS_EPS);
    const s2 = Math.sin(th) ** 2;
    for (let i = 0; i < nx; i++) {
      const e = Math.exp(xMin + i * dx), r = r0 + e;
      const v = pointValidity(m.g_dd(r, th));
      if (v) { invalid++; if (!firstBad) firstBad = `${v} at r = ${r.toPrecision(5)}, theta = ${th.toPrecision(4)}`; }
      const u = guu(r, th);
      const k = j * nx + i;
      const { B } = backgroundG(r, r0, M);
      F[0][k] = u.gtt - B[0]; F[1][k] = u.gtphi - B[1]; F[2][k] = s2 * u.gphiphi - B[2]; F[3][k] = u.grr / (e * e) - B[3]; F[4][k] = u.gthth - B[4];
    }
  }
  const t1 = performance.now();

  const data = spec.float64 ? new Float64Array(5 * n * 4) : new Float32Array(5 * n * 4);
  const fx = new Float64Array(n), fth = new Float64Array(n), fxth = new Float64Array(n);
  let nonfinite = 0;
  for (let l = 0; l < 5; l++) {
    const f = F[l];
    for (let j = 0; j < nth; j++) derivLine(f, j * nx, 1, nx, dx, fx);
    for (let i = 0; i < nx; i++) { derivLineEven(f, i, nx, nth, dth, fth); derivLineEven(fx, i, nx, nth, dth, fxth); }
    const base = l * n * 4;
    for (let k = 0; k < n; k++) {
      data[base + 4 * k] = f[k]; data[base + 4 * k + 1] = fx[k]; data[base + 4 * k + 2] = fth[k]; data[base + 4 * k + 3] = fxth[k];
      if (!Number.isFinite(f[k]) || !Number.isFinite(fxth[k]) || Math.abs(f[k]) > 3e38) nonfinite++;
    }
  }

  const equator = new Float32Array(EQUATOR_NODES * 4);
  const orbit = keplerOrbit(m);
  const dxEq = (xMax - xMin) / (EQUATOR_NODES - 1);
  for (let i = 0; i < EQUATOR_NODES; i++) {
    const o = orbit(r0 + Math.exp(xMin + i * dxEq));
    equator[4 * i] = o.ut > 0 ? 1 / o.ut : -1; equator[4 * i + 1] = o.Om;
  }

  const messages = [];
  if (invalid) messages.push(`${invalid} of ${n} table nodes outside the termination radius are not a valid metric (first: ${firstBad})`);
  if (nonfinite) messages.push(`${nonfinite} table entries are not finite in float32`);
  const t2 = performance.now();
  return {
    grid: { nx, nth, xMin, dx, thMax, dth, r0, rTerm, rMax, symmetric, M, nEq: EQUATOR_NODES, dxEq },
    data, equator,
    validation: { ok: !invalid && !nonfinite, messages, invalidNodes: invalid },
    timing: { evalMs: t1 - t0, totalMs: t2 - t0 },
  };
}
