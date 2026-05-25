# Milestone Bosses & Run Items Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add milestone bosses with lunge/dash AI on every 5th survivors-mode wave, dropping unique permanent run items (lifesteal, multishot/cleave, knockback, attack-speed) the first time waves 5/10/15/20 are cleared.

**Architecture:** Adds a `MilestoneBoss` subclass of `BossEnemy` (tier-scaled stats + lunge/dash state machine), a `RunItems` module that tracks per-item stacks and applies effects by writing into new `PlayerStats` fields, a new `ItemDrop` entity styled like `PowerDrop` for the gem pickups, and wiring in `EnemyManager` / `SurvivorsGameplayState` / `HeroBasicAttack` / `HeroHud`. Item effects are *read each tick* from `PlayerStats` so the shop and the run items share one source of truth.

**Tech Stack:** BabylonJS + TypeScript, webpack build, no test framework.

**Verification model (no test suite):** Every code-change step in this plan is verified by `npx tsc --noEmit` (catches type errors) and `npm run build` (catches webpack/import errors). Behavior verification is by manual playtest in `npm start` after the wiring tasks (Task 9 onward). The plan calls out which task needs a playtest and what to look for.

**Spec:** `docs/superpowers/specs/2026-05-25-milestone-bosses-and-items-design.md`

---

## File Structure

**New files:**
- `src/game/gameplay/enemies/MilestoneBoss.ts` — extends `BossEnemy`. Adds tier-scaled HP/speed/damage, the lunge/dash state machine, telegraph + dash-trail visuals, the enrage trigger, and overrides `applyKnockback` to reduce incoming knockback to 30 %. Exposes `public readonly isMilestone = true`.
- `src/game/gameplay/RunItems.ts` — owns the per-item stack counts, exposes `hasItem`, `getStacks`, `grant`. `grant(id)` increments the stack and writes the updated effect value into `PlayerStats`. Holds references to `PlayerStats`, `championType`, and the `HeroController` (so the attack-speed item can re-publish `basicAttackSpeedMultiplier` via the existing `heroController.updateAttackSpeed(...)` pipe, which is the same path the shop uses).
- `src/game/gameplay/ItemDrop.ts` — gem pickup entity styled on `PowerDrop` (faceted icosahedron with an emissive pillar of light). Hovers, magnetises toward the hero, fires `onPickup(itemId)` on contact.

**Modified files:**
- `src/game/gameplay/PlayerStats.ts` — add 3 new public fields.
- `src/game/gameplay/enemies/Enemy.ts` — add `applyKnockback(dirX, dirZ, magnitude)`.
- `src/game/gameplay/enemies/BossEnemy.ts` — override `applyKnockback` to apply 30 % of incoming magnitude.
- `src/game/gameplay/WaveManager.ts` — add `getCurrentWave()` getter.
- `src/game/gameplay/EnemyManager.ts` — route `spawnSurvivorsEnemy('boss', …)` to `MilestoneBoss` on milestone waves, add `setOnMilestoneBossDeath` callback, fire it on death.
- `src/game/gameplay/HeroBasicAttack.ts` — accept a `PlayerStats` reference, apply lifesteal & knockback in both attack paths, fire a multishot fan in projectile mode, queue follow-up spins in melee mode.
- `src/game/gameplay/HeroController.ts` — add `setPlayerStats(stats)` delegator that pushes stats into the inner `HeroBasicAttack` (the attack instance is private to the controller, so all external wiring goes through this method).
- `src/game/states/SurvivorsGameplayState.ts` — construct `RunItems`, pass `PlayerStats` to `HeroBasicAttack`, register the boss-death → item-drop pipeline, give `HeroHud` a `RunItems` reference, fire `pulseItem` on pickup.
- `src/game/ui/HeroHud.ts` — 4-slot items row above the power-slot row, pulse animation on pickup.

---

## Task 1: Add new PlayerStats fields

These fields hold the live values that `HeroBasicAttack` reads each tick. Defaults match no-op behavior so existing gameplay is unchanged.

**Files:**
- Modify: `src/game/gameplay/PlayerStats.ts`

- [ ] **Step 1: Add fields next to the existing run multipliers**

In `src/game/gameplay/PlayerStats.ts`, find the comment block `// ── Survivors-mode hero stats ───────────────────────────────────────────` (around line 52) and the existing `basicAttackSpeedMultiplier` declaration. Immediately after `basicAttackSpeedMultiplier` (around line 66), add:

```ts
    /** Fraction of damage dealt that is healed back to the hero (lifesteal item). */
    public lifestealPct: number = 0;
    /** For ranged classes: extra projectiles per basic attack. For barbarian: extra follow-up spins. */
    public extraAttacks: number = 0;
    /** World units pushed radially away from the hero on each basic-attack hit. */
    public knockbackOnHit: number = 0;
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/game/gameplay/PlayerStats.ts
git commit -m "feat(stats): add lifesteal, extraAttacks, knockbackOnHit run fields

Defaults preserve existing behavior. Fields are read live by
HeroBasicAttack once the RunItems system is wired up."
```

---

## Task 2: Add Enemy.applyKnockback and BossEnemy override

Base implementation: nudges `position` and skips when CC-immune (freeze/stun). Boss override reduces magnitude to 30 % so knockback can't trivialize a milestone fight.

**Files:**
- Modify: `src/game/gameplay/enemies/Enemy.ts`
- Modify: `src/game/gameplay/enemies/BossEnemy.ts`

- [ ] **Step 1: Add `applyKnockback` to the base Enemy class**

In `src/game/gameplay/enemies/Enemy.ts`, just before the closing `}` of the class (around line 1048, after `extendPath`), add:

```ts
    /**
     * Push this enemy radially by `magnitude` world units in the given normalized
     * direction. No-op if the enemy is frozen or stunned (CC-immune window).
     * Boss subclasses may override to apply a fraction of the requested magnitude.
     *
     * Note: this only mutates `this.position` — the next seek-target frame will
     * pull the enemy back toward the hero, so the push is naturally bounded and
     * the enemy does not need to clamp itself to the arena radius.
     */
    public applyKnockback(dirX: number, dirZ: number, magnitude: number): void {
        if (!this.alive) return;
        if (this.isFrozen || this.isStunned) return;
        this.position.x += dirX * magnitude;
        this.position.z += dirZ * magnitude;
        if (this.mesh && !this.mesh.isDisposed()) {
            this.mesh.position.copyFrom(this.position);
        }
    }
```

- [ ] **Step 2: Override `applyKnockback` on `BossEnemy`**

In `src/game/gameplay/enemies/BossEnemy.ts`, just before the closing `}` of the class (after `applyDifficultyMultiplier`, around line 502), add:

```ts
    /**
     * Bosses receive only 30% of incoming knockback so they remain threatening
     * even when the hero has multiple knockback stacks.
     */
    public applyKnockback(dirX: number, dirZ: number, magnitude: number): void {
        super.applyKnockback(dirX, dirZ, magnitude * 0.3);
    }
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add src/game/gameplay/enemies/Enemy.ts src/game/gameplay/enemies/BossEnemy.ts
git commit -m "feat(enemy): add applyKnockback with 30% boss reduction

Base implementation respects CC-immunity windows. Boss override
keeps milestone fights meaningful when the hero stacks knockback."
```

---

## Task 3: RunItems module

Owns per-item stacks. `grant(id)` increments the stack and recomputes the effect's value into `PlayerStats`. Branches on `championType` for the multishot/cleave item.

**Files:**
- Create: `src/game/gameplay/RunItems.ts`

- [ ] **Step 1: Create the new file**

Create `src/game/gameplay/RunItems.ts` with the full contents below:

