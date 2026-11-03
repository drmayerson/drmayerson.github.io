import { describe, it, expect } from 'vitest';
import { TetradCamera, innerProduct } from '../../../js/camera/tetradCamera.js';
import { kerrGdd, kerrGuu } from '../../../bench/kerr.js';
import { buildUniforms, compareRecords, quadrant, tiles, DEFAULTS } from '../../../bench/setup.js';

/** @param {number[][]} g @param {number[]} p covariant */
function hamiltonian(g, p) {
  let s = 0;
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) s += g[i][j] * p[i] * p[j];
  return s;
}

describe('TetradCamera.fromStaticObserver (FOORT ViewScreen port)', () => {
  const cases = [
    { a: 0, r: 1000, th: Math.PI / 2 },
    { a: 0.94, r: 1000, th: 0.2967 },
    { a: 0.998, r: 50, th: 1.4 },
  ];
  for (const { a, r, th } of cases) {
    it(`builds an orthonormal frame (a=${a}, r=${r}, th=${th})`, () => {
      const gdd = kerrGdd(a, r, th);
      const cam = TetradCamera.fromStaticObserver(gdd, kerrGuu(a, r, th), [0, r, th, 0]);
      expect(cam.warnings).toEqual([]);
      // undo FOORT's extra r and r sin(theta) factors on legs 2 and 3
      const e = cam.vielbein.map((v, k) => v.map((x) => x / (k === 2 ? r : k === 3 ? r * Math.sin(th) : 1)));
      const eta = [-1, 1, 1, 1];
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++)
        expect(innerProduct(gdd, e[i], e[j])).toBeCloseTo(i === j ? eta[i] : 0, 10);
    });

    it(`gives null, past-pointing, inward momenta with p_t = 1 (a=${a})`, () => {
      const gdd = kerrGdd(a, r, th);
      const guu = kerrGuu(a, r, th);
      const cam = TetradCamera.fromStaticObserver(gdd, guu, [0, r, th, 0]);
      for (const [al, be] of [[0, 0], [7.5, -7.5], [-3, 5]]) {
        const { up, down } = cam.initialMomentum(al, be);
        expect(down[0]).toBeCloseTo(1, 12);
        expect(Math.abs(hamiltonian(guu, down))).toBeLessThan(1e-12);
        expect(up[0]).toBeLessThan(0);
        expect(up[1]).toBeLessThan(0);
      }
    });
  }

  it('central pixel is radial for Schwarzschild', () => {
    const r = 1000, th = 1.0;
    const cam = TetradCamera.fromStaticObserver(kerrGdd(0, r, th), kerrGuu(0, r, th), [0, r, th, 0]);
    const { down } = cam.initialMomentum(0, 0);
    expect(Math.abs(down[2])).toBeLessThan(1e-14);
    expect(Math.abs(down[3])).toBeLessThan(1e-14);
  });

  it('screen alpha maps to p_phi = alpha sin(theta_obs) for a distant Schwarzschild camera', () => {
    // asymptotically, alpha is the impact parameter along -phi-hat: L = p_phi ~ alpha sin(theta)
    const r = 1e6, th = 1.2, al = 5;
    const cam = TetradCamera.fromStaticObserver(kerrGdd(0, r, th), kerrGuu(0, r, th), [0, r, th, 0]);
    const { down } = cam.initialMomentum(al, 0);
    expect(Math.abs(down[3])).toBeCloseTo(al * Math.sin(th), 4);
  });
});

describe('benchmark helpers', () => {
  it('tiles cover the image exactly once', () => {
    const N = 300, cover = new Uint8Array(N * N);
    for (const t of tiles(N, 128)) for (let y = t.y; y < t.y + t.h; y++) for (let x = t.x; x < t.x + t.w; x++) cover[y * N + x]++;
    expect(cover.every((c) => c === 1)).toBe(true);
  });

  it('quadrant follows FOORT FourColorScreen', () => {
    expect(quadrant(2, 1, 1)).toBe(1);
    expect(quadrant(2, 1, 4)).toBe(2);
    expect(quadrant(2, 2, 1)).toBe(3);
    expect(quadrant(2, 2, 4)).toBe(4);
    expect(quadrant(1, 1, 1)).toBe(0);
  });

  it('compareRecords reports identical records as identical', () => {
    const rec = new Float32Array([2, 100, 1, 1, 1, 50, 0, 0, 2, 80, 2, 5]);
    const c = compareRecords(rec, rec.slice());
    expect(c.fourColorAgreement).toBe(1);
    expect(c.codeAgreement).toBe(1);
    expect(c.escapeAngleMax).toBeLessThan(1e-7);
  });

  it('buildUniforms packs FOORT KerrExample defaults', () => {
    const U = buildUniforms(DEFAULTS);
    expect(U.E).toHaveLength(16);
    expect(U.p0[1]).toBeCloseTo(1 + Math.sqrt(1 - 0.94 ** 2), 12);
    expect(U.p1[3]).toBeCloseTo(1010, 12);
    expect(U.warnings).toEqual([]);
  });
});
