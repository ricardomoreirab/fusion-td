import { describe, it, expect } from 'vitest';
import { computeRecycledPosition, PROP_MIN_R, PROP_MAX_R } from '../src/survivors/globe/PropField';

describe('computeRecycledPosition', () => {
    it('places the prop between PROP_MIN_R and PROP_MAX_R from the hero', () => {
        for (let i = 0; i < 50; i++) {
            const p = computeRecycledPosition(100, -40, 1, 0, Math.random(), Math.random());
            const d = Math.hypot(p.x - 100, p.z - (-40));
            expect(d).toBeGreaterThanOrEqual(PROP_MIN_R - 1e-9);
            expect(d).toBeLessThanOrEqual(PROP_MAX_R + 1e-9);
        }
    });

    it('biases into the travel half-plane when moving', () => {
        // Hero moving +x: spread is ±110° around the travel direction, so the
        // angle cosine toward the prop must stay ≥ cos(110°).
        for (let i = 0; i < 50; i++) {
            const p = computeRecycledPosition(0, 0, 1, 0, Math.random(), Math.random());
            const d = Math.hypot(p.x, p.z);
            expect(p.x / d).toBeGreaterThanOrEqual(Math.cos((110 * Math.PI) / 180) - 1e-9);
        }
    });

    it('uses the full circle when stationary', () => {
        // angles must cover all quadrants across many samples
        const quadrants = new Set<number>();
        for (let i = 0; i < 200; i++) {
            const p = computeRecycledPosition(0, 0, 0, 0, i / 200, 0.5);
            quadrants.add((p.x >= 0 ? 1 : 0) + (p.z >= 0 ? 2 : 0));
        }
        expect(quadrants.size).toBe(4);
    });
});
