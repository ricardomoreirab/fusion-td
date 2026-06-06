# Red Minion Tier Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** From wave 10 onward, replace the three "blue" base enemies (basic melee minion, gold artillery carriage, wizard) with tougher "red" variants — red minion 10× HP / 2× speed / 2× attack rate, red carriage 10× HP, red wizard 3× HP with a new ranged attack instead of healing.

**Architecture:** A single pure remap function (`redSwapType`) is called at the top of `EnemyManager.spawnSurvivorsEnemy()` to rewrite the spawn type string when `wave >= 10`. Three new enemy classes subclass their blue counterparts: `RedMeleeMinion extends BasicEnemy` and `RedArtilleryCarriage extends FastEnemy` are thin stat overrides; `RedWizard extends HealerEnemy` reuses its GLB/animation/death code but replaces the heal with a ranged bolt via a new overridable `performSupportBehavior()` hook. GLB assets (already on disk) wire up automatically through `ENEMY_GLB_PATHS`.

**Tech Stack:** TypeScript, BabylonJS, Vitest (pure-logic tests only). Build: `npm run build`; type-check: `npx tsc --noEmit`; test: `npm test`.

---

## File Structure

- **Create** `src/survivors/enemies/redSwap.ts` — pure `redSwapType(type, wave)` remap + `RED_SWAP_WAVE` constant. The only unit-testable piece.
- **Create** `tests/redSwap.spec.ts` — Vitest spec for `redSwapType`.
- **Create** `src/survivors/enemies/RedMeleeMinion.ts` — `extends BasicEnemy`, stat overrides.
- **Create** `src/survivors/enemies/RedArtilleryCarriage.ts` — `extends FastEnemy`, HP override.
- **Create** `src/survivors/enemies/RedWizard.ts` — `extends HealerEnemy`, ranged-bolt behavior.
- **Modify** `src/survivors/enemies/HealerEnemy.ts` — extract heal into `protected performSupportBehavior()`; make `glbAttackHoldTimer` protected.
- **Modify** `src/survivors/enemies/EnemyManager.ts` — import + call `redSwapType`; add 3 switch cases; extend `prewarmEnemyTypes`; update shadow-skip.
- **Modify** `src/survivors/SurvivorsGameplayState.ts` — add 5 rows to `ENEMY_GLB_PATHS`.

---

## Task 1: Pure remap function + tests (TDD)

**Files:**
- Create: `tests/redSwap.spec.ts`
- Create: `src/survivors/enemies/redSwap.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/redSwap.spec.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { redSwapType, RED_SWAP_WAVE } from '../src/survivors/enemies/redSwap';

describe('redSwapType', () => {
    it('passes base types through before the swap wave', () => {
        expect(redSwapType('basic', 9)).toBe('basic');
        expect(redSwapType('fast', 1)).toBe('fast');
        expect(redSwapType('healer', RED_SWAP_WAVE - 1)).toBe('healer');
    });

    it('swaps basic/fast/healer to red variants at and after the swap wave', () => {
        expect(redSwapType('basic', RED_SWAP_WAVE)).toBe('basic_red');
        expect(redSwapType('fast', 10)).toBe('fast_red');
        expect(redSwapType('healer', 25)).toBe('healer_red');
    });

    it('leaves non-swapped types unchanged at any wave', () => {
        expect(redSwapType('tank', 20)).toBe('tank');
        expect(redSwapType('boss', 20)).toBe('boss');
        expect(redSwapType('shield', 50)).toBe('shield');
        expect(redSwapType('splitting', 50)).toBe('splitting');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- redSwap`
Expected: FAIL — cannot resolve `'../src/survivors/enemies/redSwap'` (module does not exist yet).

- [ ] **Step 3: Write minimal implementation**

Create `src/survivors/enemies/redSwap.ts`:

