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
 * @param {{shaderBase?: string, onStage?: (stage: string) => void}} [opts]  URL of the shaders/ folder; startup progress
 * @returns {Promise<import('./backend.js').Backend>}
 */
export async function createWebGL2Backend(canvas, opts = {}) {
  const stage = opts.onStage ?? (() => {});
  stage('creating the WebGL2 context…');
  const base = opts.shaderBase ?? new URL('../../shaders/glsl/', import.meta.url).href;
  const gl = canvas.getContext('webgl2', { antialias: false, depth: false, alpha: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
  if (!gl) throw new Error('WebGL2 is not available in this browser.');
  if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('WebGL2 is available but EXT_color_buffer_float is missing (needed for float records).');
  if (gl.getParameter(gl.MAX_DRAW_BUFFERS) < 4) throw new Error('WebGL2 MAX_DRAW_BUFFERS < 4.');
  if (gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS) < 16) throw new Error('WebGL2 MAX_TEXTURE_IMAGE_UNITS < 16.');
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
  stage('loading shaders…');
  // fetch every shader source at once (the trace programs are compiled on first use)
  await Promise.all(['common', 'display', 'trace', 'trace_kerr_analytic'].map(load));
  const common = await load('common');
  stage('compiling the display shader…');
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
  /** @type {WebGLTexture|null} */
  let tableTex = null, fluidTex = null, noiseTex = null, tableValTex = null, tableDerTex = null;
  /** fluid-table grid (display: Omega for procedural advection) */
  let fluidGrid = /** @type {{xMin:number, dx:number, n:number, r0:number}|null} */ (null);
  /** noise field on the GPU */
  let noiseMeta = /** @type {import('../noise/noiseField.js').NoiseMeta|null} */ (null);
  /** strides of the current trace (the display binds at most 3 levels, finest first) */
  let activeStrides = [1, 2, 4];
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
      // variants: '<file>_half' = <file>.glsl with TABLE_HALF defined (half-float derivative tables, M9 accuracy trade)
      const half = name.endsWith('_half'), file = half ? name.slice(0, -5) : name;
      if (!tracePrograms.has(name)) tracePrograms.set(name, build(HEADER + (half ? '#define TABLE_HALF 1\n' : '') + await load(file) + '\n' + common, `${name}: ${file}.glsl + common.glsl`));
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

    uploadTables(T) {
      const g = T.grid;
      gl.activeTexture(gl.TEXTURE0);
      // a fresh storage allocation per upload (texStorage is immutable; sizes may change)
      if (tableTex) gl.deleteTexture(tableTex);
      tableTex = gl.createTexture();
      // bake layout [k][j][i] -> texture rows 5 j + k (the five functions of a node in adjacent rows)
      if (5 * g.nth > gl.getParameter(gl.MAX_TEXTURE_SIZE) || g.nx > gl.getParameter(gl.MAX_TEXTURE_SIZE)) throw new Error(`metric table ${g.nx} x ${g.nth} exceeds MAX_TEXTURE_SIZE`);
      // the derivative channels are stored pre-multiplied by the cell size, (f, f_x dx, f_theta dth, f_xtheta dx dth):
      // the Hermite weights in trace.glsl then need no per-lookup scaling (done once here, in double, before rounding)
      const packed = new Float32Array(T.data.length), row = 4 * g.nx;
      const sc = [1, g.dx, g.dth, g.dx * g.dth];
      for (let k = 0; k < 5; k++) for (let j = 0; j < g.nth; j++) {
        const src = (k * g.nth + j) * row, dst = (5 * j + k) * row;
        for (let q = 0; q < row; q++) packed[dst + q] = T.data[src + q] * sc[q & 3];
      }
      gl.bindTexture(gl.TEXTURE_2D, tableTex);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, g.nx, 5 * g.nth);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, g.nx, 5 * g.nth, gl.RGBA, gl.FLOAT, packed);
      for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, p, gl.NEAREST);
      // the same data split for the half-float variant (M9 accuracy trade): values R32F, derivatives RGBA16F
      const vals = new Float32Array(g.nx * 5 * g.nth), ders = new Float32Array(4 * g.nx * 5 * g.nth);
      for (let n = 0; n < vals.length; n++) { vals[n] = packed[4 * n]; ders[4 * n] = packed[4 * n + 1]; ders[4 * n + 1] = packed[4 * n + 2]; ders[4 * n + 2] = packed[4 * n + 3]; }
      for (const t of [tableValTex, tableDerTex]) if (t) gl.deleteTexture(t);
      tableValTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tableValTex);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R32F, g.nx, 5 * g.nth);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, g.nx, 5 * g.nth, gl.RED, gl.FLOAT, vals);
      for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, p, gl.NEAREST);
      tableDerTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tableDerTex);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA16F, g.nx, 5 * g.nth);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, g.nx, 5 * g.nth, gl.RGBA, gl.FLOAT, ders);
      for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, p, gl.NEAREST);
    },

    uploadFluid(F) {
      gl.activeTexture(gl.TEXTURE0);
      if (fluidTex) gl.deleteTexture(fluidTex);
      fluidTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, fluidTex);
      fluidGrid = F.grid;
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, F.grid.n, 1);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, F.grid.n, 1, gl.RGBA, gl.FLOAT, F.data);
      for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, p, gl.NEAREST);
    },

    uploadNoise(F) {
      const m = F.meta;
      const max3 = gl.getParameter(gl.MAX_3D_TEXTURE_SIZE);
      if (Math.max(m.Nt, m.Nx, m.Nphi) > max3) throw new Error(`noise field ${m.Nphi} x ${m.Nx} x ${m.Nt} exceeds MAX_3D_TEXTURE_SIZE ${max3}`);
      gl.activeTexture(gl.TEXTURE0);
      if (noiseTex) gl.deleteTexture(noiseTex);
      noiseTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_3D, noiseTex);
      // C order (t, x, phi) = texel (phi, x, t): width Nphi, height Nx, depth Nt; R16F is filterable in WebGL2
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage3D(gl.TEXTURE_3D, 0, gl.R16F, m.Nphi, m.Nx, m.Nt, 0, gl.RED, gl.HALF_FLOAT, F.half);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.REPEAT);          // phi
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);   // x
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.REPEAT);          // t
      gl.bindTexture(gl.TEXTURE_3D, null);
      noiseMeta = m;
    },

    clearRecords(strides) {
      if (strides) activeStrides = [...strides].sort((a, b) => a - b).slice(0, 3);
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
      if (tracer.loc('uTables')) {
        if (!tableTex) throw new Error('uploadTables first');
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, tableTex);
        gl.uniform1i(tracer.loc('uTables'), 0);
      }
      if (tracer.loc('uTablesV')) {
        if (!tableValTex || !tableDerTex) throw new Error('uploadTables first');
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, tableValTex);
        gl.uniform1i(tracer.loc('uTablesV'), 0);
        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, tableDerTex);
        gl.uniform1i(tracer.loc('uTablesD'), 2);
      }
      if (!fluidTex) throw new Error('uploadFluid first');
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, fluidTex);
      gl.uniform1i(tracer.loc('uFluid'), 1);
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
      // the four record attachments of the (at most 3) levels of the current trace, finest first: 12 units,
      // plus the noise field and the fluid table (16 texture units is the WebGL2 minimum)
      let unit = 0;
      const lv = [-1, -1, -1, -1];
      const bound = activeStrides.filter((st) => levels.has(st));
      if (!bound.length) return;   // no records yet (before the first resize)
      bound.forEach((st, li) => {
        const L = /** @type {{tex: WebGLTexture[]}} */ (levels.get(st));
        lv[li] = Math.round(Math.log2(st));
        for (const k of [0, 1, 2, 3]) {
          gl.activeTexture(gl.TEXTURE0 + unit);
          gl.bindTexture(gl.TEXTURE_2D, L.tex[k]);
          gl.uniform1i(display.loc(`uS${li}R${k}`), unit++);
        }
      });
      // unused slots still need a valid 2D texture bound to their samplers
      for (let li = bound.length; li < 3; li++) for (const k of [0, 1, 2, 3]) gl.uniform1i(display.loc(`uS${li}R${k}`), k);
      gl.uniform4i(display.loc('uLevels'), lv[0], lv[1], lv[2], -1);
      gl.activeTexture(gl.TEXTURE0 + 12);
      gl.bindTexture(gl.TEXTURE_3D, noiseTex);
      gl.uniform1i(display.loc('uNoise'), 12);
      gl.activeTexture(gl.TEXTURE0 + 13);
      gl.bindTexture(gl.TEXTURE_2D, fluidTex);
      gl.uniform1i(display.loc('uFluidD'), 13);
      const fg = fluidGrid ?? { xMin: 0, dx: 1, n: 2, r0: 0 };
      gl.uniform4f(display.loc('uFluidXD'), fg.xMin, fg.dx, fg.n, fg.r0);
      const nm = noiseMeta, tm = view.time ?? { tObs: 0, slow: true, M: 1, advect: 0, sigma: 0 };
      gl.uniform4i(display.loc('uNoiseN'), nm?.Nt ?? 2, nm?.Nx ?? 2, nm?.Nphi ?? 2, nm && noiseTex && fluidTex ? 1 : 0);
      gl.uniform4f(display.loc('uNoiseP'), tm.sigma, nm?.T_over_M ?? 1, nm?.xmin ?? 0, nm?.xmax ?? 1);
      gl.uniform4f(display.loc('uTime'), tm.tObs, tm.slow ? 1 : 0, tm.M, tm.advect);
      gl.uniform4i(display.loc('uView'), view.mode, W, H, view.storeH ? 1 : 0);
      gl.uniform4f(display.loc('uRange'), view.lo, view.hi, view.maxSteps, view.rCam);
      const em = view.emission ?? { mu: 0, gamma: 0, sigma: 1, redshiftPower: 3, fudge: 1, maxPasses: 0 };
      gl.uniform4f(display.loc('uEm'), em.mu, em.gamma, em.sigma, em.redshiftPower);
      gl.uniform4f(display.loc('uEm2'), em.fudge, em.maxPasses, view.exposure ?? 1, view.toneMap ?? 0);
      gl.uniform4i(display.loc('uEm3'), view.colorMap ?? 0, 0, 0, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      lastDisplayMs = performance.now() - t0;
    },

    async readRecords(stride = 1) {
      const L = /** @type {{fbo: WebGLFramebuffer, w: number, h: number}} */ (levels.get(stride));
      gl.bindFramebuffer(gl.FRAMEBUFFER, L.fbo);
      const out = new Float32Array(16 * L.w * L.h);
      const one = new Float32Array(4 * L.w * L.h);
      for (let k = 0; k < 4; k++) {
        gl.readBuffer(gl.COLOR_ATTACHMENT0 + k);
        gl.readPixels(0, 0, L.w, L.h, gl.RGBA, gl.FLOAT, one);
        for (let p = 0; p < L.w * L.h; p++) for (let c = 0; c < 4; c++) out[16 * p + 4 * k + c] = one[4 * p + c];
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
