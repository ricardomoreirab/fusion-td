import { describe, it, expect } from 'vitest';
import { resolveLungeReach, lungeTravel, postLungeGap } from '../src/survivors/enemies/meleeLunge';

/** The fenrir's shipped numbers (SplittingEnemy) — the reachability invariant is
 *  asserted against the real tuning, not a convenient one. */
const FENRIR = { speed: 24, requestedMax: 12.0, windup: 0.55, meleeRange: 14.0, hitRange: 2.2, stopShort: 0.7 };
/** The cub's (MiniEnemy). */
const CUB = { speed: 20, requestedMax: 5.6, windup: 0.32, meleeRange: 7.0, hitRange: 1.4, stopShort: 0.5 };

describe('melee lunge reach', () => {
    it('never asks for a leap longer than the wind-up can travel', () => {
        // 24 u/s × 0.55 s = 13.2, so the fenrir's requested 12.0 stands.
        expect(resolveLungeReach(24, 12.0, 0.55, 14.0, 2.2).maxDistance).toBeCloseTo(12.0, 6);
        // 20 u/s × 0.32 s = 6.4, so the cub's requested 5.6 stands.
        expect(resolveLungeReach(20, 5.6, 0.32, 7.0, 1.4).maxDistance).toBeCloseTo(5.6, 6);
        // An over-ambitious request is cut to what the wind-up covers, not honoured.
        expect(resolveLungeReach(11, 9, 0.34, 20, 2.2).maxDistance).toBeCloseTo(3.74, 6);
    });

    it.each([
        ['fenrir', FENRIR],
        ['cub', CUB],
    ])('%s: the shipped tuning is not silently clamped', (_name, cfg) => {
        // Both classes authored a leap the wind-up CAN cover and a trigger range
        // inside what the leap can close. If a retune breaks either, the clamp
        // quietly shortens the pounce instead of failing — so assert it doesn't.
        const reach = resolveLungeReach(
            cfg.speed, cfg.requestedMax, cfg.windup, cfg.meleeRange, cfg.hitRange,
        );
        expect(reach.maxDistance).toBeCloseTo(cfg.requestedMax, 6);
        expect(reach.triggerRange).toBeCloseTo(cfg.meleeRange, 6);
    });

    it.each([
        ['fenrir', FENRIR],
        ['cub', CUB],
    ])('%s: a committed pounce always lands inside hit range', (_name, cfg) => {
        const { maxDistance, triggerRange } = resolveLungeReach(
            cfg.speed, cfg.requestedMax, cfg.windup, cfg.meleeRange, cfg.hitRange,
        );
        // This is the whole point of deriving triggerRange: sweep every distance
        // the swing can start from and check the leap actually gets there.
        for (let d = 0; d <= triggerRange + 1e-9; d += 0.01) {
            const gap = postLungeGap(d, maxDistance, cfg.stopShort);
            expect(gap).toBeLessThanOrEqual(cfg.hitRange + 1e-9);
        }
    });

    it('caps the trigger range when the authored melee range out-reaches the leap', () => {
        // Ask to swing from 10 units with a 3-unit leap and a 2-unit hit range:
        // the trigger has to come down to 5, or the pounce lands 5 units short.
        const reach = resolveLungeReach(20, 3, 1, 10, 2);
        expect(reach.maxDistance).toBeCloseTo(3, 6);
        expect(reach.triggerRange).toBeCloseTo(5, 6);
        expect(postLungeGap(reach.triggerRange, reach.maxDistance, 0.5)).toBeLessThanOrEqual(2);
    });

    it('leaves a shorter authored melee range alone', () => {
        // A leap that over-reaches must not silently WIDEN the swing trigger.
        expect(resolveLungeReach(20, 8, 1, 3, 2).triggerRange).toBeCloseTo(3, 6);
    });

    it('does not leap when already on top of the target', () => {
        expect(lungeTravel(0.4, 3, 0.7)).toBe(0);
        expect(lungeTravel(0.7, 3, 0.7)).toBe(0);
        // Just outside stopShort it starts to creep forward rather than jumping.
        expect(lungeTravel(0.9, 3, 0.7)).toBeCloseTo(0.2, 6);
    });

    it('stops short of the committed point rather than through it', () => {
        // Well inside the cap, the leap leaves exactly stopShort of clearance.
        expect(postLungeGap(2.0, 3, 0.7)).toBeCloseTo(0.7, 6);
    });

    it('never travels further than the cap however far away the target is', () => {
        for (const d of [3, 6, 40, 1000]) {
            expect(lungeTravel(d, 3, 0.7)).toBeLessThanOrEqual(3);
        }
    });

    it('is inert for the enemies that do not lunge', () => {
        // Speed 0 → zero leap length, and the authored melee range is untouched.
        const reach = resolveLungeReach(0, 0, 0.3, 1.3, 1.6);
        expect(reach.maxDistance).toBe(0);
        expect(reach.triggerRange).toBeCloseTo(1.3, 6);
    });
});
