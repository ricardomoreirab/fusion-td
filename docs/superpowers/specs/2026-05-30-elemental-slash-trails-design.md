# Elemental slash trails + element-colored damage numbers (barbarian)

**Date:** 2026-05-30
**Status:** Approved — ready for implementation plan

## Goal

Two linked visual features:

1. **Elemental slash trail (barbarian).** When the barbarian carries one or more
   power elements, his melee slash trail is colored/styled by those elements
   instead of the current hardcoded gold arc + red blood. Multiple active
   elements blend (layered distinct colors), not a single primary.
2. **Element-colored damage numbers.** Every damage instance shows its floating
   number in the color of the element that dealt it (fireball = orange, frost =
   cyan, basic melee = physical-white, burn DoT = fire, etc.). Crits stay gold.

## Decisions (locked)

- **Element source for the trail:** blend ALL active elements (one per power
  slot, up to 4), not primary-slot/cycle/most-recent.
- **Trail richness:** arc tint + axe particle ribbon (not arc-only, not the
  full ground-decal version).
- **Damage-number element threading:** add an optional `element?` parameter to
  `Enemy.takeDamage` and the damage callback; each source passes its element.
- **Crit color:** crits keep gold `#FFD000` (a non-elemental readout); only
  non-crit numbers take the element color.

## Current state (what exists)

- **Shared swing FX** — `HeroBasicAttack.spawnSwingRing()` builds a hardcoded
  **gold** ground torus + a sweeping half-disc "blade arc" that rotates 360°
  around the hero on every melee swing (~0.35s). Uses cached/frozen materials
  `swingRingMat` / `swingArcMat` and animates their `alpha` per frame.
- **Barbarian spin FX** — `Champion.triggerSpinAttack()` → `startBarbSpinFx()`
  creates a hardcoded **red blood** particle system off the axe head
  (`barbAxeHead`) + a red feet arc ring. Ticked by `tickBarbSpinFx()`, torn
  down on spin end via `setTimeout(dispose)`.
- **Element decorations** — `Champion.updateElementVisuals(activeElements)` is
  called every frame from `SurvivorsGameplayState:1042` with
  `powerSlots.getActiveElements()`. It shows static per-element meshes on the
  weapon anchor. This is the live source of "which elements the hero carries."
- **Damage numbers** — `Enemy.takeDamage(amount: number)` takes ONLY a number.
  It fires `Enemy.onDamageCallback(position, actualDamage, isCrit)`, wired in
  `SurvivorsGameplayState:472` to `showDamage(position, damage, undefined, isCrit)`
  — element is ALWAYS `undefined`. `DamageNumberManager.getColorForElement`
  still switches on the **legacy** `GameTypes.ElementType` (NONE/FIRE/WATER/
  WIND/EARTH), which no current power produces, so every number renders white
  (or gold on crit).
- **Element colors are duplicated** with no single source of truth:
  - `HeroHud.ts` / `PowerChoiceOverlay.ts` (hex):
    `fire:#ff6030 ice:#30cfff arcane:#b050ff physical:#e0e0e0 storm:#ffe040`
  - `PowerDrop.ts` (Color3): `fire(1,0.4,0) ice(0.3,0.7,1) arcane(0.8,0.3,1) physical(0.9,0.9,0.9) storm(0.8,0.8,1)`
  - `Champion` decorations: separately tuned Color3 values.
- **Element type systems:** `PowerElement = 'fire'|'ice'|'arcane'|'physical'|'storm'`
  (current, in `PowerDefinitions.ts`) vs the legacy `GameTypes.ElementType` enum.
  The new work standardizes on `PowerElement`.

## Architecture

### Unit 1 — `src/survivors/ElementColors.ts` (new)

Single source of truth for the 5-element palette, keyed by `PowerElement`.

- `ELEMENT_HEX: Record<PowerElement, string>` — `'#ff6030'` etc. For canvas /
  damage-number text. Values = the existing HeroHud/PowerChoiceOverlay hex map
  (already canonical across the UI).
- `ELEMENT_COLOR: Record<PowerElement, Color3>` — matching Color3 for 3D FX
  (derived from the same hex so UI and 3D agree).
- `blendElements(elements: PowerElement[]): Color3` — averaged Color3 of the
  given elements; returns a neutral default (the current gold, or white) when
  the array is empty. Pure function — unit-testable.

**Depends on:** `PowerElement` (type only), Babylon `Color3`.

**Consumers (refactor to import, removing their local maps):** `HeroHud.ts`,
`PowerChoiceOverlay.ts`, `PowerDrop.ts`. Champion's decoration colors are left
as-is (separately tuned for emissive 3D look — out of scope).

### Unit 2 — Element-colored damage numbers

- `Enemy.takeDamage(amount: number, element?: PowerElement): boolean` — element
  is optional and forwarded; no behavior change when omitted.
