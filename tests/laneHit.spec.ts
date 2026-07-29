import { describe, it, expect } from 'vitest';
import { isInLane } from '../src/survivors/enemies/laneHit';
import { LANE_FX } from '../src/survivors/enemies/EnemyGroundFx';

const LENGTH = 12;
const HALF = 1.7;
/** Straight down +X, so `relX` reads as "along" and `relZ` as "across". */
const AX = 1, AZ = 0;

/** A diagonal heading, normalized — the case a bare `relX`/`relZ` comparison
 *  would silently get wrong while every axis-aligned test still passed. */
const D = Math.SQRT1_2;

describe('isInLane', () => {
    it('hits a target on the centre line, anywhere along the lane', () => {
        for (const along of [0, 0.5, LENGTH / 2, LENGTH]) {
            expect(isInLane(along, 0, AX, AZ, LENGTH, HALF), `along=${along}`).toBe(true);
        }
    });

    it('misses past the end of the lane', () => {
        expect(isInLane(LENGTH + 0.01, 0, AX, AZ, LENGTH, HALF)).toBe(false);
        expect(isInLane(LENGTH * 5, 0, AX, AZ, LENGTH, HALF)).toBe(false);
    });

    it('never hits behind the attacker', () => {
        // A lane is directional. A symmetric test would let a hero standing
        // BEHIND the titan eat a smash aimed the other way, which is exactly the
        // "hit by something that was not drawn" failure this module exists for.
        expect(isInLane(-0.01, 0, AX, AZ, LENGTH, HALF)).toBe(false);
        expect(isInLane(-LENGTH / 2, 0, AX, AZ, LENGTH, HALF)).toBe(false);
    });

    it('hits exactly out to the half-width and no further', () => {
        expect(isInLane(5, HALF, AX, AZ, LENGTH, HALF)).toBe(true);
        expect(isInLane(5, -HALF, AX, AZ, LENGTH, HALF)).toBe(true);
        expect(isInLane(5, HALF + 0.01, AX, AZ, LENGTH, HALF)).toBe(false);
        expect(isInLane(5, -(HALF + 0.01), AX, AZ, LENGTH, HALF)).toBe(false);
    });

    it('measures across the lane, not from the attacker', () => {
        // The distinguishing property of a lane versus a cone or a circle: a
        // target far down the lane is hit at the SAME sideways offset as one
        // right in front, even though it is much further away overall.
        expect(isInLane(1, HALF * 0.9, AX, AZ, LENGTH, HALF)).toBe(true);
        expect(isInLane(LENGTH - 0.1, HALF * 0.9, AX, AZ, LENGTH, HALF)).toBe(true);
        // …and a distant target just outside the width misses, where a radius
        // test centred on the attacker would have caught it long before.
        expect(isInLane(LENGTH - 0.1, HALF * 1.2, AX, AZ, LENGTH, HALF)).toBe(false);
    });

    it('works on a diagonal heading, not just the axes', () => {
        // Along the diagonal at half length.
        const along = LENGTH / 2;
        expect(isInLane(D * along, D * along, D, D, LENGTH, HALF)).toBe(true);
        // Perpendicular to it is (-D, D); step just inside and just outside.
        const near = HALF * 0.9, far = HALF * 1.1;
        expect(isInLane(D * along - D * near, D * along + D * near, D, D, LENGTH, HALF)).toBe(true);
        expect(isInLane(D * along - D * far, D * along + D * far, D, D, LENGTH, HALF)).toBe(false);
    });

    it('hits the attacker\'s own position', () => {
        // along = 0 is the start of the lane, so a hero standing inside the
        // titan is caught rather than falling through a `> 0` boundary.
        expect(isInLane(0, 0, AX, AZ, LENGTH, HALF)).toBe(true);
    });

    it('is symmetric across the centre line', () => {
        for (const along of [0.2, 3, 11.9]) {
            for (const across of [0.4, HALF * 0.99, HALF * 1.01, 4]) {
                expect(isInLane(along, across, AX, AZ, LENGTH, HALF))
                    .toBe(isInLane(along, -across, AX, AZ, LENGTH, HALF));
            }
        }
    });

    it('resolves the smash against the width the telegraph actually paints', () => {
        // The titan derives its half-width from LANE_FX rather than a second
        // constant, so the marker and the hitbox cannot drift apart. A hero on
        // the painted edge is hit; one a hair outside it is not.
        const half = LANE_FX.smash.width / 2;
        expect(isInLane(4, half * 0.99, AX, AZ, LENGTH, half)).toBe(true);
        expect(isInLane(4, half * 1.01, AX, AZ, LENGTH, half)).toBe(false);
    });
});
