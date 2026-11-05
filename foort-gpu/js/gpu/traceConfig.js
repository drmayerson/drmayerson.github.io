// @ts-check
// One description of a traced image ("view") -> GPU uniforms and the equivalent options of the
// double-precision CPU reference (js/ref/cpuTracer.js), so that Level 2 comparisons trace the
// same rays. Pure math, DOM-free (runs in node for the tests).
import { TetradCamera } from '../camera/tetradCamera.js';
import { createMetric } from '../metrics/registry.js';
import { inverseMetric, toMat4 } from '../metrics/common.js';
import { tableRadiusFor } from '../bake/bake.js';

/** FOORT defaults of GeneralCircularRadialFluid (KerrExample.cfg). */
export const FLUID_DEFAULTS = { xi: 1, betaR: 1, betaPhi: 1 };

/**
 * @typedef {Object} ViewParams
 * @property {string} metric                       registry id (BH mode in M4: kerr, johannsen, mankoNovikov)
 * @property {Record<string, number>} metricParams
 * @property {{r:number, theta:number, phi?:number, screen:number, cx?:number, cy?:number}} camera  theta in rad
 * @property {number} N                            pixels per side
 * @property {number} [eps]                        FOORT step parameter (0.03)
 * @property {number} [hmin]                       SmallestPossibleStepsize (1e-12)
 * @property {number} [maxSteps]                   (5000)
 * @property {number} [epsHorizon]                 terminate at r < r_+ (1 + epsHorizon) (0.01)
 * @property {number} [rInner]                     horizonless metrics: inner cut (default: the metric's terminationRadius())
 * @property {number} [singEps]                    Euclidean distance to the metric's singularities at which rays stop
 *                                                 (default: the metric's singularityEpsilon(); 0 = off)
 * @property {number} [rBoundary]                  escape radius (default 1.01 r_cam)
 * @property {'logShifted'|'log'} [radial]         x = log(r - r_+) (app) or log r (FOORT parity)
 * @property {'interpolate'|'foort'} [crossing]
 * @property {'centers'|'foort'} [mesh]            pixel centres (i + 0.5)/N, or FOORT SimpleSquareMesh i/(N - 1)
 * @property {number} [threshold]                  FOORT crossing threshold (0.001)
 * @property {boolean} [storeH]                    record |H| instead of the third crossing
 * @property {boolean} [tableHalf]                 M9 accuracy trade: half-float derivative channels in the tables
 * @property {{r:number, max:number}|null} [farSteps]  M9 accuracy trade: step parameter eps * clamp(r / farSteps.r, 1, farSteps.max),
 *                                                 farSteps.r in units of M_ADM
 * @property {boolean} [project]                   constraint projection onto H = 0 before every step
 *                                                 (default: on for horizonless metrics, whose throat rays lose the constraint)
 * @property {number} [axisStepFloor]              floor of the axis distance in FOORT's step rule (1e-3)
 * @property {'tabulated'|'analytic'} [path]       tabulated metric (all metrics) or closed-form Kerr shader (validation)
 * @property {{nx:number, nth:number}} [grid]       table nodes in x and per hemisphere in theta
 * @property {{xi:number, betaR:number, betaPhi:number}} [fluid]   GeneralCircularRadialFluid parameters
 */

export const VIEW_DEFAULTS = {
  tableHalf: false, farSteps: /** @type {{r:number, max:number}|null} */ (null),
  eps: 0.03, hmin: 1e-12, maxSteps: 5000, epsHorizon: 0.01, radial: 'logShifted', crossing: 'interpolate',
  mesh: 'centers', threshold: 0.001, storeH: false, axisStepFloor: 1e-3, path: 'tabulated', grid: { nx: 512, nth: 128 }, fluid: FLUID_DEFAULTS,
};

/** @param {ViewParams} view */
export function normalizeView(view) {
  return /** @type {Required<ViewParams>} */ ({ ...VIEW_DEFAULTS, rBoundary: 1.01 * view.camera.r, ...view });
}

/** Shader program for a view. @param {Required<ViewParams>} v */
export function tracerFor(v) {
  if (v.path === 'analytic') {
    if (v.metric !== 'kerr') throw new Error(`metric ${v.metric}: the analytic shader exists for Kerr only`);
    return 'trace_kerr_analytic';
  }
  if (v.radial === 'log') throw new Error('the tabulated tracer uses x = log(r - r_+) only');
  return v.tableHalf ? 'trace_half' : 'trace';
}

