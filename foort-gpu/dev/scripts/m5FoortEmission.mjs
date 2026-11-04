// M5 Level 1 (deferred from M2): disc intensities of the CPU reference (with the JS fluid model) vs FOORT's
// EquatorialEmission output of the M2 parity runs (tools/foort_parity/build/runs/<case>/).
// FOORT prints intensities with 6 decimals, so agreement is judged against that rounding (|dI| <= 5e-7).
// Usage (from dev/): node scripts/m5FoortEmission.mjs [case ...] [--mode parity|app]  -> dev/reports/m5/foort_<case>_<mode>.json/.png
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { mkdirSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CASES } from './foortCases.mjs';
import { traceOptions } from './runCpuRef.mjs';
import { readFoortRun } from './foortDat.mjs';
import { prepareImage } from '../../js/ref/cpuTracer.js';
import { createFluid } from '../../js/fluid/generalCircularRadial.js';
import { discIntensity } from '../../js/fluid/emission.js';
import { writePng } from './png.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const FLUID = { xi: 1, betaR: 1, betaPhi: 1 };   // the M2 configs (foortCases.mjs)

if (!isMainThread) {
  const { name, mode, pixels, fd } = workerData;
  const c = CASES.find((x) => x.name === name);
  const o = { ...traceOptions(c, mode), ncross: 100000, ...(fd ? { fdStep: fd } : {}) };
  const { tracePixel, r0 } = prepareImage(o.metric, o);
  const fluid = createFluid(o.metric, FLUID);
  const em = { ...c.emission, redshiftPower: 3, fudge: 1, maxPasses: 0 };
  parentPort?.postMessage(pixels.map(([i, j]) => {
    const r = tracePixel(i, j);
    const cr = r.crossings.map((x) => ({ r: x.r, g: fluid.redshift(x.r, r.pt, x.px / (x.r - r0), r.pphi) }));
    return { i, j, I: discIntensity(cr, em), passes: r.passes, term: r.term };
  }));
} else if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  const mode = args.includes('--mode') ? args[args.indexOf('--mode') + 1] : 'parity';
  const fd = args.includes('--fd') ? Number(args[args.indexOf('--fd') + 1]) : null;   // CPU finite-difference step (default 1e-3)
  const tag = fd ? `${mode}_fd${fd}` : mode;
  const names = args.filter((a, k) => !a.startsWith('--') && args[k - 1] !== '--mode' && args[k - 1] !== '--fd');
  const list = names.length ? names : ['kerr_a0', 'kerr_a0.94', 'johannsen', 'mankoNovikov'];
  const outDir = resolve(here, '../reports/m5');
  mkdirSync(outDir, { recursive: true });
  for (const name of list) {
    const c = CASES.find((x) => x.name === name);
    const run = readFoortRun(resolve(here, '../../tools/foort_parity/build/runs', name), name);
    const N = c.N, threads = Math.max(1, cpus().length - 1);
    const pixels = [];
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) pixels.push([i, j]);
    const t0 = Date.now();
    const parts = await Promise.all(Array.from({ length: threads }, (_, w) => new Promise((res, rej) => {
      const wk = new Worker(fileURLToPath(import.meta.url), { workerData: { name, mode, fd, pixels: pixels.filter((_, k) => k % threads === w) } });
      wk.on('message', res); wk.on('error', rej);
    })));
    const cpu = new Map(parts.flat().map((p) => [`${p.i},${p.j}`, p]));
    const rel = [], err = new Float32Array(N * N);
    let within = 0, n = 0, sumF = 0, sumD = 0, passDiff = 0, bigNoPass = 0;
    for (const [k, f] of run.pixels) {
      const p = cpu.get(k);
      const [i, j] = k.split(',').map(Number);
      const d = Math.abs(p.I - f.intensity);
      n++; sumF += f.intensity; sumD += d;
      if (d <= 5e-7 + 1e-12) within++;
      if (f.intensity > 1e-3) rel.push(d / f.intensity);
      if (Math.abs(f.passes) !== p.passes) passDiff++;
      else if (d > 1e-3 * Math.max(f.intensity, 1e-3)) bigNoPass++;
      err[j * N + i] = d / Math.max(f.intensity, 1e-3);
    }
    rel.sort((a, b) => a - b);
    const q = (f) => rel[Math.min(rel.length - 1, Math.floor(f * rel.length))];
    const report = { case: name, mode, fdStep: fd ?? 1e-3, pixels: n, withinRounding: within / n, relL1: sumD / sumF, relDiff: { median: q(0.5), p99: q(0.99), max: rel[rel.length - 1] }, passCountDiffers: passDiff, largeDiffSamePasses: bigNoPass, cpuSeconds: (Date.now() - t0) / 1000 };
    writeFileSync(join(outDir, `foort_${name}_${tag}.json`), JSON.stringify(report, null, 1));
    // FOORT | CPU | relative difference (log10, 1e-7 .. 1e-1); intensity panels share FOORT's 99.5th percentile
    const If = [...run.pixels.values()].map((x) => x.intensity).sort((a, b) => a - b), top = If[Math.floor(0.995 * If.length)] || 1;
    const gap = 4;
    writePng(join(outDir, `foort_${name}_${tag}.png`), 3 * N + 2 * gap, N, (x, y) => {
      const panel = Math.floor(x / (N + gap)), i = x - panel * (N + gap), j = N - 1 - y;
      if (i >= N) return [255, 255, 255];
      const key = `${i},${j}`;
      if (panel < 2) {
        const v = Math.sqrt(Math.min(1, (panel === 0 ? run.pixels.get(key).intensity : cpu.get(key).I) / top));
        return [Math.min(255, 510 * v), Math.max(0, Math.min(255, 510 * v - 128)), Math.max(0, Math.min(255, 510 * v - 255))];
      }
      const t = Math.min(1, Math.max(0, (Math.log10(Math.max(err[j * N + i], 1e-9)) + 7) / 6));
      return [Math.round(255 * Math.min(1, 2 * t)), Math.round(255 * Math.max(0, 2 * t - 1)), Math.round(80 * (1 - t))];
    });
    const e = (x) => x.toExponential(1);
    console.log(`${name} [${tag}]: within FOORT's rounding ${(100 * report.withinRounding).toFixed(2)}%, relative L1 ${e(report.relL1)}, rel. diff median/p99/max ${e(q(0.5))}/${e(q(0.99))}/${e(rel[rel.length - 1])}; ` +
      `pass count differs ${passDiff} px, large differences with equal pass counts ${bigNoPass} px (${report.cpuSeconds.toFixed(0)} s)`);
  }
}
