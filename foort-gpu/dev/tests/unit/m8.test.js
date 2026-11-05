// M8: the production inoisy field in the contract format (contract validation, normalization, periodicity).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseNoiseField, sampleNoise } from '../../../js/noise/noiseField.js';

const noiseDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../../noise');
const meta = JSON.parse(readFileSync(resolve(noiseDir, 'inoisy_lg21.json'), 'utf8'));
const b = readFileSync(resolve(noiseDir, 'inoisy_lg21.bin'));
const F = parseNoiseField(meta, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));

describe('inoisy_lg21 (inoisy foort_logr, tools/noise/)', () => {
  it('satisfies the contract and documents its generator', () => {
    expect([meta.Nt, meta.Nx, meta.Nphi]).toEqual([128, 128, 256]);
    expect(meta.x_def).toBe('log(r/M)');
    expect(meta.periodic).toEqual({ t: true, phi: true });
    expect(meta.T_over_M).toBe(200);
    for (const k of ['lam', 'tau', 'r12', 'rct_over_M', 'theta_rad']) expect(Number.isFinite(meta.generator[k])).toBe(true);
  });
  it('has zero mean and unit variance at every radius', () => {
    const { Nt, Nx, Nphi } = meta;
    for (let j = 0; j < Nx; j += 9) {
      let s = 0, s2 = 0;
      for (let k = 0; k < Nt; k++) for (let i = 0; i < Nphi; i++) { const v = F.values[(k * Nx + j) * Nphi + i]; s += v; s2 += v * v; }
      const n = Nt * Nphi;
      expect(Math.abs(s / n)).toBeLessThan(1e-3);
      expect(Math.abs(Math.sqrt(s2 / n - (s / n) ** 2) - 1)).toBeLessThan(2e-3);
    }
  });
  it('is continuous across t = T and phi = 2 pi (seam steps like steps inside the field), at every radius', () => {
    const { Nt, Nx, Nphi } = meta;
    const at = (k, j, i) => F.values[(k * Nx + j) * Nphi + i];
    for (let j = 0; j < Nx; j += 7) {
      let seamT = 0, inT = 0, seamP = 0, inP = 0;
      for (let i = 0; i < Nphi; i++) for (let k = 0; k < Nt; k++) {
        inT += Math.abs(at((k + 1) % Nt, j, i) - at(k, j, i)) / Nt;
        inP += Math.abs(at(k, j, (i + 1) % Nphi) - at(k, j, i)) / Nphi;
      }
      for (let i = 0; i < Nphi; i++) seamT += Math.abs(at(0, j, i) - at(Nt - 1, j, i));
      for (let k = 0; k < Nt; k++) seamP += Math.abs(at(k, j, 0) - at(k, j, Nphi - 1));
      // the seam is one of the Nt (Nphi) steps averaged in inT (inP): it must not stand out
      expect(seamT).toBeLessThan(3 * inT + 1e-6);
      expect(seamP).toBeLessThan(3 * inP + 1e-6);
    }
    expect(sampleNoise(F, 17 + meta.T_over_M, 1.2, 0.4)).toBeCloseTo(sampleNoise(F, 17, 1.2, 0.4), 6);
  });
});
