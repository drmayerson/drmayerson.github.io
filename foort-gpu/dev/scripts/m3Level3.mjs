// M3 Level 3: analytic checks of the GPU tracer (analytic Kerr shader).
//   shadow   Schwarzschild shadow radius seen by a static camera at r = 1000
//   capture  per-pixel capture vs the exact radial-potential test from (lambda, eta) (Bardeen critical curve)
//   lens     escape directions vs kerrCore (zwart-gat-camera's analytic map, double port), distant camera
//   faceon   face-on views: no NaN, constraint drift, no seam along the alpha = 0 column
// Usage (from dev/): node scripts/m3Level3.mjs [shadow capture lens faceon]  -> dev/reports/m3/level3.json
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openViewer } from './gpuRunner.mjs';
import { traceViewCPU } from './cpuPool.mjs';
import { decodeRecord, normalizeView } from '../../js/gpu/traceConfig.js';
import { createMetric } from '../../js/metrics/registry.js';
import { inverseMetric, toMat4 } from '../../js/metrics/common.js';
import { TetradCamera } from '../../js/camera/tetradCamera.js';
import { capturedAnalytic, conserved, kerrCore } from './kerrAnalytic.mjs';
import { writePng } from './png.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, '../reports/m3');
const DEG = Math.PI / 180;
const angle = (t1, p1, t2, p2) => Math.acos(Math.min(1, Math.max(-1, Math.sin(t1) * Math.sin(t2) * Math.cos(p1 - p2) + Math.cos(t1) * Math.cos(t2))));
const q = (xs, f) => { if (!xs.length) return NaN; const s = Float64Array.from(xs).sort(); return s[Math.min(s.length - 1, Math.floor(f * s.length))]; };
const e = (x) => (Number.isFinite(x) ? x.toExponential(2) : '—');

/** Camera (double) and per-pixel initial covariant momentum, same mesh as the GPU ('centers'). */
function pixelMomenta(view) {
  const v = normalizeView(view);
  const m = createMetric(v.metric, v.metricParams);
  const { r, theta } = v.camera;
  const cam = TetradCamera.fromStaticObserver(toMat4(m.g_dd(r, theta)), toMat4(inverseMetric(m)(r, theta)), [0, r, theta, 0]);
  return (i, j) => {
    const alpha = (v.camera.cx ?? 0) + v.camera.screen * ((i + 0.5) / v.N - 0.5);
    const beta = (v.camera.cy ?? 0) + v.camera.screen * ((j + 0.5) / v.N - 0.5);
    return { alpha, beta, down: cam.initialMomentum(alpha, beta).down };
  };
}

async function shadow(viewer) {
  // static camera at r: sin(psi) = b_c sqrt(1 - 2/r) / r; FOORT screen coordinate alpha = r tan(psi)
  const r = 1000, N = 1024, screen = 12;
  const g = await viewer.trace({ metric: 'kerr', metricParams: { a: 0 }, camera: { r, theta: Math.PI / 2, screen }, N });
  let n = 0;
  for (let k = 0; k < N * N; k++) if (decodeRecord(g.rec, k).term === 1) n++;
  const pix = screen / N;
  const rGPU = Math.sqrt(n * pix * pix / Math.PI);
  const rExact = r * Math.tan(Math.asin(3 * Math.sqrt(3) * Math.sqrt(1 - 2 / r) / r));
  const out = { N, screen, captured: n, radiusGPU: rGPU, radiusExact: rExact, relErr: rGPU / rExact - 1, pixelRel: pix / rExact };
  console.log(`shadow: GPU equivalent radius ${rGPU.toFixed(5)} vs exact ${rExact.toFixed(5)}: rel ${e(out.relErr)} (pixel/radius ${e(out.pixelRel)})`);
  return out;
}

async function capture(viewer) {
  const res = [];
  for (const [a, inc] of [[0.5, 17], [0.94, 17], [0.998, 17], [0.94, 80], [0.998, 80]]) {
    const N = 512;
    const view = { metric: 'kerr', metricParams: { a }, camera: { r: 1000, theta: inc * DEG, screen: 12 }, N };
    const g = await viewer.trace(view);
    const mom = pixelMomenta(view);
    const th = view.camera.theta;
    const an = new Uint8Array(N * N), gp = new Uint8Array(N * N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const { lam, eta } = conserved(a, th, mom(i, j).down);
      an[j * N + i] = capturedAnalytic(a, lam, eta) ? 1 : 0;
      gp[j * N + i] = decodeRecord(g.rec, j * N + i).term === 1 ? 1 : 0;
    }
    let nA = 0, nG = 0, mis = 0, maxDist = 0;
    const edge = (k) => { const i = k % N, j = (k - i) / N; for (let d = 1; d < 50; d++) for (let dj = -d; dj <= d; dj++) for (let di = -d; di <= d; di++) { const ii = i + di, jj = j + dj; if (ii >= 0 && jj >= 0 && ii < N && jj < N && an[jj * N + ii] !== an[k]) return d; } return 50; };
    for (let k = 0; k < N * N; k++) {
      nA += an[k]; nG += gp[k];
      if (an[k] !== gp[k]) { mis++; maxDist = Math.max(maxDist, edge(k)); }
    }
    const row = { a, inc, N, screen: 12, capturedAnalytic: nA, capturedGPU: nG, mismatches: mis, maxMismatchDistancePx: maxDist, radiusRatio: Math.sqrt(nG / nA) };
    console.log(`capture a=${a} inc=${inc}: ${mis} mismatched px (max ${maxDist} px from the analytic edge), shadow radius ratio GPU/analytic ${row.radiusRatio.toFixed(5)}`);
    writePng(join(outDir, `capture_a${a}_inc${inc}.png`), N, N, (x, y) => {
      const k = (N - 1 - y) * N + x;
      if (an[k] !== gp[k]) return [230, 0, 0];
      return an[k] ? [0, 0, 0] : [235, 235, 235];
    });
    res.push(row);
  }
  return res;
}

