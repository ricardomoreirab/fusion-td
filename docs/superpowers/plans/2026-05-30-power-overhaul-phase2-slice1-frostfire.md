# Power Overhaul — Phase 2 (Slice 1): Fusion Archetype Dispatch + Frostfire

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Replace the "run both parents" fusion behavior with authored, emergent **archetypes** — starting with the first one, **Frostfire (fire+ice = Shatter-Burn)** — and in doing so give the Phase 1a/1b foundation its first real in-game exercise.

**Architecture:** A Babylon-free `FusionArchetypeRegistry.ts` holds element-pair→implementation maps. `makeFusionDef` (which must stay Babylon-free + unit-testable) consults the registry at cast/hit time; if no archetype is registered for a pair, it **falls back** to today's parent composition (so the other 9 fusions keep working while we migrate one at a time). The Babylon-aware `FusionArchetypes.ts` defines the actual effects (using `PowerEffects` + the rich statuses) and registers them at module load; a side-effect import wires it in. Frostfire applies Chill (→Freeze) + Burn and primes a burning **shatter** so frozen enemies erupt on death.

**Tech Stack:** TypeScript, BabylonJS, Vitest.

**Context:** Phase 2, slice 1 of the overhaul (spec: `docs/superpowers/specs/2026-05-30-power-system-fusion-ultimate-overhaul-design.md` §6; Phases 1a+1b done — rich statuses, `PowerEffects`, `dealElementalHit`, shatter hook, `StatusStacks` all exist and are wired but **dormant**). Branch: `feat/power-fusion-ultimate-overhaul`. **This slice is the first in-game verification of the entire foundation.** The remaining 9 archetypes are follow-on slices that reuse this scaffolding.

**Environment notes:** Trust `npx tsc --noEmit` + `npm run build` + `npx vitest run`, NOT the IDE (stale false "cannot find module" + pre-existing unused-import warnings). `FusionFactory.ts` and `FusionArchetypeRegistry.ts` MUST stay Babylon-free (no `@babylonjs/core` import, value or transitive) — they're in the Vitest harness. `FusionArchetypes.ts` and `PowerEffects.ts` are Babylon-aware.

---

## File Structure

- **Modify** `src/survivors/enemies/Enemy.ts` — extend `primeShatter` + `onShatterCallback` to carry an element + optional re-applied status; make the `CHILL` apply use `strength` as the stack count.
- **Modify** `src/survivors/SurvivorsGameplayState.ts` — update the `onShatterCallback` wiring to pass element + status to `aoeBurst`; add the side-effect import of `FusionArchetypes`.
- **Create** `src/survivors/powers/FusionArchetypeRegistry.ts` — Babylon-free element-pair→impl registry.
- **Create** `tests/FusionArchetypeRegistry.spec.ts` — unit tests for the registry.
- **Create** `src/survivors/powers/FusionArchetypes.ts` — Babylon-aware archetype impls (Frostfire) + registration.
- **Modify** `src/survivors/powers/FusionFactory.ts` — `makeFusionDef` dispatches to the registry with fallback.

---

## Task 1: Extend shatter (element + re-applied status) and Chill stack count

**Files:**
- Modify: `src/survivors/enemies/Enemy.ts`
- Modify: `src/survivors/SurvivorsGameplayState.ts`

No unit test (Babylon-coupled); verified by `tsc` + build + the Task 5 smoke.

- [ ] **Step 1: Extend the static `onShatterCallback` type** (`Enemy.ts`, ≈line 88)

Replace:
```typescript
    public static onShatterCallback: ((position: Vector3, damage: number, radius: number) => void) | null = null;
```
with:
```typescript
    public static onShatterCallback:
        | ((position: Vector3, damage: number, radius: number, element: PowerElement,
            status?: { effect: StatusEffect; durationS: number; strength: number }) => void)
        | null = null;
```
(`PowerElement` and `StatusEffect` are already imported in `Enemy.ts`.)

- [ ] **Step 2: Extend the shatter priming fields + method** (`Enemy.ts`)

