// Collect dev/reports/m2/*.json into one markdown table (stdout) and dev/reports/m2/summary.json.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = resolve(dirname(fileURLToPath(import.meta.url)), '../reports/m2');
const rows = readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'summary.json').map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')));
const order = ['kerr_a0', 'kerr_a0.94', 'johannsen', 'mankoNovikov', 'st3cr_l0.005'];
rows.sort((a, b) => order.indexOf(a.case) - order.indexOf(b.case) || (a.mode < b.mode ? 1 : -1));
const e = (x) => (Number.isFinite(x) ? x.toExponential(1) : '—');
console.log('| case | mode | pixels | four-colour agreement | pass-count agreement | escape-direction diff median / p99 / max (rad) | steps/ray | CPU s | capture/escape confusion (FOORT→CPU, off-diagonal) |');
console.log('|---|---|---|---|---|---|---|---|---|');
for (const r of rows) {
  const off = Object.entries(r.confusion).filter(([k]) => { const [a, b] = k.split('->'); return a !== b; }).map(([k, v]) => `${k} ${v}`).join(', ') || 'none';
  console.log(`| ${r.case} | ${r.mode} | ${r.pixels} | ${(100 * r.fourColorAgreement).toFixed(3)}% (${r.fourColorMismatches}) | ${(100 * r.passesAgreement).toFixed(3)}% (${r.passesMismatches}) | ${e(r.escapeAngle.median)} / ${e(r.escapeAngle.p99)} / ${e(r.escapeAngle.max)} | ${r.meanSteps.toFixed(0)} | ${r.cpuSeconds.toFixed(0)} | ${off} |`);
}
writeFileSync(join(dir, 'summary.json'), JSON.stringify(rows, null, 1));
