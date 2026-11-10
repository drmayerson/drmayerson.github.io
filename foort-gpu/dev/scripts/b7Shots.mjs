// Stage 1B B7: screenshots of the viewer (normal and expert panels, compare layouts, phone width) for the checkpoint.
// Usage (from dev/): node scripts/b7Shots.mjs  -> dev/reports/img/b7/*.png (git-ignored)
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, '../reports/img/b7');
const server = spawn(process.execPath, [resolve(here, 'serve.mjs'), '8769'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));
const b = await chromium.launch({ channel: 'chrome', args: ['--enable-gpu', '--ignore-gpu-blocklist'] });
const shot = async (name, q, vp = { width: 1300, height: 900 }, after) => {
  const p = await b.newPage({ viewport: vp, deviceScaleFactor: 1 });
  p.on('pageerror', (e) => console.log(name, 'pageerror', e.message));
  await p.goto(`http://127.0.0.1:8769/index.html?${q}`);
  await p.waitForFunction(() => /done|failed/.test(document.getElementById('status').textContent), null, { timeout: 180_000 });
  if (after) await after(p);
  await p.waitForTimeout(500);
  await p.screenshot({ path: resolve(out, `${name}.png`), fullPage: true });
  console.log(name, await p.evaluate(() => document.getElementById('status').textContent));
  await p.close();
};
try {
  await shot('normal_kerr', 'N=256&play=0&pretrace=0');
  await shot('expert_kerr', 'ui=expert&N=256&play=0&pretrace=0');
  await shot('compare_split_normal', 'N=256&play=0&pretrace=0&compare=split&inc=60&screen=16');
  await shot('compare_side_phone', 'N=256&play=0&pretrace=0&compare=side&inc=60&screen=16', { width: 390, height: 844 });
} finally { await b.close(); server.kill(); }
