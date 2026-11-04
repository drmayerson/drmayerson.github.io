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
//   void  geodesicRHS(vec4 pos, vec2 mom, float hemi, float pt, float pphi, out vec4 dpos, out vec2 dmom);
//   float hamiltonianRel(vec4 pos, vec2 mom, float hemi, float pt, float pphi);
//   float crossingRedshift(float r, float pt, float pphi);
//   bool  nearSingularity(float r, float delta, float hemi);
// State: pos = (x, delta, phi, t), mom = (p_x, p_delta); constants p_t (= 1, past-pointing) and p_phi.

uniform mat4 uE;        // camera vielbein, column a = leg a (contravariant, coordinates (t, r, theta, phi))
uniform mat4 uG;        // g_dd at the camera
uniform vec4 uCam;      // r_cam, delta_cam = min(theta, pi - theta), phi_cam, x_cam
uniform vec4 uScreen;   // centre alpha, centre beta, size alpha, size beta
uniform vec4 uStep;     // eps, hmin, rTerm, rBoundary
uniform vec4 uAux;      // FOORT crossing threshold (fraction of pi/2), axis step floor, camera hemisphere (+-1), 0
uniform ivec4 uImg;     // Nx, Ny of the image being traced (a progressive level is a smaller image), 0, 0
uniform ivec4 uOpt;     // maxSteps, crossing mode (0 interpolate, 1 FOORT), mesh (0 centres, 1 FOORT), store |H|

layout(location = 0) out vec4 outRec0;  // termCode + 16 * passes, steps, theta_end, phi_end (mod 2 pi)
layout(location = 1) out vec4 outRec1;  // crossing 1: r, phi (mod 2 pi), dt = t - t_cam, g; r = 0 if none
layout(location = 2) out vec4 outRec2;  // crossing 2
layout(location = 3) out vec4 outRec3;  // crossing 3, or (|H|_rel at the end, t_end, 0, 0) if uOpt.w = 1

const float PI = 3.14159265358979;
const float HALF_PI = 1.57079632679490;
const int TERM_HORIZON = 1, TERM_BOUNDARY = 2, TERM_TIMEOUT = 3, TERM_NAN = 4, TERM_SINGULARITY = 6;

// FOORT Integrators::GetAdaptiveStep on the contravariant velocities (dx, dtheta, dphi)/dlambda;
// min(theta, pi - theta) = delta. The axis distance is floored (uAux.y): with FOORT's h2 ~ theta a
// ray aimed straight at the axis (p_phi = 0) takes geometrically shrinking steps and never crosses
// it (FOORT ends such rays with its ThetaSingularity termination instead).
float adaptiveStep(vec4 pos, vec4 v) {
  float eps = uStep.x;
  float d = 1e-20;
  float h1 = eps / (abs(v.x) + d);
  float h2 = eps * max(pos.y, uAux.y) / (abs(v.y) + d);
  float h3 = eps / (abs(v.z) + d);
  float h = 1.0 / (1.0 / abs(h1) + 1.0 / abs(h2) + 1.0 / abs(h3));
  return max(h, uStep.y);
}

bool finite4(vec4 v) { return all(lessThan(abs(v), vec4(1e30))); }

vec4 crossingRecord(vec4 pos, float pt, float pphi) {
  float r = radiusOf(pos.x);
  return vec4(r, mod(pos.z, 2.0 * PI), pos.w, crossingRedshift(r, pt, pphi));
}

void main() {
  ivec2 ij = ivec2(gl_FragCoord.xy);

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
  int passes = 0;
  int code = TERM_TIMEOUT;
  int steps = 0;
  int maxSteps = uOpt.x;

  for (int n = 0; n <= maxSteps; n++) {
    // RK4 as a loop over the stages: one call site of the metric functions keeps the compiled
    // shader small (ANGLE/D3D inlines every call; four call sites of the tabulated lookup took ~30 s to compile)
    vec4 sp = pos, accP = vec4(0.0);
    vec2 sm = mom, accM = vec2(0.0);
    float h = 0.0, xStageMin = 1e30;
    for (int st = 0; st < 4; st++) {
      vec4 kp; vec2 km;
      geodesicRHS(sp, sm, hemi, pt, pphi, kp, km);
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
    float prevHemi = hemi;
    pos += h / 6.0 * accP;
    mom += h / 6.0 * accM;
    steps = n + 1;

    // axis reflection (plan Section 3.5), the same at both poles
    if (pos.y < 0.0) { pos.y = -pos.y; pos.z += PI; mom.y = -mom.y; }
    // equator: change hemisphere
    if (pos.y > HALF_PI) { pos.y = PI - pos.y; hemi = -hemi; mom.y = -mom.y; }

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
            if (passes < 3) cr[passes] = crossingRecord(pos, pt, pphi);
            passes++;
          }
          havePrev = true;
          prevZeta = z;
        }
      } else {
        float z0 = prevHemi * (HALF_PI - prevPos.y);
        if (z0 * z < 0.0) {
          // linear interpolation in lambda between the two step ends
          float f = z0 / (z0 - z);
          vec4 q = prevPos + f * (pos - prevPos);
          if (passes < 3) cr[passes] = crossingRecord(q, pt, pphi);
          passes++;
        }
      }
    }
    if (tc != 0) { code = tc; break; }
  }

  float theta = hemi > 0.0 ? pos.y : PI - pos.y;
  outRec0 = vec4(float(code + 16 * passes), float(steps), theta, mod(pos.z, 2.0 * PI));
  outRec1 = cr[0];
  outRec2 = cr[1];
  outRec3 = uOpt.w == 1 ? vec4(hamiltonianRel(pos, mom, hemi, pt, pphi), pos.w, 0.0, 0.0) : cr[2];
}
