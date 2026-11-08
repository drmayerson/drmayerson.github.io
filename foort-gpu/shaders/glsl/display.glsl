// Display pass (plan Section 3.8): every frame, reads the per-pixel record and draws a view.
// Disc emission (M5): I = sum_k F_k g_k^p J(r_k) over the stored crossings (js/fluid/emission.js), then
// exposure, tone mapping and a colour map; and the debug views.
// Time-dependent emission (M7): each crossing is multiplied by exp(sigma_n X - sigma_n^2 / 2), X the noise field at
// the crossing's emission time t_obs + dt_k ("slow light"; dt_k := 0 for fast light), x = log(r_k / M), phi_k.
// Progressive refinement: the levels (strides 1, 2, 4, 8) are separate smaller record images; the backend binds
// the (at most 3) levels of the current trace to slots S0..S2, finest first, and each pixel shows the finest slot
// that has traced it (steps > 0 after a clear).

uniform highp sampler2D uS0R0, uS0R1, uS0R2, uS0R3, uS0R4, uS0R5, uS1R0, uS1R1, uS1R2, uS1R3, uS1R4, uS1R5;
uniform ivec4 uLevels;  // log2(stride) of slots 0..1 (-1: unused)
uniform vec4 uTail;     // tail bins (Stage 1B B2): log r of the first edge, 1 / bin width, number of bins, on (1/0)
uniform highp sampler3D uNoise;   // X: texel (phi, x, t), R16F, linear, repeat in phi and t, clamp in x
uniform ivec4 uNoiseN;  // Nt, Nx, Nphi, noise on (1/0)
uniform vec4 uNoiseP;   // sigma_n, T_over_M, xmin, xmax
uniform vec4 uTime;     // t_obs / M, slow light (1/0), M_ADM, procedural advection duration D / M (0: off)
uniform highp sampler2D uFluidD;  // fluid table (1/u^t, u^r/u^t, Omega) (js/fluid/fluidTable.js), for advection
uniform vec4 uFluidXD;  // xMin, dx, nodes, r0 of the fluid table
uniform ivec4 uView;    // view mode, Nx, Ny, |H| stored in slot 3
uniform vec4 uRange;    // view range lo, hi; max steps; r_cam
uniform vec4 uEm;       // Johnson-SU mu, gamma, sigma; redshift power
uniform vec4 uEm2;      // fudge factor, max passes (0: no bound), exposure, tone map (0 linear, 1 sqrt, 2 log, 3 asinh)
uniform ivec4 uEm3;     // colour map (0 afmhot, 1 inferno, 2 grey), envelope radius (0 coordinate r, 1 circumferential, B3), 0, 0
out vec4 color;

const float PI = 3.14159265358979;
const int V_FOURCOLOR = 0, V_TERM = 1, V_STEPS = 2, V_G1 = 3, V_DT1 = 4, V_PASSES = 5, V_SKY = 6, V_HAM = 7, V_EMISSION = 8, V_NOISE = 9, V_DT21 = 10;

// FOORT FourColorScreen colours, as in the M0 benchmark
const vec3 Q1 = vec3(228.0, 74.0, 64.0) / 255.0, Q2 = vec3(64.0, 156.0, 228.0) / 255.0;
const vec3 Q3 = vec3(240.0, 200.0, 60.0) / 255.0, Q4 = vec3(90.0, 190.0, 110.0) / 255.0;

// inferno, piecewise linear through 7 samples of matplotlib's map
vec3 inferno(float t) {
  t = clamp(t, 0.0, 1.0) * 6.0;
  vec3 c0 = vec3(0.001, 0.000, 0.014), c1 = vec3(0.159, 0.044, 0.329), c2 = vec3(0.397, 0.083, 0.433);
  vec3 c3 = vec3(0.623, 0.164, 0.388), c4 = vec3(0.831, 0.283, 0.259), c5 = vec3(0.962, 0.512, 0.054);
  vec3 c6 = vec3(0.988, 0.998, 0.645);
  if (t < 1.0) return mix(c0, c1, t);
  if (t < 2.0) return mix(c1, c2, t - 1.0);
  if (t < 3.0) return mix(c2, c3, t - 2.0);
  if (t < 4.0) return mix(c3, c4, t - 3.0);
  if (t < 5.0) return mix(c4, c5, t - 4.0);
  return mix(c5, c6, t - 5.0);
}

