// Stage 1B B3: banded fluid model, circumferential envelope radius, comparison presets.
import { describe, it, expect } from 'vitest';
import { createMetric } from '../../../js/metrics/registry.js';
import { createFluid } from '../../../js/fluid/generalCircularRadial.js';
import { bakeFluid, fluidTableRcirc } from '../../../js/fluid/fluidTable.js';
import { discIntensity, EMISSION_PRESETS } from '../../../js/fluid/emission.js';

const uu = (v) => v.up[0] * v.down[0] + v.up[1] * v.down[1] + v.up[3] * v.down[3];

describe('banded fluid model', () => {
  const m = createMetric('st3cr', { lambda: 0.005 });
  const rT = /** @type {number} */ (m.terminationRadius?.());
  const range = { rMin: rT, rMax: 1100 / 24 };
  const fb = createFluid(m, { xi: 1, betaR: 1, betaPhi: 1, model: 'banded', bandRange: range });
  const ff = createFluid(m, { xi: 1, betaR: 1, betaPhi: 1, model: 'foort' });
  it('reproduces the lambda = 0.005 bands: the inner stable band and the outer one from the ISCO', () => {
    const b = /** @type {{from:number, to:number}[]} */ (fb.stableBands);
    expect(b).toHaveLength(2);
    expect(b[0].from).toBeCloseTo(rT, 12);
    expect(b[0].to).toBeGreaterThan(0.0125); expect(b[0].to).toBeLessThan(0.0135);   // 0.313 / 24 in Stage 1's sampling
    expect(b[1].from / /** @type {number} */ (ff.isco)).toBeCloseTo(1, 6);           // the outer band starts at FOORT's ISCO
    expect(b[1].to).toBe(Infinity);
  });
  it('u.u = -1 everywhere; circular in the inner band, FOORT elsewhere', () => {
    for (let k = 0; k < 300; k++) {
      const r = rT * 1.01 * Math.exp((k * Math.log(40 / rT)) / 299);
      expect(Math.abs(uu(fb.velocity(r)) + 1)).toBeLessThan(1e-10);
      expect(Math.abs(uu(ff.velocity(r)) + 1)).toBeLessThan(1e-10);
      const a = fb.velocity(r).up, c = ff.velocity(r).up;
      if (r < 0.0125) expect(a[1]).toBe(0);                                   // circular
      else if (r > 0.0135) for (const q of [0, 1, 3]) expect(Math.abs(a[q] - c[q])).toBeLessThanOrEqual(1e-8 * Math.max(Math.abs(c[q]), 1));   // = FOORT's model (the band edge and FOORT's ISCO differ by ~1e-7 relative: two bisections)
    }
  });
  it('u^mu is continuous at the outer band edge (the plunge starts with the edge orbit), with a jump at the inner band', () => {
    const e = /** @type {{from:number}[]} */ (fb.stableBands)[1].from;
    const lo = fb.velocity(e * (1 - 1e-6)).up, hi = fb.velocity(e * (1 + 1e-6)).up;
    for (const q of [0, 3]) expect(lo[q] / hi[q]).toBeCloseTo(1, 4);
    expect(Math.abs(lo[1])).toBeLessThan(1e-2);
    const t = /** @type {{to:number}[]} */ (fb.stableBands)[0].to;
    expect(Math.abs(fb.velocity(t * 1.05).up[1])).toBeGreaterThan(0.5);   // infalling gas meets the circular inner band
  });
  it('black holes: banded = FOORT', () => {
    const k = createMetric('kerr', { a: 0.9 });
    const a = createFluid(k, { xi: 0.9, betaR: 0.8, betaPhi: 0.7, model: 'banded' }), b = createFluid(k, { xi: 0.9, betaR: 0.8, betaPhi: 0.7, model: 'foort' });
    expect(a.stableBands).toBeNull();
    for (const r of [1.6, 2.2, 5, 30]) expect(a.velocity(r).up).toEqual(b.velocity(r).up);
  });
});

describe('circumferential envelope radius', () => {
  it('the fluid table carries sqrt(g_phiphi) on the equator', () => {
    for (const [id, p] of [['kerr', { a: 0.94 }], ['st3cr', { lambda: 0.005 }]]) {
      const m = createMetric(id, p);
      const rT = /** @type {number} */ (m.terminationRadius?.() ?? m.horizon.r * 1.01);
      const T = bakeFluid(m, { xi: 1, betaR: 1, betaPhi: 1 }, { rTerm: rT * 1.0001, rMax: 1100 });
      for (const r of [3, 10, 100]) expect(Math.abs(fluidTableRcirc(T, r) / Math.sqrt(m.g_dd(r, Math.PI / 2).gphiphi) - 1)).toBeLessThan(1e-4);   // linear in a 2048-node table
    }
  });
  it('discIntensity uses the mapped radius', () => {
    const em = { mu: 3, gamma: -1.5, sigma: 1, redshiftPower: 3, fudge: 1, maxPasses: 0 };
    const c = [{ r: 4, g: 0.8 }];
    expect(discIntensity(c, { ...em, radius: (r) => r })).toBe(discIntensity(c, em));
    expect(discIntensity(c, { ...em, radius: (r) => 2 * r })).not.toBe(discIntensity(c, em));
  });
  it('comparison presets: same camera and disc, circumferential radius, banded fluid', () => {
    const keys = Object.keys(EMISSION_PRESETS).filter((k) => k.startsWith('Compare'));
    expect(keys).toHaveLength(6);
    for (const k of keys) {
      const p = /** @type {any} */ (EMISSION_PRESETS)[k];
      expect(p.state).toEqual({ envelope: 'circumferential', fluidModel: 'banded' });
      expect([p.r, p.inc, p.screen]).toEqual([1000, 60, 16]);
    }
  });
});
