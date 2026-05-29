# Harder Difficulty (≈+50%) + Freeze Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make survivors mode ~50% harder across all four axes (tankier enemies, more incoming damage, bigger/faster swarms, harder bosses/elites) via one central tuning module, then investigate and fix the remaining frame-time freezing.

**Architecture:** A single `DifficultyTuning.ts` constants module is the source of truth. Existing single-site injection points read from it: the survivors spawn path (`EnemyManager.spawnSurvivorsEnemy`) applies a global HP+damage multiplier to every non-milestone-boss enemy; `setSurvivorsRates` reads cadence/count; `MilestoneBoss` and `EliteSpawner` layer their own multipliers; player HP is scaled per-champion. The freeze is handled separately as a systematic-debugging investigation.

**Tech Stack:** TypeScript, BabylonJS, Vitest (pure-logic tests only), webpack.

**Spec:** `docs/superpowers/specs/2026-05-30-harder-difficulty-design.md`

**Deviation from spec (recorded):** The spec said "player HP 120→110 (flat)". The code has no flat 120 — starting HP is per-champion `variant.hp` (barbarian 140 / ranger 90 / mage 80), consumed by BOTH `HeroController` and `PlayerStats`. The faithful implementation is a **multiplier** `playerHpMult: 0.92` (≈−8%, preserving per-champion differences) rather than a flat 110. So the `DifficultyTuning` field is `playerHpMult: 0.92`, not `playerStartHp: 110`.

**Working baseline:** worktree `feat/harder-difficulty` carries the boss-rework WIP (5 modified files, uncommitted). `tsc --noEmit` clean, 47/47 tests pass. Run all commands from the worktree root.

---

## File Structure

- **Create** `src/survivors/DifficultyTuning.ts` — the constants object (pure, no Babylon).
- **Create** `tests/DifficultyTuning.spec.ts` — invariant guards ("game is harder than baseline").
- **Modify** `src/survivors/enemies/Enemy.ts` — add public `applyDamageMultiplier` (mirror of `applyHealthMultiplier`).
- **Modify** `src/survivors/enemies/EnemyManager.ts` — add `_applyGlobalDifficulty` + call it in `spawnSurvivorsEnemy`.
- **Modify** `src/survivors/SurvivorsGameplayState.ts` — read cadence/count from tuning; scale player HP.
- **Modify** `src/survivors/enemies/MilestoneBoss.ts` — layer `bossHpMult` / `bossDamageMult` (WIP file — edit surgically).
- **Modify** `src/survivors/enemies/EliteSpawner.ts` — read `eliteHpMult` instead of literal `3`.

---

## Task 1: Central tuning module (TDD)

**Files:**
- Create: `src/survivors/DifficultyTuning.ts`
- Test: `tests/DifficultyTuning.spec.ts`

- [ ] **Step 1: Write the failing test**

The test asserts *invariants* (harder than the documented baselines: spawn 2.2, count 1.6, elite 3.0), NOT exact values — so playtest tuning won't break it.

`tests/DifficultyTuning.spec.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { DifficultyTuning as D } from '../src/survivors/DifficultyTuning';

describe('DifficultyTuning', () => {
  it('makes enemies tankier and hit harder', () => {
    expect(D.enemyHpMult).toBeGreaterThan(1);
    expect(D.enemyDamageMult).toBeGreaterThan(1);
  });

  it('increases swarm pressure beyond the old survivors baseline (2.2 / 1.6)', () => {
    expect(D.spawnRateMult).toBeGreaterThan(2.2);
    expect(D.enemyCountMult).toBeGreaterThan(1.6);
  });

  it('makes bosses harder', () => {
    expect(D.bossHpMult).toBeGreaterThan(1);
    expect(D.bossDamageMult).toBeGreaterThan(1);
  });

  it('makes elites tankier than the old 3x baseline', () => {
    expect(D.eliteHpMult).toBeGreaterThan(3);
  });

  it('makes the player squishier but not removed', () => {
    expect(D.playerHpMult).toBeGreaterThan(0);
    expect(D.playerHpMult).toBeLessThan(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/DifficultyTuning.spec.ts`
