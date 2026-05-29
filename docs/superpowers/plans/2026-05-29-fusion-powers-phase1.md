# Fusion Powers — Phase 1 (Framework + Mage) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the fusion-power framework (generated tier-2 fusions composed from parent powers, slot-merge forging, the orb-pickup fusion/ultimate offer flow) and the full Mage vertical slice (3 hand-authored ultimates), proving the entire pipeline end-to-end.

**Architecture:** A fusion is a normal `PowerDefinition` produced by a babylon-free factory that composes two parent defs (autocast: cast both effects + a fusion bonus; passive: apply both on-hit effects + bonus). A registry generates all 10 element-pair fusions per class. Ultimates are hand-authored `PowerDefinition`s, chosen by the player at forge time. `PowerSlotManager` gains a generic `fuse()` and treats every tier as an ordinary slot. The orb-pickup handler in `SurvivorsGameplayState` gains a priority branch that offers fusion/ultimate cards before the normal power/wildcard/perk cards.

**Tech Stack:** TypeScript, BabylonJS, Vitest (pure-logic only — the project harness must not import `@babylonjs/core` at module load), webpack.

**Design source:** `docs/superpowers/specs/2026-05-29-fusion-powers-design.md`

**Testing boundary (matches the codebase):** Pure-logic units are TDD'd with Vitest (Task 2). Babylon/scene-coupled code (registry that imports `POWER_DEFS`, `PowerSlotManager`, UI, integration, VFX) is verified with `npx tsc --noEmit` plus the manual smoke checklist in Task 10 — this is the project's existing convention (`vitest.config.ts` documents it).

---

## File Structure

**Create:**
- `src/survivors/powers/FusionFactory.ts` — babylon-free. `makeFusionDef(a,b)`, `fusionId(...)`, `FUSION_NAMES`, the `FUSION_*` tuning constants. Uses **type-only** imports from `PowerDefinitions` so importing it never pulls `@babylonjs/core`. **The unit-tested core.**
- `src/survivors/powers/FusionDefinitions.ts` — the registries. Imports runtime `POWER_DEFS`/`getPowerMapForClass` (babylon-laden) + the factory + the ultimate modules. Exports `FUSION_DEFS`, `ULTIMATE_DEFS`, `getAnyPowerDef`, `getFusionFor`, `getUltimatesForClass`.
- `src/survivors/powers/ultimates/MageUltimates.ts` — 3 bespoke Mage ultimate `PowerDefinition`s (Cataclysm, Absolute Zero, Singularity) + their cast VFX. Establishes the per-class ultimate-module pattern.
- `tests/FusionFactory.spec.ts` — unit tests for the factory + `fusionId`.

**Modify:**
- `src/survivors/powers/PowerDefinitions.ts` — add `tier`/`championType`/`parents`/`elements`/`dispose?` to the `PowerDefinition` interface; give Whirling Blades a `dispose`.
- `src/survivors/powers/PowerSlotManager.ts` — resolve defs via `getAnyPowerDef`; add `fuse()`, `getMaxedSlots()`; route disposal through `def.dispose`.
- `src/survivors/ui/PowerChoiceOverlay.ts` — add `fusion` + `ultimate` card kinds.
- `src/survivors/ui/HeroHud.ts` — tier-based slot glyph/color for fusion/ultimate slots.
- `src/survivors/HeroController.ts` — public `triggerScreenShake()`.
- `src/survivors/SurvivorsGameplayState.ts` — fusion/ultimate offer branch in `onOrbPickup`, element-aware leveling, forge VFX; run-summary tier.
- `src/game-over/GameOverState.ts` — carry/show fusion/ultimate tier in the run summary.

---

## Task 1: Extend `PowerDefinition` + Whirling Blades disposal

**Files:**
- Modify: `src/survivors/powers/PowerDefinitions.ts:34-65` (interface), `:528-595` (Whirling Blades def)

- [ ] **Step 1: Add the new optional fields to the `PowerDefinition` interface**

In `src/survivors/powers/PowerDefinitions.ts`, find the `PowerDefinition` interface (starts line 34). Add these fields right after the `mode` field (line 48):

```ts
    /** Progression tier. Absent ⇒ treated as 'base'. */
    tier?: 'base' | 'fusion' | 'ultimate';
    /** Owning class — set on fusion/ultimate defs (base ids encode it as `<class>_…`). */
    championType?: ChampionType;
    /** Parent def ids for fusion/ultimate defs. */
    parents?: [string, string];
    /** All constituent elements (fusion: 2; ultimate: representative set). */
    elements?: PowerElement[];
    /** Optional cleanup hook for persistent slot data (meshes). Called on remove/fuse/dispose. */
    dispose?: (state: PowerRuntimeState) => void;
```

- [ ] **Step 2: Give Whirling Blades a `dispose` hook**

In the `magePhysicalDef` object (Whirling Blades, ~line 528), add a `dispose` property (place it right after the closing of the `cast` function, as a new top-level property of the def):

```ts
    dispose: (state) => {
        const blades = state.data?.['blades'] as { mesh: { dispose: () => void } }[] | undefined;
        if (blades) {
            for (const b of blades) {
                try { b.mesh.dispose(); } catch { /* ignore */ }
            }
        }
    },
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/survivors/powers/PowerDefinitions.ts
git commit -m "feat(powers): add fusion tier fields + Whirling Blades dispose hook"
```

---

## Task 2: Fusion factory (babylon-free, TDD)

