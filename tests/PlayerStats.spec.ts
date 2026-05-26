import { describe, expect, it } from 'vitest';
import { PlayerStats } from '../src/survivors/PlayerStats';

describe('PlayerStats — economy', () => {
    it('starts with the constructor-provided money', () => {
        const ps = new PlayerStats(120, 250);
        expect(ps.getMoney()).toBe(250);
        expect(ps.getGold()).toBe(250); // gold/money aliases
    });

    it('addMoney increases balance', () => {
        const ps = new PlayerStats(120, 100);
        ps.addMoney(50);
        expect(ps.getMoney()).toBe(150);
    });

    it('spendMoney deducts and returns true when affordable', () => {
        const ps = new PlayerStats(120, 100);
        expect(ps.spendMoney(60)).toBe(true);
        expect(ps.getMoney()).toBe(40);
    });

    it('spendMoney returns false without deducting when unaffordable', () => {
        const ps = new PlayerStats(120, 50);
        expect(ps.spendMoney(60)).toBe(false);
        expect(ps.getMoney()).toBe(50);
    });

    it('unlimited mode disables deductions and returns true', () => {
        const ps = new PlayerStats(120, 0);
        ps.setUnlimitedMoney(true);
        expect(ps.spendMoney(99999)).toBe(true);
        expect(ps.getMoney()).toBe(9999); // sentinel value
    });

    it('addGold/spendGold are aliases for money', () => {
        const ps = new PlayerStats(120, 0);
        ps.addGold(75);
        expect(ps.getGold()).toBe(75);
        expect(ps.spendGold(25)).toBe(true);
        expect(ps.getGold()).toBe(50);
    });
});

describe('PlayerStats — health', () => {
    it('starts at full health', () => {
        const ps = new PlayerStats(140, 0);
        expect(ps.getHealth()).toBe(140);
        expect(ps.getMaxHealth()).toBe(140);
    });

    it('takeDamage subtracts and clamps at 0', () => {
        const ps = new PlayerStats(100, 0);
        ps.takeDamage(30);
        expect(ps.getHealth()).toBe(70);
        ps.takeDamage(1000);
        expect(ps.getHealth()).toBe(0);
    });

    it('setHealth clamps to [0, maxHealth]', () => {
        const ps = new PlayerStats(100, 0);
        ps.setHealth(150);
        expect(ps.getHealth()).toBe(100);
        ps.setHealth(-5);
        expect(ps.getHealth()).toBe(0);
        ps.setHealth(42);
        expect(ps.getHealth()).toBe(42);
    });
});

describe('PlayerStats — purchase counts', () => {
    it('starts at 0 for every item id', () => {
        const ps = new PlayerStats();
        expect(ps.getPurchaseCount('vitality')).toBe(0);
        expect(ps.getPurchaseCount('made-up-item-id')).toBe(0);
    });

    it('incrementPurchase grows the count per id independently', () => {
        const ps = new PlayerStats();
        ps.incrementPurchase('vitality');
        ps.incrementPurchase('vitality');
        ps.incrementPurchase('swiftness');
        expect(ps.getPurchaseCount('vitality')).toBe(2);
        expect(ps.getPurchaseCount('swiftness')).toBe(1);
        expect(ps.getPurchaseCount('reach')).toBe(0);
    });
});

describe('PlayerStats — survivors multipliers default to neutral (1.0 / 0)', () => {
    it('starts with neutral defaults so a fresh run isn\'t accidentally boosted', () => {
        const ps = new PlayerStats();
        expect(ps.moveSpeedMultiplier).toBe(1.0);
        expect(ps.attackRangeMultiplier).toBe(1.0);
        expect(ps.powerDamageMultiplier).toBe(1.0);
        expect(ps.powerCooldownMultiplier).toBe(1.0);
        expect(ps.damageReductionMultiplier).toBe(1.0);
        expect(ps.basicAttackSpeedMultiplier).toBe(1.0);
        expect(ps.lifestealPct).toBe(0);
        expect(ps.extraAttacks).toBe(0);
        expect(ps.knockbackOnHit).toBe(0);
        expect(ps.critChance).toBe(0);
        expect(ps.critDamageMultiplier).toBe(1.5);
        expect(ps.bonusMaxHealth).toBe(0);
    });
});
