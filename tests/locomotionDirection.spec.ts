import { describe, expect, it } from 'vitest';
import {
    BACKPEDAL_ENTER,
    BACKPEDAL_EXIT,
    nextBackpedalling,
    travelAlignment,
} from '../src/survivors/champions/locomotionDirection';

/** Yaw that faces +Z (the champion rigs' model forward). */
const FACING_PZ = 0;

describe('travelAlignment', () => {
    it('is +1 travelling dead ahead and -1 straight backwards', () => {
        expect(travelAlignment(FACING_PZ, 0, 5)).toBeCloseTo(1);
        expect(travelAlignment(FACING_PZ, 0, -5)).toBeCloseTo(-1);
    });

    it('is 0 for a pure strafe', () => {
        expect(travelAlignment(FACING_PZ, 5, 0)).toBeCloseTo(0);
        expect(travelAlignment(FACING_PZ, -5, 0)).toBeCloseTo(0);
    });

    it('follows the yaw, not the world axes', () => {
        // Facing +X: moving +X is now "ahead", moving +Z is the strafe.
        const facingPX = Math.PI / 2;
        expect(travelAlignment(facingPX, 5, 0)).toBeCloseTo(1);
        expect(travelAlignment(facingPX, 0, 5)).toBeCloseTo(0);
    });

    it('is speed-independent', () => {
        expect(travelAlignment(FACING_PZ, 0, 0.5)).toBeCloseTo(travelAlignment(FACING_PZ, 0, 50));
    });

    it('is 0 for a stationary hero', () => {
        expect(travelAlignment(FACING_PZ, 0, 0)).toBe(0);
    });
});

describe('nextBackpedalling', () => {
    it('runs the cycle forwards when travel agrees with facing', () => {
        expect(nextBackpedalling(false, FACING_PZ, 0, 6)).toBe(false);
    });

    it('flips to reverse when the hero retreats from what it is aiming at', () => {
        expect(nextBackpedalling(false, FACING_PZ, 0, -6)).toBe(true);
    });

    it('resolves a pure strafe to the forward cycle from either latch state', () => {
        // At 90 degrees neither cycle is right; forward is the conventional
        // fallback, and it must be reached from the reverse latch too.
        expect(nextBackpedalling(false, FACING_PZ, 6, 0)).toBe(false);
        expect(nextBackpedalling(true, FACING_PZ, 6, 0)).toBe(false);
    });

    it('keeps the latch across the deadband between the two thresholds', () => {
        // The whole point of the hysteresis: a heading hovering in this band
        // must not flip the cycle frame to frame.
        expect(BACKPEDAL_ENTER).toBeLessThan(BACKPEDAL_EXIT);
        const vz = (BACKPEDAL_ENTER + BACKPEDAL_EXIT) / 2;
        const vx = Math.sqrt(1 - vz * vz);
        expect(nextBackpedalling(false, FACING_PZ, vx, vz)).toBe(false);
        expect(nextBackpedalling(true, FACING_PZ, vx, vz)).toBe(true);
    });

    it('leaves reverse once travel is no longer rearward', () => {
        const vz = BACKPEDAL_EXIT + 0.05;
        const vx = Math.sqrt(1 - vz * vz);
        expect(nextBackpedalling(true, FACING_PZ, vx, vz)).toBe(false);
    });

    it('enters reverse only past the stricter threshold', () => {
        const justInside = BACKPEDAL_ENTER - 0.05;
        const justOutside = BACKPEDAL_ENTER + 0.05;
        expect(nextBackpedalling(false, FACING_PZ, Math.sqrt(1 - justInside ** 2), justInside)).toBe(true);
        expect(nextBackpedalling(false, FACING_PZ, Math.sqrt(1 - justOutside ** 2), justOutside)).toBe(false);
    });

    it('a stationary hero holds its latch instead of snapping the legs around', () => {
        expect(nextBackpedalling(true, FACING_PZ, 0, 0)).toBe(true);
        expect(nextBackpedalling(false, FACING_PZ, 0, 0)).toBe(false);
    });

    it('is a pure function of the latch and the heading, at any speed', () => {
        expect(nextBackpedalling(false, FACING_PZ, 0, -0.2)).toBe(true);
        expect(nextBackpedalling(false, FACING_PZ, 0, -20)).toBe(true);
    });
});
