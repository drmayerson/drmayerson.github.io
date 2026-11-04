// M4: effect of the metric tables on rays, isolated from float32 arithmetic. The CPU reference tracer
// (double) runs with its metric functions taken from the baked tables (Hermite lookups of the
// float32-stored tables, js/bake/hermite.js) and is compared with the same tracer on the direct metric.
// Usage (from dev/): node scripts/m4TableRays.mjs [a] [nx] [nth] [inc_deg]
import { createMetric } from '../../js/metrics/registry.js';
import { cpuTraceOptions } from '../../js/gpu/traceConfig.js';
import { prepareImage, traceRay } from '../../js/ref/cpuTracer.js';
import { bakeTables } from '../../js/bake/bake.js';
import { lookupTables } from '../../js/bake/hermite.js';

const [a = 0.94, nx = 512, nth = 256, inc = 17, f64 = 0] = process.argv.slice(2).map(Number);
const DEG = Math.PI / 180;
const angle = (t1, p1, t2, p2) => Math.acos(Math.min(1, Math.max(-1, Math.sin(t1) * Math.sin(t2) * Math.cos(p1 - p2) + Math.cos(t1) * Math.cos(t2))));
const view = { metric: 'kerr', metricParams: { a }, camera: { r: 1000, theta: inc * DEG, screen: 15 }, N: 64, grid: { nx, nth } };
const { metric, options } = cpuTraceOptions(view);
const T = bakeTables(createMetric('kerr', { a }), { nx, nth, rTerm: options.rTerm, rMax: 1100, float64: !!f64 });
/** same signature as cpuTracer.makeFunctions: (x, theta) -> G, dG/dx, dG/dtheta */
const Ftab = (x, th, v, dx, dth) => {
  let t = th;
  if (t < 0) t = -t;
  if (t > Math.PI) t = 2 * Math.PI - t;
  const hemi = t <= Math.PI / 2 ? 1 : -1, d = Math.min(t, Math.PI - t);
  const L = lookupTables(T, x, d, hemi);
  const sgn = th < 0 || th > Math.PI ? -1 : 1;
  for (let k = 0; k < 5; k++) { v[k] = L.v[k]; dx[k] = L.dx[k]; dth[k] = sgn * hemi * L.dd[k]; }
};
const img = prepareImage(metric, options);
const o = { ...img.options, metric };
const errs = [];
let termDiff = 0;
for (let j = 1; j < 64; j += 3) for (let i = 1; i < 64; i += 3) {
  const alpha = 15 * ((i + 0.5) / 64 - 0.5), beta = 15 * ((j + 0.5) / 64 - 0.5);
  const { down } = img.camera.initialMomentum(alpha, beta);
  const r0 = img.r0, rc = 1000, th = inc * DEG;
  const y0 = [Math.log(rc - r0), th, 0, 0, down[1] * (rc - r0), down[2]];
  const A = img.tracePixel(i, j);
  const B = traceRay(Ftab, y0, down[0], down[3], r0, o);
  if (A.term !== B.term) termDiff++;
  else if (A.term === 2) errs.push(angle(A.theta, A.phi, B.theta, B.phi));
}
errs.sort((x, y) => x - y);
const e = (x) => x.toExponential(1);
console.log(`a=${a} ${nx}x${nth} inc=${inc}${f64 ? ' float64 tables' : ''}: tabulated vs direct (double): escape median ${e(errs[errs.length >> 1])}, p90 ${e(errs[Math.floor(0.9 * errs.length)])}, max ${e(errs[errs.length - 1])}, termination differs ${termDiff}`);
