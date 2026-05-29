# Fusion Powers — Design

## Goal

Add a three-tier power-progression system on top of the existing 15 base
powers. Every power caps at **level 5**. When two *different* powers both
reach level 5, the next orb pickup offers to **fuse** them into a single
new power (a "fusion") that combines both — stronger than either parent,
with its own visual identity, starting back at level 1. When two *fusions*
both reach level 5, the next orb pickup offers an **ultimate fusion**: a
hand-crafted, screen-shaking showpiece power, also level 1→5.

All three tiers — base, fusion, ultimate — respect the level-5 cap and
reset to level 1 when forged.

This is purely additive to the survivors power system. Nothing about the
existing 15 base powers, the 4-slot model, autocast/passive modes, or the
basic-attack enchantment path changes in behavior; the fusion layer is
built *on top* of them.

## Authoring approach (decided)

**Hybrid: a fusion engine + a few bespoke standouts.**

- **Tier-2 fusions** are *generated* by composing their two parent
  `PowerDefinition`s (run both effects + a fusion bonus + blended visuals).
  This covers all 10 element-pairs per class (30 total) with no per-fusion
  hand-authoring required. Identity emerges for free because both parents'
  existing VFX render together.
- **Signature fusions** — exactly **one bespoke fusion per class (3 total)**
  override the generated version of one iconic element-pair with a fully
  hand-crafted effect + VFX.
- **Ultimates** — **3 per class (9 total)**, fully hand-authored, chosen by
  the player at forge time (see "Ultimate tier" below).

## Slot economy (decided)

Forging **consumes both level-5 parents** and places the new power into one
of the two freed slots, freeing the other. A 4-slot loadout can therefore
progress:

```
[Fire L5][Ice L5][Storm L3][ -- ]   →  fuse Fire+Ice
[Frostfire L1][ -- ][Storm L3][ -- ] →  freed a slot to build a 2nd fusion
... eventually [FusionA L5][FusionB L5][..][..] → ultimate fuse → [Ultimate L1][--][..][..]
```

## Within-class homogeneity

Fusions only ever combine two powers the player owns, and a player only
owns powers of their own class. Within a class all 5 powers share a mode:

- **Mage** — 5 autocast spells
- **Ranger** — 5 autocast arrows
- **Barbarian** — 5 passive on-hit enchantments

So a fusion always combines two of the *same* kind (spell+spell,
arrow+arrow, or passive+passive). There is no autocast↔passive fusion to
design for. This is what makes the generic engine tractable.

---

## Architecture

### `PowerDefinition` additions

`PowerDefinition` (in `PowerDefinitions.ts`) gains:

```ts
tier?: 'base' | 'fusion' | 'ultimate';   // defaults to 'base' when absent
parents?: [string, string];              // parent def ids (fusion/ultimate)
elements?: PowerElement[];               // all constituent elements
```

Existing base defs are untouched (they read as `tier: 'base'`).

### Fusion factory

A new module `src/survivors/powers/FusionDefinitions.ts`:

```ts
makeFusionDef(a: PowerDefinition, b: PowerDefinition): PowerDefinition
```

Produces a `PowerDefinition` with `tier: 'fusion'`, `parents: [a.id, b.id]`,
`elements: [a.element, b.element]`, a canonical `id`
(`fuse_<class>_<elemA>_<elemB>` with elements sorted), a combined `name`
(e.g. "Frostfire"), and composed behavior:

**Autocast fusion** (`mode: 'autocast'`):
- `cast(state, ctx)`: build a synthetic context whose `damageMultiplier` is
  `ctx.damageMultiplier * FUSION_DMG` and a synthetic state whose `level` is
  the fusion's level, then call `a.cast(synthState, synthCtx)` and
  `b.cast(synthState, synthCtx)`. Both parent effects fire each trigger and
  scale with the fusion's level via the parents' existing ×1.25/level curve.
- `cooldownFor(s)`: `avg(a.cooldownFor(s), b.cooldownFor(s)) * FUSION_CD`.
- `init(state, ctx)`: call both parents' `init` if present, namespacing each
  parent's persistent `state.data` under its own key (so e.g. Whirling
  Blades' blade meshes survive inside a fusion).
- `damageFor(s)`: `a.damageFor(s) + b.damageFor(s)` (display only).

**Passive fusion** (`mode: 'passive'`):
- `onHit(enemy, level, ctx)`: call `a.onHit` and `b.onHit`, then apply a
  fusion bonus (`enemy.takeDamage(ctx.baseDamage * FUSION_PASSIVE_BONUS * level)`).
