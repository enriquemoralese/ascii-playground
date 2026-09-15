precision highp float;

#define MAX_REGIONS 16
#define MAX_TRACE   24
#define MAX_RIPPLES 8
#define TAU 6.28318530718

uniform float uTime;
uniform float uSpeed;
uniform float uWarpStrength;
uniform float uWarpScale;
uniform vec3  uColorA;
uniform vec3  uColorB;
uniform float uBrightness;
uniform float uContrast;
uniform float uAccentSpread;
uniform vec2  uResolution;
uniform float uAspectCorrect;
uniform float uCanvasZoom;
uniform float uMirrorX;
uniform float uMirrorY;
uniform float uInvert;

// Feature 1 — slow outside (drag-drawn rectangle regions)
uniform int   uRegionCount;
uniform vec4  uRegions[MAX_REGIONS];
uniform float uOutsideSpeed;
uniform float uFeature1Enabled;
uniform float uInsideHueShift;
uniform float uRegionFeather; // edge softness, in normalized UV units
uniform float uRegionWobble;  // organic noise distortion along the edge

// Feature 3 — Rastro (mouse-trace stir — drags the liquid field)
uniform float uFeature3Enabled;
uniform int   uTraceCount;
uniform vec4  uTracePoints[MAX_TRACE]; // x, y, spawnTime, strength
uniform vec2  uTraceDir[MAX_TRACE];
uniform float uTraceRadius;
uniform float uTraceLife;
uniform float uTraceIntensity;
uniform float uTraceSwirl;

// Feature 4 — Onda (click shockwave ripple)
uniform float uFeature4Enabled;
uniform int   uRippleCount;
uniform vec4  uRipples[MAX_RIPPLES]; // x, y, startTime, strength
uniform float uRippleSpeed;
uniform float uRippleWidth;
uniform float uRippleAmount;
uniform float uRippleLife;

// Feature 6 — Kaléido (drag to move/spin a mirror-symmetry fold)
uniform float uFeature6Enabled;
uniform vec2  uKaleidoCenter;
uniform float uKaleidoSegments;
uniform float uKaleidoRotation;

// Feature 8 — Lava Lamp. The wax is simulated in JS (FEATURE 8 in main.js)
// and streamed in as ellipses; the shader only evaluates a signed distance.
#define LAVA_MAX 24
#define LAVA_PAIRS 12
uniform float uFeature8Enabled;
uniform float uLavaGlow;
uniform int   uLavaBodyCount;
uniform vec4  uLavaBodies[LAVA_MAX];    // x, y (screen heights; x in aspect units), semi-major, semi-minor
uniform vec2  uLavaAxis[LAVA_MAX];      // unit major axis
uniform int   uLavaPairCount;
uniform vec3  uLavaPairs[LAVA_PAIRS];   // body i, body j, smooth-min radius of the bridge between them

// Rainbow
uniform float uRainbowSpeed;
uniform float uRainbow2Speed;

varying vec2 vUv;

#include "lygia/generative/cnoise.glsl"

vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

float hueLerp(float a, float b, float t) {
  float d = b - a;
  if (d > 0.5)  d -= 1.0;
  if (d < -0.5) d += 1.0;
  return fract(a + d * t);
}

// The pattern's base density used to be a separate "Frequency" slider,
// but it did the same job as Canvas Zoom (both just scale the
// coordinate fed into the noise), so it's now a fixed constant and
// Zoom is the single "how big are the blobs" control.
#define BASE_FREQUENCY 5.0

float noiseAt(vec2 uv, float t) {
  vec2 p = uv;
  if (uAspectCorrect > 0.5) p.x *= (uResolution.x / uResolution.y);
  return cnoise(vec3(p * BASE_FREQUENCY, t * uSpeed));
}

// Shape — domain warp: bends the sampling coordinate through a second,
// independent noise field before the main pattern reads it. At 0
// strength this is a no-op (identical to the original look); turning
// it up pulls the Perlin bands into stretched, marbled, blob-like
// shapes instead of straight contour lines.
vec2 domainWarp(vec2 uv, float t) {
  if (uWarpStrength <= 0.0001) return vec2(0.0);
  vec2 wuv = uv * uWarpScale;
  float wx = cnoise(vec3(wuv, t * 0.35));
  float wy = cnoise(vec3(wuv + vec2(19.3, 7.1), t * 0.35));
  return vec2(wx, wy) * uWarpStrength;
}

