import { describe, expect, it } from 'vitest';
import { COVER_MAX_R, COVER_MIN_R, computeCoverPosition } from '../src/survivors/globe/GroundCoverField';

describe('computeCoverPosition', () => {
    it('places recycled cover inside the band around the hero', () => {
        for (let i = 0; i < 200; i++) {
            const randAngle = (i * 37 % 100) / 100;
            const randR = (i * 61 % 100) / 100;
            const p = computeCoverPosition(10, -4, 0, 0, randAngle, randR);
            const d = Math.hypot(p.x - 10, p.z + 4);
            expect(d).toBeGreaterThanOrEqual(COVER_MIN_R - 1e-9);
            expect(d).toBeLessThanOrEqual(COVER_MAX_R + 1e-9);
        }
    });

    it('biases placement toward the travel direction when moving', () => {
        // Hero running +X: every placement must land within ±110° of +X,
        // i.e. never directly behind the hero.
        for (let i = 0; i < 100; i++) {
            const randAngle = i / 100;
            const p = computeCoverPosition(0, 0, 1, 0, randAngle, 0.5);
            const angle = Math.abs(Math.atan2(p.z, p.x));
            expect(angle).toBeLessThanOrEqual((110 * Math.PI) / 180 + 1e-9);
        }
    });

    it('uses the full circle when stationary', () => {
        // With dir ≈ 0 the angle is randAngle * 2π — verify a behind-the-hero
        // placement is possible (angle near π).
        const p = computeCoverPosition(0, 0, 0, 0, 0.5, 0.5);
        expect(Math.atan2(p.z, p.x)).toBeCloseTo(Math.PI, 5);
    });
});
