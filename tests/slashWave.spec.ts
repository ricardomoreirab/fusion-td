import { describe, expect, it } from 'vitest';
import {
    SLASH_WAVE_BACK_GRACE,
    SLASH_WAVE_BODY_RADIUS,
    SLASH_WAVE_HALF_WIDTH,
    SLASH_WAVE_MIN_AIM_DIST,
    SLASH_WAVE_SPEED,
    isInSlashBand,
} from '../src/survivors/champions/HeroBasicAttack';

const W = SLASH_WAVE_HALF_WIDTH;
const R = SLASH_WAVE_BODY_RADIUS;

describe('isInSlashBand', () => {
    it('hits enemies inside the band the crest crossed this step', () => {
        // Wave travelling +X, crest moved from 2 to 4.
        expect(isInSlashBand(3, 0, 1, 0, 2, 4, W)).toBe(true);
        expect(isInSlashBand(3, W - 0.01, 1, 0, 2, 4, W)).toBe(true);
        expect(isInSlashBand(3, -(W - 0.01), 1, 0, 2, 4, W)).toBe(true);
    });

    it('misses enemies the crest has not reached or already swept past', () => {
        // Beyond the crest / behind the band by more than a body radius.
        expect(isInSlashBand(4 + R + 0.01, 0, 1, 0, 2, 4, W)).toBe(false);
        expect(isInSlashBand(2 - R - 0.01, 0, 1, 0, 2, 4, W)).toBe(false);
    });

    it('misses enemies laterally outside the corridor', () => {
        expect(isInSlashBand(3, W + 0.01, 1, 0, 2, 4, W)).toBe(false);
        expect(isInSlashBand(3, -(W + 0.01), 1, 0, 2, 4, W)).toBe(false);
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
        // Far enough behind the start line that not even its body reaches it.
        expect(isInSlashBand(-(SLASH_WAVE_BACK_GRACE + R + 0.01), 0, 1, 0,
            -SLASH_WAVE_BACK_GRACE, 0.3, W)).toBe(false);
    });

    it('tests the enemy as a body, not a point', () => {
        // Explicit radius so the assertion does not merely restate the constant.
        expect(isInSlashBand(4.4, 0, 1, 0, 2, 4, W, 0.5)).toBe(true);
        expect(isInSlashBand(1.6, 0, 1, 0, 2, 4, W, 0.5)).toBe(true);
        expect(isInSlashBand(4.4, 0, 1, 0, 2, 4, W, 0)).toBe(false);
        expect(isInSlashBand(1.6, 0, 1, 0, 2, 4, W, 0)).toBe(false);
        expect(SLASH_WAVE_BODY_RADIUS).toBeGreaterThan(0);
    });

    it('does not tunnel when the enemy closes on the hero between samples', () => {
        // THE BUG: the crest and the enemy are both sampled once per frame, so
        // an approaching enemy crosses the band backwards while the band crosses
        // it forwards, and the crossing can fall entirely between two samples.
        //
        // Whether it does depends on the sub-frame PHASE at which the enemy
        // enters, which in play is arbitrary — so sweep it. Under point
        // semantics the analytic miss rate is approach / (SLASH_WAVE_SPEED +
        // approach), i.e. a sixth of these phases for a Basic enemy.
        const dt = 1 / 60;
        const step = SLASH_WAVE_SPEED * dt;
        const PHASES = 50;

        for (const approach of [1.5, 3, 6]) {          // Tank, Basic, Fast
            for (let p = 0; p < PHASES; p++) {
                let front = 0;
                // Start clear of the crest, offset by a fraction of one frame.
                let enemyFwd = 2 + (step * p) / PHASES;
                let hit = false;
                for (let f = 0; f < 240 && !hit; f++) {
                    const prev = front;
                    front += step;
                    enemyFwd -= approach * dt;
                    if (isInSlashBand(enemyFwd, 0, 1, 0, prev, front, W)) hit = true;
                }
                expect(hit, `approach ${approach} u/s, phase ${p} must not tunnel`).toBe(true);
            }
        }
    });

    it('ignores for aiming exactly those enemies the sweep hits regardless', () => {
        // The aim cutoff is not a tuned number: it is the distance below which
        // an enemy clears the sweep's trailing edge whatever direction the wave
        // is sent, so aiming at it can only add jitter. Walk a ring of enemies
        // all the way around the hero against a wave pointing along +X.
        const step = SLASH_WAVE_SPEED / 60;
        // Run a whole wave past a stationary enemy at (dx, dz); the guarantee is
        // that SOME step sweeps it, not that the first one does.
        const sweptByWave = (dx: number, dz: number): boolean => {
            let front = -SLASH_WAVE_BACK_GRACE;
            while (front < 4.5) {
                const prev = front;
                front = Math.min(front + step, 4.5);
                if (isInSlashBand(dx, dz, 1, 0, prev, front, W)) return true;
                if (front >= 4.5) break;
            }
            return false;
        };

        const inside = SLASH_WAVE_MIN_AIM_DIST - 0.01;
        for (let i = 0; i < 72; i++) {
            const a = (i / 72) * Math.PI * 2;
            expect(
                sweptByWave(Math.cos(a) * inside, Math.sin(a) * inside),
                `bearing ${Math.round((a * 180) / Math.PI)}° at ${inside} must be swept`,
            ).toBe(true);
        }
        // And the guarantee genuinely stops there — directly behind, one hair
        // further out, the wave leaves it alone.
        expect(sweptByWave(-(SLASH_WAVE_MIN_AIM_DIST + 0.01), 0)).toBe(false);
    });

    it('sweeps a stationary enemy on the first band that reaches it', () => {
        // Hit-once is the caller's Set, so overlapping consecutive bands is
        // expected — what matters is that the FIRST band to reach the body hits.
        const dt = 1 / 60;
        const step = SLASH_WAVE_SPEED * dt;
        const target = 3;
        let front = -SLASH_WAVE_BACK_GRACE;
        let firstHitFront = Infinity;
        while (front < 5) {
            const prev = front;
            front += step;
            if (isInSlashBand(target, 0, 1, 0, prev, front, W)) {
                firstHitFront = Math.min(firstHitFront, front);
            }
        }
        // The crest reaches the body's near edge at target - R.
        expect(firstHitFront).toBeGreaterThanOrEqual(target - R);
        expect(firstHitFront).toBeLessThanOrEqual(target - R + step);
    });
});
