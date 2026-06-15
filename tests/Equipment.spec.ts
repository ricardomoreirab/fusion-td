// tests/Equipment.spec.ts
import { describe, expect, it, vi } from 'vitest';
import { Equipment, priceFor, sellValueOf } from '../src/survivors/items/Equipment';
import { foldEquipmentStats, newEquipFoldTracker } from '../src/survivors/items/foldEquipmentStats';
import { itemById } from '../src/survivors/items/ItemCatalog';
import { PlayerStats } from '../src/survivors/PlayerStats';

const gorefang = () => itemById('gorefang')!;
const skullcage = () => itemById('skullcage_of_rage')!;
const bloodplate = () => itemById('bloodforged_plate')!;
const cleaver = () => itemById('butchers_cleaver')!;
const bloodvial = () => itemById('bloodvial')!;

describe('pricing', () => {
    it('scales base price with wave', () => {
        // Price rework 2026-06-14: gorefang is rare → base 300.
        expect(priceFor(gorefang(), 0)).toBe(300);
        expect(priceFor(gorefang(), 5)).toBe(Math.ceil(300 * 1.3)); // 390
    });
    it('sell value is 60% of price paid, floored', () => {
        expect(sellValueOf(156)).toBe(93);
    });
});

describe('Equipment buy/replace', () => {
    it('buys into an empty slot, spending the wave-scaled price', () => {
        const stats = new PlayerStats(120, 500);
        const eq = new Equipment(stats);
        expect(eq.buy(gorefang(), 0)).toBe(true); // rare → 300
        expect(stats.getGold()).toBe(200);
        expect(eq.get('weapon')!.def.id).toBe('gorefang');
    });

    it('refuses when gold (plus replacement credit) is insufficient', () => {
        const stats = new PlayerStats(120, 50);
        const eq = new Equipment(stats);
        expect(eq.buy(gorefang(), 0)).toBe(false);
        expect(stats.getGold()).toBe(50);
        expect(eq.get('weapon')).toBeNull();
    });

    it('replacing credits 60% of the old price paid, without feeding XP', () => {
        const stats = new PlayerStats(120, 500);
        const sink = vi.fn();
        stats.setXpSink(sink);
        const eq = new Equipment(stats);
        eq.buy(gorefang(), 0);                       // rare 300: -300 → 200
        expect(eq.buy(cleaver(), 0)).toBe(true);     // common 150: -150 +180 credit → 230
        expect(stats.getGold()).toBe(230);
        expect(eq.get('weapon')!.def.id).toBe('butchers_cleaver');
        expect(sink).not.toHaveBeenCalled();
    });

    it('counts owned ids and set pieces', () => {
        const stats = new PlayerStats(120, 1000);
        const eq = new Equipment(stats);
        eq.buy(gorefang(), 0);
        eq.buy(skullcage(), 0);
        expect(eq.ownedIds().has('gorefang')).toBe(true);
        expect(eq.setCount('berserkers_wrath')).toBe(2);
    });
});

describe('Equipment aggregates', () => {
    it('multiplies pct mods and sums additive mods', () => {
        const stats = new PlayerStats(120, 10000);
        const eq = new Equipment(stats);
        eq.buy(cleaver(), 0);     // +12% basic damage
        eq.buy(bloodvial(), 0);   // +6% lifesteal
        const agg = eq.aggregates();
        expect(agg.basicDamageMult).toBeCloseTo(1.12);
        expect(agg.lifesteal).toBeCloseTo(0.06);
        expect(agg.effects.size).toBe(0);
    });

    it('includes the 2pc set bonus at 2 pieces but not 1', () => {
        const stats = new PlayerStats(120, 10000);
        const eq = new Equipment(stats);
        eq.buy(gorefang(), 0);    // item: +20% basic dmg, +0% atkspeed
        expect(eq.aggregates().attackSpeedMult).toBeCloseTo(1.0);
        eq.buy(skullcage(), 0);   // item +10% atkspeed; 2pc +20% atkspeed
        expect(eq.aggregates().attackSpeedMult).toBeCloseTo(1.10 * 1.20);
    });

    it('adds the set signature effect at 3 pieces', () => {
        const stats = new PlayerStats(120, 10000);
        const eq = new Equipment(stats);
        eq.buy(gorefang(), 0);
        eq.buy(skullcage(), 0);
        expect(eq.aggregates().effects.has('rage')).toBe(false);
        eq.buy(bloodplate(), 0);
        expect(eq.aggregates().effects.has('rage')).toBe(true);
    });

    it('includes item effectIds', () => {
        const stats = new PlayerStats(120, 10000);
        const eq = new Equipment(stats);
        eq.buy(itemById('thornmail_hauberk')!, 0);
        expect(eq.aggregates().effects.has('thorns')).toBe(true);
    });

    it('reset clears everything', () => {
        const stats = new PlayerStats(120, 10000);
        const eq = new Equipment(stats);
        eq.buy(gorefang(), 0);
        eq.reset();
        expect(eq.get('weapon')).toBeNull();
        expect(eq.aggregates().basicDamageMult).toBe(1);
    });
});

