import { describe, it, expect } from 'vitest';
import { gpuTraceSetup, cpuTraceOptions, decodeRecord } from '../../../js/gpu/traceConfig.js';
import { tilesCentreOut } from '../../../js/gpu/pipeline.js';
import { prepareImage, TERM } from '../../../js/ref/cpuTracer.js';
import { capturedAnalytic, conserved, kerrCore, RF } from '../../scripts/kerrAnalytic.mjs';
import { compEllint1 } from '../../../js/metrics/common.js';

const DEG = Math.PI / 180;
const angle = (t1, p1, t2, p2) => Math.acos(Math.min(1, Math.sin(t1) * Math.sin(t2) * Math.cos(p1 - p2) + Math.cos(t1) * Math.cos(t2)));

describe('trace configuration', () => {
  const view = { metric: 'kerr', metricParams: { a: 0.94 }, camera: { r: 1000, theta: 0.2967, screen: 15 }, N: 64 };
  it('GPU uniforms and CPU options describe the same rays', () => {
    const g = gpuTraceSetup(view), c = cpuTraceOptions(view);
    const rh = 1 + Math.sqrt(1 - 0.94 ** 2);
    expect(g.program).toBe('trace_kerr_analytic');
    expect(g.uniforms.uStep[1][2]).toBeCloseTo(1.01 * rh, 12);
    expect(c.options.rTerm).toBeCloseTo(1.01 * rh, 12);
    expect(g.uniforms.uStep[1][3]).toBe(1010);
    expect(c.options.rBoundary).toBe(1010);
    expect(g.uniforms.uCam[1][3]).toBeCloseTo(Math.log(1000 - rh), 12);
    expect(g.uniforms.uAux[1][1]).toBe(c.options.axisStepFloor);
  });
  it('rejects metrics without a GPU tracer yet', () => {
    expect(() => gpuTraceSetup({ ...view, metric: 'johannsen', metricParams: {} })).toThrow(/M4/);
  });
  it('decodes the record layout', () => {
    const rec = new Float32Array(32);
    rec.set([2 + 16 * 2, 700, 1.2, 3.4, 6, 1, -1000, 0.8, 9, 2, -1010, 0.5, 0, 0, 0, 0], 16);
    const d = decodeRecord(rec, 1);
    expect(d).toMatchObject({ term: 2, passes: 2, steps: 700 });
    expect(d.crossings).toHaveLength(2);
    expect(d.crossings[1]).toMatchObject({ r: 9, g: 0.5 });
  });
  it('tiles cover the image exactly once, centre first', () => {
    const t = tilesCentreOut(1000, 1000, 256);
    expect(t.reduce((s, r) => s + r.w * r.h, 0)).toBe(1e6);
    const c = t[0];
    expect(c.x <= 500 && c.x + c.w >= 500 && c.y <= 500 && c.y + c.h >= 500).toBe(true);
  });
});

describe('analytic Kerr references (dev/scripts/kerrAnalytic.mjs)', () => {
  it('Carlson R_F reproduces K(k)', () => {
    for (const k of [0.1, 0.5, 0.9]) expect(RF(0, 1 - k * k, 1)).toBeCloseTo(compEllint1(k), 10);
  });
  it('capture test from (lambda, eta) agrees with the CPU tracer away from the edge', () => {
    for (const [a, th] of [[0, 1.4], [0.94, 0.3], [0.998, 1.4]]) {
      const view = { metric: 'kerr', metricParams: { a }, camera: { r: 1000, theta: th, screen: 15 }, N: 16, maxSteps: 50000 };
      const { metric, options } = cpuTraceOptions(view);
      const img = prepareImage(metric, options);
      let agree = 0, n = 0;
      for (let i = 0; i < 16; i += 3) for (let j = 0; j < 16; j += 3) {
        const alpha = 15 * ((i + 0.5) / 16 - 0.5), beta = 15 * ((j + 0.5) / 16 - 0.5);
        const { down } = img.camera.initialMomentum(alpha, beta);
        const { lam, eta } = conserved(a, th, down);
        const res = img.tracePixel(i, j);
        n++;
        if (capturedAnalytic(a, lam, eta) === (res.term === TERM.horizon)) agree++;
      }
      expect(agree).toBe(n);
    }
  });
  it('kerrCore escape directions agree with the CPU tracer for a distant camera', () => {
    const a = 0.94, th = 60 * DEG, r = 1e5;
    const view = { metric: 'kerr', metricParams: { a }, camera: { r, theta: th, screen: 30 }, N: 8, rBoundary: 1e8, eps: 0.003, maxSteps: 200000 };
    const { metric, options } = cpuTraceOptions(view);
    const img = prepareImage(metric, options);
    for (const [i, j] of [[0, 0], [7, 2], [1, 6], [6, 7]]) {
      const alpha = 30 * ((i + 0.5) / 8 - 0.5), beta = 30 * ((j + 0.5) / 8 - 0.5);
      const { down } = img.camera.initialMomentum(alpha, beta);
      const { lam, eta } = conserved(a, th, down);
      const be = -Math.sign(down[2]) * Math.sqrt(eta + a * a * Math.cos(th) ** 2 - lam * lam / Math.tan(th) ** 2);
      const k = kerrCore(-lam / Math.sin(th), be, a, Math.cos(th), Math.sin(th));
      const res = img.tracePixel(i, j);
      expect(res.term).toBe(TERM.boundary);
      expect(k).not.toBeNull();
      // residual ~ b / r_cam from the finite camera distance
      expect(angle(res.theta, res.phi, Math.acos(k.cths), k.phs)).toBeLessThan(5e-4);
    }
  });
});
