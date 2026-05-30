# Power Overhaul — Phase 1a: Rich Status System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a stacking, threshold-driven status model (chill→freeze, burn-stacking-with-overflow, curse %HP drain, fragile damage-amp) plus a status cross-reaction registry, as the foundation the fusion/ultimate rework will build on.

**Architecture:** A Babylon-free `StatusStacks` class (`StatusModel.ts`) owns the math for the four *rich* status kinds (burn, chill, curse, fragile) and is unit-tested in isolation. `Enemy` holds one `StatusStacks` instance and routes the new statuses through it each frame, applying its outputs (DoT damage, chill-slow, chill→freeze conversion) to the existing enemy state. Legacy CC (slow/freeze/stun/push/confused) and the freeze/stun immunity windows stay exactly as they are. A separate Babylon-free `StatusReactions` registry maps `(element, status) → reaction` for the synergy engine (consumed in Phase 1b).

**Tech Stack:** TypeScript, BabylonJS, Vitest (node, pure-logic only).

**Context for this plan:** This is **Phase 1a** of the power-system overhaul (design doc: `docs/superpowers/specs/2026-05-30-power-system-fusion-ultimate-overhaul-design.md`). It is self-contained and shippable: the status math is unit-tested and the new statuses become usable in-game. Phase 1b (effect-primitive library + FX helpers) and Phases 2–3 (fusion rework, ultimates) get their own plans. Branch: `feat/power-fusion-ultimate-overhaul` (already created).

---

## File Structure

- **Create** `src/survivors/powers/StatusModel.ts` — `StatusStacks` class + `STATUS_TUNING` constants. Babylon-free. One responsibility: rich-status stack math.
- **Create** `src/survivors/powers/StatusReactions.ts` — element×status reaction registry. Babylon-free. One responsibility: synergy lookups.
- **Create** `tests/StatusModel.spec.ts` — unit tests for `StatusStacks`.
- **Create** `tests/StatusReactions.spec.ts` — unit tests for the registry.
- **Modify** `src/survivors/GameTypes.ts:30-38` — add `CHILL`, `CURSE`, `FRAGILE` to `StatusEffect`.
- **Modify** `src/survivors/enemies/Enemy.ts` — hold a `StatusStacks`; route burn/chill/curse/fragile through it; apply Fragile amp in `takeDamage`; shatter-on-death hook in `die()`.

**Convention notes (read before writing code):**
- `StatusModel.ts` / `StatusReactions.ts` MUST NOT import `@babylonjs/core` (directly or transitively) — they are included in the Vitest harness (`vitest.config.ts` includes `tests/**`, and tests import these). The pattern mirrors the existing Babylon-free `FusionFactory.ts`.
- Time is passed in **seconds** (`dtS`) — never call `performance.now()` inside `StatusModel.ts` (it must be deterministic for tests).
- All material/leak discipline (CLAUDE.md) is a Phase 1b concern; Phase 1a adds no new meshes/materials except the shatter callback *hook* (the actual AoE mesh is Phase 1b).

---

## Task 1: Add rich status kinds to the `StatusEffect` enum

**Files:**
- Modify: `src/survivors/GameTypes.ts:30-38`

- [ ] **Step 1: Add the three new enum members**

Replace the `StatusEffect` enum (currently lines 30-38) with:

```typescript
export enum StatusEffect {
    NONE = 'none',
    BURNING = 'burning',
    SLOWED = 'slowed',
    FROZEN = 'frozen',
    STUNNED = 'stunned',
    PUSHED = 'pushed',
    CONFUSED = 'confused',
    /** Stacking soft-CC; at threshold it converts to FROZEN (see StatusModel). */
    CHILL = 'chill',
    /** Drains a fraction of max HP per second (mark-for-death). */
    CURSE = 'curse',
    /** Stacking amplifier: raises incoming direct damage. */
    FRAGILE = 'fragile',
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS (no errors). The new members are unused so far; this only widens the enum.

- [ ] **Step 3: Commit**

```bash
git add src/survivors/GameTypes.ts
git commit -m "feat(status): add CHILL, CURSE, FRAGILE status kinds"
```

---

## Task 2: `StatusStacks` model + tuning (TDD)

**Files:**
- Create: `src/survivors/powers/StatusModel.ts`
- Test: `tests/StatusModel.spec.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/StatusModel.spec.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { StatusStacks, STATUS_TUNING } from '../src/survivors/powers/StatusModel';