Replace the three priming fields (added in Phase 1a):
```typescript
    private _shatterPrimed: boolean = false;
    private _shatterDamage: number = 0;
    private _shatterRadius: number = 0;
```
with:
```typescript
    private _shatterPrimed: boolean = false;
    private _shatterDamage: number = 0;
    private _shatterRadius: number = 0;
    private _shatterElement: PowerElement = 'ice';
    private _shatterStatus: { effect: StatusEffect; durationS: number; strength: number } | undefined = undefined;
```
Replace the `primeShatter` method:
```typescript
    public primeShatter(damage: number, radius: number): void {
        if (damage <= 0 || radius <= 0) return;
        this._shatterPrimed = true;
        this._shatterDamage = Math.max(this._shatterDamage, damage);
        this._shatterRadius = Math.max(this._shatterRadius, radius);
    }
```
with:
```typescript
    public primeShatter(
        damage: number,
        radius: number,
        element: PowerElement = 'ice',
        status?: { effect: StatusEffect; durationS: number; strength: number },
    ): void {
        if (damage <= 0 || radius <= 0) return;
        this._shatterPrimed = true;
        this._shatterDamage = Math.max(this._shatterDamage, damage);
        this._shatterRadius = Math.max(this._shatterRadius, radius);
        this._shatterElement = element;
        this._shatterStatus = status;
    }
```

- [ ] **Step 3: Pass element + status when firing in `die()`** (`Enemy.ts`)

Replace the shatter-firing block in `die()`:
```typescript
        if (this._shatterPrimed && Enemy.onShatterCallback) {
            Enemy.onShatterCallback(this.position, this._shatterDamage, this._shatterRadius);
        }
        this._shatterPrimed = false;
```
with:
```typescript
        if (this._shatterPrimed && Enemy.onShatterCallback) {
            Enemy.onShatterCallback(this.position, this._shatterDamage, this._shatterRadius, this._shatterElement, this._shatterStatus);
        }
        this._shatterPrimed = false;
```

- [ ] **Step 4: Make `CHILL` use `strength` as the stack count** (`Enemy.ts`, in `applyStatusEffect`)

The Phase 1a `CHILL` case is:
```typescript
            case StatusEffect.CHILL: {
                const chillResult = this.statuses.apply('chill', duration, 0, 1);
                if (chillResult.reachedFreeze) {
```
Replace its `apply` line so `strength` (rounded, ≥1) becomes the stacks added:
```typescript
            case StatusEffect.CHILL: {
                const chillStacks = Math.max(1, Math.round(strength) || 1);
                const chillResult = this.statuses.apply('chill', duration, 0, chillStacks);
                if (chillResult.reachedFreeze) {
```
(Leave the rest of the CHILL case unchanged. This lets an archetype apply N chill stacks per hit to control freeze rate; `strength=0`/unspecified still yields 1.)

- [ ] **Step 5: Update the `onShatterCallback` wiring** (`SurvivorsGameplayState.ts`, in `enter()`)

Replace the Phase 1b wiring:
```typescript
        Enemy.onShatterCallback = (position, damage, radius) => {
            const enemies = this.enemyManager?.getEnemies() ?? [];
            aoeBurst(this.scene!, enemies, position.x, position.z, { radius, damage, element: 'ice' });
        };
```
with:
```typescript
        Enemy.onShatterCallback = (position, damage, radius, element, status) => {
            const enemies = this.enemyManager?.getEnemies() ?? [];
            aoeBurst(this.scene!, enemies, position.x, position.z, { radius, damage, element, status });
        };
```

- [ ] **Step 6: Type-check + build** — `npx tsc --noEmit` → exit 0; `npm run build` → success.
- [ ] **Step 7: Commit**

```bash
git add src/survivors/enemies/Enemy.ts src/survivors/SurvivorsGameplayState.ts
git commit -m "feat(fusion): shatter carries element+status; CHILL strength = stack count"
```

---

## Task 2: `FusionArchetypeRegistry.ts` (Babylon-free) + tests

**Files:**
- Create: `src/survivors/powers/FusionArchetypeRegistry.ts`
- Test: `tests/FusionArchetypeRegistry.spec.ts`