**Files:**
- Create: `src/survivors/powers/FusionFactory.ts`
- Test: `tests/FusionFactory.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/FusionFactory.spec.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { makeFusionDef, fusionId, FUSION_DMG, FUSION_CD, FUSION_PASSIVE_BONUS } from '../src/survivors/powers/FusionFactory';
import type { PowerDefinition } from '../src/survivors/powers/PowerDefinitions';

// Minimal fake parent defs — no Babylon, no scene.
function fakeAutocast(id: string, element: string, baseCd: number, baseDmg: number, castSpy = vi.fn()): PowerDefinition {
    return {
        id, name: id, element: element as PowerDefinition['element'], icon: 'x',
        baseCooldown: baseCd, baseDamage: baseDmg, baseRange: 10, maxLevel: 5, mode: 'autocast',
        cooldownFor: (s) => baseCd * Math.pow(0.92, s.level - 1),
        damageFor:   (s) => baseDmg * Math.pow(1.25, s.level - 1),
        cast: castSpy,
    };
}
function fakePassive(id: string, element: string, onHitSpy = vi.fn(), rangeBonus?: (l: number) => number): PowerDefinition {
    return {
        id, name: id, element: element as PowerDefinition['element'], icon: 'x',
        baseCooldown: 0, baseDamage: 0, baseRange: 0, maxLevel: 5, mode: 'passive',
        cooldownFor: () => 0, damageFor: () => 0, onHit: onHitSpy, rangeBonus,
    };
}

describe('fusionId — canonical ordering', () => {
    it('is order-independent (Fire+Ice === Ice+Fire)', () => {
        expect(fusionId('mage', 'fire', 'ice')).toBe(fusionId('mage', 'ice', 'fire'));
    });
    it('encodes class and sorted elements', () => {
        expect(fusionId('mage', 'ice', 'fire')).toBe('fuse_mage_fire_ice');
    });
});

describe('makeFusionDef — metadata', () => {
    it('sets tier, parents, elements, championType, and a fixed id/name', () => {
        const a = fakeAutocast('mage_fire', 'fire', 1.4, 14);
        const b = fakeAutocast('mage_ice', 'ice', 1.2, 9);
        const f = makeFusionDef(a, b);
        expect(f.id).toBe('fuse_mage_fire_ice');
        expect(f.tier).toBe('fusion');
        expect(f.championType).toBe('mage');
        expect(f.parents).toEqual(['mage_fire', 'mage_ice']);
        expect(f.elements).toEqual(['fire', 'ice']);
        expect(f.name).toBe('Frostfire');
        expect(f.maxLevel).toBe(5);
    });
});

describe('makeFusionDef — autocast composition', () => {
    it('cooldown = averaged parent cooldowns × FUSION_CD', () => {
        const a = fakeAutocast('mage_fire', 'fire', 2, 14);
        const b = fakeAutocast('mage_ice', 'ice', 1, 9);
        const f = makeFusionDef(a, b);
        const s = { level: 1, cooldownRemaining: 0 };
        expect(f.cooldownFor(s)).toBeCloseTo(((2 + 1) / 2) * FUSION_CD, 5);
    });
    it('damage (display) = sum of parent damages', () => {
        const a = fakeAutocast('mage_fire', 'fire', 2, 14);
        const b = fakeAutocast('mage_ice', 'ice', 1, 9);
        const f = makeFusionDef(a, b);
        const s = { level: 1, cooldownRemaining: 0 };
        expect(f.damageFor(s)).toBeCloseTo(14 + 9, 5);
    });
    it('cast fires BOTH parents with the fusion-boosted damage multiplier and fusion level', () => {
        const castA = vi.fn();
        const castB = vi.fn();
        const a = fakeAutocast('mage_fire', 'fire', 2, 14, castA);
        const b = fakeAutocast('mage_ice', 'ice', 1, 9, castB);
        const f = makeFusionDef(a, b);
        const state = { level: 4, cooldownRemaining: 0 };
        const ctx = { scene: {} as never, heroPosition: {} as never, enemies: [], damageMultiplier: 2 };
        f.init?.(state, ctx);
        f.cast?.(state, ctx);
        expect(castA).toHaveBeenCalledTimes(1);
        expect(castB).toHaveBeenCalledTimes(1);
        // Each parent sees damageMultiplier scaled by FUSION_DMG…
        expect(castA.mock.calls[0][1].damageMultiplier).toBeCloseTo(2 * FUSION_DMG, 5);
        // …and a sub-state whose level mirrors the fusion's level.
        expect(castA.mock.calls[0][0].level).toBe(4);
    });
});

describe('makeFusionDef — passive composition', () => {
    it('onHit fires both parents then applies the fusion bonus damage', () => {
        const hitA = vi.fn();
        const hitB = vi.fn();
        const a = fakePassive('barbarian_fire', 'fire', hitA);
        const b = fakePassive('barbarian_ice', 'ice', hitB);
        const f = makeFusionDef(a, b);
        const takeDamage = vi.fn();
        const enemy = { takeDamage } as never;
        const ctx = { scene: {} as never, heroPosition: {} as never, enemies: [], baseDamage: 10 };
        f.onHit?.(enemy, 3, ctx);
        expect(hitA).toHaveBeenCalledTimes(1);
        expect(hitB).toHaveBeenCalledTimes(1);
        expect(takeDamage).toHaveBeenCalledWith(10 * FUSION_PASSIVE_BONUS * 3);
    });
    it('rangeBonus sums the parents', () => {
        const a = fakePassive('barbarian_physical', 'physical', vi.fn(), (l) => l * 0.3);
        const b = fakePassive('barbarian_fire', 'fire', vi.fn());
        const f = makeFusionDef(a, b);
        expect(f.rangeBonus?.(4)).toBeCloseTo(1.2, 5);
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- FusionFactory`
Expected: FAIL — `Cannot find module '../src/survivors/powers/FusionFactory'`.

- [ ] **Step 3: Implement the factory**

Create `src/survivors/powers/FusionFactory.ts`:

```ts
// Babylon-free fusion factory. Uses TYPE-ONLY imports from PowerDefinitions so
// importing this module never loads @babylonjs/core — keeps it unit-testable
// under the project's node-only Vitest harness.
import type {
    PowerDefinition,
    PowerRuntimeState,
    PowerContext,
    EnchantmentHitContext,
    PowerElement,
    ChampionType,
} from './PowerDefinitions';

/** Each parent effect hits this much harder inside a fusion. */
export const FUSION_DMG = 1.25;
/** Multiplier applied to the averaged parent cooldown. */
export const FUSION_CD = 0.85;
/** Passive fusion bonus: extra weapon-damage fraction per level, applied per hit. */
export const FUSION_PASSIVE_BONUS = 0.25;

const ELEMENT_ORDER: PowerElement[] = ['fire', 'ice', 'arcane', 'physical', 'storm'];
const FUSION_ICON = '✦';

/** Hand-picked names keyed by sorted `elemA_elemB`. Class-agnostic. */
const FUSION_NAMES: Record<string, string> = {
    fire_ice:        'Frostfire',
    fire_arcane:     'Hexflame',
    fire_physical:   'Molten Edge',
    fire_storm:      'Tempest Ember',
    ice_arcane:      'Rimecaster',
    ice_physical:    'Glacial Edge',
    ice_storm:       'Blizzard',
    arcane_physical: 'Runeblade',
    arcane_storm:    'Voltaic Rune',
    physical_storm:  'Thunderstrike',
};

function classOfBaseId(id: string): ChampionType {
    return id.split('_')[0] as ChampionType;
}

function sortElems(a: PowerElement, b: PowerElement): [PowerElement, PowerElement] {
    return ELEMENT_ORDER.indexOf(a) <= ELEMENT_ORDER.indexOf(b) ? [a, b] : [b, a];
}

export function fusionId(classType: ChampionType, e1: PowerElement, e2: PowerElement): string {
    const [a, b] = sortElems(e1, e2);
    return `fuse_${classType}_${a}_${b}`;
}

/**
 * Compose two base PowerDefinitions of the same class+mode into a fusion.
 * Autocast fusions fire both parents' cast() each trigger; passive fusions
 * apply both parents' onHit() each hit. Persistent parent data (e.g. Whirling
 * Blades' meshes) lives in per-parent sub-states under state.data.__subStates.
 */
export function makeFusionDef(a: PowerDefinition, b: PowerDefinition): PowerDefinition {
    const classType = classOfBaseId(a.id);
    const id = fusionId(classType, a.element, b.element);
    const [e1, e2] = sortElems(a.element, b.element);
    const name = FUSION_NAMES[`${e1}_${e2}`] ?? `${a.name} + ${b.name}`;
    const parents = [a, b];

    const ensureSubStates = (
        state: PowerRuntimeState,
        ctx: PowerContext | null,
    ): Record<string, PowerRuntimeState> => {
        if (!state.data) state.data = {};
        let subs = state.data['__subStates'] as Record<string, PowerRuntimeState> | undefined;
        if (!subs) {
            subs = {};
            for (const p of parents) {
                const sub: PowerRuntimeState = { level: state.level, cooldownRemaining: 0, data: {} };
                if (p.init && ctx) p.init(sub, ctx);
                subs[p.id] = sub;
            }
            state.data['__subStates'] = subs;
        }
        return subs;
    };

    const def: PowerDefinition = {
        id,
        name,
        element: e1,                 // primary element (HUD fallback / card border)
        icon: FUSION_ICON,
        baseCooldown: ((a.baseCooldown + b.baseCooldown) / 2) * FUSION_CD,
        baseDamage: a.baseDamage + b.baseDamage,
        baseRange: Math.max(a.baseRange, b.baseRange),
        maxLevel: 5,
        mode: a.mode,
        tier: 'fusion',
        championType: classType,
        parents: [a.id, b.id],
        elements: [a.element, b.element],
        cooldownFor: (s) => ((a.cooldownFor(s) + b.cooldownFor(s)) / 2) * FUSION_CD,
        damageFor:   (s) => a.damageFor(s) + b.damageFor(s),
        description: (lvl) =>
            `Fused: ${parents.map(p => (p.description ? p.description(lvl) : p.name)).join('  +  ')}`,
        init: (state, ctx) => { ensureSubStates(state, ctx); },
        dispose: (state) => {
            const subs = state.data?.['__subStates'] as Record<string, PowerRuntimeState> | undefined;
            if (!subs) return;
            for (const p of parents) {
                const sub = subs[p.id];
                if (sub && p.dispose) p.dispose(sub);
            }
        },
    };

    if (a.mode === 'passive') {
        def.onHit = (enemy, level, ctx: EnchantmentHitContext) => {
            for (const p of parents) p.onHit?.(enemy, level, ctx);
            enemy.takeDamage(ctx.baseDamage * FUSION_PASSIVE_BONUS * level);
        };
        def.rangeBonus = (level) =>
            parents.reduce((sum, p) => sum + (p.rangeBonus ? p.rangeBonus(level) : 0), 0);
    } else {
        def.cast = (state, ctx) => {
            const subs = ensureSubStates(state, ctx);
            const synthCtx: PowerContext = { ...ctx, damageMultiplier: ctx.damageMultiplier * FUSION_DMG };
            for (const p of parents) {
                const sub = subs[p.id];
                sub.level = state.level;
                p.cast?.(sub, synthCtx);
            }
        };
    }

    return def;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- FusionFactory`
