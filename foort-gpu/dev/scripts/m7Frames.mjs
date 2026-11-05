// M7 checkpoint animations: viewer frames over one noise period, written as PNG frames to
// tools/foort_parity/build/m7frames/<name>/ (git-ignored); tools/noise/frames_to_gif.py assembles them.
// Usage (from dev/): node scripts/m7Frames.mjs [--N 256] [--frames 40] [--m8: inoisy field, M8 checkpoint set]
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openViewer } from './gpuRunner.mjs';

const args = process.argv.slice(2);
const opt = (/** @type {string} */ k, /** @type {number} */ d) => (args.includes(k) ? Number(args[args.indexOf(k) + 1]) : d);
const N = opt('--N', 256);
const frames = opt('--frames', 40);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../tools/foort_parity/build/m7frames');
const FB = 'metric=st3cr&r=10.4167&inc=85.9437&screen=6.25&mu=0&gamma=-1.5&sigma=2&maxSteps=10000';
const m8 = process.argv.includes('--m8');
const SETS = m8 ? {
  'm8_kerr_a0.94_inc60': 'a=0.94&inc=60',
  'm8_kerr_a0.94_inc17': 'a=0.94&inc=17',
  'm8_st3cr_l0.005': `${FB}&lambda=0.005`,
} : {
  'kerr_a0.94_inc60_slow': 'a=0.94&inc=60',
  'kerr_a0.94_inc60_fast': 'a=0.94&inc=60&slowLight=0',
  'kerr_a0.94_inc60_advect': 'a=0.94&inc=60&advect=1',
  'st3cr_l0.005_slow': `${FB}&lambda=0.005`,
  'st3cr_l0.005_fast': `${FB}&lambda=0.005&slowLight=0`,
  'st3cr_l1e-4_slow': `${FB}&lambda=0.0001`,
};
const v = await openViewer();
const base = v.page.url().replace(/index\.html.*$/, 'index.html');
try {
  for (const [name, q] of Object.entries(SETS)) {
    await v.page.goto(`${base}?N=${N}&play=0&${q}`);
    await v.page.waitForFunction(() => window.__foort && /done/.test(document.getElementById('status').textContent), null, { timeout: 300_000 });
    const T = await v.page.evaluate(() => window.__foort.noise().meta.T_over_M);
    const dir = join(root, name);
    mkdirSync(dir, { recursive: true });
    for (let f = 0; f < frames; f++) {
      const url = await v.page.evaluate((t) => { window.__foort.setTime(t); return document.getElementById('view').toDataURL('image/png'); }, (f * T) / frames);
      writeFileSync(join(dir, `f${String(f).padStart(3, '0')}.png`), Buffer.from(url.split(',')[1], 'base64'));
    }
    console.log(name, `${frames} frames over T = ${T} M`);
  }
} finally { await v.close(); }
