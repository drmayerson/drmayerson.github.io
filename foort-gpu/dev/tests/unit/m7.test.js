// M7: noise-field contract, loader round trip, sampling rule.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { halfToFloat, floatToHalf, parseNoiseField, sampleNoise, noiseTexCoord } from '../../../js/noise/noiseField.js';

const noiseDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../../noise');
const loadFile = (name) => {
  const meta = JSON.parse(readFileSync(resolve(noiseDir, `${name}.json`), 'utf8'));
  const b = readFileSync(resolve(noiseDir, `${name}.bin`));
  return parseNoiseField(meta, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
};

describe('float16', () => {
  it('round-trips representable values and rounds others to the nearest half', () => {
    for (const v of [0, 1, -1, 0.5, 2.75, -3.125, 65504, 6.103515625e-5, 5.960464477539063e-8]) expect(halfToFloat(floatToHalf(v))).toBe(v);
    for (const v of [0.1, -1.2345, 3.14159, 1e-6]) expect(Math.abs(halfToFloat(floatToHalf(v)) - v)).toBeLessThanOrEqual(Math.abs(v) * 2 ** -11 + 6e-8);
  });
});

describe('noise-field contract', () => {
  const meta = { Nt: 2, Nx: 3, Nphi: 4, T_over_M: 10, xmin: 0, xmax: 2, x_def: 'log(r/M)', periodic: { t: true, phi: true } };
  it('parses float16 and float32 files with the same values', () => {
    const vals = Array.from({ length: 24 }, (_, i) => (i - 12) / 8);
    const b16 = new ArrayBuffer(48), d16 = new DataView(b16), b32 = new ArrayBuffer(96), d32 = new DataView(b32);
    vals.forEach((v, i) => { d16.setUint16(2 * i, floatToHalf(v), true); d32.setFloat32(4 * i, v, true); });
    const A = parseNoiseField(meta, b16), B = parseNoiseField({ ...meta, dtype: 'float32' }, b32);
    expect(Array.from(A.values)).toEqual(vals);
    expect(Array.from(B.half)).toEqual(Array.from(A.half));
  });
  it('rejects wrong sizes and non-periodic fields', () => {
    expect(() => parseNoiseField(meta, new ArrayBuffer(46))).toThrow(/bytes/);
    expect(() => parseNoiseField({ ...meta, periodic: { t: false, phi: true } }, new ArrayBuffer(48))).toThrow(/periodic/);
    expect(() => parseNoiseField({ ...meta, xmax: -1 }, new ArrayBuffer(48))).toThrow(/xmax/);
  });
});

describe('placeholder field (tools/noise/gen_placeholder_fft.py)', () => {
  const F = loadFile('placeholder');
  it('is normalized', () => {
    let s = 0, s2 = 0;
    for (const v of F.values) { s += v; s2 += v * v; }
    const n = F.values.length;
    expect(Math.abs(s / n)).toBeLessThan(1e-3);
    expect(Math.abs(Math.sqrt(s2 / n - (s / n) ** 2) - 1)).toBeLessThan(1e-3);
  });
  it('samples the nodes exactly and is periodic in t and phi', () => {
    const m = F.meta, dt = m.T_over_M / m.Nt, dx = (m.xmax - m.xmin) / (m.Nx - 1), dp = 2 * Math.PI / m.Nphi;
    expect(sampleNoise(F, 5 * dt, m.xmin + 7 * dx, 11 * dp)).toBeCloseTo(F.values[(5 * m.Nx + 7) * m.Nphi + 11], 6);
    for (const [tau, x, phi] of [[3.3, 0.7, 1.1], [199.9, -2, 6.2], [-17, 4.4, 0.01]]) {
      const v = sampleNoise(F, tau, x, phi);
      expect(sampleNoise(F, tau + m.T_over_M, x, phi)).toBeCloseTo(v, 5);
      expect(sampleNoise(F, tau, x, phi + 2 * Math.PI)).toBeCloseTo(v, 5);
      expect(sampleNoise(F, tau - 3 * m.T_over_M, x, phi - 4 * Math.PI)).toBeCloseTo(v, 5);
    }
    // clamp in x
    expect(sampleNoise(F, 3, m.xmax + 5, 1)).toBeCloseTo(sampleNoise(F, 3, m.xmax, 1), 6);
  });
  it('is continuous across the period seams (no jump larger than within the field)', () => {
    const m = F.meta;
    let seam = 0, inner = 0;
    for (let k = 0; k < 2000; k++) {
      const x = m.xmin + (m.xmax - m.xmin) * ((k * 0.618) % 1), phi = 2 * Math.PI * ((k * 0.377) % 1), e = 1e-3;
      seam = Math.max(seam, Math.abs(sampleNoise(F, m.T_over_M - e, x, phi) - sampleNoise(F, e, x, phi)), Math.abs(sampleNoise(F, 50, x, 2 * Math.PI - e) - sampleNoise(F, 50, x, e)));
      inner = Math.max(inner, Math.abs(sampleNoise(F, 77 - e, x, phi) - sampleNoise(F, 77 + e, x, phi)), Math.abs(sampleNoise(F, 50, x, 3 - e) - sampleNoise(F, 50, x, 3 + e)));
    }
    expect(seam).toBeLessThan(3 * inner + 1e-3);
  });
  it('texture coordinates put texel centres on the samples', () => {
    const m = F.meta;
    const [s, t, r] = noiseTexCoord(m, 0, m.xmin, 0);
    expect(s * m.Nphi).toBeCloseTo(0.5, 12); expect(t * m.Nx).toBeCloseTo(0.5, 12); expect(r * m.Nt).toBeCloseTo(0.5, 12);
    expect(noiseTexCoord(m, 0, m.xmax, 0)[1] * m.Nx).toBeCloseTo(m.Nx - 0.5, 10);
  });
});
