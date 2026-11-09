// Shared GPU tracer core (plan Sections 3.5-3.8): FOORT static-observer camera, RK4 with FOORT's
// adaptive step, axis reflection, terminations, equatorial crossings and the 16-float record.
// Same algorithm and order of operations as js/ref/cpuTracer.js (app mode, plus FOORT crossings).
//
// Polar coordinate in float32: the state holds the distance to the nearer pole, delta in [0, pi/2],
// and the hemisphere sign hemi (+1: theta = delta, -1: theta = pi - delta), with p_delta = hemi p_theta.
// theta itself near pi has a float32 spacing of 2.4e-7, which destroys rays passing close to the
// south pole (they freeze or swing the wrong way); delta is dense at both poles. Crossing the
// axis is delta -> -delta (both poles alike), crossing the equator flips hemi.
//
// The metric file concatenated before this one provides (theta-like arguments are delta, hemi):
//   float radiusOf(float x);
//   void  geodesicRHS(vec4 pos, vec2 mom, float hemi, float pt, float pphi, out vec4 dpos, out vec2 dmom, out vec2 dmomQ);
//         (dmomQ: the part of dmom from the p_x^2, p_delta^2 terms, used by the constraint projection; may be 0 if unused)
//   float hamiltonianRel(vec4 pos, vec2 mom, float hemi, float pt, float pphi);
//   bool  nearSingularity(float r, float delta, float hemi);
// State: pos = (x, delta, phi, t), mom = (p_x, p_delta); constants p_t (= 1, past-pointing) and p_phi.

uniform mat4 uE;        // camera vielbein, column a = leg a (contravariant, coordinates (t, r, theta, phi))
uniform mat4 uG;        // g_dd at the camera
uniform vec4 uCam;      // r_cam, delta_cam = min(theta, pi - theta), phi_cam, x_cam
uniform vec4 uScreen;   // centre alpha, centre beta, size alpha, size beta
uniform vec4 uStep;     // eps, hmin, rTerm, rBoundary
uniform vec4 uAux;      // FOORT crossing threshold (fraction of pi/2), axis step floor, camera hemisphere (+-1), constraint projection (1/0)
uniform ivec4 uImg;     // Nx, Ny of the image being traced (a progressive level is a smaller image), 0, 0
uniform ivec4 uOpt;     // maxSteps, crossing mode (0 interpolate, 1 FOORT), mesh (0 centres, 1 FOORT), store |H|
uniform highp sampler2D uFluid;   // fluid four-velocity (1/u^t, u^r/u^t, Omega, 0) at nodes x_i = log(r - r0) (row 0)
uniform vec4 uFluidX;             // fluid table: xMin, dx, nodes, r0 (js/fluid/fluidTable.js)

layout(location = 0) out vec4 outRec0;  // termCode + 16 * passes, steps, theta_end, phi_end (mod 2 pi)
layout(location = 1) out vec4 outRec1;  // crossing 1: r, phi (mod 2 pi), dt = t - t_cam, g; r = 0 if none
layout(location = 2) out vec4 outRec2;  // crossing 2
layout(location = 3) out vec4 outRec3;  // crossing 3, or (|H|_rel at the end, t_end, 0, 0) if uOpt.w = 1

// Stage 1B B2, all disc crossings: crossings 4, 5, ... (up to max passes) are accumulated into TAIL_BINS log-r bins.
// Each bin is one float: W_b = sum F g^p, with the bin's emission-weighted centroid of log r (as a fraction of the bin
// width, 8 bits) in the low 8 bits of W_b's mantissa (W_b keeps 15 bits: ~3e-5 relative). The display adds
// sum_b W_b J(r_b), without noise and slow light (plan 3.2). Packing for <= 8 RGBA32F attachments: record 0-3, tail 4-5,
// and attachment 6 free for the ray-continuation state of compaction (B5). TAIL_BINS = 0 on devices with < 6 draw buffers.
#ifndef TAIL_BINS
#define TAIL_BINS 0
#endif
#if TAIL_BINS > 0
layout(location = 4) out vec4 outTail0;  // bins 0-3
layout(location = 5) out vec4 outTail1;  // bins 4-7
uniform vec4 uTail;     // log r of the first bin edge, 1 / bin width (in log r), number of bins, 0
uniform vec4 uTailEm;   // redshift power p, geometric fudge factor (passes >= 2), max passes (0: all), 0
#endif

