// @ts-check
// WebGL2 backend (decision D2). Trace pass: full-screen triangle into four RGBA32F colour
// attachments (the 16-float record) of one progressive level, restricted to a tile with scissor; fence + poll per tile;
// GPU timer queries where available. Display pass: draws a view of the record to the canvas.
// Shader sources are fetched at runtime from shaders/glsl/ (no build step).

import { noiseFadeWidth } from '../noise/noiseField.js';

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
  // Stage 1B B2: the record is 4 RGBA32F attachments + 2 for the tail bins (8 bins), when the device has >= 6 draw
  // buffers (typically 8); otherwise the tail is off (TAIL_BINS 0) and the performance table says so
  const TAIL_BINS = gl.getParameter(gl.MAX_DRAW_BUFFERS) >= 6 ? 8 : 0;
  // Stage 1B B5 ray compaction: 2 more attachments (continuation state, tail centroids) where 8 draw buffers exist
  const COMPACT_OK = TAIL_BINS > 0 && gl.getParameter(gl.MAX_DRAW_BUFFERS) >= 8;
  const NATT = COMPACT_OK ? 8 : TAIL_BINS ? 6 : 4;
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
  /** B7: noise fields by name, and fluid-table textures by key (compare mode draws two views per frame) */
  const noiseSet = /** @type {Map<string, {tex: WebGLTexture, meta: any}>} */ (new Map());
  const fluidSet = /** @type {Map<string, {tex: WebGLTexture, grid: any}>} */ (new Map());
  /** @param {import('../fluid/fluidTable.js').FluidTable} F @param {string} key */
  const fluidFor = (F, key) => {
    let e = fluidSet.get(key);
    if (!e) {
      const tex = /** @type {WebGLTexture} */ (gl.createTexture());
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, F.grid.n, 1);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, F.grid.n, 1, gl.RGBA, gl.FLOAT, F.data);
      for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, p, gl.NEAREST);
      e = { tex, grid: F.grid };
      fluidSet.set(key, e);
      // keep a few
      if (fluidSet.size > 6) { const [k0, e0] = /** @type {[string, {tex: WebGLTexture}]} */ (fluidSet.entries().next().value); gl.deleteTexture(e0.tex); fluidSet.delete(k0); }
    }
    return e;
  };
  stage('loading shaders…');
  // fetch every shader source at once (the trace programs are compiled on first use)
  await Promise.all(['common', 'display', 'trace', 'trace_kerr_analytic', 'post'].map(load));
  const common = await load('common');
  stage('compiling the display shader…');
  const display = build(HEADER + await load('display'), 'display.glsl');
  // Stage 1B B8 post passes (telescope blur, light-curve reduction, tone map of the linear emission)
  const post = build(HEADER + await load('post'), 'post.glsl');
  /** a float render target @param {number} w @param {number} h */
  const makeTarget = (w, h) => {
    const tex = /** @type {WebGLTexture} */ (gl.createTexture());
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, w, h);
    for (const q of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, q, gl.NEAREST);
    const fbo = /** @type {WebGLFramebuffer} */ (gl.createFramebuffer());
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { tex, fbo, w, h };
  };
  /** per view (compare side) and size: the linear image, the pyramid, blur buffers; created on demand */
  const postTargets = /** @type {Map<string, ReturnType<typeof makeTarget>>} */ (new Map());
  /** @param {string} key @param {number} w @param {number} h */
  const postTarget = (key, w, h) => {
    const k = `${key}:${w}x${h}`;
    let t = postTargets.get(k);
    if (!t) { t = makeTarget(w, h); postTargets.set(k, t); }
    return t;
  };
  /** a post pass from texture `srcT` (size sw x sh) into `dst` (null: the canvas viewport set by the caller) */
  const postPass = (/** @type {number} */ mode, /** @type {{tex: WebGLTexture, w: number, h: number}} */ srcT, /** @type {{fbo: WebGLFramebuffer, w: number, h: number}|null} */ dst, /** @type {Record<string, number[]>} */ u = {}) => {
    gl.useProgram(post.prog);
    gl.bindVertexArray(vao);
    if (dst) { gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo); gl.viewport(0, 0, dst.w, dst.h); gl.disable(gl.SCISSOR_TEST); }
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, srcT.tex);
    gl.uniform1i(post.loc('uSrc'), 0);
    gl.uniform4i(post.loc('uP'), mode, srcT.w, srcT.h, (u.k ?? [0])[0]);
    gl.uniform4f(post.loc('uBlur'), ...(/** @type {[number, number, number, number]} */ (u.blur ?? [1, 0, 1, 0])));
    gl.uniform4f(post.loc('uTone'), ...(/** @type {[number, number, number, number]} */ (u.tone ?? [1, 0, 0, 0])));
    gl.uniform4i(post.loc('uOrigin'), ...(/** @type {[number, number, number, number]} */ (u.origin ?? [0, 0, 0, 0])));
    gl.uniform4i(post.loc('uFull'), ...(/** @type {[number, number, number, number]} */ (u.full ?? [srcT.w, srcT.h, 0, 0])));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };
  /** wait (without blocking the page) until the GPU has done everything queued so far */
  const fenceDone = async () => {
    const sync = /** @type {WebGLSync} */ (gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0));
    gl.flush();
    for (;;) {
      const st = gl.clientWaitSync(sync, 0, 0);
      if (st === gl.ALREADY_SIGNALED || st === gl.CONDITION_SATISFIED) break;
      if (st === gl.WAIT_FAILED) throw new Error('clientWaitSync failed');
      if (gl.isContextLost()) throw new Error('WebGL context lost (GPU watchdog?)');
      await yieldNow();
    }
    gl.deleteSync(sync);
  };
  /** light-curve read-backs in flight (PBO + fence) and the finished ones */
  const lcPending = /** @type {{pbo: WebGLBuffer, sync: WebGLSync, tag: any}[]} */ ([]);
  const lcDone = /** @type {{tag: any, v: Float32Array}[]} */ ([]);
  /** the last image the tone map read per view: the blurred one (2^k times smaller) or the linear one (B8 tests) */
  const lastPost = /** @type {Map<string, {t: {fbo: WebGLFramebuffer, w: number, h: number}, k: number}>} */ (new Map());
  const pollLc = () => {
    while (lcPending.length) {
      const e = lcPending[0];
      const st = gl.clientWaitSync(e.sync, 0, 0);
      if (st !== gl.ALREADY_SIGNALED && st !== gl.CONDITION_SATISFIED) break;
      lcPending.shift();
      gl.deleteSync(e.sync);
      const v = new Float32Array(4);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, e.pbo);
      gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, v);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      gl.deleteBuffer(e.pbo);
      lcDone.push({ tag: e.tag, v });
    }
  };
  const vao = gl.createVertexArray();

  // B5 compaction, scatter pass: one point per listed ray copies its 8 compact record texels to its pixel in the level
  const SCATTER_VS = `#version 300 es
precision highp float; precision highp int;
uniform highp isampler2D uIndex;
uniform ivec4 uSc;   // level width, level height, compact width, 0
flat out ivec2 vC;
void main() {
  int k = gl_VertexID;
  ivec2 c = ivec2(k % uSc.z, k / uSc.z);
  int p = texelFetch(uIndex, c, 0).x;
  vC = c;
  vec2 ij = vec2(float(p % uSc.x), float(p / uSc.x));
  gl_Position = vec4((ij + 0.5) / vec2(uSc.xy) * 2.0 - 1.0, 0.0, 1.0);
  gl_PointSize = 1.0;
}`;
  const SCATTER_FS = `#version 300 es
precision highp float; precision highp int;
uniform highp sampler2D uC0, uC1, uC2, uC3, uC4, uC5, uC6, uC7;
flat in ivec2 vC;
layout(location = 0) out vec4 o0; layout(location = 1) out vec4 o1; layout(location = 2) out vec4 o2; layout(location = 3) out vec4 o3;
layout(location = 4) out vec4 o4; layout(location = 5) out vec4 o5; layout(location = 6) out vec4 o6; layout(location = 7) out vec4 o7;
void main() {
  o0 = texelFetch(uC0, vC, 0); o1 = texelFetch(uC1, vC, 0); o2 = texelFetch(uC2, vC, 0); o3 = texelFetch(uC3, vC, 0);
  o4 = texelFetch(uC4, vC, 0); o5 = texelFetch(uC5, vC, 0); o6 = texelFetch(uC6, vC, 0); o7 = texelFetch(uC7, vC, 0);
}`;
  /** @type {{prog: WebGLProgram, loc: (n: string) => WebGLUniformLocation|null}|null} */
  let scatter = null;
  /** a plain program from vertex and fragment sources @param {string} vs @param {string} fs @param {string} label */
  const buildPlain = (vs, fs, label) => {
    const prog = /** @type {WebGLProgram} */ (gl.createProgram());
    for (const [type, src] of /** @type {[number, string][]} */ ([[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]])) {
      const sh = /** @type {WebGLShader} */ (gl.createShader(type));
      gl.shaderSource(sh, src); gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(`${label}: GLSL compile error\n${gl.getShaderInfoLog(sh)}`);
      gl.attachShader(prog, sh);
    }
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(`${label}: link error\n${gl.getProgramInfoLog(prog)}`);
    /** @type {Map<string, WebGLUniformLocation|null>} */
    const locs = new Map();
    return { prog, loc: (/** @type {string} */ n) => { if (!locs.has(n)) locs.set(n, gl.getUniformLocation(prog, n)); return locs.get(n) ?? null; } };
  };
  // B6 adaptive refinement: the full-resolution record interpolated from a coarse level. Bilinear in the coarse sample
  // grid (clamped at the borders); phi with wrap-around (unit vectors), escape directions on the sphere, the crossing
  // record of corner 0 for the termination code, the tail bins' weights and centroids weight-averaged. Pixels whose cell
  // corners differ in topology are traced instead (js/gpu/refine.js), so no interpolation crosses topologies.
  const INTERP_VS = VERT;
  const INTERP_FS = `#version 300 es
precision highp float; precision highp int;
uniform highp sampler2D uC0, uC1, uC2, uC3, uC4, uC5;
uniform ivec4 uIp;   // coarse stride s, coarse width, coarse height, tail (1/0)
layout(location = 0) out vec4 o0; layout(location = 1) out vec4 o1; layout(location = 2) out vec4 o2; layout(location = 3) out vec4 o3;
layout(location = 4) out vec4 o4; layout(location = 5) out vec4 o5;
const float PI = 3.14159265358979;
ivec2 c00, c10, c01, c11; float fx, fy;
vec4 at(highp sampler2D t, ivec2 c) { return texelFetch(t, c, 0); }
vec4 bil(highp sampler2D t) {
  return mix(mix(at(t, c00), at(t, c10), fx), mix(at(t, c01), at(t, c11), fx), fy);
}
float wrapPhi(float a, float b, float c, float d) {
  vec2 v = mix(mix(vec2(cos(a), sin(a)), vec2(cos(b), sin(b)), fx), mix(vec2(cos(c), sin(c)), vec2(cos(d), sin(d)), fx), fy);
  return mod(atan(v.y, v.x), 2.0 * PI);
}
vec3 dirOf(vec4 r0) { return vec3(sin(r0.z) * cos(r0.w), sin(r0.z) * sin(r0.w), cos(r0.z)); }
vec4 crossing(highp sampler2D t) {
  vec4 a = at(t, c00), b = at(t, c10), c = at(t, c01), d = at(t, c11);
  if (!(a.x > 0.0)) return vec4(0.0);
  vec4 m = mix(mix(a, b, fx), mix(c, d, fx), fy);
  m.y = wrapPhi(a.y, b.y, c.y, d.y);
  return m;
}
// tail bins: W in the high bits, the centroid fraction in the low 8 bits (common.glsl)
vec2 unpackBin(float v) { uint u = floatBitsToUint(v); return vec2(uintBitsToFloat(u & 0xFFFFFF00u), float(u & 0xFFu) / 255.0); }
float packBin(float W, float f) { return W > 0.0 ? uintBitsToFloat((floatBitsToUint(W) & 0xFFFFFF00u) | uint(clamp(f, 0.0, 1.0) * 255.0 + 0.5)) : 0.0; }
vec4 tail(highp sampler2D t) {
  vec4 q[4]; q[0] = at(t, c00); q[1] = at(t, c10); q[2] = at(t, c01); q[3] = at(t, c11);
  float w[4]; w[0] = (1.0 - fx) * (1.0 - fy); w[1] = fx * (1.0 - fy); w[2] = (1.0 - fx) * fy; w[3] = fx * fy;
  vec4 o = vec4(0.0);
  for (int b = 0; b < 4; b++) {
    float W = 0.0, X = 0.0;
    for (int k = 0; k < 4; k++) { vec2 u = unpackBin(q[k][b]); W += w[k] * u.x; X += w[k] * u.x * u.y; }
    o[b] = packBin(W, W > 0.0 ? X / W : 0.0);
  }
  return o;
}
void main() {
  float s = float(uIp.x);
  vec2 u = (gl_FragCoord.xy - 0.5 - 0.5 * (s - 1.0)) / s;   // fine pixel centre in coarse sample units
  ivec2 n = uIp.yz;
  ivec2 i0 = clamp(ivec2(floor(u)), ivec2(0), max(n - 2, ivec2(0)));
  vec2 f = clamp(u - vec2(i0), 0.0, 1.0);
  fx = f.x; fy = f.y;
  ivec2 i1 = min(i0 + 1, n - 1);
  c00 = i0; c10 = ivec2(i1.x, i0.y); c01 = ivec2(i0.x, i1.y); c11 = i1;
  vec4 r00 = at(uC0, c00), r10 = at(uC0, c10), r01 = at(uC0, c01), r11 = at(uC0, c11);
  vec3 d = normalize(mix(mix(dirOf(r00), dirOf(r10), fx), mix(dirOf(r01), dirOf(r11), fx), fy));
  float steps = mix(mix(r00.y, r10.y, fx), mix(r01.y, r11.y, fx), fy);
  o0 = vec4(r00.x, floor(steps + 0.5), acos(clamp(d.z, -1.0, 1.0)), mod(atan(d.y, d.x), 2.0 * PI));
  o1 = crossing(uC1); o2 = crossing(uC2);
  o3 = crossing(uC3);   // (refinement is off when |H| is recorded in this slot)
  if (uIp.w == 1) { o4 = tail(uC4); o5 = tail(uC5); } else { o4 = vec4(0.0); o5 = vec4(0.0); }
}`;
  /** @type {{prog: WebGLProgram, loc: (n: string) => WebGLUniformLocation|null}|null} */
  let interp = null;
  /** the compact image of the current compaction round */
  let compact = /** @type {{fbo: WebGLFramebuffer, tex: WebGLTexture[], index: WebGLTexture, w: number, h: number, M: number, stride: number, fresh: boolean}|null} */ (null);
  /** compaction phase of the next tiles: mode 0 off, 1 stop at the limit, 2 resume the listed rays */
  let compactPhase = { mode: 0, limit: 0 };
  const freeCompact = () => {
    if (!compact) return;
    for (const t of compact.tex) gl.deleteTexture(t);
    gl.deleteTexture(compact.index); gl.deleteFramebuffer(compact.fbo);
    compact = null;
  };
  /**
   * The compact image of a list of pixels of level `stride` (fresh: trace them afresh, B6 refinement; else resume them,
   * B5 compaction). @param {Int32Array} list @param {number} stride @param {boolean} fresh
   */
  const makeCompact = (list, stride, fresh) => {
    freeCompact();
    const M = list.length;
    if (!M) return 0;
    // compact image: 256 wide (or narrower), padding -1
    const w = Math.min(M, 256), h = Math.ceil(M / w);
    const idx = new Int32Array(w * h).fill(-1);
    idx.set(list);
    const index = /** @type {WebGLTexture} */ (gl.createTexture());
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, index);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R32I, w, h);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RED_INTEGER, gl.INT, idx);
    for (const q of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, q, gl.NEAREST);
    const fbo = /** @type {WebGLFramebuffer} */ (gl.createFramebuffer());
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    const tex = Array.from({ length: 8 }, (_, k) => {
      const t = /** @type {WebGLTexture} */ (gl.createTexture());
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, w, h);
      for (const q of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, q, gl.NEAREST);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + k, gl.TEXTURE_2D, t, 0);
      return t;
    });
    gl.drawBuffers(Array.from({ length: 8 }, (_, k) => gl.COLOR_ATTACHMENT0 + k));
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('compact framebuffer incomplete');
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    compact = { fbo, tex, index, w, h, M, stride, fresh };
    return M;
  };

  // one record set (4 RGBA32F targets) per progressive level, stride s -> ceil(N / s)^2 pixels:
  // a coarse level traced as a compact image keeps every SIMD lane busy (a strided pass over the
  // full image costs as much as a full trace, since a wave runs as long as its longest ray)
  const STRIDES = [1, 2, 4, 8];
  /** @type {Map<number, {fbo: WebGLFramebuffer, tex: WebGLTexture[], w: number, h: number}>} */
  const levels = new Map();
  let W = 0, H = 0;
  /** attachments of the record proper (rec0-3, tail0-1), the part that is cached */
  const RECORD_ATT = Math.min(NATT, 6);
  /** @param {number} lw @param {number} lh */
  const makeLevel = (lw, lh) => {
    const fbo = /** @type {WebGLFramebuffer} */ (gl.createFramebuffer());
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    const tex = Array.from({ length: NATT }, (_, k) => {
      const t = /** @type {WebGLTexture} */ (gl.createTexture());
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, lw, lh);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + k, gl.TEXTURE_2D, t, 0);
      return t;
    });
    gl.drawBuffers(Array.from({ length: NATT }, (_, k) => gl.COLOR_ATTACHMENT0 + k));
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('RGBA32F MRT framebuffer incomplete');
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { fbo, tex, w: lw, h: lh };
  };
  /** @param {Map<number, {fbo: WebGLFramebuffer, tex: WebGLTexture[]}>} set */
  const freeLevels = (set) => { for (const L of set.values()) { for (const t of L.tex) gl.deleteTexture(t); gl.deleteFramebuffer(L.fbo); } set.clear(); };
  /** background record set (B5 idle pre-tracing) */
  const bg = { W: 0, H: 0, levels: /** @type {Map<number, {fbo: WebGLFramebuffer, tex: WebGLTexture[], w: number, h: number}>} */ (new Map()) };
  /** @type {Map<number, {fbo: WebGLFramebuffer, tex: WebGLTexture[], w: number, h: number}>} */
  let target = levels;
  /** a level of the current record set (background levels are made on first use) @param {number} st */
  const getLevel = (st) => {
    let L = target.get(st);
    if (!L && target === bg.levels && STRIDES.includes(st)) { L = makeLevel(Math.ceil(bg.W / st), Math.ceil(bg.H / st)); target.set(st, L); }
    if (!L) throw new Error(`unsupported stride ${st} (${STRIDES.join(', ')})`);
    return L;
  };
  const blitFbo = /** @type {WebGLFramebuffer} */ (gl.createFramebuffer());
  /**
   * Float blit of one attachment: from attachment `ka` of fbo `src` (or texture `t` if src is null) to texture `t`
   * (or attachment `kd` of fbo `dst`).
   * @param {WebGLFramebuffer|null} src @param {number} ka @param {WebGLFramebuffer|null} dst @param {WebGLTexture} t
   * @param {number} w @param {number} h @param {number} [kd]
   */
  const blit = (src, ka, dst, t, w, h, kd = 0) => {
    gl.disable(gl.SCISSOR_TEST);
    if (src) {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, src);
      gl.readBuffer(gl.COLOR_ATTACHMENT0 + ka);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, blitFbo);
      gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
    } else {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, blitFbo);
      gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      gl.readBuffer(gl.COLOR_ATTACHMENT0);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, dst);
      gl.drawBuffers(Array.from({ length: NATT }, (_, k) => (k === kd ? gl.COLOR_ATTACHMENT0 + k : gl.NONE)));
    }
    gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    if (dst) gl.drawBuffers(Array.from({ length: NATT }, (_, k) => gl.COLOR_ATTACHMENT0 + k));
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
  };
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
      // variants: '<file>_half' = <file>.glsl with TABLE_HALF defined (half-float derivative tables, M9 accuracy trade);
      // '+flag' suffixes (Stage 1B B5, exact speedups): '+g34' G3_EQUALS_G4, '+reuse' TEXEL_REUSE
      // 'closed_<metric>' = trace.glsl with CLOSED_FORM and the generated shaders/glsl/closed/<metric>.glsl before it
      const [base, ...flags] = name.split('+');
      const closed = base.startsWith('closed_') ? base.slice(7) : null;
      const half = base.endsWith('_half'), file = closed ? 'trace' : half ? base.slice(0, -5) : base;
      const pre = closed ? '#define CLOSED_FORM 1\n' + await load(`closed/${closed}`) + '\n' : '';
      const FLAG_DEFINES = /** @type {Record<string, string>} */ ({ g34: 'G3_EQUALS_G4', reuse: 'TEXEL_REUSE', compact: 'COMPACT', bs3: 'BS3' });
      if (flags.includes('compact') && !COMPACT_OK) throw new Error('ray compaction needs 8 draw buffers');
      // a '+#text' flag only adds a comment (a distinct source, e.g. for compile-time measurements past the driver's cache)
      const defs = flags.map((f) => { if (f.startsWith('#')) return `// ${f}\n`; if (!FLAG_DEFINES[f]) throw new Error(`unknown tracer flag ${f}`); return `#define ${FLAG_DEFINES[f]} 1\n`; }).join('');
      if (!tracePrograms.has(name)) tracePrograms.set(name, build(HEADER + `#define TAIL_BINS ${TAIL_BINS}\n` + (half ? '#define TABLE_HALF 1\n' : '') + defs + pre + await load(file) + '\n' + common, `${name}: ${closed ? `closed/${closed}.glsl + ` : ''}${file}.glsl + common.glsl`));
      tracer = /** @type {ReturnType<typeof build>} */ (tracePrograms.get(name));
    },

    resize(w, h) {
      if (w === W && h === H) return;
      freeLevels(levels);
      for (const st of STRIDES) levels.set(st, makeLevel(Math.ceil(w / st), Math.ceil(h / st)));
      W = w; H = h;
      canvas.width = w; canvas.height = h;
    },

    useRecordSet(set, w = W, h = H) {
      // Stage 1B B5 idle pre-tracing: set 1 is a background record set (levels made on first use), so that the canvas
      // never shows a background trace; the display always reads set 0
      if (set === 1) {
        if (bg.W !== w || bg.H !== h) { freeLevels(bg.levels); bg.W = w; bg.H = h; }
        target = bg.levels;
      } else target = levels;
    },

    levelSize(stride) {
      const L = getLevel(stride);
      return { w: L.w, h: L.h };
    },

    cacheStore(strides) {
      // copy the record attachments (0-5) of the given levels of the current set into new textures (float blits)
      /** @type {Map<number, WebGLTexture[]>} */
      const tex = new Map();
      let bytes = 0;
      for (const st of strides) {
        const L = getLevel(st);
        const copies = Array.from({ length: RECORD_ATT }, (_, k) => {
          const t = /** @type {WebGLTexture} */ (gl.createTexture());
          gl.bindTexture(gl.TEXTURE_2D, t);
          gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, L.w, L.h);
          for (const q of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, q, gl.NEAREST);
          blit(L.fbo, k, null, t, L.w, L.h);
          return t;
        });
        bytes += 16 * RECORD_ATT * L.w * L.h;
        tex.set(st, copies);
      }
      return { tex, strides: [...strides], w: target === levels ? W : bg.W, h: target === levels ? H : bg.H, bytes };
    },

    cacheRestore(handle) {
      // the cached levels back into the display set (its size must match: resize first), and display them
      for (const [st, copies] of handle.tex) {
        const L = /** @type {{fbo: WebGLFramebuffer, w: number, h: number}} */ (levels.get(st));
        copies.forEach((t, k) => blit(null, 0, L.fbo, t, L.w, L.h, k));
      }
      activeStrides = [...handle.strides].sort((a, b) => a - b).slice(0, 2);
    },

    cacheFree(handle) { for (const copies of handle.tex.values()) for (const t of copies) gl.deleteTexture(t); handle.tex.clear(); },

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

    pollLightCurve() { pollLc(); return lcDone.splice(0); },

    async readLinear(side = 'A') {
      // the last linear emission image of a view (B8 tests: light-curve reduction vs a CPU sum)
      const t = [...postTargets.entries()].find(([k]) => k.startsWith(`lin${side}:`))?.[1];
      if (!t) return null;
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
      gl.readBuffer(gl.COLOR_ATTACHMENT0);
      const out = new Float32Array(4 * t.w * t.h);
      gl.readPixels(0, 0, t.w, t.h, gl.RGBA, gl.FLOAT, out);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return { w: t.w, h: t.h, data: out };
    },

    async readPost(side = 'A') {
      const e = lastPost.get(side);
      if (!e) return null;
      gl.bindFramebuffer(gl.FRAMEBUFFER, e.t.fbo);
      gl.readBuffer(gl.COLOR_ATTACHMENT0);
      const out = new Float32Array(4 * e.t.w * e.t.h);
      gl.readPixels(0, 0, e.t.w, e.t.h, gl.RGBA, gl.FLOAT, out);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return { w: e.t.w, h: e.t.h, k: e.k, data: out };
    },

    canvasSize(w, h) { if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; } },

    clearCanvas() { gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, canvas.width, canvas.height); gl.clearColor(0.08, 0.08, 0.1, 1); gl.clear(gl.COLOR_BUFFER_BIT); },

    uploadNoise(F, name = '') {
      const m = F.meta;
      // B7: fields stay loaded by name (compare mode can show two anchors); the current one is the last uploaded
      if (name && noiseSet.has(name)) { const e = /** @type {{tex: WebGLTexture, meta: any}} */ (noiseSet.get(name)); noiseTex = e.tex; noiseMeta = e.meta; return; }
      const max3 = gl.getParameter(gl.MAX_3D_TEXTURE_SIZE);
      if (Math.max(m.Nt, m.Nx, m.Nphi) > max3) throw new Error(`noise field ${m.Nphi} x ${m.Nx} x ${m.Nt} exceeds MAX_3D_TEXTURE_SIZE ${max3}`);
      gl.activeTexture(gl.TEXTURE0);
      if (noiseTex && ![...noiseSet.values()].some((e) => e.tex === noiseTex)) gl.deleteTexture(noiseTex);
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
      if (name) noiseSet.set(name, { tex: /** @type {WebGLTexture} */ (noiseTex), meta: m });
    },

    clearRecords(strides) {
      if (strides && target === levels) activeStrides = [...strides].sort((a, b) => a - b).slice(0, 2);
      const z = new Float32Array(4);
      for (const st of strides ?? STRIDES) getLevel(st);
      for (const L of target.values()) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, L.fbo);
        gl.drawBuffers(Array.from({ length: NATT }, (_, k) => gl.COLOR_ATTACHMENT0 + k));
        for (let k = 0; k < NATT; k++) gl.clearBufferfv(gl.COLOR, k, z);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    },

    async traceTile(rect, stride, toCompact = false) {
      if (!tracer) throw new Error('setTracer first');
      const L = getLevel(stride);
      const C = toCompact ? compact : null;
      if (toCompact && !C) throw new Error('compactList first');
      gl.bindFramebuffer(gl.FRAMEBUFFER, C ? C.fbo : L.fbo);
      // a program without the compaction outputs leaves attachments 6-7 off (WebGL rejects draw buffers without outputs)
      const hasCont = !!tracer.loc('uCompact');
      if (!C) gl.drawBuffers(Array.from({ length: NATT }, (_, k) => (k < 6 || hasCont ? gl.COLOR_ATTACHMENT0 + k : gl.NONE)));
      gl.viewport(0, 0, C ? C.w : L.w, C ? C.h : L.h);
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
      if (tracer.loc('uCompact')) {
        gl.uniform4i(tracer.loc('uCompact'), C ? (C.fresh ? 3 : 2) : compactPhase.mode ? 1 : 0, compactPhase.limit, 0, 0);
        // the index list and the level's records (read while the compact image is the target)
        gl.activeTexture(gl.TEXTURE3);
        gl.bindTexture(gl.TEXTURE_2D, C ? C.index : null);
        gl.uniform1i(tracer.loc('uIndex'), 3);
        for (let k = 0; k < 8; k++) {
          gl.activeTexture(gl.TEXTURE4 + k);
          gl.bindTexture(gl.TEXTURE_2D, C ? L.tex[k] : null);
          gl.uniform1i(tracer.loc(`uPrev${k}`), 4 + k);
        }
      }
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

    compactSupported: () => COMPACT_OK,

    setCompactPhase(mode, limit) { compactPhase = { mode, limit }; },

    async compactList(stride) {
      // the unfinished rays of level `stride` (termination code 8/9): read rec0 back asynchronously (PBO + fence), list them
      const L = getLevel(stride);
      const n = L.w * L.h;
      const pbo = gl.createBuffer();
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
      gl.bufferData(gl.PIXEL_PACK_BUFFER, 16 * n, gl.STREAM_READ);
      gl.bindFramebuffer(gl.FRAMEBUFFER, L.fbo);
      gl.readBuffer(gl.COLOR_ATTACHMENT0);
      gl.readPixels(0, 0, L.w, L.h, gl.RGBA, gl.FLOAT, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      const sync = /** @type {WebGLSync} */ (gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0));
      gl.flush();
      for (;;) {
        const st = gl.clientWaitSync(sync, 0, 0);
        if (st === gl.ALREADY_SIGNALED || st === gl.CONDITION_SATISFIED) break;
        if (st === gl.WAIT_FAILED) throw new Error('clientWaitSync failed');
        if (gl.isContextLost()) throw new Error('WebGL context lost (GPU watchdog?)');
        await yieldNow();
      }
      gl.deleteSync(sync);
      const rec0 = new Float32Array(4 * n);
      gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, rec0);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      gl.deleteBuffer(pbo);
      const list = [];
      for (let p = 0; p < n; p++) { const c = Math.round(rec0[4 * p]) & 15; if (c === 8 || c === 9) list.push(p); }
      return makeCompact(Int32Array.from(list), stride, false);
    },

    pixelList(stride, list) { return makeCompact(list, stride, true); },

    interpolateLevel(from) {
      // B6 adaptive refinement: fill the full-resolution level (stride 1) of the current set from level `from` by
      // interpolation; the marked pixels are traced afterwards (pixelList, traceTile toCompact) and scattered over it
      if (!interp) interp = buildPlain(INTERP_VS, INTERP_FS, 'interpolate');
      const C = getLevel(from), L = getLevel(1);
      gl.bindFramebuffer(gl.FRAMEBUFFER, L.fbo);
      gl.drawBuffers(Array.from({ length: NATT }, (_, k) => (k < 6 ? gl.COLOR_ATTACHMENT0 + k : gl.NONE)));
      gl.viewport(0, 0, L.w, L.h);
      gl.disable(gl.SCISSOR_TEST);
      gl.useProgram(interp.prog);
      gl.bindVertexArray(vao);
      for (let k = 0; k < 6; k++) {
        gl.activeTexture(gl.TEXTURE4 + k);
        gl.bindTexture(gl.TEXTURE_2D, C.tex[Math.min(k, NATT - 1)]);
        gl.uniform1i(interp.loc(`uC${k}`), 4 + k);
      }
      gl.uniform4i(interp.loc('uIp'), from, C.w, C.h, TAIL_BINS ? 1 : 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      for (let k = 4; k < 10; k++) { gl.activeTexture(gl.TEXTURE0 + k); gl.bindTexture(gl.TEXTURE_2D, null); }
      gl.drawBuffers(Array.from({ length: NATT }, (_, k) => gl.COLOR_ATTACHMENT0 + k));
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    },



    compactSize: () => (compact ? { w: compact.w, h: compact.h, M: compact.M } : null),

    scatterCompact() {
      if (!compact) return;
      if (!scatter) {
        const prog = /** @type {WebGLProgram} */ (gl.createProgram());
        for (const [type, src] of /** @type {[number, string][]} */ ([[gl.VERTEX_SHADER, SCATTER_VS], [gl.FRAGMENT_SHADER, SCATTER_FS]])) {
          const sh = /** @type {WebGLShader} */ (gl.createShader(type));
          gl.shaderSource(sh, src); gl.compileShader(sh);
          if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(`scatter: GLSL compile error\n${gl.getShaderInfoLog(sh)}`);
          gl.attachShader(prog, sh);
        }
        gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(`scatter: link error\n${gl.getProgramInfoLog(prog)}`);
        const locs = new Map();
        scatter = { prog, loc: (n) => { if (!locs.has(n)) locs.set(n, gl.getUniformLocation(prog, n)); return locs.get(n) ?? null; } };
      }
      const L = getLevel(compact.stride);
      gl.bindFramebuffer(gl.FRAMEBUFFER, L.fbo);
      gl.drawBuffers(Array.from({ length: NATT }, (_, k) => gl.COLOR_ATTACHMENT0 + k));
      gl.viewport(0, 0, L.w, L.h);
      gl.useProgram(scatter.prog);
      gl.bindVertexArray(vao);
      gl.activeTexture(gl.TEXTURE3);
      gl.bindTexture(gl.TEXTURE_2D, compact.index);
      gl.uniform1i(scatter.loc('uIndex'), 3);
      for (let k = 0; k < 8; k++) {
        gl.activeTexture(gl.TEXTURE4 + k);
        gl.bindTexture(gl.TEXTURE_2D, compact.tex[k]);
        gl.uniform1i(scatter.loc(`uC${k}`), 4 + k);
      }
      gl.uniform4i(scatter.loc('uSc'), L.w, L.h, compact.w, 0);
      gl.drawArrays(gl.POINTS, 0, compact.M);
      for (let k = 4; k < 12; k++) { gl.activeTexture(gl.TEXTURE0 + k); gl.bindTexture(gl.TEXTURE_2D, null); }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      freeCompact();
    },

    display(view, src = {}) {
      const t0 = performance.now();
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      // Stage 1B B7: a view may draw a cached record set (compare mode) into part of the canvas, with its own fluid table
      // and noise field
      const RW = src.handle ? src.handle.w : W, RH = src.handle ? src.handle.h : H;
      const vp = src.viewport ?? [0, 0, RW, RH];
      // B8: the disc emission with post passes is first drawn linearly into a float image of the view's own size
      const linear = !!view.post && view.mode === 8;
      const side = src.side ?? 'A';
      const lin = linear ? postTarget(`lin${side}`, RW, RH) : null;
      if (lin) { gl.bindFramebuffer(gl.FRAMEBUFFER, lin.fbo); gl.viewport(0, 0, RW, RH); }
      else {
        gl.viewport(vp[0], vp[1], vp[2], vp[3]);
        if (src.scissor) { gl.enable(gl.SCISSOR_TEST); gl.scissor(src.scissor[0], src.scissor[1], src.scissor[2], src.scissor[3]); }
      }
      gl.useProgram(display.prog);
      gl.bindVertexArray(vao);
      // the six record attachments (4 + 2 tail) of the (at most 2) levels of the current trace, finest first: 12 units,
      // plus the noise field and the fluid table (16 texture units is the WebGL2 minimum)
      let unit = 0;
      const lv = [-1, -1, -1, -1];
      const texOf = (/** @type {number} */ st) => (src.handle ? /** @type {WebGLTexture[]} */ (src.handle.tex.get(st)) : /** @type {{tex: WebGLTexture[]}} */ (levels.get(st)).tex);
      const bound = src.handle ? [...src.handle.strides].sort((a, b) => a - b).slice(0, 2) : activeStrides.filter((st) => levels.has(st));
      if (!bound.length) { gl.disable(gl.SCISSOR_TEST); return; }   // no records yet (before the first resize)
      bound.forEach((st, li) => {
        const T = texOf(st);
        lv[li] = Math.round(Math.log2(st));
        for (let k = 0; k < 6; k++) {
          gl.activeTexture(gl.TEXTURE0 + unit);
          gl.bindTexture(gl.TEXTURE_2D, T[Math.min(k, T.length - 1)]);   // without a tail, its samplers see a record texture (unused)
          gl.uniform1i(display.loc(`uS${li}R${k}`), unit++);
        }
      });
      // unused slots still need a valid 2D texture bound to their samplers
      for (let li = bound.length; li < 2; li++) for (let k = 0; k < 6; k++) gl.uniform1i(display.loc(`uS${li}R${k}`), k);
      gl.uniform4i(display.loc('uLevels'), lv[0], lv[1], -1, -1);
      const tg = view.tail;
      gl.uniform4f(display.loc('uTail'), tg ? tg.xLo : 0, tg ? tg.invWidth : 1, tg ? tg.K : 0, tg && TAIL_BINS ? 1 : 0);
      const nz = src.noiseName && noiseSet.has(src.noiseName) ? /** @type {{tex: WebGLTexture, meta: any}} */ (noiseSet.get(src.noiseName)) : { tex: noiseTex, meta: noiseMeta };
      gl.activeTexture(gl.TEXTURE0 + 12);
      gl.bindTexture(gl.TEXTURE_3D, nz.tex);
      gl.uniform1i(display.loc('uNoise'), 12);
      const fl = src.fluid ? fluidFor(src.fluid, src.fluidKey ?? '') : { tex: fluidTex, grid: fluidGrid };
      gl.activeTexture(gl.TEXTURE0 + 13);
      gl.bindTexture(gl.TEXTURE_2D, fl.tex);
      gl.uniform1i(display.loc('uFluidD'), 13);
      const fg = fl.grid ?? { xMin: 0, dx: 1, n: 2, r0: 0 };
      gl.uniform4f(display.loc('uFluidXD'), fg.xMin, fg.dx, fg.n, fg.r0);
      const nm = nz.meta, tm = view.time ?? { tObs: 0, slow: true, M: 1, advect: 0, sigma: 0 };
      gl.uniform4i(display.loc('uNoiseN'), nm?.Nt ?? 2, nm?.Nx ?? 2, nm?.Nphi ?? 2, nm && nz.tex && fl.tex ? 1 : 0);
      gl.uniform4f(display.loc('uNoiseP'), tm.sigma, nm?.T_over_M ?? 1, nm?.xmin ?? 0, nm?.xmax ?? 1);
      gl.uniform4f(display.loc('uNoiseFade'), nm ? noiseFadeWidth(nm) : 1, 0, 0, 0);
      gl.uniform4f(display.loc('uTime'), tm.tObs, tm.slow ? 1 : 0, tm.M, tm.advect);
      gl.uniform4f(display.loc('uCamAz'), view.azimuth ?? 0, 0, 0, 0);
      gl.uniform4i(display.loc('uView'), view.mode, RW, RH, view.storeH ? 1 : 0);
      gl.uniform4i(display.loc('uOrigin'), lin ? 0 : vp[0], lin ? 0 : vp[1], 0, 0);
      gl.uniform4i(display.loc('uOut'), lin ? 1 : 0, 0, 0, 0);
      const zm = view.zoom ?? { s: 1, ox: 0, oy: 0 };
      gl.uniform4f(display.loc('uZoom'), zm.s, zm.ox, zm.oy, 0);
      gl.uniform4f(display.loc('uRange'), view.lo, view.hi, view.maxSteps, view.rCam);
      const em = view.emission ?? { mu: 0, gamma: 0, sigma: 1, redshiftPower: 3, fudge: 1, maxPasses: 0 };
      gl.uniform4f(display.loc('uEm'), em.mu, em.gamma, em.sigma, em.redshiftPower);
      gl.uniform4f(display.loc('uEm2'), em.fudge, em.maxPasses, view.exposure ?? 1, view.toneMap ?? 0);
      gl.uniform4i(display.loc('uEm3'), view.colorMap ?? 0, view.envelope === 'circumferential' ? 1 : 0, 0, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.disable(gl.SCISSOR_TEST);
      if (lin && view.post) {
        // light curve: 2x2 sums down to one texel, read back asynchronously (finished values: pollLightCurve)
        if (view.post.lightCurve) {
          let cur = lin;
          while (cur.w > 1 || cur.h > 1) {
            const nx = Math.max(1, Math.ceil(cur.w / 2)), ny = Math.max(1, Math.ceil(cur.h / 2));
            const nxt = postTarget(`sum${side}`, nx, ny);
            postPass(1, cur, nxt);
            cur = nxt;
          }
          const pbo = /** @type {WebGLBuffer} */ (gl.createBuffer());
          gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
          gl.bufferData(gl.PIXEL_PACK_BUFFER, 16, gl.STREAM_READ);
          gl.bindFramebuffer(gl.FRAMEBUFFER, cur.fbo);
          gl.readBuffer(gl.COLOR_ATTACHMENT0);
          gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, 0);
          gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
          lcPending.push({ pbo, sync: /** @type {WebGLSync} */ (gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0)), tag: { side, tObs: view.time?.tObs ?? 0 } });
          gl.flush();
          if (lcPending.length > 8) { const e = /** @type {{pbo: WebGLBuffer, sync: WebGLSync}} */ (lcPending.shift()); gl.deleteSync(e.sync); gl.deleteBuffer(e.pbo); }
        }
        // telescope blur: a separable Gaussian, on a 2^k-times box-averaged copy when the beam is wide (sigma > 8 px)
        const sg = view.post.blurSigmaPx ?? 0;
        let img = lin, k = 0;
        if (sg > 0.3) {
          k = sg > 8 ? Math.ceil(Math.log2(sg / 8)) : 0;
          for (let i = 0; i < k; i++) {
            const nxt = postTarget(`pyr${side}${i}`, Math.max(1, Math.ceil(img.w / 2)), Math.max(1, Math.ceil(img.h / 2)));
            postPass(0, img, nxt);
            img = nxt;
          }
          const s = sg / 2 ** k, R = Math.min(64, Math.ceil(3 * s));
          const ha = postTarget(`blurH${side}`, img.w, img.h), hb = postTarget(`blurV${side}`, img.w, img.h);
          postPass(2, img, ha, { blur: [1, 0, s, R] });
          postPass(2, ha, hb, { blur: [0, 1, s, R] });
          img = hb;
        }
        lastPost.set(side, { t: img, k });
        // tone map into the canvas viewport of the view
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(vp[0], vp[1], vp[2], vp[3]);
        if (src.scissor) { gl.enable(gl.SCISSOR_TEST); gl.scissor(src.scissor[0], src.scissor[1], src.scissor[2], src.scissor[3]); }
        postPass(3, img, null, { k: [k], tone: [view.exposure ?? 1, view.toneMap ?? 0, view.colorMap ?? 0, 0], origin: [vp[0], vp[1], 0, 0], full: [RW, RH, 0, 0] });
        gl.disable(gl.SCISSOR_TEST);
      }
      lastDisplayMs = performance.now() - t0;
    },

    async readRecords(stride = 1, currentSet = false) {
      // the displayed records unless the pipeline asks for the set it is tracing (B6 refinement): an idle pre-trace may
      // switch the current set between a trace and the read-back of its records
      const L = currentSet ? getLevel(stride) : /** @type {{fbo: WebGLFramebuffer, w: number, h: number}} */ (levels.get(stride));
      // review P5: asynchronous (PBO + fence): the page stays responsive while the GPU finishes; the read-backs are queued
      // in GL order, so later draws cannot change what they read
      const n = L.w * L.h, na = Math.min(NATT, 6);
      const pbos = Array.from({ length: na }, (_, k) => {
        const pbo = /** @type {WebGLBuffer} */ (gl.createBuffer());
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
        gl.bufferData(gl.PIXEL_PACK_BUFFER, 16 * n, gl.STREAM_READ);
        gl.bindFramebuffer(gl.FRAMEBUFFER, L.fbo);
        gl.readBuffer(gl.COLOR_ATTACHMENT0 + k);
        gl.readPixels(0, 0, L.w, L.h, gl.RGBA, gl.FLOAT, 0);
        return pbo;
      });
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      gl.readBuffer(gl.COLOR_ATTACHMENT0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      await fenceDone();
      // 24 floats per pixel (js/gpu/traceConfig.js RECORD_FLOATS): the record, then the tail bins (zeros without a tail)
      const out = new Float32Array(24 * n);
      const one = new Float32Array(4 * n);
      pbos.forEach((pbo, k) => {
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
        gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, one);
        gl.deleteBuffer(pbo);
        for (let p = 0; p < n; p++) for (let c = 0; c < 4; c++) out[24 * p + 4 * k + c] = one[4 * p + c];
      });
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      return out;
    },

    async readSteps() {
      // review P5: the steps (rec0.y) summed on the GPU (2 x 2 sums down to one texel) and read back asynchronously,
      // instead of reading N^2 RGBA32F texels (64 MB at 2048^2) and summing them in JS
      const L = /** @type {{tex: WebGLTexture[], w: number, h: number}} */ (levels.get(1));
      let cur = { tex: L.tex[0], w: L.w, h: L.h };
      while (cur.w > 1 || cur.h > 1) {
        const nxt = postTarget('steps', Math.max(1, Math.ceil(cur.w / 2)), Math.max(1, Math.ceil(cur.h / 2)));
        postPass(1, cur, nxt);
        cur = nxt;
      }
      const pbo = /** @type {WebGLBuffer} */ (gl.createBuffer());
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
      gl.bufferData(gl.PIXEL_PACK_BUFFER, 16, gl.STREAM_READ);
      gl.bindFramebuffer(gl.FRAMEBUFFER, /** @type {any} */ (cur).fbo);
      gl.readBuffer(gl.COLOR_ATTACHMENT0);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, 0);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      await fenceDone();
      const v = new Float32Array(4);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
      gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, v);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      gl.deleteBuffer(pbo);
      return v[1];
    },

    pollTiming: pollQueries,

    capabilities: () => ({ renderer, timerQueries: !!timerExt, maxTexture: gl.getParameter(gl.MAX_TEXTURE_SIZE), maxDrawBuffers: gl.getParameter(gl.MAX_DRAW_BUFFERS), tailBins: TAIL_BINS, compaction: COMPACT_OK }),
    timing: () => ({ traceMs: lastTraceMs, displayMs: lastDisplayMs }),
  };
  return backend;
}
