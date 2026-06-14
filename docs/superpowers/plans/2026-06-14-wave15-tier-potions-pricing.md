# Wave-15+ Tier, Potions & Pricing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a wave-15+ enemy tier (4 new enemies + an Elemental Lord wave-25 boss that drops a ×10-power core), four single-wave shop potions, and a price rework (unique/mythic ×10, others ×2.5).

**Architecture:** Follows the proven wave-10 red-tier pattern — extend a base enemy class, override a few stats, register the GLB in `ENEMY_GLB_PATHS`, add swap/spawn/co-op/prewarm cases. Potions are a pure-logic module folded into `applyLevelBonuses()` and a dedicated shop row. Pricing is one constant table.

**Tech Stack:** TypeScript, BabylonJS, Vitest (pure-logic only), webpack.

**Verify after every task:** `npx tsc --noEmit` clean, `npm test` green.

---

## File Structure

**Create:**
- `src/survivors/enemies/FireBeetle.ts` — fast skirmisher, applies hero burn on contact
- `src/survivors/enemies/HornedLizard.ts` — heavy hitter tank
- `src/survivors/enemies/RedSuperWizard.ts` — ranged + AOE-splash wizard (wave-15 wizard elite)
- `src/survivors/PotionShop.ts` — pure potion defs + buff math
- `tests/potionShop.spec.ts`, `tests/wave15Swap.spec.ts`, `tests/elementalCore.spec.ts`

**Modify:**
- `src/survivors/enemies/redSwap.ts` — wave-15 swap tier
- `src/survivors/items/ItemTypes.ts:7-9` — `RARITY_BASE_PRICE`
- `src/survivors/SurvivorsGameplayState.ts` — asset paths, item display maps, boss tier-5 asset cap, potion state + fold + clear, shop VM/callbacks, FireBeetle burn hookup
- `src/survivors/enemies/EnemyManager.ts` — spawn switch (fire/lizard/super-wizard, boss tier-5 asset), prewarm loop
- `src/survivors/enemies/createEnemyOfType.ts` — guest spawn cases
- `src/survivors/enemies/MilestoneBoss.ts` — tier-5 label/actions + elemental nova
- `src/survivors/RunItems.ts` — `elementalCore` item
- `src/survivors/HeroController.ts` — burn DoT field + tick
- `src/survivors/enemies/Enemy.ts` — `burnOnContactDps` field
- `src/ui/overlays/ShopOverlay.ts` — potion row

---

## Phase A — Price rework (independent, do first)

### Task A1: Bump rarity base prices

**Files:**
- Modify: `src/survivors/items/ItemTypes.ts:7-9`

- [ ] **Step 1: Edit the constant**

Replace:
```typescript
export const RARITY_BASE_PRICE: Record<Rarity, number> = {
    common: 60, rare: 120, epic: 220, legendary: 400, unique: 520, mythic: 900,
};
```
with:
```typescript
export const RARITY_BASE_PRICE: Record<Rarity, number> = {
    // Price rework 2026-06-14: unique/mythic ×10, others ×2.5.
    common: 150, rare: 300, epic: 550, legendary: 1000, unique: 5200, mythic: 9000,
};
```

- [ ] **Step 2: Verify** — `npx tsc --noEmit` (clean). `priceFor()` and the 60% sell-back cascade off this table; no call-site changes.

- [ ] **Step 3: Commit**
```bash
git add src/survivors/items/ItemTypes.ts
git commit -m "balance(shop): unique/mythic items ×10, others ×2.5"
```

---

## Phase B — Wave-15 enemy tier

### Task B1: Wave-15 tiered swap (pure, TDD)

**Files:**
- Modify: `src/survivors/enemies/redSwap.ts`
- Test: `tests/wave15Swap.spec.ts`

- [ ] **Step 1: Write the failing test**
```typescript
// tests/wave15Swap.spec.ts
import { describe, it, expect } from 'vitest';
import { redSwapType, RED_SWAP_WAVE, TIER3_SWAP_WAVE } from '../src/survivors/enemies/redSwap';

describe('tiered enemy swap', () => {
    it('keeps base types before wave 10', () => {
        expect(redSwapType('fast', 9)).toBe('fast');
        expect(redSwapType('tank', 9)).toBe('tank');
    });
    it('applies red tier at wave 10-14', () => {
        expect(redSwapType('fast', 12)).toBe('fast_red');
        expect(redSwapType('tank', 12)).toBe('tank_red');
        expect(redSwapType('healer', 12)).toBe('healer_red');
        expect(redSwapType('basic', 12)).toBe('basic_red');
    });
    it('applies wave-15 tier at wave 15+', () => {
        expect(redSwapType('fast', 16)).toBe('fire_beetle');
        expect(redSwapType('tank', 16)).toBe('horned_lizard');
        // healer stays the red wizard; its ELITE upgrade is decided in the spawn switch
        expect(redSwapType('healer', 16)).toBe('healer_red');
        expect(redSwapType('basic', 16)).toBe('basic_red');
    });
    it('exposes the thresholds', () => {
        expect(RED_SWAP_WAVE).toBe(10);
        expect(TIER3_SWAP_WAVE).toBe(15);
    });
});
```