vec3 termColor(int code) {
  if (code == 1) return vec3(0.0);                 // horizon
  if (code == 2) return vec3(0.55, 0.75, 0.95);    // boundary (escaped)
  if (code == 3) return vec3(0.95, 0.55, 0.15);    // time out
  if (code == 4) return vec3(1.0, 0.0, 1.0);       // NaN
  if (code == 6) return vec3(0.7, 0.05, 0.05);     // singularity
  return vec3(0.5);
}

vec3 quadrantColor(float th, float ph) {
  if (th < 0.5 * PI) return ph < PI ? Q1 : Q2;
  return ph < PI ? Q3 : Q4;
}

float envelopeR(float r);
// FOORT GLMJohnsonSUEmission (true r; or the circumferential radius, Stage 1B B3)
float johnsonSU(float rr) {
  float r = envelopeR(rr);
  float d = r - uEm.x, t = uEm.y + asinh(d / uEm.z);
  return exp(-0.5 * t * t) / sqrt(d * d + uEm.z * uEm.z);
}
// noise field at (tau, x, phi) (js/noise/noiseField.js sampleNoise / noiseTexCoord)
float noiseX(float tau, float x, float phi) {
  vec3 n = vec3(uNoiseN.zyx);
  vec3 uvw = vec3(phi / (2.0 * PI) + 0.5 / n.x, ((x - uNoiseP.z) / (uNoiseP.w - uNoiseP.z) * (n.y - 1.0) + 0.5) / n.y, tau / uNoiseP.y + 0.5 / n.z);
  return texture(uNoise, uvw).r;
}
// fluid angular velocity Omega(r) (coordinate, d phi / dt), linear in the table as the tracer's fluidRedshift
float fluidOmega(float r) {
  float f = clamp((log(r - uFluidXD.w) - uFluidXD.x) / uFluidXD.y, 0.0, uFluidXD.z - 1.0);
  int i = min(int(floor(f)), int(uFluidXD.z) - 2);
  return mix(texelFetch(uFluidD, ivec2(i, 0), 0).z, texelFetch(uFluidD, ivec2(i + 1, 0), 0).z, f - float(i));
}
// the radius the Johnson-SU envelope sees: coordinate r, or sqrt(g_phiphi) from the fluid table's 4th channel
float envelopeR(float r) {
  if (uEm3.y == 0) return r;
  float f = clamp((log(r - uFluidXD.w) - uFluidXD.x) / uFluidXD.y, 0.0, uFluidXD.z - 1.0);
  int i = min(int(floor(f)), int(uFluidXD.z) - 2);
  return mix(texelFetch(uFluidD, ivec2(i, 0), 0).w, texelFetch(uFluidD, ivec2(i + 1, 0), 0).w, f - float(i));
}
// exp(sigma X - sigma^2 / 2) at a crossing (r, phi, dt, g); with procedural advection two copies of the field,
// rotated with the fluid since the last reset of their phase (period D, offset D/2), are crossfaded with
// variance-preserving weights (the flow-map trick)
float noiseFactor(vec4 c) {
  if (uNoiseN.w == 0 || uNoiseP.x == 0.0) return 1.0;
  float M = uTime.z;
  float tau = uTime.x + (uTime.y > 0.5 ? c.z / M : 0.0);
  float x = log(c.x / M);
  float X;
  if (uTime.w > 0.0) {
    float D = uTime.w, om = fluidOmega(c.x) * M;   // Omega in units of 1/M
    float fa = fract(tau / D), fb = fract(tau / D + 0.5);
    float wa = 1.0 - abs(2.0 * fa - 1.0), wb = 1.0 - wa;
    float Xa = noiseX(tau, x, c.y - om * fa * D), Xb = noiseX(tau, x, c.y - om * fb * D);
    X = (wa * Xa + wb * Xb) / sqrt(wa * wa + wb * wb);
  } else X = noiseX(tau, x, c.y);
  float sg = uNoiseP.x;
  return exp(sg * X - 0.5 * sg * sg);
}
// one crossing (r, phi, dt, g) of pass k (0-based)
float passEmission(vec4 c, int k) {
  if (!(c.x > 0.0) || !(c.w > 0.0)) return 0.0;
  if (uEm2.y > 0.0 && float(k + 1) > uEm2.y) return 0.0;
  return (k == 0 ? 1.0 : uEm2.x) * pow(c.w, uEm.w) * johnsonSU(c.x) * noiseFactor(c);
}
vec3 afmhot(float t) { t = clamp(t, 0.0, 1.0); return clamp(vec3(2.0 * t, 2.0 * t - 0.5, 2.0 * t - 1.0), 0.0, 1.0); }

