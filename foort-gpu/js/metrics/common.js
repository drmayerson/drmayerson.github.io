// @ts-check
// Shared pieces of the metric library (double precision, DOM-free).

/**
 * Nonzero components of a circular stationary axisymmetric metric in (t, r, theta, phi);
 * all other components vanish. Used for both g_dd and g_uu.
 * @typedef {{gtt:number, gtphi:number, gphiphi:number, grr:number, gthth:number}} Circular4
 *
 * @typedef {{kind:'point', r:number, theta:number} | {kind:'ring', r:number, theta:number}} Singularity
 *   Points sit on the axis, rings in the equatorial plane; (r, theta) are the metric's coordinates.
 *
 * @typedef {Object} StationaryAxisymmetricMetric
 * @property {string} id
 * @property {Record<string, number>} params
 * @property {number} massADM                 length unit; UI shows lengths in units of this
 * @property {{kind:'none'} | {kind:'sphere', r:number}} horizon
 * @property {boolean} equatoriallySymmetric
 * @property {(r:number, th:number) => Circular4} g_dd
 * @property {((r:number, th:number) => Circular4)=} g_uu   closed form where available
 * @property {() => Singularity[]} singularities
 * @property {(() => number)=} terminationRadius    rays stop at r < terminationRadius() (horizon metrics: outside r_+; horizonless: inner cut)
 * @property {(() => number)=} singularityEpsilon   Euclidean base-space distance at which rays stop near singularities()
 * @property {number=} lengthScale                  metrics rescaled to unit mass (rescaleToUnitMass): the raw length unit
 *                                                  (default r_h (1 + EPS_HORIZON))
 * @property {(opts?:ValidateOptions) => {ok:boolean, messages:string[]}} validate
 *
 * @typedef {Object} ValidateOptions
 * @property {number=} rMin   inner sampling radius (default: termination radius of the metric)
 * @property {number=} rMax   outer sampling radius (default 1000 M_ADM)
 * @property {number=} nr     radial samples, log-spaced (default 120)
 * @property {number=} nth    theta samples, cell-centred in (0, pi) (default 61)
 * @property {number=} epsSing  skip points closer than this (base-space distance) to a singularity
 */

/** Default horizon termination parameter (FOORT Epsilon_Horizon). */
export const EPS_HORIZON = 0.01;

/** Generic inverse of a circular metric (t-phi block plus diagonal). @param {Circular4} g @returns {Circular4} */
export function invertCircular(g) {
  const det = g.gtt * g.gphiphi - g.gtphi * g.gtphi;
  return { gtt: g.gphiphi / det, gtphi: -g.gtphi / det, gphiphi: g.gtt / det, grr: 1 / g.grr, gthth: 1 / g.gthth };
}

/** @param {Circular4} c @returns {number[][]} row-major 4x4 in (t, r, theta, phi) */
export function toMat4(c) {
  return [[c.gtt, 0, 0, c.gtphi], [0, c.grr, 0, 0], [0, 0, c.gthth, 0], [c.gtphi, 0, 0, c.gphiphi]];
}

/** Inverse metric of `m`: closed form if provided, else generic inversion. @param {StationaryAxisymmetricMetric} m */
export function inverseMetric(m) {
  return m.g_uu ?? ((/** @type {number} */ r, /** @type {number} */ th) => invertCircular(m.g_dd(r, th)));
}

/**
 * Carlson's symmetric elliptic integral R_F(x, y, z) (duplication algorithm, double precision).
 * @param {number} x @param {number} y @param {number} z
 */
export function carlsonRF(x, y, z) {
  const ERRTOL = 1e-3; // truncation error ~ ERRTOL^6 / 4
  let xn = x, yn = y, zn = z;
  for (let i = 0; i < 100; i++) {
    const mu = (xn + yn + zn) / 3;
    const dx = 1 - xn / mu, dy = 1 - yn / mu, dz = 1 - zn / mu;
    if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) < ERRTOL) {
      const e2 = dx * dy - dz * dz, e3 = dx * dy * dz;
      return (1 + (e2 / 24 - 0.1 - 3 * e3 / 44) * e2 + e3 / 14) / Math.sqrt(mu);
    }
    const sx = Math.sqrt(xn), sy = Math.sqrt(yn), sz = Math.sqrt(zn);
    const lam = sx * (sy + sz) + sy * sz;
    xn = 0.25 * (xn + lam); yn = 0.25 * (yn + lam); zn = 0.25 * (zn + lam);
  }
  return NaN;
}

