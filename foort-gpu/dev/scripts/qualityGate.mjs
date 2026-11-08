// Stage 1B quality gate (plan Section 1.2): compares a tracing configuration against Reference on a fixed scene set.
//
// Reference: the Stage 1 integrator without accuracy trades (eps 0.03, no larger far steps, max steps 5000 BH /
// 10000 fuzzball). The chaos mask is Reference vs Reference at eps / 2 (max steps doubled): pixels whose termination
// class changes, or whose sky position moves by more than 1 px. Per-pixel budgets exclude them; on them only the
// distribution-level measures apply (total emission, fractions of escaped / trapped / singular rays).
//
// Measures (non-chaotic pixels unless stated):
//  - disc emission, time-averaged (sigma_n = 0) and at 3 observer times with the noise field (slow light, sigma_n = 1):
//    relative L1, per-pixel relative error p99 (pixels brighter than 1e-3 of the image's 99.5th percentile), total flux
//    (all pixels);
//  - delays dt at matched crossings: error p99 in M;
//  - light curve over one noise period (32 samples, all pixels): correlation and relative RMS difference;
//  - sky position error in image-plane pixels: the escape-direction change mapped through the inverse of the local
//    Jacobian d(direction)/d(pixel), estimated by finite differences on the Reference record;
//  - termination-class agreement;
//  - chaotic region: total emission there, fractions of escaped / trapped (inner cut or horizon) / singular / timed-out rays;
//  - timing: GPU time, Reference and configuration alternating A/B/A/B, best of 3 (the iGPU varies 2-3x between runs).
// Budgets (Normal tier, Section 1.2) are checked and reported; other tiers are reported without a verdict.
//
// Usage (from dev/): node scripts/qualityGate.mjs --config high [--N 512] [--scenes a,b] [--no-timing] [--recompute]
// Output: dev/reports/b0/gate_<config>.json and .md. Reference records are cached in tools/foort_parity/build/gate/,
// keyed by a hash of the tracer sources (a code change invalidates them).
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openViewer } from './gpuRunner.mjs';
import { decodeRecord } from '../../js/gpu/traceConfig.js';
import { discIntensity } from '../../js/fluid/emission.js';
import { johnsonSU } from '../../js/fluid/generalCircularRadial.js';
import { createMetric } from '../../js/metrics/registry.js';
import { parseNoiseField, sampleNoise } from '../../js/noise/noiseField.js';
import { GATE_CONFIGS, sceneSet } from './gateConfigs.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const configName = opt('--config', 'high');
const N = Number(opt('--N', 512));
const sceneFilter = opt('--scenes', '');
const timing = !args.includes('--no-timing');
const recompute = args.includes('--recompute');
const outDir = resolve(here, '../reports/b0');
const cacheDir = resolve(root, 'tools/foort_parity/build/gate');
mkdirSync(outDir, { recursive: true }); mkdirSync(cacheDir, { recursive: true });
const config = GATE_CONFIGS[configName];
if (!config) throw new Error(`unknown config ${configName} (${Object.keys(GATE_CONFIGS).join(', ')})`);

// code version of the tracer: hash of everything a trace depends on
const codeHash = (() => {
  const h = createHash('sha1');
  for (const dir of ['shaders/glsl', 'js/gpu', 'js/metrics', 'js/bake', 'js/fluid', 'js/camera']) {
    for (const f of readdirSync(join(root, dir)).sort()) if (/\.(glsl|js)$/.test(f)) h.update(readFileSync(join(root, dir, f)));
  }
  return h.digest('hex').slice(0, 12);
})();

// noise field for the noisy frames (the viewer's default)
const noiseMeta = JSON.parse(readFileSync(join(root, 'noise/inoisy_lg21.json'), 'utf8'));
const nb = readFileSync(join(root, 'noise/inoisy_lg21.bin'));
const noise = parseNoiseField(noiseMeta, nb.buffer.slice(nb.byteOffset, nb.byteOffset + nb.byteLength));
const T = noiseMeta.T_over_M, SIGMA_N = 1;

const quantile = (xs, f) => { if (!xs.length) return NaN; const s = Float64Array.from(xs).sort(); return s[Math.min(s.length - 1, Math.floor(f * s.length))]; };
const TERM_CLASS = (t) => (t === 2 ? 'escaped' : t === 1 ? 'trapped' : t === 6 ? 'singular' : t === 3 ? 'timeout' : 'other');

