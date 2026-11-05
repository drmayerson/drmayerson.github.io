// M6: interpolation error of the baked ST3Cr tables (double-precision Hermite evaluation, js/bake/hermite.js)
// against the closed-form inverse metric, by grid size and by distance to the singularities (D6 centres on the
// axis at r = l/2, D0 ring in the equator at r = R). Errors are relative to the function's scale at that radius,
// S(x) = max over theta of |G(x, theta)| (as m4TableError.mjs). Points closer to a singularity than the stopping
// distance eps_sing are never reached by a ray and are left out.
// Output: dev/reports/m6/table_error_st3cr.json and error maps table_error_map_l<lambda>_<grid>.png in the
// base-space (rho, z) plane around the structure (log10 of the largest relative error of G0..G4, values | x-derivatives | delta-derivatives).
// Usage (from dev/): node scripts/m6TableError.mjs [--quick]
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMetric } from '../../js/metrics/registry.js';
import { inverseMetric, singularityDistance } from '../../js/metrics/common.js';
import { bakeTables, terminationRadius } from '../../js/bake/bake.js';
import { lookupTables } from '../../js/bake/hermite.js';
import { writePng } from './png.mjs';

const quick = process.argv.includes('--quick');
const outDir = resolve(dirname(fileURLToPath(import.meta.url)), '../reports/m6');
mkdirSync(outDir, { recursive: true });
const LAMBDAS = quick ? [0.005] : [0.05, 0.005, 1e-3, 1e-4];
const GRIDS = quick ? [[512, 128]] : [[256, 128], [512, 128], [512, 256], [1024, 256], [1024, 512]];
const BINS = [0, 1, 3, 10, 30, Infinity];   // distance to the nearest singularity in units of eps_sing
let seed = 12345;
const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const q = (xs, f) => { if (!xs.length) return NaN; const s = Float64Array.from(xs).sort(); return s[Math.min(s.length - 1, Math.floor(f * s.length))]; };
const e1 = (x) => (Number.isFinite(x) ? x.toExponential(1) : '-');
const out = [];

/** errors of the five functions at (x, delta) in the upper hemisphere: [value, d/dx, d/ddelta], max over l */
function pointErrors(T, G, x, d) {
  const L = lookupTables(T, x, d, 1);
  // 4th-order FD reference with h = 1e-3 (truncation ~1e-12): ST3Cr's own rounding at small lambda (cancellations in Q
  // and in the Simpson integral, ~1e-7 relative at lambda = 1e-4) would dominate a smaller step
  const h = 1e-3;
  const sc0 = [0.01, 0.3, 0.8, 1.3, Math.PI / 2].map((t) => G(x, t)), f0 = G(x, d);
  const xp = [G(x - 2 * h, d), G(x - h, d), G(x + h, d), G(x + 2 * h, d)];
  const hd = Math.min(h, d / 3);
  const tp = [G(x, d - 2 * hd), G(x, d - hd), G(x, d + hd), G(x, d + 2 * hd)];
  const err = [0, 0, 0];
  const scale = (/** @type {number} */ l) => Math.max(Math.abs(f0[l]), ...sc0.map((z) => Math.abs(z[l])));
  for (let l = 0; l < 5; l++) {
    // g^tphi ~ J / r^3 is tiny far out at small lambda and computed with cancellation near the axis: measured
    // against 1e-6 of the g^tt scale, below which its term in H (2 g^tphi p_t p_phi) is irrelevant
    const sc = (l === 1 ? Math.max(scale(1), 1e-6 * scale(0)) : scale(l)) || 1e-300;
    const rdx = (xp[0][l] - 8 * xp[1][l] + 8 * xp[2][l] - xp[3][l]) / (12 * h);
    const rdd = (tp[0][l] - 8 * tp[1][l] + 8 * tp[2][l] - tp[3][l]) / (12 * hd);
    err[0] = Math.max(err[0], Math.abs(L.v[l] - f0[l]) / sc);
    err[1] = Math.max(err[1], Math.abs(L.dx[l] - rdx) / sc);
    err[2] = Math.max(err[2], Math.abs(L.dd[l] - rdd) / sc);
  }
  return err;
}