- [ ] **Step 2: Run it — FAIL** (`TIER3_SWAP_WAVE` undefined): `npm test -- wave15Swap`

- [ ] **Step 3: Implement** — replace `redSwap.ts` body:
```typescript
/** Wave at/after which blue base enemies become their red variants. */
export const RED_SWAP_WAVE = 10;
/** Wave at/after which the red tier upgrades again to the wave-15 roster. */
export const TIER3_SWAP_WAVE = 15;

/**
 * Map a base enemy type to the toughest variant unlocked at `wave`. Two one-way
 * thresholds: wave 10 (red tier) then wave 15 (fire/lizard tier). Types without a
 * variant pass through. Pure — unit-tested; the only logic the Babylon spawn path
 * can't cover. NOTE: the wizard's wave-15 AOE "super" form is an ELITE decision made
 * in EnemyManager (needs the eliteElement flag), so `healer` stays `healer_red` here.
 */
export function redSwapType(type: string, wave: number): string {
    if (wave >= TIER3_SWAP_WAVE) {
        switch (type) {
            case 'fast': return 'fire_beetle';
            case 'tank': return 'horned_lizard';
            case 'basic':  return 'basic_red';
            case 'healer': return 'healer_red';
        }
    }
    if (wave >= RED_SWAP_WAVE) {
        switch (type) {
            case 'basic':  return 'basic_red';
            case 'fast':   return 'fast_red';
            case 'healer': return 'healer_red';
            case 'tank':   return 'tank_red';
        }
    }
    return type;
}
```

- [ ] **Step 4: Run — PASS**: `npm test -- wave15Swap`

- [ ] **Step 5: Commit**
```bash
git add src/survivors/enemies/redSwap.ts tests/wave15Swap.spec.ts
git commit -m "feat(enemies): wave-15 tiered swap (fire-beetle, horned-lizard)"
```

### Task B2: FireBeetle + HornedLizard + RedSuperWizard classes

**Files:**
- Create: `src/survivors/enemies/FireBeetle.ts`, `HornedLizard.ts`, `RedSuperWizard.ts`
- Modify: `src/survivors/enemies/Enemy.ts` (add `burnOnContactDps`)

- [ ] **Step 1: Add the burn field to Enemy base.** In `src/survivors/enemies/Enemy.ts`, next to `public contactDamagePerSecond` (search for that field, ~line 236), add:
```typescript
    /** If >0, contact with the hero also ignites a burn DoT (dps) for ~3s. Only
     *  FireBeetle sets it; the gameplay state reads it in applyContactDamage. */
    public burnOnContactDps: number = 0;
```

- [ ] **Step 2: FireBeetle** — `src/survivors/enemies/FireBeetle.ts`:
```typescript
import { Vector3 } from '@babylonjs/core';
import { Game } from '../../engine/Game';
import { FastEnemy } from './FastEnemy';

/**
 * Wave-15+ replacement for the fast carriage (FastEnemy). A fast skirmisher whose
 * contact ignites a fire DoT on the hero (burnOnContactDps), ticking ~3s after it
 * peels off. Reuses FastEnemy's mesh/GLB/animation; EnemyManager stages the
 * fire-beetle GLB on FastEnemy.pendingAsset before constructing this leaf.
 */
export class FireBeetle extends FastEnemy {
    constructor(game: Game, position: Vector3, path: Vector3[]) {
        super(game, position, path);
        // Fast tier: tanky-for-a-fast, quick, modest direct contact + a fire DoT.
        this.health = 220;
        this.maxHealth = 220;
        this.contactDamagePerSecond = 10;
        this.burnOnContactDps = 8; // ticks for BURN_SECONDS in applyContactDamage
        if (new.target === FireBeetle) this._initEnemyVisuals();
    }
}
```

- [ ] **Step 3: HornedLizard** — `src/survivors/enemies/HornedLizard.ts`:
```typescript
import { Vector3 } from '@babylonjs/core';
import { Game } from '../../engine/Game';
import { TankEnemy } from './TankEnemy';

/**
 * Wave-15+ replacement for the tank (TankEnemy). The heaviest non-boss hitter:
 * very high HP and contact damage, slow. Reuses TankEnemy's mesh/GLB/animation;
 * EnemyManager stages the horned-lizard GLB on TankEnemy.pendingAsset.
 */
export class HornedLizard extends TankEnemy {
    protected glbScale: number = 1.4;
    constructor(game: Game, position: Vector3, path: Vector3[]) {
        super(game, position, path);
        // Heavy hitter (TankEnemy base: 150 HP / 20 DPS). speed/cooldown unchanged.
        this.health = 900;
        this.maxHealth = 900;
        this.contactDamagePerSecond = 36;
        if (new.target === HornedLizard) this._initEnemyVisuals();
    }
}
```

- [ ] **Step 4: RedSuperWizard** — `src/survivors/enemies/RedSuperWizard.ts`. Extends `RedWizard` and overrides the bolt impact to deal AOE splash. RedWizard's `fireBolt` is private, so override `performSupportBehavior` to call a local AOE-aware fire. To avoid duplicating the projectile loop, add a `protected` splash radius hook in RedWizard (Step 4a) then override it here (Step 4b).

  - [ ] **Step 4a:** In `RedWizard.ts`, change the bolt hit block so a subclass can widen the hit into a splash. Replace the hit-test block (lines ~119-122) with:
