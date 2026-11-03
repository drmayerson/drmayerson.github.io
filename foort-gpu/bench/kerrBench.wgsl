// M0 benchmark: minimal analytic-Kerr tracer, WebGPU compute-shader version.
// Kept structurally parallel to kerrBench.frag.glsl (same functions, same order, same math).
// Hamiltonian in (t, x = log(r - r_h), theta, phi), past-pointing p_t = +1, RK4,
// FOORT adaptive step (Integrators::GetAdaptiveStep), axis reflection.

struct Uniforms {
  E: mat4x4f,       // camera vielbein, column a = leg a (contravariant)
  G: mat4x4f,       // g_dd at the camera
  screen: vec4f,    // centerX, centerY, sizeX, sizeY
  p0: vec4f,        // a, r_h, r_cam, theta_cam
  p1: vec4f,        // eps, hmin, epsHorizon, rBoundary
  i: vec4u,         // tileX, tileY, N, maxSteps
};

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage, read_write> outRec: array<vec4f>;  // termCode, nSteps, theta_end, phi_end

const PI: f32 = 3.14159265358979;

struct Deriv { dpos: vec4f, dmom: vec2f };

// state: pos = (x, theta, phi, t), mom = (p_x, p_theta); constants pt, pphi
fn rhs(pos: vec4f, mom: vec2f, pt: f32, pphi: f32) -> Deriv {
  let a = u.p0.x; let a2 = a * a;
  let er = exp(pos.x);
  let r = u.p0.y + er;
  let pr = mom.x / er;
  let pth = mom.y;
  let s = sin(pos.y); let c = cos(pos.y); let s2 = s * s;
  let Sig = r * r + a2 * c * c;
  let Del = r * r - 2.0 * r + a2;
  let iS = 1.0 / Sig;
  let Rt = (r * r + a2) * pt + a * pphi;
  let A = pphi + a * s2 * pt;
  let W = Del * pr * pr + pth * pth - Rt * Rt / Del + A * A / s2;
  let drdl = Del * pr * iS;
  let dthdl = pth * iS;
  let dphdl = (-Rt * a / Del + A / s2) * iS;
  let dtdl = (-Rt * (r * r + a2) / Del + a * A) * iS;
  let dWdr = (2.0 * r - 2.0) * pr * pr - (4.0 * r * pt * Rt * Del - Rt * Rt * (2.0 * r - 2.0)) / (Del * Del);
  let dWdth = 4.0 * a * A * c * pt / s - 2.0 * A * A * c / (s2 * s);
  let dprdl = -0.5 * iS * (dWdr - W * 2.0 * r * iS);
  let dpthdl = -0.5 * iS * (dWdth + W * 2.0 * a2 * s * c * iS);
  return Deriv(vec4f(drdl / er, dthdl, dphdl, dtdl), vec2f(dprdl * er + pr * drdl, dpthdl));
}

fn adaptiveStep(pos: vec4f, v: vec4f) -> f32 {
  let eps = u.p1.x;
  let d = 1e-20;
  let h1 = eps / (abs(v.x) + d);
  let h2 = eps * min(pos.y, PI - pos.y) / (abs(v.y) + d);
  let h3 = eps / (abs(v.z) + d);
  let h = 1.0 / (1.0 / abs(h1) + 1.0 / abs(h2) + 1.0 / abs(h3));
  return max(h, u.p1.y);
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let N = u.i.z;
  let px = gid.x + u.i.x;
  let py = gid.y + u.i.y;
  if (px >= N || py >= N) { return; }
  // pixel centre, same convention as gl_FragCoord (+0.5)
  let unit = (vec2f(f32(px), f32(py)) + 0.5) / f32(N);
  let alpha = u.screen.x + u.screen.z * (unit.x - 0.5);
  let beta = u.screen.y + u.screen.w * (unit.y - 0.5);

  let rc = u.p0.z; let thc = u.p0.w;
  let D = sqrt(rc * rc + alpha * alpha + beta * beta);
  let pflat = vec4f(-1.0, -rc / D, -beta / rc / D, alpha / rc / sin(thc) / D);
  let vup = u.E * pflat;
  var pdn = u.G * vup;
  pdn = pdn / pdn.x;
  let pt = pdn.x; let pphi = pdn.w;

  var pos = vec4f(log(rc - u.p0.y), thc, 0.0, 0.0);
  var mom = vec2f(pdn.y * (rc - u.p0.y), pdn.z);

  let rH = u.p0.y * (1.0 + u.p1.z);
  let rB = u.p1.w;
  var code: u32 = 3u;
  var n: u32 = 0u;
  loop {
    if (n >= u.i.w) { break; }
    let k1 = rhs(pos, mom, pt, pphi);
    let h = adaptiveStep(pos, k1.dpos);
    let k2 = rhs(pos + 0.5 * h * k1.dpos, mom + 0.5 * h * k1.dmom, pt, pphi);
    let k3 = rhs(pos + 0.5 * h * k2.dpos, mom + 0.5 * h * k2.dmom, pt, pphi);
    let k4 = rhs(pos + h * k3.dpos, mom + h * k3.dmom, pt, pphi);
    pos += h / 6.0 * (k1.dpos + 2.0 * k2.dpos + 2.0 * k3.dpos + k4.dpos);
    mom += h / 6.0 * (k1.dmom + 2.0 * k2.dmom + 2.0 * k3.dmom + k4.dmom);

    if (pos.y < 0.0) { pos.y = -pos.y; pos.z += PI; mom.y = -mom.y; }
    if (pos.y > PI) { pos.y = 2.0 * PI - pos.y; pos.z += PI; mom.y = -mom.y; }

    n++;
    let r = u.p0.y + exp(pos.x);
    // WGSL has no isnan; NaN fails every comparison, inf fails the finite-range test
    if (!(r == r) || !(pos.y == pos.y) || !(abs(r) < 3.0e38)) { code = 4u; break; }
    if (r < rH) { code = 1u; break; }
    if (r > rB) { code = 2u; break; }
  }
  // GLSL mod semantics: x - y * floor(x / y)
  let ph = pos.z - 2.0 * PI * floor(pos.z / (2.0 * PI));
  outRec[py * N + px] = vec4f(f32(code), f32(n), pos.y, ph);
}