```typescript
/** Wave number at/after which blue base enemies are replaced by their red variants. */
export const RED_SWAP_WAVE = 10;

/**
 * Map a base enemy type string to its red variant once the run reaches
 * RED_SWAP_WAVE. Types without a red variant (tank, boss, shield, splitting, …)
 * pass through unchanged. Pure function — unit-tested; the only logic the
 * Babylon-coupled spawn path can't cover.
 */
export function redSwapType(type: string, wave: number): string {
    if (wave < RED_SWAP_WAVE) return type;
    switch (type) {
        case 'basic':  return 'basic_red';
        case 'fast':   return 'fast_red';
        case 'healer': return 'healer_red';
        default:       return type;
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- redSwap`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add tests/redSwap.spec.ts src/survivors/enemies/redSwap.ts
git commit -m "feat(enemies): pure red-tier swap remap (wave 10+)"
```

---

## Task 2: RedMeleeMinion class

**Files:**
- Create: `src/survivors/enemies/RedMeleeMinion.ts`

Subclasses `BasicEnemy`. The base ctor calls `super(...,3,30,10,10)` and, because of the `new.target === BasicEnemy` guard, does NOT build visuals when the leaf is `RedMeleeMinion`. We override the stats AFTER `super()` (so field initializers have settled), then call `_initEnemyVisuals()` ourselves. `createMesh()` is inherited from `BasicEnemy` and reads `BasicEnemy.pendingAsset` — EnemyManager stages the red GLB there in Task 5.

- [ ] **Step 1: Write the class**

Create `src/survivors/enemies/RedMeleeMinion.ts`:

```typescript
import { Vector3 } from '@babylonjs/core';
import { Game } from '../../engine/Game';
import { BasicEnemy } from './BasicEnemy';

/**
 * Wave-10+ replacement for the blue melee minion (BasicEnemy).
 * 10× HP, 2× move speed, 2× attack rate (and doubled contact DPS to match the
 * doubled swing cadence). Reuses BasicEnemy's mesh/GLB/animation code wholesale;
 * EnemyManager stages the red-melee-minion GLB on BasicEnemy.pendingAsset before
 * constructing this class, which the inherited createMesh() consumes.
 */
