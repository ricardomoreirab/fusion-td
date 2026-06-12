// tests/ShopStock.spec.ts
import { describe, expect, it } from 'vitest';
import {
    buildWeightedPool, rarityWeights, rerollCost, rollStock, STOCK_SIZE, SLOT_SOFT_CAP,
} from '../src/survivors/shop/ShopStock';
import { ITEM_CATALOG } from '../src/survivors/items/ItemCatalog';

/** Deterministic rng from a fixed sequence (loops). */
function seqRng(seq: number[]): () => number {
    let i = 0;
    return () => seq[i++ % seq.length];
}

const baseOpts = {
    champion: 'barbarian' as const,
    wave: 5,
    ownedIds: new Set<string>(),
    setCounts: {} as Record<string, number>,
    rng: seqRng([0.1, 0.5, 0.9, 0.3, 0.7, 0.2, 0.8, 0.4, 0.6]),
};

describe('rarityWeights', () => {
    it('locks legendaries out before wave 4', () => {
        expect(rarityWeights(3).legendary).toBe(0);
        expect(rarityWeights(4).legendary).toBeGreaterThan(0);
    });
    it('shifts weight toward high rarity late', () => {
        expect(rarityWeights(12).epic).toBeGreaterThan(rarityWeights(2).epic);
    });
    it('uses the wave 7-10 bracket', () => {
        expect(rarityWeights(8)).toEqual({ common: 25, rare: 40, epic: 28, legendary: 7 });
    });
});

describe('rerollCost', () => {
    it('escalates 25, 50, 75…', () => {
        expect(rerollCost(0)).toBe(25);
        expect(rerollCost(1)).toBe(50);
        expect(rerollCost(2)).toBe(75);
    });
});

describe('buildWeightedPool', () => {
    it('excludes other classes\' items and owned items', () => {
        const pool = buildWeightedPool(ITEM_CATALOG, {
            ...baseOpts, ownedIds: new Set(['gorefang']),
        });
        const ids = pool.map(p => p.def.id);
        expect(ids).not.toContain('stormpiercer');   // ranger weapon
        expect(ids).not.toContain('gorefang');       // owned
        expect(ids).toContain('butchers_cleaver');   // barbarian weapon
        expect(ids).toContain('bloodvial');          // 'all'
    });

    it('applies 2.5x pity weight to started sets', () => {
        const without = buildWeightedPool(ITEM_CATALOG, baseOpts);
        const withPity = buildWeightedPool(ITEM_CATALOG, {
            ...baseOpts, setCounts: { berserkers_wrath: 1 },
        });
        const w0 = without.find(p => p.def.id === 'skullcage_of_rage')!.weight;
        const w1 = withPity.find(p => p.def.id === 'skullcage_of_rage')!.weight;
        expect(w1).toBeCloseTo(w0 * 2.5);
    });

    it('drops zero-weight rarities (legendary on wave 1)', () => {
        const pool = buildWeightedPool(ITEM_CATALOG, { ...baseOpts, wave: 1 });
        expect(pool.some(p => p.def.rarity === 'legendary')).toBe(false);
    });
});

describe('rollStock', () => {
    it('returns STOCK_SIZE distinct items, all class-eligible', () => {
        const stock = rollStock(ITEM_CATALOG, baseOpts);
        expect(stock.length).toBe(STOCK_SIZE);
        expect(new Set(stock.map(i => i.id)).size).toBe(STOCK_SIZE);
        for (const item of stock) {
            expect(item.classes === 'all' || item.classes.includes('barbarian')).toBe(true);
        }
    });

    it('respects the per-slot soft cap', () => {
        for (let seed = 0; seed < 10; seed++) {
            const rng = seqRng([0.1 * seed + 0.05, 0.37, 0.83, 0.59, 0.21, 0.94, 0.45, 0.68, 0.12]);
            const stock = rollStock(ITEM_CATALOG, { ...baseOpts, rng });
            expect(stock.length).toBe(STOCK_SIZE); // soft cap must not shrink the stock
            const perSlot: Record<string, number> = {};
            for (const item of stock) perSlot[item.slot] = (perSlot[item.slot] ?? 0) + 1;
            for (const n of Object.values(perSlot)) expect(n).toBeLessThanOrEqual(SLOT_SOFT_CAP);
        }
    });

    it('is deterministic for a given rng', () => {
        const a = rollStock(ITEM_CATALOG, { ...baseOpts, rng: seqRng([0.42, 0.17, 0.93, 0.55]) });
        const b = rollStock(ITEM_CATALOG, { ...baseOpts, rng: seqRng([0.42, 0.17, 0.93, 0.55]) });
        expect(a.map(i => i.id)).toEqual(b.map(i => i.id));
    });
});
