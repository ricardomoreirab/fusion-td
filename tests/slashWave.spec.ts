import { describe, expect, it } from 'vitest';
import {
    SLASH_WAVE_BACK_GRACE,
    SLASH_WAVE_HALF_WIDTH,
    isInSlashBand,
} from '../src/survivors/champions/HeroBasicAttack';

const W = SLASH_WAVE_HALF_WIDTH;

describe('isInSlashBand', () => {
    it('hits enemies inside the band the crest crossed this step', () => {
        // Wave travelling +X, crest moved from 2 to 4.
        expect(isInSlashBand(3, 0, 1, 0, 2, 4, W)).toBe(true);
        expect(isInSlashBand(3, W - 0.01, 1, 0, 2, 4, W)).toBe(true);
        expect(isInSlashBand(3, -(W - 0.01), 1, 0, 2, 4, W)).toBe(true);
    });

    it('misses enemies the crest has not reached or already swept past', () => {
        expect(isInSlashBand(5, 0, 1, 0, 2, 4, W)).toBe(false);
        expect(isInSlashBand(1, 0, 1, 0, 2, 4, W)).toBe(false);
    });

    it('misses enemies laterally outside the corridor', () => {
        expect(isInSlashBand(3, W + 0.01, 1, 0, 2, 4, W)).toBe(false);
        expect(isInSlashBand(3, -(W + 0.01), 1, 0, 2, 4, W)).toBe(false);
    });

    it('sweeps each point exactly once across consecutive steps', () => {
        // Half-open (prev, new]: a point on the shared boundary belongs to the
        // earlier step only, so no enemy is ever hit twice by adjacent steps.
        expect(isInSlashBand(2, 0, 1, 0, 0, 2, W)).toBe(true);
        expect(isInSlashBand(2, 0, 1, 0, 2, 4, W)).toBe(false);
    });

    it('works for arbitrary travel directions', () => {
        // Travelling -Z: an enemy 3 units down -Z is in band (2, 4]; an enemy
        // 90° off to +X is not.
        expect(isInSlashBand(0, -3, 0, -1, 2, 4, W)).toBe(true);
        expect(isInSlashBand(3, 0, 0, -1, 2, 4, W)).toBe(false);
    });

    it('catches enemies overlapping the hero via the back grace on the first step', () => {
        expect(isInSlashBand(0, 0, 1, 0, -SLASH_WAVE_BACK_GRACE, 0.3, W)).toBe(true);
        expect(isInSlashBand(-0.3, 0, 1, 0, -SLASH_WAVE_BACK_GRACE, 0.3, W)).toBe(true);
        expect(isInSlashBand(-0.8, 0, 1, 0, -SLASH_WAVE_BACK_GRACE, 0.3, W)).toBe(false);
    });
});
