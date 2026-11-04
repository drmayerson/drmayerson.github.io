// @ts-check
// Main-thread side of the bake worker: one request in flight per table key, a small LRU cache,
// and stale requests superseded by newer ones (slider drags).

export class BakeClient {
  /** @param {{cacheSize?: number}} [opts] */
  constructor(opts = {}) {
    this.worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    this.cacheSize = opts.cacheSize ?? 6;
    /** @type {Map<string, any>} */
    this.cache = new Map();
    /** @type {Map<number, {resolve: (t:any) => void, reject: (e:Error) => void}>} */
    this.pending = new Map();
    this.nextId = 1;
    this.worker.onmessage = (ev) => {
      const p = this.pending.get(ev.data.id);
      if (!p) return;
      this.pending.delete(ev.data.id);
      if (ev.data.error) p.reject(new Error(ev.data.error)); else p.resolve(ev.data.tables);
    };
  }

  /**
   * Baked tables for a spec from traceConfig.tableSpec / fluidSpec (cached by key).
   * @param {{kind?:'metric'|'fluid', metric:string, params:Record<string, number>, spec:any, key:string}} ts
   * @returns {Promise<{tables: any, cached: boolean, ms: number}>}
   */
  async get(ts) {
    const hit = this.cache.get(ts.key);
    if (hit) { this.cache.delete(ts.key); this.cache.set(ts.key, hit); return { tables: hit, cached: true, ms: 0 }; }
    const t0 = performance.now();
    const id = this.nextId++;
    const tables = await new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, kind: ts.kind ?? 'metric', metric: ts.metric, params: ts.params, spec: ts.spec });
    });
    this.cache.set(ts.key, tables);
    while (this.cache.size > this.cacheSize) this.cache.delete(/** @type {string} */ (this.cache.keys().next().value));
    return { tables, cached: false, ms: performance.now() - t0 };
  }
}
