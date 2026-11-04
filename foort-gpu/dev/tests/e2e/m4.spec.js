import { test, expect } from '@playwright/test';
import { cpuTraceOptions, decodeRecord } from '../../../js/gpu/traceConfig.js';
import { prepareImage, fourColorQuadrant } from '../../../js/ref/cpuTracer.js';

const quadrant = (d) => fourColorQuadrant({ term: d.term, theta: d.theta, phi: d.phi });

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (e) => console.error('page error:', e.message));
  await page.goto('index.html?N=128');
  await page.waitForFunction(() => window.__foort || window.__foortError, null, { timeout: 60_000 })
    .catch(async (e) => { throw new Error(`${e.message}; startup: ${await page.evaluate(() => JSON.stringify({ stage: window.__foortStage, ready: document.readyState, loaded: performance.getEntriesByType('resource').map((r) => r.name.split('/').slice(-2).join('/')) }))}`); });
  expect(await page.evaluate(() => window.__foortError)).toBeUndefined();
  await expect(page.locator('#status')).toContainText('done', { timeout: 60_000 });
});

test('metric switching re-bakes and traces every BH-mode metric', async ({ page }) => {
  for (const m of ['johannsen', 'mankoNovikov', 'kerr']) {
    await page.selectOption('select[name=metric]', m);
    await expect(page.locator('#status')).toContainText('done', { timeout: 60_000 });
    await expect(page.locator('#perf')).toContainText('nodes');
  }
  await page.selectOption('select[name=path]', 'analytic');
  await expect(page.locator('#status')).toContainText('done', { timeout: 60_000 });
  await expect(page.locator('#perf')).toContainText('closed-form');
});

test('tabulated Johannsen and Manko-Novikov vs CPU reference (sampled pixels)', async ({ page }) => {
  for (const view of [
    { metric: 'johannsen', metricParams: { a: 0.94, alpha13: 5.5 }, camera: { r: 1000, theta: 0.2967, screen: 15 }, N: 64 },
    { metric: 'mankoNovikov', metricParams: { a: 0.94, alpha3: 2 }, camera: { r: 1000, theta: 0.523599, screen: 15 }, N: 64 },
  ]) {
    const r = await page.evaluate((v) => window.__foort.trace(v), view);
    expect(r.bake.validation.ok).toBe(true);
    const buf = Buffer.from(r.records, 'base64');
    const rec = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
    const { metric, options } = cpuTraceOptions(view);
    const { tracePixel } = prepareImage(metric, options);
    let agree = 0, n = 0;
    for (let k = 0; k < 64 * 64; k += 61) {
      const i = k % 64, j = (k - i) / 64;
      if (quadrant(decodeRecord(rec, k)) === fourColorQuadrant(tracePixel(i, j))) agree++;
      n++;
    }
    expect(agree / n).toBeGreaterThanOrEqual(0.97);
  }
});
