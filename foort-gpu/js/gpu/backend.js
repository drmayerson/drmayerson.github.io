// @ts-check
// Backend interface (plan Section 3.1). Physics and UI code talk only to this interface;
// the Stage 1 backend is WebGL2 (decision D2, backendWebGL2.js). A WebGPU backend (M10 or
// Stage 2) implements the same methods.

/**
 * @typedef {{x:number, y:number, w:number, h:number}} Rect
 * @typedef {Record<string, ['4f'|'4i'|'m4', ArrayLike<number>]>} Uniforms
 * @typedef {{mode:number, lo:number, hi:number, maxSteps:number, rCam:number, storeH:boolean,
 *   emission?: import('../fluid/emission.js').EmissionParams, exposure?: number, toneMap?: number, colorMap?: number,
 *   time?: DisplayTime, tail?: TailGeometry|null, envelope?: 'coordinate'|'circumferential', azimuth?: number}} DisplayView
 *   azimuth: camera azimuth in rad, display-only (Stage 1B B5)
 * @typedef {import('./traceConfig.js').TailGeometry} TailGeometry
 * @typedef {{tObs:number, slow:boolean, M:number, advect:number, sigma:number}} DisplayTime
 *   observer time t_obs / M, slow light, M_ADM, procedural-advection duration D / M (0: off), noise amplitude sigma_n
 *
 * @typedef {{tex: Map<number, unknown[]>, strides: number[], w: number, h: number, bytes: number}} CacheHandle
 *
 * @typedef {Object} Backend
 * @property {'webgl2'|'webgpu'} kind
 * @property {(name:string) => Promise<void>} setTracer             trace program, e.g. 'trace_kerr_analytic'
 * @property {(w:number, h:number) => void} resize                    record (and canvas) size in pixels
 * @property {(u:Uniforms) => void} uploadUniforms                    trace uniforms for the next tiles
 * @property {(t:import('../bake/bake.js').BakedTables) => void} uploadTables  metric tables of the tabulated tracer
 * @property {(f:import('../fluid/fluidTable.js').FluidTable) => void} uploadFluid  fluid four-velocity table (both tracers)
 * @property {(f:import('../noise/noiseField.js').NoiseField) => void} uploadNoise  noise field (3D texture), display pass
 * @property {(strides?:number[]) => void} clearRecords                mark every pixel untraced; the strides the next trace uses
 * @property {(stride:number) => {w:number, h:number}} levelSize   size of the progressive level `stride` (1, 2, 4, 8)
 * @property {(rect:Rect, stride:number, toCompact?:boolean) => Promise<{wallMs:number, gpuMs:Promise<number|null>}>} traceTile
 *   trace the pixels of `rect` (in that level's pixels) of the level image `stride`; toCompact: `rect` of the compact
 *   image of the unfinished rays (Stage 1B B5 ray compaction)
 * @property {() => boolean} compactSupported                          ray compaction available (8 draw buffers)
 * @property {(mode:number, limit:number) => void} setCompactPhase     next tiles: 0 off, 1 stop rays at `limit` steps (0: never)
 * @property {(stride:number) => Promise<number>} compactList         list the unfinished rays of a level (async read-back); their number
 * @property {() => {w:number, h:number, M:number}|null} compactSize  the compact image of the current list
 * @property {() => void} scatterCompact                              copy the compact records back to their pixels
 * @property {(set:0|1, w?:number, h?:number) => void} useRecordSet  0: the displayed records; 1: a background set of size w x h
 *   (Stage 1B B5 idle pre-tracing); later trace/clear/read/compaction calls act on it
 * @property {(strides:number[]) => CacheHandle} cacheStore           copy the record levels of the current set (record cache)
 * @property {(h:CacheHandle) => void} cacheRestore                   copy cached levels into the displayed set and show them
 * @property {(h:CacheHandle) => void} cacheFree
 * @property {(view:DisplayView) => void} display
 * @property {(stride?:number) => Promise<Float32Array>} readRecords  one level (default full resolution), 24 floats per pixel (RECORD_FLOATS), row 0 = bottom
 * @property {() => Promise<number>} readSteps                        total RK4 steps of the image
 * @property {() => void} pollTiming                                  resolve finished GPU timer queries
 * @property {() => Record<string, unknown>} capabilities
 * @property {() => {traceMs:number|null, displayMs:number|null}} timing
 */

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{onStage?: (stage: string) => void}} [opts]  startup progress messages
 * @returns {Promise<Backend>}
 */
export async function createBackend(canvas, opts = {}) {
  const { createWebGL2Backend } = await import('./backendWebGL2.js');
  return createWebGL2Backend(canvas, opts);
}
