uniform vec2 uUvScale;  // (1,1) normally; <1 when rendering one texel per ASCII cell

varying vec2 vUv;

void main() {
  vUv = uv * uUvScale;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