```ts
import { PlayerStats } from './PlayerStats';
import { HeroController } from './HeroController';

/** Identifiers for the four milestone-boss items. */
export type ItemId = 'lifesteal' | 'multishotCleave' | 'knockback' | 'attackSpeed';

/** Which item drops at which boss tier (waveNumber / 5). Missing tiers drop nothing. */
const ITEM_BY_TIER: Record<number, ItemId> = {
    1: 'lifesteal',        // wave 5
    2: 'multishotCleave',  // wave 10
    3: 'knockback',        // wave 15
    4: 'attackSpeed',      // wave 20
};

/** Per-stack tuning constants — see spec for rationale. Adjust here, not at call sites. */
const LIFESTEAL_PCT_PER_STACK   = 0.05; // 5% of damage healed per stack
const KNOCKBACK_UNITS_PER_STACK = 1.0;  // world units pushed per hit per stack
const ATTACK_SPEED_FACTOR       = 2.0;  // multiplier applied once per stack

export class RunItems {
    private stacks: Record<ItemId, number> = {
        lifesteal: 0,
        multishotCleave: 0,
        knockback: 0,
        attackSpeed: 0,
    };

    constructor(
        private readonly stats: PlayerStats,
        private readonly championType: string,
        private readonly heroController: HeroController,
    ) {}

    public hasItem(id: ItemId): boolean {
        return this.stacks[id] > 0;
    }

    public getStacks(id: ItemId): number {
        return this.stacks[id];
    }

    /** Look up the item awarded at a given boss tier, or null if none. */
    public static itemForTier(tier: number): ItemId | null {
        return ITEM_BY_TIER[tier] ?? null;
    }

    /**
     * Increment the stack for an item and re-apply its effect. Safe to call
     * repeatedly; PlayerStats fields are recomputed from the new stack count.
     */
    public grant(id: ItemId): void {
        this.stacks[id]++;
        this.applyEffect(id);
    }

    private applyEffect(id: ItemId): void {
        const n = this.stacks[id];
        switch (id) {
            case 'lifesteal':
                this.stats.lifestealPct = LIFESTEAL_PCT_PER_STACK * n;
                return;

            case 'multishotCleave':
                // Same field for both classes; HeroBasicAttack interprets it based on attack mode.
                this.stats.extraAttacks = n;
                return;

            case 'knockback':
                this.stats.knockbackOnHit = KNOCKBACK_UNITS_PER_STACK * n;
                return;

            case 'attackSpeed':
                // Multiplicative composition with the shop's Quickness item (which also writes
                // basicAttackSpeedMultiplier and pushes through heroController.updateAttackSpeed).
                // On grant we multiply by the per-stack factor and re-publish; subsequent grants
                // compound naturally.
                this.stats.basicAttackSpeedMultiplier *= ATTACK_SPEED_FACTOR;
                this.heroController.updateAttackSpeed(this.stats.basicAttackSpeedMultiplier);
                return;
        }
    }
}
```

The `championType` field is held but not used directly in this file — `HeroBasicAttack` already branches on attack `mode` (`'projectile'` vs `'melee'`) when consuming `extraAttacks`, which is the same split. The constructor accepts `championType` so future per-class item logic (e.g. cleave-as-AOE variants) has a single place to read it.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: zero errors. (`championType` is accepted as a plain string because the file does not yet branch on it — that branching lives inside `HeroBasicAttack` via the unified `extraAttacks` field, which is the entire reason the module is small.)

- [ ] **Step 3: Commit**

```bash
git add src/game/gameplay/RunItems.ts
git commit -m "feat(items): add RunItems stack tracker and item-tier mapping

Grants increment per-item stacks and re-publish the effect value
to PlayerStats. ItemId is the single source of truth for the four
milestone items. ITEM_BY_TIER lives next to grant() so the wave-5/
10/15/20 mapping is easy to find and re-tune."
```

---

## Task 4: HeroBasicAttack — wire lifesteal & knockback (and HeroController delegator)

Accept a `PlayerStats` reference. In both melee and projectile damage paths, heal the hero by `damage * lifestealPct` and push the enemy by `knockbackOnHit`. Also add a `setPlayerStats` delegator on `HeroController` so external wiring can reach the inner basic attack.

**Files:**
- Modify: `src/game/gameplay/HeroBasicAttack.ts`
- Modify: `src/game/gameplay/HeroController.ts`

- [ ] **Step 1: Import PlayerStats and add a reference field**

In `src/game/gameplay/HeroBasicAttack.ts`, change the top of the file. Replace this import (around line 5):

```ts
import { Enemy } from './enemies/Enemy';
```

with:

```ts
import { Enemy } from './enemies/Enemy';
import { PlayerStats } from './PlayerStats';
```

Then, in the class field declarations (around line 35, after `private powerSlots: PowerSlotManager | null = null;`), add:

```ts
    private playerStats: PlayerStats | null = null;
```

- [ ] **Step 2: Add the `setPlayerStats` setter**

In the same file, just after the existing `setPowerSlots` method (around line 67), add:

```ts
    /** Wire up player stats so run-item effects (lifesteal, knockback, multishot, multi-spin) apply. */
    public setPlayerStats(stats: PlayerStats): void {
        this.playerStats = stats;
    }
```

- [ ] **Step 3: Apply lifesteal & knockback in the melee swing**

In `performMeleeSwing()`, locate this block (around line 119-128):

```ts
        for (const e of enemies) {
            if (!e.isAlive()) continue;
            const dx = e.getPosition().x - heroPos.x;
            const dz = e.getPosition().z - heroPos.z;
            if (Math.hypot(dx, dz) <= range) {
                e.takeDamage(this.damage);
                hitEnemies.push(e);
                this.applyEnchantments(e, heroPos, enemies);
            }
        }
```

Replace it with:

```ts
        const lifestealPct = this.playerStats?.lifestealPct ?? 0;
        const knockback    = this.playerStats?.knockbackOnHit ?? 0;
        for (const e of enemies) {
            if (!e.isAlive()) continue;
            const dx = e.getPosition().x - heroPos.x;
            const dz = e.getPosition().z - heroPos.z;
            const horizDist = Math.hypot(dx, dz);
            if (horizDist <= range) {
                e.takeDamage(this.damage);
                if (lifestealPct > 0 && this.playerStats) {
                    this.playerStats.heal(this.damage * lifestealPct);
                }
                if (knockback > 0 && horizDist > 0.001) {
                    // Direction: from hero outward toward the enemy.
                    e.applyKnockback(dx / horizDist, dz / horizDist, knockback);
                }
                hitEnemies.push(e);
                this.applyEnchantments(e, heroPos, enemies);
            }
        }
```

- [ ] **Step 4: Apply lifesteal & knockback on projectile impact**

In `spawnProjectile()`, locate the impact branch (around line 287-303):

```ts
            if (dist < 0.4) {
                target.takeDamage(capturedDamage);
                // Apply enchantments on projectile hit
                if (this.powerSlots) {
                    const enemyHit = allEnemies.find(e => {
                        const ep = e.getPosition();
                        const dx = ep.x - target.position.x;
                        const dz = ep.z - target.position.z;
                        return Math.hypot(dx, dz) < 0.5 && e.isAlive();
                    });
                    if (enemyHit) {
                        this.applyEnchantments(enemyHit, heroPos, allEnemies);
                    }
                }
                releaseProjectile(poolKey, proj);
                this.scene.onBeforeRenderObservable.remove(observer);
                return;
            }
```

Replace it with:

```ts
            if (dist < 0.4) {
                target.takeDamage(capturedDamage);
                if (this.playerStats) {
                    if (this.playerStats.lifestealPct > 0) {
                        this.playerStats.heal(capturedDamage * this.playerStats.lifestealPct);
                    }
                }
                // Apply enchantments AND knockback on projectile hit — look up the actual
                // Enemy instance behind the BasicAttackTarget so we have applyKnockback.
                const enemyHit = allEnemies.find(e => {
                    const ep = e.getPosition();
                    const dx = ep.x - target.position.x;
                    const dz = ep.z - target.position.z;
                    return Math.hypot(dx, dz) < 0.5 && e.isAlive();
                });
                if (enemyHit) {
                    const knockback = this.playerStats?.knockbackOnHit ?? 0;
                    if (knockback > 0) {
                        // Direction: hero → impact point (matches projectile travel direction).
                        const tx = target.position.x - heroPos.x;
                        const tz = target.position.z - heroPos.z;
                        const tlen = Math.hypot(tx, tz);
                        if (tlen > 0.001) {
                            enemyHit.applyKnockback(tx / tlen, tz / tlen, knockback);
                        }
                    }
                    if (this.powerSlots) {
                        this.applyEnchantments(enemyHit, heroPos, allEnemies);
                    }
                }
                releaseProjectile(poolKey, proj);
                this.scene.onBeforeRenderObservable.remove(observer);
                return;
            }
```

