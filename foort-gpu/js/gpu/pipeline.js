// @ts-check
// Backend-agnostic trace scheduling (plan Section 3.8): progressive levels (stride 4 -> 2 -> 1, each
// traced as its own smaller image),
// tiles sized so that one dispatch stays well under the browser's GPU watchdog, cancellation
// when the parameters change, and timing.

/**
 * Tiles of edge `edge` covering a w x h image, ordered from the centre outwards
 * (the interesting part of a black-hole image appears first).
 * @param {number} w @param {number} h @param {number} edge
 * @returns {import('./backend.js').Rect[]}
 */
export function tilesCentreOut(w, h, edge) {
  const out = [];
  for (let y = 0; y < h; y += edge) for (let x = 0; x < w; x += edge)
    out.push({ x, y, w: Math.min(edge, w - x), h: Math.min(edge, h - y) });
  const d = (/** @type {import('./backend.js').Rect} */ t) => (t.x + t.w / 2 - w / 2) ** 2 + (t.y + t.h / 2 - h / 2) ** 2;
  return out.sort((a, b) => d(a) - d(b));
}

/**
 * @typedef {Object} TraceStats
 * @property {number} N
 * @property {number[]} levels
 * @property {number} wallMs                 from the first tile submitted to the last fence
 * @property {number|null} gpuMs             sum of GPU timer queries (null if unavailable)
 * @property {number} tiles
 * @property {number|null} steps             total RK4 steps (when measured)
 */

/** Edge of the probe tile that starts every trace (worst case 1024 rays x maxSteps). */
const PROBE_EDGE = 32;
const MIN_TILE_RAYS = 256;

/**
 * Re-cut tiles into tiles of at most `edge` (only splitting), in centre-out order.
 * @param {import('./backend.js').Rect[]} tiles @param {number} edge @param {number} w @param {number} h
 */
export function recut(tiles, edge, w, h) {
  const out = [];
  for (const t of tiles) {
    if (t.w <= edge && t.h <= edge) { out.push(t); continue; }
    for (let y = t.y; y < t.y + t.h; y += edge) for (let x = t.x; x < t.x + t.w; x += edge)
      out.push({ x, y, w: Math.min(edge, t.x + t.w - x), h: Math.min(edge, t.y + t.h - y) });
  }
  const d = (/** @type {import('./backend.js').Rect} */ t) => (t.x + t.w / 2 - w / 2) ** 2 + (t.y + t.h / 2 - h / 2) ** 2;
  return out.sort((a, b) => d(a) - d(b));
}

export class TracePipeline {
  /**
   * @param {import('./backend.js').Backend} backend
   * @param {{tileRays?: number, targetTileMs?: number, onProgress?: (info:{level:number, done:number, total:number}) => void,
   *   onStage?: (stage: string) => void}} [opts]
   */
  constructor(backend, opts = {}) {
    this.backend = backend;
    /** rays per tile: adapted so that a tile takes about targetTileMs */
    this.tileRays = opts.tileRays ?? 256 * 256;
    this.targetTileMs = opts.targetTileMs ?? 30;
    this.onProgress = opts.onProgress ?? (() => {});
    this.generation = 0;
    this.busy = false;
    this.onStage = opts.onStage ?? (() => {});
    /** trace programs compiled so far */
    this.compiled = new Set();
    /** key of the fluid table on the GPU */
    this.fluidKey = /** @type {string|null} */ (null);
    /** key of the metric tables on the GPU */
    this.tableKey = /** @type {string|null} */ (null);
  }

  /** Tile edge for the current rays-per-tile estimate (multiple of 8, at least 16). */
  tileEdge() { return Math.max(16, Math.round(Math.sqrt(this.tileRays) / 8) * 8); }

  /** Cancel the running trace (it stops after its current tile). */
  cancel() { this.generation++; }

