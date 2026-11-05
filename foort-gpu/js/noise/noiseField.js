// @ts-check
// Noise-field contract (plan Section 3.9): noise/<name>.json (metadata) + noise/<name>.bin (little-endian float16
// or float32, shape (Nt, Nx, Nphi), C order), a zero-mean, unit-variance field X(t, x, phi) with x = log(r / M),
// periodic in t (period T_over_M, in units of M) and phi. The GPU samples it as a half-float 3D texture with
// hardware linear filtering (repeat in t and phi, clamp in x); sampleNoise is the same trilinear rule in double,
// for the tests. Pure math apart from loadNoiseField (fetch), DOM-free.

/**
 * @typedef {Object} NoiseMeta
 * @property {number} Nt @property {number} Nx @property {number} Nphi
 * @property {number} T_over_M  period in t, units of M
 * @property {number} xmin @property {number} xmax   x = log(r / M) of the first and last x samples
 * @property {string} x_def
 * @property {{t:boolean, phi:boolean}} periodic
 * @property {'float16'|'float32'} [dtype]  (default float16)
 *
 * @typedef {Object} NoiseField
 * @property {NoiseMeta} meta
 * @property {Uint16Array} half     float16 bits, (t, x, phi) C order: texel (phi, x, t) of the 3D texture
 * @property {Float32Array} values  the same values as float32
 */

/** float16 bits -> number. @param {number} h */
export function halfToFloat(h) {
  const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 0x1f, f = h & 0x3ff;
  if (e === 0) return s * f * 2 ** -24;
  if (e === 31) return f ? NaN : s * Infinity;
  return s * (1 + f / 1024) * 2 ** (e - 15);
}

/** number -> float16 bits (round to nearest even). @param {number} v */
export function floatToHalf(v) {
  const f32 = new Float32Array([v]), u = new Uint32Array(f32.buffer)[0];
  const s = (u >> 16) & 0x8000, e = ((u >> 23) & 0xff) - 127 + 15;
  let m = u & 0x7fffff;
  if (e >= 31) return s | 0x7c00 | (Number.isNaN(v) ? 0x200 : 0);
  if (e <= 0) {
    if (e < -10) return s;
    m |= 0x800000;
    const shift = 14 - e, half = m >> shift, rem = m & ((1 << shift) - 1), mid = 1 << (shift - 1);
    return s | (half + (rem > mid || (rem === mid && half & 1) ? 1 : 0));
  }
  const half = (e << 10) | (m >> 13), rem = m & 0x1fff;
  return s | (half + (rem > 0x1000 || (rem === 0x1000 && half & 1) ? 1 : 0));
}

/**
 * Parse and validate a field from its metadata and binary contents.
 * @param {NoiseMeta} meta @param {ArrayBuffer} buf
 * @returns {NoiseField}
 */
export function parseNoiseField(meta, buf) {
  for (const k of /** @type {const} */ (['Nt', 'Nx', 'Nphi'])) if (!(Number.isInteger(meta[k]) && meta[k] >= 2)) throw new Error(`noise field: ${k} must be an integer >= 2`);
  if (!(meta.T_over_M > 0)) throw new Error('noise field: T_over_M must be > 0');
  if (!(meta.xmax > meta.xmin)) throw new Error('noise field: xmax must exceed xmin');
  if (meta.x_def && meta.x_def !== 'log(r/M)') throw new Error(`noise field: x_def ${meta.x_def} (expected log(r/M))`);
  if (meta.periodic && !(meta.periodic.t && meta.periodic.phi)) throw new Error('noise field: must be periodic in t and phi');
  const n = meta.Nt * meta.Nx * meta.Nphi, dtype = meta.dtype ?? 'float16';
  const bytes = dtype === 'float32' ? 4 : 2;
  if (buf.byteLength !== n * bytes) throw new Error(`noise field: ${buf.byteLength} bytes, expected ${n * bytes} (${meta.Nt} x ${meta.Nx} x ${meta.Nphi} ${dtype})`);
  const dv = new DataView(buf);
  const half = new Uint16Array(n), values = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if (bytes === 2) { half[i] = dv.getUint16(2 * i, true); values[i] = halfToFloat(half[i]); }
    else { values[i] = dv.getFloat32(4 * i, true); half[i] = floatToHalf(values[i]); if (bytes === 4) values[i] = halfToFloat(half[i]); }
  }
  return { meta: { ...meta, dtype }, half, values };
}

/**
 * Fetch a field from a folder URL (default: the app's noise/ folder).
 * @param {string} name @param {string} [base]
 */
export async function loadNoiseField(name, base = new URL('../../noise/', import.meta.url).href) {
  const [mr, br] = await Promise.all([fetch(new URL(`${name}.json`, base)), fetch(new URL(`${name}.bin`, base))]);
  if (!mr.ok || !br.ok) throw new Error(`noise field ${name}: not found (${mr.status}, ${br.status})`);
  return parseNoiseField(await mr.json(), await br.arrayBuffer());
}

/**
 * X(tau, x, phi) with the GPU's rule: texel centres at the samples, trilinear, repeat in t and phi, clamp in x.
 * @param {NoiseField} F @param {number} tau  time in units of M @param {number} x  log(r / M) @param {number} phi
 */
export function sampleNoise(F, tau, x, phi) {
  const { Nt, Nx, Nphi, T_over_M, xmin, xmax } = F.meta;
  const ut = (tau / T_over_M) * Nt, up = (phi / (2 * Math.PI)) * Nphi;
  const ux = Math.min(Math.max((x - xmin) / (xmax - xmin) * (Nx - 1), 0), Nx - 1);
  const t0 = Math.floor(ut), p0 = Math.floor(up), x0 = Math.min(Math.floor(ux), Nx - 2);
  const ft = ut - t0, fp = up - p0, fx = ux - x0;
  const wrap = (/** @type {number} */ i, /** @type {number} */ n) => ((i % n) + n) % n;
  const at = (/** @type {number} */ t, /** @type {number} */ xi, /** @type {number} */ p) => F.values[(wrap(t, Nt) * Nx + xi) * Nphi + wrap(p, Nphi)];
  let v = 0;
  for (const [dt, wt] of [[0, 1 - ft], [1, ft]]) for (const [dx, wx] of [[0, 1 - fx], [1, fx]]) for (const [dp, wp] of [[0, 1 - fp], [1, fp]])
    v += wt * wx * wp * at(t0 + dt, x0 + dx, p0 + dp);
  return v;
}

/**
 * Texture coordinates of (tau, x, phi) for the 3D texture (s = phi, t = x, r = time), texel centres at the samples:
 * the same mapping as shaders/glsl/display.glsl noiseX. @param {NoiseMeta} m @param {number} tau @param {number} x @param {number} phi
 */
export function noiseTexCoord(m, tau, x, phi) {
  return [phi / (2 * Math.PI) + 0.5 / m.Nphi, ((x - m.xmin) / (m.xmax - m.xmin) * (m.Nx - 1) + 0.5) / m.Nx, tau / m.T_over_M + 0.5 / m.Nt];
}
