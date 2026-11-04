// @ts-check
// 1D table of the equatorial fluid four-velocity for the GPU (plan Section 3.9): the redshift of a
// crossing is g = 1 / (u^t p_t + u^r p_r + u^phi p_phi) = (1/u^t) / (p_t + (u^r/u^t) p_r + Omega p_phi),
// so the table holds (1/u^t, u^r/u^t, Omega) at nodes uniform in x = log(r - r0), interpolated linearly.
// All three are finite and smooth from the termination radius out (u^t itself diverges at the horizon);
// the kink of the fluid model at the ISCO lies inside one cell. Pure math, DOM-free.
import { createFluid } from './generalCircularRadial.js';

/** Nodes of the fluid table. */
export const FLUID_NODES = 2048;

/**
 * @typedef {Object} FluidTable
 * @property {Float32Array} data     FLUID_NODES * 4 floats: [1/u^t, u^r/u^t, Omega, 0]
 * @property {{xMin:number, dx:number, n:number, r0:number}} grid
 * @property {number|null} isco
 * @property {{xi:number, betaR:number, betaPhi:number}} params
 * @property {number} ms
 */

/**
 * @param {import('../metrics/common.js').StationaryAxisymmetricMetric} m
 * @param {{xi:number, betaR:number, betaPhi:number}} fluidParams
 * @param {{rTerm:number, rMax:number}} range
 * @returns {FluidTable}
 */
export function bakeFluid(m, fluidParams, range) {
  const t0 = performance.now();
  const r0 = m.horizon.kind === 'sphere' ? m.horizon.r : 0;
  const f = createFluid(m, fluidParams);
  const n = FLUID_NODES;
  const xMin = Math.log(range.rTerm - r0), dx = (Math.log(range.rMax - r0) - xMin) / (n - 1);
  const data = new Float32Array(4 * n);
  for (let i = 0; i < n; i++) {
    const { up } = f.velocity(r0 + Math.exp(xMin + i * dx));
    data[4 * i] = 1 / up[0]; data[4 * i + 1] = up[1] / up[0]; data[4 * i + 2] = up[3] / up[0];
  }
  return { data, grid: { xMin, dx, n, r0 }, isco: f.isco, params: f.params, ms: performance.now() - t0 };
}

/** Linear lookup at radius r and the redshift for photon momenta (p_t, p_r, p_phi), as the shader. @param {FluidTable} T */
export function fluidRedshiftTable(T, /** @type {number} */ r, /** @type {number} */ pt, /** @type {number} */ pr, /** @type {number} */ pphi) {
  const g = T.grid;
  const f = Math.min(Math.max((Math.log(r - g.r0) - g.xMin) / g.dx, 0), g.n - 1);
  const i = Math.min(Math.floor(f), g.n - 2), u = f - i;
  const at = (/** @type {number} */ k) => T.data[4 * i + k] * (1 - u) + T.data[4 * i + 4 + k] * u;
  return at(0) / (pt + at(1) * pr + at(2) * pphi);
}
