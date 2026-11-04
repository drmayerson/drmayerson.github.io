// @ts-check
// One description of a traced image ("view") -> GPU uniforms and the equivalent options of the
// double-precision CPU reference (js/ref/cpuTracer.js), so that Level 2 comparisons trace the
// same rays. Pure math, DOM-free (runs in node for the tests).
import { TetradCamera } from '../camera/tetradCamera.js';
import { createMetric } from '../metrics/registry.js';
import { inverseMetric, toMat4 } from '../metrics/common.js';

/**
 * @typedef {Object} ViewParams
 * @property {string} metric                       registry id; M3 supports 'kerr' (analytic shader)
 * @property {Record<string, number>} metricParams
 * @property {{r:number, theta:number, phi?:number, screen:number, cx?:number, cy?:number}} camera  theta in rad
 * @property {number} N                            pixels per side
 * @property {number} [eps]                        FOORT step parameter (0.03)
 * @property {number} [hmin]                       SmallestPossibleStepsize (1e-12)
 * @property {number} [maxSteps]                   (5000)
 * @property {number} [epsHorizon]                 terminate at r < r_+ (1 + epsHorizon) (0.01)
 * @property {number} [rBoundary]                  escape radius (default 1.01 r_cam)
 * @property {'logShifted'|'log'} [radial]         x = log(r - r_+) (app) or log r (FOORT parity)
 * @property {'interpolate'|'foort'} [crossing]
 * @property {'centers'|'foort'} [mesh]            pixel centres (i + 0.5)/N, or FOORT SimpleSquareMesh i/(N - 1)
 * @property {number} [threshold]                  FOORT crossing threshold (0.001)
 * @property {boolean} [storeH]                    record |H| instead of the third crossing
 * @property {number} [axisStepFloor]              floor of the axis distance in FOORT's step rule (1e-3)
 */

export const VIEW_DEFAULTS = {
  eps: 0.03, hmin: 1e-12, maxSteps: 5000, epsHorizon: 0.01, radial: 'logShifted', crossing: 'interpolate',
  mesh: 'centers', threshold: 0.001, storeH: false, axisStepFloor: 1e-3,
};

/** @param {ViewParams} view */
export function normalizeView(view) {
  return /** @type {Required<ViewParams>} */ ({ ...VIEW_DEFAULTS, rBoundary: 1.01 * view.camera.r, ...view });
}

/** Shader program per metric (M4 adds the tabulated 'trace'). @param {string} id */
export function tracerFor(id) {
  if (id === 'kerr') return 'trace_kerr_analytic';
  throw new Error(`metric ${id}: no GPU tracer before M4 (only analytic Kerr in M3)`);
}

/**
 * GPU uniforms for a view. Values are [type, data] with type '4f' | '4i' | 'm4'.
 * @param {ViewParams} viewIn
 */
export function gpuTraceSetup(viewIn) {
  const v = normalizeView(viewIn);
  const metric = createMetric(v.metric, v.metricParams);
  const rh = metric.horizon.kind === 'sphere' ? metric.horizon.r : 0;
  const r0 = v.radial === 'log' ? 0 : rh;
  const { r, theta } = v.camera;
  const phi = v.camera.phi ?? 0;
  if (!(r > rh * (1 + v.epsHorizon))) throw new Error(`camera radius ${r} is inside the termination radius`);
  const gdd = toMat4(metric.g_dd(r, theta));
  const cam = TetradCamera.fromStaticObserver(gdd, toMat4(inverseMetric(metric)(r, theta)), [0, r, theta, phi]);
  const G = new Float32Array(16);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) G[4 * j + i] = gdd[i][j];
  const sx = v.camera.screen;
  /** @type {Record<string, ['4f'|'4i'|'m4', number[]|Float32Array]>} */
  const uniforms = {
    uE: ['m4', cam.vielbeinColumnMajor()],
    uG: ['m4', G],
    uCam: ['4f', [r, Math.min(theta, Math.PI - theta), phi, Math.log(r - r0)]],
    uScreen: ['4f', [v.camera.cx ?? 0, v.camera.cy ?? 0, sx, sx]],
    uStep: ['4f', [v.eps, v.hmin, rh * (1 + v.epsHorizon), v.rBoundary]],
    uAux: ['4f', [v.threshold, v.axisStepFloor, theta <= Math.PI / 2 ? 1 : -1, 0]],
    uOpt: ['4i', [v.maxSteps, v.crossing === 'foort' ? 1 : 0, v.mesh === 'foort' ? 1 : 0, v.storeH ? 1 : 0]],
  };
  if (v.metric === 'kerr') uniforms.uMetric = ['4f', [metric.params.a, r0, 0, 0]];
  return { program: tracerFor(v.metric), uniforms, N: v.N, warnings: cam.warnings, metric, view: v };
}

/**
 * Options of the CPU reference tracer for the same view (prepareImage(metric, options)).
 * @param {ViewParams} viewIn
 */
export function cpuTraceOptions(viewIn) {
  const v = normalizeView(viewIn);
  const metric = createMetric(v.metric, v.metricParams);
  const rh = metric.horizon.kind === 'sphere' ? metric.horizon.r : 0;
  return {
    metric,
    options: {
      N: v.N, mesh: v.mesh, camera: v.camera, radial: v.radial, eps: v.eps, hmin: v.hmin, maxSteps: v.maxSteps,
      rTerm: rh * (1 + v.epsHorizon), rBoundary: v.rBoundary, axis: /** @type {'reflect'} */ ('reflect'),
      thetaSingEps: null, singularity: null, crossing: v.crossing, threshold: v.threshold, ncross: 3,
      axisStepFloor: v.axisStepFloor,
    },
  };
}

/** Record layout (16 floats per pixel, 4 RGBA32F targets) -> plain object. @param {Float32Array} rec @param {number} k pixel index */
export function decodeRecord(rec, k) {
  const o = 16 * k;
  const packed = Math.round(rec[o]);
  const crossings = [];
  for (let c = 0; c < 3; c++) {
    const b = o + 4 + 4 * c;
    if (rec[b] > 0) crossings.push({ r: rec[b], phi: rec[b + 1], dt: rec[b + 2], g: rec[b + 3] });
  }
  return { term: packed % 16, passes: Math.floor(packed / 16), steps: rec[o + 1], theta: rec[o + 2], phi: rec[o + 3], crossings };
}