- `rangeBonus(level)`: `(a.rangeBonus?.(level) ?? 0) + (b.rangeBonus?.(level) ?? 0)`.
- `description(level)`: concatenate both parents' descriptions + "(fused)".

**Tunable constants** (all in one place, balance pass refines):
```
FUSION_DMG            = 1.25   // +25% to each parent effect
FUSION_CD             = 0.85   // -15% off the averaged cooldown
FUSION_PASSIVE_BONUS  = 0.25   // bonus weapon-dmg per level for passive fusions
```

### Registries

- `FUSION_DEFS: Record<string, PowerDefinition>` — built once at module load
  by iterating each class's 10 element-pairs through `makeFusionDef`, then
  overlaying the 3 bespoke signature defs (which share the same id and thus
  replace the generated entry).
- `ULTIMATE_DEFS: Record<string, PowerDefinition>` — 9 hand-authored defs
  (`ult_<class>_<name>`), 3 per class.
- A lookup `getFusionFor(idA, idB): PowerDefinition | null` (canonicalizes
  the pair) and `getUltimatesForClass(type): PowerDefinition[]`.

`POWER_DEFS` lookups used by `PowerSlotManager.addPower/levelUp/replaceSlot`
are extended to also resolve fusion and ultimate ids (a single merged
accessor, e.g. `getAnyPowerDef(id)`), so the slot manager keeps treating
every slot as a generic `PowerDefinition`. No special slot type is added.

### `PowerSlotManager` changes

Minimal:
1. `addPower`/`replaceSlot` resolve defs via the merged accessor.
2. New `fuse(idA, idB, resultDef)`: validates both parents are present at
   level 5, disposes both parents' slot data, removes both, inserts
   `resultDef` at level 1 into one of the freed slots, runs its `init`.
3. `disposeSlotData` is generalized to dispose *any* meshes a slot's
   `state.data` holds (today it only knows the `blades` key) so composed
   fusions clean up both parents' persistent meshes.
4. New query helpers: `getMaxedSlots()` (level === maxLevel), used by the
   gameplay state to detect fusion/ultimate availability.

## Ultimate tier (decided: choose-1-of-3)

Two fusions always span 4 of the 5 elements, so a deterministic
element→theme mapping cannot yield 3 balanced, reachable ultimates.
Instead: **when two fusions are both level 5, the next orb pickup presents
the player's 3 class ultimates as a choice.** Picking one consumes both
fusions and forges the chosen ultimate at level 1. This guarantees all 3
are reachable, adds a climactic decision, and makes the moment stand out.

Ultimates are hand-authored, ~2.5–3× fusion damage, large AoE, unique VFX +
screen shake. They are a normal power slot — **distinct from the existing
manual `AbilityManager` click-ultimates** (Meteor Strike / Frost Nova).

| Class | Ultimate A | Ultimate B | Ultimate C |
|---|---|---|---|
| **Mage** | **Cataclysm** — rolling meteor + lightning storm sweeping the arena | **Absolute Zero** — pulsing freeze field; arcane implosions on frozen foes | **Singularity** — black-hole orb that pulls enemies in and crushes them |
| **Ranger** | **Storm of Arrows** — wide barrage of explosive + chaining arrows | **Glacial Volley** — piercing frost fan, freeze → shatter | **Spectral Hunt** — autonomous homing spectral arrows seeking all foes |
| **Barbarian** | **Avatar of War** — rage transform: damage aura + periodic whirlwind | **Permafrost Aura** — constant freeze aura that shatters frozen foes | **Thunderlord** — every hit mega-chains + periodic lightning storm |

Ultimate level scaling reuses the ×1.25/level damage curve; bespoke
mechanics (radii, counts, intervals) scale per-ultimate as authored.

## Leveling fused / ultimate powers

A fused power levels through the normal orb-pickup upgrade card when the
orb's element matches **either** of its constituent elements. An ultimate
(4 constituent elements) levels on an orb matching any of them. This keeps
orb pickups meaningful after fusing. The upgrade-card subtitle uses the
fusion's combined `description`/`damageFor`.

## Visual identity

- **Engine fusions** — both parents' existing VFX already render together
  (e.g. fire+ice = orange comet + cyan shards), giving emergent blended
  identity. On top: a **blended-color fusion sigil** orbiting the hero while
  a fusion is equipped, and a **split-color HUD icon** inside a distinct
  fusion frame. Blended color = midpoint of the two element colors from the
  existing `ELEMENT_COLOR` map.
