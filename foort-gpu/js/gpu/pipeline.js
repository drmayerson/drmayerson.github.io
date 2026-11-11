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
 * @property {number} [compacted]            rays traced again in compaction rounds (Stage 1B B5)
 * @property {boolean} [cached]              restored from the record cache (Stage 1B B5)
 * @property {number} [traced]               fraction of the full-resolution pixels traced (Stage 1B B6 refinement)
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

/**
 * Step limits of the compaction rounds (Stage 1B B5): phase A stops at n1, each later round at twice the previous limit,
 * the last round runs to max steps (limit 0). Empty when n1 >= max steps.
 * @param {number} n1 @param {number} maxSteps
 */
export function compactLimits(n1, maxSteps) {
  if (!(n1 > 0) || !(n1 < maxSteps)) return [];
  const out = [];
  for (let L = n1; L < maxSteps; L *= 2) out.push(L);
  return out;
}

/**
 * Cache key of a trace: everything its records depend on.
 * @param {{program:string, uniforms:import('./backend.js').Uniforms, N:number, tableKey?:string|null, fluidKey?:string|null, compact?:{n1:number}|null, refine?:object|null}} setup
 * @param {number[]} levels
 */
export function traceKey(setup, levels) {
  const u = Object.entries(setup.uniforms).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, [t, v]]) => [k, t, Array.from(v)]);
  return JSON.stringify([setup.program, u, setup.tableKey ?? null, setup.fluidKey ?? null, setup.N, levels, setup.compact ?? null, setup.refine ?? null]);
}

import { refineList } from './refine.js';

/**
 * Review P1: what a trace's cost per ray depends on, besides the view: the program and its settings. The view (camera,
 * metric parameters) changes the cost too, but tiles adapt from the first one on.
 * @param {{program:string, maxSteps?:number, uniforms:import('./backend.js').Uniforms}} setup
 */
export function rateKey(setup) {
  const u = setup.uniforms, f = (/** @type {string} */ k) => (u[k] ? Array.from(u[k][1]).slice(0, 2).join(',') : '');
  return [setup.program, setup.maxSteps ?? 0, f('uStep'), f('uFar'), f('uBS')].join('|');
}

export class TracePipeline {
  /**
   * @param {import('./backend.js').Backend} backend
   * @param {{tileRays?: number, targetTileMs?: number, onProgress?: (info:{level:number, done:number, total:number}) => void,
   *   onStage?: (stage: string) => void, cacheBytes?: number, finalTileMs?: number}} [opts]
   */
  constructor(backend, opts = {}) {
    this.backend = backend;
    /** rays per tile: adapted so that a tile takes about targetTileMs */
    this.tileRays = opts.tileRays ?? 256 * 256;
    this.targetTileMs = opts.targetTileMs ?? 30;
    /** review P1: the tile target of final traces (fewer, larger tiles; the watchdog rule still splits slow ones) */
    this.finalTileMs = opts.finalTileMs ?? 90;
    /** review P1: measured cost (ms per ray) per rate key (program, max steps, tier settings), so a trace with a known
     * rate skips the probe tile; persisted per GPU by the viewer (rates(), setRates()) */
    this.rateMs = /** @type {Map<string, number>} */ (new Map());
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
    /** record cache (Stage 1B B5): trace key -> records on the GPU, least recently used first */
    this.cache = /** @type {Map<string, {handle: import('./backend.js').CacheHandle, stats: TraceStats}>} */ (new Map());
    /** its memory budget in bytes (0: off; decision E9: 256 MB desktop, 64 MB phone) */
    this.cacheBytes = opts.cacheBytes ?? 256 * 2 ** 20;
    /** cache key of the last foreground trace ('' without the cache), and keys that eviction skips (B7 compare sides) */
    this.lastKey = '';
    this.pins = /** @type {Set<string>} */ (new Set());
    /** setup of the displayed records */
    this.displayed = /** @type {{fluid?:any, fluidKey?:string|null}|null} */ (null);
    /** no progress reports (background traces) */
    this.silent = false;
  }

  /** the fluid table of a displayed setup onto the GPU (the display pass reads it) @param {{fluid?:any, fluidKey?:string|null}} setup */
  showFluid(setup) {
    if (setup.fluid && setup.fluidKey !== this.fluidKey) { this.backend.uploadFluid(setup.fluid); this.fluidKey = setup.fluidKey ?? null; }
  }

  /** bytes held by the record cache */
  cacheUsed() { let b = 0; for (const e of this.cache.values()) b += e.handle.bytes; return b; }

