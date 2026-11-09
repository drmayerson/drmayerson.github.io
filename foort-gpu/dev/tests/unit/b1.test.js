// Stage 1B B1: the fuzzball in units of its ADM mass (rescaleToUnitMass), URL migration.
import { describe, it, expect } from 'vitest';
import { rescaleToUnitMass, inverseMetric } from '../../../js/metrics/common.js';
import { createST3Cr, st3crMass } from '../../../js/metrics/st3cr.js';
import { createST3CrBH } from '../../../js/metrics/st3crBH.js';
import { createMetric } from '../../../js/metrics/registry.js';
import { bakeTables, terminationRadius, tableRadiusFor } from '../../../js/bake/bake.js';
import { createFluid } from '../../../js/fluid/generalCircularRadial.js';
import { tableSpec, fluidSpec } from '../../../js/gpu/traceConfig.js';
import { initialState, stateToQuery } from '../../../js/ui/controls.js';
import { EMISSION_PRESETS } from '../../../js/fluid/emission.js';

const L = st3crMass(2, 50);
let seed = 4242;
const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const close = (a, b, tol) => Math.abs(a - b) <= tol * Math.max(Math.abs(a), Math.abs(b), 1e-300);

describe('rescaleToUnitMass', () => {
  for (const lambda of [0.05, 0.005, 1e-4]) {
    it(`ST3Cr lambda = ${lambda}: wrapped vs raw metric under the scaling, to 1e-12`, () => {
      const raw = createST3Cr({ P: 2, q0: 50, lambda }), w = rescaleToUnitMass(raw);
      expect(L).toBe(24);
      expect(w.massADM).toBe(1);
      for (let k = 0; k < 2000; k++) {
        const r = Math.exp(Math.log(1e-4) + (Math.log(100) - Math.log(1e-4)) * rnd()), th = 0.01 + 3.12 * rnd();
        const a = w.g_dd(r, th), b = raw.g_dd(L * r, th);
        expect(close(a.gtt, b.gtt, 1e-12) && close(a.gtphi, b.gtphi / L, 1e-12) && close(a.gphiphi, b.gphiphi / (L * L), 1e-12)
          && close(a.grr, b.grr, 1e-12) && close(a.gthth, b.gthth / (L * L), 1e-12)).toBe(true);
        const u = /** @type {any} */ (w).g_uu(r, th), v = /** @type {any} */ (raw).g_uu(L * r, th);
        expect(close(u.gtt, v.gtt, 1e-12) && close(u.gtphi, v.gtphi * L, 1e-12) && close(u.gphiphi, v.gphiphi * L * L, 1e-12)
          && close(u.grr, v.grr, 1e-12) && close(u.gthth, v.gthth * L * L, 1e-12)).toBe(true);
      }
      // lengths
      expect(w.terminationRadius?.()).toBeCloseTo(/** @type {any} */ (raw).terminationRadius() / L, 15);
      expect(w.singularities().map((s) => s.r)).toEqual(raw.singularities().map((s) => s.r / L));
      expect(w.singularityEpsilon?.()).toBeCloseTo(/** @type {any} */ (raw).singularityEpsilon() / L, 15);
    });
  }
  it('M_ADM of the wrapped metric is 1 from the large-r falloff of g_tt', () => {
    const w = createMetric('st3cr', { lambda: 0.005 });
    for (const r of [1e4, 1e5]) {
      const M = (1 + w.g_dd(r, 1.1).gtt) * r / 2;   // -g_tt = 1 - 2M/r + O(1/r^2)
      expect(M).toBeCloseTo(1, r >= 1e5 ? 3 : 2);
    }
  });
  it('lambda = 0: the critical impact parameter scales by 1/24', () => {
    const raw = createST3CrBH({ P: 2, q0: 50 }), w = /** @type {any} */ (createMetric('st3crBH', {}));
    const a = raw.criticalImpactParameter(), b = w.criticalImpactParameter();
    expect(b.b).toBeCloseTo(a.b / L, 10);
    expect(b.r).toBeCloseTo(a.r / L, 10);
    expect(b.b).toBeCloseTo(49.7146 / 24, 4);
  });
  it('tables and the fluid ISCO: same nodes (scaled) and the same ISCO as the raw metric', () => {
    const raw = createST3Cr({ P: 2, q0: 50, lambda: 0.005 }), w = rescaleToUnitMass(raw);
    expect(tableRadiusFor(252.5 / 24, L)).toBeCloseTo(1100 / 24, 12);
    const Tr = bakeTables(raw, { nx: 64, nth: 16, rTerm: terminationRadius(raw), rMax: 1100 });
    const Tw = bakeTables(w, { nx: 64, nth: 16, rTerm: terminationRadius(w), rMax: 1100 / L });
    expect(Tw.grid.xMin).toBeCloseTo(Tr.grid.xMin - Math.log(L), 12);
    expect(Tw.grid.dx).toBeCloseTo(Tr.grid.dx, 12);
    // G0 is scale-invariant; the background is too (B'(r/L) relates to B(r) by the same powers of L as G)
    expect(Tw.data[0]).toBeCloseTo(Tr.data[0], 5);
    const fr = createFluid(raw, { xi: 1, betaR: 1, betaPhi: 1 }), fw = createFluid(w, { xi: 1, betaR: 1, betaPhi: 1 });
    expect(/** @type {number} */ (fw.isco)).toBeCloseTo(/** @type {number} */ (fr.isco) / L, 8);
    // the redshift (a ratio of energies) is unchanged. With p_t normalized to 1 in both: p'_mu = (L p_mu) / L, so
    // p'_r = p_r (r = L r') and p'_phi = p_phi / L. Inside the ISCO (radial infall, u^r != 0) and outside it.
    for (const r of [8, 30]) {
      const pr = 0.3, pphi = 4;
      expect(fw.redshift(r / L, 1, pr, pphi / L)).toBeCloseTo(fr.redshift(r, 1, pr, pphi), 8);
    }
  });
  it('view specs: the fuzzball camera and tables in units of M', () => {
    const view = { metric: 'st3cr', metricParams: { lambda: 0.005 }, camera: { r: 250 / 24, theta: 1.5, screen: 150 / 24 }, N: 16 };
    expect(/** @type {any} */ (tableSpec(view)).spec.rMax).toBeCloseTo(1100 / 24, 12);
    expect(fluidSpec(view).spec.range.rMax).toBeCloseTo(1100 / 24, 12);
  });
});

