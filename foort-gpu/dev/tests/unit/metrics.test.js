import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PARITY_SETS, compareRows } from '../../scripts/parityLib.mjs';
import { METRICS, createMetric } from '../../../js/metrics/registry.js';
import { invertCircular, compEllint1, validityRadius } from '../../../js/metrics/common.js';
import { createKerr } from '../../../js/metrics/kerr.js';
import { createJohannsen } from '../../../js/metrics/johannsen.js';
import { createMankoNovikov } from '../../../js/metrics/mankoNovikov.js';
import { createST3Cr, st3crMass, st3crLambdaMax } from '../../../js/metrics/st3cr.js';
import { createST3CrBH } from '../../../js/metrics/st3crBH.js';

const golden = (name) => fileURLToPath(new URL(`../golden/metric_parity/${name}.csv`, import.meta.url));

describe('Level 0: JS metrics vs FOORT golden values (50 points per set; full 1e4-point run: scripts/metricParity.mjs)', () => {
  for (const set of PARITY_SETS) {
    it(set.name, () => {
      const f = golden(set.name);
      if (!existsSync(f)) return; // regenerate with scripts/metricParity.mjs
      const rows = readFileSync(f, 'utf8').trim().split('\n').map((l) => l.split(',').map(Number));
      const s = compareRows(set, rows);
      expect(s.nonfiniteFoort + s.nonfiniteJs).toBe(0);
      expect(s.gddScaled.max).toBeLessThan(1e-12);
      expect(s.guuClosedScaled.max).toBeLessThan(1e-12);
    });
  }
});

describe('elliptic integral', () => {
  it('K(0) = pi/2, K(1/sqrt 2) and K(0.9) reference values', () => {
    expect(compEllint1(0)).toBeCloseTo(Math.PI / 2, 15);
    expect(compEllint1(Math.SQRT1_2)).toBeCloseTo(1.854074677301372, 14);
    expect(compEllint1(0.9)).toBeCloseTo(2.280549138422770, 14);
  });
});

describe('inverse metrics', () => {
  const pts = [[3, 0.3], [10, 1.2], [200, 2.9], [1.5e3, 1.57]];
  const check = (m, tol) => {
    for (const [r, th] of pts) {
      const a = m.g_uu(r, th), b = invertCircular(m.g_dd(r, th));
      for (const k of ['gtt', 'gphiphi', 'grr', 'gthth']) expect(Math.abs(a[k] / b[k] - 1)).toBeLessThan(tol);
      expect(Math.abs(a.gtphi - b.gtphi) / Math.sqrt(Math.abs(b.gtt * b.gphiphi))).toBeLessThan(tol);
    }
  };
  it('Kerr', () => check(createKerr({ a: 0.9 }), 1e-13));
  it('Johannsen', () => check(createJohannsen({ a: 0.7, alpha13: 2, alpha22: 0.3 }), 1e-13));
  it('ST3Cr (closed form of plan Section 4.1)', () => { for (const lambda of [0.15, 0.005, 1e-4]) check(createST3Cr({ P: 2, q0: 50, lambda }), 1e-14); });
  it('ST3Cr BH', () => check(createST3CrBH({ P: 2, q0: 50 }), 1e-15));
});

describe('ST3Cr', () => {
  it('M_ADM = 24 from the asymptotics, for all lambda', () => {
    for (const lambda of [0.15, 0.005, 1e-4]) {
      const m = createST3Cr({ P: 2, q0: 50, lambda });
      // M(r) = r(1 + g_tt)/2 = M - c/r: Richardson from r and 10 r
      const Mr = (r) => r * (1 + m.g_dd(r, 1.1).gtt) / 2;
      const r = 2e5;
      expect((10 * Mr(10 * r) - Mr(r)) / 9).toBeCloseTo(24, 4);
    }
    expect(st3crMass(2, 50)).toBe(24);
  });
  it('lambda_max', () => {
    expect(st3crLambdaMax(2, 50)).toBeCloseTo(0.1931818181818, 12);
    expect(createST3Cr({ P: 2, q0: 50, lambda: 0.194 }).validate().ok).toBe(false);
    expect(createST3Cr({ P: 2, q0: 50, lambda: 0.19 }).validate().ok).toBe(true);
  });
  it('lambda -> 0 converges to the BH away from the throat (Q ~ lambda^2, g_tphi ~ lambda)', () => {
    const bh = createST3CrBH({ P: 2, q0: 50 });
    const r = 24; // 1 M_ADM
    const dev = (lambda) => {
      const m = createST3Cr({ P: 2, q0: 50, lambda });
      let dQ = 0, w = 0;
      for (const th of [0.3, 1.0, 1.5, 2.5]) {
        dQ = Math.max(dQ, Math.abs(m.functions(r, th).Q / bh.Q(r) - 1));
        const g = m.g_dd(r, th);
        w = Math.max(w, Math.abs(g.gtphi) / Math.sqrt(Math.abs(g.gtt * g.gphiphi)));
      }
      return { dQ, w };
    };
    const a = dev(1e-3), b = dev(1e-4);
    expect(a.dQ / b.dQ).toBeGreaterThan(80);
    expect(a.w / b.w).toBeGreaterThan(8);
    expect(b.dQ).toBeLessThan(1e-7);
  });
  it('ST3Cr BH critical impact parameter: b_c^2 = min (r+4)^3 (r+84) / r^2', () => {
    const { b, r } = createST3CrBH({ P: 2, q0: 50 }).criticalImpactParameter();
    // stationarity: 3/(r+4) + 1/(r+84) = 2/r
    expect(3 / (r + 4) + 1 / (r + 84) - 2 / r).toBeCloseTo(0, 7); // golden section: r to ~sqrt(eps), b to ~eps
    expect(b).toBeCloseTo(Math.sqrt((r + 4) ** 3 * (r + 84)) / r, 10);
    expect(b / 24).toBeCloseTo(2.0714, 4);
  });
});

describe('validity', () => {
  it('Johannsen rejects alpha13 <= -r_+^3', () => {
    const rh = 1 + Math.sqrt(1 - 0.25);
    expect(createJohannsen({ a: 0.5, alpha13: -(rh ** 3) - 1e-9 }).validate().ok).toBe(false);
    expect(createJohannsen({ a: 0.5, alpha13: -(rh ** 3) + 1e-3 }).validate().ok).toBe(true);
  });
  it('Manko-Novikov has a CTC region just outside the horizon for alpha3 != 0', () => {
    const m = createMankoNovikov({ a: 0.5, alpha3: 0.5 });
    const v = validityRadius(m, m.horizon.r * (1 + 1e-6), 1000, { nr: 600, rRef: m.horizon.r });
    expect(v.rValid / m.horizon.r).toBeGreaterThan(1.05);
    expect(createMankoNovikov({ a: 0.5, alpha3: 0 }).validate().ok).toBe(true);
    expect(m.validate({ rMin: v.rValid }).ok).toBe(true);
  });
  it('registry defaults (except Manko-Novikov, pending decision) validate', () => {
    for (const e of METRICS) {
      const ok = createMetric(e.id).validate().ok;
      expect(ok).toBe(e.id !== 'mankoNovikov');
    }
  });
});