- [ ] **Step 1: Write the failing tests** — create `tests/FusionArchetypeRegistry.spec.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import {
    registerAutocastArchetype, registerPassiveArchetype,
    getAutocastArchetype, getPassiveArchetype, archetypeKey,
} from '../src/survivors/powers/FusionArchetypeRegistry';

describe('FusionArchetypeRegistry', () => {
    it('builds a sorted element-pair key (order-independent)', () => {
        expect(archetypeKey('fire', 'ice')).toBe('fire_ice');
        expect(archetypeKey('ice', 'fire')).toBe('fire_ice');
        expect(archetypeKey('storm', 'physical')).toBe('physical_storm');
    });

    it('stores and retrieves autocast + passive archetypes by key', () => {
        const auto = () => {};
        const pass = () => {};
        registerAutocastArchetype('fire_ice', auto);
        registerPassiveArchetype('fire_ice', pass);
        expect(getAutocastArchetype('fire_ice')).toBe(auto);
        expect(getPassiveArchetype('fire_ice')).toBe(pass);
    });

    it('returns undefined for unregistered keys', () => {
        expect(getAutocastArchetype('arcane_storm')).toBeUndefined();
        expect(getPassiveArchetype('arcane_storm')).toBeUndefined();
    });
});
```

- [ ] **Step 2: Run → FAIL** — `npx vitest run tests/FusionArchetypeRegistry.spec.ts` → FAIL (module missing).

- [ ] **Step 3: Implement** — create `src/survivors/powers/FusionArchetypeRegistry.ts`:

```typescript
// Babylon-free registry mapping a sorted element-pair key → fusion archetype impl.
// makeFusionDef (also Babylon-free) consults this at cast/hit time; the Babylon
// implementations register themselves at startup from FusionArchetypes.ts. Keeping
// this module Babylon-free preserves FusionFactory's node-only unit-testability.
import type { PowerRuntimeState, PowerContext, EnchantmentHitContext, PowerElement } from './PowerDefinitions';

const ELEMENT_ORDER: PowerElement[] = ['fire', 'ice', 'arcane', 'physical', 'storm'];

/** Autocast archetype: deliver the fusion's effect. `damage` is the fully-scaled
 *  per-cast damage (damageFor × multipliers) the archetype should base hits on. */
export type AutocastArchetype = (state: PowerRuntimeState, ctx: PowerContext, damage: number) => void;
/** Passive (enchantment) archetype: triggered on each basic-attack hit. */
export type PassiveArchetype = (enemy: import('../enemies/Enemy').Enemy, level: number, ctx: EnchantmentHitContext) => void;

/** Sorted `elemA_elemB` key — order-independent. */
export function archetypeKey(a: PowerElement, b: PowerElement): string {
    return ELEMENT_ORDER.indexOf(a) <= ELEMENT_ORDER.indexOf(b) ? `${a}_${b}` : `${b}_${a}`;
}

const autocastReg = new Map<string, AutocastArchetype>();
const passiveReg = new Map<string, PassiveArchetype>();

export function registerAutocastArchetype(key: string, fn: AutocastArchetype): void { autocastReg.set(key, fn); }
export function registerPassiveArchetype(key: string, fn: PassiveArchetype): void { passiveReg.set(key, fn); }
export function getAutocastArchetype(key: string): AutocastArchetype | undefined { return autocastReg.get(key); }
export function getPassiveArchetype(key: string): PassiveArchetype | undefined { return passiveReg.get(key); }
```

- [ ] **Step 4: Run → PASS** — `npx vitest run tests/FusionArchetypeRegistry.spec.ts` → PASS.
- [ ] **Step 5: Type-check** — `npx tsc --noEmit` → exit 0.
- [ ] **Step 6: Commit**

```bash
git add src/survivors/powers/FusionArchetypeRegistry.ts tests/FusionArchetypeRegistry.spec.ts
git commit -m "feat(fusion): Babylon-free fusion-archetype registry + tests"
```

---

## Task 3: `FusionArchetypes.ts` — the Frostfire archetype (autocast + passive)

