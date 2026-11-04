// @ts-check
// Double-precision CPU reference tracer (plan M2). Same algorithm as the GPU tracer:
// Hamiltonian in (t, x, theta, phi), conserved p_t (= 1, past-pointing, FOORT convention) and p_phi,
// RK4 with FOORT's adaptive step, terminations, axis handling and equatorial crossings.
// The metric is evaluated directly (no tables); r- and theta-derivatives of the inverse metric
// are 4th-order central finite differences in double. DOM-free, runs in node and in the browser.
//
// The five functions are those the GPU tables will hold (plan Section 3.4):
//   G0 = g^tt, G1 = g^tphi, G2 = sin^2(theta) g^phiphi, G3 = g^xx, G4 = g^thth,
// with x = log(r - r0) (r0 = horizon radius for 'logShifted', 0 for 'log').
import { TetradCamera } from '../camera/tetradCamera.js';
import { inverseMetric, toMat4, singularityDistance } from '../metrics/common.js';

/** Closest approach to the axis at which the metric functions are evaluated. */
const AXIS_EPS = 1e-9;

/** Termination codes (shared with the GPU record). */
export const TERM = { horizon: 1, boundary: 2, timeout: 3, nan: 4, thetaSing: 5, singularity: 6 };

/**
 * @typedef {Object} TraceOptions
 * @property {number} N                         pixels per side
 * @property {'centers'|'foort'} [mesh]         pixel centres (i+0.5)/N, or FOORT SimpleSquareMesh i/(N-1)
 * @property {{r:number, theta:number, phi?:number, screen:number, cx?:number, cy?:number}} camera
 * @property {'logShifted'|'log'} [radial]      x = log(r - r_h) (app) or x = log r (FOORT RLogScale)
 * @property {number} [eps]                     FOORT StepSize (0.03)
 * @property {number} [hmin]                    FOORT SmallestPossibleStepsize
 * @property {number} maxSteps
 * @property {number} rTerm                     terminate when r < rTerm (horizon termination)
 * @property {number} rBoundary                 terminate when r > rBoundary (escape)
 * @property {'reflect'|'foort'} [axis]         reflect through the axis, or FOORT (continue; terminate within thetaSingEps)
 * @property {number|null} [thetaSingEps]       FOORT ThetaSingularity epsilon (null: off)
 * @property {{mode:'foort'|'euclid', eps:number}|null} [singularity]
 * @property {'interpolate'|'foort'} [crossing]
 * @property {number} [threshold]               FOORT EquatorialPasses threshold (0.001)
 * @property {number} [ncross]                  crossings stored per ray (3)
 * @property {number} [fdStep]                  finite-difference step in x and theta (1e-3)
 * @property {number} [axisStepFloor]           floor of min(theta, pi - theta) in the step rule (default 1e-3 with
 *                                              axis 'reflect', 0 = FOORT with axis 'foort')
 *
 * @typedef {Object} Crossing
 * @property {number} r @property {number} theta @property {number} phi @property {number} t
 * @property {number} px @property {number} pth     momenta at the crossing (redshift needs them, M5)
 *
 * @typedef {Object} RayResult
 * @property {number} term @property {number} steps
 * @property {number} r @property {number} theta @property {number} phi @property {number} t  final position
 * @property {number} passes                    all equatorial passes (FOORT counting in 'foort' mode)
 * @property {Crossing[]} crossings             first `ncross` crossings
 * @property {number} hamiltonian               |H| / sum of |terms of H| at the end (constraint drift)
 * @property {number} pt @property {number} pphi
 */

/**
 * Build the per-metric evaluation of (G0..G4) and their x- and theta-derivatives.
 * @param {import('../metrics/common.js').StationaryAxisymmetricMetric} metric
 * @param {number} r0 @param {number} fd
 */