for (const lambda of LAMBDAS) {
  const m = createMetric('st3cr', { lambda });
  const guu = inverseMetric(m);
  const sings = m.singularities();
  const epsSing = /** @type {() => number} */ (m.singularityEpsilon)();
  const size = Math.max(...sings.map((s) => s.r));
  const G = (x, th) => { const r = Math.exp(x), u = guu(r, th), s2 = Math.sin(th) ** 2; return [u.gtt, u.gtphi, s2 * u.gphiphi, u.grr / (r * r), u.gthth]; };
  for (const [nx, nth] of GRIDS) {
    const T = bakeTables(m, { nx, nth, rTerm: terminationRadius(m), rMax: 1100 });
    const g = T.grid;
    const xHi = Math.log(1000);
    /** @type {{v:number[], dx:number[], dd:number[]}[]} */
    const bins = BINS.slice(0, -1).map(() => ({ v: [], dx: [], dd: [] }));
    // half the samples uniform in (x, delta) over the whole table, half in the structure region r < 3 max(l/2, R)
    for (let k = 0; k < (quick ? 8000 : 20000); k++) {
      const x = k % 2 ? g.xMin + (xHi - g.xMin) * rnd() : g.xMin + (Math.log(3 * size) - g.xMin) * rnd();
      const d = 0.002 + (Math.PI / 2 - 0.002) * rnd();
      const dist = singularityDistance(sings, Math.exp(x), d) / epsSing;
      if (dist < 1) continue;
      const b = BINS.findIndex((lim, i) => dist >= lim && dist < BINS[i + 1]);
      const err = pointErrors(T, G, x, d);
      bins[b].v.push(err[0]); bins[b].dx.push(err[1]); bins[b].dd.push(err[2]);
    }
    const row = { lambda, nx, nth: g.nth, epsSing, size, bakeMs: T.timing.totalMs, valid: T.validation.ok,
      bins: bins.map((b, i) => ({ from: BINS[i], to: BINS[i + 1], n: b.v.length, v: { p99: q(b.v, 0.99), max: b.v.length ? Math.max(...b.v) : NaN }, dx: { p99: q(b.dx, 0.99) }, dd: { p99: q(b.dd, 0.99) } })) };
    console.log(`st3cr lambda=${lambda} ${nx}x${g.nth} (bake ${row.bakeMs.toFixed(0)} ms): p99 G / dG/dx / dG/ddelta by distance to singularity in eps_sing: `
      + row.bins.map((b) => `[${b.from},${b.to}) n=${b.n}: ${e1(b.v.p99)}/${e1(b.dx.p99)}/${e1(b.dd.p99)}`).join('  '));
    out.push(row);

    // error map in the (rho, z) plane, rho in [0, 2 size], z in [0, size]: three panels
    if ((nx === 512 && nth === 128) || (lambda === 0.005 && !quick)) {
      const W = 240, H = 120, gap = 4;
      const errs = new Float64Array(3 * W * H).fill(NaN);
      for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
        const rho = (i + 0.5) / W * 2 * size, z = (j + 0.5) / H * size;
        const r = Math.hypot(rho, z), d = Math.atan2(rho, z);
        if (r < g.rTerm * 1.0001 || singularityDistance(sings, r, d) < epsSing || d < 1e-3) continue;
        const err = pointErrors(T, G, Math.log(r), d);
        for (let c = 0; c < 3; c++) errs[(c * H + j) * W + i] = err[c];
      }
      writePng(join(outDir, `table_error_map_l${lambda}_${nx}x${nth}.png`), 3 * W + 2 * gap, H, (px, py) => {
        const c = Math.floor(px / (W + gap)), i = px - c * (W + gap), j = H - 1 - py;
        if (i >= W) return [255, 255, 255];
        const e = errs[(c * H + j) * W + i];
        if (!Number.isFinite(e)) return [60, 60, 60];
        const t = Math.min(1, Math.max(0, (Math.log10(Math.max(e, 1e-12)) + 9) / 9));   // 1e-9 .. 1
        return [Math.round(255 * Math.min(1, 2 * t)), Math.round(255 * Math.max(0, 2 * t - 1)), Math.round(120 * (1 - t))];
      });
    }
  }
}
writeFileSync(join(outDir, 'table_error_st3cr.json'), JSON.stringify(out, null, 1));