export class RedMeleeMinion extends BasicEnemy {
    constructor(game: Game, position: Vector3, path: Vector3[]) {
        super(game, position, path);

        // Red tier overrides (BasicEnemy base: 30 HP / speed 3 / 0.5s cooldown / 8 DPS).
        this.health = 300;
        this.maxHealth = 300;
        this.speed = 6;
        this.originalSpeed = 6;
        this.meleeCooldownDuration = 0.25;
        this.contactDamagePerSecond = 16;

        // Build mesh + health bar AFTER the stat overrides so the bar reflects 300 HP.
        // new.target guard mirrors BasicEnemy: fires exactly once for the concrete leaf.
        if (new.target === RedMeleeMinion) this._initEnemyVisuals();
    }
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors. (If `health`/`maxHealth`/`speed`/`originalSpeed`/`meleeCooldownDuration`/`_initEnemyVisuals` report as inaccessible, they are `protected` on `Enemy` and reachable from this subclass — re-read the error; it should not occur.)

- [ ] **Step 3: Commit**

```bash
git add src/survivors/enemies/RedMeleeMinion.ts
git commit -m "feat(enemies): RedMeleeMinion (10x HP, 2x speed, 2x rate)"
```

---

## Task 3: RedArtilleryCarriage class

**Files:**
- Create: `src/survivors/enemies/RedArtilleryCarriage.ts`

Subclasses `FastEnemy` (base: 20 HP / speed 6 / 0.35s cooldown / 7 dmg / flying). Per the spec decision, only HP changes (10×). Speed and attack rate stay.

- [ ] **Step 1: Write the class**

Create `src/survivors/enemies/RedArtilleryCarriage.ts`:

```typescript
import { Vector3 } from '@babylonjs/core';
import { Game } from '../../engine/Game';
import { FastEnemy } from './FastEnemy';

/**
 * Wave-10+ replacement for the blue gold artillery carriage (FastEnemy).
 * 10× HP only — speed (6) and attack rate (0.35s) are unchanged; it is already
 * the fast/flying enemy. Reuses FastEnemy's mesh/GLB/animation code; EnemyManager
 * stages the red-gold-artillery-carriage GLB on FastEnemy.pendingAsset.
 */
export class RedArtilleryCarriage extends FastEnemy {
    constructor(game: Game, position: Vector3, path: Vector3[]) {
        super(game, position, path);

        // Red tier override (FastEnemy base: 20 HP). isFlying / speed / melee unchanged.
        this.health = 200;
        this.maxHealth = 200;

        if (new.target === RedArtilleryCarriage) this._initEnemyVisuals();
    }
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/survivors/enemies/RedArtilleryCarriage.ts
git commit -m "feat(enemies): RedArtilleryCarriage (10x HP)"
```

---

## Task 4: HealerEnemy refactor — overridable support behavior

**Files:**
- Modify: `src/survivors/enemies/HealerEnemy.ts:31` (field visibility)
- Modify: `src/survivors/enemies/HealerEnemy.ts:308-323` (extract heal)

This is a pure refactor: the healer's behavior must not change. We (a) make `glbAttackHoldTimer` protected so `RedWizard` can trigger the cast animation when it fires, and (b) move the heal block into a `protected performSupportBehavior(deltaTime)` that `RedWizard` will override.

- [ ] **Step 1: Make `glbAttackHoldTimer` protected**

In `src/survivors/enemies/HealerEnemy.ts`, change line 31 from:

```typescript
    private glbAttackHoldTimer: number = 0;
```

to:

```typescript
    protected glbAttackHoldTimer: number = 0;
```

- [ ] **Step 2: Extract the heal block into an overridable method**

In `update()`, replace this block (currently lines ~308-323):

```typescript
        // Update heal timer and dispatch heal event
        this.healTimer += deltaTime;
        if (this.healTimer >= 1.0) {
            this.healTimer -= 1.0;
            const healEvent = new CustomEvent('enemyHeal', {
                detail: {
                    position: this.position,
                    radius: 3,
                    healAmount: 5
                }
            });
            document.dispatchEvent(healEvent);

            // Expanding pulse ring visual at healer's feet
            this.spawnHealPulseRing();
        }
```

with a single call:

```typescript
        // Support behavior (heal pulse). Overridable: RedWizard replaces this with
        // a ranged bolt attack instead of healing.
        this.performSupportBehavior(deltaTime);
```

- [ ] **Step 3: Add the `performSupportBehavior` method**

Add this method to the `HealerEnemy` class (e.g. immediately AFTER `update()` closes, before `createDeathEffect()`):

```typescript
    /**
     * Per-frame support behavior. Base healer: every 1s, dispatch a heal pulse to
     * nearby allies + spawn the telegraph ring. Subclasses (RedWizard) override this
     * to do something else entirely (e.g. fire a projectile) without touching the
     * shared GLB/animation/movement code in update().
     */
    protected performSupportBehavior(deltaTime: number): void {
        this.healTimer += deltaTime;
        if (this.healTimer >= 1.0) {
            this.healTimer -= 1.0;
            const healEvent = new CustomEvent('enemyHeal', {
                detail: {
                    position: this.position,
                    radius: 3,
                    healAmount: 5
                }
            });
            document.dispatchEvent(healEvent);

            // Expanding pulse ring visual at healer's feet
            this.spawnHealPulseRing();
        }
    }
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors. Healer behavior is byte-for-byte identical (same code, just relocated).

- [ ] **Step 5: Commit**

```bash
git add src/survivors/enemies/HealerEnemy.ts
git commit -m "refactor(enemies): extract HealerEnemy heal into overridable performSupportBehavior"
```

---

## Task 5: RedWizard class — ranged bolt attack

**Files:**
- Create: `src/survivors/enemies/RedWizard.ts`

Subclasses `HealerEnemy` (base: speed 3.5, weak melee, healer GLB pipeline). Overrides: HP 75 (3×25), contact DPS 2, and `performSupportBehavior` → fire a dodgeable straight bolt at the hero every 2s when within range. Reuses the `ProjectilePool` + `getCachedMaterial` + `onBeforeRenderObservable` pattern lifted from `HeroBasicAttack` / `HealerEnemy.spawnHealPulseRing` (CLAUDE.md transient-FX rules: pooled mesh + bounded cache key + observer removed on every exit path).

- [ ] **Step 1: Write the class**

Create `src/survivors/enemies/RedWizard.ts`:

```typescript
import { Vector3, MeshBuilder, Color3 } from '@babylonjs/core';
import { Game } from '../../engine/Game';
import { HealerEnemy } from './HealerEnemy';
import { acquireProjectile, releaseProjectile } from '../../engine/rendering/ProjectilePool';
import { getCachedMaterial } from '../../engine/rendering/MaterialCache';

/**
 * Wave-10+ replacement for the blue wizard (HealerEnemy). It does NOT heal —
 * instead it fires a dodgeable magic bolt at the hero from range, and has 3× the
 * healer's HP. Reuses HealerEnemy's GLB / animation / movement / death code; only
 * the support behavior (performSupportBehavior) is replaced.
 */
export class RedWizard extends HealerEnemy {
    private static readonly ATTACK_COOLDOWN = 2.0; // seconds between bolts
    private static readonly ATTACK_RANGE = 12;     // world units; only fires within this
    private static readonly BOLT_SPEED = 14;       // units/sec — slow enough to sidestep
    private static readonly BOLT_DAMAGE = 12;
    private static readonly BOLT_HIT_RADIUS = 0.6; // distance to hero counted as a hit
    private static readonly BOLT_TIMEOUT_MS = 3000;
    private static readonly POOL_KEY = 'red-wizard-bolt';

