// @ts-check
// lambda = 0 limit of ST3Cr: static, spherically symmetric supersymmetric black hole with the
// horizon at base-space r = 0 (no FOORT counterpart; FOORT's ST3Cr divides by l = 0).
//   V = L = 0, omega = 0, K = 1 + 2P/r, M = -1/2 + (P^3 - q0)/r, Q = -2 K^3 M,
//   ds^2 = -Q^{-1/2} dt^2 + Q^{1/2} (dr^2 + r^2 dOmega^2).
// Near r = 0, Q^{1/2} -> L^2/r^2 with L^2 = 4 sqrt(P^3 (q0 - P^3)) (AdS2 x S2 throat).
import { sampledValidity } from './common.js';
import { st3crMass } from './st3cr.js';

/**
 * @param {{P:number, q0:number}} params
 * @returns {import('./common.js').StationaryAxisymmetricMetric & {Q:(r:number) => number, criticalImpactParameter:() => {b:number, r:number}}}
 */
export function createST3CrBH({ P, q0 }) {
  /** @param {number} r */
  const Q = (r) => {
    const K = 1 + 2 * P / r;
    const M = -1 / 2 + (P * P * P - q0) / r;
    return -2 * K * K * K * M;
  };
  const massADM = st3crMass(P, q0);
  const metric = {
    id: 'st3crBH',
    params: { P, q0 },
    massADM,
    // horizon at r = 0: no sphere at finite r; rays are terminated at a configurable r_cut instead
    horizon: /** @type {{kind:'none'}} */ ({ kind: 'none' }),
    equatoriallySymmetric: true,
    Q,
    /** @param {number} r @param {number} theta */
    g_dd(r, theta) {
      const sQ = Math.sqrt(Q(r));
      const s = Math.sin(theta);
      return { gtt: -1 / sQ, grr: sQ, gthth: sQ * r * r, gphiphi: sQ * r * r * s * s, gtphi: 0 };
    },
    /** @param {number} r @param {number} theta */
    g_uu(r, theta) {
      const sQ = Math.sqrt(Q(r));
      const s = Math.sin(theta);
      return { gtt: -sQ, grr: 1 / sQ, gthth: 1 / (sQ * r * r), gphiphi: 1 / (sQ * r * r * s * s), gtphi: 0 };
    },
    singularities: () => [],
    /**
     * Critical impact parameter b_c = min_r r sqrt(Q(r)) (from b^2 = g_phiphi / (-g_tt) on the equator),
     * found by golden-section search on log r.
     */
    criticalImpactParameter() {
      const b = (/** @type {number} */ lr) => Math.exp(lr) * Math.sqrt(Q(Math.exp(lr)));
      let lo = Math.log(1e-3 * massADM), hi = Math.log(1e3 * massADM);
      const g = (Math.sqrt(5) - 1) / 2;
      let x1 = hi - g * (hi - lo), x2 = lo + g * (hi - lo);
      for (let i = 0; i < 200; i++) {
        if (b(x1) < b(x2)) { hi = x2; x2 = x1; x1 = hi - g * (hi - lo); } else { lo = x1; x1 = x2; x2 = lo + g * (hi - lo); }
      }
      const lr = 0.5 * (lo + hi);
      return { b: b(lr), r: Math.exp(lr) };
    },
    /** @param {import('./common.js').ValidateOptions} [opts] */
    validate(opts = {}) {
      if (!(P * P * P - q0 < 0)) return { ok: false, messages: [`P^3 - q0 < 0 must hold (P = ${P}, q0 = ${q0})`] };
      return sampledValidity(metric, { rMin: 1e-6 * massADM, rMax: 1000 * massADM, ...opts });
    },
  };
  return metric;
}
