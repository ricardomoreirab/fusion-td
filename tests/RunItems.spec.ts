import { describe, expect, it, vi } from 'vitest';
import { RunItems, type ItemId } from '../src/survivors/RunItems';
import { PlayerStats } from '../src/survivors/PlayerStats';

/**
 * RunItems is the cleanest unit-testable thing in the codebase — it only
 * touches PlayerStats fields and an injected updateBasicAttackSpeed callback.
 * No Babylon scene, no DOM.
 */

function makeRunItems() {
    const stats = new PlayerStats();
    const heroController = {
        updateBasicAttackSpeed: vi.fn(),
        addReviveCharge: vi.fn(),
    } as unknown as ConstructorParameters<typeof RunItems>[2];
    const items = new RunItems(stats, 'barbarian', heroController);
    return { stats, heroController, items };
}

describe('RunItems.itemForTier', () => {
    it('maps tiers 1-4 to the spec items', () => {
        expect(RunItems.itemForTier(1)).toBe('extraLife');
        expect(RunItems.itemForTier(2)).toBe('multishotCleave');
        expect(RunItems.itemForTier(3)).toBe('knockback');
        expect(RunItems.itemForTier(4)).toBe('attackSpeed');
    });

    it('returns null for tiers outside 1-4', () => {
        expect(RunItems.itemForTier(0)).toBeNull();
        expect(RunItems.itemForTier(5)).toBeNull();
        expect(RunItems.itemForTier(-1)).toBeNull();
        expect(RunItems.itemForTier(99)).toBeNull();
    });
});

describe('RunItems.grant — extraLife', () => {
    it('grants a revive charge to the hero per stack and tracks the stack count', () => {
        const { heroController, items } = makeRunItems();
        const addReviveCharge = (heroController as unknown as {
            addReviveCharge: ReturnType<typeof vi.fn>;
        }).addReviveCharge;

        expect(items.getStacks('extraLife')).toBe(0);

        items.grant('extraLife');
        expect(items.getStacks('extraLife')).toBe(1);
        expect(addReviveCharge).toHaveBeenCalledTimes(1);

        items.grant('extraLife');
        expect(items.getStacks('extraLife')).toBe(2);
        expect(addReviveCharge).toHaveBeenCalledTimes(2);
    });

    it('consumeExtraLife decrements the HUD-facing stack, never below 0', () => {
        const { items } = makeRunItems();
        items.grant('extraLife');
        expect(items.getStacks('extraLife')).toBe(1);

        items.consumeExtraLife();
        expect(items.getStacks('extraLife')).toBe(0);

        // Idempotent at 0 — a stray consume can't underflow.
        items.consumeExtraLife();
        expect(items.getStacks('extraLife')).toBe(0);
    });
});

describe('RunItems.grant — knockback', () => {
    it('adds 1 unit of knockback per stack', () => {
        const { stats, items } = makeRunItems();
        expect(stats.knockbackOnHit).toBe(0);
        items.grant('knockback');
        expect(stats.knockbackOnHit).toBe(1);
        items.grant('knockback');
        expect(stats.knockbackOnHit).toBe(2);
    });
});

describe('RunItems.grant — multishotCleave', () => {
    it('increments extraAttacks per stack', () => {
        const { stats, items } = makeRunItems();
        expect(stats.extraAttacks).toBe(0);
        items.grant('multishotCleave');
        expect(stats.extraAttacks).toBe(1);
        items.grant('multishotCleave');
        expect(stats.extraAttacks).toBe(2);
    });
});

describe('RunItems.grant — attackSpeed', () => {
    it('doubles the basic-attack-speed multiplier per stack', () => {
        const { stats, heroController, items } = makeRunItems();
        expect(stats.basicAttackSpeedMultiplier).toBe(1.0);

        items.grant('attackSpeed');
        expect(stats.basicAttackSpeedMultiplier).toBe(2.0);
        // heroController.updateBasicAttackSpeed is a vi.fn() — cast via unknown
        // is the canonical way to peek at the mock alongside its real type.
        const mock = (heroController as unknown as {
            updateBasicAttackSpeed: ReturnType<typeof vi.fn>;
        }).updateBasicAttackSpeed;
        expect(mock).toHaveBeenLastCalledWith(2.0);

        items.grant('attackSpeed');
        expect(stats.basicAttackSpeedMultiplier).toBe(4.0);
    });

    it('compounds with prior shop-Quickness purchases (multiplicative)', () => {
        const { stats, items } = makeRunItems();
        stats.basicAttackSpeedMultiplier = 1.5; // simulate one Quickness shop purchase
        items.grant('attackSpeed');
        expect(stats.basicAttackSpeedMultiplier).toBe(3.0);
    });
});

describe('RunItems.hasItem / getStacks', () => {
    it('reflects grants', () => {
        const { items } = makeRunItems();
        const id: ItemId = 'extraLife';
        expect(items.hasItem(id)).toBe(false);
        expect(items.getStacks(id)).toBe(0);
        items.grant(id);
        expect(items.hasItem(id)).toBe(true);
        expect(items.getStacks(id)).toBe(1);
        items.grant(id);
        expect(items.getStacks(id)).toBe(2);
    });
});
