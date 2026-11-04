import { test, expect } from '@playwright/test';

test('capability page loads and reports both backends', async ({ page }) => {
  await page.goto('caps.html');
  await page.waitForFunction(() => /** @type {any} */ (window).__caps);
  const caps = await page.evaluate(() => /** @type {any} */ (window).__caps);
  console.log('WebGL2:', caps.webgl2.renderer ?? caps.webgl2.reason);
  console.log('WebGPU:', JSON.stringify(caps.webgpu.info ?? caps.webgpu.reason));
  expect(caps.webgl2.available || caps.webgpu.available).toBe(true);
});

test('benchmark: WebGL2 and WebGPU images agree', async ({ page }) => {
  await page.goto('bench/?auto=1&sizes=256&runs=1');
  await page.waitForFunction(() => /** @type {any} */ (window).__benchResult, null, { timeout: 100_000 });
  const r = await page.evaluate(() => /** @type {any} */ (window).__benchResult);
  expect(r.error).toBeUndefined();
  for (const row of r.results.filter((/** @type {any} */ x) => x.backend)) {
    console.log(`${row.backend} ${row.N}²: ${row.wallMsMedian.toFixed(1)} ms wall, ${row.stepsPerPixel.toFixed(0)} steps/px`);
    expect(row.codes.nan).toBe(0);
  }
  const cmp = r.results.find((/** @type {any} */ x) => x.compare);
  test.skip(!cmp, 'only one backend available in this browser');
  expect(cmp.fourColorAgreement).toBeGreaterThan(0.999);
  expect(cmp.escapeAngleMedian).toBeLessThan(1e-4);
});