```typescript
            if (hx * hx + hz * hz < RedWizard.BOLT_HIT_RADIUS * RedWizard.BOLT_HIT_RADIUS) {
                this.onBoltHit(seekTarget, bolt.position);
                cleanup();
            }
```
  and add this overridable method to `RedWizard` (after `fireBolt`):
```typescript
    /** Apply the bolt's damage on impact. Base = single-target. Subclasses (the
     *  super wizard) override to add AOE splash. `at` is the bolt's world position. */
    protected onBoltHit(target: { takeDamage?: (n: number, src?: Vector3) => void }, at: Vector3): void {
        target.takeDamage?.(RedWizard.BOLT_DAMAGE, this.position);
    }
```
  (Add `Vector3` is already imported in RedWizard.) Also expose the damage constant to subclasses by changing `private static readonly BOLT_DAMAGE` to `protected static readonly BOLT_DAMAGE` and `BOLT_HIT_RADIUS` likewise if referenced — only `BOLT_DAMAGE` is needed below.

  - [ ] **Step 4b:** `src/survivors/enemies/RedSuperWizard.ts`:
```typescript
import { Vector3 } from '@babylonjs/core';
import { Game } from '../../engine/Game';
import { RedWizard } from './RedWizard';

/**
 * Wave-15+ wizard ELITE: a RedWizard whose bolt detonates in a small AOE on impact
 * instead of a single-target hit. Spawned by EnemyManager when a wave-15+ wizard
 * rolls elite. Reuses RedWizard's ranged bolt loop wholesale (only onBoltHit differs).
 */
export class RedSuperWizard extends RedWizard {
    private static readonly SPLASH_RADIUS = 3.0;
    private static readonly SPLASH_DAMAGE = 18;

    constructor(game: Game, position: Vector3, path: Vector3[]) {
        super(game, position, path);
        if (new.target === RedSuperWizard) this._initEnemyVisuals();
    }

    /** Damage every live hero within SPLASH_RADIUS of the impact point. */
    protected onBoltHit(_target: { takeDamage?: (n: number, src?: Vector3) => void }, at: Vector3): void {
        const heroes = this.seekTargets ?? (this.seekTarget ? [this.seekTarget] : []);
        for (const h of heroes) {
            if (h.isAlive?.() === false) continue;
            const p = h.getPosition();
            const dx = p.x - at.x, dz = p.z - at.z;
            if (dx * dx + dz * dz <= RedSuperWizard.SPLASH_RADIUS * RedSuperWizard.SPLASH_RADIUS) {
                h.takeDamage?.(RedSuperWizard.SPLASH_DAMAGE, this.position);
            }
        }
    }
}
```
  NOTE: verify `seekTargets` / `seekTarget` types expose `isAlive?()`, `getPosition()`, `takeDamage?()` (they do — RedWizard already calls them). If `seekTargets` element type lacks `isAlive`, mirror RedWizard's `resolveSeekTarget()` usage instead.

- [ ] **Step 5: Verify** — `npx tsc --noEmit` clean.

- [ ] **Step 6: Commit**
```bash
git add src/survivors/enemies/FireBeetle.ts src/survivors/enemies/HornedLizard.ts src/survivors/enemies/RedSuperWizard.ts src/survivors/enemies/RedWizard.ts src/survivors/enemies/Enemy.ts
git commit -m "feat(enemies): FireBeetle, HornedLizard, RedSuperWizard classes"
```

### Task B3: Register GLB assets + item-display maps stay valid

**Files:**
- Modify: `src/survivors/SurvivorsGameplayState.ts` (`ENEMY_GLB_PATHS`, ~line 140)

- [ ] **Step 1: Add asset paths.** In `ENEMY_GLB_PATHS`, after the `healer_red_elite` line, add:
```typescript
    // Wave-15+ tier (see redSwap.ts TIER3_SWAP_WAVE).
    fire_beetle:      { dir: 'assets/fire-beetle/source/',     file: 'fire_beetle.glb' },
    horned_lizard:    { dir: 'assets/horned-lizard/source/',   file: 'horned_lizard.glb' },
    // The wave-15 wizard elite (RedSuperWizard) reuses the red-super-wizard GLB; this
    // key lets the guest resolve the model from netType 'healer_red_super'.
    healer_red_super: { dir: 'assets/red-super-wizard/source/', file: 'red_super_wizard.glb' },
```
  And in the boss block, after `boss_tier4`, add:
```typescript
    boss_tier5:  { dir: 'assets/elemental-lord/source/',                   file: 'elemental_lord.glb' },
```

- [ ] **Step 2: Verify** the preload loops (`Object.keys(ENEMY_GLB_PATHS)` at ~612 and ~911) pick these up automatically. `npx tsc --noEmit` clean.

- [ ] **Step 3: Commit**
```bash
git add src/survivors/SurvivorsGameplayState.ts
git commit -m "feat(assets): register wave-15 enemy + elemental-lord GLBs"
```

### Task B4: Host spawn switch

**Files:**
- Modify: `src/survivors/enemies/EnemyManager.ts` (~594-629 switch; imports at top)

