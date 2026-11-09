// @ts-check
// Stage 1B B5: metrics with a generated closed-form shader (shaders/glsl/closed/<id>.glsl, written by
// tools/codegen/gen_metrics.py from symbolic metrics). The shader replaces the table lookup of trace.glsl; this module
// gives its uniforms: uClosed (and uClosed2) = the parameters in the generator's order, uClosedD = derived constants.

/** @typedef {{params: string[], derived: (p: Record<string, number>) => number[], auto: boolean, note?: string}} ClosedFormSpec
 * auto: used by path 'auto' (the viewer's default). */

const horizonPair = (/** @type {number} */ q) => [1 + Math.sqrt(1 - q * q), 1 - Math.sqrt(1 - q * q)];

/** @type {Record<string, ClosedFormSpec>} */
export const CLOSED_FORMS = {
  // Kerr: the generated shader cross-checks the hand-written one (trace_kerr_analytic.glsl), which is 1.1-1.5x faster
  // and is what 'auto' uses
  kerr: { params: ['a'], derived: (p) => horizonPair(p.a), auto: false, note: 'auto uses the hand-written closed-form Kerr shader' },
  johannsen: { params: ['a', 'alpha13', 'alpha22', 'alpha52', 'eps3'], derived: (p) => horizonPair(p.a), auto: true },
  reissnerNordstrom: { params: ['Q'], derived: (p) => horizonPair(p.Q), auto: true },
  // Manko-Novikov: not safe in float32 next to its termination radius (just outside the CTC band: r = 1.51-1.8 for
  // a = 0.94, alpha3 = 2, 0.9% of the pixels wrong against the double CPU reference, which agrees with the tables on
  // every one of them; dev/reports/b5/referee_*.json). Plan 4.1-1: it keeps the tabulated path.
  mankoNovikov: {
    params: ['a', 'alpha3'],
    derived: (p) => [Math.sqrt(1 - p.a * p.a), p.a === 0 ? 0 : (-1 + Math.sqrt(1 - p.a * p.a)) / p.a],
    auto: false, note: 'float32 loses digits next to the termination radius: the tables (baked in double) are used',
  },
};

/** Derived constants by name (the generator's symbols), for the JS test mirrors. @param {string} id @param {Record<string, number>} p */
export function closedDerivedByName(id, p) {
  const names = { kerr: ['rp', 'rm'], johannsen: ['rp', 'rm'], reissnerNordstrom: ['rp', 'rm'], mankoNovikov: ['k', 'alpha'] }[id] ?? [];
  const d = CLOSED_FORMS[id].derived(p);
  return Object.fromEntries(names.map((n, i) => [n, d[i]]));
}

/**
 * Uniforms of the closed-form shader of metric `id` with parameters `p` (the metric's own params object).
 * @param {string} id @param {Record<string, number>} p
 * @returns {Record<string, ['4f', number[]]>}
 */
export function closedFormUniforms(id, p) {
  const s = CLOSED_FORMS[id];
  if (!s) throw new Error(`metric ${id} has no closed-form shader`);
  const vals = s.params.map((n) => p[n] ?? 0);
  const pad = (/** @type {number[]} */ a) => [...a, 0, 0, 0, 0].slice(0, 4);
  return { uClosed: ['4f', pad(vals.slice(0, 4))], uClosed2: ['4f', pad(vals.slice(4))], uClosedD: ['4f', pad(s.derived(p))] };
}
