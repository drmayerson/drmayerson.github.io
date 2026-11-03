// @ts-check
// Johannsen (2013) deformed Kerr, M = 1. Port of FOORT JohannsenMetric (implementation by Seppe Staelens).
import { EPS_HORIZON, sampledValidity } from './common.js';

/**
 * @param {{a:number, alpha13?:number, alpha22?:number, alpha52?:number, eps3?:number}} params
 * @returns {import('./common.js').StationaryAxisymmetricMetric}
 */
export function createJohannsen({ a, alpha13 = 0, alpha22 = 0, alpha52 = 0, eps3 = 0 }) {
  const rh = 1 + Math.sqrt(1 - a * a);
  const a2 = a * a;
  /** @param {number} r @param {number} theta */
  const parts = (r, theta) => {
    const sint = Math.sin(theta), cost = Math.cos(theta);
    const A1 = 1 + alpha13 / (r * r * r);
    const A2 = 1 + alpha22 / (r * r);
    const A5 = 1 + alpha52 / (r * r);
    const eps_f = eps3 / r;
    const rho2 = r * r + a2 * cost * cost + eps_f;
    const delta = r * r + a2 - 2 * r;
    return { sint, cost, A1, A2, A5, rho2, delta };
  };
  /** @type {import('./common.js').StationaryAxisymmetricMetric} */
  const metric = {
    id: 'johannsen',
    params: { a, alpha13, alpha22, alpha52, eps3 },
    massADM: 1,
    horizon: { kind: 'sphere', r: rh },
    equatoriallySymmetric: true,
    g_dd(r, theta) {
      const { sint, A1, A2, A5, rho2, delta } = parts(r, theta);
      const den = Math.pow((r * r + a2) * A1 - a2 * A2 * sint * sint, 2);
      return {
        gtt: -rho2 * (delta - a2 * A2 * A2 * sint * sint) / den,
        grr: rho2 / (delta * A5),
        gthth: rho2,
        gphiphi: rho2 * sint * sint * (Math.pow((r * r + a2) * A1, 2) - a2 * delta * sint * sint) / den,
        gtphi: -a * ((r * r + a2) * A1 * A2 - delta) * rho2 * sint * sint / den,
      };
    },
    g_uu(r, theta) {
      const { sint, A1, A2, A5, rho2, delta } = parts(r, theta);
      return {
        gtt: (-1 * Math.pow((r * r + a2) * A1, 2) + a2 * delta * sint * sint) / (delta * rho2),
        grr: delta * A5 / rho2,
        gthth: 1 / rho2,
        gphiphi: (-a2 * A2 * A2 * sint * sint + delta) / (delta * rho2 * sint * sint),
        gtphi: -a * (A2 * A1 * (r * r + a2) - delta) / (delta * rho2),
      };
    },
    singularities: () => [],
    validate(opts = {}) {
      // parameter ranges as checked in FOORT's constructor
      const messages = [];
      const rh3 = rh * rh * rh;
      if (!(a * a < 1)) messages.push(`spin a = ${a} must satisfy |a| < 1`);
      if (!(alpha13 > -rh3)) messages.push(`alpha13 = ${alpha13} must exceed -r_+^3 = ${(-rh3).toFixed(6)}`);
      if (!(alpha52 > -rh * rh)) messages.push(`alpha52 = ${alpha52} must exceed -r_+^2 = ${(-rh * rh).toFixed(6)}`);
      if (!(eps3 > -rh3)) messages.push(`eps3 = ${eps3} must exceed -r_+^3 = ${(-rh3).toFixed(6)}`);
      if (messages.length) return { ok: false, messages };
      return sampledValidity(metric, { rMin: rh * (1 + EPS_HORIZON), rMax: 1000, ...opts });
    },
  };
  return metric;
}
