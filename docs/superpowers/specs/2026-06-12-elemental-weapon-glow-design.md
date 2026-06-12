# Elemental Weapon Glow — Design

**Date:** 2026-06-12
**Status:** Approved

## Problem

Active power elements currently decorate the hero's weapon with small static meshes
(`Champion.createElementDecoration`, `src/survivors/champions/Champion.ts:1988-2069`):
3 flame cones (fire), 3 crystal shards (ice), 2 orbs (arcane), 4 sparkle polyhedra
(physical), 3 zigzag boxes (storm). They read as clutter, not as the weapon being
imbued — the user wants "the axe is frozen / has a fire effect / lightning around it"
across all champions' weapons.

## Goals

- The weapon itself should look imbued: a glow-like elemental effect, not attached trinkets.
- Works for all champions: procedural (barbarian axe, ranger bow, mage staff orb) and
  GLB heroes (weapon anchored at `glbWeaponAnchor`).
- Multiple active elements stack — each element keeps its own readable aura.
- No new render passes (no GlowLayer); stay within the current frozen-material /
  `blockMaterialDirtyMechanism` pipeline and the transient-FX material-leak invariant.

## Approach (chosen: tint + particle aura)

Replace the mesh clusters with two layers, driven by the existing
`updateElementVisuals(activeElements)` per-frame call:

### 1. Weapon emissive tint (procedural champions only)

- When ≥1 element is active, swap the weapon anchor mesh's material
  (`barbAxeHead` / `rangerBow` / `mageStaffOrb`) to an emissive material tinted by
  `blendElements(activeElements)`.
- Restore the original material when the active set becomes empty.
- Materials via `getCachedMaterial`, keyed by the **sorted element combo**
  (bounded: ≤31 keys) — never per-instance keys.
- GLB champions skip this layer (weapon is baked into the skinned mesh).

### 2. Per-element particle aura (all champions, stacked)

One small persistent `ParticleSystem` per active element, `emitter = getWeaponAnchor()`,
additive blend (`BLENDMODE_ONEONE`) so it reads as glow. Capacity ~24–32 each,
colors from `ELEMENT_COLOR`. Styles:

| Element  | Aura |
|----------|------|
| fire     | rising embers, orange → deep red fade, upward drift |
| ice      | slow frost mist, soft cyan-white, slight downward fall, larger soft particles |
| storm    | fast tiny yellow-white sparks, short life + 2–3 thin bolt meshes flickering (visibility + rotation re-randomized a few times/sec from `updateElementVisuals`) |
| arcane   | slow swirling purple motes, longer life |
| physical | sparse white glints |

- Created lazily on first activation (same lifecycle as today), `start()`/`stop()`
  as the active set changes.
- Storm bolt meshes: materials via `getCachedMaterial` with a bounded key; flicker via
  `mesh.visibility` (never mutate a shared/frozen material's alpha).
- All particle systems and bolt meshes disposed in `_releaseChampionFx()`.

## Rejected alternatives

- **GlowLayer bloom** — real halo, but adds a post-process pass (mobile perf) and
  doesn't read on GLB heroes.
- **Emissive shell overlay** (scaled translucent weapon clone) — strong frozen look but
  procedural-only; GLB heroes would get nothing.

## Error handling / invariants

- `getWeaponAnchor()` may return null (mesh disposed) — bail out, as today.
- Single-player and co-op behavior unchanged: the public API
  (`updateElementVisuals`) is untouched; the change is internal to `Champion`.
- Resource watchdog (`checkResourceBudget`) guards material/texture leaks at wave clear.

## Testing / verification

- `npx tsc --noEmit` clean.
- Headless Playwright run (`--use-angle=metal`, `?test` auto-pick), pick up an element
  power, screenshot the weapon; confirm no `[resource-watchdog]` log across waves.
- No unit tests — pure Babylon visuals, outside the Vitest pure-logic scope.
