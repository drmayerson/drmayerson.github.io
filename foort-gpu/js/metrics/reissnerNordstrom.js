// @ts-check
// Reissner-Nordström (charged, static, spherical) black hole, M = 1: the plan's M9 "add a metric" demonstration.
// It needs this module and one entry in registry.js, nothing else (the viewer's controls come from the registry,
// the GPU reads the metric through the baked tables).
//   ds^2 = -f dt^2 + dr^2 / f + r^2 dOmega^2,  f = 1 - 2/r + Q^2/r^2,  horizon r_+ = 1 + sqrt(1 - Q^2).
import { EPS_HORIZON, sampledValidity } from './common.js';

/**
 * @param {{Q:number}} params  charge, |Q| < 1
 * @returns {import('./common.js').StationaryAxisymmetricMetric & {criticalImpactParameter:() => {b:number, r:number}}}
 */
export function createReissnerNordstrom({ Q }) {
  const Q2 = Q * Q;
  const rh = 1 + Math.sqrt(1 - Q2);
  const f = (/** @type {number} */ r) => 1 - 2 / r + Q2 / (r * r);
  const metric = {
    id: 'reissnerNordstrom',
    params: { Q },
    massADM: 1,
    horizon: /** @type {{kind:'sphere', r:number}} */ ({ kind: 'sphere', r: rh }),
    equatoriallySymmetric: true,
    /** @param {number} r @param {number} theta */
    g_dd(r, theta) {
      const s = Math.sin(theta);
      return { gtt: -f(r), grr: 1 / f(r), gthth: r * r, gphiphi: r * r * s * s, gtphi: 0 };
    },
    /** @param {number} r @param {number} theta */
    g_uu(r, theta) {
      const s = Math.sin(theta);
      return { gtt: -1 / f(r), grr: f(r), gthth: 1 / (r * r), gphiphi: 1 / (r * r * s * s), gtphi: 0 };
    },
    singularities: () => [],
    /** Photon sphere r = (3 + sqrt(9 - 8 Q^2)) / 2 and critical impact parameter b_c = r / sqrt(f(r)). */
    criticalImpactParameter() {
      const r = (3 + Math.sqrt(9 - 8 * Q2)) / 2;
      return { b: r / Math.sqrt(f(r)), r };
    },
    /** @param {import('./common.js').ValidateOptions} [opts] */
    validate(opts = {}) {
      if (!(Q2 < 1)) return { ok: false, messages: [`charge Q = ${Q} must satisfy |Q| < 1`] };
      return sampledValidity(metric, { rMin: rh * (1 + EPS_HORIZON), rMax: 1000, ...opts });
    },
  };
  return metric;
}
