// M9 accuracy trades, each measured on its own against the baseline (the app as committed):
//   half     half-float derivative channels in the metric tables (tableHalf)
//   far4     larger steps at large r: eps * clamp(r / 20 M, 1, 4) (farSteps)
//   far8     the same with up to 8x
//   steps5k  fuzzball max steps 5000 instead of 10000
// Speed: GPU time of one full-resolution level (no tiling or levels), baseline and trade alternating, best of the runs.
// Accuracy: the trade's GPU image against the baseline's on the same views: four-colour agreement, escape directions,
// disc emission (relative L1), captured fraction (shadow size); the baseline itself is validated against the CPU reference
// and FOORT in M3-M6.
// Usage (from dev/): node scripts/m9Trades.mjs [trade ...] [--N 256]  -> dev/reports/m9/trades.json
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openViewer } from './gpuRunner.mjs';
import { decodeRecord } from '../../js/gpu/traceConfig.js';
import { discIntensity } from '../../js/fluid/emission.js';

const args = process.argv.slice(2);
const N = args.includes('--N') ? Number(args[args.indexOf('--N') + 1]) : 256;
const only = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--N');
const outDir = resolve(dirname(fileURLToPath(import.meta.url)), '../reports/m9');
mkdirSync(outDir, { recursive: true });
const DEG = Math.PI / 180;
const kerrEm = { mu: 2.02, gamma: -2, sigma: 0.5, redshiftPower: 3, fudge: 1, maxPasses: 0 };
const fbEm = { mu: 0, gamma: -1.5, sigma: 2 / 24, redshiftPower: 3, fudge: 1, maxPasses: 0 };   // units of M (B1)
const fbCam = { r: 250 / 24, theta: 1.5, screen: 150 / 24 };
const BH_VIEWS = [
  { name: 'kerr_a0.94_inc17', view: { metric: 'kerr', metricParams: { a: 0.94 }, camera: { r: 1000, theta: 0.2967, screen: 15 } }, em: kerrEm },
  { name: 'kerr_a0.94_inc80', view: { metric: 'kerr', metricParams: { a: 0.94 }, camera: { r: 1000, theta: 80 * DEG, screen: 15 } }, em: kerrEm },
  { name: 'johannsen_a0.94_a13_5.5', view: { metric: 'johannsen', metricParams: { a: 0.94, alpha13: 5.5 }, camera: { r: 1000, theta: 0.2967, screen: 15 } }, em: kerrEm },
  { name: 'mankoNovikov_a0.94_a3_2', view: { metric: 'mankoNovikov', metricParams: { a: 0.94, alpha3: 2 }, camera: { r: 1000, theta: 0.523599, screen: 15 } }, em: kerrEm },
];
const FB_VIEWS = [
  { name: 'st3cr_l0.005', view: { metric: 'st3cr', metricParams: { lambda: 0.005 }, camera: fbCam, maxSteps: 10000 }, em: fbEm },
  { name: 'st3cr_l1e-3', view: { metric: 'st3cr', metricParams: { lambda: 1e-3 }, camera: fbCam, maxSteps: 10000 }, em: fbEm },
  { name: 'st3cr_l1e-4', view: { metric: 'st3cr', metricParams: { lambda: 1e-4 }, camera: fbCam, maxSteps: 10000 }, em: fbEm },
];
const TRADES = {
  half: { change: { tableHalf: true }, views: [...BH_VIEWS, ...FB_VIEWS.slice(0, 2)] },
  far4: { change: { farSteps: { r: 20, max: 4 } }, views: [...BH_VIEWS, ...FB_VIEWS.slice(0, 2)] },
  far8: { change: { farSteps: { r: 20, max: 8 } }, views: [...BH_VIEWS, ...FB_VIEWS.slice(0, 2)] },
  steps5k: { change: { maxSteps: 5000 }, views: FB_VIEWS },
};
const quad = (d) => (d.term !== 2 ? 0 : d.theta < Math.PI / 2 ? (d.phi < Math.PI ? 1 : 2) : (d.phi < Math.PI ? 3 : 4));
const angle = (a, b) => Math.acos(Math.min(1, Math.max(-1, Math.sin(a.theta) * Math.sin(b.theta) * Math.cos(a.phi - b.phi) + Math.cos(a.theta) * Math.cos(b.theta))));
const q = (xs, f) => { if (!xs.length) return NaN; const s = Float64Array.from(xs).sort(); return s[Math.min(s.length - 1, Math.floor(f * s.length))]; };

