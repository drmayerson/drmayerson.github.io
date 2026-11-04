// @ts-check
// Port of FOORT's GeneralCircularRadialFluid (FOORT/src/DiagnosticsEmission.cpp), double precision, DOM-free.
// Equatorial fluid: a mix of (sub-)Keplerian circular orbits (outside the ISCO; inside it the Cunningham
// plunge with the ISCO energy and angular momentum) and radial infall from rest at infinity, with
// parameters xi (sub-Keplerian), beta_r and beta_phi (all clamped to [0, 1]).
//
// Coordinates are (t, r, theta, phi) with the true r. FOORT works in its integration coordinates
// (log r with RLogScale); the four-velocity is a vector, so its contraction with the photon momentum,
// and hence the redshift, is the same. The r-Christoffels of the t-phi block are taken by 4th-order
// finite differences in r (FOORT: central differences in its coordinate, h = 1e-7); the ISCO
// stability test d/dr(g^{ab} Gamma^r_{bc} g^{cd}) p_a p_d has the same sign in either coordinate,
// because the extra term of the coordinate change is proportional to the (vanishing) radial geodesic
// equation of the circular orbit.

const TH = Math.PI / 2;
/** FOORT Integrators::delta_nodiv0 */
const DELTA = 1e-20;
/** FOORT Integrators::Derivative_hval: the ISCO bisection stops at a bracket of 2 h (in FOORT's coordinate) */
const DERIV_H = 1e-7;

/**
 * @typedef {Object} FluidParams
 * @property {number} xi         sub-Keplerian parameter (1: Keplerian)
 * @property {number} betaR      radial velocity parameter (1: circular / plunging)
 * @property {number} betaPhi    azimuthal velocity parameter (1: circular / plunging)
 * @property {number} [iscoLower]  ISCO search bounds, true radii (FOORT: r_h and 10 r_h; horizonless 0.05 and 1000)
 * @property {number} [iscoUpper]
 * @property {boolean} [rLogScale] bisection in log r, as FOORT with RLogScale (default true)
 *
 * @typedef {[number, number, number, number]} Vec4  covariant (t, r, theta, phi) unless stated
 */

/**
 * @param {import('../metrics/common.js').StationaryAxisymmetricMetric} m
 * @param {FluidParams} params
 */