export function makeFunctions(metric, r0, fd) {
  const guu = inverseMetric(metric);
  /** values of G0..G4 at (x, theta) into out[0..4] @param {number} x @param {number} th @param {Float64Array} out @param {number} o */
  const G = (x, th, out, o) => {
    const e = Math.exp(x), r = r0 + e, s = Math.sin(th);
    // axisymmetry: g(r, -theta) = g(r, theta); evaluate in [0, pi] so finite differences straddling
    // the axis stay valid (ST3Cr's ring term uses sin(theta) directly and is NaN for theta < 0).
    // G0..G4 are smooth and even across the axis but their formulas are 0 * inf on it: stay 1e-9 away.
    const ta = th < 0 ? -th : th > Math.PI ? 2 * Math.PI - th : th;
    const u = guu(r, Math.min(Math.max(ta, AXIS_EPS), Math.PI - AXIS_EPS));
    out[o] = u.gtt; out[o + 1] = u.gtphi; out[o + 2] = s * s * u.gphiphi; out[o + 3] = u.grr / (e * e); out[o + 4] = u.gthth;
  };
  const buf = new Float64Array(5 * 9);
  /**
   * @param {number} x @param {number} th
   * @param {Float64Array} v  out: 5 values
   * @param {Float64Array} dx out: 5 x-derivatives
   * @param {Float64Array} dth out: 5 theta-derivatives
   */
  return (x, th, v, dx, dth) => {
    G(x, th, buf, 0);
    G(x - 2 * fd, th, buf, 5); G(x - fd, th, buf, 10); G(x + fd, th, buf, 15); G(x + 2 * fd, th, buf, 20);
    G(x, th - 2 * fd, buf, 25); G(x, th - fd, buf, 30); G(x, th + fd, buf, 35); G(x, th + 2 * fd, buf, 40);
    for (let k = 0; k < 5; k++) {
      v[k] = buf[k];
      dx[k] = (buf[5 + k] - 8 * buf[10 + k] + 8 * buf[15 + k] - buf[20 + k]) / (12 * fd);
      dth[k] = (buf[25 + k] - 8 * buf[30 + k] + 8 * buf[35 + k] - buf[40 + k]) / (12 * fd);
    }
  };
}

/**
 * Trace one ray. State y = [x, theta, phi, t, px, pth].
 * @param {ReturnType<typeof makeFunctions>} F
 * @param {number[]} y0 @param {number} pt @param {number} pphi @param {number} r0
 * @param {Required<Omit<TraceOptions, 'camera'|'N'|'mesh'|'radial'>> & {metric:any}} o
 * @returns {RayResult}
 */
