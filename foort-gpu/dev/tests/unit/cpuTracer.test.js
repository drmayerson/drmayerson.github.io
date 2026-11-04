import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CASES } from '../../scripts/foortCases.mjs';
import { traceOptions } from '../../scripts/runCpuRef.mjs';
import { prepareImage, fourColorQuadrant, TERM } from '../../../js/ref/cpuTracer.js';
import { createKerr } from '../../../js/metrics/kerr.js';
import { createST3CrBH } from '../../../js/metrics/st3crBH.js';

const golden = (name) => fileURLToPath(new URL(`../golden/foort_images/${name}.json`, import.meta.url));
const angle = (t1, p1, t2, p2) => Math.acos(Math.min(1, Math.sin(t1) * Math.sin(t2) * Math.cos(p1 - p2) + Math.cos(t1) * Math.cos(t2)));

describe('Level 1: CPU reference (FOORT parity mode) vs FOORT golden pixels', () => {
  for (const c of CASES) {
    const f = golden(c.name);
    // ST3Cr rays cost ~2 s each in double precision: only a few golden pixels
    it(c.name, { timeout: 120_000 }, () => {
      if (!existsSync(f)) return; // regenerate with scripts/runFoort.mjs + scripts/makeGolden.mjs
      const g = JSON.parse(readFileSync(f, 'utf8'));
      const opts = traceOptions(c, 'parity');
      const { tracePixel } = prepareImage(opts.metric, opts);
      let agree = 0;
      for (const p of g.pixels) {
        const r = tracePixel(p.i, p.j);
        const ok = fourColorQuadrant(r) === p.quadrant && r.passes === Math.abs(p.passes)
          && (p.quadrant === 0 || angle(r.theta, r.phi, p.theta, p.phi) < 1e-3);
        if (ok) agree++;
      }
      expect(agree / g.pixels.length).toBeGreaterThanOrEqual(c.name.startsWith('st3cr') ? 0.8 : 0.95);
    });
  }
});

describe('Level 3 analytic checks of the CPU reference', () => {
  it('Schwarzschild critical impact parameter 3 sqrt(3) from the capture edge', () => {
    const N = 2001, r = 1000;
    const { tracePixel } = prepareImage(createKerr({ a: 0 }), { N, camera: { r, theta: Math.PI / 2, screen: 15 }, maxSteps: 100000, rTerm: 2.02, rBoundary: 1010 });
    let lo = 1000, hi = N - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (tracePixel(mid, 1000).term === TERM.horizon) lo = mid; else hi = mid; }
    const alpha = 15 * ((lo + hi + 1) / 2 / N - 0.5);
    const b = r * Math.sin(Math.atan(alpha / r)) / Math.sqrt(1 - 2 / r);
    expect(Math.abs(b / (3 * Math.sqrt(3)) - 1)).toBeLessThan(15 / N / 5);
  });
  it('ST3Cr BH (lambda = 0) shadow edge at b_c', () => {
    const m = createST3CrBH({ P: 2, q0: 50 });
    const r = 2500, N = 1001; // camera at 104 M_ADM
    const bc = m.criticalImpactParameter().b;
    const screen = 3 * bc;
    const { tracePixel } = prepareImage(m, { N, radial: 'log', camera: { r, theta: Math.PI / 2, screen }, maxSteps: 100000, rTerm: 1e-3, rBoundary: 1.01 * r });
    let lo = 500, hi = N - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (tracePixel(mid, 500).term !== TERM.boundary) lo = mid; else hi = mid; }
    const alpha = screen * ((lo + hi + 1) / 2 / N - 0.5);
    // b = (angle) x (r sqrt(-g_phiphi/g_tt) at the camera)/(r): local static frame, sin(psi) = b / (r sqrt(Q(r)))
    const b = r * Math.sqrt(m.Q(r)) * Math.sin(Math.atan(alpha / r));
    expect(Math.abs(b / bc - 1)).toBeLessThan(screen / N / bc);
  });
  it('axis reflection: face-on Schwarzschild rays through the pole keep the null constraint', () => {
    const { tracePixel } = prepareImage(createKerr({ a: 0 }), { N: 64, camera: { r: 1000, theta: 1e-3, screen: 30 }, maxSteps: 100000, rTerm: 2.02, rBoundary: 1010 });
    for (const [i, j] of [[10, 32], [32, 10], [50, 40], [5, 60]]) {
      const res = tracePixel(i, j);
      expect(res.term).toBe(TERM.boundary);
      expect(res.hamiltonian).toBeLessThan(1e-6);
      expect(res.theta).toBeGreaterThanOrEqual(0);
      expect(res.theta).toBeLessThanOrEqual(Math.PI);
    }
  });
});
