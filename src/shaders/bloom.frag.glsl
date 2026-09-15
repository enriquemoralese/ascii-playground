// bloom.frag.glsl — cheap single-pass bloom.
// Downsample the source to 1/2 or 1/4, then run this at low res for
// performance. Sobel-ish 7x7 Gaussian, only over pixels above threshold.

precision highp float;
varying vec2 vUv;

uniform sampler2D uTexture;
uniform vec2  uTexelSize;     // 1.0 / bloom RT size
uniform float uThreshold;     // 0..1, brightness cutoff
uniform float uRadius;        // bloom spread multiplier
uniform float uIntensity;     // final brightness of the bloom layer

void main() {
  vec3 sum = vec3(0.0);
  float wsum = 0.0;

  for (int i = -3; i <= 3; i++) {
    for (int j = -3; j <= 3; j++) {
      vec2 off = vec2(float(i), float(j)) * uTexelSize * uRadius;
      vec3 c = texture2D(uTexture, vUv + off).rgb;
      float lum = max(c.r, max(c.g, c.b));
      float w = exp(-float(i*i + j*j) / 8.0) * step(uThreshold, lum);
      sum  += c * w;
      wsum += w;
    }
  }

  vec3 bloom = sum / max(wsum, 1.0);
  gl_FragColor = vec4(bloom * uIntensity, 1.0);
}