// Tabulated metric (plan Sections 3.3-3.4): the metric-agnostic backbone of the GPU tracer.
// Provides the metric interface of common.glsl from baked tables (js/bake/bake.js):
//   G0 = g^tt, G1 = g^tphi, G2 = sin^2(theta) g^phiphi, G3 = g^xx, G4 = g^thth on an (x, theta) grid,
// x = log(r - r0), as residuals over the analytic background backgroundG (js/bake/bake.js explains why),
// stored as Hermite data (f, f_x dx, f_theta dth, f_xtheta dx dth) in one RGBA32F texture (functions interleaved by row) and
// read with texelFetch (no hardware filtering). Bicubic Hermite interpolation gives the values and
// both first derivatives; the 1/sin^2 of g^phiphi is applied analytically.
// lookupTables is line for line js/bake/hermite.js.

#ifdef TABLE_HALF
// M9 accuracy trade: values in R32F, the (pre-scaled) derivative channels in RGBA16F (12 instead of 16 bytes per texel)
uniform highp sampler2D uTablesV;       // texel (i, 5 j + k): G_k at node (x_i, theta_j)
uniform highp sampler2D uTablesD;       // the same texel: (G_x dx, G_theta dth, G_xtheta dx dth, 0), half float
vec4 tableTexel(ivec2 p) { return vec4(texelFetch(uTablesV, p, 0).x, texelFetch(uTablesD, p, 0).xyz); }
#else
uniform highp sampler2D uTables;        // texel (i, 5 j + k) = G_k at node (x_i, theta_j): the five functions
                                        // of a node are adjacent rows, so a lookup's 20 texels are close in memory
vec4 tableTexel(ivec2 p) { return texelFetch(uTables, p, 0); }
#endif
uniform vec4 uTab;                      // xMin, dx, thMax (pi/2: symmetric half table, or pi), dtheta
uniform ivec4 uTabN;                    // nx, ntheta, symmetric (1/0), 0
uniform vec4 uMetric;                   // r0 (0: horizonless, x = log r, bounded background), background mass M, 0, 0
uniform vec4 uSing;                     // singularities (ST3Cr): axis points at z = +-zc, equatorial ring radius R,
                                        // Euclidean stopping distance eps, on (1/0); zc or R < 0: none

float radiusOf(float x) { return uMetric.x + exp(x); }

// Analytic background B_k(r) of the tables and its x-derivatives (js/bake/bake.js backgroundG):
// 1/r^2 forms for horizon metrics (r0 > 0), forms bounded at small r for horizonless ones (r0 = 0)
void backgroundG(float x, out float B[5], out float dB[5]) {
  float r0 = uMetric.x, M = uMetric.y;
  float e = exp(x), r = r0 + e, ir = 1.0 / r, ir2 = ir * ir;
  float D2 = e * e + M * M, D = (r + 2.0 * M) * D2;
  float dD = D2 + (r + 2.0 * M) * 2.0 * e;
  B[1] = 0.0; B[3] = r / D;
  dB[1] = 0.0; dB[3] = e * (D - r * dD) / (D * D);
  if (r0 > 0.0) {
    B[0] = -(1.0 + 2.0 * M * ir + 4.0 * M * M * ir2); B[2] = ir2; B[4] = ir2;
    dB[0] = e * (2.0 * M * ir2 + 8.0 * M * M * ir2 * ir); dB[2] = -2.0 * e * ir2 * ir;
  } else {
    float S = r * r + M * M, iS = 1.0 / S, N = r + 2.0 * M;
    B[0] = -(1.0 + 2.0 * M * N * iS); B[2] = iS; B[4] = iS;
    dB[0] = -2.0 * e * M * (S - 2.0 * r * N) * iS * iS; dB[2] = -2.0 * e * r * iS * iS;
  }
  dB[4] = dB[2];
}