**Files:**
- Create: `src/survivors/powers/FusionArchetypes.ts`
- Modify: `src/survivors/SurvivorsGameplayState.ts` (side-effect import)

No unit test (Babylon-coupled); verified by `tsc` + build + the Task 5 smoke.

- [ ] **Step 1: Create `src/survivors/powers/FusionArchetypes.ts`**

```typescript
// Babylon-aware fusion archetype implementations. Each authored archetype gives a
// fused power EMERGENT behavior (not just its two parents combined). Registers into
// the Babylon-free FusionArchetypeRegistry at module load; a side-effect import in
// SurvivorsGameplayState ensures registration runs before any fusion is cast.
import { StatusEffect } from '../GameTypes';
import { dealElementalHit, aoeBurst } from './PowerEffects';
import { registerAutocastArchetype, registerPassiveArchetype, archetypeKey } from './FusionArchetypeRegistry';
import type { Enemy } from '../enemies/Enemy';
import type { PowerElement, PowerContext, EnchantmentHitContext } from './PowerDefinitions';

/** Nearest live enemy to a point within `range` (or null). */
function nearestEnemy(enemies: Enemy[], x: number, z: number, range: number): Enemy | null {
    let best: Enemy | null = null;
    let bestD2 = range * range;
    for (const e of enemies) {
        if (!e.isAlive()) continue;
        const p = e.getPosition();
        const dx = p.x - x, dz = p.z - z;
        const d2 = dx * dx + dz * dz;
        if (d2 <= bestD2) { bestD2 = d2; best = e; }
    }
    return best;
}

// ── Frostfire (fire+ice) — Shatter-Burn ─────────────────────────────────────
// Applies Chill (stacks → Freeze) + Burn, and primes a BURNING shatter so an
// enemy that dies while frozen erupts in a burning nova (re-applying burn to
// neighbours). The emergent loop: freeze sets up the kill, the kill spreads fire.
const FROSTFIRE_RANGE = 12;

function applyFrostfire(scene: PowerContext['scene'], enemies: Enemy[], target: Enemy, damage: number, element: PowerElement): void {
    dealElementalHit(scene, enemies, target, damage, element);
    if (!target.isAlive()) return;
    target.applyStatusEffect(StatusEffect.CHILL, 2.5, 2);                 // +2 chill stacks (→ freeze at 7)
    target.applyStatusEffect(StatusEffect.BURNING, 2.5, damage * 0.15);  // burn DoT (0.15·dmg per 0.5s stack)
    // On a frozen death, erupt: burning nova that re-applies burn to neighbours.
    target.primeShatter(damage * 0.6, 2.8, 'fire',
        { effect: StatusEffect.BURNING, durationS: 2, strength: damage * 0.1 });
}

registerAutocastArchetype(archetypeKey('fire', 'ice'), (_state, ctx, damage) => {
    const target = nearestEnemy(ctx.enemies, ctx.heroPosition.x, ctx.heroPosition.z, FROSTFIRE_RANGE);
    if (!target) return;
    applyFrostfire(ctx.scene, ctx.enemies, target, damage, ctx.element);
    // Small frost-fire splash around the impact for feel + minor AoE.
    const p = target.getPosition();
    aoeBurst(ctx.scene, ctx.enemies, p.x, p.z, { radius: 1.8, damage: damage * 0.4, element: ctx.element });
});

registerPassiveArchetype(archetypeKey('fire', 'ice'), (enemy, level, ctx: EnchantmentHitContext) => {
    const damage = ctx.baseDamage * (0.3 + 0.2 * level);
    applyFrostfire(ctx.scene, ctx.enemies, enemy, damage, ctx.element);
});
```

- [ ] **Step 2: Add the side-effect import** in `SurvivorsGameplayState.ts`

After the existing `import { aoeBurst, setCameraShakeHook, resetPowerEffects } from './powers/PowerEffects';` line, add:
```typescript
import './powers/FusionArchetypes'; // registers fusion archetypes at load
```

- [ ] **Step 3: Type-check + build** — `npx tsc --noEmit` → exit 0; `npm run build` → success.
- [ ] **Step 4: Commit**