// Stage 1B B5, ray compaction (COMPACT; needs the tail and 8 draw buffers). Phase A traces every pixel and stops a ray
// that has not terminated after uCompact.y steps, writing its state: rec0 = (8 or 9 for hemi = +1 / -1, + 16 passes;
// steps; delta; phi, not reduced), the crossings in rec1-3 as usual, the tail bins unpacked (W_b) in tail0-1, and
//   outCont  = (x, t, p_x, p_delta),
//   outTailX = the tail centroids as fractions of their bin, two per float: round(4095 f_2k) + f_2k+1 (12 bits each).
// Phase B (uCompact.x = 2) traces a compact image of the unfinished rays: texel -> pixel index from uIndex, the state
// from the level's records (uPrev0-7), p_t and p_phi recomputed from the pixel (the same code, so the same bits), and
// continues the same loop; its records are scattered back (backendWebGL2.js). Up to the tail centroids (12 bits at a
// phase boundary, 8 bits in the final record anyway) a compacted ray is the single-pass ray.
#ifdef COMPACT
uniform ivec4 uCompact;              // mode (1: stop at the step limit; 2: resume the listed rays; 3: trace the listed pixels
                                     // afresh, B6 adaptive refinement), step limit (0: none), 0, 0
uniform highp isampler2D uIndex;     // mode 2: pixel index i + Nx j of the compact texel, -1 = padding
uniform highp sampler2D uPrev0, uPrev1, uPrev2, uPrev3, uPrev4, uPrev5, uPrev6, uPrev7;   // the level's records
layout(location = 6) out vec4 outCont;
layout(location = 7) out vec4 outTailX;
#endif

const float PI = 3.14159265358979;
const float HALF_PI = 1.57079632679490;
const int TERM_HORIZON = 1, TERM_BOUNDARY = 2, TERM_TIMEOUT = 3, TERM_NAN = 4, TERM_SINGULARITY = 6;

// FOORT Integrators::GetAdaptiveStep on the contravariant velocities (dx, dtheta, dphi)/dlambda;
// min(theta, pi - theta) = delta. The axis distance is floored (uAux.y): with FOORT's h2 ~ theta a
// ray aimed straight at the axis (p_phi = 0) takes geometrically shrinking steps and never crosses
// it (FOORT ends such rays with its ThetaSingularity termination instead).
#ifdef BS3
uniform vec4 uBS;       // B6 embedded integrator: error tolerance (rad), step cap factor on FOORT's eps, 0, 0
#endif
uniform vec4 uFar;      // larger steps at large r (M9 accuracy trade): eps *= clamp(r / r_far, 1, k_max); x = r_far (0: off), y = k_max

float adaptiveStep(vec4 pos, vec4 v) {
  float eps = uStep.x;
  if (uFar.x > 0.0) eps *= clamp(radiusOf(pos.x) / uFar.x, 1.0, uFar.y);
  float d = 1e-20;
  float h1 = eps / (abs(v.x) + d);
  float h2 = eps * max(pos.y, uAux.y) / (abs(v.y) + d);
  float h3 = eps / (abs(v.z) + d);
  float h = 1.0 / (1.0 / abs(h1) + 1.0 / abs(h2) + 1.0 / abs(h3));
  return max(h, uStep.y);
}

bool finite4(vec4 v) { return all(lessThan(abs(v), vec4(1e30))); }

// Redshift g = 1 / (u^mu p_mu) of the equatorial fluid (FOORT GeneralCircularRadialFluid, past-directed p with
// p_t = 1) for the photon momenta at a crossing: (1/u^t) / (p_t + (u^r/u^t) p_r + Omega p_phi); p_r = p_x dx/dr.
float fluidRedshift(float r, float pr, float pt, float pphi) {
  float f = clamp((log(r - uFluidX.w) - uFluidX.x) / uFluidX.y, 0.0, uFluidX.z - 1.0);
  int i = min(int(floor(f)), int(uFluidX.z) - 2);
  vec3 a = texelFetch(uFluid, ivec2(i, 0), 0).xyz, b = texelFetch(uFluid, ivec2(i + 1, 0), 0).xyz;
  vec3 e = mix(a, b, f - float(i));
  return e.x / (pt + e.y * pr + e.z * pphi);
}