    /** Counts down to the next shot. Starts at full cooldown so the first bolt is delayed. */
    private attackTimer: number = RedWizard.ATTACK_COOLDOWN;

    constructor(game: Game, position: Vector3, path: Vector3[]) {
        super(game, position, path);

        // Red tier override (HealerEnemy base: 25 HP). Keep speed 3.5 + weak melee.
        // Low contact DPS — it's a backline ranged threat, not a brawler.
        this.health = 75;
        this.maxHealth = 75;
        this.contactDamagePerSecond = 2;

        if (new.target === RedWizard) this._initEnemyVisuals();
    }

    /**
     * Replaces the healer's heal pulse: tick an attack timer and, when ready AND the
     * hero is within range, fire a bolt. Out of range → timer stays ready so the bolt
     * launches the instant the hero steps into range.
     */
    protected performSupportBehavior(deltaTime: number): void {
        if (!this.seekTarget || this.isFrozen || this.isStunned) return;

        this.attackTimer -= deltaTime;
        if (this.attackTimer > 0) return;

        const heroPos = this.seekTarget.getPosition();
        const dx = heroPos.x - this.position.x;
        const dz = heroPos.z - this.position.z;
        if (dx * dx + dz * dz > RedWizard.ATTACK_RANGE * RedWizard.ATTACK_RANGE) return;

        this.attackTimer = RedWizard.ATTACK_COOLDOWN;
        // Trigger the GLB cast/attack animation (inherited GLB block plays it while > 0).
        this.glbAttackHoldTimer = 0.6;
        this.fireBolt(heroPos);
    }