- [ ] **Step 5: Add `setPlayerStats` delegator on HeroController**

The `HeroBasicAttack` is a private field of `HeroController`. External code wires player stats by going through the controller. In `src/game/gameplay/HeroController.ts`, find the existing `updateAttackSpeed(multiplier)` method (around line 254). Just before or after it, add:

```ts
    /** Push player-stats reference into the inner basic-attack instance (used by RunItems wiring). */
    public setPlayerStats(stats: PlayerStats): void {
        this.basicAttack?.setPlayerStats(stats);
    }
```

If `PlayerStats` isn't already imported in `HeroController.ts`, add this import at the top (alongside the other gameplay imports):

```ts
import { PlayerStats } from './PlayerStats';
```

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 7: Commit**

```bash
git add src/game/gameplay/HeroBasicAttack.ts src/game/gameplay/HeroController.ts
git commit -m "feat(hero): wire lifesteal and knockback into basic attacks

Both melee and projectile damage paths now read PlayerStats fields
each tick and heal / push accordingly. Defaults of 0 mean no
behavior change until RunItems grants the relevant item. Adds a
HeroController.setPlayerStats delegator so external wiring reaches
the controller-owned basic-attack instance."
```

---

## Task 5: HeroBasicAttack — projectile multishot fan

When `extraAttacks > 0` and mode is projectile, fire `1 + extraAttacks` projectiles spread evenly over a 20° fan.

**Files:**
- Modify: `src/game/gameplay/HeroBasicAttack.ts`

- [ ] **Step 1: Refactor the firing call site to spawn N projectiles**

In `update(dt)` (around line 90-108), locate the projectile branch:

```ts
        } else {
            const target = this.targetProvider();
            if (!target || !target.isAlive()) return;

            const heroPos = this.getHeroPosition();
            const dist = Vector3.Distance(heroPos, target.position);
            if (dist > this.effectiveRange) return;

            this.spawnProjectile(heroPos.clone(), target);
            this.cooldown = this.effectiveInterval;
        }
```

Replace it with:

```ts
        } else {
            const target = this.targetProvider();
            if (!target || !target.isAlive()) return;

            const heroPos = this.getHeroPosition();
            const dist = Vector3.Distance(heroPos, target.position);
            if (dist > this.effectiveRange) return;

            const extras = this.playerStats?.extraAttacks ?? 0;
            const total  = 1 + extras;
            if (total === 1) {
                this.spawnProjectile(heroPos.clone(), target);
            } else {
                // Total fan spread is 20°. Angles distributed evenly from -10° to +10°
                // (e.g. 2 projectiles → -5° / +5°; 3 → -10° / 0° / +10°).
                const totalSpreadRad = (20 * Math.PI) / 180;
                const step = total > 1 ? totalSpreadRad / (total - 1) : 0;
                const start = -totalSpreadRad / 2;
                for (let i = 0; i < total; i++) {
                    const angle = start + step * i;
                    this.spawnProjectileAtAngle(heroPos.clone(), target, angle);
                }
            }
            this.cooldown = this.effectiveInterval;
        }
```

- [ ] **Step 2: Add `spawnProjectileAtAngle` next to `spawnProjectile`**

In `src/game/gameplay/HeroBasicAttack.ts`, just before the existing `spawnProjectile` method (around line 238), add a thin wrapper that rotates the target offset by the given angle and synthesizes a virtual target for the side projectiles:

```ts
    /**
     * Fan-variant of spawnProjectile: rotates the launch direction by `angleRad`
     * around the vertical axis. Center projectile (angle = 0) is identical to
     * a normal spawnProjectile call. Off-center projectiles fly straight in the
     * rotated direction at the same speed; if they hit the original target
     * along the way (the target's tracking is preserved by spawnProjectile),
     * they still apply damage. Off-center projectiles miss the target most of
     * the time — they exist primarily to make the fan readable and to clear
     * out adjacent enemies.
     */
    private spawnProjectileAtAngle(from: Vector3, target: BasicAttackTarget, angleRad: number): void {
        if (angleRad === 0) {
            this.spawnProjectile(from, target);
            return;
        }
        // Build a virtual target offset by rotating the (target - from) vector by angleRad.
        const dx = target.position.x - from.x;
        const dz = target.position.z - from.z;
        const cos = Math.cos(angleRad);
        const sin = Math.sin(angleRad);
        const rotX = dx * cos - dz * sin;
        const rotZ = dx * sin + dz * cos;
        // Extend the rotated direction out to the same length so the projectile travels.
        const virtualTargetPos = new Vector3(from.x + rotX, target.position.y, from.z + rotZ);
        const virtualTarget: BasicAttackTarget = {
            position: virtualTargetPos,
            takeDamage: (amount: number) => target.takeDamage(amount),
            isAlive: () => target.isAlive(),
        };
        this.spawnProjectile(from, virtualTarget);
    }
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add src/game/gameplay/HeroBasicAttack.ts
git commit -m "feat(hero): projectile fan when extraAttacks > 0

Ranger/Mage with the multishotCleave item fire 1+extraAttacks
projectiles in a 20° fan. Center shot tracks the target; side
shots fly straight in the rotated launch direction."
```

---

## Task 6: HeroBasicAttack — melee multi-spin queue

When `extraAttacks > 0` and mode is melee, queue that many follow-up swings spaced 0.15 s apart. Follow-ups run the full `performMeleeSwing()` pipeline so they fire knockback/lifesteal/enchantments too.

**Files:**
- Modify: `src/game/gameplay/HeroBasicAttack.ts`

- [ ] **Step 1: Add queue fields and the spacing constant**

In `src/game/gameplay/HeroBasicAttack.ts`, near the top (just above the `HeroBasicAttack` class declaration, around line 22), add:

```ts
/** Delay between the main melee swing and each queued follow-up spin. */
const EXTRA_SPIN_DELAY = 0.15;
```

Then in the class field declarations (around line 36), add after the existing fields:

```ts
    private queuedSwings: number = 0;
    private queuedSpinTimer: number = 0;
```

- [ ] **Step 2: Tick the queue at the top of `update()`, before the cooldown gate**

Locate `public update(deltaTime: number): void` (around line 90). Replace the entire method body with:

```ts
    public update(deltaTime: number): void {
        // Queued follow-up swings (barbarian extraAttacks) bypass the normal cooldown gate
        // so they fire at the chosen cadence regardless of the base attack interval.
        if (this.queuedSwings > 0) {
            this.queuedSpinTimer -= deltaTime;
            if (this.queuedSpinTimer <= 0) {
                this.performMeleeSwing();
                this.queuedSwings--;
                this.queuedSpinTimer = EXTRA_SPIN_DELAY;
            }
        }

        this.cooldown -= deltaTime;
        if (this.cooldown > 0) return;

        if (this.mode === 'melee') {
            this.performMeleeSwing();
            // After the main swing, queue any extra spins from RunItems.
            const extras = this.playerStats?.extraAttacks ?? 0;
            if (extras > 0) {
                this.queuedSwings = extras;
                this.queuedSpinTimer = EXTRA_SPIN_DELAY;
            }
            this.cooldown = this.effectiveInterval;
        } else {
            const target = this.targetProvider();
            if (!target || !target.isAlive()) return;

            const heroPos = this.getHeroPosition();
            const dist = Vector3.Distance(heroPos, target.position);
            if (dist > this.effectiveRange) return;

            const extras = this.playerStats?.extraAttacks ?? 0;
            const total  = 1 + extras;
            if (total === 1) {
                this.spawnProjectile(heroPos.clone(), target);
            } else {
                const totalSpreadRad = (20 * Math.PI) / 180;
                const step = total > 1 ? totalSpreadRad / (total - 1) : 0;
                const start = -totalSpreadRad / 2;
                for (let i = 0; i < total; i++) {
                    const angle = start + step * i;
                    this.spawnProjectileAtAngle(heroPos.clone(), target, angle);
                }
            }
            this.cooldown = this.effectiveInterval;
        }
    }
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add src/game/gameplay/HeroBasicAttack.ts
git commit -m "feat(hero): melee follow-up spin queue when extraAttacks > 0

After the main swing, queue extraAttacks follow-up calls to
performMeleeSwing() at 0.15s spacing. Queue ticks bypass the
cooldown gate so the spacing is honored. Follow-ups re-enter
the full swing pipeline so lifesteal, knockback, and the
sword-arc visual all fire again."
```

