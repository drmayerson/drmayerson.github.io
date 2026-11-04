// Viewer images for CHECKPOINT M3 (canvas contents at full record resolution).
// Usage (from dev/): node scripts/m3Screens.mjs  -> dev/reports/m3/views/*.png
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openViewer } from './gpuRunner.mjs';

const out = resolve(dirname(fileURLToPath(import.meta.url)), '../reports/m3/views');
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
const v = await openViewer();
const base = v.page.url().replace(/index\.html.*$/, 'index.html');
try {
  for (const [name, q] of Object.entries(SHOTS)) {
    await v.page.goto(`${base}?N=512&${q}`);
    await v.page.waitForFunction(() => window.__foort && /done/.test(document.getElementById('status').textContent));
    await v.page.waitForTimeout(100);
    const url = await v.page.evaluate(() => document.getElementById('view').toDataURL('image/png'));
    writeFileSync(join(out, `${name}.png`), Buffer.from(url.split(',')[1], 'base64'));
    console.log(name);
  }
} finally { await v.close(); }
