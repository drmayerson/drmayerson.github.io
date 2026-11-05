// Viewer images for the checkpoints (canvas contents at full record resolution).
// Usage (from dev/): node scripts/m3Screens.mjs [--m4]  -> dev/reports/m3/views/*.png (or m4/views)
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openViewer } from './gpuRunner.mjs';

const m4 = process.argv.includes('--m4'), m5 = process.argv.includes('--m5'), m6 = process.argv.includes('--m6');
const out = resolve(dirname(fileURLToPath(import.meta.url)), m6 ? '../reports/m6/views' : m5 ? '../reports/m5/views' : m4 ? '../reports/m4/views' : '../reports/m3/views');
mkdirSync(out, { recursive: true });
const SHOTS = {
  'fourColor_a0.94_inc17': 'a=0.94&inc=17',
  'fourColor_a0.998_inc80': 'a=0.998&inc=80',
  'sky_faceon_a0': 'a=0&inc=0.01&view=sky',
  'sky_faceon_a0.94': 'a=0.94&inc=0.01&view=sky',
  'sky_a0.94_inc80': 'a=0.94&inc=80&view=sky',
  'g1_a0.94_inc80': 'a=0.94&inc=80&view=g1',
  'passes_a0.94_inc80': 'a=0.94&inc=80&view=passes',
  'steps_a0.94_inc80': 'a=0.94&inc=80&view=steps',
};
const SHOTS_M4 = {
  'fourColor_johannsen_a0.94_a13_5.5': 'metric=johannsen&a=0.94&alpha13=5.5',
  'fourColor_johannsen_a0.5_a13_-5_inc80': 'metric=johannsen&a=0.5&alpha13=-5&inc=80',
  'fourColor_mankoNovikov_a0.94_a3_1_inc30': 'metric=mankoNovikov&a=0.94&alpha3=1&inc=30',
  'sky_mankoNovikov_a0.94_a3_1_inc80': 'metric=mankoNovikov&a=0.94&alpha3=1&inc=80&view=sky',
  'g1_mankoNovikov_a0.94_a3_1_inc80': 'metric=mankoNovikov&a=0.94&alpha3=1&inc=80&view=g1',
  'sky_kerr_tabulated_faceon': 'a=0.94&inc=0.01&view=sky',
};
// M5: disc emission (FOORT presets as URL parameters; afmhot, sqrt tone map, auto exposure)
const SHOTS_M5 = {
  'emission_KerrExample': 'a=0.94&inc=17',
  'emission_kerr_a0.94_inc80': 'a=0.94&inc=80',
  'emission_kerr_a0_inc80': 'a=0&inc=80',
  'emission_JohannsenExample': 'metric=johannsen&a=0.94&alpha13=5.5',
  'emission_Test_MNrun_a3_1': 'metric=mankoNovikov&a=0.94&alpha3=1&inc=30&mu=0.658826&gamma=-1.5',
  'emission_kerr_a0.94_inc80_subkeplerian': 'a=0.94&inc=80&xi=0.5&betaR=0.5&betaPhi=0.5',
  'emission_kerr_a0.94_inc80_log': 'a=0.94&inc=80&toneMap=2&colorMap=1',
  'g1_kerr_a0.94_inc80': 'a=0.94&inc=80&view=g1',
};
// M6: ST3Cr fuzzball (Test_FBdetail camera: r = 250, theta = 1.5, screen 150 in base units = 10.417 / 6.25 M_ADM)
const FB = 'metric=st3cr&r=10.4167&inc=85.9437&screen=6.25&mu=0&gamma=-1.5&sigma=2&maxSteps=10000';
/** @type {Record<string, string>} */
const SHOTS_M6 = {};
for (const [tag, q] of [['0.15', 'lambda=0.15'], ['0.05', 'lambda=0.05'], ['0.01', 'lambda=0.01'], ['0.005', 'lambda=0.005'], ['1e-3', 'lambda=0.001'], ['1e-4', 'lambda=0.0001'], ['0_BH', 'bh0=1']]) {
  SHOTS_M6[`emission_st3cr_l${tag}`] = `${FB}&${q}`;
  SHOTS_M6[`fourColor_st3cr_l${tag}`] = `${FB}&${q}&view=fourColor`;
}
Object.assign(SHOTS_M6, {
  'term_st3cr_l0.005': `${FB}&lambda=0.005&view=term`,
  'steps_st3cr_l0.005': `${FB}&lambda=0.005&view=steps`,
  'g1_st3cr_l0.005': `${FB}&lambda=0.005&view=g1`,
  'emission_st3cr_l0.005_log': `${FB}&lambda=0.005&toneMap=2&colorMap=1`,
  'emission_st3cr_l0.005_faceon': `${FB}&lambda=0.005&inc=2`,
  'emission_st3cr_l0.005_distant': 'metric=st3cr&lambda=0.005&r=1000&inc=17&screen=15&mu=0&gamma=-1.5&sigma=2&maxSteps=10000',
});
// Fuzzball Shadows (arXiv:2103.12075) Fig. 1: equatorial camera at r = 250, four-colour, lambda = 0.19 ... 0.001 and the BH
if (process.argv.includes('--fig1')) {
  for (const k of Object.keys(SHOTS_M6)) delete SHOTS_M6[k];
  const F1 = 'metric=st3cr&r=10.4167&inc=90&screen=4.6&maxSteps=10000&view=fourColor';
  for (const [tag, q] of [['0.19', 'lambda=0.19'], ['0.05', 'lambda=0.05'], ['0.01', 'lambda=0.01'], ['0.001', 'lambda=0.001'], ['BH', 'bh0=1']]) SHOTS_M6[`fig1_fourColor_${tag}`] = `${F1}&${q}`;
}
const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const v = await openViewer();
const base = v.page.url().replace(/index\.html.*$/, 'index.html');
try {
  for (const [name, q] of Object.entries(m6 ? SHOTS_M6 : m5 ? SHOTS_M5 : m4 ? SHOTS_M4 : SHOTS)) {
    if (only.length && !only.includes(name)) continue;
    await v.page.goto(`${base}?N=512&${q}`);
    await v.page.waitForFunction(() => window.__foort && /done/.test(document.getElementById('status').textContent), null, { timeout: 300_000 });
    await v.page.waitForTimeout(100);
    const url = await v.page.evaluate(() => document.getElementById('view').toDataURL('image/png'));
    writeFileSync(join(out, `${name}.png`), Buffer.from(url.split(',')[1], 'base64'));
    console.log(name, await v.page.evaluate(() => document.getElementById('status').textContent));
  }
} finally { await v.close(); }
