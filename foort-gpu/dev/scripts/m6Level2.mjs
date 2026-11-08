// M6 Level 2: GPU (float32, tabulated ST3Cr) vs the double-precision CPU reference (exact metric) on the same rays.
// Inside the fuzzball, ray scattering is chaotic: two correct integrators separate there (M2 diagnosis). The
// mismatched pixels are therefore re-traced on the CPU at a smaller step (eps / 3); a pixel whose CPU outcome
// changes with the step is not converged at the default step, and its GPU-CPU difference says nothing about the GPU.
// The report gives the agreement over all pixels and over the converged ones.
// Usage (from dev/): node scripts/m6Level2.mjs [case ...] [--N 64] [--recompute]
// Writes dev/reports/m6/level2_<case>.json/.png; caches CPU results in tools/foort_parity/build/m6/ (git-ignored).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openViewer } from './gpuRunner.mjs';
import { traceViewCPU } from './cpuPool.mjs';
import { compareImages, summary, writeComparisonPng, quadrantOf } from './m3Compare.mjs';
import { decodeRecord } from '../../js/gpu/traceConfig.js';
import { discIntensity } from '../../js/fluid/emission.js';

const here = dirname(fileURLToPath(import.meta.url));
// Test_FBdetail.cfg (r = 250, screen 150 coordinate units) in units of M: the registry's ST3Cr is in units of M_ADM = 24 (B1)
const fbCam = { r: 250 / 24, theta: 1.5, screen: 150 / 24 };
const fbEm = { mu: 0, gamma: -1.5, sigma: 2 / 24, redshiftPower: 3, fudge: 1, maxPasses: 0 };
export const M6_CASES = {
  'st3cr_l0.005': { metric: 'st3cr', metricParams: { lambda: 0.005 }, camera: fbCam },
  'st3cr_l0.05': { metric: 'st3cr', metricParams: { lambda: 0.05 }, camera: fbCam },
  'st3cr_l1e-4': { metric: 'st3cr', metricParams: { lambda: 1e-4 }, camera: fbCam },
  'st3crBH': { metric: 'st3crBH', metricParams: {}, camera: fbCam },
  'st3cr_l0.005_faceon': { metric: 'st3cr', metricParams: { lambda: 0.005 }, camera: { r: 250 / 24, theta: 0.05, screen: 150 / 24 } },
};

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const N = Number(opt('--N', 64));
const recompute = args.includes('--recompute');
// --grid 1024x256: GPU table size (the CPU reference does not depend on it); the report name gets the grid
const gridArg = opt('--grid', null);
const grid = gridArg ? { nx: Number(gridArg.split('x')[0]), nth: Number(gridArg.split('x')[1]) } : null;
const tag = grid ? `_grid${gridArg}` : '';
const names = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && ['--N', '--grid'].includes(args[i - 1])));
const list = names.length ? names : Object.keys(M6_CASES);
const outDir = resolve(here, '../reports/m6'), cacheDir = resolve(here, '../../tools/foort_parity/build/m6');
mkdirSync(outDir, { recursive: true }); mkdirSync(cacheDir, { recursive: true });
const cached = async (file, f) => {
  if (!recompute && existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  const t0 = Date.now(); const cpu = await f(); const res = { cpuSeconds: (Date.now() - t0) / 1000, cpu };
  writeFileSync(file, JSON.stringify(res)); return res;
};
const viewer = await openViewer();
console.log('GPU:', viewer.renderer);
try {
  for (const name of list) {
    const view = { ...M6_CASES[name], N, maxSteps: 10000, fluid: { xi: 1, betaR: 1, betaPhi: 1 } };
    const g = await viewer.trace(grid ? { ...view, grid } : view);
    const { cpu, cpuSeconds } = await cached(join(cacheDir, `${name}_N${N}_M1.json`), () => traceViewCPU(view));
    const cmp = compareImages(g.rec, cpu, N);
    writeComparisonPng(join(outDir, `level2_${name}${tag}.png`), cmp);
    const C = new Array(N * N); for (const c of cpu) C[c.j * N + c.i] = c;
    // convergence of the mismatched pixels: CPU at eps / 3
    const mism = [];
    for (let k = 0; k < N * N; k++) if (cmp._maps.mismatch[k]) mism.push([k % N, Math.floor(k / N)]);
    // fine-step CPU results are cached per pixel (the mismatched set depends on the GPU table)
    const fineFile = join(cacheDir, `${name}_N${N}_M1_fine.json`);
    const fineAll = !recompute && existsSync(fineFile) ? JSON.parse(readFileSync(fineFile, 'utf8')).cpu : [];
    const have = new Set(fineAll.map((f) => `${f.i},${f.j}`));
    const todo = mism.filter(([i, j]) => !have.has(`${i},${j}`));
    if (todo.length) { fineAll.push(...(await traceViewCPU({ ...view, eps: 0.01, maxSteps: 30000 }, todo))); writeFileSync(fineFile, JSON.stringify({ cpu: fineAll })); }
    const want = new Set(mism.map(([i, j]) => `${i},${j}`));
    const fine = fineAll.filter((f) => want.has(`${f.i},${f.j}`));
    const unconverged = new Uint8Array(N * N);
    for (const f of fine) {
      const k = f.j * N + f.i, c = C[k];
      if (quadrantOf(f.term, f.theta, f.phi) !== quadrantOf(c.term, c.theta, c.phi)) unconverged[k] = 1;
    }
    const nUnc = unconverged.reduce((a, b) => a + b, 0);
    // disc emission (Test_FBdetail parameters), all pixels and converged pixels
    let iC = 0, iD = 0, iCc = 0, iDc = 0;
    /** @type {any[]} */
    let worst = [];
    for (let k = 0; k < N * N; k++) {
      const IG = discIntensity(decodeRecord(g.rec, k).crossings, fbEm), IC = discIntensity(C[k].crossings.slice(0, 3), fbEm);
      iC += IC; iD += Math.abs(IG - IC);
      worst.push({ i: k % N, j: Math.floor(k / N), dI: Math.abs(IG - IC), IG, IC, gpu: decodeRecord(g.rec, k).crossings, cpu: C[k].crossings.slice(0, 3).map((c) => ({ r: c.r, g: c.g })), unconverged: !!unconverged[k] });
      if (!unconverged[k]) { iCc += IC; iDc += Math.abs(IG - IC); }
    }
    worst = worst.sort((a, b) => b.dI - a.dI).slice(0, 5);
    const conv = N * N - nUnc;
    const report = { case: name, view, grid: grid ?? '512x128 (default)', renderer: viewer.renderer, gpu: g.stats, cpuSeconds, ...summary(cmp),
      mismatched: mism.length, unconvergedAtEps: nUnc,
      fourColorAgreementConverged: (conv - (mism.length - nUnc)) / conv,
      emissionRelL1: iD / iC, emissionRelL1Converged: iDc / iCc, emissionTotalCPU: iC, worstEmissionPixels: worst };
    writeFileSync(join(outDir, `level2_${name}${tag}.json`), JSON.stringify(report, null, 1));
    const e = (x) => (Number.isFinite(x) ? x.toExponential(1) : '—');
    console.log(`${name}${tag}: four-colour ${(100 * cmp.fourColorAgreement).toFixed(2)}% (${mism.length} px, of which ${nUnc} change with the CPU step; converged pixels ${(100 * report.fourColorAgreementConverged).toFixed(3)}%), `
      + `escape dir median/p99 ${e(cmp.escapeAngle.median)}/${e(cmp.escapeAngle.p99)} rad, crossing1 r ${e(cmp.crossing1.relR.median)}/${e(cmp.crossing1.relR.p99)}, g ${e(cmp.crossing1.relG.median)}/${e(cmp.crossing1.relG.p99)}, `
      + `emission L1 ${e(report.emissionRelL1)} (converged ${e(report.emissionRelL1Converged)}); GPU ${g.stats.wallMs.toFixed(0)} ms, CPU ${cpuSeconds?.toFixed(0)} s`);
  }
} finally { await viewer.close(); }
