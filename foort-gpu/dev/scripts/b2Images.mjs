// Stage 1B B2 checkpoint images: fuzzball disc emission with the first 3 crossings only (Stage 1, max passes 3) and with
// all crossings (binned tail), 512^2, Test_FBdetail camera, time-averaged (sigma_n = 0), common exposure per pair.
// Output: dev/reports/img/b2/ (git-ignored) as PNG pairs and one comparison sheet per lambda.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openViewer } from './gpuRunner.mjs';

const out = resolve(dirname(fileURLToPath(import.meta.url)), '../reports/img/b2');
mkdirSync(out, { recursive: true });
const FB = 'v=2&N=512&play=0&sigmaN=0&metric=st3cr&r=10.4167&inc=85.9437&screen=6.25&mu=0&gamma=-1.5&sigma=0.0833333&maxSteps=10000&farSteps=0';
const v = await openViewer();
const base = v.page.url().replace(/index\.html.*$/, 'index.html');
try {
  for (const [tag, q] of [['0.05', 'lambda=0.05'], ['5e-3', 'lambda=0.005'], ['1e-3', 'lambda=0.001'], ['1e-4', 'lambda=0.0001'], ['0', 'bh0=1']]) {
    let exposure = null;
    for (const [mode, extra] of [['all', ''], ['first3', '&maxPasses=3']]) {
      await v.page.goto(`${base}?${FB}&${q}${extra}${exposure ? `&autoExposure=0&exposure=${exposure}` : ''}`);
      await v.page.waitForFunction(() => window.__foort && /done/.test(document.getElementById('status').textContent), null, { timeout: 600_000 });
      await v.page.waitForTimeout(200);
      if (!exposure) exposure = await v.page.evaluate(() => Number(document.getElementById('legend').textContent.match(/exposure ([\d.e+-]+)/)?.[1]));
      const url = await v.page.evaluate(() => document.getElementById('view').toDataURL('image/png'));
      writeFileSync(join(out, `st3cr_l${tag}_${mode}.png`), Buffer.from(url.split(',')[1], 'base64'));
      console.log(tag, mode, 'exposure', exposure);
    }
  }
} finally { await v.close(); }
