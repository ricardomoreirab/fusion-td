import { describe, it, expect } from 'vitest';
import { difficultyAt, bossDifficultyAt, DIFFICULTY_ANCHORS } from '../src/survivors/DifficultyCurve';

/** The ramps this curve replaced, kept here as the reference the shape is judged
 *  against: WaveManager's count/cadence ramp × EnemyManager's HP/reward ramp. */
const legacyPace = (n: number) => 1 + 0.08 * (n - 1);
const legacyHpOrReward = (n: number) => 1 + 0.06 * (n - 1);
/** Aggregate pressure ≈ spawn cadence × enemy HP × enemy damage. */
const legacyPressure = (n: number) => legacyPace(n) * legacyHpOrReward(n);
const pressure = (n: number) => {
    const d = difficultyAt(n);
    return d.pace * d.hp * d.damage;
};

describe('DifficultyCurve', () => {
    it('reproduces its anchors exactly', () => {
        for (const a of DIFFICULTY_ANCHORS) {
            const d = difficultyAt(a.wave);
            expect(d.hp).toBeCloseTo(a.hp, 6);
            expect(d.damage).toBeCloseTo(a.damage, 6);
            expect(d.pace).toBeCloseTo(a.pace, 6);
            expect(d.reward).toBeCloseTo(a.reward, 6);
        }
    });

    it('clamps waves below 1 and non-finite input to the first anchor', () => {
        for (const w of [1, 0, -5, NaN, Infinity]) {
            expect(difficultyAt(w).hp).toBeCloseTo(DIFFICULTY_ANCHORS[0].hp, 6);
        }
    });

    it('rises monotonically on every axis', () => {
        for (let n = 1; n < 60; n++) {
            const a = difficultyAt(n);
            const b = difficultyAt(n + 1);
            expect(b.hp).toBeGreaterThan(a.hp);
            expect(b.damage).toBeGreaterThan(a.damage);
            expect(b.pace).toBeGreaterThan(a.pace);
            expect(b.reward).toBeGreaterThan(a.reward);
        }
    });

    // The whole point of the rebalance: waves 1-5 are the on-ramp.
    it('makes the opening waves far easier than the legacy ramp', () => {
        expect(pressure(1) / legacyPressure(1)).toBeLessThan(0.35);
        expect(pressure(3) / legacyPressure(3)).toBeLessThan(0.35);
        expect(pressure(5) / legacyPressure(5)).toBeLessThan(0.45);
    });

    it('makes wave 25 several times harder than the legacy ramp', () => {
        expect(pressure(25) / legacyPressure(25)).toBeGreaterThan(3);
    });

    it('crosses the legacy curve in the mid-game, not at wave 5', () => {
        // Below the legacy line through the whole first third of a run...
        for (let n = 1; n <= 12; n++) {
            expect(pressure(n)).toBeLessThan(legacyPressure(n));
        }
        // ...and above it from the mid-game on.
        for (let n = 18; n <= 30; n++) {
            expect(pressure(n)).toBeGreaterThan(legacyPressure(n));
        }
    });

    // "Gradual after wave 5" — the difficulty must ACCELERATE without ever
    // stepping. A cliff at the easy/hard boundary is the failure mode here.
    it('never steps: no wave is a large jump over its predecessor', () => {
        for (let n = 1; n < 60; n++) {
            const a = difficultyAt(n);
            const b = difficultyAt(n + 1);
            expect(b.hp / a.hp).toBeLessThan(1.2);
            expect(b.damage / a.damage).toBeLessThan(1.1);
            expect(b.pace / a.pace).toBeLessThan(1.1);
        }
        // In particular, the wave-5 boundary is no sharper than its neighbours.
        const step = (n: number) => difficultyAt(n + 1).hp / difficultyAt(n).hp;
        expect(step(5)).toBeLessThan(step(4) * 1.1);
    });

    it('accelerates: later waves grow faster than the opening ones', () => {
        const step = (n: number) => difficultyAt(n + 1).hp / difficultyAt(n).hp;
        expect(step(3)).toBeLessThan(step(12));
        expect(step(12)).toBeLessThan(step(22));
    });

    // Gold is the only XP source and XP pacing is calibrated (level 100 at wave
    // 13, A50 near wave 36). Wave income ∝ enemy count × per-enemy reward
    // ∝ pace × reward, so that product must track the legacy total-gold curve.
    // If this fails after a `pace` retune, retune `reward` to match.
    it('holds wave gold income on the legacy curve', () => {
        for (let n = 1; n <= 30; n++) {
            const d = difficultyAt(n);
            const legacy = legacyPace(n) * legacyHpOrReward(n);
            expect(d.pace * d.reward).toBeGreaterThan(legacy * 0.95);
            expect(d.pace * d.reward).toBeLessThan(legacy * 1.05);
        }
    });

    it('keeps enemy population bounded by ramping HP far harder than pace', () => {
        const d = difficultyAt(25);
        expect(d.hp).toBeGreaterThan(d.pace * 5);
        // Cadence must not outrun the legacy ramp, or horde-scale CPU cost spikes.
        expect(d.pace).toBeLessThan(legacyPace(25));
    });

    it('keeps growing past the last anchor for endless mode', () => {
        const last = DIFFICULTY_ANCHORS[DIFFICULTY_ANCHORS.length - 1];
        expect(difficultyAt(last.wave + 10).hp).toBeGreaterThan(last.hp * 2);
        for (const w of [30, 40, 60, 100]) {
            expect(Number.isFinite(difficultyAt(w).hp)).toBe(true);
        }
    });

    describe('bossDifficultyAt', () => {
        it('discounts the early tiers and climbs late', () => {
            expect(bossDifficultyAt(5).hp).toBeLessThan(1);
            expect(bossDifficultyAt(25).hp).toBeGreaterThan(3);
        });

        it('softens HP relative to the trash curve (bosses ramp by tier too)', () => {
            expect(bossDifficultyAt(25).hp).toBeLessThan(difficultyAt(25).hp);
            expect(bossDifficultyAt(25).damage).toBeCloseTo(difficultyAt(25).damage, 6);
        });

        it('rises monotonically across boss tiers', () => {
            for (let tier = 1; tier < 10; tier++) {
                expect(bossDifficultyAt((tier + 1) * 5).hp)
                    .toBeGreaterThan(bossDifficultyAt(tier * 5).hp);
            }
        });
    });
});
