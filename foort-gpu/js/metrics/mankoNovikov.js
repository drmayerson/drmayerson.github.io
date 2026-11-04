// @ts-check
// Manko-Novikov with spin a and octopole alpha3, M = 1. Port of FOORT MankoNovikovMetric
// (implementation by Seppe Staelens). Prolate coordinates x = (r - 1)/k, y = cos(theta), k = sqrt(1 - a^2).
// Not equatorially symmetric for alpha3 != 0.
// For alpha3 != 0 there is a band just outside the horizon with CTCs (or overflow at a = 0);
// rays terminate 1% outside its edge (decision at CHECKPOINT M1, see DECISIONS.md).
import { EPS_HORIZON, sampledValidity, validityRadius } from './common.js';

/** Safety factor outside the edge r_valid of the invalid band. */
export const MN_TERMINATION_MARGIN = 0.01;

/**
 * @param {{a:number, alpha3:number}} params
 * @returns {import('./common.js').StationaryAxisymmetricMetric}
 */
export function createMankoNovikov({ a, alpha3 }) {
  const alpha = a === 0 ? 0 : (-1 + Math.sqrt(1 - a * a)) / a;
  const k = Math.sqrt(1 - a * a);
  const rh = 1 + Math.sqrt(1 - a * a);

  /** Metric functions f, exp(2 gamma), omega and the coordinate factors. @param {number} r @param {number} theta */
  const fns = (r, theta) => {
    const sint = Math.sin(theta), cost = Math.cos(theta);
    const xx = (r - 1) / k;
    const yy = cost;
    const R = Math.sqrt(xx * xx + yy * yy - 1);
    const P1 = xx * yy / R;
    const P2 = 0.5 * (3 * xx * xx * yy * yy / (R * R) - 1);
    const P3 = 0.5 * (5 * Math.pow(xx * yy / R, 3) - 3 * xx * yy / R);
    const P4 = 0.125 * (35 * Math.pow(xx * yy / R, 4) - 30 * xx * xx * yy * yy / (R * R) + 3);
    const aa = -alpha * Math.exp(2 * alpha3 * (1 - (xx - yy) * (1 / R + P1 / (R * R) + P2 / (R * R * R) + P3 / (R * R * R * R))));
    const bb = alpha * Math.exp(2 * alpha3 * (-1 + (xx + yy) * (1 / R - P1 / (R * R) + P2 / (R * R * R) - P3 / (R * R * R * R))));
    const AA = (xx * xx - 1) * (1 + aa * bb) * (1 + aa * bb) - (1 - yy * yy) * (bb - aa) * (bb - aa);
    const BB = Math.pow(xx + 1 + (xx - 1) * aa * bb, 2) + Math.pow((1 + yy) * aa + (1 - yy) * bb, 2);
    const CC = (xx * xx - 1) * (1 + aa * bb) * (bb - aa - yy * (aa + bb)) + (1 - yy * yy) * (bb - aa) * (1 + aa * bb + xx * (1 - aa * bb));
    const psi = alpha3 * P3 / (R * R * R * R);
    const gamma_prime = 2 * alpha3 * alpha3 * (P4 * P4 - P3 * P3) / Math.pow(R, 8) + 2 * alpha3 * (-yy + xx * P1 / R - yy * P2 / (R * R) + xx * P3 / (R * R * R)) / R;
    const f = Math.exp(2 * psi) * AA / BB;
    const exp_2gamma = Math.exp(2 * gamma_prime) * AA / ((xx * xx - yy * yy) * (1 - alpha * alpha) * (1 - alpha * alpha));
    const omega = 2 * k * Math.exp(-2 * psi) * CC / AA - 4 * k * alpha / (1 - alpha * alpha);
    const rho_sq = (r - 1) * (r - 1) - k * k * cost * cost;
    const delta = (r - 1) * (r - 1) - k * k;
    return { sint, f, exp_2gamma, omega, rho_sq, delta };
  };

  /** @type {import('./common.js').StationaryAxisymmetricMetric} */
  const metric = {
    id: 'mankoNovikov',
    params: { a, alpha3 },
    massADM: 1,
    horizon: { kind: 'sphere', r: rh },
    equatoriallySymmetric: alpha3 === 0,
    g_dd(r, theta) {
      const { sint, f, exp_2gamma, omega, rho_sq, delta } = fns(r, theta);
      const g22 = exp_2gamma * rho_sq / f;
      return {
        gtt: -f,
        gthth: g22,
        grr: g22 / delta,
        gphiphi: -f * omega * omega + delta * sint * sint / f,
        gtphi: omega * f,
      };
    },
    g_uu(r, theta) {
      const { sint, f, exp_2gamma, omega, rho_sq, delta } = fns(r, theta);
      const beta_d = omega * f;
      const gamma_dd = -f * omega * omega + delta * sint * sint / f;
      const beta_u = beta_d / gamma_dd;
      const alpha_sq = beta_u * beta_d + f;
      const g22 = f / (exp_2gamma * rho_sq);
      return {
        gtt: -1 / alpha_sq,
        gthth: g22,
        grr: delta * g22,
        gphiphi: 1 / gamma_dd - beta_u * beta_u / alpha_sq,
        gtphi: beta_u / alpha_sq,
      };
    },
    singularities: () => [],
    terminationRadius() {
      if (rTerm === undefined) {
        const { rValid } = validityRadius(metric, rh * (1 + 1e-6), 1000, { nr: 600, rRef: rh });
        rTerm = Math.max(rh * (1 + EPS_HORIZON), rValid * (1 + MN_TERMINATION_MARGIN));
      }
      return rTerm;
    },
    validate(opts = {}) {
      if (!(a * a < 1)) return { ok: false, messages: [`spin a = ${a} must satisfy |a| < 1`] };
      return sampledValidity(metric, { rMin: metric.terminationRadius?.() ?? rh * (1 + EPS_HORIZON), rMax: 1000, ...opts });
    },
  };
  /** @type {number|undefined} */
  let rTerm;
  return metric;
}