- **Signature fusions (1 per class, 3 total)** — a hand-crafted effect + VFX
  overriding one iconic pair. Suggested (easily changed):
  - Mage Fire+Ice → **Frostfire** (comet that burns then shatters in a frost burst)
  - Ranger Storm+Physical → **Railshot** (instant rail that pierces all + chains)
  - Barbarian Fire+Storm → **Tempest Blade** (each hit erupts in a fiery shockwave + chain)
- **Ultimates** — bespoke VFX, a forge flash, and a brief screen shake on
  cast/forge. The clear visual apex.

## UX / overlay flow

Reuse `PowerChoiceOverlay`; add two card kinds to `PowerCardKind`:

- **`fusion`** (prismatic/gold frame): shown when `getMaxedSlots()` yields
  ≥2 different powers on orb pickup. Each fusable pair becomes one card:
  "Fire L5 + Ice L5 → **Frostfire**". Fusion cards take priority over the
  normal power/wildcard/perk cards (filling card slots first). Picking plays
  a short two-orbs-spiral-together fuse VFX, then calls
  `PowerSlotManager.fuse(...)`.
- **`ultimate`** (radiant frame): shown when ≥2 *fusions* are level 5. The
  overlay presents the class's 3 ultimate choices with a larger reveal +
  screen flash. Picking forges the chosen ultimate.

`KIND_CONFIG` in `PowerChoiceOverlay.ts` gets entries for the two new kinds
(border color, label, glyph). The desktop/mobile card builders already
iterate a generic `PowerCard[]`, so no layout rewrite is needed — only the
new kind styling and the fuse/forge pick VFX hook.

`onOrbPickup` in `SurvivorsGameplayState.ts` gains a branch *before* the
existing A/B/C card assembly: if fusion or ultimate offers are available,
build those cards (plus a skip). Otherwise fall through to today's logic.
The per-pickup global power bump and the +25-gold skip reward are preserved.

## Edge cases

- **Multiple fusable pairs** (3+ powers at level 5): offer up to the card
  limit as separate fusion cards; player picks which pair to fuse.
- **Mixed availability** (a fusion offer *and* a normal level-up both
  possible): fusion cards take priority and fill first; remaining card slots
  may show a normal upgrade.
- **Slot data disposal**: forging disposes both parents' persistent meshes
  via the generalized `disposeSlotData`; `init` re-creates the fusion's own
  (composed parents') meshes.
- **Run summary / loadout export** (`finalLoadout` at end of run): include
  fusion/ultimate tier so the game-over summary reflects forged powers.

## Testing

Pure-logic pieces are unit-tested with Vitest (no Babylon scene):
- `getFusionFor` canonicalization (Fire+Ice == Ice+Fire → same def id).
- Fusion `cooldownFor`/`damageFor` composition math against the constants.
- `PowerSlotManager.fuse`: rejects when parents aren't both level-5 present;
  consumes both, inserts result at level 1, frees one slot.
- `getMaxedSlots` / availability detection (≥2 maxed base → fusion offer;
  ≥2 maxed fusions → ultimate offer).

VFX, overlay rendering, and per-frame casting are validated by running the
game (`npm start`), not unit tests, matching the existing test boundary.

## Scope & build order

This is large, so it is split into phases. This document is the shared
blueprint; **each phase gets its own implementation plan**.

1. **Framework + Mage vertical slice** — `PowerDefinition` additions,
   `FusionDefinitions.ts` factory + registries, merged def accessor,
   `PowerSlotManager.fuse` + generalized disposal + `getMaxedSlots`, the
   `fusion`/`ultimate` card kinds + fuse/forge VFX, `onOrbPickup` branch,
   leveling, and the full **Mage** content (10 engine fusions + 3
   ultimates). Proves the entire pipeline end-to-end and is shippable alone.
2. **Ranger** — 10 engine fusions + 3 ultimates (arrows). Reuses framework.
3. **Barbarian** — passive-fusion path validation + 3 ultimates.
4. **Signatures + balance + polish** — the 3 bespoke signature fusions,
   constant tuning, HUD/visual cohesion pass.

## Key invariants

- A fusion/ultimate is a normal `PowerDefinition`; `PowerSlotManager` never
  special-cases tier beyond `fuse()` and availability queries.
- Forging is the *only* way slot count decreases mid-run; it always nets
  −1 occupied slot at tier-2 and tier-3.
- All tiers cap at level 5 and reset to level 1 when forged.
- Fusion behavior is composed from parents — base power edits automatically
  flow into every fusion that uses them.