// Soft, organic rectangle mask: the edge is feathered by uRegionFeather
// and additionally wobbled by a slow-drifting noise field (uRegionWobble),
// so the boundary reads as a loose, breathing region instead of a hard,
// ruler-straight cutout.
float rectMask(vec4 r, vec2 uv, float feather, float wobble) {
  float edgeNoise = cnoise(vec3(uv * 9.0, uTime * 0.12));
  vec2 juv = uv + edgeNoise * wobble;

  float inLeft   = smoothstep(r.x - feather, r.x + feather, juv.x);
  float inRight  = 1.0 - smoothstep(r.z - feather, r.z + feather, juv.x);
  float inBottom = smoothstep(r.y - feather, r.y + feather, juv.y);
  float inTop    = 1.0 - smoothstep(r.w - feather, r.w + feather, juv.y);
  return inLeft * inRight * inBottom * inTop;
}

// Feature 4 — displacement pushing outward from each active click
// point along an expanding, fading ring.
vec2 rippleDisplacement(vec2 uv) {
  if (uFeature4Enabled < 0.5 || uRippleCount == 0) return vec2(0.0);
  float aspect = uResolution.x / uResolution.y;
  vec2 disp = vec2(0.0);
  for (int i = 0; i < MAX_RIPPLES; i++) {
    if (i >= uRippleCount) break;
    vec4 r = uRipples[i];
    float age = uTime - r.z;
    if (age < 0.0 || age > uRippleLife) continue;
    vec2 d = vec2((uv.x - r.x) * aspect, uv.y - r.y);
    float dist = length(d);
    float ringR = age * uRippleSpeed;
    float band = exp(-pow((dist - ringR) / max(uRippleWidth, 0.001), 2.0));
    float fade = 1.0 - age / uRippleLife;
    vec2 dir = dist > 0.0001 ? d / dist : vec2(0.0);
    disp += dir * band * fade * r.w * uRippleAmount;
  }
  return disp;
}

// Feature 3 — drags the sampling UV along the cursor's recent path,
// like stirring the liquid rather than lighting it up. On top of that
// directional drag, each point also applies a small vortex-style
// rotation of the space around itself (uTraceSwirl), so the fabric
// bends and twists near the recent path instead of only sliding in a
// straight line. Also returns a total weight, used afterwards for a
// small brightness lift.
vec2 traceDisplacement(vec2 uv, out float totalWeight) {
  totalWeight = 0.0;
  vec2 disp = vec2(0.0);
  if (uFeature3Enabled < 0.5) return disp;

  float aspect = uResolution.x / uResolution.y;
  for (int i = 0; i < MAX_TRACE; i++) {
    if (i >= uTraceCount) break;
    vec4 p = uTracePoints[i];
    float age = uTime - p.z;
    if (age < 0.0 || age > uTraceLife) continue;

    vec2 d = vec2((uv.x - p.x) * aspect, uv.y - p.y);
    float dist = length(d);
    float lifeT = 1.0 - age / uTraceLife;
    float radius = uTraceRadius * (0.4 + 0.6 * lifeT);
    float weight = smoothstep(radius, 0.0, dist) * lifeT * lifeT * p.w;

    disp += uTraceDir[i] * weight;
    totalWeight += weight;

    if (uTraceSwirl > 0.0001) {
      float angle = uTraceSwirl * weight;
      float s = sin(angle);
      float c = cos(angle);
      vec2 rotated = vec2(d.x * c - d.y * s, d.x * s + d.y * c);
      disp += vec2((rotated.x - d.x) / aspect, rotated.y - d.y);
    }
  }
  disp *= uTraceIntensity * 0.09;
  return disp;
}

