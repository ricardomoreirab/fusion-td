# Power Overhaul — Phase 2 (Slice 2): Five Primitive-Diverse Fusion Archetypes

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Author 5 more fusion archetypes — Tempest Ember (Overload), Rimecaster (Glacial Vortex), Molten Edge (Magma Trail), Voltaic Rune (Arc Split), Runeblade (Rune Burst) — each chosen to exercise a *different* `PowerEffects` primitive so the in-game smoke validates the whole effect surface.

**Architecture:** Pure additive content. The dispatch infra (`FusionArchetypeRegistry`, `makeFusionDef` dispatch with fallback, the Frostfire template) already exists from slice 1. Each archetype registers one `AutocastArchetype` + one `PassiveArchetype` in `FusionArchetypes.ts`, composing the leak-safe primitives (`chainHit`, `gatherVortex`, `persistentZone`, `omniVolley`, `dealElementalHit`, status applies, `primeShatter`). Heavy passive (barbarian-mode) archetypes that spawn a zone/vortex/volley use a proc chance so they don't spawn one per basic hit. **No changes to FusionFactory/registry/PowerEffects.**

**Tech Stack:** TypeScript, BabylonJS.

**Context:** Phase 2 slice 2 (spec §6; slice 1 = Frostfire, done & committed). Branch `feat/power-fusion-ultimate-overhaul`. The PowerEffects primitives exist (Plan 1b) and are leak-safe (cached materials, `mesh.visibility` fade, `_activeEffects` cross-run teardown). Their signatures (from `src/survivors/powers/PowerEffects.ts`):
- `dealElementalHit(scene, enemies, target, damage, element)`
- `aoeBurst(scene, enemies, x, z, { radius, damage, element, status?, ringLifeS? })`
- `chainHit(scene, enemies, origin: Vector3, { hops, radius, damage, element, falloff?, status?, split? })`
- `gatherVortex(scene, enemies, x, z, { radius, durationS, pull, tickDamage, tickIntervalS?, element, status?, finalBurst? })`
- `persistentZone(scene, enemies, x, z, { radius, durationS, tickIntervalS?, tickDamage, element, status?, crawlToward?, crawlSpeed? })`
- `omniVolley(scene, enemies, x, z, { count, speed, damage, element, lifeS?, hitRadius?, status? })`

`EffectStatus = { effect: StatusEffect; durationS: number; strength: number }`. `archetypeKey(a, b)` returns the sorted `elem_elem` key (order ELEMENT_ORDER = fire, ice, arcane, physical, storm). `getCachedMaterial` etc. are NOT used here — all FX go through the primitives.

**Environment notes:** Trust `npx tsc --noEmit` (exit 0) + `npm run build` + `npm test` — NOT the IDE. `Math.random()` for gameplay proc chance is fine (this is the proven crit-roll pattern); the "no Math.random" rule is ONLY for material cache keys.

---

## File Structure

- **Modify** `src/survivors/powers/FusionArchetypes.ts` — add `Vector3` import + 4 more `PowerEffects` imports; append the 5 archetypes (each registers autocast + passive).

---

## Task 1: Add the five archetypes to `FusionArchetypes.ts`

**Files:**
- Modify: `src/survivors/powers/FusionArchetypes.ts`

No unit test (Babylon-coupled); verified by `tsc` + build + the Task 2 smoke.

- [ ] **Step 1: Extend the imports**

The current top of `FusionArchetypes.ts` is:
```typescript
import { StatusEffect } from '../GameTypes';
import { dealElementalHit, aoeBurst } from './PowerEffects';
import { registerAutocastArchetype, registerPassiveArchetype, archetypeKey } from './FusionArchetypeRegistry';
import type { Enemy } from '../enemies/Enemy';
import type { PowerElement, PowerContext, EnchantmentHitContext } from './PowerDefinitions';
```
Replace it with (adds `Vector3` + the 4 primitives used below; `aoeBurst` stays for Frostfire):
```typescript
import { Vector3 } from '@babylonjs/core';
import { StatusEffect } from '../GameTypes';
import { dealElementalHit, aoeBurst, chainHit, gatherVortex, persistentZone, omniVolley } from './PowerEffects';
import { registerAutocastArchetype, registerPassiveArchetype, archetypeKey } from './FusionArchetypeRegistry';
import type { Enemy } from '../enemies/Enemy';
import type { PowerElement, PowerContext, EnchantmentHitContext } from './PowerDefinitions';
```

- [ ] **Step 2: Append the five archetypes** at the end of `FusionArchetypes.ts` (after the Frostfire registrations):

