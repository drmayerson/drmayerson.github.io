// M7: sanity of the light-travel delays that slow light uses (plan M7 tests).
//  - BH: the n = 1 image (second crossing) lags the direct image by about half a photon-orbit period; for
//    Schwarzschild the photon orbit's period at infinity is 2 pi b_c = 2 pi 3 sqrt(3) M = 32.6 M.
//  - fuzzball: echoes from the throat, delays far beyond the photon-orbit time, growing as lambda -> 0.
// Delays are excess delays: -dt_1 - (r_cam - r_1) (as the viewer's dt1 view), in units of M_ADM.
// Usage (from dev/): node scripts/m7Delays.mjs [--N 256]  -> dev/reports/m7/delays.json
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openViewer } from './gpuRunner.mjs';
import { decodeRecord } from '../../js/gpu/traceConfig.js';

const args = process.argv.slice(2);
const N = args.includes('--N') ? Number(args[args.indexOf('--N') + 1]) : 256;
const outDir = resolve(dirname(fileURLToPath(import.meta.url)), '../reports/m7');
mkdirSync(outDir, { recursive: true });
const DEG = Math.PI / 180;
const fb = { r: 250, theta: 1.5, screen: 150 };
const CASES = [
  { name: 'kerr_a0_inc80', view: { metric: 'kerr', metricParams: { a: 0 }, camera: { r: 1000, theta: 80 * DEG, screen: 15 } }, M: 1 },
  { name: 'kerr_a0.94_inc80', view: { metric: 'kerr', metricParams: { a: 0.94 }, camera: { r: 1000, theta: 80 * DEG, screen: 15 } }, M: 1 },
  { name: 'kerr_a0.94_inc17', view: { metric: 'kerr', metricParams: { a: 0.94 }, camera: { r: 1000, theta: 0.2967, screen: 15 } }, M: 1 },
  { name: 'st3cr_l0.05', view: { metric: 'st3cr', metricParams: { lambda: 0.05 }, camera: fb, maxSteps: 10000 }, M: 24 },
  { name: 'st3cr_l0.005', view: { metric: 'st3cr', metricParams: { lambda: 0.005 }, camera: fb, maxSteps: 10000 }, M: 24 },
  { name: 'st3cr_l1e-4', view: { metric: 'st3cr', metricParams: { lambda: 1e-4 }, camera: fb, maxSteps: 10000 }, M: 24 },
  { name: 'st3crBH', view: { metric: 'st3crBH', metricParams: {}, camera: fb, maxSteps: 10000 }, M: 24 },
];
const q = (xs, f) => { if (!xs.length) return NaN; const s = Float64Array.from(xs).sort(); return s[Math.min(s.length - 1, Math.floor(f * s.length))]; };
const v = await openViewer();
const rows = [];
try {
  for (const c of CASES) {
    const g = await v.trace({ ...c.view, N, fluid: { xi: 1, betaR: 1, betaPhi: 1 } });
    const rc = c.view.camera.r;
    const d21 = [], ex1 = [];
    for (let k = 0; k < N * N; k++) {
      const d = decodeRecord(g.rec, k);
      if (d.crossings.length >= 1) ex1.push((-d.crossings[0].dt - (rc - d.crossings[0].r)) / c.M);
      if (d.crossings.length >= 2) d21.push((d.crossings[0].dt - d.crossings[1].dt) / c.M);
    }
    const st = (xs) => ({ n: xs.length, median: q(xs, 0.5), p10: q(xs, 0.1), p90: q(xs, 0.9), p99: q(xs, 0.99), max: xs.length ? Math.max(...xs) : NaN });
    const row = { case: c.name, N, delay21_M: st(d21), excessDelay1_M: st(ex1) };
    rows.push(row);
    const f = (x) => (Number.isFinite(x) ? x.toPrecision(3) : '-');
    console.log(`${c.name}: n=1 minus direct delay (M): median ${f(row.delay21_M.median)} [p10 ${f(row.delay21_M.p10)}, p90 ${f(row.delay21_M.p90)}], max ${f(row.delay21_M.max)} (${d21.length} px); `
      + `excess delay of crossing 1 (M): median ${f(row.excessDelay1_M.median)}, p99 ${f(row.excessDelay1_M.p99)}, max ${f(row.excessDelay1_M.max)}`);
  }
} finally { await v.close(); }
writeFileSync(join(outDir, 'delays.json'), JSON.stringify({ renderer: v.renderer, rows }, null, 1));