- `Enemy.onDamageCallback: (position, damage, isCrit, element?) => void`.
- `Enemy` burn DoT stores the element that applied it (default `'fire'`) and
  passes it on the tick at `Enemy.ts:861`.
- `DamageNumberManager.showDamage(position, damage, element?: PowerElement, isCrit)`
  — replace the legacy `ElementType` param + `getColorForElement` switch with a
  lookup into `ELEMENT_HEX`. No element → neutral (physical/white). Crit → gold
  (unchanged), regardless of element.
- `SurvivorsGameplayState` damage callback forwards the element to `showDamage`.

**Element per source:**
- Powers (`PowerDefinitions.ts`, ~13 `takeDamage` sites) → the power's `element`.
- Basic melee (`HeroBasicAttack.applyHit` / projectile hit) → `'physical'`.
- Enchantment procs (`applyEnchantments`) → the enchantment's element.
- Burn DoT → `'fire'` (or whatever element applied the burn, if tracked).

**Depends on:** Unit 1 (`ELEMENT_HEX`), `PowerElement`.

### Unit 3 — Barbarian elemental slash trail (blend-all)

- **Element snapshot:** `Champion.updateElementVisuals` already runs every frame
  with the active set; store it in a `Champion` field so the slash FX can read
  the current elements without re-querying.
- **Arc tint** (`HeroBasicAttack.spawnSwingRing`): when the hero is a barbarian
  carrying ≥1 element, tint the blade arc + ground ring to
  `blendElements(active)`; otherwise keep the gold default. The elemental path
  builds a **fresh per-swing emissive material** and disposes it in the existing
  `t >= 1` sweep cleanup (alongside `ring.dispose()` / `arc.dispose()`). It must
  NOT mutate the shared cached `swingArcMat`/`swingRingMat` in place (documented
  hazard: shared frozen-material color writes affect every concurrent user).
- **Axe particle ribbons** (`Champion.startBarbSpinFx`): replace the single
  hardcoded red blood PS with one short-lived element-colored particle ribbon
  **per active element** (capped at the 4 slots) emitted off `barbAxeHead`, each
  colored via `ELEMENT_COLOR[element]`. Layered distinct colors read as
  "blend all." No active elements → current red blood fallback. The feet arc
  ring (`barbSpinArcRing`) tint in `tickBarbSpinFx` is driven from
  `blendElements(active)` (red fallback when none).

**Depends on:** Unit 1 (`ELEMENT_COLOR`, `blendElements`),
`powerSlots.getActiveElements()` snapshot.

## Leak discipline (this codebase has a documented leak history)

- Per-swing tinted arc/ring materials are disposed in the sweep's `t >= 1`
  cleanup — same lifetime as the meshes they belong to.
- Elemental axe particle systems are stopped + disposed on spin end (existing
  `setTimeout(dispose)` pattern) and on Champion teardown / state `exit()`.
- No new persistent meshes or textures. Object count bounded: ≤4 ribbons per
  spin, one arc + one ring per swing.
- Reuse `getCachedMaterial` only with **variant-keyed** names (e.g. by element
  set), never by instance — but the per-swing-dispose approach above is the
  primary, simplest leak-safe path for the animated arc.

## Testing

- `npx tsc --noEmit` clean; check LSP diagnostics on every touched file.
- Vitest (pure logic only): `tests/ElementColors.spec.ts` —
  `blendElements(['fire'])` equals the fire color; `blendElements([])` equals
  the neutral default; two-element blend is the component-wise average.
- Manual at `localhost:9000`:
  - Barbarian with one fire power: orange slash arc + orange axe sparks +
    orange basic-melee numbers.
  - Barbarian with fire + ice: blended arc tint + distinct orange & cyan axe
    sparks.
  - Fireball numbers orange, frost numbers cyan, lightning yellow; crit numbers
    gold regardless of element.
  - Reach a few waves, pause/resume, die and restart — confirm no progressive
    freeze or black screen (no leaked materials/particles).

## Out of scope

- Non-barbarian champions' slash trails (ranger/mage) — palette and threading
  are reusable later, but only the barbarian trail ships now.
- The full "ground decal" trail variant (lingering scorch/frost patch).
- Re-theming Champion's static weapon decorations to the shared palette.

## Files

- **New:** `src/survivors/ElementColors.ts`, `tests/ElementColors.spec.ts`
- **Edit:** `src/survivors/enemies/Enemy.ts`,
  `src/survivors/DamageNumberManager.ts`,
  `src/survivors/SurvivorsGameplayState.ts`,
  `src/survivors/powers/PowerDefinitions.ts`,
  `src/survivors/champions/HeroBasicAttack.ts`,
  `src/survivors/champions/Champion.ts`
- **DRY refactor:** `src/survivors/ui/HeroHud.ts`,
  `src/survivors/ui/PowerChoiceOverlay.ts`, `src/survivors/powers/PowerDrop.ts`