- [ ] **Step 1: Import the new classes** at the top of EnemyManager.ts (next to the Red* imports):
```typescript
import { FireBeetle } from './FireBeetle';
import { HornedLizard } from './HornedLizard';
import { RedSuperWizard } from './RedSuperWizard';
```

- [ ] **Step 2: Add spawn cases.** After the `tank_red` case (line ~625), add:
```typescript
            case 'fire_beetle':   FastEnemy.pendingAsset = assetFor('fire_beetle');
                                  enemy = new FireBeetle(this.game, spawnPos, []); break;
            case 'horned_lizard': TankEnemy.pendingAsset = assetFor('horned_lizard');
                                  enemy = new HornedLizard(this.game, spawnPos, []); break;
```

- [ ] **Step 3: Upgrade the wizard elite at wave 15+.** Replace the existing `healer_red` case with:
```typescript
            case 'healer_red': {
                // Wave 15+ elite wizards become the AOE "super" wizard; otherwise the
                // ranged RedWizard. assetFor('healer_red') already resolves the
                // red-super-wizard GLB when eliteElement is set (healer_red_elite).
                const superWizard = !!eliteElement && waveNow >= TIER3_SWAP_WAVE;
                HealerEnemy.pendingAsset = assetFor('healer_red');
                enemy = superWizard
                    ? new RedSuperWizard(this.game, spawnPos, [])
                    : new RedWizard(this.game, spawnPos, []);
                break;
            }
```
  Import `TIER3_SWAP_WAVE`: change the existing `redSwap` import to `import { redSwapType, TIER3_SWAP_WAVE } from './redSwap';`.

- [ ] **Step 4: Tag the super wizard's netType for the guest.** After the `enemy.netType = …` assignment (line ~636), add:
```typescript
        if (enemy instanceof RedSuperWizard) enemy.netType = 'healer_red_super';
```

- [ ] **Step 5: Verify** — `npx tsc --noEmit` clean.

- [ ] **Step 6: Commit**
```bash
git add src/survivors/enemies/EnemyManager.ts
git commit -m "feat(enemies): spawn wave-15 tier + wizard-elite super wizard"
```

### Task B5: Guest spawn parity + prewarm

**Files:**
- Modify: `src/survivors/enemies/createEnemyOfType.ts`, `src/survivors/enemies/EnemyManager.ts` (prewarm ~413-444)

- [ ] **Step 1: Guest cases.** In `createEnemyOfType.ts`, add imports:
```typescript
import { FireBeetle } from './FireBeetle';
import { HornedLizard } from './HornedLizard';
import { RedSuperWizard } from './RedSuperWizard';
```
  and after the `tank_red` case:
```typescript
        case 'fire_beetle':
            FastEnemy.pendingAsset = asset;
            return new FireBeetle(game, pos, []);

        case 'horned_lizard':
            TankEnemy.pendingAsset = asset;
            return new HornedLizard(game, pos, []);

        case 'healer_red_super':
            HealerEnemy.pendingAsset = asset;
            return new RedSuperWizard(game, pos, []);
```
  (`GuestEnemies.assetFor('healer_red_super')` resolves via `getCachedEnemyAsset` — the key added in B3.)

- [ ] **Step 2: Prewarm the new GLB variants** (avoids the first-spawn shader stall — see CLAUDE.md "freeze = shadow-depth shader not prewarmed"). In `EnemyManager.prewarmEnemyTypes`, import the three classes (top of file already done in B4 for the manager; createEnemyOfType import is separate). Add to the `glbVariants` array after `tank_red`:
```typescript
            { cls: FastEnemy,   key: 'fire_beetle',      build: () => new FireBeetle(this.game, farAway, []) },
            { cls: TankEnemy,   key: 'horned_lizard',    build: () => new HornedLizard(this.game, farAway, []) },
            { cls: HealerEnemy, key: 'healer_red_super', build: () => new RedSuperWizard(this.game, farAway, []) },
```
  and change the boss prewarm loop bound from `tier <= 4` to `tier <= 5`.

- [ ] **Step 3: Verify** — `npx tsc --noEmit` clean.

- [ ] **Step 4: Commit**
```bash
git add src/survivors/enemies/createEnemyOfType.ts src/survivors/enemies/EnemyManager.ts
git commit -m "feat(coop): guest parity + prewarm for wave-15 tier"
```

---

## Phase C — Elemental Lord (wave 25) + Elemental Core

### Task C1: Boss tier-5 asset selection + label/actions/nova

**Files:**
- Modify: `src/survivors/enemies/EnemyManager.ts` (~604-608), `src/survivors/enemies/MilestoneBoss.ts`

- [ ] **Step 1: Select the tier-5 GLB.** In EnemyManager's `boss` case, change the asset cap from tier-4 to tier-5:
```typescript
                    const assetTier = Math.min(5, Math.max(1, tier));
```

- [ ] **Step 2: Tier-5 identity.** In `MilestoneBoss.ts`, extend the tables:
```typescript
const TIER_ACTIONS: Record<number, SpecialAction[]> = {
    1: ['dash'], 2: ['pull'], 3: ['dash'], 4: ['dash', 'pull'], 5: ['dash', 'pull'],
};
```
```typescript
const TIER_LABEL: Record<number, string> = {
    1: 'Ravager', 2: 'Warden', 3: 'Gemini', 4: 'Apex Tyrant', 5: 'Elemental Lord',
};
```