Expected: FAIL — cannot resolve `../src/survivors/DifficultyTuning`.

- [ ] **Step 3: Create the module**

`src/survivors/DifficultyTuning.ts`:
```ts
/**
 * Single source of truth for the survivors-mode difficulty rebalance.
 *
 * Per-axis numbers are deliberately MODEST: the four axes compound
 * multiplicatively (tankier × more-of-them × hit-harder), so these aggregate to
 * a "substantial" (~1.5–1.7×) overall difficulty, not 1.5× on each (which would
 * stack to ~3× = brutal). Tune here; every consumer reads from this object.
 *
 * Baselines being replaced: survivors spawn cadence was 2.2, enemy count 1.6,
 * elite HP 3.0, hero HP per-champion (barb 140 / ranger 90 / mage 80).
 */
export const DifficultyTuning = {
  /** Global max-HP multiplier on every non-milestone-boss enemy at spawn. */
  enemyHpMult: 1.30,
  /** Global contact + melee damage multiplier on every non-milestone-boss enemy. */
  enemyDamageMult: 1.25,
  /** Survivors spawn cadence (delays divided by this). Was 2.2. */
  spawnRateMult: 2.6,
  /** Enemies per wave (group counts multiplied by this). Was 1.6. */
  enemyCountMult: 1.9,
  /** Extra HP on milestone bosses, layered on top of their tier mults. */
  bossHpMult: 1.30,
  /** Extra contact + melee damage on milestone bosses, on top of tier mults. */
  bossDamageMult: 1.20,
  /** Elite HP multiplier. Was 3.0. */
  eliteHpMult: 3.5,
  /** Hero starting/max HP multiplier applied to per-champion variant.hp (~-8%). */
  playerHpMult: 0.92,
} as const;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/DifficultyTuning.spec.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/survivors/DifficultyTuning.ts tests/DifficultyTuning.spec.ts
git commit -m "feat(difficulty): central DifficultyTuning constants + invariant tests"
```

---

## Task 2: `Enemy.applyDamageMultiplier`

