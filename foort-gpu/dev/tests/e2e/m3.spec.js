import { test, expect } from '@playwright/test';
import { cpuTraceOptions, decodeRecord } from '../../../js/gpu/traceConfig.js';
import { prepareImage, fourColorQuadrant } from '../../../js/ref/cpuTracer.js';

const DEG = Math.PI / 180;
const quadrant = (d) => fourColorQuadrant({ term: d.term, theta: d.theta, phi: d.phi });

/** @param {import('@playwright/test').Page} page */
async function traceGPU(page, view) {
  const r = await page.evaluate((v) => window.__foort.trace(v), view);
  const buf = Buffer.from(r.records, 'base64');
  return { stats: r.stats, rec: new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4) };
}

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (e) => console.error('page error:', e.message));
  await page.goto('index.html?N=128');
  await page.waitForFunction(() => window.__foort || window.__foortError, null, { timeout: 60_000 });
  expect(await page.evaluate(() => window.__foortError)).toBeUndefined();
});

test('viewer traces progressively and shows every debug view', async ({ page }) => {
  await expect(page.locator('#status')).toContainText('done');
  for (const v of ['term', 'steps', 'g1', 'dt1', 'passes', 'sky', 'ham', 'fourColor']) {
    await page.selectOption('select[name=view]', v);
    await expect(page.locator('#legend')).not.toBeEmpty();
  }
  const st = await page.evaluate(() => window.__foort.stats());
  expect(st.levels).toEqual([4, 2, 1]);
  expect(st.steps / (st.N * st.N)).toBeGreaterThan(300);
});

test('GPU vs CPU reference, KerrExample camera (sampled pixels)', async ({ page }) => {
  const view = { metric: 'kerr', metricParams: { a: 0.94 }, camera: { r: 1000, theta: 0.2967, screen: 15 }, N: 128 };
  const { rec } = await traceGPU(page, view);
  const { metric, options } = cpuTraceOptions(view);
  const { tracePixel } = prepareImage(metric, options);
  let agree = 0, n = 0;
  for (let k = 0; k < 128 * 128; k += 97) {
    const i = k % 128, j = (k - i) / 128;
    const g = decodeRecord(rec, k);
    expect(g.term).not.toBe(4);
    if (quadrant(g) === fourColorQuadrant(tracePixel(i, j))) agree++;
    n++;
  }
  expect(agree / n).toBeGreaterThanOrEqual(0.99);
});

test('face-on camera: axis crossings without NaN, constraint kept', async ({ page }) => {
  const view = { metric: 'kerr', metricParams: { a: 0.94 }, camera: { r: 1000, theta: 0.01 * DEG, screen: 15 }, N: 128, storeH: true, maxSteps: 20000 };
  const { rec } = await traceGPU(page, view);
  let hMax = 0;
  for (let k = 0; k < 128 * 128; k++) {
    const g = decodeRecord(rec, k);
    expect(g.term === 1 || g.term === 2).toBe(true);
    if (g.term === 2) hMax = Math.max(hMax, rec[16 * k + 12]);
  }
  expect(hMax).toBeLessThan(1e-3);
});