- [ ] **Step 3: Make tier 5 the biggest boss.** Find where MilestoneBoss sets its mesh scale (`glbScale` or a scaling call in the constructor, ~lines 147-196). Add a tier-5 scale bump so it visibly dwarfs tier 4 — multiply the resolved scale by `tier >= 5 ? 1.4 : 1` (locate the exact `glbScale`/scaling field during implementation and apply there). Keep it a single, clearly-commented line.

- [ ] **Step 4: Elemental nova.** Add a periodic telegraphed AOE in MilestoneBoss, gated to tier 5. Reuse the existing slam/dash AOE damage application (find the method that applies dash AOE damage to the hero) and trigger it on a timer (~every 6s) with an `AbilityVisuals` element-themed burst. Broadcast via `emitCoopFx` like other specials. Implementation detail: add `private novaTimer = 6` ticked in `update`, fire when `this.waveTier >= 5 && novaTimer <= 0`, telegraph via the existing `'telegraph'` state if convenient, else a simple 0.6s delayed strike; reset timer. Keep damage = the boss's melee/slam damage value already computed.

- [ ] **Step 5: Verify** — `npx tsc --noEmit` clean; existing MilestoneBoss tests (if any) green.

- [ ] **Step 6: Commit**
```bash
git add src/survivors/enemies/EnemyManager.ts src/survivors/enemies/MilestoneBoss.ts
git commit -m "feat(boss): Elemental Lord (tier 5) — bigger, elemental nova"
```

### Task C2: Elemental Core drop (TDD)

**Files:**
- Modify: `src/survivors/RunItems.ts`, `src/survivors/SurvivorsGameplayState.ts` (item maps + power re-fold)
- Test: `tests/elementalCore.spec.ts`

- [ ] **Step 1: Failing test**
```typescript
// tests/elementalCore.spec.ts
import { describe, it, expect } from 'vitest';
import { PlayerStats } from '../src/survivors/PlayerStats';
import { RunItems } from '../src/survivors/RunItems';

// Minimal HeroController stub — RunItems only calls these on certain items.
const heroStub = { addReviveCharge() {}, updateBasicAttackSpeed() {} } as any;

describe('elementalCore', () => {
    it('drops at boss tier 5', () => {
        expect(RunItems.itemForTier(5)).toBe('elementalCore');
    });
    it('multiplies power damage ×10 per stack', () => {
        const ps = new PlayerStats();
        const ri = new RunItems(ps, 'mage', heroStub);
        ps.powerDamageMultiplier = 1;
        ri.grant('elementalCore');
        // grant applies the live effect immediately
        expect(ps.powerDamageMultiplier).toBeCloseTo(10, 5);
        expect(ri.getStacks('elementalCore')).toBe(1);
    });
});
```

- [ ] **Step 2: Run — FAIL**: `npm test -- elementalCore`

- [ ] **Step 3: Implement in RunItems.ts.**
  - Union: `export type ItemId = 'extraLife' | 'multishotCleave' | 'knockback' | 'attackSpeed' | 'elementalCore';`
  - `ITEM_BY_TIER`: add `5: 'elementalCore',`
  - `stacks` record: add `elementalCore: 0,`
  - Add a constant `export const ELEMENTAL_CORE_POWER_MULT = 10;`
  - In `applyEffect`, add a case:
```typescript
            case 'elementalCore':
                // Multiplicative with the level/equipment power scaling. applyLevelBonuses()
                // RE-ASSIGNS powerDamageMultiplier each recompute, so (like attackSpeed) it
                // is also re-folded there via Math.pow — see SurvivorsGameplayState.
                this.stats.powerDamageMultiplier *= ELEMENTAL_CORE_POWER_MULT;
                return;
```

- [ ] **Step 4: Re-fold in applyLevelBonuses** so level-ups/equips don't erase the ×10. In `SurvivorsGameplayState.applyLevelBonuses`, right after the attack-speed re-fold (the `ps.basicAttackSpeedMultiplier *= Math.pow(ATTACK_SPEED_FACTOR, …)` block, ~line 3840), add:
```typescript
        // Elemental Core (wave-25 boss drop): ×10 power per stack, re-folded for the
        // same reason the attack-speed stack is — the assignment above reset the field.
        ps.powerDamageMultiplier *= Math.pow(
            ELEMENTAL_CORE_POWER_MULT, this.runItems?.getStacks('elementalCore') ?? 0,
        );
```
  Import `ELEMENTAL_CORE_POWER_MULT` alongside the existing `ATTACK_SPEED_FACTOR` import from `./RunItems`.

- [ ] **Step 5: Item display maps.** In SurvivorsGameplayState.ts, add `elementalCore` entries (the `Record<ItemId, string>` maps now require them — TS will error otherwise):
  - `ITEM_DISPLAY_NAMES`: `elementalCore: 'Elemental Core',`
  - `ITEM_FLOAT_COLOR`: `elementalCore: '#ff5a2e',`
  - Find any HUD item-slot list keyed by ItemId (search `extraLife`) and add an `elementalCore` slot so the pickup shows on the HUD, matching the other four.

