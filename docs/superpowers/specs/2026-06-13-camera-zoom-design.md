# Camera Zoom (perspective-locked) — Design

**Date:** 2026-06-13
**Status:** Approved (design); implementation plan pending

## Goal

Let the player zoom the isometric follow camera in and out with the **mouse wheel**,
while keeping the **exact same perspective** (look-down angle and lens). Zoom range is
0.6×–1.6× of the current slant distance, the chosen level **persists** across runs, and
in co-op manual zoom **composes** (multiplies) with the existing auto-framing.

## Background — current camera

The follow camera lives entirely in `src/survivors/HeroController.ts`:

- An isometric `FreeCamera`. `camera.inputs.clear()` disables ALL built-in camera
  manipulation (no pan/rotate/zoom today).
- Position derives from two tuning knobs:
  - `CAMERA_PITCH_DEG = 42` — the look-down angle (the "perspective" to preserve).
  - `CAMERA_DISTANCE = 26` (desktop) / `CAMERA_DISTANCE_MOBILE = 23` (< 700px) — slant range.
  - `cameraHeight = camDist · sin(pitch)`, `cameraOffsetZ = −camDist · cos(pitch)`.
- Rotation is set ONCE (`setTarget` then `rotation = rotation.clone()`) and never touched
  again — only `camera.position` is lerped per frame. The code comments warn that calling
  `setTarget()` per frame produces drift that reads as the map slowly rotating.
- Per-frame follow target:
  `(focus.x, focus.height, focus.z + cameraOffsetZ)`, lerped at `min(1, dt·6)`.
  `focus` comes from a co-op `cameraFocusProvider` (midpoint + auto-computed height) when
  set, else falls back to `{ x: pos.x, z: pos.z, height: cameraHeight }` in solo.
- Existing finite-guards keep `camera.position` from going NaN (sticky black-screen class).

## Chosen approach — scale the slant distance, keep rotation locked

Considered three approaches:

1. **Scale slant distance, lock rotation** ✅ chosen. Keep the locked rotation; scale
   `height` and `offsetZ` by the same factor. Because rotation never changes, the look-down
   angle is provably identical at every zoom — the strongest reading of "same perspective."
   Framing stays self-similar (hero stays proportionally just-below-center).
2. **Change FOV** — rejected. Telephoto↔wide *changes* the perspective (flattens/expands the
   lens), which is explicitly unwanted.
3. **Recompute `setTarget` each frame at the new distance** — rejected. Per-frame `setTarget()`
   causes the documented map-rotation drift.

## Core mechanic

Introduce a single `zoomMultiplier ∈ [CAMERA_ZOOM_MIN, CAMERA_ZOOM_MAX] = [0.6, 1.6]`,
default `1.0`. `cameraHeight` / `cameraOffsetZ` remain the **unzoomed base** values. The
per-frame follow target becomes:

```
target = ( focus.x,
           focus.height * zoom,
           focus.z + cameraOffsetZ * zoom )
```

Both height and offsetZ scale by the same `zoom` → the camera's distance from the focus
point scales while the angle stays constant. Rotation is locked, so the perspective is
identical at every zoom.

**Co-op composition falls out for free.** `focus.height` is the co-op auto-computed height
in co-op and the base `cameraHeight` in solo. Multiplying it by `zoom` (and scaling
`cameraOffsetZ` by the same `zoom`) means manual zoom *multiplies* whatever framing distance
is active — exactly the "compose" behavior chosen — with **no co-op-specific branch**. (We
do not change co-op's underlying auto-zoom behavior; it remains as-is and manual zoom rides
on top.)

## Input & feel

- **Mouse wheel only.** A canvas `wheel` listener attached with `{ passive: false }` so
  `preventDefault()` can stop page scroll / browser pinch-zoom. Removed in `dispose()`.
- **Multiplicative step** (`CAMERA_ZOOM_STEP = 1.1`): scroll up (`deltaY < 0`) → zoom in
  (`target /= 1.1`); scroll down → zoom out (`target *= 1.1`); result clamped to the range.
  ~5 notches end-to-end.
- **Smoothing:** the wheel sets `zoomTarget`; each frame the live `zoomMultiplier` lerps
  toward `zoomTarget` (same `min(1, dt·CAMERA_ZOOM_LERP)` pattern as position) → smooth
  glide, no snap.

## Persistence

- `localStorage` key `ktg.cameraZoom` holds the target multiplier as a string.
- Written whenever the target changes (a wheel notch; tiny string, negligible cost).
- Read + clamped at construction; NaN / missing / garbage → default `1.0`.
- The initial camera position is set to the **zoomed** values (base × persisted zoom) so
  there is no first-frame zoom pop on load.

## Rotation correctness on load

Rotation must be identical regardless of the saved zoom. Constructor order:

1. Create camera at the **base** position `(0, cameraHeight, cameraOffsetZ)`.
2. `setTarget((0, 0, CAMERA_AIM_AHEAD))` → derives the base look-down rotation.
3. `rotation = rotation.clone()` to lock it.
4. Load + clamp persisted zoom into `zoomMultiplier` and `zoomTarget`.
5. `camera.position.set(0, cameraHeight * zoom, cameraOffsetZ * zoom)`.

Because rotation is derived in step 2 from the base geometry and then frozen, it never
depends on the zoom level.

## Code structure

- **New pure module `src/survivors/cameraZoom.ts`** (no Babylon imports):
  - `clampZoom(z): number` — clamp to `[CAMERA_ZOOM_MIN, CAMERA_ZOOM_MAX]`.
  - `stepZoom(current, deltaY): number` — apply one multiplicative wheel step, clamped.
  - `lerpZoom(current, target, dt): number` — frame-rate-independent ease toward target.
  - `parsePersistedZoom(raw: string | null): number` — parse + clamp, default `1.0` on
    NaN/garbage/null.
  - Range/step/lerp constants exported from here so both the module and `HeroController`
    share one source of truth.
- **`HeroController.ts`** — thin wiring only:
  - Fields: `zoomMultiplier`, `zoomTarget`, the bound wheel handler, the canvas ref.
  - Constructor: keep `cameraHeight`/`cameraOffsetZ` as base; load persisted zoom; set
    initial zoomed position; attach the wheel listener.
  - Follow block: lerp `zoomMultiplier` → `zoomTarget`; apply to the target as above.
  - `dispose()`: remove the wheel listener.
  - Wheel handler: `preventDefault()`, `zoomTarget = stepZoom(zoomTarget, deltaY)`, persist.

## Safety

- `zoomMultiplier` is always clamped to `[0.6, 1.6]`, so it can never introduce NaN into the
  camera transform; the existing `camera.position` finite-guards remain untouched.
- `parsePersistedZoom` defends against corrupt localStorage values.

## Testing

- **Vitest** unit tests for `cameraZoom.ts` (pure logic, matching the `integrateMove.ts` /
  `renderHealth.ts` convention): clamping at both bounds, step direction + magnitude,
  multiple steps converging on the bounds, lerp monotonic-toward-target and `dt`-scaling,
  `parsePersistedZoom` on valid / out-of-range / NaN / null / non-numeric input.
- Manual smoke: wheel in/out in solo (angle visibly unchanged, smooth glide, clamps at both
  ends); reload preserves zoom; co-op separation auto-zoom still works and manual zoom scales
  around it.

## Out of scope (YAGNI)

- Pinch/touch, keyboard, and on-screen-button inputs (wheel-only was chosen; all are trivial
  future adds through the same pure module).
- Changing co-op's underlying auto-zoom framing math.
- Any per-champion or per-map zoom defaults.
