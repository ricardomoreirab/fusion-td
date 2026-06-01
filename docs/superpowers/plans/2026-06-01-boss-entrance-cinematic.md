# Boss Entrance Cinematic Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Play a ~2.2s camera-pan cinematic on a dramatic "entrance" model when the wave-5/10/15 milestone bosses (lava Thamuz, wraith Thamuz, Helcurt) appear, then spawn the real boss where the camera looked.

**Architecture:** A self-contained `BossEntranceCinematic` controller owns a temporary entrance GLB model + its own animation clock and drives the scene's `FreeCamera` through glide-in → hold → glide-back, then hard-restores the camera and disposes the model. `SurvivorsGameplayState.update()` early-returns (freezing the battlefield) while the cinematic is active, so the hero follow-cam never runs and can't conflict. The boss spawn is deferred behind the cinematic via an `spawnPosOverride` on `EnemyManager.spawnSurvivorsEnemy`. The pure wave→tier mapping lives in a Babylon-free module so it is unit-testable.

**Tech Stack:** TypeScript, BabylonJS (`@babylonjs/core`), Vitest (pure-logic tests).

---

## File Structure

- **Create** `src/survivors/bossEntranceTier.ts` — pure `entranceTierForWave(wave)` mapping (no Babylon import). Unit-testable.
- **Create** `src/survivors/BossEntranceCinematic.ts` — the cinematic controller (Babylon-bound).
- **Create** `tests/BossEntrance.spec.ts` — unit tests for the pure tier mapping.
- **Modify** `src/survivors/enemies/EnemyManager.ts` — add `spawnPosOverride?` to `spawnSurvivorsEnemy`.
- **Modify** `src/survivors/SurvivorsGameplayState.ts` — entrance GLB registry + preload, construct/wire the cinematic, intercept boss spawn, freeze during cinematic, dispose on exit.

---

### Task 1: Pure wave→tier mapping (TDD)

**Files:**
- Create: `src/survivors/bossEntranceTier.ts`
- Test: `tests/BossEntrance.spec.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/BossEntrance.spec.ts
import { describe, it, expect } from 'vitest';
import { entranceTierForWave } from '../src/survivors/bossEntranceTier';

describe('entranceTierForWave', () => {
  it('maps the first three milestone waves to tiers 1-3', () => {
    expect(entranceTierForWave(5)).toBe(1);
    expect(entranceTierForWave(10)).toBe(2);
    expect(entranceTierForWave(15)).toBe(3);
  });

  it('returns null for non-milestone waves', () => {
    expect(entranceTierForWave(1)).toBeNull();
    expect(entranceTierForWave(7)).toBeNull();
    expect(entranceTierForWave(0)).toBeNull();
    expect(entranceTierForWave(-5)).toBeNull();
  });

  it('returns null for milestone waves beyond the third boss (no entrance asset)', () => {
    expect(entranceTierForWave(20)).toBeNull();
    expect(entranceTierForWave(25)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/BossEntrance.spec.ts`
Expected: FAIL — cannot resolve `../src/survivors/bossEntranceTier`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/survivors/bossEntranceTier.ts
/**
 * Pure (Babylon-free, so unit-testable) mapping from an absolute wave number to
 * the boss-entrance tier whose cinematic should play, or null when no entrance
 * applies. Only the first three milestone bosses (waves 5/10/15) have entrance
 * assets; every other wave — including milestone waves 20+ — returns null and
 * spawns normally.
 */