export function createFluid(m, params) {
  const clamp01 = (/** @type {number} */ v) => Math.min(Math.max(v, 0), 1);
  const xi = clamp01(params.xi), betaR = clamp01(params.betaR), betaPhi = clamp01(params.betaPhi);
  const rh = m.horizon.kind === 'sphere' ? m.horizon.r : 0;
  const iscoLower = params.iscoLower ?? (rh > 0 ? rh : 0.05);
  const iscoUpper = params.iscoUpper ?? (rh > 0 ? 10 * rh : 1000);
  const logScale = params.rLogScale ?? true;
  const guu = m.g_uu ? m.g_uu.bind(m) : null;

  /** inverse metric on the equator, t-phi block and g^rr */
  const inv = (/** @type {number} */ r) => {
    if (guu) return guu(r, TH);
    const g = m.g_dd(r, TH);
    const det = g.gtt * g.gphiphi - g.gtphi * g.gtphi;
    return { gtt: g.gphiphi / det, gtphi: -g.gtphi / det, gphiphi: g.gtt / det, grr: 1 / g.grr, gthth: 1 / g.gthth };
  };
  /** Gamma^r_{AB} for A, B in {t, phi}: -1/2 g^rr d_r g_AB (4th-order FD) */
  const christR = (/** @type {number} */ r) => {
    const h = 1e-4 * Math.max(r, 1e-3);
    const g2 = m.g_dd(r - 2 * h, TH), g1 = m.g_dd(r - h, TH), g3 = m.g_dd(r + h, TH), g4 = m.g_dd(r + 2 * h, TH);
    const d = (/** @type {'gtt'|'gtphi'|'gphiphi'} */ k) => (g2[k] - 8 * g1[k] + 8 * g3[k] - g4[k]) / (12 * h);
    const grr = inv(r).grr;
    return { tt: -0.5 * grr * d('gtt'), tp: -0.5 * grr * d('gtphi'), pp: -0.5 * grr * d('gphiphi') };
  };
  /** M = g^{AB} Gamma^r_{BC} g^{CD} on the t-phi block: [tt, tp, pp] */
  const raisedChrist = (/** @type {number} */ r) => {
    const u = inv(r), G = christR(r);
    const A = [[u.gtt, u.gtphi], [u.gtphi, u.gphiphi]], C = [[G.tt, G.tp], [G.tp, G.pp]];
    const M = [[0, 0], [0, 0]];
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) for (let k = 0; k < 2; k++) for (let l = 0; l < 2; l++) M[i][j] += A[i][k] * C[k][l] * A[l][j];
    return M;
  };

  /**
   * FOORT GetCircularVelocityd: circular geodesic (then sub-Keplerian rescaling of L if requested).
   * @returns {Vec4} covariant velocity, or all zeros if none
   */
  const circular = (/** @type {number} */ r, subKeplerianOn = true) => {
    const u = inv(r);
    const M = raisedChrist(r);
    const a = M[0][0], b = M[1][1], c = 2 * M[0][1];
    const ap = u.gtt, bp = u.gphiphi, cp = 2 * u.gtphi;
    /** @type {Vec4} */
    const p = [0, 0, 0, 0];
    let discr = c * c - 4 * a * b;
    if (discr < 0) return p;
    const q = 0.5 * (c + Math.sign(c || 1) * Math.sqrt(discr));
    const roots = [];
    if (Math.abs(b) > DELTA) roots.push(q / b);
    if (Math.abs(q) > DELTA) roots.push(a / q);
    let eta = 0, found = false;
    for (const ro of roots) {
      const den = ap + bp * ro * ro - cp * ro;
      if (den < 0 && (!found || ro > eta)) { eta = ro; found = true; }
    }
    if (!found) return p;
    const denom = ap + bp * eta * eta - cp * eta;
    if (denom >= 0) return p;
    p[0] = -Math.sqrt(-1 / denom);
    p[3] = eta * -p[0];
    if (subKeplerianOn) {
      const old = p[3];
      p[3] *= xi;
      let failed = false;
      if (Math.abs(ap) > DELTA) {
        discr = cp * cp * p[3] * p[3] - 4 * ap * (1 + bp * p[3] * p[3]);
        if (discr < 0) failed = true;
        else p[0] = 1 / (2 * ap) * (-cp * p[3] + Math.sqrt(discr));
      } else if (Math.abs(cp * p[3]) > DELTA) p[0] = -(1 + bp * p[3] * p[3]) / (cp * p[3]);
      else failed = true;
      if (failed) p[3] = old;
    }
    return p;
  };

  // FOORT FindISCO: bisection on the stability of circular orbits (in log r with RLogScale)
  const toC = (/** @type {number} */ r) => (logScale ? Math.log(r) : r), toR = (/** @type {number} */ c) => (logScale ? Math.exp(c) : c);
  let lo = toC(iscoLower), hi = toC(iscoUpper), cur = (lo + hi) / 2;
  let exact = false;
  for (let it = 0; hi - lo > 2 * DERIV_H && it < 1000 && !exact; it++) {
    const r = toR(cur);
    const pc = circular(r, false);
    let smaller;
    if (pc[0] < 0) {
      const h = 1e-4 * r;
      const Mp2 = raisedChrist(r + 2 * h), Mp = raisedChrist(r + h), Mm = raisedChrist(r - h), Mm2 = raisedChrist(r - 2 * h);
      const dM = (/** @type {number} */ i, /** @type {number} */ j) => (-Mp2[i][j] + 8 * Mp[i][j] - 8 * Mm[i][j] + Mm2[i][j]) / (12 * h);
      const P = [pc[0], pc[3]];
      let rdd = 0;
      for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) rdd += -P[i] * dM(i, j) * P[j];
      if (rdd < 0) smaller = true; else if (rdd > 0) smaller = false; else { exact = true; smaller = true; }
    } else smaller = false;
    if (!exact) { if (smaller) hi = cur; else lo = cur; cur = (lo + hi) / 2; }
  }
  const rIsco = toR(exact ? cur : hi);
  const pIsco = circular(rIsco);
  const iscoExists = pIsco[0] < 0;

  /** FOORT GetInsideISCOCircularVelocityd: ISCO E, L and radial infall */
  const insideIsco = (/** @type {number} */ r) => {
    const u = inv(r);
    const t2 = -1 - u.gtt * pIsco[0] * pIsco[0] - 2 * u.gtphi * pIsco[0] * pIsco[3] - u.gphiphi * pIsco[3] * pIsco[3];
    const pr = -1 / Math.sqrt(u.grr) * Math.sqrt(Math.max(t2, 0));
    return /** @type {Vec4} */ (Number.isNaN(pr) ? [0, 0, 0, 0] : [pIsco[0], pr, 0, pIsco[3]]);
  };
  /** FOORT GetRadialVelocityd: radial infall with E = 1, L = 0 (g^tr = 0 for these metrics) */
  const radial = (/** @type {number} */ r) => {
    const u = inv(r);
    const pr = 1 / u.grr * (0 - Math.sqrt(Math.max(-u.grr + (0 - u.gtt * u.grr), 0)));
    return /** @type {Vec4} */ ([-1, pr, 0, 0]);
  };

  /**
   * FOORT GetFourVelocityd at radius r (on the equator).
   * @param {number} r
   * @returns {{down: Vec4, up: Vec4}} covariant and contravariant four-velocity
   */
  const velocity = (r) => {
    const gd = m.g_dd(r, TH), u = inv(r);
    const raise = (/** @type {Vec4} */ p) => /** @type {Vec4} */ ([u.gtt * p[0] + u.gtphi * p[3], u.grr * p[1], 0, u.gtphi * p[0] + u.gphiphi * p[3]]);
    const lower = (/** @type {Vec4} */ v) => /** @type {Vec4} */ ([gd.gtt * v[0] + gd.gtphi * v[3], gd.grr * v[1], 0, gd.gtphi * v[0] + gd.gphiphi * v[3]]);
    const pRad = radial(r);
    let fin = pRad;
    if (betaR > 0 || betaPhi > 0) {
      /** @type {Vec4} */
      let pc = [0, 0, 0, 0];
      if (iscoExists) {
        pc = r >= rIsco ? circular(r) : insideIsco(r);
        if (pc[0] >= 0 && r >= rIsco) pc = insideIsco(r);
      } else pc = circular(r);
      if (pc[0] < 0) {
        const uc = raise(pc), ur = raise(pRad);
        const urTot = uc[1] + (1 - betaR) * (ur[1] - uc[1]);
        const OmC = uc[3] / uc[0], OmR = ur[3] / ur[0];
        const Om = OmC + (1 - betaPhi) * (OmR - OmC);
        const den = gd.gtt + 2 * gd.gtphi * Om + gd.gphiphi * Om * Om;
        const ut2 = (-1 - gd.grr * urTot * urTot) / den;
        fin = ut2 < 0 ? pRad : lower([Math.sqrt(ut2), urTot, 0, Math.sqrt(ut2) * Om]);
      }
      if (Number.isNaN(fin[0]) || Number.isNaN(fin[1]) || Number.isNaN(fin[3]) || fin[0] >= 0) fin = pRad;
    }
    return { down: fin, up: raise(fin) };
  };

  return {
    params: { xi, betaR, betaPhi, iscoLower, iscoUpper },
    isco: iscoExists ? rIsco : null,
    velocity,
    /**
     * Redshift g = 1 / (u^mu p_mu) for the past-directed photon momentum p (p_t = 1), FOORT convention.
     * @param {number} r @param {number} pt @param {number} pr @param {number} pphi  covariant, true-r components
     */
    redshift(r, pt, pr, pphi) {
      const { up } = velocity(r);
      return 1 / (up[0] * pt + up[1] * pr + up[3] * pphi);
    },
  };
}

/** FOORT GLMJohnsonSUEmission: J(r) = exp(-(gamma + asinh((r - mu)/sigma))^2 / 2) / sqrt((r - mu)^2 + sigma^2), true r. */
export const johnsonSU = (/** @type {number} */ r, /** @type {{mu:number, gamma:number, sigma:number}} */ p) => {
  const t = p.gamma + Math.asinh((r - p.mu) / p.sigma);
  return Math.exp(-0.5 * t * t) / Math.sqrt((r - p.mu) ** 2 + p.sigma ** 2);
};

/** Analytic Kerr prograde ISCO (Bardeen, Press & Teukolsky 1972), M = 1. @param {number} a */
export function kerrISCO(a) {
  const z1 = 1 + Math.cbrt(1 - a * a) * (Math.cbrt(1 + a) + Math.cbrt(1 - a));
  const z2 = Math.sqrt(3 * a * a + z1 * z1);
  return 3 + z2 - Math.sqrt((3 - z1) * (3 + z1 + 2 * z2));
}