---

## Task 7: WaveManager getter + MilestoneBoss class

`getCurrentWave()` is a one-line getter. `MilestoneBoss` is the bigger piece — tier-scaled stats, the lunge/dash state machine, telegraph visual, enrage, and the knockback override.

**Files:**
- Modify: `src/game/gameplay/WaveManager.ts`
- Create: `src/game/gameplay/enemies/MilestoneBoss.ts`

- [ ] **Step 1: Add `getCurrentWave()` to WaveManager**

In `src/game/gameplay/WaveManager.ts`, locate the existing `private currentWave: number = 0;` field (around line 128). Just below the existing constructor section (find a logical place near the other getters), add:

```ts
    /** Current wave number (1-based after the first wave has started). 0 before any wave runs. */
    public getCurrentWave(): number {
        return this.currentWave;
    }
```

If the file already has a `getCurrentWave` (it may not; search before adding), do nothing. If a `currentWave()` exists with different casing/return type, leave it and use the existing one in the EnemyManager change in Task 8.

- [ ] **Step 2: Create the MilestoneBoss class file**

Create `src/game/gameplay/enemies/MilestoneBoss.ts` with the full contents below:

```ts
import { Vector3, MeshBuilder, StandardMaterial, Color3, Mesh } from '@babylonjs/core';
import { Game } from '../../Game';
import { BossEnemy } from './BossEnemy';

/** Public tag the EnemyManager checks on death to fire the item-drop hook. */
type Tier = 1 | 2 | 3 | 4 | 5;

/** Lunge/dash state machine. */
type LungeState = 'walking' | 'telegraph' | 'dashing' | 'recover';

/** Per-tier stat multipliers applied on top of BossEnemy base stats. */
const TIER_HP_MULT:    Record<number, number> = { 1: 1.8, 2: 2.6, 3: 3.4, 4: 4.4 };
const TIER_SPEED_MULT: Record<number, number> = { 1: 1.4, 2: 1.5, 3: 1.6, 4: 1.7 };
const TIER_DPS_MULT:   Record<number, number> = { 1: 1.0, 2: 1.1, 3: 1.2, 4: 1.3 };

/** Tier 5+ HP: 4.4 + 0.6 × (tier − 4). Speed and DPS clamp at tier-4 values. */
function tierHpMult(tier: number): number {
    return tier <= 4 ? TIER_HP_MULT[tier] : 4.4 + 0.6 * (tier - 4);
}
function tierSpeedMult(tier: number): number { return TIER_SPEED_MULT[tier] ?? 1.7; }
function tierDpsMult(tier: number): number   { return TIER_DPS_MULT[tier]   ?? 1.3; }

/** Lunge cadence per tier (seconds between lunges). Faster at higher tiers. */
const LUNGE_COOLDOWN_BY_TIER: Record<number, number> = { 1: 4.0, 2: 3.5, 3: 3.0, 4: 2.4 };
function lungeCooldown(tier: number): number {
    return LUNGE_COOLDOWN_BY_TIER[tier] ?? 2.4;
}

/** Tier 2+ leads the hero by predicting their movement. */
function hasSidestepPredict(tier: number): boolean { return tier >= 2; }
/** Tier 3+ enrages below 30% HP. */
function hasEnrage(tier: number): boolean { return tier >= 3; }

const TELEGRAPH_DURATION = 0.6;  // seconds rooted before the dash
const DASH_DURATION      = 0.5;  // seconds of dash motion (≈6 units at 12 u/s)
const DASH_DISTANCE      = 6.0;  // world units travelled per dash
const DASH_SPEED         = 12.0; // world units per second during dash
const RECOVER_DURATION   = 0.4;  // seconds rooted after the dash
const PREDICT_LEAD_TIME  = 0.4;  // seconds of hero velocity to lead by on tier 2+
const ENRAGE_HP_FRACTION = 0.30; // triggers enrage when HP drops below this
const ENRAGE_SPEED_BUMP  = 1.4;  // one-shot speed multiplier on enrage
const ENRAGE_LUNGE_FACTOR= 0.5;  // halves the lunge cooldown on enrage

export class MilestoneBoss extends BossEnemy {
    /** Public so EnemyManager can check it on death without instanceof. */
    public readonly isMilestone: boolean = true;
    /** Public so the item-drop handler can pick the right item for this kill. */
    public readonly waveTier: number;

    private lungeState: LungeState = 'walking';
    private stateTimer: number = 0;
    private lungeTimer: number;
    private dashDirX: number = 0;
    private dashDirZ: number = 0;
    private dashDistanceRemaining: number = 0;
    private enraged: boolean = false;

    // Hero velocity tracking for sidestep predict (tier 2+)
    private lastHeroPos: Vector3 | null = null;
    private heroVelX: number = 0;
    private heroVelZ: number = 0;

    // Telegraph visual — disposed when state leaves 'telegraph'
    private telegraphRing: Mesh | null = null;

    constructor(game: Game, position: Vector3, path: Vector3[], waveTier: number) {
        super(game, position, path);
        this.waveTier = waveTier;
        this.lungeTimer = lungeCooldown(waveTier);

        // Apply tier-scaled stat multipliers on top of the base BossEnemy stats.
        const hpMult    = tierHpMult(waveTier);
        const speedMult = tierSpeedMult(waveTier);
        const dpsMult   = tierDpsMult(waveTier);

        // BossEnemy constructor already set maxHealth=500 and contactDamagePerSecond=30.
        this.maxHealth = Math.floor(this.maxHealth * hpMult);
        this.health    = this.maxHealth;
        this.speed     = this.speed * speedMult;
        this.originalSpeed = this.originalSpeed * speedMult;
        this.contactDamagePerSecond = this.contactDamagePerSecond * dpsMult;

        this.updateHealthBar();
    }

    public update(deltaTime: number): boolean {
        if (!this.alive || !this.mesh) return false;

        this.updateHeroVelocity(deltaTime);
        this.tickLungeStateMachine(deltaTime);
        this.maybeEnrage();

        // While dashing, we override the seek behavior to travel in the locked direction.
        // Otherwise BossEnemy.update handles the normal seek + status + animation.
        if (this.lungeState === 'dashing') {
            this.advanceDash(deltaTime);
            // Skip the parent's seek by clearing seekTarget for this frame — restore after.
            const savedSeek = this.seekTarget;
            this.seekTarget = null;
            const result = super.update(deltaTime);
            this.seekTarget = savedSeek;
            return result;
        }

        if (this.lungeState === 'telegraph' || this.lungeState === 'recover') {
            // Rooted: zero speed for this frame. Parent still ticks animation/status.
            const savedSpeed = this.speed;
            this.speed = 0;
            const result = super.update(deltaTime);
            this.speed = savedSpeed;
            return result;
        }

        return super.update(deltaTime);
    }

    private updateHeroVelocity(deltaTime: number): void {
        if (!this.seekTarget || deltaTime <= 0) {
            this.heroVelX = 0;
            this.heroVelZ = 0;
            return;
        }
        const heroPos = this.seekTarget.getPosition();
        if (this.lastHeroPos) {
            this.heroVelX = (heroPos.x - this.lastHeroPos.x) / deltaTime;
            this.heroVelZ = (heroPos.z - this.lastHeroPos.z) / deltaTime;
        }
        this.lastHeroPos = heroPos.clone();
    }

    private tickLungeStateMachine(deltaTime: number): void {
        switch (this.lungeState) {
            case 'walking':
                this.lungeTimer -= deltaTime;
                if (this.lungeTimer <= 0 && this.seekTarget) {
                    this.enterTelegraph();
                }
                return;

            case 'telegraph':
                this.stateTimer -= deltaTime;
                if (this.stateTimer <= 0) {
                    this.enterDash();
                }
                return;

            case 'dashing':
                this.stateTimer -= deltaTime;
                // Also exit if we've travelled the full dash distance.
                if (this.stateTimer <= 0 || this.dashDistanceRemaining <= 0) {
                    this.enterRecover();
                }
                return;

            case 'recover':
                this.stateTimer -= deltaTime;
                if (this.stateTimer <= 0) {
                    this.enterWalking();
                }
                return;
        }
    }

    private enterTelegraph(): void {
        if (!this.seekTarget) return;
        const heroPos = this.seekTarget.getPosition();

        // Tier 2+ leads the hero by their current velocity over PREDICT_LEAD_TIME.
        let aimX = heroPos.x;
        let aimZ = heroPos.z;
        if (hasSidestepPredict(this.waveTier)) {
            aimX += this.heroVelX * PREDICT_LEAD_TIME;
            aimZ += this.heroVelZ * PREDICT_LEAD_TIME;
        }

        const dx = aimX - this.position.x;
        const dz = aimZ - this.position.z;
        const len = Math.hypot(dx, dz);
        if (len < 0.001) {
            // Hero is on top of us — skip and reset cooldown.
            this.enterWalking();
            return;
        }
        this.dashDirX = dx / len;
        this.dashDirZ = dz / len;
        this.dashDistanceRemaining = DASH_DISTANCE;
        this.lungeState = 'telegraph';
        this.stateTimer = TELEGRAPH_DURATION;

        this.spawnTelegraphRing();
    }

    private enterDash(): void {
        this.disposeTelegraphRing();
        this.lungeState = 'dashing';
        this.stateTimer = DASH_DURATION;
    }

    private enterRecover(): void {
        this.disposeTelegraphRing();
        this.lungeState = 'recover';
        this.stateTimer = RECOVER_DURATION;
    }

    private enterWalking(): void {
        this.disposeTelegraphRing();
        this.lungeState = 'walking';
        const baseCd = lungeCooldown(this.waveTier);
        this.lungeTimer = this.enraged ? baseCd * ENRAGE_LUNGE_FACTOR : baseCd;
    }

    private advanceDash(deltaTime: number): void {
        const step = Math.min(this.dashDistanceRemaining, DASH_SPEED * deltaTime);
        this.position.x += this.dashDirX * step;
        this.position.z += this.dashDirZ * step;
        this.dashDistanceRemaining -= step;
        if (this.mesh && !this.mesh.isDisposed()) {
            this.mesh.position.copyFrom(this.position);
            this.mesh.position.y = this.position.y + 1.2;
            // Face dash direction.
            this.mesh.rotation.y = -Math.atan2(this.dashDirZ, this.dashDirX) + Math.PI / 2;
        }
    }

    private maybeEnrage(): void {
        if (this.enraged || !hasEnrage(this.waveTier)) return;
        if (this.health / this.maxHealth > ENRAGE_HP_FRACTION) return;

        this.enraged = true;
        this.speed *= ENRAGE_SPEED_BUMP;
        this.originalSpeed *= ENRAGE_SPEED_BUMP;

        // Trim the in-flight lunge cooldown by the enrage factor so the speed-up is immediate.
        if (this.lungeState === 'walking') {
            this.lungeTimer *= ENRAGE_LUNGE_FACTOR;
        }
    }

    /** Draws a red ground ring pointing in the locked dash direction during the telegraph phase. */
    private spawnTelegraphRing(): void {
        this.disposeTelegraphRing();

        // A thin elongated rectangle on the ground pointing in the dash direction.
        const length = DASH_DISTANCE;
        const ring = MeshBuilder.CreatePlane('mbossTelegraph', { width: 1.4, height: length }, this.scene);
        ring.rotation.x = Math.PI / 2;                           // flat on ground
        ring.rotation.y = -Math.atan2(this.dashDirZ, this.dashDirX) + Math.PI / 2;
        // Pivot so it extends FORWARD from the boss in the dash direction.
        ring.position.x = this.position.x + this.dashDirX * (length / 2);
        ring.position.z = this.position.z + this.dashDirZ * (length / 2);
        ring.position.y = 0.05;

        const mat = new StandardMaterial('mbossTelegraphMat', this.scene);
        mat.emissiveColor = new Color3(1, 0.1, 0.1);
        mat.diffuseColor  = new Color3(0, 0, 0);
        mat.specularColor = Color3.Black();
        mat.alpha = 0.55;
        ring.material = mat;

        this.telegraphRing = ring;
    }

    private disposeTelegraphRing(): void {
        if (this.telegraphRing && !this.telegraphRing.isDisposed()) {
            this.telegraphRing.dispose();
        }
        this.telegraphRing = null;
    }

    /** Override to keep the 30% knockback reduction from BossEnemy (same behavior). */
    public applyKnockback(dirX: number, dirZ: number, magnitude: number): void {
        // BossEnemy already reduces to 30%; defer to it.
        super.applyKnockback(dirX, dirZ, magnitude);
    }

    /** Dispose owned visuals not parented to mesh. */
    public dispose(): void {
        this.disposeTelegraphRing();
        super.dispose();
    }

    protected die(): void {
        this.disposeTelegraphRing();
        super.die();
    }
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add src/game/gameplay/WaveManager.ts src/game/gameplay/enemies/MilestoneBoss.ts
git commit -m "feat(boss): add MilestoneBoss with lunge/dash AI and tier scaling

Subclass of BossEnemy. Constructor multiplies HP/speed/contact-DPS
by per-tier factors. update() runs a 4-state lunge machine:
walking → telegraph (0.6s) → dashing (~0.5s, 6u) → recover (0.4s).
Tier 2+ leads the hero by their velocity for sidestep prediction.
Tier 3+ enrages at 30% HP. WaveManager.getCurrentWave() added so
EnemyManager can route to this class on milestone waves."
```

