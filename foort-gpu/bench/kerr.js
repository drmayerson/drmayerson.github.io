// @ts-check
// Closed-form Kerr in Boyer-Lindquist coordinates (M = 1), used only by the M0 benchmark
// to build the camera. The real metric library arrives in M1 (js/metrics/).

/** @param {number} a */
export const kerrHorizon = (a) => 1 + Math.sqrt(1 - a * a);

/** @param {number} a @param {number} r @param {number} th */
export function kerrGdd(a, r, th) {
  const s = Math.sin(th), c = Math.cos(th), s2 = s * s, a2 = a * a;
  const Sig = r * r + a2 * c * c, Del = r * r - 2 * r + a2;
  const gtt = -(1 - 2 * r / Sig);
  const gtp = -2 * a * r * s2 / Sig;
  const gpp = (r * r + a2 + 2 * a2 * r * s2 / Sig) * s2;
  return [[gtt, 0, 0, gtp], [0, Sig / Del, 0, 0], [0, 0, Sig, 0], [gtp, 0, 0, gpp]];
}

/** @param {number} a @param {number} r @param {number} th */
export function kerrGuu(a, r, th) {
  const s = Math.sin(th), c = Math.cos(th), s2 = s * s, a2 = a * a;
  const Sig = r * r + a2 * c * c, Del = r * r - 2 * r + a2;
  const gtt = -((r * r + a2) ** 2 - a2 * Del * s2) / (Sig * Del);
  const gtp = -2 * a * r / (Sig * Del);
  const gpp = (Del - a2 * s2) / (Sig * Del * s2);
  return [[gtt, 0, 0, gtp], [0, Del / Sig, 0, 0], [0, 0, 1 / Sig, 0], [gtp, 0, 0, gpp]];
}
