# Power System Overhaul — Distinct Fusions & All-Class Ultimates

- **Date:** 2026-05-30
- **Status:** Approved design — ready for implementation planning
- **Scope:** `src/survivors/powers/**`, `src/survivors/abilities/AbilityManager.ts`, `src/survivors/enemies/Enemy.ts`, `src/survivors/GameTypes.ts`, fusion/ultimate UI flow in `SurvivorsGameplayState.ts` and the power-choice overlays.

## 1. Summary

The survivors power system has three tiers — base powers, fusions (two maxed bases), and ultimates (two maxed fusions). Two problems make the upper tiers fall flat:

1. **Fusions are mechanically hollow.** `FusionFactory.makeFusionDef` (`FusionFactory.ts:127-135`) just runs *both* parent `cast()` functions back-to-back at 1.25× damage. "Frostfire" is literally a Fireball and a Frost Shard fired together — no emergent behavior. This is the "fusions aren't very different than the normal ones" complaint.
2. **Ultimates are mage-only and disconnected.** Only `ultimates/MageUltimates.ts` exists (3 ultimates). The gate at `SurvivorsGameplayState.ts:1217` requires two maxed fusions but then offers a *fixed* 3 generic class ultimates, unrelated to which fusions you actually built.

This overhaul makes **fusions change a power's category** (the genre lesson: burst→persistent, projectile→orbit, single→gather, or add a status cross-reaction), and makes **ultimates climactic, element-themed, and defined for every class** — chosen from the combined elements of the two fusions that forged them.

The work rests on a new **effect-primitive library** and a **rich status system**, built once and reused by every fusion and ultimate.

## 2. Goals & non-goals

**Goals**
- Every fusion (10 per class) has a distinct, emergent behavior — not a numeric merge of its parents.
- Every class has a full set of ultimates (5 per class, one per element); no dead-end fusions.
- An ultimate is offered per-element from the *union* of the two maxed fusions' elements; the player picks one.
- Ultimates feel like a climax: screen-scale geometry, camera shake, flash, hitstop, oversized particles.
- A reusable, **leak-safe** effect-primitive + status foundation so future powers compose instead of hardcode.

**Non-goals (out of scope)**
- The hero's manual Q/E/Space **active abilities** (Whirlwind, Smash, Multishot, Explosive Arrow, Dash, Meteor, Frost Nova) stay as-is. The new tier-3 ultimates are **autocast slot powers**, consistent with the current mage ultimates. The two systems remain separate. (Optional later cleanup: rename the HUD "ultimate buttons" to "abilities" to remove the naming collision — not part of this work.)
- No new base powers, classes, or elements. The 3 classes × 5 elements grid is unchanged.
- No change to gold/shop economy or wave pacing.

## 3. Locked design decisions