---

## Task 8: EnemyManager routing + onMilestoneBossDeath callback

Route `spawnSurvivorsEnemy('boss', …)` to `MilestoneBoss` on every 5th wave. Add a `setOnMilestoneBossDeath((pos, tier) => void)` callback fired before the standard cleanup.

**Files:**
- Modify: `src/game/gameplay/EnemyManager.ts`

- [ ] **Step 1: Import MilestoneBoss and add the callback field**

In `src/game/gameplay/EnemyManager.ts`, add this import alongside the existing enemy imports (after the `BossEnemy` import on line 8):

```ts
import { MilestoneBoss } from './enemies/MilestoneBoss';
```

Add a forward declaration for `WaveManager` (to avoid a circular import):

```ts
import type { WaveManager } from './WaveManager';
```

Then in the class field declarations (around line 28, after `onEliteDeathCallback`), add:

```ts
    private onMilestoneBossDeathCallback: (position: Vector3, waveTier: number) => void = () => {};
    private waveManager: WaveManager | null = null;
```

- [ ] **Step 2: Add the setter for WaveManager and the death-callback registrar**

After the existing `setOnEliteDeath` method (around line 99-101), add:

```ts
    /**
     * Provide the WaveManager so spawnSurvivorsEnemy can route milestone-wave bosses
     * to MilestoneBoss. Optional — without it, bosses fall back to the standard BossEnemy.
     */
    public setWaveManager(wm: WaveManager): void {
        this.waveManager = wm;
    }

    /**
     * Register a callback fired exactly once when a MilestoneBoss dies, before
     * the standard cleanup. `waveTier` = waveNumber / 5 (1 at wave 5, 2 at wave 10, …).
     */
    public setOnMilestoneBossDeath(fn: (position: Vector3, waveTier: number) => void): void {
        this.onMilestoneBossDeathCallback = fn;
    }
```

- [ ] **Step 3: Route the boss spawn to MilestoneBoss on milestone waves**

In `spawnSurvivorsEnemy` (around line 147-157), locate the switch:

```ts
        switch (type) {
            case 'basic':    enemy = new BasicEnemy(this.game, spawnPos, []); break;
            case 'fast':     enemy = new FastEnemy(this.game, spawnPos, []); break;
            case 'tank':     enemy = new TankEnemy(this.game, spawnPos, []); break;
            case 'boss':     enemy = new BossEnemy(this.game, spawnPos, []); break;
            case 'splitting':enemy = new SplittingEnemy(this.game, spawnPos, []); break;
            case 'healer':   enemy = new HealerEnemy(this.game, spawnPos, []); break;
            case 'shield':   enemy = new ShieldEnemy(this.game, spawnPos, []); break;
            default:         enemy = new BasicEnemy(this.game, spawnPos, []); break;
        }
```

Replace the `case 'boss':` line with the routing logic:

