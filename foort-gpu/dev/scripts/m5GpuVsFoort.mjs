// M5: GPU disc images vs FOORT EquatorialEmission (M2 parity runs, 128², FOORT mesh), with FOORT-parity
// crossings (post-step position outside the threshold band) and with the app's interpolated crossings.
// The GPU uses its app setup otherwise (tabulated metric, x = log(r - r+), float32; analytic Kerr shader
// for 'kerr_*' with --analytic). The GPU record holds 3 crossings; FOORT sums all passes.
// Usage (from dev/): node scripts/m5GpuVsFoort.mjs [case ...] [--analytic]  -> dev/reports/m5/gpu_<case>_<crossing>.json/.png
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CASES } from './foortCases.mjs';
import { readFoortRun } from './foortDat.mjs';
import { openViewer } from './gpuRunner.mjs';
import { decodeRecord } from '../../js/gpu/traceConfig.js';
import { discIntensity } from '../../js/fluid/emission.js';
import { writePng } from './png.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const analytic = args.includes('--analytic') || args.includes('--parity');
// --parity: closed-form Kerr shader in FOORT's radial coordinate x = log r, so that the GPU takes FOORT's steps
const parity = args.includes('--parity');
const names = args.filter((a) => !a.startsWith('--'));
const list = names.length ? names : ['kerr_a0', 'kerr_a0.94', 'johannsen', 'mankoNovikov'];
const outDir = resolve(here, '../reports/m5');
mkdirSync(outDir, { recursive: true });
const metricOf = { kerr_a0: ['kerr', { a: 0 }], 'kerr_a0.94': ['kerr', { a: 0.94 }], johannsen: ['johannsen', { a: 0.94, alpha13: 5.5 }], mankoNovikov: ['mankoNovikov', { a: 0.94, alpha3: 2 }] };
const viewer = await openViewer();
try {
  for (const name of list) {
    const c = CASES.find((x) => x.name === name);
    const run = readFoortRun(resolve(here, '../../tools/foort_parity/build/runs', name), name);
    const N = c.N;
    const [metric, metricParams] = metricOf[name];
    const em = { ...c.emission, redshiftPower: 3, fudge: 1, maxPasses: 0 };
    for (const crossing of parity ? ['foort'] : ['foort', 'interpolate']) {
      const view = { metric, metricParams, camera: c.camera, N, mesh: 'foort', crossing, maxSteps: c.maxSteps, path: analytic && metric === 'kerr' ? 'analytic' : 'tabulated',
        epsHorizon: c.horizonRadius > 0 ? c.epsHorizon : 0.01, fluid: { xi: 1, betaR: 1, betaPhi: 1 }, ...(parity ? { radial: 'log' } : {}) };
      const g = await viewer.trace(view);
      const IG = new Float64Array(N * N), IF = new Float64Array(N * N);
      let sumF = 0, sumD = 0, many = 0;
      const rel = [];
      for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
        const k = j * N + i, d = decodeRecord(g.rec, k), f = run.pixels.get(`${i},${j}`);
        IG[k] = discIntensity(d.crossings, em); IF[k] = f.intensity;
        if (d.passes > 3) many++;
        sumF += IF[k]; sumD += Math.abs(IG[k] - IF[k]);
        if (IF[k] > 1e-3) rel.push(Math.abs(IG[k] - IF[k]) / IF[k]);
      }
      rel.sort((a, b) => a - b);
      const q = (f) => rel[Math.min(rel.length - 1, Math.floor(f * rel.length))];
      const tag = `${name}_${crossing}${parity ? '_parity' : view.path === 'analytic' ? '_analytic' : ''}`;
      const report = { case: name, crossing, path: view.path, N, relL1: sumD / sumF, relDiff: { median: q(0.5), p90: q(0.9), p99: q(0.99) }, raysWithMoreThan3Passes: many, renderer: viewer.renderer };
      writeFileSync(join(outDir, `gpu_${tag}.json`), JSON.stringify(report, null, 1));
      const top = [...IF].sort((a, b) => a - b)[Math.floor(0.995 * N * N)] || 1, gap = 4;
      writePng(join(outDir, `gpu_${tag}.png`), 3 * N + 2 * gap, N, (x, y) => {
        const panel = Math.floor(x / (N + gap)), i = x - panel * (N + gap), k = (N - 1 - y) * N + i;
        if (i >= N) return [255, 255, 255];
        if (panel < 2) {
          const v = Math.sqrt(Math.min(1, (panel === 0 ? IF[k] : IG[k]) / top));
          return [Math.min(255, 510 * v), Math.max(0, Math.min(255, 510 * v - 128)), Math.max(0, Math.min(255, 510 * v - 255))];
        }
        const e = Math.abs(IG[k] - IF[k]) / Math.max(IF[k], 1e-3), t = Math.min(1, Math.max(0, (Math.log10(Math.max(e, 1e-9)) + 7) / 6));
        return [Math.round(255 * Math.min(1, 2 * t)), Math.round(255 * Math.max(0, 2 * t - 1)), Math.round(80 * (1 - t))];
      });
      const e = (x) => x.toExponential(1);
      console.log(`${tag}: GPU vs FOORT intensity: relative L1 ${e(report.relL1)}, rel. diff median/p90/p99 ${e(q(0.5))}/${e(q(0.9))}/${e(q(0.99))}; rays with > 3 passes ${many}`);
    }
  }
} finally { await viewer.close(); }
