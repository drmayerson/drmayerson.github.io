// Stage 1B B4: fuzzball noise fields (inoisy foort_logr with the banded fluid's Omega(r)), anchor selection, coverage guard.
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseNoiseField, noiseFadeWidth, noiseCover, autoNoiseField } from '../../../js/noise/noiseField.js';

const noiseDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../../noise');
const ANCHORS = ['0', '1e-3', '5e-3', '0.05'];

describe('anchor selection (auto)', () => {
  it('black holes get the Lee & Gammie field, the lambda = 0 ST3Cr black hole the lambda = 0 anchor', () => {
    expect(autoNoiseField('kerr', { a: 0.9 })).toBe('inoisy_lg21');
    expect(autoNoiseField('rn', { q: 0.5 })).toBe('inoisy_lg21');
    expect(autoNoiseField('st3crBH', {})).toBe('inoisy_st3cr_l0');
  });
  it('fuzzballs get the anchor nearest in log lambda', () => {
    const f = (/** @type {number} */ lambda) => autoNoiseField('st3cr', { lambda });
    expect(f(1e-4)).toBe('inoisy_st3cr_l0');
    expect(f(5e-4)).toBe('inoisy_st3cr_l1e-3');
    expect(f(1e-3)).toBe('inoisy_st3cr_l1e-3');
    expect(f(2e-3)).toBe('inoisy_st3cr_l1e-3');
    expect(f(3e-3)).toBe('inoisy_st3cr_l5e-3');
    expect(f(5e-3)).toBe('inoisy_st3cr_l5e-3');
    expect(f(0.02)).toBe('inoisy_st3cr_l0.05');
    expect(f(0.1)).toBe('inoisy_st3cr_l0.05');
  });
});

describe('coverage guard', () => {
  const m = /** @type {any} */ ({ xmin: -9, xmax: 5, fadeWidth: 2 });
  it('is 1 inside the range and fades linearly to 0 over fadeWidth outside it', () => {
    expect(noiseCover(m, 0)).toBe(1);
    expect(noiseCover(m, 5)).toBe(1);
    expect(noiseCover(m, 6)).toBeCloseTo(0.5, 12);
    expect(noiseCover(m, -10)).toBeCloseTo(0.5, 12);
    expect(noiseCover(m, 8)).toBe(0);
  });
  it('fade width falls back to lam |cos theta|, then 1', () => {
    expect(noiseFadeWidth(/** @type {any} */ ({ generator: { lam: 5, theta_rad: -1.22173 } }))).toBeCloseTo(1.7101, 4);
    expect(noiseFadeWidth(/** @type {any} */ ({}))).toBe(1);
  });
});

for (const a of ANCHORS) {
  const name = `inoisy_st3cr_l${a}`;
  const have = existsSync(resolve(noiseDir, `${name}.json`));
  describe.skipIf(!have)(name, () => {
    const meta = have ? JSON.parse(readFileSync(resolve(noiseDir, `${name}.json`), 'utf8')) : null;
    const b = have ? readFileSync(resolve(noiseDir, `${name}.bin`)) : Buffer.alloc(0);
    const F = have ? parseNoiseField(meta, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)) : null;
    it('satisfies the contract, covers r = 1e-4 ... 200 M and records its Omega table and anchor', () => {
      expect([meta.Nt, meta.Nx, meta.Nphi]).toEqual([128, 192, 128]);
      expect(meta.x_def).toBe('log(r/M)');
      expect(meta.periodic).toEqual({ t: true, phi: true });
      expect(meta.T_over_M).toBe(200);
      expect(meta.xmin).toBeCloseTo(Math.log(1e-4), 3);
      expect(Math.exp(meta.xmax)).toBeGreaterThan(195);
      expect(meta.generator.omega).toBe(`st3cr_l${a}.txt`);
      expect(meta.anchor).toBe(`st3cr lambda=${a}`);
      expect(meta.fadeWidth).toBeCloseTo(5 * Math.abs(Math.cos(meta.generator.theta_rad)), 6);
      expect(b.byteLength).toBe(128 * 192 * 128 * 2);
    });
    it('has zero mean and unit variance at every radius', () => {
      const { Nt, Nx, Nphi } = meta;
      for (let j = 0; j < Nx; j += 7) {
        let s = 0, s2 = 0;
        for (let k = 0; k < Nt; k++) for (let i = 0; i < Nphi; i++) { const v = /** @type {any} */ (F).values[(k * Nx + j) * Nphi + i]; s += v; s2 += v * v; }
        const n = Nt * Nphi, mean = s / n;
        expect(Math.abs(mean)).toBeLessThan(1e-3);
        expect(Math.sqrt(s2 / n - mean * mean)).toBeCloseTo(1, 2);
      }
    });
    it('is periodic in t and phi: the wrap-around step is like an interior step', () => {
      const { Nt, Nx, Nphi } = meta, V = /** @type {any} */ (F).values;
      let jt = 0, it_ = 0, jp = 0, ip = 0, n = 0;
      for (let j = 0; j < Nx; j += 5) for (let i = 0; i < Nphi; i += 3) {
        const at = (/** @type {number} */ k, /** @type {number} */ ii) => V[(k * Nx + j) * Nphi + ii];
        jt += Math.abs(at(0, i) - at(Nt - 1, i)); it_ += Math.abs(at(Nt / 2, i) - at(Nt / 2 - 1, i));
        jp += Math.abs(at(i % Nt, 0) - at(i % Nt, Nphi - 1)); ip += Math.abs(at(i % Nt, Nphi / 2) - at(i % Nt, Nphi / 2 - 1));
        n++;
      }
      expect(jt / it_).toBeGreaterThan(0.7); expect(jt / it_).toBeLessThan(1.4);
      expect(jp / ip).toBeGreaterThan(0.7); expect(jp / ip).toBeLessThan(1.4);
    });
  });
}
