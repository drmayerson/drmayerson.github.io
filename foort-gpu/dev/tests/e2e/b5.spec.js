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

/** canvas pixels (RGBA bytes) of the current frame */
const pixels = (page) => page.evaluate(() => {
  const c = document.getElementById('view');
  const o = document.createElement('canvas'); o.width = c.width; o.height = c.height;
  const g = o.getContext('2d'); g.drawImage(c, 0, 0);
  return Array.from(g.getImageData(0, 0, o.width, o.height).data);
});

test('B5: camera azimuth is display-only and equals a camera traced at that azimuth', async ({ page }) => {
  test.setTimeout(180_000);
  // noisy emission (the noise depends on phi), fixed time, no pre-tracing
  await ready(page, 'N=128&play=0&pretrace=0&sigmaN=1&inc=60&autoExposure=0&exposure=1');
  const az = 40;
  // A: azimuth in the display
  const view = await page.evaluate(() => window.__foort.view());
  await page.evaluate((v) => window.__foort.trace(v, { records: false }), view);
  const before = await page.evaluate(() => window.__foort.stats());
  await page.locator('input[name=az]').evaluate((el, v) => { el.value = String(v); el.dispatchEvent(new Event('input')); el.dispatchEvent(new Event('change')); }, az);
  expect(await page.evaluate(() => window.__foort.stats())).toEqual(before);   // no new trace
  await page.evaluate(() => window.__foort.setTime(37));
  const A = await pixels(page);
  // B: azimuth traced, display azimuth 0
  await page.locator('input[name=az]').evaluate((el) => { el.value = '0'; el.dispatchEvent(new Event('input')); el.dispatchEvent(new Event('change')); });
  // (the azimuth must change the frame, or this test proves nothing)
  await page.evaluate(() => window.__foort.setTime(37));
  const C = await pixels(page);
  let changed = 0;
  for (let k = 0; k < A.length; k += 4) if (Math.abs(A[k] - C[k]) + Math.abs(A[k + 1] - C[k + 1]) + Math.abs(A[k + 2] - C[k + 2]) > 3) changed++;
  expect(changed / (A.length / 4)).toBeGreaterThan(0.05);
  await page.evaluate(([v, a]) => window.__foort.trace({ ...v, camera: { ...v.camera, phi: a * Math.PI / 180 } }, { records: false }), [view, az]);
  await page.evaluate(() => window.__foort.setTime(37));
  const B = await pixels(page);
  let diff = 0, n = 0;
  for (let k = 0; k < A.length; k += 4) { const d = Math.abs(A[k] - B[k]) + Math.abs(A[k + 1] - B[k + 1]) + Math.abs(A[k + 2] - B[k + 2]); if (d > 3) diff++; n++; }
  expect(diff / n).toBeLessThan(0.002);
});

test('B5: record cache restores a view instantly; idle pre-tracing fills it', async ({ page }) => {
  test.setTimeout(180_000);
  await ready(page, 'N=128&play=0');
  // idle pre-tracing: inclination +- 5 deg previews (Kerr)
  await expect.poll(() => page.evaluate(() => window.__foort.pipeline.cache.size), { timeout: 30_000 }).toBeGreaterThanOrEqual(3);
  const first = await pixels(page);
  await page.selectOption('select[name=metric]', 'reissnerNordstrom');
  await expect(page.locator('#status')).toContainText('done', { timeout: 60_000 });
  await page.selectOption('select[name=metric]', 'kerr');
  await expect(page.locator('#status')).toContainText('done', { timeout: 60_000 });
  await expect(page.locator('#perf')).toContainText('restored from the record cache');
  expect(await pixels(page)).toEqual(first);
  await expect(page.locator('#perf')).toContainText('record cache');
});

test('B5: ray compaction and texel reuse re-trace with unchanged step counts', async ({ page }) => {
  test.setTimeout(240_000);
  await ready(page, 'N=128&play=0&pretrace=0&metric=st3cr&lambda=0.005&r=10.4167&inc=85.9437&screen=6.25&maxSteps=5000');
  const base = (await page.evaluate(() => window.__foort.stats())).steps;
  await page.locator('input[name=compact]').check();
  await expect(page.locator('#perf')).toContainText('continued in compaction rounds', { timeout: 120_000 });
  expect((await page.evaluate(() => window.__foort.stats())).steps).toBe(base);
  await page.locator('input[name=compact]').uncheck();
  await expect(page.locator('#status')).toContainText('done', { timeout: 120_000 });
  // texel reuse is on by default (B5): switching it off keeps the step count
  expect(await page.locator('input[name=texelReuse]').isChecked()).toBe(true);
  await page.locator('input[name=texelReuse]').uncheck();
  await expect(page.locator('#status')).toContainText('done', { timeout: 120_000 });
  const reuse = (await page.evaluate(() => window.__foort.stats())).steps;
  expect(Math.abs(reuse - base) / base).toBeLessThan(1e-3);
});
