// Chirp-karaoke and ET-horizon must give the same detector reach for the same pair (review X1/K2).
// ET-horizon's own zAtP() and tables are loaded from et-horizon/index.html; Chirp's REACH table and
// reachZ() from chirp-karaoke/index.html.
import assert from 'node:assert/strict';
import { loadEtHorizon } from './et-reach-lib.mjs';
import { loadChirpCore } from './load-core.mjs';
const ET = loadEtHorizon(), C = loadChirpCore();
const mc = (m1, m2) => Math.pow(m1 * m2, 0.6) / Math.pow(m1 + m2, 0.2);
let fails = 0;
const pairs = [[1.4, 1.4], [1.46, 1.27], [5, 5], [10, 10], [30, 30], [35.6, 30.6], [60, 60], [98.4, 57.2]];
for (const [a, b] of pairs) for (const det of ['lvk', 'et']) {
  const M = mc(a, b), zEt = ET.zAtP(det === 'lvk' ? ET.PHYS.P_lvk : ET.PHYS.P_et, M, 0.5), zCk = C.reachZ(det, M);
  const tEt = ET.tlOfZ(zEt), tCk = C.lookback(zCk);
  const ok = Math.abs(zCk / zEt - 1) < 0.02 && Math.abs(tCk - tEt) < 0.05;
  if (!ok) fails++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${a}+${b} (Mc ${M.toFixed(2)}) ${det.padEnd(3)}  ET-horizon z=${zEt.toPrecision(3)} (${tEt.toFixed(2)} Gyr)  Chirp z=${zCk.toPrecision(3)} (${tCk.toFixed(2)} Gyr)`);
}
// The 30+30 numbers ET-horizon shows (its REACH.zb uses Mc = 26.12)
assert.ok(Math.abs(C.reachZ('lvk', 26.12) / ET.zAtP(ET.PHYS.P_lvk, 26.12, 0.5) - 1) < 0.02);
assert.ok(Math.abs(C.reachZ('et', 26.12) / ET.zAtP(ET.PHYS.P_et, 26.12, 0.5) - 1) < 0.02);
console.log(fails ? `\n${fails} FAILED` : '\nall passed'); process.exit(fails ? 1 : 0);