/** per-pixel intensity of a decoded record: time-averaged (tau = null) or at observer time tau (units of M) with noise */
function intensity(d, em, M, tau) {
  if (tau === null) return discIntensity(d.crossings, em, d.tail);
  let I = 0;
  d.crossings.forEach((c, k) => {
    if (em.maxPasses > 0 && k + 1 > em.maxPasses) return;
    if (!(c.g > 0) || !(c.r > 0)) return;
    const X = sampleNoise(noise, tau + c.dt / M, Math.log(c.r / M), c.phi);
    I += (k === 0 ? 1 : em.fudge) * c.g ** em.redshiftPower * johnsonSU(c.r, em) * Math.exp(SIGMA_N * X - 0.5 * SIGMA_N * SIGMA_N);
  });
  // the binned tail is drawn without noise (its fluctuations average out; plan 3.2)
  if (d.tail) I += discIntensity([], em, d.tail);
  return I;
}

/** escape direction in tangent coordinates about (th0, ph0) */
const tangent = (th, ph, th0, ph0) => {
  let dph = ph - ph0; if (dph > Math.PI) dph -= 2 * Math.PI; if (dph < -Math.PI) dph += 2 * Math.PI;
  return [dph * Math.sin(th0), th - th0];
};
/** image-plane displacement (px) of the sky point of pixel k when its direction moves from A to B (Jacobian from A) */
function skyPx(A, k, b) {
  const a = A[k];
  if (a.term !== 2 || b.term !== 2) return NaN;
  const i = k % N, j = Math.floor(k / N);
  const nb = (di, dj) => { const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= N || jj >= N) return null; const q = A[jj * N + ii]; return q.term === 2 ? q : null; };
  const col = (p, m) => {
    if (p && m) { const tp = tangent(p.theta, p.phi, a.theta, a.phi), tm = tangent(m.theta, m.phi, a.theta, a.phi); return [(tp[0] - tm[0]) / 2, (tp[1] - tm[1]) / 2]; }
    if (p) return tangent(p.theta, p.phi, a.theta, a.phi);
    if (m) { const tm = tangent(m.theta, m.phi, a.theta, a.phi); return [-tm[0], -tm[1]]; }
    return null;
  };
  const ci = col(nb(1, 0), nb(-1, 0)), cj = col(nb(0, 1), nb(0, -1));
  if (!ci || !cj) return NaN;
  const det = ci[0] * cj[1] - cj[0] * ci[1];
  if (!(Math.abs(det) > 1e-30)) return NaN;
  const d = tangent(b.theta, b.phi, a.theta, a.phi);
  const x = (d[0] * cj[1] - cj[0] * d[1]) / det, y = (ci[0] * d[1] - d[0] * ci[1]) / det;
  return Math.hypot(x, y);
}

const viewer = await openViewer();
const base = viewer.page.url().replace(/index\.html.*$/, 'index.html');
await viewer.page.goto(`${base}?N=128&play=0`);   // paused: no animation frames during traces
await viewer.page.waitForFunction(() => window.__foort && /done/.test(document.getElementById('status').textContent), null, { timeout: 60_000 });
const trace = async (view) => (await viewer.trace({ ...view, N }, { levels: [1], adaptTiles: true })).rec;
const gpuTime = (view, n) => viewer.page.evaluate(([v, nn]) => window.__foort.trace({ ...v, N: nn }, { levels: [1], adaptTiles: true, measureSteps: false, records: false }).then((r) => r.stats.gpuMs ?? r.stats.wallMs), [view, n]);
const cached = async (name, view) => {
  const f = join(cacheDir, `${name}_N${N}_${codeHash}.bin`);
  if (!recompute && existsSync(f)) { const b = readFileSync(f); return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4); }
  const rec = await trace(view);
  writeFileSync(f, Buffer.from(rec.buffer, rec.byteOffset, rec.byteLength));
  return rec;
};