Expected: PASS — all describe blocks green.

- [ ] **Step 5: Type-check + commit**

```bash
npx tsc --noEmit
git add src/survivors/powers/FusionFactory.ts tests/FusionFactory.spec.ts
git commit -m "feat(powers): babylon-free fusion factory (composes parent powers)"
```

---

## Task 3: Fusion registry + accessors

**Files:**
- Create: `src/survivors/powers/FusionDefinitions.ts`

- [ ] **Step 1: Implement the registry module**

Create `src/survivors/powers/FusionDefinitions.ts`:

```ts
import {
    POWER_DEFS,
    getPowerMapForClass,
    PowerDefinition,
    PowerElement,
    ChampionType,
} from './PowerDefinitions';
import { makeFusionDef, fusionId } from './FusionFactory';

const CLASSES: ChampionType[] = ['barbarian', 'ranger', 'mage'];

/** All 10 element-pair fusions per class, generated by composing base defs. */
export const FUSION_DEFS: Record<string, PowerDefinition> = (() => {
    const out: Record<string, PowerDefinition> = {};
    for (const c of CLASSES) {
        const map = getPowerMapForClass(c);
        const elems = Object.keys(map) as PowerElement[];
        for (let i = 0; i < elems.length; i++) {
            for (let j = i + 1; j < elems.length; j++) {
                const a = POWER_DEFS[map[elems[i]]];
                const b = POWER_DEFS[map[elems[j]]];
                const def = makeFusionDef(a, b);
                out[def.id] = def;
            }
        }
    }
    return out;
})();

/**
 * Ultimate defs, aggregated from per-class modules. Populated in Task 4.
 * Kept as a mutable record so per-class ultimate modules register into it.
 */
export const ULTIMATE_DEFS: Record<string, PowerDefinition> = {};

/** Resolve any power def id across all three tiers. */
export function getAnyPowerDef(id: string): PowerDefinition | undefined {
    return POWER_DEFS[id] ?? FUSION_DEFS[id] ?? ULTIMATE_DEFS[id];
}

/** The tier-2 fusion produced by two BASE power ids of the same class, or null. */
export function getFusionFor(idA: string, idB: string): PowerDefinition | null {
    const a = POWER_DEFS[idA];
    const b = POWER_DEFS[idB];
    if (!a || !b) return null;
    const classA = idA.split('_')[0] as ChampionType;
    const classB = idB.split('_')[0] as ChampionType;
    if (classA !== classB) return null;
    return FUSION_DEFS[fusionId(classA, a.element, b.element)] ?? null;
}

/** The hand-authored ultimates available to a class. */
export function getUltimatesForClass(type: ChampionType): PowerDefinition[] {
    return Object.values(ULTIMATE_DEFS).filter(d => d.championType === type);
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors. (`ULTIMATE_DEFS` is intentionally empty until Task 4.)

- [ ] **Step 3: Commit**

```bash
git add src/survivors/powers/FusionDefinitions.ts
git commit -m "feat(powers): fusion registry + tier-aware def accessors"
```

---

## Task 4: Mage ultimates

**Files:**
- Create: `src/survivors/powers/ultimates/MageUltimates.ts`
- Modify: `src/survivors/powers/FusionDefinitions.ts` (register the mage ultimates)

- [ ] **Step 1: Implement the Mage ultimate module**

Create `src/survivors/powers/ultimates/MageUltimates.ts`:

```ts
import { MeshBuilder, Color3, StandardMaterial } from '@babylonjs/core';
import { getCachedMaterial } from '../../../engine/rendering/MaterialCache';
import { StatusEffect } from '../../GameTypes';
import type { Scene } from '@babylonjs/core';
import type { Enemy } from '../../enemies/Enemy';
import type { PowerDefinition } from '../PowerDefinitions';

const ALL_ELEMENTS: PowerDefinition['elements'] = ['fire', 'ice', 'arcane', 'physical', 'storm'];

