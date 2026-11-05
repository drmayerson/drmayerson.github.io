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

/**
 * Progressive levels of a full trace of an N x N image: one coarse preview level (about 128^2 to 256^2 rays, so that it
 * appears at once) and then the full image. A middle level (the M3-M8 levels 4 -> 2 -> 1) would cost another 25%.
 * @param {number} N
 */
export const finalLevels = (N) => (N >= 2048 ? [8, 1] : N >= 512 ? [4, 1] : N >= 256 ? [2, 1] : [1]);

/** Edge of the probe tile that starts every trace (worst case 1024 rays x maxSteps). */
const PROBE_EDGE = 32;
/** Tiles queued on the GPU at once. */
const TILES_IN_FLIGHT = 2;
/** Smallest tile in normal operation (64^2): smaller tiles do not fill the GPU. */
const MIN_TILE_RAYS = 64 * 64;
/** A tile of MIN_TILE_RAYS this slow (ms) may be split further (watchdog margin: Windows resets the GPU after ~2 s;
 * the M6 crash was a 128^2 fuzzball tile running for seconds). Splitting earlier makes tiles too small to fill the GPU. */
const DANGER_MS = 1000;
/** The floor never drops below this. */
const MIN_TILE_RAYS_DANGER = 32 * 32;

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
      const levels = opts.levels ?? finalLevels(setup.N);
      const be = this.backend;
      if (!this.compiled.has(setup.program)) this.onStage(`compiling the ${setup.program === 'trace' ? 'tabulated' : 'closed-form Kerr'} tracer (first use)…`);
      await be.setTracer(setup.program);
      this.compiled.add(setup.program);
      if (gen !== this.generation) return null;
      if (setup.tables && setup.tableKey !== this.tableKey) { be.uploadTables(setup.tables); this.tableKey = setup.tableKey ?? null; }
      if (setup.fluid && setup.fluidKey !== this.fluidKey) { be.uploadFluid(setup.fluid); this.fluidKey = setup.fluidKey ?? null; }
      be.resize(setup.N, setup.N);
      be.uploadUniforms(setup.uniforms);
      be.clearRecords(levels);
      const t0 = performance.now();
      /** @type {Promise<number|null>[]} */
      const gpu = [];
      let nTiles = 0;
      // the first tile of every trace is a small probe: one tile's cost varies by orders of magnitude between
      // metrics and step limits (a 128^2 fuzzball tile with 10^4 max steps runs for seconds and can trip the
      // OS GPU watchdog, which loses the context)
      let probe = opts.adaptTiles !== false;
      let minRays = MIN_TILE_RAYS;
      for (const st of levels) {
        // each level is its own compact image of ceil(N / st)^2 rays
        const { w, h } = be.levelSize(st);
        let edge = probe ? PROBE_EDGE : this.tileEdge();
        let pending = tilesCentreOut(w, h, edge);
        let done = 0;
        // two tiles in flight: the next tile is already queued on the GPU while the JS side waits for the fence of the
        // previous one (serial submit-and-wait left the GPU idle ~10-40 ms per tile: 2x the GPU time for 1000+ tiles).
        // The probe runs alone, since the rest of the level is cut from its timing.
        /** @type {{t: import('./backend.js').Rect, p: ReturnType<typeof be.traceTile>, at: number}[]} */
        const inflight = [];
        let lastDone = performance.now();
        while (pending.length || inflight.length) {
          if (gen !== this.generation) { await Promise.allSettled(inflight.map((x) => x.p)); return null; }
          while (inflight.length < (probe ? 1 : TILES_IN_FLIGHT) && pending.length) {
            const tt = /** @type {import('./backend.js').Rect} */ (pending.shift());
            inflight.push({ t: tt, p: be.traceTile(tt, st), at: performance.now() });
          }
          const { t, p, at } = /** @type {{t: import('./backend.js').Rect, p: ReturnType<typeof be.traceTile>, at: number}} */ (inflight.shift());
          const res = await p;
          const now = performance.now();
          // this tile's own GPU share: from the later of its submission and the previous completion
          const r = { wallMs: now - Math.max(at, lastDone), gpuMs: res.gpuMs };
          lastDone = now;
          gpu.push(r.gpuMs);
          nTiles++; done++;
          this.onProgress({ level: st, done, total: done + pending.length + inflight.length });
          if (opts.adaptTiles !== false) {
            // rays per tile from the measured rate. The estimate moves both ways (log-space average, at most x2 per tile)
            // and persists between traces. A wall time includes a fixed fence/yield latency, so a pure rate rule shrinks
            // tiles without end and tiny tiles leave the GPU idle (M9: 4941 tiles and 20x the M4 time). Tiles therefore
            // stay >= MIN_TILE_RAYS unless such a tile itself runs longer than DANGER_MS (the OS watchdog risk).
            const rays = t.w * t.h, ms = Math.max(r.wallMs, 0.5);
            const want = rays * this.targetTileMs / ms;
            // the floor drops (for the rest of this trace) when a tile at the floor runs dangerously long
            if (ms > DANGER_MS && rays <= minRays) minRays = Math.max(MIN_TILE_RAYS_DANGER, minRays / 4);
            const floor = minRays;
            const next = probe ? want : this.tileRays * Math.min(2, Math.max(0.5, Math.sqrt(want / this.tileRays)));
            this.tileRays = Math.round(Math.min(1024 * 1024, Math.max(floor, next)));
            const e = this.tileEdge();
            // after the probe: tile the level afresh (re-tracing the small probe region is cheaper than many tiny
            // tiles); when one tile ran far over the target: split the rest of this level
            if (probe) { pending = tilesCentreOut(w, h, e); edge = e; }
            else if (ms > 3 * this.targetTileMs && e < edge / 1.5) { pending = recut(pending, e, w, h); edge = e; }
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
