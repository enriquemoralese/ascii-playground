precision highp float;

uniform sampler2D uPrevFreeze;
uniform float uTime;
uniform vec2  uCursor;
uniform float uCursorActive;
uniform float uCursorRadius;
uniform float uFeature2Enabled;
uniform float uAspect;
uniform float uForceReset;

varying vec2 vUv;

// Stores one float per texel: the last uTime this spot was "live"
// (i.e. under the cursor torch). Read back next frame as the previous
// state — a minimal GPU feedback loop, no CPU-side history needed.
void main() {
  if (uForceReset > 0.5) {
    gl_FragColor = vec4(uTime, 0.0, 0.0, 1.0);
    return;
  }

  if (uFeature2Enabled < 0.5) {
    // Feature off: keep the buffer pinned to "now" so re-enabling
    // starts fully live until the torch sweeps somewhere.
    gl_FragColor = vec4(uTime, 0.0, 0.0, 1.0);
    return;
  }

  float result = texture2D(uPrevFreeze, vUv).r;

  if (uCursorActive > 0.5) {
    vec2 d = vec2((vUv.x - uCursor.x) * uAspect, vUv.y - uCursor.y);
    if (length(d) < uCursorRadius) {
      result = uTime;
    }
  }

  gl_FragColor = vec4(result, 0.0, 0.0, 1.0);
}
