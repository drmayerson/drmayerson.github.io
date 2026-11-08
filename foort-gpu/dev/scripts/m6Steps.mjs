// M6: step-count, termination and timing statistics of fuzzball views on the GPU, vs lambda and max steps.
// Test_FBdetail camera (r = 250, theta = 1.5, screen 150 in base units). Usage (from dev/):
//   node scripts/m6Steps.mjs [--N 128] [--max 2000,5000,20000] [--lambdas 0.05,0.005,1e-3,1e-4,0]  -> dev/reports/m6/steps.json
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openViewer } from './gpuRunner.mjs';
import { decodeRecord } from '../../js/gpu/traceConfig.js';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const N = Number(opt('--N', 128));
const MAXS = opt('--max', '2000,5000,20000').split(',').map(Number);
const LAMBDAS = opt('--lambdas', '0.05,0.005,1e-3,1e-4,0').split(',').map(Number);
const outDir = resolve(dirname(fileURLToPath(import.meta.url)), '../reports/m6');
mkdirSync(outDir, { recursive: true });
const camera = { r: 250 / 24, theta: 1.5, screen: 150 / 24 };   // Test_FBdetail, units of M (B1)
const v = await openViewer();
const rows = [];
try {
  for (const lambda of LAMBDAS) for (const maxSteps of MAXS) {
    const view = lambda > 0 ? { metric: 'st3cr', metricParams: { lambda } } : { metric: 'st3crBH', metricParams: {} };
    const t0 = Date.now();
    const g = await v.trace({ ...view, camera, N, maxSteps, fluid: { xi: 1, betaR: 1, betaPhi: 1 } });
    const wall = Date.now() - t0;
    const steps = [], term = [0, 0, 0, 0, 0, 0, 0];
    for (let k = 0; k < N * N; k++) { const d = decodeRecord(g.rec, k); steps.push(d.steps); term[d.term]++; }
    steps.sort((a, b) => a - b);
    const q = (f) => steps[Math.min(steps.length - 1, Math.floor(f * steps.length))];
    const mean = steps.reduce((a, b) => a + b, 0) / steps.length;
    const frac = (c) => +(term[c] / (N * N)).toFixed(5);
    const row = { lambda, maxSteps, N, gpuMs: g.stats.gpuMs, wallMs: wall, steps: { mean, median: q(0.5), p90: q(0.9), p99: q(0.99), max: steps[steps.length - 1] },
      term: { innerCut: frac(1), escaped: frac(2), timeout: frac(3), nan: frac(4), singularity: frac(6) } };
    rows.push(row);
    console.log(`lambda ${lambda} max ${maxSteps}: GPU ${row.gpuMs?.toFixed(0)} ms; steps mean ${mean.toFixed(0)} median ${q(0.5)} p90 ${q(0.9)} p99 ${q(0.99)}; `
      + `escaped ${frac(2)}, inner cut ${frac(1)}, singularity ${frac(6)}, time out ${frac(3)}, NaN ${frac(4)}`);
  }
} finally { await v.close(); }
writeFileSync(join(outDir, `steps_N${N}.json`), JSON.stringify({ renderer: v.renderer, camera, rows }, null, 1));
