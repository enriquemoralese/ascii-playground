// bloomComposite.frag.glsl — additive composite of base + bloom.
precision highp float;
varying vec2 vUv;

uniform sampler2D uBase;
uniform sampler2D uBloom;
uniform float uBloomIntensity;

void main() {
  vec3 base  = texture2D(uBase,  vUv).rgb;
  vec3 bloom = texture2D(uBloom, vUv).rgb;
  gl_FragColor = vec4(base + bloom * uBloomIntensity, 1.0);
}