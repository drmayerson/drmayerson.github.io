// @ts-check
/**
 * General tetrad camera (double precision, DOM-free).
 *
 * `fromStaticObserver` is a faithful port of FOORT's ViewScreen::ConstructVielbein and
 * ViewScreen::SetNewInitialConditions (FOORT/src/ViewScreen.cpp): Gram-Schmidt starting
 * from d_t, then d_phi, then the gradient directions g^{r mu} and g^{theta mu}; the theta
 * and phi legs carry FOORT's extra factors r and r sin(theta), which the flat-frame
 * momentum divides out again. Coordinates are (t, r, theta, phi) with the true r.
 *
 * @typedef {number[][]} Mat4   row-major 4x4, Mat4[i][j]
 * @typedef {number[]} Vec4
 */

/** @param {Mat4} g @param {Vec4} u @param {Vec4} v */
export function innerProduct(g, u, v) {
  let s = 0;
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) s += u[i] * g[i][j] * v[j];
  return s;
}

/** @param {Vec4} u @param {number} c */
const scale = (u, c) => u.map((x) => x * c);
/** @param {Vec4} u @param {Vec4} v */
const sub = (u, v) => u.map((x, i) => x - v[i]);

export class TetradCamera {
  /**
   * @param {Vec4} position     (t, r, theta, phi)
   * @param {Vec4[]} vielbein   vielbein[a] = contravariant components of leg a
   * @param {Mat4} gdd          covariant metric at the camera
   * @param {string[]} warnings
   */
  constructor(position, vielbein, gdd, warnings = []) {
    this.position = position;
    this.vielbein = vielbein;
    this.gdd = gdd;
    this.warnings = warnings;
  }

  /**
   * Static observer at `position`, FOORT convention.
   * @param {Mat4} gdd  covariant metric at the camera, (t, r, theta, phi)
   * @param {Mat4} guu  inverse metric at the camera
   * @param {Vec4} position
   */
  static fromStaticObserver(gdd, guu, position) {
    const r = position[1];
    const th = position[2];
    const ip = (/** @type {Vec4} */ u, /** @type {Vec4} */ v) => innerProduct(gdd, u, v);
    const signs = [0, 0, 0, 0];
    const e = /** @type {Vec4[]} */ ([[], [], [], []]);

    e[0] = [1, 0, 0, 0];
    let n = ip(e[0], e[0]);
    signs[0] = n < 0 ? -1 : 1;
    e[0] = scale(e[0], 1 / Math.sqrt(signs[0] * n));

    e[3] = sub([0, 0, 0, 1], scale(e[0], signs[0] * ip([0, 0, 0, 1], e[0])));
    n = ip(e[3], e[3]);
    signs[3] = n < 0 ? -1 : 1;
    e[3] = scale(e[3], 1 / Math.sqrt(signs[3] * n));

    e[1] = sub(sub(guu[1], scale(e[0], signs[0] * ip(guu[1], e[0]))), scale(e[3], signs[3] * ip(guu[1], e[3])));
    n = ip(e[1], e[1]);
    signs[1] = n < 0 ? -1 : 1;
    e[1] = scale(e[1], 1 / Math.sqrt(signs[1] * n));

    e[2] = sub(sub(sub(guu[2], scale(e[0], signs[0] * ip(guu[2], e[0]))),
      scale(e[3], signs[3] * ip(guu[2], e[3]))), scale(e[1], signs[1] * ip(guu[2], e[1])));
    n = ip(e[2], e[2]);
    signs[2] = n < 0 ? -1 : 1;
    e[2] = scale(e[2], r / Math.sqrt(signs[2] * n));
    e[3] = scale(e[3], r * Math.sin(th));

    const warnings = [];
    if (signs[0] * signs[1] * signs[2] * signs[3] > 0) warnings.push('Vielbein does not have Lorentzian signature');
    if (signs[0] > 0) warnings.push('d_t is not timelike at the camera (ergoregion or horizon?)');
    return new TetradCamera(position, e, gdd, warnings);
  }

  /**
   * Flat-frame momentum for screen coordinates (alpha, beta), FOORT convention
   * (radially inward pointing camera only).
   * @param {number} alpha @param {number} beta
   * @returns {Vec4}
   */
  flatMomentum(alpha, beta) {
    const r = this.position[1];
    const s = Math.sin(this.position[2]);
    const D = Math.sqrt(r * r + alpha * alpha + beta * beta);
    return [-1, -r / D, -beta / r / D, alpha / r / s / D];
  }

  /**
   * Initial momentum of the (past-directed) null ray through screen point (alpha, beta).
   * @param {number} alpha @param {number} beta
   * @returns {{ up: Vec4, down: Vec4 }}  contravariant and covariant, normalized to p_t = +1
   */
  initialMomentum(alpha, beta) {
    const pf = this.flatMomentum(alpha, beta);
    let up = [0, 0, 0, 0];
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) up[i] += this.vielbein[j][i] * pf[j];
    let pt = 0;
    for (let i = 0; i < 4; i++) pt += this.gdd[0][i] * up[i];
    up = scale(up, 1 / pt);
    const down = [0, 0, 0, 0];
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) down[i] += this.gdd[i][j] * up[j];
    return { up, down };
  }

  /** Vielbein as a column-major Float32Array (column a = leg a), for mat4 uniforms. */
  vielbeinColumnMajor() {
    const m = new Float32Array(16);
    for (let a = 0; a < 4; a++) for (let i = 0; i < 4; i++) m[4 * a + i] = this.vielbein[a][i];
    return m;
  }
}
