// Regenerates the REACH table in ../index.html from ET-horizon's tables, so both apps
// use one definition of "how far a detector hears":
//   LIGO-Virgo-KAGRA network at measured O4 sensitivity, and Einstein Telescope (ET-D triangle),
//   SNR >= 10, reach = the redshift where HALF of such pairs (random sky position and
//   orientation) are detected.  P_lvk / P_et and the Planck-2018 cosmology come from
//   et-horizon/index.html; zAtP() is ET-horizon's own function.
//
// Usage:  node chirp-karaoke/dev/gen-reach.mjs          (rewrites the REACH line in index.html)
//         node chirp-karaoke/dev/gen-reach.mjs --print  (prints the table, writes nothing)
//
// Chirp masses outside ET-horizon's grid (1 - 120 solar masses) are extrapolated:
//  * below 1: low-mass pairs merge far above the detectors' band, so SNR is set by the
//    inspiral alone: SNR ~ ((1+z) Mc)^(5/6) / D_L.  We keep that ratio fixed at the Mc = 1 value.
//  * above 120: the distance falls off with mass as in the previous Chirp-karaoke table
//    (PhenomA amplitude on the O4 and ET-D noise curves; LEGACY below), anchored at Mc = 120.
//    Only very slow, very low black-hole-mode whoops reach this range.
import fs from 'node:fs';
import { loadEtHorizon, CHIRP_HTML } from './et-reach-lib.mjs';

const ET = loadEtHorizon();
const { PHYS, zAtP, interp } = ET;
const Zc = PHYS.zc, Dc = PHYS.Dc;
const DL = z => (1 + z) * interp(Zc, Dc, z); // Mpc
function solveZ(fn, target) { // fn increasing in z
  let lo = 1e-5, hi = 1000;
  for (let k = 0; k < 200; k++) { const m = Math.sqrt(lo * hi); if (fn(m) < target) lo = m; else hi = m; }
  return Math.sqrt(lo * hi);
}
const LEGACY = { // previous table (best-case single-detector horizon), used only for its shape above Mc = 120
  mc: [93.7204, 110.6669, 130.6778, 154.307, 182.2089, 215.156, 254.0606, 300],
  zL: [1.84794, 1.65265, 1.4302, 1.20403, 0.98991, 0.7933, 0.6152, 0.45653],
  zE: [25.77077, 22.9354, 20.39197, 18.10625, 16.05526, 14.20948, 12.54669, 11.04503]
};
const logInterp = (xs, ys, x) => { let i = 1; while (i < xs.length - 1 && xs[i] < x) i++;
  const w = (Math.log(x) - Math.log(xs[i - 1])) / (Math.log(xs[i]) - Math.log(xs[i - 1]));
  return Math.exp(Math.log(ys[i - 1]) + w * (Math.log(ys[i]) - Math.log(ys[i - 1]))); };

const MC_LO = PHYS.Mc[0], MC_HI = PHYS.Mc[PHYS.Mc.length - 1];
function z50(det, mc) {
  const P = det === 'lvk' ? PHYS.P_lvk : PHYS.P_et;
  if (mc >= MC_LO && mc <= MC_HI) return zAtP(P, mc, 0.5);
  if (mc < MC_LO) {
    const z1 = zAtP(P, MC_LO, 0.5);
    const q = (DL(z1) / Math.pow(1 + z1, 5 / 6)) * Math.pow(mc / MC_LO, 5 / 6);
    return solveZ(z => DL(z) / Math.pow(1 + z, 5 / 6), q);
  }
  const zH = zAtP(P, MC_HI, 0.5), key = det === 'lvk' ? 'zL' : 'zE';
  const ratio = DL(logInterp(LEGACY.mc, LEGACY[key], mc)) / DL(logInterp(LEGACY.mc, LEGACY[key], MC_HI));
  return solveZ(DL, DL(zH) * ratio);
}

const sig = (x, n) => Number(x.toPrecision(n));
const grid = new Set(PHYS.Mc.map(m => sig(m, 5)));
for (let i = 0; i <= 47; i++) grid.add(sig(0.2 * Math.pow(1500, i / 47), 4));
const mc = [...grid].sort((a, b) => a - b);
const zL = mc.map(m => sig(z50('lvk', m), 5)), zE = mc.map(m => sig(z50('et', m), 5));
// cosmology (lookback time in Gyr) from ET-horizon, z = 0 dropped for log interpolation
const z = [], tlb = [];
for (let i = 0; i < Zc.length; i++) if (Zc[i] > 0 && PHYS.tl[i] > 0) { z.push(Zc[i]); tlb.push(PHYS.tl[i]); }
const REACH = { def: 'LVK O4 (measured) and ET-D, SNR>=10, z where half are detected; from et-horizon PHYS', mc, zL, zE, z, tlb, age0: PHYS.tl[PHYS.tl.length - 1] };

if (process.argv.includes('--print')) {
  for (const m of [0.2, 0.5, 1.22, 2.0, 5, 10, 26.12, 63.3, 120, 300])
    console.log(String(m).padStart(6), 'zL', z50('lvk', m).toFixed(4).padStart(8), ' zE', z50('et', m).toFixed(3).padStart(8));
} else {
  const html = fs.readFileSync(CHIRP_HTML, 'utf8');
  const re = /^const REACH = \{.*\};$/m;
  if (!re.test(html)) throw new Error('REACH line not found in chirp-karaoke/index.html');
  fs.writeFileSync(CHIRP_HTML, html.replace(re, () => 'const REACH = ' + JSON.stringify(REACH) + ';'));
  console.log(`REACH rewritten: ${mc.length} masses, ${z.length} cosmology points.`);
}
