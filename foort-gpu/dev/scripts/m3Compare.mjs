// Level 2 comparison of a GPU record image with the CPU reference for the same view, and report images.
import { decodeRecord } from '../../js/gpu/traceConfig.js';
import { writePng } from './png.mjs';

const TWO_PI = 2 * Math.PI;
export const quadrantOf = (term, th, ph) => (term !== 2 ? 0 : th < Math.PI / 2 ? (ph < Math.PI ? 1 : 2) : (ph < Math.PI ? 3 : 4));
const angle = (t1, p1, t2, p2) => Math.acos(Math.min(1, Math.max(-1, Math.sin(t1) * Math.sin(t2) * Math.cos(p1 - p2) + Math.cos(t1) * Math.cos(t2))));
/** Johnson-SU envelope (FOORT GLMJohnsonSUEmission) with the KerrExample.cfg parameters. */
export const johnsonSU = (r, mu = 2.02, gamma = -2, sigma = 0.5) => Math.exp(-0.5 * (gamma + Math.asinh((r - mu) / sigma)) ** 2) / Math.sqrt((r - mu) ** 2 + sigma ** 2);
/** Emission proxy for M3 (no fluid model yet): sum over stored crossings of g^3 J(r). */
const intensity = (cr) => cr.reduce((s, c) => s + (c.g > 0 ? c.g ** 3 * johnsonSU(c.r) : 0), 0);
const q = (xs, f) => { if (!xs.length) return NaN; const s = Float64Array.from(xs).sort(); return s[Math.min(s.length - 1, Math.floor(f * s.length))]; };

/**
 * @param {Float32Array} rec   GPU records (16 floats per pixel, k = j N + i)
 * @param {any[]} cpu          CPU results with i, j (cpuPool.traceViewCPU)
 * @param {number} N
 */
export function compareImages(rec, cpu, N) {
  const C = new Array(N * N);
  for (const c of cpu) C[c.j * N + c.i] = c;
  const G = Array.from({ length: N * N }, (_, k) => decodeRecord(rec, k));
  const qG = new Uint8Array(N * N), qC = new Uint8Array(N * N);
  for (let k = 0; k < N * N; k++) { qG[k] = quadrantOf(G[k].term, G[k].theta, G[k].phi); qC[k] = quadrantOf(C[k].term, C[k].theta, C[k].phi); }
  let sameTerm = 0, sameQuad = 0, samePasses = 0, hetero = 0, capG = 0, capC = 0, nanG = 0, timeoutG = 0;
  const ang = [], dr = [], ddt = [], dg = [], angErr = new Float32Array(N * N).fill(NaN);
  let iG = 0, iC = 0, iDiff = 0;
  const mismatch = new Uint8Array(N * N);
  for (let k = 0; k < N * N; k++) {
    const g = G[k], c = C[k];
    if (g.term === c.term) sameTerm++;
    if (g.passes === c.passes) samePasses++;
    if (g.term === 1) capG++;
    if (c.term === 1) capC++;
    if (g.term === 4) nanG++;
    if (g.term === 3) timeoutG++;
    if (qG[k] === qC[k]) sameQuad++;
    else {
      mismatch[k] = 1;
      // is the CPU image itself changing class around this pixel?
      const i = k % N, j = (k - i) / N;
      let het = false;
      for (let dj = -1; dj <= 1 && !het; dj++) for (let di = -1; di <= 1; di++) {
        const ii = i + di, jj = j + dj;
        if (ii >= 0 && jj >= 0 && ii < N && jj < N && qC[jj * N + ii] !== qC[k]) { het = true; break; }
      }
      if (het) hetero++;
    }
    if (g.term === 2 && c.term === 2) { const a = angle(g.theta, g.phi, c.theta, c.phi); ang.push(a); angErr[k] = a; }
    if (g.crossings.length && c.crossings.length) {
      const a = g.crossings[0], b = c.crossings[0];
      dr.push(Math.abs(a.r - b.r) / b.r);
      ddt.push(Math.abs(a.dt - b.dt));
      if (b.g > 0 && a.g > 0) dg.push(Math.abs(a.g - b.g) / b.g);
    }
    const IG = intensity(g.crossings), IC = intensity(c.crossings);
    iG += IG; iC += IC; iDiff += Math.abs(IG - IC);
  }
  const n = N * N;
  return {
    N, pixels: n,
    terminationAgreement: sameTerm / n,
    fourColorAgreement: sameQuad / n, fourColorMismatches: n - sameQuad, mismatchesInHeterogeneousNeighbourhood: hetero,
    passesAgreement: samePasses / n,
    escapeAngle: { median: q(ang, 0.5), p99: q(ang, 0.99), max: ang.length ? Math.max(...ang) : NaN, count: ang.length },
    crossing1: { relR: { median: q(dr, 0.5), p99: q(dr, 0.99) }, absDt: { median: q(ddt, 0.5), p99: q(ddt, 0.99) }, relG: { median: q(dg, 0.5), p99: q(dg, 0.99) }, count: dr.length },
    shadow: { capturedGPU: capG, capturedCPU: capC, radiusRatio: Math.sqrt(capG / capC) },
    emissionProxyRelL1: iC > 0 ? iDiff / iC : NaN,
    nanGPU: nanG, timeoutGPU: timeoutG,
    _maps: { qG, qC, mismatch, angErr },
  };
}

const COLORS = [[0, 0, 0], [228, 74, 64], [64, 156, 228], [240, 200, 60], [90, 190, 110]];

/** Four panels: GPU four-colour | CPU four-colour | mismatches | escape-direction error (log10, 1e-7 .. 1e-1 rad). */
export function writeComparisonPng(file, cmp) {
  const { N } = cmp, { qG, qC, mismatch, angErr } = cmp._maps;
  const gap = 4, W = 4 * N + 3 * gap;
  writePng(file, W, N, (x, y) => {
    const panel = Math.floor(x / (N + gap)), i = x - panel * (N + gap);
    if (i >= N) return [255, 255, 255];
    const k = (N - 1 - y) * N + i;
    if (panel === 0) return COLORS[qG[k]];
    if (panel === 1) return COLORS[qC[k]];
    if (panel === 2) {
      if (mismatch[k]) return [220, 0, 0];
      const i2 = i < N - 1 ? k + 1 : k, j2 = y < N - 1 ? k - N : k;
      return qC[k] !== qC[i2] || (j2 >= 0 && qC[k] !== qC[j2]) ? [170, 170, 170] : [255, 255, 255];
    }
    const e = angErr[k];
    if (!Number.isFinite(e)) return [40, 40, 40];
    const t = Math.min(1, Math.max(0, (Math.log10(Math.max(e, 1e-9)) + 7) / 6));
    return [Math.round(255 * Math.min(1, 2 * t)), Math.round(255 * Math.max(0, 2 * t - 1)), Math.round(80 * (1 - t))];
  });
}

/** Strip the per-pixel maps for JSON. */
export const summary = (cmp) => { const { _maps, ...rest } = cmp; return rest; };
export { TWO_PI };
