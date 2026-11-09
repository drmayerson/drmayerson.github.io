// Stage 1B B5: how much could ray compaction save? From the per-pixel step counts of a trace, the cost model
// "a wave of B x B pixels runs as long as its longest ray" gives the single-pass cost and the cost with one compaction
// at N1 steps (phase A: all pixels up to N1; phase B: the unfinished rays packed densely, waves of B^2 rays in order).
// Usage (from dev/): node scripts/b5CompactEstimate.mjs [--N 512] [--B 8]
import { openViewer } from './gpuRunner.mjs';
import { RECORD_FLOATS } from '../../js/gpu/traceConfig.js';
import { GATE_CONFIGS, sceneSet } from './gateConfigs.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const N = Number(opt('--N', 512)), B = Number(opt('--B', 8));
const v = await openViewer();
try {
  for (const s of sceneSet()) {
    const r = await v.trace({ ...GATE_CONFIGS.high.apply(s), N }, { levels: [1], adaptTiles: true });
    const steps = new Float64Array(N * N);
    for (let k = 0; k < N * N; k++) steps[k] = r.rec[RECORD_FLOATS * k + 1];
    const waveCost = (f) => { let c = 0; for (let by = 0; by < N; by += B) for (let bx = 0; bx < N; bx += B) { let m = 0; for (let y = by; y < by + B; y++) for (let x = bx; x < bx + B; x++) m = Math.max(m, f(steps[y * N + x])); c += m * B * B; } return c; };
    const single = waveCost((n) => n);
    const total = steps.reduce((a, b) => a + b, 0);
    const out = [`${s.name}: mean ${(total / (N * N)).toFixed(0)} steps, max ${steps.reduce((a, b) => Math.max(a, b), 0)}, SIMD efficiency single-pass ${(100 * total / single).toFixed(0)}%`];
    for (const n1 of [500, 1000, 1500, 2500]) {
      const A = waveCost((n) => Math.min(n, n1));
      const rest = []; for (let k = 0; k < N * N; k++) if (steps[k] > n1) rest.push(steps[k] - n1);
      let Bc = 0; for (let k = 0; k < rest.length; k += B * B) { let m = 0; for (let q = k; q < Math.min(rest.length, k + B * B); q++) m = Math.max(m, rest[q]); Bc += m * B * B; }
      out.push(`N1 ${n1}: ${(single / (A + Bc)).toFixed(2)}x (${(100 * rest.length / (N * N)).toFixed(1)}% continue)`);
    }
    console.log(out.join('; '));
  }
} finally { await v.close(); }