describe('StatusStacks — burn', () => {
    it('stacks additively and ticks stacks*strength per interval', () => {
        const s = new StatusStacks();
        s.apply('burn', 5, /*strength*/ 2, /*addStacks*/ 3); // 3 stacks, 2 dmg/stack/tick
        expect(s.stacks('burn')).toBe(3);
        // below the 0.5s interval → no damage yet
        expect(s.tick(0.25, 100).burnDamage).toBe(0);
        // crossing the interval → 3 stacks × 2 = 6
        expect(s.tick(0.25, 100).burnDamage).toBe(6);
    });

    it('caps at maxStacks and detonates the pool when applied over cap', () => {
        const s = new StatusStacks();
        s.apply('burn', 5, 2, STATUS_TUNING.burn.maxStacks); // exactly at cap
        expect(s.stacks('burn')).toBe(STATUS_TUNING.burn.maxStacks);
        const r = s.apply('burn', 5, 2, 1); // one more → overflow
        expect(r.overflowDetonate).toBeCloseTo(
            STATUS_TUNING.burn.maxStacks * 2 * STATUS_TUNING.burn.overflowFactor, 5,
        );
        expect(s.stacks('burn')).toBe(STATUS_TUNING.burn.maxStacks); // stays capped, not consumed
    });
});

describe('StatusStacks — chill', () => {
    it('accumulates stacks and slows, with a floor', () => {
        const s = new StatusStacks();
        s.apply('chill', 3, 0, 5); // 5 stacks, below the 7-stack freeze threshold
        const m = s.tick(0.016, 100).chillSlowMultiplier;
        expect(m).toBeCloseTo(Math.max(STATUS_TUNING.chill.slowFloor, 1 - 5 * STATUS_TUNING.chill.slowPerStack), 5);
        expect(m).toBeGreaterThanOrEqual(STATUS_TUNING.chill.slowFloor);
    });

    it('signals freeze at the threshold and consumes chill', () => {
        const s = new StatusStacks();
        s.apply('chill', 3, 0, 6); // 6 stacks, no freeze yet
        expect(s.apply('chill', 3, 0, 1).reachedFreeze).toBe(true); // 7th → freeze
        expect(s.has('chill')).toBe(false); // consumed
    });
});

describe('StatusStacks — fragile', () => {
    it('amplifies incoming damage, capped at maxStacks', () => {
        const s = new StatusStacks();
        expect(s.damageAmplifier()).toBe(1);
        s.apply('fragile', 5, 0, 3);
        expect(s.damageAmplifier()).toBeCloseTo(1 + 3 * STATUS_TUNING.fragile.ampPerStack, 5);
        s.apply('fragile', 5, 0, 999); // over cap
        expect(s.stacks('fragile')).toBe(STATUS_TUNING.fragile.maxStacks);
        expect(s.damageAmplifier()).toBeCloseTo(
            1 + STATUS_TUNING.fragile.maxStacks * STATUS_TUNING.fragile.ampPerStack, 5,
        );
    });
});

describe('StatusStacks — curse', () => {
    it('drains a fraction of max HP per second continuously', () => {
        const s = new StatusStacks();
        s.apply('curse', 5, /*strength = 3%/s*/ 0.03);
        // 0.5s at 3%/s of 200 maxHP = 0.5 * 0.03 * 200 = 3
        expect(s.tick(0.5, 200).curseDamage).toBeCloseTo(3, 5);
    });
});

