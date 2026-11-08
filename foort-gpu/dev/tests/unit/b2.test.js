// Stage 1B B2: the binned tail (packing as shaders/glsl/common.glsl, decoding, geometry, intensity).
import { describe, it, expect } from 'vitest';
import { decodeTail, decodeRecord, tailGeometry, normalizeView, RECORD_FLOATS, TAIL_BINS } from '../../../js/gpu/traceConfig.js';
import { binTail, discIntensity } from '../../../js/fluid/emission.js';
import { johnsonSU } from '../../../js/fluid/generalCircularRadial.js';
import { createMetric } from '../../../js/metrics/registry.js';

/** pack bins as the shader does: W with its low 8 mantissa bits replaced by round(255 f) */
function packRecord(crossings, geom, em) {
  const rec = new Float32Array(RECORD_FLOATS);
  const u = new Uint32Array(rec.buffer);
  const W = new Float64Array(geom.K), X = new Float64Array(geom.K);
  crossings.forEach((c, k) => {
    if (k < 3) return;
    const w = em.fudge * c.g ** em.redshiftPower, x = Math.log(c.r);
    const b = Math.min(geom.K - 1, Math.max(0, Math.floor((x - geom.xLo) * geom.invWidth)));
    W[b] += w; X[b] += w * x;
  });
  const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
  for (let b = 0; b < geom.K; b++) {
    if (!(W[b] > 0)) continue;
    f32[0] = W[b];
    const f = Math.min(1, Math.max(0, (X[b] / W[b] - geom.xLo) * geom.invWidth - b));
    u[16 + b] = ((u32[0] & 0xffffff00) | Math.floor(f * 255 + 0.5)) >>> 0;
  }
  rec[0] = 2 + 16 * crossings.length;
  return rec;
}

describe('binned tail', () => {
  const m = createMetric('st3cr', { lambda: 0.005 });
  const view = normalizeView({ metric: 'st3cr', metricParams: { lambda: 0.005 }, camera: { r: 10.4, theta: 1.5, screen: 6 }, N: 8 });
  const geom = tailGeometry(m, view);
  const em = { mu: 0, gamma: -1.5, sigma: 2 / 24, redshiftPower: 3, fudge: 0.7, maxPasses: 0 };
  let seed = 99;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const crossings = Array.from({ length: 40 }, () => ({ r: Math.exp(geom.xLo + rnd() * geom.K / geom.invWidth), g: 0.05 + 1.2 * rnd() }));

  it('geometry: 8 bins from the inner cut to 50 M', () => {
    expect(geom.K).toBe(TAIL_BINS);
    expect(Math.exp(geom.xLo)).toBeCloseTo(/** @type {any} */ (m).terminationRadius(), 12);
    expect(Math.exp(geom.xLo + geom.K / geom.invWidth)).toBeCloseTo(50, 9);
  });
  it('the record decodes to the same bins as binTail (quantized)', () => {
    const rec = packRecord(crossings, geom, em);
    const a = decodeTail(rec, 0, geom), b = binTail(crossings, geom, em, true);
    expect(a.length).toBe(b.length);
    a.forEach((x, n) => { expect(x.W).toBe(b[n].W); expect(x.r).toBeCloseTo(b[n].r, 12); });
    expect(decodeRecord(rec, 0, geom).tail?.length).toBe(b.length);
  });
  it('quantization costs < 1e-4 of W and < 1/510 of a bin in the centroid', () => {
    const q = binTail(crossings, geom, em, true), e = binTail(crossings, geom, em, false);
    q.forEach((x, n) => {
      expect(Math.abs(x.W - e[n].W) / e[n].W).toBeLessThan(1e-4);
      expect(Math.abs(Math.log(x.r) - Math.log(e[n].r)) * geom.invWidth).toBeLessThanOrEqual(1 / 510 + 1e-12);
    });
  });
  it('first 3 crossings + tail = the exact sum when each bin holds crossings at one radius', () => {
    const at = (b) => Math.exp(geom.xLo + (b + 0.5) / geom.invWidth);
    const list = [0, 1, 2, 3, 4, 5, 6, 3, 3].map((b, k) => ({ r: at(b), g: 0.3 + 0.1 * k }));
    const exact = list.reduce((s, c, k) => s + (k === 0 ? 1 : em.fudge) * c.g ** 3 * johnsonSU(c.r, em), 0);
    const tailed = discIntensity(list.slice(0, 3), em, binTail(list, geom, em, false));
    expect(tailed / exact).toBeCloseTo(1, 10);
  });
  it('max passes cuts the tail', () => {
    expect(binTail(crossings, geom, { ...em, maxPasses: 3 })).toEqual([]);
    const five = binTail(crossings, geom, { ...em, maxPasses: 5 });
    expect(five.reduce((s, x) => s + x.W, 0)).toBeCloseTo(crossings.slice(3, 5).reduce((s, c) => s + em.fudge * c.g ** 3, 0), 4);
  });
});
