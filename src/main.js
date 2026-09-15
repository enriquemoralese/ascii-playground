import * as THREE from 'three';
import { resolveLygia } from 'resolve-lygia';
import { Pane } from 'tweakpane';

import noiseVertex from './shaders/noise.vert.glsl?raw';
import noiseFragment from './shaders/noise.frag.glsl?raw';
import asciiVertex from './shaders/ascii.vert.glsl?raw';
import asciiFragment from './shaders/ascii.frag.glsl?raw';
import crtVertex from './shaders/crt.vert.glsl?raw';
import crtFragment from './shaders/crt.frag.glsl?raw';
import crtFeedbackFragment from './shaders/crtFeedback.frag.glsl?raw';
import bloomFragment from './shaders/bloom.frag.glsl?raw';
import bloomCompositeFragment from './shaders/bloomComposite.frag.glsl?raw';

// ═══════════════════════════════════════════════════════════
// PALETA MÁGICA
// ═══════════════════════════════════════════════════════════

const MAGIC_COLORS = [
  '#00e5ff', '#0088ff', '#4400ff', '#9900ff',
  '#ff00cc', '#ff0066', '#ff3300', '#ff8800',
  '#ffcc00', '#ccff00', '#00ff88', '#00ffcc',
];

const DEFAULT_A = '#ff00cc';
const DEFAULT_B = '#00ffcc';

const MAX_REGIONS = 16;
const MAX_TRACE   = 24;
const MAX_RIPPLES = 8;

// ═══════════════════════════════════════════════════════════
// RENDERER
// ═══════════════════════════════════════════════════════════

