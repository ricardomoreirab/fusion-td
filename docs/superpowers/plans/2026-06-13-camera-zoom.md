# Camera Zoom (perspective-locked) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add mouse-wheel zoom to the isometric follow camera that scales the slant distance while keeping the look-down angle (perspective) and FOV exactly constant, with the chosen level persisted to localStorage and composing with co-op auto-framing.

**Architecture:** A pure, Vitest-covered module `src/survivors/cameraZoom.ts` owns all zoom math (clamp / wheel-step / ease / persisted-value parse). `HeroController` wires a DOM `wheel` listener to it, eases a live multiplier toward the wheel-set target each frame, and scales both `cameraHeight` and `cameraOffsetZ` by it — so the locked camera rotation never changes and the perspective is provably identical at every zoom.

**Tech Stack:** TypeScript, BabylonJS (`FreeCamera`), Vitest (node environment, pure-logic only).

**Spec:** `docs/superpowers/specs/2026-06-13-camera-zoom-design.md`

---

## File Structure

- **Create** `src/survivors/cameraZoom.ts` — pure zoom math + tuning constants. No Babylon, no DOM. Single responsibility: convert wheel input and persisted strings into a clamped, eased zoom multiplier.
- **Create** `tests/cameraZoom.spec.ts` — Vitest unit tests for the pure module.
- **Modify** `src/survivors/HeroController.ts` — wire wheel events + per-frame application onto the existing camera. Thin: it imports the pure module for all arithmetic.

---

## Task 1: Pure zoom math module (`cameraZoom.ts`)

**Files:**
- Create: `src/survivors/cameraZoom.ts`
- Test: `tests/cameraZoom.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/cameraZoom.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  clampZoom, stepZoom, lerpZoom, parsePersistedZoom,
  CAMERA_ZOOM_MIN, CAMERA_ZOOM_MAX, CAMERA_ZOOM_DEFAULT, CAMERA_ZOOM_STEP,
} from '../src/survivors/cameraZoom';

describe('range constants', () => {
  it('are the 0.6x-1.6x band with a 1.0x default', () => {
    expect(CAMERA_ZOOM_MIN).toBe(0.6);
    expect(CAMERA_ZOOM_MAX).toBe(1.6);
    expect(CAMERA_ZOOM_DEFAULT).toBe(1.0);
    expect(CAMERA_ZOOM_STEP).toBeGreaterThan(1); // multiplicative step
  });
});

describe('clampZoom', () => {
  it('passes through an in-range value', () => {
    expect(clampZoom(1.0)).toBe(1.0);
    expect(clampZoom(1.25)).toBe(1.25);
  });
  it('clamps at both bounds', () => {
    expect(clampZoom(5)).toBe(CAMERA_ZOOM_MAX);
    expect(clampZoom(0.1)).toBe(CAMERA_ZOOM_MIN);
  });
  it('non-finite input falls back to the default (NaN can never reach the camera transform)', () => {
    expect(clampZoom(NaN)).toBe(CAMERA_ZOOM_DEFAULT);
    expect(clampZoom(Infinity)).toBe(CAMERA_ZOOM_DEFAULT);
    expect(clampZoom(-Infinity)).toBe(CAMERA_ZOOM_DEFAULT);
  });
});

describe('stepZoom', () => {
  it('scroll up (deltaY < 0) zooms IN — smaller multiplier', () => {
    expect(stepZoom(1.0, -100)).toBeCloseTo(1.0 / CAMERA_ZOOM_STEP, 12);
  });
  it('scroll down (deltaY > 0) zooms OUT — larger multiplier', () => {
    expect(stepZoom(1.0, 100)).toBeCloseTo(1.0 * CAMERA_ZOOM_STEP, 12);
  });
  it('deltaY === 0 is a clamped no-op', () => {
    expect(stepZoom(1.2, 0)).toBe(1.2);
  });
  it('repeated out-steps converge exactly on the max', () => {
    let z = 1.0;
    for (let i = 0; i < 25; i++) z = stepZoom(z, 1);
    expect(z).toBe(CAMERA_ZOOM_MAX);
  });
  it('repeated in-steps converge exactly on the min', () => {
    let z = 1.0;
    for (let i = 0; i < 25; i++) z = stepZoom(z, -1);
    expect(z).toBe(CAMERA_ZOOM_MIN);
  });
});

describe('lerpZoom', () => {
  it('dt <= 0 does not move', () => {
    expect(lerpZoom(1.0, 1.5, 0)).toBe(1.0);
    expect(lerpZoom(1.0, 1.5, -0.5)).toBe(1.0);
  });
  it('eases toward the target, staying strictly between for a small dt', () => {
    const r = lerpZoom(1.0, 1.5, 0.05);
    expect(r).toBeGreaterThan(1.0);
    expect(r).toBeLessThan(1.5);
  });
  it('a large dt reaches (does not overshoot) the target', () => {
    expect(lerpZoom(1.0, 1.5, 10)).toBe(1.5);
    expect(lerpZoom(1.5, 0.6, 10)).toBe(0.6);
  });
});

describe('parsePersistedZoom', () => {
  it('null (nothing saved) -> default', () => {
    expect(parsePersistedZoom(null)).toBe(CAMERA_ZOOM_DEFAULT);
  });
  it('a valid in-range string round-trips', () => {
    expect(parsePersistedZoom('1.3')).toBe(1.3);
  });
  it('out-of-range strings clamp', () => {
    expect(parsePersistedZoom('99')).toBe(CAMERA_ZOOM_MAX);
    expect(parsePersistedZoom('0.01')).toBe(CAMERA_ZOOM_MIN);
  });
  it('garbage / empty / NaN -> default', () => {
    expect(parsePersistedZoom('abc')).toBe(CAMERA_ZOOM_DEFAULT);
    expect(parsePersistedZoom('')).toBe(CAMERA_ZOOM_DEFAULT);
    expect(parsePersistedZoom('NaN')).toBe(CAMERA_ZOOM_DEFAULT);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/cameraZoom.spec.ts`
