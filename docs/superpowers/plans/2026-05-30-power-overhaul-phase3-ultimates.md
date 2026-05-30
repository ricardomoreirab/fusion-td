# Power Overhaul — Phase 3: All-Class Ultimates

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Build the tier-3 ultimate system: **5 element ultimate archetypes** (screen-scale showpieces on `PowerEffects`), instantiated for **all 3 classes** (15 defs) via a factory, chosen from the **union of the two maxed fusions' elements**, with a special-FX layer (camera shake + screen flash). Ranger ultimates deliver via arrows (consistent with the fusion rework).

**Architecture:** A class-agnostic mechanic per element (5 archetypes) composing the leak-safe `PowerEffects` primitives + two new ones (`repeatStrikes` for time-staggered storms, `ultimateImpact` for the FX layer). A factory `makeUltimateDef(class, element)` produces an autocast `tier:'ultimate'` `PowerDefinition` (class-flavored name, ranger arrow-delivery via the shared `deliverAutocast`). All 15 register into `ULTIMATE_DEFS`. When two fusions are maxed, the offer is the class's ultimate for each element in the union of the two fusions' `elements` (3–4 cards). This replaces the old mage-only `MageUltimates` (3 fixed) + the `getUltimatesForClass` offer.

**Context:** Phases 1a/1b/2 done. `PowerEffects` provides `aoeBurst, chainHit, gatherVortex, persistentZone, omniVolley, dealElementalHit, arrowStrike, cameraShake, screenFlash` + the `_activeEffects` registry (cross-run teardown) + `deliverAutocast` (currently in `FusionArchetypes.ts` — **move it to `PowerEffects.ts` and export** so both fusions and ultimates share it). Branch `feat/power-fusion-ultimate-overhaul`. Trust `tsc`/`build`/`npm test`, not the IDE.

---

## Task 1: Move `deliverAutocast` to PowerEffects + add `repeatStrikes` & `ultimateImpact`

**Files:** Modify `src/survivors/powers/PowerEffects.ts`, `src/survivors/powers/FusionArchetypes.ts`.

- [ ] **Step 1: Move `deliverAutocast` into `PowerEffects.ts`** (export it), and import `ChampionType` (type) there. Remove the copy from `FusionArchetypes.ts` and import it from `./PowerEffects` instead. The function body is unchanged:
```typescript
import type { PowerElement, ChampionType } from './PowerDefinitions'; // ChampionType added
// ...
export function deliverAutocast(
    ctx: { scene: Scene; heroPosition: { x: number; z: number } },
    championType: ChampionType,
    target: Enemy,
    element: PowerElement,
    effectAt: (x: number, z: number) => void,
): void {
    if (championType === 'ranger') {
        arrowStrike(ctx.scene, ctx.heroPosition.x, ctx.heroPosition.z, target, element, effectAt);
    } else {
        const p = target.getPosition();
        effectAt(p.x, p.z);
    }
}
```
(In `FusionArchetypes.ts`: delete the local `deliverAutocast`, add it to the `./PowerEffects` import. Build to confirm.)

- [ ] **Step 2: Add `repeatStrikes`** to `PowerEffects.ts` (registry-tracked time-staggered repeat — used by storm/meteor ultimates so they tear down cross-run):
```typescript
/** Fire `count` strikes spaced `intervalS` apart (registry-tracked, so it tears
 *  down cross-run). `onStrike(i)` runs each tick; the first fires immediately. */
export function repeatStrikes(scene: Scene, count: number, intervalS: number, onStrike: (i: number) => void): void {
    if (count <= 0) return;
    let fired = 0;
    let acc = intervalS; // fire #0 on the first frame
    let fx: ActiveFx;
    const obs = scene.onBeforeRenderObservable.add(() => {
        acc += scene.getEngine().getDeltaTime() / 1000;
        while (acc >= intervalS && fired < count) {
            acc -= intervalS;
            try { onStrike(fired); } catch { /* ignore */ }
            fired++;
        }
        if (fired >= count) endFx(fx);
    });
    fx = { scene, obs: obs!, cleanup: () => { /* no mesh; onStrike effects self-manage */ } };
    _activeEffects.add(fx);
}
```

- [ ] **Step 3: Add `ultimateImpact`** (the FX layer) to `PowerEffects.ts`:
```typescript
/** The "this is an ultimate" punch: camera shake + an element-tinted screen flash. */
export function ultimateImpact(element: PowerElement): void {
    cameraShake(0.4);
    const c = ELEMENT_COLOR[element];
    screenFlash(`rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},0.35)`, 260);
}
```

- [ ] **Step 4:** `tsc` + build + `npm test` (103) green. Commit: `feat(fx): repeatStrikes + ultimateImpact; share deliverAutocast`.

---

