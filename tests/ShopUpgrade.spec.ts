import { describe, expect, it } from 'vitest';
import {
    shopUpgradeCost, bonusScaleFor, itemPriceScaleFor, scaleMods,
} from '../src/survivors/shop/ShopUpgrade';
import { ItemStatMods } from '../src/survivors/items/ItemTypes';
import { describeMods } from '../src/survivors/items/describeMods';

describe('shopUpgradeCost', () => {
    it('follows round(300 * 1.6^level), uncapped', () => {
        expect(shopUpgradeCost(0)).toBe(300);
        expect(shopUpgradeCost(1)).toBe(480);
        expect(shopUpgradeCost(2)).toBe(768);
        expect(shopUpgradeCost(3)).toBe(1229);
        expect(shopUpgradeCost(5)).toBe(3146);
        expect(shopUpgradeCost(9)).toBe(20616);
    });
});

describe('scale factors', () => {
    it('bonus scale is +10% of base per level', () => {
        expect(bonusScaleFor(0)).toBeCloseTo(1.0);
        expect(bonusScaleFor(1)).toBeCloseTo(1.1);
        expect(bonusScaleFor(4)).toBeCloseTo(1.4);
        expect(bonusScaleFor(8)).toBeCloseTo(1.8);
    });
    it('item-price scale is +12% per level', () => {
        expect(itemPriceScaleFor(0)).toBeCloseTo(1.0);
        expect(itemPriceScaleFor(3)).toBeCloseTo(1.36);
        expect(itemPriceScaleFor(6)).toBeCloseTo(1.72);
    });
});

describe('scaleMods', () => {
    it('multiplies every present numeric field by the factor, exactly (no rounding)', () => {
        const mods: ItemStatMods = { basicDamagePct: 30, critChance: 0.05, maxHealth: 40 };
        const out = scaleMods(mods, 1.1);
        expect(out.basicDamagePct).toBeCloseTo(33);
        expect(out.critChance).toBeCloseTo(0.055);
        expect(out.maxHealth).toBeCloseTo(44);
    });
    it('leaves absent fields absent and never mutates the input', () => {
        const mods: ItemStatMods = { powerDamagePct: 20 };
        const out = scaleMods(mods, 1.4);
        expect(out.powerDamagePct).toBeCloseTo(28);
        expect(out.basicDamagePct).toBeUndefined();
        expect(mods.powerDamagePct).toBe(20); // input untouched
    });
    it('factor 1.0 is an identity copy', () => {
        const mods: ItemStatMods = { attackSpeedPct: 15, lifesteal: 0.06 };
        expect(scaleMods(mods, 1.0)).toEqual(mods);
    });
});

describe('describeMods rounds scaled percentage fields for display', () => {
    it('rounds a scaled basicDamagePct to a whole percent', () => {
        const scaled = scaleMods({ basicDamagePct: 12 }, 1.4); // 16.8
        expect(describeMods(scaled)).toContain('+17% basic damage');
    });
    it('rounds scaled maxHealth and knockback', () => {
        const scaled = scaleMods({ maxHealth: 40, knockback: 1 }, 1.1); // 44, 1.1
        expect(describeMods(scaled)).toContain('+44 max HP');
        expect(describeMods(scaled)).toContain('+1 knockback');
    });
});