/** Complete elliptic integral of the first kind with modulus k (same convention as std::comp_ellint_1). @param {number} k */
export function compEllint1(k) {
  return carlsonRF(0, 1 - k * k, 1);
}

/**
 * Base-space (Euclidean R^3 with spherical coordinates r, theta) distance to the nearest singularity.
 * @param {Singularity[]} sings @param {number} r @param {number} th
 */
export function singularityDistance(sings, r, th) {
  const rho = r * Math.sin(th), z = r * Math.cos(th);
  let d = Infinity;
  for (const s of sings) {
    if (s.kind === 'point') {
      const zc = s.r * Math.cos(s.theta);
      d = Math.min(d, Math.hypot(rho, z - zc));
    } else {
      d = Math.min(d, Math.hypot(rho - s.r, z));
    }
  }
  return d;
}

/**
 * The same test as pointValidity on the inverse metric g^uu (one metric evaluation where only g^uu is needed):
 * g^rr, g^thth > 0, det of the (t, phi) block < 0 (its sign is that of the g_dd block), and
 * g_phiphi = g^tt / det > 0, i.e. g^tt < 0.
 * @param {Circular4} u
 */
export function pointValidityInverse(u) {
  if (![u.gtt, u.gtphi, u.gphiphi, u.grr, u.gthth].every(Number.isFinite)) return 'nonfinite';
  if (!(u.grr > 0 && u.gthth > 0 && u.gtt * u.gphiphi - u.gtphi * u.gtphi < 0)) return 'signature';
  if (!(u.gtt < 0)) return 'ctc';
  return '';
}

/**
 * A metric in units of its ADM mass (Stage 1B, B1): t = L t', r = L r' with L = massADM. With the overall factor L^2
 * dropped (null geodesics and redshift ratios do not see a constant conformal factor):
 *   g'_tt(r') = g_tt(L r'), g'_tphi = g_tphi(L r') / L, g'_phiphi = g_phiphi(L r') / L^2, g'_rr = g_rr(L r'),
 *   g'_thth = g_thth(L r') / L^2,  and the inverse g'^tt = g^tt, g'^tphi = L g^tphi, g'^phiphi = L^2 g^phiphi,
 *   g'^rr = g^rr, g'^thth = L^2 g^thth.
 * Everything with a length scales by 1/L (horizon, termination radius, singularities and their distance, the
 * critical impact parameter); `lengthScale` = L lets grids keep their raw node positions (tableRadiusFor, the fluid's
 * ISCO search), so the scaled metric traces the same rays. `raw` is the original metric (FOORT parity harness).
 * Metric-specific raw-unit helpers (ST3Cr `functions`, ST3Cr-BH `Q`) are not carried over.
 * @template {StationaryAxisymmetricMetric} T
 * @param {T} m
 * @returns {StationaryAxisymmetricMetric & {lengthScale:number, raw:T, criticalImpactParameter?:() => {b:number, r:number}}}
 */
export function rescaleToUnitMass(m) {
  const L = m.massADM, L2 = L * L;
  const any = /** @type {any} */ (m);
  /** @type {any} */
  const w = {
    id: m.id,
    params: m.params,
    massADM: 1,
    lengthScale: L,
    raw: m,
    horizon: m.horizon.kind === 'sphere' ? { kind: 'sphere', r: m.horizon.r / L } : m.horizon,
    equatoriallySymmetric: m.equatoriallySymmetric,
    /** @param {number} r @param {number} th */
    g_dd(r, th) { const g = m.g_dd(L * r, th); return { gtt: g.gtt, gtphi: g.gtphi / L, gphiphi: g.gphiphi / L2, grr: g.grr, gthth: g.gthth / L2 }; },
    singularities: () => m.singularities().map((s) => ({ ...s, r: s.r / L })),
    /** @param {ValidateOptions} [opts] */
    validate: (opts = {}) => m.validate({ ...opts, ...(opts.rMin !== undefined ? { rMin: opts.rMin * L } : {}), ...(opts.rMax !== undefined ? { rMax: opts.rMax * L } : {}) }),
  };
  if (m.g_uu) {
    const guu = m.g_uu;
    /** @param {number} r @param {number} th */
    w.g_uu = (r, th) => { const u = guu(L * r, th); return { gtt: u.gtt, gtphi: u.gtphi * L, gphiphi: u.gphiphi * L2, grr: u.grr, gthth: u.gthth * L2 }; };
  }
  if (m.terminationRadius) { const f = m.terminationRadius; w.terminationRadius = () => f() / L; }
  if (m.singularityEpsilon) { const f = m.singularityEpsilon; w.singularityEpsilon = () => f() / L; }
  if (any.criticalImpactParameter) w.criticalImpactParameter = () => { const c = any.criticalImpactParameter(); return { b: c.b / L, r: c.r / L }; };
  return w;
}