/** An expanding, fading ring on the ground. Self-disposing. */
function spawnShockRing(scene: Scene, x: number, z: number, maxRadius: number, color: Color3, lifeS: number): void {
    const ring = MeshBuilder.CreateTorus('ult_ring', { diameter: maxRadius * 2, thickness: 0.3, tessellation: 36 }, scene);
    ring.position.set(x, 0.3, z);
    const mat = new StandardMaterial('ult_ring_mat_' + Math.random(), scene);
    mat.emissiveColor = color;
    mat.diffuseColor = new Color3(0, 0, 0);
    mat.alpha = 0.85;
    ring.material = mat;
    ring.scaling.setAll(0.1);
    let elapsed = 0;
    const obs = scene.onBeforeRenderObservable.add(() => {
        const dt = scene.getEngine().getDeltaTime() / 1000;
        elapsed += dt;
        const t = Math.min(elapsed / lifeS, 1);
        ring.scaling.setAll(0.1 + 0.9 * t);
        mat.alpha = 0.85 * (1 - t);
        if (t >= 1) {
            ring.dispose();
            mat.dispose();
            scene.onBeforeRenderObservable.remove(obs);
        }
    });
}

/** A brief falling fire streak + AOE burn impact. */
function meteorImpact(scene: Scene, x: number, z: number, damage: number, radius: number, enemies: Enemy[]): void {
    for (const e of enemies) {
        if (!e.isAlive()) continue;
        const dx = e.getPosition().x - x;
        const dz = e.getPosition().z - z;
        if (Math.hypot(dx, dz) <= radius) {
            e.takeDamage(damage);
            e.applyStatusEffect(StatusEffect.BURNING, 3, damage * 0.1);
        }
    }
    spawnShockRing(scene, x, z, radius, new Color3(1, 0.4, 0.05), 0.32);
    const streak = MeshBuilder.CreateCylinder('ult_meteor', { height: 6, diameterTop: 0.1, diameterBottom: 0.5, tessellation: 6 }, scene);
    streak.position.set(x, 3.2, z);
    streak.material = getCachedMaterial(scene, 'ult_meteor_mat', m => {
        m.emissiveColor = new Color3(1, 0.5, 0.1);
        m.diffuseColor = new Color3(0, 0, 0);
    });
    setTimeout(() => { if (!streak.isDisposed()) streak.dispose(); }, 150);
}

// ── Cataclysm — rolling meteor storm ────────────────────────────────────────
const mageCataclysm: PowerDefinition = {
    id: 'mage_ult_cataclysm',
    name: 'Cataclysm',
    element: 'fire',
    championType: 'mage',
    tier: 'ultimate',
    elements: ALL_ELEMENTS,
    icon: '✪',
    baseCooldown: 6,
    baseDamage: 60,
    baseRange: 14,
    maxLevel: 5,
    mode: 'autocast',
    cooldownFor: (s) => 6 * Math.pow(0.94, s.level - 1),
    damageFor:   (s) => 60 * Math.pow(1.25, s.level - 1),
    cast: (state, ctx) => {
        const strikes = 4 + state.level;
        const dmg = mageCataclysm.damageFor(state) * ctx.damageMultiplier;
        for (let i = 0; i < strikes; i++) {
            setTimeout(() => {
                const alive = ctx.enemies.filter(e => e.isAlive());
                let x: number, z: number;
                if (alive.length > 0) {
                    const p = alive[Math.floor(Math.random() * alive.length)].getPosition();
                    x = p.x; z = p.z;
                } else {
                    const ang = Math.random() * Math.PI * 2;
                    const r = Math.random() * mageCataclysm.baseRange;
                    x = ctx.heroPosition.x + Math.cos(ang) * r;
                    z = ctx.heroPosition.z + Math.sin(ang) * r;
                }
                meteorImpact(ctx.scene, x, z, dmg, 3, ctx.enemies);
            }, i * 90);
        }
    },
};

// ── Absolute Zero — mass freeze burst ───────────────────────────────────────
const mageAbsoluteZero: PowerDefinition = {
    id: 'mage_ult_absolute_zero',
    name: 'Absolute Zero',
    element: 'ice',
    championType: 'mage',
    tier: 'ultimate',
    elements: ALL_ELEMENTS,
    icon: '✪',
    baseCooldown: 7,
    baseDamage: 70,
    baseRange: 9,
    maxLevel: 5,
    mode: 'autocast',
    cooldownFor: (s) => 7 * Math.pow(0.94, s.level - 1),
    damageFor:   (s) => 70 * Math.pow(1.25, s.level - 1),
    cast: (state, ctx) => {
        const radius = mageAbsoluteZero.baseRange + state.level * 0.4;
        const dmg = mageAbsoluteZero.damageFor(state) * ctx.damageMultiplier;
        for (const e of ctx.enemies) {
            if (!e.isAlive()) continue;
            const dx = e.getPosition().x - ctx.heroPosition.x;
            const dz = e.getPosition().z - ctx.heroPosition.z;
            if (Math.hypot(dx, dz) <= radius) {
                e.takeDamage(dmg);
                e.applyStatusEffect(StatusEffect.FROZEN, 2 + state.level * 0.3, 1);
            }
        }
        spawnShockRing(ctx.scene, ctx.heroPosition.x, ctx.heroPosition.z, radius, new Color3(0.5, 0.85, 1), 0.45);
    },
};

// ── Singularity — gravity vortex + implosion ────────────────────────────────
const mageSingularity: PowerDefinition = {
    id: 'mage_ult_singularity',
    name: 'Singularity',
    element: 'arcane',
    championType: 'mage',
    tier: 'ultimate',
    elements: ALL_ELEMENTS,
    icon: '✪',
    baseCooldown: 8,
    baseDamage: 50,
    baseRange: 6,
    maxLevel: 5,
    mode: 'autocast',
    cooldownFor: (s) => 8 * Math.pow(0.94, s.level - 1),
    damageFor:   (s) => 50 * Math.pow(1.25, s.level - 1),
    cast: (state, ctx) => {
        let cx = ctx.heroPosition.x;
        let cz = ctx.heroPosition.z;
        let best: Enemy | null = null;
        let bestD2 = Infinity;
        for (const e of ctx.enemies) {
            if (!e.isAlive()) continue;
            const dx = e.getPosition().x - ctx.heroPosition.x;
            const dz = e.getPosition().z - ctx.heroPosition.z;
            const d2 = dx * dx + dz * dz;
            if (d2 < bestD2) { bestD2 = d2; best = e; }
        }
        if (best) { cx = best.getPosition().x; cz = best.getPosition().z; }

        const radius = mageSingularity.baseRange;
        const tickDmg = mageSingularity.damageFor(state) * ctx.damageMultiplier * 0.25;
        const burstDmg = mageSingularity.damageFor(state) * ctx.damageMultiplier;

        const orb = MeshBuilder.CreateSphere('ult_singularity', { diameter: 1.2, segments: 8 }, ctx.scene);
        orb.position.set(cx, 1, cz);
        orb.material = getCachedMaterial(ctx.scene, 'ult_singularity_mat', m => {
            m.emissiveColor = new Color3(0.35, 0.05, 0.55);
            m.diffuseColor = new Color3(0, 0, 0);
        });

        const lifeS = 1.6;
        let elapsed = 0;
        let tickAcc = 0;
        const obs = ctx.scene.onBeforeRenderObservable.add(() => {
            const dt = ctx.scene.getEngine().getDeltaTime() / 1000;
            elapsed += dt;
            tickAcc += dt;
            orb.rotation.y += dt * 6;
            orb.scaling.setAll(1 + 0.3 * Math.sin(elapsed * 10));
            if (tickAcc >= 0.2) {
                tickAcc = 0;
                for (const e of ctx.enemies) {
                    if (!e.isAlive()) continue;
                    const dx = e.getPosition().x - cx;
                    const dz = e.getPosition().z - cz;
                    if (Math.hypot(dx, dz) <= radius) {
                        e.takeDamage(tickDmg);
                        e.applyStatusEffect(StatusEffect.SLOWED, 0.4, 0.3);
                    }
                }
            }
            if (elapsed >= lifeS) {
                for (const e of ctx.enemies) {
                    if (!e.isAlive()) continue;
                    const dx = e.getPosition().x - cx;
                    const dz = e.getPosition().z - cz;
                    if (Math.hypot(dx, dz) <= radius) e.takeDamage(burstDmg);
                }
                spawnShockRing(ctx.scene, cx, cz, radius, new Color3(0.6, 0.2, 1), 0.3);
                orb.dispose();
                ctx.scene.onBeforeRenderObservable.remove(obs);
            }
        });
    },
};

