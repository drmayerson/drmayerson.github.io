// @ts-check
// Shared, backend-independent setup for the M0 benchmark: parameters -> camera -> uniforms,
// plus the comparison statistics. DOM-free.
import { TetradCamera } from '../js/camera/tetradCamera.js';
import { kerrGdd, kerrGuu, kerrHorizon } from './kerr.js';

/**
 * @typedef {Object} BenchParams
 * @property {number} a          spin
 * @property {number} rCam       camera radius (M)
 * @property {number} thetaCam   camera inclination (rad)
 * @property {number} screen     screen size (alpha and beta extent, M)
 * @property {number} eps        FOORT step parameter
 * @property {number} hmin       FOORT SmallestPossibleStepsize
 * @property {number} epsHorizon FOORT Epsilon_Horizon
 * @property {number} maxSteps
 * @property {number} tile       tile edge in pixels
 */

/** Defaults from FOORT/cfgs/KerrExample.cfg (boundary 1.01 r_cam per plan Section 3.7). */
export const DEFAULTS = /** @type {BenchParams} */ ({
  a: 0.94, rCam: 1000, thetaCam: 0.2967, screen: 15, eps: 0.03, hmin: 1e-12,
  epsHorizon: 0.01, maxSteps: 5000, tile: 256,
});

/**
 * @typedef {Object} BenchUniforms
 * @property {Float32Array} E       vielbein, column-major
 * @property {Float32Array} G       g_dd at camera, column-major (symmetric)
 * @property {number[]} screen      [cx, cy, sx, sy]
 * @property {number[]} p0          [a, r_h, r_cam, theta_cam]
 * @property {number[]} p1          [eps, hmin, epsHorizon, rBoundary]
 * @property {number} maxSteps
 * @property {string[]} warnings
 */

/** @param {BenchParams} p @returns {BenchUniforms} */
export function buildUniforms(p) {
  const pos = [0, p.rCam, p.thetaCam, 0];
  const gdd = kerrGdd(p.a, p.rCam, p.thetaCam);
  const cam = TetradCamera.fromStaticObserver(gdd, kerrGuu(p.a, p.rCam, p.thetaCam), pos);
  const G = new Float32Array(16);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) G[4 * j + i] = gdd[i][j];
  return {
    E: cam.vielbeinColumnMajor(),
    G,
    screen: [0, 0, p.screen, p.screen],
    p0: [p.a, kerrHorizon(p.a), p.rCam, p.thetaCam],
    p1: [p.eps, p.hmin, p.epsHorizon, 1.01 * p.rCam],
    maxSteps: p.maxSteps,
    warnings: cam.warnings,
  };
}

/**
 * Tiles covering an N x N image, row-major.
 * @param {number} N @param {number} tile
 */
export function tiles(N, tile) {
  const out = [];
  for (let y = 0; y < N; y += tile) for (let x = 0; x < N; x += tile)
    out.push({ x, y, w: Math.min(tile, N - x), h: Math.min(tile, N - y) });
  return out;
}

/** FOORT FourColorScreen quadrant (Diagnostics.cpp); 0 if the ray did not escape. */
export function quadrant(code, theta, phi) {
  if (code !== 2) return 0;
  if (theta < Math.PI / 2) return phi < Math.PI ? 1 : 2;
  return phi < Math.PI ? 3 : 4;
}

/** @param {Float32Array} rec  N*N*4 records */
export function totalSteps(rec) {
  let s = 0;
  for (let i = 1; i < rec.length; i += 4) s += rec[i];
  return s;
}

/** @param {Float32Array} rec */
export function codeCounts(rec) {
  const c = [0, 0, 0, 0, 0];
  for (let i = 0; i < rec.length; i += 4) c[rec[i] | 0]++;
  return { horizon: c[1], escape: c[2], timeout: c[3], nan: c[4] };
}

/**
 * Compare two record arrays of the same size.
 * @param {Float32Array} A @param {Float32Array} B
 */
export function compareRecords(A, B) {
  const n = A.length / 4;
  let sameCode = 0, sameQuad = 0, bothEsc = 0, stepAbs = 0;
  const ang = [];
  const mismatch = new Uint8Array(n);
  for (let k = 0; k < n; k++) {
    const i = 4 * k;
    const ca = A[i], cb = B[i];
    stepAbs += Math.abs(A[i + 1] - B[i + 1]);
    const qa = quadrant(ca, A[i + 2], A[i + 3]), qb = quadrant(cb, B[i + 2], B[i + 3]);
    if (ca === cb) sameCode++;
    if (qa === qb) sameQuad++; else mismatch[k] = 1;
    if (ca === 2 && cb === 2) {
      bothEsc++;
      const t1 = A[i + 2], p1 = A[i + 3], t2 = B[i + 2], p2 = B[i + 3];
      const c = Math.sin(t1) * Math.sin(t2) * Math.cos(p1 - p2) + Math.cos(t1) * Math.cos(t2);
      ang.push(Math.acos(Math.min(1, Math.max(-1, c))));
    }
  }
  ang.sort((x, y) => x - y);
  const q = (/** @type {number} */ f) => (ang.length ? ang[Math.min(ang.length - 1, Math.floor(f * ang.length))] : NaN);
  return {
    pixels: n,
    codeAgreement: sameCode / n,
    fourColorAgreement: sameQuad / n,
    fourColorMismatches: n - sameQuad,
    bothEscaped: bothEsc,
    escapeAngleMedian: q(0.5),
    escapeAngleP99: q(0.99),
    escapeAngleMax: ang.length ? ang[ang.length - 1] : NaN,
    meanAbsStepDiff: stepAbs / n,
    mismatch,
  };
}

/** @param {number[]} xs */
export const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : 0.5 * (s[s.length / 2 - 1] + s[s.length / 2])) : NaN;
};
