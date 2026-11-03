// Shared by scripts/metricParity.mjs and tests/unit/metricParity.test.js.
import { createKerr } from '../../js/metrics/kerr.js';
import { createJohannsen } from '../../js/metrics/johannsen.js';
import { createMankoNovikov } from '../../js/metrics/mankoNovikov.js';
import { createST3Cr } from '../../js/metrics/st3cr.js';
import { toMat4, invertCircular, singularityDistance, pointValidity } from '../../js/metrics/common.js';

/**
 * @typedef {{name:string, foort:string, foortArgs:number[], create:() => any, kind:'horizon'|'singular'}} ParitySet
 */
const ST = (lambda) => ({
  name: `ST3Cr_l${lambda}`, foort: 'ST3Cr', foortArgs: [2, 50, lambda], kind: 'singular',
  create: () => createST3Cr({ P: 2, q0: 50, lambda }),
});
/** @type {ParitySet[]} */
export const PARITY_SETS = [
  ...[0, 0.5, 0.94, 0.998].map((a) => ({ name: `Kerr_a${a}`, foort: 'Kerr', foortArgs: [a], kind: 'horizon', create: () => createKerr({ a }) })),
  ...[[0, 2, 0, 0, 0], [0.5, 1, 0, 0, 0], [0.9, -0.5, 0, 0, 0], [0.3, 5, 0.5, 0.2, 0.3]].map(([a, a13, a22, a52, e3]) => ({
    name: `Johannsen_a${a}_a13_${a13}${a22 || a52 || e3 ? `_a22_${a22}_a52_${a52}_e3_${e3}` : ''}`, foort: 'Johannsen', foortArgs: [a, a13, a22, a52, e3], kind: 'horizon',
    create: () => createJohannsen({ a, alpha13: a13, alpha22: a22, alpha52: a52, eps3: e3 }),
  })),
  ...[[0, 0.2], [0.5, 0.1], [0.9, -0.5], [0.3, 1]].map(([a, a3]) => ({
    name: `MankoNovikov_a${a}_a3_${a3}`, foort: 'MankoNovikov', foortArgs: [a, a3], kind: 'horizon', create: () => createMankoNovikov({ a, alpha3: a3 }),
  })),
  ...[0.005, 1e-4, 0.05, 0.15].map(ST),
];

/** mulberry32 */
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Deterministic sample points (r, theta) for a parity set. @param {ParitySet} set @param {number} n */
export function makePoints(set, n) {
  const m = set.create();
  const rand = rng(12345);
  let rMin, rMax, sings = [], dmin = 0;
  if (set.kind === 'horizon') { rMin = m.horizon.r * 1.01; rMax = 1000; }
  else {
    sings = m.singularities();
    const scale = Math.min(sings[0].r, sings[2].r);
    rMin = 1e-3 * scale; rMax = 1000 * m.massADM; dmin = 0.01 * scale;
  }
  const pts = [];
  while (pts.length < n) {
    const r = Math.exp(Math.log(rMin) + rand() * (Math.log(rMax) - Math.log(rMin)));
    const th = 1e-4 + rand() * (Math.PI - 2e-4);
    if (sings.length && singularityDistance(sings, r, th) < dmin) continue;
    pts.push([r, th]);
  }
  return pts;
}

/** JS row in the harness layout: [r, th, gdd(16), guu closed(16), guu generic(16)] */
export function jsRow(m, r, th) {
  const gdd = toMat4(m.g_dd(r, th)).flat();
  const guu = toMat4(m.g_uu(r, th)).flat();
  const gen = toMat4(invertCircular(m.g_dd(r, th))).flat();
  return { gdd, guu, gen };
}

const relDiff = (a, b) => {
  const s = Math.max(Math.abs(a), Math.abs(b));
  return s === 0 ? 0 : Math.abs(a - b) / s;
};
const COMP = ['tt', 'tr', 'tth', 'tph', 'rt', 'rr', 'rth', 'rph', 'tht', 'thr', 'thth', 'thph', 'pht', 'phr', 'phth', 'phph'];

/**
 * @param {ParitySet} set @param {number[][]} rows harness rows
 * @param {number} [tol] count of point-components above this
 */
export function compareRows(set, rows, tol = 1e-12) {
  const m = set.create();
  const acc = () => ({ max: 0, at: null, above: 0 });
  // raw: component-wise relative difference. scaled: same for diagonal components; off-diagonal
  // (t-phi) differences divided by sqrt(|g_tt g_phiphi|), the natural size of that block, because
  // g_tphi is often a small result of large cancellations (rounding floor far above 1e-12 relative).
  // Points where FOORT's own g_dd is invalid (wrong signature or CTC; e.g. near the Manko-Novikov
  // horizon) are counted and summarized separately: precision there is meaningless.
  const out = { gdd: acc(), guuClosed: acc(), guuGeneric: acc(), gddScaled: acc(), guuClosedScaled: acc(), guuGenericScaled: acc(),
    nonfiniteFoort: 0, nonfiniteJs: 0, nonfiniteBoth: 0, invalidRegion: 0, invalidRegionGddScaledMax: 0 };
  for (const row of rows) {
    const [r, th] = row;
    const fdd = row.slice(2, 18), fuu = row.slice(18, 34);
    const { gdd, guu, gen } = jsRow(m, r, th);
    const fFin = [...fdd, ...fuu].every(Number.isFinite), jFin = [...gdd, ...guu].every(Number.isFinite);
    if (!fFin || !jFin) {
      if (!fFin && !jFin) out.nonfiniteBoth++; else if (!fFin) out.nonfiniteFoort++; else out.nonfiniteJs++;
      continue;
    }
    const f = { gtt: fdd[0], gtphi: fdd[3], gphiphi: fdd[15], grr: fdd[5], gthth: fdd[10] };
    if (pointValidity(f)) {
      out.invalidRegion++;
      for (const k of [0, 3, 5, 10, 15]) {
        const ds = k === 3 ? Math.abs(gdd[k] - fdd[k]) / Math.sqrt(Math.abs(fdd[0] * fdd[15])) : relDiff(gdd[k], fdd[k]);
        out.invalidRegionGddScaledMax = Math.max(out.invalidRegionGddScaledMax, ds);
      }
      continue;
    }
    for (const [key, js, ref] of [['gdd', gdd, fdd], ['guuClosed', guu, fuu], ['guuGeneric', gen, fuu]]) {
      const a = out[key];
      for (let k = 0; k < 16; k++) {
        const d = relDiff(js[k], ref[k]);
        if (d > tol) a.above++;
        if (d > a.max) { a.max = d; a.at = { r, theta: th, comp: COMP[k], js: js[k], foort: ref[k] }; }
        const b = out[key + 'Scaled'];
        const ds = k === 3 || k === 12 ? Math.abs(js[k] - ref[k]) / Math.sqrt(Math.abs(ref[0] * ref[15])) : d;
        if (ds > tol) b.above++;
        if (ds > b.max) { b.max = ds; b.at = { r, theta: th, comp: COMP[k], js: js[k], foort: ref[k] }; }
      }
    }
  }
  return out;
}
