// @ts-check
// Capability report page (caps.html).
import { probeWebGL2, probeWebGPU } from './gpu/capabilities.js';

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));

/** @param {string} label @param {boolean} ok @param {string} text */
const row = (label, ok, text) =>
  `<tr><th>${label}</th><td class="${ok ? 'ok' : 'bad'}">${ok ? '✓' : '✗'}</td><td>${text}</td></tr>`;

async function main() {
  const gl = probeWebGL2();
  const gpu = await probeWebGPU();
  $('gl').textContent = JSON.stringify(gl, null, 1);
  $('gpu').textContent = JSON.stringify(gpu, null, 1);
  $('summary').innerHTML =
    row('WebGL2', gl.available, gl.available ? `${gl.renderer}` : String(gl.reason)) +
    row('EXT_color_buffer_float', !!gl.extensions?.EXT_color_buffer_float, 'required to render and read back float records') +
    row('GPU timer queries (WebGL2)', !!gl.extensions?.EXT_disjoint_timer_query_webgl2, 'optional, for timing') +
    row('WebGPU', gpu.available, gpu.available ? Object.values(gpu.info ?? {}).join(' / ') || 'adapter info hidden' : String(gpu.reason)) +
    row('timestamp-query (WebGPU)', !!gpu.features?.includes('timestamp-query'), 'optional, for timing');
  /** @type {any} */ (window).__caps = { webgl2: gl, webgpu: gpu };
}

main().catch((e) => { $('summary').innerHTML = `<tr><td class="bad">Capability check failed: ${e}</td></tr>`; });
