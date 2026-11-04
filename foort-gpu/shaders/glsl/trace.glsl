// Tabulated metric (plan Sections 3.3-3.4): the metric-agnostic backbone of the GPU tracer.
// Provides the metric interface of common.glsl from baked tables (js/bake/bake.js):
//   G0 = g^tt, G1 = g^tphi, G2 = sin^2(theta) g^phiphi, G3 = g^xx, G4 = g^thth on an (x, theta) grid,
// x = log(r - r0), as residuals over the analytic background backgroundG (js/bake/bake.js explains why),
// stored as Hermite data (f, f_x, f_theta, f_xtheta) in one RGBA32F texture (functions interleaved by row) and
// read with texelFetch (no hardware filtering). Bicubic Hermite interpolation gives the values and
// both first derivatives; the 1/sin^2 of g^phiphi is applied analytically.
// lookupTables is line for line js/bake/hermite.js.

uniform highp sampler2D uTables;        // texel (i, 5 j + k) = G_k at node (x_i, theta_j): the five functions
                                        // of a node are adjacent rows, so a lookup's 20 texels are close in memory
uniform vec4 uTab;                      // xMin, dx, thMax (pi/2: symmetric half table, or pi), dtheta
uniform ivec4 uTabN;                    // nx, ntheta, symmetric (1/0), 0
uniform vec4 uMetric;                   // r0, background mass M, 0, 0

float radiusOf(float x) { return uMetric.x + exp(x); }

// Analytic background B_k(r) of the tables and its x-derivatives (js/bake/bake.js backgroundG)
void backgroundG(float x, out float B[5], out float dB[5]) {
  float r0 = uMetric.x, M = uMetric.y;
  float e = exp(x), r = r0 + e, ir = 1.0 / r, ir2 = ir * ir;
  float D2 = e * e + M * M, D = (r + 2.0 * M) * D2;
  float dD = D2 + (r + 2.0 * M) * 2.0 * e;
  B[0] = -(1.0 + 2.0 * M * ir + 4.0 * M * M * ir2); B[1] = 0.0; B[2] = ir2; B[3] = r / D; B[4] = ir2;
  dB[0] = e * (2.0 * M * ir2 + 8.0 * M * M * ir2 * ir); dB[1] = 0.0; dB[2] = -2.0 * e * ir2 * ir;
  dB[3] = e * (D - r * dD) / (D * D); dB[4] = dB[2];
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
  vec2 hu = vec2(2.0 * u3 - 3.0 * u2 + 1.0, -2.0 * u3 + 3.0 * u2), gu = vec2(u3 - 2.0 * u2 + u, u3 - u2);
  vec2 dhu = vec2(6.0 * u2 - 6.0 * u, -6.0 * u2 + 6.0 * u), dgu = vec2(3.0 * u2 - 4.0 * u + 1.0, 3.0 * u2 - 2.0 * u);
  vec2 hv = vec2(2.0 * w3 - 3.0 * w2 + 1.0, -2.0 * w3 + 3.0 * w2), gv = vec2(w3 - 2.0 * w2 + w, w3 - w2);
  vec2 dhv = vec2(6.0 * w2 - 6.0 * w, -6.0 * w2 + 6.0 * w), dgv = vec2(3.0 * w2 - 4.0 * w + 1.0, 3.0 * w2 - 2.0 * w);
  // weights of the corner data (F, F_x, F_theta, F_xtheta), with the cell scaling of the derivatives
  // folded in; corners 00, 10, 01, 11 = (i, j), (i+1, j), (i, j+1), (i+1, j+1). Value, d/du, d/dv.
  vec4 S = vec4(1.0, uTab.y, uTab.w, uTab.y * uTab.w);
  vec4 W00 = S * vec4(hu.x * hv.x, gu.x * hv.x, hu.x * gv.x, gu.x * gv.x), W10 = S * vec4(hu.y * hv.x, gu.y * hv.x, hu.y * gv.x, gu.y * gv.x);
  vec4 W01 = S * vec4(hu.x * hv.y, gu.x * hv.y, hu.x * gv.y, gu.x * gv.y), W11 = S * vec4(hu.y * hv.y, gu.y * hv.y, hu.y * gv.y, gu.y * gv.y);
  vec4 X00 = S * vec4(dhu.x * hv.x, dgu.x * hv.x, dhu.x * gv.x, dgu.x * gv.x), X10 = S * vec4(dhu.y * hv.x, dgu.y * hv.x, dhu.y * gv.x, dgu.y * gv.x);
  vec4 X01 = S * vec4(dhu.x * hv.y, dgu.x * hv.y, dhu.x * gv.y, dgu.x * gv.y), X11 = S * vec4(dhu.y * hv.y, dgu.y * hv.y, dhu.y * gv.y, dgu.y * gv.y);
  vec4 T00 = S * vec4(hu.x * dhv.x, gu.x * dhv.x, hu.x * dgv.x, gu.x * dgv.x), T10 = S * vec4(hu.y * dhv.x, gu.y * dhv.x, hu.y * dgv.x, gu.y * dgv.x);
  vec4 T01 = S * vec4(hu.x * dhv.y, gu.x * dhv.y, hu.x * dgv.y, gu.x * dgv.y), T11 = S * vec4(hu.y * dhv.y, gu.y * dhv.y, hu.y * dgv.y, gu.y * dgv.y);
  float ix = 1.0 / uTab.y, it = m / uTab.w;
  for (int l = 0; l < 5; l++) {
    int y0 = 5 * j + l;
    vec4 c00 = texelFetch(uTables, ivec2(i, y0), 0), c10 = texelFetch(uTables, ivec2(i + 1, y0), 0);
    vec4 c01 = texelFetch(uTables, ivec2(i, y0 + 5), 0), c11 = texelFetch(uTables, ivec2(i + 1, y0 + 5), 0);
    v[l] = dot(c00, W00) + dot(c10, W10) + dot(c01, W01) + dot(c11, W11);
    dx[l] = ix * (dot(c00, X00) + dot(c10, X10) + dot(c01, X01) + dot(c11, X11));
    dd[l] = it * (dot(c00, T00) + dot(c10, T10) + dot(c01, T01) + dot(c11, T11));
  }
  float B[5], dB[5];
  backgroundG(x, B, dB);
  for (int l = 0; l < 5; l++) { v[l] += B[l]; dx[l] += dB[l]; }
}

// Hamilton's equations in (x, delta); same as js/ref/cpuTracer.js with theta -> delta (sin theta = sin delta)
void geodesicRHS(vec4 pos, vec2 mom, float hemi, float pt, float pphi, out vec4 dpos, out vec2 dmom) {
  float v[5], dx[5], dd[5];
  lookupTables(pos.x, pos.y, hemi, v, dx, dd);
  float s = sin(pos.y), c = cos(pos.y), is2 = 1.0 / (s * s);
  float px = mom.x, pd = mom.y;
  float pt2 = pt * pt, ptph = pt * pphi, ph2 = pphi * pphi;
  dpos = vec4(v[3] * px, v[4] * pd, v[1] * pt + v[2] * pphi * is2, v[0] * pt + v[1] * pphi);
  dmom = vec2(
    -0.5 * (dx[0] * pt2 + 2.0 * dx[1] * ptph + dx[2] * ph2 * is2 + dx[3] * px * px + dx[4] * pd * pd),
    -0.5 * (dd[0] * pt2 + 2.0 * dd[1] * ptph + (dd[2] * is2 - 2.0 * v[2] * c * is2 / s) * ph2 + dd[3] * px * px + dd[4] * pd * pd));
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

bool nearSingularity(float r, float delta, float hemi) { return false; }