## Task 2: `UltimateArchetypes.ts` — the 5 element showpieces

**Files:** Create `src/survivors/powers/UltimateArchetypes.ts`.

Each archetype: `(ctx: PowerContext, damage: number, championType: ChampionType) => void`. They fire `ultimateImpact(element)` once, then deliver a screen-scale effect. Ranger routes per-strike via `deliverAutocast` (arrow → effect on impact). Use a local `randomAliveEnemy(enemies)` helper (returns a random alive enemy or null) and `nearestEnemy` (copy the small helper or import — define locally).

- [ ] **Step 1: Create the file with these 5 archetypes** (compose `PowerEffects`; damage fractions are starting points, tunable):

```typescript
import { Vector3 } from '@babylonjs/core';
import { StatusEffect } from '../GameTypes';
import {
    aoeBurst, chainHit, gatherVortex, omniVolley, deliverAutocast, repeatStrikes, ultimateImpact,
} from './PowerEffects';
import type { Enemy } from '../enemies/Enemy';
import type { PowerElement, PowerContext, ChampionType } from './PowerDefinitions';

function randomAliveEnemy(enemies: Enemy[]): Enemy | null {
    const alive = enemies.filter(e => e.isAlive());
    return alive.length ? alive[Math.floor(Math.random() * alive.length)] : null;
}

export type UltimateArchetype = (ctx: PowerContext, damage: number, championType: ChampionType) => void;

export const ULTIMATE_ARCHETYPES: Record<PowerElement, UltimateArchetype> = {
    // FIRE — Cataclysm: a rolling meteor storm. 6 strikes, each an AoE burst + burn
    // at a random enemy (ranger: each meteor is delivered by an arrow).
    fire: (ctx, damage, cls) => {
        ultimateImpact('fire');
        repeatStrikes(ctx.scene, 6, 0.12, () => {
            const t = randomAliveEnemy(ctx.enemies);
            if (!t) return;
            deliverAutocast(ctx, cls, t, 'fire', (x, z) => {
                aoeBurst(ctx.scene, ctx.enemies, x, z, {
                    radius: 3.2, damage, element: 'fire',
                    status: { effect: StatusEffect.BURNING, durationS: 3, strength: damage * 0.1 },
                });
            });
        });
    },

    // ICE — Absolute Zero: arena-wide freeze burst from the hero; frozen enemies are
    // shatter-primed (their death erupts in an ice nova).
    ice: (ctx, damage, _cls) => {
        ultimateImpact('ice');
        const radius = 9;
        aoeBurst(ctx.scene, ctx.enemies, ctx.heroPosition.x, ctx.heroPosition.z, {
            radius, damage, element: 'ice',
            status: { effect: StatusEffect.CHILL, durationS: 3, strength: 7 }, // 7 chill stacks → freeze
            ringLifeS: 0.5,
        });
        for (const e of ctx.enemies) {
            if (!e.isAlive()) continue;
            const p = e.getPosition();
            const dx = p.x - ctx.heroPosition.x, dz = p.z - ctx.heroPosition.z;
            if (dx * dx + dz * dz <= radius * radius) e.primeShatter(damage * 0.6, 3, 'ice');
        }
    },

    // ARCANE — Singularity: a large, strong, long gravity vortex that implodes.
    arcane: (ctx, damage, cls) => {
        ultimateImpact('arcane');
        const t = randomAliveEnemy(ctx.enemies);
        const cx = t ? t.getPosition().x : ctx.heroPosition.x;
        const cz = t ? t.getPosition().z : ctx.heroPosition.z;
        const spawn = (x: number, z: number) => gatherVortex(ctx.scene, ctx.enemies, x, z, {
            radius: 7, durationS: 2.2, pull: 1.4, tickDamage: damage * 0.25, tickIntervalS: 0.2,
            element: 'arcane', status: { effect: StatusEffect.SLOWED, durationS: 0.5, strength: 0.5 },
            finalBurst: damage * 1.2,
        });
        if (cls === 'ranger' && t) deliverAutocast(ctx, cls, t, 'arcane', spawn);
        else spawn(cx, cz);
    },

    // PHYSICAL — Maelstrom: repeated radial shrapnel bursts (blade storm) around the hero.
    physical: (ctx, damage, cls) => {
        ultimateImpact('physical');
        repeatStrikes(ctx.scene, 5, 0.14, () => {
            const originEnemy = randomAliveEnemy(ctx.enemies);
            const ox = originEnemy ? originEnemy.getPosition().x : ctx.heroPosition.x;
            const oz = originEnemy ? originEnemy.getPosition().z : ctx.heroPosition.z;
            const burst = (x: number, z: number) => omniVolley(ctx.scene, ctx.enemies, x, z, {
                count: 10, speed: 17, damage: damage * 0.4, element: 'physical',
                status: { effect: StatusEffect.FRAGILE, durationS: 3, strength: 0 },
            });
            if (cls === 'ranger' && originEnemy) deliverAutocast(ctx, cls, originEnemy, 'physical', burst);
            else burst(ox, oz);
        });
    },

    // STORM — Thunderstorm: rapid chain-lightning strikes that fork across the arena.
    storm: (ctx, damage, cls) => {
        ultimateImpact('storm');
        repeatStrikes(ctx.scene, 8, 0.1, () => {
            const t = randomAliveEnemy(ctx.enemies);
            if (!t) return;
            const strike = (x: number, z: number) => chainHit(ctx.scene, ctx.enemies, new Vector3(x, 1, z), {
                hops: 5, radius: 6, damage: damage * 0.6, element: 'storm', falloff: 0.85, split: true,
                status: { effect: StatusEffect.FRAGILE, durationS: 3, strength: 0 },
            });
            if (cls === 'ranger') deliverAutocast(ctx, cls, t, 'storm', strike);
            else { const p = t.getPosition(); strike(p.x, p.z); }
        });
    },
};
```