```bash
git add src/survivors/powers/FusionArchetypes.ts src/survivors/SurvivorsGameplayState.ts
git commit -m "feat(fusion): Frostfire archetype (Shatter-Burn) + registration"
```

---

## Task 4: `makeFusionDef` dispatch to archetypes (with fallback)

**Files:**
- Modify: `src/survivors/powers/FusionFactory.ts`

`FusionFactory.ts` stays Babylon-free: it imports ONLY the Babylon-free registry (type-only `PowerDefinitions` already). `FusionFactory.spec.ts` must still pass (the tests don't register any archetype, so every fusion takes the fallback = current behavior).

- [ ] **Step 1: Add the registry import**

At the top of `FusionFactory.ts`, after the existing `import type { … } from './PowerDefinitions';` block, add:
```typescript
import { archetypeKey, getAutocastArchetype, getPassiveArchetype } from './FusionArchetypeRegistry';
```

- [ ] **Step 2: Compute the archetype key in `makeFusionDef`**

In `makeFusionDef`, after the line `const [e1, e2] = sortElems(a.element, b.element);`, add:
```typescript
    const archKey = archetypeKey(a.element, b.element);
```

- [ ] **Step 3: Dispatch the passive branch with fallback**

Replace the passive branch:
```typescript
    if (a.mode === 'passive') {
        def.onHit = (enemy, level, ctx: EnchantmentHitContext) => {
            for (const p of parents) p.onHit?.(enemy, level, ctx);
            enemy.takeDamage(ctx.baseDamage * FUSION_PASSIVE_BONUS * level);
        };
        def.rangeBonus = (level) =>
            parents.reduce((sum, p) => sum + (p.rangeBonus ? p.rangeBonus(level) : 0), 0);
    } else {
```
with:
```typescript
    if (a.mode === 'passive') {
        def.onHit = (enemy, level, ctx: EnchantmentHitContext) => {
            const arch = getPassiveArchetype(archKey);
            if (arch) { arch(enemy, level, ctx); return; }
            // Fallback (un-migrated pair): run both parents + the flat fusion bonus.
            for (const p of parents) p.onHit?.(enemy, level, ctx);
            enemy.takeDamage(ctx.baseDamage * FUSION_PASSIVE_BONUS * level);
        };
        def.rangeBonus = (level) =>
            parents.reduce((sum, p) => sum + (p.rangeBonus ? p.rangeBonus(level) : 0), 0);
    } else {
```

- [ ] **Step 4: Dispatch the autocast branch with fallback**

Replace the autocast branch:
```typescript
        def.cast = (state, ctx) => {
            const subs = ensureSubStates(state, ctx);
            const synthCtx: PowerContext = { ...ctx, damageMultiplier: ctx.damageMultiplier * FUSION_DMG };
            for (const p of parents) {
                const sub = subs[p.id];
                sub.level = state.level;
                p.cast?.(sub, synthCtx);
            }
        };
```
with:
```typescript
        def.cast = (state, ctx) => {
            const arch = getAutocastArchetype(archKey);
            if (arch) { arch(state, ctx, def.damageFor(state) * ctx.damageMultiplier); return; }
            // Fallback (un-migrated pair): run both parents at the fusion damage bump.
            const subs = ensureSubStates(state, ctx);
            const synthCtx: PowerContext = { ...ctx, damageMultiplier: ctx.damageMultiplier * FUSION_DMG };
            for (const p of parents) {
                const sub = subs[p.id];
                sub.level = state.level;
                p.cast?.(sub, synthCtx);
            }
        };
```

- [ ] **Step 5: Confirm `FusionFactory.ts` stays Babylon-free** — `FusionArchetypeRegistry` imports only type-only `PowerDefinitions` (no Babylon). Verify no new value import of `@babylonjs/core` crept in.

- [ ] **Step 6: Run the fusion-factory unit tests** — `npx vitest run tests/FusionFactory.spec.ts` → PASS (no archetypes registered in the test → every fusion uses the fallback = original behavior, so all 10 tests stay green).

- [ ] **Step 7: Type-check + build** — `npx tsc --noEmit` → exit 0; `npm run build` → success.

- [ ] **Step 8: Commit**

```bash
git add src/survivors/powers/FusionFactory.ts
git commit -m "feat(fusion): makeFusionDef dispatches to archetypes (fallback to parents)"
```

---

## Task 5: Full verification + in-game smoke (first real foundation test)

**Files:** none.

- [ ] **Step 1: Full unit suite** — `npm test` → all pass (StatusModel, StatusReactions, FusionFactory, the new FusionArchetypeRegistry, etc.).
- [ ] **Step 2: Type-check** — `npx tsc --noEmit` → exit 0.
- [ ] **Step 3: Build** — `npm run build` → success (pre-existing entrypoint-size warnings only).
- [ ] **Step 4: In-game smoke — THIS is the first end-to-end test of Phases 1a+1b+2.** Run `npm start`. Pick the **mage** (autocast) for the clearest read. Level a **Fire** power and an **Ice** power to 5, then take the **Frostfire** fusion offer. Then over a couple of waves confirm:
  - Frostfire auto-casts at the nearest enemy: target takes damage, gets a small frost-fire splash ring, a **burn DoT** (orange ticking damage numbers), and accrues **chill** (it visibly slows; after enough stacks it **freezes**).
  - A **frozen enemy that dies erupts in a burning nova** (an expanding fire ring) that damages + re-burns nearby enemies — the Shatter-Burn payoff.
  - The other (un-migrated) fusions still behave as before (spot-check one, e.g. a storm-pair fusion, still fires its parent effects).
  - **No `[resource-watchdog] LEAK SUSPECTED`** and no `[freeze:longtask]` over several wave clears of heavy Frostfire casting; `materials`/`textures` stay near baseline (FX materials are cached by element — a small bounded set). If the watchdog fires, the named prefix is the leak — STOP and treat as a regression.
- [ ] **Step 5: Final commit (if any tweaks)**

```bash
git add -A && git commit -m "test(fusion): Phase 2 slice-1 verification pass" || echo "nothing to commit"
```

---

## Notes for the implementer

- **Why a registry + fallback:** `makeFusionDef` must stay Babylon-free (its `FusionFactory.spec.ts` runs under node). The registry is the Babylon-free seam; the Babylon archetype code registers into it at load. The fallback means migrating one element-pair doesn't disturb the other nine.
- **Freeze rate is tunable** via the chill stacks per hit (Frostfire applies 2) and `STATUS_TUNING.chill.freezeAtStacks` (7). If freezing feels too slow/fast in the smoke, adjust the `applyStatusEffect(CHILL, …, 2)` strength argument — don't change the threshold for one archetype.
- **Shatter is now flexible:** `primeShatter(damage, radius, element, status?)` lets each archetype choose its shatter flavour (Frostfire = fire + re-burn). The generic Phase 1b ice shatter is just the default.
- **Parent `init`/`dispose` for future archetypes:** an archetype fusion still runs `makeFusionDef`'s `def.init`/`def.dispose`, which create + tear down the parents' sub-states. For Frostfire this is harmless (Fireball/Frost Shards have no persistent `init`). But when migrating an archetype whose parent has a **persistent `init`** (e.g. Whirling Blades spawns orbiting blade meshes, Seeking Arrow an orbiting orb), gate `def.init`/`def.dispose` on archetype presence (`if (!getAutocastArchetype(archKey) && !getPassiveArchetype(archKey)) …`) so unused parent meshes aren't spawned/leaked. Add that gating in the slice that first migrates such a pair — not needed here.
- **Next slices:** the remaining 9 archetypes (Hexflame, Molten Edge, Tempest Ember/Overload, Rimecaster/Vortex, Glacial Edge, Blizzard, Runeblade, Voltaic Rune/Arc-Split, Thunderstrike/Chain-Shrapnel) each register one autocast + one passive impl in `FusionArchetypes.ts`, reusing `PowerEffects` (`chainHit`, `gatherVortex`, `persistentZone`, `omniVolley`) — no further changes to `FusionFactory`/registry needed.
