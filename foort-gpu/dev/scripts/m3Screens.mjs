// Viewer images for the checkpoints (canvas contents at full record resolution).
// Usage (from dev/): node scripts/m3Screens.mjs [--m4]  -> dev/reports/m3/views/*.png (or m4/views)
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openViewer } from './gpuRunner.mjs';

const m4 = process.argv.includes('--m4');
const out = resolve(dirname(fileURLToPath(import.meta.url)), m4 ? '../reports/m4/views' : '../reports/m3/views');
mkdirSync(out, { recursive: true });
const SHOTS = {
  'fourColor_a0.94_inc17': 'a=0.94&inc=17',
  'fourColor_a0.998_inc80': 'a=0.998&inc=80',
  'sky_faceon_a0': 'a=0&inc=0.01&view=sky',
  'sky_faceon_a0.94': 'a=0.94&inc=0.01&view=sky',
  'sky_a0.94_inc80': 'a=0.94&inc=80&view=sky',
  'g1_a0.94_inc80': 'a=0.94&inc=80&view=g1',
  'passes_a0.94_inc80': 'a=0.94&inc=80&view=passes',
  'steps_a0.94_inc80': 'a=0.94&inc=80&view=steps',
};
const SHOTS_M4 = {
  'fourColor_johannsen_a0.94_a13_5.5': 'metric=johannsen&a=0.94&alpha13=5.5',
  'fourColor_johannsen_a0.5_a13_-5_inc80': 'metric=johannsen&a=0.5&alpha13=-5&inc=80',
  'fourColor_mankoNovikov_a0.94_a3_1_inc30': 'metric=mankoNovikov&a=0.94&alpha3=1&inc=30',
  'sky_mankoNovikov_a0.94_a3_1_inc80': 'metric=mankoNovikov&a=0.94&alpha3=1&inc=80&view=sky',
  'g1_mankoNovikov_a0.94_a3_1_inc80': 'metric=mankoNovikov&a=0.94&alpha3=1&inc=80&view=g1',
  'sky_kerr_tabulated_faceon': 'a=0.94&inc=0.01&view=sky',
};
const v = await openViewer();
const base = v.page.url().replace(/index\.html.*$/, 'index.html');
try {
  for (const [name, q] of Object.entries(m4 ? SHOTS_M4 : SHOTS)) {
    await v.page.goto(`${base}?N=512&${q}`);
    await v.page.waitForFunction(() => window.__foort && /done/.test(document.getElementById('status').textContent), null, { timeout: 120_000 });
    await v.page.waitForTimeout(100);
    const url = await v.page.evaluate(() => document.getElementById('view').toDataURL('image/png'));
    writeFileSync(join(out, `${name}.png`), Buffer.from(url.split(',')[1], 'base64'));
    console.log(name);
  }
} finally { await v.close(); }
