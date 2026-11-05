// M6 Level 3: the lambda = 0 ST3Cr black hole is static and spherical, so its shadow is the disc of screen radius
//   rho_s = r_c tan(psi),  sin(psi) = b_c sqrt(-g_tt / g_thth)(r_c) = b_c / (r_c sqrt(Q(r_c))),
// with b_c = min_r r sqrt(Q(r)) (js/metrics/st3crBH.js criticalImpactParameter). Rays inside it reach the inner cut
// (they cross the photon sphere and fall down the AdS2 throat); rays outside escape. Compared pixel by pixel.
// Usage (from dev/): node scripts/m6Level3.mjs [--N 512]  -> dev/reports/m6/level3.json
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openViewer } from './gpuRunner.mjs';
import { decodeRecord } from '../../js/gpu/traceConfig.js';
import { createST3CrBH } from '../../js/metrics/st3crBH.js';

const args = process.argv.slice(2);
const N = Number(args[args.indexOf('--N') + 1] || 512);
const outDir = resolve(dirname(fileURLToPath(import.meta.url)), '../reports/m6');
mkdirSync(outDir, { recursive: true });
const bh = createST3CrBH({ P: 2, q0: 50 });
const { b: bc, r: rPh } = bh.criticalImpactParameter();
const CAMS = [
  { name: 'Test_FBdetail', r: 250, theta: 1.5, screen: 150 },
  { name: 'distant_1000M', r: 24000, theta: 1.0, screen: 150 },
  { name: 'faceon_100M', r: 2400, theta: 0.01, screen: 150 },
];
const v = await openViewer();
const rows = [];
try {
  for (const cam of CAMS) {
    const rhoS = cam.r * Math.tan(Math.asin(bc / (cam.r * Math.sqrt(bh.Q(cam.r)))));
    const g = await v.trace({ metric: 'st3crBH', metricParams: {}, camera: cam, N, maxSteps: 20000, fluid: { xi: 1, betaR: 1, betaPhi: 1 } });
    let nG = 0, nA = 0, mis = 0, maxD = 0, other = 0;
    const px = cam.screen / N;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const d = decodeRecord(g.rec, j * N + i);
      const a = cam.screen * ((i + 0.5) / N - 0.5), b = cam.screen * ((j + 0.5) / N - 0.5);
      const rho = Math.hypot(a, b);
      const inA = rho < rhoS, inG = d.term === 1;
      if (d.term !== 1 && d.term !== 2) other++;
      nA += inA ? 1 : 0; nG += inG ? 1 : 0;
      if (inA !== inG) { mis++; maxD = Math.max(maxD, Math.abs(rho - rhoS) / px); }
    }
    const row = { camera: cam, N, bc, rPhotonSphere: rPh, rhoShadow: rhoS, capturedGPU: nG, capturedAnalytic: nA, mismatches: mis,
      maxMismatchDistancePx: maxD, radiusRatio: Math.sqrt(nG / nA), notCapturedOrEscaped: other, gpuMs: g.stats.gpuMs };
    rows.push(row);
    console.log(`${cam.name}: shadow radius ${rhoS.toFixed(4)} (b_c ${bc.toFixed(4)}); GPU/analytic equivalent radius ${row.radiusRatio.toFixed(5)}, `
      + `${mis} mismatched px (max ${maxD.toFixed(2)} px from the edge), other terminations ${other}`);
  }
} finally { await v.close(); }
writeFileSync(join(outDir, 'level3.json'), JSON.stringify({ renderer: v.renderer, rows }, null, 1));
