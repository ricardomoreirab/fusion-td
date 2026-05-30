# Merge Quickness into Haste — Design

**Date:** 2026-05-30
**Status:** Approved (pending spec review)

## Problem

The between-wave shop has two "go faster" upgrades that read as duplicates to players:

- **Haste** — `-5% all power cooldowns` (writes `powerCooldownMultiplier`, floored at 0.5×).
- **Quickness** — `+5% basic attack speed` (writes `basicAttackSpeedMultiplier`, uncapped).

Mechanically they're distinct (active powers vs. basic auto-attack), but the overlap is confusing and dilutes the shop. Merge them into a single **Haste** item.

## Design

Replace both items with one combined **Haste** (keeps the `haste` id) in `buildShopItems()`
(`src/survivors/SurvivorsGameplayState.ts`). Shop count drops 9 → 8; the between-wave
overlay lays out by `items.length`, so no layout change is required.

### Merged `haste` item

| Field | Value |
|---|---|
| `id` | `haste` |
| `name` | `Haste` |
| `description` | `-5% power cooldowns & +5% attack speed` |
| `baseCost` | `75` |
| `costGrowth` | `1.75` |
| `isCapped` | `() => false` |

**`apply()`** (single purchase does both):
1. `incrementPurchase('haste')`
2. `powerCooldownMultiplier = max(0.5, powerCooldownMultiplier * 0.95)` — cooldown floor unchanged.
3. `basicAttackSpeedMultiplier *= 1.05` then `heroController.updateBasicAttackSpeed(basicAttackSpeedMultiplier)`.

**`currentValue()`** shows both knobs, e.g. `cd 95% → 90% · atk +10% → +15%`,
using the existing `pctInv` (cooldown) and `pctDelta` (attack speed) helpers.

**Why uncapped:** the old Haste capped at the 0.5× cooldown floor. If we kept that cap,
attack-speed scaling would stop too. Leaving the item uncapped preserves Quickness's
old unbounded attack-speed growth; the cooldown simply clamps at its floor internally
while attack speed keeps climbing.

### Cleanup

- Remove the `quickness` item block from `buildShopItems()`.
- Remove the `quickness` glyph entry from `ITEM_CONFIG` in
  `src/survivors/ui/BetweenWaveShopOverlay.ts`.
- Cosmetic comment updates referencing "Quickness" → "Haste" in
  `RunItems.ts` (line ~73) and `HeroController.ts` (line ~306).

The `attackSpeed` milestone run-item (`RunItems.ts`) still writes
`basicAttackSpeedMultiplier` and composes multiplicatively with the merged Haste —
no logic change there.

## Out of scope

- Not adding a new item to refill the freed shop slot (8 items is fine).
- Not touching dead code `src/ui/overlays/Shop.ts` (not imported anywhere).
- No change to `PlayerStats` fields (`purchaseCounts` is a generic string map;
  the stale `quickness` key simply stops being written).

## Verification

- `npx tsc --noEmit` clean.
- Manual: between-wave shop shows 8 items, no Quickness; buying Haste lowers a power's
  cooldown sweep and speeds up the basic auto-attack in the same purchase; readout shows
  both deltas; remains buyable after cooldown hits the 0.5× floor.
