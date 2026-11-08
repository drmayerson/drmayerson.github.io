// M6: continuity of the images as lambda -> 0 (plan gotcha 5): the ST3Cr images at lambda = 1e-2, 1e-3, 1e-4 against
// the lambda = 0 black hole, on the GPU, Test_FBdetail camera. Outside the throat (screen radius > 1.1 x the
// lambda = 0 shadow radius) the images should converge to the black hole's; inside, rays that the black hole
// swallows come back out of the fuzzball's cap after a long delay.
// Usage (from dev/): node scripts/m6Continuity.mjs [--N 256]  -> dev/reports/m6/continuity.json/.png
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openViewer } from './gpuRunner.mjs';
import { decodeRecord } from '../../js/gpu/traceConfig.js';
import { discIntensity } from '../../js/fluid/emission.js';
import { createST3CrBH } from '../../js/metrics/st3crBH.js';
import { writePng } from './png.mjs';

const args = process.argv.slice(2);
const N = args.includes('--N') ? Number(args[args.indexOf('--N') + 1]) : 256;
const outDir = resolve(dirname(fileURLToPath(import.meta.url)), '../reports/m6');
mkdirSync(outDir, { recursive: true });
// Test_FBdetail camera: raw coordinates (FOORT) and units of M (the registry's ST3Cr since Stage 1B B1)
const camRaw = { r: 250, theta: 1.5, screen: 150 };
const cam = { r: camRaw.r / 24, theta: camRaw.theta, screen: camRaw.screen / 24 };
const em = { mu: 0, gamma: -1.5, sigma: 2 / 24, redshiftPower: 3, fudge: 1, maxPasses: 0 };
const bh = createST3CrBH({ P: 2, q0: 50 });
// shadow radius from the raw BH (its Q is in raw units), then in units of M
const rhoS = camRaw.r * Math.tan(Math.asin(bh.criticalImpactParameter().b / (camRaw.r * Math.sqrt(bh.Q(camRaw.r))))) / 24;
const quad = (d) => (d.term !== 2 ? 0 : d.theta < Math.PI / 2 ? (d.phi < Math.PI ? 1 : 2) : (d.phi < Math.PI ? 3 : 4));
const LAMBDAS = [1e-2, 1e-3, 1e-4, 0];
const v = await openViewer();
const imgs = [];
try {
  for (const lambda of LAMBDAS) {
    const view = lambda > 0 ? { metric: 'st3cr', metricParams: { lambda } } : { metric: 'st3crBH', metricParams: {} };
    const g = await v.trace({ ...view, camera: cam, N, maxSteps: 10000, fluid: { xi: 1, betaR: 1, betaPhi: 1 } });
    const q = new Uint8Array(N * N), I = new Float64Array(N * N), dt = new Float64Array(N * N);
    for (let k = 0; k < N * N; k++) { const d = decodeRecord(g.rec, k); q[k] = quad(d); I[k] = discIntensity(d.crossings, em); dt[k] = d.crossings[0]?.dt ?? NaN; }
    imgs.push({ lambda, q, I, dt, gpuMs: g.stats.gpuMs });
  }
} finally { await v.close(); }
const ref = imgs[imgs.length - 1];
const outside = new Uint8Array(N * N);
for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
  const a = cam.screen * ((i + 0.5) / N - 0.5), b = cam.screen * ((j + 0.5) / N - 0.5);
  outside[j * N + i] = Math.hypot(a, b) > 1.1 * rhoS ? 1 : 0;
}
const rows = [];
for (const im of imgs.slice(0, -1)) {
  let nOut = 0, misOut = 0, misIn = 0, nIn = 0, iRef = 0, iDiff = 0, iRefAll = 0, iDiffAll = 0;
  for (let k = 0; k < N * N; k++) {
    const mis = im.q[k] !== ref.q[k];
    iRefAll += ref.I[k]; iDiffAll += Math.abs(im.I[k] - ref.I[k]);
    if (outside[k]) { nOut++; if (mis) misOut++; iRef += ref.I[k]; iDiff += Math.abs(im.I[k] - ref.I[k]); } else { nIn++; if (mis) misIn++; }
  }
  const row = { lambda: im.lambda, N, shadowRadiusBH: rhoS, outside: { pixels: nOut, fourColorMismatch: misOut / nOut, emissionRelL1: iDiff / iRef },
    inside: { pixels: nIn, fourColorMismatch: misIn / nIn }, emissionRelL1All: iDiffAll / iRefAll, gpuMs: im.gpuMs };
  rows.push(row);
  console.log(`lambda ${im.lambda} vs 0: outside 1.1 x shadow: four-colour mismatch ${(100 * row.outside.fourColorMismatch).toFixed(3)}%, emission L1 ${row.outside.emissionRelL1.toExponential(2)}; `
    + `inside: four-colour mismatch ${(100 * row.inside.fourColorMismatch).toFixed(1)}%; emission L1 over the whole image ${row.emissionRelL1All.toExponential(2)}`);
}
writeFileSync(join(outDir, 'continuity.json'), JSON.stringify({ camera: cam, rows }, null, 1));
// rows: four-colour (lambda = 1e-2, 1e-3, 1e-4, 0) | emission (same, common exposure) | four-colour mismatch with lambda = 0
const COL = [[0, 0, 0], [228, 74, 64], [64, 156, 228], [240, 200, 60], [90, 190, 110]];
const top = [...ref.I].sort((a, b) => a - b)[Math.floor(0.995 * N * N)] || 1, gap = 4, n = imgs.length;
writePng(join(outDir, 'continuity.png'), n * N + (n - 1) * gap, 3 * N + 2 * gap, (x, y) => {
  const c = Math.floor(x / (N + gap)), i = x - c * (N + gap), rr = Math.floor(y / (N + gap)), jj = y - rr * (N + gap);
  if (i >= N || jj >= N) return [255, 255, 255];
  const k = (N - 1 - jj) * N + i, im = imgs[c];
  if (rr === 0) return COL[im.q[k]];
  if (rr === 1) { const t = Math.sqrt(Math.min(1, im.I[k] / top)); return [Math.min(255, 510 * t), Math.max(0, Math.min(255, 510 * t - 128)), Math.max(0, Math.min(255, 510 * t - 255))]; }
  const mis = im.q[k] !== ref.q[k];
  return mis ? [255, 60, 60] : outside[k] ? [235, 235, 235] : [190, 190, 210];
});
