// Stage 1B B6: quality tiers, URL migration to v3, adaptive-refinement marking.
import { describe, it, expect } from 'vitest';
import { tierSettings, pickTier } from '../../../js/gpu/tiers.js';
import { initialState, stateToQuery } from '../../../js/ui/controls.js';
import { refineList } from '../../../js/gpu/refine.js';
import { RECORD_FLOATS } from '../../../js/gpu/traceConfig.js';

describe('quality tiers', () => {
  it('Reference and High are the plan 1.2 settings', () => {
    expect(tierSettings('reference', 'BH')).toMatchObject({ eps: 0.03, farSteps: null, maxSteps: 5000 });
    expect(tierSettings('reference', 'fuzzball')).toMatchObject({ eps: 0.03, farSteps: null, maxSteps: 10000 });
    expect(tierSettings('high', 'fuzzball')).toMatchObject({ eps: 0.03, farSteps: { r: 20, max: 4 }, maxSteps: 5000 });
  });
  it('auto picks the highest tier within the E1 target', () => {
    // probe of 4096 rays; the full image 512^2 = 64x more
    expect(pickTier({ reference: 20, high: 15, normal: 10 }, 4096, 512 * 512, 'BH').tier).toBe('reference');   // 1.3 s
    expect(pickTier({ reference: 40, high: 30, normal: 20 }, 4096, 512 * 512, 'BH').tier).toBe('high');        // 2.6 / 1.9 s
    expect(pickTier({ reference: 40, high: 35, normal: 20 }, 4096, 512 * 512, 'BH').tier).toBe('normal');      // 2.6 / 2.2 / 1.3 s
    expect(pickTier({ reference: 400, high: 300, normal: 250 }, 4096, 512 * 512, 'fuzzball').tier).toBe('normal');   // none fits: lowest
  });
  it('URLs before v3 that set tracing parameters become quality custom', () => {
    expect(initialState(new URLSearchParams('eps=0.01')).quality).toBe('custom');
    expect(initialState(new URLSearchParams('v=2&maxSteps=10000')).quality).toBe('custom');
    expect(initialState(new URLSearchParams('a=0.5')).quality).toBe('auto');
    expect(initialState(new URLSearchParams('v=3&eps=0.01')).quality).toBe('auto');
    expect(stateToQuery(initialState(new URLSearchParams('')))).toContain('v=3');
  });
});

describe('adaptive refinement marking', () => {
  /** a coarse record image: f(i, j) -> [term, passes, theta, phi, crossing r, g, dt] */
  const coarse = (cw, ch, f) => {
    const a = new Float32Array(RECORD_FLOATS * cw * ch);
    for (let j = 0; j < ch; j++) for (let i = 0; i < cw; i++) {
      const [term, passes, th, ph, r, g, dt] = f(i, j), o = RECORD_FLOATS * (j * cw + i);
      a[o] = term + 16 * passes; a[o + 1] = 100; a[o + 2] = th; a[o + 3] = ph;
      if (passes) { a[o + 4] = r; a[o + 5] = 0; a[o + 6] = dt; a[o + 7] = g; }
    }
    return a;
  };
  const P = { sky: 0.2, r: 2e-3, g: 2e-3, dt: 0.2 };
  it('smooth (even steep) mappings: nothing to trace', () => {
    // linear in the pixel, however steep: bilinear interpolation is exact
    const c = coarse(8, 8, (i, j) => [2, 1, 1 + 0.05 * i, 0.03 * j, 3 + 0.5 * i, 1 + 0.1 * j, 7 * i]);
    expect(refineList(c, 8, 8, 4, 32, 32, P, 1e-3, 1).list.length).toBe(0);
  });
  it('a change of termination class marks the cells around it, all their fine pixels', () => {
    const c = coarse(8, 8, (i, j) => (i === 4 && j === 4 ? [1, 0, 0, 0, 0, 0, 0] : [2, 0, 1 + 1e-3 * i, 1e-3 * j, 0, 0, 0]));
    const r = refineList(c, 8, 8, 4, 32, 32, P, 1e-3, 1);
    expect(r.marked).toBe(4);
    expect(r.list.length).toBe(4 * 16);
    // the coarse sample (4, 4) sits at fine pixel 17.5: cells 3 and 4 cover fine pixels 14..21
    for (const p of r.list) { const x = p % 32, y = (p - x) / 32; expect(x >= 14 && x <= 21 && y >= 14 && y <= 21).toBe(true); }
  });
  it('curvature beyond the thresholds marks: sky, radius, redshift, delay', () => {
    const mk = (f) => refineList(coarse(6, 6, f), 6, 6, 4, 24, 24, P, 1e-3, 1).marked;
    expect(mk((i) => [2, 0, 1 + 0.01 * i * i, 0, 0, 0, 0])).toBeGreaterThan(0);        // second difference 0.02 vs first ~0.05: ~0.2 px
    expect(mk((i) => [2, 0, 1 + 1e-4 * i * i + 0.05 * i, 0, 0, 0, 0])).toBe(0);
    expect(mk((i) => [2, 1, 1, 0, 3 + 0.1 * i * i, 1, 0])).toBeGreaterThan(0);
    expect(mk((i) => [2, 1, 1, 0, 3, 1 + 0.05 * i * i, 0])).toBeGreaterThan(0);
    expect(mk((i) => [2, 1, 1, 0, 3, 1, 2 * i * i])).toBeGreaterThan(0);
  });
});
