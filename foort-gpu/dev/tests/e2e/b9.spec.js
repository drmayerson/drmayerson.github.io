import { test, expect } from '@playwright/test';
import { pngTexts } from '../../../js/export.js';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (e) => console.error('page error:', e.message));
});

const ready = async (page, q) => {
  await page.goto(`index.html?ui=expert&${q}`);
  await page.waitForFunction(() => window.__foort || window.__foortError, null, { timeout: 60_000 });
  expect(await page.evaluate(() => window.__foortError)).toBeUndefined();
  await expect(page.locator('#status')).toContainText('done', { timeout: 120_000 });
};

test('B9: the snapshot is the image at trace resolution with the view link inside; a download', async ({ page }) => {
  test.setTimeout(120_000);
  await ready(page, 'N=256&play=0&pretrace=0&inc=40&snapBurn=1&units=sgra');
  const b64 = await page.evaluate(async () => {
    const u8 = await window.__foort.snapshotBytes();
    let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
    return btoa(s);
  });
  const png = Uint8Array.from(Buffer.from(b64, 'base64'));
  const url = pngTexts(png)['foort-gpu-url'];
  expect(url).toContain('inc=40');
  expect(url).toContain('v=3');
  // IHDR: 256 x 256
  const dv = new DataView(png.buffer);
  expect([dv.getUint32(16), dv.getUint32(20)]).toEqual([256, 256]);
  // the button downloads a file named after the metric
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#snapshot')]);
  expect(dl.suggestedFilename()).toMatch(/^foort-gpu-kerr-.*\.png$/);
});

test('B9: a short video at a fixed observer-time step (one noise period), with progress; cancel', async ({ page }) => {
  test.setTimeout(180_000);
  await ready(page, 'N=128&play=0&pretrace=0&inc=60&vidSeconds=1&vidFps=24&vidLoop=1');
  const fmt = await page.evaluate(async () => (await import('/js/export.js')).videoFormat());
  test.skip(!fmt, 'this browser offers no MediaRecorder format');
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60_000 }), page.click('#record')]);
  expect(dl.suggestedFilename()).toMatch(/\.(webm|mp4)$/);
  await expect(page.locator('#status')).toContainText('video saved: 24 frames');
  // the clock returns to where it was
  await expect(page.locator('#clock')).toContainText('t = 0.0 M');
  // cancel a longer one
  await page.locator('#view').focus();
  await page.selectOption('select[name=vidFps]', '30');
  await page.locator('input[name=vidSeconds]').evaluate((el) => { el.value = '20'; el.dispatchEvent(new Event('change')); });
  await page.click('#record');
  await expect(page.locator('#progressText')).toContainText('recording');
  await page.click('#cancel');
  await expect(page.locator('#status')).toContainText('recording cancelled', { timeout: 10_000 });
});
