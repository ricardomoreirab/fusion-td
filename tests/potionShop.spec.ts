import { describe, it, expect } from 'vitest';
import { POTIONS, POTION_PRICE, potionBuffs, PotionId } from '../src/survivors/PotionShop';

describe('PotionShop', () => {
    it('defines four potions at a flat price', () => {
        expect(POTIONS.map(p => p.id).sort()).toEqual(['lifesteal', 'power', 'rage', 'shield']);
        for (const p of POTIONS) expect(p.price).toBe(POTION_PRICE);
        expect(POTION_PRICE).toBe(500);
    });
    it('empty set = identity buffs', () => {
        const b = potionBuffs(new Set<PotionId>());
        expect(b).toEqual({ powerMult: 1, atkSpeedMult: 1, dmgReductionMult: 1, lifestealAdd: 0 });
    });
    it('each potion maps to the right stat', () => {
        expect(potionBuffs(new Set<PotionId>(['power'])).powerMult).toBeCloseTo(1.2);
        expect(potionBuffs(new Set<PotionId>(['rage'])).atkSpeedMult).toBeCloseTo(1.1);
        expect(potionBuffs(new Set<PotionId>(['shield'])).dmgReductionMult).toBeCloseTo(0.8);
        expect(potionBuffs(new Set<PotionId>(['lifesteal'])).lifestealAdd).toBeCloseTo(0.1);
    });
    it('stacks different potions multiplicatively / additively', () => {
        const b = potionBuffs(new Set<PotionId>(['power', 'rage', 'shield', 'lifesteal']));
        expect(b.powerMult).toBeCloseTo(1.2);
        expect(b.atkSpeedMult).toBeCloseTo(1.1);
        expect(b.dmgReductionMult).toBeCloseTo(0.8);
        expect(b.lifestealAdd).toBeCloseTo(0.1);
    });
});
