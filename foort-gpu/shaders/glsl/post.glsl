// Stage 1B B8 post passes on the linear disc emission (display.glsl with uOut.x = 1): (total, n = 1, n = 2, n >= 3 + tail).
//   P_DOWN   box average of 2x2 texels (the pyramid of the telescope blur), or their sum (P_SUM: the light-curve reduction)
//   P_BLUR   one direction of a separable Gaussian, sigma in texels of the source
//   P_TONE   exposure, tone map and colour map of the total, from a source that may be 2^k times smaller (manual bilinear;
//            no float-filtering extension needed), drawn into the canvas viewport of the view
uniform highp sampler2D uSrc;
uniform ivec4 uP;      // mode, source width, source height, downsampling level k of the source (P_TONE)
uniform vec4 uBlur;    // direction x, y; sigma (texels); taps radius
uniform vec4 uTone;    // exposure, tone map, colour map, 0
uniform ivec4 uOrigin; // canvas pixel of the view's lower-left corner (P_TONE)
uniform ivec4 uFull;   // full-resolution width and height of the view (P_TONE)
out vec4 color;
const int P_DOWN = 0, P_SUM = 1, P_BLUR = 2, P_TONE = 3;

vec4 at(ivec2 p) { return texelFetch(uSrc, clamp(p, ivec2(0), uP.yz - 1), 0); }
vec4 atZero(ivec2 p) { return (p.x < 0 || p.y < 0 || p.x >= uP.y || p.y >= uP.z) ? vec4(0.0) : texelFetch(uSrc, p, 0); }

vec3 afmhot(float t) { t = clamp(t, 0.0, 1.0); return clamp(vec3(2.0 * t, 2.0 * t - 0.5, 2.0 * t - 1.0), 0.0, 1.0); }
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

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  int mode = uP.x;
  if (mode == P_DOWN || mode == P_SUM) {
    vec4 s = atZero(2 * p) + atZero(2 * p + ivec2(1, 0)) + atZero(2 * p + ivec2(0, 1)) + atZero(2 * p + ivec2(1, 1));
    color = mode == P_SUM ? s : 0.25 * s;
  } else if (mode == P_BLUR) {
    // zero outside the image: the beam spreads light off the edge as a telescope would
    ivec2 d = ivec2(uBlur.xy);
    float sg = uBlur.z;
    int R = int(uBlur.w);
    vec4 acc = vec4(0.0);
    float wsum = 0.0;
    for (int k = -64; k <= 64; k++) {
      if (k < -R || k > R) continue;
      float w = exp(-0.5 * float(k * k) / (sg * sg));
      acc += w * atZero(p + k * d);
      wsum += w;
    }
    color = acc / wsum;
  } else {
    // canvas pixel -> full-resolution pixel of the view -> source texel (bilinear between texel centres)
    vec2 f = gl_FragCoord.xy - vec2(uOrigin.xy);
    if (f.x < 0.0 || f.y < 0.0 || f.x >= float(uFull.x) || f.y >= float(uFull.y)) discard;
    vec2 u = f / float(1 << uP.w) - 0.5;
    ivec2 i0 = ivec2(floor(u));
    vec2 w = u - vec2(i0);
    float I = mix(mix(at(i0).x, at(i0 + ivec2(1, 0)).x, w.x), mix(at(i0 + ivec2(0, 1)).x, at(i0 + ivec2(1, 1)).x, w.x), w.y);
    float v = max(I * uTone.x, 0.0);
    int tm = int(uTone.y + 0.5);
    if (tm == 1) v = sqrt(v);
    else if (tm == 2) v = log(1.0 + 99.0 * v) / log(100.0);
    else if (tm == 3) v = asinh(30.0 * v) / asinh(30.0);
    int cm = int(uTone.z + 0.5);
    color = vec4(cm == 0 ? afmhot(v) : cm == 1 ? inferno(v) : vec3(clamp(v, 0.0, 1.0)), 1.0);
  }
}
