# Shop Upgrade Levels — Design

**Date:** 2026-06-15
**Branch:** `feat/wave15-tier-potions` (or a fresh `feat/shop-upgrade-levels`)
**Status:** Approved (design)

## Goal

Add a permanent, uncapped **shop upgrade level** that turns the shop into an infinite
gold sink. The player spends gold to raise the shop's level (`+N`). At `+N`, every item
on offer is its **+N version** — bigger stat bonuses, higher price. Equipped gear is
frozen at the level it was bought; to benefit from a higher shop level the player must
**re-buy** the item. The loop — *upgrade shop → re-buy gear → upgrade again* — keeps
the player spending gold for the whole run.

## The loop

1. Shop starts at `+0`. Items show their base bonuses at their base (wave-scaled) price.
2. Player spends gold to raise the shop to `+1`, `+2`, … (cost escalates each level, no cap).
3. At `+N`, all stock shows the **+N version**: stat bonuses scaled up, price scaled up.
4. Equipped items keep whatever level they were bought at. Re-buying the same item from a
   higher shop level installs the stronger version.

## Scaling math

All formulas live in a new pure module **`src/survivors/shop/ShopUpgrade.ts`** so they can be
unit-tested in isolation.

| Quantity | Formula | Examples |
|---|---|---|
| **Upgrade cost** (N → N+1) | `round(300 × 1.6^N)` | +0→+1: 300, +2→+3: 770, +5→+6: 3150, +9→+10: 21000 |
| **Bonus scale** at level N | `1 + 0.10 × N` | +1: ×1.10, +4: ×1.40, +8: ×1.80 |
| **Item price scale** at level N | `1 + 0.12 × N` | +3: ×1.36, +6: ×1.72 (stacks with wave scale) |

### What scales vs. what stays fixed

- **Scales:** only the item's own `ItemStatMods` (the per-card stat lines). `scaleMods(mods, factor)`
  multiplies every numeric field uniformly (`basicDamagePct`, `cooldownPct`, `lifesteal`,
  `maxHealth`, `knockback`, …). Reduction fields (`cooldownPct`, `damageTakenPct`) scale the same
  way — a bigger reduction.
- **Fixed (NOT scaled):**
  - **Set bonuses** (2pc / 4pc / 6pc tiers) — they are threshold-gated bonuses, kept at their
    catalog values regardless of shop level.
  - **Named item effects** (`rage`, `midas`, `ricochet`, `earthbreaker`, mythic signatures, …) —
    triggers/behaviours, not numbers to inflate.

## Components & changes

### New: `src/survivors/shop/ShopUpgrade.ts` (pure, Vitest-covered)
```ts
export const SHOP_UPGRADE_BASE = 300;
export const SHOP_UPGRADE_GROWTH = 1.6;
export const BONUS_SCALE_PER_LEVEL = 0.10;
export const ITEM_PRICE_SCALE_PER_LEVEL = 0.12;

export function shopUpgradeCost(level: number): number;   // round(300 * 1.6^level)
export function bonusScaleFor(level: number): number;     // 1 + 0.10*level
export function itemPriceScaleFor(level: number): number; // 1 + 0.12*level
export function scaleMods(mods: ItemStatMods, factor: number): ItemStatMods; // scale every numeric field
```

### `src/survivors/items/Equipment.ts`
- **`EquippedItem`** gains `level: number` — the shop level captured at purchase time.
- **`priceFor(def, wave, shopLevel)`** — multiply existing wave-scaled price by `itemPriceScaleFor(shopLevel)`.
- **`buy(def, wave, shopLevel)`** — capture `shopLevel` into the installed `EquippedItem`; price uses
  the new `priceFor`. Sell-back (`sellValueOf`) is unchanged (still 60% of `pricePaid`).
- **`aggregate()`** — for each equipped item, fold `scaleMods(item.def.mods, bonusScaleFor(item.level))`
  instead of the raw mods. Set-tier bonuses and effects are folded unchanged.

### `src/survivors/SurvivorsGameplayState.ts`
- Add run-state field `shopLevel = 0`; **reset to 0 in `exit()`** alongside the other run state.
- Add `handleShopUpgrade()`: read `shopUpgradeCost(shopLevel)`, if affordable `spendGold` it,
  increment `shopLevel`, then refresh the shop VM (prices + stat lines re-render at the new level).
  If not affordable, refresh with a "poor" Gribble bark (mirrors `handleShopBuy`).
- Pass `shopLevel` into `equipment.buy(def, wave, shopLevel)` in `handleShopBuy`.
- Pass `shopLevel` into `buildShopVM` so each card's price and stat lines reflect the current level.
  Stat lines render from `scaleMods(def.mods, bonusScaleFor(shopLevel))`.

### `src/ui/overlays/ShopOverlay.ts` + `ShopVM`
- `ShopVM` gains: `shopLevel: number`, `upgradeCost: number`, `upgradeAffordable: boolean`.
- `ShopCardVM` gains: `itemLevel: number` (the shop level the for-sale version represents) for the badge.
- Render a compact **`Upgrade +N  🪙cost`** button beside the existing **Reroll** button, with a
  small `Shop is +N` label. Disabled/greyed when not affordable (same pattern as reroll).
- Each item card shows a **`+N` badge**; its stat lines already come pre-scaled from the VM.
- Wire `callbacks.onUpgrade` → `handleShopUpgrade()`.

### CSS (`src/ui/styles/components.css`)
- Style the upgrade button (sibling of reroll) and the `+N` card badge.

## Testing (TDD, Vitest, pure-logic)

`tests/shopUpgrade.spec.ts` (new):
- `shopUpgradeCost` curve: exact values at levels 0, 1, 2, 5, 9.
- `bonusScaleFor` / `itemPriceScaleFor` at several levels.
- `scaleMods`: every numeric field scaled, undefined fields stay undefined, integer-ish fields
  (e.g. `maxHealth`, `knockback`) handled; round/`Math.ceil` semantics decided where displayed.

`tests/equipment.spec.ts` (extend existing if present, else new):
- `priceFor(def, wave, shopLevel)` stacks wave × shopLevel scaling.
- `buy` captures the shop level into `EquippedItem.level`.
- `aggregate` scales an item's mods by its captured level and leaves set bonuses + effects unscaled.
- An item bought at `+2` keeps `+2` bonuses after the shop later climbs to `+5` (no retroactive change).

## Co-op

No new co-op work. `shopLevel` is per-player run state; item bonuses fold through the existing
per-player equipment aggregate path that co-op itemization already drives. Same solo-leaning,
byte-identical footing as the unique/mythic items (Phase "co-op FX = N/A").

## Out of scope / non-goals

- No cap, no per-wave reset (decided: permanent, uncapped).
- No per-individual-item upgrades — you upgrade the *shop*, not equipped gear.
- Set bonuses and named effects do not scale.
- No change to the reroll system, potions, or sell-back percentage.
