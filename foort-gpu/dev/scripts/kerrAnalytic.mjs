// Analytic Kerr references for the Level 3 checks (M = 1, double precision):
//  - conserved quantities (lambda, eta) of a pixel's ray and an exact capture test from the
//    radial potential R(r) (equivalent to the Bardeen critical curve, valid at any camera distance);
//  - kerrCore: a double-precision port of the analytic ray map of zwart-gat-camera/index.html
//    (kerrCore, Carlson elliptic integrals; Gralla-Lupsasca 2020 "case 2" rays), giving the
//    asymptotic source direction of a ray from a distant observer.
// zwart-gat-camera itself is not modified; this file lives in foort-gpu/dev only.

/** Carlson R_F, iterated to convergence. */
export function RF(x, y, z) {
  for (let i = 0; i < 40; i++) {
    const mu = (x + y + z) / 3;
    const X = 1 - x / mu, Y = 1 - y / mu, Z = 1 - z / mu;
    if (Math.max(Math.abs(X), Math.abs(Y), Math.abs(Z)) < 1e-4) {
      const E2 = X * Y - Z * Z, E3 = X * Y * Z;
      return (1 - E2 / 10 + E3 / 14 + E2 * E2 / 24 - 3 * E2 * E3 / 44) / Math.sqrt(mu);
    }
    const sx = Math.sqrt(x), sy = Math.sqrt(y), sz = Math.sqrt(z);
    const l = sx * (sy + sz) + sy * sz;
    x = (x + l) / 4; y = (y + l) / 4; z = (z + l) / 4;
  }
  return NaN;
}

function RC(x, y) {
  const q = x / y, t = 1 - q;
  let g;
  if (Math.abs(t) < 1e-3) g = 1 + t * (1 / 6 + t * (3 / 40 + t * (5 / 112 + t * (35 / 1152 + t * (63 / 2816)))));
  else if (t > 0) g = Math.acos(Math.sqrt(q)) / Math.sqrt(t);
  else { const v = Math.sqrt(-t); g = Math.log(v + Math.sqrt(q)) / v; }
  return g / Math.sqrt(y);
}

/** Carlson R_J, p > 0, iterated to convergence. */
export function RJ(x, y, z, p) {
  let s = 0, fac = 1;
  for (let i = 0; i < 40; i++) {
    const mu = (x + y + z + 2 * p) / 5;
    const X = (mu - x) / mu, Y = (mu - y) / mu, Z = (mu - z) / mu, P = (mu - p) / mu;
    if (Math.max(Math.abs(X), Math.abs(Y), Math.abs(Z), Math.abs(P)) < 1e-4) {
      const ea = X * (Y + Z) + Y * Z, eb = X * Y * Z, ec = P * P;
      const e2 = ea - 3 * ec, e3 = eb + 2 * P * (ea - ec);
      const e4 = (2 * eb + P * (ea - 3 * ec)) * P, e5 = eb * ec;
      const S = 1 - 3 * e2 / 14 + e3 / 6 + 9 * e2 * e2 / 88 - 3 * e4 / 22 - 9 * e2 * e3 / 52 + 3 * e5 / 26;
      return 3 * s + fac * S / (mu * Math.sqrt(mu));
    }
    const sx = Math.sqrt(x), sy = Math.sqrt(y), sz = Math.sqrt(z);
    const l = sx * (sy + sz) + sy * sz;
    const al = p * (sx + sy + sz) + sx * sy * sz;
    s += fac * RC(al * al, p * (p + l) * (p + l));
    fac /= 4;
    x = (x + l) / 4; y = (y + l) / 4; z = (z + l) / 4; p = (p + l) / 4;
  }
  return NaN;
}

const kPi = (n, eps, phi, m) => {
  const s = Math.sin(phi), c = Math.cos(phi), s2 = s * s, c2 = c * c, d = 1 - m * s2;
  return s * RF(c2, d, 1) + (n / 3) * s * s2 * RJ(c2, d, 1, c2 + eps * s2);
};
const kPiC = (n, eps, m) => RF(0, 1 - m, 1) + (n / 3) * RJ(0, 1 - m, 1, eps);

