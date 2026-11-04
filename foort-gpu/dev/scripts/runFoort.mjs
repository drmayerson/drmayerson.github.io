// Run FOORT (unmodified local clone, its own build) on the M2 parity cases.
// Usage (from dev/): node scripts/runFoort.mjs [caseName ...] [--N 64]
// Output: tools/foort_parity/build/runs/<case>/ (git-ignored): <case>.cfg, <case>_<Diagnostic>.dat, time.json
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CASES, foortConfig } from './foortCases.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const foortDir = process.env.FOORT_DIR ?? resolve(here, '../../../../../Coding/FOORT GitHub/FOORT');
const exe = join(foortDir, 'FOORT', 'bin', process.platform === 'win32' ? 'FOORT.exe' : 'FOORT');
const args = process.argv.slice(2);
const iN = args.indexOf('--N');
const Nover = iN >= 0 ? Number(args[iN + 1]) : null;
const names = args.filter((a, i) => !a.startsWith('--') && (iN < 0 || i !== iN + 1));
for (const c of CASES.filter((c) => !names.length || names.includes(c.name))) {
  const cc = Nover ? { ...c, N: Nover } : c;
  const dir = resolve(here, '../../tools/foort_parity/build/runs', c.name);
  mkdirSync(dir, { recursive: true });
  const cfg = join(dir, `${c.name}.cfg`);
  writeFileSync(cfg, foortConfig(cc, join(dir, c.name).split('\\').join('/')));
  const t0 = Date.now();
  const res = spawnSync(exe, [cfg], { cwd: dir, encoding: 'utf8', maxBuffer: 1 << 26 });
  const secs = (Date.now() - t0) / 1000;
  writeFileSync(join(dir, 'time.json'), JSON.stringify({ N: cc.N, seconds: secs, status: res.status }));
  console.log(`${c.name}: N=${cc.N} exit ${res.status} in ${secs.toFixed(1)} s`);
  if (res.status !== 0) console.log((res.stdout ?? '').slice(-2000), (res.stderr ?? '').slice(-2000));
}
