// Stage 1B B4: the fluid's coordinate angular velocity Omega(r) = u^phi / u^t on the equator (units of M), from the
// viewer's own fluid model (banded, Stage 1B B3), at the noise anchors (E3: lambda = 0, 1e-3, 5e-3, 0.05), for inoisy's
// foort_logr model (FOORT_OMEGA_FILE). Columns: x = log(r / M), Omega(r). Range r = 1e-4 .. 200 M; below a metric's
// inner cut the first value is repeated (no ray reaches there).
// Usage (from dev/): node scripts/b4OmegaTables.mjs  -> tools/noise/omega/st3cr_l<anchor>.txt
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMetric } from '../../js/metrics/registry.js';
import { createFluid } from '../../js/fluid/generalCircularRadial.js';

const out = resolve(dirname(fileURLToPath(import.meta.url)), '../../tools/noise/omega');
mkdirSync(out, { recursive: true });
const ANCHORS = [['0', 'st3crBH', {}], ['1e-3', 'st3cr', { lambda: 1e-3 }], ['5e-3', 'st3cr', { lambda: 5e-3 }], ['0.05', 'st3cr', { lambda: 0.05 }]];
const xLo = Math.log(1e-4), xHi = Math.log(200), n = 600;
for (const [tag, id, p] of ANCHORS) {
  const m = createMetric(id, p);
  const rT = /** @type {number} */ (m.terminationRadius?.());
  const f = createFluid(m, { xi: 1, betaR: 1, betaPhi: 1, model: 'banded', bandRange: { rMin: rT, rMax: 1100 / 24 } });
  const rows = [];
  let first = null;
  for (let i = 0; i < n; i++) {
    const x = xLo + (i * (xHi - xLo)) / (n - 1), r = Math.exp(x);
    let om = null;
    if (r >= rT * 1.001) { const u = f.velocity(r).up; om = u[3] / u[0]; if (first === null) first = om; }
    rows.push([x, om]);
  }
  const text = `# Omega(r) = u^phi / u^t (units of 1/M), ${id} ${JSON.stringify(p)}, banded fluid (xi = beta_r = beta_phi = 1); x = log(r/M)\n`
    + rows.map(([x, om]) => `${x.toFixed(8)} ${(om ?? first).toExponential(10)}`).join('\n') + '\n';
  writeFileSync(join(out, `st3cr_l${tag}.txt`), text);
  const mx = Math.max(...rows.map((r) => Math.abs(r[1] ?? 0)));
  console.log(`st3cr_l${tag}: inner cut ${rT.toExponential(2)} M, max |Omega| ${mx.toFixed(4)} /M, min period ${(2 * Math.PI / mx).toFixed(1)} M`);
}
