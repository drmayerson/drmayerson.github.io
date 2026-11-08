// M6: how much of the fuzzball disc emission comes from equatorial crossings beyond the GPU record's 3?
// CPU reference (double, constraint projection, interpolated crossings) with every crossing kept, Test_FBdetail
// camera and emission. Reports the share of the image's intensity in crossings 4, 5, ... and how it falls with the
// number of stored crossings.
// Usage (from dev/): node scripts/m6Passes.mjs [--N 64] [lambda ...]  -> dev/reports/m6/passes.json
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { mkdirSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cpuTraceOptions } from '../../js/gpu/traceConfig.js';
import { prepareImage } from '../../js/ref/cpuTracer.js';
import { createFluid, johnsonSU } from '../../js/fluid/generalCircularRadial.js';

// Test_FBdetail emission and camera in units of M (the registry's ST3Cr since Stage 1B B1)
const em = { mu: 0, gamma: -1.5, sigma: 2 / 24 };
const MAXK = 12;

if (!isMainThread) {
  const { view, pixels } = workerData;
  const { metric, options } = cpuTraceOptions(view);
  const { tracePixel } = prepareImage(metric, { ...options, ncross: 100000 });
  const fluid = createFluid(metric, view.fluid);
  parentPort?.postMessage(pixels.map(([i, j]) => {
    const r = tracePixel(i, j);
    // intensity of crossing k (FOORT: g^3 J(r), fudge factor 1)
    return r.crossings.map((c) => { const g = fluid.redshift(c.r, r.pt, c.px / c.r, r.pphi); return g > 0 ? g ** 3 * johnsonSU(c.r, em) : 0; });
  }));
} else {
  const args = process.argv.slice(2);
  const N = args.includes('--N') ? Number(args[args.indexOf('--N') + 1]) : 64;
  const lambdas = args.filter((a, k) => !a.startsWith('--') && args[k - 1] !== '--N').map(Number);
  const outDir = resolve(dirname(fileURLToPath(import.meta.url)), '../reports/m6');
  mkdirSync(outDir, { recursive: true });
  const rows = [];
  for (const lambda of lambdas.length ? lambdas : [0.05, 0.005, 1e-4]) {
    const view = { metric: 'st3cr', metricParams: { lambda }, camera: { r: 250 / 24, theta: 1.5, screen: 150 / 24 }, N, maxSteps: 10000, fluid: { xi: 1, betaR: 1, betaPhi: 1 } };
    const px = []; for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) px.push([i, j]);
    const T = Math.max(1, cpus().length - 1);
    const t0 = Date.now();
    const parts = await Promise.all(Array.from({ length: T }, (_, w) => new Promise((res, rej) => {
      const wk = new Worker(fileURLToPath(import.meta.url), { workerData: { view, pixels: px.filter((_, k) => k % T === w) } });
      wk.on('message', res); wk.on('error', rej);
    })));
    const all = parts.flat();
    const byK = new Float64Array(MAXK + 1);   // byK[k]: intensity in crossing k + 1 (last bin: all beyond)
    let total = 0, raysMore3 = 0;
    for (const list of all) {
      if (list.length > 3) raysMore3++;
      list.forEach((I, k) => { byK[Math.min(k, MAXK)] += I; total += I; });
    }
    const share = Array.from(byK, (x) => x / total);
    const kept = (n) => share.slice(0, n).reduce((a, b) => a + b, 0);
    const row = { lambda, N, seconds: (Date.now() - t0) / 1000, raysWithMoreThan3: raysMore3 / (N * N), shareByCrossing: share,
      intensityKeptWith: { 1: kept(1), 2: kept(2), 3: kept(3), 4: kept(4), 6: kept(6), 8: kept(8) } };
    rows.push(row);
    console.log(`lambda ${lambda}: rays with > 3 crossings ${(100 * row.raysWithMoreThan3).toFixed(1)}%; intensity kept with 1/2/3/4/6/8 crossings: `
      + [1, 2, 3, 4, 6, 8].map((n) => (100 * kept(n)).toFixed(1) + '%').join(' / ') + ` (${row.seconds.toFixed(0)} s)`);
  }
  writeFileSync(join(outDir, 'passes.json'), JSON.stringify(rows, null, 1));
}