```ts
            case 'boss': {
                const currentWave = this.waveManager?.getCurrentWave() ?? 0;
                if (currentWave > 0 && currentWave % 5 === 0) {
                    const tier = currentWave / 5;
                    enemy = new MilestoneBoss(this.game, spawnPos, [], tier);
                } else {
                    enemy = new BossEnemy(this.game, spawnPos, []);
                }
                break;
            }
```

- [ ] **Step 4: Fire the death callback in the update loop**

In `update(deltaTime)` (around line 208-221), locate this death branch:

```ts
            } else if (!enemy.isAlive()) {
                // Enemy died, give reward to player
                if (this.playerStats) {
                    this.playerStats.addMoney(enemy.getReward());
                    this.playerStats.addKill();
                }

                // Survivors mode: fire elite-death callback so a PowerDrop can be spawned
                if (enemy.isElite && enemy.eliteDropElement) {
                    this.onEliteDeathCallback(enemy.getPosition().clone(), enemy.eliteDropElement);
                }

                // Remove from enemies list
                this.removeEnemy(enemy);
            }
```

Replace it with:

```ts
            } else if (!enemy.isAlive()) {
                // Enemy died, give reward to player
                if (this.playerStats) {
                    this.playerStats.addMoney(enemy.getReward());
                    this.playerStats.addKill();
                }

                // Survivors mode: fire elite-death callback so a PowerDrop can be spawned
                if (enemy.isElite && enemy.eliteDropElement) {
                    this.onEliteDeathCallback(enemy.getPosition().clone(), enemy.eliteDropElement);
                }

                // Survivors mode: fire milestone-boss death callback so an ItemDrop can be spawned
                if ((enemy as MilestoneBoss).isMilestone) {
                    const mb = enemy as MilestoneBoss;
                    this.onMilestoneBossDeathCallback(mb.getPosition().clone(), mb.waveTier);
                }

                // Remove from enemies list
                this.removeEnemy(enemy);
            }
```

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 6: Build to catch any import or webpack issues**

Run: `npm run build`
Expected: build succeeds with no errors. (Warnings about bundle size are fine.)

- [ ] **Step 7: Commit**

```bash
git add src/game/gameplay/EnemyManager.ts
git commit -m "feat(enemies): route boss spawns to MilestoneBoss on 5th waves

When currentWave % 5 === 0, instantiate MilestoneBoss with the
tier (wave/5). Otherwise the standard BossEnemy is used so any
non-survivors boss spawn paths stay on the existing class.
setOnMilestoneBossDeath callback fires once per MilestoneBoss
death, before cleanup."
```

---

## Task 9: ItemDrop entity + wire item-drop pipeline in SurvivorsGameplayState

`ItemDrop` is the gem pickup (modeled on `PowerDrop`). The wiring in `SurvivorsGameplayState` constructs `RunItems`, hands the player stats to `HeroBasicAttack`, registers the boss-death → item-drop chain, and grants the item on pickup.

**Files:**
- Create: `src/game/gameplay/ItemDrop.ts`
- Modify: `src/game/states/SurvivorsGameplayState.ts`

- [ ] **Step 1: Create the ItemDrop entity**

Create `src/game/gameplay/ItemDrop.ts` with the full contents below:

```ts
import { Scene, Vector3, Mesh, MeshBuilder, StandardMaterial, Color3 } from '@babylonjs/core';
import { ItemId } from './RunItems';

/** Visual color per item — matches the HUD slot color so the link reads. */
const ITEM_COLORS: Record<ItemId, Color3> = {
    lifesteal:       new Color3(1.0, 0.15, 0.25),   // red
    multishotCleave: new Color3(1.0, 0.85, 0.30),   // gold
    knockback:       new Color3(0.30, 0.65, 1.0),   // blue
    attackSpeed:     new Color3(1.0, 1.0, 0.55),    // yellow-white
};

export interface ItemDropOpts {
    pickupRadius: number;
    magnetRadius: number;
    magnetSpeed: number;
    onPickup: (id: ItemId) => void;
}

export class ItemDrop {
    private scene: Scene;
    private mesh: Mesh;
    private pillar: Mesh;
    private color: Color3;
    public itemId: ItemId;
    private opts: ItemDropOpts;
    private alive: boolean = true;
    private heroProvider: () => Vector3;
    private spawnTime: number = performance.now();

    constructor(
        scene: Scene,
        position: Vector3,
        itemId: ItemId,
        heroProvider: () => Vector3,
        opts: ItemDropOpts,
    ) {
        this.scene = scene;
        this.itemId = itemId;
        this.color = ITEM_COLORS[itemId] ?? new Color3(1, 1, 1);
        this.opts = opts;
        this.heroProvider = heroProvider;

        // Faceted icosahedron gem
        this.mesh = MeshBuilder.CreatePolyhedron(`itemGem_${itemId}_${Math.random()}`,
            { type: 2, size: 0.45 }, scene);
        this.mesh.position.copyFrom(position);
        this.mesh.position.y = 0.8;
        const gemMat = new StandardMaterial(`itemGemMat_${itemId}_${Math.random()}`, scene);
        gemMat.emissiveColor = this.color;
        gemMat.diffuseColor  = this.color.scale(0.3);
        gemMat.specularColor = Color3.Black();
        this.mesh.material = gemMat;

        // Pillar of light — tall thin cylinder behind the gem
        this.pillar = MeshBuilder.CreateCylinder(`itemPillar_${itemId}_${Math.random()}`,
            { height: 8, diameterTop: 0.3, diameterBottom: 0.9, tessellation: 8 }, scene);
        this.pillar.position.copyFrom(position);
        this.pillar.position.y = 4;
        const pillarMat = new StandardMaterial(`itemPillarMat_${itemId}_${Math.random()}`, scene);
        pillarMat.emissiveColor = this.color;
        pillarMat.diffuseColor  = new Color3(0, 0, 0);
        pillarMat.specularColor = Color3.Black();
        pillarMat.alpha = 0.20;
        this.pillar.material = pillarMat;
        this.pillar.isPickable = false;
    }

    public isAlive(): boolean {
        return this.alive;
    }

    public update(deltaTime: number): void {
        if (!this.alive) return;

        const heroPos = this.heroProvider();
        const dx = heroPos.x - this.mesh.position.x;
        const dz = heroPos.z - this.mesh.position.z;
        const dist = Math.hypot(dx, dz);

        if (dist <= this.opts.pickupRadius) {
            this.playPickupFlash();
            this.opts.onPickup(this.itemId);
            this.dispose();
            return;
        }

        if (dist <= this.opts.magnetRadius && dist > 0.001) {
            const step = this.opts.magnetSpeed * deltaTime;
            this.mesh.position.x += (dx / dist) * step;
            this.mesh.position.z += (dz / dist) * step;
            this.pillar.position.x = this.mesh.position.x;
            this.pillar.position.z = this.mesh.position.z;
        }

        // Idle hover + slow spin
        const t = (performance.now() - this.spawnTime) / 1000;
        this.mesh.position.y = 0.8 + Math.sin(t * 2.0) * 0.15;
        this.mesh.rotation.y = t * 1.2;
    }

    private playPickupFlash(): void {
        const flashMat = new StandardMaterial(`itemFlash_${Math.random()}`, this.scene);
        flashMat.emissiveColor = this.color.scale(2.5);
        flashMat.specularColor = Color3.Black();
        this.mesh.material = flashMat;
        this.mesh.scaling.setAll(2.0);
    }

    public dispose(): void {
        this.alive = false;
        if (!this.mesh.isDisposed()) this.mesh.dispose();
        if (!this.pillar.isDisposed()) this.pillar.dispose();
    }
}
```

- [ ] **Step 2: Wire the pipeline in SurvivorsGameplayState**

In `src/game/states/SurvivorsGameplayState.ts`, add these imports near the existing imports at the top of the file (after the other `gameplay/` imports):

```ts
import { RunItems, ItemId } from '../gameplay/RunItems';
import { ItemDrop } from '../gameplay/ItemDrop';
```

In the class field declarations (find the section near the other private fields, around lines 27-50), add:

```ts
    private runItems: RunItems | null = null;
    private itemDrops: ItemDrop[] = [];
```

