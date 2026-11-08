// M6 Level 1: GPU fuzzball images vs FOORT (M2 parity run st3cr_l0.005: Test_FBdetail.cfg camera, 128², FOORT mesh,
// RK4 eps = 0.03, EquatorialEmission with GLMJohnsonSU mu = 0, gamma = -1.5, sigma = 2 and GeneralCircularRadial 1/1/1).
// The GPU takes FOORT's terminations as far as it can: inner cut r < 0.01 (FOORT Epsilon_Horizon with r_h = 0) and
// singularity distance 0.001 (Euclidean on the GPU; FOORT measures it in coordinate space (r, theta)).
// Four-colour agreement (FOORT FourColorScreen quadrants) and disc intensities, FOORT-parity and interpolated crossings.
// Usage (from dev/): node scripts/m6GpuVsFoort.mjs  -> dev/reports/m6/foort_<crossing>.json/.png
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
const outDir = resolve(here, '../reports/m6');
mkdirSync(outDir, { recursive: true });
const c = /** @type {any} */ (CASES.find((x) => x.name === 'st3cr_l0.005'));
const run = readFoortRun(resolve(here, '../../tools/foort_parity/build/runs', c.name), c.name);
const N = c.N;
// FOORT works in the raw ST3Cr coordinates; the GPU's ST3Cr is in units of M_ADM = 24 (Stage 1B B1): camera, terminations
// and the Johnson-SU mu, sigma are divided by 24, and J(r) (1/length) is 24x larger, so GPU intensities are divided by 24
const L = 24;
const em = { ...c.emission, mu: c.emission.mu / L, sigma: c.emission.sigma / L, redshiftPower: 3, fudge: 1, maxPasses: 0 };
const quad = (d) => (d.term !== 2 ? 0 : d.theta < Math.PI / 2 ? (d.phi < Math.PI ? 1 : 2) : (d.phi < Math.PI ? 3 : 4));
const COL = [[0, 0, 0], [228, 74, 64], [64, 156, 228], [240, 200, 60], [90, 190, 110]];
const viewer = await openViewer();
try {
  // FOORT does not project onto H = 0: the parity run does not either; the app run (interpolated crossings) does
  for (const [crossing, project] of [['foort', false], ['interpolate', true]]) {
    const view = { metric: 'st3cr', metricParams: { lambda: 0.005 }, camera: { r: c.camera.r / L, theta: c.camera.theta, screen: c.camera.screen / L }, N, mesh: 'foort', crossing, maxSteps: c.maxSteps,
      rInner: c.epsHorizon / L, singEps: c.singEps / L, project, fluid: { xi: 1, betaR: 1, betaPhi: 1 } };
    const g = await viewer.trace(view);
    const IG = new Float64Array(N * N), IF = new Float64Array(N * N), qG = new Uint8Array(N * N), qF = new Uint8Array(N * N);
    let same = 0, sumF = 0, sumD = 0, many = 0, sumFo = 0, sumDo = 0;
    const rel = [];
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      const k = j * N + i, d = decodeRecord(g.rec, k), f = /** @type {any} */ (run.pixels.get(`${i},${j}`));
      qG[k] = quad(d); qF[k] = f.quadrant;
      if (qG[k] === qF[k]) same++;
      IG[k] = discIntensity(d.crossings, em) / L; IF[k] = f.intensity;
      if (d.passes > 3) many++;
      sumF += IF[k]; sumD += Math.abs(IG[k] - IF[k]);
      if (qG[k] === qF[k]) { sumFo += IF[k]; sumDo += Math.abs(IG[k] - IF[k]); }
      if (IF[k] > 1e-3 * 0.01) rel.push(Math.abs(IG[k] - IF[k]) / IF[k]);
    }
    rel.sort((a, b) => a - b);
    // hot pixels: intensity > 100 x the 99.5th percentile of FOORT's image (constraint-drift blow-ups of g in either
    // code); the robust L1 leaves out pixels that are hot in either image
    const p995 = [...IF].sort((a, b) => a - b)[Math.floor(0.995 * N * N)];
    let hotF = 0, hotG = 0, sumFr = 0, sumDr = 0, sum3F = 0, sum3D = 0, n3 = 0;
    for (let k = 0; k < N * N; k++) {
      const hf = IF[k] > 100 * p995, hg = IG[k] > 100 * p995;
      if (hf) hotF++; if (hg) hotG++;
      if (!hf && !hg) { sumFr += IF[k]; sumDr += Math.abs(IG[k] - IF[k]); }
      // pixels the 3-crossing record represents completely in both codes, with the same four-colour class
      const f = /** @type {any} */ (run.pixels.get(`${k % N},${Math.floor(k / N)}`)), d = decodeRecord(g.rec, k);
      if (!hf && !hg && Math.abs(f.passes) <= 3 && d.passes <= 3 && qG[k] === qF[k]) { sum3F += IF[k]; sum3D += Math.abs(IG[k] - IF[k]); n3++; }
    }
    const q = (x) => rel[Math.min(rel.length - 1, Math.floor(x * rel.length))];
    const report = { case: c.name, crossing, project, N, fourColorAgreement: same / (N * N), fourColorMismatches: N * N - same,
      emission: { relL1: sumD / sumF, relL1SameQuadrant: sumDo / sumFo, hotPixelsFOORT: hotF, hotPixelsGPU: hotG, relL1WithoutHot: sumDr / sumFr, relL1AtMost3PassesSameQuadrant: sum3D / sum3F, pixelsAtMost3PassesSameQuadrant: n3, relDiff: { median: q(0.5), p90: q(0.9), p99: q(0.99) } },
      raysWithMoreThan3Passes: many, gpu: g.stats, renderer: viewer.renderer };
    writeFileSync(join(outDir, `foort_${crossing}.json`), JSON.stringify(report, null, 1));
    // panels: FOORT four-colour | GPU four-colour | FOORT emission | GPU emission | |dI|/I (log, 1e-7 .. 1e-1)
    const top = [...IF].sort((a, b) => a - b)[Math.floor(0.995 * N * N)] || 1, gap = 4;
    writePng(join(outDir, `foort_${crossing}.png`), 5 * N + 4 * gap, N, (x, y) => {
      const p = Math.floor(x / (N + gap)), i = x - p * (N + gap), k = (N - 1 - y) * N + i;
      if (i >= N) return [255, 255, 255];
      if (p === 0) return COL[qF[k]];
      if (p === 1) return COL[qG[k]];
      if (p < 4) {
        const v = Math.sqrt(Math.min(1, (p === 2 ? IF[k] : IG[k]) / top));
        return [Math.min(255, 510 * v), Math.max(0, Math.min(255, 510 * v - 128)), Math.max(0, Math.min(255, 510 * v - 255))];
      }
      const e = Math.abs(IG[k] - IF[k]) / Math.max(IF[k], 1e-3 * top), t = Math.min(1, Math.max(0, (Math.log10(Math.max(e, 1e-9)) + 7) / 6));
      return [Math.round(255 * Math.min(1, 2 * t)), Math.round(255 * Math.max(0, 2 * t - 1)), Math.round(80 * (1 - t))];
    });
    const e = (x) => x.toExponential(1);
    console.log(`${crossing}${project ? ' + projection' : ''}: four-colour ${(100 * report.fourColorAgreement).toFixed(2)}% (${report.fourColorMismatches} px); emission rel L1 ${e(report.emission.relL1)} `
      + `(same-quadrant pixels ${e(report.emission.relL1SameQuadrant)}; hot pixels FOORT ${hotF}, GPU ${hotG}; L1 without them ${e(sumDr / sumFr)}; on the ${n3} px with ≤ 3 passes in both and the same class ${e(sum3D / sum3F)}), rel diff median/p90/p99 ${e(q(0.5))}/${e(q(0.9))}/${e(q(0.99))}; rays > 3 passes ${many}`);
  }
} finally { await viewer.close(); }
