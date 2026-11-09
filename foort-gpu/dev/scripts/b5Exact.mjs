// Stage 1B B5: exactness and speed of one exact speedup. Every scene of the quality-gate set it applies to is traced
// with the speedup off (A) and on (B), with the viewer's configuration (High), and the records are compared:
//  - termination-class agreement, escape-direction change (rad), crossing r (relative), dt (M), g (relative),
//    tail bins (relative), time-averaged disc emission (relative L1);
//  - all pixels, and the non-chaotic ones (chaos mask: A vs A at eps / 2, max steps doubled; termination class changes,
//    or an escape direction moving by more than 1e-3 rad). Float32 rounding changes are amplified in the chaotic
//    region, so exactness is judged on the non-chaotic pixels.
//  - timing: A/B/A/B/A/B, best of 3 each (wall time of the full trace, one level, adaptive tiles).
// Usage (from dev/): node scripts/b5Exact.mjs --feature g34|analytic|closed|closedVsAnalytic|reuse|compact|floor [--N 512] [--scenes a,b] [--no-timing]
// Output: dev/reports/b5/<feature>.json
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openViewer } from './gpuRunner.mjs';
import { decodeRecord, RECORD_FLOATS } from '../../js/gpu/traceConfig.js';
import { discIntensity } from '../../js/fluid/emission.js';
import { metricEntry } from '../../js/metrics/registry.js';
import { CLOSED_FORMS } from '../../js/metrics/closedForm.js';
import { GATE_CONFIGS, sceneSet } from './gateConfigs.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const feature = opt('--feature', 'g34');
const N = Number(opt('--N', 512));
const sceneFilter = opt('--scenes', '');
const timing = !args.includes('--no-timing');
const outDir = resolve(here, '../reports/b5');
mkdirSync(outDir, { recursive: true });

/** feature -> {applies(scene), A(view), B(view), trace options of B} */
const FEATURES = {
  g34: { applies: (s) => !!metricEntry(s.view.metric).g3equalsG4, A: (v) => ({ ...v, g34: false }), B: (v) => ({ ...v, g34: true }) },
  analytic: { applies: (s) => s.view.metric === 'kerr', A: (v) => ({ ...v, path: 'tabulated' }), B: (v) => ({ ...v, path: 'analytic' }) },
  // generated closed-form shaders (tools/codegen) vs the tables, and vs the hand-written Kerr shader
  closed: { applies: (s) => !!CLOSED_FORMS[s.view.metric], A: (v) => ({ ...v, path: 'tabulated' }), B: (v) => ({ ...v, path: 'closed' }) },
  closedVsAnalytic: { applies: (s) => s.view.metric === 'kerr', A: (v) => ({ ...v, path: 'analytic' }), B: (v) => ({ ...v, path: 'closed' }) },
  reuse: { applies: () => true, A: (v) => ({ ...v, texelReuse: false }), B: (v) => ({ ...v, texelReuse: true }) },
  compact: { applies: () => true, A: (v) => ({ ...v, compact: null }), B: (v) => ({ ...v, compact: { n1: Number(opt('--n1', 1500)) } }) },
  // the noise floor: the same trace with eps changed by 1e-6 (a perturbation far below any table or step error)
  floor: { applies: () => true, A: (v) => v, B: (v) => ({ ...v, eps: v.eps * (1 + 1e-6) }) },
};
const F = FEATURES[feature];
if (!F) throw new Error(`unknown feature ${feature}`);

const q = (xs, f) => { if (!xs.length) return NaN; const s = Float64Array.from(xs).sort(); return s[Math.min(s.length - 1, Math.floor(f * s.length))]; };
const ang = (a, b) => Math.acos(Math.min(1, Math.max(-1, Math.sin(a.theta) * Math.sin(b.theta) * Math.cos(a.phi - b.phi) + Math.cos(a.theta) * Math.cos(b.theta))));