In `startRun()`, locate the existing `setOnEliteDeath` registration (around line 211). Just before that block, after `this.heroController` and `this.playerStats` are both assigned and after `this.waveManager` is set up (i.e. anywhere later in `startRun()`), insert:

```ts
        // Hand the WaveManager to EnemyManager so boss spawns route to MilestoneBoss on 5th waves.
        this.enemyManager.setWaveManager(this.waveManager);

        // Push playerStats into the controller-owned HeroBasicAttack so run-item
        // effects (lifesteal, knockback, multishot, multi-spin) can read them.
        this.heroController.setPlayerStats(this.playerStats);

        // Construct RunItems now that controller + playerStats + championType all exist.
        this.runItems = new RunItems(this.playerStats, this.currentChampionType, this.heroController);

        // Boss-death → item-drop pipeline.
        this.enemyManager.setOnMilestoneBossDeath((pos, tier) => this.spawnItemDrop(pos, tier));
```

Field names referenced (verified against the current file):
- `this.heroController` — `HeroController` instance (private field at the top of the class).
- `this.playerStats` — `PlayerStats` instance.
- `this.waveManager` — `WaveManager` instance.
- `this.currentChampionType` — `ChampionType` set at line 137 of `startRun()` (`(championType as ChampionType) ?? 'mage'`).

- [ ] **Step 3: Implement `spawnItemDrop` on `SurvivorsGameplayState`**

In the same file, add this private method near the existing PowerDrop spawn helpers (or after the wiring you just added):

```ts
    private spawnItemDrop(position: Vector3, waveTier: number): void {
        const itemId = RunItems.itemForTier(waveTier);
        if (!itemId) return;
        if (this.runItems?.hasItem(itemId)) return; // Already owned — no re-drop today.

        const heroProvider = () => this.hero!.getPosition();
        const drop = new ItemDrop(
            this.scene,
            position,
            itemId,
            heroProvider,
            {
                pickupRadius: 1.2,
                magnetRadius: 4.0,
                magnetSpeed: 8.0,
                onPickup: (id: ItemId) => this.onItemPickup(id),
            },
        );
        this.itemDrops.push(drop);
    }

    private onItemPickup(id: ItemId): void {
        if (!this.runItems) return;
        this.runItems.grant(id);
        // HUD pulse is wired in Task 10.
    }
```

- [ ] **Step 4: Tick the item drops each frame**

Find the main `update(dt)` method on `SurvivorsGameplayState` (the local var is named `dt`, not `deltaTime` — line ~376 onward). Where the existing `PowerDrop` updates happen (line ~404):

```ts
        for (const d of this.powerDrops) d.update(dt);
        this.powerDrops = this.powerDrops.filter(d => d.isAlive());
```

Add the parallel block for item drops immediately below it:

```ts
        for (const d of this.itemDrops) d.update(dt);
        this.itemDrops = this.itemDrops.filter(d => d.isAlive());
```

- [ ] **Step 5: Dispose item drops in `exit()`**

Find the `exit()` method. The existing PowerDrop cleanup (line ~309) reads:

```ts
        for (const d of this.powerDrops) d.dispose();
        this.powerDrops = [];
```

Add the parallel item-drop cleanup just below it:

```ts
        for (const d of this.itemDrops) d.dispose();
        this.itemDrops = [];
        this.runItems = null;
```

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 7: Build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 8: Manual playtest**

Run: `npm start`
Open `http://localhost:9000`.