/**
 * Pointwise validity of g_dd: 'nonfinite', 'signature', 'ctc' or '' (valid).
 * @param {Circular4} g
 */
export function pointValidity(g) {
  if (![g.gtt, g.gtphi, g.gphiphi, g.grr, g.gthth].every(Number.isFinite)) return 'nonfinite';
  if (!(g.grr > 0 && g.gthth > 0 && g.gtt * g.gphiphi - g.gtphi * g.gtphi < 0)) return 'signature';
  if (!(g.gphiphi > 0)) return 'ctc';
  return '';
}

/**
 * Smallest sampled radius r_valid such that the metric is valid on all samples with r >= r_valid
 * (log-spaced in r - rRef over [rStart, rMax], cell-centred theta). Returns rStart if everything is valid.
 * @param {StationaryAxisymmetricMetric} m @param {number} rStart @param {number} rMax
 * @param {{nr?:number, nth?:number, rRef?:number}} [opts]  rRef (e.g. the horizon radius) clusters samples near it
 */
export function validityRadius(m, rStart, rMax, opts = {}) {
  const nr = opts.nr ?? 400, nth = opts.nth ?? 181, rRef = opts.rRef ?? 0;
  const lr0 = Math.log(rStart - rRef), lr1 = Math.log(rMax - rRef);
  let rBad = 0, why = '';
  for (let i = nr - 1; i >= 0; i--) {
    const r = rRef + Math.exp(lr0 + (lr1 - lr0) * i / (nr - 1));
    for (let j = 0; j < nth; j++) {
      const v = pointValidity(m.g_dd(r, Math.PI * (j + 0.5) / nth));
      if (v) { rBad = r; why = v; break; }
    }
    if (rBad) {
      const rNext = rRef + Math.exp(lr0 + (lr1 - lr0) * (i + 1) / (nr - 1));
      return { rValid: rNext, worst: why, rBad };
    }
  }
  return { rValid: rStart, worst: '', rBad: 0 };
}

/**
 * Sampled validity check outside the termination region: finite components, Lorentzian
 * signature (g_rr > 0, g_thth > 0, g_tt g_phiphi - g_tphi^2 < 0) and no closed timelike
 * curves (g_phiphi > 0).
 * @param {StationaryAxisymmetricMetric} m
 * @param {Required<Pick<ValidateOptions, 'rMin'|'rMax'>> & ValidateOptions} opts
 * @returns {{ok:boolean, messages:string[], counts:Record<string, number>}}
 */
export function sampledValidity(m, opts) {
  const nr = opts.nr ?? 120, nth = opts.nth ?? 61;
  const sings = m.singularities();
  const epsSing = opts.epsSing ?? 1e-3;
  /** @type {Record<string, number>} */
  const counts = { samples: 0, nonfinite: 0, signature: 0, ctc: 0 };
  /** @type {Record<string, string>} */
  const first = {};
  const lr0 = Math.log(opts.rMin), lr1 = Math.log(opts.rMax);
  for (let i = 0; i < nr; i++) {
    const r = Math.exp(lr0 + (lr1 - lr0) * i / (nr - 1));
    for (let j = 0; j < nth; j++) {
      const th = Math.PI * (j + 0.5) / nth;
      if (sings.length && singularityDistance(sings, r, th) < epsSing) continue;
      counts.samples++;
      const v = pointValidity(m.g_dd(r, th));
      if (v) { counts[v]++; first[v] ??= `r = ${r.toPrecision(6)}, theta = ${th.toFixed(4)}`; }
    }
  }
  const messages = [];
  if (counts.nonfinite) messages.push(`${counts.nonfinite} samples with non-finite metric components (first at ${first.nonfinite})`);
  if (counts.signature) messages.push(`${counts.signature} samples with wrong signature (first at ${first.signature})`);
  if (counts.ctc) messages.push(`${counts.ctc} samples with g_phiphi <= 0, i.e. closed timelike curves (first at ${first.ctc})`);
  return { ok: messages.length === 0, messages, counts };
}
