// Review package 2 (P1, P5): the scheduler. The viewer's final traces (levels 4 -> 1 at 512^2, 8 -> 1 at 2048^2, adaptive
// tiles, cache off) of the default Kerr view: wall time, GPU time, tiles, and the time the whole call takes (with the
// step count read back, as the expert panel does), over 5 runs after a warm-up.
// Usage (from dev/): node scripts/r2Sched.mjs [--label before]  -> dev/reports/review/sched_<label>.json
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openViewer } from './gpuRunner.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const label = args.includes('--label') ? args[args.indexOf('--label') + 1] : 'now';
const out = resolve(here, '../reports/review');
mkdirSync(out, { recursive: true });
const v = await openViewer({ port: 8776 });
const rows = [];
try {
  for (const [name, N, extra] of [['kerr512', 512, {}], ['kerr2048', 2048, {}], ['kerr512_inc60', 512, { theta: 60 }], ['fuzzball512', 512, { st3cr: true }]]) {
    const r = await v.page.evaluate(async ([N, x]) => {
      const f = window.__foort, D = Math.PI / 180;
      const view = x.st3cr
        ? { ...f.view(), metric: 'st3cr', metricParams: { lambda: 0.005 }, camera: { r: 250 / 24, theta: 1.5, screen: 150 / 24 }, N, path: 'auto', quality: 'high', maxSteps: 5000, farSteps: { r: 20, max: 4 }, eps: 0.03 }
        : { ...f.view(), metric: 'kerr', metricParams: { a: 0.94 }, camera: { r: 1000, theta: (x.theta ?? 17) * D, screen: 15 }, N, path: 'auto' };
      const lv = N >= 2048 ? [8, 1] : [4, 1];
      await f.trace(view, { levels: lv, adaptTiles: true, records: false, measureSteps: true });
      const runs = [];
      for (let k = 0; k < 5; k++) {
        const t0 = performance.now();
        const t = await f.trace(view, { levels: lv, adaptTiles: true, records: false, measureSteps: true });
        runs.push({ call: performance.now() - t0, wall: t.stats.wallMs, gpu: t.stats.gpuMs, tiles: t.stats.tiles });
      }
      return runs;
    }, [N, extra]);
    const med = (k) => { const s = r.map((x) => x[k]).sort((a, b) => a - b); return s[2]; };
    const row = { name, N, wall: med('wall'), gpu: med('gpu'), call: med('call'), tiles: med('tiles'), ratio: med('wall') / med('gpu'), runs: r };
    rows.push(row);
    console.log(`${name}: wall ${row.wall.toFixed(0)} ms, GPU ${row.gpu?.toFixed(0)} ms (wall/GPU ${row.ratio.toFixed(2)}), whole call ${row.call.toFixed(0)} ms, ${row.tiles} tiles`);
  }
} finally { await v.close(); }
writeFileSync(resolve(out, `sched_${label}.json`), JSON.stringify({ label, date: new Date().toISOString(), rows }, null, 1));