Expected: FAIL — cannot resolve `../src/survivors/cameraZoom` (module does not exist yet).

- [ ] **Step 3: Write the implementation**

Create `src/survivors/cameraZoom.ts`:

```ts
// Pure mouse-wheel zoom math for the isometric follow camera — no Babylon, no DOM,
// safe for Vitest. HeroController wires DOM wheel events + a per-frame ease onto these
// helpers. "Zoom" is a multiplier on the camera's BASE slant distance: scaling camera
// height AND z-offset by the same factor keeps the look-down angle (the perspective)
// exactly constant, because the camera's locked rotation never changes.

/** Closest the camera may zoom in (0.6x the base slant distance). */
export const CAMERA_ZOOM_MIN = 0.6;
/** Farthest the camera may zoom out (1.6x the base slant distance). */
export const CAMERA_ZOOM_MAX = 1.6;
/** Zoom multiplier when nothing is persisted. */
export const CAMERA_ZOOM_DEFAULT = 1.0;
/** Multiplicative change per wheel notch (~5 notches across the full range). */
export const CAMERA_ZOOM_STEP = 1.1;
/** Frame-rate-independent ease factor for gliding the live zoom toward its target. */
export const CAMERA_ZOOM_LERP = 8;

/** Clamp a zoom multiplier into [MIN, MAX]; non-finite input falls back to DEFAULT
 *  so a bad value can never poison the camera transform. */
export function clampZoom(z: number): number {
    if (!Number.isFinite(z)) return CAMERA_ZOOM_DEFAULT;
    return Math.min(CAMERA_ZOOM_MAX, Math.max(CAMERA_ZOOM_MIN, z));
}

/** Apply one wheel notch to the current zoom target. Wheel deltaY < 0 (scroll up)
 *  zooms IN (smaller multiplier = closer); deltaY > 0 zooms OUT; deltaY === 0 is a
 *  no-op. Result is clamped to the range. */
export function stepZoom(current: number, deltaY: number): number {
    if (deltaY === 0) return clampZoom(current);
    const next = deltaY < 0 ? current / CAMERA_ZOOM_STEP : current * CAMERA_ZOOM_STEP;
    return clampZoom(next);
}

/** Frame-rate-independent ease of the live zoom toward its target, matching the
 *  camera-position lerp pattern (factor = min(1, dt*LERP)). dt <= 0 -> no move. */
export function lerpZoom(current: number, target: number, dt: number): number {
    const t = Math.min(1, Math.max(0, dt * CAMERA_ZOOM_LERP));
    return current + (target - current) * t;
}

/** Parse a persisted localStorage value into a clamped zoom; null/garbage/NaN -> DEFAULT. */
export function parsePersistedZoom(raw: string | null): number {
    if (raw === null) return CAMERA_ZOOM_DEFAULT;
    return clampZoom(parseFloat(raw));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/cameraZoom.spec.ts`
Expected: PASS — all describe blocks green.

- [ ] **Step 5: Commit**