  /** @param {string} key @param {import('./backend.js').CacheHandle} handle @param {TraceStats} stats */
  cachePut(key, handle, stats) {
    this.cache.set(key, { handle, stats });
    // evict the least recently used entries beyond the budget (the newest entry always stays)
    this.cacheTrim();
  }

  /** evict the least recently used entries beyond the budget (the newest and the pinned ones stay) */
  cacheTrim() {
    for (const [k, e] of [...this.cache.entries()]) {
      if (this.cacheUsed() <= this.cacheBytes || this.cache.size <= 1) break;
      if (this.pins.has(k)) continue;
      this.backend.cacheFree(e.handle);
      this.cache.delete(k);
    }
  }

  /** drop every cached trace */
  cacheClear() { for (const e of this.cache.values()) this.backend.cacheFree(e.handle); this.cache.clear(); }

  /** Tile edge for the current rays-per-tile estimate (multiple of 8, at least 16). */
  tileEdge() { return Math.max(16, Math.round(Math.sqrt(this.tileRays) / 8) * 8); }

  /** Cancel the running trace (it stops after its current tile). */
  cancel() { this.generation++; }

  /**
   * Trace all tiles of a w x h image with `submit`, adapting the tile size (the first tile is a small probe: one tile's
   * cost varies by orders of magnitude between metrics and step limits, and a 128^2 fuzzball tile with 10^4 max steps
   * can run for seconds and trip the OS GPU watchdog, which loses the context). False if cancelled.
   * @param {number} gen @param {number} w @param {number} h
   * @param {(t: import('./backend.js').Rect) => ReturnType<import('./backend.js').Backend['traceTile']>} submit
   * @param {number} st  level (progress reports) @param {boolean} adapt
   * @param {Promise<number|null>[]} gpu  GPU timer results (appended) @param {() => void} counted
   */
  async runTiles(gen, w, h, submit, st, adapt, gpu, counted, rate = 0, tileMs = this.targetTileMs) {
    // review P1: with a known cost per ray the first tile is sized from it (no lone probe tile, no re-tiling)
    let probe = adapt && !(rate > 0);
    if (adapt && rate > 0) this.tileRays = Math.round(Math.min(1024 * 1024, Math.max(MIN_TILE_RAYS, tileMs / rate)));
    const saved = this.targetTileMs;
    this.targetTileMs = tileMs;
    try { return await this.runTilesInner(gen, w, h, submit, st, adapt, gpu, counted, probe); } finally { this.targetTileMs = saved; }
  }

  /** @param {number} gen @param {number} w @param {number} h @param {(t: import('./backend.js').Rect) => ReturnType<import('./backend.js').Backend['traceTile']>} submit
   * @param {number} st @param {boolean} adapt @param {Promise<number|null>[]} gpu @param {() => void} counted @param {boolean} probe */
  async runTilesInner(gen, w, h, submit, st, adapt, gpu, counted, probe) {
    let minRays = MIN_TILE_RAYS;
    let edge = probe ? PROBE_EDGE : this.tileEdge();
    let pending = tilesCentreOut(w, h, edge);
    let done = 0;
    // two tiles in flight: the next tile is already queued on the GPU while the JS side waits for the fence of the
    // previous one (serial submit-and-wait left the GPU idle ~10-40 ms per tile: 2x the GPU time for 1000+ tiles).
    // The probe runs alone, since the rest of the level is cut from its timing.
    /** @type {{t: import('./backend.js').Rect, p: ReturnType<import('./backend.js').Backend['traceTile']>, at: number}[]} */
    const inflight = [];
    let lastDone = performance.now();
    while (pending.length || inflight.length) {
      if (gen !== this.generation) { await Promise.allSettled(inflight.map((x) => x.p)); return false; }
      while (inflight.length < (probe ? 1 : TILES_IN_FLIGHT) && pending.length) {
        const tt = /** @type {import('./backend.js').Rect} */ (pending.shift());
        inflight.push({ t: tt, p: submit(tt), at: performance.now() });
      }
      const { t, p, at } = /** @type {{t: import('./backend.js').Rect, p: ReturnType<import('./backend.js').Backend['traceTile']>, at: number}} */ (inflight.shift());
      const res = await p;
      const now = performance.now();
      // this tile's own GPU share: from the later of its submission and the previous completion
      const r = { wallMs: now - Math.max(at, lastDone), gpuMs: res.gpuMs };
      lastDone = now;
      gpu.push(r.gpuMs);
      counted(); done++;
      if (!this.silent) this.onProgress({ level: st, done, total: done + pending.length + inflight.length });
      if (adapt) {
        // rays per tile from the measured rate. The estimate moves both ways (log-space average, at most x2 per tile)
        // and persists between traces. A wall time includes a fixed fence/yield latency, so a pure rate rule shrinks
        // tiles without end and tiny tiles leave the GPU idle (M9: 4941 tiles and 20x the M4 time). Tiles therefore
        // stay >= MIN_TILE_RAYS unless such a tile itself runs longer than DANGER_MS (the OS watchdog risk).
        const rays = t.w * t.h, ms = Math.max(r.wallMs, 0.5);
        const want = rays * this.targetTileMs / ms;
        // the floor drops (for the rest of this image) when a tile at the floor runs dangerously long
        if (ms > DANGER_MS && rays <= minRays) minRays = Math.max(MIN_TILE_RAYS_DANGER, minRays / 4);
        const floor = minRays;
        const next = probe ? want : this.tileRays * Math.min(2, Math.max(0.5, Math.sqrt(want / this.tileRays)));
        this.tileRays = Math.round(Math.min(1024 * 1024, Math.max(floor, next)));
        const e = this.tileEdge();
        // after the probe: tile the image afresh (re-tracing the small probe region is cheaper than many tiny
        // tiles); when one tile ran far over the target: split the rest
        if (probe) { pending = tilesCentreOut(w, h, e); edge = e; }
        else if (ms > 3 * this.targetTileMs && e < edge / 1.5) { pending = recut(pending, e, w, h); edge = e; }
        probe = false;
      }
    }
    return true;
  }

