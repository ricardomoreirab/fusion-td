import { ItemStatMods } from '../items/ItemTypes';

/** Permanent, uncapped shop upgrade level (`+N`). Spending gold raises it; at
 *  `+N` every item on offer is its +N version — stat mods ×(1+0.10·N), price
 *  ×(1+0.12·N). Set bonuses and named effects are NOT scaled (see scaleMods use). */

export const SHOP_UPGRADE_BASE = 300;
export const SHOP_UPGRADE_GROWTH = 1.6;
export const BONUS_SCALE_PER_LEVEL = 0.10;
export const ITEM_PRICE_SCALE_PER_LEVEL = 0.12;

/** Gold to go from `level` → `level+1`. round(300 · 1.6^level). */
export function shopUpgradeCost(level: number): number {
    return Math.round(SHOP_UPGRADE_BASE * Math.pow(SHOP_UPGRADE_GROWTH, level));
}

/** Multiplier applied to an item's own stat mods at the given shop level. */
export function bonusScaleFor(level: number): number {
    return 1 + BONUS_SCALE_PER_LEVEL * level;
}

/** Multiplier applied to an item's wave-scaled price at the given shop level. */
export function itemPriceScaleFor(level: number): number {
    return 1 + ITEM_PRICE_SCALE_PER_LEVEL * level;
}

/** A new ItemStatMods with every present numeric field multiplied by `factor`.
 *  Exact (no rounding) — display rounding lives in describeMods. Input untouched. */
export function scaleMods(mods: ItemStatMods, factor: number): ItemStatMods {
    const out: ItemStatMods = {};
    for (const k of Object.keys(mods) as (keyof ItemStatMods)[]) {
        const v = mods[k];
        if (v !== undefined) out[k] = v * factor;
    }
    return out;
}