  /**
   * Trace an image. Starting a new trace cancels the running one.
   * @param {{program:string, uniforms:import('./backend.js').Uniforms, N:number, tables?:any, tableKey?:string|null, fluid?:any, fluidKey?:string|null}} setup
   *   from traceConfig.gpuTraceSetup
   * @param {{levels?: number[], measureSteps?: boolean, adaptTiles?: boolean}} [opts]
   * @returns {Promise<TraceStats|null>}  null if cancelled
   */
  async trace(setup, opts = {}) {
    const gen = ++this.generation;
    while (this.busy) { await new Promise((r) => setTimeout(r, 0)); if (gen !== this.generation) return null; }
    this.busy = true;
    try {
      const levels = opts.levels ?? [4, 2, 1];
      const be = this.backend;
      if (!this.compiled.has(setup.program)) this.onStage(`compiling the ${setup.program === 'trace' ? 'tabulated' : 'closed-form Kerr'} tracer (first use)…`);
      await be.setTracer(setup.program);
      this.compiled.add(setup.program);
      if (gen !== this.generation) return null;
      if (setup.tables && setup.tableKey !== this.tableKey) { be.uploadTables(setup.tables); this.tableKey = setup.tableKey ?? null; }
      if (setup.fluid && setup.fluidKey !== this.fluidKey) { be.uploadFluid(setup.fluid); this.fluidKey = setup.fluidKey ?? null; }
      be.resize(setup.N, setup.N);
      be.uploadUniforms(setup.uniforms);
      be.clearRecords();
      const t0 = performance.now();
      /** @type {Promise<number|null>[]} */
      const gpu = [];
      let nTiles = 0;
      // the first tile of every trace is a small probe: one tile's cost varies by orders of magnitude between
      // metrics and step limits (a 128^2 fuzzball tile with 10^4 max steps runs for seconds and can trip the
      // OS GPU watchdog, which loses the context)
      let probe = opts.adaptTiles !== false;
      for (const st of levels) {
        // each level is its own compact image of ceil(N / st)^2 rays
        const { w, h } = be.levelSize(st);
        let edge = probe ? PROBE_EDGE : this.tileEdge();
        let pending = tilesCentreOut(w, h, edge);
        let done = 0;
        while (pending.length) {
          if (gen !== this.generation) return null;
          const t = /** @type {import('./backend.js').Rect} */ (pending.shift());
          const r = await be.traceTile(t, st);
          gpu.push(r.gpuMs);
          nTiles++; done++;
          this.onProgress({ level: st, done, total: done + pending.length });
          if (opts.adaptTiles !== false) {
            // rays per tile proportional to the measured rate, so that a tile takes about targetTileMs
            const rays = t.w * t.h, ms = Math.max(r.wallMs, 0.5);
            if (probe || ms > 2 * this.targetTileMs || (ms < 0.4 * this.targetTileMs && rays >= this.tileRays * 0.9)) {
              this.tileRays = Math.min(1024 * 1024, Math.max(MIN_TILE_RAYS, Math.round(rays * this.targetTileMs / ms)));
            }
            const e = this.tileEdge();
            // after the probe: tile the level afresh (re-tracing the small probe region is cheaper than many tiny
            // tiles); when tiles became much slower: split the rest of this level
            if (probe) { pending = tilesCentreOut(w, h, e).filter((x) => !(x.x === t.x && x.y === t.y && x.w === t.w && x.h === t.h)); edge = e; }
            else if (e < edge / 1.5) { pending = recut(pending, e, w, h); edge = e; }
            probe = false;
          }
        }
      }
      const wallMs = performance.now() - t0;
      // GPU timer results arrive a little after the fences
      let gpuMs = /** @type {number|null} */ (null);
      const settled = await Promise.race([
        (async () => { for (let k = 0; k < 100; k++) { be.pollTiming(); await new Promise((r) => setTimeout(r, 2)); } return null; })(),
        Promise.all(gpu),
      ]);
      if (Array.isArray(settled) && settled.every((x) => x !== null)) gpuMs = settled.reduce((a, b) => a + /** @type {number} */ (b), 0);
      const steps = opts.measureSteps ? await be.readSteps() : null;
      return { N: setup.N, levels, wallMs, gpuMs, tiles: nTiles, steps };
    } finally {
      this.busy = false;
    }
  }
}