export function traceRay(F, y0, pt, pphi, r0, o) {
  const v = new Float64Array(5), dx = new Float64Array(5), dth = new Float64Array(5);
  const k1 = new Float64Array(6), k2 = new Float64Array(6), k3 = new Float64Array(6), k4 = new Float64Array(6), tmp = new Float64Array(6);
  const pt2 = pt * pt, ptph = pt * pphi, ph2 = pphi * pphi;
  /** @param {Float64Array|number[]} y @param {Float64Array} k */
  const rhs = (y, k) => {
    const th = y[1], px = y[4], pth = y[5];
    F(y[0], th, v, dx, dth);
    const s = Math.sin(th), c = Math.cos(th), is2 = 1 / (s * s);
    k[0] = v[3] * px;
    k[1] = v[4] * pth;
    k[2] = v[1] * pt + v[2] * pphi * is2;
    k[3] = v[0] * pt + v[1] * pphi;
    k[4] = -0.5 * (dx[0] * pt2 + 2 * dx[1] * ptph + dx[2] * ph2 * is2 + dx[3] * px * px + dx[4] * pth * pth);
    k[5] = -0.5 * (dth[0] * pt2 + 2 * dth[1] * ptph + (dth[2] * is2 - 2 * v[2] * c * is2 / s) * ph2 + dth[3] * px * px + dth[4] * pth * pth);
  };
  /** constraint |H| relative to the sum of the magnitudes of its terms @param {Float64Array} y */
  const ham = (y) => {
    F(y[0], y[1], v, dx, dth);
    const s = Math.sin(y[1]);
    const t = [v[0] * pt2, 2 * v[1] * ptph, v[2] * ph2 / (s * s), v[3] * y[4] * y[4], v[4] * y[5] * y[5]];
    return Math.abs(t.reduce((a, b) => a + b)) / t.reduce((a, b) => a + Math.abs(b), 0);
  };
  const y = Float64Array.from(y0);
  const yPrev = new Float64Array(6);
  const PI = Math.PI, half = PI / 2;
  const sings = o.singularity ? o.metric.singularities() : [];
  /** @type {Crossing[]} */
  const crossings = [];
  let passes = 0;
  const band = half * o.threshold;
  let prevTheta = Math.abs(y[1] - half) > band ? y[1] : -1; // FOORT: UpdateData at the start position
  const rOf = (/** @type {number} */ x) => r0 + Math.exp(x);
  const addCrossing = (/** @type {Float64Array} */ yy) => {
    if (crossings.length < o.ncross) crossings.push({ r: rOf(yy[0]), theta: yy[1], phi: yy[2], t: yy[3], px: yy[4], pth: yy[5] });
  };

  let term = TERM.timeout, steps = 0;
  for (;;) {
    rhs(y, k1);
    // FOORT Integrators::GetAdaptiveStep on the contravariant velocities (dx, dtheta, dphi)/dlambda;
    // with axis reflection the axis distance is floored, else a ray aimed at the axis never crosses it
    const d = 1e-20;
    const h1 = o.eps / (Math.abs(k1[0]) + d);
    const h2 = o.eps * Math.max(Math.min(y[1], PI - y[1]), o.axisStepFloor) / (Math.abs(k1[1]) + d);
    const h3 = o.eps / (Math.abs(k1[2]) + d);
    const h = Math.max(1 / (1 / Math.abs(h1) + 1 / Math.abs(h2) + 1 / Math.abs(h3)), o.hmin);
    // xStageMin: an RK stage inside the termination radius means the ray reaches it within this step.
    // In x = log r (FOORT-like) p_r ~ 1/Delta diverges at the horizon and a stage beyond it returns garbage.
    for (let i = 0; i < 6; i++) tmp[i] = y[i] + 0.5 * h * k1[i];
    let xStageMin = tmp[0];
    rhs(tmp, k2);
    for (let i = 0; i < 6; i++) tmp[i] = y[i] + 0.5 * h * k2[i];
    xStageMin = Math.min(xStageMin, tmp[0]);
    rhs(tmp, k3);
    for (let i = 0; i < 6; i++) tmp[i] = y[i] + h * k3[i];
    xStageMin = Math.min(xStageMin, tmp[0]);
    rhs(tmp, k4);
    yPrev.set(y);
    for (let i = 0; i < 6; i++) y[i] += h / 6 * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
    steps++;

    if (o.axis === 'reflect') {
      if (y[1] < 0) { y[1] = -y[1]; y[2] += PI; y[5] = -y[5]; }
      if (y[1] > PI) { y[1] = 2 * PI - y[1]; y[2] += PI; y[5] = -y[5]; }
    }

    // terminations, FOORT order: horizon, boundary sphere, time out, theta singularity, NaN, singularity
    const r = rOf(y[0]);
    let tc = 0;
    if (r < o.rTerm || rOf(xStageMin) < o.rTerm) tc = TERM.horizon;
    else if (r > o.rBoundary) tc = TERM.boundary;
    else if (steps > o.maxSteps) tc = TERM.timeout;
    else if (o.thetaSingEps !== null && (Math.abs(y[1]) < o.thetaSingEps || Math.abs(PI - y[1]) < o.thetaSingEps)) tc = TERM.thetaSing;
    else if (!y.every(Number.isFinite)) tc = TERM.nan;
    else if (o.singularity) {
      if (o.singularity.mode === 'euclid') { if (singularityDistance(sings, r, y[1]) <= o.singularity.eps) tc = TERM.singularity; }
      else for (const sg of sings) {
        // FOORT GeneralSingularityTermination: distance in coordinate space (r, theta)
        if ((r - sg.r) ** 2 + (y[1] - sg.theta) ** 2 <= o.singularity.eps ** 2) { tc = TERM.singularity; break; }
      }
    }

    // equatorial crossings (only while the ray has not terminated, as in FOORT)
    if (!tc) {
      if (o.crossing === 'foort') {
        if (Math.abs(y[1] - half) > band) {
          if (prevTheta > 0 && (prevTheta - half) * (y[1] - half) < 0) { passes++; addCrossing(y); }
          prevTheta = y[1];
        }
      } else if ((yPrev[1] - half) * (y[1] - half) < 0) {
        // linear interpolation in lambda between the two step ends
        const f = (half - yPrev[1]) / (y[1] - yPrev[1]);
        for (let i = 0; i < 6; i++) tmp[i] = yPrev[i] + f * (y[i] - yPrev[i]);
        tmp[1] = half;
        passes++; addCrossing(tmp);
      }
    }
    if (tc) { term = tc; break; }
  }
  return { term, steps, r: rOf(y[0]), theta: y[1], phi: y[2], t: y[3], passes, crossings, hamiltonian: Math.abs(ham(y)), pt, pphi };
}