describe('URL migration (version 1 -> 2)', () => {
  it('old fuzzball URLs divide mu and sigma by 24; new URLs carry the version (v=3 since B6) and are left alone', () => {
    const old = initialState(new URLSearchParams('metric=st3cr&mu=0&sigma=2&gamma=-1.5&lambda=0.005'));
    expect(old.sigma).toBeCloseTo(2 / 24, 15);
    expect(old.mu).toBe(0);
    expect(old.gamma).toBe(-1.5);
    const oldDefaults = initialState(new URLSearchParams('metric=st3cr'));
    expect(oldDefaults.mu).toBeCloseTo(2.02 / 24, 15);
    const q = stateToQuery(old);
    expect(q).toContain('v=3');
    const again = initialState(new URLSearchParams(q));
    expect(again.sigma).toBeCloseTo(2 / 24, 15);
    expect(initialState(new URLSearchParams('a=0.5&mu=3')).mu).toBe(3);   // BH URLs unchanged
  });
  it('the Test_FBdetail preset is in units of M', () => {
    expect(EMISSION_PRESETS.Test_FBdetail.emission.sigma).toBeCloseTo(2 / 24, 15);
    expect(EMISSION_PRESETS.Test_FBdetail.r).toBeCloseTo(250 / 24, 12);
  });
});