```bash
git add src/survivors/cameraZoom.ts tests/cameraZoom.spec.ts
git commit -m "feat: pure perspective-locked camera-zoom math + tests"
```

---

## Task 2: Wire zoom into `HeroController`

**Files:**
- Modify: `src/survivors/HeroController.ts`

This task is not unit-testable in this harness (`HeroController` imports `@babylonjs/core`, which the Vitest config excludes). It is verified by `npx tsc --noEmit` in this task and by the build + manual smoke in Task 3.

- [ ] **Step 1: Add the import + storage key + localStorage helpers**

In `src/survivors/HeroController.ts`, add the import next to the other relative imports near the top (after the `integrateMove` import on line 8):

```ts
import { stepZoom, lerpZoom, parsePersistedZoom } from './cameraZoom';
```

Then, immediately after the `CAMERA_AIM_AHEAD` constant block (the line `const CAMERA_AIM_AHEAD = 2;`), add the storage key and the best-effort localStorage helpers:

```ts
/** localStorage key for the persisted camera zoom multiplier. */
const CAMERA_ZOOM_STORAGE_KEY = 'ktg.cameraZoom';

/** localStorage is best-effort — wrapped so private-mode / disabled storage can't crash
 *  the camera. Returns null (→ default zoom) when storage is unavailable. */
function readPersistedZoom(): string | null {
    try { return localStorage.getItem(CAMERA_ZOOM_STORAGE_KEY); } catch { return null; }
}
function writePersistedZoom(zoom: number): void {
    try { localStorage.setItem(CAMERA_ZOOM_STORAGE_KEY, String(zoom)); } catch { /* ignore */ }
}
```

- [ ] **Step 2: Add the instance fields**

In the field-declaration block, immediately after the `cameraFocusProvider` field (the `private cameraFocusProvider: ... = null;` declaration around line 130), add:

```ts
    // Mouse-wheel zoom: a multiplier on the BASE slant distance. zoomTarget is set by
    // the wheel; zoomMultiplier eases toward it each frame and scales cameraHeight +
    // cameraOffsetZ together so the look-down angle stays constant. See cameraZoom.ts.
    private zoomMultiplier: number = 1;
    private zoomTarget: number = 1;
    private readonly canvas: HTMLCanvasElement | null;
    private readonly onWheel: (e: WheelEvent) => void;
```

- [ ] **Step 3: Load zoom, snap the zoomed position, and attach the wheel listener in the constructor**

In the constructor, the camera is set up like this (around lines 159-170):

```ts
        this.camera = new FreeCamera('heroCam', new Vector3(0, this.cameraHeight, this.cameraOffsetZ), scene);
        this.camera.fov = CAMERA_FOV;
        this.camera.setTarget(new Vector3(0, 0, CAMERA_AIM_AHEAD));
        // Snapshot the look-down rotation once. ...
        this.camera.rotation = this.camera.rotation.clone();
        scene.activeCamera = this.camera;

        // No user camera manipulation
        this.camera.inputs.clear();
```

Immediately AFTER the `this.camera.inputs.clear();` line, insert:

```ts

        // Mouse-wheel zoom. The rotation was just locked from the BASE (unzoomed)
        // geometry above, so it is identical regardless of the saved zoom — the
        // perspective never drifts. Load the persisted multiplier, snap the camera to
        // the zoomed slant position so there is no first-frame pop, then listen for wheel.
        this.zoomTarget = parsePersistedZoom(readPersistedZoom());
        this.zoomMultiplier = this.zoomTarget;
        this.camera.position.set(
            0,
            this.cameraHeight * this.zoomMultiplier,
            this.cameraOffsetZ * this.zoomMultiplier,
        );

        this.canvas = scene.getEngine().getRenderingCanvas();
        this.onWheel = (e: WheelEvent) => {
            e.preventDefault(); // stop page scroll / browser pinch-zoom over the canvas
            this.zoomTarget = stepZoom(this.zoomTarget, e.deltaY);
            writePersistedZoom(this.zoomTarget);
        };
        // passive:false is required so preventDefault() actually takes effect.
        this.canvas?.addEventListener('wheel', this.onWheel, { passive: false });
```

- [ ] **Step 4: Ease + apply the zoom in the per-frame follow block**

In the camera-follow section of `update()` (around lines 689-697), the current block is:

```ts
        const ft = Number.isFinite;
        if (ft(focus.x) && ft(focus.height) && ft(focus.z) && ft(deltaTime)) {
            this._scratchCamTarget.set(focus.x, focus.height, focus.z + this.cameraOffsetZ);
            Vector3.LerpToRef(
                this.camera.position,
                this._scratchCamTarget,
                Math.min(1, deltaTime * 6),
                this.camera.position,
            );
        }
```