- [ ] **Step 2:** `tsc` + build green. Commit: `feat(ultimate): 5 element ultimate archetypes on PowerEffects`.

---

## Task 3: Ultimate factory + registry + element-union resolver

**Files:** Create `src/survivors/powers/UltimateDefinitions.ts`; modify `src/survivors/powers/FusionDefinitions.ts` (point `ULTIMATE_DEFS` at the new set); keep/repurpose `ultimates/MageUltimates.ts` only if still referenced (otherwise remove its import).

- [ ] **Step 1: Create `UltimateDefinitions.ts`:**
```typescript
import { ULTIMATE_ARCHETYPES } from './UltimateArchetypes';
import type { PowerDefinition, PowerElement, ChampionType } from './PowerDefinitions';

const CLASSES: ChampionType[] = ['barbarian', 'ranger', 'mage'];
const ELEMENTS: PowerElement[] = ['fire', 'ice', 'arcane', 'physical', 'storm'];

/** Class-flavored display names per element (mechanic is shared; this is skin). */
const ULTIMATE_NAMES: Record<ChampionType, Record<PowerElement, string>> = {
    mage:      { fire: 'Cataclysm',     ice: 'Absolute Zero',  arcane: 'Singularity',  physical: 'Maelstrom',      storm: 'Thunderstorm' },
    ranger:    { fire: 'Rain of Fire',  ice: 'Frozen Barrage', arcane: 'Void Quiver',  physical: 'Arrow Storm',    storm: 'Storm Volley' },
    barbarian: { fire: 'Volcanic Wrath',ice: 'Glacial Cataclysm', arcane: 'Rift Smash', physical: 'Whirlwind Fury', storm: 'Thunderclap' },
};

export function makeUltimateDef(cls: ChampionType, element: PowerElement): PowerDefinition {
    const id = `${cls}_ult_${element}`;
    const baseDamage = 60, baseCooldown = 7;
    return {
        id,
        name: ULTIMATE_NAMES[cls][element],
        element,
        icon: '✪',
        championType: cls,
        tier: 'ultimate',
        elements: [element],
        baseCooldown,
        baseDamage,
        baseRange: 16,
        maxLevel: 5,
        mode: 'autocast',
        cooldownFor: (s) => baseCooldown * Math.pow(0.94, s.level - 1),
        damageFor:   (s) => baseDamage  * Math.pow(1.25, s.level - 1),
        cast: (state, ctx) => {
            const damage = baseDamage * Math.pow(1.25, state.level - 1) * ctx.damageMultiplier;
            ULTIMATE_ARCHETYPES[element](ctx, damage, cls);
        },
    };
}

/** All 15 ultimate defs, keyed by id. */
export const ULTIMATE_DEFS: Record<string, PowerDefinition> = (() => {
    const out: Record<string, PowerDefinition> = {};
    for (const c of CLASSES) for (const e of ELEMENTS) { const d = makeUltimateDef(c, e); out[d.id] = d; }
    return out;
})();

export function getUltimateForClassElement(cls: ChampionType, element: PowerElement): PowerDefinition | undefined {
    return ULTIMATE_DEFS[`${cls}_ult_${element}`];
}

/** Offer = the class's ultimate for each element in the UNION of the two fusions'
 *  elements (deduped, stable order). Two distinct fusions share 0–1 elements ⇒ 3–4. */
export function getUltimateOfferForFusions(cls: ChampionType, a: PowerDefinition, b: PowerDefinition): PowerDefinition[] {
    const seen = new Set<PowerElement>();
    const union: PowerElement[] = [];
    for (const e of [...(a.elements ?? [a.element]), ...(b.elements ?? [b.element])]) {
        if (!seen.has(e)) { seen.add(e); union.push(e); }
    }
    return union.map(e => getUltimateForClassElement(cls, e)).filter((d): d is PowerDefinition => !!d);
}
```

