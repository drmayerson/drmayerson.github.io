// @ts-check
// WebGL2 backend (decision D2). Trace pass: full-screen triangle into four RGBA32F colour
// attachments (the 16-float record) of one progressive level, restricted to a tile with scissor; fence + poll per tile;
// GPU timer queries where available. Display pass: draws a view of the record to the canvas.
// Shader sources are fetched at runtime from shaders/glsl/ (no build step).

const VERT = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;
const HEADER = '#version 300 es\nprecision highp float;\nprecision highp int;\n';

/** Yield to the event loop without the setTimeout clamp. */
const yieldNow = () => new Promise((res) => {
  const ch = new MessageChannel();
  ch.port1.onmessage = () => res(undefined);
  ch.port2.postMessage(0);
});

/**
 * @param {HTMLCanvasElement} canvas  display canvas; its size is set to the record size
 * @param {{shaderBase?: string}} [opts]  URL of the shaders/ folder
 * @returns {Promise<import('./backend.js').Backend>}
 */
export async function createWebGL2Backend(canvas, opts = {}) {
  const base = opts.shaderBase ?? new URL('../../shaders/glsl/', import.meta.url).href;
  const gl = canvas.getContext('webgl2', { antialias: false, depth: false, alpha: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
  if (!gl) throw new Error('WebGL2 is not available in this browser.');
  if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('WebGL2 is available but EXT_color_buffer_float is missing (needed for float records).');
  if (gl.getParameter(gl.MAX_DRAW_BUFFERS) < 4) throw new Error('WebGL2 MAX_DRAW_BUFFERS < 4.');
  if (gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS) < 12) throw new Error('WebGL2 MAX_TEXTURE_IMAGE_UNITS < 12.');
  const timerExt = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const renderer = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);

  /** @type {Record<string, string>} */
  const sources = {};
  const load = async (/** @type {string} */ name) => {
    if (!(name in sources)) {
      const res = await fetch(new URL(`${name}.glsl`, base));
      if (!res.ok) throw new Error(`cannot load shader ${name}.glsl (${res.status})`);
      sources[name] = await res.text();
    }
    return sources[name];
  };

  /** @param {string} frag @param {string} label */
  const build = (frag, label) => {
    const prog = /** @type {WebGLProgram} */ (gl.createProgram());
    for (const [type, src] of /** @type {[number, string][]} */ ([[gl.VERTEX_SHADER, VERT], [gl.FRAGMENT_SHADER, frag]])) {
      const sh = /** @type {WebGLShader} */ (gl.createShader(type));
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(`${label}: GLSL compile error\n${gl.getShaderInfoLog(sh)}`);
      gl.attachShader(prog, sh);
    }
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(`${label}: GLSL link error\n${gl.getProgramInfoLog(prog)}`);
    /** @type {Map<string, WebGLUniformLocation|null>} */
    const loc = new Map();
    return { prog, loc: (/** @type {string} */ n) => { if (!loc.has(n)) loc.set(n, gl.getUniformLocation(prog, n)); return loc.get(n) ?? null; } };
  };

  /** @type {Map<string, ReturnType<typeof build>>} */
  const tracePrograms = new Map();
  const common = await load('common');
  const display = build(HEADER + await load('display'), 'display.glsl');
  const vao = gl.createVertexArray();

  // one record set (4 RGBA32F targets) per progressive level, stride s -> ceil(N / s)^2 pixels:
  // a coarse level traced as a compact image keeps every SIMD lane busy (a strided pass over the
  // full image costs as much as a full trace, since a wave runs as long as its longest ray)
  const STRIDES = [1, 2, 4, 8];
  /** @type {Map<number, {fbo: WebGLFramebuffer, tex: WebGLTexture[], w: number, h: number}>} */
  const levels = new Map();
  let W = 0, H = 0;
  /** @type {ReturnType<typeof build>|null} */
  let tracer = null;
  /** @type {Record<string, ['4f'|'4i'|'m4', ArrayLike<number>]>} */
  let traceUniforms = {};
  let lastTraceMs = /** @type {number|null} */ (null), lastDisplayMs = /** @type {number|null} */ (null);
  /** @type {{q: WebGLQuery, done: (ms: number|null) => void}[]} */
  const pendingQueries = [];

  const pollQueries = () => {
    if (!timerExt) return;
    const disjoint = gl.getParameter(timerExt.GPU_DISJOINT_EXT);
    while (pendingQueries.length && gl.getQueryParameter(pendingQueries[0].q, gl.QUERY_RESULT_AVAILABLE)) {
      const { q, done } = /** @type {{q: WebGLQuery, done: (ms: number|null) => void}} */ (pendingQueries.shift());
      done(disjoint ? null : gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6);
      gl.deleteQuery(q);
    }
  };

  /** @param {ReturnType<typeof build>} p @param {Record<string, ['4f'|'4i'|'m4', ArrayLike<number>]>} u */
  const setUniforms = (p, u) => {
    for (const [name, [type, val]] of Object.entries(u)) {
      const l = p.loc(name);
      if (!l) continue;
      if (type === '4f') gl.uniform4fv(l, Array.from(val));
      else if (type === '4i') gl.uniform4iv(l, Array.from(val, (x) => Math.round(x)));
      else gl.uniformMatrix4fv(l, false, Float32Array.from(val));
    }
  };

  /** @type {import('./backend.js').Backend} */
  const backend = {
    kind: 'webgl2',

    async setTracer(name) {
      if (!tracePrograms.has(name)) tracePrograms.set(name, build(HEADER + await load(name) + '\n' + common, `${name}.glsl + common.glsl`));
      tracer = /** @type {ReturnType<typeof build>} */ (tracePrograms.get(name));
    },

    resize(w, h) {
      if (w === W && h === H) return;
      for (const L of levels.values()) { for (const t of L.tex) gl.deleteTexture(t); gl.deleteFramebuffer(L.fbo); }
      levels.clear();
      for (const st of STRIDES) {
        const lw = Math.ceil(w / st), lh = Math.ceil(h / st);
        const fbo = /** @type {WebGLFramebuffer} */ (gl.createFramebuffer());
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        const tex = [0, 1, 2, 3].map((k) => {
          const t = /** @type {WebGLTexture} */ (gl.createTexture());
          gl.bindTexture(gl.TEXTURE_2D, t);
          gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, lw, lh);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
          gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + k, gl.TEXTURE_2D, t, 0);
          return t;
        });
        gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2, gl.COLOR_ATTACHMENT3]);
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('RGBA32F MRT framebuffer incomplete');
        levels.set(st, { fbo, tex, w: lw, h: lh });
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      W = w; H = h;
      canvas.width = w; canvas.height = h;
    },

    levelSize(stride) {
      const L = levels.get(stride);
      if (!L) throw new Error(`unsupported stride ${stride} (${STRIDES.join(', ')})`);
      return { w: L.w, h: L.h };
    },

    uploadUniforms(u) { traceUniforms = u; },

    clearRecords() {
      const z = new Float32Array(4);
      for (const L of levels.values()) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, L.fbo);
        for (let k = 0; k < 4; k++) gl.clearBufferfv(gl.COLOR, k, z);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    },

    async traceTile(rect, stride) {
      if (!tracer) throw new Error('setTracer first');
      const L = /** @type {{fbo: WebGLFramebuffer, w: number, h: number}} */ (levels.get(stride));
      gl.bindFramebuffer(gl.FRAMEBUFFER, L.fbo);
      gl.viewport(0, 0, L.w, L.h);
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(rect.x, rect.y, rect.w, rect.h);
      gl.useProgram(tracer.prog);
      gl.bindVertexArray(vao);
      setUniforms(tracer, traceUniforms);
      gl.uniform4i(tracer.loc('uImg'), L.w, L.h, 0, 0);
      /** @type {Promise<number|null>} */
      let gpu = Promise.resolve(null);
      if (timerExt) {
        const q = /** @type {WebGLQuery} */ (gl.createQuery());
        gl.beginQuery(timerExt.TIME_ELAPSED_EXT, q);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.endQuery(timerExt.TIME_ELAPSED_EXT);
        gpu = new Promise((done) => pendingQueries.push({ q, done }));
      } else gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.disable(gl.SCISSOR_TEST);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      const sync = /** @type {WebGLSync} */ (gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0));
      gl.flush();
      const t0 = performance.now();
      for (;;) {
        const st = gl.clientWaitSync(sync, 0, 0);
        if (st === gl.ALREADY_SIGNALED || st === gl.CONDITION_SATISFIED) break;
        if (st === gl.WAIT_FAILED) throw new Error('clientWaitSync failed');
        if (gl.isContextLost()) throw new Error('WebGL context lost (GPU watchdog?)');
        await yieldNow();
      }
      gl.deleteSync(sync);
      const wallMs = performance.now() - t0;
      pollQueries();
      lastTraceMs = wallMs;
      return { wallMs, gpuMs: gpu };
    },

    display(view) {
      const t0 = performance.now();
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, W, H);
      gl.useProgram(display.prog);
      gl.bindVertexArray(vao);
      // per level the attachments the views read: 0 (all), 1 (crossing 1), 3 (|H|)
      let unit = 0;
      STRIDES.forEach((st, li) => {
        const L = /** @type {{tex: WebGLTexture[]}} */ (levels.get(st));
        for (const k of [0, 1, 3]) {
          gl.activeTexture(gl.TEXTURE0 + unit);
          gl.bindTexture(gl.TEXTURE_2D, L.tex[k]);
          gl.uniform1i(display.loc(`uL${li}R${k}`), unit++);
        }
      });
      gl.uniform4i(display.loc('uView'), view.mode, W, H, view.storeH ? 1 : 0);
      gl.uniform4f(display.loc('uRange'), view.lo, view.hi, view.maxSteps, view.rCam);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      lastDisplayMs = performance.now() - t0;
    },

    async readRecords() {
      gl.bindFramebuffer(gl.FRAMEBUFFER, /** @type {{fbo: WebGLFramebuffer}} */ (levels.get(1)).fbo);
      const out = new Float32Array(16 * W * H);
      const one = new Float32Array(4 * W * H);
      for (let k = 0; k < 4; k++) {
        gl.readBuffer(gl.COLOR_ATTACHMENT0 + k);
        gl.readPixels(0, 0, W, H, gl.RGBA, gl.FLOAT, one);
        for (let p = 0; p < W * H; p++) for (let c = 0; c < 4; c++) out[16 * p + 4 * k + c] = one[4 * p + c];
      }
      gl.readBuffer(gl.COLOR_ATTACHMENT0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return out;
    },

    async readSteps() {
      gl.bindFramebuffer(gl.FRAMEBUFFER, /** @type {{fbo: WebGLFramebuffer}} */ (levels.get(1)).fbo);
      gl.readBuffer(gl.COLOR_ATTACHMENT0);
      const one = new Float32Array(4 * W * H);
      gl.readPixels(0, 0, W, H, gl.RGBA, gl.FLOAT, one);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      let s = 0;
      for (let p = 1; p < one.length; p += 4) s += one[p];
      return s;
    },

    pollTiming: pollQueries,

    capabilities: () => ({ renderer, timerQueries: !!timerExt, maxTexture: gl.getParameter(gl.MAX_TEXTURE_SIZE) }),
    timing: () => ({ traceMs: lastTraceMs, displayMs: lastDisplayMs }),
  };
  return backend;
}
