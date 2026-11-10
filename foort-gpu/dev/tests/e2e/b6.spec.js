import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (e) => console.error('page error:', e.message));
});

const ready = async (page, q) => {
  await page.goto(`index.html?ui=expert&${q}`);
  await page.waitForFunction(() => window.__foort || window.__foortError, null, { timeout: 60_000 });
  expect(await page.evaluate(() => window.__foortError)).toBeUndefined();
  await expect(page.locator('#status')).toContainText('done', { timeout: 120_000 });
};

test('B6: quality auto measures the device and names the tier; a fixed tier and custom settings', async ({ page }) => {
  test.setTimeout(240_000);
  await ready(page, 'N=256&play=0&pretrace=0');
  await expect(page.locator('#status')).toContainText(/quality (Reference|High|Normal) \(auto\)/);
  await expect(page.locator('#perf')).toContainText('predicted full trace here');
  expect(['reference', 'high', 'normal']).toContain(await page.evaluate(() => window.__foort.tier()));
  // a fixed tier: Reference traces with its settings
  await page.selectOption('select[name=quality]', 'reference');
  await expect(page.locator('#status')).toContainText('quality Reference', { timeout: 120_000 });
  expect(await page.evaluate(() => window.__foort.view())).toMatchObject({ eps: 0.03, farSteps: null, maxSteps: 5000 });
  expect(page.url()).toContain('quality=reference');
  // the step parameter is shown (and used) only for custom
  await expect(page.locator('input[name=eps]')).toBeHidden();
  await page.selectOption('select[name=quality]', 'custom');
  await expect(page.locator('input[name=eps]')).toBeVisible();
  await expect(page.locator('#status')).toContainText('done', { timeout: 120_000 });
});

test('B6: a pre-v3 link with tracing settings opens as quality custom', async ({ page }) => {
  test.setTimeout(120_000);
  await ready(page, 'N=128&play=0&pretrace=0&v=2&eps=0.01');
  expect(await page.locator('select[name=quality]').inputValue()).toBe('custom');
  expect((await page.evaluate(() => window.__foort.view())).eps).toBeCloseTo(0.01, 6);
});

test('B6: adaptive refinement traces part of the image and matches the full trace closely', async ({ page }) => {
  test.setTimeout(240_000);
  await ready(page, 'N=128&play=0&pretrace=0');
  const v = await page.evaluate(() => window.__foort.view());
  const full = await page.evaluate((vv) => window.__foort.trace({ ...vv, N: 256, refine: null }, { levels: [4, 1] }), v);
  const ref = await page.evaluate((vv) => window.__foort.trace({ ...vv, N: 256, refine: { sky: 0.2, r: 2e-3, g: 2e-3, dt: 0.2 } }, { levels: [4, 1] }), v);
  expect(ref.stats.traced).toBeGreaterThan(0.05);
  expect(ref.stats.traced).toBeLessThan(0.9);
  const dec = (b64) => { const b = Buffer.from(b64, 'base64'); return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4); };
  const A = dec(full.records), B = dec(ref.records);
  let same = 0, n = 256 * 256;
  for (let k = 0; k < n; k++) if ((Math.round(A[24 * k]) & 15) === (Math.round(B[24 * k]) & 15)) same++;
  expect(same / n).toBeGreaterThan(0.995);
});