/**
 * Termination radius of a view: the metric's own (Manko-Novikov: outside its invalid band) or
 * r_+ (1 + epsHorizon), whichever is larger.
 * @param {import('../metrics/common.js').StationaryAxisymmetricMetric} m @param {Required<ViewParams>} v
 */
export function viewTerminationRadius(m, v) {
  if (m.horizon.kind !== 'sphere') return v.rInner ?? m.terminationRadius?.() ?? 0;
  const r = m.horizon.r * (1 + v.epsHorizon);
  return m.terminationRadius ? Math.max(m.terminationRadius(), r) : r;
}

/** Constraint projection of a view. @param {import('../metrics/common.js').StationaryAxisymmetricMetric} m @param {Required<ViewParams>} v */
export const viewProjects = (m, v) => v.project ?? m.horizon.kind !== 'sphere';

/**
 * Singularity termination of a view: Euclidean distance in the base R^3 to point singularities on the axis
 * (at z = +-zc) and to a ring in the equatorial plane (radius R); eps = 0 switches it off.
 * @param {import('../metrics/common.js').StationaryAxisymmetricMetric} m @param {Required<ViewParams>} v
 */
export function viewSingularities(m, v) {
  const sings = m.singularities();
  const eps = v.singEps ?? m.singularityEpsilon?.() ?? 0;
  const pt = sings.find((x) => x.kind === 'point'), ring = sings.find((x) => x.kind === 'ring');
  for (const x of sings) {
    if (x.kind === 'point' && !(Math.abs(Math.sin(x.theta)) < 1e-12 && Math.abs(x.r - (pt?.r ?? 0)) < 1e-12)) throw new Error('singularities: point singularities must sit on the axis at z = +-zc');
    if (x.kind === 'ring' && !(Math.abs(x.theta - Math.PI / 2) < 1e-12 && x.r === ring?.r)) throw new Error('singularities: one equatorial ring only');
  }
  return { eps: sings.length ? eps : 0, zc: pt?.r ?? -1, R: ring?.r ?? -1, list: sings };
}

/**
 * Fluid-table specification of a view (both tracers), with a cache key.
 * @param {ViewParams} viewIn
 */
export function fluidSpec(viewIn) {
  const v = normalizeView(viewIn);
  const m = createMetric(v.metric, v.metricParams);
  const fluid = { ...FLUID_DEFAULTS, ...v.fluid };
  const spec = { fluid, range: { rTerm: viewTerminationRadius(m, v), rMax: tableRadiusFor(v.rBoundary) } };
  return { kind: /** @type {'fluid'} */ ('fluid'), metric: v.metric, params: m.params, spec, key: JSON.stringify(['fluid', v.metric, m.params, spec]) };
}

/**
 * Table specification of a view (null for the analytic path): what the bake worker needs, and a cache key.
 * @param {ViewParams} viewIn
 */
export function tableSpec(viewIn) {
  const v = normalizeView(viewIn);
  if (tracerFor(v) === 'trace_kerr_analytic') return null;
  const m = createMetric(v.metric, v.metricParams);
  const spec = { nx: v.grid.nx, nth: v.grid.nth, rTerm: viewTerminationRadius(m, v), rMax: tableRadiusFor(v.rBoundary) };
  return { metric: v.metric, params: m.params, spec, key: JSON.stringify([v.metric, m.params, spec]) };
}

/**
 * GPU uniforms for a view. Values are [type, data] with type '4f' | '4i' | 'm4'.
 * @param {ViewParams} viewIn
 * @param {import('../bake/bake.js').BakedTables|undefined} tables  required for the tabulated path (from tableSpec(view))
 * @param {import('../fluid/fluidTable.js').FluidTable} fluid  from fluidSpec(view)
 */
