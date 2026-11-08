// Stage 1B B2: all disc crossings through the binned tail.
//  1. Recovered share: GPU flux (first 3 crossings + binned tail) over the CPU reference's flux with every crossing kept
//     (double precision, the m6Passes setup: Test_FBdetail camera and emission, 10000 max steps, projection), and the
//     share the first 3 crossings alone gave (Stage 1).
//  2. Tail approximation, on the CPU alone (same rays): the binned tail J(centroid) vs the exact sum of J(r_k) over
//     crossings 4, 5, ...; relative L1 over pixels and in total, for K = 4, 8, 16 bins, quantized as the record stores it.
// Usage (from dev/): node scripts/b2Tail.mjs [--N 64] [lambda ...]  -> dev/reports/b2/tail.json
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { mkdirSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cpuTraceOptions, tailGeometry, normalizeView, decodeRecord } from '../../js/gpu/traceConfig.js';
import { prepareImage } from '../../js/ref/cpuTracer.js';
import { createFluid, johnsonSU } from '../../js/fluid/generalCircularRadial.js';
import { discIntensity, binTail } from '../../js/fluid/emission.js';
import { createMetric } from '../../js/metrics/registry.js';

const em = { mu: 0, gamma: -1.5, sigma: 2 / 24, redshiftPower: 3, fudge: 1, maxPasses: 0 };   // Test_FBdetail, units of M
const cam = { r: 250 / 24, theta: 1.5, screen: 150 / 24 };

if (!isMainThread) {
  const { view, pixels } = workerData;
  const { metric, options } = cpuTraceOptions(view);
  const { tracePixel } = prepareImage(metric, { ...options, ncross: 100000 });
  const fluid = createFluid(metric, view.fluid);
  parentPort?.postMessage(pixels.map(([i, j]) => {
    const r = tracePixel(i, j);
    return r.crossings.map((c) => ({ r: c.r, g: fluid.redshift(c.r, r.pt, c.px / c.r, r.pphi) }));
  }));
} else {
  const { openViewer } = await import('./gpuRunner.mjs');
  const args = process.argv.slice(2);
  const N = args.includes('--N') ? Number(args[args.indexOf('--N') + 1]) : 64;
  const lambdas = args.filter((a, k) => !a.startsWith('--') && args[k - 1] !== '--N').map(Number);
  const outDir = resolve(dirname(fileURLToPath(import.meta.url)), '../reports/b2');
  mkdirSync(outDir, { recursive: true });
  const v = await openViewer();
  const rows = [];
  try {
    for (const lambda of lambdas.length ? lambdas : [0.05, 5e-3, 1e-4]) {
      const view = { metric: 'st3cr', metricParams: { lambda }, camera: cam, N, maxSteps: 10000, fluid: { xi: 1, betaR: 1, betaPhi: 1 } };
      // CPU, all crossings
      const px = []; for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) px.push([i, j]);
      const T = Math.max(1, cpus().length - 1), t0 = Date.now();
      const parts = await Promise.all(Array.from({ length: T }, (_, w) => new Promise((res, rej) => {
        const wk = new Worker(fileURLToPath(import.meta.url), { workerData: { view, pixels: px.filter((_, k) => k % T === w) } });
        wk.on('message', res); wk.on('error', rej);
      })));
      // reorder to pixel order (worker w got pixels w, w + T, ...)
      const cpu = new Array(N * N);
      parts.forEach((list, w) => list.forEach((c, n) => { cpu[w + n * T] = c; }));
      const cpuSeconds = (Date.now() - t0) / 1000;
      const m = createMetric('st3cr', { lambda });
      const geom8 = tailGeometry(m, normalizeView(view));
      const geomK = (K) => ({ ...geom8, K, invWidth: geom8.invWidth * K / geom8.K });
      // exact intensities
      let full = 0, first3 = 0, tailExact = 0;
      const tailK = { 4: { approx: 0, l1: 0 }, 8: { approx: 0, l1: 0 }, 16: { approx: 0, l1: 0 } };
      for (const list of cpu) {
        const I = (k) => (k === 0 ? 1 : em.fudge) * list[k].g ** em.redshiftPower * johnsonSU(list[k].r, em);
        let te = 0;
        list.forEach((c, k) => { if (!(c.g > 0) || !(c.r > 0)) return; const x = I(k); full += x; if (k < 3) first3 += x; else te += x; });
        tailExact += te;
        for (const K of [4, 8, 16]) {
          const ta = discIntensity([], em, binTail(list, geomK(K), em, true));
          tailK[K].approx += ta; tailK[K].l1 += Math.abs(ta - te);
        }
      }
      // GPU: first 3 + binned tail, same view
      const g = await v.trace(view);
      let gpu3 = 0, gpuTail = 0;
      for (let k = 0; k < N * N; k++) {
        const d = decodeRecord(g.rec, k, g.tail);
        gpu3 += discIntensity(d.crossings, em);
        gpuTail += discIntensity([], em, d.tail);
      }
      const row = { lambda, N, cpuSeconds,
        cpu: { full, first3Share: first3 / full, tailShare: tailExact / full },
        gpu: { recoveredShare: (gpu3 + gpuTail) / full, first3Share: gpu3 / full },
        tailApproximation: Object.fromEntries(Object.entries(tailK).map(([K, t]) => [K, { relL1: t.l1 / tailExact, totalRel: (t.approx - tailExact) / tailExact }])) };
      rows.push(row);
      const p = (x) => (100 * x).toFixed(1) + '%', e = (x) => x.toExponential(1);
      console.log(`lambda ${lambda}: CPU first 3 crossings ${p(row.cpu.first3Share)}, tail ${p(row.cpu.tailShare)}; GPU recovered ${p(row.gpu.recoveredShare)} (first 3 alone ${p(row.gpu.first3Share)}); `
        + `tail approximation L1 / total: K=4 ${e(row.tailApproximation[4].relL1)}/${e(row.tailApproximation[4].totalRel)}, K=8 ${e(row.tailApproximation[8].relL1)}/${e(row.tailApproximation[8].totalRel)}, `
        + `K=16 ${e(row.tailApproximation[16].relL1)}/${e(row.tailApproximation[16].totalRel)} (CPU ${cpuSeconds.toFixed(0)} s)`);
    }
  } finally { await v.close(); }
  writeFileSync(join(outDir, 'tail.json'), JSON.stringify(rows, null, 1));
}
