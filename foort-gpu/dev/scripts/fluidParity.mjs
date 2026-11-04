// M5: FOORT GeneralCircularRadialFluid (tools/foort_parity/build/fluid_dump) vs the JS port
// (js/fluid/generalCircularRadial.js): ISCO radius and covariant four-velocity at radii from the
// termination radius to 1000.
// Usage (from dev/): node scripts/fluidParity.mjs  -> dev/reports/m5/fluid_parity.json
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMetric } from '../../js/metrics/registry.js';
import { createFluid, kerrISCO } from '../../js/fluid/generalCircularRadial.js';
import { terminationRadius } from '../../js/bake/bake.js';

const here = dirname(fileURLToPath(import.meta.url));
const exe = resolve(here, '../../tools/foort_parity/build/fluid_dump' + (process.platform === 'win32' ? '.exe' : ''));
const FLUIDS = [[1, 1, 1], [0.7, 0.5, 0.3], [0.5, 0, 1], [1, 0, 0]];
const CASES = [
  ['kerr', { a: 0 }, ['Kerr', '0']], ['kerr', { a: 0.5 }, ['Kerr', '0.5']], ['kerr', { a: 0.94 }, ['Kerr', '0.94']], ['kerr', { a: 0.998 }, ['Kerr', '0.998']],
  ['johannsen', { a: 0.94, alpha13: 5.5 }, ['Johannsen', '0.94', '5.5', '0', '0', '0']],
  ['johannsen', { a: 0.5, alpha13: -5 }, ['Johannsen', '0.5', '-5', '0', '0', '0']],
  ['mankoNovikov', { a: 0.94, alpha3: 2 }, ['MankoNovikov', '0.94', '2']],
  ['mankoNovikov', { a: 0.5, alpha3: 0.5 }, ['MankoNovikov', '0.5', '0.5']],
];
const out = [];
for (const [id, params, cli] of CASES) for (const [xi, br, bp] of FLUIDS) {
  const m = createMetric(id, params);
  const rT = terminationRadius(m);
  const radii = Array.from({ length: 400 }, (_, k) => rT * (1.0001 + 0) * Math.exp(Math.log(1000 / rT) * k / 399));
  const run = spawnSync(exe, [...cli, String(xi), String(br), String(bp)], { input: radii.join('\n'), encoding: 'utf8' });
  if (run.status !== 0) throw new Error(`fluid_dump failed: ${run.stderr}`);
  const res = run.stdout, desc = run.stderr;
  const f = createFluid(m, { xi, betaR: br, betaPhi: bp });
  let worst = 0, worstR = 0;
  for (const line of res.trim().split('\n')) {
    const [r, ut, ur, , up] = line.split(',').map(Number);
    const d = f.velocity(r).down;
    const sc = Math.abs(ut) + Math.abs(up) / r + Math.abs(ur);
    const e = Math.max(Math.abs(d[0] - ut), Math.abs(d[1] - ur), Math.abs(d[3] - up) / r) / sc;
    if (e > worst) { worst = e; worstR = r; }
  }
  out.push({ metric: id, params, fluid: { xi, betaR: br, betaPhi: bp }, iscoJS: f.isco, iscoFOORTdesc: desc.trim(), maxRelVelocityDiff: worst, atR: worstR, iscoKerr: id === 'kerr' ? kerrISCO(params.a) : null });
}
// ISCO from FOORT's description string ("ISCO = 6.000000")
for (const o of out) {
  const mm = /ISCO = ([0-9.eE+-]+)/.exec(o.iscoFOORTdesc);
  o.iscoFOORT = mm ? Number(mm[1]) : null;
  delete o.iscoFOORTdesc;
  const e = (x) => (Number.isFinite(x) ? x.toExponential(1) : '—');
  console.log(`${o.metric} ${JSON.stringify(o.params)} fluid ${o.fluid.xi}/${o.fluid.betaR}/${o.fluid.betaPhi}: ISCO JS ${o.iscoJS?.toFixed(6)} FOORT ${o.iscoFOORT?.toFixed(6)}${o.iscoKerr ? ` analytic ${o.iscoKerr.toFixed(6)}` : ''}; u_mu max rel diff ${e(o.maxRelVelocityDiff)} at r = ${o.atR.toPrecision(4)}`);
}
mkdirSync(resolve(here, '../reports/m5'), { recursive: true });
writeFileSync(resolve(here, '../reports/m5/fluid_parity.json'), JSON.stringify(out, null, 1));
