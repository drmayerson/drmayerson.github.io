// @ts-check
// Metric tables for the GPU (plan Section 3.4), baked in double precision.
// Functions on an (x, theta) grid, x = log(r - r0) (r0 = r_+ for horizon metrics, 0 for horizonless ones):
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
// The fluid four-velocity for the redshift is a separate 1D table (js/fluid/fluidTable.js).
// Pure math, DOM-free (runs in a Web Worker and in node).
import { EPS_HORIZON, inverseMetric, pointValidityInverse } from '../metrics/common.js';

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
 *
 * @typedef {Object} BakedTables
 * @property {TableGrid} grid
 * @property {Float32Array|Float64Array} data  5 * nth * nx * 4 floats, [layer][j][i][f, f_x, f_theta, f_xtheta]
 * @property {{ok:boolean, messages:string[], invalidNodes:number}} validation
 * @property {{evalMs:number, totalMs:number}} timing
 */

/**
 * Analytic background of the tables (functions of r only) and its x-derivatives, x = log(r - r0).
 * Horizon metrics (r0 > 0):   B0 = -(1 + 2M/r + 4M^2/r^2), B2 = B4 = 1/r^2.
 * Horizonless metrics (r0 = 0, x = log r, rays reach r << M): the same large-r behaviour up to O(1/r^3),
 * but bounded at small r, B0 = -(1 + 2M (r + 2M) / (r^2 + M^2)), B2 = B4 = 1/(r^2 + M^2); with the 1/r^2
 * forms the residual inside a fuzzball (g^tt ~ -L^2/r^2, L^2 << 4M^2) would be ~30x larger than G itself.
 * B1 = 0 and B3 = r / ((r + 2M) ((r - r0)^2 + M^2)) in both cases.
 * @param {number} r @param {number} r0 @param {number} M
 * @returns {{B: number[], dB: number[]}}
 */
export function backgroundG(r, r0, M) {
  const e = r - r0, ir = 1 / r, ir2 = ir * ir;
  const D2 = e * e + M * M, D = (r + 2 * M) * D2;
  const dD = D2 + (r + 2 * M) * 2 * e;
  const B3 = r / D, dB3 = (D - r * dD) / (D * D);
  if (r0 > 0) {
    const B = [-(1 + 2 * M * ir + 4 * M * M * ir2), 0, ir2, B3, ir2];
    const dBdr = [2 * M * ir2 + 8 * M * M * ir2 * ir, 0, -2 * ir2 * ir, dB3, -2 * ir2 * ir];
    return { B, dB: dBdr.map((d) => e * d) };
  }
  const S = r * r + M * M, N = r + 2 * M, iS = 1 / S;
  const B = [-(1 + 2 * M * N * iS), 0, iS, B3, iS];
  const dBdr = [-2 * M * (S - 2 * r * N) * iS * iS, 0, -2 * r * iS * iS, dB3, -2 * r * iS * iS];
  return { B, dB: dBdr.map((d) => e * d) };
}

/**
 * Inner termination radius of a metric: horizon metrics r_+ (1 + eps) or their own; horizonless metrics their
 * inner cut (ST3Cr: a fraction of the size of its centres and ring; the lambda = 0 BH: r_cut).
 * @param {import('../metrics/common.js').StationaryAxisymmetricMetric} m
 */
export function terminationRadius(m) {
  if (m.horizon.kind !== 'sphere') return m.terminationRadius?.() ?? 0;
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
 * Bake the tables of a metric.
 * @param {import('../metrics/common.js').StationaryAxisymmetricMetric} m
 * @param {GridSpec} spec
 * @returns {BakedTables}
 */
export function bakeTables(m, spec) {
  const t0 = performance.now();
  const r0 = m.horizon.kind === 'sphere' ? m.horizon.r : 0;
  const rTerm = spec.rTerm ?? terminationRadius(m);
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
      const u = guu(r, th);
      const v = pointValidityInverse(u);
      if (v) { invalid++; if (!firstBad) firstBad = `${v} at r = ${r.toPrecision(5)}, theta = ${th.toPrecision(4)}`; }
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

  const messages = [];
  if (invalid) messages.push(`${invalid} of ${n} table nodes outside the termination radius are not a valid metric (first: ${firstBad})`);
  if (nonfinite) messages.push(`${nonfinite} table entries are not finite in float32`);
  const t2 = performance.now();
  return {
    grid: { nx, nth, xMin, dx, thMax, dth, r0, rTerm, rMax, symmetric, M },
    data,
    validation: { ok: !invalid && !nonfinite, messages, invalidNodes: invalid },
    timing: { evalMs: t1 - t0, totalMs: t2 - t0 },
  };
}
