import { ChampionType } from '../powers/PowerDefinitions';
import { EquipSlot, ItemDef, Rarity } from '../items/ItemTypes';

export const STOCK_SIZE = 6;
export const SLOT_SOFT_CAP = 2;
export const PITY_WEIGHT_MULT = 2.5;
/** Each piece already owned in a set adds this much pity on top of PITY_WEIGHT_MULT
 *  (so a near-complete 6-piece unique set is far likelier to finish). */
export const PITY_WEIGHT_STEP = 0.5;
export const REROLL_BASE_COST = 25;
export const REROLL_COST_STEP = 25;

export interface StockOpts {
    champion: ChampionType;
    wave: number;
    /** id → shop level the player owns that item at. An owned item still appears
     *  in stock when shopLevel exceeds its owned level (so the upgrade is buyable). */
    ownedLevels: Map<string, number>;
    /** Current shop upgrade level. Owned items at or above this are excluded. */
    shopLevel: number;
    /** setId → owned piece count (pity weighting for started sets). */
    setCounts: Record<string, number>;
    /** Injectable RNG in [0,1) for testability. */
    rng: () => number;
}

export function rerollCost(rerollsThisVisit: number): number {
    return REROLL_BASE_COST + REROLL_COST_STEP * rerollsThisVisit;
}

export function rarityWeights(wave: number): Record<Rarity, number> {
    if (wave <= 4)  return { common: 60, rare: 30, epic: 10, legendary: 0,  unique: 0,  mythic: 0 };
    if (wave <= 7)  return { common: 35, rare: 38, epic: 22, legendary: 5,  unique: 0,  mythic: 0 };
    if (wave <= 10) return { common: 18, rare: 34, epic: 30, legendary: 12, unique: 6,  mythic: 0 };
    if (wave <= 14) return { common: 8,  rare: 24, epic: 32, legendary: 18, unique: 13, mythic: 5 };
    return { common: 4, rare: 16, epic: 30, legendary: 22, unique: 20, mythic: 8 };
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
        const ownedLevel = opts.ownedLevels.get(def.id);
        if (ownedLevel !== undefined && ownedLevel >= opts.shopLevel) continue;
        if (def.classes !== 'all' && !def.classes.includes(opts.champion)) continue;
        let weight = weights[def.rarity];
        if (weight <= 0) continue;
        const owned = def.setId ? (opts.setCounts[def.setId] ?? 0) : 0;
        if (owned >= 1) weight *= PITY_WEIGHT_MULT + PITY_WEIGHT_STEP * (owned - 1);
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
