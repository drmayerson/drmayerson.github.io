// Analytic Kerr (Boyer-Lindquist, M = 1): the validation and benchmarking path of the GPU tracer
// (plan Section 3.3). Provides the metric interface that common.glsl uses:
//   radiusOf, geodesicRHS, hamiltonianRel, crossingRedshift, nearSingularity.
// Radial coordinate x = log(r - r0); r0 = r_+ in app mode, 0 in FOORT parity mode (x = log r).
// Hamiltonian H = W / (2 Sigma) with
//   W = Delta p_r^2 + p_th^2 - R_t^2 / Delta + A^2 / sin^2(th),
//   R_t = (r^2 + a^2) p_t + a p_phi,  A = p_phi + a sin^2(th) p_t.
// The M0 benchmark shader uses the same formulas (bench/kerrBench.frag.glsl).
// Kerr is equatorially symmetric, so in the pole-distance state (delta, hemi) of common.glsl the
// equations are those in theta with theta := delta (every theta-odd term flips sign together with
// p_delta = hemi p_theta); hemi is not needed.

uniform vec4 uMetric;   // a, r0, 0, 0

float radiusOf(float x) { return uMetric.y + exp(x); }

void geodesicRHS(vec4 pos, vec2 mom, float hemi, float pt, float pphi, out vec4 dpos, out vec2 dmom) {
  float a = uMetric.x, a2 = a * a;
  float er = exp(pos.x);
  float r = uMetric.y + er;
  float pr = mom.x / er;
  float pth = mom.y;
  float s = sin(pos.y), c = cos(pos.y), s2 = s * s;
  float Sig = r * r + a2 * c * c;
  float Del = r * r - 2.0 * r + a2;
  float iS = 1.0 / Sig;
  float Rt = (r * r + a2) * pt + a * pphi;
  float A = pphi + a * s2 * pt;
  float W = Del * pr * pr + pth * pth - Rt * Rt / Del + A * A / s2;
  float drdl = Del * pr * iS;
  float dthdl = pth * iS;
  float dphdl = (-Rt * a / Del + A / s2) * iS;
  float dtdl = (-Rt * (r * r + a2) / Del + a * A) * iS;
  // written with Rt / Delta so that no intermediate exceeds ~r^2 (Delta^2 ~ r^4 overflows float32 at r ~ 1e7)
  float RtD = Rt / Del;
  float dWdr = (2.0 * r - 2.0) * pr * pr - 4.0 * r * pt * RtD + RtD * RtD * (2.0 * r - 2.0);
  float dWdth = 4.0 * a * A * c * pt / s - 2.0 * A * A * c / (s2 * s);
  float dprdl = -0.5 * iS * (dWdr - W * 2.0 * r * iS);
  float dpthdl = -0.5 * iS * (dWdth + W * 2.0 * a2 * s * c * iS);
  dpos = vec4(drdl / er, dthdl, dphdl, dtdl);
  dmom = vec2(dprdl * er + pr * drdl, dpthdl);
}

// |W| relative to the sum of the magnitudes of its terms (constraint drift, debug view).
float hamiltonianRel(vec4 pos, vec2 mom, float hemi, float pt, float pphi) {
  float a = uMetric.x, a2 = a * a;
  float er = exp(pos.x);
  float r = uMetric.y + er;
  float pr = mom.x / er;
  float s = sin(pos.y), s2 = s * s;
  float Del = r * r - 2.0 * r + a2;
  float Rt = (r * r + a2) * pt + a * pphi;
  float A = pphi + a * s2 * pt;
  float t1 = Del * pr * pr, t2 = mom.y * mom.y, t3 = Rt * Rt / Del, t4 = A * A / s2;
  return abs(t1 + t2 - t3 + t4) / (abs(t1) + t2 + abs(t3) + t4);
}

// Redshift g = 1 / (u^t (p_t + Omega p_phi)) (FOORT convention, past-pointing p with p_t = 1)
// of a prograde Keplerian emitter on the equator. M3 placeholder for the fluid model, which
// arrives in M5 (GeneralCircularRadialFluid table). 0 where no circular orbit exists (r <= r_photon).
float crossingRedshift(float r, float pt, float pphi) {
  float a = uMetric.x;
  float sr = sqrt(r);
  float q = r * sr - 3.0 * sr + 2.0 * a;
  if (q <= 0.0) return 0.0;
  float ut = (r * sr + a) / (pow(r, 0.75) * sqrt(q));
  float Om = 1.0 / (r * sr + a);
  return 1.0 / (ut * (pt + Om * pphi));
}

bool nearSingularity(float r, float delta, float hemi) { return false; }
