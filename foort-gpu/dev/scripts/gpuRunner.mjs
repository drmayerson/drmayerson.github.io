// Drive the viewer (index.html) in installed Chrome via Playwright and trace views on the GPU.
// Starts dev/scripts/serve.mjs on the foort-gpu folder unless a server is already running there.
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

async function serving(url) {
  try { return (await fetch(url)).ok; } catch { return false; }
}

/** @param {{port?: number, headed?: boolean}} [opts] */
export async function openViewer(opts = {}) {
  const port = opts.port ?? 8765;
  const base = `http://127.0.0.1:${port}/`;
  let server = null;
  if (!(await serving(base + 'index.html'))) {
    server = spawn(process.execPath, [resolve(root, 'dev/scripts/serve.mjs'), String(port)], { stdio: 'ignore' });
    for (let k = 0; k < 50 && !(await serving(base + 'index.html')); k++) await new Promise((r) => setTimeout(r, 100));
  }
  const browser = await chromium.launch({
    channel: process.env.PW_CHANNEL ?? 'chrome', headless: !opts.headed,
    args: ['--enable-gpu', '--ignore-gpu-blocklist', '--disable-gpu-watchdog'],
  });
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  page.on('pageerror', (e) => console.error('page error:', e.message));
  await page.goto(base + 'index.html?N=128&pretrace=0');   // scripts trace themselves: no idle pre-tracing
  await page.waitForFunction(() => window.__foort || window.__foortError, null, { timeout: 60_000 });
  const err = await page.evaluate(() => window.__foortError);
  if (err) throw new Error(err);
  const renderer = await page.evaluate(() => window.__foort.backend.capabilities().renderer);
  return {
    page, renderer,
    /** @param {any} view @param {{levels?: number[]}} [o] */
    async trace(view, o = {}) {
      const r = await page.evaluate(([v, oo]) => window.__foort.trace(v, oo), [view, o]);
      const buf = Buffer.from(r.records, 'base64');
      return { stats: r.stats, tail: r.tail, rec: new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4) };
    },
    async close() { await browser.close(); if (server) server.kill(); },
  };
}
