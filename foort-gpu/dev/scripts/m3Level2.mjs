// Level 2: GPU (float32) vs CPU reference (double) on the same views. M3 cases run on the analytic
// Kerr shader, M4 cases (--m4) on the tabulated tracer.
// Usage (from dev/): node scripts/m3Level2.mjs [case ...] [--N 256] [--recompute] [--m4]
// Writes dev/reports/m3/ (or m4/) <case>.json and .png; caches CPU results in tools/foort_parity/build/m3/ (git-ignored).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openViewer } from './gpuRunner.mjs';
import { traceViewCPU } from './cpuPool.mjs';
import { compareImages, summary, writeComparisonPng } from './m3Compare.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const DEG = Math.PI / 180;
// KerrExample.cfg camera (r = 1000, theta = 17 deg, 15 x 15 screen); plus near edge-on and face-on views
const kerrCam = { r: 1000, theta: 0.2967, screen: 15 };
export const M3_CASES = {
  'kerr_a0': { metric: 'kerr', metricParams: { a: 0 }, camera: kerrCam },
  'kerr_a0.5': { metric: 'kerr', metricParams: { a: 0.5 }, camera: kerrCam },
  'kerr_a0.94': { metric: 'kerr', metricParams: { a: 0.94 }, camera: kerrCam },
  'kerr_a0.998': { metric: 'kerr', metricParams: { a: 0.998 }, camera: kerrCam },
  'kerr_a0.94_inc80': { metric: 'kerr', metricParams: { a: 0.94 }, camera: { r: 1000, theta: 80 * DEG, screen: 15 } },
  'kerr_a0.998_inc80': { metric: 'kerr', metricParams: { a: 0.998 }, camera: { r: 1000, theta: 80 * DEG, screen: 15 } },
  'kerr_a0_faceon': { metric: 'kerr', metricParams: { a: 0 }, camera: { r: 1000, theta: 0.01 * DEG, screen: 15 } },
  'kerr_a0.94_faceon': { metric: 'kerr', metricParams: { a: 0.94 }, camera: { r: 1000, theta: 0.01 * DEG, screen: 15 } },
};
// M4: BH-mode metrics on the tabulated GPU path (default table 512 x 128). Cameras: the M2 parity cases
// (Johannsen as KerrExample, Manko-Novikov as Test_MNrun.cfg) plus near edge-on views.
export const M4_CASES = {
  'johannsen_a0.94_a13_5.5': { metric: 'johannsen', metricParams: { a: 0.94, alpha13: 5.5 }, camera: kerrCam },
  'johannsen_a0.5_a13_-5_inc80': { metric: 'johannsen', metricParams: { a: 0.5, alpha13: -5 }, camera: { r: 1000, theta: 80 * DEG, screen: 15 } },
  'mankoNovikov_a0.94_a3_2': { metric: 'mankoNovikov', metricParams: { a: 0.94, alpha3: 2 }, camera: { r: 1000, theta: 0.523599, screen: 15 } },
  'mankoNovikov_a0.5_a3_0.5_inc80': { metric: 'mankoNovikov', metricParams: { a: 0.5, alpha3: 0.5 }, camera: { r: 1000, theta: 80 * DEG, screen: 15 } },
  'kerr_a0.94_tab': { metric: 'kerr', metricParams: { a: 0.94 }, camera: kerrCam },
};
const ALL_CASES = { ...M3_CASES, ...M4_CASES };

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
  const N = Number(opt('--N', 256));
  const recompute = args.includes('--recompute');
  const m4 = args.includes('--m4');
  const names = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1] === '--N'));
  const list = names.length ? names : Object.keys(m4 ? M4_CASES : M3_CASES);
  const outDir = resolve(here, m4 ? '../reports/m4' : '../reports/m3'), cacheDir = resolve(here, '../../tools/foort_parity/build/m3');
  mkdirSync(outDir, { recursive: true }); mkdirSync(cacheDir, { recursive: true });
  const viewer = await openViewer();
  console.log('GPU:', viewer.renderer);
  try {
    for (const name of list) {
      const view = { ...ALL_CASES[name], N, maxSteps: 20000, path: name in M4_CASES ? 'tabulated' : 'analytic' };
      const g = await viewer.trace(view);
      const cacheFile = join(cacheDir, `${name}_N${N}.json`);
      let cpu, cpuSeconds = null;
      if (!recompute && existsSync(cacheFile)) ({ cpu, cpuSeconds } = JSON.parse(readFileSync(cacheFile, 'utf8')));
      else {
        const t0 = Date.now();
        cpu = await traceViewCPU(view);
        cpuSeconds = (Date.now() - t0) / 1000;
        writeFileSync(cacheFile, JSON.stringify({ view, cpuSeconds, cpu }));
      }
      const cmp = compareImages(g.rec, cpu, N);
      writeComparisonPng(join(outDir, `${name}.png`), cmp);
      const report = { case: name, view, renderer: viewer.renderer, gpu: g.stats, cpuSeconds, ...summary(cmp) };
      writeFileSync(join(outDir, `${name}.json`), JSON.stringify(report, null, 1));
      const e = (x) => (Number.isFinite(x) ? x.toExponential(1) : '—');
      console.log(`${name}: four-colour ${(100 * cmp.fourColorAgreement).toFixed(3)}% (${cmp.fourColorMismatches} px, ${cmp.mismatchesInHeterogeneousNeighbourhood} at CPU class edges), ` +
        `escape dir ${e(cmp.escapeAngle.median)}/${e(cmp.escapeAngle.p99)}/${e(cmp.escapeAngle.max)} rad, shadow radius ratio ${cmp.shadow.radiusRatio.toFixed(5)}, ` +
        `crossing1 r ${e(cmp.crossing1.relR.median)}/${e(cmp.crossing1.relR.p99)}, g ${e(cmp.crossing1.relG.median)}/${e(cmp.crossing1.relG.p99)}, ` +
        `emission proxy L1 ${e(cmp.emissionProxyRelL1)}, NaN ${cmp.nanGPU}, timeouts ${cmp.timeoutGPU}; GPU ${g.stats.wallMs.toFixed(0)} ms, CPU ${cpuSeconds?.toFixed(0)} s`);
    }
  } finally {
    await viewer.close();
  }
}