Verify in this order:
1. Pick the **Barbarian**. Play through to wave 5.
2. On wave 5: the boss appears (Abyssal Titan mesh, same as before), but it should periodically root, draw a red ground rectangle pointing at you, then dash ~6 units fast. Kiting in a straight line should NOT outpace it — the dash catches up.
3. Kill the boss. A glowing red gem with a tall light pillar should drop at its corpse.
4. Walk into the gem. It should magnet toward you and disappear with a bright flash.
5. From that point on, attacking enemies should heal the barbarian by ~5% of damage dealt (visible on the HP bar).
6. Continue to wave 10. The boss telegraph should now LEAD your strafing (if you move sideways during the telegraph, the dash arrives where you're heading).
7. Kill wave-10 boss → gold gem drops. Pick it up → the barbarian should now perform two distinct spin animations per swing (the second arrives 0.15s after the first).
8. Test on Ranger too — wave-10 item should make each shot fire 2 arrows in a fan instead of 1.

If anything in 2-8 misbehaves, fix and re-test before committing.

- [ ] **Step 9: Commit**

```bash
git add src/game/gameplay/ItemDrop.ts src/game/states/SurvivorsGameplayState.ts
git commit -m "feat(items): wire boss-death → item-drop → grant pipeline

ItemDrop is a colored faceted-gem entity (with a pillar of light)
modeled on PowerDrop. SurvivorsGameplayState constructs RunItems
once the hero is built, hands PlayerStats to HeroBasicAttack,
and registers the milestone-boss death callback to spawn an
ItemDrop. Picking up a drop calls RunItems.grant(itemId) which
publishes the new effect values into PlayerStats."
```

---

## Task 10: HeroHud items row + pulseItem animation

Render a 4-slot row above the existing power-slot row, populated from `runItems.getStacks(id)`. Add `pulseItem(itemId)` for the pickup flash. Wire `SurvivorsGameplayState` to pass `runItems` to the HUD and call `pulseItem` on pickup.

**Files:**
- Modify: `src/game/ui/HeroHud.ts`
- Modify: `src/game/states/SurvivorsGameplayState.ts`

- [ ] **Step 1: Import RunItems + ItemId in HeroHud**

In `src/game/ui/HeroHud.ts`, add this import near the existing imports at the top:

```ts
import { RunItems, ItemId } from '../gameplay/RunItems';
```

- [ ] **Step 2: Add the data + container fields**

In the `HeroHud` class declarations (around line 36-79, near the other field declarations), add:

```ts
    private runItems: RunItems | null = null;

    /** Item-row slot containers, keyed by item id. */
    private itemSlots: Record<ItemId, { bg: Rectangle; icon: TextBlock; badge: TextBlock } | null> = {
        lifesteal: null,
        multishotCleave: null,
        knockback: null,
        attackSpeed: null,
    };

    /** Pulse animation state, per slot. */
    private itemPulseTime: Record<ItemId, number> = {
        lifesteal: 0, multishotCleave: 0, knockback: 0, attackSpeed: 0,
    };
    private itemPulseActive: Record<ItemId, boolean> = {
        lifesteal: false, multishotCleave: false, knockback: false, attackSpeed: false,
    };
```

Add a glyph + color table near the top of the file, next to the existing `ELEMENT_GLYPH` block:

```ts
/** Per-item glyph and color for the items HUD row. */
const ITEM_GLYPH: Record<ItemId, string> = {
    lifesteal: '♥',
    multishotCleave: '✦',
    knockback: '➤',
    attackSpeed: '⚡',
};
const ITEM_COLOR: Record<ItemId, string> = {
    lifesteal: '#ff2a40',
    multishotCleave: '#ffd84a',
    knockback: '#4ea7ff',
    attackSpeed: '#fff080',
};
```

- [ ] **Step 3: Add the public setter and pulse trigger**

After the existing `constructor` (around line 96), add:

```ts
    /** Wire the RunItems source so the item row reflects live stack counts. */
    public setRunItems(runItems: RunItems): void {
        this.runItems = runItems;
    }

    /** Trigger the 1s pickup pulse animation on the slot for `id`. */
    public pulseItem(id: ItemId): void {
        this.itemPulseActive[id] = true;
        this.itemPulseTime[id] = 0;
    }
```

- [ ] **Step 4: Build the row inside the desktop layout**

In `_buildDesktop()`, find the existing `slotRow` block (around line 231-260). Just AFTER `this.builtControls.push(slotRow);` (where the per-slot icons are added inside the loop), but OUTSIDE the for-loop that builds power slots — i.e. immediately after the power-slot row construction is complete — append:

```ts
        // ── Items row — 4 small slots sitting above the power-slot row ──────
        const itemSize = 36;
        const itemGap  = 6;
        const itemRowWidth = itemSize * 4 + itemGap * 3;
        const itemRow = new Rectangle('itemRow');
        itemRow.width = `${itemRowWidth}px`;
        itemRow.height = `${itemSize}px`;
        itemRow.thickness = 0;
        itemRow.background = '';
        itemRow.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
        itemRow.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
        itemRow.top = `-${slotSize + 18}px`; // sits just above the power-slot row
        this.ui.addControl(itemRow);
        this.builtControls.push(itemRow);

        this._buildItemSlots(itemRow, itemSize, itemGap);
```

- [ ] **Step 5: Build the row inside the mobile layout**

In `_buildMobile()`, find the equivalent slotRow block (around line 395-425). After it completes, append the same construction with smaller dimensions:

```ts
        // ── Items row — mobile variant, smaller slots ──────────────────────
        const itemSize = 28;
        const itemGap  = 4;
        const itemRowWidth = itemSize * 4 + itemGap * 3;
        const itemRow = new Rectangle('itemRow');
        itemRow.width = `${itemRowWidth}px`;
        itemRow.height = `${itemSize}px`;
        itemRow.thickness = 0;
        itemRow.background = '';
        itemRow.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
        itemRow.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
        itemRow.top = `-${slotSize + 14}px`;
        this.ui.addControl(itemRow);
        this.builtControls.push(itemRow);

        this._buildItemSlots(itemRow, itemSize, itemGap);
```

- [ ] **Step 6: Add the `_buildItemSlots` helper**

Inside the `HeroHud` class, after the existing build helpers (somewhere near the slot construction code), add:

```ts
    private _buildItemSlots(parent: Rectangle, sizePx: number, gapPx: number): void {
        const ids: ItemId[] = ['lifesteal', 'multishotCleave', 'knockback', 'attackSpeed'];

        // Reset slot table so resize-rebuilds don't keep stale references.
        this.itemSlots = {
            lifesteal: null,
            multishotCleave: null,
            knockback: null,
            attackSpeed: null,
        };

        for (let i = 0; i < ids.length; i++) {
            const id = ids[i];

            const bg = makeFrame({ sizePx, label: '' });
            bg.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
            bg.verticalAlignment   = Control.VERTICAL_ALIGNMENT_TOP;
            bg.left = `${i * (sizePx + gapPx)}px`;
            bg.background = '#1a1a22';
            bg.color = '#3a3a46';
            parent.addControl(bg);

            const icon = new TextBlock(`itemIcon_${id}`, ITEM_GLYPH[id]);
            icon.color = '#3a3a46';   // dim grey = locked
            icon.fontSize = Math.round(sizePx * 0.55);
            icon.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
            icon.verticalAlignment   = Control.VERTICAL_ALIGNMENT_CENTER;
            bg.addControl(icon);

            const badge = new TextBlock(`itemBadge_${id}`, '');
            badge.color = '#ffffff';
            badge.fontSize = Math.round(sizePx * 0.32);
            badge.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
            badge.verticalAlignment   = Control.VERTICAL_ALIGNMENT_BOTTOM;
            badge.paddingRight = '3px';
            badge.paddingBottom = '1px';
            badge.isVisible = false;
            bg.addControl(badge);

            this.itemSlots[id] = { bg, icon, badge };
        }
    }
```

- [ ] **Step 7: Refresh the item row each frame in `update()`**

Find the existing `public update(...)` method on `HeroHud`. Add this block near the top (so it runs every frame regardless of whatever else the method does):

```ts
        this._updateItemRow(deltaTime);
```

If the `deltaTime` arg name differs, use whatever the method already calls it.

Then add the helper as a private method on the class:

```ts
    private _updateItemRow(deltaTime: number): void {
        const ids: ItemId[] = ['lifesteal', 'multishotCleave', 'knockback', 'attackSpeed'];
        for (const id of ids) {
            const slot = this.itemSlots[id];
            if (!slot) continue;

            const stacks = this.runItems?.getStacks(id) ?? 0;
            const owned = stacks > 0;

            // Icon color: dim grey when locked, bright item color when owned.
            slot.icon.color = owned ? ITEM_COLOR[id] : '#3a3a46';
            slot.bg.color   = owned ? ITEM_COLOR[id] : '#3a3a46';

            // Stack badge: shown only when stacks > 1.
            slot.badge.isVisible = stacks > 1;
            if (stacks > 1) slot.badge.text = `×${stacks}`;

            // Pulse animation (1s total). Scale 1 → 1.4 → 1.0 via simple eased curve.
            if (this.itemPulseActive[id]) {
                this.itemPulseTime[id] += deltaTime;
                const t = this.itemPulseTime[id] / 1.0;
                if (t >= 1) {
                    this.itemPulseActive[id] = false;
                    slot.bg.scaleX = 1;
                    slot.bg.scaleY = 1;
                } else {
                    // Triangle wave peaking at t=0.5
                    const k = t < 0.5 ? (t * 2) : (1 - (t - 0.5) * 2);
                    const s = 1 + 0.4 * k;
                    slot.bg.scaleX = s;
                    slot.bg.scaleY = s;
                }
            }
        }
    }
```

- [ ] **Step 8: Pass RunItems into HeroHud and trigger pulse on pickup**

In `src/game/states/SurvivorsGameplayState.ts`, find where the `HeroHud` is constructed (line ~265: `this.hud = new HeroHud(this.ui, this.abilityManager, this.game);`). Note the field is `this.hud`, not `this.heroHud`.

Constructing `RunItems` happens before `new HeroHud(...)` in the current `startRun()` ordering (you added the RunItems construction in Task 9 Step 2 around the `setOnEliteDeath` block, which is line ~211 — before the HeroHud construction at line ~265). So after the HeroHud line, add:

```ts
        if (this.runItems) {
            this.hud.setRunItems(this.runItems);
        }
```

Then update the `onItemPickup` method you wrote in Task 9 to fire the pulse:

```ts
    private onItemPickup(id: ItemId): void {
        if (!this.runItems) return;
        this.runItems.grant(id);
        this.hud?.pulseItem(id);
    }
```

- [ ] **Step 9: Type-check**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 10: Build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 11: Manual playtest**

Run: `npm start`.

Verify:
1. On run start the HUD shows 4 dim grey item slots above the power-slot row, each with a faint silhouette glyph (♥, ✦, ➤, ⚡).
2. On wave 5 boss kill + gem pickup, the lifesteal slot pulses (scale 1 → 1.4 → 1.0) and becomes red.
3. Wave 10 → gold ✦ slot lights up. Wave 15 → blue ➤ slot. Wave 20 → yellow ⚡ slot.
4. On mobile layout (responsive), the row is smaller (28px slots) but otherwise behaves the same — open dev tools, toggle device mode to a phone resolution, refresh.
5. After picking up wave-20 attack-speed: barbarian or ranger should noticeably swing/shoot faster (roughly doubled cadence). HP bar should still tick down at normal rates from boss/enemy contact damage.

- [ ] **Step 12: Commit**

```bash
git add src/game/ui/HeroHud.ts src/game/states/SurvivorsGameplayState.ts
git commit -m "feat(hud): items row above power slots with pickup pulse

Four small slots reflect RunItems.getStacks live. Locked slots
are dim grey with a faint glyph; unlocked use the item color
and frame. Stack badge appears when stacks > 1. pulseItem(id)
runs a 1s scale 1→1.4→1.0 animation on pickup. Wires the row
to RunItems and pulses on grant in SurvivorsGameplayState."
```

---

## Final verification

After all tasks are committed:

- [ ] **Step 1: Full type-check**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 2: Production build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: End-to-end playtest checklist (do once per champion)**

Run: `npm start`. For each of barbarian / ranger / mage:

| Wave | Expected boss behavior | Expected item drop | Expected post-pickup |
|------|------------------------|--------------------|----------------------|
| 5    | Lunge/dash cadence 4s, kiting straight catches you | Red ♥ gem | Hero heals ~5% of damage dealt |
| 10   | Lunge leads your strafing | Gold ✦ gem | Barb: 2 spins per swing 0.15s apart. Ranger/Mage: 2 projectiles in a fan |
| 15   | Lunge + sidestep + enrage (red ground glow) at 30% HP | Blue ➤ gem | Each hit pushes enemies ~1u radially out |
| 20   | Faster lunge cadence (≈2.4s) | Yellow ⚡ gem | Attack speed roughly doubled |
| 25+  | All tier-4 behaviors, slightly more HP | No drop | — |

Bugs found at this stage should be filed as follow-up commits, not amends.