    /**
     * Spawn a straight-flying bolt aimed at the hero's position AT LAUNCH (non-homing,
     * so the player can dodge). Moved each frame via an onBeforeRenderObservable closure;
     * the observer is removed on hit, timeout, or if the wizard/hero is gone.
     */
    private fireBolt(heroPos: Vector3): void {
        const origin = this.position.clone();
        origin.y += 1.4; // roughly staff-orb height

        const dirX = heroPos.x - origin.x;
        const dirZ = heroPos.z - origin.z;
        const len = Math.hypot(dirX, dirZ) || 1;
        const vx = (dirX / len) * RedWizard.BOLT_SPEED;
        const vz = (dirZ / len) * RedWizard.BOLT_SPEED;

        const bolt = acquireProjectile(this.scene, RedWizard.POOL_KEY, () => {
            const m = MeshBuilder.CreateSphere('redWizardBolt', { diameter: 0.4, segments: 6 }, this.scene);
            // Bounded cache key (one material total) — never per-instance/random (CLAUDE.md).
            m.material = getCachedMaterial(this.scene, RedWizard.POOL_KEY, mat => {
                mat.emissiveColor = new Color3(0.95, 0.18, 0.12);
                mat.diffuseColor = new Color3(0.95, 0.18, 0.12);
                mat.disableLighting = true;
            });
            return m;
        });
        bolt.position.copyFrom(origin);
        bolt.setEnabled(true);

        const seekTarget = this.seekTarget;
        const startTime = performance.now();

        const observer = this.scene.onBeforeRenderObservable.add(() => {
            const cleanup = () => {
                this.scene.onBeforeRenderObservable.remove(observer);
                releaseProjectile(RedWizard.POOL_KEY, bolt);
            };

            // Bail if the bolt/wizard/hero is gone, or the bolt has flown too long.
            if (bolt.isDisposed() || !this.alive || !seekTarget
                || seekTarget.isAlive?.() === false
                || performance.now() - startTime > RedWizard.BOLT_TIMEOUT_MS) {
                cleanup();
                return;
            }

            const dt = this.scene.getEngine().getDeltaTime() / 1000;
            bolt.position.x += vx * dt;
            bolt.position.z += vz * dt;

            // Hit test against the hero's CURRENT position.
            const hp = seekTarget.getPosition();
            const hx = hp.x - bolt.position.x;
            const hz = hp.z - bolt.position.z;
            if (hx * hx + hz * hz < RedWizard.BOLT_HIT_RADIUS * RedWizard.BOLT_HIT_RADIUS) {
                seekTarget.takeDamage?.(RedWizard.BOLT_DAMAGE, this.position);
                cleanup();
            }
        });
    }
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors. (`seekTarget`, `isFrozen`, `isStunned`, `alive`, `position`, `scene`, `glbAttackHoldTimer` are all accessible — public/protected on `Enemy`/`HealerEnemy`. `seekTarget.takeDamage`/`isAlive` are optional members guarded with `?.`.)

- [ ] **Step 3: Commit**

```bash
git add src/survivors/enemies/RedWizard.ts
git commit -m "feat(enemies): RedWizard ranged-bolt caster (replaces blue-wizard heal)"
```

---

## Task 6: Wire the swap into EnemyManager

**Files:**
- Modify: `src/survivors/enemies/EnemyManager.ts` (imports near lines 4-14)
- Modify: `src/survivors/enemies/EnemyManager.ts:470-560` (`spawnSurvivorsEnemy`)
- Modify: `src/survivors/enemies/EnemyManager.ts:310-348` (`prewarmEnemyTypes` glbVariants)

- [ ] **Step 1: Add imports**

After the existing enemy imports (after `import { MiniEnemy } from './MiniEnemy';`), add:

```typescript
import { RedMeleeMinion } from './RedMeleeMinion';
import { RedArtilleryCarriage } from './RedArtilleryCarriage';
import { RedWizard } from './RedWizard';
import { redSwapType } from './redSwap';
```

- [ ] **Step 2: Apply the remap at the top of `spawnSurvivorsEnemy`**

In `spawnSurvivorsEnemy`, immediately AFTER the `spawnPos` block is computed and BEFORE the `assetFor` helper (around line 485), insert:

```typescript
        // Wave-10+ red-tier swap: tougher red variants replace the blue base enemies.
        // Rewrites the type string so both the asset lookup and the switch below use it.
        const waveNow = this.waveManager?.getCurrentWave() ?? 0;
        type = redSwapType(type, waveNow);
```

- [ ] **Step 3: Add the three switch cases**

In the `switch (type)` block, add these cases (e.g. after the `case 'healer':` block, before `case 'shield':`):

```typescript
            case 'basic_red':  BasicEnemy.pendingAsset = assetFor('basic_red');
                               enemy = new RedMeleeMinion(this.game, spawnPos, []); break;
            case 'fast_red':   FastEnemy.pendingAsset = assetFor('fast_red');
                               enemy = new RedArtilleryCarriage(this.game, spawnPos, []); break;
            case 'healer_red': HealerEnemy.pendingAsset = assetFor('healer_red');
                               enemy = new RedWizard(this.game, spawnPos, []); break;
```

(Note: `RedMeleeMinion` inherits `BasicEnemy.createMesh`, which reads `BasicEnemy.pendingAsset`; likewise `RedArtilleryCarriage`→`FastEnemy.pendingAsset`, `RedWizard`→`HealerEnemy.pendingAsset`. That is why we stage the parent's static slot.)

- [ ] **Step 4: Update the shadow-skip so red basics also skip shadows**

Find (around line 551):

```typescript
        const skipShadow = type === 'basic';
```

Replace with:

```typescript
        const skipShadow = type === 'basic' || type === 'basic_red';
```

- [ ] **Step 5: Prewarm the red GLB variants**

In `prewarmEnemyTypes`, the `glbVariants` array (lines ~331-342), add these entries (e.g. after the `fast_elite` and `healer_elite` lines respectively, or grouped at the end of the array before the closing `]`):

```typescript
            { cls: BasicEnemy,  key: 'basic_red',        build: () => new RedMeleeMinion(this.game, farAway, []) },
            { cls: BasicEnemy,  key: 'basic_red_elite',  build: () => new RedMeleeMinion(this.game, farAway, []) },
            { cls: FastEnemy,   key: 'fast_red',         build: () => new RedArtilleryCarriage(this.game, farAway, []) },
            { cls: HealerEnemy, key: 'healer_red',       build: () => new RedWizard(this.game, farAway, []) },
            { cls: HealerEnemy, key: 'healer_red_elite', build: () => new RedWizard(this.game, farAway, []) },
```

(`cls` is the class whose static `pendingAsset` slot is set; the red leaf's inherited `createMesh` reads that same slot. Entries whose `key` has no loaded asset are skipped by the existing `if (!asset) continue;` guard, so this is safe even before Task 7.)

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/survivors/enemies/EnemyManager.ts
git commit -m "feat(enemies): wire red-tier swap + prewarm into EnemyManager"
```

---

## Task 7: Register the red GLB assets

**Files:**
- Modify: `src/survivors/SurvivorsGameplayState.ts:54-71` (`ENEMY_GLB_PATHS`)

Adding keys here makes them preload (the `enter()` and gameplay loops iterate `Object.keys(ENEMY_GLB_PATHS)`) and get handed to `EnemyManager.setEnemyAsset`, so `assetFor('basic_red')` etc. resolve. All five `.glb` files are confirmed present on disk.

- [ ] **Step 1: Add the five asset rows**

In `ENEMY_GLB_PATHS`, add (e.g. after the `shield:` line, before the boss tiers):

```typescript
    basic_red:        { dir: 'assets/red-melee-minion/source/',            file: 'red_melee_minion.glb' },
    fast_red:         { dir: 'assets/red-gold-artillery-carriage/source/', file: 'red_gold_artillery_carriage.glb' },
    healer_red:       { dir: 'assets/red-wizard/source/',                  file: 'red_wizard.glb' },
    basic_red_elite:  { dir: 'assets/red-super-melee-minion/source/',      file: 'red_super_melee_minion.glb' },
    healer_red_elite: { dir: 'assets/red-super-wizard/source/',            file: 'red_super_wizard.glb' },
```

(There is no `red-super-artillery-carriage` asset; an elite red carriage's `fast_red_elite` lookup misses and `assetFor` falls back to `fast_red` automatically — no row needed.)

- [ ] **Step 2: Type-check + build**

Run: `npx tsc --noEmit && npm run build`
Expected: type-check clean; webpack build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/survivors/SurvivorsGameplayState.ts
git commit -m "feat(assets): register red minion/carriage/wizard GLBs"
```

---

## Task 8: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite + type-check**

Run: `npm test && npx tsc --noEmit`
Expected: all tests pass (including the 3 new `redSwap` tests); zero type errors.

- [ ] **Step 2: Manual in-game check**

Run: `npm start`, play to wave 10 (use any debug fast-forward if available; otherwise survive). Verify:
- Waves < 10 still spawn the blue minion / blue carriage / blue wizard (healing).
- From wave 10: red minion (visibly tankier, faster, hits twice as often), red carriage (very tanky, same speed), red wizard fires red bolts at the hero that can be sidestepped and deal damage on hit; the wizard no longer heals.
- No frame hitch on the first red spawn (prewarm working).
- Clear a wave at/after 10 and confirm the console shows NO `[resource-watchdog] LEAK SUSPECTED` line after sustained wizard fire (bolt mesh/material lifecycle is clean).

- [ ] **Step 3: Final confirmation**

Report the test output, type-check result, and manual observations. The feature is complete when tests pass, types are clean, and the wave-10 swap + dodgeable wizard bolts behave as described with no watchdog leak warning.

---

## Self-Review Notes

- **Spec coverage:** red minion stats (Task 2) ✓; red carriage 10× HP only (Task 3) ✓; red wizard 3× HP + ranged, no heal (Tasks 4-5) ✓; wave-10 gate (Task 1 + Task 6 step 2) ✓; asset wiring incl. elites (Task 7) ✓; leak-safety (Task 5 pooled mesh + bounded key + observer cleanup) ✓; prewarm to avoid first-spawn freeze (Task 6 step 5) ✓.
- **Type consistency:** `BasicEnemy.pendingAsset` / `FastEnemy.pendingAsset` / `HealerEnemy.pendingAsset` are the staging slots the inherited `createMesh()` reads — staged consistently in both `spawnSurvivorsEnemy` (Task 6.3) and `prewarmEnemyTypes` (Task 6.5). `redSwapType` / `RED_SWAP_WAVE` names match across Task 1 and Task 6. `performSupportBehavior(deltaTime)` signature matches between Task 4 (definition) and Task 5 (override). `glbAttackHoldTimer` made protected in Task 4 before Task 5 uses it.
- **No placeholders:** every code step contains complete code.
