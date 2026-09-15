# Lava lamp — blob animation fixes

**Status:** spec, not yet implemented.
**Supersedes** any earlier guidance in chat history about lava physics constants
and bloom kernel radii. Two numbers given earlier were wrong and may survive in a
compaction summary: `kDrain = 12` (too small by ~60×) and bloom kernel radii
`[6,10,14,18,22]` (should be `[3,5,7,9,11]`). The values in this file are correct.

Files involved: `main.js` (FEATURE 8 section), `shaders/noise.frag.glsl` (`lavaSDF`).

---

## Problem

Two symptoms, one root cause:

1. Blob–blob merges happen too fast and pop.
2. Return to the base pool is not smooth at all.

The state machine (`drain → neck → merge` / `neck → stretch → rupture`) is the
right shape. The problems are that **every state exit is a hard swap** and
**every timing constant is 5–60× too short**.

---

## 1. Blob–blob merge — measured

For a typical pair, `ra = rb = 0.06`, so `rEff = 0.06`:

| Phase | Code | Actual duration |
|---|---|---|
| drain | `dt / (kDrain · rEff^1.5)` = `dt / (12 · 0.0147)` | **0.18 s** (comment claims 1–4 s) |
| neck  | `tN = tNeckK · rEff = 6 · 0.06` | 0.36 s nominal… |
| neck (real) | exits early via `dist < (ra+rb)·0.75`; capillary `pull = 0.05`/side ⇒ ~0.1/s closing, 0.03 gap | **0.3 s** |

**Total first-touch → merged: ~0.5 s.**

### The pop

```js
removeBody(a); removeBody(b);
newBody({ x: centroid, area: A, aspect: min((semiMajor/rNew)**2, 3), axX: nx, ... })
```

At `dist = 0.09`, the union of two `r = 0.06` circles has waist half-width
`sqrt(0.06² − 0.045²) = 0.040` ⇒ waist ≈ 0.08 (≈0.095 with the smin fillet).
The replacement ellipse has `rNew = 0.085`, `aspect = 1.53`, semi-minor `0.069`
⇒ waist **0.137**. The waist grows ~45% in one frame and the fillet vanishes.

Also: `newBody` is not passed `vx, vy`, so the merged body starts at rest and
ramps back through `kv = 1 − exp(−dt/0.12)`. **Every merge stalls ~200 ms.**

---

## 2. Return to pool — frame by frame

Cold blob (`T = 0.25`, `r = 0.08`) sinks at `vy = 0.08·(0.25−0.5)·2 = −0.04/s`.

1. `geom(pool, b)` uses `dist = (b.y − poolTop) + rb` — the pool is a **flat
   infinite plane** at `poolTop`, independent of `x`. Touch at
   `b.y < poolTop + 1.04·rb`.
2. `drain`: the `minD` projection pins `b.y ≥ poolTop + 0.96·rb` and the `vn > 0`
   cancellation zeroes `vy`. **The blob stops dead, hovering one full radius
   above the pool**, for `12 · 0.08^1.5 = 0.27 s`.
3. `neck`: `pull` drags it down over `tN = 0.48 s`. Merge at `dist < 1.5·rb`
   ⇒ `b.y < poolTop + 0.5·rb`.
4. `merge()` pool branch: `pool.area += body.area; removeBody(body)`.
   **The blob is deleted while half of it is still above the surface.**
5. `poolB = pool.area · size² / poolA` recomputes: `0.035 → 0.0414` moves
   `poolB` from `0.033 → 0.039` — the surface **jumps 0.006 screen heights
   (~1/5 cell) in one frame**.

Stop → wait → vanish → pool jumps.

Secondary: the pool SDF in the shader is an ellipse of semi-major `0.6·aspect`,
so its visual surface at `x` is `poolB · sqrt(1 − ((x−cx)/poolA)²)` — 0.81·poolB
at the edges of the emission range. The sim's flat-plane contact sits above the
visual surface off-centre.

---

## 3. Emission has the same bug class

```js
const b = newBody({ y: poolTop + r*0.85, area, ... });  // materializes fully formed
pool.area -= area;                                       // surface steps down
pairs.push({ state: 'stretch', k: kMax*r, ... });
```

Blob pops into existence; pool surface steps. The stretch bridge then thins over
`tPinch · sqrt(r/0.08) ≈ 1.2 s` whether or not the blob has moved.

---

## 4. Curve shapes

- `grown = (t/tN)^0.6` has **infinite slope at t = 0**. First frame
  (`dt = 0.016`, `tN = 0.36`): `(0.044)^0.6 = 0.15` ⇒ k jumps to 15% of max in
  one frame.
- `k = k0 · sqrt(1 − tau)` has **infinite slope at tau = 1**: k is `0.32·k0` at
  `tau = 0.9`, `0.1·k0` at `0.99`, then 0. The bridge snaps rather than thins.
- `rupture()` spawns the satellite fully formed. Nothing was there the frame
  before.

---

## 5. `break outer`

