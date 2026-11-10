import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (e) => console.error('page error:', e.message));
  await page.goto('index.html?ui=expert&N=128');
  await page.waitForFunction(() => window.__foort || window.__foortError, null, { timeout: 60_000 });
  expect(await page.evaluate(() => window.__foortError)).toBeUndefined();
  await expect(page.locator('#status')).toContainText('done', { timeout: 60_000 });
});

/** mean brightness of the canvas (0..255) */
const brightness = (page) => page.evaluate(() => {
  const c = /** @type {HTMLCanvasElement} */ (document.getElementById('view'));
  const t = document.createElement('canvas'); t.width = c.width; t.height = c.height;
  const ctx = /** @type {CanvasRenderingContext2D} */ (t.getContext('2d'));
  ctx.drawImage(c, 0, 0);
  const d = ctx.getImageData(0, 0, t.width, t.height).data;
  let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2];
  return s / (d.length / 4) / 3;
});

test('disc emission is the default view, with the fluid ISCO reported', async ({ page }) => {
  await expect(page.locator('#legend')).toContainText('ISCO r = 2.024');
  await expect(page.locator('#perf')).toContainText('ISCO r = 2.0236');
  expect(await brightness(page)).toBeGreaterThan(20);
});

test('emission parameters redraw without a new trace; fluid parameters retrace', async ({ page }) => {
  const before = await page.evaluate(() => window.__foort.stats());
  await page.fill('input[name=gamma]', '0');
  await page.locator('input[name=gamma]').dispatchEvent('change');
  expect(await page.evaluate(() => window.__foort.stats())).toEqual(before);   // same timings: no new trace
  await page.locator('input[name=xi]').evaluate((el) => { el.value = '0.5'; el.dispatchEvent(new Event('change')); });
  await expect(page.locator('#perf')).toContainText('ξ = 0.5', { timeout: 60_000 });
});

test('FOORT presets set metric, camera and emission', async ({ page }) => {
  await page.selectOption('select[name=preset]', 'Test_MNrun');
  await expect(page.locator('#status')).toContainText('done', { timeout: 60_000 });
  expect(await page.locator('select[name=metric]').inputValue()).toBe('mankoNovikov');
  expect(Number(await page.locator('input[name=mu]').inputValue())).toBeCloseTo(0.658826, 6);
  expect(await brightness(page)).toBeGreaterThan(10);
});
