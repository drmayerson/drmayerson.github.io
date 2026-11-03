// @ts-check
// Capability probes for WebGL2 and WebGPU. Browser-only (uses document / navigator).

/**
 * @typedef {Object} WebGL2Caps
 * @property {boolean} available
 * @property {string=} reason
 * @property {string=} vendor
 * @property {string=} renderer
 * @property {string=} version
 * @property {string=} glsl
 * @property {Record<string, boolean>=} extensions   the ones we care about
 * @property {Record<string, number|number[]>=} limits
 * @property {boolean=} ready                         everything Stage 1 needs is present
 */

/** Extensions relevant to FOORT-GPU (EXT_color_buffer_float is required). */
const GL_EXTENSIONS = [
  'EXT_color_buffer_float',
  'EXT_disjoint_timer_query_webgl2',
  'OES_texture_float_linear',
  'EXT_float_blend',
  'WEBGL_debug_renderer_info',
  'KHR_parallel_shader_compile',
];

/** @returns {WebGL2Caps} */
export function probeWebGL2() {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2');
  if (!gl) return { available: false, reason: 'WebGL2 is not available in this browser.' };
  /** @type {Record<string, boolean>} */
  const extensions = {};
  for (const name of GL_EXTENSIONS) extensions[name] = !!gl.getExtension(name);
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const limits = {
    MAX_TEXTURE_SIZE: gl.getParameter(gl.MAX_TEXTURE_SIZE),
    MAX_3D_TEXTURE_SIZE: gl.getParameter(gl.MAX_3D_TEXTURE_SIZE),
    MAX_DRAW_BUFFERS: gl.getParameter(gl.MAX_DRAW_BUFFERS),
    MAX_COLOR_ATTACHMENTS: gl.getParameter(gl.MAX_COLOR_ATTACHMENTS),
    MAX_RENDERBUFFER_SIZE: gl.getParameter(gl.MAX_RENDERBUFFER_SIZE),
    MAX_FRAGMENT_UNIFORM_VECTORS: gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS),
    MAX_TEXTURE_IMAGE_UNITS: gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS),
    MAX_VIEWPORT_DIMS: Array.from(gl.getParameter(gl.MAX_VIEWPORT_DIMS)),
  };
  const hp = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
  const caps = {
    available: true,
    vendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
    renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    version: gl.getParameter(gl.VERSION),
    glsl: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
    extensions,
    limits: { ...limits, FRAGMENT_HIGH_FLOAT_PRECISION_BITS: hp ? hp.precision : 0 },
    ready: extensions.EXT_color_buffer_float && limits.MAX_DRAW_BUFFERS >= 4,
  };
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return caps;
}

/**
 * @typedef {Object} WebGPUCaps
 * @property {boolean} available
 * @property {string=} reason
 * @property {Record<string, string>=} info
 * @property {string[]=} features
 * @property {Record<string, number>=} limits     selected adapter limits
 * @property {boolean=} isFallbackAdapter
 */

const GPU_LIMITS = [
  'maxStorageBufferBindingSize', 'maxBufferSize', 'maxComputeWorkgroupsPerDimension',
  'maxComputeInvocationsPerWorkgroup', 'maxComputeWorkgroupSizeX', 'maxTextureDimension2D',
  'maxTextureDimension3D', 'maxStorageBuffersPerShaderStage',
];

/** @returns {Promise<WebGPUCaps>} */
export async function probeWebGPU() {
  const gpu = /** @type {any} */ (navigator).gpu;
  if (!gpu) return { available: false, reason: 'WebGPU is not available in this browser (navigator.gpu is missing).' };
  let adapter;
  try {
    adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
  } catch (e) {
    return { available: false, reason: `requestAdapter failed: ${e}` };
  }
  if (!adapter) return { available: false, reason: 'WebGPU is exposed but no adapter was returned.' };
  const ai = adapter.info ?? (adapter.requestAdapterInfo ? await adapter.requestAdapterInfo() : {});
  /** @type {Record<string, string>} */
  const info = {};
  for (const k of ['vendor', 'architecture', 'device', 'description']) if (ai[k]) info[k] = String(ai[k]);
  /** @type {Record<string, number>} */
  const limits = {};
  for (const k of GPU_LIMITS) limits[k] = adapter.limits[k];
  return {
    available: true,
    info,
    features: Array.from(adapter.features).map(String).sort(),
    limits,
    isFallbackAdapter: !!(adapter.isFallbackAdapter ?? ai.isFallbackAdapter),
  };
}
