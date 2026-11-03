// @ts-check
// Backend interface (plan Section 3.1). Only the type is defined at M0; the chosen
// backend (decision D2 at CHECKPOINT M0) is implemented from M3 on, in
// backendWebGL2.js or backendWebGPU.js, and physics/UI code talks only to this interface.

/**
 * @typedef {{x:number, y:number, w:number, h:number}} Rect
 *
 * @typedef {Object} Backend
 * @property {'webgl2'|'webgpu'} kind
 * @property {(name:string, data:Float32Array, w:number, h:number) => void} uploadTable2D
 * @property {(name:string, data:ArrayBufferView, nx:number, ny:number, nz:number, format:string) => void} uploadTexture3D
 * @property {(obj:Record<string, number|number[]|Float32Array>) => void} uploadUniforms
 * @property {(rect:Rect, levelOfDetail:number) => Promise<void>} traceTile
 * @property {(time:number, viewParams:Record<string, unknown>) => void} display
 * @property {(rect:Rect) => Promise<Float32Array>} readRecords     for tests
 * @property {() => Record<string, unknown>} capabilities
 * @property {() => {traceMs:number|null, displayMs:number|null}} timing
 */

/**
 * @param {HTMLCanvasElement} _canvas
 * @returns {Promise<Backend>}
 */
export async function createBackend(_canvas) {
  throw new Error('No backend implemented yet (M3).');
}
