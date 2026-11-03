// Extract small golden sets from the FOORT M2 runs for the Vitest suite:
// per case, a stratified sample of pixels (escaped, captured, multi-pass, singular/other) with
// FOORT's quadrant, final theta/phi, pass count and intensity.
// Usage (from dev/): node scripts/makeGolden.mjs [case ...]  -> dev/tests/golden/foort_images/<case>.json
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CASES } from './foortCases.mjs';
import { readFoortRun } from './foortDat.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const PER = { kerr_a0: 40, 'kerr_a0.94': 40, johannsen: 30, mankoNovikov: 30, 'st3cr_l0.005': 6 };
const names = process.argv.slice(2);
mkdirSync(resolve(here, '../tests/golden/foort_images'), { recursive: true });
for (const c of CASES.filter((c) => !names.length || names.includes(c.name))) {
  const run = readFoortRun(resolve(here, '../../tools/foort_parity/build/runs', c.name), c.name);
  const all = [...run.pixels.entries()].map(([k, v]) => { const [i, j] = k.split(',').map(Number); return { i, j, ...v }; });
  // deterministic stratified pick: each stratum sorted by a hash of (i, j)
  const hash = (p) => ((p.i * 73856093) ^ (p.j * 19349663)) >>> 0;
  const strata = [
    all.filter((p) => p.quadrant > 0 && Math.abs(p.passes) <= 1),
    all.filter((p) => p.quadrant > 0 && Math.abs(p.passes) >= 2),
    all.filter((p) => p.quadrant === 0 && p.passes <= 0),
    all.filter((p) => p.quadrant === 0 && p.passes > 0),
  ];
  const n = PER[c.name] ?? 20, picks = [];
  for (const s of strata) picks.push(...s.sort((a, b) => hash(a) - hash(b)).slice(0, Math.ceil(n / 4)));
  const out = { case: c.name, N: c.N, foortHeader: run.header.slice(0, 300), pixels: picks.slice(0, n) };
  writeFileSync(join(here, '../tests/golden/foort_images', `${c.name}.json`), JSON.stringify(out, null, 1));
  console.log(`${c.name}: ${out.pixels.length} golden pixels (strata sizes ${strata.map((s) => s.length).join('/')})`);
}
