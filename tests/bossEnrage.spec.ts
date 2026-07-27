import { describe, it, expect } from 'vitest';
import { StatusEffect } from '../src/survivors/GameTypes';
import {
    ENRAGE_HEALTH_FRACTION, ENRAGE_TANK_FACTOR, ENRAGE_SPEED_FACTOR, ENRAGE_DAMAGE_FACTOR,
    ENRAGE_COOLDOWN_FACTOR, TWIN_ENRAGE_COOLDOWN_FACTOR,
    isMovementImpairing, specialCooldownScale,
} from '../src/survivors/enemies/enrageProfile';

/**
 * The enrage stat block is pure arithmetic, so it is exercised here against a
 * stand-in with the same fields rather than a real MilestoneBoss (which needs a
 * Game, a scene and a GLB). The transitions the real class must preserve —
 * one-shot, composes with an existing resistance, monotonic health bar — are all
 * expressible on this shape.
 *
 * The factors are IMPORTED, not restated: this file used to keep its own copy of
 * them, which meant retuning the boss left the assertions passing against the
 * old numbers.
 */
interface BossLike {
    health: number;
    maxHealth: number;
    damageResistance: number;
    speed: number;
    meleeHitDamage: number;
    contactDamagePerSecond: number;
    dashSlashDamage: number;
    enraged: boolean;
    /** Movement-impairing effects currently on the boss. */
    impairments: Set<StatusEffect>;
}

function makeBoss(over: Partial<BossLike> = {}): BossLike {
    return {
        health: 1000, maxHealth: 1000, damageResistance: 0, speed: 6,
        meleeHitDamage: 40, contactDamagePerSecond: 30, dashSlashDamage: 48,
        enraged: false, impairments: new Set(), ...over,
    };
}

/** Mirror of MilestoneBoss.maybeEnterLastStand. */
function tickEnrage(b: BossLike): void {
    if (b.enraged) return;
    if (b.health > b.maxHealth * ENRAGE_HEALTH_FRACTION) return;
    b.enraged = true;
    b.damageResistance = 1 - (1 - b.damageResistance) / ENRAGE_TANK_FACTOR;
    for (const e of [...b.impairments]) {
        if (isMovementImpairing(e)) b.impairments.delete(e);
    }
    b.speed *= ENRAGE_SPEED_FACTOR;
    b.meleeHitDamage = Math.round(b.meleeHitDamage * ENRAGE_DAMAGE_FACTOR);
    b.contactDamagePerSecond *= ENRAGE_DAMAGE_FACTOR;
    b.dashSlashDamage = Math.round(b.dashSlashDamage * ENRAGE_DAMAGE_FACTOR);
}

/** Mirror of MilestoneBoss.applyStatusEffect's gate. */
function applyStatus(b: BossLike, effect: StatusEffect): void {
    if (b.enraged && isMovementImpairing(effect)) return;
    b.impairments.add(effect);
}

/** Damage actually applied after resistance, mirroring Enemy.takeDamage. */
const applied = (b: BossLike, raw: number) => raw * (1 - b.damageResistance);

describe('boss last-stand enrage', () => {
    it('triggers at 30% health, not before', () => {
        const b = makeBoss({ health: 301 });
        tickEnrage(b);
        expect(b.enraged).toBe(false);

        b.health = 300;
        tickEnrage(b);
        expect(b.enraged).toBe(true);
    });

    it('is 50% more tanky in effective HP', () => {
        const b = makeBoss({ health: 300 });
        const before = applied(b, 100);
        tickEnrage(b);
        expect(applied(b, 100)).toBeCloseTo(before / ENRAGE_TANK_FACTOR, 6);
    });

    it('composes with an existing resistance rather than replacing it', () => {
        // BossEnemy ships with 0.15 base resistance.
        const b = makeBoss({ health: 300, damageResistance: 0.15 });
        const before = applied(b, 100);
        tickEnrage(b);
        expect(applied(b, 100)).toBeCloseTo(before / ENRAGE_TANK_FACTOR, 6);
        expect(b.damageResistance).toBeGreaterThan(0.15);
        expect(b.damageResistance).toBeLessThan(1);
    });

    it('is faster and stronger across every damage channel', () => {
        const b = makeBoss({ health: 300 });
        tickEnrage(b);
        expect(b.speed).toBeCloseTo(6 * ENRAGE_SPEED_FACTOR, 6);
        expect(b.meleeHitDamage).toBe(Math.round(40 * ENRAGE_DAMAGE_FACTOR));
        expect(b.contactDamagePerSecond).toBeCloseTo(30 * ENRAGE_DAMAGE_FACTOR, 6);
        expect(b.dashSlashDamage).toBe(Math.round(48 * ENRAGE_DAMAGE_FACTOR));
    });

    it('closes the gap on a kiting hero', () => {
        // Even the slowest milestone boss (tier 2, TIER_BASE_SPEED 5.8) has to end
        // up clear of the hero's 7 u/s BASE move speed, or the last stand can be
        // walked away from outright. A levelled hero still out-runs it — the
        // shorter special cadence and the grab are what answer that.
        expect(5.8 * ENRAGE_SPEED_FACTOR).toBeGreaterThan(7);
    });

    it('is one-shot — staying below the threshold never re-applies it', () => {
        const b = makeBoss({ health: 300 });
        for (let i = 0; i < 100; i++) {
            b.health = Math.max(1, b.health - 1);
            tickEnrage(b);
        }
        expect(b.speed).toBeCloseTo(6 * ENRAGE_SPEED_FACTOR, 6);
        expect(b.meleeHitDamage).toBe(Math.round(40 * ENRAGE_DAMAGE_FACTOR));
        expect(b.damageResistance).toBeCloseTo(1 - 1 / ENRAGE_TANK_FACTOR, 6);
    });

    it('never raises max health, so the boss bar cannot move backwards', () => {
        const b = makeBoss({ health: 300 });
        const maxBefore = b.maxHealth;
        const fillBefore = b.health / b.maxHealth;
        tickEnrage(b);
        expect(b.maxHealth).toBe(maxBefore);
        expect(b.health / b.maxHealth).toBeCloseTo(fillBefore, 6);
    });

    it('leaves the threshold where the HUD expects it', () => {
        // The HUD derives its enraged state from the same fraction (so the co-op
        // guest, which never ticks boss AI, still flips at the same point).
        expect(ENRAGE_HEALTH_FRACTION).toBeGreaterThan(0);
        expect(ENRAGE_HEALTH_FRACTION).toBeLessThan(0.5);
    });
});

