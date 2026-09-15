precision highp float;

uniform sampler2D uSource;

varying vec2 vUv;

void main() {
  gl_FragColor = vec4(texture2D(uSource, vUv).rgb, 1.0);
}