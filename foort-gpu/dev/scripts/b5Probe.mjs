// Stage 1B B5: run probe.html (?auto=1) on this machine in Chrome and save its report (dev/reports/b5/probe_<label>.json).
// Usage (from dev/): node scripts/b5Probe.mjs [--label laptop]
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const label = args.includes('--label') ? args[args.indexOf('--label') + 1] : 'laptop';
const server = spawn(process.execPath, [resolve(here, 'serve.mjs'), '8767'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));
const b = await chromium.launch({ channel: 'chrome', args: ['--enable-gpu', '--ignore-gpu-blocklist', '--disable-gpu-watchdog'] });
try {
  const p = await b.newPage();
  p.on('pageerror', (e) => console.log('pageerror', e.message));
  await p.goto('http://127.0.0.1:8767/probe.html?auto=1');
  await p.waitForFunction(() => window.__probe, null, { timeout: 1_800_000 });
  const r = await p.evaluate(() => window.__probe);
  mkdirSync(resolve(here, '../reports/b5'), { recursive: true });
  writeFileSync(resolve(here, `../reports/b5/probe_${label}.json`), JSON.stringify(r, null, 1));
  for (const x of r.results ?? []) console.log(x.case.padEnd(42), String(x.msteps_per_s).padStart(7), 'Msteps/s', String(x.predicted512s).padStart(6), 's @512');
  for (const x of r.b5pairs ?? []) console.log(x.case.padEnd(50), x.msA, '->', x.msB, 'ms', `${x.speedup}x`);
  if (r.error) console.log('error', r.error);
} finally { await b.close(); server.kill(); }
