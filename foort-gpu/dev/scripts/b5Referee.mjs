// Stage 1B B5: where two GPU paths (A, B) disagree, which one agrees with the double-precision CPU reference?
// The pixels whose termination class or time-averaged emission (> 1e-3 relative) differ are traced on the CPU, and each
// GPU path is scored against it (termination class, emission within 1e-3 relative).
// Usage (from dev/): node scripts/b5Referee.mjs --scene mankoNovikov_a0.94_a3_2 [--A tabulated] [--B closed] [--N 256] [--max 400]
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openViewer } from './gpuRunner.mjs';
import { traceViewCPU } from './cpuPool.mjs';
import { decodeRecord } from '../../js/gpu/traceConfig.js';
import { discIntensity } from '../../js/fluid/emission.js';
import { GATE_CONFIGS, sceneSet } from './gateConfigs.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const sceneName = opt('--scene', 'mankoNovikov_a0.94_a3_2');
const pathA = opt('--A', 'tabulated'), pathB = opt('--B', 'closed');
const N = Number(opt('--N', 256)), MAX = Number(opt('--max', 400));
const s = sceneSet().find((x) => x.name === sceneName);
if (!s) throw new Error(`unknown scene ${sceneName}`);
const view = { ...GATE_CONFIGS.reference.apply(s), N };

const v = await openViewer();
let A, B;
try {
  A = (await v.trace({ ...view, path: pathA }, { levels: [1], adaptTiles: true })).rec;
  B = (await v.trace({ ...view, path: pathB }, { levels: [1], adaptTiles: true })).rec;
} finally { await v.close(); }
const I = (d) => discIntensity(d.crossings, s.em);
const diff = [];
for (let k = 0; k < N * N; k++) {
  const a = decodeRecord(A, k), b = decodeRecord(B, k);
  const ia = I(a), ib = I(b);
  if (a.term !== b.term || Math.abs(ia - ib) > 1e-3 * Math.max(ia, ib)) diff.push(k);
}
const pick = diff.length > MAX ? Array.from({ length: MAX }, (_, n) => diff[Math.floor((n * diff.length) / MAX)]) : diff;
console.log(`${sceneName}, N = ${N}: ${diff.length} pixels differ between ${pathA} and ${pathB}; tracing ${pick.length} on the CPU`);
const cpu = await traceViewCPU(view, pick.map((k) => [k % N, Math.floor(k / N)]));
const score = { [pathA]: { term: 0, em: 0 }, [pathB]: { term: 0, em: 0 }, neither: 0 };
const rows = [];
for (const c of cpu) {
  const k = c.j * N + c.i, ic = discIntensity(c.crossings, s.em);
  const a = decodeRecord(A, k), b = decodeRecord(B, k);
  const okA = Math.abs(I(a) - ic) <= 1e-3 * Math.max(I(a), ic, 1e-300), okB = Math.abs(I(b) - ic) <= 1e-3 * Math.max(I(b), ic, 1e-300);
  if (a.term === c.term) score[pathA].term++;
  if (b.term === c.term) score[pathB].term++;
  if (okA) score[pathA].em++;
  if (okB) score[pathB].em++;
  if (!okA && !okB) score.neither++;
  rows.push({ i: c.i, j: c.j, cpu: { term: c.term, I: ic, passes: c.passes, rMin: Math.min(...c.crossings.map((x) => x.r), Infinity) }, [pathA]: { term: a.term, I: I(a) }, [pathB]: { term: b.term, I: I(b) } });
}
console.log(`agreement with the CPU on ${cpu.length} differing pixels:`, JSON.stringify(score));
const out = resolve(here, '../reports/b5');
mkdirSync(out, { recursive: true });
writeFileSync(join(out, `referee_${sceneName}_${pathA}_vs_${pathB}.json`), JSON.stringify({ scene: sceneName, N, differing: diff.length, traced: cpu.length, score, rows }, null, 1));
