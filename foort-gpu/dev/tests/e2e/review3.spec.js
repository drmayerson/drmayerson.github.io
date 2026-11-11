// Review package 3 (P6): record memory at 2048^2, the cache within its budget, shared textures restored correctly.
import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (e) => console.error('page error:', e.message));
});

const mb = async (page) => {
  const t = await page.locator('#perf').textContent();
  const tot = Number(t.match(/GPU record memory(\d+) MB/)[1]);
  const [, used, budget] = t.match(/record cache\d+ views?, (\d+) of (\d+) MB/).map(Number);
  return { tot, used, budget };
};

test('P6: 2048^2 Kerr holds at most 450 MB of records; the cache never exceeds its budget', async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto('index.html?ui=expert&N=2048&play=0&pretrace=0&quality=normal');
  await expect(page.locator('#status')).toContainText('done', { timeout: 200_000 });
  const m = await mb(page);
  expect(m.tot).toBeLessThanOrEqual(450);
  expect(m.used).toBeLessThanOrEqual(m.budget);
});

test('P6: views share their textures with the cache; switching back restores the same pixels; eviction keeps the shown view', async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto('index.html?ui=expert&N=512&play=0&pretrace=0&cacheMB=64');
  await expect(page.locator('#status')).toContainText('done', { timeout: 120_000 });
  // the canvas is redrawn on the animation frame after "done": wait two frames
  const px = () => page.evaluate(async () => {
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const c = document.getElementById('view'), o = document.createElement('canvas'); o.width = c.width; o.height = c.height;
    const g = o.getContext('2d'); g.drawImage(c, 0, 0); return Array.from(g.getImageData(0, 0, o.width, o.height).data.filter((_, k) => k % 97 === 0));
  });
  // set the inclination and wait for that trace (not the previous "done")
  const setInc = async (v) => {
    const f0 = await page.evaluate(() => window.__foort.finals());
    await page.locator('input[name=inc]').evaluate((el, x) => { el.value = x; el.dispatchEvent(new Event('change')); }, v);
    await page.waitForFunction((f) => window.__foort.finals() > f, f0, { timeout: 120_000 });
  };
  const first = await px();
  // two more views: the 64 MB budget (two 512^2 entries of 25 MB) evicts the first
  for (const inc of ['40', '70']) {
    await setInc(inc);
    const m = await mb(page);
    expect(m.used).toBeLessThanOrEqual(m.budget);
  }
  const shown = await px();
  expect(shown.some((v, k) => v !== first[k])).toBe(true);
  // back to the first view: traced again (evicted) or restored; either way the same image
  await setInc('17');
  expect(await px()).toEqual(first);
  // and the 70 deg view, evicted or not, again
  await setInc('70');
  expect(await px()).toEqual(shown);
});