describe('foldEquipmentStats', () => {
    /** Simulates applyLevelBonuses(): assign level-derived values, then fold. */
    function recompute(ps: PlayerStats, eq: Equipment, t: ReturnType<typeof newEquipFoldTracker>) {
        ps.moveSpeedMultiplier = 1.05;
        ps.basicAttackSpeedMultiplier = 1.02;
        ps.powerDamageMultiplier = 1.10;
        ps.powerCooldownMultiplier = 0.95;
        ps.damageReductionMultiplier = 0.95;
        ps.critChance = 0.01;
        ps.critDamageMultiplier = 1.55;
        foldEquipmentStats(ps, eq.aggregates(), t);
    }

    it('is idempotent across repeated recomputes', () => {
        const ps = new PlayerStats(120, 10000);
        const eq = new Equipment(ps);
        const t = newEquipFoldTracker();
        eq.buy(itemById('sprintweave_boots')!, 0);   // +10% move speed
        eq.buy(bloodvial(), 0);                      // +6% lifesteal (delta-tracked)
        recompute(ps, eq, t);
        const move1 = ps.moveSpeedMultiplier;
        const ls1 = ps.lifestealPct;
        recompute(ps, eq, t);
        expect(ps.moveSpeedMultiplier).toBeCloseTo(move1);   // 1.05 × 1.10
        expect(ps.lifestealPct).toBeCloseTo(ls1);            // no double-add
        expect(move1).toBeCloseTo(1.05 * 1.10);
        expect(ls1).toBeCloseTo(0.06);
    });

    it('preserves external += additions to lifesteal (RunItems interplay)', () => {
        const ps = new PlayerStats(120, 10000);
        const eq = new Equipment(ps);
        const t = newEquipFoldTracker();
        eq.buy(bloodvial(), 0);
        recompute(ps, eq, t);
        ps.lifestealPct += 0.10;          // RunItems-style external addition
        recompute(ps, eq, t);
        expect(ps.lifestealPct).toBeCloseTo(0.16);
    });

    it('writes the equipment-only fields directly', () => {
        const ps = new PlayerStats(120, 10000);
        const eq = new Equipment(ps);
        const t = newEquipFoldTracker();
        eq.buy(cleaver(), 0);            // +12% basic damage
        recompute(ps, eq, t);
        expect(ps.basicDamageMultiplier).toBeCloseTo(1.12);
        eq.reset();
        recompute(ps, eq, t);
        expect(ps.basicDamageMultiplier).toBe(1);
    });

    it('folds cooldown, damage-taken and gold-gain with the right signs', () => {
        const ps = new PlayerStats(120, 10000);
        const eq = new Equipment(ps);
        const t = newEquipFoldTracker();
        eq.buy(itemById('mindcrown')!, 0);             // −8% power cooldowns
        eq.buy(itemById('juggernaut_legplates')!, 0);  // −15% damage taken (+1 knockback)
        eq.buy(itemById('gribbles_lucky_coin')!, 0);   // +10% gold (+5% crit)
        recompute(ps, eq, t);
        expect(ps.powerCooldownMultiplier).toBeCloseTo(0.95 * 0.92);   // lower = faster
        expect(ps.damageReductionMultiplier).toBeCloseTo(0.95 * 0.85); // lower = tankier
        expect(ps.goldGainMultiplier).toBeCloseTo(1.10);
        expect(ps.knockbackOnHit).toBeCloseTo(1);
    });
});

