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
        expect(priceFor(gorefang(), 0)).toBe(120);
        expect(priceFor(gorefang(), 5)).toBe(Math.ceil(120 * 1.3)); // 156
    });
    it('sell value is 60% of price paid, floored', () => {
        expect(sellValueOf(156)).toBe(93);
    });
});

describe('Equipment buy/replace', () => {
    it('buys into an empty slot, spending the wave-scaled price', () => {
        const stats = new PlayerStats(120, 300);
        const eq = new Equipment(stats);
        expect(eq.buy(gorefang(), 0)).toBe(true);
        expect(stats.getGold()).toBe(180);
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
        const stats = new PlayerStats(120, 300);
        const sink = vi.fn();
        stats.setXpSink(sink);
        const eq = new Equipment(stats);
        eq.buy(gorefang(), 0);                       // -120 → 180
        expect(eq.buy(cleaver(), 0)).toBe(true);     // -60 +72 credit → 192
        expect(stats.getGold()).toBe(192);
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
});