```typescript
// ── Tempest Ember (fire+storm) — Overload ───────────────────────────────────
// Plant/refresh burn, then a STORM hit detonates the accumulated burn via the
// storm→burn 'overload' cross-reaction in dealElementalHit. Repeated casts build
// the burn and pop it for an AoE — the overload loop.
function applyTempest(scene: PowerContext['scene'], enemies: Enemy[], target: Enemy, damage: number): void {
    target.applyStatusEffect(StatusEffect.BURNING, 3, damage * 0.2); // plant/refresh a burn stack
    dealElementalHit(scene, enemies, target, damage, 'storm');       // storm → detonates burn (overload)
}
registerAutocastArchetype(archetypeKey('fire', 'storm'), (_state, ctx, damage) => {
    const t = nearestEnemy(ctx.enemies, ctx.heroPosition.x, ctx.heroPosition.z, 12);
    if (t) applyTempest(ctx.scene, ctx.enemies, t, damage);
});
registerPassiveArchetype(archetypeKey('fire', 'storm'), (enemy, level, ctx: EnchantmentHitContext) => {
    applyTempest(ctx.scene, ctx.enemies, enemy, ctx.baseDamage * (0.3 + 0.2 * level));
});

// ── Rimecaster (ice+arcane) — Glacial Vortex ────────────────────────────────
// A gravity well that pulls enemies in, chilling (→ freeze) them, then implodes.
registerAutocastArchetype(archetypeKey('ice', 'arcane'), (_state, ctx, damage) => {
    const t = nearestEnemy(ctx.enemies, ctx.heroPosition.x, ctx.heroPosition.z, 12);
    if (!t) return;
    const p = t.getPosition();
    gatherVortex(ctx.scene, ctx.enemies, p.x, p.z, {
        radius: 4, durationS: 1.4, pull: 0.9, tickDamage: damage * 0.2, tickIntervalS: 0.2,
        element: ctx.element, status: { effect: StatusEffect.CHILL, durationS: 1.5, strength: 2 },
        finalBurst: damage * 0.9,
    });
});
registerPassiveArchetype(archetypeKey('ice', 'arcane'), (enemy, level, ctx: EnchantmentHitContext) => {
    const dmg = ctx.baseDamage * (0.3 + 0.2 * level);
    dealElementalHit(ctx.scene, ctx.enemies, enemy, dmg, ctx.element);
    if (enemy.isAlive()) enemy.applyStatusEffect(StatusEffect.CHILL, 1.5, 2);
    if (Math.random() < 0.15) { // occasional vortex proc on a basic hit
        const p = enemy.getPosition();
        gatherVortex(ctx.scene, ctx.enemies, p.x, p.z, {
            radius: 3, durationS: 1.0, pull: 0.9, tickDamage: dmg * 0.2, tickIntervalS: 0.2,
            element: ctx.element, status: { effect: StatusEffect.CHILL, durationS: 1.5, strength: 2 },
            finalBurst: dmg * 0.6,
        });
    }
});

// ── Molten Edge (fire+physical) — Magma Trail ───────────────────────────────
// Leaves a burning lava pool on the ground.
registerAutocastArchetype(archetypeKey('fire', 'physical'), (_state, ctx, damage) => {
    persistentZone(ctx.scene, ctx.enemies, ctx.heroPosition.x, ctx.heroPosition.z, {
        radius: 3, durationS: 3, tickIntervalS: 0.5, tickDamage: damage * 0.25,
        element: 'fire', status: { effect: StatusEffect.BURNING, durationS: 2, strength: damage * 0.1 },
    });
});
registerPassiveArchetype(archetypeKey('fire', 'physical'), (enemy, level, ctx: EnchantmentHitContext) => {
    const dmg = ctx.baseDamage * (0.3 + 0.2 * level);
    dealElementalHit(ctx.scene, ctx.enemies, enemy, dmg, ctx.element);
    if (Math.random() < 0.2) {
        const p = enemy.getPosition();
        persistentZone(ctx.scene, ctx.enemies, p.x, p.z, {
            radius: 2.5, durationS: 2.5, tickIntervalS: 0.5, tickDamage: dmg * 0.25,
            element: 'fire', status: { effect: StatusEffect.BURNING, durationS: 2, strength: dmg * 0.1 },
        });
    }
});

// ── Voltaic Rune (arcane+storm) — Arc Split ─────────────────────────────────
// Chain lightning that forks into two each hop, applying Fragile (amp) to every
// enemy it touches.
registerAutocastArchetype(archetypeKey('arcane', 'storm'), (_state, ctx, damage) => {
    chainHit(ctx.scene, ctx.enemies, new Vector3(ctx.heroPosition.x, 1, ctx.heroPosition.z), {
        hops: 4, radius: 5, damage, element: 'storm', falloff: 0.8, split: true,
        status: { effect: StatusEffect.FRAGILE, durationS: 3, strength: 0 },
    });
});
registerPassiveArchetype(archetypeKey('arcane', 'storm'), (enemy, level, ctx: EnchantmentHitContext) => {
    const dmg = ctx.baseDamage * (0.3 + 0.2 * level);
    const p = enemy.getPosition();
    chainHit(ctx.scene, ctx.enemies, new Vector3(p.x, 1, p.z), {
        hops: 3, radius: 4.5, damage: dmg, element: 'storm', falloff: 0.75, split: true,
        status: { effect: StatusEffect.FRAGILE, durationS: 3, strength: 0 },
    });
});

// ── Runeblade (arcane+physical) — Rune Burst ────────────────────────────────
// A burst of rune-shots fired outward in all directions, applying Fragile.
registerAutocastArchetype(archetypeKey('arcane', 'physical'), (_state, ctx, damage) => {
    omniVolley(ctx.scene, ctx.enemies, ctx.heroPosition.x, ctx.heroPosition.z, {
        count: 6, speed: 16, damage: damage * 0.7, element: ctx.element,
        status: { effect: StatusEffect.FRAGILE, durationS: 3, strength: 0 },
    });
});
registerPassiveArchetype(archetypeKey('arcane', 'physical'), (enemy, level, ctx: EnchantmentHitContext) => {
    const dmg = ctx.baseDamage * (0.3 + 0.2 * level);
    dealElementalHit(ctx.scene, ctx.enemies, enemy, dmg, ctx.element);
    if (enemy.isAlive()) enemy.applyStatusEffect(StatusEffect.FRAGILE, 3, 0);
    if (Math.random() < 0.15) {
        const p = enemy.getPosition();
        omniVolley(ctx.scene, ctx.enemies, p.x, p.z, {
            count: 5, speed: 16, damage: dmg * 0.6, element: ctx.element,
            status: { effect: StatusEffect.FRAGILE, durationS: 3, strength: 0 },
        });
    }
});
```

