# Infinite Globe Map Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the bounded 25-unit arena with an infinite flat plane rendered as a small globe — ground curves to a visible horizon, terrain/props/enemies roll over the curve as the hero runs, enemies spawn at random angles just past the horizon.

**Architecture:** Gameplay math stays flat and unbounded (clamp removed via `arenaRadius = Infinity` through existing paths). Curvature is render-only: a pure `curveDrop(dx,dz) = d²/2R` function applied CPU-side to enemy/drop/prop meshes (never to gameplay positions) and GPU-side in the grass vertex shader (toroidal tile wrap + drop). A pre-curved ground cap, the skydome, and the directional shadow light all follow the hero each frame. Spec: `docs/superpowers/specs/2026-06-12-infinite-globe-map-design.md`.

**Tech Stack:** BabylonJS + TypeScript, Vitest for pure logic, webpack build.

**Verification commands:** `npx tsc --noEmit` (trust this, not the IDE), `npm test`, `npm run build`.

**Spec deviations (agreed inline):** Projectiles are EXCLUDED from the CPU curvature pass — within attack range (≤ ~12 u) the drop is < 1 u and invisible at the tilted camera; touching every projectile site isn't worth it. Damage numbers spawn from gameplay positions (same sub-1-unit error) — also excluded.

**Known landmines (from CLAUDE.md / memory — do not violate):**
- Materials from `createLowPolyMaterial` are frozen; `scene.blockMaterialDirtyMechanism = true`. Never create runtime lights; never trigger material recompiles. CPU position writes are safe.
- Transient/prop materials must go through `getCachedMaterial(scene, boundedKey, factory)` — bounded keys only (variant names, never instance ids).
- The old ground disc called `freezeWorldMatrix()` — the new ground MOVES every frame, so it must NOT be frozen.
- The ground mesh must keep the name `arenaGround` (the `applyRuinsAmbience` receiveShadows loop and resource-watchdog buckets match on the prefix).
- `receiveShadows` must be set BEFORE the material is assigned (shader compiles once).

---

### Task 1: Globe constants + curvature module (pure, TDD)

**Files:**
- Create: `src/survivors/globe/constants.ts`
- Create: `src/survivors/globe/curvature.ts`
- Test: `tests/curvature.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/curvature.spec.ts
import { describe, it, expect, afterEach } from 'vitest';
import { curveDrop, curveDropAt, setCurveOrigin, clearCurveOrigin } from '../src/survivors/globe/curvature';
import { GLOBE_RADIUS } from '../src/survivors/globe/constants';

afterEach(() => clearCurveOrigin());

describe('curveDrop', () => {
    it('is zero at the origin', () => {
        expect(curveDrop(0, 0)).toBe(0);
    });

    it('matches d²/2R', () => {
        expect(curveDrop(3, 4)).toBeCloseTo(25 / (2 * GLOBE_RADIUS), 10);
        expect(curveDrop(40, 0, 80)).toBeCloseTo(10, 10);
    });

    it('is monotonic in distance', () => {
        expect(curveDrop(10, 0)).toBeLessThan(curveDrop(20, 0));
        expect(curveDrop(20, 0)).toBeLessThan(curveDrop(0, 30));
    });

    it('is radially symmetric', () => {
        expect(curveDrop(5, 12)).toBeCloseTo(curveDrop(13, 0), 10);
    });
});

describe('curveDropAt (module origin)', () => {
    it('returns 0 when no origin is set', () => {
        expect(curveDropAt(100, 100)).toBe(0);
    });

    it('measures from the set origin', () => {
        setCurveOrigin(10, 20);
        expect(curveDropAt(10, 20)).toBe(0);
        expect(curveDropAt(13, 24)).toBeCloseTo(curveDrop(3, 4), 10);
    });

    it('returns 0 again after clearCurveOrigin', () => {
        setCurveOrigin(10, 20);
        clearCurveOrigin();
        expect(curveDropAt(13, 24)).toBe(0);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/curvature.spec.ts`
Expected: FAIL — cannot resolve `../src/survivors/globe/curvature`.

- [ ] **Step 3: Write the implementation**

```ts
// src/survivors/globe/constants.ts
/** Tuning constants for the infinite globe-map illusion. Roles are fixed by the
 *  design spec (docs/superpowers/specs/2026-06-12-infinite-globe-map-design.md);
 *  values are expected to change during visual tuning. */
export const GLOBE_RADIUS = 80;            // curvature radius R of the illusion
export const VISIBLE_TERRAIN_RADIUS = 60;  // ground cap half-size (world units)
export const SPAWN_RING_RADIUS = 40;       // enemy spawn distance from hero (just past horizon)
export const PROP_RECYCLE_DIST = 70;       // props farther than this from the hero recycle ahead
export const GRASS_TILE_SIZE = 44;         // grass treadmill tile edge (≈ old disc area → same density)
```

