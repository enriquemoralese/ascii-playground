// crt.frag.glsl — display pass final
// Reads an already-persisted frame from the feedback pass and adds
// the visible CRT display effects: barrel, chromatic aberration,
// scanlines (luminance-only, aligned to physical pixels), optional
// phosphor mask, vignette, and temporal dithering.
//
// KEY PRINCIPLE #1: scanlines are applied to LUMINANCE ONLY, not to
// each color channel independently. When you darken R, G, B separately
// you get colored stripes that read as "lines over the content". When
// you darken only the luminance and keep the chroma untouched, the
// eye reads it as "the same image, sampled through a CRT grid" —
// which is exactly what we want.
//
// KEY PRINCIPLE #2: all screen-fixed patterns use the UNDISTORTED vUv
// so they don't swim with the barrel warp.

varying vec2 vUv;

uniform sampler2D uTexture;
uniform vec2  uResolution;
uniform float uTime;

uniform float uScanlinePeriodPx;
uniform float uScanlineIntensity;
uniform float uScanlineRollSpeed;

uniform float uMaskPeriodPx;
uniform float uMaskIntensity;

uniform float uCurvature;
uniform float uVignette;
uniform float uAberration;
uniform float uDither;

const float TAU = 6.28318530718;

vec2 barrel(vec2 uv, float amount) {
  vec2 cc = uv - 0.5;
  return uv + cc * dot(cc, cc) * amount;
}

// Raised-cosine scanline: 1.0 in the middle of each period, 0.0 at
// the edges. C1-continuous, so it never beats with anything.
float scanlineFactor(vec2 uv, vec2 res, float periodPx, float rollSpeed, float t) {
  float y = uv.y * res.y;
  float phase = y / periodPx + rollSpeed * t * 0.001;
  return 0.5 - 0.5 * cos(fract(phase) * TAU);
}

// Soft RGB phosphor triads, luminance-normalized so the mask warms
// shadows and cools highlights without shifting overall brightness.
vec3 phosphorMask(vec2 uv, vec2 res, float periodPx) {
  float x = (uv.x * res.x) / periodPx;
  float p = fract(x) * 3.0;
  vec3 m;
  m.r = exp(-pow((p - 0.5) * 1.8, 2.0));
  m.g = exp(-pow((p - 1.5) * 1.8, 2.0));
  m.b = exp(-pow((p - 2.1) * 1.8, 2.0));
  m /= max(m.r + m.g + m.b, 1e-4);
  m *= 3.0;
  return m;
}

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  // ── Barrel warp (only for TEXTURE sampling) ──
  vec2 uvTex = barrel(vUv, uCurvature);

  vec2 edgeDist = min(uvTex, 1.0 - uvTex);
  float edge = smoothstep(0.0, 0.008, min(edgeDist.x, edgeDist.y));
  if (edge <= 0.0) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }

  // ── Chromatic aberration, aspect-corrected ──
  float aspect = uResolution.x / uResolution.y;
  vec2 ab = vec2(uAberration / aspect, 0.0);
  float r = texture2D(uTexture, uvTex + ab).r;
  float g = texture2D(uTexture, uvTex).g;
  float b = texture2D(uTexture, uvTex - ab).b;
  vec3 color = vec3(r, g, b) * edge;

  // ── Scanline: LUMINANCE-ONLY ──
  // Darkening only the luminance leaves the hue and saturation intact,
  // so the underlying content still reads clearly through the grid.
  if (uScanlineIntensity > 0.0001) {
    float scan = scanlineFactor(vUv, uResolution, uScanlinePeriodPx, uScanlineRollSpeed, uTime);
    float lum = dot(color, vec3(0.2126, 0.7152, 0.0722));
    float newLum = lum * mix(1.0, scan, uScanlineIntensity);
    color += (newLum - lum); // shift by the luminance delta only
  }

  // ── Phosphor mask (off at 0 intensity) ──
  if (uMaskIntensity > 0.0001) {
    vec3 mask = phosphorMask(vUv, uResolution, uMaskPeriodPx);
    color *= mix(vec3(1.0), mask, uMaskIntensity);
  }

  // ── Vignette ──
  vec2 vc = vUv - 0.5;
  color *= clamp(1.0 - dot(vc, vc) * uVignette * 3.0, 0.0, 1.0);

  // ── Temporal dithering ──
  if (uDither > 0.0001) {
    float n = hash(gl_FragCoord.xy + uTime * 13.7);
    color += (n - 0.5) * uDither / 255.0;
  }

  gl_FragColor = vec4(color, 1.0);
}