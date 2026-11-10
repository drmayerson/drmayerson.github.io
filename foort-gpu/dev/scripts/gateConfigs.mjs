// Stage 1B quality gate: the scene set (plan Section 1.2) and the tracing configurations it compares.
// Cameras and lengths are given in units of M (M_ADM); they are converted to the registry metric's own units here,
// so the scene set stays the same when the fuzzball is rescaled to unit mass (B1).
import { createMetric } from '../../js/metrics/registry.js';

const DEG = Math.PI / 180;
const kerrEm = { mu: 2.02, gamma: -2, sigma: 0.5, redshiftPower: 3, fudge: 1, maxPasses: 0 };
// Test_FBdetail emission, in units of M (FOORT's mu = 0, sigma = 2 coordinate units; M_ADM = 24)
const fbEm = { mu: 0, gamma: -1.5, sigma: 2 / 24, redshiftPower: 3, fudge: 1, maxPasses: 0 };
const kerrCam = (inc) => ({ r: 1000, theta: inc * DEG, screen: 15 });
const fbCam = { r: 250 / 24, theta: 1.5, screen: 150 / 24 };

/** the scene set: views with camera and emission in units of M */
const SCENES = [
  { name: 'kerr_a0_inc17', metric: 'kerr', metricParams: { a: 0 }, cam: kerrCam(17), em: kerrEm },
  { name: 'kerr_a0_inc80', metric: 'kerr', metricParams: { a: 0 }, cam: kerrCam(80), em: kerrEm },
  { name: 'kerr_a0.94_inc17', metric: 'kerr', metricParams: { a: 0.94 }, cam: kerrCam(17), em: kerrEm },
  { name: 'kerr_a0.94_inc80', metric: 'kerr', metricParams: { a: 0.94 }, cam: kerrCam(80), em: kerrEm },
  { name: 'kerr_a0.998_inc80', metric: 'kerr', metricParams: { a: 0.998 }, cam: kerrCam(80), em: kerrEm },
  { name: 'johannsen_a0.94_a13_5.5', metric: 'johannsen', metricParams: { a: 0.94, alpha13: 5.5 }, cam: kerrCam(17), em: kerrEm },
  { name: 'mankoNovikov_a0.94_a3_2', metric: 'mankoNovikov', metricParams: { a: 0.94, alpha3: 2 }, cam: { r: 1000, theta: 0.523599, screen: 15 }, em: kerrEm },
  { name: 'rn_Q0.8_inc60', metric: 'reissnerNordstrom', metricParams: { Q: 0.8 }, cam: kerrCam(60), em: kerrEm },
  { name: 'st3cr_l0.05', metric: 'st3cr', metricParams: { lambda: 0.05 }, cam: fbCam, em: fbEm, fuzzball: true },
  { name: 'st3cr_l5e-3', metric: 'st3cr', metricParams: { lambda: 5e-3 }, cam: fbCam, em: fbEm, fuzzball: true },
  { name: 'st3cr_l1e-3', metric: 'st3cr', metricParams: { lambda: 1e-3 }, cam: fbCam, em: fbEm, fuzzball: true },
  { name: 'st3cr_l1e-4', metric: 'st3cr', metricParams: { lambda: 1e-4 }, cam: fbCam, em: fbEm, fuzzball: true },
  { name: 'st3cr_l0', metric: 'st3crBH', metricParams: {}, cam: fbCam, em: fbEm, fuzzball: true },
];

/** scenes with views in the registry metric's units (camera and emission scaled by its M_ADM) */
export function sceneSet() {
  return SCENES.map((s) => {
    const M = createMetric(s.metric, s.metricParams).massADM;
    return {
      name: s.name, fuzzball: !!s.fuzzball,
      view: { metric: s.metric, metricParams: s.metricParams, camera: { r: s.cam.r * M, theta: s.cam.theta, screen: s.cam.screen * M }, fluid: { xi: 1, betaR: 1, betaPhi: 1 } },
      em: { ...s.em, mu: s.em.mu * M, sigma: s.em.sigma * M },
    };
  });
}

/** the exact speedups of B5, in every configuration (plan 1.2: allowed in Reference, they change nothing beyond float32 rounding) */
const EXACT = { path: 'auto', texelReuse: true };
const high = (s) => ({ ...s.view, ...EXACT, eps: 0.03, farSteps: { r: 20, max: 4 }, maxSteps: 5000 });

/** configurations: apply(scene) -> the view to trace */
export const GATE_CONFIGS = {
  reference: {
    description: 'Reference: Stage 1 integrator without accuracy trades (eps 0.03, no larger far steps, max steps 5000 BH / 10000 fuzzball), with the exact B5 speedups.',
    apply: (s) => ({ ...s.view, ...EXACT, eps: 0.03, farSteps: null, maxSteps: s.fuzzball ? 10000 : 5000 }),
  },
  high: {
    description: 'High: Reference + the Stage 1 trades (larger steps beyond 20 M up to 4x; fuzzball max steps 5000) = the viewer since M9.',
    apply: high,
  },
  // Stage 1B B9: the Normal tier as confirmed at B6 (black holes: High + BS3 at tol 0.1; the fuzzball: High)
  normal: {
    description: 'Normal (confirmed at B6): black holes High + Bogacki-Shampine 3(2) at tol 0.1; the fuzzball = High.',
    apply: (s) => ({ ...high(s), ...(s.fuzzball ? {} : { bs3: { tol: 0.1, cap: 4 } }) }),
  },
  // Stage 1B B6, plan 4.2-1: an embedded error-controlled integrator (Bogacki-Shampine 3(2), FSAL), tolerance = tol x the
  // pixel's angle at the camera, steps capped at FOORT's rule x 4
  ...Object.fromEntries([0.1, 0.3, 1].map((tol) => [`bs3_tol${tol}`, {
    description: `High with the Bogacki-Shampine 3(2) integrator, tolerance ${tol} pixel angles, steps capped at 4x FOORT's rule.`,
    apply: (s) => ({ ...high(s), bs3: { tol, cap: 4 } }),
  }])),
  // Stage 1B B6, plan 4.2-2: adaptive refinement from the stride-4 level (thresholds on the estimated interpolation error:
  // escape direction in fine pixels, crossing r and g relative, dt in M)
  refine_tight: { description: 'High with adaptive refinement from stride 4: interpolation error sky 0.1 px, r 1e-3, g 1e-3, dt 0.1 M.', apply: (s) => ({ ...high(s), refine: { sky: 0.1, r: 1e-3, g: 1e-3, dt: 0.1 } }) },
  refine_loose: { description: 'High with adaptive refinement from stride 4: interpolation error sky 0.3 px, r 3e-3, g 3e-3, dt 0.3 M.', apply: (s) => ({ ...high(s), refine: { sky: 0.3, r: 3e-3, g: 3e-3, dt: 0.3 } }) },
  // Stage 1B B6, plan 4.2-1: larger near-field step parameter, the far-step rule kept
  ...Object.fromEntries([0.04, 0.05, 0.06, 0.08].map((eps) => [`eps${eps}`, {
    description: `High with the step parameter eps = ${eps} (instead of 0.03); far steps kept.`,
    apply: (s) => ({ ...high(s), eps }),
  }])),
};