export function gpuTraceSetup(viewIn, tables, fluid) {
  const v = normalizeView(viewIn);
  const program = tracerFor(v);
  const metric = createMetric(v.metric, v.metricParams);
  const rh = metric.horizon.kind === 'sphere' ? metric.horizon.r : 0;
  const r0 = v.radial === 'log' ? 0 : rh;
  const rTerm = viewTerminationRadius(metric, v);
  const { r, theta } = v.camera;
  const phi = v.camera.phi ?? 0;
  if (!(r > rTerm)) throw new Error(`camera radius ${r} is inside the termination radius ${rTerm.toPrecision(4)}`);
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
    uStep: ['4f', [v.eps, v.hmin, rTerm, v.rBoundary]],
    uAux: ['4f', [v.threshold, v.axisStepFloor, theta <= Math.PI / 2 ? 1 : -1, viewProjects(metric, v) ? 1 : 0]],
    uFar: ['4f', v.farSteps ? [v.farSteps.r * metric.massADM, v.farSteps.max, 0, 0] : [0, 1, 0, 0]],
    uOpt: ['4i', [v.maxSteps, v.crossing === 'foort' ? 1 : 0, v.mesh === 'foort' ? 1 : 0, v.storeH ? 1 : 0]],
  };
  /** @type {string|null} */
  let tableKey = null;
  if (program === 'trace_kerr_analytic') {
    if (viewProjects(metric, v)) throw new Error('constraint projection needs the tabulated tracer (the closed-form Kerr shader does not split its force)');
    uniforms.uMetric = ['4f', [metric.params.a, r0, 0, 0]];
  }
  else {
    const ts = /** @type {NonNullable<ReturnType<typeof tableSpec>>} */ (tableSpec(v));
    if (!tables) throw new Error('gpuTraceSetup: the tabulated path needs the baked tables');
    const g = tables.grid;
    if (Math.abs(g.r0 - r0) > 1e-12 * r0 || g.rTerm > rTerm * (1 + 1e-12) || g.rMax < v.rBoundary) throw new Error('gpuTraceSetup: tables do not cover this view');
    uniforms.uTab = ['4f', [g.xMin, g.dx, g.thMax, g.dth]];
    uniforms.uTabN = ['4i', [g.nx, g.nth, g.symmetric ? 1 : 0, 0]];
    uniforms.uMetric = ['4f', [r0, g.M, 0, 0]];
    const sg = viewSingularities(metric, v);
    // a negative zc / R disables that test in the shader (no such singularity)
    uniforms.uSing = ['4f', [sg.zc, sg.R, sg.eps, sg.eps > 0 ? 1 : 0]];
    tableKey = ts.key;
  }
  if (!fluid) throw new Error('gpuTraceSetup: the fluid table is required');
  const fs = fluidSpec(v);
  if (Math.abs(fluid.grid.r0 - rh) > 1e-12 * Math.max(rh, 1) || Math.exp(fluid.grid.xMin) + fluid.grid.r0 > rTerm * (1 + 1e-9)) throw new Error('gpuTraceSetup: fluid table does not cover this view');
  uniforms.uFluidX = ['4f', [fluid.grid.xMin, fluid.grid.dx, fluid.grid.n, fluid.grid.r0]];
  return { program, uniforms, N: v.N, warnings: cam.warnings, metric, view: v, tables: tables ?? null, tableKey, fluid, fluidKey: fs.key };
}

/**
 * Options of the CPU reference tracer for the same view (prepareImage(metric, options)).
 * @param {ViewParams} viewIn
 */
export function cpuTraceOptions(viewIn) {
  const v = normalizeView(viewIn);
  const metric = createMetric(v.metric, v.metricParams);
  return {
    metric,
    options: {
      N: v.N, mesh: v.mesh, camera: v.camera, radial: v.radial, eps: v.eps, hmin: v.hmin, maxSteps: v.maxSteps,
      rTerm: viewTerminationRadius(metric, v), rBoundary: v.rBoundary, axis: /** @type {'reflect'} */ ('reflect'),
      thetaSingEps: null, singularity: viewSingularities(metric, v).eps > 0 ? { mode: /** @type {'euclid'} */ ('euclid'), eps: viewSingularities(metric, v).eps } : null, crossing: v.crossing, threshold: v.threshold, ncross: 3,
      axisStepFloor: v.axisStepFloor, project: viewProjects(metric, v),
      farSteps: v.farSteps ? { r: v.farSteps.r * metric.massADM, max: v.farSteps.max } : null,
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
