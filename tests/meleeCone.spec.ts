import { describe, expect, it } from 'vitest';
import { MELEE_CONE_HALF_ANGLE_RAD, isInMeleeCone } from '../src/survivors/champions/HeroBasicAttack';

const cosHalf = Math.cos(MELEE_CONE_HALF_ANGLE_RAD);

describe('isInMeleeCone', () => {
    it('hits enemies straight ahead and misses enemies behind', () => {
        // Facing +X.
        expect(isInMeleeCone(5, 0, 1, 0, cosHalf)).toBe(true);
        expect(isInMeleeCone(-5, 0, 1, 0, cosHalf)).toBe(false);
        expect(isInMeleeCone(0, 5, 1, 0, cosHalf)).toBe(false); // 90° off — outside a 55° half-angle
    });

    it('respects the half-angle boundary', () => {
        // Just inside / just outside the 55° edge around facing +X.
        const inside = MELEE_CONE_HALF_ANGLE_RAD - 0.02;
        const outside = MELEE_CONE_HALF_ANGLE_RAD + 0.02;
        expect(isInMeleeCone(Math.cos(inside), Math.sin(inside), 1, 0, cosHalf)).toBe(true);
        expect(isInMeleeCone(Math.cos(outside), Math.sin(outside), 1, 0, cosHalf)).toBe(false);
    });

    it('works for arbitrary facing directions', () => {
        // Facing -Z: an enemy at -Z hits, an enemy at +X (90° off) misses.
        expect(isInMeleeCone(0, -3, 0, -1, cosHalf)).toBe(true);
        expect(isInMeleeCone(3, 0, 0, -1, cosHalf)).toBe(false);
    });

    it('always hits an enemy standing inside the hero', () => {
        expect(isInMeleeCone(0, 0, 1, 0, cosHalf)).toBe(true);
    });
});