describe('StatusStacks — expiry', () => {
    it('removes a kind when its timer runs out and reports it', () => {
        const s = new StatusStacks();
        s.apply('fragile', 1, 0, 2);
        expect(s.tick(0.6, 100).expired).toEqual([]);
        const r = s.tick(0.6, 100); // total 1.2s > 1s
        expect(r.expired).toContain('fragile');
        expect(s.has('fragile')).toBe(false);
    });

    it('clear() empties everything; clear(kind) removes one', () => {
        const s = new StatusStacks();
        s.apply('burn', 5, 2, 1);
        s.apply('curse', 5, 0.02);
        s.clear('burn');
        expect(s.has('burn')).toBe(false);
        expect(s.has('curse')).toBe(true);
        s.clear();
        expect(s.has('curse')).toBe(false);
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/StatusModel.spec.ts`
Expected: FAIL — "Cannot find module '../src/survivors/powers/StatusModel'".

- [ ] **Step 3: Implement `StatusModel.ts`**

Create `src/survivors/powers/StatusModel.ts`:

```typescript
// Babylon-free. Pure stack math for the four RICH status kinds:
//   burn   — stacking DoT, capped, overflow-detonates when applied past cap
//   chill  — stacking soft-slow that converts to a Freeze at threshold
//   curse  — drains a fraction of MAX HP per second
//   fragile — stacking amplifier that raises incoming direct damage
// Legacy CC (slow/freeze/stun/push/confused) stays in Enemy.ts unchanged.
// MUST NOT import @babylonjs/core — this module is unit-tested under node.

export type RichStatusKind = 'burn' | 'chill' | 'curse' | 'fragile';

export const STATUS_TUNING = {
    burn:    { tickIntervalS: 0.5, maxStacks: 20, overflowFactor: 2 },
    chill:   { freezeAtStacks: 7, slowPerStack: 0.08, slowFloor: 0.2, freezeDurationS: 2 },
    fragile: { maxStacks: 10, ampPerStack: 0.05 },
} as const;

interface Track {
    stacks: number;
    remainingS: number;
    /** burn: damage per stack per tick · curse: fraction of maxHP per second. */
    strength: number;
}

export interface ApplyResult {
    /** Burst damage to deal NOW because burn was applied at/over cap (0 otherwise). */
    overflowDetonate: number;
    /** True when chill reached the freeze threshold — caller should apply Freeze. */
    reachedFreeze: boolean;
}

export interface StatusTickResult {
    burnDamage: number;   // deal as element 'fire'
    curseDamage: number;  // deal as element 'arcane'
    /** Speed multiplier from chill, in [slowFloor..1]. 1 when no chill present. */
    chillSlowMultiplier: number;
    /** Rich kinds whose timer expired this tick (already removed from state). */
    expired: RichStatusKind[];
}

export class StatusStacks {
    private tracks = new Map<RichStatusKind, Track>();
    private burnTickAcc = 0;

    has(kind: RichStatusKind): boolean { return this.tracks.has(kind); }
    stacks(kind: RichStatusKind): number { return this.tracks.get(kind)?.stacks ?? 0; }

    /** 1 + fragileStacks × ampPerStack. Multiply incoming direct damage by this. */
    damageAmplifier(): number {
        const f = this.tracks.get('fragile');
        return f ? 1 + f.stacks * STATUS_TUNING.fragile.ampPerStack : 1;
    }

    /**
     * Apply (or refresh) a rich status.
     * @param strength burn: damage per stack per tick · curse: fraction of maxHP/s · others: unused
     * @param addStacks number of stacks to add (default 1)
     */
    apply(kind: RichStatusKind, durationS: number, strength = 0, addStacks = 1): ApplyResult {
        const res: ApplyResult = { overflowDetonate: 0, reachedFreeze: false };
        switch (kind) {
            case 'burn': {
                const t = this.tracks.get('burn');
                const dmg = Math.max(t?.strength ?? 0, strength);
                if (t && t.stacks >= STATUS_TUNING.burn.maxStacks) {
                    // At cap: applying more detonates the pool; stacks stay capped.
                    res.overflowDetonate = t.stacks * t.strength * STATUS_TUNING.burn.overflowFactor;
                    t.remainingS = Math.max(t.remainingS, durationS);
                    t.strength = dmg;
                } else {
                    const stacks = Math.min(STATUS_TUNING.burn.maxStacks, (t?.stacks ?? 0) + addStacks);
                    this.tracks.set('burn', { stacks, remainingS: durationS, strength: dmg });
                }
                break;
            }
            case 'chill': {
                const stacks = (this.tracks.get('chill')?.stacks ?? 0) + addStacks;
                if (stacks >= STATUS_TUNING.chill.freezeAtStacks) {
                    this.tracks.delete('chill'); // consumed into a Freeze (caller applies it)
                    res.reachedFreeze = true;
                } else {
                    this.tracks.set('chill', { stacks, remainingS: durationS, strength: 0 });
                }
                break;
            }
            case 'curse': {
                const t = this.tracks.get('curse');
                this.tracks.set('curse', {
                    stacks: 1,
                    remainingS: Math.max(t?.remainingS ?? 0, durationS),
                    strength: Math.max(t?.strength ?? 0, strength),
                });
                break;
            }
            case 'fragile': {
                const stacks = Math.min(
                    STATUS_TUNING.fragile.maxStacks,
                    (this.tracks.get('fragile')?.stacks ?? 0) + addStacks,
                );
                this.tracks.set('fragile', { stacks, remainingS: durationS, strength: 0 });
                break;
            }
        }
        return res;
    }

    /** Advance all timers by dtS; return DoT damage + chill slow + expiries. */
    tick(dtS: number, maxHp: number): StatusTickResult {
        const out: StatusTickResult = { burnDamage: 0, curseDamage: 0, chillSlowMultiplier: 1, expired: [] };
        if (this.tracks.size === 0) { this.burnTickAcc = 0; return out; }

        const burn = this.tracks.get('burn');
        if (burn) {
            this.burnTickAcc += dtS;
            if (this.burnTickAcc >= STATUS_TUNING.burn.tickIntervalS) {
                out.burnDamage = burn.stacks * burn.strength;
                this.burnTickAcc -= STATUS_TUNING.burn.tickIntervalS;
            }
        } else {
            this.burnTickAcc = 0;
        }

        const curse = this.tracks.get('curse');
        if (curse) out.curseDamage = maxHp * curse.strength * dtS;

        const chill = this.tracks.get('chill');
        if (chill) {
            out.chillSlowMultiplier = Math.max(
                STATUS_TUNING.chill.slowFloor,
                1 - chill.stacks * STATUS_TUNING.chill.slowPerStack,
            );
        }

        for (const [kind, t] of this.tracks) {
            t.remainingS -= dtS;
            if (t.remainingS <= 0) out.expired.push(kind);
        }
        for (const kind of out.expired) this.tracks.delete(kind);
        return out;
    }

    clear(kind?: RichStatusKind): void {
        if (kind) this.tracks.delete(kind);
        else this.tracks.clear();
    }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/StatusModel.spec.ts`
Expected: PASS — all describe-blocks green.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/survivors/powers/StatusModel.ts tests/StatusModel.spec.ts
git commit -m "feat(status): StatusStacks model (burn/chill/curse/fragile) + unit tests"
```

---

## Task 3: `StatusReactions` registry (TDD)

**Files:**
- Create: `src/survivors/powers/StatusReactions.ts`
- Test: `tests/StatusReactions.spec.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/StatusReactions.spec.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { getReaction, registerReaction } from '../src/survivors/powers/StatusReactions';

describe('StatusReactions', () => {
    it('returns the built-in Overload reaction for storm hitting a burning enemy', () => {
        expect(getReaction('storm', 'burn')).toEqual({ kind: 'overload' });
    });

    it('returns undefined for an unmapped pair', () => {
        expect(getReaction('ice', 'burn')).toBeUndefined();
        expect(getReaction('storm', 'fragile')).toBeUndefined();
    });

    it('lets callers register new reactions', () => {
        registerReaction('fire', 'chill', { kind: 'overload' });
        expect(getReaction('fire', 'chill')).toEqual({ kind: 'overload' });
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/StatusReactions.spec.ts`
Expected: FAIL — "Cannot find module '../src/survivors/powers/StatusReactions'".

- [ ] **Step 3: Implement `StatusReactions.ts`**

Create `src/survivors/powers/StatusReactions.ts`:

```typescript
// Babylon-free synergy registry: (incoming element, present status) -> reaction.
// Consumed by Phase 1b's dealElementalHit to fire cross-element combos
// (e.g. a storm hit on a Burning enemy detonates the burn — "Overload").
// MUST NOT import @babylonjs/core.
import type { RichStatusKind } from './StatusModel';

/** Element string matches PowerElement ('fire'|'ice'|'arcane'|'physical'|'storm'). */
export type ReactionKind = 'overload';

export interface Reaction {
    kind: ReactionKind;
}

const REACTIONS = new Map<string, Reaction>();

function key(element: string, status: RichStatusKind): string {
    return `${element}:${status}`;
}

export function registerReaction(element: string, status: RichStatusKind, reaction: Reaction): void {
    REACTIONS.set(key(element, status), reaction);
}

export function getReaction(element: string, status: RichStatusKind): Reaction | undefined {
    return REACTIONS.get(key(element, status));
}

// Built-in reactions.
registerReaction('storm', 'burn', { kind: 'overload' });
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/StatusReactions.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/survivors/powers/StatusReactions.ts tests/StatusReactions.spec.ts
git commit -m "feat(status): cross-reaction registry (storm+burn -> overload)"
```

---

## Task 4: Route burn/chill/curse/fragile through `StatusStacks` in `Enemy`

**Files:**
- Modify: `src/survivors/enemies/Enemy.ts` (import + field ~line 3/185; `applyStatusEffect` 873-922; `updateStatusEffects` 750-769; `processBurningEffect` 853-865; `takeDamage` 1121-1140)

This task keeps the legacy SLOWED/FROZEN/STUNNED/PUSHED/CONFUSED handling and the immunity windows exactly as-is, and moves burn + the three new kinds onto the model. There is no unit test (it requires a Babylon scene); verification is `tsc` + `build` + manual smoke at the end (Task 6).

- [ ] **Step 1: Add the import**

At the top of `Enemy.ts`, the line `import { EnemyType, StatusEffect } from '../GameTypes';` (line 3) stays. Directly below the existing imports add:

```typescript
import { StatusStacks, STATUS_TUNING } from '../powers/StatusModel';
```

- [ ] **Step 2: Add the `statuses` field**

Find the status-effect fields (line ~185, `protected activeStatusEffects: Map<...>`). Immediately below `protected statusEffectParticles: Map<StatusEffect, ParticleSystem> = new Map();` add:

```typescript
    /** Rich-status stack model (burn/chill/curse/fragile). Legacy CC (slow/
     *  freeze/stun) still lives in activeStatusEffects above. */
    protected statuses: StatusStacks = new StatusStacks();
```

- [ ] **Step 3: Route burn + new kinds in `applyStatusEffect`**

Replace the `BURNING` case (lines 879-884) with this, and add the three new cases. The `BURNING` case stops mutating `burnDamagePerTick`/`lastBurnDamageTime` (the model owns burn now) but still spawns the existing particles:

```typescript
            case StatusEffect.BURNING: {
                // strength = damage per stack per 0.5s tick (preserves legacy feel).
                const r = this.statuses.apply('burn', duration, strength, 1);
                if (r.overflowDetonate > 0) this.takeDamage(r.overflowDetonate, 'fire');
                this.createStatusEffectParticles(effect);
                break;
            }

            case StatusEffect.CHILL: {
                const r = this.statuses.apply('chill', duration, 0, 1);
                if (r.reachedFreeze) {
                    // Convert to a real Freeze through the normal (immunity-gated) path.
                    this.applyStatusEffect(StatusEffect.FROZEN, STATUS_TUNING.chill.freezeDurationS, 1);
                } else {
                    this.createStatusEffectParticles(StatusEffect.SLOWED); // reuse slow visual
                }
                break;
            }

            case StatusEffect.CURSE: {
                // strength = fraction of MAX HP drained per second.
                this.statuses.apply('curse', duration, strength, 1);
                this.createStatusEffectParticles(effect);
                break;
            }

            case StatusEffect.FRAGILE: {
                this.statuses.apply('fragile', duration, 0, 1);
                // No dedicated particle; amplifier is felt via bigger damage numbers.
                break;
            }
```

> Note: `createStatusEffectParticles` switches on the effect kind. If it has no branch for `CURSE`, that call is a safe no-op only if the method tolerates unknown kinds. Verify in Step 7; if it throws/early-returns cleanly for unknown kinds, leave as-is, otherwise drop the `createStatusEffectParticles(effect)` call in the CURSE case.

- [ ] **Step 4: Tick the model in `updateStatusEffects`**

Replace the body of `updateStatusEffects` (lines 750-769) with:

```typescript
    protected updateStatusEffects(deltaTime: number): void {
        // ── Rich statuses (model-owned: burn/chill/curse/fragile) ──
        const rich = this.statuses.tick(deltaTime, this.maxHealth);
        if (rich.burnDamage > 0 && this.alive) this.takeDamage(rich.burnDamage, 'fire');
        if (rich.curseDamage > 0 && this.alive) this.takeDamage(rich.curseDamage, 'arcane');
        if (this.alive && !this.isFrozen && !this.isStunned && rich.chillSlowMultiplier < 1) {
            this.speed = this.originalSpeed * rich.chillSlowMultiplier;
        }
        for (let i = 0; i < rich.expired.length; i++) {
            if (rich.expired[i] === 'chill') {
                // Restore base speed; an active legacy SLOWED re-asserts on its next apply.
                if (!this.isFrozen && !this.isStunned) this.speed = this.originalSpeed;
                this.stopStatusEffectParticles(StatusEffect.SLOWED);
            } else if (rich.expired[i] === 'curse') {
                this.stopStatusEffectParticles(StatusEffect.CURSE);
            }
        }

        // ── Legacy CC (slow/freeze/stun/push/confused) — unchanged ──
        if (this.activeStatusEffects.size === 0) return;
        const currentTime = performance.now();
        this._expiredStatusEffects.length = 0;
        for (const [effect, effectData] of this.activeStatusEffects) {
            if (currentTime > effectData.endTime) {
                this._expiredStatusEffects.push(effect);
            }
            // Burn is no longer ticked here — the model owns it.
        }
        for (let i = 0; i < this._expiredStatusEffects.length; i++) {
            this.removeStatusEffect(this._expiredStatusEffects[i]);
        }
    }
```

- [ ] **Step 5: Neutralise the legacy burn tick**

`processBurningEffect` (lines 853-865) is now dead — burn is ticked by the model. Delete the method body's damage call to avoid double-burn. Replace the whole method with a no-op kept for binary-compat with any override:

```typescript
    /** @deprecated Burn is now ticked by the StatusStacks model in
     *  updateStatusEffects. Kept as a no-op so subclass overrides don't break. */
    protected processBurningEffect(_deltaTime: number): void { /* model-owned */ }
```

Also confirm nothing else still calls `processBurningEffect` expecting damage (the only caller was the `else if (effect === StatusEffect.BURNING)` branch removed in Step 4).

- [ ] **Step 6: Apply the Fragile amplifier in `takeDamage`**

In `takeDamage` (lines 1121-1140), the order is: crit roll → damage resistance → `this.health -= actualDamage`. Insert the Fragile amplifier *after* the damage-resistance block (after line 1138) and *before* `this.health -= actualDamage;` (line 1140):

```typescript
        // Fragile: stacking amplifier raises incoming direct damage.
        actualDamage *= this.statuses.damageAmplifier();
```

- [ ] **Step 7: Type-check and confirm the `createStatusEffectParticles` note**

Run: `npx tsc --noEmit`
Expected: PASS.
Then open `createStatusEffectParticles` (line ~971) and confirm an unknown effect kind (`CURSE`) is handled gracefully (it typically `switch`es and falls through to nothing). If `CURSE` would throw, remove the `createStatusEffectParticles(effect)` line from the CURSE case (Step 3) and re-run `tsc`.

- [ ] **Step 8: Build**

Run: `npm run build`
Expected: webpack build succeeds (no TS errors).

- [ ] **Step 9: Commit**

```bash
git add src/survivors/enemies/Enemy.ts
git commit -m "feat(status): route burn/chill/curse/fragile through StatusStacks in Enemy"
```

---

## Task 5: Shatter-on-death hook

**Files:**
- Modify: `src/survivors/enemies/Enemy.ts` (static callback near line 82; new fields near line 185; `die()` 1303-1332)

Frozen/marked enemies should emit an AoE *when they actually die*. The AoE mesh itself is Phase 1b, so Phase 1a adds only the priming state + a static callback hook (mirroring the existing `Enemy.onDamageCallback` / `Enemy.onRewardCallback` pattern). When nothing wires the callback (i.e. before Phase 1b) it is a safe no-op.

- [ ] **Step 1: Add the static shatter callback**

Near the other static callbacks (line ~82-83, `onDamageCallback` / `onRewardCallback`), add:

```typescript
    /** Wired by the gameplay state (Phase 1b) to PowerEffects.aoeBurst. Fired from
     *  die() when an enemy was shatter-primed. Position is passed by reference —
     *  the consumer must NOT retain the Vector3. */
    public static onShatterCallback: ((position: Vector3, damage: number, radius: number) => void) | null = null;
```

- [ ] **Step 2: Add the priming fields**

Near the status fields (after the `statuses` field added in Task 4 Step 2), add:

```typescript
    private _shatterPrimed: boolean = false;
    private _shatterDamage: number = 0;
    private _shatterRadius: number = 0;
```

- [ ] **Step 3: Add the priming method**

Add a public method (place it just after `applyStatusEffect`, around line 922):

```typescript
    /** Mark this enemy so that on death it emits a shatter AoE (fired via
     *  Enemy.onShatterCallback). Re-priming keeps the larger of the two bursts. */
    public primeShatter(damage: number, radius: number): void {
        if (damage <= 0 || radius <= 0) return;
        this._shatterPrimed = true;
        this._shatterDamage = Math.max(this._shatterDamage, damage);
        this._shatterRadius = Math.max(this._shatterRadius, radius);
    }
```

- [ ] **Step 4: Fire it in `die()`**

In `die()` (lines 1303-1332), after `this.createDeathEffect();` (line 1313) add:

```typescript
        // Shatter-on-death (e.g. frozen enemies erupting). Fires the static hook
        // wired by the gameplay state; a no-op until Phase 1b wires PowerEffects.
        if (this._shatterPrimed && Enemy.onShatterCallback) {
            Enemy.onShatterCallback(this.position, this._shatterDamage, this._shatterRadius);
        }
        this._shatterPrimed = false;
```

- [ ] **Step 5: Type-check and build**

Run: `npx tsc --noEmit`
Expected: PASS.
Run: `npm run build`
Expected: succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/survivors/enemies/Enemy.ts
git commit -m "feat(status): shatter-on-death priming + static hook (no-op until Phase 1b)"
```

---

## Task 6: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: PASS — including the existing `PlayerStats.spec.ts` / `RunItems.spec.ts` and the two new spec files.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS (no errors).

- [ ] **Step 3: Production build**

Run: `npm run build`
Expected: succeeds with no TS errors.

- [ ] **Step 4: Manual smoke (dev server)**

Run: `npm start`, play a survivors run with a fire power (applies BURNING) and an ice power (applies SLOWED/FROZEN).
Expected:
- Burning enemies still take damage over time (the model now ticks burn) and burn damage numbers are orange/fire-coloured.
- Slow/Freeze still work and the 3s freeze-immunity / 5s stun-immunity windows are intact.
- No `[resource-watchdog] LEAK SUSPECTED` line in the console over several wave clears (Phase 1a adds no new materials/meshes — only the no-op shatter hook).

- [ ] **Step 5: Final commit (if any tweaks were needed)**

```bash
git add -A
git commit -m "test(status): Phase 1a verification pass" || echo "nothing to commit"
```

---

## Notes for the implementer

- **Do not** unify the legacy CC into `StatusStacks` in this phase — that is deliberately deferred. Chill's slow temporarily overrides a concurrent legacy SLOWED on the same enemy; that is acceptable because base powers use SLOWED while fusions/ultimates use CHILL, and they rarely co-occur on one target.
- `StatusModel.ts` and `StatusReactions.ts` must stay import-clean of `@babylonjs/core`. If `tsc` is happy but `vitest` fails to load the module, the cause is almost always a transitive Babylon import — check what you imported.
- The shatter hook is intentionally inert until Phase 1b wires `Enemy.onShatterCallback`. Leaving it unwired is correct for this phase.
