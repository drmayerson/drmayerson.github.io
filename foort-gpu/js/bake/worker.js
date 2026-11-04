// @ts-check
// Bake worker (module Web Worker): metric tables and fluid tables off the main thread.
// Message in: {id, kind: 'metric'|'fluid', metric, params, spec}; out: {id, tables} (buffers transferred) or {id, error}.
import { createMetric } from '../metrics/registry.js';
import { bakeTables } from './bake.js';
import { bakeFluid } from '../fluid/fluidTable.js';

self.onmessage = (/** @type {MessageEvent} */ ev) => {
  const { id, kind, metric, params, spec } = ev.data;
  try {
    const m = createMetric(metric, params);
    const tables = kind === 'fluid' ? bakeFluid(m, spec.fluid, spec.range) : bakeTables(m, spec);
    /** @type {any} */ (self).postMessage({ id, tables }, [tables.data.buffer]);
  } catch (e) {
    /** @type {any} */ (self).postMessage({ id, error: String(/** @type {Error} */ (e)?.message ?? e) });
  }
};
