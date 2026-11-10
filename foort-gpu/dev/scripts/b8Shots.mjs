// Stage 1B B7: screenshots of the viewer (normal and expert panels, compare layouts, phone width) for the checkpoint.
// Usage (from dev/): node scripts/b7Shots.mjs  -> dev/reports/img/b8/*.png (git-ignored)
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, '../reports/img/b8');
const server = spawn(process.execPath, [resolve(here, 'serve.mjs'), '8773'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));
const b = await chromium.launch({ channel: 'chrome', args: ['--enable-gpu', '--ignore-gpu-blocklist'] });
const shot = async (name, q, vp = { width: 1300, height: 900 }, after) => {
  const p = await b.newPage({ viewport: vp, deviceScaleFactor: 1 });
  p.on('pageerror', (e) => console.log(name, 'pageerror', e.message));
  await p.goto(`http://127.0.0.1:8773/index.html?${q}`);
  await p.waitForFunction(() => /done|failed/.test(document.getElementById('status').textContent), null, { timeout: 180_000 });
  if (after) await after(p);
  await p.waitForTimeout(500);
  await p.screenshot({ path: resolve(out, `${name}.png`), fullPage: true });
  console.log(name, await p.evaluate(() => document.getElementById('status').textContent));
  await p.close();
};
try {
  await shot('sgra_beam20', 'N=512&play=0&pretrace=0&inc=17&units=sgra&blur=1&beamUas=20&timeAvg=1');
  await shot('lightcurve', 'N=256&play=0&pretrace=0&inc=60&lightcurve=1&lcOrders=1&units=sgra&ui=expert', undefined, async (p) => {
    await p.evaluate(async () => { const f = window.__foort; for (let k = 0; k < 120; k++) { f.setTime(k * 2); await new Promise((r) => setTimeout(r, 10)); } });
  });
  await shot('inspector_kerr', 'N=256&play=0&pretrace=0&inc=60&inspect=1&ui=expert', undefined, async (p) => {
    for (const [x, y] of [[0.5, 0.42], [0.62, 0.55], [0.3, 0.6]]) await p.evaluate(([xx, yy]) => window.__foort.inspect(xx, yy), [x, y]);
  });
  await shot('inspector_fuzzball', 'N=256&play=0&pretrace=0&inspect=1&ui=expert&metric=st3cr&lambda=0.05&r=10.4167&inc=85.9437&screen=6.25', undefined, async (p) => {
    for (const [x, y] of [[0.52, 0.5], [0.45, 0.55], [0.6, 0.47]]) await p.evaluate(([xx, yy]) => window.__foort.inspect(xx, yy), [x, y]);
  });
} finally { await b.close(); server.kill(); }
