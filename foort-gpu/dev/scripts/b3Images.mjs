// Stage 1B B3: the two fluid models for the fuzzball (FOORT's GeneralCircularRadial vs banded) and the equal-mass
// comparison presets.
//  - Flux (dev/reports/b3/fluid.json): total disc flux of each model from the GPU records (all crossings, time-averaged),
//    Test_FBdetail camera and emission, 256^2, and its change in the inner band (pixels whose first crossing lies there).
//  - Images (dev/reports/img/b3/, git-ignored): 512^2 viewer frames of both models (same exposure per pair) and of
//    the comparison presets A | B (same exposure per pair, circumferential radius, banded fluid).
// Usage (from dev/): node scripts/b3Images.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openViewer } from './gpuRunner.mjs';
import { decodeRecord } from '../../js/gpu/traceConfig.js';
import { discIntensity } from '../../js/fluid/emission.js';
import { createMetric } from '../../js/metrics/registry.js';
import { createFluid } from '../../js/fluid/generalCircularRadial.js';

const here = dirname(fileURLToPath(import.meta.url));
const img = resolve(here, '../reports/img/b3'), rep = resolve(here, '../reports/b3');
mkdirSync(img, { recursive: true }); mkdirSync(rep, { recursive: true });
const em = { mu: 0, gamma: -1.5, sigma: 2 / 24, redshiftPower: 3, fudge: 1, maxPasses: 0 };
const cam = { r: 250 / 24, theta: 1.5, screen: 150 / 24 };
const v = await openViewer();
const base = v.page.url().replace(/index\.html.*$/, 'index.html');
const rows = [];
const shot = async (q, file, exposure) => {
  await v.page.goto(`${base}?v=2&N=512&play=0&sigmaN=0&${q}${exposure ? `&autoExposure=0&exposure=${exposure}` : ''}`);
  await v.page.waitForFunction(() => window.__foort && /done/.test(document.getElementById('status').textContent), null, { timeout: 600_000 });
  await v.page.waitForTimeout(200);
  const e = await v.page.evaluate(() => Number(document.getElementById('legend').textContent.match(/exposure ([\d.e+-]+)/)?.[1]));
  const url = await v.page.evaluate(() => document.getElementById('view').toDataURL('image/png'));
  writeFileSync(join(img, file), Buffer.from(url.split(',')[1], 'base64'));
  return e;
};
try {
  // flux of the two fluid models
  for (const lambda of [0.05, 5e-3, 1e-3, 1e-4]) {
    const m = createMetric('st3cr', { lambda });
    const rT = /** @type {number} */ (m.terminationRadius?.());
    const bands = createFluid(m, { xi: 1, betaR: 1, betaPhi: 1, model: 'banded', bandRange: { rMin: rT, rMax: 1100 / 24 } }).stableBands ?? [];
    const inner = bands.length > 1 ? bands[0].to : 0;
    const flux = {};
    for (const model of ['foort', 'banded']) {
      const g = await v.trace({ metric: 'st3cr', metricParams: { lambda }, camera: cam, N: 256, maxSteps: 10000, fluid: { xi: 1, betaR: 1, betaPhi: 1, model } });
      let tot = 0, innerFlux = 0;
      for (let k = 0; k < 256 * 256; k++) {
        const d = decodeRecord(g.rec, k, g.tail);
        const I = discIntensity(d.crossings, em, d.tail);
        tot += I;
        if (d.crossings.length && d.crossings[0].r < inner) innerFlux += I;
      }
      flux[model] = { total: tot, firstCrossingInInnerBand: innerFlux };
    }
    const row = { lambda, innerStableBandTo: inner, bands, flux, totalRatio: flux.banded.total / flux.foort.total };
    rows.push(row);
    console.log(`lambda ${lambda}: inner stable band to ${inner.toPrecision(4)} M; flux banded / FOORT ${row.totalRatio.toFixed(4)} (first crossing in the inner band: FOORT ${flux.foort.firstCrossingInInnerBand.toExponential(2)}, banded ${flux.banded.firstCrossingInInnerBand.toExponential(2)} of ${flux.foort.total.toExponential(2)})`);
  }
  writeFileSync(join(rep, 'fluid.json'), JSON.stringify(rows, null, 1));
  // images: both fluid models
  const FB = 'metric=st3cr&r=10.4167&inc=85.9437&screen=6.25&mu=0&gamma=-1.5&sigma=0.0833333&maxSteps=10000&farSteps=0';
  for (const [tag, l] of [['0.05', 0.05], ['5e-3', 0.005], ['1e-3', 0.001], ['1e-4', 0.0001]]) {
    const e = await shot(`${FB}&lambda=${l}&fluidModel=foort`, `fluid_l${tag}_foort.png`);
    await shot(`${FB}&lambda=${l}&fluidModel=banded`, `fluid_l${tag}_banded.png`, e);
    console.log('fluid images', tag);
  }
  // images: comparison presets (as the preset sets them)
  const CMP = 'r=1000&inc=60&screen=16&mu=3&gamma=-1.5&sigma=1&envelope=circumferential&fluidModel=banded';
  for (const [tag, a, b] of [['1', 'metric=kerr&a=0', 'metric=st3cr&lambda=0.005'], ['2', 'metric=kerr&a=0', 'metric=st3cr&bh0=1'], ['3', 'metric=kerr&a=0.5', 'metric=st3cr&lambda=0.05']]) {
    const e = await shot(`${CMP}&${a}`, `compare${tag}_A.png`);
    await shot(`${CMP}&${b}`, `compare${tag}_B.png`, e);
    console.log('compare images', tag);
  }
} finally { await v.close(); }