- [ ] **Step 2: Point `FusionDefinitions.ULTIMATE_DEFS` at the new set.** In `FusionDefinitions.ts`, replace the `MAGE_ULTIMATES`-based `ULTIMATE_DEFS` with a re-export from `UltimateDefinitions` (and drop the `MAGE_ULTIMATES` import). `getAnyPowerDef` must still resolve ultimate ids (it reads `ULTIMATE_DEFS`). Keep `getUltimatesForClass` working (it can filter the new `ULTIMATE_DEFS` by championType) for any残 callers, but the offer will use `getUltimateOfferForFusions`.
```typescript
// FusionDefinitions.ts
import { ULTIMATE_DEFS as ALL_ULTIMATE_DEFS } from './UltimateDefinitions';
export const ULTIMATE_DEFS = ALL_ULTIMATE_DEFS;
// getUltimatesForClass: Object.values(ULTIMATE_DEFS).filter(d => d.championType === type)
```
(Remove the `import { MAGE_ULTIMATES } from './ultimates/MageUltimates';` and its loop. The old `ultimates/MageUltimates.ts` becomes dead — delete it.)

- [ ] **Step 3:** `tsc` + build + `npm test` green (FusionFactory.spec, etc.). Commit: `feat(ultimate): factory + 15 defs + element-union offer resolver`.

---

## Task 4: Wire the element-union offer into the gameplay state

**Files:** Modify `src/survivors/SurvivorsGameplayState.ts`.

- [ ] **Step 1:** Replace the ultimate branch of `buildFusionOfferCards` (the `maxedFusions.length >= 2` block, ~line 1250-1265). Use `getUltimateOfferForFusions`:
```typescript
        const maxedFusions = maxed.filter(s => s.def.tier === 'fusion');
        if (maxedFusions.length >= 2) {
            const a = maxedFusions[0];
            const b = maxedFusions[1];
            const offer = getUltimateOfferForFusions(this.currentChampionType, a.def, b.def);
            const cards = offer.map((ult): PowerCard => ({
                kind: 'ultimate',
                title: ult.name,
                subtitle: `ULTIMATE · ${ult.element} · forge from ${a.def.name} + ${b.def.name}`,
                element: ult.element,
                onPick: () => {
                    this.powerSlots!.fuse(a.def.id, b.def.id, ult.id);
                    this.playForgeVfx(true);
                },
            }));
            return cards.length > 0 ? cards : null;
        }
```
Update the import on line 16 to bring `getUltimateOfferForFusions` from `./powers/FusionDefinitions` (re-export it from there) or directly from `./powers/UltimateDefinitions`. (Re-export from FusionDefinitions to keep one import site: add `export { getUltimateOfferForFusions } from './UltimateDefinitions';` — or import directly.) Remove the now-unused `getUltimatesForClass` import if nothing else uses it.

- [ ] **Step 2:** Confirm the power-choice overlay handles up to **4** ultimate cards (the union can be 4). If the desktop layout caps at 3, extend it to 4 (per the spec §8). If it already flexes, no change. Verify in the smoke.

- [ ] **Step 3:** `tsc` + build + `npm test` green. Commit: `feat(ultimate): offer per-element ultimates from the two fusions' element union`.

---

## Task 5: Verification + smoke

- [ ] `npm test` (103+) · `npx tsc --noEmit` (0) · `npm run build` (success).
- [ ] In-game (`?test` cycles fusions; to test ultimates, level two fusions to 5 — or extend `?test` to also grant ultimates, optional): pick mage, build two fusions covering 3–4 elements, confirm the **per-element ultimate offer** appears, pick one, and confirm the showpiece fires (meteor storm / freeze+shatter / vortex / blade storm / thunderstorm) with **camera shake + screen flash**. Confirm ranger ultimates **fire via arrows**. Watch console: no `[resource-watchdog]` / `[freeze:longtask]` from ultimates; effects torn down on quit-to-menu (the `_activeEffects` registry).

---

## Notes
- Numbers (damage fractions, strike counts, radii, cooldown 7s/damage 60 base) are starting points (spec §13) — tune in the smoke.
- `MageUltimates.ts` is replaced by the factory; delete it once `FusionDefinitions` no longer imports it.
- Ranger ultimate "from arrows": each strike is delivered via `deliverAutocast` → `arrowStrike` for the ranger class, so meteors/thunder/shrapnel originate as arrows; mage/barbarian deliver directly.
- The shadow-cost optimization is handled separately in the performance-review pass.