// Feature 6 — classic polar kaleidoscope fold: space is sliced into
// uKaleidoSegments angular wedges around uKaleidoCenter, and every
// other wedge is mirrored so the pattern repeats with true symmetry.
vec2 applyKaleido(vec2 uv) {
  if (uFeature6Enabled < 0.5) return uv;
  float aspect = uResolution.x / uResolution.y;
  vec2 d = vec2((uv.x - uKaleidoCenter.x) * aspect, uv.y - uKaleidoCenter.y);
  float r = length(d);
  float a = atan(d.y, d.x);

  float segments = max(floor(uKaleidoSegments), 2.0);
  float wedge = TAU / segments;

  float rel = mod(a - uKaleidoRotation, wedge);
  if (rel > wedge * 0.5) rel = wedge - rel;

  float finalAngle = rel + uKaleidoRotation;
  vec2 newD = vec2(cos(finalAngle), sin(finalAngle)) * r;
  return uKaleidoCenter + vec2(newD.x / aspect, newD.y);
}

// Feature 8 — signed distance to the wax. Each body is an ellipse; bodies
// only blend where the JS simulation says a bridge exists (a pair with a
// smooth-min radius k). Everything else is a hard min, so two blobs that
// merely touch stay two blobs — that's what separates wax from oil.
float sdEllipse(vec2 p, vec2 r) {
  float k0 = length(p / r);
  float k1 = length(p / (r * r));
  return k0 * (k0 - 1.0) / k1;
}