/** Jacobi amplitude am(u|m) for m <= 0 via the descending AGM (as in zwart-gat-camera, more stages). */
function amNeg(u, m) {
  const q = Math.sqrt(1 - m), mu = -m / (1 - m);
  const a = [1], b = [Math.sqrt(1 - mu)], c = [0];
  for (let k = 0; k < 12; k++) { a.push((a[k] + b[k]) / 2); c.push((a[k] - b[k]) / 2); b.push(Math.sqrt(a[k] * b[k])); }
  const n = a.length - 1;
  let ph = 2 ** n * a[n] * u * q;
  for (let k = n; k >= 1; k--) ph = 0.5 * (ph + Math.asin(Math.max(-1, Math.min(1, c[k] / a[k] * Math.sin(ph)))));
  const j = Math.floor(ph / Math.PI + 0.5), r = ph - j * Math.PI;
  return j * Math.PI + Math.atan2(Math.sin(r), q * Math.cos(r));
}

/** Gauss-Legendre nodes/weights on [0, 1], n = 32. */
const GL = (() => {
  const n = 32, x = [], w = [];
  for (let i = 1; i <= n; i++) {
    let z = Math.cos(Math.PI * (i - 0.25) / (n + 0.5)), pp = 0;
    for (let it = 0; it < 100; it++) {
      let p1 = 1, p2 = 0;
      for (let j = 1; j <= n; j++) { const p3 = p2; p2 = p1; p1 = ((2 * j - 1) * z * p2 - (j - 1) * p3) / j; }
      pp = n * (z * p1 - p2) / (z * z - 1);
      const z1 = z; z = z1 - p1 / pp;
      if (Math.abs(z - z1) < 1e-15) break;
    }
    x.push((1 - z) / 2); w.push(1 / ((1 - z * z) * pp * pp));
  }
  return { x, w };
})();

/** Radial roots of R(r) = r^4 + A r^2 + B r + C (Ferrari, as in kerrCore). */
export function radialRoots(a, lam, eta) {
  const A = a * a - eta - lam * lam, B = 2 * (eta + (lam - a) ** 2), C = -a * a * eta;
  const P = -A * A / 12 - C, Q = -A / 3 * ((A / 6) ** 2 - C) - B * B / 8;
  const disc = (P / 3) ** 3 + (Q / 2) ** 2;
  let s3;
  if (disc >= 0) { const sd = Math.sqrt(disc); s3 = Math.cbrt(-Q / 2 + sd) + Math.cbrt(-Q / 2 - sd); }
  else s3 = 2 * Math.sqrt(-P / 3) * Math.cos(Math.atan2(Math.sqrt(-disc), -Q / 2) / 3);
  const z2 = s3 / 2 - A / 6, z = Math.sqrt(Math.max(z2, 1e-300));
  const ip = -A / 2 - z2 + B / (4 * z), im = -A / 2 - z2 - B / (4 * z);
  if (im < 0) return null;                       // r3, r4 complex
  const sip = Math.sqrt(Math.max(ip, 0)), sim = Math.sqrt(im);
  return { r1: -z - sip, r2: -z + sip, r3: z - sim, r4: z + sim };
}

/**
 * Conserved quantities of a past-directed ray with covariant momentum `down` (p_t = 1, FOORT camera):
 * the future-directed photon has E = 1, L = -p_phi, so lambda = -p_phi; eta = Carter Q / E^2.
 */
export function conserved(a, theta, down) {
  const lam = -down[3], pth = down[2], c = Math.cos(theta), s = Math.sin(theta);
  return { lam, eta: pth * pth - c * c * (a * a - lam * lam / (s * s)), pthSign: Math.sign(pth) };
}

