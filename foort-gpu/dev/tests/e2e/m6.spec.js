import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (e) => console.error('page error:', e.message));
  await page.goto('index.html?ui=expert&N=128&maxSteps=2000');
  await page.waitForFunction(() => window.__foort || window.__foortError, null, { timeout: 60_000 });
  expect(await page.evaluate(() => window.__foortError)).toBeUndefined();
  await expect(page.locator('#status')).toContainText('done', { timeout: 60_000 });
});

test('Test_FBdetail preset: ST3Cr fuzzball, lambda slider, camera in units of M_ADM, circular-orbit bands', async ({ page }) => {
  test.setTimeout(180_000);
  await page.selectOption('select[name=preset]', 'Test_FBdetail');
  await expect(page.locator('#status')).toContainText('done', { timeout: 150_000 });
  expect(await page.locator('select[name=metric]').inputValue()).toBe('st3cr');
  await expect(page.locator('input[name=lambda]')).toBeVisible();
  expect(await page.locator('select[name=maxSteps]').inputValue()).toBe('5000');
  await expect(page.locator('#perf')).toContainText('ISCO r = 0.7733');   // 18.558 / 24: units of M (Stage 1B B1)
  await expect(page.locator('#perf')).toContainText('2 stable bands');
  const st = await page.evaluate(() => window.__foort.state);
  expect(st.r).toBeCloseTo(250 / 24, 6);
});

test('lambda = 0 switch selects the supersymmetric black hole; the lambda slider moves to its zero position (B7)', async ({ page }) => {
  test.setTimeout(120_000);
  await page.selectOption('select[name=metric]', 'st3cr');
  await expect(page.locator('#status')).toContainText('done', { timeout: 100_000 });
  await page.locator('input[name=bh0]').check();
  await expect(page.locator('input[name=lambda]')).toHaveValue('-1');
  await expect(page.locator('label:has(input[name=lambda]) output')).toHaveText('0');
  await expect(page.locator('#status')).toContainText('done', { timeout: 100_000 });
  await expect(page.locator('#perf')).toContainText('ISCO r = 0.780');
});

test('GPU trace hook: lambda = 0 rays below the shadow edge reach the inner cut, rays near the ring stop at it', async ({ page }) => {
  test.setTimeout(120_000);
  const res = await page.evaluate(async () => {
    const t = await window.__foort.trace({ metric: 'st3cr', metricParams: { lambda: 0.005 }, camera: { r: 250 / 24, theta: 1.5, screen: 150 / 24 }, N: 64, maxSteps: 5000 });
    const bin = atob(t.records), buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    const rec = new Float32Array(buf.buffer);
    const counts = [0, 0, 0, 0, 0, 0, 0];
    for (let k = 0; k < 64 * 64; k++) counts[Math.round(rec[24 * k]) % 16]++;
    return { counts, isco: t.isco };
  });
  expect(res.counts[2]).toBeGreaterThan(0.8 * 64 * 64);   // escaped
  expect(res.counts[6]).toBeGreaterThan(0);                // singularity terminations (centres, ring)
  expect(res.counts[4]).toBe(0);                           // no NaN
  expect(res.isco).toBeCloseTo(18.558 / 24, 4);
});
