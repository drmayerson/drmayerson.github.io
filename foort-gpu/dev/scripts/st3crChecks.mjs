// ST3Cr checks for CHECKPOINT M1 (P = 2, q0 = 50):
//  1. M_ADM and J from the asymptotics g_tt ~ -1 + 2M/r, g_tphi ~ -2 J sin^2(theta) / r
//  2. lambda -> 0: ST3Cr functions vs the ST3Cr BH (lambda = 0) away from the throat
//  3. closed-form inverse vs generic inversion (JS only, all lambdas)
//  4. ST3Cr BH critical impact parameter b_c
// Usage (from dev/): node scripts/st3crChecks.mjs   -> dev/reports/m1_st3cr.json
import { writeFileSync, mkdirSync } from 'node:fs';
import { createST3Cr, st3crMass, st3crLambdaMax } from '../../js/metrics/st3cr.js';
import { createST3CrBH } from '../../js/metrics/st3crBH.js';
import { invertCircular, singularityDistance } from '../../js/metrics/common.js';

const P = 2, q0 = 50;
const M = st3crMass(P, q0);
const report = { P, q0, massFormula: M, lambdaMax: st3crLambdaMax(P, q0) };
console.log(`M_ADM formula (3P + q0 - P^3)/2 = ${M}, lambda_max = ${report.lambdaMax.toPrecision(8)}`);

// 1. asymptotics: Richardson-free estimate at several radii; the 1/r^2 correction shows as drift
report.asymptotics = [];
console.log('\n1. asymptotic mass and angular momentum: M(r) = r (1 + g_tt) / 2, J(r) = -r g_tphi / (2 sin^2 theta)');
for (const lambda of [0.15, 0.05, 0.005, 1e-4, 0]) {
  const m = lambda ? createST3Cr({ P, q0, lambda }) : createST3CrBH({ P, q0 });
  const th = 1.1;
  const rows = [1e3, 1e4, 1e5].map((r) => { const g = m.g_dd(r * M, th); return { r: r * M, M: r * M * (1 + g.gtt) / 2, J: -r * M * g.gtphi / (2 * Math.sin(th) ** 2) }; });
  report.asymptotics.push({ lambda, rows });
  console.log(`lambda = ${lambda}: ` + rows.map((x) => `r = ${x.r.toExponential(0)}: M = ${x.M.toFixed(5)}, J = ${x.J.toPrecision(5)}`).join(' | '));
}

// 2. lambda -> 0 convergence, outside a ball of radius rCut around the origin
const bh = createST3CrBH({ P, q0 });
report.convergence = [];
console.log('\n2. lambda -> 0: max over theta of |Q/Q_BH - 1| and |g_tphi| / sqrt(|g_tt g_phiphi|), at fixed r (units of M_ADM)');
const radii = [0.01, 0.1, 1, 10, 100].map((x) => x * M);
console.log(['lambda', ...radii.map((r) => `r=${(r / M).toString()}M`)].join('\t'));
for (const lambda of [1e-2, 1e-3, 1e-4, 1e-5, 1e-6]) {
  const m = createST3Cr({ P, q0, lambda });
  const cells = radii.map((r) => {
    let dQ = 0, w = 0;
    for (let j = 0; j < 91; j++) {
      const th = Math.PI * (j + 0.5) / 91;
      const { Q, omega } = m.functions(r, th);
      const g = m.g_dd(r, th);
      dQ = Math.max(dQ, Math.abs(Q / bh.Q(r) - 1));
      w = Math.max(w, Math.abs(g.gtphi) / Math.sqrt(Math.abs(g.gtt * g.gphiphi)));
      void omega;
    }
    return { r, dQ, w };
  });
  report.convergence.push({ lambda, cells });
  console.log([lambda, ...cells.map((c) => `${c.dQ.toExponential(1)} / ${c.w.toExponential(1)}`)].join('\t'));
}

// 3. closed-form vs generic inverse (scaled as in the parity report)
report.inverse = [];
console.log('\n3. closed-form g^{mu nu} vs generic inversion (max scaled difference, 20000 points, singularity distance > 1% of min(l/2, R))');
for (const lambda of [0.15, 0.05, 0.005, 1e-4]) {
  const m = createST3Cr({ P, q0, lambda });
  const s = m.singularities(), scale = Math.min(s[0].r, s[2].r);
  let worst = 0, n = 0, seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  while (n < 20000) {
    const r = Math.exp(Math.log(1e-3 * scale) + rnd() * Math.log(1e6 * M / scale)), th = 1e-4 + rnd() * (Math.PI - 2e-4);
    if (singularityDistance(s, r, th) < 0.01 * scale) continue;
    n++;
    const a = m.g_uu(r, th), b = invertCircular(m.g_dd(r, th));
    const d = Math.max(Math.abs(a.gtt / b.gtt - 1), Math.abs(a.gphiphi / b.gphiphi - 1), Math.abs(a.grr / b.grr - 1), Math.abs(a.gthth / b.gthth - 1),
      Math.abs(a.gtphi - b.gtphi) / Math.sqrt(Math.abs(b.gtt * b.gphiphi)));
    worst = Math.max(worst, d);
  }
  report.inverse.push({ lambda, maxScaledDiff: worst });
  console.log(`lambda = ${lambda}: ${worst.toExponential(2)}`);
}

// 4. b_c for the lambda = 0 BH
const bc = bh.criticalImpactParameter();
const L2 = 4 * Math.sqrt(P ** 3 * (q0 - P ** 3));
report.bh = { bc: bc.b, bcOverM: bc.b / M, rPhoton: bc.r, rPhotonOverM: bc.r / M, L2, schwarzschildBc: 3 * Math.sqrt(3) };
console.log(`\n4. ST3Cr BH: b_c = ${bc.b.toFixed(6)} = ${(bc.b / M).toFixed(6)} M_ADM (Schwarzschild: ${(3 * Math.sqrt(3)).toFixed(6)} M), photon sphere at base r = ${bc.r.toFixed(6)} = ${(bc.r / M).toFixed(6)} M_ADM; throat L^2 = ${L2.toFixed(4)}`);
mkdirSync('reports', { recursive: true });
writeFileSync('reports/m1_st3cr.json', JSON.stringify(report, null, 1));
