// Stage 1B B9 acceptance (plan B9): on this machine, at the auto-selected tier,
//   1024^2 Kerr <= 1 s;  512^2 fuzzball at lambda = 1e-3 <= 4 s;  display with light curve and beam >= 50 fps at
//   512^2-1024^2;  azimuth drag at 60 fps with no re-trace.
// Trace times: the viewer's own final traces (levels 4 -> 1, cache off), best of 3 after a warm-up. Display: (a) the
// throughput of the display pass (200 frames back to back, finished with a read-back) and (b) the frame rate the page
// reaches while playing (requestAnimationFrame over 3 s). Drag: synthetic pointer moves for 2 s.
// Usage (from dev/): node scripts/b9Acceptance.mjs [--label laptop]  -> dev/reports/b9/acceptance_<label>.json
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const label = args.includes('--label') ? args[args.indexOf('--label') + 1] : 'laptop';
const out = resolve(here, '../reports/b9');
mkdirSync(out, { recursive: true });
const server = spawn(process.execPath, [resolve(here, 'serve.mjs'), '8774'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));
const b = await chromium.launch({ channel: 'chrome', headless: !args.includes('--headed'), args: ['--enable-gpu', '--ignore-gpu-blocklist', '--disable-gpu-watchdog'] });
const page = await b.newPage({ viewport: { width: 1400, height: 1100 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
const open = async (q) => {
  await page.goto(`http://127.0.0.1:8774/index.html?ui=expert&play=0&pretrace=0&${q}`);
  await page.waitForFunction(() => window.__foort && /done/.test(document.getElementById('status').textContent), null, { timeout: 300_000 });
};
const traceTime = () => page.evaluate(async () => {
  const f = window.__foort, v = f.view(), lv = v.N >= 2048 ? [8, 1] : v.N >= 512 ? [4, 1] : [2, 1];
  await f.trace(v, { levels: lv, adaptTiles: true, measureSteps: false, records: false });
  const ms = [];
  for (let k = 0; k < 3; k++) ms.push((await f.trace(v, { levels: lv, adaptTiles: true, measureSteps: false, records: false })).stats.wallMs);
  return { ms: Math.min(...ms), runs: ms, tier: f.tier() };
});
const report = { label, date: new Date().toISOString(), cases: {} };
try {
  await open('N=1024&metric=kerr');
  report.renderer = await page.evaluate(() => window.__foort.backend.capabilities().renderer);
  report.cases.kerr1024 = { ...(await traceTime()), target: '<= 1000 ms' };
  await open('N=512&metric=st3cr&lambda=0.001&r=10.4167&inc=85.9437&screen=6.25');
  report.cases.fuzzball512_FBdetail = { ...(await traceTime()), target: '<= 4000 ms' };
  await open('N=512&metric=st3cr&lambda=0.001');
  report.cases.fuzzball512_far = { ...(await traceTime()), target: '<= 4000 ms (the viewer default camera)' };
  for (const N of [512, 1024]) {
    await open(`N=${N}&metric=kerr&inc=60&lightcurve=1&blur=1&units=sgra`);
    const r = await page.evaluate(async () => {
      const f = window.__foort, gl = document.getElementById('view').getContext('webgl2');
      const px = new Uint8Array(4);
      // (a) the display pass back to back
      f.setTime(0); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const t0 = performance.now();
      for (let k = 0; k < 200; k++) f.setTime(k * 0.5);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const passMs = (performance.now() - t0) / 200;
      // (b) the page playing: requestAnimationFrame rate over 3 s
      f.state.play = true;
      let n = 0;
      const t1 = performance.now();
      await new Promise((res) => { const tick = () => { n++; if (performance.now() - t1 < 3000) requestAnimationFrame(tick); else res(undefined); }; requestAnimationFrame(tick); });
      f.state.play = false;
      return { passMs, passFps: 1000 / passMs, rafFps: n / ((performance.now() - t1) / 1000), lcSamples: f.lightCurve().length };
    });
    report.cases[`display${N}_lightcurve_beam`] = { ...r, target: '>= 50 fps' };
  }
  // azimuth drag: 2 s of pointer moves on the image, frames counted, no run started
  await open('N=512&metric=kerr&inc=60');
  const box = await page.locator('#view').boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  const runs0 = await page.evaluate(() => window.__foort.runs());
  await page.evaluate(() => { window.__frames = 0; const tick = () => { window.__frames++; if (window.__countFrames) requestAnimationFrame(tick); }; window.__countFrames = true; requestAnimationFrame(tick); });
  await page.mouse.move(cx, cy); await page.mouse.down();
  const t0 = Date.now();
  let k = 0;
  while (Date.now() - t0 < 2000) { await page.mouse.move(cx + 100 * Math.sin(k / 10), cy, { steps: 1 }); k++; }
  await page.mouse.up();
  const frames = await page.evaluate(() => { window.__countFrames = false; return window.__frames; });
  const az = await page.evaluate(() => window.__foort.state.az);
  report.cases.azimuthDrag = { fps: frames / ((Date.now() - t0) / 1000), moves: k, runsStarted: (await page.evaluate(() => window.__foort.runs())) - runs0, azimuth: az, target: '60 fps, no re-trace' };
} finally { await b.close(); server.kill(); }
writeFileSync(resolve(out, `acceptance_${label}.json`), JSON.stringify(report, null, 1));
console.log(JSON.stringify(report, null, 1));
