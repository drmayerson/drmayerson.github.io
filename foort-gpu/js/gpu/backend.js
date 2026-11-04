// @ts-check
// Backend interface (plan Section 3.1). Physics and UI code talk only to this interface;
// the Stage 1 backend is WebGL2 (decision D2, backendWebGL2.js). A WebGPU backend (M10 or
// Stage 2) implements the same methods.

/**
 * @typedef {{x:number, y:number, w:number, h:number}} Rect
 * @typedef {Record<string, ['4f'|'4i'|'m4', ArrayLike<number>]>} Uniforms
 * @typedef {{mode:number, lo:number, hi:number, maxSteps:number, rCam:number, storeH:boolean}} DisplayView
 *
 * @typedef {Object} Backend
 * @property {'webgl2'|'webgpu'} kind
 * @property {(name:string) => Promise<void>} setTracer             trace program, e.g. 'trace_kerr_analytic'
 * @property {(w:number, h:number) => void} resize                    record (and canvas) size in pixels
 * @property {(u:Uniforms) => void} uploadUniforms                    trace uniforms for the next tiles
 * @property {(t:import('../bake/bake.js').BakedTables) => void} uploadTables  metric tables of the tabulated tracer
 * @property {() => void} clearRecords                                mark every pixel untraced
 * @property {(stride:number) => {w:number, h:number}} levelSize   size of the progressive level `stride` (1, 2, 4, 8)
 * @property {(rect:Rect, stride:number) => Promise<{wallMs:number, gpuMs:Promise<number|null>}>} traceTile
 *   trace the pixels of `rect` (in that level's pixels) of the level image `stride`
 * @property {(view:DisplayView) => void} display
 * @property {() => Promise<Float32Array>} readRecords                full-resolution level, 16 floats per pixel, row 0 = bottom (tests)
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
