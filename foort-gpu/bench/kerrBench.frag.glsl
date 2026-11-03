#version 300 es
// M0 benchmark: minimal analytic-Kerr tracer, WebGL2 fragment-shader version.
// Kept structurally parallel to kerrBench.wgsl (same functions, same order, same math).
// Hamiltonian in (t, x = log(r - r_h), theta, phi), past-pointing p_t = +1, RK4,
// FOORT adaptive step (Integrators::GetAdaptiveStep), axis reflection.
precision highp float;
precision highp int;

uniform mat4 uE;        // camera vielbein, column a = leg a (contravariant)
uniform mat4 uG;        // g_dd at the camera
uniform vec4 uScreen;   // centerX, centerY, sizeX, sizeY
uniform vec4 uP0;       // a, r_h, r_cam, theta_cam
uniform vec4 uP1;       // eps, hmin, epsHorizon, rBoundary
uniform ivec4 uI;       // unused, unused, N, maxSteps

out vec4 outRec;        // termCode, nSteps, theta_end, phi_end

const float PI = 3.14159265358979;

// state: pos = (x, theta, phi, t), mom = (p_x, p_theta); constants pt, pphi
void rhs(vec4 pos, vec2 mom, float pt, float pphi, out vec4 dpos, out vec2 dmom) {
  float a = uP0.x, a2 = a * a;
  float er = exp(pos.x);
  float r = uP0.y + er;
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
  float dWdr = (2.0 * r - 2.0) * pr * pr - (4.0 * r * pt * Rt * Del - Rt * Rt * (2.0 * r - 2.0)) / (Del * Del);
  float dWdth = 4.0 * a * A * c * pt / s - 2.0 * A * A * c / (s2 * s);
  float dprdl = -0.5 * iS * (dWdr - W * 2.0 * r * iS);
  float dpthdl = -0.5 * iS * (dWdth + W * 2.0 * a2 * s * c * iS);
  dpos = vec4(drdl / er, dthdl, dphdl, dtdl);
  dmom = vec2(dprdl * er + pr * drdl, dpthdl);
}

float adaptiveStep(vec4 pos, vec4 v) {
  float eps = uP1.x;
  float d = 1e-20;
  float h1 = eps / (abs(v.x) + d);
  float h2 = eps * min(pos.y, PI - pos.y) / (abs(v.y) + d);
  float h3 = eps / (abs(v.z) + d);
  float h = 1.0 / (1.0 / abs(h1) + 1.0 / abs(h2) + 1.0 / abs(h3));
  return max(h, uP1.y);
}

void main() {
  int N = uI.z;
  vec2 unit = gl_FragCoord.xy / float(N);
  float alpha = uScreen.x + uScreen.z * (unit.x - 0.5);
  float beta = uScreen.y + uScreen.w * (unit.y - 0.5);

  float rc = uP0.z, thc = uP0.w;
  float D = sqrt(rc * rc + alpha * alpha + beta * beta);
  vec4 pflat = vec4(-1.0, -rc / D, -beta / rc / D, alpha / rc / sin(thc) / D);
  vec4 vup = uE * pflat;
  vec4 pdn = uG * vup;
  pdn /= pdn.x;
  float pt = pdn.x, pphi = pdn.w;

  vec4 pos = vec4(log(rc - uP0.y), thc, 0.0, 0.0);
  vec2 mom = vec2(pdn.y * (rc - uP0.y), pdn.z);

  float rH = uP0.y * (1.0 + uP1.z);
  float rB = uP1.w;
  int code = 3;
  int n = 0;
  for (n = 0; n < uI.w; n++) {
    vec4 k1p; vec2 k1m;
    rhs(pos, mom, pt, pphi, k1p, k1m);
    float h = adaptiveStep(pos, k1p);
    vec4 k2p; vec2 k2m;
    rhs(pos + 0.5 * h * k1p, mom + 0.5 * h * k1m, pt, pphi, k2p, k2m);
    vec4 k3p; vec2 k3m;
    rhs(pos + 0.5 * h * k2p, mom + 0.5 * h * k2m, pt, pphi, k3p, k3m);
    vec4 k4p; vec2 k4m;
    rhs(pos + h * k3p, mom + h * k3m, pt, pphi, k4p, k4m);
    pos += h / 6.0 * (k1p + 2.0 * k2p + 2.0 * k3p + k4p);
    mom += h / 6.0 * (k1m + 2.0 * k2m + 2.0 * k3m + k4m);

    if (pos.y < 0.0) { pos.y = -pos.y; pos.z += PI; mom.y = -mom.y; }
    if (pos.y > PI) { pos.y = 2.0 * PI - pos.y; pos.z += PI; mom.y = -mom.y; }

    float r = uP0.y + exp(pos.x);
    if (isnan(r) || isinf(r) || isnan(pos.y)) { code = 4; n++; break; }
    if (r < rH) { code = 1; n++; break; }
    if (r > rB) { code = 2; n++; break; }
  }
  float ph = mod(pos.z, 2.0 * PI);
  outRec = vec4(float(code), float(n), pos.y, ph);
}
