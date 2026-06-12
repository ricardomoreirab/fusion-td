import { ChampionType } from '../powers/PowerDefinitions';
import { EquipSlot, ItemDef, Rarity } from '../items/ItemTypes';

export const STOCK_SIZE = 6;
export const SLOT_SOFT_CAP = 2;
export const PITY_WEIGHT_MULT = 2.5;
export const REROLL_BASE_COST = 25;
export const REROLL_COST_STEP = 25;

export interface StockOpts {
    champion: ChampionType;
    wave: number;
    /** Item ids the player already owns (excluded from stock). */
    ownedIds: Set<string>;
    /** setId → owned piece count (pity weighting for started sets). */
    setCounts: Record<string, number>;
    /** Injectable RNG in [0,1) for testability. */
    rng: () => number;
}

export function rerollCost(rerollsThisVisit: number): number {
    return REROLL_BASE_COST + REROLL_COST_STEP * rerollsThisVisit;
}

export function rarityWeights(wave: number): Record<Rarity, number> {
    if (wave <= 3)  return { common: 60, rare: 35, epic: 5,  legendary: 0 };
    if (wave <= 6)  return { common: 40, rare: 40, epic: 18, legendary: 2 };
    if (wave <= 10) return { common: 25, rare: 40, epic: 28, legendary: 7 };
    return { common: 15, rare: 35, epic: 35, legendary: 15 };
}

export interface WeightedItem {
    def: ItemDef;
    weight: number;
}

/** Class-filtered, owned-excluded, rarity- and pity-weighted candidate pool. */
export function buildWeightedPool(catalog: ItemDef[], opts: StockOpts): WeightedItem[] {
    const weights = rarityWeights(opts.wave);
    const pool: WeightedItem[] = [];
    for (const def of catalog) {
        if (opts.ownedIds.has(def.id)) continue;
        if (def.classes !== 'all' && !def.classes.includes(opts.champion)) continue;
        let weight = weights[def.rarity];
        if (weight <= 0) continue;
        if (def.setId && (opts.setCounts[def.setId] ?? 0) >= 1) weight *= PITY_WEIGHT_MULT;
        pool.push({ def, weight });
    }
    return pool;
}

/** Weighted sample without replacement; items past the per-slot soft cap are
 *  discarded and drawing continues until STOCK_SIZE or pool exhaustion. */
export function rollStock(catalog: ItemDef[], opts: StockOpts): ItemDef[] {
    const pool = buildWeightedPool(catalog, opts);
    const out: ItemDef[] = [];
    const slotCount: Partial<Record<EquipSlot, number>> = {};
    while (out.length < STOCK_SIZE && pool.length > 0) {
        let total = 0;
        for (const entry of pool) total += entry.weight;
        let r = opts.rng() * total;
        let idx = pool.length - 1;
        for (let i = 0; i < pool.length; i++) {
            r -= pool[i].weight;
            if (r <= 0) { idx = i; break; }
        }
        const picked = pool.splice(idx, 1)[0].def;
        const count = slotCount[picked.slot] ?? 0;
        if (count >= SLOT_SOFT_CAP) continue;
        slotCount[picked.slot] = count + 1;
        out.push(picked);
    }
    return out;
}