export const MAGE_ULTIMATES: PowerDefinition[] = [mageCataclysm, mageAbsoluteZero, mageSingularity];
```

- [ ] **Step 2: Register the mage ultimates into `ULTIMATE_DEFS`**

In `src/survivors/powers/FusionDefinitions.ts`, add this import below the existing imports:

```ts
import { MAGE_ULTIMATES } from './ultimates/MageUltimates';
```

Then replace the empty `ULTIMATE_DEFS` declaration with a populated one:

```ts
/** Ultimate defs, aggregated from per-class modules (one module per class). */
export const ULTIMATE_DEFS: Record<string, PowerDefinition> = (() => {
    const out: Record<string, PowerDefinition> = {};
    for (const def of [...MAGE_ULTIMATES]) out[def.id] = def;
    return out;
})();
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/survivors/powers/ultimates/MageUltimates.ts src/survivors/powers/FusionDefinitions.ts
git commit -m "feat(powers): mage ultimates (Cataclysm, Absolute Zero, Singularity)"
```

---

## Task 5: `PowerSlotManager` — tier-aware resolution, `fuse`, `getMaxedSlots`

**Files:**
- Modify: `src/survivors/powers/PowerSlotManager.ts`

- [ ] **Step 1: Swap the def accessor import**

In `src/survivors/powers/PowerSlotManager.ts`, change the import on line 2 from:

```ts
import { PowerDefinition, PowerRuntimeState, PowerContext, PowerElement, POWER_DEFS } from './PowerDefinitions';
```

to:

```ts
import { PowerDefinition, PowerRuntimeState, PowerContext, PowerElement } from './PowerDefinitions';
import { getAnyPowerDef, getFusionFor } from './FusionDefinitions';
```

- [ ] **Step 2: Resolve defs via `getAnyPowerDef` in `addPower` and `replaceSlot`**

In `addPower` (line 49), change `const def = POWER_DEFS[defId];` to:

```ts
        const def = getAnyPowerDef(defId);
```

In `replaceSlot` (line 77), change `const def = POWER_DEFS[defId];` to:

```ts
        const def = getAnyPowerDef(defId);
```

- [ ] **Step 3: Add `getMaxedSlots` and `fuse`**

Add these two public methods to the class (e.g. right after `levelUp`, ~line 74):

```ts
    /** Slots whose power has reached its level cap. */
    public getMaxedSlots(): PowerSlot[] {
        return this.slots.filter(
            (s): s is PowerSlot => s !== null && s.state.level >= s.def.maxLevel,
        );
    }

    /**
     * Forge two equipped, level-capped powers into `resultDefId`.
     * Consumes both parents (disposing their persistent data), inserts the
     * result at level 1 into one of the freed slots, and runs its init.
     * Returns false if validation fails (defs missing, not both present & maxed).
     */
    public fuse(idA: string, idB: string, resultDefId: string): boolean {
        const idxA = this.slots.findIndex(s => s?.def.id === idA);
        const idxB = this.slots.findIndex(s => s?.def.id === idB);
        if (idxA < 0 || idxB < 0 || idxA === idxB) return false;
        const slotA = this.slots[idxA]!;
        const slotB = this.slots[idxB]!;
        if (slotA.state.level < slotA.def.maxLevel) return false;
        if (slotB.state.level < slotB.def.maxLevel) return false;
        const resultDef = getAnyPowerDef(resultDefId);
        if (!resultDef) return false;

        this.disposeSlotData(slotA);
        this.disposeSlotData(slotB);
        this.slots[idxB] = null;

        const slot: PowerSlot = {
            def: resultDef,
            state: { level: 1, cooldownRemaining: resultDef.baseCooldown },
        };
        this.slots[idxA] = slot;
        if (resultDef.init) {
            const ctx = this.buildContext();
            resultDef.init(slot.state, ctx);
        }
        return true;
    }

    /** Convenience: the tier-2 fusion def for two equipped base power ids, or null. */
    public fusionResultFor(idA: string, idB: string): PowerDefinition | null {
        return getFusionFor(idA, idB);
    }
```

- [ ] **Step 4: Route disposal through `def.dispose`**

Replace the existing `disposeSlotData` method (lines 227-235) with:

```ts
    private disposeSlotData(slot: PowerSlot | null): void {
        if (!slot) return;
        try { slot.def.dispose?.(slot.state); } catch { /* ignore */ }
    }
```

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors. (Confirm there are no remaining references to `POWER_DEFS` in this file — the import was removed.)

- [ ] **Step 6: Commit**

```bash
git add src/survivors/powers/PowerSlotManager.ts
git commit -m "feat(powers): PowerSlotManager.fuse + getMaxedSlots + def.dispose routing"
```

---

## Task 6: Fusion/ultimate card kinds + HUD tier styling

**Files:**
- Modify: `src/survivors/ui/PowerChoiceOverlay.ts:5`, `:33-37`
- Modify: `src/survivors/ui/HeroHud.ts:863-866`

- [ ] **Step 1: Extend the card-kind union**

In `src/survivors/ui/PowerChoiceOverlay.ts`, change line 5 from:

```ts
export type PowerCardKind = 'power' | 'wildcard' | 'perk';
```

to:

```ts
export type PowerCardKind = 'power' | 'wildcard' | 'perk' | 'fusion' | 'ultimate';
```

- [ ] **Step 2: Add styling config for the new kinds**

In the `KIND_CONFIG` map (lines 33-37), add two entries:

```ts
const KIND_CONFIG: Record<PowerCardKind, { border: string; kindLabel: string; glyph: string }> = {
    power:    { border: '#888',    kindLabel: 'POWER',   glyph: '★'  },
    wildcard: { border: '#ffffff', kindLabel: 'UPGRADE', glyph: '↑'  },
    perk:     { border: '#ffd700', kindLabel: 'PERK',    glyph: '✦'  },
    fusion:   { border: '#c060ff', kindLabel: 'FUSE',    glyph: '✦'  },
    ultimate: { border: '#ffd24d', kindLabel: 'ULTIMATE',glyph: '✪'  },
};
```

Note: the desktop/mobile card builders already read `KIND_CONFIG[card.kind]` generically — no further layout changes are needed. Fusion/ultimate cards may pass an `element` (used only for the inner glyph/border on `power` cards); for fusion/ultimate the `kindCfg` border/glyph above governs the look.

- [ ] **Step 3: Distinct HUD glyph/color for fusion & ultimate slots**

In `src/survivors/ui/HeroHud.ts`, replace lines 864-865:

```ts
                const glyph = POWER_GLYPH[slot.def.id] ?? ELEMENT_GLYPH[slot.def.element] ?? '?';
                const elemColor = ELEMENT_COLOR[slot.def.element] ?? '#fff';