After any `merge` / `rupture`, every other pair skips its update that frame.
With 3–4 active pairs that is a visible one-frame hitch on all of them.

---

# Fixes

## A. Constants (do first — half the problem, 2 minutes)

```js
kDrain:  12  ->  120     // 1.8 s at rEff 0.06, ~4 s at 0.1
tNeckK:  6   ->  14      // 0.85 s at rEff 0.06
```

In `'neck'`, **remove the `dist < (ra+rb)*0.75` early-exit**. Leave `'neck'`
only on `t >= tN`.

## B. New `'converge'` state (blob–blob merge)

Both bodies stay alive. Over `tConv ≈ 1.0 s`, with `e = smoothstep(0,1,tau)`:

```
p_a, p_b            -> lerp toward area-weighted centroid
area_a, area_b      -> lerp toward A_total        (both radii -> rNew)
aspect_a, aspect_b  -> lerp toward 1.6, axis -> nx (elongated along the join)
vx, vy              -> both set to weighted-average velocity every frame
k                   -> hold kMax*rEff until tau = 0.7, then -> 0 by tau = 1
```

At `tau = 1`: two identical co-centred ellipses with `k = 0`, so `min(d,d) = d`.
Swap to one body with the same centre, area, aspect, axis **and velocity** —
zero pixel change.

Why `k -> 0` before the swap: `smin(d, d, k) = d − k/4`. Two identical SDFs with
a live bridge render dilated by `k/4 ≈ 0.005` (a sixth of a cell). Ramp k down
once overlap is near-total.

**Skip `'converge'` bodies in section 4 (shape relaxation)** or the two systems
fight over `aspect` and `axis`.

## C. New `'absorb'` state (pool merge)

```
enter: neck complete against pool
each frame over tAbs ~= 1.2 s:
  dA         = lerp area_0 -> 0 with smoothstep
  body.area -= dA;  pool.area += dA
  body.y    += (poolSurfaceAt(x) - r_current - body.y) * (1 - exp(-dt/0.4))
  k          = kMax * r_current
remove body when area < minArea   (fully inside the pool SDF by then)
```

- **Remove the `poolTop − 0.2r` floor clamp** for bodies in a pool pair — they
  must go below the surface.
- Area transfers continuously, so `poolB` changes continuously and the surface
  jump in §2.5 disappears. Belt-and-braces: upload a smoothed `pool.areaVis`
  (tau = 0.5 s) rather than `pool.area` directly.
- In `geom()`, replace the flat `poolTop` with
  `poolSurfaceAt(x) = poolB * sqrt(max(1 - ((x - pool.x)/poolA)**2, 0))`
  so sim contact matches the visual surface.

## D. New `'emerge'` state (pool emission)

Create the body at `y = poolSurfaceAt(x) - r_target`, `area = minArea`.
Over `tEmerge ≈ 1.5 s`: `area -> target` (smoothstep) while `pool.area`
decreases by the same amount; `k = kMax * r_current`; body is hot so it rises on
its own. Hand off to the existing `'stretch'` logic when
`dist > stretchBreak*(ra+rb)`.

## E. Curves

```
neck:    grown = smoothstep(0.0, 1.0, t/tN)        // zero slope both ends
stretch: k = k0 * (1 - smoothstep(0.0, 1.0, tau))  // or (1-tau)^2 for a fast but C1 finish
```

## F. Satellite: spawn before rupture

At `tau = 0.5` in `'stretch'`, create the satellite at the gap midpoint with
`area = minArea`, in `'neck'` pairs with both parents at `k = 0.5*k_current`.
Grow its area to `satArea` (taken from the parents proportionally) by `tau = 1`,
and let those two bridges follow the parent bridge down to 0. The thread beads
visibly, then snaps.

## G. Deferred events

Replace `break outer` with a queue: push `{type:'merge', pr}` /
`{type:'rupture', pr}` during the pair loop, apply after it. All pairs update
every frame.

## H. Misc

`newBody` should take `vx, vy` explicitly in every path. Currently the only
velocity-like state passed through is `impX/impY`.

---

# Implementation order

1. **A** — constants + remove early merge exit. Sim already feels 3× slower and
   the merge waits for the neck.
2. **B** — `'converge'`. Blob–blob pop gone.
3. **C** — `'absorb'` + surface function + drop floor clamp. Return-to-base
   becomes three smooth phases.
4. **E**, **G** — curves + deferred queue. Micro-hitches.
5. **D**, **F** — `'emerge'` + satellite pre-spawn. Remaining two pops.

After 1–3, take a screen recording. Anything still hitching will be a specific
event and easy to isolate.

---

# Unrelated but still open (bloom)

In `main.js`, `lavaBloomLevels` uses kernel radii `[6, 10, 14, 18, 22]`.
`UnrealBloomPass` / `BloomNode` use `[3, 5, 7, 9, 11]` — the current values give
**2× the blur reach at every mip**, which is the oversized aura.
Also `SIGMA = kernelRadius` in the original, not `kernelRadius / 3`.
Fix both together.
