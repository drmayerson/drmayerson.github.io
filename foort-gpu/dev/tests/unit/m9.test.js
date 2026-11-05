// M9: "add a metric" (Reissner-Nordström: one module + one registry entry) and the registry-driven controls.
import { describe, it, expect } from 'vitest';
import { createReissnerNordstrom } from '../../../js/metrics/reissnerNordstrom.js';
import { METRICS, createMetric } from '../../../js/metrics/registry.js';
import { invertCircular } from '../../../js/metrics/common.js';
import { bakeTables, terminationRadius } from '../../../js/bake/bake.js';
import { lookupTables } from '../../../js/bake/hermite.js';
import { createFluid } from '../../../js/fluid/generalCircularRadial.js';
import { CONTROLS } from '../../../js/ui/controls.js';

describe('Reissner-Nordström', () => {
  const m = createReissnerNordstrom({ Q: 0.6 });
  it('has a valid metric whose closed-form inverse matches the generic one', () => {
    expect(m.validate().ok).toBe(true);
    expect(m.horizon).toEqual({ kind: 'sphere', r: 1.8 });
    for (const [r, th] of [[2.5, 0.4], [10, 1.2], [300, 2.9]]) {
      const a = m.g_uu(r, th), b = invertCircular(m.g_dd(r, th));
      for (const k of ['gtt', 'grr', 'gthth', 'gphiphi']) expect(a[k] / b[k]).toBeCloseTo(1, 12);
    }
    expect(createReissnerNordstrom({ Q: 1.2 }).validate().ok).toBe(false);
  });
  it('reduces to Schwarzschild at Q = 0 (photon sphere 3, b_c = 3 sqrt 3, ISCO 6)', () => {
    const s = createReissnerNordstrom({ Q: 0 });
    const c = s.criticalImpactParameter();
    expect(c.r).toBeCloseTo(3, 12);
    expect(c.b).toBeCloseTo(3 * Math.sqrt(3), 12);
    expect(createFluid(s, { xi: 1, betaR: 1, betaPhi: 1 }).isco).toBeCloseTo(6, 4);
  });
  it('bakes through the generic pipeline', () => {
    const T = bakeTables(m, { nx: 256, nth: 64, rTerm: terminationRadius(m), rMax: 1100 });
    expect(T.validation.ok).toBe(true);
    const L = lookupTables(T, Math.log(5 - 1.8), 0.9, 1), u = m.g_uu(5, 0.9);
    expect(L.v[0] / u.gtt).toBeCloseTo(1, 6);
  });
});

describe('registry-driven controls', () => {
  it('every visible metric is in the metric menu and every non-fixed parameter has a slider', () => {
    const menu = /** @type {any} */ (CONTROLS.find((c) => c.key === 'metric')).options;
    for (const e of METRICS) {
      expect(menu.includes(e.id)).toBe(!e.hidden);
      for (const p of e.params) if (!p.fixed) {
        const c = CONTROLS.find((x) => x.key === p.name);
        expect(c, p.name).toBeDefined();
        expect(c?.visible?.({ metric: e.id })).toBe(true);
      }
    }
    expect(createMetric('reissnerNordstrom', { Q: 0.3 }).params.Q).toBe(0.3);
  });
});
