import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (e) => console.error('page error:', e.message));
});

const ready = async (page, q) => {
  await page.goto(`index.html?${q}`);
  await page.waitForFunction(() => window.__foort || window.__foortError, null, { timeout: 60_000 });
  expect(await page.evaluate(() => window.__foortError)).toBeUndefined();
  await expect(page.locator('#status')).toContainText('done', { timeout: 120_000 });
};
const done = (page) => expect(page.locator('#status')).toContainText('done', { timeout: 120_000 });
const slide = (page, name, value) => page.locator(`input[name=${name}]`).evaluate((el, v) => {
  el.value = String(v); el.dispatchEvent(new Event('input')); el.dispatchEvent(new Event('change'));
}, value);

test('B7: the normal panel by default; switching panels keeps the state', async ({ page }) => {
  test.setTimeout(180_000);
  await ready(page, 'N=128&play=0&pretrace=0');
  await expect(page.locator('select[name=family]')).toBeVisible();
  await expect(page.locator('select[name=metric]')).toBeHidden();
  await expect(page.locator('#perfBox')).toBeHidden();
  await slide(page, 'inc', 40);
  await done(page);
  await page.click('#uiToggle');
  await expect(page.locator('select[name=metric]')).toBeVisible();
  await expect(page.locator('select[name=family]')).toBeHidden();
  expect(await page.evaluate(() => window.__foort.state.inc)).toBe(40);
  await expect.poll(() => page.url()).toContain('ui=expert');
  await page.locator('#view').focus();
  await page.keyboard.press('e');
  await expect(page.locator('select[name=family]')).toBeVisible();
  expect(await page.evaluate(() => window.__foort.state.inc)).toBe(40);
  // the family switch selects the fuzzball; the lambda slider's lowest position is lambda = 0
  await page.selectOption('select[name=family]', 'fuzzball');
  await done(page);
  expect(await page.evaluate(() => window.__foort.state.metric)).toBe('st3cr');
  await slide(page, 'lambda', -1);
  await done(page);
  expect(await page.evaluate(() => window.__foort.state.bh0)).toBe(true);
});

test('B7: drag rotates (azimuth without a trace, viewing angle with one), wheel and pinch zoom', async ({ page }) => {
  test.setTimeout(180_000);
  await ready(page, 'N=128&play=0&pretrace=0');
  const box = await page.locator('#view').boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  const runs0 = await page.evaluate(() => window.__foort.runs());
  // horizontal drag: azimuth only, no run
  await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.move(cx + 40, cy, { steps: 4 }); await page.mouse.up();
  expect(await page.evaluate(() => window.__foort.state.az)).not.toBe(0);
  expect(await page.evaluate(() => window.__foort.runs())).toBe(runs0);
  // vertical drag: viewing angle, previews while dragging and a full trace on release
  const inc0 = await page.evaluate(() => window.__foort.state.inc);
  await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.move(cx, cy - 30, { steps: 3 }); await page.mouse.up();
  expect(await page.evaluate(() => window.__foort.state.inc)).toBeGreaterThan(inc0);
  expect(await page.evaluate(() => window.__foort.runs())).toBeGreaterThan(runs0);
  await done(page);
  // wheel: zoom in, a full trace after the pause
  const s0 = await page.evaluate(() => window.__foort.state.screen);
  await page.mouse.move(cx, cy); await page.mouse.wheel(0, -300);
  await expect.poll(() => page.evaluate(() => window.__foort.state.screen)).toBeLessThan(s0);
  await done(page);
  // pinch (two synthetic touch pointers moving apart): zoom in
  const s1 = await page.evaluate(() => window.__foort.state.screen);
  await page.locator('#view').evaluate((el, [x, y]) => {
    const ev = (type, id, px) => el.dispatchEvent(new PointerEvent(type, { pointerId: id, clientX: px, clientY: y, bubbles: true, pointerType: 'touch' }));
    el.setPointerCapture = () => {};
    ev('pointerdown', 11, x - 20); ev('pointerdown', 12, x + 20);
    ev('pointermove', 11, x - 40); ev('pointermove', 12, x + 40);
    ev('pointerup', 11, x - 40); ev('pointerup', 12, x + 40);
  }, [cx, cy]);
  await expect.poll(() => page.evaluate(() => window.__foort.state.screen)).toBeLessThan(s1);
  await done(page);
});

