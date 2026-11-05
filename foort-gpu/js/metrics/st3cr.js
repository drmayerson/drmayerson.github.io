// @ts-check
// ST3Cr ring fuzzball (Bacchini et al., "Fuzzball Shadows", arXiv:2103.12075), lambda > 0.
// Port of FOORT ST3CrMetric (implementation by Lies Van Dael), including its 17-point Simpson
// integral for omega_phi and the complete elliptic integral in M_D0.
//   ds^2 = -Q^{-1/2} (dt + omega dphi)^2 + Q^{1/2} (dr^2 + r^2 dtheta^2 + r^2 sin^2 theta dphi^2)
// with base-space spherical coordinates (r, theta). D6 centres on the axis at r = l/2, the D0
// ring in the equatorial plane at r = R.
import { compEllint1, sampledValidity } from './common.js';

/** ADM mass for charges P, q0: 2 M = 3P + q0 - P^3 (lambda-independent). @param {number} P @param {number} q0 */
export const st3crMass = (P, q0) => (3 * P + q0 - P * P * P) / 2;

/** Upper end of the allowed lambda range. @param {number} P @param {number} q0 */
export const st3crLambdaMax = (P, q0) => (q0 / (2 * P * P * P) - 1) / (3 * P * P - 1);

const pi = Math.PI;

/** Terminations relative to the structure size min(l/2, R): 0.005 gives 8e-4 at lambda = 0.005 (FOORT: 1e-3). */
export const ST3CR_EPS_REL = 0.005;

/** @param {number} r @param {number} theta @param {number} l */
function get_omega(r, theta, l) {
  const cost = Math.cos(theta);
  return (r * r - l * l) / Math.sqrt(r * r * r * r + l * l * l * l - 2 * r * r * l * l * Math.cos(2 * theta)) - 1
    - (r * cost - l) / Math.sqrt(r * r + l * l - 2 * r * l * cost) + (r * cost + l) / Math.sqrt(r * r + l * l + 2 * r * l * cost);
}

/**
 * @param {{P:number, q0:number, lambda:number}} params
 * @returns {import('./common.js').StationaryAxisymmetricMetric & {functions:(r:number, th:number) => {Q:number, omega:number}}}
 */