`EnemyManager` cannot touch `meleeHitDamage` (it's `protected`), so add a public scaler mirroring the existing `applyHealthMultiplier` (Enemy.ts:245). This is Babylon-coupled, so verification is `tsc`, not a unit test.

**Files:**
- Modify: `src/survivors/enemies/Enemy.ts` (after `applyHealthMultiplier`, ~:248)

- [ ] **Step 1: Add the method**

Find (Enemy.ts:245):
```ts
    public applyHealthMultiplier(mult: number): void {
        this.health *= mult;
        this.maxHealth *= mult;
    }
```

Insert immediately after it:
```ts
    /** Scale this enemy's outgoing damage (contact DPS + melee swing + path-end
     *  damage). Mirror of applyHealthMultiplier; used by the global difficulty
     *  multiplier at spawn. */
    public applyDamageMultiplier(mult: number): void {
        this.contactDamagePerSecond *= mult;
        this.meleeHitDamage = Math.round(this.meleeHitDamage * mult);
        this.damage = Math.round(this.damage * mult);
    }
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: exit 0, no output.

- [ ] **Step 3: Commit**

```bash
git add src/survivors/enemies/Enemy.ts
git commit -m "feat(enemy): public applyDamageMultiplier for global difficulty scaling"
```

---

## Task 3: Global enemy difficulty at spawn (EnemyManager)

Apply `enemyHpMult` + `enemyDamageMult` to every spawned enemy except milestone bosses (they take their own boss mults in Task 5). Hooks into the existing per-spawn multiplier chain in `spawnSurvivorsEnemy`, right after `_applyWaveScaling`.

**Files:**
- Modify: `src/survivors/enemies/EnemyManager.ts` (import; new method ~:226; call ~:458)

- [ ] **Step 1: Add the import**

At the top of `EnemyManager.ts`, near the existing `import { makeElite } from './EliteSpawner';` (line 16), add:
```ts
import { DifficultyTuning } from '../DifficultyTuning';
```

- [ ] **Step 2: Add the `_applyGlobalDifficulty` method**

Immediately after the `_applyWaveScaling` method (which ends around line 227, after the `enemy.applyHealthMultiplier(waveMult)` block), add:
```ts
    /** Apply the global difficulty multipliers (tankier + harder-hitting) to a
     *  freshly-constructed enemy. Skips milestone bosses — they derive HP from
     *  tier and take bossHpMult/bossDamageMult in their own constructor. Compounds
     *  on top of elite, orb, and wave-scaling multipliers (intentional). */
    private _applyGlobalDifficulty(enemy: Enemy): void {
        if (enemy instanceof MilestoneBoss) return;
        enemy.applyHealthMultiplier(DifficultyTuning.enemyHpMult);
        enemy.applyDamageMultiplier(DifficultyTuning.enemyDamageMult);
    }
```

(`MilestoneBoss` is already imported in EnemyManager — it is referenced in `_applyWaveScaling`'s `enemy instanceof MilestoneBoss` guard.)

- [ ] **Step 3: Call it in the spawn chain**

In `spawnSurvivorsEnemy`, find the existing call (around line 458):
```ts
        // Per-wave baseline HP + reward scaling (skips milestone bosses, which
        // already derive tier HP from the wave number). Compounds on top of the
        // orb buff and elite scaling.
        this._applyWaveScaling(enemy);
```

Insert immediately after it:
```ts
        // Global difficulty rebalance (DifficultyTuning): tankier + harder-hitting
        // for all non-milestone-boss enemies. Compounds on the above multipliers.
        this._applyGlobalDifficulty(enemy);
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: exit 0, no output.

- [ ] **Step 5: Commit**

```bash
git add src/survivors/enemies/EnemyManager.ts
git commit -m "feat(difficulty): global enemy HP+damage multiplier at spawn"
```

---

## Task 4: Spawn cadence/count + player HP (SurvivorsGameplayState)

Read swarm cadence/count from tuning, and scale per-champion hero HP by `playerHpMult` so both `HeroController` and `PlayerStats` stay consistent.

**Files:**
- Modify: `src/survivors/SurvivorsGameplayState.ts` (import; ~:317 hero HP; ~:366 + ~:376 consume; ~:532 setSurvivorsRates)

- [ ] **Step 1: Add the import**

Near the other survivors imports at the top of `SurvivorsGameplayState.ts`, add:
```ts
import { DifficultyTuning } from './DifficultyTuning';
```

- [ ] **Step 2: Compute scaled hero HP**

Find (line 317):
```ts
        const variant = variants[championType] ?? variants['barbarian'];
```

Insert immediately after it:
```ts
        // Difficulty rebalance: shave hero starting HP (~-8%) so the "more
        // incoming damage" axis bites. Multiplier (not flat) preserves the
        // per-champion HP spread (barb 140 / ranger 90 / mage 80).
        const heroHp = Math.round(variant.hp * DifficultyTuning.playerHpMult);
```

- [ ] **Step 3: Use `heroHp` at both consumers**

Find (line 366, inside the `new HeroController(...)` args):
```ts
            variant.speed,
            variant.hp,
            championType,
```
Replace with:
```ts
            variant.speed,
            heroHp,
            championType,
```

Find (line 376):
```ts
        this.playerStats = new PlayerStats(variant.hp, 100);
```
Replace with:
```ts
        this.playerStats = new PlayerStats(heroHp, 100);
```

- [ ] **Step 4: Read swarm rates from tuning**

Find (line 532):
```ts
        this.waveManager.setSurvivorsRates(2.2, 1.6);
```
Replace with:
```ts
        this.waveManager.setSurvivorsRates(
            DifficultyTuning.spawnRateMult,
            DifficultyTuning.enemyCountMult,
        );
```

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: exit 0, no output.

- [ ] **Step 6: Commit**

```bash
git add src/survivors/SurvivorsGameplayState.ts
git commit -m "feat(difficulty): faster/bigger swarms + ~8% hero HP cut from tuning"
```

---

## Task 5: Milestone boss multipliers (MilestoneBoss.ts)

Layer `bossHpMult` / `bossDamageMult` on top of the existing tier multipliers. WIP file — edit only the four marked lines.

**Files:**
- Modify: `src/survivors/enemies/MilestoneBoss.ts` (import; ~:162-176)

- [ ] **Step 1: Add the import**

Near the top imports of `MilestoneBoss.ts`, add:
```ts
import { DifficultyTuning } from '../DifficultyTuning';
```

- [ ] **Step 2: Fold boss mults into the tier multipliers**

Find (lines 162-163):
```ts
        const hpMult    = tierHpMult(waveTier) * strengthMultiplier;
        const dpsMult   = tierDpsMult(waveTier) * strengthMultiplier;
```
Replace with:
```ts
        const hpMult    = tierHpMult(waveTier) * strengthMultiplier * DifficultyTuning.bossHpMult;
        const dpsMult   = tierDpsMult(waveTier) * strengthMultiplier * DifficultyTuning.bossDamageMult;
```

- [ ] **Step 3: Scale melee hit damage before deriving special-move damage**

`dpsMult` already scales `contactDamagePerSecond` (line 172), but `meleeHitDamage` (the basis for dash/pull damage) is NOT tier-scaled — so apply `bossDamageMult` to it explicitly, *before* the dash/pull derivation.

Find (lines 174-176):
```ts
        // Special-move damage scales with the boss's melee hit damage.
        this.dashSlashDamage = Math.round(this.meleeHitDamage * DASH_SLASH_DAMAGE_FACTOR);
        this.pullSlamDamage  = Math.round(this.meleeHitDamage * PULL_SLAM_DAMAGE_FACTOR);
```
Replace with:
```ts
        // Difficulty rebalance: boss melee (and the dash/pull derived from it)
        // hits harder. Applied before the dash/pull derivation below.
        this.meleeHitDamage = Math.round(this.meleeHitDamage * DifficultyTuning.bossDamageMult);

        // Special-move damage scales with the boss's melee hit damage.
        this.dashSlashDamage = Math.round(this.meleeHitDamage * DASH_SLASH_DAMAGE_FACTOR);
        this.pullSlamDamage  = Math.round(this.meleeHitDamage * PULL_SLAM_DAMAGE_FACTOR);
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: exit 0, no output.

- [ ] **Step 5: Commit**

```bash
git add src/survivors/enemies/MilestoneBoss.ts
git commit -m "feat(difficulty): milestone bosses tankier + harder-hitting"
```

---

## Task 6: Elite HP from tuning (EliteSpawner.ts)

**Files:**
- Modify: `src/survivors/enemies/EliteSpawner.ts` (import; :39)

- [ ] **Step 1: Add the import**

At the top of `EliteSpawner.ts`, after `import { getCachedMaterial } from '../../engine/rendering/MaterialCache';` (line 3), add:
```ts
import { DifficultyTuning } from '../DifficultyTuning';
```

- [ ] **Step 2: Replace the literal**

Find (lines 38-39):
```ts
    // Triple HP
    enemy.applyHealthMultiplier(3);
```
Replace with:
```ts
    // Elite HP multiplier (DifficultyTuning.eliteHpMult).
    enemy.applyHealthMultiplier(DifficultyTuning.eliteHpMult);
```

- [ ] **Step 3: Update the doc comment**

Find (line 16, in the `makeElite` JSDoc):
```ts
 * - 3× HP
```
Replace with:
```ts
 * - eliteHpMult× HP (DifficultyTuning)
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: exit 0, no output.

- [ ] **Step 5: Commit**

```bash
git add src/survivors/enemies/EliteSpawner.ts
git commit -m "feat(difficulty): elite HP multiplier from tuning (3 -> 3.5)"
```

---

## Task 7: Full Part-A verification

- [ ] **Step 1: Type-check the whole project**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 2: Run all unit tests**

Run: `npm test`
Expected: all pass (47 prior + 5 new DifficultyTuning = 52).

- [ ] **Step 3: Production build**

Run: `npm run build`
Expected: webpack completes, no errors, `dist/` updated.

- [ ] **Step 4: Manual playtest checkpoint (human)**

Run: `npm start`, play several waves into the first milestone boss (wave 5).
Confirm: enemies clearly tankier, swarms denser, hits hurt more, gold still keeps up. If any axis over/undershoots, adjust the single number in `DifficultyTuning.ts` and rebuild — no other file changes needed. (No commit unless a number changes.)

---

## Task 8 (Part B): Freeze investigation & fix

> **REQUIRED SUB-SKILL at execution:** Use superpowers:systematic-debugging. This is an investigation — the fix is unknown until the root cause is found. Do NOT pre-commit to a cause; the steps below are the method, not the answer.

**Files:** unknown until diagnosed. Likely candidates from project history: `EnemyManager.ts`, `Enemy.ts`, `Champion.ts`, `MaterialCache.ts`, plus anything the boss-rework WIP touched (`MilestoneBoss.ts`).

- [ ] **Step 1: Reproduce**

Run: `npm start`. Play into the dense swarm + first milestone boss (wave 5). Confirm the freeze/hitch and note WHEN it fires (spawn surge? boss spawn? mass death?). Note: the harder difficulty (more enemies) should make it easier to trigger.

- [ ] **Step 2: Instrument (temporary)**

Add a temporary per-second console log (e.g. in `SurvivorsGameplayState.update` behind a `DEBUG_PERF` flag) printing:
- `scene.meshes.length`, `scene.materials.length`, `scene.textures.length`
- `scene.animatables.length` and `(scene as any)._activeAnimatables?.length`
- the `EnemyManager` live-enemy count
The existing ">50ms spawn" diagnostic in `spawnSurvivorsEnemy` is an additional signal — leave it in place during diagnosis.

- [ ] **Step 3: Find the root cause**

Watch which counter climbs monotonically (leak) or spikes (per-frame cost) when the hitch fires. Identify the exact source before editing. Per project history, prime suspects: per-spawn disposal leaks (die() vs dispose()), the material-cache key leak, cloned-GLB skeleton bone-matrix textures, looping animatables, observer pile-up. Confirm with the instrument — do not assume.

- [ ] **Step 4: Write a guard/regression check where possible**

If the root cause lives in a pure-logic boundary (e.g. a cache key, a cleanup accounting function), add a Vitest test that fails on the leak. If it is purely Babylon-side, document the manual reproduction + the instrument reading that proves it instead.

- [ ] **Step 5: Fix the root cause**

Apply the minimal fix targeting the identified cause.

- [ ] **Step 6: Verify the fix**

Re-run `npm start`, repeat the Step 1 repro. Confirm the instrumented counter is now flat / the spike is gone and the freeze does not occur. Run `npx tsc --noEmit` and `npm test`.

- [ ] **Step 7: Remove temporary instrumentation**

Strip the `DEBUG_PERF` logging added in Step 2 (keep the pre-existing ">50ms spawn" diagnostic only if it was there before this branch). Re-run `npx tsc --noEmit`.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "fix(perf): <root cause> causing frame-time freeze under load"
```

---

## Self-review notes

- **Spec coverage:** all four axes (Tasks 3,4,5,6) + freeze (Task 8) + verification (Task 7). ✓
- **Player-HP deviation** (flat 110 → 0.92 multiplier) recorded in the header. ✓
- **Type consistency:** `applyDamageMultiplier` (Task 2) is the exact method called in Task 3; `DifficultyTuning` field names match across the module (Task 1) and every consumer (Tasks 3–6). ✓
- **Compounding order:** `_applyGlobalDifficulty` runs after elite/orb/wave scaling and excludes `MilestoneBoss`, which is the only enemy that takes boss mults — no double-scaling. ✓