test('B7: compare layouts share the camera; side by side doubles the canvas; blink', async ({ page }) => {
  test.setTimeout(240_000);
  await ready(page, 'N=128&play=0&pretrace=0&inc=60');
  await page.selectOption('select[name=compare]', 'split');
  await expect(page.locator('#status')).toContainText('compare A | B', { timeout: 200_000 });
  const A = await page.evaluate(() => window.__foort.side('A')), B = await page.evaluate(() => window.__foort.side('B'));
  expect(A.metric).toBe('kerr'); expect(B.metric).toBe('st3cr');
  expect(B.inc).toBe(A.inc);
  await expect(page.locator('#divider')).toBeVisible();
  expect(await page.evaluate(() => document.getElementById('view').width)).toBe(128);
  await page.selectOption('select[name=compare]', 'side');
  await done(page);
  expect(await page.evaluate(() => document.getElementById('view').width)).toBe(256);
  await page.selectOption('select[name=compare]', 'blink');
  await done(page);
  // b: show the other side by hand (blinking stops)
  const vis = () => page.evaluate(() => getComputedStyle(document.getElementById('labelA')).visibility);
  await page.locator('#view').focus();
  const before = await vis();
  await page.keyboard.press('b');
  await expect.poll(vis).toBe(before === 'visible' ? 'hidden' : 'visible');
  const after = await vis();
  await page.waitForTimeout(1200);   // no longer blinking
  expect(await vis()).toBe(after);
  // expert: the panel edits B; A keeps its own settings
  await page.click('#uiToggle');
  await page.selectOption('select[name=cmpEdit]', 'B');
  expect(await page.evaluate(() => window.__foort.state.metric)).toBe('st3cr');
  await page.selectOption('select[name=cmpEdit]', 'A');
  expect(await page.evaluate(() => window.__foort.state.metric)).toBe('kerr');
  await page.selectOption('select[name=compare]', 'off');
  await done(page);
  await expect(page.locator('#sideLabels')).toBeHidden();
});

test('B7: the last view is remembered; the URL wins; reset restores the defaults', async ({ page }) => {
  test.setTimeout(180_000);
  await ready(page, 'N=128&play=0&pretrace=0&inc=33');
  await page.goto('index.html');
  await page.waitForFunction(() => window.__foort, null, { timeout: 60_000 });
  expect(await page.evaluate(() => window.__foort.state.inc)).toBe(33);
  await page.goto('index.html?N=128&play=0&pretrace=0&inc=21');
  await page.waitForFunction(() => window.__foort, null, { timeout: 60_000 });
  expect(await page.evaluate(() => window.__foort.state.inc)).toBe(21);
  await done(page);
  await page.click('#resetView');
  await page.waitForFunction(() => window.__foort, null, { timeout: 60_000 });
  expect(await page.evaluate(() => window.__foort.state.inc)).toBe(17);
});

test('B7: a long trace can be cancelled; the help overlay', async ({ page }) => {
  test.setTimeout(180_000);
  await ready(page, 'N=128&play=0&pretrace=0');
  await page.locator('#view').focus();
  await page.keyboard.press('?');
  await expect(page.locator('#helpOverlay')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#helpOverlay')).toBeHidden();
  // a slow trace: the fuzzball at Reference, 1024^2
  await page.click('#uiToggle');
  await page.selectOption('select[name=quality]', 'reference');
  await done(page);
  await page.selectOption('select[name=metric]', 'st3cr');
  await done(page);
  await page.selectOption('select[name=N]', '1024');
  await page.locator('#warnGo').click({ timeout: 5000 }).catch(() => {});
  await expect(page.locator('#progress')).toBeVisible({ timeout: 60_000 });
  await page.click('#cancel');
  await expect(page.locator('#status')).toContainText('cancelled');
  await expect(page.locator('#progress')).toBeHidden();
});

test('B7: links from before B7 open with their state (in the normal panel)', async ({ page }) => {
  test.setTimeout(120_000);
  await ready(page, 'v=2&metric=st3cr&lambda=0.05&N=128&play=0&pretrace=0');
  expect(await page.evaluate(() => [window.__foort.state.metric, window.__foort.state.lambda, window.__foort.state.ui])).toEqual(['st3cr', 0.05, 'normal']);
  expect(await page.locator('select[name=family]').inputValue()).toBe('fuzzball');
});
