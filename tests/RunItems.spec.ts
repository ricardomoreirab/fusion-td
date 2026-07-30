import { describe, expect, it, vi } from 'vitest';
import { RunItems, LIFESTEAL_PCT_PER_STACK, type ItemId } from '../src/survivors/RunItems';
import { PlayerStats } from '../src/survivors/PlayerStats';
import { MAX_AUTHORED_TIER } from '../src/survivors/enemies/bossTiers';

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
    it('maps every boss tier to the spec item', () => {
        expect(RunItems.itemForTier(1)).toBe('extraLife');
        expect(RunItems.itemForTier(2)).toBe('multishotCleave');
        expect(RunItems.itemForTier(3)).toBe('knockback');
        expect(RunItems.itemForTier(4)).toBe('attackSpeed');
        expect(RunItems.itemForTier(5)).toBe('verdantHeart');
        expect(RunItems.itemForTier(6)).toBe('elementalCore');
    });

    it('gives every milestone boss a drop', () => {
        // A boss with no reward is the failure mode of moving one between waves
        // and forgetting its item — which is exactly what happened when the
        // Elemental Lord moved from wave 25 to wave 30.
        for (let tier = 1; tier <= MAX_AUTHORED_TIER; tier++) {
            expect(RunItems.itemForTier(tier), `tier ${tier} drops nothing`).not.toBeNull();
        }
    });

    it('swaps the ranger tier-3 drop to ricochet, leaving other classes on knockback', () => {
        expect(RunItems.itemForTier(3, 'ranger')).toBe('ricochet');
        expect(RunItems.itemForTier(3, 'barbarian')).toBe('knockback');
        expect(RunItems.itemForTier(3, 'mage')).toBe('knockback');
        // Other tiers are untouched by the ranger override.
        expect(RunItems.itemForTier(1, 'ranger')).toBe('extraLife');
        expect(RunItems.itemForTier(6, 'ranger')).toBe('elementalCore');
    });

    it('returns null for tiers outside the authored ladder', () => {
        expect(RunItems.itemForTier(0)).toBeNull();
        expect(RunItems.itemForTier(MAX_AUTHORED_TIER + 1)).toBeNull();
        expect(RunItems.itemForTier(-1)).toBeNull();
        expect(RunItems.itemForTier(99)).toBeNull();
    });
});

describe('RunItems.itemRowForClass', () => {
    it('returns one socket per boss tier, with the class tier-3 variant', () => {
        expect(RunItems.itemRowForClass('barbarian')).toEqual(
            ['extraLife', 'multishotCleave', 'knockback', 'attackSpeed', 'verdantHeart', 'elementalCore']);
        expect(RunItems.itemRowForClass('ranger')).toEqual(
            ['extraLife', 'multishotCleave', 'ricochet', 'attackSpeed', 'verdantHeart', 'elementalCore']);
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

describe('RunItems.grant — verdantHeart', () => {
    it('adds lifesteal per stack', () => {
        const { stats, items } = makeRunItems();
        expect(stats.lifestealPct).toBe(0);
        items.grant('verdantHeart');
        expect(stats.lifestealPct).toBeCloseTo(LIFESTEAL_PCT_PER_STACK, 6);
        items.grant('verdantHeart');
        expect(stats.lifestealPct).toBeCloseTo(LIFESTEAL_PCT_PER_STACK * 2, 6);
    });

    it('ADDS to lifesteal rather than assigning it', () => {
        // lifestealPct is shared with equipment and ascension, both of which
        // delta-swap it assuming RunItems only ever +=s. An assignment here
        // would wipe their contribution and desync both fold trackers for the
        // rest of the run — the same contract knockback documents.
        const { stats, items } = makeRunItems();
        stats.lifestealPct = 0.25; // stand in for an equipped/ascended contribution
        items.grant('verdantHeart');
        expect(stats.lifestealPct).toBeCloseTo(0.25 + LIFESTEAL_PCT_PER_STACK, 6);
    });
});

describe('RunItems.grant — ricochet', () => {
    it('grants 2 bounces per stack via assignment (RunItems is the only writer)', () => {
        const { stats, items } = makeRunItems();
        expect(stats.ricochetBounces).toBe(0);
        items.grant('ricochet');
        expect(stats.ricochetBounces).toBe(2);
        items.grant('ricochet');
        expect(stats.ricochetBounces).toBe(4);
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
