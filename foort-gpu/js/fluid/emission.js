// @ts-check
// Disc emission of a pixel from its record (plan Section 3.8, FOORT EquatorialEmissionDiagnostic):
//   I = sum_k F_k g_k^p J(r_k),  F_1 = 1, F_{k>1} = GeometricFudgeFactor, F_k = 0 beyond EquatPassUpperBound
// (0 = no bound), p = RedshiftPower, J = Johnson-SU in the true r. The same formula is in
// shaders/glsl/display.glsl; this one serves auto exposure and the tests. DOM-free.
import { johnsonSU } from './generalCircularRadial.js';

/**
 * @typedef {Object} EmissionParams
 * @property {number} mu @property {number} gamma @property {number} sigma   Johnson-SU (FOORT GLMJohnsonSUEmission)
 * @property {number} redshiftPower       FOORT RedshiftPower (3)
 * @property {number} fudge               FOORT GeometricFudgeFactor (1)
 * @property {number} maxPasses           FOORT EquatPassUpperBound (0: no bound)
 */

/** FOORT presets (FOORT/cfgs): emission parameters, plus the metric and camera of the example. */
export const EMISSION_PRESETS = {
  KerrExample: { emission: { mu: 2.02, gamma: -2, sigma: 0.5 }, metric: 'kerr', params: { a: 0.94 }, inc: 17.0, r: 1000, screen: 15 },
  JohannsenExample: { emission: { mu: 2.02, gamma: -2, sigma: 0.5 }, metric: 'johannsen', params: { a: 0.94, alpha13: 5.5 }, inc: 17.0, r: 1000, screen: 15 },
  Test_MNrun: { emission: { mu: 0.658826, gamma: -1.5, sigma: 0.5 }, metric: 'mankoNovikov', params: { a: 0.94, alpha3: 1 }, inc: 30.0, r: 1000, screen: 15 },
  // ST3Cr lambda = 0.005: camera r = 250, theta = 1.5 rad, screen 150 x 150 in base-space units, here in units of M_ADM = 24
  Test_FBdetail: { emission: { mu: 0, gamma: -1.5, sigma: 2 }, metric: 'st3cr', params: { lambda: 0.005, bh0: false }, inc: 1.5 * 180 / Math.PI, r: 250 / 24, screen: 150 / 24, maxSteps: 5000 },   // FOORT's config: 10000 (M9: 5000 gives the same disc image)
};

/**
 * Intensity from a list of crossings {r, g} in order along the (backward) ray.
 * @param {{r:number, g:number}[]} crossings @param {EmissionParams} p
 */
export function discIntensity(crossings, p) {
  let I = 0;
  crossings.forEach((c, k) => {
    if (p.maxPasses > 0 && k + 1 > p.maxPasses) return;
    if (!(c.g > 0) || !(c.r > 0)) return;
    I += (k === 0 ? 1 : p.fudge) * c.g ** p.redshiftPower * johnsonSU(c.r, p);
  });
  return I;
}
