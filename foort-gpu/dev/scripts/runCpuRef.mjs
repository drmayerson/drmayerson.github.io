// Run the CPU reference tracer on the M2 parity cases, in parallel worker threads.
// Usage (from dev/): node scripts/runCpuRef.mjs <case> [--mode parity|app] [--stride 1] [--threads 15]
//   [--pixels list.json (array of [i, j])] [--eps 0.03] [--tag name (output cpu_<mode>_<tag>.json)]
// Traces pixels (i, j) of the case's FOORT SimpleSquareMesh (i, j multiples of `stride`).
// Output: tools/foort_parity/build/runs/<case>/cpu_<mode>.json (git-ignored).
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cpus } from 'node:os';
import { CASES } from './foortCases.mjs';
import { prepareImage } from '../../js/ref/cpuTracer.js';

/** Tracer options for a case in a mode. @param {import('./foortCases.mjs').ParityCase} c @param {'parity'|'app'} mode */
export function traceOptions(c, mode) {
  const m = c.create();
  const rTerm = c.horizonRadius > 0 ? c.horizonRadius * (1 + c.epsHorizon) : c.epsHorizon;
  const common = { N: c.N, mesh: /** @type {'foort'} */ ('foort'), camera: c.camera, maxSteps: c.maxSteps, rTerm, rBoundary: 1.01 * c.camera.r, eps: 0.03, hmin: 1e-12 };
  if (mode === 'parity') {
    return { ...common, radial: /** @type {'log'} */ ('log'), axis: /** @type {'foort'} */ ('foort'), thetaSingEps: c.thetaSing ? 1e-6 : null,
      crossing: /** @type {'foort'} */ ('foort'), singularity: c.singEps !== null ? { mode: /** @type {'foort'} */ ('foort'), eps: c.singEps } : null, metric: m };
  }
  return { ...common, radial: /** @type {'logShifted'} */ ('logShifted'), axis: /** @type {'reflect'} */ ('reflect'), thetaSingEps: null,
    crossing: /** @type {'interpolate'} */ ('interpolate'), singularity: c.singEps !== null ? { mode: /** @type {'euclid'} */ ('euclid'), eps: c.singEps } : null, metric: m };
}

if (isMainThread && process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
  const name = args[0];
  const mode = opt('--mode', 'parity');
  const stride = Number(opt('--stride', 1));
  const threads = Number(opt('--threads', Math.max(1, cpus().length - 1)));
  const c = CASES.find((x) => x.name === name);
  if (!c) { console.error('unknown case', name); process.exit(1); }
  const epsOverride = opt('--eps', null), tag = opt('--tag', null), list = opt('--pixels', null);
  let pixels = [];
  if (list) pixels = JSON.parse(readFileSync(list, 'utf8'));
  else for (let i = 0; i < c.N; i += stride) for (let j = 0; j < c.N; j += stride) pixels.push([i, j]);
  // interleave so every worker gets a mix of easy and hard pixels
  const chunks = Array.from({ length: threads }, (_, w) => pixels.filter((_, k) => k % threads === w));
  const t0 = Date.now();
  const parts = await Promise.all(chunks.map((px) => new Promise((res, rej) => {
    const w = new Worker(fileURLToPath(import.meta.url), { workerData: { runCpuRef: true, name, mode, pixels: px, eps: epsOverride ? Number(epsOverride) : null } });
    w.on('message', res); w.on('error', rej);
  })));
  const results = parts.flat().sort((a, b) => a.i - b.i || a.j - b.j);
  const secs = (Date.now() - t0) / 1000;
  const dir = resolve(dirname(fileURLToPath(import.meta.url)), '../../tools/foort_parity/build/runs', name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `cpu_${mode}${tag ? '_' + tag : ''}.json`), JSON.stringify({ case: name, mode, N: c.N, stride, eps: epsOverride ? Number(epsOverride) : 0.03, seconds: secs, threads, results }));
  const steps = results.reduce((s, r) => s + r.steps, 0);
  console.log(`${name} [${mode}] ${results.length} rays in ${secs.toFixed(1)} s on ${threads} threads, ${(steps / results.length).toFixed(0)} steps/ray`);
} else if (!isMainThread && workerData?.runCpuRef) {   // (other scripts' workers import traceOptions from here)
  const { name, mode, pixels, eps } = workerData;
  const c = CASES.find((x) => x.name === name);
  const opts = traceOptions(c, mode);
  // smaller steps need proportionally more of them
  if (eps) { opts.maxSteps = Math.ceil(opts.maxSteps * opts.eps / eps); opts.eps = eps; }
  const { tracePixel } = prepareImage(opts.metric, opts);
  const out = pixels.map(([i, j]) => {
    const r = tracePixel(i, j);
    return { i, j, term: r.term, steps: r.steps, r: r.r, theta: r.theta, phi: r.phi, t: r.t, passes: r.passes, crossings: r.crossings, H: r.hamiltonian, pt: r.pt, pphi: r.pphi };
  });
  parentPort.postMessage(out);
}
