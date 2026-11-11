// Review package 2 (P1, P5): the scheduler changes nothing traced; the GPU step sum.
import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (e) => console.error('page error:', e.message));
});

test('P1: records are bit-identical with adaptive (rate-sized) and fixed tiles; P5: the GPU step sum equals the records', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('index.html?ui=expert&N=128&play=0&pretrace=0');
  await page.waitForFunction(() => window.__foort && /done/.test(document.getElementById('status').textContent), null, { timeout: 120_000 });
  const r = await page.evaluate(async () => {
    const f = window.__foort, D = Math.PI / 180;
    const dec = (b64) => { const s = atob(b64), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return new Float32Array(u.buffer); };
    const out = [];
    for (const view of [
      { ...f.view(), metric: 'kerr', metricParams: { a: 0.94 }, camera: { r: 1000, theta: 60 * D, screen: 15 }, N: 256, path: 'tabulated' },
      { ...f.view(), metric: 'st3cr', metricParams: { lambda: 0.005 }, camera: { r: 250 / 24, theta: 1.5, screen: 150 / 24 }, N: 128, path: 'auto', maxSteps: 5000 },
    ]) {
      const a = await f.trace(view, { levels: [4, 1], adaptTiles: true, measureSteps: true });
      const b = await f.trace(view, { levels: [4, 1], adaptTiles: false, measureSteps: true });
      const A = dec(a.records), B = dec(b.records);
      let diff = 0, steps = 0;
      for (let k = 0; k < A.length; k++) if (!Object.is(A[k], B[k])) diff++;
      for (let p = 0; p < A.length / 24; p++) steps += A[24 * p + 1];
      out.push({ diff, gpuSteps: a.stats.steps, cpuSteps: steps, tilesA: a.stats.tiles, tilesB: b.stats.tiles });
    }
    return out;
  });
  for (const x of r) {
    expect(x.diff).toBe(0);
    expect(Math.abs(x.gpuSteps - x.cpuSteps) / x.cpuSteps).toBeLessThan(1e-5);
  }
});
