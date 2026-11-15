// Review package 4 (P3): drag previews. The default Kerr view at 512^2, its inclination slider moved by one notch per
// animation frame for 3 s (as a drag does), after one drag to measure the preview cost: previews per second, their
// stride (resolution) and wall time.
// Usage (from dev/): node scripts/r4Drag.mjs [--label now] [--metric st3cr] [--q extra=query]  -> dev/reports/review/drag_<label>.json
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openViewer } from './gpuRunner.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const label = opt('--label', 'now'), metric = opt('--metric', 'kerr'), extra = opt('--q', '');
const out = resolve(here, '../reports/review');
mkdirSync(out, { recursive: true });
const v = await openViewer({ port: 8777 });
const rows = [];
try {
  await v.page.goto(v.page.url().replace(/\?.*$/, `?N=512&play=0&pretrace=0&metric=${metric}&ui=expert${extra ? `&${extra}` : ''}`));
  await v.page.waitForFunction(() => window.__foort?.finals() >= 1, null, { timeout: 120_000 });
  for (const pass of ['warm-up', 'measured']) {
    const r = await v.page.evaluate(async (ms) => {
      const el = /** @type {HTMLInputElement} */ (document.querySelector('input[name=inc]'));
      const f = window.__foort, p0 = f.previews(), strides = new Map();
      let inc = 20, dir = 1;
      const t0 = performance.now();
      await new Promise((done) => {
        const step = () => {
          if (performance.now() - t0 > ms) return done(null);
          inc += dir * 0.5; if (inc > 70 || inc < 10) dir = -dir;
          el.value = String(inc); el.dispatchEvent(new Event('input'));
          const p = f.previews(); if (p.stride) strides.set(p.stride, (strides.get(p.stride) ?? 0) + 1);
          requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      });
      const p1 = f.previews();
      el.dispatchEvent(new Event('change'));
      return { previews: p1.done - p0.done, seconds: (performance.now() - t0) / 1000, lastStride: p1.stride, lastMs: p1.ms, gpuMedian: p1.gpu.sort((a, b) => a - b)[p1.gpu.length >> 1] ?? null, N: p1.N, strideFrames: Object.fromEntries(strides) };
    }, 3000);
    await v.page.waitForFunction(() => /done/.test(document.getElementById('status').textContent), null, { timeout: 120_000 });
    const row = { pass, ...r, fps: r.previews / r.seconds, previewRes: r.N / r.lastStride };
    rows.push(row);
    console.log(`${pass}: ${row.fps.toFixed(1)} previews/s at ${row.previewRes}^2 (stride ${r.lastStride}, last ${r.lastMs.toFixed(1)} ms wall, GPU median ${r.gpuMedian?.toFixed(1)} ms); frames by stride ${JSON.stringify(r.strideFrames)}`);
  }
} finally { await v.close(); }
writeFileSync(resolve(out, `drag_${label}_${metric}.json`), JSON.stringify({ label, metric, date: new Date().toISOString(), rows }, null, 1));
