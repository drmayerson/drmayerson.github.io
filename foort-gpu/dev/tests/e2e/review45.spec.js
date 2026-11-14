// Review (2026-11-10) work packages 4 (P3, P4: interactivity) and 5 (C5: kiosk time precision).
import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (e) => console.error('page error:', e.message));
});

const loaded = async (page, q) => {
  await page.goto(`index.html?${q}`);
  await page.waitForFunction(() => window.__foort || window.__foortError, null, { timeout: 60_000 });
  expect(await page.evaluate(() => window.__foortError)).toBeUndefined();
};
const firstFinal = (page) => page.waitForFunction(() => window.__foort.finals() >= 1, null, { timeout: 180_000 });
/** a frame of the view canvas at observer time t (redrawn, then two animation frames) */
const frameAt = async (page, t) => {
  await page.evaluate(async (tt) => {
    window.__foort.setTime(tt);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  }, t);
  return page.locator('#view').screenshot();
};

test('C5: at t = 1e7 M the noise still advances by 0.3 M, and equals the wrapped time', async ({ page }) => {
  test.setTimeout(180_000);
  await loaded(page, 'N=128&play=0&pretrace=0&ui=expert&view=noise');
  await firstFinal(page);
  await page.evaluate(() => window.__foort.noiseReady());
  const T = await page.evaluate(() => window.__foort.noise().meta.T_over_M);
  const big = 1e7, wrapped = big - Math.floor(big / T) * T;
  const a = await frameAt(page, big), b = await frameAt(page, big + 0.3), c = await frameAt(page, wrapped);
  expect(a.equals(b)).toBe(false);   // float32: 1e7 + 0.3 == 1e7, so these were identical before the fix
  expect(a.equals(c)).toBe(true);
  // the emission view with procedural advection (its phase fract(t / D) is wrapped separately)
  await page.selectOption('select[name=view]', 'emission');
  await page.locator('input[name=advect]').check();
  const d = await frameAt(page, big), e = await frameAt(page, big + 0.3);
  expect(d.equals(e)).toBe(false);
});

test('P4: the first image does not wait for the noise download; the flicker starts when it arrives', async ({ page }) => {
  test.setTimeout(180_000);
  let release = () => {};
  const gate = new Promise((r) => { release = r; });
  await page.route('**/noise/*.bin', async (route) => { await gate; await route.continue(); });
  await loaded(page, 'N=128&play=0&pretrace=0');
  await firstFinal(page);
  await expect(page.locator('#status')).toContainText('done');
  expect(await page.evaluate(() => window.__foort.noise())).toBeNull();
  release();
  expect(await page.evaluate(() => window.__foort.noiseReady())).toBe(true);
  expect(await page.evaluate(() => window.__foort.noise()?.meta.T_over_M)).toBeGreaterThan(0);
});

test('P4: a second visit runs no probe traces', async ({ page }) => {
  test.setTimeout(240_000);
  await loaded(page, 'N=128&play=0&pretrace=0');
  await firstFinal(page);
  expect(await page.evaluate(() => window.__foort.probes())).toBe(1);
  const tier = await page.evaluate(() => window.__foort.tier());
  await page.reload();
  await page.waitForFunction(() => window.__foort, null, { timeout: 60_000 });
  await firstFinal(page);
  expect(await page.evaluate(() => window.__foort.probes())).toBe(0);
  expect(await page.evaluate(() => window.__foort.tier())).toBe(tier);
});

test('P3: with a drag input every frame, previews still finish; the release traces in full', async ({ page }) => {
  test.setTimeout(180_000);
  await loaded(page, 'N=512&play=0&pretrace=0&ui=expert');
  await firstFinal(page);
  const r = await page.evaluate(async () => {
    const el = /** @type {HTMLInputElement} */ (document.querySelector('input[name=inc]'));
    const f = window.__foort, p0 = f.previews().done;
    let inc = 20;
    const t0 = performance.now();
    await new Promise((done) => {
      const step = () => {
        if (performance.now() - t0 > 2000) return done(null);
        inc += 0.5; el.value = String(inc); el.dispatchEvent(new Event('input'));
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
    const finals = f.finals();
    el.dispatchEvent(new Event('change'));
    return { previews: f.previews().done - p0, finals };
  });
  expect(r.previews).toBeGreaterThan(10);
  await page.waitForFunction((n) => window.__foort.finals() > n, r.finals, { timeout: 120_000 });
  await expect(page.locator('#status')).toContainText('done');
});