Replace it with (only the two lines inside the `if` change — the guard is untouched):

```ts
        const ft = Number.isFinite;
        if (ft(focus.x) && ft(focus.height) && ft(focus.z) && ft(deltaTime)) {
            // Ease the live zoom toward the wheel-set target, then scale BOTH the
            // focus height and the z-offset by it so the look-down angle stays constant.
            // focus.height is the co-op auto-computed height in co-op (base height in
            // solo), so this multiplies — i.e. composes — with co-op's auto-framing.
            this.zoomMultiplier = lerpZoom(this.zoomMultiplier, this.zoomTarget, deltaTime);
            const zoom = this.zoomMultiplier;
            this._scratchCamTarget.set(focus.x, focus.height * zoom, focus.z + this.cameraOffsetZ * zoom);
            Vector3.LerpToRef(
                this.camera.position,
                this._scratchCamTarget,
                Math.min(1, deltaTime * 6),
                this.camera.position,
            );
        }
```

- [ ] **Step 5: Detach the wheel listener in `dispose()`**

The current `dispose()` (around lines 725-728) is:

```ts
    public dispose(): void {
        this.basicAttack?.dispose(); // shared flight observer + streak pool
        this.camera.dispose();
    }
```

Change it to remove the wheel listener before disposing the camera:

```ts
    public dispose(): void {
        this.basicAttack?.dispose(); // shared flight observer + streak pool
        this.canvas?.removeEventListener('wheel', this.onWheel);
        this.camera.dispose();
    }
```

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: clean (no new errors). If it reports a non-null issue on `getRenderingCanvas()`, confirm the field type is `HTMLCanvasElement | null` and the listener calls use `this.canvas?.` (optional chaining), as written.

- [ ] **Step 7: Commit**

```bash
git add src/survivors/HeroController.ts
git commit -m "feat: mouse-wheel camera zoom (perspective-locked, persisted, co-op-composing)"
```

---

## Task 3: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all suites pass, including the new `cameraZoom` suite. No regressions.

- [ ] **Step 2: Production build**

Run: `npm run build`
Expected: webpack build completes with no TypeScript errors → `dist/` updated.

- [ ] **Step 3: Manual smoke (`npm start`, open localhost:9000)**

Start a solo run, then confirm:
- Scroll wheel **up** → camera glides closer; **down** → glides farther. Motion is smooth (eased), not snapped.
- The map's tilt/angle does **not** change at any zoom — only the distance. (Perspective preserved.)
- Zoom clamps: keep scrolling in/out — it stops at a closest and a farthest point and never inverts or flips.
- Reload the page (F5) → the run resumes at the **last zoom level**, not the default.
- Page does not scroll / browser does not zoom when the wheel is used over the canvas.

- [ ] **Step 4: Manual co-op check (optional, if a co-op session is convenient)**

With two players (`?host` / `?join`), separate the heroes so co-op auto-zooms out, then scroll the wheel:
- Manual zoom scales **around** the auto-framed distance (composes), and the perspective angle stays constant.
- At the default zoom (no manual scroll), the co-op framing looks exactly as it did before this change.

---

## Self-Review Notes

- **Spec coverage:** core mechanic (scale height+offsetZ by one multiplier) → Task 2 Steps 3-4; wheel input + step → module `stepZoom` + Step 3 listener; smoothing → `lerpZoom` + Step 4; range 0.6–1.6 → `CAMERA_ZOOM_MIN/MAX`; persistence → `parsePersistedZoom` + `read/writePersistedZoom` + Step 3; rotation-on-load correctness → Step 3 ordering (load/snap AFTER the existing rotation lock); co-op compose → Step 4 (`focus.height * zoom`); NaN safety → `clampZoom` non-finite guard; tests → Task 1; out-of-scope (pinch/keyboard/buttons) → not implemented, as specified.
- **Names are consistent across tasks:** `zoomMultiplier`, `zoomTarget`, `onWheel`, `canvas`, `CAMERA_ZOOM_STORAGE_KEY`, `readPersistedZoom`, `writePersistedZoom`, `clampZoom`, `stepZoom`, `lerpZoom`, `parsePersistedZoom`, `CAMERA_ZOOM_MIN/MAX/DEFAULT/STEP/LERP`.
- **No placeholders:** every code step shows full code; every run step shows the command and expected result.
