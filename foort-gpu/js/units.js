// @ts-check
// Physical units (Stage 1B B8, plan 5.4; decision E6). The tracer works in units of the metric's ADM mass M; a preset
// gives M (in solar masses) and the distance D, from which
//   time   GM/c^3   = 4.925490947 us per M_sun,
//   length GM/c^2   = 1.476625038 km per M_sun,
//   angle  theta_g  = GM/(c^2 D).
// Presets (sources in DECISIONS.md, 2026-11-10):
//   Sgr A*: M = 4.297e6 M_sun, D = 8.277 kpc (GRAVITY Collaboration 2022, A&A 657, L12): theta_g = 5.12 uas;
//   M87*:   M = 6.5e9 M_sun,   D = 16.8 Mpc  (EHT Collaboration 2019, ApJL 875, L6, Paper VI): theta_g = 3.8 uas;
//   a 10 M_sun stellar-mass black hole at 1 kpc (illustrative).
// Pure math, DOM-free.

/** GM_sun / c^3 in seconds (IAU nominal GM_sun = 1.3271244e20 m^3/s^2, c = 299792458 m/s) */
export const T_SUN_S = 4.925490947e-6;
/** GM_sun / c^2 in km */
export const L_SUN_KM = 1.476625038;
/** one parsec in km */
export const PC_KM = 3.0856775814913673e13;
/** one microarcsecond in radians */
export const UAS = Math.PI / (180 * 3600 * 1e6);

/** @typedef {{label: string, Msun: number, Dkpc: number}} UnitPreset */
/** @type {Record<string, UnitPreset|null>} */
export const UNIT_PRESETS = {
  M: null,
  sgra: { label: 'Sgr A* (4.297 × 10⁶ M☉, 8.277 kpc)', Msun: 4.297e6, Dkpc: 8.277 },
  m87: { label: 'M87* (6.5 × 10⁹ M☉, 16.8 Mpc)', Msun: 6.5e9, Dkpc: 16.8e3 },
  stellar: { label: '10 M☉ black hole at 1 kpc', Msun: 10, Dkpc: 1 },
  custom: { label: 'custom M and D', Msun: 1e6, Dkpc: 10 },
};

/**
 * Units of a state: null for dimensionless (M); else the time (s), length (km) and angle (uas) of 1 M.
 * @param {string} preset @param {number} [Msun] custom mass @param {number} [Dkpc] custom distance
 * @returns {{Msun:number, Dkpc:number, tS:number, lKm:number, thetaUas:number}|null}
 */
export function unitsOf(preset, Msun, Dkpc) {
  const p = UNIT_PRESETS[preset];
  if (!p) return null;
  const m = preset === 'custom' ? (Msun ?? p.Msun) : p.Msun, d = preset === 'custom' ? (Dkpc ?? p.Dkpc) : p.Dkpc;
  const lKm = m * L_SUN_KM;
  return { Msun: m, Dkpc: d, tS: m * T_SUN_S, lKm, thetaUas: lKm / (d * 1e3 * PC_KM) / UAS };
}

/** a duration in seconds as s / min / h / days / years @param {number} s */
export function formatDuration(s) {
  const a = Math.abs(s);
  if (a < 1e-3) return `${(s * 1e6).toPrecision(3)} µs`;
  if (a < 1) return `${(s * 1e3).toPrecision(3)} ms`;
  if (a < 120) return `${s.toPrecision(3)} s`;
  if (a < 7200) return `${(s / 60).toPrecision(3)} min`;
  if (a < 2 * 86400) return `${(s / 3600).toPrecision(3)} h`;
  if (a < 730 * 86400) return `${(s / 86400).toPrecision(3)} days`;
  return `${(s / (365.25 * 86400)).toPrecision(3)} yr`;
}

/** a length in km as km / AU / pc @param {number} km */
export function formatLength(km) {
  const a = Math.abs(km);
  if (a < 1e7) return `${km.toPrecision(3)} km`;
  if (a < 0.1 * PC_KM) return `${(km / 1.495978707e8).toPrecision(3)} AU`;
  return `${(km / PC_KM).toPrecision(3)} pc`;
}

/** a round number at most x: 1, 2 or 5 times a power of ten (scale bars) @param {number} x */
export function niceBelow(x) {
  const e = 10 ** Math.floor(Math.log10(x)), f = x / e;
  return (f >= 5 ? 5 : f >= 2 ? 2 : 1) * e;
}

/**
 * Telescope beam: FWHM in uas (or directly in M when the units are dimensionless) -> Gaussian sigma in image pixels.
 * @param {number} fwhm  in uas, or in M if `units` is null
 * @param {ReturnType<typeof unitsOf>} units @param {number} screenM  field of view in M @param {number} N  pixels
 */
export function beamSigmaPx(fwhm, units, screenM, N) {
  const fwhmM = units ? fwhm / units.thetaUas : fwhm;
  return fwhmM / (2 * Math.sqrt(2 * Math.log(2))) / (screenM / N);
}