```ts
// src/survivors/globe/curvature.ts
import { GLOBE_RADIUS } from './constants';

/** Pure globe-curvature drop: how far below the flat plane a point (dx, dz)
 *  away from the curve origin (the hero) RENDERS. d²/2R is the small-angle
 *  approximation of a sphere of radius R. Render-only — gameplay math always
 *  stays flat; never feed this back into a gameplay position. */
export function curveDrop(dx: number, dz: number, radius: number = GLOBE_RADIUS): number {
    return (dx * dx + dz * dz) / (2 * radius);
}

// Module-level curve origin (the hero's flat position). Set once per frame by
// SurvivorsGameplayState.update and cleared in exit(), so render-only consumers
// (Enemy mesh sync, drops, props) can read the drop without threading hero refs.
let originX = 0;
let originZ = 0;
let originSet = false;

export function setCurveOrigin(x: number, z: number): void {
    originX = x;
    originZ = z;
    originSet = true;
}

export function clearCurveOrigin(): void {
    originSet = false;
}

/** Drop at world (x, z) relative to the current origin; 0 when no origin set
 *  (menu, tests, or after exit()) so every consumer degrades to flat. */
export function curveDropAt(x: number, z: number): number {
    return originSet ? curveDrop(x - originX, z - originZ) : 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/curvature.spec.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/survivors/globe/constants.ts src/survivors/globe/curvature.ts tests/curvature.spec.ts
git commit -m "feat(globe): curvature module + tuning constants for infinite map"
```

---

### Task 2: integrateMove with Infinity radius (test-only — documents the contract)

**Files:**
- Test: `tests/integrateMove.spec.ts` (append; if the existing spec file has a different name, find it with `ls tests | grep -i integrate` and append there)

- [ ] **Step 1: Append the test (no production change expected)**

```ts
describe('infinite map (arenaRadius = Infinity)', () => {
    it('arenaClampScale never clamps', () => {
        expect(arenaClampScale(1e6, 1e6, Infinity)).toBe(1);
        expect(arenaClampScale(0, 0, Infinity)).toBe(1);
    });

    it('integrateMove walks unbounded', () => {
        let p = { x: 24.9, z: 0 };
        for (let i = 0; i < 100; i++) p = integrateMove(p.x, p.z, 1, 0, 7, 0.1, Infinity);
        expect(p.x).toBeCloseTo(24.9 + 100 * 0.7, 6); // straight through the old wall
    });
});
```

