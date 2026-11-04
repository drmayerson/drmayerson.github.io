// M4: interpolation error of the baked tables (double-precision Hermite evaluation, js/bake/hermite.js)
// against the closed-form inverse metric, by grid size. Errors are relative to the function's scale at
// that radius, S(x) = max over theta of |G(x, theta)| (G2 = sin^2 g^phiphi crosses zero at the ergosurface):
// |dG| / S, |dG_x| / S, |dG_delta| / S.
// Usage (from dev/): node scripts/m4TableError.mjs [metric] -> dev/reports/m4/table_error_<metric>.json
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMetric } from '../../js/metrics/registry.js';
import { inverseMetric } from '../../js/metrics/common.js';
import { bakeTables } from '../../js/bake/bake.js';
import { lookupTables } from '../../js/bake/hermite.js';

const id = process.argv[2] ?? 'kerr';
const SETS = { kerr: [{ a: 0 }, { a: 0.5 }, { a: 0.94 }, { a: 0.998 }], johannsen: [{ a: 0.94, alpha13: 5.5 }, { a: 0.5, alpha13: -2 }], mankoNovikov: [{ a: 0.94, alpha3: 2 }, { a: 0.5, alpha3: 0.5 }] }[id];
const GRIDS = [[128, 64], [256, 128], [512, 256], [1024, 512]];
let seed = 12345;
const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const q = (xs, f) => { const s = Float64Array.from(xs).sort(); return s[Math.min(s.length - 1, Math.floor(f * s.length))]; };
const out = [];
for (const params of SETS) {
  const m = createMetric(id, params);
  const guu = inverseMetric(m);
  for (const [nx, nth] of GRIDS) {
    const T = bakeTables(m, { nx, nth, rMax: 1100 });
    const g = T.grid;
    const G = (x, th) => { const e = Math.exp(x), r = g.r0 + e, u = guu(r, th), s2 = Math.sin(th) ** 2; return [u.gtt, u.gtphi, s2 * u.gphiphi, u.grr / (e * e), u.gthth]; };
    const errs = { v: [], dx: [], dd: [] };
    const xHi = Math.log(1000 - g.r0);
    for (let k = 0; k < 20000; k++) {
      const x = g.xMin + (xHi - g.xMin) * rnd();
      const hemi = g.symmetric || rnd() < 0.5 ? 1 : -1;
      const d = 0.002 + (Math.PI / 2 - 0.004) * rnd();
      const th = hemi > 0 ? d : Math.PI - d;
      const L = lookupTables(T, x, d, hemi);
      const h = 1e-4;
      const sc0 = [0.01, 0.3, 0.8, 1.3, Math.PI / 2].map((t) => G(x, t)), f0 = G(x, th), xp = [G(x - 2 * h, th), G(x - h, th), G(x + h, th), G(x + 2 * h, th)];
      const tp = [G(x, th - 2 * h * hemi), G(x, th - h * hemi), G(x, th + h * hemi), G(x, th + 2 * h * hemi)];
      for (let l = 0; l < 5; l++) {
        const sc = Math.max(Math.abs(f0[l]), ...sc0.map((z) => Math.abs(z[l]))) || 1e-300;
        const rdx = (xp[0][l] - 8 * xp[1][l] + 8 * xp[2][l] - xp[3][l]) / (12 * h);
        const rdd = (tp[0][l] - 8 * tp[1][l] + 8 * tp[2][l] - tp[3][l]) / (12 * h);
        errs.v.push(Math.abs(L.v[l] - f0[l]) / sc);
        errs.dx.push(Math.abs(L.dx[l] - rdx) / sc);
        if (!(id === 'kerr' && params.a === 0 && l !== 2 && l !== 4)) errs.dd.push(Math.abs(L.dd[l] - rdd) / sc); // a = 0: G0, G1, G3 theta-independent
      }
    }
    const row = { metric: id, params, nx, nth: g.nth, symmetric: g.symmetric, bakeMs: T.timing.totalMs, valid: T.validation.ok,
      v: { p99: q(errs.v, 0.99), max: Math.max(...errs.v) }, dx: { p99: q(errs.dx, 0.99), max: Math.max(...errs.dx) }, dd: errs.dd.length ? { p99: q(errs.dd, 0.99), max: Math.max(...errs.dd) } : null };
    const e = (x) => x.toExponential(1);
    console.log(`${id} ${JSON.stringify(params)} ${nx}x${g.nth}: G ${e(row.v.p99)}/${e(row.v.max)}, dG/dx ${e(row.dx.p99)}/${e(row.dx.max)}, dG/dth ${row.dd ? e(row.dd.p99) + '/' + e(row.dd.max) : '-'}, bake ${row.bakeMs.toFixed(0)} ms${row.valid ? '' : ' INVALID'}`);
    out.push(row);
  }
}
writeFileSync(resolve(dirname(fileURLToPath(import.meta.url)), `../reports/m4/table_error_${id}.json`), JSON.stringify(out, null, 1));
