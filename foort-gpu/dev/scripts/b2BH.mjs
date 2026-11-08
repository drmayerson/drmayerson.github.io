// Stage 1B B2: black holes with the binned tail. Photon-ring pixels with more than 3 equatorial crossings gain their
// n >= 4 contributions; every other pixel must be unchanged. The tail is switched off with max passes = 3 (crossings 4+
// excluded from the record's weights), which leaves the first 3 crossings exactly as before.
// Usage (from dev/): node scripts/b2BH.mjs [--N 512]  -> dev/reports/b2/bh.json
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openViewer } from './gpuRunner.mjs';
import { decodeRecord } from '../../js/gpu/traceConfig.js';
import { discIntensity } from '../../js/fluid/emission.js';

const args = process.argv.slice(2);
const N = args.includes('--N') ? Number(args[args.indexOf('--N') + 1]) : 512;
const outDir = resolve(dirname(fileURLToPath(import.meta.url)), '../reports/b2');
mkdirSync(outDir, { recursive: true });
const DEG = Math.PI / 180;
const em = { mu: 2.02, gamma: -2, sigma: 0.5, redshiftPower: 3, fudge: 1, maxPasses: 0 };
const CASES = [
  { name: 'kerr_a0.94_inc17', view: { metric: 'kerr', metricParams: { a: 0.94 }, camera: { r: 1000, theta: 17 * DEG, screen: 15 } } },
  { name: 'kerr_a0.94_inc80', view: { metric: 'kerr', metricParams: { a: 0.94 }, camera: { r: 1000, theta: 80 * DEG, screen: 15 } } },
  { name: 'kerr_a0_inc80', view: { metric: 'kerr', metricParams: { a: 0 }, camera: { r: 1000, theta: 80 * DEG, screen: 15 } } },
];
const v = await openViewer();
const rows = [];
try {
  for (const c of CASES) {
    const A = await v.trace({ ...c.view, N, fluid: { xi: 1, betaR: 1, betaPhi: 1 } });
    const B = await v.trace({ ...c.view, N, fluid: { xi: 1, betaR: 1, betaPhi: 1 }, tailEmission: { redshiftPower: 3, fudge: 1, maxPasses: 3 } });
    let more3 = 0, changedOther = 0, changedRecord = 0, flux = 0, gain = 0;
    for (let k = 0; k < N * N; k++) {
      const a = decodeRecord(A.rec, k, A.tail), b = decodeRecord(B.rec, k, B.tail);
      for (let q = 0; q < 16; q++) if (A.rec[24 * k + q] !== B.rec[24 * k + q]) { changedRecord++; break; }
      const Ia = discIntensity(a.crossings, em, a.tail), Ib = discIntensity(b.crossings, em, b.tail);
      flux += Ib; gain += Ia - Ib;
      if (a.passes > 3) more3++;
      else if (Ia !== Ib) changedOther++;
    }
    const row = { case: c.name, N, pixelsWithMoreThan3: more3, changedPixelsWith3OrFewer: changedOther, recordsChanged: changedRecord, fluxGain: gain / flux };
    rows.push(row);
    console.log(`${c.name}: ${more3} px with > 3 crossings; flux gain ${(100 * row.fluxGain).toFixed(3)}%; pixels with <= 3 crossings changed: ${changedOther}; first-16-float records changed: ${changedRecord}`);
  }
} finally { await v.close(); }
writeFileSync(join(outDir, 'bh.json'), JSON.stringify(rows, null, 1));
