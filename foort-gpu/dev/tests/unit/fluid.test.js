import { describe, it, expect } from 'vitest';
import { createFluid, kerrISCO, johnsonSU } from '../../../js/fluid/generalCircularRadial.js';
import { bakeFluid, fluidRedshiftTable } from '../../../js/fluid/fluidTable.js';
import { discIntensity } from '../../../js/fluid/emission.js';
import { createKerr } from '../../../js/metrics/kerr.js';
import { createMankoNovikov } from '../../../js/metrics/mankoNovikov.js';
import { terminationRadius } from '../../../js/bake/bake.js';

const norm = (f, r) => { const { up, down } = f.velocity(r); return up[0] * down[0] + up[1] * down[1] + up[3] * down[3]; };

describe('fluid model (port of FOORT GeneralCircularRadialFluid)', () => {
  it('ISCO of Kerr matches Bardeen-Press-Teukolsky to the bisection tolerance', () => {
    for (const a of [0, 0.5, 0.94, 0.998]) {
      const f = createFluid(createKerr({ a }), { xi: 1, betaR: 1, betaPhi: 1 });
      expect(Math.abs(f.isco / kerrISCO(a) - 1)).toBeLessThan(3e-7);
    }
  });

  it('Keplerian outside the ISCO, Cunningham plunge inside (conserved ISCO E and L), radial infall mixing', () => {
    const a = 0.94, m = createKerr({ a });
    const f = createFluid(m, { xi: 1, betaR: 1, betaPhi: 1 });
    for (const r of [3, 10, 100]) {
      const { up, down } = f.velocity(r);
      expect(up[3] / up[0]).toBeCloseTo(1 / (r ** 1.5 + a), 9);
      expect(down[1]).toBe(0);
    }
    const inA = f.velocity(1.8).down, inB = f.velocity(1.5).down, isco = f.velocity(f.isco).down;
    expect(inA[0]).toBeCloseTo(isco[0], 12); expect(inA[3]).toBeCloseTo(isco[3], 12);
    expect(inA[1]).toBeLessThan(0); expect(inB[1]).toBeLessThan(inA[1]);
    const g = createFluid(m, { xi: 0.6, betaR: 0.4, betaPhi: 0.2 });
    for (const r of [1.5, 2.5, 8, 50]) { expect(norm(f, r)).toBeCloseTo(-1, 10); expect(norm(g, r)).toBeCloseTo(-1, 10); }
    // pure radial infall: E = 1, L = 0
    const rad = createFluid(m, { xi: 1, betaR: 0, betaPhi: 0 }).velocity(20).down;
    expect(rad[0]).toBeCloseTo(-1, 12); expect(rad[3]).toBe(0);
  });

  it('parameters are clamped to [0, 1] (FOORT)', () => {
    expect(createFluid(createKerr({ a: 0.5 }), { xi: 2, betaR: -1, betaPhi: 0.5 }).params).toMatchObject({ xi: 1, betaR: 0, betaPhi: 0.5 });
  });

  it('fluid table: the GPU redshift lookup reproduces the model', () => {
    for (const m of [createKerr({ a: 0.94 }), createMankoNovikov({ a: 0.94, alpha3: 2 })]) {
      const f = createFluid(m, { xi: 0.8, betaR: 0.7, betaPhi: 0.9 });
      const T = bakeFluid(m, { xi: 0.8, betaR: 0.7, betaPhi: 0.9 }, { rTerm: terminationRadius(m), rMax: 1100 });
      for (const r of [1.02 * terminationRadius(m), 2.5, 7, 40, 900]) {
        const exact = f.redshift(r, 1, -0.9, 2.1), tab = fluidRedshiftTable(T, r, 1, -0.9, 2.1);
        expect(Math.abs(tab / exact - 1)).toBeLessThan(2e-5);
      }
    }
  });

  it('disc intensity: Johnson-SU, redshift power, fudge factor and pass bound', () => {
    const p = { mu: 2.02, gamma: -2, sigma: 0.5, redshiftPower: 3, fudge: 0.5, maxPasses: 0 };
    const cr = [{ r: 4, g: 0.8 }, { r: 3, g: 0.6 }, { r: 5, g: 0 }];
    const J = (r) => johnsonSU(r, p);
    expect(discIntensity(cr, p)).toBeCloseTo(0.8 ** 3 * J(4) + 0.5 * 0.6 ** 3 * J(3), 14);
    expect(discIntensity(cr, { ...p, maxPasses: 1 })).toBeCloseTo(0.8 ** 3 * J(4), 14);
    expect(johnsonSU(2.02, { mu: 2.02, gamma: 0, sigma: 0.5 })).toBeCloseTo(2, 14);
  });
});