const rows = [];
try {
  for (const s of sceneSet()) {
    if (sceneFilter && !sceneFilter.split(',').includes(s.name)) continue;
    const M = createMetric(s.view.metric, s.view.metricParams).massADM;
    const ref = GATE_CONFIGS.reference.apply(s);
    const refHalf = { ...ref, eps: ref.eps / 2, maxSteps: 2 * ref.maxSteps };
    const cfg = config.apply(s);
    const t0 = Date.now();
    const recA = await cached(`${s.name}_ref`, ref), recH = await cached(`${s.name}_refhalf`, refHalf);
    const recC = configName === 'reference' ? recA : await trace(cfg);
    const A = Array.from({ length: N * N }, (_, k) => decodeRecord(recA, k));
    const H = Array.from({ length: N * N }, (_, k) => decodeRecord(recH, k));
    const C = Array.from({ length: N * N }, (_, k) => decodeRecord(recC, k));
    // chaos mask
    const chaos = new Uint8Array(N * N);
    for (let k = 0; k < N * N; k++) {
      if (TERM_CLASS(A[k].term) !== TERM_CLASS(H[k].term)) chaos[k] = 1;
      else if (A[k].term === 2 && skyPx(A, k, H[k]) > 1) chaos[k] = 1;
    }
    const nChaos = chaos.reduce((a, b) => a + b, 0);
    // termination class and sky position (non-chaotic)
    let sameClass = 0, nonChaos = 0;
    const sky = [], dterr = [];
    for (let k = 0; k < N * N; k++) {
      if (chaos[k]) continue;
      nonChaos++;
      if (TERM_CLASS(A[k].term) === TERM_CLASS(C[k].term)) sameClass++;
      const p = skyPx(A, k, C[k]);
      if (Number.isFinite(p)) sky.push(p);
      const n = Math.min(A[k].crossings.length, C[k].crossings.length);
      for (let c = 0; c < n; c++) dterr.push(Math.abs(A[k].crossings[c].dt - C[k].crossings[c].dt) / M);
    }
    // emission: time-averaged and 3 noisy frames
    const em = s.em;
    const frames = [null, 0, T / 3, (2 * T) / 3];
    const emis = frames.map((tau) => {
      const IA = new Float64Array(N * N), IC = new Float64Array(N * N);
      for (let k = 0; k < N * N; k++) { IA[k] = intensity(A[k], em, M, tau); IC[k] = intensity(C[k], em, M, tau); }
      const top = quantile(Array.from(IA), 0.995), floor = 1e-3 * top;
      let sA = 0, sD = 0, totA = 0, totC = 0, chA = 0, chC = 0;
      const rel = [];
      for (let k = 0; k < N * N; k++) {
        totA += IA[k]; totC += IC[k];
        if (chaos[k]) { chA += IA[k]; chC += IC[k]; continue; }
        sA += IA[k]; sD += Math.abs(IA[k] - IC[k]);
        if (IA[k] > floor) rel.push(Math.abs(IA[k] - IC[k]) / IA[k]);
      }
      return { tau, relL1: sA > 0 ? sD / sA : 0, relP99: quantile(rel, 0.99), fluxRel: totA > 0 ? (totC - totA) / totA : 0, chaoticFluxRel: chA > 0 ? (chC - chA) / chA : 0 };
    });
    // light curve over one period (32 samples), all pixels
    const lc = (P) => Array.from({ length: 32 }, (_, n) => { let f = 0; for (let k = 0; k < N * N; k++) if (P[k].crossings.length || P[k].tail) f += intensity(P[k], em, M, (n * T) / 32); return f; });
    const la = lc(A), lcC = lc(C);
    const mean = (x) => x.reduce((a, b) => a + b, 0) / x.length;
    const ma = mean(la), mc = mean(lcC);
    let sab = 0, saa = 0, scc = 0, sd2 = 0;
    for (let n = 0; n < 32; n++) { sab += (la[n] - ma) * (lcC[n] - mc); saa += (la[n] - ma) ** 2; scc += (lcC[n] - mc) ** 2; sd2 += (la[n] - lcC[n]) ** 2; }
    const corr = saa > 0 && scc > 0 ? sab / Math.sqrt(saa * scc) : 1;
    // chaotic-region class fractions
    const fr = (P) => { const c = { escaped: 0, trapped: 0, singular: 0, timeout: 0, other: 0 }; let n = 0; for (let k = 0; k < N * N; k++) if (chaos[k]) { c[TERM_CLASS(P[k].term)]++; n++; } for (const key in c) c[key] = n ? c[key] / n : 0; return c; };
    const frA = fr(A), frC = fr(C);
    const maxFracDiff = Math.max(...Object.keys(frA).map((key) => Math.abs(frA[key] - frC[key])));
    // timing (alternating)
    let speed = null;
    if (timing && configName !== 'reference') {
      const tN = s.view.metric.startsWith('st3cr') ? 256 : 512;
      await gpuTime(ref, tN); await gpuTime(cfg, tN);
      const ta = [], tc = [];
      for (let r = 0; r < 3; r++) { ta.push(await gpuTime(ref, tN)); tc.push(await gpuTime(cfg, tN)); }
      speed = { N: tN, referenceMs: Math.min(...ta), configMs: Math.min(...tc), speedup: Math.min(...ta) / Math.min(...tc) };
    }
    const row = {
      scene: s.name, N, chaosFraction: nChaos / (N * N), classAgreement: sameClass / nonChaos,
      sky: { medianPx: quantile(sky, 0.5), p99Px: quantile(sky, 0.99), maxPx: sky.length ? sky.reduce((a, b) => (b > a ? b : a), 0) : NaN },
      dtP99M: quantile(dterr, 0.99), emission: emis, lightCurve: { correlation: corr, relRMS: Math.sqrt(sd2 / 32) / Math.abs(ma || 1) },
      chaotic: { pixels: nChaos, fluxRel: emis[0].chaoticFluxRel, maxClassFractionDiff: maxFracDiff, reference: frA, config: frC }, speed, seconds: (Date.now() - t0) / 1000,
    };
    // Normal budgets
    const worst = (f) => Math.max(...emis.map(f));
    row.budget = {
      emissionL1: worst((e) => e.relL1) <= 3e-3, emissionP99: worst((e) => (Number.isFinite(e.relP99) ? e.relP99 : 0)) <= 0.02,
      flux: worst((e) => Math.abs(e.fluxRel)) <= 2e-3, dt: !(row.dtP99M > 0.5), lightCurve: corr >= 0.999, classAgreement: row.classAgreement >= 0.998,
      // the chaotic-region measures need a region: from 100 chaotic pixels up
      chaoticFlux: nChaos < 100 || Math.abs(row.chaotic.fluxRel) <= 0.02, chaoticFractions: nChaos < 100 || maxFracDiff <= 0.01,
    };
    rows.push(row);
    const e = (x) => (Number.isFinite(x) ? x.toExponential(1) : '-');
    console.log(`${s.name}: chaos ${(100 * row.chaosFraction).toFixed(2)}%, class ${(100 * row.classAgreement).toFixed(3)}%, sky px median/p99 ${e(row.sky.medianPx)}/${e(row.sky.p99Px)}, `
      + `emission L1 ${emis.map((x) => e(x.relL1)).join('/')}, p99 ${emis.map((x) => e(x.relP99)).join('/')}, flux ${emis.map((x) => e(x.fluxRel)).join('/')}, dt p99 ${e(row.dtP99M)} M, `
      + `LC corr ${corr.toFixed(6)}, chaotic flux ${e(row.chaotic.fluxRel)}, class-fraction diff ${e(maxFracDiff)}${speed ? `, speed-up ${speed.speedup.toFixed(2)}x` : ''} (${row.seconds.toFixed(0)} s)`);
  }
} finally { await viewer.close(); }

