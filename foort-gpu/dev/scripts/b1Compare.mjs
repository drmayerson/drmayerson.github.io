// Stage 1B B1: the fuzzball in units of M against the raw-coordinate fuzzball (images unchanged up to float32 noise).
// The raw Reference records come from the B0 quality-gate cache (traced before the rescaling, code hash given);
// the same scenes are traced now with the registry's rescaled ST3Cr. Compared: termination class, escape direction,
// crossing radii r / 24 and delays dt / 24, redshifts, and the disc emission (the rescaled J is 24x larger).
// Usage (from dev/): node scripts/b1Compare.mjs --hash c3fb395af5bd [--N 512]  -> dev/reports/b1/compare.json
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openViewer } from './gpuRunner.mjs';
import { decodeRecord } from '../../js/gpu/traceConfig.js';
import { discIntensity } from '../../js/fluid/emission.js';
import { GATE_CONFIGS, sceneSet } from './gateConfigs.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const hash = args[args.indexOf('--hash') + 1];
const N = args.includes('--N') ? Number(args[args.indexOf('--N') + 1]) : 512;
const L = 24;
const outDir = resolve(here, '../reports/b1');
mkdirSync(outDir, { recursive: true });
const q = (xs, f) => { if (!xs.length) return NaN; const s = Float64Array.from(xs).sort(); return s[Math.min(s.length - 1, Math.floor(f * s.length))]; };
const ang = (a, b) => Math.acos(Math.min(1, Math.max(-1, Math.sin(a.theta) * Math.sin(b.theta) * Math.cos(a.phi - b.phi) + Math.cos(a.theta) * Math.cos(b.theta))));

const v = await openViewer();
const base = v.page.url().replace(/index\.html.*$/, 'index.html');
await v.page.goto(`${base}?N=128&play=0`);
await v.page.waitForFunction(() => window.__foort && /done/.test(document.getElementById('status').textContent), null, { timeout: 60_000 });
const rows = [];
try {
  for (const s of sceneSet().filter((x) => x.fuzzball)) {
    const b = readFileSync(resolve(here, `../../tools/foort_parity/build/gate/${s.name}_ref_N${N}_${hash}.bin`));
    const raw = new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
    const bh = readFileSync(resolve(here, `../../tools/foort_parity/build/gate/${s.name}_refhalf_N${N}_${hash}.bin`));
    const half = new Float32Array(bh.buffer, bh.byteOffset, bh.byteLength / 4);
    const now = (await v.trace({ ...GATE_CONFIGS.reference.apply(s), N }, { levels: [1], adaptTiles: true })).rec;
    let same = 0, nI = 0;
    const da = [], dr = [], ddt = [], dg = [];
    let iR = 0, iD = 0, iRc = 0, iDc = 0, sameNC = 0, nNC = 0;
    const emRaw = { ...s.em, mu: s.em.mu * L, sigma: s.em.sigma * L };   // the scene's emission is in units of M now
    for (let k = 0; k < N * N; k++) {
      const a = decodeRecord(raw, k), c = decodeRecord(now, k);
      if (a.term === c.term) same++;
      if (a.term === 2 && c.term === 2) da.push(ang(a, c));
      const n = Math.min(a.crossings.length, c.crossings.length);
      for (let j = 0; j < n; j++) {
        const x = a.crossings[j], y = c.crossings[j];
        dr.push(Math.abs(y.r - x.r / L) / (x.r / L)); ddt.push(Math.abs(y.dt - x.dt / L)); dg.push(Math.abs(y.g - x.g) / x.g);
      }
      const IA = discIntensity(a.crossings, emRaw), IC = discIntensity(c.crossings, s.em) / L;
      iR += IA; iD += Math.abs(IA - IC); if (IA > 0) nI++;
      // B0 chaos mask: the raw Reference's termination changes with the step (eps vs eps / 2)
      const chaotic = decodeRecord(half, k).term !== a.term;
      if (!chaotic) { nNC++; if (a.term === c.term) sameNC++; iRc += IA; iDc += Math.abs(IA - IC); }
    }
    const row = { scene: s.name, N, termAgreement: same / (N * N), escape: { median: q(da, 0.5), p99: q(da, 0.99) }, crossingR: { median: q(dr, 0.5), p99: q(dr, 0.99) },
      dtM: { median: q(ddt, 0.5), p99: q(ddt, 0.99) }, g: { median: q(dg, 0.5), p99: q(dg, 0.99) }, emissionRelL1: iD / iR,
      nonChaotic: { fraction: nNC / (N * N), termAgreement: sameNC / nNC, emissionRelL1: iDc / iRc } };
    rows.push(row);
    const e = (x) => (Number.isFinite(x) ? x.toExponential(1) : '-');
    console.log(`${s.name}: termination ${(100 * row.termAgreement).toFixed(3)}%, escape median/p99 ${e(row.escape.median)}/${e(row.escape.p99)} rad, `
      + `r ${e(row.crossingR.median)}/${e(row.crossingR.p99)}, dt ${e(row.dtM.median)}/${e(row.dtM.p99)} M, g ${e(row.g.median)}/${e(row.g.p99)}, emission L1 ${e(row.emissionRelL1)}; non-chaotic: termination ${(100 * row.nonChaotic.termAgreement).toFixed(3)}%, emission L1 ${e(row.nonChaotic.emissionRelL1)}`);
  }
} finally { await v.close(); }
writeFileSync(join(outDir, 'compare.json'), JSON.stringify({ hash, rows }, null, 1));
