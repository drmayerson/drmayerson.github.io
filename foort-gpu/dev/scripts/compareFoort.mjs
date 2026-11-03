// Level-1 comparison: CPU reference vs FOORT for one M2 case and mode.
// Usage (from dev/): node scripts/compareFoort.mjs <case> [--mode parity|app]
// Writes dev/reports/m2/<case>_<mode>.json and a side-by-side PNG
//   [FOORT four-colour | CPU four-colour | disagreement | FOORT passes | CPU passes].
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CASES } from './foortCases.mjs';
import { readFoortRun } from './foortDat.mjs';
import { writePng } from './png.mjs';
import { fourColorQuadrant, TERM } from '../../js/ref/cpuTracer.js';
import { traceOptions } from './runCpuRef.mjs';

const here = dirname(fileURLToPath(import.meta.url));

/** @param {string} name @param {string} mode */
export function compareCase(name, mode) {
  const c = CASES.find((x) => x.name === name);
  const runDir = resolve(here, '../../tools/foort_parity/build/runs', name);
  const foort = readFoortRun(runDir, name);
  const cpu = JSON.parse(readFileSync(join(runDir, `cpu_${mode}.json`), 'utf8'));
  const rTerm = traceOptions(c, mode).rTerm;
  const cat = (/** @type {string} */ kind, x) => {
    if (kind === 'foort') return x.quadrant > 0 ? 'escape' : x.r < rTerm * (1 + 1e-9) ? 'horizon' : 'other';
    return x.term === TERM.boundary ? 'escape' : x.term === TERM.horizon ? 'horizon' : 'other';
  };
  /** @type {Record<string, number>} */
  const confusion = {};
  let same4 = 0, samePasses = 0, n = 0;
  const ang = [];
  const map = new Map();
  for (const res of cpu.results) {
    const f = foort.pixels.get(`${res.i},${res.j}`);
    if (!f) continue;
    n++;
    const q = fourColorQuadrant(res);
    const fc = cat('foort', f), cc = cat('cpu', res);
    confusion[`${fc}->${cc}`] = (confusion[`${fc}->${cc}`] ?? 0) + 1;
    const ok4 = q === f.quadrant;
    if (ok4) same4++;
    const okP = Math.abs(f.passes) === res.passes;
    if (okP) samePasses++;
    if (fc === 'escape' && cc === 'escape') {
      const cs = Math.sin(f.theta) * Math.sin(res.theta) * Math.cos(f.phi - res.phi) + Math.cos(f.theta) * Math.cos(res.theta);
      ang.push(Math.acos(Math.min(1, Math.max(-1, cs))));
    }
    map.set(`${res.i},${res.j}`, { q, fq: f.quadrant, ok4, okP, fp: Math.abs(f.passes), cp: res.passes });
  }
  ang.sort((a, b) => a - b);
  const pct = (p) => (ang.length ? ang[Math.min(ang.length - 1, Math.floor(p * ang.length))] : NaN);
  const stats = {
    case: name, mode, pixels: n, stride: cpu.stride, cpuSeconds: cpu.seconds,
    fourColorAgreement: same4 / n, fourColorMismatches: n - same4,
    passesAgreement: samePasses / n, passesMismatches: n - samePasses,
    escapeAngle: { median: pct(0.5), p90: pct(0.9), p99: pct(0.99), max: ang[ang.length - 1] ?? NaN, count: ang.length },
    confusion,
    meanSteps: cpu.results.reduce((s, r) => s + r.steps, 0) / cpu.results.length,
    // relative constraint |H| / sum|terms| at the end of escaping rays (captured rays end at a coordinate singularity)
    hEscape: (() => { const h = cpu.results.filter((r) => r.term === TERM.boundary).map((r) => r.H).sort((a, b) => a - b);
      return { median: h[h.length >> 1] ?? NaN, max: h[h.length - 1] ?? NaN }; })(),
  };

  // image
  const s = cpu.stride, M = Math.ceil(c.N / s), Z = 2, gap = 4, panels = 5;
  const W = panels * M * Z + (panels - 1) * gap, H = M * Z;
  const QC = [[0, 0, 0], [228, 74, 64], [64, 156, 228], [240, 200, 60], [90, 190, 110]];
  const PC = (p) => (p <= 0 ? [25, 25, 30] : p === 1 ? [200, 80, 40] : p === 2 ? [240, 200, 60] : [255, 255, 255]);
  writePng(join(mkdirOut(), `${name}_${mode}.png`), W, H, (x, y) => {
    const panel = Math.floor(x / (M * Z + gap)), xx = x - panel * (M * Z + gap);
    if (xx >= M * Z) return [255, 255, 255];
    const i = Math.floor(xx / Z) * s, j = (M - 1 - Math.floor(y / Z)) * s;
    const e = map.get(`${i},${j}`);
    if (!e) return [128, 128, 128];
    if (panel === 0) return QC[e.fq] ?? [255, 0, 255];
    if (panel === 1) return QC[e.q] ?? [255, 0, 255];
    if (panel === 2) return !e.ok4 ? [255, 40, 40] : !e.okP ? [255, 220, 0] : [30, 30, 30];
    if (panel === 3) return PC(e.fp);
    return PC(e.cp);
  });
  writeFileSync(join(mkdirOut(), `${name}_${mode}.json`), JSON.stringify(stats, null, 1));
  return stats;
}

function mkdirOut() { const d = resolve(here, '../reports/m2'); mkdirSync(d, { recursive: true }); return d; }

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  const i = args.indexOf('--mode');
  const mode = i >= 0 ? args[i + 1] : 'parity';
  const st = compareCase(args[0], mode);
  const e = (x) => (Number.isFinite(x) ? x.toExponential(2) : '—');
  console.log(`${st.case} [${mode}] n=${st.pixels}: four-colour ${(100 * st.fourColorAgreement).toFixed(3)}% (${st.fourColorMismatches} px), passes ${(100 * st.passesAgreement).toFixed(3)}% (${st.passesMismatches} px), escape angle median ${e(st.escapeAngle.median)} p99 ${e(st.escapeAngle.p99)} max ${e(st.escapeAngle.max)}, steps/ray ${st.meanSteps.toFixed(0)}, |H|/sum (escaping) median ${e(st.hEscape.median)} max ${e(st.hEscape.max)}`);
  console.log('  categories FOORT->CPU:', JSON.stringify(st.confusion));
}