float smin(float a, float b, float k) {
  if (k <= 1e-4) return min(a, b);
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

float lavaSDF(vec2 uv) {
  float aspect = uResolution.x / uResolution.y;
  vec2 p = vec2(uv.x * aspect, uv.y);
  float dArr[LAVA_MAX];
  float d = 1e3;

  for (int i = 0; i < LAVA_MAX; i++) {
    dArr[i] = 1e3;
    if (i >= uLavaBodyCount) continue;
    vec4 b = uLavaBodies[i];
    vec2 ax = uLavaAxis[i];
    vec2 q = p - b.xy;
    vec2 local = vec2(dot(q, ax), dot(q, vec2(-ax.y, ax.x)));
    float di = sdEllipse(local, b.zw);
    dArr[i] = di;
    d = min(d, di);
  }

  for (int n = 0; n < LAVA_PAIRS; n++) {
    if (n >= uLavaPairCount) break;
    vec3 pr = uLavaPairs[n];
    int i = int(pr.x + 0.5);
    int j = int(pr.y + 0.5);
    d = min(d, smin(dArr[i], dArr[j], pr.z));
  }

  // a little slow lumpiness so surfaces aren't geometric
  d += 0.003 * cnoise(vec3(p * 6.0, uTime * 0.05));
  return d;
}

void main() {
  float minFeather = 2.0 / uResolution.x;
  float feather = max(minFeather, uRegionFeather);

  // ── Quantize UV al grid de bloques del ASCII (16x16) ──
  vec2 pix = vUv * uResolution;
  vec2 blockPix = floor(pix / 16.0) * 16.0 + 8.0;
  vec2 blockUV = blockPix / uResolution;

  // ── F1 mask ────────────────────────────────────────────
  float f1Mask = 0.0;
  if (uFeature1Enabled > 0.5) {
    for (int i = 0; i < MAX_REGIONS; i++) {
      if (i >= uRegionCount) break;
      f1Mask = max(f1Mask, rectMask(uRegions[i], blockUV, feather, uRegionWobble));
    }
  }

  // ── Combine displacement-style effects (F3 stir + F4 ripple) ──
  // All measured relative to the true screen position (vUv), then
  // summed, so each one's center tracks the real cursor regardless
  // of what the others are doing.
  float traceWeight = 0.0;
  vec2 disp = rippleDisplacement(vUv)
            + traceDisplacement(vUv, traceWeight);

  vec2 uv = vUv + disp;

  // ── Full coordinate fold (F6 kaleidoscope) ──
  uv = applyKaleido(uv);

  // ── Shape — domain warp ───────────────────────────────────
  uv += domainWarp(uv, uTime);

  // Lava lamp reads the coordinate before zoom/mirror so the lamp always
  // fills the screen (Blob size is its own scale control).
  vec2 lavaUV = uv;

  // ── Canvas — zoom + mirror ─────────────────────────────────
  // Applied only to the content-sampling coordinate, so interactive
  // effect centers (ripple/trace/kaleido) stay locked
  // to the real cursor position regardless of zoom/mirror settings.
  uv = (uv - 0.5) / max(uCanvasZoom, 0.001) + 0.5;
  if (uMirrorX > 0.5 && uv.x > 0.5) uv.x = 1.0 - uv.x;
  if (uMirrorY > 0.5 && uv.y > 0.5) uv.y = 1.0 - uv.y;

  // ── Noise + Feature 1 (drag-region slow-outside) ─────────
  float nLive = noiseAt(uv, uTime);
  float n;
  float t_effective = uTime;

  if (uFeature1Enabled > 0.5 && uRegionCount > 0) {
    float nSlow = noiseAt(uv, uTime * uOutsideSpeed);
    n = mix(nSlow, nLive, f1Mask);
    t_effective = mix(uTime * uOutsideSpeed, uTime, f1Mask);
  } else {
    n = nLive;
  }

  float t = clamp(n * 0.5 + 0.5, 0.0, 1.0);

  // ── Accent spread ──────────────────────────────────────
  float bias = (t - 0.5) * 2.0;
  bias = sign(bias) * pow(abs(bias), uAccentSpread);
  t = bias * 0.5 + 0.5;

  // ── Color ──────────────────────────────────────────────
  vec3 hsvA = rgb2hsv(uColorA);
  vec3 hsvB = rgb2hsv(uColorB);

  float hue = hueLerp(hsvA.x, hsvB.x, t);
  float sat = mix(hsvA.y, hsvB.y, t);
  float val = mix(hsvA.z, hsvB.z, t);

  // ── Feature 8 — Lava lamp: replaces the noise colouring ──
  // Liquid = dark Color B, lit faintly from the bulb below.
  // Wax    = full-saturation Color A with a neon halo and a white-hot core.
  if (uFeature8Enabled > 0.5) {
    float d     = lavaSDF(lavaUV);
    float wax   = smoothstep(0.004, -0.004, d);             // surface, ~half a cell soft
    float halo  = exp(-max(d, 0.0) / 0.05) * (1.0 - wax);   // glow just outside
    float bulb  = smoothstep(0.55, 0.0, vUv.y);

    hue = hueLerp(hsvB.x, hsvA.x, max(wax, halo));
    sat = mix(max(hsvB.y, 0.6), 1.0, max(wax, halo));

    float liquid = 0.08 + 0.10 * bulb + halo * 0.45 * uLavaGlow;
    // Brightness ramps from the surface (0.55) to full over ~0.05 screen
    // heights of depth and clips at 1.0, so the CP437 ramp draws a ○/◙ rim
    // a cell or two wide and a clean • core. An SDF has a definite edge, so
    // there are no stray blocks away from the wax.
    float depth  = clamp(-d / 0.05, 0.0, 1.0);
    float lit    = min(mix(0.55, 1.25, depth), 1.0);
    val = mix(liquid, lit, wax);
  }

  hue = fract(hue + uInsideHueShift * f1Mask);

  // Rainbow: time drift PLUS a diagonal spatial phase, so when active
  // it reads as a hue wave sweeping across the screen rather than the
  // whole canvas flashing the same color at once. The spatial term is
  // scaled by uRainbowSpeed itself, so it's fully inert when rainbow
  // is off (speed 0) and preserves the exact look you had before.
  float rainbowActive = step(0.0005, uRainbowSpeed);
  hue = fract(hue + t_effective * uRainbowSpeed + (vUv.x + vUv.y) * 0.5 * rainbowActive);

  // Rainbow #2 — the OG version: a flat, whole-canvas hue drift with
  // no spatial component, so it cycles color uniformly over time.
  hue = fract(hue + t_effective * uRainbow2Speed);

  val = pow(clamp(val, 0.0, 1.0), uContrast);
  val = val * uBrightness;
  val *= 1.0 + clamp(traceWeight, 0.0, 1.0) * 0.35;

  vec3 col = hsv2rgb(vec3(hue, sat, val));
  col = mix(col, 1.0 - col, uInvert);

  gl_FragColor = vec4(col, 1.0);
}
