import { describe, it, expect } from 'vitest';
import { ENRAGE_HEALTH_FRACTION } from '../src/survivors/enemies/MilestoneBoss';

/**
 * The enrage stat block is pure arithmetic, so it is exercised here against a
 * stand-in with the same fields rather than a real MilestoneBoss (which needs a
 * Game, a scene and a GLB). The transitions the real class must preserve —
 * one-shot, composes with an existing resistance, monotonic health bar — are all
 * expressible on this shape.
 */
const TANK = 1.5;
const SPEED = 1.5;
const DAMAGE = 1.5;

interface BossLike {
    health: number;
    maxHealth: number;
    damageResistance: number;
    speed: number;
    meleeHitDamage: number;
    contactDamagePerSecond: number;
    dashSlashDamage: number;
    enraged: boolean;
}

function makeBoss(over: Partial<BossLike> = {}): BossLike {
    return {
        health: 1000, maxHealth: 1000, damageResistance: 0, speed: 6,
        meleeHitDamage: 40, contactDamagePerSecond: 30, dashSlashDamage: 48,
        enraged: false, ...over,
    };
}

/** Mirror of MilestoneBoss.maybeEnterLastStand. */
function tickEnrage(b: BossLike): void {
    if (b.enraged) return;
    if (b.health > b.maxHealth * ENRAGE_HEALTH_FRACTION) return;
    b.enraged = true;
    b.damageResistance = 1 - (1 - b.damageResistance) / TANK;
    b.speed *= SPEED;
    b.meleeHitDamage = Math.round(b.meleeHitDamage * DAMAGE);
    b.contactDamagePerSecond *= DAMAGE;
    b.dashSlashDamage = Math.round(b.dashSlashDamage * DAMAGE);
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
        expect(applied(b, 100)).toBeCloseTo(before / 1.5, 6);
    });

    it('composes with an existing resistance rather than replacing it', () => {
        // BossEnemy ships with 0.15 base resistance.
        const b = makeBoss({ health: 300, damageResistance: 0.15 });
        const before = applied(b, 100);
        tickEnrage(b);
        expect(applied(b, 100)).toBeCloseTo(before / 1.5, 6);
        expect(b.damageResistance).toBeGreaterThan(0.15);
        expect(b.damageResistance).toBeLessThan(1);
    });

    it('is 50% faster and 50% stronger across every damage channel', () => {
        const b = makeBoss({ health: 300 });
        tickEnrage(b);
        expect(b.speed).toBeCloseTo(9, 6);
        expect(b.meleeHitDamage).toBe(60);
        expect(b.contactDamagePerSecond).toBeCloseTo(45, 6);
        expect(b.dashSlashDamage).toBe(72);
    });

    it('is one-shot — staying below the threshold never re-applies it', () => {
        const b = makeBoss({ health: 300 });
        for (let i = 0; i < 100; i++) {
            b.health = Math.max(1, b.health - 1);
            tickEnrage(b);
        }
        expect(b.speed).toBeCloseTo(9, 6);
        expect(b.meleeHitDamage).toBe(60);
        expect(b.damageResistance).toBeCloseTo(1 - 1 / 1.5, 6);
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