| Decision | Choice |
|---|---|
| Ultimate mapping | **Element-theme** — the union of the two fusions' elements decides which ultimates are offered |
| Ultimate play-style | **Autocast showpiece** — occupies a slot, fires on cooldown (like today's mage ults) |
| Ultimate selection | **Pick from present elements** — one ultimate per element in the combined set; player chooses |
| Status depth | **Rich status model** — stacking, thresholds, cross-reactions (the synergy engine) |
| Ultimate roster | **5 per class, one per element**; mechanic keyed to element (5 archetypes), each class skins all 5 |

## 4. Progression model

```
BASE  (5 elements × 3 classes)
  └─ two maxed (Lv5) base powers, same class ─► FUSION  (10 per class, by element pair)
        └─ two maxed (Lv5) fusions ─► ULTIMATE
              offer = one ✪ per element in UNION(fusionA.elements, fusionB.elements)
              two distinct fusions share 0 or 1 element ⇒ union is 3 or 4 elements
              ⇒ 3–4 ultimate cards offered; player picks 1; both fusions consumed,
                ultimate placed at Lv1 in the freed slot (current fuse() behavior reused)
```

**Worked example:** `Frostfire{fire,ice}` + `Blizzard{ice,storm}` → union `{fire, ice, storm}` → offered Inferno (fire) / Absolute Zero (ice) / Thunderstorm (storm) → pick one.

The "both Lv5" gate is unchanged in spirit (today's gate already requires maxed fusions); the new part is **which** ultimate(s) are offered and that **every** fusion participates.

## 5. Foundation layer (Phase 1)

This is the riskiest phase because it touches core enemy code and is where the project's recurring **transient-FX material-orphan freeze** would re-appear if discipline slips (see CLAUDE.md "Key design invariants"). The foundation is the single chokepoint that *enforces* leak-safety so the dozens of new effects above it cannot regress.

### 5.1 `src/survivors/powers/PowerEffects.ts` — composable effect primitives

A Babylon-aware library. Each function self-manages its lifetime via a scene observer and disposes cleanly. **Leak rules (mandatory, enforced here so callers can't get it wrong):**
- All materials via `getCachedMaterial(scene, key, …)` with a **bounded** key (element name / colour hex / effect name) — never `Math.random()`, never instance ids. (Note: existing `MageUltimates.spawnShockRing` at `MageUltimates.ts:14` uses `'ult_ring_mat_' + Math.random()` — migrate it to a cached key as part of this phase.)
- Unique animated meshes are disposed with `mesh.dispose(false, true)`; pooled/shared meshes fade via `mesh.visibility`, never by mutating a shared/frozen material's `.alpha`.
- Reuse `ProjectilePool` / bolt-segment pools where a primitive spawns many short-lived meshes.

Proposed API (signatures; exact params tuned in the plan):

| Primitive | Signature (sketch) | Notes |
|---|---|---|
| `aoeBurst` | `(ctx, center, {radius, damage, element, status?, ring?})` | instant radial damage + optional expanding ring (replaces ad-hoc nova loops) |
| `chainHit` | `(ctx, origin, {hops, radius, damage, falloff, element, status?, split?})` | chain to nearest; `split:true` branches into 2 per hop (Arc Split / exponential) |
| `gatherVortex` | `(ctx, center, {radius, duration, pull, tickDamage, tickInterval, element, status?, finalBurst})` | pulls enemies inward, ticks, optional implosion burst (generalises Singularity) |
| `persistentZone` | `(ctx, center, {radius, duration, tickInterval, tickDamage, element, status?, crawlToward?})` | lingering hazard field; `crawlToward` makes it creep toward a point (La Borra) |
| `omniVolley` | `(ctx, origin, {count, spread\|directions, projectile})` | multi-directional projectile spray |
| `dealElementalHit` | `(ctx, enemy, damage, element)` | **single chokepoint**: applies damage incl. Fragile amplification + fires status cross-reactions |
| `cameraShake` | `(strength, durationMs)` | via a registered hook into `HeroController` camera (see 5.4) |
| `screenFlash` | `(color, durationMs)` | full-screen tint pulse |
| `hitstop` | `(durationMs)` | brief global time-scale dip for impact |

`ctx` is the existing `PowerContext` (`scene, heroPosition, enemies, damageMultiplier, element`).

`shatterOnDeath` is **not** a primitive call; it is a status-driven enemy effect (see 5.2) so it fires correctly on the real kill, whatever the source.

### 5.2 Rich status system

Extend `GameTypes.StatusEffect` and `Enemy` status handling from single-shot effects to a **stack model**.

**Status kinds**

| Kind | Model | Effect |
|---|---|---|
| **Burn** | stacking, cap ~20, tick 0.5s | DoT per stack; applying past cap *detonates* all stacks as one burst, stacks not consumed (Halls-of-Torment rule) |
| **Chill** | stacking soft-slow | each stack slows; at threshold (~7 stacks) converts to **Freeze** |
| **Freeze** | hard CC (existing FROZEN) | immobilise; can be **shatter-primed** (see below) |
| **Slow** | existing SLOWED | multiplier slow (reused unchanged) |
| **Stun / Push** | existing | reused unchanged |
| **Curse / Mark** | timed | drains a % of *max* HP per second over the duration |
| **Fragile** | stacking amplifier | +X% (≈5%/stack) incoming **direct** damage; applied inside `dealElementalHit` |

**Data model:** add a per-enemy `statuses` map tracking `{ stacks, expiresAt, nextTickAt, … }` per kind. `Enemy.applyStatusEffect` becomes stack-aware (additive with cap + timer refresh). Ticking (Burn/Curse DoT, Chill→Freeze conversion, expiry) runs in `Enemy.update(dt)`. Keep the existing freeze/stun immunity windows (3s / 5s, see CLAUDE.md Balance).

**Shatter-on-death:** applying Freeze (or an explicit shatter-priming call) can store `shatterDamage`/`shatterRadius` on the enemy. `Enemy.die()` checks it and emits an `aoeBurst` (re-applying the relevant status to neighbours). Hooks into the existing `die()` path (the in-wave death path — see memory `enemy_death_disposal_leak`), **not** `dispose()`.

**Cross-reaction registry:** a small table keyed by `(incomingElement, presentStatusKind) → reaction(ctx, enemy)`, consulted inside `dealElementalHit`. Initial entry: `(storm, Burn) → detonate Burn stacks` (Overload). The registry is the data-driven synergy engine; fusions/ultimates light up reactions by virtue of which element + status they apply.

### 5.3 Damage-number element colouring

All new damage routes through `dealElementalHit`, which must pass the source element to `Enemy.takeDamage(amount, element)` so floating numbers colour correctly (see memory `element_colors_single_source`). DoT ticks colour by their status's element (Burn=fire, Curse=arcane, etc.).

### 5.4 FX helper wiring

`cameraShake` needs the camera. To avoid coupling `PowerEffects` to `HeroController`, expose a small registration hook (e.g. `PowerEffects.setCameraShakeHook(fn)`) wired once in `SurvivorsGameplayState.enter()` from the existing `HeroController` camera-shake path (`CAMERA_SHAKE_MAGNITUDE`). `screenFlash`/`hitstop` operate on the scene/engine directly. All FX must be torn down in `SurvivorsGameplayState.exit()` (no lingering observers/timescale).

## 6. Fusion rework (Phase 2)

Replace the "run both parents" behavior in `makeFusionDef` with **authored per-element-pair archetypes** built on `PowerEffects`. Identity is by element pair (existing `FUSION_NAMES`); **delivery adapts to class mode**:
- **Autocast** (mage, ranger): the fusion casts a spell/projectile that delivers the archetype's effect.
- **Passive** (barbarian): the archetype triggers as an on-hit proc; persistent/zone archetypes spawn on hit, chains/detonations fire from the struck enemy.

The archetype identity (the *what*) is shared across classes; only the delivery (the *how*) differs.

| Pair (name) | Archetype — emergent behavior | Grammar verb | Statuses |
|---|---|---|---|
| fire+ice **Frostfire** | **Shatter-Burn** — applies Chill + Burn; an enemy frozen (via Chill threshold) that dies erupts in a burning nova | detonate-on-death | Chill→Freeze, Burn, shatter |
| fire+arcane **Hexflame** | **Hexfire** — Curses target (%HP drain); its Burn DoT is amplified by Fragile stacks the fusion also applies | mark + amplify | Burn, Curse, Fragile |
| fire+physical **Molten Edge** | **Magma Trail** — leaves a persistent lava pool that Burns enemies in it | persist | Burn (zone) |
| fire+storm **Tempest Ember** | **Overload** — plants Burn; a storm hit on a Burning enemy detonates the stacks for an AoE | detonate-on-condition | Burn → Overload |
| ice+arcane **Rimecaster** | **Glacial Vortex** — a gravity well pulls enemies in, Chilling→Freezing them at the core | gather | Chill→Freeze |
| ice+physical **Glacial Edge** | **Frost Cleave** — wide cleave that Chills; striking a frozen enemy shatters it (AoE) | multi-direct + detonate | Chill→Freeze, shatter |
| ice+storm **Blizzard** | **Static Blizzard** — a creeping zone that Chills and arcs lightning between Chilled enemies | persist + chain | Chill, chain |
| arcane+physical **Runeblade** | **Rune Burst** — piercing rune-shots that detonate on expiry and apply Fragile | pierce + detonate + amplify | Fragile |
| arcane+storm **Voltaic Rune** | **Arc Split** — chain lightning that splits into two each hop (branching) and applies Fragile | split + chain + amplify | Fragile |
| physical+storm **Thunderstrike** | **Chain-Shrapnel** — chains, and each hop bursts into shrapnel fragments | chain + MIRV | — |

**Numbers (starting point, tuned in plan):** preserve the current fusion power budget — fused `baseDamage ≈ sum of parents` (autocast bases are 9–22, so fusions land ~20–36), cooldown ≈ averaged parents × 0.85, ×1.25 per-tier emphasis folded into the archetype's main hit. Status params seed from the genre research (Burn 0.5s tick / cap 20; Chill→Freeze at ~7; Fragile +5%/stack). Each archetype keeps level scaling (more hops/larger radius/longer zone with level).

**`makeFusionDef` change:** it keeps composing identity/metadata (id, name, element pair, parents, championType, level scaling) but its `cast`/`onHit` now dispatches to an **archetype function selected by element pair + mode**, instead of looping over parents. A per-pair archetype registry (`FusionArchetypes.ts`) maps `elemPairKey → { autocast, passive }` implementations. Fusions retain their `parents`/`elements` metadata (needed for the ultimate union).

## 7. Ultimate system (Phase 3)

### 7.1 Five element archetypes (mechanic), skinned per class (visuals)

The ultimate's mechanic is keyed to its **element** (5 archetypes); each class instantiates all 5 with its own visual skin and a small class-flavored rider. Three exist already (mage) and need polish + the special-FX layer:

| Element | Archetype | Screen-scale showpiece |
|---|---|---|
| fire | **Cataclysm** *(exists, polish)* | rolling meteor storm; impacts leave Burning craters |
| ice | **Absolute Zero** *(exists, + shatter)* | arena freeze burst; frozen enemies shatter into chained AoE |
| arcane | **Singularity** *(exists)* | gravity vortex pulls everything in, then implodes (built on `gatherVortex`) |
| physical | **Maelstrom** *(new)* | giant expanding blade-cyclone / shrapnel storm sweeping outward from the hero |
| storm | **Thunderstorm** *(new)* | lightning rains across every on-screen enemy, arcing between them (built on `chainHit`) |

**Class skins** (same core mechanic, different dress + rider), e.g. fire → mage *Cataclysm* / barbarian *Volcanic Wrath* (ground erupts around hero) / ranger *Rain of Fire* (fire-arrow meteor volley). The 5 archetypes live in shared helpers; per-class modules (`MageUltimates.ts`, new `BarbarianUltimates.ts`, `RangerUltimates.ts`) declare the 5 defs each with class skin + element identity.

**Numbers:** stay in the existing ultimate band — base damage ~50–70, cooldown ~6–8s, scaling `damage ×1.25`, `cooldown ×0.94` per level (matches current mage ults). All autocast, `maxLevel 5`, `tier:'ultimate'`.

**Special-FX layer (every ultimate cast):** `cameraShake` + `screenFlash` (element-tinted) + brief `hitstop` + oversized particle burst. Implemented once as an `ultimateImpact(ctx, element)` helper so all 15 share it.

### 7.2 Registry & resolution

- `ULTIMATE_DEFS` aggregates all three class modules (today it only loads `MAGE_ULTIMATES` — `FusionDefinitions.ts:32-36`).
- New resolver: given two fusion defs, compute `union(elements)`, then return the class's ultimate def for each element in the union → the offer set. Add `getUltimateForClassElement(class, element)` and `getUltimateOfferForFusions(fusionA, fusionB)`.

### 7.3 Trigger & slot flow

- `SurvivorsGameplayState.buildFusionOfferCards` (`:1213-1260`): when two maxed fusions exist, replace the fixed `getUltimatesForClass` list with `getUltimateOfferForFusions(...)` (3–4 element-themed cards).
- `PowerSlotManager.fuse` (`:94-120`) is reused unchanged for the consume-both-place-one mechanic (it already validates maxed parents, disposes both, inits the result at Lv1).

## 8. UI changes

- **Power-choice overlay:** today's desktop layout assumes ≤3 cards (`PowerChoiceOverlay.ts`, `ui/overlays/PowerChoice.ts`). The union can yield **4** ultimate cards. Either extend the desktop layout to lay out 4 cards, or cap the offer at 3 by a documented priority rule (e.g. prefer the shared element + the two primaries). **Decision: extend to 4** to honour "no dead ends / every invested element reachable"; mobile already stacks vertically and is unaffected.
- **HUD:** ultimate slot display (`HeroHud.ts` glyph `✪`, gold tint) already handles tier-3 powers; no change needed beyond the new defs resolving. Ultimate auto-cast uses the existing slot cooldown sweep.
- No change to the separate Q/E/Space ability buttons (out of scope).

## 9. Data model changes

`PowerDefinition` (`PowerDefinitions.ts:38-79`) is already expressive enough (`tier`, `championType`, `parents`, `elements`, `cast`, `cooldownFor`, `damageFor`). Likely additions, kept minimal:
- Fusion defs continue to carry `elements: [a,b]` (already do) — required for the ultimate union.
- No new required fields; archetype selection is by `(elements, mode)` via the archetype registry, not a new discriminator on the def. (If a registry lookup proves awkward, add an optional `archetype?: string` tag — decide in the plan.)

`StatusEffect` (`GameTypes.ts:30-38`) gains `CHILL`, `CURSE`, `FRAGILE` (Burn/Slow/Freeze/Stun/Push reused). Enemy status storage moves to the stack model (§5.2).

## 10. Leak-safety & performance invariants (critical)

This project's signature bug is the multi-second freeze from orphaned transient-FX materials (see CLAUDE.md and memories `freeze_material_orphan_class_and_watchdog`, `material_cache_isready_never_hits`). This overhaul adds *many* per-cast/per-tick/per-frame effects, so:

1. **Every material in `PowerEffects`/archetypes/ultimates goes through `getCachedMaterial` with a bounded key.** No `Math.random()` / instance-id keys. Migrate the existing `spawnShockRing` random-key material.
2. **Unique animated meshes** disposed with `dispose(false, true)`; **pooled/shared** meshes fade via `visibility` and return to pool.
3. **Status ticking is allocation-free** in the hot path — no per-tick mesh/material creation keyed by anything unbounded; DoT visuals (if any) reuse cached materials.
4. **All observers/timescale/zone meshes torn down in `exit()`** alongside the existing `clearMaterialCache()` + `clearProjectilePools()`.
5. The existing **resource watchdog** (`checkResourceBudget()` at wave clear) will name any leaking prefix — treat a fired watchdog as a release blocker for this work.

## 11. Testing

- **Vitest (pure logic, node-only):** the status stack model (Burn cap/overflow detonation math, Chill→Freeze threshold, Curse %HP-per-tick, Fragile damage multiplier), the element-union → ultimate-offer resolver, and the fusion archetype selection by `(elements, mode)`. Extract these into Babylon-free modules (the project already splits `FusionFactory` this way for testability) so they unit-test without a scene. Mirrors existing `RunItems.spec.ts` / `PlayerStats.spec.ts`.
- **Type-check / build:** `npx tsc --noEmit` clean; `npm run build` clean.
- **Manual smoke (per phase):** reach Lv5 fusions of differing elements, confirm the correct 3–4 ultimate cards appear; confirm each fusion archetype's signature behavior; confirm no `[resource-watchdog] LEAK SUSPECTED` over several waves of heavy casting.

## 12. Decomposition & sequencing

One cohesive design; phased implementation (each phase its own implementation-plan slice, type-checked and smoke-tested before the next).

1. **Phase 1 — Foundation.** `PowerEffects.ts` primitive library + rich status system (`GameTypes`, `Enemy`) + FX helpers + cross-reaction registry. Vitest for the status/resolver logic. *No visible gameplay change alone; unblocks 2 and 3.*
2. **Phase 2 — Fusion rework.** `FusionArchetypes.ts` (10 archetypes × autocast/passive) + `makeFusionDef` dispatch change. *Fixes the "fusions feel samey" complaint — fast, visible payoff.*
3. **Phase 3 — Ultimates.** 5 element archetypes + per-class skins (`MageUltimates` polish, new `BarbarianUltimates`/`RangerUltimates`), `ULTIMATE_DEFS` for all classes, element-union offer resolver, trigger/UI changes, special-FX layer. *The headline feature.*

**Recommended order: 1 → 2 → 3.**

## 13. Risks & open questions

- **Enemy.ts blast radius.** The status stack model touches the hottest, most leak-sensitive code. Mitigate by keeping the stack model allocation-free and unit-testing the math in isolation.
- **4-card power-choice layout.** Confirmed we extend desktop to 4; verify spacing on small desktop viewports during Phase 3.
- **Barbarian passive archetypes.** Persistent/zone/gather archetypes (Magma Trail, Glacial Vortex, Static Blizzard) on a passive on-hit trigger need a sensible spawn cadence (e.g. proc chance or internal cooldown) so they don't spam zones every basic hit — decide per-archetype cadence in Phase 2.
- **Balance.** 10 new fusion behaviors + 15 ultimates is a large tuning surface; numbers here are starting points to be tuned against the existing power budget during implementation.
```