/** Exact capture test: no radial turning point outside the horizon. */
export function capturedAnalytic(a, lam, eta) {
  const rp = 1 + Math.sqrt(1 - a * a);
  if (eta <= 0 && !(Math.abs(lam) > 0)) return true;
  const rr = radialRoots(a, lam, eta);
  return !rr || rr.r4 <= rp;
}

/**
 * kerrCore (zwart-gat-camera) in double: distant observer at inclination (cth, sth), Bardeen (al, be).
 * Returns null if the ray comes from the horizon, else { cths, phs } with phs = phi_s - phi_o.
 */
export function kerrCore(al, be, a, cth, sth) {
  const lam = -al * sth;
  const eta = (al * al - a * a) * cth * cth + be * be;
  if (eta <= 0) return null;
  const rr = radialRoots(a, lam, eta);
  const rp = 1 + Math.sqrt(1 - a * a), rm = a * a / rp;
  if (!rr || rr.r4 <= rp) return null;
  const { r1, r2, r3, r4 } = rr;
  const r31 = r3 - r1, r41 = r4 - r1, r42 = r4 - r2, r43 = r4 - r3;
  const sq = Math.sqrt(r31 * r42), sphi = Math.sqrt(r31 / r41), c2r = r43 / r41, dr = r43 / r42;
  const Fi = sphi * RF(c2r, dr, 1);
  const Ir = 4 * Fi / sq;
  let Iphi;
  if (r3 < 0.9 * r4) {
    Iphi = 0;
    for (let k = 0; k < GL.x.length; k++) {
      const t = GL.x[k], u = (1 - t * t) / r4;
      const num = (2 - a * lam * u) * u * 2 / r4;
      const den = (1 - 2 * u + a * a * u * u) * Math.sqrt((1 - r1 * u) * (1 - r2 * u) * (r43 + r3 * t * t) / r4);
      Iphi += GL.w[k] * num / den;
    }
    Iphi *= 2 * a;
  } else {
    const s3p = sphi ** 3, rp3 = rp - r3, rp4 = rp - r4, rm3 = rm - r3, rm4 = rm - r4;
    const Pip = Fi + (rp3 * r41 / (rp4 * r31) / 3) * s3p * RJ(c2r, dr, 1, r43 / (r4 - rp));
    const Ip = 2 * (-(2 / sq) * (r43 / (rp3 * rp4)) * Pip - (2 / sq) * Fi / rp3);
    const Pim = Fi + (rm3 * r41 / (rm4 * r31) / 3) * s3p * RJ(c2r, dr, 1, r43 / (r4 - rm));
    const Im = 2 * (-(2 / sq) * (r43 / (rm3 * rm4)) * Pim - (2 / sq) * Fi / rm3);
    Iphi = (2 * a / (rp - rm)) * ((rp - a * lam / 2) * Ip - (rm - a * lam / 2) * Im);
  }
  const w = (a * a - eta - lam * lam) / 2, wm = w - Math.sqrt(w * w + a * a * eta);
  const up = -eta / wm, eps = lam * lam / (a * a - wm), km = a * a * up / wm, s = Math.sqrt(-wm);
  const sgb = be >= 0 ? 1 : -1;
  const sno = cth / Math.sqrt(up);
  const co2 = (sth * sth * be * be) / ((a * a * cth * cth - wm) * up);
  const dno = 1 - km * sno * sno;
  const Fo = sno * RF(co2, dno, 1);
  const PiO = Fo + (up / 3) * sno ** 3 * RJ(co2, dno, 1, co2 + eps * sno * sno);
  const PiC = kPiC(up, eps, km);
  const Psi = amNeg(Fo + sgb * s * Ir, km);
  const j = Math.floor(Psi / Math.PI + 0.5);
  const PiPsi = 2 * j * PiC + kPi(up, eps, Psi - j * Math.PI, km);
  const Gphi = sgb * (PiPsi - PiO) / s;
  return { cths: Math.sqrt(up) * Math.sin(Psi), phs: -(Iphi + lam * Gphi) };
}