// texel of slot l (stride 2^uLevels[l]) covering full-resolution pixel p
ivec2 levelTexel(ivec2 p, int l) {
  int sh = uLevels[l];
  ivec2 n = (uView.yz + (1 << sh) - 1) >> sh;
  return ivec2((vec2(p) + 0.5) / vec2(uView.yz) * vec2(n));
}
vec4 rec0(int l, ivec2 q) { return l == 0 ? texelFetch(uS0R0, q, 0) : texelFetch(uS1R0, q, 0); }
vec4 rec1(int l, ivec2 q) { return l == 0 ? texelFetch(uS0R1, q, 0) : texelFetch(uS1R1, q, 0); }
vec4 rec2(int l, ivec2 q) { return l == 0 ? texelFetch(uS0R2, q, 0) : texelFetch(uS1R2, q, 0); }
vec4 rec3(int l, ivec2 q) { return l == 0 ? texelFetch(uS0R3, q, 0) : texelFetch(uS1R3, q, 0); }
vec4 rec4(int l, ivec2 q) { return l == 0 ? texelFetch(uS0R4, q, 0) : texelFetch(uS1R4, q, 0); }
vec4 rec5(int l, ivec2 q) { return l == 0 ? texelFetch(uS0R5, q, 0) : texelFetch(uS1R5, q, 0); }

