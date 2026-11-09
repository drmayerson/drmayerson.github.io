// Stage 1B B5: compile + link time of every trace program (first use, a fresh page per program; the browser or driver
// may still cache compiled shaders on disk between runs, so repeated runs can be faster).
// Usage (from dev/): node scripts/b5Compile.mjs [--repeat 2]  -> dev/reports/b5/compile.json
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openViewer } from './gpuRunner.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const repeat = Number(args.includes('--repeat') ? args[args.indexOf('--repeat') + 1] : 2);
const PROGRAMS = ['trace', 'trace+g34', 'trace_kerr_analytic', 'closed_kerr', 'closed_johannsen', 'closed_reissnerNordstrom', 'closed_mankoNovikov'];
const v = await openViewer();
const base = v.page.url().replace(/index\.html.*$/, 'index.html');
const rows = [];
try {
  for (const p of PROGRAMS) {
    const ms = [];
    for (let k = 0; k < repeat; k++) {
      // a fresh page with no trace (play=0, a tiny image) so that the program is not compiled yet
      await v.page.goto(`${base}?N=16&play=0&metric=reissnerNordstrom&path=tabulated`);
      await v.page.waitForFunction(() => window.__foort && /done/.test(document.getElementById('status').textContent), null, { timeout: 120_000 });
      // a comment flag makes the source unique, past the in-memory program caches of the browser and the driver
      ms.push(await v.page.evaluate(async (name) => {
        const t0 = performance.now();
        await window.__foort.backend.setTracer(name);
        return performance.now() - t0;
      }, `${p}+#${Date.now()}-${k}`));
    }
    rows.push({ program: p, ms });
    console.log(`${p}: ${ms.map((x) => x.toFixed(0)).join(', ')} ms`);
  }
  writeFileSync(join(resolve(here, '../reports/b5'), 'compile.json'), JSON.stringify({ renderer: v.renderer, rows }, null, 1));
} finally { await v.close(); }
