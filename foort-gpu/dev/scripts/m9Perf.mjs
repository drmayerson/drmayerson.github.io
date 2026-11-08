// M9 acceptance timings (plan M9) in the viewer's own trace path (progressive levels, adaptive tiles):
//  - Kerr re-trace at 1024^2 (the viewer's levels, finalLevels: 4 -> 1), tabulated (the app) and closed-form (validation shader)
//  - drag preview: one 256^2 level
//  - fuzzball lambda = 1e-3 at 1024^2 (Test_FBdetail camera, 10000 max steps) vs the Kerr re-trace
// Each timing is the median of 3 traces after a warm-up (tables cached, shader compiled); 1 trace if the warm-up took > 20 s.
// Usage (from dev/): node scripts/m9Perf.mjs [--tag name]  -> dev/reports/m9/perf_<tag>.json
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openViewer } from './gpuRunner.mjs';
import { finalLevels } from '../../js/gpu/pipeline.js';

const args = process.argv.slice(2);
const tag = args.includes('--tag') ? args[args.indexOf('--tag') + 1] : 'baseline';
const outDir = resolve(dirname(fileURLToPath(import.meta.url)), '../reports/m9');
mkdirSync(outDir, { recursive: true });
// --app: the viewer's defaults since the M9 trades (larger steps beyond 20 M up to 4x; fuzzball 5000 max steps)
const app = args.includes('--app');
const kerr = { metric: 'kerr', metricParams: { a: 0.94 }, camera: { r: 1000, theta: 0.2967, screen: 15 }, ...(app ? { farSteps: { r: 20, max: 4 } } : {}) };
const fb = { metric: 'st3cr', metricParams: { lambda: 1e-3 }, camera: { r: 250 / 24, theta: 1.5, screen: 150 / 24 }, maxSteps: app ? 5000 : 10000, ...(app ? { farSteps: { r: 20, max: 4 } } : {}) };
const CASES = [
  { name: 'kerr_tabulated_1024_retrace', view: { ...kerr, N: 1024 }, levels: finalLevels(1024) },
  { name: 'kerr_analytic_1024_retrace', view: { ...kerr, N: 1024, path: 'analytic' }, levels: finalLevels(1024) },
  { name: 'kerr_tabulated_256_preview', view: { ...kerr, N: 256 }, levels: [1] },
  { name: 'kerr_tabulated_512_retrace', view: { ...kerr, N: 512 }, levels: finalLevels(512) },
  { name: 'st3cr_l1e-3_1024_retrace', view: { ...fb, N: 1024 }, levels: finalLevels(1024) },
  { name: 'st3cr_l1e-3_512_retrace', view: { ...fb, N: 512 }, levels: finalLevels(512) },
];
const median = (xs) => [...xs].sort((a, b) => a - b)[(xs.length - 1) >> 1];
const v = await openViewer();
const rows = [];
try {
  for (const c of CASES) {
    const run = () => v.page.evaluate(([view, levels]) => window.__foort.trace(view, { levels, adaptTiles: true, measureSteps: false, records: false }).then((r) => r.stats), [c.view, c.levels]);
    const t0 = Date.now();
    await run();   // warm-up: bake, compile, tile size
    const reps = Date.now() - t0 > 20000 ? 1 : 3;   // slow cases: one timed run
    const st = [];
    for (let k = 0; k < reps; k++) st.push(await run());
    const row = { case: c.name, wallMs: median(st.map((s) => s.wallMs)), gpuMs: median(st.map((s) => s.gpuMs ?? NaN)), tiles: st[0].tiles };
    rows.push(row);
    console.log(`${c.name}: ${row.wallMs.toFixed(0)} ms wall (GPU ${row.gpuMs.toFixed(0)} ms, ${row.tiles} tiles)`);
  }
} finally { await v.close(); }
const get = (n) => rows.find((r) => r.case === n)?.wallMs ?? NaN;
const summary = { fuzzballOverKerr1024: get('st3cr_l1e-3_1024_retrace') / get('kerr_tabulated_1024_retrace') };
console.log(`fuzzball / Kerr at 1024^2: ${summary.fuzzballOverKerr1024.toFixed(2)}`);
writeFileSync(join(outDir, `perf_${tag}.json`), JSON.stringify({ renderer: v.renderer, rows, summary }, null, 1));