// G0..G4 and their x- and delta-derivatives at (x, delta) in hemisphere hemi
void lookupTables(float x, float delta, float hemi, out float v[5], out float dx[5], out float dd[5]) {
  // table angle and d(table angle)/d(delta)
  float th = delta, m = 1.0;
  if (uTabN.z == 0) { th = hemi > 0.0 ? delta : 3.14159265358979 - delta; m = hemi; }
  if (th < 0.0) { th = -th; m = -m; }                          // mirror through the axis (RK stages)
  if (th > uTab.z) { th = 2.0 * uTab.z - th; m = -m; }         // through the equator (half table) or the south axis
  float fu = (x - uTab.x) / uTab.y, fv = th / uTab.w;
  int i = clamp(int(floor(fu)), 0, uTabN.x - 2), j = clamp(int(floor(fv)), 0, uTabN.y - 2);
  float u = clamp(fu - float(i), 0.0, 1.0), w = clamp(fv - float(j), 0.0, 1.0);
  float u2 = u * u, u3 = u2 * u, w2 = w * w, w3 = w2 * w;
  // cubic Hermite basis in u (along x) and w (along theta): values (h0, g0, h1, g1) and their derivatives
  vec4 bu = vec4(2.0 * u3 - 3.0 * u2 + 1.0, u3 - 2.0 * u2 + u, -2.0 * u3 + 3.0 * u2, u3 - u2);
  vec4 dbu = vec4(6.0 * u2 - 6.0 * u, 3.0 * u2 - 4.0 * u + 1.0, -6.0 * u2 + 6.0 * u, 3.0 * u2 - 2.0 * u);
  vec4 bw = vec4(2.0 * w3 - 3.0 * w2 + 1.0, w3 - 2.0 * w2 + w, -2.0 * w3 + 3.0 * w2, w3 - w2);
  vec4 dbw = vec4(6.0 * w2 - 6.0 * w, 3.0 * w2 - 4.0 * w + 1.0, -6.0 * w2 + 6.0 * w, 3.0 * w2 - 2.0 * w);
  float ix = 1.0 / uTab.y, it = m / uTab.w;
  // bicubic Hermite, separably: along x first for each of the two theta rows, then along theta. The texels hold
  // (F, F_x dx, F_theta dth, F_xtheta dx dth) (pre-scaled at upload, js/gpu/backendWebGL2.js), so a row's
  // (F, F_theta dth)(u) = bu.x c0.xz + bu.y c0.yw + bu.z c1.xz + bu.w c1.yw, and likewise its u-derivative with dbu.
  // Exactly the tensor-product formula of js/bake/hermite.js, with about a third of the arithmetic.
  for (int l = 0; l < 5; l++) {
    int y0 = 5 * j + l;
    vec4 c00 = tableTexel(ivec2(i, y0)), c10 = tableTexel(ivec2(i + 1, y0));
    vec4 c01 = tableTexel(ivec2(i, y0 + 5)), c11 = tableTexel(ivec2(i + 1, y0 + 5));
    vec2 r0 = bu.x * c00.xz + bu.y * c00.yw + bu.z * c10.xz + bu.w * c10.yw;     // row j: (F, F_theta dth) at u
    vec2 r1 = bu.x * c01.xz + bu.y * c01.yw + bu.z * c11.xz + bu.w * c11.yw;     // row j + 1
    vec2 q0 = dbu.x * c00.xz + dbu.y * c00.yw + dbu.z * c10.xz + dbu.w * c10.yw; // their u-derivatives
    vec2 q1 = dbu.x * c01.xz + dbu.y * c01.yw + dbu.z * c11.xz + dbu.w * c11.yw;
    vec4 R = vec4(r0, r1), Q = vec4(q0, q1);
    v[l] = dot(bw, R);
    dx[l] = ix * dot(bw, Q);
    dd[l] = it * dot(dbw, R);
  }
  float B[5], dB[5];
  backgroundG(x, B, dB);
  for (int l = 0; l < 5; l++) { v[l] += B[l]; dx[l] += dB[l]; }
}

// Hamilton's equations in (x, delta); same as js/ref/cpuTracer.js with theta -> delta (sin theta = sin delta)
// dmomQ: the part of dmom quadratic in the spatial momenta (p_x^2, p_delta^2 terms), for the constraint projection
void geodesicRHS(vec4 pos, vec2 mom, float hemi, float pt, float pphi, out vec4 dpos, out vec2 dmom, out vec2 dmomQ) {
  float v[5], dx[5], dd[5];
  lookupTables(pos.x, pos.y, hemi, v, dx, dd);
  float s = sin(pos.y), c = cos(pos.y), is2 = 1.0 / (s * s);
  float px = mom.x, pd = mom.y;
  float pt2 = pt * pt, ptph = pt * pphi, ph2 = pphi * pphi;
  dpos = vec4(v[3] * px, v[4] * pd, v[1] * pt + v[2] * pphi * is2, v[0] * pt + v[1] * pphi);
  dmomQ = vec2(-0.5 * (dx[3] * px * px + dx[4] * pd * pd), -0.5 * (dd[3] * px * px + dd[4] * pd * pd));
  dmom = vec2(
    -0.5 * (dx[0] * pt2 + 2.0 * dx[1] * ptph + dx[2] * ph2 * is2),
    -0.5 * (dd[0] * pt2 + 2.0 * dd[1] * ptph + (dd[2] * is2 - 2.0 * v[2] * c * is2 / s) * ph2)) + dmomQ;
}

// |H| relative to the sum of the magnitudes of its terms (as the CPU reference)
float hamiltonianRel(vec4 pos, vec2 mom, float hemi, float pt, float pphi) {
  float v[5], dx[5], dd[5];
  lookupTables(pos.x, pos.y, hemi, v, dx, dd);
  float s = sin(pos.y);
  float t0 = v[0] * pt * pt, t1 = 2.0 * v[1] * pt * pphi, t2 = v[2] * pphi * pphi / (s * s);
  float t3 = v[3] * mom.x * mom.x, t4 = v[4] * mom.y * mom.y;
  return abs(t0 + t1 + t2 + t3 + t4) / (abs(t0) + abs(t1) + abs(t2) + abs(t3) + abs(t4));
}

// Euclidean distance in the base R^3 (rho = r sin theta, z = r cos theta) to the nearer axis point (z = zc, delta
// is the distance to the nearer pole) and to the equatorial ring (rho = R, z = 0); as js/metrics/common.js singularityDistance
bool nearSingularity(float r, float delta, float hemi) {
  if (uSing.w == 0.0) return false;
  float rho = r * sin(delta), z = r * cos(delta);
  float d = 1e30;
  if (uSing.x >= 0.0) d = length(vec2(rho, z - uSing.x));
  if (uSing.y >= 0.0) d = min(d, length(vec2(rho - uSing.y, z)));
  return d <= uSing.z;
}
