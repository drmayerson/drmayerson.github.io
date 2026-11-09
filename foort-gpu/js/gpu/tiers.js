// @ts-check
// Quality tiers (Stage 1B B6, plan Section 1.2). Every trace runs at a tier:
//   Reference: the Stage 1 integrator without accuracy trades (eps 0.03, no larger far steps, max steps 5000 BH /
//              10000 fuzzball), every pixel traced; exact speedups (B5) allowed.
//   High:      Reference + the Stage 1 trades the user accepted (far steps up to 4x beyond 20 M; fuzzball max steps 5000).
//   Normal:    High + the accuracy-budgeted speedups that pass the quality gate (B6; NORMAL below).
//   Draft:     previews while dragging only (the coarse level; coarse tables while a metric parameter is dragged).
// Automatic selection: the highest tier whose predicted full trace at the current resolution fits the time target (E1:
// 2 s black holes, 10 s fuzzball), predicted from a small probe trace of the current view on this device.

/** @typedef {'reference'|'high'|'normal'} Tier */
export const TIERS = /** @type {Tier[]} */ (['reference', 'high', 'normal']);
export const TIER_LABELS = { reference: 'Reference', high: 'High', normal: 'Normal', draft: 'Draft' };

/** E1 (accepted at B4): full trace at the default resolution within these times */
export const TIER_TARGET_S = { BH: 2, fuzzball: 10 };

/**
 * The accuracy-budgeted speedups of Normal, per metric mode (B6; dev/reports/b6/summary.md). Of the candidates
 * (eps 0.04-0.08, Bogacki-Shampine 3(2) at tolerances 0.1-1 pixel angles, adaptive refinement), only BS3 at 0.1 passes
 * every Normal budget, and only for black holes (sky p99 0.08 px vs High's 0.25; emission L1 <= 1.8e-3; 1.19x High).
 * No candidate passes for the fuzzball, whose interior is chaotic: there Normal = High.
 * @type {Record<'BH'|'fuzzball', {bs3?: {tol:number, cap:number}|null, refine?: import('./refine.js').RefineParams|null}>}
 */
export const NORMAL = { BH: { bs3: { tol: 0.1, cap: 4 } }, fuzzball: {} };

/**
 * Tracing settings of a tier for a metric mode.
 * @param {Tier} tier @param {'BH'|'fuzzball'} mode
 * @returns {{eps:number, farSteps:{r:number, max:number}|null, maxSteps:number, refine:import('./refine.js').RefineParams|null, bs3:{tol:number, cap:number}|null}}
 */
export function tierSettings(tier, mode) {
  if (tier === 'reference') return { eps: 0.03, farSteps: null, maxSteps: mode === 'fuzzball' ? 10000 : 5000, refine: null, bs3: null };
  const high = { eps: 0.03, farSteps: { r: 20, max: 4 }, maxSteps: 5000, refine: null, bs3: null };
  if (tier === 'high') return high;
  return { ...high, bs3: NORMAL[mode].bs3 ?? null, refine: NORMAL[mode].refine ?? null };
}

/**
 * Pick a tier from probe timings. probeMs[t]: the time of a probe trace of `probeRays` rays at tier t (missing tiers are
 * predicted from High with the ratios given). The prediction scales to `rays` (the full image, all progressive levels).
 * @param {Partial<Record<Tier, number>>} probeMs @param {number} probeRays @param {number} rays @param {'BH'|'fuzzball'} mode
 * @returns {{tier: Tier, predictedS: Record<Tier, number>}}
 */
export function pickTier(probeMs, probeRays, rays, mode) {
  /** @type {Record<Tier, number>} */
  const predictedS = /** @type {any} */ ({});
  for (const t of TIERS) {
    const ms = probeMs[t] ?? (probeMs.high !== undefined ? probeMs.high / (t === 'normal' ? NORMAL_SPEEDUP[mode] : 1 / REFERENCE_SLOWDOWN[mode]) : NaN);
    predictedS[t] = (ms * rays) / probeRays / 1000;
  }
  const tier = TIERS.find((t) => predictedS[t] <= TIER_TARGET_S[mode]) ?? 'normal';
  return { tier, predictedS };
}

/** Reference / High time ratios (quality gate, B0/B6: High's speedup over Reference) */
export const REFERENCE_SLOWDOWN = { BH: 1.4, fuzzball: 1.6 };
/** Normal: share of the full level traced with adaptive refinement (B6: refinement is not in Normal, so 1) */
export const NORMAL_TRACED = { BH: 1, fuzzball: 1 };
/** Normal / High speedups (quality gate, B6: geometric means over the scene set) */
export const NORMAL_SPEEDUP = { BH: 1.19, fuzzball: 1 };
