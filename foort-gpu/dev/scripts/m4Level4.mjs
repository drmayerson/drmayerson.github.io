// M4 Level 4: tabulated vs closed-form Kerr, both on the GPU (float32), same rays.
// Targets (plan Section 6): escape-direction difference <= 1e-3 rad for >= 99% of escaping pixels;
// emission relative L1 <= 0.5% (here the M3 emission proxy, sum of g^3 J(r) over the crossings).
// Usage (from dev/): node scripts/m4Level4.mjs [--N 256]  -> dev/reports/m4/level4.json, level4_<case>.png
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openViewer } from './gpuRunner.mjs';
import { decodeRecord } from '../../js/gpu/traceConfig.js';
import { compareImages, summary, writeComparisonPng } from './m3Compare.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, '../reports/m4');
const DEG = Math.PI / 180;
const args = process.argv.slice(2);
const N = Number(args[args.indexOf('--N') + 1] || 256) || 256;
const angle = (t1, p1, t2, p2) => Math.acos(Math.min(1, Math.max(-1, Math.sin(t1) * Math.sin(t2) * Math.cos(p1 - p2) + Math.cos(t1) * Math.cos(t2))));

/** GPU record image -> the per-pixel list compareImages expects as its reference */
const asList = (rec) => Array.from({ length: N * N }, (_, k) => ({ i: k % N, j: Math.floor(k / N), ...decodeRecord(rec, k) }));

mkdirSync(outDir, { recursive: true });
const viewer = await openViewer();
const rows = [];
try {
  for (const a of [0, 0.5, 0.94, 0.998]) for (const inc of [17, 80]) {
    const base = { metric: 'kerr', metricParams: { a }, camera: { r: 1000, theta: inc * DEG, screen: 15 }, N, maxSteps: 20000 };
    const A = await viewer.trace({ ...base, path: 'analytic' });
    const ref = asList(A.rec);
    for (const [nx, nth] of [[256, 128], [512, 128], [512, 256], [1024, 256]]) {
      const T = await viewer.trace({ ...base, path: 'tabulated', grid: { nx, nth } });
      const cmp = compareImages(T.rec, ref, N);
      let esc = 0, within = 0;
      for (let k = 0; k < N * N; k++) {
        const t = decodeRecord(T.rec, k), r = ref[k];
        if (t.term === 2 && r.term === 2) { esc++; if (angle(t.theta, t.phi, r.theta, r.phi) <= 1e-3) within++; }
      }
      const name = `kerr_a${a}_inc${inc}_${nx}x${nth}`;
      if (nx === 512 && nth === 128) writeComparisonPng(join(outDir, `level4_${name}.png`), cmp);
      const row = { case: name, a, inc, nx, nth, fracWithin1e3: within / esc, gpuMs: { analytic: A.stats.wallMs, tabulated: T.stats.wallMs }, ...summary(cmp) };
      rows.push(row);
      const e = (x) => (Number.isFinite(x) ? x.toExponential(1) : '—');
      console.log(`${name}: escape within 1e-3: ${(100 * row.fracWithin1e3).toFixed(3)}%, median/p99/max ${e(cmp.escapeAngle.median)}/${e(cmp.escapeAngle.p99)}/${e(cmp.escapeAngle.max)}, ` +
        `four-colour ${(100 * cmp.fourColorAgreement).toFixed(3)}% (${cmp.fourColorMismatches}), shadow ${cmp.shadow.radiusRatio.toFixed(5)}, ` +
        `crossing1 r ${e(cmp.crossing1.relR.median)}, g ${e(cmp.crossing1.relG.median)}/${e(cmp.crossing1.relG.p99)}, emission proxy L1 ${e(cmp.emissionProxyRelL1)}`);
    }
  }
} finally { await viewer.close(); }
writeFileSync(join(outDir, 'level4.json'), JSON.stringify({ N, rows }, null, 1));
