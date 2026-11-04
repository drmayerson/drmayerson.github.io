// M3 performance: viewer trace times vs the M0 benchmark shader, same browser and GPU.
// Usage (from dev/): node scripts/m3Perf.mjs [--headed]  -> dev/reports/m3/perf.json
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openViewer } from './gpuRunner.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[(s.length - 1) >> 1]; };
const viewer = await openViewer({ headed: process.argv.includes('--headed') });
const out = { renderer: viewer.renderer, viewer: [], bench: null };
try {
  const cam = { r: 1000, theta: 0.2967, screen: 15 };
  for (const N of [512, 1024]) for (const levels of [[1], [4, 2, 1]]) for (const storeH of [false]) {
    const runs = [];
    for (let k = 0; k < 4; k++) runs.push((await viewer.trace({ metric: 'kerr', metricParams: { a: 0.94 }, camera: cam, N, storeH }, { levels })).stats);
    const s = runs.slice(1);   // first run includes shader compilation
    const row = { N, levels, wallMs: median(s.map((x) => x.wallMs)), gpuMs: s[0].gpuMs === null ? null : median(s.map((x) => x.gpuMs)), stepsPerRay: s[0].steps / (N * N), tiles: s[0].tiles };
    row.mStepsPerSecGPU = row.gpuMs ? s[0].steps / (row.gpuMs * 1e3) : null;
    console.log(`viewer ${N}² levels ${levels.join('>')}: ${row.wallMs.toFixed(0)} ms wall, ${row.gpuMs?.toFixed(0)} ms GPU, ${row.stepsPerRay.toFixed(0)} steps/ray, ${row.mStepsPerSecGPU?.toFixed(0)} Msteps/s, ${row.tiles} tiles`);
    out.viewer.push(row);
  }
  const page = viewer.page;
  await page.goto(page.url().replace(/index\.html.*$/, 'bench/?auto=1&sizes=512,1024&runs=3'));
  await page.waitForFunction(() => window.__benchResult, null, { timeout: 300_000 });
  out.bench = await page.evaluate(() => window.__benchResult.results.filter((x) => x.backend === 'WebGL2'));
  for (const r of out.bench) console.log(`M0 bench WebGL2 ${r.N}²: ${r.wallMsMedian.toFixed(0)} ms wall, ${r.gpuMsMedian?.toFixed?.(0)} ms GPU`);
} finally { await viewer.close(); }
mkdirSync(resolve(here, '../reports/m3'), { recursive: true });
writeFileSync(resolve(here, '../reports/m3/perf.json'), JSON.stringify(out, null, 1));
