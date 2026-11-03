// @ts-check
// Kerr in Boyer-Lindquist coordinates, M = 1. Port of FOORT KerrMetric (m = 1).
import { EPS_HORIZON, sampledValidity } from './common.js';

/**
 * @param {{a:number}} params
 * @returns {import('./common.js').StationaryAxisymmetricMetric}
 */
export function createKerr({ a }) {
  const rh = 1 + Math.sqrt(1 - a * a);
  const a2 = a * a;
  /** @type {import('./common.js').StationaryAxisymmetricMetric} */
  const metric = {
    id: 'kerr',
    params: { a },
    massADM: 1,
    horizon: { kind: 'sphere', r: rh },
    equatoriallySymmetric: true,
    g_dd(r, theta) {
      const sint = Math.sin(theta), cost = Math.cos(theta);
      const sigma = r * r + a2 * cost * cost;
      const delta = r * r + a2 - 2 * r;
      const A_ = (r * r + a2) * (r * r + a2) - delta * a2 * sint * sint;
      return {
        gtt: -(1 - 2 * r / sigma),
        grr: sigma / delta,
        gthth: sigma,
        gphiphi: A_ / sigma * sint * sint,
        gtphi: -2 * r * a * sint * sint / sigma,
      };
    },
    g_uu(r, theta) {
      const sint = Math.sin(theta), cost = Math.cos(theta);
      const sigma = r * r + a2 * cost * cost;
      const delta = r * r + a2 - 2 * r;
      const A_ = (r * r + a2) * (r * r + a2) - delta * a2 * sint * sint;
      return {
        gtt: -A_ / (sigma * delta),
        grr: delta / sigma,
        gthth: 1 / sigma,
        gphiphi: (delta - a2 * sint * sint) / (sigma * delta * sint * sint),
        gtphi: -2 * a * r / (sigma * delta),
      };
    },
    singularities: () => [],
    validate(opts = {}) {
      const messages = [];
      if (!(a * a < 1)) messages.push(`spin a = ${a} must satisfy |a| < 1`);
      if (messages.length) return { ok: false, messages };
      return sampledValidity(metric, { rMin: rh * (1 + EPS_HORIZON), rMax: 1000, ...opts });
    },
  };
  return metric;
}