async function lens(viewer) {
  // a distant camera so that the asymptotic kerrCore map applies (residual ~ b / r_cam)
  const res = [];
  for (const [a, inc] of [[0.5, 17], [0.94, 17], [0.94, 80], [0.998, 80]]) {
    const N = 128, r = 1e5;
    const view = { metric: 'kerr', metricParams: { a }, camera: { r, theta: inc * DEG, screen: 15 }, N, rBoundary: 1e8, maxSteps: 20000 };
    const g = await viewer.trace(view);
    const mom = pixelMomenta(view);
    const th = view.camera.theta, cth = Math.cos(th), sth = Math.sin(th);
    const dG = [], pixels = [], ref = [];
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const G = decodeRecord(g.rec, j * N + i);
      if (G.term !== 2) continue;
      const { down } = mom(i, j);
      const { lam, eta } = conserved(a, th, down);
      const al = -lam / sth;
      const be2 = eta + a * a * cth * cth - lam * lam * cth * cth / (sth * sth);
      const be = -Math.sign(down[2]) * Math.sqrt(Math.max(be2, 0));
      if (Math.abs(be) < 1e-3 || Math.abs(lam) < 1e-3) continue;      // kerrCore's measure-zero lines
      const k = kerrCore(al, be, a, cth, sth);
      if (!k) continue;
      const ts = Math.acos(Math.max(-1, Math.min(1, k.cths))), ps = k.phs;
      dG.push(angle(G.theta, G.phi, ts, ps));
      if ((i + 3 * j) % 17 === 0) { pixels.push([i, j]); ref.push([ts, ps]); }
    }
    const cpu = await traceViewCPU(view, pixels);
    const byKey = new Map(cpu.map((c) => [`${c.i},${c.j}`, c]));
    const dC = pixels.map(([i, j], n) => { const c = byKey.get(`${i},${j}`); return c.term === 2 ? angle(c.theta, c.phi, ref[n][0], ref[n][1]) : NaN; }).filter(Number.isFinite);
    const row = { a, inc, rCam: r, N, escapes: dG.length, gpu: { median: q(dG, 0.5), p99: q(dG, 0.99), max: Math.max(...dG) }, cpuSample: { n: dC.length, median: q(dC, 0.5), p99: q(dC, 0.99), max: Math.max(...dC) } };
    console.log(`lens a=${a} inc=${inc}: GPU vs kerrCore ${e(row.gpu.median)}/${e(row.gpu.p99)}/${e(row.gpu.max)} rad (${dG.length} rays); CPU ref vs kerrCore ${e(row.cpuSample.median)}/${e(row.cpuSample.p99)}/${e(row.cpuSample.max)} (${dC.length})`);
    res.push(row);
  }
  return res;
}

async function faceon(viewer) {
  const res = [];
  for (const a of [0, 0.94]) {
    const N = 256;
    const view = { metric: 'kerr', metricParams: { a }, camera: { r: 1000, theta: 0.01 * DEG, screen: 15 }, N, storeH: true, maxSteps: 20000 };
    const g = await viewer.trace(view);
    let nan = 0, timeout = 0, hMax = 0;
    const hs = [];
    for (let k = 0; k < N * N; k++) {
      const G = decodeRecord(g.rec, k);
      if (G.term === 4) nan++;
      if (G.term === 3) timeout++;
      const h = g.rec[16 * k + 12];
      if (G.term === 2) { hs.push(h); hMax = Math.max(hMax, h); }
    }
    // seam test: escape directions on the alpha = 0 column vs CPU, compared with the rest of the image
    const cols = [N / 2 - 1, N / 2, N / 4];
    const pixels = [];
    for (const i of cols) for (let j = 0; j < N; j += 2) pixels.push([i, j]);
    const cpu = await traceViewCPU({ ...view, storeH: false }, pixels);
    const errs = { centre: [], quarter: [] };
    for (const c of cpu) {
      const G = decodeRecord(g.rec, c.j * N + c.i);
      if (G.term === 2 && c.term === 2) (c.i === N / 4 ? errs.quarter : errs.centre).push(angle(G.theta, G.phi, c.theta, c.phi));
    }
    const row = { a, N, nan, timeout, escapedHrel: { median: q(hs, 0.5), p99: q(hs, 0.99), max: hMax },
      escapeErrCentreColumns: { median: q(errs.centre, 0.5), max: Math.max(...errs.centre) }, escapeErrQuarterColumn: { median: q(errs.quarter, 0.5), max: Math.max(...errs.quarter) } };
    console.log(`faceon a=${a}: NaN ${nan}, timeouts ${timeout}, |H|rel median/p99/max ${e(row.escapedHrel.median)}/${e(row.escapedHrel.p99)}/${e(hMax)}; ` +
      `escape-direction error vs CPU: centre columns ${e(row.escapeErrCentreColumns.median)}/${e(row.escapeErrCentreColumns.max)}, quarter column ${e(row.escapeErrQuarterColumn.median)}/${e(row.escapeErrQuarterColumn.max)}`);
    res.push(row);
  }
  return res;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const which = process.argv.slice(2);
  const all = { shadow, capture, lens, faceon };
  mkdirSync(outDir, { recursive: true });
  const file = join(outDir, 'level3.json');
  const report = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  const viewer = await openViewer();
  report.renderer = viewer.renderer;
  try {
    for (const [k, f] of Object.entries(all)) if (!which.length || which.includes(k)) report[k] = await f(viewer);
  } finally { await viewer.close(); }
  writeFileSync(file, JSON.stringify(report, null, 1));
}
