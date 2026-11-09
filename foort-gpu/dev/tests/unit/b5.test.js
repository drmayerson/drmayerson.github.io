// Stage 1B B5: exact speedups. The ST3Cr table identity, and the generated closed-form metrics against the JS metrics.
import { describe, it, expect } from 'vitest';
import { createMetric, METRICS } from '../../../js/metrics/registry.js';
import { inverseMetric } from '../../../js/metrics/common.js';
import { closedDerivedByName, CLOSED_FORMS } from '../../../js/metrics/closedForm.js';
import * as kerr from './closed/kerr.js';
import * as johannsen from './closed/johannsen.js';
import * as reissnerNordstrom from './closed/reissnerNordstrom.js';
import * as mankoNovikov from './closed/mankoNovikov.js';

const GEN = { kerr, johannsen, reissnerNordstrom, mankoNovikov };

// a deterministic stream of random numbers
let seed = 12345;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);

/** G0..G4 of js/bake/bake.js from the JS metric, in double, at (r, theta); x = log(r - r0) */
function Gjs(m, r, th) {
  const r0 = m.horizon.kind === 'sphere' ? m.horizon.r : 0;
  const u = inverseMetric(m)(r, th), e = r - r0, s2 = Math.sin(th) ** 2;
  return [u.gtt, u.gtphi, s2 * u.gphiphi, u.grr / (e * e), u.gthth];
}

describe('ST3Cr table identity G3 = G4 (g^rr = r^2 g^thth)', () => {
  for (const [id, p] of [['st3cr', { lambda: 0.05 }], ['st3cr', { lambda: 5e-3 }], ['st3cr', { lambda: 1e-4 }], ['st3crBH', {}]]) {
    it(`${id} ${JSON.stringify(p)}: to 1e-12 in double, and only metrics flagged in the registry`, () => {
      const m = createMetric(id, p);
      expect(METRICS.find((x) => x.id === id)?.g3equalsG4).toBe(true);
      let worst = 0;
      for (let k = 0; k < 3000; k++) {
        const r = Math.exp(-9 + 15 * rnd()), th = 1e-3 + (Math.PI - 2e-3) * rnd();
        const G = Gjs(m, r, th);
        worst = Math.max(worst, Math.abs(G[3] - G[4]) / Math.abs(G[4]));
      }
      expect(worst).toBeLessThan(1e-12);
    });
  }
  it('is not claimed for other metrics', () => {
    for (const e of METRICS) if (!['st3cr', 'st3crBH'].includes(e.id)) expect(e.g3equalsG4).toBeFalsy();
  });
});

const CASES = [
  ['kerr', { a: 0 }], ['kerr', { a: 0.94 }], ['kerr', { a: 0.998 }],
  ['johannsen', { a: 0.94, alpha13: 5.5 }], ['johannsen', { a: 0.5, alpha13: -0.5 }],
  ['reissnerNordstrom', { Q: 0.8 }], ['reissnerNordstrom', { Q: 0 }],
  ['mankoNovikov', { a: 0.94, alpha3: 2 }], ['mankoNovikov', { a: 0.5, alpha3: 0.1 }], ['mankoNovikov', { a: 0.5, alpha3: -0.5 }],
];

describe('generated closed-form metrics (tools/codegen/gen_metrics.py) vs the JS metrics, in double', () => {
  for (const [id, p] of CASES) {
    it(`${id} ${JSON.stringify(p)}: values and both derivatives`, () => {
      const m = createMetric(id, p);
      const gen = GEN[id], P = m.params, D = closedDerivedByName(id, P);
      expect(gen.params.every((n) => n in P)).toBe(true);
      const r0 = m.horizon.r, rT = m.terminationRadius?.() ?? r0 * 1.01;
      let worst = { v: 0, dx: 0, dd: 0 };
      for (let k = 0; k < 400; k++) {
        const r = rT + Math.exp(Math.log(1e-3) + Math.log(1e6) * rnd()), x = Math.log(r - r0);
        const delta = 0.02 + (Math.PI / 2 - 0.02) * rnd(), hemi = rnd() < 0.5 ? 1 : -1;
        const th = hemi > 0 ? delta : Math.PI - delta;
        const g = gen.lookup(x, delta, hemi, P, D);
        const G = Gjs(m, r, th);
        // derivatives by central differences of the JS metric: d/dx = (r - r0) d/dr, d/d delta = hemi d/d theta
        const hx = 1e-5, hd = 1e-5;
        const Gxp = Gjs(m, r0 + Math.exp(x + hx), th), Gxm = Gjs(m, r0 + Math.exp(x - hx), th);
        const Gdp = Gjs(m, r, hemi > 0 ? delta + hd : Math.PI - delta - hd), Gdm = Gjs(m, r, hemi > 0 ? delta - hd : Math.PI - delta + hd);
        for (let l = 0; l < 5; l++) {
          const scale = Math.max(Math.abs(G[l]), 1e-300);
          if (G[l] === 0) expect(Math.abs(g.v[l])).toBeLessThan(1e-12); else worst.v = Math.max(worst.v, Math.abs(g.v[l] - G[l]) / scale);
          const dxf = (Gxp[l] - Gxm[l]) / (2 * hx), ddf = (Gdp[l] - Gdm[l]) / (2 * hd);
          const sx = Math.max(Math.abs(dxf), Math.abs(G[l]), 1e-12), sd = Math.max(Math.abs(ddf), Math.abs(G[l]), 1e-12);
          worst.dx = Math.max(worst.dx, Math.abs(g.dx[l] - dxf) / sx);
          worst.dd = Math.max(worst.dd, Math.abs(g.dd[l] - ddf) / sd);
        }
      }
      // Manko-Novikov's JS formula (prolate coordinates) itself keeps ~1e-10 near the horizon
      expect(worst.v).toBeLessThan(id === 'mankoNovikov' ? 1e-8 : 1e-10);
      // the reference derivatives are central differences (h = 1e-5): their error is ~1e-5 where Manko-Novikov's functions
      // vary steeply next to its CTC band
      const tolD = id === 'mankoNovikov' ? 1e-4 : 1e-5;
      expect(worst.dx).toBeLessThan(tolD);
      expect(worst.dd).toBeLessThan(tolD);
    });
  }
  it('every generated metric has its uniforms', () => {
    for (const id of Object.keys(GEN)) expect(CLOSED_FORMS[id]).toBeDefined();
  });
});
