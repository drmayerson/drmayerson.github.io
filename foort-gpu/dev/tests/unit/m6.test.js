// M6: fuzzball mode through the bake pipeline (x = log r), singularity terminations, fluid bands.
import { describe, it, expect } from 'vitest';
import { bakeTables, backgroundG, terminationRadius } from '../../../js/bake/bake.js';
import { lookupTables } from '../../../js/bake/hermite.js';
import { createST3Cr, ST3CR_EPS_REL } from '../../../js/metrics/st3cr.js';
import { createST3CrBH, ST3CRBH_RCUT } from '../../../js/metrics/st3crBH.js';
import { inverseMetric, pointValidity, pointValidityInverse } from '../../../js/metrics/common.js';
import { createFluid } from '../../../js/fluid/generalCircularRadial.js';
import { bakeFluid } from '../../../js/fluid/fluidTable.js';
import { gpuTraceSetup, tableSpec, fluidSpec, cpuTraceOptions } from '../../../js/gpu/traceConfig.js';
import { createMetric } from '../../../js/metrics/registry.js';

const fb = { r: 250, theta: 1.5, screen: 150 };

describe('horizonless background', () => {
  it('is bounded at small r and agrees with the horizon background to O(M^2/r^2) at large r', () => {
    const M = 24;
    const small = backgroundG(1e-4, 0, M).B;
    expect(Math.abs(small[0])).toBeLessThan(6);
    expect(small[2]).toBeCloseTo(1 / (M * M), 12);
    const r = 1e5, far = backgroundG(r, 0, M).B, bh = backgroundG(r, 1e-9, M).B;
    for (const k of [0, 2, 3, 4]) expect(Math.abs(far[k] - bh[k]) / Math.abs(bh[k])).toBeLessThan(2 * M * M / (r * r));
  });
  it('x-derivatives match finite differences', () => {
    const M = 24, x = Math.log(3), h = 1e-5;
    const d = backgroundG(Math.exp(x), 0, M).dB;
    const p = backgroundG(Math.exp(x + h), 0, M).B, m = backgroundG(Math.exp(x - h), 0, M).B;
    for (const k of [0, 2, 3, 4]) expect(d[k]).toBeCloseTo((p[k] - m[k]) / (2 * h), 7);
  });
});

describe('validity from the inverse metric', () => {
  it('agrees with the g_dd test on ST3Cr samples', () => {
    const m = createST3Cr({ P: 2, q0: 50, lambda: 0.005 });
    const guu = inverseMetric(m);
    for (const r of [0.01, 0.2, 0.5, 3, 80]) for (const th of [0.1, 0.8, 1.5]) expect(pointValidityInverse(guu(r, th))).toBe(pointValidity(m.g_dd(r, th)));
  });
});

describe('ST3Cr tables', () => {
  const m = createST3Cr({ P: 2, q0: 50, lambda: 0.005 });
  const l = 8 * 8 * 0.005, R = m.singularities()[2].r;
  const T = bakeTables(m, { nx: 512, nth: 128, rTerm: terminationRadius(m), rMax: 1100 });
  it('bake on x = log r from the inner cut, valid', () => {
    expect(T.grid.r0).toBe(0);
    expect(terminationRadius(m)).toBeCloseTo(ST3CR_EPS_REL * Math.min(l / 2, R), 12);
    expect(Math.exp(T.grid.xMin)).toBeCloseTo(terminationRadius(m), 12);
    expect(T.validation.ok).toBe(true);
  });
  it('interpolates to 1e-5 away from the centres and the ring', () => {
    const guu = inverseMetric(m);
    for (const [r, th] of [[2, 0.7], [30, 1.2], [0.9, 0.3], [400, 1.5]]) {
      const L = lookupTables(T, Math.log(r), th, 1), u = guu(r, th);
      expect(Math.abs(L.v[0] - u.gtt) / Math.abs(u.gtt)).toBeLessThan(1e-5);
      expect(Math.abs(L.v[3] - u.grr / (r * r)) / (u.grr / (r * r))).toBeLessThan(1e-5);
    }
  });
  it('lambda = 0 black hole bakes down to r_cut', () => {
    const bh = createST3CrBH({ P: 2, q0: 50 });
    const TB = bakeTables(bh, { nx: 256, nth: 32, rTerm: terminationRadius(bh), rMax: 1100 });
    expect(terminationRadius(bh)).toBe(ST3CRBH_RCUT);
    expect(TB.validation.ok).toBe(true);
    const r = 0.01, L = lookupTables(TB, Math.log(r), 1, 1);
    expect(L.v[0] / -Math.sqrt(bh.Q(r)) - 1).toBeLessThan(1e-6);
  });
});

describe('fluid for horizonless metrics', () => {
  it('FOORT bisection ISCO and the circular-orbit bands', () => {
    const f = createFluid(createST3CrBH({ P: 2, q0: 50 }), { xi: 1, betaR: 1, betaPhi: 1 });
    expect(f.isco).toBeCloseTo(18.723, 2);
    expect(f.circularBands(0.002, 1000).map((b) => b.kind)).toEqual(['none', 'unstable', 'stable']);
    const g = createFluid(createST3Cr({ P: 2, q0: 50, lambda: 0.005 }), { xi: 1, betaR: 1, betaPhi: 1 });
    expect(g.circularBands(0.001, 1000).filter((b) => b.kind === 'stable').length).toBe(2);
  });
});

describe('fuzzball views', () => {
  it('singularity uniforms, inner cut and the CPU reference options', () => {
    const view = { metric: 'st3cr', metricParams: { lambda: 0.005 }, camera: fb, N: 16 };
    const m = createMetric('st3cr', { lambda: 0.005 });
    const ts = /** @type {any} */ (tableSpec(view));
    const T = bakeTables(m, { ...ts.spec, nx: 128, nth: 32 });
    const fs = fluidSpec(view);
    const F = bakeFluid(m, fs.spec.fluid, fs.spec.range);
    const s = gpuTraceSetup(view, T, F);
    const [zc, R, eps, on] = /** @type {number[]} */ (s.uniforms.uSing[1]);
    expect(zc).toBeCloseTo(0.16, 12);
    expect(R).toBeCloseTo(m.singularities()[2].r, 12);
    expect(eps).toBeCloseTo(ST3CR_EPS_REL * 0.16, 12);
    expect(on).toBe(1);
    expect(s.uniforms.uStep[1][2]).toBeCloseTo(ST3CR_EPS_REL * 0.16, 12);
    expect(s.uniforms.uMetric[1][0]).toBe(0);
    const c = cpuTraceOptions(view);
    expect(c.options.singularity).toEqual({ mode: 'euclid', eps });
    expect(c.options.rTerm).toBeCloseTo(eps, 12);
    // FOORT-like overrides
    const c2 = cpuTraceOptions({ ...view, rInner: 0.01, singEps: 0.001 });
    expect(c2.options.rTerm).toBe(0.01);
    expect(c2.options.singularity).toEqual({ mode: 'euclid', eps: 0.001 });
  });
});