```

with:

```ts
                const tier = slot.def.tier;
                const glyph = tier === 'ultimate' ? '✪'
                    : tier === 'fusion' ? '✦'
                    : (POWER_GLYPH[slot.def.id] ?? ELEMENT_GLYPH[slot.def.element] ?? '?');
                const elemColor = tier === 'ultimate' ? '#ffd24d'
                    : tier === 'fusion' ? '#c060ff'
                    : (ELEMENT_COLOR[slot.def.element] ?? '#fff');
```

- [ ] **Step 4: Type-check + commit**

```bash
npx tsc --noEmit
git add src/survivors/ui/PowerChoiceOverlay.ts src/survivors/ui/HeroHud.ts
git commit -m "feat(ui): fusion/ultimate card kinds + HUD tier glyphs"
```

---

## Task 7: Public screen-shake on `HeroController`

**Files:**
- Modify: `src/survivors/HeroController.ts`

- [ ] **Step 1: Add a public shake trigger**

In `src/survivors/HeroController.ts`, add this public method (e.g. right after `setOnDeath`, ~line 174). The existing shake apply (lines 462-468) normalizes magnitude by `cameraShakeTimeRemaining / CAMERA_SHAKE_DURATION_S`, so passing a larger duration yields a stronger, longer decaying shake — ideal for ultimate forges:

```ts
    /**
     * Trigger a camera shake of the given duration (seconds). Larger durations
     * read as stronger shakes because the magnitude scales with
     * remaining / CAMERA_SHAKE_DURATION_S. Used for fusion/ultimate forges.
     */
    public triggerScreenShake(durationS: number = 0.3): void {
        this.cameraShakeTimeRemaining = Math.max(this.cameraShakeTimeRemaining, durationS);
    }
