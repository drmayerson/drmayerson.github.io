// Level-0 metric parity: JS metrics vs FOORT C++ (tools/foort_parity/build/metric_dump).
// Usage (from dev/): node scripts/metricParity.mjs [--n 10000] [--golden 50]
// Writes dev/reports/m1_parity.json and refreshes dev/tests/golden/metric_parity/*.csv.
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PARITY_SETS, makePoints, compareRows } from './parityLib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const dev = join(here, '..');
const exe = join(dev, '..', 'tools', 'foort_parity', 'build', process.platform === 'win32' ? 'metric_dump.exe' : 'metric_dump');
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? Number(args[i + 1]) : def; };
const N = opt('--n', 10000), NG = opt('--golden', 50);

if (!existsSync(exe)) { console.error(`harness not built: ${exe}\nrun: sh tools/foort_parity/build.sh`); process.exit(1); }
mkdirSync(join(dev, 'reports'), { recursive: true });
mkdirSync(join(dev, 'tests', 'golden', 'metric_parity'), { recursive: true });

const report = [];
for (const set of PARITY_SETS) {
  const pts = makePoints(set, N);
  const input = pts.map(([r, th]) => `${r.toPrecision(17)},${th.toPrecision(17)}`).join('\n') + '\n';
  const res = spawnSync(exe, [set.foort, ...set.foortArgs.map(String)], { input, maxBuffer: 1 << 28, encoding: 'utf8' });
  if (res.status !== 0) throw new Error(`${set.name}: harness failed: ${res.stderr}`);
  const rows = res.stdout.trim().split('\n').map((l) => l.split(',').map(Number));
  const stats = compareRows(set, rows);
  report.push({ set: set.name, points: rows.length, ...stats });
  const s = stats;
  const e = (/** @type {number} */ x) => x.toExponential(1);
  console.log(`${set.name.padEnd(44)} raw: g_dd ${e(s.gdd.max)} g_uu ${e(s.guuClosed.max)} gen ${e(s.guuGeneric.max)} | scaled: g_dd ${e(s.gddScaled.max)} g_uu ${e(s.guuClosedScaled.max)} gen ${e(s.guuGenericScaled.max)} | nonfinite ${s.nonfiniteFoort}/${s.nonfiniteJs}/${s.nonfiniteBoth} | invalid-region pts ${s.invalidRegion} (g_dd scaled ${e(s.invalidRegionGddScaledMax)})`);
  writeFileSync(join(dev, 'tests', 'golden', 'metric_parity', `${set.name}.csv`), rows.slice(0, NG).map((r) => r.map((x) => x.toPrecision(17)).join(',')).join('\n') + '\n');
}
writeFileSync(join(dev, 'reports', 'm1_parity.json'), JSON.stringify(report, null, 1));
