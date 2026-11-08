import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (e) => console.error('page error:', e.message));
  await page.goto('index.html?N=128&play=0&maxSteps=2000');
  await page.waitForFunction(() => window.__foort || window.__foortError, null, { timeout: 60_000 });
  expect(await page.evaluate(() => window.__foortError)).toBeUndefined();
  await expect(page.locator('#status')).toContainText('done', { timeout: 60_000 });
});

test('B3: envelope radius only redraws; the fluid model re-traces; comparison presets set both', async ({ page }) => {
  test.setTimeout(180_000);
  const before = await page.evaluate(() => window.__foort.stats());
  await page.selectOption('select[name=envelope]', 'circumferential');
  expect(await page.evaluate(() => window.__foort.stats())).toEqual(before);   // no new trace
  await page.selectOption('select[name=preset]', 'Compare 1B: ST3Cr λ = 0.005');
  await expect(page.locator('#status')).toContainText('done', { timeout: 150_000 });
  expect(await page.locator('select[name=metric]').inputValue()).toBe('st3cr');
  expect(await page.locator('select[name=envelope]').inputValue()).toBe('circumferential');
  expect(await page.locator('select[name=fluidModel]').inputValue()).toBe('banded');
  await expect(page.locator('#perf')).toContainText('banded; ');
  const st = await page.evaluate(() => window.__foort.stats());
  await page.selectOption('select[name=fluidModel]', 'foort');
  await expect(page.locator('#perf')).toContainText("FOORT's model", { timeout: 150_000 });
  expect(await page.evaluate(() => window.__foort.stats())).not.toEqual(st);
});
