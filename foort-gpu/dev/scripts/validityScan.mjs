// Validity scans for the deformation parameters (CHECKPOINT M1):
// for each (a, alpha) the smallest radius r_valid outside which the sampled metric has Lorentzian
// signature, no CTCs (g_phiphi > 0) and finite components. Reported as r_valid / r_+.
// Usage (from dev/): node scripts/validityScan.mjs   -> dev/reports/m1_validity.json + tables on stdout
import { writeFileSync, mkdirSync } from 'node:fs';
import { createJohannsen } from '../../js/metrics/johannsen.js';
import { createMankoNovikov } from '../../js/metrics/mankoNovikov.js';
import { validityRadius } from '../../js/metrics/common.js';

const spins = [0, 0.3, 0.5, 0.7, 0.9, 0.94, 0.99, 0.998];
const fmt = (x) => (x <= 1.00001 ? 'ok' : (x - 1).toExponential(1));
const out = { johannsen: [], mankoNovikov: [] };

function scan(label, create, alphas, key) {
  console.log(`\n${label}: r_valid / r_+ - 1 ("ok" = valid down to 1e-5 above the horizon; 600 r samples log-spaced in r - r_+ from 1e-6 r_+ to 1000, 181 theta)`);
  console.log(['a \\ ' + key, ...alphas.map(String)].join('\t'));
  for (const a of spins) {
    const rh = 1 + Math.sqrt(1 - a * a);
    const row = [];
    for (const al of alphas) {
      const m = create(a, al, rh);
      if (!m) { row.push('—'); continue; }
      const v = validityRadius(m, rh * (1 + 1e-6), 1000, { nr: 600, rRef: rh });
      out[label].push({ a, [key]: al, rValidOverRh: v.rValid / rh, worst: v.worst });
      row.push(fmt(v.rValid / rh) + (v.worst && v.rValid / rh > 1.0000001 ? v.worst[0] : ''));
    }
    console.log([a, ...row].join('\t'));
  }
}

scan('johannsen', (a, al13, rh) => (al13 > -(rh ** 3) ? createJohannsen({ a, alpha13: al13 }) : null),
  [-8, -4, -2, -1, -0.5, 0, 0.5, 1, 2, 5, 10, 30, 100], 'alpha13');
scan('mankoNovikov', (a, al3) => createMankoNovikov({ a, alpha3: al3 }),
  [-2, -1, -0.5, -0.2, -0.1, -0.03, -0.01, 0, 0.01, 0.03, 0.1, 0.2, 0.5, 1, 2], 'alpha3');
console.log('\nsuffix letter = first failure type at r_valid: n = non-finite, s = signature, c = CTC (g_phiphi <= 0)');
mkdirSync('reports', { recursive: true });
writeFileSync('reports/m1_validity.json', JSON.stringify(out, null, 1));
