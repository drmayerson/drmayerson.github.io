// M3 Level 2: GPU (float32, analytic Kerr shader) vs CPU reference (double) on the same views.
// Usage (from dev/): node scripts/m3Level2.mjs [case ...] [--N 256] [--recompute]
// Writes dev/reports/m3/<case>.json and .png; caches CPU results in tools/foort_parity/build/m3/ (git-ignored).
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

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
  const N = Number(opt('--N', 256));
  const recompute = args.includes('--recompute');
  const names = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1] === '--N'));
  const list = names.length ? names : Object.keys(M3_CASES);
  const outDir = resolve(here, '../reports/m3'), cacheDir = resolve(here, '../../tools/foort_parity/build/m3');
  mkdirSync(outDir, { recursive: true }); mkdirSync(cacheDir, { recursive: true });
  const viewer = await openViewer();
  console.log('GPU:', viewer.renderer);
  try {
    for (const name of list) {
      const view = { ...M3_CASES[name], N, maxSteps: 20000 };
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
