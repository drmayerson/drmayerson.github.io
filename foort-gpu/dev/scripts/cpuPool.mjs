// Trace the pixels of a view (js/gpu/traceConfig.js ViewParams) with the double-precision CPU
// reference in parallel worker threads; results in the GPU record's terms.
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { cpus } from 'node:os';
import { cpuTraceOptions } from '../../js/gpu/traceConfig.js';
import { prepareImage } from '../../js/ref/cpuTracer.js';
import { keplerOrbit, emitterRedshift } from '../../js/bake/bake.js';

/**
 * @param {import('../../js/gpu/traceConfig.js').ViewParams} view
 * @param {[number, number][]} [pixels]  default: all
 * @param {number} [threads]
 */
export async function traceViewCPU(view, pixels, threads = Math.max(1, cpus().length - 1)) {
  if (!pixels) { pixels = []; for (let j = 0; j < view.N; j++) for (let i = 0; i < view.N; i++) pixels.push([i, j]); }
  const chunks = Array.from({ length: threads }, (_, w) => pixels.filter((_, k) => k % threads === w));
  const parts = await Promise.all(chunks.map((px) => new Promise((res, rej) => {
    const w = new Worker(fileURLToPath(import.meta.url), { workerData: { view, pixels: px } });
    w.on('message', res); w.on('error', rej);
  })));
  return parts.flat();
}

if (!isMainThread && workerData?.view) {
  const { view, pixels } = workerData;
  const { metric, options } = cpuTraceOptions(view);
  const { tracePixel } = prepareImage(metric, options);
  // redshift placeholder: prograde circular equatorial emitter, as the GPU tables (js/bake/bake.js)
  const orbit = keplerOrbit(metric);
  const out = pixels.map(([i, j]) => {
    const r = tracePixel(i, j);
    let ph = r.phi % (2 * Math.PI); if (ph < 0) ph += 2 * Math.PI;
    return {
      i, j, term: r.term, passes: r.passes, steps: r.steps, theta: r.theta, phi: ph, H: r.hamiltonian,
      crossings: r.crossings.map((c) => ({ r: c.r, phi: ((c.phi % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI), dt: c.t, g: emitterRedshift(orbit(c.r), r.pt, r.pphi) })),
    };
  });
  parentPort?.postMessage(out);
}