/** compare records A, B on the pixel set `use` */
function compare(A, B, tailA, tailB, em, use) {
  let n = 0, same = 0, iA = 0, iD = 0, nE = 0, nE3 = 0;
  const da = [], dr = [], ddt = [], dg = [], dtail = [];
  for (let k = 0; k < N * N; k++) {
    if (!use(k)) continue;
    n++;
    const a = decodeRecord(A, k, tailA), b = decodeRecord(B, k, tailB);
    if (a.term === b.term) same++;
    if (a.term === 2 && b.term === 2) da.push(ang(a, b));
    const m = a.crossings.length === b.crossings.length ? a.crossings.length : 0;
    for (let j = 0; j < m; j++) {
      const x = a.crossings[j], y = b.crossings[j];
      dr.push(Math.abs(y.r - x.r) / x.r); ddt.push(Math.abs(y.dt - x.dt)); if (x.g > 0) dg.push(Math.abs(y.g - x.g) / x.g);
    }
    for (let j = 0; j < 8; j++) { const x = A[RECORD_FLOATS * k + 16 + j], y = B[RECORD_FLOATS * k + 16 + j]; if (x > 0) dtail.push(Math.abs(y - x) / x); }
    const IA = discIntensity(a.crossings, em, a.tail), IB = discIntensity(b.crossings, em, b.tail);
    iA += IA; iD += Math.abs(IA - IB);
    if (IA > 0 || IB > 0) { nE++; if (Math.abs(IA - IB) > 1e-3 * Math.max(IA, IB)) nE3++; }
  }
  const st = (xs) => ({ median: q(xs, 0.5), p99: q(xs, 0.99), max: xs.length ? xs.reduce((x, y) => Math.max(x, y), 0) : NaN });
  return { pixels: n, termAgreement: same / n, escapeRad: st(da), crossingRRel: st(dr), dtM: st(ddt), gRel: st(dg), tailRel: st(dtail), emissionRelL1: iA > 0 ? iD / iA : 0, emissionChanged1e3: nE ? nE3 / nE : 0 };
}

const v = await openViewer();
const rows = [];
try {
  for (const s of sceneSet().filter((x) => F.applies(x) && (!sceneFilter || sceneFilter.split(',').includes(x.name)))) {
    const view = { ...GATE_CONFIGS.high.apply(s), N };
    const vA = F.A(view), vB = F.B(view);
    const rA = await v.trace(vA, { levels: [1], adaptTiles: true });
    const rB = await v.trace(vB, { levels: [1], adaptTiles: true });
    const rH = await v.trace({ ...vA, eps: vA.eps / 2, maxSteps: 2 * vA.maxSteps }, { levels: [1], adaptTiles: true, measureSteps: false });
    const chaotic = new Uint8Array(N * N);
    for (let k = 0; k < N * N; k++) {
      const a = decodeRecord(rA.rec, k), h = decodeRecord(rH.rec, k);
      chaotic[k] = a.term !== h.term || (a.term === 2 && ang(a, h) > 1e-3) ? 1 : 0;
    }
    const all = compare(rA.rec, rB.rec, rA.tail, rB.tail, s.em, () => true);
    const nonChaotic = compare(rA.rec, rB.rec, rA.tail, rB.tail, s.em, (k) => !chaotic[k]);
    const row = { scene: s.name, N, programA: null, chaoticFraction: chaotic.reduce((x, y) => x + y, 0) / (N * N), all, nonChaotic, stepsA: rA.stats.steps, stepsB: rB.stats.steps };
    if (timing) {
      const tA = [], tB = [];
      for (let k = 0; k < 3; k++) {
        tA.push((await v.trace(vA, { levels: [1], adaptTiles: true, measureSteps: false, records: false })).stats.wallMs);
        tB.push((await v.trace(vB, { levels: [1], adaptTiles: true, measureSteps: false, records: false })).stats.wallMs);
      }
      row.timing = { A: Math.min(...tA), B: Math.min(...tB), speedup: Math.min(...tA) / Math.min(...tB), runsA: tA, runsB: tB };
    }
    rows.push(row);
    const e = (x) => (Number.isFinite(x) ? x.toExponential(1) : '-');
    const nc = row.nonChaotic;
    console.log(`${s.name}: chaotic ${(100 * row.chaoticFraction).toFixed(2)}%; non-chaotic: term ${(100 * nc.termAgreement).toFixed(4)}%, escape max ${e(nc.escapeRad.max)} rad, r p99/max ${e(nc.crossingRRel.p99)}/${e(nc.crossingRRel.max)}, `
      + `dt max ${e(nc.dtM.max)} M, g max ${e(nc.gRel.max)}, emission L1 ${e(nc.emissionRelL1)}, changed >1e-3 ${(100 * nc.emissionChanged1e3).toFixed(2)}%; all: term ${(100 * row.all.termAgreement).toFixed(3)}%, emission L1 ${e(row.all.emissionRelL1)}, changed >1e-3 ${(100 * row.all.emissionChanged1e3).toFixed(2)}%`
      + (row.timing ? `; ${row.timing.A.toFixed(0)} -> ${row.timing.B.toFixed(0)} ms (${row.timing.speedup.toFixed(2)}x)` : ''));
  }
  const renderer = v.renderer;
  writeFileSync(join(outDir, `${feature}.json`), JSON.stringify({ feature, N, renderer, date: new Date().toISOString(), rows }, null, 1));
} finally { await v.close(); }