export function createST3Cr({ P, q0, lambda }) {
  const l = 8 * P * P * P * lambda;
  const R = 2 * lambda * Math.sqrt(q0 * q0 / Math.pow(1 - (1 - 3 * P * P) * lambda, 2) - 4 * Math.pow(P, 6));

  /** @param {number} phi @param {number} r @param {number} theta @param {number} l @param {number} R */
  const f_phi = (phi, r, theta, l, R) =>
    q0 / (2 * pi * Math.sqrt(R * R + l * l)) * (-(r * Math.sqrt(l * l + R * R) * Math.sin(theta) * (R * Math.cos(phi) * (l - r * Math.cos(theta)) - l * r * Math.sin(theta)))
      / (l * l * R * R - 2 * l * r * R * R * Math.cos(theta) + r * r * R * R * Math.cos(theta) * Math.cos(theta) - 2 * l * r * R * Math.cos(phi) * (l - r * Math.cos(theta)) * Math.sin(theta)
        + l * l * r * r * Math.cos(phi) * Math.cos(phi) * Math.sin(theta) * Math.sin(theta) + l * l * r * r * Math.sin(phi) * Math.sin(phi) * Math.sin(theta) * Math.sin(theta)
        + r * r * R * R * Math.sin(phi) * Math.sin(phi) * Math.sin(theta) * Math.sin(theta)));

  /** @param {number} phi @param {number} r @param {number} theta @param {number} l @param {number} R */
  const f_om_phi = (phi, r, theta, l, R) => {
    const r_ac = 1 / 4 * Math.sqrt(l * l + 16 * r * r + 4 * R * R - 8 * l * r * Math.cos(theta) + 8 * r * R * Math.sin(phi - theta) - 8 * r * R * Math.sin(phi + theta));
    const theta_ac = Math.acos((-l * l + 4 * R * R + 4 * l * r * Math.cos(theta) - 8 * r * R * Math.cos(phi) * Math.sin(theta))
      / (Math.sqrt(l * l + 4 * R * R) * Math.sqrt(l * l + 16 * r * r + 4 * R * R - 8 * l * r * Math.cos(theta) - 16 * r * R * Math.cos(phi) * Math.sin(theta))));
    const theta_bc = Math.acos((-l * l + 4 * R * R - 4 * l * r * Math.cos(theta) - 8 * r * R * Math.cos(phi) * Math.sin(theta))
      / (Math.sqrt(l * l + 4 * R * R) * Math.sqrt(l * l + 16 * r * r + 4 * R * R + 8 * l * r * Math.cos(theta) - 16 * r * R * Math.cos(phi) * Math.sin(theta))));
    const r_bc = 1 / 4 * Math.sqrt(l * l + 16 * r * r + 4 * R * R + 8 * l * r * Math.cos(theta) + 8 * r * R * Math.sin(phi - theta) - 8 * r * R * Math.sin(phi + theta));
    const omega_phi_ac = get_omega(r_ac, theta_ac, Math.sqrt(R * R + l * l / 4) / 2) * f_phi(phi, r, theta, l / 2, R);
    const omega_phi_bc = get_omega(r_bc, theta_bc, Math.sqrt(R * R + l * l / 4) / 2) * -f_phi(phi, r, theta, -l / 2, R);
    return omega_phi_ac + omega_phi_bc;
  };

  /** Q and omega_phi. @param {number} r @param {number} theta */
  const functions = (r, theta) => {
    const sint = Math.sin(theta), cost = Math.cos(theta);
    const r1 = Math.sqrt(r * r + l * l / 4 - r * l * cost);
    const r2 = Math.sqrt(r * r + l * l / 4 + r * l * cost);
    const r3 = Math.sqrt(r * r + R * R + 2 * r * R * sint);
    const cei = compEllint1(Math.sqrt(4 * r * R * sint / (r3 * r3)));
    const MD0 = -2 * q0 / (pi * r3) * cei;
    const omega_phi_ab = -4 * P * P * P / l * get_omega(r, theta, l / 2);
    // Simpson's rule on [0, pi] with 16 intervals, doubled (FOORT)
    const ni = 16;
    const h = pi / ni;
    let sum_odds = 0;
    for (let i = 1; i < ni; i += 2) sum_odds += f_om_phi(i * h, r, theta, l, R);
    let sum_evens = 0;
    for (let i = 2; i < ni; i += 2) sum_evens += f_om_phi(i * h, r, theta, l, R);
    const omega = omega_phi_ab + 2 * (f_om_phi(0, r, theta, l, R) + f_om_phi(pi, r, theta, l, R) + 2 * sum_evens + 4 * sum_odds) * h / 3;
    const K = 1 + P * (1 / r1 + 1 / r2);
    const M = -1 / 2 + (P * P * P) / 2 * (1 / r1 + 1 / r2) + MD0;
    const V = 1 / r1 - 1 / r2;
    const L = -P * P * (1 / r1 - 1 / r2);
    const Q = -2 * Math.pow(K, 3) * M + Math.pow(L, 3) * V + 3 / 4 * L * L * K * K - M * M * V * V - 3 * M * V * K * L;
    return { Q, omega, sint };
  };

  const sings = /** @type {import('./common.js').Singularity[]} */ ([
    { kind: 'point', r: l / 2, theta: 0 },
    { kind: 'point', r: l / 2, theta: pi },
    { kind: 'ring', r: R, theta: pi / 2 },
  ]);
  const massADM = st3crMass(P, q0);
  // size of the structure: rays stop at a fixed fraction of it (inner cut and singularity distance), so the
  // terminations scale with lambda (FOORT's absolute 0.001 and 0.01 would swallow the structure for lambda < ~1e-3)
  const size = Math.min(l / 2, R);

  const metric = {
    id: 'st3cr',
    params: { P, q0, lambda },
    massADM,
    horizon: /** @type {{kind:'none'}} */ ({ kind: 'none' }),
    equatoriallySymmetric: true,
    functions,
    /** @param {number} r @param {number} theta */
    g_dd(r, theta) {
      const { Q, omega, sint } = functions(r, theta);
      const sQ = Math.sqrt(Q);
      return { gtt: -1 / sQ, grr: sQ, gthth: sQ * r * r, gphiphi: sQ * r * r * sint * sint - 1 / sQ * omega * omega, gtphi: -omega / sQ };
    },
    /** @param {number} r @param {number} theta */
    g_uu(r, theta) {
      const { Q, omega, sint } = functions(r, theta);
      const sQ = Math.sqrt(Q);
      return {
        gtt: (omega * omega - Q * r * r * sint * sint) / (sQ * r * r * sint * sint),
        grr: 1 / sQ,
        gthth: 1 / (sQ * r * r),
        gphiphi: 1 / (sQ * r * r * sint * sint),
        gtphi: -omega / (sQ * r * r * sint * sint),
      };
    },
    singularities: () => sings,
    /** Inner cut: rays stop at r < ST3CR_EPS_REL min(l/2, R) (near the origin of the base space). */
    terminationRadius: () => ST3CR_EPS_REL * size,
    /** Euclidean base-space distance at which rays stop near a D6 centre or the D0 ring. */
    singularityEpsilon: () => ST3CR_EPS_REL * size,
    /** @param {import('./common.js').ValidateOptions} [opts] */
    validate(opts = {}) {
      const messages = [];
      if (!(P * P * P - q0 < 0)) messages.push(`P^3 - q0 < 0 must hold (P = ${P}, q0 = ${q0})`);
      if (!(lambda > 0)) messages.push(`lambda = ${lambda} must be > 0 (use the ST3Cr BH metric for lambda = 0)`);
      if (!(q0 * q0 / Math.pow(1 - (1 - 3 * P * P) * lambda, 2) - 4 * Math.pow(P, 6) > 0))
        messages.push(`lambda = ${lambda} is outside the allowed range (lambda_max = ${st3crLambdaMax(P, q0).toPrecision(6)})`);
      if (messages.length) return { ok: false, messages };
      // Q <= 0 shows up as non-finite sqrt(Q) components
      return sampledValidity(metric, { rMin: 1e-3 * Math.min(l / 2, R), rMax: 1000 * massADM, ...opts });
    },
  };
  return metric;
}