```

- [ ] **Step 2: Type-check + commit**

```bash
npx tsc --noEmit
git add src/survivors/HeroController.ts
git commit -m "feat(hero): public triggerScreenShake for fusion/ultimate forges"
```

---

## Task 8: Orb-pickup fusion/ultimate offer flow + forge VFX

**Files:**
- Modify: `src/survivors/SurvivorsGameplayState.ts` (imports; replace `onOrbPickup`; add helper methods)

- [ ] **Step 1: Add imports**

In `src/survivors/SurvivorsGameplayState.ts`, add `StandardMaterial` to the `@babylonjs/core` import (line 1) so the import reads `...MeshBuilder, Mesh, StandardMaterial, BackgroundMaterial...` (insert `StandardMaterial` into the existing list).

Add `PowerSlot` to the PowerSlotManager import (line 14):

```ts
import { PowerSlotManager, PowerSlot } from './powers/PowerSlotManager';
```

Add `PowerDefinition` to the `./powers/PowerDefinitions` import (line 15) — it is used in the `upgradeSubtitle`/`newPowerSubtitle` helper signatures added in Step 2. The line becomes:

```ts
import { POWER_DEFS, getPowerByElementAndClass, getPowerMapForClass, PowerElement, ChampionType, PowerDefinition } from './powers/PowerDefinitions';
```

Add a new import after the `PowerDefinitions` import (line 15):

```ts
import { getFusionFor, getUltimatesForClass } from './powers/FusionDefinitions';
```

- [ ] **Step 2: Replace `onOrbPickup` and add helpers**

Replace the entire existing `onOrbPickup` method (lines 1041-1191) with the following set of methods:

```ts
    private onOrbPickup(element: string): void {
        // Hidden mechanic: every orb collected makes future spawns +5% tougher.
        this.enemyManager?.addOrbHpBonus(0.05);

        if (!this.powerSlots || !this.powerChoice || !this.playerStats) return;
        if (this.powerChoice.isOpen() || this.replaceSlotOverlay?.isOpen()) return;

        // Fusion / ultimate offers take priority over the normal cards.
        const fusionCards = this.buildFusionOfferCards();
        if (fusionCards && fusionCards.length > 0) {
            const cards = fusionCards.slice(0, 3);
            // Tier-2 fusion offers leave room for one normal upgrade; ultimate
            // offers (3 choices) fill the row themselves.
            if (cards[0].kind === 'fusion' && cards.length < 3) {
                const fill = this.buildOrbUpgradeCard(element) ?? this.buildWildcardCard(element);
                if (fill) cards.push(fill);
            }
            this.showChoiceCards(cards);
            return;
        }

        // Normal flow: power upgrade + wildcard + perk.
        const cards: PowerCard[] = [];
        const cardA = this.buildOrbUpgradeCard(element);
        if (cardA) cards.push(cardA);
        const cardB = this.buildWildcardCard(element);
        if (cardB) cards.push(cardB);
        cards.push(this.buildPerkCard());
        this.showChoiceCards(cards);
    }

    /**
     * Tier-3 (two maxed fusions → choose 1 of 3 class ultimates) takes priority
     * over tier-2 (two maxed base powers → fuse). Returns null when no offer.
     */
    private buildFusionOfferCards(): PowerCard[] | null {
        if (!this.powerSlots) return null;
        const maxed = this.powerSlots.getMaxedSlots();

        const maxedFusions = maxed.filter(s => s.def.tier === 'fusion');
        if (maxedFusions.length >= 2) {
            const a = maxedFusions[0];
            const b = maxedFusions[1];
            const ults = getUltimatesForClass(this.currentChampionType);
            const cards = ults.map((ult): PowerCard => ({
                kind: 'ultimate',
                title: ult.name,
                subtitle: `ULTIMATE  ·  forge from ${a.def.name} + ${b.def.name}`,
                element: ult.element,
                onPick: () => {
                    this.powerSlots!.fuse(a.def.id, b.def.id, ult.id);
                    this.playForgeVfx(true);
                },
            }));
            return cards.length > 0 ? cards : null;
        }

        const maxedBase = maxed.filter(s => (s.def.tier ?? 'base') === 'base');
        if (maxedBase.length >= 2) {
            const cards: PowerCard[] = [];
            for (let i = 0; i < maxedBase.length && cards.length < 2; i++) {
                for (let j = i + 1; j < maxedBase.length && cards.length < 2; j++) {
                    const aSlot = maxedBase[i];
                    const bSlot = maxedBase[j];
                    const fdef = getFusionFor(aSlot.def.id, bSlot.def.id);
                    if (!fdef) continue;
                    cards.push({
                        kind: 'fusion',
                        title: fdef.name,
                        subtitle: `FUSE  ·  ${aSlot.def.name} + ${bSlot.def.name}`,
                        element: fdef.element,
                        onPick: () => {
                            this.powerSlots!.fuse(aSlot.def.id, bSlot.def.id, fdef.id);
                            this.playForgeVfx(false);
                        },
                    });
                }
            }
            return cards.length > 0 ? cards : null;
        }

        return null;
    }

    /**
     * Owned, non-maxed slot that contains `element` (a fusion/ultimate counts if
     * it lists the element). Prefers the lowest tier so a fresh fusion levels
     * before an any-element ultimate hogs every orb.
     */
    private getOwnedSlotForElement(element: string): PowerSlot | null {
        if (!this.powerSlots) return null;
        const rank = (t?: string) => (t === 'ultimate' ? 2 : t === 'fusion' ? 1 : 0);
        let best: PowerSlot | null = null;
        for (const s of this.powerSlots.getSlots()) {
            if (!s) continue;
            if (s.state.level >= s.def.maxLevel) continue;
            const elems = s.def.elements ?? [s.def.element];
            if (!elems.includes(element as PowerElement)) continue;
            if (!best || rank(s.def.tier) < rank(best.def.tier)) best = s;
        }
        return best;
    }

    /** Card A: level the owned power for this element, or add the base power. */
    private buildOrbUpgradeCard(element: string): PowerCard | null {
        if (!this.powerSlots) return null;
        const owned = this.getOwnedSlotForElement(element);
        if (owned) {
            const def = owned.def;
            const lvl = owned.state.level;
            return {
                kind: 'power',
                title: def.name,
                element: def.element,
                subtitle: this.upgradeSubtitle(def, lvl),
                onPick: () => this.powerSlots!.levelUp(def.id),
            };
        }
        const orbDef = getPowerByElementAndClass(element as PowerElement, this.currentChampionType)
            ?? Object.values(POWER_DEFS)[0];
        // Owned but maxed (and no fusion partner) → no useful upgrade card.
        if (this.powerSlots.hasPower(orbDef.id)) return null;
        const slotsFull = this.powerSlots.emptySlotIndex() < 0;
        return {
            kind: 'power',
            title: orbDef.name,
            element: orbDef.element,
            subtitle: slotsFull ? `${this.newPowerSubtitle(orbDef)} (replace slot)` : this.newPowerSubtitle(orbDef),
            onPick: () => {
                if (slotsFull) this.openReplacePrompt(orbDef.id);
                else this.powerSlots!.addPower(orbDef.id);
            },
        };
    }

    /** Card B: upgrade a random other owned power, or offer a new class power. */
    private buildWildcardCard(element: string): PowerCard | null {
        if (!this.powerSlots) return null;
        const orbDefId = (getPowerByElementAndClass(element as PowerElement, this.currentChampionType)
            ?? Object.values(POWER_DEFS)[0]).id;
        const ownedSlots = this.powerSlots.getSlots().filter(
            (s): s is PowerSlot => s !== null && s.def.id !== orbDefId && s.state.level < s.def.maxLevel,
        );
        if (ownedSlots.length > 0) {
            const target = ownedSlots[Math.floor(Math.random() * ownedSlots.length)];
            return {
                kind: 'wildcard',
                title: target.def.name,
                element: target.def.element,
                subtitle: this.upgradeSubtitle(target.def, target.state.level),
                onPick: () => this.powerSlots!.levelUp(target.def.id),
            };
        }
        const classMap = getPowerMapForClass(this.currentChampionType);
        const classPowerIds = Object.values(classMap).filter(id => id !== orbDefId && !this.powerSlots!.hasPower(id));
        if (classPowerIds.length === 0) return null;
        const altDef = POWER_DEFS[classPowerIds[Math.floor(Math.random() * classPowerIds.length)]];
        return {
            kind: 'wildcard',
            title: altDef.name,
            element: altDef.element,
            subtitle: this.newPowerSubtitle(altDef),
            onPick: () => {
                if (this.powerSlots!.emptySlotIndex() < 0) this.openReplacePrompt(altDef.id);
                else this.powerSlots!.addPower(altDef.id);
            },
        };
    }

    /** Card C: a random run perk. */
    private buildPerkCard(): PowerCard {
        const perks = [
            { title: '+5% Damage', apply: () => { this.runPerks.damageMultiplier *= 1.05; } },
            {
                title: '+5% Move Speed',
                apply: () => {
                    this.runPerks.moveSpeedMultiplier *= 1.05;
                    if (this.heroController && this.playerStats) {
                        this.heroController.updateMoveSpeed(
                            this.playerStats.moveSpeedMultiplier * this.runPerks.moveSpeedMultiplier,
                        );
                    }
                },
            },
            {
                title: '+10% Attack Range',
                apply: () => {
                    this.runPerks.attackRangeMultiplier *= 1.1;
                    if (this.heroController && this.playerStats) {
                        this.heroController.updateBasicAttackRange(
                            this.playerStats.attackRangeMultiplier * this.runPerks.attackRangeMultiplier,
                        );
                    }
                },
            },
        ];
        const perk = perks[Math.floor(Math.random() * perks.length)];
        return { kind: 'perk', title: perk.title, subtitle: 'This run', onPick: perk.apply };
    }

    /** "Lv X→Y · Dmg A→B · CD a→b" (or per-level description for passives/fusions). */
    private upgradeSubtitle(def: PowerDefinition, fromLevel: number): string {
        const next = fromLevel + 1;
        if ((def.mode === 'passive' || def.tier === 'fusion') && def.description) {
            return `Lv ${fromLevel} → ${next}  ·  ${def.description(next)}`;
        }
        const curState = { level: fromLevel, cooldownRemaining: 0 };
        const nextState = { level: next, cooldownRemaining: 0 };
        const curDmg = Math.round(def.damageFor(curState));
        const nextDmg = Math.round(def.damageFor(nextState));
        const curCd = def.cooldownFor(curState).toFixed(1);
        const nextCd = def.cooldownFor(nextState).toFixed(1);
        return `Lv ${fromLevel} → ${next}  ·  Dmg ${curDmg}→${nextDmg}  ·  CD ${curCd}s→${nextCd}s`;
    }

    /** Subtitle for a freshly-added power. */
    private newPowerSubtitle(def: PowerDefinition): string {
        if (def.mode === 'passive' && def.description) {
            return `New  ·  ${def.description(1)}`;
        }
        const state = { level: 1, cooldownRemaining: 0 };
        const dmg = Math.round(def.damageFor(state));
        const cd = def.cooldownFor(state).toFixed(1);
        return `New  ·  Dmg ${dmg}  ·  CD ${cd}s`;
    }

    /** Apply the per-pickup global power bump to every card, then show. */
    private showChoiceCards(cards: PowerCard[]): void {
        if (!this.powerChoice || !this.playerStats) return;
        const GLOBAL_POWER_BUMP = 1.06;
        for (const card of cards) {
            const pick = card.onPick;
            card.onPick = () => {
                pick();
                this.runPerks.damageMultiplier *= GLOBAL_POWER_BUMP;
            };
        }
        this.powerChoice.show(
            cards,
            () => this.playerStats!.addGold(25),
            () => {},
        );
    }

    /** Brief expanding burst at the hero + camera shake when forging. */
    private playForgeVfx(isUltimate: boolean): void {
        this.heroController?.triggerScreenShake(isUltimate ? 0.5 : 0.25);
        if (!this.scene || !this.hero) return;
        const scene = this.scene;
        const pos = this.hero.getPosition().clone();
        pos.y = 1.2;
        const color = isUltimate ? new Color3(1, 0.9, 0.4) : new Color3(0.75, 0.45, 1);
        const burst = MeshBuilder.CreateSphere('forgeBurst', { diameter: 0.6, segments: 8 }, scene);
        burst.position.copyFrom(pos);
        const mat = new StandardMaterial('forgeBurstMat_' + Math.random(), scene);
        mat.emissiveColor = color;
        mat.diffuseColor = new Color3(0, 0, 0);
        mat.alpha = 0.9;
        burst.material = mat;
        const lifeS = isUltimate ? 0.7 : 0.5;
        let elapsed = 0;
        const obs = scene.onBeforeRenderObservable.add(() => {
            const dt = scene.getEngine().getDeltaTime() / 1000;
            elapsed += dt;
            const t = Math.min(elapsed / lifeS, 1);
            burst.scaling.setAll(0.6 + t * (isUltimate ? 10 : 6));
            mat.alpha = 0.9 * (1 - t);
            if (t >= 1) {
                burst.dispose();
                mat.dispose();
                scene.onBeforeRenderObservable.remove(obs);
            }
        });
    }
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors. (`PowerDefinition` was added to the import in Step 1; `StandardMaterial`, `getFusionFor`, `getUltimatesForClass`, and `PowerSlot` likewise.)

