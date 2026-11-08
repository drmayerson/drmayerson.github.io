// Stage 1B B4: how much of the disc emission the noise field covers, through the viewer's own code path.
// For each scene the viewer picks the field ('auto'), traces at 512^2 and reports the emission-weighted share of the noisy
// crossings (the first 3) that lie inside the field's radial range (the clock line); the noise-coverage view is saved.
//  - dev/reports/b4/coverage.json; images in dev/reports/img/b4/ (git-ignored).
// Requirement: >= 99% for the fuzzball scenes.
// Usage (from dev/): node scripts/b4Coverage.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openViewer } from './gpuRunner.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const img = resolve(here, '../reports/img/b4'), rep = resolve(here, '../reports/b4');
mkdirSync(img, { recursive: true }); mkdirSync(rep, { recursive: true });
const FB = 'r=10.4167&inc=85.9437&screen=6.25&mu=0&gamma=-1.5&sigma=0.0833333&maxSteps=10000&farSteps=0';
const CMP = 'r=1000&inc=60&screen=16&mu=3&gamma=-1.5&sigma=1&envelope=circumferential&fluidModel=banded';
const SCENES = [
  ['Test_FBdetail l0.05', `metric=st3cr&lambda=0.05&${FB}`],
  ['Test_FBdetail l5e-3', `metric=st3cr&lambda=0.005&${FB}`],
  ['Test_FBdetail l1e-3', `metric=st3cr&lambda=0.001&${FB}`],
  ['Test_FBdetail l1e-4', `metric=st3cr&lambda=0.0001&${FB}`],
  ['Compare 1B (l5e-3)', `metric=st3cr&lambda=0.005&maxSteps=10000&${CMP}`],
  ['Compare 2B (BH l0)', `metric=st3cr&bh0=1&${CMP}`],
  ['Compare 3B (l0.05)', `metric=st3cr&lambda=0.05&maxSteps=10000&${CMP}`],
  ['Compare 1A (Kerr a=0)', `metric=kerr&a=0&${CMP}`],
  ['KerrExample-like (Kerr a=0.94, r=1000)', 'metric=kerr&a=0.94&r=1000&inc=60&screen=16&mu=3&gamma=-1.5&sigma=1'],
];
const v = await openViewer();
const base = v.page.url().replace(/index\.html.*$/, 'index.html');
const rows = [];
try {
  for (const [name, q] of SCENES) {
    await v.page.goto(`${base}?v=2&N=512&play=0&noiseField=auto&view=coverage&${q}`);
    await v.page.waitForFunction(() => window.__foort && /done/.test(document.getElementById('status').textContent), null, { timeout: 600_000 });
    await v.page.waitForFunction(() => /noise covers/.test(document.getElementById('clock').textContent), null, { timeout: 60_000 });
    await v.page.waitForTimeout(300);
    const clock = await v.page.evaluate(() => document.getElementById('clock').textContent);
    const m = clock.match(/\((\S+?), auto.*noise covers ([\d.]+)%/);
    const row = { scene: name, field: m?.[1], coveragePercent: Number(m?.[2]), clock };
    rows.push(row);
    const url = await v.page.evaluate(() => document.getElementById('view').toDataURL('image/png'));
    writeFileSync(join(img, `coverage_${name.replace(/[^\w.-]+/g, '_')}.png`), Buffer.from(url.split(',')[1], 'base64'));
    console.log(`${name}: ${row.field}, coverage ${row.coveragePercent}%`);
  }
} finally { await v.close(); }
writeFileSync(join(rep, 'coverage.json'), JSON.stringify(rows, null, 1));
const bad = rows.filter((r) => r.scene.match(/l0|l1e|l5e/) && !(r.coveragePercent >= 99));
console.log(bad.length ? `BELOW 99%: ${bad.map((r) => r.scene).join(', ')}` : 'all fuzzball scenes >= 99%');
