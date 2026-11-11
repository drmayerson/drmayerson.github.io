// Review (2026-11-10) work package 1: the confirmed bugs C1-C4 and U10.
import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (e) => console.error('page error:', e.message));
});

const ready = async (page, q) => {
  await page.goto(`index.html?ui=expert&${q}`);
  await page.waitForFunction(() => window.__foort || window.__foortError, null, { timeout: 60_000 });
  expect(await page.evaluate(() => window.__foortError)).toBeUndefined();
  await expect(page.locator('#status')).toContainText(/done|failed/, { timeout: 180_000 });
};
const DEG = Math.PI / 180;
/** records of a view, decoded in the page: (max crossing-1 radius, crossings at the camera radius, NaN count) */
const scan = (page, view) => page.evaluate(async (v) => {
  const t = await window.__foort.trace(v, { levels: [1] });
  const bin = atob(t.records), buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  const rec = new Float32Array(buf.buffer), n = v.N * v.N;
  let rMax = 0, atCam = 0, nan = 0, none = 0;
  for (let k = 0; k < n; k++) {
    const r1 = rec[24 * k + 4];
    rMax = Math.max(rMax, r1);
    if (Math.abs(r1 - v.camera.r) < 0.5) atCam++;
    if (!(r1 > 0)) none++;
    if ((Math.round(rec[24 * k]) & 15) === 4) nan++;
  }
  return { rMax, atCam, nan, none };
}, view);

test('C3: a camera exactly on the equator records no crossing at itself', async ({ page }) => {
  test.setTimeout(120_000);
  await ready(page, 'N=128&play=0&pretrace=0');
  const r = await scan(page, { metric: 'kerr', metricParams: { a: 0.94 }, camera: { r: 1000, theta: 90 * DEG, screen: 15 }, N: 128, path: 'auto' });
  expect(r.atCam).toBe(0);
  // FOORT parity keeps FOORT's own crossing rule (its threshold band)
  const p = await scan(page, { metric: 'kerr', metricParams: { a: 0.94 }, camera: { r: 1000, theta: 89.99 * DEG, screen: 15 }, N: 128, path: 'auto' });
  expect(p.atCam).toBe(0);
});

test('C1: with a close camera the disc is traced out to 60 M; FOORT parity keeps 1.01 r_cam', async ({ page }) => {
  test.setTimeout(120_000);
  await ready(page, 'N=128&play=0&pretrace=0');
  const v = { metric: 'kerr', metricParams: { a: 0.94 }, camera: { r: 10, theta: 60 * DEG, screen: 30 }, N: 128, path: 'tabulated' };
  const r = await scan(page, v);
  expect(r.rMax).toBeGreaterThan(50);
  const far = await scan(page, { ...v, camera: { ...v.camera, r: 1000 } });
  expect(r.none / (128 * 128)).toBeLessThan(3 * far.none / (128 * 128) + 0.05);
  const parity = await scan(page, { ...v, crossing: 'foort' });
  expect(parity.rMax).toBeLessThan(10.2);
});

test('C2: a camera inside the static limit is moved out, visibly; no NaN image', async ({ page }) => {
  test.setTimeout(120_000);
  await ready(page, 'N=128&play=0&pretrace=0&r=2&inc=90');
  await expect(page.locator('#status')).toContainText('camera moved out of the ergoregion');
  expect(await page.evaluate(() => window.__foort.state.r)).toBeGreaterThan(2);
  const v = await page.evaluate(() => window.__foort.view());
  const r = await scan(page, v);
  expect(r.nan).toBe(0);
});

test('C4: the auto exposure at 2048^2 is that of 512^2', async ({ page }) => {
  test.setTimeout(240_000);
  const exposure = async (N) => {
    await ready(page, `N=${N}&play=0&pretrace=0&quality=normal`);
    return Number((await page.locator('#legend').textContent()).match(/exposure ([\d.e+-]+)/)[1]);
  };
  const e512 = await exposure(512), e2048 = await exposure(2048);
  expect(Math.abs(e2048 / e512 - 1)).toBeLessThan(0.05);
});

test.describe('U10: on a phone', () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });
  test('a link made on a phone does not carry the phone\'s own defaults', async ({ page }) => {
    test.setTimeout(120_000);
    await ready(page, 'N=128&play=0&inc=33');
    expect(await page.evaluate(() => window.__foort.state.pretrace)).toBe(false);
    await page.locator('input[name=inc]').evaluate((el) => { el.value = '40'; el.dispatchEvent(new Event('input')); el.dispatchEvent(new Event('change')); });
    await expect(page.locator('#status')).toContainText('done', { timeout: 120_000 });
    await expect.poll(() => page.url()).toContain('inc=40');
    expect(page.url()).not.toContain('pretrace');
  });
});
