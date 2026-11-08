import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (e) => console.error('page error:', e.message));
  await page.goto('index.html?N=128&play=0');
  await page.waitForFunction(() => window.__foort || window.__foortError, null, { timeout: 60_000 });
  expect(await page.evaluate(() => window.__foortError)).toBeUndefined();
  await expect(page.locator('#status')).toContainText('done', { timeout: 60_000 });
});

test('add a metric: Reissner-Nordström is in the menu with its charge slider (from the registry alone)', async ({ page }) => {
  await page.selectOption('select[name=metric]', 'reissnerNordstrom');
  await expect(page.locator('#status')).toContainText('done', { timeout: 60_000 });
  await expect(page.locator('input[name=Q]')).toBeVisible();
  await expect(page.locator('input[name=a]')).toBeHidden();
  await expect(page.locator('#perf')).toContainText('ISCO');
});

test('Reissner-Nordström shadow on the GPU vs the analytic critical impact parameter', async ({ page }) => {
  const res = await page.evaluate(async () => {
    const Q = 0.8, N = 256, cam = { r: 1000, theta: 1.2, screen: 14 };
    const t = await window.__foort.trace({ metric: 'reissnerNordstrom', metricParams: { Q }, camera: cam, N, maxSteps: 5000 });
    const bin = atob(t.records), buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    const rec = new Float32Array(buf.buffer);
    // analytic: photon sphere r_ph = (3 + sqrt(9 - 8 Q^2)) / 2, b_c = r_ph / sqrt(f(r_ph)); static camera sin(psi) = b_c sqrt(f(r_c)) / r_c
    const f = (r) => 1 - 2 / r + Q * Q / (r * r);
    const rph = (3 + Math.sqrt(9 - 8 * Q * Q)) / 2, bc = rph / Math.sqrt(f(rph));
    const rho = cam.r * Math.tan(Math.asin(bc * Math.sqrt(f(cam.r)) / cam.r));
    let nG = 0, nA = 0, mis = 0;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const a = cam.screen * ((i + 0.5) / N - 0.5), b = cam.screen * ((j + 0.5) / N - 0.5);
      const inA = Math.hypot(a, b) < rho, inG = Math.round(rec[24 * (j * N + i)]) % 16 === 1;
      nA += inA ? 1 : 0; nG += inG ? 1 : 0; if (inA !== inG) mis++;
    }
    return { ratio: Math.sqrt(nG / nA), mis, edgePx: 2 * Math.PI * rho / (cam.screen / N) };
  });
  expect(Math.abs(res.ratio - 1)).toBeLessThan(2e-3);
  expect(res.mis).toBeLessThan(0.02 * res.edgePx);   // mismatches only along the edge
});
