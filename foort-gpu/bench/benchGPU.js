// @ts-check
// WebGPU side of the M0 benchmark: compute shader writing vec4 records to a storage buffer,
// one dispatch (and submit) per tile, onSubmittedWorkDone per tile, optional timestamp queries.
import { tiles } from './setup.js';

const UBO_BYTES = 192;

export class GPUBench {
  /** @param {string} wgslSource */
  constructor(wgslSource) {
    this.wgslSource = wgslSource;
    /** @type {any} */
    this.device = null;
    this.error = '';
    this.deviceName = '';
  }

  /** @returns {Promise<boolean>} */
  async init() {
    const gpu = /** @type {any} */ (navigator).gpu;
    if (!gpu) { this.error = 'WebGPU is missing in this browser (navigator.gpu is undefined).'; return false; }
    const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) { this.error = 'WebGPU is exposed but no adapter is available.'; return false; }
    const info = adapter.info ?? {};
    this.deviceName = [info.vendor, info.architecture, info.device, info.description].filter(Boolean).join(' / ');
    this.hasTimestamps = adapter.features.has('timestamp-query');
    const need = 1024 * 1024 * 16;
    const requiredLimits = {
      maxStorageBufferBindingSize: Math.min(adapter.limits.maxStorageBufferBindingSize, Math.max(need, 134217728)),
      maxBufferSize: Math.min(adapter.limits.maxBufferSize, Math.max(need, 268435456)),
    };
    this.device = await adapter.requestDevice({
      requiredFeatures: this.hasTimestamps ? ['timestamp-query'] : [],
      requiredLimits,
    });
    this.device.lost.then((/** @type {any} */ e) => { this.error = 'WebGPU device lost: ' + e.message; });
    const module = this.device.createShaderModule({ code: this.wgslSource });
    const ci = await module.getCompilationInfo();
    const errs = ci.messages.filter((/** @type {any} */ m) => m.type === 'error');
    if (errs.length) { this.error = 'WGSL compile error: ' + errs.map((/** @type {any} */ m) => `${m.lineNum}:${m.linePos} ${m.message}`).join('\n'); return false; }
    this.pipeline = await this.device.createComputePipelineAsync({ layout: 'auto', compute: { module, entryPoint: 'main' } });
    return true;
  }

  /**
   * @param {import('./setup.js').BenchUniforms} U
   * @param {number} N @param {number} tile
   * @returns {Promise<{wallMs:number, gpuMs:number|null, rec:Float32Array}>}
   */
  async run(U, N, tile) {
    const dev = this.device;
    const G = /** @type {any} */ (globalThis).GPUBufferUsage;
    const outBytes = N * N * 16;
    if (outBytes > dev.limits.maxStorageBufferBindingSize) throw new Error(`record buffer ${outBytes} B exceeds maxStorageBufferBindingSize`);
    const out = dev.createBuffer({ size: outBytes, usage: G.STORAGE | G.COPY_SRC });
    const read = dev.createBuffer({ size: outBytes, usage: G.MAP_READ | G.COPY_DST });
    const tl = tiles(N, tile);
    // one uniform slot per tile (256-byte aligned) so per-tile writes cannot race
    const stride = 256;
    const ubo = dev.createBuffer({ size: stride * tl.length, usage: G.UNIFORM | G.COPY_DST });
    const host = new ArrayBuffer(stride * tl.length);
    tl.forEach((t, k) => {
      const f = new Float32Array(host, k * stride, UBO_BYTES / 4);
      f.set(U.E, 0); f.set(U.G, 16); f.set(U.screen, 32); f.set(U.p0, 36); f.set(U.p1, 40);
      new Uint32Array(host, k * stride + 176, 4).set([t.x, t.y, N, U.maxSteps]);
    });
    dev.queue.writeBuffer(ubo, 0, host);
    const groups = tl.map((_, k) => dev.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: ubo, offset: k * stride, size: UBO_BYTES } },
        { binding: 1, resource: { buffer: out } }],
    }));
    let qs = null, qbuf = null, qread = null;
    if (this.hasTimestamps) {
      qs = dev.createQuerySet({ type: 'timestamp', count: 2 * tl.length });
      qbuf = dev.createBuffer({ size: 16 * tl.length, usage: G.QUERY_RESOLVE | G.COPY_SRC });
      qread = dev.createBuffer({ size: 16 * tl.length, usage: G.MAP_READ | G.COPY_DST });
    }
    await dev.queue.onSubmittedWorkDone();

    const t0 = performance.now();
    for (let k = 0; k < tl.length; k++) {
      const t = tl[k];
      const enc = dev.createCommandEncoder();
      const pass = enc.beginComputePass(qs ? { timestampWrites: { querySet: qs, beginningOfPassWriteIndex: 2 * k, endOfPassWriteIndex: 2 * k + 1 } } : {});
      pass.setPipeline(this.pipeline);
      pass.setBindGroup(0, groups[k]);
      pass.dispatchWorkgroups(Math.ceil(t.w / 8), Math.ceil(t.h / 8));
      pass.end();
      dev.queue.submit([enc.finish()]);
      await dev.queue.onSubmittedWorkDone();
    }
    const wallMs = performance.now() - t0;

    const enc = dev.createCommandEncoder();
    enc.copyBufferToBuffer(out, 0, read, 0, outBytes);
    if (qs) { enc.resolveQuerySet(qs, 0, 2 * tl.length, qbuf, 0); enc.copyBufferToBuffer(qbuf, 0, qread, 0, 16 * tl.length); }
    dev.queue.submit([enc.finish()]);
    await read.mapAsync(1 /* GPUMapMode.READ */);
    const rec = new Float32Array(read.getMappedRange().slice(0));
    read.unmap();
    let gpuMs = null;
    if (qread) {
      await qread.mapAsync(1);
      const ts = new BigUint64Array(qread.getMappedRange().slice(0));
      qread.unmap();
      gpuMs = 0;
      for (let k = 0; k < tl.length; k++) gpuMs += Number(ts[2 * k + 1] - ts[2 * k]) / 1e6;
      if (!(gpuMs > 0)) gpuMs = null;
    }
    for (const b of [out, read, ubo, qbuf, qread]) b?.destroy();
    qs?.destroy();
    return { wallMs, gpuMs, rec };
  }
}