  /**
   * Trace an image. Starting a new trace cancels the running one.
   * @param {{program:string, uniforms:import('./backend.js').Uniforms, N:number, tables?:any, tableKey?:string|null, fluid?:any, fluidKey?:string|null,
   *   compact?:{n1:number}|null, maxSteps?:number, refine?:(import('./refine.js').RefineParams & {M:number, spacing:number})|null}} setup
   *   With the record cache on (opts.cache, default true), a trace whose key (program, uniforms, tables, fluid, N, levels) is
   *   cached is restored instead of traced (stats.cached); background traces (opts.background: idle pre-tracing) run in
   *   the backend's background record set and only fill the cache.
   *   from traceConfig.gpuTraceSetup
   * @param {{levels?: number[], measureSteps?: boolean, adaptTiles?: boolean, cache?: boolean, background?: boolean, final?: boolean}} [opts]
   *   final: false for previews (30 ms tiles); otherwise final traces use larger tiles (review P1)
   * @returns {Promise<TraceStats|null>}  null if cancelled
   */
  async trace(setup, opts = {}) {
    // a background trace (idle pre-tracing) never cancels or waits for another trace: it runs only on an idle pipeline
    if (opts.background && this.busy) return null;
    const gen = ++this.generation;
    while (this.busy) { await new Promise((r) => setTimeout(r, 0)); if (gen !== this.generation) return null; }
    this.busy = true;
    const be = this.backend;
    try {
      const levels = opts.levels ?? finalLevels(setup.N);
      const useCache = opts.cache !== false && this.cacheBytes > 0;
      const key = useCache ? traceKey(setup, levels) : '';
      const hit = useCache ? this.cache.get(key) : undefined;
      if (!opts.background) this.lastKey = useCache ? key : '';
      if (hit) {
        // most recently used last
        this.cache.delete(key); this.cache.set(key, hit);
        if (opts.background) return hit.stats;
        be.useRecordSet(0);
        be.resize(setup.N, setup.N);
        be.cacheRestore(hit.handle);
        this.showFluid(setup);
        return { ...hit.stats, cached: true };
      }
      if (!opts.background) this.displayed = setup;
      be.useRecordSet(opts.background ? 1 : 0, setup.N, setup.N);
      // background traces report no progress (the status line and the redraws belong to the displayed view)
      this.silent = !!opts.background;
      // devices without 8 draw buffers: no compaction or refinement (the plain program, every pixel traced)
      if (setup.program.includes('+compact') && !be.compactSupported()) setup = { ...setup, program: setup.program.replace('+compact', ''), compact: null, refine: null };
      if (!this.compiled.has(setup.program)) this.onStage(`compiling the ${setup.program.startsWith('trace_kerr') ? 'closed-form Kerr' : 'tabulated'} tracer (first use)…`);
      await be.setTracer(setup.program);
      this.compiled.add(setup.program);
      if (gen !== this.generation) return null;
      if (setup.tables && setup.tableKey !== this.tableKey) { be.uploadTables(setup.tables); this.tableKey = setup.tableKey ?? null; }
      if (setup.fluid && setup.fluidKey !== this.fluidKey) { be.uploadFluid(setup.fluid); this.fluidKey = setup.fluidKey ?? null; }
      if (!opts.background) be.resize(setup.N, setup.N);
      be.uploadUniforms(setup.uniforms);
      be.clearRecords(levels);
      const t0 = performance.now();
      /** @type {Promise<number|null>[]} */
      const gpu = [];
      let nTiles = 0;
      // review P1: the rate of this kind of trace, if measured before, and the tile target (final traces: larger tiles)
      const rk = rateKey(setup);
      const rate = this.rateMs.get(rk) ?? 0;
      const tileMs = opts.final === false ? this.targetTileMs : this.finalTileMs;
      const compactRounds = setup.compact ? compactLimits(setup.compact.n1, setup.maxSteps ?? 0) : [];
      let compacted = 0;
      /** fraction of the full-resolution pixels traced (B6 adaptive refinement; 1 without it) */
      let traced = 1;
      for (const [li, st] of levels.entries()) {
        // Stage 1B B6 adaptive refinement: the full level from the coarse one before it, tracing only the marked cells
        const cs = li > 0 ? levels[li - 1] : 0;
        if (setup.refine && st === 1 && cs > 1) {
          const { w: cw, h: ch } = be.levelSize(cs), { w, h } = be.levelSize(1);
          const coarse = await be.readRecords(cs, true);
          const r = refineList(coarse, cw, ch, cs, w, h, setup.refine, setup.refine.spacing * cs, setup.refine.M);
          be.interpolateLevel(cs);
          traced = r.list.length / (w * h);
          if (be.pixelList(1, r.list)) {
            be.setCompactPhase(0, 0);
            const cz = /** @type {{w:number, h:number}} */ (be.compactSize());
            const ok = await this.runTiles(gen, cz.w, cz.h, (t) => be.traceTile(t, 1, true), 1, opts.adaptTiles !== false, gpu, () => nTiles++, rate, tileMs);
            if (!ok) return null;
            be.scatterCompact();
          }
          continue;
        }
        // each level is its own compact image of ceil(N / st)^2 rays
        const { w, h } = be.levelSize(st);
        // Stage 1B B5 ray compaction: phase A stops rays at the first limit; each later round traces the unfinished rays
        // as a dense compact image (up to the next limit, the last one without a limit) and scatters them back
        be.setCompactPhase(compactRounds.length ? 1 : 0, compactRounds[0] ?? 0);
        const ok = await this.runTiles(gen, w, h, (t) => be.traceTile(t, st), st, opts.adaptTiles !== false, gpu, () => nTiles++, rate, tileMs);
        if (!ok) return null;
        for (let k = 1; k < compactRounds.length + 1 && compactRounds.length; k++) {
          const M = await be.compactList(st);
          if (gen !== this.generation) return null;
          if (!M) break;
          compacted += M;
          be.setCompactPhase(2, compactRounds[k] ?? 0);
          const cs = /** @type {{w:number, h:number}} */ (be.compactSize());
          // the continuing rays are the long ones: start with a probe tile again
          const ok2 = await this.runTiles(gen, cs.w, cs.h, (t) => be.traceTile(t, st, true), st, opts.adaptTiles !== false, gpu, () => nTiles++);
          if (!ok2) return null;
          be.scatterCompact();
        }
        be.setCompactPhase(0, 0);
      }
      const wallMs = performance.now() - t0;
      // review P1: the measured cost per ray of this kind of trace (wall time, all levels; refinement and compaction
      // rounds included); a log-space average with the previous value
      {
        const rays = levels.reduce((a, st) => a + Math.ceil(setup.N / st) ** 2, 0);
        const m = wallMs / Math.max(1, rays);
        const old = this.rateMs.get(rk);
        this.rateMs.set(rk, old ? Math.sqrt(old * m) : m);
      }
      // GPU timer results arrive a little after the fences
      let gpuMs = /** @type {number|null} */ (null);
      const settled = await Promise.race([
        (async () => { for (let k = 0; k < 100; k++) { be.pollTiming(); await new Promise((r) => setTimeout(r, 2)); } return null; })(),
        Promise.all(gpu),
      ]);
      if (Array.isArray(settled) && settled.every((x) => x !== null)) gpuMs = settled.reduce((a, b) => a + /** @type {number} */ (b), 0);
      const steps = opts.measureSteps && !opts.background ? await be.readSteps() : null;
      const stats = { N: setup.N, levels, wallMs, gpuMs, tiles: nTiles, steps, compacted, traced };
      if (useCache) this.cachePut(key, be.cacheStore(levels), stats);
      return stats;
    } finally {
      be.useRecordSet(0);
      be.setCompactPhase(0, 0);
      this.silent = false;
      // a background trace may have replaced the fluid table the display reads (Omega, envelope radius)
      if (opts.background && this.displayed) this.showFluid(this.displayed);
      this.busy = false;
    }
  }
}