const renderer = new THREE.WebGLRenderer({
  antialias: false,
  alpha: false,
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

const canvas = renderer.domElement;

// ═══════════════════════════════════════════════════════════
// CÁMARA Y GEOMETRÍA
// ═══════════════════════════════════════════════════════════

const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
camera.position.z = 0.5;

const geometry = new THREE.PlaneGeometry(2, 2);

// ═══════════════════════════════════════════════════════════
// REGIONES / PUNTOS — arrays independientes por feature
// ═══════════════════════════════════════════════════════════

const regionArray = Array.from({ length: MAX_REGIONS }, () => new THREE.Vector4(0, 0, 0, 0));

const traceArray    = Array.from({ length: MAX_TRACE }, () => new THREE.Vector4(0, 0, -1000, 0));
const traceDirArray = Array.from({ length: MAX_TRACE }, () => new THREE.Vector2(0, 0));

const rippleArray = Array.from({ length: MAX_RIPPLES }, () => new THREE.Vector4(0, 0, -1000, 0));

// Lava lamp: wax bodies (ellipses) and the bridges between them, streamed to
// the shader each frame. See FEATURE 8 below for the simulation.
const LAVA_MAX   = 24;  // must match #define LAVA_MAX in noise.frag.glsl
const LAVA_PAIRS = 12;  // must match #define LAVA_PAIRS
const lavaHash = (n) => { const x = Math.sin(n * 91.3458) * 47453.5453; return x - Math.floor(x); };
const lavaBodyArray = Array.from({ length: LAVA_MAX },   () => new THREE.Vector4(0, 0, 0, 0));  // x, y, semi-major, semi-minor
const lavaAxisArray = Array.from({ length: LAVA_MAX },   () => new THREE.Vector2(1, 0));
const lavaPairArray = Array.from({ length: LAVA_PAIRS }, () => new THREE.Vector3(0, 0, 0));  // i, j, bridge k

// ═══════════════════════════════════════════════════════════
// UNIFORMS
// ═══════════════════════════════════════════════════════════

const noiseUniforms = {
  uTime:              { value: 0 },
  uUvScale:           { value: new THREE.Vector2(1, 1) },
  uSpeed:            { value: 0.09 },
  uWarpStrength:      { value: 0 },
  uWarpScale:         { value: 3.0 },
  uColorA:            { value: new THREE.Color(DEFAULT_A) },
  uColorB:            { value: new THREE.Color(DEFAULT_B) },
  uBrightness:        { value: 1.0 },
  uContrast:          { value: 1.0 },
  uAccentSpread:      { value: 0.55 },
  uResolution:        { value: new THREE.Vector2(canvas.width, canvas.height) },
  uAspectCorrect:     { value: 0 },
  uCanvasZoom:        { value: 1.0 },
  uMirrorX:           { value: 0 },
  uMirrorY:           { value: 0 },
  uInvert:            { value: 0 },
  uRegionCount:       { value: 0 },
  uRegions:           { value: regionArray },
  uOutsideSpeed:      { value: 0.25 },
  uFeature1Enabled:   { value: 0 },
  uInsideHueShift:    { value: 0.4 },
  uRegionFeather:     { value: 0.025 },
  uRegionWobble:      { value: 0.018 },
  uFeature3Enabled:   { value: 0 },
  uTraceCount:        { value: 0 },
  uTracePoints:       { value: traceArray },
  uTraceDir:          { value: traceDirArray },
  uTraceRadius:       { value: 0.10 },
  uTraceLife:         { value: 0.6 },
  uTraceIntensity:    { value: 1.0 },
  uTraceSwirl:        { value: 1.2 },
  uFeature4Enabled:   { value: 0 },
  uRippleCount:       { value: 0 },
  uRipples:           { value: rippleArray },
  uRippleSpeed:       { value: 0.6 },
  uRippleWidth:       { value: 0.05 },
  uRippleAmount:      { value: 0.15 },
  uRippleLife:        { value: 1.5 },
  uFeature6Enabled:   { value: 0 },
  uKaleidoCenter:     { value: new THREE.Vector2(0.5, 0.5) },
  uKaleidoSegments:   { value: 6 },
  uKaleidoRotation:   { value: 0 },
  uFeature8Enabled:   { value: 0 },
  uLavaSpeed:         { value: 0.3 },
  uLavaSize:          { value: 1.05 },
  uLavaGlow:          { value: 0.15 },
  uLavaBodyCount:     { value: 0 },
  uLavaBodies:        { value: lavaBodyArray },
  uLavaAxis:          { value: lavaAxisArray },
  uLavaPairCount:     { value: 0 },
  uLavaPairs:         { value: lavaPairArray },
  uRainbowSpeed:      { value: 0 },
  uRainbow2Speed:     { value: 0 },
};

const noiseMaterial = new THREE.ShaderMaterial({
  vertexShader: noiseVertex,
  fragmentShader: resolveLygia(noiseFragment),
  uniforms: noiseUniforms,
  depthTest: false,
  depthWrite: false,
});

const noiseMesh = new THREE.Mesh(geometry, noiseMaterial);
const noiseScene = new THREE.Scene();
noiseScene.add(noiseMesh);

// ═══════════════════════════════════════════════════════════
// RENDER TARGET + ASCII
// ═══════════════════════════════════════════════════════════

const rtA = new THREE.WebGLRenderTarget(
  window.innerWidth,
  window.innerHeight,
  {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    type: THREE.HalfFloatType,
  }
);

// Glyph atlas for HD characters: one row of real font glyphs, darkest → brightest.
// Each glyph is drawn at exactly the on-screen cell size (16 device px) so the
// shader can sample it 1:1 — crisp, anti-aliased edges with no scaling blur.
const GLYPH_RAMP = ['.', ':', '*', 'o', '&', '8', '@', '#'];
const GLYPH_CELL = 16;

function createGlyphAtlas() {
  const atlas = document.createElement('canvas');
  atlas.width = GLYPH_CELL * GLYPH_RAMP.length;
  atlas.height = GLYPH_CELL;
  const ctx = atlas.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, atlas.width, atlas.height);
  ctx.fillStyle = '#fff';
  ctx.font = `bold ${GLYPH_CELL - 3}px ui-monospace, 'SF Mono', Menlo, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  GLYPH_RAMP.forEach((ch, i) => {
    ctx.fillText(ch, GLYPH_CELL * (i + 0.5), GLYPH_CELL * 0.5 + 1);
  });

  const tex = new THREE.CanvasTexture(atlas);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  return tex;
}

// CP437 ramp for the Lava Lamp ASCII style, as real 9×16 VGA bitmaps
// (8 font columns + the 9th column, which VGA leaves blank except for
// full-bleed glyphs). Ramp: " ", "·", "°", "○", "◙", "•". One byte per row, MSB = left.
// Drawn 2× on screen → 18×32 device-px cells.
const CP437_RAMP = [
  [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],                                                   // " "
  [0,0,0,0,0,0,0,0x18,0x18,0,0,0,0,0,0,0],                                             // · (250)
  [0,0,0,0,0,0,0x38,0x6c,0x6c,0x38,0,0,0,0,0,0],                                       // ° (248), centered with the rest of the ramp
  [0,0,0,0,0,0x3c,0x66,0x42,0x42,0x66,0x3c,0,0,0,0,0],                                 // ○ (9)
  [0xff,0xff,0xff,0xff,0xff,0xc3,0x99,0xbd,0xbd,0x99,0xc3,0xff,0xff,0xff,0xff,0xff],   // ◙ (10)
  [0,0,0,0,0,0,0x18,0x3c,0x3c,0x18,0,0,0,0,0,0],                                       // • (7)
];
const CP437_FULL_BLEED = [false, false, false, false, true, false];

function createCp437Atlas() {
  const W = 9, H = 16, N = CP437_RAMP.length;
  const data = new Uint8Array(W * N * H * 4);
  CP437_RAMP.forEach((rows, g) => {
    rows.forEach((byte, r) => {
      const y = H - 1 - r;  // DataTexture row 0 is the bottom
      for (let x = 0; x < W; x++) {
        const bit = x < 8 ? (byte >> (7 - x)) & 1 : (CP437_FULL_BLEED[g] ? byte & 1 : 0);
        const i = (y * W * N + g * W + x) * 4;
        data[i] = data[i + 1] = data[i + 2] = bit * 255;
        data[i + 3] = 255;
      }
    });
  });
  const tex = new THREE.DataTexture(data, W * N, H, THREE.RGBAFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

// Source for the CP437 style: the noise rendered at exactly one texel per
// 18×32 cell, so every cell gets one flat color (sized in onResize).
const CP437_CELL = new THREE.Vector2(18, 32);
const rtCells = new THREE.WebGLRenderTarget(1, 1, {
  minFilter: THREE.NearestFilter,
  magFilter: THREE.NearestFilter,
  type: THREE.HalfFloatType,
});
const cellUvScale = new THREE.Vector2(1, 1);

const asciiUniforms = {
  uTexture:    { value: rtA.texture },
  uGrid:       { value: new THREE.Vector2(1, 1) },  // CP437 cols × rows
  uResolution: { value: new THREE.Vector2(canvas.width, canvas.height) },
  uGlyphs:     { value: createGlyphAtlas() },
  uGlyphCount: { value: GLYPH_RAMP.length },
  uHD:         { value: 1 },
  uCp437:      { value: createCp437Atlas() },
  uLavaAscii:  { value: 0 },  // CP437 dithered ramp — only while Lava Lamp is on
  uLavaJet:    { value: 1 },  // 0 = scene colors, 1 = inverted jet LUT snapped to xterm-256
};

const asciiMaterial = new THREE.ShaderMaterial({
  vertexShader: asciiVertex,
  fragmentShader: asciiFragment,
  uniforms: asciiUniforms,
  depthTest: false,
  depthWrite: false,
});

const asciiMesh = new THREE.Mesh(geometry, asciiMaterial);
const asciiScene = new THREE.Scene();
asciiScene.add(asciiMesh);

// ═══════════════════════════════════════════════════════════
// MAGIC PIPELINE — CRT
// ═══════════════════════════════════════════════════════════

const rtB = new THREE.WebGLRenderTarget(
  window.innerWidth,
  window.innerHeight,
  {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    type: THREE.HalfFloatType,
  }
);

const bloomScale = 0.5;
const bloomW = Math.max(1, Math.floor(window.innerWidth  * bloomScale));
const bloomH = Math.max(1, Math.floor(window.innerHeight * bloomScale));

const rtBloom = new THREE.WebGLRenderTarget(bloomW, bloomH, {
  minFilter: THREE.LinearFilter,
  magFilter: THREE.LinearFilter,
  type: THREE.HalfFloatType,
});
const rtComposite = new THREE.WebGLRenderTarget(
  window.innerWidth, window.innerHeight,
  {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    type: THREE.HalfFloatType,
  }
);

const crtFeedback = [
  new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    type: THREE.HalfFloatType,
  }),
  new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    type: THREE.HalfFloatType,
  }),
];
let crtReadIndex = 0;

const bloomUniforms = {
  uTexture:   { value: rtB.texture },
  uTexelSize: { value: new THREE.Vector2(1 / bloomW, 1 / bloomH) },
  uThreshold: { value: 0.6 },
  uRadius:    { value: 1.4 },
  uIntensity: { value: 0.85 },
};
const bloomMaterial = new THREE.ShaderMaterial({
  vertexShader: crtVertex,
  fragmentShader: bloomFragment,
  uniforms: bloomUniforms,
  depthTest: false,
  depthWrite: false,
});
const bloomScene = new THREE.Scene();
bloomScene.add(new THREE.Mesh(geometry, bloomMaterial));

const bloomCompositeUniforms = {
  uBase:           { value: rtB.texture },
  uBloom:          { value: rtBloom.texture },
  uBloomIntensity: { value: 0.7 },
};
const bloomCompositeMaterial = new THREE.ShaderMaterial({
  vertexShader: crtVertex,
  fragmentShader: bloomCompositeFragment,
  uniforms: bloomCompositeUniforms,
  depthTest: false,
  depthWrite: false,
});
const bloomCompositeScene = new THREE.Scene();
bloomCompositeScene.add(new THREE.Mesh(geometry, bloomCompositeMaterial));

// ── Lava CP437 bloom: port of three's BloomNode (threshold 0, strength 0.8, radius 0) ──
// Matches three/examples/jsm/tsl/display/BloomNode.js:
//  • 5 mips at 1/2 … 1/32 res, blurred progressively (mip i reads mip i-1's result)
//  • separable Gaussian per mip (H then V), kernel radii 6/10/14/18/22,
//    sigma = radius/3, adjacent taps merged into bilinear fetches
//  • composite = strength × Σ factor·mip, factors [1.0, 0.8, 0.6, 0.4, 0.2]
// The threshold-0 high pass is a no-op here (black stays black), so it's skipped.
// Separate from the CRT bloom, no feedback/curvature. No clamp until output.
const LAVA_BLUR_MAX_TAPS = 11;  // ceil((22 - 1) / 2) merged taps for the widest kernel

function gaussianTaps(kernelRadius) {
  const sigma = kernelRadius / 3;
  const coeff = [];
  for (let i = 0; i < kernelRadius; i++) {
    coeff.push(0.39894 * Math.exp(-0.5 * i * i / (sigma * sigma)) / sigma);
  }
  const offsets = new Array(LAVA_BLUR_MAX_TAPS).fill(0);
  const weights = new Array(LAVA_BLUR_MAX_TAPS).fill(0);
  let n = 0;
  for (let i = 1; i < kernelRadius; i += 2) {
    const wa = coeff[i];
    const wb = i + 1 < kernelRadius ? coeff[i + 1] : 0;
    const w = wa + wb;
    offsets[n] = (i * wa + (i + 1) * wb) / w;
    weights[n] = w;
    n++;
  }
  return { center: coeff[0], offsets, weights, count: n };
}

const lavaBlurFragment = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uTexture;
  uniform vec2  uInvSize;
  uniform vec2  uDirection;
  uniform float uCenter;
  uniform float uOffsets[${LAVA_BLUR_MAX_TAPS}];
  uniform float uWeights[${LAVA_BLUR_MAX_TAPS}];
  uniform int   uCount;
  void main() {
    vec3 sum = texture2D(uTexture, vUv).rgb * uCenter;
    for (int i = 0; i < ${LAVA_BLUR_MAX_TAPS}; i++) {
      if (i >= uCount) break;
      vec2 off = uDirection * uInvSize * uOffsets[i];
      sum += (texture2D(uTexture, vUv + off).rgb + texture2D(uTexture, vUv - off).rgb) * uWeights[i];
    }
    gl_FragColor = vec4(sum, 1.0);
  }
`;

const makeBloomTarget = () => new THREE.WebGLRenderTarget(1, 1, {
  minFilter: THREE.LinearFilter,
  magFilter: THREE.LinearFilter,
  type: THREE.HalfFloatType,
});

const lavaBloomLevels = [6, 10, 14, 18, 22].map((kernelRadius, i) => {
  const taps = gaussianTaps(kernelRadius);
  return {
    scale: 0.5 / 2 ** i,
    horizontal: makeBloomTarget(),
    target: makeBloomTarget(),  // vertical result — the mip that gets composited
    material: new THREE.ShaderMaterial({
      vertexShader: crtVertex,
      fragmentShader: lavaBlurFragment,
      uniforms: {
        uTexture:   { value: null },
        uInvSize:   { value: new THREE.Vector2(1, 1) },
        uDirection: { value: new THREE.Vector2(1, 0) },
        uCenter:    { value: taps.center },
        uOffsets:   { value: taps.offsets },
        uWeights:   { value: taps.weights },
        uCount:     { value: taps.count },
      },
      depthTest: false,
      depthWrite: false,
    }),
  };
});
const lavaBloomMesh = new THREE.Mesh(geometry, lavaBloomLevels[0].material);
const lavaBloomScene = new THREE.Scene();
lavaBloomScene.add(lavaBloomMesh);

const lavaCompositeUniforms = {
  uBase:     { value: rtB.texture },
  uB1:       { value: lavaBloomLevels[0].target.texture },
  uB2:       { value: lavaBloomLevels[1].target.texture },
  uB3:       { value: lavaBloomLevels[2].target.texture },
  uB4:       { value: lavaBloomLevels[3].target.texture },
  uB5:       { value: lavaBloomLevels[4].target.texture },
  uStrength: { value: 0.1 },
};
const lavaCompositeScene = new THREE.Scene();
lavaCompositeScene.add(new THREE.Mesh(geometry, new THREE.ShaderMaterial({
  vertexShader: crtVertex,
  fragmentShader: /* glsl */ `
    precision highp float;
    varying vec2 vUv;
    uniform sampler2D uBase, uB1, uB2, uB3, uB4, uB5;
    uniform float uStrength;
    void main() {
      vec3 bloom = 1.0 * texture2D(uB1, vUv).rgb
                 + 0.8 * texture2D(uB2, vUv).rgb
                 + 0.6 * texture2D(uB3, vUv).rgb
                 + 0.4 * texture2D(uB4, vUv).rgb
                 + 0.2 * texture2D(uB5, vUv).rgb;
      gl_FragColor = vec4(texture2D(uBase, vUv).rgb + bloom * uStrength, 1.0);
    }
  `,
  uniforms: lavaCompositeUniforms,
  depthTest: false,
  depthWrite: false,
})));

const crtFeedbackUniforms = {
  uTexture:   { value: rtComposite.texture },
  uPrevFrame: { value: crtFeedback[0].texture },
  uDecay:     { value: 0.42 },
  uDecayTint: { value: new THREE.Vector3(1.0, 1.0, 1.0) },
  uSoftness:  { value: 0.6 },
};
const crtFeedbackMaterial = new THREE.ShaderMaterial({
  vertexShader: crtVertex,
  fragmentShader: crtFeedbackFragment,
  uniforms: crtFeedbackUniforms,
  depthTest: false,
  depthWrite: false,
});
const crtFeedbackMesh = new THREE.Mesh(geometry, crtFeedbackMaterial);
const crtFeedbackScene = new THREE.Scene();
crtFeedbackScene.add(crtFeedbackMesh);

const crtUniforms = {
  uTexture:            { value: crtFeedback[1].texture },
  uResolution:         { value: new THREE.Vector2(canvas.width, canvas.height) },
  uTime:               { value: 0 },
  uScanlinePeriodPx:   { value: 8.0 },   // bigger period = less aliasing
  uScanlineIntensity:  { value: 0.40 },
  uScanlineRollSpeed:  { value: 0.0 },
  uMaskPeriodPx:       { value: 6.0 },
  uMaskIntensity:      { value: 0.0 },
  uCurvature:          { value: 0.08 },
  uVignette:           { value: 0.0 },
  uAberration:         { value: 0.0005 },
  uDither:             { value: 0.35 },
};
const crtMaterial = new THREE.ShaderMaterial({
  vertexShader: crtVertex,
  fragmentShader: crtFragment,
  uniforms: crtUniforms,
  depthTest: false,
  depthWrite: false,
});
const crtMesh = new THREE.Mesh(geometry, crtMaterial);
const crtScene = new THREE.Scene();
crtScene.add(crtMesh);

// ═══════════════════════════════════════════════════════════
// ESTADO
// ═══════════════════════════════════════════════════════════

const editorState   = { enabled: false };
const feature1State = { enabled: false };
const feature3State = { enabled: false };
const feature4State = { enabled: false };
const feature6State = { enabled: false };
const feature8State = { enabled: false, cp437: true, bloom: true, interactive: false };
let lavaCrtWasOn = false;  // CRT state before the lava lamp switched it on
const crtState      = { enabled: false };
const rainbowParams = { enabled: false, speed: 0.05 };
const rainbow2Params = { enabled: false, speed: 0.05 };

// CRT sliders. bloom has decimals, the rest are integers.
// Defaults requested: bloom 2.5, scanline 4, curvature 1, vignette 0.
// Trail slider removed — its value is fixed at 0.42 internally.
const crtParams = {
  bloom:     1.7,
  scanline:  0,
  curvature: 3,
  vignette:  0,
};

const traceParams  = { minDist: 0.008 };
const rippleParams = { maxHold: 1.2 };
const kaleidoParams = { rotateGain: 4.0, autoSpeed: 0.1, locked: false };
// Kaleido "Toggle ripple": a ripple from the kaleido centre on the snare
// beats of a 4/4 groove (default 86 BPM, backbeat on 2 and 4), with its
// own ripple look. `beatsPerSnare` 2 = backbeat, 1 = every beat, 4 = once a bar.
const KALEIDO_RIPPLE = { speed: 0.2, width: 0.03, strength: 0.10, life: 4.0 };
const kaleidoRipple  = { enabled: false, bpm: 86, beatsPerSnare: 2, next: 0, snapshot: null };
const snareInterval  = () => (60 / kaleidoRipple.bpm) * kaleidoRipple.beatsPerSnare;

// Lava lamp physics. Distances in screen heights, times in seconds. The lamp
// runs in the Stokes regime: no inertia, velocity is the force. Thermal and
// buoyancy rates are scaled by Flow speed; coalescence, pinch-off and cursor
// timings are material properties and run in real time.
const lavaPhysics = {
  // cursor (Interactive)
  stir:      1.0,   // slider — how hard the cursor nudges the wax it touches
  carry:     0.06,  // wax is carried at up to this fraction of the cursor's speed
  shove:     0.04,  // faint push out of the cursor's way — the needle mostly passes through
  reach:     0.012, // the cursor is a needle: touches only wax within ~a cursor's width
  maxCursor: 2.0,   // cursor speed cap (screen heights/s)
  touch:     0.5,   // 1/s warming from a held-down cursor ("finger on the glass")
  split:     0.08,  // recoil of the two halves after a cut
  minCut:    0.04,  // a pass that would shave off less than 4% of the area is a graze
  minRadius: 0.018, // no piece smaller than this (≈ one cell)
  pinchFrac: 0.12,  // area of the droplet a resting touch pinches off
  pinchAfter: 0.35, // seconds resting inside a blob before that happens
  // Stokes regime
  rRef:      0.08,  // reference radius for the rates below
  vRise:     0.08,  // rise speed of an rRef body at full heat; scales with R²
  slowFloor: 0.3,   // satellites never drop below this fraction of the R² scaling (the liquid carries them)
  tHot:      1.0,   // ambient temperature on the plate…
  tCold:     0.25,  // …and in the liquid above it (neutral buoyancy is 0.5)
  plate:     0.15,  // height of the hot zone
  tauThermal: 20,   // s for an rRef body to approach ambient; scales with R²
  // coalescence
  kDrain:    120,   // film drainage time = kDrain · R_eff^1.5  (1.8 s at R_eff 0.06, ~4 s at 0.1)
  tDrainRelax: 2.0, // a partly drained film heals over this long once contact breaks
  tNeckK:    14,    // bridge growth time = tNeckK · R_eff  (0.85 s at R_eff 0.06)
  tConv:     1.0,   // blob–blob 'converge': the two bodies become one over this long
  tAbs:      1.2,   // pool 'absorb': a body's wax transfers into the pool over this long
  tAbsFollow: 0.4,  // …while its centre follows the sinking target with this time constant
  poolVisTau: 0.5,  // the pool's drawn/contact area lags the true area by this (no surface steps)
  kMax:      0.35,  // smooth-min radius of a full bridge, × R_eff
  pull:      0.05,  // capillary pull of a bridge (screen heights/s)
  stretchBreak: 1.6,// bridged pair separation (× (R_i + R_j)) beyond which the bridge thins
  tPinch:    1.2,   // bridge thinning time at rRef (× √(R_eff / rRef))
  satFrac:   [0.02, 0.06],  // satellite area as a fraction of the pair
  tauRelax:  1.0,   // ellipse → circle relaxation
  // base pool
  poolWidth: 0.6,   // pool semi-major axis as a fraction of the screen width
  poolFloor: 0.012, // the pool never drains below this area
  emitEvery: [6, 14],  // s between emissions (stretched by 1/√Flow speed), given enough wax
  emitFrac:  0.5,   // share of the pool's excess that leaves in one emission
  tEmerge:   1.5,   // s for a newly emitted droplet to grow from minRadius to its target area
};

let regionCount = 0;
let magicPipelineEnabled = false;

// Nonlinear intensity curves — the difference between "barely visible
// artifact" at 1 and "real CRT" at 4 is intentional. Linear mapping
// made level 1-2 already readable as "lines", which is exactly what we
// want to avoid. These curve values push the low end into invisibility
// while keeping the high end punchy.
function applyCrtParams() {
  // Bloom — linear is fine (it's a smooth glow, not a pattern)
  bloomUniforms.uIntensity.value              = crtParams.bloom * 0.5;
  bloomCompositeUniforms.uBloomIntensity.value = crtParams.bloom * 0.3;

  // Scanline — heavily curved: 0 / 0.03 / 0.10 / 0.22 / 0.40
  const SCAN_CURVE = [0.0, 0.03, 0.10, 0.22, 0.40];
  const si = Math.round(Math.max(0, Math.min(4, crtParams.scanline)));
  crtUniforms.uScanlineIntensity.value = SCAN_CURVE[si];

  // Auto-link a faint phosphor mask at high scanline levels — it breaks
  // up the "pure horizontal stripe" look and reads more CRT-like.
  crtUniforms.uMaskIntensity.value = si >= 3 ? 0.10 : 0.0;

  // Curvature — curved: 0 / 0.05 / 0.10 / 0.18 / 0.30
  const CURV_CURVE = [0.0, 0.05, 0.10, 0.18, 0.30];
  const ci = Math.round(Math.max(0, Math.min(4, crtParams.curvature)));
  crtUniforms.uCurvature.value = CURV_CURVE[ci];

  // Vignette — curved: 0 / 0.15 / 0.30 / 0.55 / 0.85
  const VIG_CURVE = [0.0, 0.15, 0.30, 0.55, 0.85];
  const vi = Math.round(Math.max(0, Math.min(4, crtParams.vignette)));
  crtUniforms.uVignette.value = VIG_CURVE[vi];

  // Trail is fixed (slider removed).
  crtFeedbackUniforms.uDecay.value = 0.42;
}

// Settings captured right before a preset is applied, restored when it's unchecked.
let preset1Snapshot = null;
let presetRainbowSnapshot = null;

// ── Preset 💻: full stack (CRT + Ripple + locked Kaleidoscope mandala) ──
function applyPreset1() {
  preset1Snapshot = {
    crt:        crtState.enabled,
    ripple:     feature4State.enabled,
    kaleido:    feature6State.enabled,
    center:     noiseUniforms.uKaleidoCenter.value.clone(),
    segments:   noiseUniforms.uKaleidoSegments.value,
    autoSpeed:  kaleidoParams.autoSpeed,
    rotateGain: kaleidoParams.rotateGain,
    locked:     kaleidoParams.locked,
    zoom:       noiseUniforms.uCanvasZoom.value,
  };

  noiseUniforms.uCanvasZoom.value = 0.4;

  // CRT on
  crtState.enabled = true;
  magicPipelineEnabled = true;

  // Ripple on
  feature4State.enabled = true;
  noiseUniforms.uFeature4Enabled.value = 1;

  // Kaleido on, centered, Mandala preset, locked
  feature6State.enabled = true;
  noiseUniforms.uFeature6Enabled.value = 1;
  noiseUniforms.uKaleidoCenter.value.set(0.5, 0.5);
  noiseUniforms.uKaleidoSegments.value = 12;   // Mandala
  kaleidoParams.autoSpeed  = 0.05;             // Mandala
  kaleidoParams.rotateGain = 3.0;              // Mandala
  kaleidoParams.locked     = true;

  pane.refresh();
}

function revertPreset1() {
  const s = preset1Snapshot;
  if (!s) return;
  preset1Snapshot = null;

  crtState.enabled = s.crt;
  magicPipelineEnabled = s.crt;

  feature4State.enabled = s.ripple;
  noiseUniforms.uFeature4Enabled.value = s.ripple || kaleidoRipple.enabled ? 1 : 0;

  feature6State.enabled = s.kaleido;
  noiseUniforms.uFeature6Enabled.value = s.kaleido ? 1 : 0;
  noiseUniforms.uKaleidoCenter.value.copy(s.center);
  noiseUniforms.uKaleidoSegments.value = s.segments;
  kaleidoParams.autoSpeed  = s.autoSpeed;
  kaleidoParams.rotateGain = s.rotateGain;
  kaleidoParams.locked     = s.locked;

  noiseUniforms.uCanvasZoom.value = s.zoom;

  pane.refresh();
}

// ── Preset 🌈: Rainbow on + zoomed out ──
function applyPresetRainbow() {
  presetRainbowSnapshot = {
    rainbow: rainbowParams.enabled,
    zoom:    noiseUniforms.uCanvasZoom.value,
  };

  rainbowParams.enabled = true;
  noiseUniforms.uRainbowSpeed.value = rainbowParams.speed;

  noiseUniforms.uCanvasZoom.value = 0.3;

  pane.refresh();
}

function revertPresetRainbow() {
  const s = presetRainbowSnapshot;
  if (!s) return;
  presetRainbowSnapshot = null;

  rainbowParams.enabled = s.rainbow;
  noiseUniforms.uRainbowSpeed.value = s.rainbow ? rainbowParams.speed : 0;

  noiseUniforms.uCanvasZoom.value = s.zoom;

  pane.refresh();
}

// ═══════════════════════════════════════════════════════════
// TWEAKPANE
// ═══════════════════════════════════════════════════════════

const pane = new Pane({ title: 'Menu' });
pane.expanded = false;

// ── 🌵 Presets (top of menu) ───────────────────────────────
const presetsFolder = pane.addFolder({ title: '🌵', expanded: false });
const presetState = { one: false, rainbow: false };
presetsFolder.addBinding(presetState, 'one', {
  label: '💻',
}).on('change', (ev) => {
  if (ev.value) applyPreset1();
  else revertPreset1();
});
presetsFolder.addBinding(presetState, 'rainbow', {
  label: '🌈',
}).on('change', (ev) => {
  if (ev.value) applyPresetRainbow();
  else revertPresetRainbow();
});

const paneScaleStyle = document.createElement('style');
paneScaleStyle.textContent = `
  .tp-dfwv {
    transform: scale(0.9);
    transform-origin: top right;
    transition: opacity 0.35s ease, transform 0.35s ease;
    opacity: 1;
  }
  .tp-dfwv.pane-hidden {
    opacity: 0;
    transform: scale(0.9) translateX(24px);
    pointer-events: none;
  }
  .menu-toggle-btn {
    position: fixed;
    width: 10px;
    height: 10px;
    box-sizing: border-box;
    border: 1px solid rgba(255, 255, 255, 0.55);
    background: transparent;
    cursor: pointer;
    z-index: 10000;
    transition: left 0.35s ease, border-color 0.2s ease, transform 0.2s ease;
  }
  .menu-toggle-btn:hover {
    border-color: rgba(255, 255, 255, 0.95);
    transform: scale(1.3);
  }
`;
document.head.appendChild(paneScaleStyle);

const paneEl = document.querySelector('.tp-dfwv');
let paneHidden = false;
let menuToggleDockedLeft = 0;

const menuToggleBtn = document.createElement('div');
menuToggleBtn.className = 'menu-toggle-btn';
menuToggleBtn.title = 'Toggle menu';
document.body.appendChild(menuToggleBtn);

function updateMenuTogglePosition() {
  menuToggleBtn.style.left = paneHidden
    ? `${window.innerWidth - 20}px`
    : `${menuToggleDockedLeft}px`;
}

function positionMenuToggle() {
  // While hidden the pane is translated off to the side, so its rect isn't
  // the docked position — skip the recompute and just keep tracking the
  // right edge (see updateMenuTogglePosition).
  if (!paneHidden) {
    const rect = paneEl.getBoundingClientRect();
    menuToggleDockedLeft = rect.left - 20;
    menuToggleBtn.style.top = `${rect.top + 4}px`;
  }
  updateMenuTogglePosition();
}

menuToggleBtn.addEventListener('click', () => {
  paneHidden = !paneHidden;
  paneEl.classList.toggle('pane-hidden', paneHidden);
  updateMenuTogglePosition();
});

requestAnimationFrame(positionMenuToggle);
window.addEventListener('resize', positionMenuToggle);
// The pane's own height (and occasionally width) changes as folders open,
// close, or it collapses right after load — re-dock the toggle whenever
// that happens instead of relying on catching it at exactly the right frame.
new ResizeObserver(positionMenuToggle).observe(paneEl);
// The panel animates its own transform into place over ~0.35s right after
// mount (collapsing to the title bar); re-sync once that settles so the
// toggle doesn't end up docked to its mid-transition position.
paneEl.addEventListener('transitionend', (ev) => {
  if (ev.propertyName === 'transform') positionMenuToggle();
});

// ── Folder: Shape ──────────────────────────────────────────
const shapeFolder = pane.addFolder({ title: 'Shape', expanded: false });

shapeFolder.addBinding(noiseUniforms.uSpeed, 'value', {
  min: 0, max: 1, step: 0.01, label: 'Speed',
});

shapeFolder.addBinding(noiseUniforms.uWarpStrength, 'value', {
  min: 0, max: 0.4, step: 0.02, label: 'Warp strength',
});

shapeFolder.addBinding(noiseUniforms.uWarpScale, 'value', {
  min: 0.5, max: 8, step: 0.5, label: 'Warp scale',
});

// ── Folder: Canvas ─────────────────────────────────────────
const canvasFolder = pane.addFolder({ title: 'Canvas', expanded: false });
const canvasParams = { aspectCorrect: false, mirrorX: false, mirrorY: false, invert: false, hd: true };

canvasFolder.addBinding(canvasParams, 'hd', {
  label: 'HD characters',
}).on('change', (ev) => {
  asciiUniforms.uHD.value = ev.value ? 1 : 0;
});

canvasFolder.addBinding(canvasParams, 'aspectCorrect', {
  label: 'Aspect-correct pattern',
}).on('change', (ev) => {
  noiseUniforms.uAspectCorrect.value = ev.value ? 1 : 0;
});

canvasFolder.addBinding(noiseUniforms.uCanvasZoom, 'value', {
  min: 0.1, max: 3.0, step: 0.1, label: 'Zoom',
});

canvasFolder.addBinding(canvasParams, 'mirrorX', {
  label: 'Mirror X',
}).on('change', (ev) => {
  noiseUniforms.uMirrorX.value = ev.value ? 1 : 0;
});

canvasFolder.addBinding(canvasParams, 'mirrorY', {
  label: 'Mirror Y',
}).on('change', (ev) => {
  noiseUniforms.uMirrorY.value = ev.value ? 1 : 0;
});

canvasFolder.addBinding(canvasParams, 'invert', {
  label: 'Invert colors',
}).on('change', (ev) => {
  noiseUniforms.uInvert.value = ev.value ? 1 : 0;
});

// ── Folder: Color ─────────────────────────────────────────
const colorFolder = pane.addFolder({ title: 'Color', expanded: false });
{
  const hint = document.createElement('span');
  hint.textContent = 'F to toggle';
  hint.style.cssText = 'margin-left: 6px; font-size: 0.8em; opacity: 0.45;';
  colorFolder.element.querySelector('.tp-fldv_t')?.appendChild(hint);
}

colorFolder.addBinding(editorState, 'enabled', {
  label: 'Color Wheel',
}).on('change', (ev) => {
  setWheelsVisible(ev.value);
});

colorFolder.addBinding(noiseUniforms.uBrightness, 'value', {
  min: 0.5, max: 1.5, step: 0.05, label: 'Brightness',
});

colorFolder.addBinding(noiseUniforms.uContrast, 'value', {
  min: 0.3, max: 3.0, step: 0.1, label: 'Contrast',
});

colorFolder.addBinding(noiseUniforms.uAccentSpread, 'value', {
  min: 0.15, max: 1.0, step: 0.05, label: 'Accent spread',
});

colorFolder.addBinding(rainbowParams, 'enabled', {
  label: 'Rainbow',
}).on('change', (ev) => {
  noiseUniforms.uRainbowSpeed.value = ev.value ? rainbowParams.speed : 0;
});

colorFolder.addBinding(rainbowParams, 'speed', {
  min: 0.005, max: 0.3, step: 0.01, label: 'Rainbow speed',
}).on('change', (ev) => {
  if (rainbowParams.enabled) {
    noiseUniforms.uRainbowSpeed.value = ev.value;
  }
});

colorFolder.addBinding(rainbow2Params, 'enabled', {
  label: 'Rainbow #2',
}).on('change', (ev) => {
  noiseUniforms.uRainbow2Speed.value = ev.value ? rainbow2Params.speed : 0;
});

colorFolder.addBinding(rainbow2Params, 'speed', {
  min: 0.005, max: 0.3, step: 0.01, label: 'Rainbow #2 speed',
}).on('change', (ev) => {
  if (rainbow2Params.enabled) {
    noiseUniforms.uRainbow2Speed.value = ev.value;
  }
});

// ── Color presets ─────────────────────────────────────────
const COLOR_PRESETS = [
  { title: 'Aggro Dr1ft',   a: '#ff00cc', b: '#00ffcc' },
  { title: 'Violet Volt',   a: '#9900ff', b: '#ccff00' },
  { title: 'Neon Tropics',  a: '#ff0066', b: '#00ffcc' },
  { title: 'Deep Sea',      a: '#00e5ff', b: '#0088ff' },
  { title: 'Solar Flare',   a: '#ff3300', b: '#ffcc00' },
];

const presetColorFolder = colorFolder.addFolder({ title: 'Presets', expanded: false });

COLOR_PRESETS.forEach((preset) => {
  presetColorFolder.addButton({ title: preset.title }).on('click', () => {
    noiseUniforms.uColorA.value.set(preset.a);
    noiseUniforms.uColorB.value.set(preset.b);
    syncWheelActive();
  });
});

// ── Folder: Features ───────────────────────────────────────
const magicFolder = pane.addFolder({ title: 'Features', expanded: false });

// ── Feature 1 — Regions ────────────────────────────────────
const regionsFolder = magicFolder.addFolder({
  title: 'Regions',
  expanded: false,
});

regionsFolder.addBinding(feature1State, 'enabled', {
  label: 'Enable regions',
}).on('change', (ev) => {
  noiseUniforms.uFeature1Enabled.value = ev.value ? 1 : 0;
});

regionsFolder.addBinding(noiseUniforms.uInsideHueShift, 'value', {
  min: 0, max: 0.5, step: 0.05, label: 'Inside hue shift',
});

regionsFolder.addBinding(noiseUniforms.uOutsideSpeed, 'value', {
  min: 0.0, max: 1.0, step: 0.05, label: 'Outside speed',
});

regionsFolder.addBinding(noiseUniforms.uRegionFeather, 'value', {
  min: 0.0, max: 0.08, step: 0.002, label: 'Edge softness',
});

regionsFolder.addBinding(noiseUniforms.uRegionWobble, 'value', {
  min: 0.0, max: 0.05, step: 0.001, label: 'Edge wobble',
});

regionsFolder.addButton({ title: 'Clear regions' }).on('click', () => {
  clearRegions();
});

// ── Feature 3 — Trace ──────────────────────────────────────
const traceFolder = magicFolder.addFolder({
  title: 'Trace',
  expanded: false,
});

traceFolder.addBinding(feature3State, 'enabled', {
  label: 'Enable',
}).on('change', (ev) => {
  noiseUniforms.uFeature3Enabled.value = ev.value ? 1 : 0;
  if (!ev.value) clearTrace();
});

traceFolder.addBinding(noiseUniforms.uTraceRadius, 'value', {
  min: 0.02, max: 0.3, step: 0.01, label: 'Stir radius',
});

traceFolder.addBinding(noiseUniforms.uTraceLife, 'value', {
  min: 0.2, max: 5.0, step: 0.1, label: 'Stir life (s)',
});

// ── Feature 4 — Ripple ─────────────────────────────────────
const rippleFolder = magicFolder.addFolder({
  title: 'Ripple',
  expanded: false,
});

rippleFolder.addBinding(feature4State, 'enabled', {
  label: 'Enable click ripples',
}).on('change', (ev) => {
  // The shader flag stays on while the kaleido beat ripple needs it.
  noiseUniforms.uFeature4Enabled.value = ev.value || kaleidoRipple.enabled ? 1 : 0;
});

rippleFolder.addBinding(noiseUniforms.uRippleSpeed, 'value', {
  min: 0.1, max: 2.0, step: 0.1, label: 'Ripple speed',
});

rippleFolder.addBinding(noiseUniforms.uRippleWidth, 'value', {
  min: 0.01, max: 0.2, step: 0.01, label: 'Ripple width',
});

rippleFolder.addBinding(noiseUniforms.uRippleAmount, 'value', {
  min: 0.0, max: 0.5, step: 0.05, label: 'Ripple strength',
});

rippleFolder.addBinding(noiseUniforms.uRippleLife, 'value', {
  min: 0.3, max: 4.0, step: 0.2, label: 'Ripple life (s)',
});


// ── Feature 6 — Kaleidoscope ⭐ ────────────────────────────
const kaleidoFolder = magicFolder.addFolder({
  title: 'Kaleidoscope ⭐',
  expanded: false,
});

kaleidoFolder.addBinding(feature6State, 'enabled', {
  label: 'Enable kaleidoscope',
}).on('change', (ev) => {
  noiseUniforms.uFeature6Enabled.value = ev.value ? 1 : 0;
});

kaleidoFolder.addBinding(kaleidoParams, 'locked', {
  label: 'Lock kaleido',
});

kaleidoFolder.addBinding(noiseUniforms.uKaleidoSegments, 'value', {
  min: 2, max: 16, step: 1, label: 'Segments',
});

kaleidoFolder.addBinding(kaleidoParams, 'autoSpeed', {
  min: 0, max: 1.0, step: 0.05, label: 'Auto-rotate speed',
});

kaleidoFolder.addBinding(kaleidoParams, 'rotateGain', {
  min: 0.5, max: 10.0, step: 0.5, label: 'Drag spin sensitivity',
});

kaleidoFolder.addButton({ title: 'Center kaleido' }).on('click', () => {
  noiseUniforms.uKaleidoCenter.value.set(0.5, 0.5);
});

kaleidoFolder.addButton({ title: 'Reset kaleido' }).on('click', () => {
  noiseUniforms.uKaleidoCenter.value.set(0.5, 0.5);
  noiseUniforms.uKaleidoRotation.value = 0;
});

// Beat ripple: fires from the kaleido centre on beats 2 and 4 at 86 BPM.
// It draws through the click-ripple renderer, so while it's on the ripple
// settings are switched to its own look (and put back when it's off).
kaleidoFolder.addBinding(kaleidoRipple, 'enabled', {
  label: 'Toggle ripple',
}).on('change', (ev) => {
  const u = noiseUniforms;
  if (ev.value) {
    kaleidoRipple.snapshot = {
      speed: u.uRippleSpeed.value, width: u.uRippleWidth.value,
      strength: u.uRippleAmount.value, life: u.uRippleLife.value,
    };
    u.uRippleSpeed.value  = KALEIDO_RIPPLE.speed;
    u.uRippleWidth.value  = KALEIDO_RIPPLE.width;
    u.uRippleAmount.value = KALEIDO_RIPPLE.strength;
    u.uRippleLife.value   = KALEIDO_RIPPLE.life;
    u.uFeature4Enabled.value = 1;
    kaleidoRipple.next = clock.getElapsed() + 60 / kaleidoRipple.bpm;  // first snare: beat 2
  } else {
    const s = kaleidoRipple.snapshot;
    if (s) {
      u.uRippleSpeed.value  = s.speed;
      u.uRippleWidth.value  = s.width;
      u.uRippleAmount.value = s.strength;
      u.uRippleLife.value   = s.life;
      kaleidoRipple.snapshot = null;
    }
    u.uFeature4Enabled.value = feature4State.enabled ? 1 : 0;
  }
  pane.refresh();
});

kaleidoFolder.addBinding(kaleidoRipple, 'bpm', {
  min: 40, max: 200, step: 1, label: 'BPM',
});

kaleidoFolder.addBinding(kaleidoRipple, 'beatsPerSnare', {
  options: { 'every beat': 1, 'backbeat (2 & 4)': 2, 'once a bar': 4 },
  label: 'Snare on',
});

// Press this on a snare of the track you're listening to: the next ripple
// fires right away and the rest follow from there, so the phase lines up.
kaleidoFolder.addButton({ title: 'Sync (press on a snare)' }).on('click', () => {
  kaleidoRipple.next = clock.getElapsed();
});

const KALEIDO_PRESETS = [
  { title: 'Mirror',    segments: 2,  autoSpeed: 0,    rotateGain: 2 },
  { title: 'Classic',   segments: 6,  autoSpeed: 0.1,  rotateGain: 4 },
  { title: 'Mandala',   segments: 12, autoSpeed: 0.05, rotateGain: 3 },
  { title: 'Starburst', segments: 8,  autoSpeed: 0.4,  rotateGain: 6 },
  { title: 'Chaos',     segments: 16, autoSpeed: 0.8,  rotateGain: 9 },
];

const kaleidoPresetFolder = kaleidoFolder.addFolder({ title: 'Presets', expanded: false });

KALEIDO_PRESETS.forEach((preset) => {
  kaleidoPresetFolder.addButton({ title: preset.title }).on('click', () => {
    noiseUniforms.uKaleidoSegments.value = preset.segments;
    kaleidoParams.autoSpeed = preset.autoSpeed;
    kaleidoParams.rotateGain = preset.rotateGain;
    pane.refresh();
  });
});

// ── Folder: Lava Lamp ⭐ ────────────────────────────────────
// Blobs = Color A (neon), liquid = Color B (dark), so F combos restyle it.
const lavaFolder = magicFolder.addFolder({
  title: 'Lava Lamp ⭐',
  expanded: false,
});

lavaFolder.addBinding(feature8State, 'enabled', {
  label: 'Enable lava lamp',
}).on('change', (ev) => {
  noiseUniforms.uFeature8Enabled.value = ev.value ? 1 : 0;
  syncLavaAscii();
  if (ev.value && !lavaSim.seeded) seedLavaSim(clock.getElapsed());
  // The lamp brings CRT with it, and puts it back the way it was after.
  if (ev.value) { lavaCrtWasOn = crtState.enabled; crtState.enabled = true; }
  else crtState.enabled = lavaCrtWasOn;
  magicPipelineEnabled = crtState.enabled;
  pane.refresh();
});

// Test: CP437 dithered ASCII style, scoped to the lava lamp only.
lavaFolder.addBinding(feature8State, 'cp437', {
  label: 'CP437 ASCII',
}).on('change', syncLavaAscii);

function syncLavaAscii() {
  asciiUniforms.uLavaAscii.value = feature8State.enabled && feature8State.cp437 ? 1 : 0;
}

lavaFolder.addBinding(noiseUniforms.uLavaSpeed, 'value', {
  min: 0.1, max: 4.0, step: 0.1, label: 'Flow speed',
});

lavaFolder.addBinding(noiseUniforms.uLavaSize, 'value', {
  min: 0.5, max: 2.0, step: 0.05, label: 'Blob size',
});

lavaFolder.addBinding(noiseUniforms.uLavaGlow, 'value', {
  min: 0, max: 1.5, step: 0.05, label: 'Glow',
});

// Interactive: the cursor becomes a needle — pass through a blob to cut it,
// rest inside one to pinch off a drop, hold the button to warm the wax.
lavaFolder.addBinding(feature8State, 'interactive', {
  label: 'Interactive (stir)',
});

lavaFolder.addBinding(lavaPhysics, 'stir', {
  min: 0.2, max: 3.0, step: 0.1, label: 'Stir strength',
});

// ── Folder: CRT ────────────────────────────────────────────
// 4 sliders. bloom takes decimals, the rest are 0-4 integer.
const crtFolder = magicFolder.addFolder({ title: 'CRT ⭐', expanded: false });

crtFolder.addBinding(crtState, 'enabled', {
  label: 'CRT ⭐',
}).on('change', (ev) => {
  magicPipelineEnabled = ev.value;
});

crtFolder.addBinding(crtParams, 'bloom', {
  min: 0, max: 4, step: 0.1, label: 'Bloom',
}).on('change', applyCrtParams);

crtFolder.addBinding(crtParams, 'scanline', {
  min: 0, max: 4, step: 1, label: 'Scanline',
}).on('change', applyCrtParams);

crtFolder.addBinding(crtParams, 'curvature', {
  min: 0, max: 4, step: 1, label: 'Curvature',
}).on('change', applyCrtParams);

crtFolder.addBinding(crtParams, 'vignette', {
  min: 0, max: 4, step: 1, label: 'Vignette',
}).on('change', applyCrtParams);

// Push initial CRT values into uniforms once.
applyCrtParams();

// ═══════════════════════════════════════════════════════════
// CSS RUEDAS
// ═══════════════════════════════════════════════════════════

const style = document.createElement('style');
style.textContent = `
  .tp-dfwv {
    max-height: 100vh;
    overflow-y: auto;
    overscroll-behavior: contain;
  }
  .color-wheel {
    position: fixed;
    left: 22px;
    width: 84px;
    height: 84px;
    border-radius: 50%;
    background: rgba(8, 8, 14, 0.55);
    backdrop-filter: blur(24px) saturate(1.4);
    -webkit-backdrop-filter: blur(24px) saturate(1.4);
    border: 1px solid rgba(255, 255, 255, 0.08);
    box-shadow:
      0 8px 32px rgba(0, 0, 0, 0.5),
      inset 0 1px 0 rgba(255, 255, 255, 0.06);
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.35s ease;
    z-index: 1000;
  }
  .color-wheel.visible {
    opacity: 1;
    pointer-events: auto;
  }
  #color-wheel-A { bottom: 124px; }
  #color-wheel-B { bottom: 26px; }
  .wheel-dot {
    position: absolute;
    width: 9px;
    height: 9px;
    border-radius: 50%;
    cursor: pointer;
    transform: translate(-50%, -50%);
    transition:
      transform 0.18s cubic-bezier(0.34, 1.56, 0.64, 1),
      box-shadow 0.18s ease;
  }
  .wheel-dot:hover { transform: translate(-50%, -50%) scale(1.35); }
  .wheel-dot.active {
    transform: translate(-50%, -50%) scale(1.6);
    box-shadow:
      0 0 0 1.5px rgba(255, 255, 255, 0.55),
      0 0 16px currentColor;
  }
  .wheel-label {
    position: absolute;
    top: 50%; left: 50%;
    transform: translate(-50%, -50%);
    font: 600 10px/1 ui-monospace, 'SF Mono', Menlo, monospace;
    color: rgba(255, 255, 255, 0.3);
    letter-spacing: 0.06em;
    pointer-events: none;
    user-select: none;
  }
`;
document.head.appendChild(style);

// ═══════════════════════════════════════════════════════════
// RUEDAS
// ═══════════════════════════════════════════════════════════

const wheels = {};

function buildWheel(anchor, initialColor) {
  const wheel = document.createElement('div');
  wheel.className = 'color-wheel';
  wheel.id = `color-wheel-${anchor}`;

  const label = document.createElement('div');
  label.className = 'wheel-label';
  label.textContent = anchor;
  wheel.appendChild(label);

  const radius = 28;
  const total = MAGIC_COLORS.length;

  MAGIC_COLORS.forEach((color, i) => {
    const angle = (i / total) * Math.PI * 2 - Math.PI / 2;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;

    const dot = document.createElement('div');
    dot.className = 'wheel-dot';
    dot.style.background = color;
    dot.style.color = color;
    dot.style.left = `calc(50% + ${x}px)`;
    dot.style.top = `calc(50% + ${y}px)`;
    dot.dataset.color = color;

    if (color === initialColor) dot.classList.add('active');

    dot.addEventListener('click', () => {
      if (anchor === 'A') noiseUniforms.uColorA.value.set(color);
      else noiseUniforms.uColorB.value.set(color);

      wheel.querySelectorAll('.wheel-dot').forEach((d) => {
        d.classList.toggle('active', d.dataset.color === color);
      });
    });

    wheel.appendChild(dot);
  });

  document.body.appendChild(wheel);
  wheels[anchor] = wheel;
}

function setWheelsVisible(visible) {
  wheels.A.classList.toggle('visible', visible);
  wheels.B.classList.toggle('visible', visible);
}

buildWheel('A', DEFAULT_A);
buildWheel('B', DEFAULT_B);

function syncWheelActive() {
  const hexA = `#${noiseUniforms.uColorA.value.getHexString()}`;
  const hexB = `#${noiseUniforms.uColorB.value.getHexString()}`;
  wheels.A.querySelectorAll('.wheel-dot').forEach((d) => {
    d.classList.toggle('active', d.dataset.color === hexA);
  });
  wheels.B.querySelectorAll('.wheel-dot').forEach((d) => {
    d.classList.toggle('active', d.dataset.color === hexB);
  });
}

// ═══════════════════════════════════════════════════════════
// TECLA F — rota entre color combos con crossfade
// ═══════════════════════════════════════════════════════════

const F_COMBOS = [
  { name: 'Miami Nights',   a: '#ff2e88', b: '#00d4ff' },
  { name: 'Toxic Waste',    a: '#39ff14', b: '#7a00ff' },
  { name: 'Mango Chamoy',   a: '#ffd000', b: '#ff0080' },
  { name: 'Frida',          a: '#ff0a54', b: '#00f5d4' },
  { name: 'Oro y Cobalto',  a: '#ffc400', b: '#0047ff' },
  { name: 'Cotton Candy',   a: '#ff9ef5', b: '#7afcff' },
  { name: 'Blood Moon',     a: '#ff1a1a', b: '#2b00ff' },
  { name: 'Matrix',         a: '#00ff41', b: '#00331a' },
  { name: 'Lava Lamp',      a: '#ff00cc', b: '#ffe600' },
  { name: 'Ultraviolet',    a: '#b026ff', b: '#ff3df2' },
  { name: 'Aggro Dr1ft',    a: '#ff00cc', b: '#00ffcc' },  // the default colors — rotation loops back home
];

const COMBO_FADE_SECONDS = 0.6;
let comboIndex = -1;
let comboFadeId = 0;

const comboToast = document.createElement('div');
comboToast.style.cssText = `
  position: fixed; left: 50%; bottom: 32px; transform: translateX(-50%);
  padding: 8px 14px; border-radius: 999px;
  background: rgba(10, 10, 12, 0.72); backdrop-filter: blur(8px);
  font: 600 12px/1 ui-monospace, 'SF Mono', Menlo, monospace;
  color: #fff; letter-spacing: 0.06em;
  display: flex; align-items: center; gap: 8px;
  opacity: 0; pointer-events: none; transition: opacity 0.3s ease; z-index: 1001;
`;
document.body.appendChild(comboToast);
let comboToastTimer = null;

function showComboToast(combo) {
  const swatch = (c) => `<span style="width:10px;height:10px;border-radius:50%;background:${c};box-shadow:0 0 8px ${c}"></span>`;
  comboToast.innerHTML = `${swatch(combo.a)}${swatch(combo.b)}<span>${combo.name}</span>`;
  comboToast.style.opacity = '1';
  clearTimeout(comboToastTimer);
  comboToastTimer = setTimeout(() => { comboToast.style.opacity = '0'; }, 1400);
}

function nextColorCombo() {
  comboIndex = (comboIndex + 1) % F_COMBOS.length;
  const combo = F_COMBOS[comboIndex];

  const fromA = noiseUniforms.uColorA.value.clone();
  const fromB = noiseUniforms.uColorB.value.clone();
  const toA = new THREE.Color(combo.a);
  const toB = new THREE.Color(combo.b);
  const start = performance.now();
  const id = ++comboFadeId;  // a newer press cancels an in-progress fade

  function step(now) {
    if (id !== comboFadeId) return;
    const t = Math.min((now - start) / (COMBO_FADE_SECONDS * 1000), 1);
    const e = t * t * (3 - 2 * t);  // smoothstep
    noiseUniforms.uColorA.value.lerpColors(fromA, toA, e);
    noiseUniforms.uColorB.value.lerpColors(fromB, toB, e);
    if (t < 1) requestAnimationFrame(step);
    else syncWheelActive();
  }
  requestAnimationFrame(step);

  showComboToast(combo);
}

window.addEventListener('keydown', (e) => {
  if (e.key !== 'f' && e.key !== 'F') return;
  if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
  const t = e.target;
  if (t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
  nextColorCombo();
});

// ═══════════════════════════════════════════════════════════
// FEATURE 1 — drag para dibujar regiones
// ═══════════════════════════════════════════════════════════

let isDragging = false;
let dragMoved = false;
let dragStartX = 0;
let dragStartY = 0;
let currentRegion = null;

function clearRegions() {
  regionCount = 0;
  noiseUniforms.uRegionCount.value = 0;
  for (let i = 0; i < MAX_REGIONS; i++) regionArray[i].set(0, 0, 0, 0);
}

canvas.addEventListener('pointerdown', (e) => {
  if (!feature1State.enabled) return;
  if (e.button !== 0) return;

  isDragging = true;
  dragMoved = false;
  dragStartX = e.clientX;
  dragStartY = e.clientY;
  canvas.setPointerCapture(e.pointerId);
});

canvas.addEventListener('pointermove', (e) => {
  if (!isDragging) return;

  const dx = e.clientX - dragStartX;
  const dy = e.clientY - dragStartY;

  if (!dragMoved && (Math.abs(dx) > 5 || Math.abs(dy) > 5)) {
    dragMoved = true;

    if (regionCount < MAX_REGIONS) {
      currentRegion = regionArray[regionCount];
      regionCount++;
      noiseUniforms.uRegionCount.value = regionCount;
    }
  }

  if (!dragMoved || !currentRegion) return;

  const rect = canvas.getBoundingClientRect();
  const startX = (dragStartX - rect.left) / rect.width;
  const startY = 1 - (dragStartY - rect.top) / rect.height;
  const endX = (e.clientX - rect.left) / rect.width;
  const endY = 1 - (e.clientY - rect.top) / rect.height;

  currentRegion.set(
    Math.min(startX, endX), Math.min(startY, endY),
    Math.max(startX, endX), Math.max(startY, endY)
  );
});

canvas.addEventListener('pointerup', (e) => {
  if (!isDragging) return;
  isDragging = false;
  if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
  dragMoved = false;
  currentRegion = null;
});

canvas.addEventListener('pointercancel', () => {
  isDragging = false;
  dragMoved = false;
  currentRegion = null;
});

// ═══════════════════════════════════════════════════════════
// FEATURE 3 — Rastro: stir de mouse independiente del drag
// ═══════════════════════════════════════════════════════════

let traceWriteIndex = 0;
let lastTracePos = null;
let lastTraceTime = 0;

function clearTrace() {
  traceWriteIndex = 0;
  noiseUniforms.uTraceCount.value = 0;
  for (let i = 0; i < MAX_TRACE; i++) {
    traceArray[i].set(0, 0, -1000, 0);
    traceDirArray[i].set(0, 0);
  }
  lastTracePos = null;
}

function pushTracePoint(u, v, dirX, dirY, strength, time) {
  traceArray[traceWriteIndex].set(u, v, time, strength);
  traceDirArray[traceWriteIndex].set(dirX, dirY);
  traceWriteIndex = (traceWriteIndex + 1) % MAX_TRACE;
  if (noiseUniforms.uTraceCount.value < MAX_TRACE) noiseUniforms.uTraceCount.value++;
}

canvas.addEventListener('pointerleave', () => {
  lastTracePos = null;
});

canvas.addEventListener('pointermove', (e) => {
  if (!feature3State.enabled) return;

  const rect = canvas.getBoundingClientRect();
  const u = (e.clientX - rect.left) / rect.width;
  const v = 1 - (e.clientY - rect.top) / rect.height;
  const now = clock.getElapsed();

  if (lastTracePos) {
    const dx = u - lastTracePos.u;
    const dy = v - lastTracePos.v;
    const dist = Math.hypot(dx, dy);
    if (dist < traceParams.minDist) return;

    const dt = Math.max(now - lastTraceTime, 0.001);
    const speed = dist / dt;
    const inv = dist > 0.00001 ? 1 / dist : 0;
    const strength = THREE.MathUtils.clamp(0.25 + speed * 1.5, 0.25, 1.0);

    pushTracePoint(u, v, dx * inv, dy * inv, strength, now);
  } else {
    pushTracePoint(u, v, 0, 0, 0.3, now);
  }

  lastTracePos = { u, v };
  lastTraceTime = now;
});

// ═══════════════════════════════════════════════════════════
// FEATURE 4 — Onda: shockwave por click
// ═══════════════════════════════════════════════════════════

let rippleWriteIndex = 0;
let rippleDownTime = null;
let rippleDownPos = null;

function pushRipple(u, v, strength) {
  const t = clock.getElapsed();
  rippleArray[rippleWriteIndex].set(u, v, t, strength);
  rippleWriteIndex = (rippleWriteIndex + 1) % MAX_RIPPLES;
  if (noiseUniforms.uRippleCount.value < MAX_RIPPLES) noiseUniforms.uRippleCount.value++;
}

canvas.addEventListener('pointerdown', (e) => {
  if (!feature4State.enabled) return;
  if (e.button !== 0) return;

  rippleDownTime = clock.getElapsed();
  const rect = canvas.getBoundingClientRect();
  rippleDownPos = {
    u: (e.clientX - rect.left) / rect.width,
    v: 1 - (e.clientY - rect.top) / rect.height,
  };
});

canvas.addEventListener('pointerup', (e) => {
  if (!feature4State.enabled || rippleDownTime === null) return;

  const hold = clock.getElapsed() - rippleDownTime;
  const strength = THREE.MathUtils.clamp(0.4 + hold / rippleParams.maxHold, 0.4, 1.6);
  pushRipple(rippleDownPos.u, rippleDownPos.v, strength);

  rippleDownTime = null;
  rippleDownPos = null;
});

// ═══════════════════════════════════════════════════════════
// FEATURE 6 — Kaléido: drag para mover y girar
// ═══════════════════════════════════════════════════════════

let kaleidoHeld = false;
let lastKaleidoPos = null;

canvas.addEventListener('pointerdown', (e) => {
  if (!feature6State.enabled || e.button !== 0) return;
  if (kaleidoParams.locked) return;
  kaleidoHeld = true;
});

canvas.addEventListener('pointerup', () => {
  kaleidoHeld = false;
  lastKaleidoPos = null;
});

canvas.addEventListener('pointermove', (e) => {
  if (!feature6State.enabled || !kaleidoHeld) return;

  const rect = canvas.getBoundingClientRect();
  const u = (e.clientX - rect.left) / rect.width;
  const v = 1 - (e.clientY - rect.top) / rect.height;

  noiseUniforms.uKaleidoCenter.value.set(u, v);

  if (lastKaleidoPos) {
    const dx = u - lastKaleidoPos.u;
    noiseUniforms.uKaleidoRotation.value += dx * kaleidoParams.rotateGain;
  }

  lastKaleidoPos = { u, v };
});

// ═══════════════════════════════════════════════════════════
// FEATURE 8 — Lava: cera con estado (Stokes + coalescencia + pinch-off)
// ═══════════════════════════════════════════════════════════
// Every wax body is a particle: position, temperature, area (screen units²;
// radius = √area × Blob size) and a slowly relaxing ellipse. The regime is
// Stokes — no inertia, velocity *is* the force — so rise/sink speed scales
// with R² (big blobs are quick, satellites hang) and each body has its own
// thermal time constant ∝ R², so big blobs stay hot longer and climb higher
// before turning. That desync is what makes the set read as a lamp.
//
// Merging and splitting are processes with their own clocks, not functions
// of distance (that's the difference between wax and oil):
//   drain   — two bodies touch; the film between them drains for 1–4 s
//             (longer for big bodies). They flatten against each other and
//             can part again without merging.
//   neck    — the film breaks; a bridge grows (the smooth-min k rises over
//             ~0.85 s) and the bodies are pulled together.
//   converge — (blob–blob) over ~1 s both bodies slide to their common
//             centroid, grow to the combined area and elongate along the
//             join, moving at a shared velocity; at the end they are two
//             identical co-centred ellipses, so swapping in one body changes
//             no pixel. It then relaxes back to round.
//   absorb  — (blob–pool) over ~1.2 s the body's wax transfers into the pool
//             while its centre sinks below the surface; it's removed once
//             it's fully inside.
//   stretch — a bridged pair keeps separating; the bridge thins and snaps
//             (Rayleigh–Plateau), leaving a small satellite in between.
// The base pool is a body anchored at the bottom whose surface is an
// ellipse (poolSurfaceAt): sinking wax settles onto it and is absorbed, and
// now and then it bulges and pinches off a fresh blob (leaving about a
// third behind), so emission is pulsed like the real thing.
// Coordinates: x in [0, aspect], y in [0, 1] (up).

const lavaSim = {
  bodies: [],   // wax bodies (see newBody); the base pool is one of them
  pairs: [],    // coalescence state per touching pair: { a, b, state, drain, t, k, k0, … }
  pool: null,
  nextId: 1,
  seeded: false,
  emitAt: 0,
  cursor: { x: 0, y: 0, vx: 0, vy: 0, lx: 0, ly: 0, active: false, held: false, lastT: 0 },
};

const TAU = Math.PI * 2;
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (x, a, b) => THREE.MathUtils.smoothstep(x, a, b);

function newBody(o) {
  if (lavaSim.bodies.length >= LAVA_MAX) return null;
  const b = {
    id: lavaSim.nextId++, x: 0, y: 0, vx: 0, vy: 0, impX: 0, impY: 0, T: 0.5, area: 0.0064,
    aspect: 1, axX: 0, axY: 1, isPool: false, locked: false, noPairUntil: 0, lastCut: -10,
    inside: false, enterX: 0, enterY: 0, contact: 0, dwellPinched: false,
    ...o,
  };
  lavaSim.bodies.push(b);
  return b;
}

// Fresh lamp: a pool on the base and ten blobs spread across the width, the
// lower ones hot (rising), the upper ones cool (sinking).
function seedLavaSim(now) {
  const S = lavaSim;
  const aspect = canvas.width / canvas.height;
  S.bodies.length = 0;
  S.pairs.length = 0;
  S.nextId = 1;
  S.pool = newBody({ x: aspect / 2, y: 0, area: 0.035, areaVis: 0.035, T: 1, isPool: true });
  for (let i = 0; i < 10; i++) {
    const h1 = lavaHash(i + 1), h2 = lavaHash(i + 7.3), h3 = lavaHash(i + 13.7);
    const r = lerp(0.05, 0.11, h3);
    const y = lerp(0.15, 0.85, h2);
    newBody({
      x: (0.06 + 0.88 * (i + 0.25 + 0.5 * h1) / 10) * aspect, y, area: r * r,
      T: y < 0.5 ? 0.75 + 0.2 * h1 : 0.25 + 0.15 * h1,
    });
  }
  S.emitAt = now + 3;
  S.seeded = true;
  S.cursor.lx = S.cursor.x;
  S.cursor.ly = S.cursor.y;
}

function stepLavaSim(dt, now) {
  const P      = lavaPhysics;
  const S      = lavaSim;
  if (!S.seeded) seedLavaSim(now);
  const speed  = noiseUniforms.uLavaSpeed.value;
  const size   = noiseUniforms.uLavaSize.value;
  const aspect = canvas.width / canvas.height;
  const ds     = dt * speed;                         // lamp time: thermal + buoyancy
  const bodies = S.bodies, pairs = S.pairs, pool = S.pool, c = S.cursor;
  const R      = (b) => Math.sqrt(b.area) * size;    // circle-equivalent radius
  const minArea = P.minRadius * P.minRadius;
  pool.x = aspect / 2;                                // stay centred if the window's aspect changes
  const poolA  = aspect * P.poolWidth;
  // The pool's drawn (and contact) height follows its true area with a short
  // lag, so wax entering or leaving never steps the surface.
  pool.areaVis += (pool.area - pool.areaVis) * (1 - Math.exp(-dt / P.poolVisTau));
  const poolB  = pool.areaVis * size * size / poolA;  // pool semi-minor axis = its height at the centre
  // The pool is drawn as an ellipse, so its surface is lower off-centre;
  // the sim's contact uses the same curve.
  const poolSurfaceAt = (x) => poolB * Math.sqrt(Math.max(1 - ((x - pool.x) / poolA) ** 2, 0));
  const clamp  = THREE.MathUtils.clamp;

  // ── Cursor ──
  if (performance.now() / 1000 - c.lastT > 0.08) {
    const k = Math.exp(-dt * 10);
    c.vx *= k; c.vy *= k;
  }
  let cs = Math.hypot(c.vx, c.vy);
  const cvx = cs > 0 ? c.vx / cs : 0;   // unit direction of cursor travel
  const cvy = cs > 0 ? c.vy / cs : 0;
  cs = Math.min(cs, P.maxCursor);
  const gate = sstep(cs, 0.05, 0.3);    // a resting cursor doesn't push
  const cursorOn = feature8State.interactive && c.active;

  // Drop pairs whose bodies are gone.
  for (let n = pairs.length - 1; n >= 0; n--) {
    if (!bodies.includes(pairs[n].a) || !bodies.includes(pairs[n].b)) pairs.splice(n, 1);
  }

  // Geometry of a pair: radii, centre distance and the unit normal a → b.
  // The pool is treated as a body of its partner's radius sitting just
  // below it, so the same drain / neck / stretch rules apply to it.
  const geom = (a, b) => {
    if (b.isPool) { const g = geom(b, a); return { ...g, nx: -g.nx, ny: -g.ny, ra: g.rb, rb: g.ra }; }
    if (a.isPool) {
      const rb = R(b);
      return { ra: rb, rb, dist: (b.y - poolSurfaceAt(b.x)) + rb, nx: 0, ny: 1 };
    }
    const dx = b.x - a.x, dy = b.y - a.y;
    const dist = Math.hypot(dx, dy) || 1e-4;
    return { ra: R(a), rb: R(b), dist, nx: dx / dist, ny: dy / dist };
  };
  const findPair = (a, b) => pairs.find((p) => (p.a === a && p.b === b) || (p.a === b && p.b === a));
  const rEffOf = (g) => 2 * g.ra * g.rb / (g.ra + g.rb);   // harmonic radius
  const removeBody = (b) => { const i = bodies.indexOf(b); if (i >= 0) bodies.splice(i, 1); };
  const removePair = (pr) => { const i = pairs.indexOf(pr); if (i >= 0) pairs.splice(i, 1); };

  // Bridge snaps: a satellite is left in the middle of the gap — already
  // grown in over the back half of 'stretch' (F) if there was room for one,
  // otherwise (satellite too small, or the pair never lingered past tau=0.5
  // before rupturing) spawned fully formed here as a fallback.
  const rupture = (pr) => {
    const { a, b } = pr;
    if (pr.sat) {
      removePair(pr.satPairA); removePair(pr.satPairB);
      pr.sat.noPairUntil = now + 1.0;
    } else {
      const g = geom(a, b);
      const total = a.area + b.area;
      const satArea = total * lerp(P.satFrac[0], P.satFrac[1], lavaHash(now * 5.7 + a.id));
      const shareA = satArea * a.area / total, shareB = satArea - shareA;
      if (satArea >= minArea && a.area - shareA >= minArea && b.area - shareB >= minArea) {
        const gap = Math.max(g.dist - g.ra - g.rb, 0);
        const sx = a.isPool ? b.x : a.x + g.nx * g.ra;    // a's surface point
        const sy = a.isPool ? poolSurfaceAt(b.x) : a.y + g.ny * g.ra;
        const sat = newBody({
          x: sx + g.nx * gap / 2, y: sy + g.ny * gap / 2, area: satArea,
          T: (a.T + b.T) / 2, aspect: 1.4, axX: g.nx, axY: g.ny, noPairUntil: now + 1.5,
        });
        if (sat) { a.area -= shareA; b.area -= shareB; }
      }
    }
    a.noPairUntil = b.noPairUntil = now + 1.0;
    removePair(pr);
  };

  // Drop every pair (except `keep`) that involves any of the given bodies.
  const dropPairsOf = (keep, ...ws) => {
    for (let n = pairs.length - 1; n >= 0; n--) {
      const q = pairs[n];
      if (q !== keep && ws.some((w) => q.a === w || q.b === w)) pairs.splice(n, 1);
    }
  };

  // Bridge fully grown between two blobs: start the converge. Both bodies
  // stay alive; their offsets from the area-weighted centroid, areas, aspects
  // and axes are captured here and lerped in the pair loop. While converging
  // they're locked (no other pairs, no shape relaxation, no cutting).
  const beginConverge = (pr, g) => {
    const { a, b } = pr;
    const A = a.area + b.area;
    const wa = a.area / A, wb = b.area / A;
    const cx = a.x * wa + b.x * wb, cy = a.y * wa + b.y * wb;
    const alignedAxis = (w) => (w.axX * g.nx + w.axY * g.ny < 0) ? [-w.axX, -w.axY] : [w.axX, w.axY];
    Object.assign(pr, {
      state: 'converge', t: 0, A, wa, wb,
      offAx: a.x - cx, offAy: a.y - cy, offBx: b.x - cx, offBy: b.y - cy,
      area0a: a.area, area0b: b.area, aspect0a: a.aspect, aspect0b: b.aspect,
      ax0a: alignedAxis(a), ax0b: alignedAxis(b), nx: g.nx, ny: g.ny,
      k0: P.kMax * rEffOf(g),
    });
    a.locked = b.locked = true;
    a.noPairUntil = b.noPairUntil = now + P.tConv + 0.5;
    dropPairsOf(pr, a, b);
  };

  // Converge finished: the two bodies are identical and co-centred, so the
  // single body that replaces them (same centre, area, aspect, axis and
  // velocity) draws exactly the same pixels.
  const finishConverge = (pr) => {
    const { a, b, wa, wb } = pr;
    const cx = a.x * wa + b.x * wb, cy = a.y * wa + b.y * wb;
    removeBody(a); removeBody(b);
    dropPairsOf(null, a, b);
    newBody({
      x: cx, y: cy, vx: a.vx, vy: a.vy, area: pr.A,
      T: a.T * wa + b.T * wb, impX: a.impX * wa + b.impX * wb, impY: a.impY * wa + b.impY * wb,
      aspect: 1.6, axX: pr.nx, axY: pr.ny, noPairUntil: now + 0.5,
    });
  };

  // Bridge fully grown against the pool: start the absorb. The body is
  // locked; its wax transfers into the pool continuously in the pair loop.
  const beginAbsorb = (pr) => {
    const body = pr.a.isPool ? pr.b : pr.a;
    Object.assign(pr, { state: 'absorb', t: 0, area0: body.area });
    body.locked = true;
    body.noPairUntil = Infinity;
    dropPairsOf(pr, body);
  };

  // ── 1. Thermal lag + Stokes velocity ──
  for (const b of bodies) {
    if (b.isPool) continue;
    const r  = R(b);
    const rr = (r / P.rRef) ** 2;
    const tAmb = lerp(P.tHot, P.tCold, sstep(b.y, 0, P.plate));
    const tau  = Math.max(P.tauThermal * rr, 0.5);
    b.T += (tAmb - b.T) * (1 - Math.exp(-ds / tau));

    let vx = 0;
    let vy = P.vRise * (b.T - 0.5) * 2 * Math.max(rr, P.slowFloor) * speed;
    // recoil from a cut — the one velocity that lingers, briefly
    const kImp = Math.exp(-dt / 0.3);
    b.impX *= kImp; b.impY *= kImp;
    vx += b.impX; vy += b.impY;
    // cursor nudge, only on wax the needle touches, only while it moves
    if (cursorOn && gate > 0) {
      const dx = b.x - c.x, dy = b.y - c.y;
      const dist = Math.hypot(dx, dy);
      if (dist < r * 1.05 + P.reach) {
        const s = P.stir * gate;
        vx += cvx * cs * P.carry * s;
        vy += cvy * cs * P.carry * s;
        if (dist > 1e-4) {
          const ap = Math.max((cvx * dx + cvy * dy) / dist, 0) * cs;
          vx += dx / dist * ap * P.shove * s;
          vy += dy / dist * ap * P.shove * s;
        }
      }
    }
    const kv = 1 - Math.exp(-dt / 0.12);   // no inertia, just a little smoothing
    b.vx += (vx - b.vx) * kv;
    b.vy += (vy - b.vy) * kv;
  }

  // ── 2. Pairs: contact → drain → neck → merge, or neck → stretch → snap ──
  // State changes that remove/replace bodies (converge finish, absorb finish,
  // rupture) are queued here and applied after the double loop, so every
  // other pair still updates this frame instead of a one-frame hitch.
  const events = [];
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const a = bodies[i], b = bodies[j];
      const g = geom(a, b);
      const touch = g.dist < (g.ra + g.rb) * 1.02;
      const pr = findPair(a, b);
      if (!pr) {
        if (touch && now >= a.noPairUntil && now >= b.noPairUntil && pairs.length < LAVA_PAIRS * 2) {
          pairs.push({ a, b, state: 'drain', drain: 0, t: 0, k: 0, k0: 0 });
        }
        continue;
      }
      const rEff = rEffOf(g);

      if (pr.state === 'drain') {
        if (touch) pr.drain += dt / (P.kDrain * rEff ** 1.5);
        else       pr.drain -= dt / P.tDrainRelax;
        if (pr.drain <= 0) { removePair(pr); continue; }
        if (pr.drain >= 1) { pr.state = 'neck'; pr.t = 0; }
        // While the film drains the surfaces touch but don't mix: keep them
        // from overlapping (they flatten against each other). Stokes, so the
        // approaching velocity simply cancels — no bounce.
        const minD = (g.ra + g.rb) * 0.98;
        if (g.dist < minD) {
          // eased, not snapped: a pair that forms already overlapping (e.g. a
          // freshly merged, larger body resting on the pool) would otherwise
          // jump by the whole overlap — up to a cell — in one frame
          const ov = (minD - g.dist) * (1 - Math.exp(-dt / 0.15));
          if (a.isPool)      { b.x += g.nx * ov;     b.y += g.ny * ov; }
          else if (b.isPool) { a.x -= g.nx * ov;     a.y -= g.ny * ov; }
          else { a.x -= g.nx * ov / 2; a.y -= g.ny * ov / 2; b.x += g.nx * ov / 2; b.y += g.ny * ov / 2; }
        }
        const vn = (a.vx - b.vx) * g.nx + (a.vy - b.vy) * g.ny;   // > 0: closing in
        if (vn > 0) {
          if (a.isPool)      { b.vx += g.nx * vn;     b.vy += g.ny * vn; }
          else if (b.isPool) { a.vx -= g.nx * vn;     a.vy -= g.ny * vn; }
          else { a.vx -= g.nx * vn / 2; a.vy -= g.ny * vn / 2; b.vx += g.nx * vn / 2; b.vy += g.ny * vn / 2; }
        }
      } else if (pr.state === 'neck') {
        pr.t += dt;
        const tN = P.tNeckK * rEff;
        const grown = sstep(pr.t / tN, 0, 1);   // zero slope at both ends
        pr.k = P.kMax * rEff * grown;
        // capillary pull (Stokes: speed ∝ force / R)
        // Applied as a displacement (a velocity × dt), not added to b.vx/b.vy:
        // section 1 smooths vx/vy as persistent state, so an addition there
        // accumulates to pull/kv (~7.7× at 60 fps, frame-rate dependent) and
        // made necked blobs pass through each other / fall through the pool.
        const pull = P.pull * grown;
        if (!a.isPool) { a.x += g.nx * pull * rEff / g.ra * dt; a.y += g.ny * pull * rEff / g.ra * dt; }
        if (!b.isPool) { b.x -= g.nx * pull * rEff / g.rb * dt; b.y -= g.ny * pull * rEff / g.rb * dt; }
        if (g.dist > (g.ra + g.rb) * P.stretchBreak) {
          pr.state = 'stretch'; pr.t = 0; pr.k0 = pr.k; pr.d0 = g.dist;
        } else if (pr.t >= tN) {
          // bridge fully grown: hand over to the smooth join
          if (a.isPool || b.isPool) beginAbsorb(pr);
          else beginConverge(pr, g);
        }
      } else if (pr.state === 'converge') {
        pr.t += dt;
        const tau = Math.min(pr.t / P.tConv, 1);
        const e = sstep(tau, 0, 1);
        // shared velocity (area-weighted), so the pair drifts as one
        const vx = a.vx * pr.wa + b.vx * pr.wb, vy = a.vy * pr.wa + b.vy * pr.wb;
        a.vx = b.vx = vx; a.vy = b.vy = vy;
        // weights fixed at entry + shared velocity ⇒ this centroid is exact
        const cx = a.x * pr.wa + b.x * pr.wb, cy = a.y * pr.wa + b.y * pr.wb;
        a.x = cx + pr.offAx * (1 - e); a.y = cy + pr.offAy * (1 - e);
        b.x = cx + pr.offBx * (1 - e); b.y = cy + pr.offBy * (1 - e);
        a.area = lerp(pr.area0a, pr.A, e); b.area = lerp(pr.area0b, pr.A, e);
        a.aspect = lerp(pr.aspect0a, 1.6, e); b.aspect = lerp(pr.aspect0b, 1.6, e);
        for (const [w, ax0] of [[a, pr.ax0a], [b, pr.ax0b]]) {
          const x = lerp(ax0[0], pr.nx, e), y = lerp(ax0[1], pr.ny, e);
          const n = Math.hypot(x, y) || 1;
          w.axX = x / n; w.axY = y / n;
        }
        // hold the bridge, then fade it before the swap: smin of two
        // identical SDFs is dilated by k/4, so k must be 0 at the swap
        pr.k = pr.k0 * (1 - sstep(tau, 0.7, 1));
        if (tau >= 1) {
          events.push({ type: 'converge', pr });
        }
      } else if (pr.state === 'absorb') {
        const body = a.isPool ? b : a;
        pr.t += dt;
        const tau = Math.min(pr.t / P.tAbs, 1);
        const target = pr.area0 * (1 - sstep(tau, 0, 1));
        const dA = Math.max(body.area - target, 0);
        body.area -= dA; pool.area += dA;           // continuous transfer, no surface step
        const rc = R(body);
        body.vx = body.vy = 0;                      // the sink below is its only motion
        body.y += (poolSurfaceAt(body.x) - rc - body.y) * (1 - Math.exp(-dt / P.tAbsFollow));
        pr.k = P.kMax * rc;
        if (body.area < minArea) {                  // fully inside the pool's SDF by now
          events.push({ type: 'absorbDone', pr });
        }
      } else if (pr.state === 'emerge') {
        // grows from minArea to its target, drawing the difference straight
        // out of the pool, while its own buoyancy (it's hot) lifts it clear;
        // once it's pulled far enough away it hands off to the normal
        // stretch → rupture pinch-off, same as any other neck would
        const body = a.isPool ? b : a;
        pr.t += dt;
        const tau = Math.min(pr.t / P.tEmerge, 1);
        const newArea = lerp(minArea, pr.targetArea, sstep(tau, 0, 1));
        const dA = newArea - body.area;
        if (dA > 0) { body.area = newArea; pool.area -= dA; }
        pr.k = P.kMax * R(body);
        if (g.dist > (g.ra + g.rb) * P.stretchBreak) {
          pr.state = 'stretch'; pr.t = 0; pr.k0 = pr.k; pr.d0 = g.dist;
        }
      } else if (pr.state === 'stretch') {
        const tP = P.tPinch * Math.sqrt(rEff / P.rRef) * (pr.fast ? 0.35 : 1);
        pr.t += dt;
        const tau = Math.min(pr.t / tP, 1);
        pr.k = pr.k0 * (1 - sstep(tau, 0, 1));      // zero slope both ends: thins, doesn't snap
        const pull = P.pull * 0.3 * (1 - tau);      // a thinning bridge still tugs a little
        if (!a.isPool) { a.x += g.nx * pull * rEff / g.ra * dt; a.y += g.ny * pull * rEff / g.ra * dt; }
        if (!b.isPool) { b.x -= g.nx * pull * rEff / g.rb * dt; b.y -= g.ny * pull * rEff / g.rb * dt; }
        // F: bead a satellite into existence at the gap midpoint partway
        // through the thinning (fed by two little bridges that mirror the
        // parent bridge's k), instead of it popping in fully formed at rupture
        if (!pr.sat && tau >= 0.5) {
          const total = a.area + b.area;
          const satArea = total * lerp(P.satFrac[0], P.satFrac[1], lavaHash(now * 5.7 + a.id));
          const shareA = satArea * a.area / total, shareB = satArea - shareA;
          if (satArea >= minArea && a.area - shareA >= minArea && b.area - shareB >= minArea) {
            const gap = Math.max(g.dist - g.ra - g.rb, 0);
            const sx = a.isPool ? b.x : a.x + g.nx * g.ra;
            const sy = a.isPool ? poolSurfaceAt(b.x) : a.y + g.ny * g.ra;
            const sat = newBody({
              x: sx + g.nx * gap / 2, y: sy + g.ny * gap / 2, area: minArea,
              T: (a.T + b.T) / 2, aspect: 1.4, axX: g.nx, axY: g.ny, noPairUntil: Infinity,
            });
            if (sat) {
              pr.sat = sat; pr.satTarget = satArea;
              pr.satShareA = shareA / satArea; pr.satShareB = shareB / satArea;
              pr.satPairA = { a, b: sat, state: 'satBridge', k: pr.k * 0.5 };
              pr.satPairB = { a: sat, b, state: 'satBridge', k: pr.k * 0.5 };
              pairs.push(pr.satPairA, pr.satPairB);
            }
          }
        }
        if (pr.sat) {
          const e = sstep(tau, 0.5, 1);
          const newSatArea = lerp(minArea, pr.satTarget, e);
          const dA = newSatArea - pr.sat.area;
          if (dA > 0) {
            pr.sat.area = newSatArea;
            a.area -= dA * pr.satShareA; b.area -= dA * pr.satShareB;
          }
          pr.satPairA.k = pr.satPairB.k = pr.k * 0.5;
        }
        if (tau >= 1) {
          events.push({ type: 'rupture', pr });
        } else if (g.dist < pr.d0 * 0.9) {
          // actually coming back together (not just still close — the two
          // halves of a cut, or a blob leaving the pool, start overlapping):
          // the bridge regrows from where it is
          pr.state = 'neck';
          // inverse of grown = smoothstep(t/tN): closed form for 3x²-2x³ = grown
          const grown = clamp(pr.k / (P.kMax * rEff), 0, 1);
          pr.t = (P.tNeckK * rEff) * (0.5 - Math.sin(Math.asin(clamp(1 - 2 * grown, -1, 1)) / 3));
          if (pr.sat) {
            // the parents are re-merging instead of separating: leave the
            // partial satellite as its own small free body, stop tracking it
            removePair(pr.satPairA); removePair(pr.satPairB);
            pr.sat.noPairUntil = now + 0.5;
            pr.sat = pr.satPairA = pr.satPairB = null;
          }
        }
      }
    }
  }

  // Apply queued state changes now that every pair has updated this frame.
  for (const ev of events) {
    if (ev.type === 'converge') {
      finishConverge(ev.pr);
    } else if (ev.type === 'absorbDone') {
      const body = ev.pr.a.isPool ? ev.pr.b : ev.pr.a;
      pool.area += body.area;
      removeBody(body);
      removePair(ev.pr);
    } else if (ev.type === 'rupture') {
      rupture(ev.pr);
    }
  }

  // ── 3. Integrate, walls ──
  const inPoolPair = new Set();
  for (const p of pairs) { if (p.a.isPool) inPoolPair.add(p.b); else if (p.b.isPool) inPoolPair.add(p.a); }
  for (const b of bodies) {
    if (b.isPool) continue;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    const r = R(b);
    b.x = clamp(b.x, r, aspect - r);
    if (b.y > 1 - r) { b.y = 1 - r; if (b.vy > 0) b.vy = 0; }
    // free bodies rest on the pool surface; ones paired with it may go under
    const floor = poolSurfaceAt(b.x) - r * 0.2;
    if (!inPoolPair.has(b) && b.y < floor) { b.y = floor; if (b.vy < 0) b.vy = 0; }
  }

  // ── 4. Shape: a little elongation along the motion, relaxing to round ──
  // (converging / absorbing bodies are driven by their pair instead)
  for (const b of bodies) {
    if (b.isPool || b.locked) continue;
    const sp = Math.hypot(b.vx, b.vy);
    const target = 1 + 0.3 * Math.min(sp / (P.vRise * Math.max(speed, 0.1)), 1.5);
    b.aspect += (target - b.aspect) * (1 - Math.exp(-dt / P.tauRelax));
    if (sp > 0.002) {
      let tx = b.vx / sp, ty = b.vy / sp;
      if (tx * b.axX + ty * b.axY < 0) { tx = -tx; ty = -ty; }   // axis is sign-free
      const e = 1 - Math.exp(-dt / 1.5);
      b.axX += (tx - b.axX) * e;
      b.axY += (ty - b.axY) * e;
      const n = Math.hypot(b.axX, b.axY) || 1;
      b.axX /= n; b.axY /= n;
    }
  }

  // ── 5. Base pool: bulge and pinch off a blob now and then ──
  if (now >= S.emitAt) {
    const excess = pool.area - P.poolFloor;
    if (excess > 0.006 && bodies.length < LAVA_MAX - 2) {
      const targetArea = P.emitFrac * excess;
      const rTarget = Math.sqrt(targetArea) * size;
      const h = lavaHash(now * 7.1 + S.nextId);
      const x = (0.15 + 0.7 * h) * aspect;
      // starts tiny and submerged; 'emerge' below grows it to targetArea
      // while it floats up, rather than popping into existence full-sized
      const b = newBody({
        x, y: poolSurfaceAt(x) - rTarget, area: minArea, T: 1.0,
        aspect: 1.3, axX: 0, axY: 1, noPairUntil: now + 0.3,
      });
      if (b) pairs.push({ a: pool, b, state: 'emerge', t: 0, targetArea, k0: 0, k: 0 });
    }
    S.emitAt = now + lerp(P.emitEvery[0], P.emitEvery[1], lavaHash(now * 3.3)) / Math.sqrt(Math.max(speed, 0.1));
  }

  // ── 6. Cursor: cuts, pinches, warming (Interactive only) ──
  // The chord the needle drew through a body slices it: the far segment
  // becomes a new body joined by a bridge that thins fast and snaps.
  const cutBody = (w) => {
    if (now - w.lastCut < 0.3) return;
    const lx = c.x - w.enterX, ly = c.y - w.enterY;
    const len = Math.hypot(lx, ly);
    const r = R(w);
    if (len < 0.5 * r) return;                               // a real pass, not jitter
    w.lastCut = now;
    let nx = -ly / len, ny = lx / len;                       // chord normal
    const h = (w.x - w.enterX) * nx + (w.y - w.enterY) * ny;
    if (h > 0) { nx = -nx; ny = -ny; }                       // n points away from the centre
    const hh = Math.min(Math.abs(h), r);
    const theta = 2 * Math.acos(hh / r);
    const frac = (theta - Math.sin(theta)) / TAU;            // far segment's share of the area
    if (frac < P.minCut) return;
    const childArea = w.area * frac;
    if (childArea < minArea || w.area - childArea < minArea) return;
    const cd = (4 * r * Math.sin(theta / 2) ** 3) / (3 * (theta - Math.sin(theta)));
    const child = newBody({
      x: w.x + nx * cd, y: w.y + ny * cd, area: childArea, T: w.T,
      aspect: 1.2, axX: nx, axY: ny, noPairUntil: now + 0.5,
    });
    if (!child) return;
    w.area -= childArea;
    w.x -= nx * cd * frac / (1 - frac);
    w.y -= ny * cd * frac / (1 - frac);
    w.noPairUntil = now + 0.5;
    // Two halves of a disc sit closer than their rounded-off selves would:
    // capillary retraction snaps them apart to just past touching. The
    // impulse decays with τ = 0.3 s, so each travels v0·τ.
    const g = geom(w, child);
    const v0 = Math.max(0, 1.08 * (g.ra + g.rb) - g.dist) / 2 / 0.3;
    child.impX = g.nx * v0; child.impY = g.ny * v0;
    w.impX -= g.nx * v0;    w.impY -= g.ny * v0;
    const rEff = rEffOf(g);
    pairs.push({ a: w, b: child, state: 'stretch', drain: 1, t: 0, k0: P.kMax * rEff * 0.8, k: P.kMax * rEff * 0.8, d0: g.dist, fast: true });
  };

  // A resting touch inside a body pinches off a small drop toward the cursor.
  const pinchSmall = (w) => {
    const childArea = w.area * P.pinchFrac;
    if (childArea < minArea || w.area - childArea < minArea) return;
    let nx = c.x - w.x, ny = c.y - w.y;
    const n = Math.hypot(nx, ny);
    if (n > 1e-4) { nx /= n; ny /= n; } else { nx = 0; ny = -1; }
    const rd = Math.sqrt(childArea) * size;
    const child = newBody({
      x: c.x + nx * rd, y: c.y + ny * rd, area: childArea, T: w.T, noPairUntil: now + 1.0,
    });
    if (!child) return;
    w.area -= childArea;
    w.noPairUntil = now + 1.0;
    const g = geom(w, child);                     // snap the drop clear of its parent
    const v0 = Math.max(0, 1.08 * (g.ra + g.rb) - g.dist) / 0.3;
    child.impX = g.nx * v0; child.impY = g.ny * v0;
  };

  // Needle contact: does the cursor's path this frame cross the body? With
  // hysteresis, so a body drifting past a resting cursor doesn't flicker
  // in and out of contact every frame.
  const touching = (w) => {
    const Rt = (R(w) * 1.05 + P.reach) * (w.inside ? 1.2 : 1.0);
    const sx = c.x - c.lx, sy = c.y - c.ly;
    const ss = sx * sx + sy * sy;
    let u = ss > 1e-9 ? ((w.x - c.lx) * sx + (w.y - c.ly) * sy) / ss : 0;
    u = clamp(u, 0, 1);
    return Math.hypot(w.x - (c.lx + sx * u), w.y - (c.ly + sy * u)) < Rt;
  };

  if (cursorOn) {
    const n0 = bodies.length;   // bodies added by a cut wait until next frame
    for (let i = 0; i < n0; i++) {
      const w = bodies[i];
      if (w.isPool || w.locked) continue;   // mid-merge wax isn't cuttable
      const inside = touching(w);
      if (inside && !w.inside) { w.enterX = c.lx; w.enterY = c.ly; w.contact = 0; w.dwellPinched = false; }
      if (inside) {
        w.contact += dt;
        if (c.held) w.T = Math.min(w.T + P.touch * dt, 1);
        if (!w.dwellPinched && w.contact > P.pinchAfter && cs < 0.05) { pinchSmall(w); w.dwellPinched = true; }
      } else if (w.inside) {
        cutBody(w);
      }
      w.inside = inside;
    }
  } else {
    for (const w of bodies) w.inside = false;
  }

  // ── 7. Upload ──
  bodies.forEach((b, i) => {
    if (b.isPool) {
      lavaBodyArray[i].set(b.x, 0, poolA, poolB);
      lavaAxisArray[i].set(1, 0);
    } else {
      const r = R(b), s = Math.sqrt(b.aspect);
      lavaBodyArray[i].set(b.x, b.y, r * s, r / s);
      lavaAxisArray[i].set(b.axX, b.axY);
    }
  });
  noiseUniforms.uLavaBodyCount.value = bodies.length;
  let np = 0;
  for (const pr of pairs) {
    if (np >= LAVA_PAIRS || pr.k <= 1e-4) continue;
    const i = bodies.indexOf(pr.a), j = bodies.indexOf(pr.b);
    if (i < 0 || j < 0) continue;
    lavaPairArray[np++].set(i, j, pr.k);
  }
  noiseUniforms.uLavaPairCount.value = np;
  c.lx = c.x; c.ly = c.y;
}

canvas.addEventListener('pointermove', (e) => {
  if (!feature8State.interactive) return;
  const rect = canvas.getBoundingClientRect();
  const aspect = canvas.width / canvas.height;
  const x = (e.clientX - rect.left) / rect.width * aspect;
  const y = 1 - (e.clientY - rect.top) / rect.height;
  const now = performance.now() / 1000;
  const c = lavaSim.cursor;
  if (c.active) {
    const dtm = Math.max(now - c.lastT, 1e-3);
    c.vx = lerp(c.vx, (x - c.x) / dtm, 0.5);
    c.vy = lerp(c.vy, (y - c.y) / dtm, 0.5);
  }
  c.x = x; c.y = y; c.lastT = now; c.active = true;
});

canvas.addEventListener('pointerleave', () => {
  const c = lavaSim.cursor;
  c.active = false; c.held = false; c.vx = 0; c.vy = 0;
});

canvas.addEventListener('pointerdown', (e) => {
  if (e.button === 0) lavaSim.cursor.held = true;
});

window.addEventListener('pointerup', () => {
  lavaSim.cursor.held = false;
});

// ═══════════════════════════════════════════════════════════
// RESIZE
// ═══════════════════════════════════════════════════════════

function onResize() {
  const w = window.innerWidth;
  const h = window.innerHeight;

  renderer.setSize(w, h);

  // Render targets take raw pixels (no pixel ratio), so size them from the
  // drawing buffer — otherwise on a 2× display they're half the canvas res.
  const cw = canvas.width;
  const ch = canvas.height;
  rtA.setSize(cw, ch);
  rtB.setSize(cw, ch);
  rtComposite.setSize(cw, ch);
  crtFeedback[0].setSize(cw, ch);
  crtFeedback[1].setSize(cw, ch);

  const bw = Math.max(1, Math.floor(cw * bloomScale));
  const bh = Math.max(1, Math.floor(ch * bloomScale));
  rtBloom.setSize(bw, bh);
  bloomUniforms.uTexelSize.value.set(1 / bw, 1 / bh);

  // CP437: one noise texel per cell; the UV scale maps texel i's center
  // exactly onto the center of on-screen cell i (the last row/col overhangs).
  const cols = Math.ceil(cw / CP437_CELL.x);
  const rows = Math.ceil(ch / CP437_CELL.y);
  rtCells.setSize(cols, rows);
  asciiUniforms.uGrid.value.set(cols, rows);
  cellUvScale.set((cols * CP437_CELL.x) / cw, (rows * CP437_CELL.y) / ch);

  lavaBloomLevels.forEach((level) => {
    const lw = Math.max(1, Math.floor(cw * level.scale));
    const lh = Math.max(1, Math.floor(ch * level.scale));
    level.horizontal.setSize(lw, lh);
    level.target.setSize(lw, lh);
    level.material.uniforms.uInvSize.value.set(1 / lw, 1 / lh);
  });

  asciiUniforms.uResolution.value.set(canvas.width, canvas.height);
  noiseUniforms.uResolution.value.set(canvas.width, canvas.height);
  crtUniforms.uResolution.value.set(canvas.width, canvas.height);
}

window.addEventListener('resize', onResize);
onResize();

// ═══════════════════════════════════════════════════════════
// LOOP
// ═══════════════════════════════════════════════════════════

const clock = new THREE.Timer();
let lastFrameTime = 0;

function animate(timestamp) {
  requestAnimationFrame(animate);

  clock.update(timestamp);
  const now = clock.getElapsed();
  const dt = Math.min(now - lastFrameTime, 0.1);
  lastFrameTime = now;

  noiseUniforms.uTime.value = now;

  if (feature8State.enabled) stepLavaSim(dt, now);

  if (feature6State.enabled && !kaleidoParams.locked) {
    noiseUniforms.uKaleidoRotation.value += kaleidoParams.autoSpeed * dt;
  }

  // Beat ripple — only while the kaleidoscope itself is on. The `while`
  // keeps the phase exact across a long frame; if we're more than a second
  // behind (tab was hidden) we resync instead of firing a burst.
  if (kaleidoRipple.enabled && feature6State.enabled) {
    const interval = snareInterval();
    if (now - kaleidoRipple.next > 1.0) kaleidoRipple.next = now;
    while (now >= kaleidoRipple.next) {
      const c = noiseUniforms.uKaleidoCenter.value;
      pushRipple(c.x, c.y, 1.0);
      kaleidoRipple.next += interval;
    }
  }

  // ── Base: noise → rtA (or → one texel per cell for the CP437 style) ──
  const cp437 = asciiUniforms.uLavaAscii.value > 0.5;
  const noiseTarget = cp437 ? rtCells : rtA;
  if (cp437) noiseUniforms.uUvScale.value.copy(cellUvScale);
  else noiseUniforms.uUvScale.value.set(1, 1);

  renderer.setRenderTarget(noiseTarget);
  renderer.render(noiseScene, camera);

  asciiUniforms.uTexture.value = noiseTarget.texture;

  if (!magicPipelineEnabled && cp437 && feature8State.bloom) {
    // ASCII → rtB, bloom chain, additive composite → screen
    renderer.setRenderTarget(rtB);
    renderer.render(asciiScene, camera);

    let src = rtB;
    for (const level of lavaBloomLevels) {
      const u = level.material.uniforms;
      lavaBloomMesh.material = level.material;

      u.uTexture.value = src.texture;
      u.uDirection.value.set(1, 0);
      renderer.setRenderTarget(level.horizontal);
      renderer.render(lavaBloomScene, camera);

      u.uTexture.value = level.horizontal.texture;
      u.uDirection.value.set(0, 1);
      renderer.setRenderTarget(level.target);
      renderer.render(lavaBloomScene, camera);

      src = level.target;
    }

    renderer.setRenderTarget(null);
    renderer.render(lavaCompositeScene, camera);
  } else if (magicPipelineEnabled) {
    renderer.setRenderTarget(rtB);
    renderer.render(asciiScene, camera);

    bloomUniforms.uTexture.value = rtB.texture;
    renderer.setRenderTarget(rtBloom);
    renderer.render(bloomScene, camera);

    bloomCompositeUniforms.uBase.value  = rtB.texture;
    bloomCompositeUniforms.uBloom.value = rtBloom.texture;
    renderer.setRenderTarget(rtComposite);
    renderer.render(bloomCompositeScene, camera);

    const feedbackRead  = crtFeedback[crtReadIndex];
    const feedbackWrite = crtFeedback[1 - crtReadIndex];

    crtFeedbackUniforms.uTexture.value   = rtComposite.texture;
    crtFeedbackUniforms.uPrevFrame.value = feedbackRead.texture;

    renderer.setRenderTarget(feedbackWrite);
    renderer.render(crtFeedbackScene, camera);

    crtUniforms.uTexture.value = feedbackWrite.texture;
    crtUniforms.uTime.value    = now;

    renderer.setRenderTarget(null);
    renderer.render(crtScene, camera);

    crtReadIndex = 1 - crtReadIndex;
  } else {
    renderer.setRenderTarget(null);
    renderer.render(asciiScene, camera);
  }
}

animate();