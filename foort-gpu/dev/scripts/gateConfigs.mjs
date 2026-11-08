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

/** configurations: apply(scene) -> the view to trace */
export const GATE_CONFIGS = {
  reference: {
    description: 'Reference: Stage 1 integrator without accuracy trades (eps 0.03, no larger far steps, max steps 5000 BH / 10000 fuzzball).',
    apply: (s) => ({ ...s.view, eps: 0.03, farSteps: null, maxSteps: s.fuzzball ? 10000 : 5000 }),
  },
  high: {
    description: 'High: Reference + the Stage 1 trades (larger steps beyond 20 M up to 4x; fuzzball max steps 5000) = the viewer since M9.',
    apply: (s) => ({ ...s.view, eps: 0.03, farSteps: { r: 20, max: 4 }, maxSteps: 5000 }),
  },
};
