// @ts-check
// Stage 1B B8 pixel inspector: the double-precision CPU reference (cpuTracer.js) traces one pixel of a view, with its
// path, in a worker. Message in: {id, view, i, j}; out: {id, result} or {id, error}.
import { cpuTraceOptions } from '../gpu/traceConfig.js';
import { prepareImage } from './cpuTracer.js';
import { createFluid } from '../fluid/generalCircularRadial.js';
import { FLUID_DEFAULTS } from '../gpu/traceConfig.js';

self.onmessage = (e) => {
  const { id, view, i, j } = e.data;
  try {
    const { metric, options } = cpuTraceOptions(view);
    const { tracePixel, r0 } = prepareImage(metric, options);
    const t0 = performance.now();
    const r = /** @type {any} */ (tracePixel(i, j, true));
    const fluid = createFluid(metric, { ...FLUID_DEFAULTS, ...view.fluid });
    const rr0 = options.radial === 'log' || metric.horizon.kind !== 'sphere' ? 0 : r0;
    const crossings = r.crossings.map((/** @type {any} */ c) => ({ r: c.r, phi: ((c.phi % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI), dt: c.t,
      g: fluid.redshift(c.r, r.pt, c.px / (c.r - rr0), r.pphi) }));
    // the path, thinned to at most 4000 points
    const n = r.path.length / 3, stride = Math.max(1, Math.ceil(n / 4000));
    const path = [];
    for (let k = 0; k < n; k += stride) path.push(r.path[3 * k], r.path[3 * k + 1], r.path[3 * k + 2]);
    path.push(r.path[3 * n - 3], r.path[3 * n - 2], r.path[3 * n - 1]);
    self.postMessage({ id, result: { term: r.term, steps: r.steps, passes: r.passes, theta: r.theta, phi: ((r.phi % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI),
      crossings, path, H: r.hamiltonian, ms: performance.now() - t0, horizon: metric.horizon, singularities: metric.singularities(), M: metric.massADM } });
  } catch (err) {
    self.postMessage({ id, error: String(err) });
  }
};
