import { describe, it, expect } from 'vitest';
import { bakeTables, backgroundG, keplerOrbit, emitterRedshift, tableRadiusFor } from '../../../js/bake/bake.js';
import { lookupTables, lookupEquator } from '../../../js/bake/hermite.js';
import { createKerr } from '../../../js/metrics/kerr.js';
import { createMankoNovikov } from '../../../js/metrics/mankoNovikov.js';
import { createJohannsen } from '../../../js/metrics/johannsen.js';
import { tableSpec, gpuTraceSetup } from '../../../js/gpu/traceConfig.js';

/** Closed-form Kerr G0..G4 at (x, theta), x = log(r - r_+). */
const kerrG = (a, x, th) => {
  const m = createKerr({ a }), e = Math.exp(x), r = m.horizon.r + e, u = m.g_uu(r, th);
  return [u.gtt, u.gtphi, Math.sin(th) ** 2 * u.gphiphi, u.grr / (e * e), u.gthth];
};

describe('metric tables (js/bake)', () => {
  const a = 0.94;
  const T = bakeTables(createKerr({ a }), { nx: 512, nth: 128 });
  const g = T.grid;

  it('grid: symmetric half table from the termination radius to rMax', () => {
    expect(g.symmetric).toBe(true);
    expect(g.thMax).toBeCloseTo(Math.PI / 2, 15);
    expect(g.r0 + Math.exp(g.xMin)).toBeCloseTo(1.01 * g.r0, 12);
    expect(g.r0 + Math.exp(g.xMin + (g.nx - 1) * g.dx)).toBeCloseTo(1100, 8);
    expect(T.validation.ok).toBe(true);
  });

  it('reproduces the metric at the nodes (residual + background)', () => {
    for (const [i, j] of [[0, 0], [100, 40], [511, 127], [300, 127]]) {
      const x = g.xMin + i * g.dx, d = Math.max(j * g.dth, 1e-6);
      const L = lookupTables(T, x, d, 1), ref = kerrG(a, x, d);
      for (let l = 0; l < 5; l++) expect(Math.abs(L.v[l] - ref[l])).toBeLessThan(1e-6 * Math.max(1, Math.abs(ref[l])));
    }
  });

  it('interpolated values and derivatives match closed-form Kerr', () => {
    const h = 1e-4;
    for (const [x, d] of [[0.3, 0.7], [2.0, 1.2], [5.5, 0.05], [-3.5, 1.5]]) {
      const L = lookupTables(T, x, d, 1), f = kerrG(a, x, d);
      const fx = (l) => (kerrG(a, x + h, d)[l] - kerrG(a, x - h, d)[l]) / (2 * h);
      const ft = (l) => (kerrG(a, x, d + h)[l] - kerrG(a, x, d - h)[l]) / (2 * h);
      for (let l = 0; l < 5; l++) {
        const sc = Math.max(Math.abs(f[l]), Math.abs(kerrG(a, x, Math.PI / 2)[l]), Math.abs(kerrG(a, x, 0.01)[l]));
        expect(Math.abs(L.v[l] - f[l]) / sc).toBeLessThan(1e-6);
        expect(Math.abs(L.dx[l] - fx(l)) / sc).toBeLessThan(1e-4);
        expect(Math.abs(L.dd[l] - ft(l)) / sc).toBeLessThan(1e-4);
      }
    }
  });

  it('mirror logic: south hemisphere and stages through the axis and equator', () => {
    const x = 1.1, d = 0.4;
    const N = lookupTables(T, x, d, 1), S = lookupTables(T, x, d, -1);
    for (let l = 0; l < 5; l++) { expect(S.v[l]).toBe(N.v[l]); expect(S.dd[l]).toBe(N.dd[l]); }
    const neg = lookupTables(T, x, -d, 1), over = lookupTables(T, x, Math.PI - d, 1);
    for (let l = 0; l < 5; l++) {
      expect(neg.v[l]).toBeCloseTo(N.v[l], 12); expect(neg.dd[l]).toBeCloseTo(-N.dd[l], 12);
      expect(over.v[l]).toBeCloseTo(N.v[l], 12); expect(over.dd[l]).toBeCloseTo(-N.dd[l], 12);
    }
  });

  it('full table for the equatorially asymmetric Manko-Novikov metric; covers r >= its termination radius', () => {
    const m = createMankoNovikov({ a: 0.94, alpha3: 2 });
    const TM = bakeTables(m, { nx: 256, nth: 64 });
    expect(TM.grid.symmetric).toBe(false);
    expect(TM.grid.nth).toBe(127);
    expect(TM.grid.r0 + Math.exp(TM.grid.xMin)).toBeCloseTo(m.terminationRadius(), 10);
    expect(TM.validation.ok).toBe(true);
    // north and south differ for alpha3 != 0
    const n = lookupTables(TM, 0.5, 0.6, 1).v, s = lookupTables(TM, 0.5, 0.6, -1).v;
    expect(Math.abs(n[0] - s[0])).toBeGreaterThan(1e-6);
  });

  it('flags a metric that is invalid on its table', () => {
    // Johannsen below the alpha13 bound has a CTC band outside r_+ (1.01)
    const TJ = bakeTables(createJohannsen({ a: 0.9, alpha13: -0.9999 * (1 + Math.sqrt(1 - 0.81)) ** 3 }), { nx: 128, nth: 32 });
    expect(TJ.validation.ok).toBe(false);
  });

  it('background: regular, with the large-r behaviour of the metric', () => {
    const { B } = backgroundG(1e4, g.r0, 1);
    const f = kerrG(a, Math.log(1e4 - g.r0), 1.0);
    for (const l of [0, 2, 3, 4]) expect(Math.abs(f[l] - B[l]) / Math.abs(f[l])).toBeLessThan(1e-7);
    const near = backgroundG(g.r0 * 1.001, g.r0, 1);
    expect(near.B.every(Number.isFinite) && near.dB.every(Number.isFinite)).toBe(true);
  });

  it('equatorial emitter: Kerr Keplerian orbit and its table', () => {
    const orbit = keplerOrbit(createKerr({ a }));
    for (const r of [4, 10, 100]) {
      const o = orbit(r), Om = 1 / (r ** 1.5 + a);
      expect(o.Om).toBeCloseTo(Om, 9);
      const ut = (r ** 1.5 + a) / (r ** 0.75 * Math.sqrt(r ** 1.5 - 3 * Math.sqrt(r) + 2 * a));
      expect(o.ut / ut - 1).toBeLessThan(1e-8);
      const L = lookupEquator(T, Math.log(r - g.r0));
      expect(L.ut / ut - 1).toBeLessThan(1e-5);
      expect(emitterRedshift(L, 1, -2)).toBeCloseTo(emitterRedshift(o, 1, -2), 5);
    }
    expect(orbit(1.3).ut).toBe(0);   // inside the photon orbit
  });

  it('table radius steps by decades; traceConfig connects tables and uniforms', () => {
    expect(tableRadiusFor(1010)).toBe(1100);
    expect(tableRadiusFor(1.01e5)).toBeCloseTo(1.1e5, 6);
    const view = { metric: 'johannsen', metricParams: { a: 0.5, alpha13: 2 }, camera: { r: 1000, theta: 1, screen: 15 }, N: 16 };
    const ts = tableSpec(view);
    const TJ = bakeTables(createJohannsen({ a: 0.5, alpha13: 2 }), ts.spec);
    const setup = gpuTraceSetup(view, TJ);
    expect(setup.program).toBe('trace');
    expect(setup.tableKey).toBe(ts.key);
    expect(() => gpuTraceSetup({ ...view, camera: { ...view.camera, r: 5000 } }, TJ)).toThrow(/cover/);
  });
});