(Ensure `arenaClampScale` and `integrateMove` are in the file's existing imports; add if missing.)

- [ ] **Step 2: Run the full existing spec**

Run: `npx vitest run tests/integrateMove.spec.ts`
Expected: PASS — all old bounded-arena tests AND the new Infinity tests (no production change needed; `limit/dist` with `limit = Infinity` is never taken since `dist > Infinity` is false).

- [ ] **Step 3: Commit**

```bash
git add tests/integrateMove.spec.ts
git commit -m "test(globe): integrateMove contract for arenaRadius = Infinity"
```

---

### Task 3: GlobeGround (curved ground cap that follows the hero)

**Files:**
- Create: `src/survivors/globe/GlobeGround.ts`
- (SurvivorsArena.ts stays untouched for now — swapped out in Task 4, deleted in Task 9)

- [ ] **Step 1: Write GlobeGround**

```ts
// src/survivors/globe/GlobeGround.ts
import { Scene, Mesh, MeshBuilder, StandardMaterial, Texture, VertexBuffer } from '@babylonjs/core';
import { GrassProceduralTexture } from '@babylonjs/procedural-textures/grass/grassProceduralTexture';
import { VISIBLE_TERRAIN_RADIUS } from './constants';
import { curveDrop } from './curvature';

const SUBDIVISIONS = 48;
/** Texture repeats across the cap — keeps the same texel density as the old
 *  25-radius disc (which used uScale = radius * 0.5 = 12.5 over 50 units). */
const TEX_TILES = VISIBLE_TERRAIN_RADIUS * 0.5;

/**
 * Infinite-map ground: a square cap, pre-curved so the terrain bends down
 * toward the horizon (globe illusion), that follows the hero every frame.
 * The curve is radially symmetric, so the cap never rotates or re-bakes —
 * the texture UV-scrolls by hero position so the terrain appears to slide
 * underneath while the cap itself stays centred on screen.
 */
export class GlobeGround {
    private ground: Mesh;
    private grassTexture: GrassProceduralTexture;
    private grassMaterial: StandardMaterial;

    constructor(scene: Scene) {
        const size = VISIBLE_TERRAIN_RADIUS * 2;
        // Name must keep the 'arenaGround' prefix — applyRuinsAmbience's
        // receiveShadows loop and the resource-watchdog buckets match on it.
        const ground = MeshBuilder.CreateGround(
            'arenaGround', { width: size, height: size, subdivisions: SUBDIVISIONS }, scene);
        ground.position.y = -0.01;

        // Bake the globe curvature into the geometry once: each vertex sinks by
        // curveDrop of its distance from the cap centre (where the hero stands).
        const pos = ground.getVerticesData(VertexBuffer.PositionKind)!.slice();
        for (let i = 0; i < pos.length; i += 3) {
            pos[i + 1] -= curveDrop(pos[i], pos[i + 2]);
        }
        ground.updateVerticesData(VertexBuffer.PositionKind, pos);
        ground.createNormals(false); // re-light the curved surface

        this.grassTexture = new GrassProceduralTexture('grassTex', 256, scene);
        this.grassTexture.uScale = TEX_TILES;
        this.grassTexture.vScale = TEX_TILES;
        this.grassTexture.wrapU = Texture.WRAP_ADDRESSMODE;
        this.grassTexture.wrapV = Texture.WRAP_ADDRESSMODE;

        this.grassMaterial = new StandardMaterial('grassMat', scene);
        this.grassMaterial.diffuseTexture = this.grassTexture;
        this.grassMaterial.specularColor.set(0, 0, 0);
        this.grassMaterial.ambientColor.set(0.55, 0.55, 0.55);
        this.grassMaterial.maxSimultaneousLights = 8;

        // BEFORE material assignment — blockMaterialDirtyMechanism means the
        // shader only compiles shadow support if the flag is already set.
        ground.receiveShadows = true;

        ground.material = this.grassMaterial;
        ground.alwaysSelectAsActiveMesh = true;
        // NO freezeWorldMatrix — unlike the old static disc, this mesh moves
        // every frame to follow the hero.
        this.ground = ground;
    }

    /** Per-frame: recentre the cap on the hero and counter-scroll the texture
     *  so the terrain pattern stays world-anchored (the ground "slides"). */
    public update(heroX: number, heroZ: number): void {
        this.ground.position.x = heroX;
        this.ground.position.z = heroZ;
        const size = VISIBLE_TERRAIN_RADIUS * 2;
        // CreateGround UVs: u spans +x, v spans +z across the mesh. Offset by
        // the hero's world position in tile units so the texture is stationary
        // in world space. (If the texture visibly "swims" with the hero instead
        // of staying put, flip the sign of the offending axis.)
        this.grassTexture.uOffset = (heroX / size) * TEX_TILES;
        this.grassTexture.vOffset = (heroZ / size) * TEX_TILES;
    }

    public dispose(): void {
        this.ground.dispose();
        this.grassMaterial.dispose();
        this.grassTexture.dispose();
    }
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: clean (module not wired yet, but must compile).

- [ ] **Step 3: Commit**

```bash
git add src/survivors/globe/GlobeGround.ts
git commit -m "feat(globe): pre-curved hero-following ground cap with UV terrain scroll"
```

---

### Task 4: Wire the unbounded world into SurvivorsGameplayState

**Files:**
- Modify: `src/survivors/SurvivorsGameplayState.ts` (lines noted from pre-WIP HEAD; re-locate with grep if drifted)

- [ ] **Step 1: Swap SurvivorsArena → GlobeGround**

Imports: remove `import { SurvivorsArena } from './SurvivorsArena';`, add:

```ts
import { GlobeGround } from './globe/GlobeGround';
import { setCurveOrigin, clearCurveOrigin, curveDropAt } from './globe/curvature';
import { GLOBE_RADIUS, GRASS_TILE_SIZE } from './globe/constants';
```

Field (~line 242): `private map: SurvivorsArena | null = null;` → `private map: GlobeGround | null = null;`
Construction (~line 513): `this.map = new SurvivorsArena(this.scene, 25);` → `this.map = new GlobeGround(this.scene);`

- [ ] **Step 2: Replace every getArenaRadius() consumer**

Run: `grep -n "getArenaRadius" src/survivors/SurvivorsGameplayState.ts` and fix all four:
- ~line 670 (HeroController ctor arg): `this.map.getArenaRadius()` → `Infinity`
- ~line 824: `this.enemyManager.configureSurvivorsMode(this._heroProviders, this.map.getArenaRadius());` → `this.enemyManager.configureSurvivorsMode(this._heroProviders, Infinity);` (spawn ring becomes a constant in Task 7; `arenaRadius` now only feeds EnemyManager's interior clamp at `EnemyManager.ts:228`, which `Infinity` correctly disables)
- ~line 1255 (grass opts): `arenaRadius: this.map?.getArenaRadius() ?? 20,` → `tileSize: GRASS_TILE_SIZE, curveRadius: GLOBE_RADIUS,` (compiles only after Task 6 — do Steps 1–4 of this task and Task 6 before type-checking, or reorder; see Step 4)
- ~lines 1453 and 2924 (guest ghost + input replay): replace `this.map?.getArenaRadius() ?? 20` → `Infinity`

- [ ] **Step 3: Per-frame globe upkeep in update()**

In `update()`, right after the early-exit guards where `this.hero` is known live (just BEFORE the existing grass torch-sync block at ~line 2773 `if (this.grass && this.hero)`), insert:

```ts
        // ── Infinite-map globe upkeep ──────────────────────────────────────
        // Order matters: set the curve origin FIRST so every render-side
        // curveDropAt() call this frame (enemies, drops, props) uses the
        // hero's current position.
        if (this.hero) {
            const hp = this.hero.getPosition();
            setCurveOrigin(hp.x, hp.z);
            this.map?.update(hp.x, hp.z);
            // Skydome is a 1000-unit box; follow the hero so a long run never
            // walks out of it. (Position-only — material untouched.)
            if (this.skyDome) {
                this.skyDome.position.x = hp.x;
                this.skyDome.position.z = hp.z;
            }
            // Directional shadow frustum is a fixed ±30-unit ortho box around
            // the light — keep it centred on the hero. Snap to 0.5 u so the
            // shadow texels don't shimmer as the hero moves.
            if (this.shadowSourceLight) {
                this.shadowSourceLight.position.x = Math.round((hp.x + 8) * 2) / 2;
                this.shadowSourceLight.position.z = Math.round((hp.z + 8) * 2) / 2;
            }
            this.grass?.setHeroPos(hp); // grass treadmill recentre (Task 6 API)
        }
```

Add the field near skyTexture/skyMaterial declarations: `private skyDome: Mesh | null = null;` and in `applyRuinsAmbience()` after `skydome.material = skyMat;` add `this.skyDome = skydome;`. In `exit()` where skyTexture/skyMaterial are disposed, add `this.skyDome = null;` (the mesh itself is already disposed with the scene teardown there — match how skyTexture/skyMaterial are handled; if they are explicitly disposed, dispose the mesh too).

- [ ] **Step 4: exit() cleanup**

In `exit()` near `this.map?.dispose()` (~line 2548), add `clearCurveOrigin();`.

- [ ] **Step 5: Co-op ghost curvature**

At the guest-ghost mesh write (~lines 2742–2747 `g.mesh.position.x = pose.x; ...`), add after the existing x/z writes:

```ts
                        // Render-only globe drop — gameplay pose stays flat.
                        g.mesh.position.y = pose.y - curveDropAt(pose.x, pose.z);
```

- [ ] **Step 6: Type-check (expects ONLY Task 6/7 stragglers)**

Run: `npx tsc --noEmit`
Expected errors at this point: `tileSize`/`curveRadius` not in `ProceduralGrassOptions`, `setHeroPos` missing (fixed in Task 6). NO other errors. If `configureSurvivorsMode` or anything else errors, fix before moving on.

- [ ] **Step 7: Commit (with Task 6 if needed to keep the tree compiling — otherwise commit now)**

```bash
git add src/survivors/SurvivorsGameplayState.ts
git commit -m "feat(globe): unbounded world — Infinity clamp, ground/sky/shadow follow hero"
```

(If tsc is red solely due to the grass API, fold this commit into Task 6's commit instead — never commit a non-compiling tree.)

---

### Task 5: Camera tilt (horizon framing)

**Files:**
- Modify: `src/survivors/HeroController.ts` (~lines 131–151)

- [ ] **Step 1: Retune the camera constants + aim-ahead target**

Replace the camera parameter block and construction:

```ts
        // Globe-map camera: lower + tilted back so the curved horizon and sky
        // are framed with the hero lower-centre (enemies crest the curve ahead).
        // Heights are starting values from the design spec — tune in-browser.
        const viewportWidth = scene.getEngine().getRenderWidth();
        if (viewportWidth < 700) {
            this.cameraHeight = 8;     // mobile: slightly closer
            this.cameraOffsetZ = -9;
        } else {
            this.cameraHeight = 9;
            this.cameraOffsetZ = -11;
        }

        // Top-down follow camera — replace the old isometric camera from Game.setupScene
        this.camera = new FreeCamera('heroCam', new Vector3(0, this.cameraHeight, this.cameraOffsetZ), scene);
        // Aim a few units AHEAD of the hero so the hero sits lower on screen
        // and the top of the frame shows the horizon + sky.
        this.camera.setTarget(new Vector3(0, 0, CAMERA_AIM_AHEAD));
```

Add near the file's other module constants (grep `KNOCKBACK_DURATION_S` for placement):

```ts
/** How far ahead of the hero the camera aims — pushes the hero toward the
 *  lower-centre of the frame so the curved horizon is visible up top. */
const CAMERA_AIM_AHEAD = 4;
```

Everything else (rotation snapshot, per-frame position lerp, shake, co-op focus provider) is untouched — the lock-rotation comment block stays.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit` — expected: same residual grass-API errors only (or clean if Task 6 landed first).

- [ ] **Step 3: Commit**

```bash
git add src/survivors/HeroController.ts
git commit -m "feat(globe): tilt follow camera back to frame the curved horizon"
```

---

### Task 6: Grass treadmill (shader wrap + curvature)

**Files:**
- Modify: `src/engine/rendering/ProceduralGrass.ts`

- [ ] **Step 1: Options + API changes**

In `ProceduralGrassOptions`: replace `arenaRadius: number;` with:

```ts
    /** Edge length of the toroidal grass tile centred on the hero. Blades are
     *  placed once in this square; the vertex shader wraps them around the
     *  hero as it moves (treadmill — zero per-frame buffer updates). */
    tileSize: number;
    /** Globe curvature radius (same R the rest of the world uses). */
    curveRadius: number;
```

In `ProceduralGrass` (returned interface) add:

```ts
    /** Per-frame: the hero's world position — centre of the wrap tile and
     *  origin of the curvature drop. */
    setHeroPos: (position: Vector3) => void;
```

- [ ] **Step 2: Blade placement → uniform square**

Replace the radial placement (lines ~357–365) inside the matrix loop:

```ts
        const r = Math.sqrt(Math.random()) * opts.arenaRadius * 0.96;
        const theta = Math.random() * Math.PI * 2;
        ...
        tmpPos.set(Math.cos(theta) * r, rootY, Math.sin(theta) * r);
```

with:

```ts
        tmpPos.set(
            (Math.random() - 0.5) * opts.tileSize,
            rootY,
            (Math.random() - 0.5) * opts.tileSize,
        );
```

(keep the yRot/scale lines between them unchanged).

- [ ] **Step 3: Vertex shader — wrap + curve**

In `VERT`, add with the other uniforms:

```glsl
uniform vec3 uHeroPos;
uniform float uTileSize;
uniform float uCurveRadius;
```

Immediately after `vec3 worldPos = wp4.xyz;` (line ~124, BEFORE the influencer push so push/sway/shadow all use the wrapped position), insert:

```glsl
    // Infinite-map treadmill: wrap the whole blade (instance origin world3, not
    // the vertex — the blade must wrap as a unit) into a uTileSize² tile centred
    // on the hero, then sink it by the globe curvature. The wrap offset is a
    // multiple of uTileSize, so a blade's wrapped position is stable until it
    // crosses the tile edge (always far behind the camera).
    vec2 rel = world3.xz - uHeroPos.xz;
    vec2 wrapOffset = (mod(rel + 0.5 * uTileSize, uTileSize) - 0.5 * uTileSize) - rel;
    worldPos.xz += wrapOffset;
    vec2 rootToHero = (world3.xz + wrapOffset) - uHeroPos.xz;
    worldPos.y -= dot(rootToHero, rootToHero) / (2.0 * uCurveRadius);
```

(`bladeSeed` above keeps using raw `world3` — per-blade lean/curve stays stable across wraps; `vColorSeed` uses the wrapped `worldPos`, which is also stable between wraps.)

- [ ] **Step 4: JS-side uniforms + setter**

In `uniformsList` add `'uHeroPos', 'uTileSize', 'uCurveRadius'`.
After the existing `mat.setFloat('uWindStrength', ...)` block add:

```ts
    mat.setVector3('uHeroPos', Vector3.Zero());
    mat.setFloat('uTileSize', opts.tileSize);
    mat.setFloat('uCurveRadius', opts.curveRadius);
```

In the returned object add:

```ts
        setHeroPos: (position: Vector3) => {
            mat.setVector3('uHeroPos', position);
        },
```

- [ ] **Step 5: Check for other callers**

Run: `grep -rn "createProceduralGrass" src/ --include="*.ts"`
Expected: only `SurvivorsGameplayState.ts` (already migrated in Task 4). If another caller appears, migrate it the same way.

- [ ] **Step 6: Type-check + full test run**

Run: `npx tsc --noEmit && npm test`
Expected: clean / all pass (the grass module has no specs; this catches API drift).

- [ ] **Step 7: Commit**

```bash
git add src/engine/rendering/ProceduralGrass.ts src/survivors/SurvivorsGameplayState.ts
git commit -m "feat(globe): grass treadmill — toroidal shader wrap + curvature drop"
```

---

### Task 7: Enemy render curvature + spawn ring constant

**Files:**
- Modify: `src/survivors/enemies/Enemy.ts`
- Modify: `src/survivors/enemies/EnemyManager.ts` (~line 552)

- [ ] **Step 1: Static hook + per-frame drop on Enemy**

In `Enemy.ts` near the other static hooks (`onDamageCallback` etc., ~line 86):

```ts
    /** Render-only globe-curvature hook (infinite map). When set, mesh and
     *  health-bar Y positions sink by drop(x, z) — gameplay `this.position`
     *  stays flat (all distances/AI/network use flat space). Static so host
     *  enemies AND guest render copies share it; wired in startRun and cleared
     *  in SurvivorsGameplayState.exit() like the guest*Redirect statics. */
    public static curveDropFn: ((x: number, z: number) => number) | null = null;
    /** This frame's drop for this enemy — computed once per update/network tick. */
    protected _curveDropY = 0;
```

- [ ] **Step 2: Apply at every live mesh-sync site**

Run: `grep -n "mesh.position.copyFrom(this.position)" src/survivors/enemies/Enemy.ts`
At the survivors-branch sync (~line 703), compute THEN apply:

```ts
            this._curveDropY = Enemy.curveDropFn ? Enemy.curveDropFn(this.position.x, this.position.z) : 0;
            if (this.mesh && !this.mesh.isDisposed()) {
                this.mesh.position.copyFrom(this.position);
                this.mesh.position.y -= this._curveDropY;
```

At every OTHER `copyFrom(this.position)` site found by the grep (legacy path branch ~815, plus the ~1963 / ~2134 sites — inspect each; they are knockback/death-anim style syncs), append directly after the copyFrom:

```ts
            this.mesh.position.y -= this._curveDropY;
```

Also inspect ~line 1909 (`this.mesh.position.y = 1.5;`) — read 5 lines of context; if it is a recurring per-frame Y write (e.g. flying hover), subtract `this._curveDropY` there too; if it is a one-shot init, leave it.

In `applyNetworkPosition` (~lines 2146–2170, the guest mesh-pose path): after it writes mesh position from the network pose, add the same compute-and-subtract pair (compute `_curveDropY` from the NETWORK x/z it just applied, then subtract from mesh Y).

- [ ] **Step 3: Health bars follow the drop**

In `updateHealthBar()` (~line 516): `const y = this.position.y + this.barHeightOffset;` → `const y = this.position.y + this.barHeightOffset - this._curveDropY;`
(The creation-time bar placement at ~line 407 can stay flat — bars re-position every frame via updateHealthBar.)

- [ ] **Step 4: Wire + clear the hook in SurvivorsGameplayState**

In `startRun()` — put it next to where other `Enemy.` statics / callbacks are wired (grep `Enemy.onDamageCallback` for the spot):

```ts
        Enemy.curveDropFn = curveDropAt; // render-only globe drop (infinite map)
```

In `exit()` — next to where the `guest*Redirect` statics are cleared (grep `Redirect = null`):

```ts
        Enemy.curveDropFn = null;
```

- [ ] **Step 5: Spawn ring constant**

In `EnemyManager.ts` add import: `import { SPAWN_RING_RADIUS } from '../globe/constants';`
At ~line 552 replace:

```ts
        const r = this.arenaRadius + 2;
```

with:

```ts
        // Infinite map: spawn just past the visual horizon so enemies crest the
        // curve from a random direction (theta above is already angle-uniform).
        const r = SPAWN_RING_RADIUS;
```

(`this.arenaRadius` stays as a field — it now carries `Infinity`, which correctly disables the interior clamp at ~line 228.)

- [ ] **Step 6: Type-check + tests**

Run: `npx tsc --noEmit && npm test`
Expected: clean / all pass (enemy damage-routing co-op specs must stay green — `_curveDropY` never touches `this.position`).

- [ ] **Step 7: Commit**

```bash
git add src/survivors/enemies/Enemy.ts src/survivors/enemies/EnemyManager.ts src/survivors/SurvivorsGameplayState.ts
git commit -m "feat(globe): render-only enemy curvature + horizon spawn ring"
```

---

### Task 8: Drops sink with the curve

**Files:**
- Modify: `src/survivors/powers/PowerDrop.ts` (~line 75)
- Modify: `src/survivors/ItemDrop.ts` (~lines 96–103)

- [ ] **Step 1: PowerDrop**

Add import: `import { curveDropAt } from '../globe/curvature';`
Replace the bob line (~75):

```ts
        this.mesh.position.y = 0.6 + Math.sin(performance.now() / 200) * 0.1;
```

with:

```ts
        this.mesh.position.y = 0.6 + Math.sin(performance.now() / 200) * 0.1
            - curveDropAt(this.mesh.position.x, this.mesh.position.z);
```

- [ ] **Step 2: ItemDrop**

Add import: `import { curveDropAt } from './globe/curvature';`
Replace the bob line (~102) the same way, and pin the pillar (after the existing pillar x/z sync at ~96–97):

```ts
            const itemCurveDrop = curveDropAt(this.mesh.position.x, this.mesh.position.z);
            this.mesh.position.y = 0.8 + Math.sin(t * 2.0) * 0.15 - itemCurveDrop;
            this.pillar.position.y = 4 - itemCurveDrop;
```

(Adapt to the exact local code shape — the bob and pillar writes may be a few lines apart; the invariant is: every per-frame Y write on drop meshes subtracts `curveDropAt` of that mesh's x/z.)

- [ ] **Step 3: Type-check + commit**

Run: `npx tsc --noEmit`

```bash
git add src/survivors/powers/PowerDrop.ts src/survivors/ItemDrop.ts
git commit -m "feat(globe): power orbs + item drops sink with the curvature"
```

---

### Task 9: Prop treadmill (recycled horizon props) + delete SurvivorsArena

**Files:**
- Create: `src/survivors/globe/PropField.ts`
- Test: `tests/propRecycle.spec.ts`
- Delete: `src/survivors/SurvivorsArena.ts`
- Modify: `src/survivors/SurvivorsGameplayState.ts` (wire-in)

- [ ] **Step 1: Failing test for the pure recycle math**

```ts
// tests/propRecycle.spec.ts
import { describe, it, expect } from 'vitest';
import { computeRecycledPosition, PROP_MIN_R, PROP_MAX_R } from '../src/survivors/globe/PropField';

describe('computeRecycledPosition', () => {
    it('places the prop between PROP_MIN_R and PROP_MAX_R from the hero', () => {
        for (let i = 0; i < 50; i++) {
            const p = computeRecycledPosition(100, -40, 1, 0, Math.random(), Math.random());
            const d = Math.hypot(p.x - 100, p.z - (-40));
            expect(d).toBeGreaterThanOrEqual(PROP_MIN_R - 1e-9);
            expect(d).toBeLessThanOrEqual(PROP_MAX_R + 1e-9);
        }
    });

    it('biases into the travel half-plane when moving', () => {
        // Hero moving +x: every recycled prop must land with x > heroX
        // (spread is ±110°, cos(110°) ≈ -0.34 — so allow the slight overhang:
        // dot(dir, toProp) must exceed cos(110°) * r).
        for (let i = 0; i < 50; i++) {
            const p = computeRecycledPosition(0, 0, 1, 0, Math.random(), Math.random());
            const d = Math.hypot(p.x, p.z);
            expect(p.x / d).toBeGreaterThanOrEqual(Math.cos((110 * Math.PI) / 180) - 1e-9);
        }
    });

    it('uses the full circle when stationary', () => {
        // angles must cover all quadrants across many samples
        const quadrants = new Set<number>();
        for (let i = 0; i < 200; i++) {
            const p = computeRecycledPosition(0, 0, 0, 0, i / 200, 0.5);
            quadrants.add((p.x >= 0 ? 1 : 0) + (p.z >= 0 ? 2 : 0));
        }
        expect(quadrants.size).toBe(4);
    });
});
```

Run: `npx vitest run tests/propRecycle.spec.ts` — expected: FAIL (module missing).

- [ ] **Step 2: PropField implementation**

```ts
// src/survivors/globe/PropField.ts
import { Scene, Mesh, MeshBuilder, Vector3 } from '@babylonjs/core';
import { getCachedMaterial } from '../../engine/rendering/MaterialCache';
import { PROP_RECYCLE_DIST } from './constants';
import { curveDropAt } from './curvature';

export const PROP_MIN_R = 45; // just past the spawn ring / horizon
export const PROP_MAX_R = 65;
const PROP_COUNT = 20;

/** Pure recycle placement: random ring position PROP_MIN_R..PROP_MAX_R from the
 *  hero. If the hero is moving, bias the angle to ±110° around the travel
 *  direction so props roll in over the horizon ahead; stationary → any angle.
 *  randAngle/randR ∈ [0,1) are injected for testability. */
export function computeRecycledPosition(
    heroX: number, heroZ: number,
    dirX: number, dirZ: number,
    randAngle: number, randR: number,
): { x: number; z: number } {
    const moving = Math.hypot(dirX, dirZ) > 0.01;
    const theta = moving
        ? Math.atan2(dirZ, dirX) + (randAngle - 0.5) * ((220 * Math.PI) / 180)
        : randAngle * Math.PI * 2;
    const r = PROP_MIN_R + randR * (PROP_MAX_R - PROP_MIN_R);
    return { x: heroX + Math.cos(theta) * r, z: heroZ + Math.sin(theta) * r };
}

/**
 * Pool of low-poly decorative props (rocks, broken pillars, dead trees) that
 * drift past as the hero runs and silently recycle to a fresh spot beyond the
 * horizon once left behind. Non-colliding decoration — no pathing impact.
 * Materials come from the bounded-key material cache (3 keys, never per-instance).
 */
export class PropField {
    private props: { mesh: Mesh; baseY: number }[] = [];

    constructor(scene: Scene) {
        const makers: ((i: number) => { mesh: Mesh; baseY: number })[] = [
            (i) => { // rock — squashed octahedron
                const m = MeshBuilder.CreatePolyhedron(`globeProp_rock_${i}`, { type: 1, size: 0.9 }, scene);
                m.scaling.set(1.2, 0.7, 1.0);
                m.material = getCachedMaterial(scene, 'globePropRock', mat => {
                    mat.diffuseColor.set(0.45, 0.43, 0.40);
                    mat.specularColor.set(0, 0, 0);
                });
                return { mesh: m, baseY: 0.35 };
            },
            (i) => { // broken pillar — stubby cylinder
                const h = 1.4 + (i % 3) * 0.7;
                const m = MeshBuilder.CreateCylinder(`globeProp_pillar_${i}`, { height: h, diameter: 0.9, tessellation: 8 }, scene);
                m.rotation.z = 0.06; // slight ruinous lean
                m.material = getCachedMaterial(scene, 'globePropPillar', mat => {
                    mat.diffuseColor.set(0.55, 0.52, 0.46);
                    mat.specularColor.set(0, 0, 0);
                });
                return { mesh: m, baseY: h / 2 };
            },
            (i) => { // dead tree — bare tapered trunk
                const m = MeshBuilder.CreateCylinder(`globeProp_tree_${i}`, { height: 3.2, diameterBottom: 0.5, diameterTop: 0.06, tessellation: 6 }, scene);
                m.rotation.z = 0.1;
                m.material = getCachedMaterial(scene, 'globePropTree', mat => {
                    mat.diffuseColor.set(0.30, 0.22, 0.15);
                    mat.specularColor.set(0, 0, 0);
                });
                return { mesh: m, baseY: 1.6 };
            },
        ];

        for (let i = 0; i < PROP_COUNT; i++) {
            const prop = makers[i % makers.length](i);
            prop.mesh.isPickable = false;
            // Initial scatter: anywhere in the visible field (full circle, any radius
            // from 10 up to PROP_MAX_R) so the run doesn't start with an empty plain.
            const theta = Math.random() * Math.PI * 2;
            const r = 10 + Math.random() * (PROP_MAX_R - 10);
            prop.mesh.position.set(Math.cos(theta) * r, prop.baseY, Math.sin(theta) * r);
            prop.mesh.rotation.y = Math.random() * Math.PI * 2;
            this.props.push(prop);
        }
    }

    /** Per-frame: recycle left-behind props ahead of the hero + apply curvature. */
    public update(heroX: number, heroZ: number, dirX: number, dirZ: number): void {
        for (const p of this.props) {
            const dx = p.mesh.position.x - heroX;
            const dz = p.mesh.position.z - heroZ;
            if (dx * dx + dz * dz > PROP_RECYCLE_DIST * PROP_RECYCLE_DIST) {
                const np = computeRecycledPosition(heroX, heroZ, dirX, dirZ, Math.random(), Math.random());
                p.mesh.position.x = np.x;
                p.mesh.position.z = np.z;
                p.mesh.rotation.y = Math.random() * Math.PI * 2;
            }
            p.mesh.position.y = p.baseY - curveDropAt(p.mesh.position.x, p.mesh.position.z);
        }
    }

    public dispose(): void {
        // Materials are cache-owned (clearMaterialCache in exit() frees them) —
        // default dispose (no material free) is correct here.
        for (const p of this.props) p.mesh.dispose();
        this.props = [];
    }
}
```

Run: `npx vitest run tests/propRecycle.spec.ts` — expected: PASS.
(Check `getCachedMaterial`'s exact signature in `src/engine/rendering/MaterialCache.ts` first and adapt the calls if the factory shape differs.)

- [ ] **Step 3: Wire into SurvivorsGameplayState**

- Field: `private propField: PropField | null = null;` + import.
- In `startRun()` after `this.map` exists / near hero construction: `this.propField = new PropField(this.scene);`
- In the Task-4 globe-upkeep block, after `this.grass?.setHeroPos(hp);` add (hero travel direction from the controller's last input; simplest robust source is the hero's velocity — grep `setPlayerVelocity` / use `this.heroController` if it exposes input, else derive from position delta):

```ts
            // Travel direction from frame-to-frame hero displacement (cheap, no
            // new API): zero when stationary → recycle uses the full circle.
            const pdx = hp.x - this._lastHeroX, pdz = hp.z - this._lastHeroZ;
            this._lastHeroX = hp.x; this._lastHeroZ = hp.z;
            this.propField?.update(hp.x, hp.z, pdx, pdz);
```

with fields `private _lastHeroX = 0; private _lastHeroZ = 0;`.
- In `exit()` next to `this.map?.dispose()`: `this.propField?.dispose(); this.propField = null;`

- [ ] **Step 4: Delete SurvivorsArena**

```bash
rm src/survivors/SurvivorsArena.ts
grep -rn "SurvivorsArena" src/ tests/   # expected: no hits
```

- [ ] **Step 5: Full verification + commit**

Run: `npx tsc --noEmit && npm test && npm run build`
Expected: all clean.

```bash
git add -A
git commit -m "feat(globe): recycled horizon props; delete bounded SurvivorsArena"
```

---

### Task 10: Full verification + in-browser check

- [ ] **Step 1: Full gates**

Run: `npx tsc --noEmit && npm test && npm run build`
Expected: zero TS errors, all ~314+ new tests pass, webpack build succeeds.

- [ ] **Step 2: In-browser smoke (dev server)**

Run `npm start`, open `http://localhost:9000/?test` (auto-starts a barbarian run) and verify:
1. Curved horizon with sky visible at the top of the frame; hero lower-centre.
2. Running in one direction indefinitely: no wall, ground/texture slides underneath, grass field never visibly pops at the wrap seam, props drift by and new ones crest the horizon ahead.
3. Enemies appear over the curve from random directions and converge on the hero; health bars sit on the (sunk) meshes, not floating.
4. Hero shadow persists far from origin (shadow frustum follows).
5. Console: NO `[resource-watchdog] LEAK SUSPECTED` across several waves; no `[loop:render]` errors.
6. Co-op spot check `?host` + `?join` in two tabs: guest sees the same curvature, no rubber-banding with the clamp gone.

- [ ] **Step 3: Visual tuning pass**

Adjust `GLOBE_RADIUS`, camera height/offset/`CAMERA_AIM_AHEAD`, `GRASS_TILE_SIZE`, texture-scroll signs in `GlobeGround.update` (if the terrain pattern "swims" with the hero instead of sliding under) until it reads right. Commit tuning separately:

```bash
git add -A && git commit -m "tune(globe): curvature radius + camera framing"
```
