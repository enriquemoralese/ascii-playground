precision highp float;

uniform sampler2D uCurrent;    // el frame de ASCII recién renderizado
uniform sampler2D uPrevious;   // el frame de echo anterior
uniform float uEchoEnabled;    // 0 = off, 1 = on
uniform float uEchoDecay;      // 0.5 - 0.99

varying vec2 vUv;

void main() {
  vec3 cur  = texture2D(uCurrent, vUv).rgb;
  vec3 prev = texture2D(uPrevious, vUv).rgb;

  // El eco: cada píxel guarda el máximo entre "lo actual" y
  // "lo que había antes, atenuado por decay". Es un max() y no
  // un add() porque así los caracteres no se acumulan hasta
  // quemar — se asientan en el valor más brillante que hayan
  // tenido, y después decaen desde ahí.
  vec3 decayedPrev = prev * uEchoDecay;
  vec3 echoed = max(cur, decayedPrev);

  // Cuando Feature 2 está apagado, la salida es simplemente
  // el frame actual. Cuando está prendido, es el eco.
  vec3 result = mix(cur, echoed, uEchoEnabled);

  gl_FragColor = vec4(result, 1.0);
}