/**
 * Normalize options and build what every ray of an image needs.
 * @param {import('../metrics/common.js').StationaryAxisymmetricMetric} metric
 * @param {TraceOptions} opts
 */
export function prepareImage(metric, opts) {
  const o = {
    mesh: 'centers', radial: 'logShifted', eps: 0.03, hmin: 1e-12, axis: 'reflect', thetaSingEps: null,
    singularity: null, crossing: 'interpolate', threshold: 0.001, ncross: 3, fdStep: 1e-3, ...opts,
  };
  if (o.axisStepFloor === undefined) o.axisStepFloor = o.axis === 'reflect' ? 1e-3 : 0;
  const r0 = o.radial === 'log' || metric.horizon.kind !== 'sphere' ? 0 : metric.horizon.r;
  const F = makeFunctions(metric, r0, o.fdStep);
  const { r, theta } = o.camera;
  const cam = TetradCamera.fromStaticObserver(toMat4(metric.g_dd(r, theta)), toMat4(inverseMetric(metric)(r, theta)), [0, r, theta, o.camera.phi ?? 0]);
  const rayOpts = { ...o, metric };
  /**
   * Trace pixel (i, j): i runs along alpha (FOORT "row"), j along beta.
   * @param {number} i @param {number} j
   */
  const tracePixel = (i, j) => {
    const N = o.N;
    const ux = o.mesh === 'foort' ? i / (N - 1) : (i + 0.5) / N;
    const uy = o.mesh === 'foort' ? j / (N - 1) : (j + 0.5) / N;
    const alpha = (o.camera.cx ?? 0) + o.camera.screen * (ux - 0.5);
    const beta = (o.camera.cy ?? 0) + o.camera.screen * (uy - 0.5);
    const { down } = cam.initialMomentum(alpha, beta);
    const y0 = [Math.log(r - r0), theta, o.camera.phi ?? 0, 0, down[1] * (r - r0), down[2]];
    return traceRay(F, y0, down[0], down[3], r0, /** @type {any} */ (rayOpts));
  };
  return { tracePixel, camera: cam, r0, options: o };
}

/** FOORT FourColorScreen quadrant (Diagnostics.cpp) of a terminated ray; 0 unless it reached the boundary. @param {RayResult} res */
export function fourColorQuadrant(res) {
  if (res.term !== TERM.boundary) return 0;
  let ph = res.phi;
  if (Math.abs(ph) < 2 * Math.PI * 1e5) { while (ph > 2 * Math.PI) ph -= 2 * Math.PI; while (ph < 0) ph += 2 * Math.PI; }
  if (res.theta < Math.PI / 2) return ph < Math.PI ? 1 : 2;
  return ph < Math.PI ? 3 : 4;
}