- [ ] **Step 4: Commit**

```bash
git add src/survivors/SurvivorsGameplayState.ts
git commit -m "feat(survivors): orb-pickup fusion/ultimate offers + forge VFX"
```

---

## Task 9: Run-summary tier badge

**Files:**
- Modify: `src/game-over/GameOverState.ts:13`, `:298-299`
- Modify: `src/survivors/SurvivorsGameplayState.ts:792-794`

- [ ] **Step 1: Add `tier` to the summary loadout type**

In `src/game-over/GameOverState.ts`, change the `finalLoadout` field (line 13) from:

```ts
    finalLoadout: { name: string; level: number; icon: string }[];
```

to:

```ts
    finalLoadout: { name: string; level: number; icon: string; tier?: string }[];
```

- [ ] **Step 2: Badge fusion/ultimate names in the summary display**

In `src/game-over/GameOverState.ts`, replace the loadout map (lines 298-299):

```ts
        const loadoutStr = s.finalLoadout.length > 0
            ? s.finalLoadout.map(p => `${p.icon} ${p.name} Lv${p.level}`).join('  ')
```

with:

```ts
        const tierBadge = (t?: string) => (t === 'ultimate' ? '✪ ' : t === 'fusion' ? '✦ ' : '');
        const loadoutStr = s.finalLoadout.length > 0
            ? s.finalLoadout.map(p => `${tierBadge(p.tier)}${p.icon} ${p.name} Lv${p.level}`).join('  ')
```

- [ ] **Step 3: Populate `tier` when building the summary**

In `src/survivors/SurvivorsGameplayState.ts`, update the `finalLoadout` map (lines 792-794):

```ts
        const finalLoadout = (this.powerSlots?.getSlots() ?? [])
            .filter((s): s is NonNullable<typeof s> => s !== null)
            .map(s => ({ name: s.def.name, level: s.state.level, icon: s.def.icon }));
```

to:

```ts
        const finalLoadout = (this.powerSlots?.getSlots() ?? [])
            .filter((s): s is NonNullable<typeof s> => s !== null)
            .map(s => ({ name: s.def.name, level: s.state.level, icon: s.def.icon, tier: s.def.tier }));
```

- [ ] **Step 4: Type-check + commit**

```bash
npx tsc --noEmit
git add src/game-over/GameOverState.ts src/survivors/SurvivorsGameplayState.ts
git commit -m "feat(survivors): show fusion/ultimate tier in run summary"
```

---

## Task 10: Full build + manual smoke test

**Files:** none (verification only)

- [ ] **Step 1: Full unit-test run**

Run: `npm test`
Expected: all tests pass, including the new `FusionFactory` suite.

- [ ] **Step 2: Production build**

Run: `npm run build`
Expected: webpack build succeeds, no TypeScript errors.

- [ ] **Step 3: Manual smoke test (the parts not covered by unit tests)**

Run: `npm start`, open `localhost:9000`, pick **Mage**, and verify:

- [ ] Collect orbs to raise two base spells (e.g. Fireball + Frost Shards) to **level 5** each. Confirm the level-5 cap holds (no level 6).
- [ ] On the next orb pickup, a **FUSE** card appears (purple frame) offering "Frostfire" (+ one normal upgrade card). Pick it.
- [ ] Confirm: both parents vanish, one slot frees, a **Frostfire** slot appears at level 1 with the ✦ HUD glyph, the forge burst + camera shake fire, and Frostfire autocasts **both** a fireball and frost shards each trigger.
- [ ] Level Frostfire via fire **or** ice orbs up to 5. Build a second fusion the same way (e.g. Lightning Chain + Whirling Blades → "Thunderstrike") and confirm Whirling Blades' orbiting blades appear and dispose correctly through the fusion (no leftover meshes after forging).
- [ ] With **two** level-5 fusions, the next orb shows the **ULTIMATE** choice (3 radiant cards: Cataclysm / Absolute Zero / Singularity). Pick one.
- [ ] Confirm the chosen ultimate forges at level 1, both fusions are consumed, the bigger forge shake fires, and the ultimate autocasts its signature VFX (meteor storm / freeze burst / vortex) with clearly higher impact than a fusion.
- [ ] Die and confirm the game-over loadout shows the ✦/✪ tier badges.

- [ ] **Step 4: Final commit (if any smoke-test tweaks were needed)**

```bash
git add -A
git commit -m "test: fusion powers phase 1 smoke-test fixes"
```

(If no tweaks were needed, skip this commit.)

---

## Notes / explicitly deferred to later phases

- **Tier-2 fusions already work for all three classes** — the factory is class-agnostic, so Ranger and Barbarian get generic (auto-composed) fusions for free. Their **ultimates** (and any signature bespoke fusions) are Phases 2–4.
- **Richer visual identity** — orbiting fusion sigil/aura on the hero, split-color HUD icons, and a UI screen-flash on ultimate reveal — is the dedicated polish phase. Phase 1 ships the camera shake + forge burst + both-parents-VFX, which is enough to read clearly.
- **Balance constants** (`FUSION_DMG`, `FUSION_CD`, `FUSION_PASSIVE_BONUS`, ultimate damage/cooldowns) are intentionally first-pass and tuned in the polish phase.
```
