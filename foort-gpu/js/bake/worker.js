// @ts-check
// Bake worker (module Web Worker): builds the metric and bakes its tables off the main thread.
// Message in: {id, metric, params, spec}; out: {id, tables} (buffers transferred) or {id, error}.
import { createMetric } from '../metrics/registry.js';
import { bakeTables } from './bake.js';

self.onmessage = (/** @type {MessageEvent} */ ev) => {
  const { id, metric, params, spec } = ev.data;
  try {
    const tables = bakeTables(createMetric(metric, params), spec);
    /** @type {any} */ (self).postMessage({ id, tables }, [tables.data.buffer, tables.equator.buffer]);
  } catch (e) {
    /** @type {any} */ (self).postMessage({ id, error: String(/** @type {Error} */ (e)?.message ?? e) });
  }
};
