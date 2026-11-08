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
 * @property {(r:number) => number} [radius]  the radius the envelope sees (default r; circumferential radius, B3)
 */

/** disc of the comparison presets: Johnson-SU in circumferential radius (M), peaked near 3 M */
const COMPARE_EM = { mu: 3, gamma: -1.5, sigma: 1 };
/** viewer state the comparison presets also set */
const COMPARE_STATE = { envelope: 'circumferential', fluidModel: 'banded' };

/** FOORT presets (FOORT/cfgs): emission parameters, plus the metric and camera of the example. */
export const EMISSION_PRESETS = {
  KerrExample: { emission: { mu: 2.02, gamma: -2, sigma: 0.5 }, metric: 'kerr', params: { a: 0.94 }, inc: 17.0, r: 1000, screen: 15 },
  JohannsenExample: { emission: { mu: 2.02, gamma: -2, sigma: 0.5 }, metric: 'johannsen', params: { a: 0.94, alpha13: 5.5 }, inc: 17.0, r: 1000, screen: 15 },
  Test_MNrun: { emission: { mu: 0.658826, gamma: -1.5, sigma: 0.5 }, metric: 'mankoNovikov', params: { a: 0.94, alpha3: 1 }, inc: 30.0, r: 1000, screen: 15 },
  // ST3Cr lambda = 0.005: camera r = 250, theta = 1.5 rad, screen 150 x 150 in base-space units, here in units of M_ADM = 24
  // FOORT's mu = 0, sigma = 2 are in coordinate units of the raw ST3Cr (M_ADM = 24): sigma = 2/24 in units of M (B1)
  // Stage 1B B3 comparison presets: the same camera and the same disc, defined in circumferential radius (units of M),
  // for a black hole and a fuzzball of equal mass. Switch between A and B (compare mode arrives in B7).
  'Compare 1A: Kerr a = 0': { emission: COMPARE_EM, metric: 'kerr', params: { a: 0 }, inc: 60, r: 1000, screen: 16, state: COMPARE_STATE },
  'Compare 1B: ST3Cr λ = 0.005': { emission: COMPARE_EM, metric: 'st3cr', params: { lambda: 0.005, bh0: false }, inc: 60, r: 1000, screen: 16, state: COMPARE_STATE },
  'Compare 2A: Kerr a = 0': { emission: COMPARE_EM, metric: 'kerr', params: { a: 0 }, inc: 60, r: 1000, screen: 16, state: COMPARE_STATE },
  'Compare 2B: ST3Cr λ = 0 (BH)': { emission: COMPARE_EM, metric: 'st3cr', params: { lambda: 0.005, bh0: true }, inc: 60, r: 1000, screen: 16, state: COMPARE_STATE },
  'Compare 3A: Kerr a = 0.5': { emission: COMPARE_EM, metric: 'kerr', params: { a: 0.5 }, inc: 60, r: 1000, screen: 16, state: COMPARE_STATE },
  'Compare 3B: ST3Cr λ = 0.05': { emission: COMPARE_EM, metric: 'st3cr', params: { lambda: 0.05, bh0: false }, inc: 60, r: 1000, screen: 16, state: COMPARE_STATE },
  Test_FBdetail: { emission: { mu: 0, gamma: -1.5, sigma: 2 / 24 }, metric: 'st3cr', params: { lambda: 0.005, bh0: false }, inc: 1.5 * 180 / Math.PI, r: 250 / 24, screen: 150 / 24, maxSteps: 5000 },   // FOORT's config: 10000 (M9: 5000 gives the same disc image)
};

/**
 * Intensity from a list of crossings {r, g} in order along the (backward) ray, plus the binned tail (Stage 1B B2):
 * tail bins {W, r} with W = sum F g^p already weighted at trace time.
 * @param {{r:number, g:number}[]} crossings @param {EmissionParams} p @param {{W:number, r:number}[]|null} [tail]
 */
export function discIntensity(crossings, p, tail) {
  let I = 0;
  if (tail) for (const t of tail) I += t.W * johnsonSU(p.radius ? p.radius(t.r) : t.r, p);
  crossings.forEach((c, k) => {
    if (p.maxPasses > 0 && k + 1 > p.maxPasses) return;
    if (!(c.g > 0) || !(c.r > 0)) return;
    I += (k === 0 ? 1 : p.fudge) * c.g ** p.redshiftPower * johnsonSU(p.radius ? p.radius(c.r) : c.r, p);
  });
  return I;
}

/**
 * The binned tail of a list of crossings {r, g} along a ray, as shaders/glsl/common.glsl accumulates and packs it
 * (Stage 1B B2): crossings 4, 5, ... (up to maxPasses) into geometry.K log-r bins, W_b = sum F g^p and the centroid of
 * log r. With `quantize`, W keeps 15 mantissa bits and the centroid 8 bits of the bin width, as the record stores them.
 * @param {{r:number, g:number}[]} crossings  all crossings, in order
 * @param {{xLo:number, invWidth:number, K:number}} geometry
 * @param {{redshiftPower:number, fudge:number, maxPasses:number}} em
 * @param {boolean} [quantize]
 * @returns {{W:number, r:number}[]}
 */
export function binTail(crossings, geometry, em, quantize = true) {
  const W = new Float64Array(geometry.K), X = new Float64Array(geometry.K);
  crossings.forEach((c, k) => {
    if (k < 3 || (em.maxPasses > 0 && k + 1 > em.maxPasses) || !(c.r > 0) || !(c.g > 0)) return;
    const w = em.fudge * c.g ** em.redshiftPower, x = Math.log(c.r);
    const b = Math.min(geometry.K - 1, Math.max(0, Math.floor((x - geometry.xLo) * geometry.invWidth)));
    W[b] += w; X[b] += w * x;
  });
  const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
  const out = [];
  for (let b = 0; b < geometry.K; b++) {
    if (!(W[b] > 0)) continue;
    let f = Math.min(1, Math.max(0, (X[b] / W[b] - geometry.xLo) * geometry.invWidth - b)), w = W[b];
    if (quantize) { f32[0] = w; u32[0] = (u32[0] & 0xffffff00) >>> 0; w = f32[0]; f = Math.round(f * 255) / 255; }
    out.push({ W: w, r: Math.exp(geometry.xLo + (b + f) / geometry.invWidth) });
  }
  return out;
}