> Notes for the implementer:
> - `nearestEnemy` already exists in this file (used by Frostfire) — reuse it, don't redefine.
> - `archetypeKey` sorts elements (ELEMENT_ORDER = fire,ice,arcane,physical,storm), so `archetypeKey('ice','arcane')` → `'ice_arcane'`, `archetypeKey('arcane','storm')` → `'arcane_storm'`, etc. The order you pass the two element strings does not matter.
> - These all compose the leak-safe primitives — **do NOT create any mesh/material directly** in this file.
> - `Math.random()` here is gameplay proc chance (fine); it is NOT a material key.

- [ ] **Step 3: Type-check + build** — `npx tsc --noEmit` → exit 0; `npm run build` → success (pre-existing entrypoint-size warnings OK).
- [ ] **Step 4: Commit**

```bash
git add src/survivors/powers/FusionArchetypes.ts
git commit -m "feat(fusion): 5 archetypes — Tempest Ember, Rimecaster, Molten Edge, Voltaic Rune, Runeblade"
```

---

## Task 2: Verification + in-game smoke (validates the full PowerEffects surface)

**Files:** none.

- [ ] **Step 1: Unit suite** — `npm test` → 103 pass (no test touches these; confirm none broke).
- [ ] **Step 2: Type-check** — `npx tsc --noEmit` → exit 0.
- [ ] **Step 3: Build** — `npm run build` → success.
- [ ] **Step 4: In-game smoke (mage, autocast).** `npm start`. For each pair, level the two base elements to 5 and take the fusion, then confirm the signature behavior + no `[resource-watchdog]` / `[freeze:longtask]` over several waves:
  - **Tempest Ember (fire+storm):** enemies get a burn DoT; the storm hit **detonates the burn into an AoE** (fire ring) — overload.
  - **Rimecaster (ice+arcane):** a vortex **pulls enemies inward**, chills→freezes them, then implodes (final burst).
  - **Molten Edge (fire+physical):** a **lingering lava disc** ticks burn on enemies standing in it.
  - **Voltaic Rune (arcane+storm):** chain lightning that **forks** (hits more enemies than hops suggest) and leaves them taking extra damage (Fragile).
  - **Runeblade (arcane+physical):** a **radial burst of projectiles** outward from the hero.
  - Confirm material/texture counts stay near baseline (the FX materials are cached by element — bounded), and that quitting to menu mid-effect doesn't carry an effect into the next run (the `_activeEffects` teardown from Plan 1b).
- [ ] **Step 5: Final commit (if any tuning tweaks)**

```bash
git add -A && git commit -m "test(fusion): Phase 2 slice-2 verification pass" || echo "nothing to commit"
```

---

## Notes for the implementer

- **Numbers are starting points** (spec §13). If a behavior feels too weak/strong in the smoke, tune the literals (radius, durationS, damage fractions, proc chance, chill stacks) — don't change the primitive APIs or `STATUS_TUNING` thresholds for one archetype.
- **Passive proc cadence:** zone/vortex/volley archetypes use a `Math.random()` proc on basic hits so a melee build doesn't spawn one every swing; light archetypes (Tempest overload, Voltaic chain) apply every hit. Tune the proc chances in the smoke.
- **Remaining (slice 3):** Hexflame (fire+arcane, curse+fragile), Glacial Edge (ice+physical, frost-cleave + shatter), Blizzard (ice+storm, creeping zone + chain), Thunderstrike (physical+storm, chain-shrapnel) — all reuse these now-validated primitives.
