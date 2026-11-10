import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (e) => console.error('page error:', e.message));
  await page.goto('index.html?ui=expert&N=128&play=0&maxSteps=2000');
  await page.waitForFunction(() => window.__foort || window.__foortError, null, { timeout: 60_000 });
  expect(await page.evaluate(() => window.__foortError)).toBeUndefined();
  await expect(page.locator('#status')).toContainText('done', { timeout: 60_000 });
});

test('B4: auto noise field follows metric and lambda; coverage view and clock report coverage', async ({ page }) => {
  test.setTimeout(240_000);
  expect(await page.locator('select[name=noiseField]').inputValue()).toBe('auto');
  await expect(page.locator('#clock')).toContainText('inoisy_lg21, auto');
  await expect(page.locator('#clock')).toContainText('noise covers');
  await page.selectOption('select[name=preset]', 'Compare 1B: ST3Cr λ = 0.005');
  await expect(page.locator('#status')).toContainText('done', { timeout: 200_000 });
  await expect(page.locator('#clock')).toContainText('inoisy_st3cr_l5e-3, auto', { timeout: 30_000 });
  await page.selectOption('select[name=preset]', 'Compare 3B: ST3Cr λ = 0.05');
  await expect(page.locator('#status')).toContainText('done', { timeout: 200_000 });
  await expect(page.locator('#clock')).toContainText('inoisy_st3cr_l0.05, auto', { timeout: 30_000 });
  await expect(page.locator('#clock')).toContainText('noise covers 100.0%');
  await page.selectOption('select[name=view]', 'coverage');
  await expect(page.locator('#legend')).toContainText('Noise coverage');
  // a fixed choice overrides auto
  await page.selectOption('select[name=noiseField]', 'inoisy_lg21');
  await expect(page.locator('#clock')).toContainText('(inoisy_lg21, period', { timeout: 30_000 });
});
