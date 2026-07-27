import { describe, it, expect } from 'vitest';
import {
    resolveLeapFlight, leapHeightAt, easeInCoil, type LeapSpec,
} from '../src/survivors/enemies/leapMotion';

/** The tier-1/Apex boss's shipped spec. */
const BOSS: LeapSpec = {
    maxDistance: 14, topSpeed: 24, minAirTime: 0.30,
    stopShort: 1.4, arcHeight: 4.0, arcMinFraction: 0.55,
};
/** The dragon turtle's. */
const TURTLE: LeapSpec = {
    maxDistance: 13, topSpeed: 20, minAirTime: 0.35,
    stopShort: 0, arcHeight: 4.5, arcMinFraction: 0.5,
};
const BOTH: Array<[string, LeapSpec]> = [['boss', BOSS], ['turtle', TURTLE]];

describe('leap flight', () => {
    it.each(BOTH)('%s: always lands exactly as its air time runs out', (_n, spec) => {
        // This is the property that keeps a leap from being followed by a pause:
        // speed × airTime must reproduce the distance at EVERY gap, including the
        // ones where the minimum-air-time floor is what sets the clock.
        for (let gap = 0; gap <= spec.maxDistance + 8; gap += 0.25) {
            const f = resolveLeapFlight(gap, spec);
            expect(f.speed * f.airTime).toBeCloseTo(f.distance, 6);
        }
    });

    it.each(BOTH)('%s: never travels further than its cap', (_n, spec) => {
        for (const gap of [0, 5, spec.maxDistance, 60, 500]) {
            expect(resolveLeapFlight(gap, spec).distance).toBeLessThanOrEqual(spec.maxDistance);
        }
    });

    it.each(BOTH)('%s: never exceeds its top speed', (_n, spec) => {
        for (let gap = 0; gap <= spec.maxDistance + 8; gap += 0.25) {
            expect(resolveLeapFlight(gap, spec).speed).toBeLessThanOrEqual(spec.topSpeed + 1e-9);
        }
    });

    it.each(BOTH)('%s: always stays airborne long enough to read', (_n, spec) => {
        for (let gap = 0; gap <= spec.maxDistance + 8; gap += 0.25) {
            expect(resolveLeapFlight(gap, spec).airTime).toBeGreaterThanOrEqual(spec.minAirTime);
        }
    });

    it.each(BOTH)('%s: survives a leaper stood on top of its target', (_n, spec) => {
        // gap 0 → distance 0 → speed 0. It must still coil, arc and land rather
        // than divide by zero or skip the move.
        const f = resolveLeapFlight(0, spec);
        expect(f.distance).toBe(0);
        expect(f.speed).toBe(0);
        expect(f.airTime).toBe(spec.minAirTime);
        expect(f.arcHeight).toBeCloseTo(spec.arcHeight * spec.arcMinFraction, 6);
        expect(Number.isFinite(f.speed)).toBe(true);
    });

    it.each(BOTH)('%s: arcs higher the further it goes, never beyond its peak', (_n, spec) => {
        const short = resolveLeapFlight(spec.stopShort + 1, spec);
        const full = resolveLeapFlight(spec.maxDistance + spec.stopShort, spec);
        expect(short.arcHeight).toBeLessThan(full.arcHeight);
        expect(full.arcHeight).toBeCloseTo(spec.arcHeight, 6);
        // A short hop still leaves the ground — otherwise it stops being a leap.
        expect(short.arcHeight).toBeGreaterThan(0);
    });

    it('stops short so the leaper lands in front of its target, not inside it', () => {
        // The boss slashes through on the follow-up dash, so it needs the gap.
        expect(resolveLeapFlight(10, BOSS).distance).toBeCloseTo(10 - BOSS.stopShort, 6);
        // The turtle lands ON the hero — the shell is the weapon.
        expect(resolveLeapFlight(10, TURTLE).distance).toBeCloseTo(10, 6);
    });
});

describe('leap arc', () => {
    it('leaves and meets the ground exactly', () => {
        expect(leapHeightAt(0, 4)).toBe(0);
        expect(leapHeightAt(1, 4)).toBe(0);
    });

    it('peaks at the full height halfway through', () => {
        expect(leapHeightAt(0.5, 4)).toBeCloseTo(4, 6);
    });

    it('is symmetric and never dips below the ground', () => {
        for (let t = 0; t <= 1.0001; t += 0.05) {
            const h = leapHeightAt(t, 4);
            expect(h).toBeGreaterThanOrEqual(0);
            expect(h).toBeCloseTo(leapHeightAt(1 - t, 4), 6);
        }
    });

    it('clamps outside 0..1 rather than diving underground', () => {
        // Frame overshoot can push progress past 1; a raw 4t(1−t) would go negative
        // and bury the model.
        expect(leapHeightAt(1.4, 4)).toBe(0);
        expect(leapHeightAt(-0.3, 4)).toBe(0);
    });
});

describe('coil easing', () => {
    it('runs 0 → 1 over the charge', () => {
        expect(easeInCoil(0)).toBe(0);
        expect(easeInCoil(1)).toBe(1);
    });

    it('is slow to start so the coil snaps tight at the launch', () => {
        expect(easeInCoil(0.5)).toBeLessThan(0.5);
        expect(easeInCoil(0.9)).toBeGreaterThan(easeInCoil(0.5));
    });

    it('clamps, so an overshooting timer cannot over-squash the body', () => {
        expect(easeInCoil(1.7)).toBe(1);
        expect(easeInCoil(-2)).toBe(0);
    });
});