const report = { config: configName, description: config.description, N, codeHash, renderer: viewer.renderer, date: new Date().toISOString(), rows };
writeFileSync(join(outDir, `gate_${configName}.json`), JSON.stringify(report, null, 1));
// markdown summary
const e = (x) => (Number.isFinite(x) ? x.toExponential(1) : '—');
const md = [`# Quality gate: ${configName} vs Reference (${N}², code ${codeHash})`, '', config.description, '',
  '| scene | chaos | class agr. | sky px med / p99 | emission L1 (avg / t₀ / t₁ / t₂) | p99 rel (worst) | flux (worst) | dt p99 (M) | LC corr | chaotic flux | class-frac Δ | speed-up |',
  '|---|---|---|---|---|---|---|---|---|---|---|---|',
  ...rows.map((r) => `| ${r.scene} | ${(100 * r.chaosFraction).toFixed(2)}% | ${(100 * r.classAgreement).toFixed(3)}% | ${e(r.sky.medianPx)} / ${e(r.sky.p99Px)} | ${r.emission.map((x) => e(x.relL1)).join(' / ')} | ${e(Math.max(...r.emission.map((x) => x.relP99 || 0)))} | ${e(Math.max(...r.emission.map((x) => Math.abs(x.fluxRel))))} | ${e(r.dtP99M)} | ${r.lightCurve.correlation.toFixed(6)} | ${e(r.chaotic.fluxRel)} | ${e(r.chaotic.maxClassFractionDiff)} | ${r.speed ? r.speed.speedup.toFixed(2) + '×' : '—'} |`),
  '', 'Normal budgets passed per scene: ' + rows.map((r) => `${r.scene}: ${Object.entries(r.budget).filter(([, v]) => !v).map(([k]) => k).join(', ') || 'all'}`).join('; ')].join('\n');
writeFileSync(join(outDir, `gate_${configName}.md`), md + '\n');
console.log(`wrote dev/reports/b0/gate_${configName}.json/.md`);
