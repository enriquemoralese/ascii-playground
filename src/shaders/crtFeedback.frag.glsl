// crtFeedback.frag.glsl — persistence pass
// Blends the current ASCII frame with the decayed previous frame.
// Runs BEFORE any scanline/mask are applied, so the trail accumulates
// clean color instead of reinforcing the scanline pattern.
//
// Improvement over `max(cur, prev*decay)`: a soft asymmetric blend
// that reads as phosphor decay rather than a hard clipped maximum.

varying vec2 vUv;

uniform sampler2D uTexture;    // rtB — current ascii frame
uniform sampler2D uPrevFrame;  // feedback[read] — previous accumulated

uniform float uDecay;          // overall decay 0..1 (0.35 recommended)
uniform vec3  uDecayTint;      // per-channel decay (1,1,1 = neutral)
uniform float uSoftness;       // 0 = hard max, 1 = smooth blend

void main() {
  vec3 cur  = texture2D(uTexture,   vUv).rgb;
  vec3 prev = texture2D(uPrevFrame, vUv).rgb;

  // Per-channel decay — allows warmer/cooler trails (e.g. green lingers
  // longer on old phosphor monitors: (0.3, 0.45, 0.3) gives green ghosting).
  vec3 decayed = prev * uDecay * uDecayTint;

  // Hard max: keeps brightest pixel. Snappy but reinforces patterns.
  vec3 hard = max(cur, decayed);

  // Soft blend: current dominates but faded ghosts leak through.
  // Looks like real phosphor persistence.
  vec3 soft = mix(cur, decayed, uDecay * (1.0 - cur));

  vec3 col = mix(hard, soft, uSoftness);

  gl_FragColor = vec4(col, 1.0);
}