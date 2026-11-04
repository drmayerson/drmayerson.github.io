// M4 timings: table bakes (node and the browser's bake worker) and trace times, tabulated vs closed-form Kerr.
// Usage (from dev/): node scripts/m4Perf.mjs  -> dev/reports/m4/perf.json
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openViewer } from './gpuRunner.mjs';
import { createMetric } from '../../js/metrics/registry.js';
import { bakeTables } from '../../js/bake/bake.js';
import { tableSpec } from '../../js/gpu/traceConfig.js';

const here = dirname(fileURLToPath(import.meta.url));
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[(s.length - 1) >> 1]; };
const METRICS = [['kerr', { a: 0.94 }], ['johannsen', { a: 0.94, alpha13: 5.5 }], ['mankoNovikov', { a: 0.94, alpha3: 2 }]];
const GRIDS = [[128, 64], [256, 128], [512, 128], [512, 256], [1024, 256]];
const cam = { r: 1000, theta: 0.2967, screen: 15 };
const out = { node: [], browser: [], trace: [] };

for (const [id, params] of METRICS) for (const [nx, nth] of GRIDS) {
  const ts = tableSpec({ metric: id, metricParams: params, camera: cam, N: 16, grid: { nx, nth } });
  const times = [];
  for (let k = 0; k < 3; k++) times.push(bakeTables(createMetric(id, params), ts.spec).timing.totalMs);   // fresh metric: MN's validity scan included
  out.node.push({ metric: id, nx, nth, ms: median(times) });
  console.log(`node bake ${id} ${nx}x${nth}: ${median(times).toFixed(0)} ms`);
}

const viewer = await openViewer();
out.renderer = viewer.renderer;
try {
  for (const [id, params] of METRICS) for (const [nx, nth] of [[512, 128], [512, 256]]) {
    // a fresh parameter value each time so that the bake cache misses
    const ms = [];
    for (let k = 0; k < 3; k++) {
      const p = { ...params, a: params.a - 0.001 * (k + 1) - (nth === 256 ? 0.01 : 0) };
      const r = await viewer.page.evaluate(async ([v]) => {
        const t0 = performance.now();
        const res = await window.__foort.trace(v, { levels: [8] });
        return { total: performance.now() - t0, bake: res.bake?.timing.totalMs, trace: res.stats.wallMs };
      }, [{ metric: id, metricParams: p, camera: cam, N: 128, grid: { nx, nth } }]);
      ms.push(r);
    }
    const row = { metric: id, nx, nth, bakeInWorkerMs: median(ms.map((x) => x.bake)), bakeAndCoarseTraceMs: median(ms.map((x) => x.total)) };
    out.browser.push(row);
    console.log(`browser worker bake ${id} ${nx}x${nth}: ${row.bakeInWorkerMs.toFixed(0)} ms (with a 16² preview trace and transfer: ${row.bakeAndCoarseTraceMs.toFixed(0)} ms)`);
  }
  for (const N of [512, 1024]) for (const [path, id, params] of [['analytic', 'kerr', { a: 0.94 }], ['tabulated', 'kerr', { a: 0.94 }], ['tabulated', 'johannsen', { a: 0.94, alpha13: 5.5 }], ['tabulated', 'mankoNovikov', { a: 0.94, alpha3: 2 }]]) {
    const runs = [];
    for (let k = 0; k < 4; k++) runs.push((await viewer.trace({ metric: id, metricParams: params, camera: cam, N, path }, { levels: [1] })).stats);
    const s = runs.slice(1);
    const row = { N, path, metric: id, wallMs: median(s.map((x) => x.wallMs)), gpuMs: s[0].gpuMs === null ? null : median(s.map((x) => x.gpuMs)), stepsPerRay: s[0].steps / (N * N) };
    out.trace.push(row);
    console.log(`trace ${N}² ${path} ${id}: ${row.wallMs.toFixed(0)} ms wall, ${row.gpuMs?.toFixed(0)} ms GPU, ${row.stepsPerRay.toFixed(0)} steps/ray`);
  }
} finally { await viewer.close(); }
mkdirSync(resolve(here, '../reports/m4'), { recursive: true });
writeFileSync(resolve(here, '../reports/m4/perf.json'), JSON.stringify(out, null, 1));