// the binned tail (crossings 4, 5, ...): sum_b W_b J(r_b), r_b at the bin's emission-weighted centroid, decoded from the
// packed float (js/gpu/traceConfig.js decodeTail); no noise and no slow light (their average over many crossings is 1)
float tailBin(float v, int b) {
  uint bits = floatBitsToUint(v);
  float W = uintBitsToFloat(bits & 0xFFFFFF00u);
  if (!(W > 0.0)) return 0.0;
  float f = float(bits & 0xFFu) / 255.0;
  return W * johnsonSU(exp(uTail.x + (float(b) + f) / uTail.y));
}
float tailEmission(int l, ivec2 q) {
  if (uTail.w < 0.5) return 0.0;
  vec4 a = rec4(l, q), c = rec5(l, q);
  return tailBin(a.x, 0) + tailBin(a.y, 1) + tailBin(a.z, 2) + tailBin(a.w, 3) + tailBin(c.x, 4) + tailBin(c.y, 5) + tailBin(c.z, 6) + tailBin(c.w, 7);
}

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  int lv = -1;
  ivec2 q;
  vec4 r0;
  for (int l = 0; l < 2; l++) {
    if (uLevels[l] < 0) break;
    q = levelTexel(p, l);
    r0 = rec0(l, q);
    if (r0.y > 0.0) { lv = l; break; }
  }
  if (lv < 0) { color = vec4(0.08, 0.08, 0.1, 1.0); return; }
  int packed = int(r0.x + 0.5);
  int code = packed % 16, passes = packed / 16;
  float th = r0.z, ph = r0.w;
  int mode = uView.x;
  vec3 c = vec3(0.0);
  if (mode == V_FOURCOLOR) {
    c = code == 2 ? quadrantColor(th, ph) : (code == 1 ? vec3(0.0) : termColor(code));
  } else if (mode == V_TERM) {
    c = termColor(code);
  } else if (mode == V_STEPS) {
    c = inferno(log(r0.y) / log(max(uRange.z, 2.0)));
  } else if (mode == V_G1 || mode == V_DT1) {
    vec4 c1 = rec1(lv, q);
    if (c1.x <= 0.0) c = vec3(0.05, 0.1, 0.25);
    else {
      // dt_1 relative to the straight-line travel time from the emission radius: -dt - (r_cam - r_1)
      float v = mode == V_G1 ? c1.w : -c1.z - (uRange.w - c1.x);
      c = inferno((v - uRange.x) / (uRange.y - uRange.x));
    }
  } else if (mode == V_PASSES) {
    c = passes == 0 ? vec3(0.0) : passes == 1 ? vec3(0.25, 0.45, 0.85) : passes == 2 ? vec3(0.95, 0.6, 0.2) : vec3(1.0);
  } else if (mode == V_SKY) {
    // escape direction on a 15-degree latitude-longitude grid, tinted by FOORT quadrant
    if (code != 2) c = code == 1 ? vec3(0.0) : termColor(code);
    else {
      float cell = PI / 12.0;
      float chk = mod(floor(th / cell) + floor(ph / cell), 2.0);
      vec2 f = abs(fract(vec2(th, ph) / cell + 0.5) - 0.5) * cell;   // distance to the grid lines (rad)
      float w = min(fwidth(th) + fwidth(ph), 0.1 * cell) + 1e-4;   // capped: ph jumps at the 2 pi wrap
      float line = 1.0 - smoothstep(0.0, 1.5 * w, min(f.x, f.y));
      c = mix(quadrantColor(th, ph) * (0.55 + 0.45 * chk), vec3(1.0), 0.8 * line);
    }
  } else if (mode == V_EMISSION) {
    float I = passEmission(rec1(lv, q), 0) + passEmission(rec2(lv, q), 1) + (uView.w == 1 ? 0.0 : passEmission(rec3(lv, q), 2)) + tailEmission(lv, q);
    float v = max(I * uEm2.z, 0.0);
    int tm = int(uEm2.w + 0.5);
    if (tm == 1) v = sqrt(v);
    else if (tm == 2) v = log(1.0 + 99.0 * v) / log(100.0);
    else if (tm == 3) v = asinh(30.0 * v) / asinh(30.0);
    c = uEm3.x == 0 ? afmhot(v) : uEm3.x == 1 ? inferno(v) : vec3(clamp(v, 0.0, 1.0));
  } else if (mode == V_NOISE) {
    // the noise X at crossing 1 (as sampled for the emission), grey = 0.5 + X / 8 (tests read it back)
    vec4 c1 = rec1(lv, q);
    if (c1.x <= 0.0 || uNoiseN.w == 0) c = vec3(0.0, 0.0, 0.3);
    else {
      float M = uTime.z, tau = uTime.x + (uTime.y > 0.5 ? c1.z / M : 0.0);
      c = vec3(clamp(0.5 + noiseX(tau, log(c1.x / M), c1.y) / 8.0, 0.0, 1.0));
    }
  } else if (mode == V_DT21) {
    // delay of the n = 1 image behind the direct image, (dt_1 - dt_2) / M, on the colour range
    vec4 c1 = rec1(lv, q), c2 = rec2(lv, q);
    if (c2.x <= 0.0) c = vec3(0.05, 0.1, 0.25);
    else c = inferno(((c1.z - c2.z) / uTime.z - uRange.x) / (uRange.y - uRange.x));
  } else if (mode == V_HAM) {
    if (uView.w == 0) c = vec3(0.3);
    else {
      float hv = rec3(lv, q).x;
      c = inferno((log(max(hv, 1e-12)) / log(10.0) - uRange.x) / (uRange.y - uRange.x));
    }
  }
  color = vec4(c, 1.0);
}
