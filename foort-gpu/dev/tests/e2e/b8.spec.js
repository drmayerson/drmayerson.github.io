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

test('B8: the light-curve reduction equals a CPU sum of the same frame; the time average', async ({ page }) => {
  test.setTimeout(180_000);
  await ready(page, 'N=256&play=0&pretrace=0&inc=60&lightcurve=1');
  // one frame at t = 50: the GPU sum (read back asynchronously) vs the sum of the linear image in double
  const r = await page.evaluate(async () => {
    const f = window.__foort;
    f.setTime(50);
    let got;
    for (let k = 0; k < 100 && !got; k++) { await new Promise((res) => setTimeout(res, 20)); got = f.lightCurve().find((x) => Math.abs(x[0] - 50) < 1e-9); }
    const lin = await f.backend.readLinear('A');
    const s = [0, 0, 0, 0];
    for (let p = 0; p < lin.w * lin.h; p++) for (let c = 0; c < 4; c++) s[c] += lin.data[4 * p + c];
    return { gpu: got.slice(1), cpu: s };
  });
  for (let c = 0; c < 4; c++) expect(Math.abs(r.gpu[c] - r.cpu[c]) / Math.max(Math.abs(r.cpu[0]), 1e-30)).toBeLessThan(1e-5);
  expect(Math.abs(r.cpu[1] + r.cpu[2] + r.cpu[3] - r.cpu[0]) / r.cpu[0]).toBeLessThan(1e-5);
  // the time average (sigma_n = 0) equals the mean over one noise period (32 frames) to within sampling noise
  const avg = await page.evaluate(async () => {
    const f = window.__foort, T = f.noise().meta.T_over_M;
    const sumAt = async (t) => {
      f.setTime(t);
      let got;
      for (let k = 0; k < 100 && !got; k++) { await new Promise((res) => setTimeout(res, 15)); got = f.lightCurve().find((x) => Math.abs(x[0] - t) < 1e-9); }
      return got[1];
    };
    const xs = [];
    for (let n = 0; n < 32; n++) xs.push(await sumAt((n * T) / 32 + 0.123));
    const m = xs.reduce((a, b) => a + b, 0) / xs.length;
    const sd = Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
    f.state.timeAvg = true;
    const flat = await sumAt(1);
    f.state.timeAvg = false;
    return { m, flat, sd };
  });
  // E[exp(sigma X - sigma^2 / 2)] = 1: within the sampling noise of one period (the 32 frames are correlated over the
  // field's correlation time, about 8 independent samples per period: 3 standard errors)
  expect(Math.abs(avg.m - avg.flat)).toBeLessThan(3 * avg.sd / Math.sqrt(8));
  expect(Math.abs(avg.m - avg.flat) / avg.flat).toBeLessThan(0.15);
});

test('B8: the telescope beam has the requested width (the variance it adds to a compact source)', async ({ page }) => {
  test.setTimeout(180_000);
  // a compact source: the disc (r < ~10 M) in a 200 M field, so the beam spreads no light off the image; beam in M
  await ready(page, 'N=256&play=0&pretrace=0&inc=17&timeAvg=1&screen=200');
  const m = await page.evaluate(async () => {
    const f = window.__foort;
    /** intensity-weighted variance (x and y), in full-resolution pixels, of an image 2^k times smaller */
    const moments = (img) => {
      const sc = 2 ** img.k;
      let w = 0, sx = 0, sy = 0, sxx = 0, syy = 0;
      for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) {
        const I = img.data[4 * (y * img.w + x)];
        const X = (x + 0.5) * sc, Y = (y + 0.5) * sc;
        w += I; sx += I * X; sy += I * Y; sxx += I * X * X; syy += I * Y * Y;
      }
      return { vx: sxx / w - (sx / w) ** 2, vy: syy / w - (sy / w) ** 2, w: w * sc * sc };
    };
    const out = [];
    for (const fwhm of [10, 20, 40]) {
      f.state.blur = true; f.state.beamM = fwhm; f.setTime(0);
      const a = moments({ ...(await f.backend.readLinear('A')), k: 0 });   // the same frame before the beam
      const post = await f.backend.readPost('A');
      const b = moments(post);
      out.push({ fwhm, k: post.k, dvx: b.vx - a.vx, dvy: b.vy - a.vy, flux: b.w / a.w });
    }
    return out;
  });
  for (const r of m) {
    // sigma (px) = FWHM / 2.3548 / (screen / N); box-averaging 2^k pixels adds (4^k - 1) / 12 px^2
    const s = r.fwhm / 2.354820045 / (200 / 256), box = (4 ** r.k - 1) / 12;
    for (const dv of [r.dvx, r.dvy]) {
      expect(Math.sqrt(dv)).toBeGreaterThan(0.97 * s);
      expect(Math.sqrt(dv)).toBeLessThan(1.03 * Math.sqrt(s * s + box));
    }
    expect(Math.abs(r.flux - 1)).toBeLessThan(0.01);
  }
});

test('B8: the pixel inspector: the CPU ray agrees with the GPU record (Kerr and the fuzzball)', async ({ page }) => {
  test.setTimeout(240_000);
  for (const q of ['metric=kerr&a=0.94&inc=60&quality=high', 'metric=st3cr&lambda=0.05&r=10.4167&inc=85.9437&screen=6.25&quality=high']) {
    await ready(page, `N=128&play=0&pretrace=0&inspect=1&${q}`);
    let agree = 0, n = 0;
    for (const [xf, yf] of [[0.5, 0.5], [0.3, 0.45], [0.62, 0.4], [0.8, 0.8], [0.15, 0.2], [0.55, 0.7]]) {
      await page.evaluate(([x, y]) => window.__foort.inspect(x, y), [xf, yf]);
      const r = (await page.evaluate(() => window.__foort.inspected()))[0];
      expect(r.cpu.error).toBeUndefined();
      n++;
      if (r.cpu.term === r.gpu.term) agree++;
      // matching crossings: radii to 1e-3 relative where both have them (outside chaotic scattering)
      if (r.cpu.term === r.gpu.term && r.cpu.crossings.length && r.gpu.crossings.length) {
        expect(Math.abs(r.cpu.crossings[0].r - r.gpu.crossings[0].r) / r.cpu.crossings[0].r).toBeLessThan(2e-3);
      }
    }
    expect(agree / n).toBeGreaterThanOrEqual(5 / 6);
    await expect(page.locator('#inspTable tr')).toHaveCount(4);   // header + 3 kept rays
  }
});

test('B8: physical units in the clock, the scale bar and the panel; real time', async ({ page }) => {
  test.setTimeout(120_000);
  await ready(page, 'N=128&play=0&pretrace=0&units=sgra&realTime=1');
  await page.evaluate(() => window.__foort.setTime(100));
  await expect(page.locator('#clock')).toContainText('t = 100.0 M = 35.3 min');
  await expect(page.locator('#scaleBar')).toContainText('µas');
  await expect(page.locator('label:has(input[name=screen]) output')).toContainText('µas');
  await page.selectOption('select[name=units]', 'M');
  await expect(page.locator('#scaleBar')).not.toContainText('µas');
});
