precision highp float;

uniform vec2 uResolution;
uniform sampler2D uTexture;
uniform sampler2D uGlyphs;     // one row of font glyphs, 16px each, darkest → brightest
uniform float uGlyphCount;
uniform float uHD;             // 1 = font glyphs, 0 = original 5x5 bitmaps
uniform vec2 uGrid;            // CP437 cols × rows (size of the one-texel-per-cell source)
uniform sampler2D uCp437;     // 6 CP437 glyphs, 9x16 each: " · ° ○ ◙ •"
uniform float uLavaAscii;      // 1 = CP437 dithered style (lava lamp only)
uniform float uLavaJet;        // 1 = inverted jet LUT, snapped to xterm-256

varying vec2 vUv;

// ── CP437 style helpers ────────────────────────────────────
// Standard 4x4 Bayer built from two nested 2x2 Bayers; returns (2B+1)/32.
float bayer4(ivec2 c) {
  ivec2 a = c % 2;
  ivec2 b = (c / 2) % 2;
  int b2a = (2 * a.x + 3 * a.y) % 4;
  int b2b = (2 * b.x + 3 * b.y) % 4;
  return float(2 * (4 * b2a + b2b) + 1) / 32.0;
}

vec3 jet(float t) {
  return clamp(vec3(1.5 - abs(4.0 * t - 3.0),
                    1.5 - abs(4.0 * t - 2.0),
                    1.5 - abs(4.0 * t - 1.0)), 0.0, 1.0);
}

// Nearest xterm-256 color: 6x6x6 cube (levels 0,95,135,175,215,255) vs.
// the 24-step gray ramp (8..238). The cube is separable, so per-channel
// nearest is the true nearest within it.
float cubeLevel(float v) {
  float x = v * 255.0;
  if (x < 47.5)  return 0.0;
  if (x < 115.0) return 95.0 / 255.0;
  return (floor((x - 115.0) / 40.0 + 0.5) * 40.0 + 135.0) / 255.0;
}

vec3 snapXterm(vec3 c) {
  vec3 cube = vec3(cubeLevel(c.r), cubeLevel(c.g), cubeLevel(c.b));
  float avg = (c.r + c.g + c.b) / 3.0 * 255.0;
  float g = (clamp(floor((avg - 8.0) / 10.0 + 0.5), 0.0, 23.0) * 10.0 + 8.0) / 255.0;
  vec3 gray = vec3(g);
  return dot(c - cube, c - cube) <= dot(c - gray, c - gray) ? cube : gray;
}

float character(int n, vec2 p) {
  p = floor(p * vec2(-4.0, 4.0) + 2.5);
  if (clamp(p.x, 0.0, 4.0) == p.x) {
    if (clamp(p.y, 0.0, 4.0) == p.y) {
      int a = int(round(p.x) + 5.0 * round(p.y));
      if (((n >> a) & 1) == 1) return 1.0;
    }
  }
  return 0.0;
}

void main() {
  vec2 pix = vUv * uResolution;

  // ── CP437 style (lava lamp test) ─────────────────────────
  // 18x32 device-px cells (9x16 font at 2x), one scene sample per cell,
  // max-channel signal, 6-step ramp with ordered dither, dim-end fade.
  if (uLavaAscii > 0.5) {
    const vec2 CELL = vec2(18.0, 32.0);
    vec2 cell = floor(pix / CELL);
    vec3 src = texture2D(uTexture, (cell + 0.5) / uGrid).rgb;  // source is one texel per cell
    float v = clamp(max(src.r, max(src.g, src.b)), 0.0, 1.0);

    // Dither only the dim end (" " · °). The bright steps (○ ◙ •) use plain
    // thresholds: the wax rim's brightness ramps across about one cell, so
    // with dithering every rim cell sat next to one of 16 thresholds and a
    // few pixels of drift flipped cells all along the contour (sparkle).
    // Hard thresholds move the contour as one coherent line instead.
    float scaled = v * 5.0;
    float th = scaled < 3.0 ? bayer4(ivec2(cell)) : 0.5;
    float idx = floor(scaled) + (fract(scaled) > th ? 1.0 : 0.0);
    idx = min(idx, 5.0);

    vec2 texel = floor(mod(pix, CELL) / 2.0);  // 0..8, 0..15
    float mask = texture2D(uCp437, (vec2(idx * 9.0, 0.0) + texel + 0.5) / vec2(54.0, 16.0)).r;

    // Ink on black: color × glyph × gate, nothing drawn behind the glyph.
    // The xterm palette snap only applies to the dim dots: on the bright
    // steps a drifting rim would hop between palette entries (cyan ↔ blue)
    // every few frames, which read as the blocks flickering.
    vec3 tint = uLavaJet > 0.5 ? (scaled < 3.0 ? snapXterm(jet(1.0 - v)) : jet(1.0 - v)) : src;
    float gate = smoothstep(0.05, 0.14, v);
    gl_FragColor = vec4(tint * mask * gate, 1.0);
    return;
  }

  vec2 blockPix = floor(pix / 16.0) * 16.0;
  vec2 blockUV = blockPix / uResolution;

  vec3 col = texture2D(uTexture, blockUV).rgb;
  float gray = 0.3 * col.r + 0.59 * col.g + 0.11 * col.b;

  if (uHD > 0.5) {
    // Same brightness ramp as below: <0.2 → glyph 0, >0.8 → last glyph.
    float idx = clamp(floor((gray - 0.1) / 0.1), 0.0, uGlyphCount - 1.0);
    vec2 cellPix = mod(pix, 16.0);  // pix lands on texel centers, so this samples 1:1
    vec2 glyphUV = vec2((idx * 16.0 + cellPix.x) / (uGlyphCount * 16.0), cellPix.y / 16.0);
    float glyphMask = texture2D(uGlyphs, glyphUV).r;
    gl_FragColor = vec4(col * glyphMask, 1.0);
    return;
  }

  int n = 4096;
  if (gray > 0.2) n = 65600;
  if (gray > 0.3) n = 163153;
  if (gray > 0.4) n = 15255086;
  if (gray > 0.5) n = 13121101;
  if (gray > 0.6) n = 15252014;
  if (gray > 0.7) n = 13195790;
  if (gray > 0.8) n = 11512810;

  vec2 p = mod(pix / 8.0, 2.0) - vec2(1.0);
  float mask = character(n, p);

  gl_FragColor = vec4(col * mask, 1.0);
}
