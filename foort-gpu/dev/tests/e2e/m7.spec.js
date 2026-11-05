import { test, expect } from '@playwright/test';

const N = 128;
test.beforeEach(async ({ page }) => {
  page.on('pageerror', (e) => console.error('page error:', e.message));
  await page.goto(`index.html?N=${N}&a=0.94&inc=60&play=0`);
  await page.waitForFunction(() => window.__foort || window.__foortError, null, { timeout: 60_000 });
  expect(await page.evaluate(() => window.__foortError)).toBeUndefined();
  await expect(page.locator('#status')).toContainText('done', { timeout: 60_000 });
});

/** canvas pixels (row 0 = top) */
const canvasPixels = (page) => page.evaluate(() => {
  const c = /** @type {HTMLCanvasElement} */ (document.getElementById('view'));
  const t = document.createElement('canvas'); t.width = c.width; t.height = c.height;
  const ctx = /** @type {CanvasRenderingContext2D} */ (t.getContext('2d'));
  ctx.drawImage(c, 0, 0);
  return Array.from(ctx.getImageData(0, 0, t.width, t.height).data);
});

test('the shader samples the noise field as the CPU rule does, with zero mean and unit variance', async ({ page }) => {
  await page.selectOption('select[name=view]', 'noise');
  const res = await page.evaluate(async (n) => {
    const nf = await import('/js/noise/noiseField.js');
    const F = window.__foort.noise();
    window.__foort.setTime(37);
    const rec = await window.__foort.backend.readRecords(1);
    return { meta: F.meta, rec: Array.from(rec), cpu: (() => {
      const out = [];
      for (let k = 0; k < n * n; k++) {
        const r = rec[16 * k + 4], phi = rec[16 * k + 5], dt = rec[16 * k + 6];
        out.push(r > 0 ? nf.sampleNoise(F, 37 + dt, Math.log(r), phi) : null);
      }
      return out;
    })() };
  }, N);
  const px = await canvasPixels(page);
  let maxErr = 0, s = 0, s2 = 0, n = 0;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const X = res.cpu[j * N + i];
    if (X === null) continue;
    const grey = px[4 * ((N - 1 - j) * N + i)] / 255;
    if (grey <= 0.001 || grey >= 0.999) continue;   // clamped
    const Xg = (grey - 0.5) * 8;
    maxErr = Math.max(maxErr, Math.abs(Xg - X));
    s += X; s2 += X * X; n++;
  }
  expect(n).toBeGreaterThan(0.3 * N * N);
  expect(maxErr).toBeLessThan(0.1);   // 8-bit readback (0.03) + hardware filter weights
  // statistics of the GPU samples: one image covers a correlated patch of the field, so average over 20 times
  // spread over the period (T = 200 M, correlation time 8 M)
  let S = 0, S2 = 0, M = 0;
  for (let k = 0; k < 20; k++) {
    await page.evaluate((t) => window.__foort.setTime(t), 10 * k + 3);
    const q = await canvasPixels(page);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      if (res.cpu[j * N + i] === null) continue;
      const Xg = (q[4 * ((N - 1 - j) * N + i)] / 255 - 0.5) * 8;
      S += Xg; S2 += Xg * Xg; M++;
    }
  }
  expect(Math.abs(S / M)).toBeLessThan(0.15);
  expect(Math.abs(S2 / M - (S / M) ** 2 - 1)).toBeLessThan(0.25);
});

test('the animation loops seamlessly at t = T; slow and fast light differ', async ({ page }) => {
  const T = await page.evaluate(() => window.__foort.noise().meta.T_over_M);
  await page.evaluate(() => window.__foort.setTime(13));
  const a = await canvasPixels(page);
  await page.evaluate((t) => window.__foort.setTime(13 + t), T);
  const b = await canvasPixels(page);
  let maxd = 0;
  for (let k = 0; k < a.length; k++) maxd = Math.max(maxd, Math.abs(a[k] - b[k]));
  expect(maxd).toBeLessThanOrEqual(2);
  await page.locator('input[name=slowLight]').uncheck();
  await page.evaluate(() => window.__foort.setTime(13));
  const c = await canvasPixels(page);
  let diff = 0;
  for (let k = 0; k < a.length; k++) diff += Math.abs(a[k] - c[k]);
  expect(diff / a.length).toBeGreaterThan(1);
  // the trace is not repeated for time, light or noise changes
  const st = await page.evaluate(() => window.__foort.stats());
  await page.locator('input[name=sigmaN]').evaluate((el) => { el.value = '0.5'; el.dispatchEvent(new Event('change')); });
  expect(await page.evaluate(() => window.__foort.stats())).toEqual(st);
});

test('playing advances the clock', async ({ page }) => {
  await page.locator('input[name=play]').check();
  await page.waitForTimeout(800);
  const t = Number((await page.locator('#clock').textContent())?.match(/t = ([\d.]+)/)?.[1]);
  expect(t).toBeGreaterThan(2);
});
