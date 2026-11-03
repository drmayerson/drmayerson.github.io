// @ts-check
// WebGL2 side of the M0 benchmark: full-screen triangle into one RGBA32F target,
// one draw per tile (scissor), fence + poll per tile, optional GPU timer queries.
import { tiles } from './setup.js';

const VERT = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

/** Yield to the event loop without the setTimeout clamp. */
const yieldNow = () => new Promise((res) => {
  const ch = new MessageChannel();
  ch.port1.onmessage = () => res(undefined);
  ch.port2.postMessage(0);
});

export class GLBench {
  /** @param {string} fragSource */
  constructor(fragSource) {
    this.fragSource = fragSource;
    /** @type {WebGL2RenderingContext|null} */
    this.gl = null;
    this.error = '';
  }

  /** @returns {boolean} */
  init() {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const gl = canvas.getContext('webgl2', { antialias: false, depth: false, powerPreference: 'high-performance' });
    if (!gl) { this.error = 'WebGL2 is missing in this browser.'; return false; }
    if (!gl.getExtension('EXT_color_buffer_float')) { this.error = 'WebGL2 is present but EXT_color_buffer_float is missing.'; return false; }
    this.timerExt = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    this.device = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    const prog = gl.createProgram();
    for (const [type, src] of [[gl.VERTEX_SHADER, VERT], [gl.FRAGMENT_SHADER, this.fragSource]]) {
      const sh = /** @type {WebGLShader} */ (gl.createShader(/** @type {number} */ (type)));
      gl.shaderSource(sh, /** @type {string} */ (src));
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) { this.error = 'GLSL compile error: ' + gl.getShaderInfoLog(sh); return false; }
      gl.attachShader(prog, sh);
    }
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { this.error = 'GLSL link error: ' + gl.getProgramInfoLog(prog); return false; }
    this.prog = prog;
    this.vao = gl.createVertexArray();
    /** @type {Record<string, WebGLUniformLocation|null>} */
    this.loc = {};
    for (const n of ['uE', 'uG', 'uScreen', 'uP0', 'uP1', 'uI']) this.loc[n] = gl.getUniformLocation(prog, n);
    this.gl = gl;
    return true;
  }

  /**
   * @param {import('./setup.js').BenchUniforms} U
   * @param {number} N @param {number} tile
   * @returns {Promise<{wallMs:number, gpuMs:number|null, rec:Float32Array}>}
   */
  async run(U, N, tile) {
    const gl = /** @type {WebGL2RenderingContext} */ (this.gl);
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, N, N);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('RGBA32F framebuffer incomplete');

    gl.useProgram(/** @type {WebGLProgram} */ (this.prog));
    gl.bindVertexArray(this.vao);
    const L = /** @type {Record<string, WebGLUniformLocation>} */ (this.loc);
    gl.uniformMatrix4fv(L.uE, false, U.E);
    gl.uniformMatrix4fv(L.uG, false, U.G);
    gl.uniform4fv(L.uScreen, U.screen);
    gl.uniform4fv(L.uP0, U.p0);
    gl.uniform4fv(L.uP1, U.p1);
    gl.uniform4i(L.uI, 0, 0, N, U.maxSteps);
    gl.viewport(0, 0, N, N);
    gl.enable(gl.SCISSOR_TEST);
    gl.finish();

    const ext = this.timerExt;
    const queries = [];
    const t0 = performance.now();
    for (const t of tiles(N, tile)) {
      gl.scissor(t.x, t.y, t.w, t.h);
      let q = null;
      if (ext) { q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q); }
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (ext) { gl.endQuery(ext.TIME_ELAPSED_EXT); queries.push(q); }
      const sync = /** @type {WebGLSync} */ (gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0));
      gl.flush();
      for (;;) {
        const st = gl.clientWaitSync(sync, 0, 0);
        if (st === gl.ALREADY_SIGNALED || st === gl.CONDITION_SATISFIED) break;
        if (st === gl.WAIT_FAILED) throw new Error('clientWaitSync failed');
        await yieldNow();
      }
      gl.deleteSync(sync);
    }
    const wallMs = performance.now() - t0;
    gl.disable(gl.SCISSOR_TEST);

    const rec = new Float32Array(N * N * 4);
    gl.readPixels(0, 0, N, N, gl.RGBA, gl.FLOAT, rec);

    let gpuMs = null;
    if (ext && queries.length) {
      // results become available shortly after the fence; poll a little
      for (let k = 0; k < 200 && !gl.getQueryParameter(queries[queries.length - 1], gl.QUERY_RESULT_AVAILABLE); k++) await yieldNow();
      const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
      if (!disjoint && gl.getQueryParameter(queries[queries.length - 1], gl.QUERY_RESULT_AVAILABLE)) {
        gpuMs = 0;
        for (const q of queries) gpuMs += gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6;
      }
      for (const q of queries) gl.deleteQuery(q);
    }
    gl.deleteFramebuffer(fbo);
    gl.deleteTexture(tex);
    return { wallMs, gpuMs, rec };
  }
}