describe('enraged boss is unstoppable', () => {
    const IMPAIRING = [
        StatusEffect.SLOWED, StatusEffect.FROZEN, StatusEffect.STUNNED,
        StatusEffect.CHILL, StatusEffect.CONFUSED, StatusEffect.PUSHED,
    ];
    const DAMAGE_ONLY = [StatusEffect.BURNING, StatusEffect.CURSE, StatusEffect.FRAGILE];

    it.each(IMPAIRING)('refuses %s once enraged', effect => {
        const b = makeBoss({ health: 300 });
        tickEnrage(b);
        applyStatus(b, effect);
        expect(b.impairments.has(effect)).toBe(false);
    });

    it.each(DAMAGE_ONLY)('still takes %s — this is a race, not immunity', effect => {
        const b = makeBoss({ health: 300 });
        tickEnrage(b);
        applyStatus(b, effect);
        expect(b.impairments.has(effect)).toBe(true);
    });

    it('breaks out of impairments it was already under when it enrages', () => {
        // A boss frozen at the moment it crosses the threshold must not stand
        // there through its own enrage waiting for the freeze to expire.
        const b = makeBoss({ health: 300, impairments: new Set([StatusEffect.FROZEN, StatusEffect.BURNING]) });
        tickEnrage(b);
        expect(b.impairments.has(StatusEffect.FROZEN)).toBe(false);
        expect(b.impairments.has(StatusEffect.BURNING)).toBe(true);
    });

    it('is impairable before the threshold', () => {
        const b = makeBoss({ health: 1000 });
        tickEnrage(b);
        applyStatus(b, StatusEffect.FROZEN);
        expect(b.impairments.has(StatusEffect.FROZEN)).toBe(true);
    });

    it('counts chill as impairing — it slows AND converts to a freeze at cap', () => {
        expect(isMovementImpairing(StatusEffect.CHILL)).toBe(true);
    });
});

describe('enraged special cooldown', () => {
    it('is unchanged when neither enrage is live', () => {
        expect(specialCooldownScale(false, false)).toBe(1);
    });

    it('shortens the cadence in the last stand', () => {
        expect(specialCooldownScale(false, true)).toBeCloseTo(ENRAGE_COOLDOWN_FACTOR, 6);
        expect(ENRAGE_COOLDOWN_FACTOR).toBeLessThan(1);
    });

    it('shortens it for a twin death', () => {
        expect(specialCooldownScale(true, false)).toBeCloseTo(TWIN_ENRAGE_COOLDOWN_FACTOR, 6);
    });

    it('COMPOSES the two rather than letting one override the other', () => {
        // Both enrages are independent one-shots and a tier-3/4 boss can hit both
        // in one fight; the composed cadence must be strictly faster than either.
        const both = specialCooldownScale(true, true);
        expect(both).toBeCloseTo(TWIN_ENRAGE_COOLDOWN_FACTOR * ENRAGE_COOLDOWN_FACTOR, 6);
        expect(both).toBeLessThan(specialCooldownScale(true, false));
        expect(both).toBeLessThan(specialCooldownScale(false, true));
    });

    it('never reaches zero, so specials can never fire every frame', () => {
        expect(specialCooldownScale(true, true)).toBeGreaterThan(0);
    });
});