describe('shop-level pricing + scaling', () => {
    it('priceFor multiplies the wave price by +12% per shop level', () => {
        // gorefang is rare → base 300. Wave 0, shop 0 → 300.
        expect(priceFor(gorefang(), 0, 0)).toBe(300);
        // Wave 0, shop +3 → ceil(300 × 1.36) = 408.
        expect(priceFor(gorefang(), 0, 3)).toBe(408);
        // Stacks with wave scaling: wave 5 (×1.3), shop +2 (×1.24).
        expect(priceFor(gorefang(), 5, 2)).toBe(Math.ceil(300 * 1.3 * 1.24));
    });
    it('priceFor defaults shopLevel to 0 (back-compat)', () => {
        expect(priceFor(gorefang(), 5)).toBe(Math.ceil(300 * 1.3));
    });

    it('buy captures the shop level onto the equipped item', () => {
        const eq = new Equipment(new PlayerStats(120, 100000));
        expect(eq.buy(gorefang(), 0, 2)).toBe(true);
        expect(eq.get('weapon')!.level).toBe(2);
    });

    it('aggregates scales an item\'s own mods by its captured level', () => {
        const eq = new Equipment(new PlayerStats(120, 100000));
        eq.buy(cleaver(), 0, 4);   // common: +12% basic damage; +4 → ×1.40 → 16.8% → ×1.168
        expect(eq.aggregates().basicDamageMult).toBeCloseTo(1 + 0.12 * 1.40, 5);
    });

    it('keeps each item frozen at its own bought level (no retroactive change)', () => {
        const eq = new Equipment(new PlayerStats(120, 100000));
        eq.buy(cleaver(), 0, 2);   // +12% basic dmg at +2 → ×1.20 → 14.4%
        const before = eq.aggregates().basicDamageMult;
        // A later, higher-level item in a DIFFERENT slot must not change the weapon's bonus.
        eq.buy(itemById('sprintweave_boots')!, 0, 9);
        expect(eq.aggregates().basicDamageMult).toBeCloseTo(before, 5);
        expect(before).toBeCloseTo(1 + 0.12 * 1.20, 5);
    });

    it('does NOT scale set bonuses by item level (only the item\'s own mods)', () => {
        const eq = new Equipment(new PlayerStats(120, 100000));
        // 2-pc Berserker's Wrath = +20% attack speed (fixed). gorefang +0% atkspd,
        // skullcage +10% atkspd. Both bought at +5 → item mods scale, set bonus does not.
        eq.buy(gorefang(), 0, 5);     // atkspd mod 0 → still 0
        eq.buy(skullcage(), 0, 5);    // atkspd item mod 10 → ×1.5 → 15%
        const agg = eq.aggregates();
        // item 15% (scaled) × set 20% (UNSCALED) = 1.15 × 1.20
        expect(agg.attackSpeedMult).toBeCloseTo(1.15 * 1.20, 5);
    });
});

describe('unique sets + mythic wildcard', () => {
    function equip(eq: Equipment, ...ids: string[]) {
        for (const id of ids) expect(eq.buy(itemById(id)!, 0)).toBe(true);
    }

    it('applies the 2-piece tier at 2 unique pieces, not the 4/6', () => {
        const eq = new Equipment(new PlayerStats(120, 100000));
        equip(eq, 'oathbreaker_maul', 'browplate_of_the_titan'); // maul +8% atkspd; 2pc +15% atkspd
        const agg = eq.aggregates();
        expect(agg.setCounts['titans_oath']).toBe(2);
        expect(agg.attackSpeedMult).toBeCloseTo(1.08 * 1.15, 5);
        expect(agg.effects.has('earthbreaker')).toBe(false);
    });

    it('a mythic weapon counts as the unique set weapon piece (wildcard ⇒ 6-pc)', () => {
        const eq = new Equipment(new PlayerStats(120, 100000));
        // 5 unique armor pieces + the mythic weapon (NOT the unique weapon)
        equip(eq, 'browplate_of_the_titan', 'ribcage_bulwark', 'quakestride_faulds',
              'stampede_sabatons', 'heart_of_the_warbeast', 'skullsplitter_apex');
        const agg = eq.aggregates();
        expect(agg.setCounts['titans_oath']).toBe(6);
        expect(agg.effects.has('earthbreaker')).toBe(true);  // 6-pc set effect
        expect(agg.effects.has('apex_cleave')).toBe(true);   // mythic's own effect
        // mythic's OWN basic-dmg (38) folded — with the 4-pc tier (+18), not the unique weapon's 24.
        expect(agg.basicDamageMult).toBeCloseTo(1.38 * 1.18, 5);
    });
});