#if TAIL_BINS > 0
// a crossing (r, phi, dt, g) into its log-r bin: weight F g^p (F = fudge for passes >= 2; the tail starts at pass 4)
#define TAIL_ADD(C) { vec4 tc_ = (C); if (tc_.x > 0.0 && tc_.w > 0.0) { float w_ = uTailEm.y * pow(tc_.w, uTailEm.x), x_ = log(tc_.x); \
  int b_ = clamp(int(floor((x_ - uTail.x) * uTail.y)), 0, TAIL_BINS - 1); tW[b_] += w_; tX[b_] += w_ * x_; } }
#endif

vec4 crossingRecord(vec4 pos, vec2 mom, float pt, float pphi) {
  float r = radiusOf(pos.x);
  float pr = mom.x / exp(pos.x);   // x = log(r - r0) of the tracer
  return vec4(r, mod(pos.z, 2.0 * PI), pos.w, fluidRedshift(r, pr, pt, pphi));
}

void main() {
  ivec2 ij = ivec2(gl_FragCoord.xy);
#ifdef COMPACT
  if (uCompact.x >= 2) {
    int pix = texelFetch(uIndex, ij, 0).x;
    if (pix < 0) {
      outRec0 = vec4(0.0); outRec1 = vec4(0.0); outRec2 = vec4(0.0); outRec3 = vec4(0.0);
      outTail0 = vec4(0.0); outTail1 = vec4(0.0); outCont = vec4(0.0); outTailX = vec4(0.0);
      return;
    }
    ij = ivec2(pix % uImg.x, pix / uImg.x);
  }
#endif

  // pixel -> screen coordinates (i along alpha, j along beta)
  vec2 unit = uOpt.z == 1 ? vec2(ij) / vec2(uImg.xy - 1) : (vec2(ij) + 0.5) / vec2(uImg.xy);
  float alpha = uScreen.x + uScreen.z * (unit.x - 0.5);
  float beta = uScreen.y + uScreen.w * (unit.y - 0.5);

  // FOORT ViewScreen::SetNewInitialConditions: flat-frame momentum, vielbein, lower, p_t = 1
  float rc = uCam.x;
  float hemi = uAux.z;
  float D = sqrt(rc * rc + alpha * alpha + beta * beta);
  vec4 pflat = vec4(-1.0, -rc / D, -beta / rc / D, alpha / rc / sin(uCam.y) / D);
  vec4 pdn = uG * (uE * pflat);
  pdn /= pdn.x;
  float pt = pdn.x, pphi = pdn.w;

  vec4 pos = vec4(uCam.w, uCam.y, uCam.z, 0.0);
  vec2 mom = vec2(pdn.y * exp(uCam.w), hemi * pdn.z);   // p_x = p_r dr/dx; p_delta = hemi p_theta

  float rTerm = uStep.z, rB = uStep.w;
  float band = HALF_PI * uAux.x;
  // signed distance to the equator, zeta = pi/2 - theta = hemi (pi/2 - delta)
  float zeta = hemi * (HALF_PI - pos.y);
  bool havePrev = abs(zeta) > band;   // FOORT crossing state (UpdateData at the start position)
  float prevZeta = zeta;
  vec4 cr[3];
  cr[0] = vec4(0.0); cr[1] = vec4(0.0); cr[2] = vec4(0.0);
#if TAIL_BINS > 0
  float tW[8], tX[8];
  for (int b = 0; b < 8; b++) { tW[b] = 0.0; tX[b] = 0.0; }
#endif
  int passes = 0;
  int code = TERM_TIMEOUT;
  int steps = 0;
  int maxSteps = uOpt.x;
  int n0 = 0;
#ifdef COMPACT
  bool cont = false;
  if (uCompact.x == 2) {
    // resume: the state phase A (or an earlier phase B) left in the level's records
    vec4 s0 = texelFetch(uPrev0, ij, 0), sc = texelFetch(uPrev6, ij, 0);
    int c0 = int(s0.x + 0.5);
    passes = c0 / 16;
    hemi = (c0 - 16 * passes) == 8 ? 1.0 : -1.0;
    steps = int(s0.y + 0.5);
    n0 = steps;
    pos = vec4(sc.x, s0.z, s0.w, sc.y);
    mom = sc.zw;
    cr[0] = texelFetch(uPrev1, ij, 0); cr[1] = texelFetch(uPrev2, ij, 0); cr[2] = texelFetch(uPrev3, ij, 0);
    vec4 w0 = texelFetch(uPrev4, ij, 0), w1 = texelFetch(uPrev5, ij, 0), fx = texelFetch(uPrev7, ij, 0);
    for (int b = 0; b < 8; b++) {
      tW[b] = b < 4 ? w0[b] : w1[b - 4];
      float pk = fx[b / 2];
      float f = (b % 2 == 0) ? floor(pk) / 4095.0 : fract(pk);
      tX[b] = tW[b] * (uTail.x + (float(b) + f) / uTail.y);
    }
  }
#endif

#ifdef BS3
  vec4 k1p = vec4(0.0);
  vec2 k1m = vec2(0.0), k1q = vec2(0.0);
  bool haveK1 = false;
  float hNext = -1.0;
#endif
  for (int n = n0; n <= maxSteps; n++) {
#ifdef BS3
    // Stage 1B B6 (plan 4.2-1, Normal-tier candidate): Bogacki-Shampine 3(2) with error control and FSAL (k4 of an
    // accepted step is k1 of the next: 3 metric evaluations per step). Error: the embedded 2nd-order difference in
    // (x, delta, sin(delta) phi), against the tolerance uBS.x (a fraction of the pixel's angle at the camera); the step
    // is capped by FOORT's rule at eps * uBS.y and floored at hmin. A rejected attempt counts as a step (time-out).
    // One call site of the metric functions, as for RK4: the stages are a loop.
    vec4 prevPos = pos;
    vec2 prevMom = mom;
    float prevHemi = hemi;
    float h = 0.0, xStageMin = 1e30;
    vec4 k2p = vec4(0.0), k3p = vec4(0.0), k4p = vec4(0.0), y1p = pos;
    vec2 k2m = vec2(0.0), k3m = vec2(0.0), k4m = vec2(0.0), k4q = vec2(0.0), y1m = mom;
    for (int st = haveK1 ? 0 : -1; st < 3; st++) {
      vec4 sp = pos; vec2 sm = mom;
      if (st == 0) {
        // constraint projection on k1 (as for RK4's first stage), then the step
        if (uAux.w > 0.5) {
          float B = pt * k1p.w + pphi * k1p.z, A = mom.x * k1p.x + mom.y * k1p.y;
          if (A > 0.0 && B < 0.0) {
            float sc = sqrt(-B / A);
            mom *= sc;
            k1p.xy *= sc; k1m += (sc * sc - 1.0) * k1q;
          }
        }
        float hcap = adaptiveStep(pos, k1p) * uBS.y;
        h = max(min(hNext > 0.0 ? hNext : hcap / uBS.y, hcap), uStep.y);
        sp = pos + 0.5 * h * k1p; sm = mom + 0.5 * h * k1m;
      } else if (st == 1) {
        sp = pos + 0.75 * h * k2p; sm = mom + 0.75 * h * k2m;
      } else if (st == 2) {
        sp = pos + h * ((2.0 / 9.0) * k1p + (1.0 / 3.0) * k2p + (4.0 / 9.0) * k3p);
        sm = mom + h * ((2.0 / 9.0) * k1m + (1.0 / 3.0) * k2m + (4.0 / 9.0) * k3m);
        y1p = sp; y1m = sm;
      }
      if (st >= 0) xStageMin = min(xStageMin, sp.x);
      vec4 kp; vec2 km, kq;
      geodesicRHS(sp, sm, hemi, pt, pphi, kp, km, kq);
      if (st == -1) { k1p = kp; k1m = km; k1q = kq; haveK1 = true; }
      else if (st == 0) { k2p = kp; k2m = km; }
      else if (st == 1) { k3p = kp; k3m = km; }
      else { k4p = kp; k4m = km; k4q = kq; }
    }
    vec4 ev = h * ((-5.0 / 72.0) * k1p + (1.0 / 12.0) * k2p + (1.0 / 9.0) * k3p - 0.125 * k4p);
    float err = max(max(abs(ev.x), abs(ev.y)), abs(ev.z) * sin(pos.y)) / uBS.x;
    steps = n + 1;
    if (!(err <= 1.0) && h > uStep.y * 1.0001 && err == err) {
      hNext = h * max(0.2, 0.9 * pow(err, -1.0 / 3.0));
      continue;
    }
    hNext = h * clamp(0.9 * pow(max(err, 1e-6), -1.0 / 3.0), 0.2, 4.0);
    pos = y1p; mom = y1m;
    k1p = k4p; k1m = k4m; k1q = k4q;   // FSAL
#else
    // RK4 as a loop over the stages: one call site of the metric functions keeps the compiled
    // shader small (ANGLE/D3D inlines every call; four call sites of the tabulated lookup took ~30 s to compile)
    vec4 sp = pos, accP = vec4(0.0);
    vec2 sm = mom, accM = vec2(0.0);
    float h = 0.0, xStageMin = 1e30;
    for (int st = 0; st < 4; st++) {
      vec4 kp; vec2 km, kq;
      geodesicRHS(sp, sm, hemi, pt, pphi, kp, km, kq);
      // constraint projection (uAux.w = 1; horizonless metrics): rescale the spatial momenta onto H = 0 at the start of
      // the step, from 2H = p_mu dx^mu/dlambda = B + A with B = p_t dt + p_phi dphi and A = p_x dx + p_delta ddelta >= 0.
      // The first stage is then corrected exactly instead of re-evaluated: dx, ddelta scale with s, the force's
      // momentum-squared part kq with s^2, the rest not at all (same result as js/ref/cpuTracer.js, option project)
      if (st == 0 && uAux.w > 0.5) {
        float B = pt * kp.w + pphi * kp.z, A = mom.x * kp.x + mom.y * kp.y;
        if (A > 0.0 && B < 0.0) {
          float sc = sqrt(-B / A);
          mom *= sc; sm = mom;
          kp.xy *= sc; km += (sc * sc - 1.0) * kq;
        }
      }
      if (st == 0) h = adaptiveStep(pos, kp);
      float wgt = (st == 0 || st == 3) ? 1.0 : 2.0;
      accP += wgt * kp; accM += wgt * km;
      if (st < 3) {
        float cst = st == 2 ? h : 0.5 * h;
        sp = pos + cst * kp; sm = mom + cst * km;
        xStageMin = min(xStageMin, sp.x);   // stage positions (any one inside the cut means capture)
      }
    }
    vec4 prevPos = pos;
    vec2 prevMom = mom;
    float prevHemi = hemi;
    pos += h / 6.0 * accP;
    mom += h / 6.0 * accM;
    steps = n + 1;
#endif

    // axis reflection (plan Section 3.5), the same at both poles
    if (pos.y < 0.0) { pos.y = -pos.y; pos.z += PI; mom.y = -mom.y;
#ifdef BS3
      haveK1 = false;   // k1 was evaluated in the other chart
#endif
    }
    // equator: change hemisphere
    if (pos.y > HALF_PI) { pos.y = PI - pos.y; hemi = -hemi; mom.y = -mom.y;
#ifdef BS3
      haveK1 = false;
#endif
    }

    // terminations, FOORT order (horizon: any RK stage inside counts; boundary; time out; singularity),
    // except that NaN/Inf is tested first: GLSL comparisons and min() with NaN are undefined
    float r = radiusOf(pos.x);
    int tc = 0;
    if (!finite4(pos) || !all(lessThan(abs(mom), vec2(1e30))) || !(abs(xStageMin) < 1e30)) tc = TERM_NAN;
    else if (r < rTerm || radiusOf(xStageMin) < rTerm) tc = TERM_HORIZON;
    else if (r > rB) tc = TERM_BOUNDARY;
    else if (steps > maxSteps) tc = TERM_TIMEOUT;
    else if (nearSingularity(r, pos.y, hemi)) tc = TERM_SINGULARITY;

    // equatorial crossings, only while the ray has not terminated (as in FOORT)
    if (tc == 0) {
      float z = hemi * (HALF_PI - pos.y);
      if (uOpt.y == 1) {
        // FOORT EquatorialPassesDiagnostic: outside the threshold band, post-step position
        if (abs(z) > band) {
          if (havePrev && prevZeta * z < 0.0) {
            if (passes < 3) cr[passes] = crossingRecord(pos, mom, pt, pphi);
#if TAIL_BINS > 0
            else if (uTailEm.z <= 0.0 || float(passes + 1) <= uTailEm.z) TAIL_ADD(crossingRecord(pos, mom, pt, pphi))
#endif
            passes++;
          }
          havePrev = true;
          prevZeta = z;
        }
      } else {
        float z0 = prevHemi * (HALF_PI - prevPos.y);
        // the hemisphere flip is the crossing: a sign test on z misses rays whose flipped delta = pi - delta
        // rounds to exactly pi/2 in float32 (z = 0)
        if (hemi != prevHemi) {
          // linear interpolation in lambda between the two step ends
          float az = abs(z0) + abs(z);
          float f = az > 0.0 ? abs(z0) / az : 1.0;
          vec4 q = prevPos + f * (pos - prevPos);
          vec2 qm = prevMom + f * (mom - prevMom);
          if (passes < 3) cr[passes] = crossingRecord(q, qm, pt, pphi);
#if TAIL_BINS > 0
          else if (uTailEm.z <= 0.0 || float(passes + 1) <= uTailEm.z) TAIL_ADD(crossingRecord(q, qm, pt, pphi))
#endif
          passes++;
        }
      }
    }
    if (tc != 0) { code = tc; break; }
#ifdef COMPACT
    if (uCompact.y > 0 && steps >= uCompact.y) { cont = true; break; }
#endif
  }
#ifdef COMPACT
  if (cont) {
    outRec0 = vec4(float((hemi > 0.0 ? 8 : 9) + 16 * passes), float(steps), pos.y, pos.z);
    outRec1 = cr[0]; outRec2 = cr[1]; outRec3 = cr[2];
    outTail0 = vec4(tW[0], tW[1], tW[2], tW[3]);
    outTail1 = vec4(tW[4], tW[5], tW[6], tW[7]);
    outCont = vec4(pos.x, pos.w, mom.x, mom.y);
    vec4 fx = vec4(0.0);
    for (int b = 0; b < 8; b++) {
      float f = tW[b] > 0.0 ? clamp((tX[b] / tW[b] - uTail.x) * uTail.y - float(b), 0.0, 1.0) : 0.0;
      if (b % 2 == 0) fx[b / 2] = floor(f * 4095.0 + 0.5); else fx[b / 2] += min(f, 0.99975);
    }
    outTailX = fx;
    return;
  }
  outCont = vec4(0.0); outTailX = vec4(0.0);
#endif

  float theta = hemi > 0.0 ? pos.y : PI - pos.y;
  outRec0 = vec4(float(code + 16 * passes), float(steps), theta, mod(pos.z, 2.0 * PI));
  outRec1 = cr[0];
  outRec2 = cr[1];
  outRec3 = uOpt.w == 1 ? vec4(hamiltonianRel(pos, mom, hemi, pt, pphi), pos.w, 0.0, 0.0) : cr[2];
#if TAIL_BINS > 0
  vec4 tp0 = vec4(0.0), tp1 = vec4(0.0);
  for (int b = 0; b < 8; b++) {
    float v = 0.0;
    if (tW[b] > 0.0) {
      float f = clamp((tX[b] / tW[b] - uTail.x) * uTail.y - float(b), 0.0, 1.0);
      v = uintBitsToFloat((floatBitsToUint(tW[b]) & 0xFFFFFF00u) | uint(f * 255.0 + 0.5));
    }
    if (b < 4) tp0[b] = v; else tp1[b - 4] = v;
  }
  outTail0 = tp0;
  outTail1 = tp1;
#endif
}