- [ ] **Step 6: Run — PASS**: `npm test -- elementalCore`; `npx tsc --noEmit` clean.

- [ ] **Step 7: Commit**
```bash
git add src/survivors/RunItems.ts src/survivors/SurvivorsGameplayState.ts tests/elementalCore.spec.ts
git commit -m "feat(items): Elemental Core drop — ×10 power damage (wave-25 boss)"
```

---

## Phase D — FireBeetle hero burn DoT

### Task D1: HeroController burn field + tick

**Files:**
- Modify: `src/survivors/HeroController.ts`

- [ ] **Step 1: Add fields** next to `shieldTimer` (~line 89):
```typescript
    private burnTimer: number = 0;   // seconds of remaining hero burn
    private burnDps: number = 0;     // damage/sec while burnTimer > 0
```

- [ ] **Step 2: Public igniter** (near `setOnRevive`):
```typescript
    /** Ignite/refresh a fire DoT on the hero (FireBeetle contact). Refreshes the
     *  timer and raises the dps to the strongest active source. */
    public applyBurn(durationS: number, dps: number): void {
        if (this.isDead || this.spectating) return;
        this.burnTimer = Math.max(this.burnTimer, durationS);
        this.burnDps = Math.max(this.burnDps, dps);
    }
```

- [ ] **Step 3: Tick** in `update(deltaTime)` right after the shield block (~line 627):
```typescript
        // ── Fire DoT (FireBeetle contact) ──────────────────────────────────
        if (this.burnTimer > 0) {
            this.burnTimer -= deltaTime;
            // Route through takeDamage so the revive/invuln gates still apply. No
            // source position → no knockback. 'fire' element colours the number.
            this.takeDamage(this.burnDps * deltaTime, undefined);
            if (this.burnTimer <= 0) { this.burnTimer = 0; this.burnDps = 0; }
        }
```
  (If `takeDamage`'s second param is required, pass `this.hero.getPosition()`; confirm its signature during implementation. If it accepts an element/hint param, pass `'fire'`.)

- [ ] **Step 4: Verify** — `npx tsc --noEmit` clean.

- [ ] **Step 5: Commit**
```bash
git add src/survivors/HeroController.ts
git commit -m "feat(hero): fire DoT field for FireBeetle contact burn"
```

### Task D2: Apply burn on FireBeetle contact

**Files:**
- Modify: `src/survivors/SurvivorsGameplayState.ts` (`applyContactDamage`, ~4515)

- [ ] **Step 1: Ignite on contact.** Inside the local-hero contact block, after the `this.heroController.takeDamage(...)` call (~line 4516), add:
```typescript
                    if (e.burnOnContactDps > 0) this.heroController.applyBurn(3.0, e.burnOnContactDps);
```

- [ ] **Step 2: Verify** — `npx tsc --noEmit` clean.

- [ ] **Step 3: Commit**
```bash
git add src/survivors/SurvivorsGameplayState.ts
git commit -m "feat(enemies): FireBeetle ignites a 3s burn on hero contact"
```

> Co-op note: this burns the LOCAL hero (solo + each player's own screen). The host's
> guest-HP contact path (`guestHeroHp`) does not model a guest-side DoT — acceptable
> minor co-op gap; solo is unaffected.

---

## Phase E — Shop potions

### Task E1: PotionShop pure module (TDD)

**Files:**
- Create: `src/survivors/PotionShop.ts`
- Test: `tests/potionShop.spec.ts`

- [ ] **Step 1: Failing test**
```typescript
// tests/potionShop.spec.ts
import { describe, it, expect } from 'vitest';
import { POTIONS, POTION_PRICE, potionBuffs, PotionId } from '../src/survivors/PotionShop';

describe('PotionShop', () => {
    it('defines four potions at a flat price', () => {
        expect(POTIONS.map(p => p.id).sort()).toEqual(['lifesteal', 'power', 'rage', 'shield']);
        for (const p of POTIONS) expect(p.price).toBe(POTION_PRICE);
        expect(POTION_PRICE).toBe(500);
    });
    it('empty set = identity buffs', () => {
        const b = potionBuffs(new Set<PotionId>());
        expect(b).toEqual({ powerMult: 1, atkSpeedMult: 1, dmgReductionMult: 1, lifestealAdd: 0 });
    });
    it('each potion maps to the right stat', () => {
        expect(potionBuffs(new Set<PotionId>(['power'])).powerMult).toBeCloseTo(1.2);
        expect(potionBuffs(new Set<PotionId>(['rage'])).atkSpeedMult).toBeCloseTo(1.1);
        expect(potionBuffs(new Set<PotionId>(['shield'])).dmgReductionMult).toBeCloseTo(0.8);
        expect(potionBuffs(new Set<PotionId>(['lifesteal'])).lifestealAdd).toBeCloseTo(0.1);
    });
    it('stacks different potions multiplicatively / additively', () => {
        const b = potionBuffs(new Set<PotionId>(['power', 'rage', 'shield', 'lifesteal']));
        expect(b.powerMult).toBeCloseTo(1.2);
        expect(b.atkSpeedMult).toBeCloseTo(1.1);
        expect(b.dmgReductionMult).toBeCloseTo(0.8);
        expect(b.lifestealAdd).toBeCloseTo(0.1);
    });
});
```

- [ ] **Step 2: Run — FAIL**: `npm test -- potionShop`

- [ ] **Step 3: Implement** `src/survivors/PotionShop.ts`:
```typescript
/** Single-wave consumable potions sold in their own shop row. Pure logic —
 *  the gameplay state owns the active set and folds potionBuffs() into PlayerStats. */
export type PotionId = 'lifesteal' | 'power' | 'shield' | 'rage';

export interface PotionDef {
    id: PotionId;
    name: string;
    desc: string;
    glyph: string;
    price: number;
}

export const POTION_PRICE = 500;

export const POTIONS: PotionDef[] = [
    { id: 'lifesteal', name: 'Lifesteal Potion', desc: '+10% lifesteal',            glyph: '🧪', price: POTION_PRICE },
    { id: 'power',     name: 'Power Potion',     desc: '+20% power damage',         glyph: '⚗️', price: POTION_PRICE },
    { id: 'shield',    name: 'Shield Potion',    desc: '20% damage reduction',      glyph: '🛡️', price: POTION_PRICE },
    { id: 'rage',      name: 'Rage Potion',      desc: '+10% attack speed',         glyph: '🔥', price: POTION_PRICE },
];

export interface PotionBuffs {
    powerMult: number;        // ×powerDamageMultiplier
    atkSpeedMult: number;     // ×basicAttackSpeedMultiplier
    dmgReductionMult: number; // ×damageReductionMultiplier (lower = tankier)
    lifestealAdd: number;     // +lifestealPct
}

/** Resolve the active potion set into stat deltas. Deterministic — same set in,
 *  same buffs out (so applyLevelBonuses can fold it idempotently every recompute). */
export function potionBuffs(active: Set<PotionId>): PotionBuffs {
    return {
        powerMult:        active.has('power')  ? 1.2 : 1,
        atkSpeedMult:     active.has('rage')   ? 1.1 : 1,
        dmgReductionMult: active.has('shield') ? 0.8 : 1,
        lifestealAdd:     active.has('lifesteal') ? 0.1 : 0,
    };
}
```

- [ ] **Step 4: Run — PASS**: `npm test -- potionShop`

- [ ] **Step 5: Commit**
```bash
git add src/survivors/PotionShop.ts tests/potionShop.spec.ts
git commit -m "feat(shop): PotionShop pure module (defs + buff math)"
```

### Task E2: Fold potions into PlayerStats; clear each wave

**Files:**
- Modify: `src/survivors/SurvivorsGameplayState.ts`

- [ ] **Step 1: State fields.** Near `shopPhase`/`currentStock` (~line 538), add:
```typescript
    /** Potions active for the CURRENT combat wave (cleared when the next shop opens). */
    private activePotions = new Set<PotionId>();
    /** Delta-swap tracker for potion lifesteal (additive field, not reset by
     *  applyLevelBonuses — must subtract last contribution to stay idempotent). */
    private potionLifestealApplied = 0;
```
  Import: `import { POTIONS, POTION_PRICE, potionBuffs, PotionId } from './PotionShop';`

- [ ] **Step 2: Fold in applyLevelBonuses.** Just before the "Re-push the multipliers" comment (~line 3881), add:
```typescript
        // Potion buffs (single-wave): multiplicative on top of level+equipment. Lifesteal
        // is additive+shared, so delta-swap it (mirrors the equipment lifesteal tracker).
        const pb = potionBuffs(this.activePotions);
        ps.powerDamageMultiplier      *= pb.powerMult;
        ps.basicAttackSpeedMultiplier *= pb.atkSpeedMult;
        ps.damageReductionMultiplier  *= pb.dmgReductionMult;
        ps.lifestealPct += pb.lifestealAdd - this.potionLifestealApplied;
        this.potionLifestealApplied = pb.lifestealAdd;
```

- [ ] **Step 3: Clear potions when the shop opens.** In the `setOnWaveCleared` callback (~line 1129, where `shopPhase = 'open'`), before `this.openShop()` add:
```typescript
                this.activePotions.clear();
                this.applyLevelBonuses(); // drop last wave's potion buffs (lifesteal delta-swaps back to 0)
```

- [ ] **Step 4: Reset on run exit.** In `exit()` near the `shopPhase`/`currentStock` reset (~line 2751), add:
```typescript
        this.activePotions.clear();
        this.potionLifestealApplied = 0;
```

- [ ] **Step 5: Verify** — `npx tsc --noEmit` clean; `npm test` green.

- [ ] **Step 6: Commit**
```bash
git add src/survivors/SurvivorsGameplayState.ts
git commit -m "feat(shop): fold single-wave potion buffs into PlayerStats"
```

### Task E3: Potion row in the shop overlay + buy handler

**Files:**
- Modify: `src/ui/overlays/ShopOverlay.ts`, `src/survivors/SurvivorsGameplayState.ts`

- [ ] **Step 1: Extend the VM + callbacks** in `ShopOverlay.ts`:
```typescript
export interface PotionCardVM {
    id: string;
    name: string;
    desc: string;
    glyph: string;
    price: number;
    affordable: boolean;
    active: boolean; // already bought for the upcoming wave
}
```
  Add `potions: PotionCardVM[];` to `ShopVM`, and `onBuyPotion(id: string): void;` to `ShopCallbacks`.

- [ ] **Step 2: Render the row.** In `show()`, after the `gridEl` is appended to `mainCol` (~line 85), add a potion row container:
```typescript
        this.potionRowEl = el('div', { class: 'shop-potions' });
        mainCol.appendChild(this.potionRowEl);
```
  Declare `private potionRowEl: HTMLDivElement | null = null;` with the other fields, and null it in `closeSilently()`. In `refresh(vm)`, after the grid loop, add:
```typescript
        if (this.potionRowEl) {
            this.potionRowEl.replaceChildren();
            for (const p of vm.potions) this.potionRowEl.appendChild(this.buildPotionCard(p));
        }
```
  Add the builder:
```typescript
    private buildPotionCard(p: PotionCardVM): HTMLDivElement {
        const poor = !p.affordable && !p.active;
        const root = el('div', {
            class: 'shop-potion' + (poor ? ' shop-potion--poor' : '') + (p.active ? ' shop-potion--active' : ''),
        });
        root.append(
            el('div', { class: 'shop-potion__glyph', text: p.glyph }),
            el('div', { class: 'shop-potion__name', text: p.name }),
            el('div', { class: 'shop-potion__desc', text: p.desc }),
            el('div', { class: 'shop-potion__price', text: p.active ? 'ACTIVE' : `🪙 ${p.price}` }),
        );
        if (!p.active) onTap(root, () => this.callbacks?.onBuyPotion(p.id));
        return root;
    }
```

- [ ] **Step 3: Minimal styles.** Append to `src/ui/styles/components.css` a `.shop-potions` flex row + `.shop-potion` card rules (mirror `.shop-card` sizing; `--active` dims + shows a check tint; `--poor` reduces opacity). Keep it consistent with existing shop card styling.

- [ ] **Step 4: Build the potion VM + wire callbacks.** In `SurvivorsGameplayState.buildShopVM`, add to the returned object:
```typescript
            potions: POTIONS.map(p => ({
                id: p.id, name: p.name, desc: p.desc, glyph: p.glyph, price: p.price,
                affordable: ps.getGold() >= p.price,
                active: this.activePotions.has(p.id),
            })),
```
  In `openShop()`'s callbacks object, add:
```typescript
            onBuyPotion: (id) => this.handlePotionBuy(id as PotionId),
```

- [ ] **Step 5: Buy handler.** Add to SurvivorsGameplayState:
```typescript
    private handlePotionBuy(id: PotionId): void {
        if (!this.playerStats) return;
        if (this.activePotions.has(id)) return;       // one per wave — idempotent
        if (!this.playerStats.spendGold(POTION_PRICE)) {
            this.shopOverlay?.refresh(this.buildShopVM(pickBark('poor')));
            return;
        }
        this.activePotions.add(id);
        this.applyLevelBonuses();                      // fold the new buff now
        this.updateInventoryHud();
        this.shopOverlay?.refresh(this.buildShopVM(pickBark('buy')));
    }
```
  (Confirm `PlayerStats.spendGold` returns a boolean; if it returns void, gate on `getGold() >= POTION_PRICE` first, then `spendGold`.)

- [ ] **Step 6: Verify** — `npx tsc --noEmit` clean; `npm test` green; `npm run build` succeeds.

- [ ] **Step 7: Commit**
```bash
git add src/ui/overlays/ShopOverlay.ts src/survivors/SurvivorsGameplayState.ts src/ui/styles/components.css
git commit -m "feat(shop): dedicated single-wave potion row (lifesteal/power/shield/rage)"
```

---

## Final verification

- [ ] `npx tsc --noEmit` — clean
- [ ] `npm test` — all green (existing ~314 + new potionShop/wave15Swap/elementalCore)
- [ ] `npm run build` — succeeds
- [ ] Manual smoke (documented for the human reviewer, not blocking the PR): reach wave 15 (fire-beetle burn, horned-lizard, super-wizard AOE), wave 25 (Elemental Lord + core ×10 power), buy each potion and confirm it expires after one wave, confirm new shop prices.

---

## Self-Review notes

- **Spec coverage:** wave-15 swap (B1), 4 enemies (B2/B4), assets (B3), co-op+prewarm (B5), Elemental Lord (C1), Elemental Core ×10 (C2), FireBeetle burn (D1/D2), 4 potions one-wave (E1/E2), potion row (E3), pricing (A1). All spec sections mapped.
- **Idempotency:** potion multiplicative fields are re-assigned each recompute (safe); lifesteal uses a delta-swap tracker (`potionLifestealApplied`) exactly like the equipment lifesteal tracker. Elemental Core re-folds via `Math.pow` next to the attack-speed re-fold — the established pattern.
- **Type consistency:** `PotionId`, `potionBuffs`, `POTION_PRICE`, `POTIONS` used identically across PotionShop/state/overlay; `ItemId` gains `elementalCore` in the union, `ITEM_BY_TIER`, `stacks`, and both `Record<ItemId,string>` display maps (TS enforces the maps).
- **Open verification points flagged inline:** exact `glbScale` field in MilestoneBoss (C1.3), `takeDamage` signature (D1.3), `spendGold` return type (E3.5), `seekTargets` element type (B2.4) — each has a fallback instruction.
