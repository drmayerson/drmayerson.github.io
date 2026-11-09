// Stage 1B B6: one table of every quality-gate run in dev/reports/b6 (gate_<config>.json) against the Normal budgets
// (plan 1.2), with two rules made explicit:
//  - sky position: "no worse than High" (median and p99 px, per scene, +10% and +0.01 px slack for run-to-run noise);
//  - the fuzzball's termination-class agreement and chaotic-region class fractions are dominated by High's own max-steps
//    trade (5000 vs Reference's 10000, accepted in Stage 1): there a candidate passes if it is within budget or no
//    worse than High by more than 0.1 percentage point (class agreement) / 1 point (fractions).
// Usage (from dev/): node scripts/b6Summary.mjs  -> dev/reports/b6/summary.md and summary.json
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = resolve(dirname(fileURLToPath(import.meta.url)), '../reports/b6');
const load = (c) => JSON.parse(readFileSync(join(dir, `gate_${c}.json`), 'utf8'));
if (!existsSync(join(dir, 'gate_high.json'))) throw new Error('gate_high.json missing');
const high = load('high');
const H = Object.fromEntries(high.rows.map((r) => [r.scene, r]));
const configs = readdirSync(dir).filter((f) => /^gate_.*\.json$/.test(f)).map((f) => f.slice(5, -5)).sort();
const out = [];
for (const c of configs) {
  const g = load(c);
  const scenes = g.rows.map((r) => {
    const h = H[r.scene];
    const fuzz = r.scene.startsWith('st3cr');
    const fails = Object.entries(r.budget).filter(([, ok]) => !ok).map(([k]) => k).filter((k) => {
      if (!fuzz || !h) return true;
      if (k === 'classAgreement') return r.classAgreement < Math.min(0.998, h.classAgreement - 0.001);
      if (k === 'chaoticFractions') return r.chaotic.maxClassFractionDiff > Math.max(0.01, h.chaotic.maxClassFractionDiff + 0.01);
      return true;
    });
    if (h && Number.isFinite(r.sky.medianPx) && Number.isFinite(h.sky.medianPx)) {
      if (r.sky.medianPx > 1.1 * h.sky.medianPx + 0.01 || r.sky.p99Px > 1.1 * h.sky.p99Px + 0.01) fails.push('sky');
    }
    return { scene: r.scene, fails, speedup: r.speed?.speedup ?? null, emissionL1: Math.max(...r.emission.map((e) => e.relL1)), p99: Math.max(...r.emission.map((e) => e.relP99 || 0)),
      flux: Math.max(...r.emission.map((e) => Math.abs(e.fluxRel))), skyP99: r.sky.p99Px, highSkyP99: h?.sky.p99Px ?? null, dt: r.dtP99M, cls: r.classAgreement };
  });
  const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
  const geo = (xs) => (xs.length ? Math.exp(mean(xs.map(Math.log))) : NaN);
  const bh = scenes.filter((s) => !s.scene.startsWith('st3cr') && s.speedup), fz = scenes.filter((s) => s.scene.startsWith('st3cr') && s.speedup);
  // speed against High: the gate times each config against Reference; divide by High's speed-up on the same scene
  const vsHigh = (ss) => geo(ss.map((s) => s.speedup / (H[s.scene]?.speed?.speedup ?? NaN)).filter(Number.isFinite));
  out.push({ config: c, description: g.description, pass: scenes.every((s) => !s.fails.length), failing: scenes.filter((s) => s.fails.length).map((s) => `${s.scene}: ${s.fails.join(', ')}`),
    speedupVsReference: { BH: geo(bh.map((s) => s.speedup)), fuzzball: geo(fz.map((s) => s.speedup)) }, speedupVsHigh: { BH: vsHigh(bh), fuzzball: vsHigh(fz) }, scenes });
}
writeFileSync(join(dir, 'summary.json'), JSON.stringify(out, null, 1));
const f = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '—');
const e = (x) => (Number.isFinite(x) ? x.toExponential(1) : '—');
const md = ['# Stage 1B B6: Normal-tier candidates, quality gate (512², vs Reference)', '',
  'Speed-ups are geometric means over the scenes (BH: 8 scenes, fuzzball: 5), A/B/A/B best of 3; "vs High" divides by High\'s speed-up on the same scene.',
  'Budgets: plan 1.2; the sky budget is "no worse than High"; for the fuzzball the class agreement and the chaotic class fractions are judged against High (its 5000-step limit dominates them).', '',
  '| config | passes | BH vs High | fuzzball vs High | worst emission L1 | worst p99 | worst flux | worst sky p99 (px) | failing |',
  '|---|---|---|---|---|---|---|---|---|',
  ...out.map((o) => `| ${o.config} | ${o.pass ? 'yes' : 'no'} | ${f(o.speedupVsHigh.BH)}× | ${f(o.speedupVsHigh.fuzzball)}× | ${e(Math.max(...o.scenes.map((s) => s.emissionL1)))} | ${e(Math.max(...o.scenes.map((s) => s.p99)))} | ${e(Math.max(...o.scenes.map((s) => s.flux)))} | ${e(Math.max(...o.scenes.map((s) => s.skyP99 ?? 0)))} | ${o.failing.join('; ') || '—'} |`)].join('\n');
writeFileSync(join(dir, 'summary.md'), md + '\n');
console.log(md);