export function entranceTierForWave(wave: number): 1 | 2 | 3 | null {
  if (wave <= 0 || wave % 5 !== 0) return null;
  const tier = wave / 5;
  return tier === 1 || tier === 2 || tier === 3 ? tier : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/BossEntrance.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/survivors/bossEntranceTier.ts tests/BossEntrance.spec.ts
git commit -m "feat(boss-entrance): pure wave->tier mapping + tests"
```

---

### Task 2: BossEntranceCinematic controller

**Files:**
- Create: `src/survivors/BossEntranceCinematic.ts`

No unit test (Babylon-scene-bound; verified by `tsc` + manual). The pure `smoothstep`
math is internal; the testable surface (`entranceTierForWave`) was covered in Task 1.

- [ ] **Step 1: Write the full module**

```typescript
// src/survivors/BossEntranceCinematic.ts
import {
  Scene, Vector3, FreeCamera, AssetContainer, AnimationGroup, Mesh, TransformNode, Quaternion, Skeleton,
} from '@babylonjs/core';
import { Game } from '../engine/Game';

// Phase durations (seconds) — total ~2.2s. See spec 2026-06-01-boss-entrance-cinematic.
const GLIDE_IN_S = 0.6;
const HOLD_S = 1.0;
const GLIDE_OUT_S = 0.6;
const TOTAL_S = GLIDE_IN_S + HOLD_S + GLIDE_OUT_S;

const BOSS_SCALE = 2.2;                            // match MilestoneBoss model scale
const FRAME_OFFSET = new Vector3(0, 11, -9);       // camera pose relative to the boss
const LOOK_HEIGHT = 2;                             // look at the boss/hero chest, not feet

/** Smoothstep ease (0..1), clamped. */
function smoothstep(t: number): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

/**
 * Plays a short cinematic when a milestone boss appears: a dramatic "entrance"
 * GLB strikes its action pose at the boss spawn point while the camera glides in,
 * holds, and glides back. Self-contained: owns the temp model + its own clock and
 * drives the scene camera. The gameplay loop freezes the battlefield (early-returns
 * from update) while this is active, so the hero follow-cam never fights us.
 *
 * Camera handoff: snapshot the live follow-cam position+rotation at play() start,
 * drive position+look-target each frame via setTarget(), then HARD-restore the exact
 * snapshot on completion so the top-down follow resumes with zero drift.
 */
export class BossEntranceCinematic {
  private scene: Scene;
  private getCamera: () => FreeCamera | null;
  private assets: Partial<Record<number, AssetContainer>> = {};

  private active = false;
  private elapsed = 0;
  private resolveFn: (() => void) | null = null;

  // Live model state (disposed each finish()).
  private holder: Mesh | null = null;
  private animGroups: AnimationGroup[] = [];
  private skeletons: Skeleton[] = [];
  private rootNodes: TransformNode[] = [];

  // Camera key poses.
  private savedPos = new Vector3();
  private savedRot = new Vector3();
  private startLook = new Vector3();
  private bossLook = new Vector3();
  private framePos = new Vector3();

  // Per-frame scratch (no allocation in update()).
  private _pos = new Vector3();
  private _look = new Vector3();

  constructor(game: Game, getCamera: () => FreeCamera | null) {
    this.scene = game.getScene();
    this.getCamera = getCamera;
  }

  /** tier (1..3) -> preloaded entrance container. */
  setEntranceAssets(map: Partial<Record<number, AssetContainer>>): void {
    this.assets = map;
  }

  hasEntrance(tier: number): boolean {
    return !!this.assets[tier];
  }

  isActive(): boolean {
    return this.active;
  }

  /**
   * Begin the cinematic. Sets up the model + camera snapshot synchronously (so
   * isActive() is true immediately), then resolves when update() reaches the end.
   * Resolves immediately (no-op) if the asset or camera is missing.
   */
  play(tier: number, spawnPos: Vector3, heroPos: Vector3): Promise<void> {
    const asset = this.assets[tier];
    const camera = this.getCamera();
    if (!asset || !camera) return Promise.resolve();

    this.active = true;
    this.elapsed = 0;

    this.savedPos.copyFrom(camera.position);
    this.savedRot.copyFrom(camera.rotation);
    this.startLook.set(heroPos.x, heroPos.y + LOOK_HEIGHT, heroPos.z);
    this.bossLook.set(spawnPos.x, spawnPos.y + LOOK_HEIGHT, spawnPos.z);
    this.framePos.set(
      spawnPos.x + FRAME_OFFSET.x,
      spawnPos.y + FRAME_OFFSET.y,
      spawnPos.z + FRAME_OFFSET.z,
    );

    this.instantiate(asset, spawnPos, heroPos);
    return new Promise<void>(resolve => { this.resolveFn = resolve; });
  }

  private instantiate(asset: AssetContainer, spawnPos: Vector3, heroPos: Vector3): void {
    const holder = new Mesh('bossEntranceRoot', this.scene);
    holder.position.copyFrom(spawnPos);
    // Yaw the model to face the hero.
    holder.rotation.y = Math.atan2(heroPos.x - spawnPos.x, heroPos.z - spawnPos.z);
    this.holder = holder;

    // cloneMaterials=true so dispose(false, true) below frees per-instance materials
    // AND their cloned textures (the GLB texture-leak rule in CLAUDE.md).
    const inst = asset.instantiateModelsToScene(name => `entrance_${name}`, true, { doNotInstantiate: true });
    this.animGroups = inst.animationGroups;
    this.skeletons = inst.skeletons;
    this.rootNodes = inst.rootNodes as TransformNode[];

    const flip = Quaternion.RotationYawPitchRoll(Math.PI, 0, 0);
    for (const root of inst.rootNodes) {
      const tn = root as TransformNode;
      tn.parent = holder;
      tn.scaling.scaleInPlace(BOSS_SCALE);
      if (tn.rotationQuaternion) {
        tn.rotationQuaternion = flip.multiply(tn.rotationQuaternion);
      } else {
        tn.rotation.y += Math.PI;
      }
    }

    // Feet-on-ground offset.
    holder.computeWorldMatrix(true);
    const bbox = holder.getHierarchyBoundingVectors(true);
    const feetOffset = -bbox.min.y;
    for (const root of inst.rootNodes) {
      (root as TransformNode).position.y += feetOffset;
    }

    // Play the dramatic "city_action" pose, looped for the cinematic's duration.
    for (const ag of inst.animationGroups) ag.stop();
    const action = inst.animationGroups.find(ag => ag.name.toLowerCase().includes('action'))
      ?? inst.animationGroups[0];
    if (action) action.start(true);
  }

  /** Advance the cinematic on the RAW (unscaled) frame delta. */
  update(deltaTime: number): void {
    if (!this.active) return;
    const camera = this.getCamera();
    if (!camera) { this.finish(); return; }

    this.elapsed += deltaTime;

    if (this.elapsed < GLIDE_IN_S) {
      const s = smoothstep(this.elapsed / GLIDE_IN_S);
      Vector3.LerpToRef(this.savedPos, this.framePos, s, this._pos);
      Vector3.LerpToRef(this.startLook, this.bossLook, s, this._look);
    } else if (this.elapsed < GLIDE_IN_S + HOLD_S) {
      this._pos.copyFrom(this.framePos);
      this._look.copyFrom(this.bossLook);
    } else if (this.elapsed < TOTAL_S) {
      const s = smoothstep((this.elapsed - GLIDE_IN_S - HOLD_S) / GLIDE_OUT_S);
      Vector3.LerpToRef(this.framePos, this.savedPos, s, this._pos);
      Vector3.LerpToRef(this.bossLook, this.startLook, s, this._look);
    } else {
      this.finish();
      return;
    }

    camera.position.copyFrom(this._pos);
    camera.setTarget(this._look);
  }

  private finish(): void {
    const camera = this.getCamera();
    if (camera) {
      camera.position.copyFrom(this.savedPos);
      camera.rotation.copyFrom(this.savedRot);
    }
    this.disposeModel();
    this.active = false;
    this.elapsed = 0;
    const r = this.resolveFn;
    this.resolveFn = null;
    if (r) r();
  }

  private disposeModel(): void {
    for (const ag of this.animGroups) ag.dispose();
    for (const sk of this.skeletons) sk.dispose();
    for (const root of this.rootNodes) root.dispose(false, true); // free cloned mats + textures
    this.holder?.dispose(false, true);
    this.animGroups = [];
    this.skeletons = [];
    this.rootNodes = [];
    this.holder = null;
  }

  /**
   * Run abandoned mid-cinematic (exit()): restore the camera and free the model.
   * Does NOT resolve the pending promise — the deferred boss spawn is guarded and
   * must not fire into a torn-down run.
   */
  dispose(): void {
    if (this.active) {
      const camera = this.getCamera();
      if (camera) {
        camera.position.copyFrom(this.savedPos);
        camera.rotation.copyFrom(this.savedRot);
      }
    }
    this.disposeModel();
    this.active = false;
    this.resolveFn = null;
  }
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/survivors/BossEntranceCinematic.ts
git commit -m "feat(boss-entrance): cinematic controller (camera pan + model lifecycle)"
```

---

### Task 3: `spawnPosOverride` on EnemyManager.spawnSurvivorsEnemy

**Files:**
- Modify: `src/survivors/enemies/EnemyManager.ts` (the `spawnSurvivorsEnemy` signature + spawn-position block, around lines 470-484)

- [ ] **Step 1: Update the signature**

Find:

```typescript
    public spawnSurvivorsEnemy(type: string, eliteElement?: string, bossStrengthMultiplier: number = 1): Enemy | null {
        if (!this.heroProvider) return null;
```

Replace with:

```typescript
    public spawnSurvivorsEnemy(type: string, eliteElement?: string, bossStrengthMultiplier: number = 1, spawnPosOverride?: Vector3): Enemy | null {
        if (!this.heroProvider) return null;
```

- [ ] **Step 2: Honor the override when computing the spawn position**

Find:

```typescript
        const heroPos = this.heroProvider.getPosition();
        const theta = Math.random() * Math.PI * 2;
        const r = this.arenaRadius + 2;
        const spawnPos = new Vector3(
            heroPos.x + Math.cos(theta) * r,
            0,
            heroPos.z + Math.sin(theta) * r,
        );
```

Replace with:

```typescript
        const heroPos = this.heroProvider.getPosition();
        let spawnPos: Vector3;
        if (spawnPosOverride) {
            // Boss-entrance cinematic places the boss exactly where the camera looked.
            spawnPos = spawnPosOverride.clone();
        } else {
            const theta = Math.random() * Math.PI * 2;
            const r = this.arenaRadius + 2;
            spawnPos = new Vector3(
                heroPos.x + Math.cos(theta) * r,
                0,
                heroPos.z + Math.sin(theta) * r,
            );
        }
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/survivors/enemies/EnemyManager.ts
git commit -m "feat(boss-entrance): optional spawnPosOverride on spawnSurvivorsEnemy"
```

---

### Task 4: Wire the cinematic into SurvivorsGameplayState

**Files:**
- Modify: `src/survivors/SurvivorsGameplayState.ts`

- [ ] **Step 1: Import the cinematic + tier helper**

Near the other `src/survivors/...` imports at the top of the file, add:

```typescript
import { BossEntranceCinematic } from './BossEntranceCinematic';
import { entranceTierForWave } from './bossEntranceTier';
```

- [ ] **Step 2: Add the entrance GLB registry + loader**

Immediately AFTER the `ENEMY_GLB_PATHS` object (the block ending at the line `};` on line 71, before `function loadChampionAsset`), insert:

```typescript
// Boss-entrance cinematic GLBs (tiers 1-3 → waves 5/10/15). Kept in a SEPARATE
// registry from ENEMY_GLB_PATHS so they never feed enemy spawn-staging or prewarm —
// they are only ever consumed by BossEntranceCinematic.
const BOSS_ENTRANCE_GLB_PATHS: Partial<Record<string, { dir: string; file: string }>> = {
    entrance1: { dir: 'assets/thamuz-lord-lava-entrance/source/',      file: 'thamuz_lord_lava_entrance.glb' },
    entrance2: { dir: 'assets/thamuz-lord-of-wraith-entrance/source/', file: 'thamuz_lord_of_wraith_entrance.glb' },
    entrance3: { dir: 'assets/helcurt-shadowbringer-entrance/source/', file: 'helcurt_shadowbringer_entrance.glb' },
};
function loadBossEntranceAsset(tier: number, scene: Scene): Promise<AssetContainer> | null {
    return loadAsset(BOSS_ENTRANCE_GLB_PATHS, `entrance${tier}`, scene);
}
```

- [ ] **Step 3: Declare the fields**

Find the field declaration (line ~190):

```typescript
    private timeScale: number = 1.0;
```

Insert immediately AFTER it:

```typescript
    private bossEntrance: BossEntranceCinematic | null = null;
    /** Absolute wave whose boss-entrance cinematic already played (re-entry guard). */
    private bossEntrancePlayedWave: number = -1;
```

- [ ] **Step 4: Preload the entrance GLBs in enter()**

Find the enemy-preload loop in `enter()` (lines ~338-341):

```typescript
        for (const type of Object.keys(ENEMY_GLB_PATHS)) {
            const p = loadEnemyAsset(type, this.scene);
            if (p) p.catch(err => console.error(`Enemy GLB preload failed (${type}):`, err));
        }
```

Insert immediately AFTER that block:

```typescript
        for (let tier = 1; tier <= 3; tier++) {
            const p = loadBossEntranceAsset(tier, this.scene);
            if (p) p.catch(err => console.error(`Boss entrance GLB preload failed (tier ${tier}):`, err));
        }
```

- [ ] **Step 5: Construct + load the cinematic in startRun()**

Find the enemy-asset hand-off loop + prewarm in `startRun()` (lines ~531-546). Immediately AFTER the `await this.enemyManager.prewarmEnemyTypes();` line, insert:

```typescript
        // Boss-entrance cinematic — construct + load the tier-1/2/3 entrance GLBs.
        // The camera accessor is read lazily each frame so it always sees the live
        // hero camera. Preloaded in enter(), so these awaits are usually cache hits.
        this.bossEntrance = new BossEntranceCinematic(this.game, () => this.heroController?.getCamera() ?? null);
        const entranceAssets: Partial<Record<number, AssetContainer>> = {};
        for (let tier = 1; tier <= 3; tier++) {
            const p = loadBossEntranceAsset(tier, this.scene);
            if (!p) continue;
            try {
                entranceAssets[tier] = await p;
            } catch (err) {
                console.error(`Boss entrance GLB failed to load (tier ${tier}):`, err);
            }
        }
        this.bossEntrance.setEntranceAssets(entranceAssets);
        this.bossEntrancePlayedWave = -1;
```

- [ ] **Step 6: Intercept the boss spawn**

Find the `setSpawnFn` wiring (lines ~686-688):

```typescript
        this.waveManager.setSpawnFn((type, eliteElement, bossStrengthMultiplier) => {
            this.enemyManager!.spawnSurvivorsEnemy(type, eliteElement, bossStrengthMultiplier);
        });
```

Replace with:

```typescript
        this.waveManager.setSpawnFn((type, eliteElement, bossStrengthMultiplier) => {
            if (type === 'boss' && this.shouldPlayBossEntrance()) {
                void this.spawnBossWithEntrance(bossStrengthMultiplier);
            } else {
                this.enemyManager!.spawnSurvivorsEnemy(type, eliteElement, bossStrengthMultiplier);
            }
        });
```

- [ ] **Step 7: Add the orchestration methods**

Immediately AFTER the `setSpawnFn(...)` block from Step 6, insert these two methods... wait — `setSpawnFn` is inside `startRun()`. Instead, add the methods as class members. Place them immediately BEFORE the `private applyLevelBonuses(): void {` method (line ~1700):

```typescript
    /** True when the current wave's boss should get an entrance cinematic. */
    private shouldPlayBossEntrance(): boolean {
        if (!this.bossEntrance || !this.waveManager) return false;
        const wave = this.waveManager.getCurrentWave();
        const tier = entranceTierForWave(wave);
        return tier !== null && this.bossEntrance.hasEntrance(tier) && this.bossEntrancePlayedWave !== wave;
    }

    /**
     * Play the entrance cinematic, then spawn the real milestone boss exactly where
     * the camera was looking. Async + fire-and-forget; gameplay is frozen by the
     * isActive() check in update() for the cinematic's duration.
     */
    private async spawnBossWithEntrance(strength: number): Promise<void> {
        if (!this.bossEntrance || !this.enemyManager || !this.waveManager || !this.hero) return;
        const wave = this.waveManager.getCurrentWave();
        const tier = entranceTierForWave(wave);
        if (tier === null) return;
        this.bossEntrancePlayedWave = wave;

        const heroPos = this.hero.getPosition();
        const arenaRadius = this.map?.getArenaRadius() ?? 20;
        const theta = Math.random() * Math.PI * 2;
        const r = arenaRadius + 2;
        const spawnPos = new Vector3(
            heroPos.x + Math.cos(theta) * r,
            0,
            heroPos.z + Math.sin(theta) * r,
        );

        await this.bossEntrance.play(tier, spawnPos, heroPos.clone());

        // Run may have exited (or torn down) during the ~2.2s cinematic.
        if (!this.enemyManager) return;
        this.enemyManager.spawnSurvivorsEnemy('boss', undefined, strength, spawnPos);
    }
```

- [ ] **Step 8: Freeze the battlefield while the cinematic plays**

Find the top of `update()` (lines ~1188-1193):

```typescript
    public update(deltaTime: number): void {
        // If game hasn't started yet (champion select showing), skip game updates
        if (!this.heroController) return;

        // True pause while any blocking overlay is open (power choice, replace-slot, shop)
        if (this.isPausedForOverlay()) return;
```

Insert immediately AFTER the `isPausedForOverlay()` early-return:

```typescript

        // Boss-entrance cinematic owns the frame: advance it on the RAW delta and
        // freeze everything else (hero/wave/enemies/powers never tick), so the
        // follow-cam can't fight the cinematic and the wave can't be flagged clear.
        if (this.bossEntrance?.isActive()) {
            this.bossEntrance.update(deltaTime);
            return;
        }
```

- [ ] **Step 9: Dispose on exit()**

Open `exit()` (line ~1073) and, alongside the other subsystem teardown, add:

```typescript
        this.bossEntrance?.dispose();
        this.bossEntrance = null;
        this.bossEntrancePlayedWave = -1;
```

(Place it near where other run systems like `enemyManager`/`abilityManager` are nulled.)

- [ ] **Step 10: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors. If `AssetContainer` is reported unused/missing, confirm it's already imported (it is — used by `_glbAssets`).

- [ ] **Step 11: Commit**

```bash
git add src/survivors/SurvivorsGameplayState.ts
git commit -m "feat(boss-entrance): wire cinematic into spawn flow + update freeze"
```

---

### Task 5: Build + full verification

**Files:** none (verification only)

- [ ] **Step 1: Unit tests pass**

Run: `npm test`
Expected: all specs pass, including `tests/BossEntrance.spec.ts`.

- [ ] **Step 2: Type-check clean**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Production build succeeds**

Run: `npm run build`
Expected: webpack build completes; `dist/assets/` contains the three `*-entrance/` folders (the build copies `assets/`). If they are missing, confirm the asset-copy step includes them.

- [ ] **Step 4: Manual verification (dev server)**

Run: `npm start`, play to wave 5, then 10, then 15. Confirm for each:
- The correct entrance model appears (lava Thamuz → wraith Thamuz → Helcurt) striking its action pose.
- The camera glides to the boss, holds ~1s, glides back, and the top-down follow resumes at the **exact** prior angle (no tilt/drift).
- The real boss materializes where the camera looked and combat resumes; other enemies were frozen during the cinematic.
- Console shows no `[resource-watchdog] LEAK SUSPECTED` after the boss wave clears, and no render-loop errors.

- [ ] **Step 5: Final commit (if any tweaks were needed)**

```bash
git add -A
git commit -m "chore(boss-entrance): verification pass"
```

---

## Self-Review Notes

- **Spec coverage:** asset mapping (Task 4 Step 2), cinematic controller incl. camera pan/hold/return + model lifecycle (Task 2), hard freeze via early-return (Task 4 Step 8), spawn-where-camera-looked via `spawnPosOverride` (Task 3 + Task 4 Step 7), preload-at-run-start (Task 4 Steps 4-5), ~2.2s timing (Task 2 constants), degrade-on-missing-asset + exit cleanup + re-entrancy guard (Task 2 `dispose`/`play` guards, Task 4 `shouldPlayBossEntrance`/`exit`). All covered.
- **HeroController:** the spec mentioned a `setCameraSuspended` flag; implementation discovered it is unnecessary because `update()` early-returns before `heroController.update()` during the cinematic, so the follow-cam never runs. The camera snapshot/hard-restore in the cinematic fully covers the handoff. No HeroController change is required.
- **Type consistency:** `entranceTierForWave` returns `1|2|3|null` and is consumed as such; `spawnSurvivorsEnemy(..., spawnPosOverride?: Vector3)` matches the call in `spawnBossWithEntrance`; `setEntranceAssets`/`hasEntrance`/`isActive`/`play`/`update`/`dispose` signatures match all call sites.
```