const v = await openViewer();
// a paused viewer page: no animation frames during the traces
const base = v.page.url().replace(/index\.html.*$/, 'index.html');
await v.page.goto(`${base}?N=128&play=0`);
await v.page.waitForFunction(() => window.__foort && /done/.test(document.getElementById('status').textContent), null, { timeout: 60_000 });
const trace = (view) => v.trace({ ...view, fluid: { xi: 1, betaR: 1, betaPhi: 1 } }, { levels: [1] });
const timeIt = (view) => v.page.evaluate((vw) => window.__foort.trace(vw, { levels: [1], adaptTiles: false, measureSteps: true, records: false }).then((r) => r.stats), { ...view, fluid: { xi: 1, betaR: 1, betaPhi: 1 } });
const rows = [];
try {
  for (const [tname, T] of Object.entries(TRADES)) {
    if (only.length && !only.includes(tname)) continue;
    for (const c of T.views) {
      const bView = { ...c.view, N }, tView = { ...c.view, ...T.change, N };
      // accuracy
      const A = await trace(bView), B = await trace(tView);
      let same = 0, capA = 0, capB = 0, iA = 0, iD = 0;
      const ang = [];
      for (let k = 0; k < N * N; k++) {
        const a = decodeRecord(A.rec, k), b = decodeRecord(B.rec, k);
        if (quad(a) === quad(b)) same++;
        if (a.term === 1) capA++;
        if (b.term === 1) capB++;
        if (a.term === 2 && b.term === 2) ang.push(angle(a, b));
        const IA = discIntensity(a.crossings, c.em), IB = discIntensity(b.crossings, c.em);
        iA += IA; iD += Math.abs(IA - IB);
      }
      // speed: one level of a larger image (BH 512^2, fuzzball 256^2), alternating, best of 3 each
      const sN = c.view.metric === 'st3cr' ? 256 : 512;
      const tb = [], tt = [];
      let steps = [0, 0];
      await timeIt({ ...bView, N: sN }); await timeIt({ ...tView, N: sN });   // warm-up (compile, bake)
      for (let k = 0; k < 3; k++) {
        const sb = await timeIt({ ...bView, N: sN }), st = await timeIt({ ...tView, N: sN });
        tb.push(sb.gpuMs); tt.push(st.gpuMs); steps = [sb.steps / sN / sN, st.steps / sN / sN];
      }
      const row = { trade: tname, view: c.name, N, fourColorAgreement: same / (N * N), escape: { n: ang.length, median: q(ang, 0.5), p99: q(ang, 0.99), within1e3: ang.filter((x) => x <= 1e-3).length / ang.length },
        capturedRatio: capA ? capB / capA : NaN, emissionRelL1: iA > 0 ? iD / iA : NaN,
        speed: { N: sN, baselineMs: Math.min(...tb), tradeMs: Math.min(...tt), speedup: Math.min(...tb) / Math.min(...tt), stepsPerRay: steps } };
      rows.push(row);
      const e = (x) => (Number.isFinite(x) ? x.toExponential(1) : '-');
      console.log(`${tname} ${c.name}: speed-up ${row.speed.speedup.toFixed(2)}x (${row.speed.baselineMs.toFixed(0)} -> ${row.speed.tradeMs.toFixed(0)} ms, steps ${steps[0].toFixed(0)} -> ${steps[1].toFixed(0)}); `
        + `four-colour ${(100 * row.fourColorAgreement).toFixed(3)}%, escape median/p99 ${e(row.escape.median)}/${e(row.escape.p99)} rad (${(100 * row.escape.within1e3).toFixed(3)}% within 1e-3), `
        + `emission L1 ${e(row.emissionRelL1)}, captured ratio ${row.capturedRatio.toFixed(5)}`);
    }
  }
} finally { await v.close(); }
writeFileSync(join(outDir, `trades${only.length ? '_' + only.join('_') : ''}.json`), JSON.stringify({ renderer: v.renderer, rows }, null, 1));
