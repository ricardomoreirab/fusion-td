import { describe, it, expect } from 'vitest';
import {
    FINAL_WAVE, MAX_ALIVE, BOSS_EVERY, ESCALATION_PERIOD_S,
    escalationAt, difficultyWaveAt, lastStandBatch, batchHasBoss,
} from '../src/survivors/LastStand';
import { MAX_AUTHORED_TIER } from '../src/survivors/enemies/bossTiers';
import { difficultyAt } from '../src/survivors/DifficultyCurve';
import { redSwapType } from '../src/survivors/enemies/redSwap';

describe('last stand — where it starts', () => {
    it('lands on the final boss\'s wave, derived from the ladder', () => {
        // Written down anywhere else, this strands the phase five waves early the
        // first time a boss tier is added.
        expect(FINAL_WAVE).toBe(MAX_AUTHORED_TIER * 5);
        expect(FINAL_WAVE).toBe(30);
    });
});

describe('last stand — escalation', () => {
    it('starts at zero and is monotonic in time', () => {
        expect(escalationAt(0)).toBe(0);
        expect(escalationAt(-5)).toBe(0);
        expect(escalationAt(NaN)).toBe(0);
        let prev = -1;
        for (let t = 0; t <= 3600; t += 7) {
            const e = escalationAt(t);
            expect(e).toBeGreaterThanOrEqual(prev);
            prev = e;
        }
    });

    it('advances about one virtual wave per escalation period', () => {
        expect(escalationAt(ESCALATION_PERIOD_S)).toBeCloseTo(1, 5);
        expect(escalationAt(ESCALATION_PERIOD_S * 10)).toBeCloseTo(10, 5);
    });

    it('quantises, so difficultyAt\'s memo is not missed on every call', () => {
        // The scalars are read once per frame plus once per spawn. A continuously
        // varying wave would rebuild the scalar object every single call.
        const a = escalationAt(100.0);
        const b = escalationAt(100.4);
        expect(a).toBe(b);
        // …but the step is fine enough to still be a ramp rather than whole waves.
        expect(escalationAt(ESCALATION_PERIOD_S * 0.5)).toBeGreaterThan(0);
        expect(escalationAt(ESCALATION_PERIOD_S * 0.5)).toBeLessThan(1);
    });

    it('never reads below the wave the phase opened on', () => {
        for (const t of [0, 1, 10, 600]) {
            expect(difficultyWaveAt(t)).toBeGreaterThanOrEqual(FINAL_WAVE);
        }
        expect(difficultyWaveAt(0)).toBe(FINAL_WAVE);
    });

    it('actually makes the assault harder over time, through the existing curve', () => {
        // The phase adds no scalars of its own — it advances the wave the curve is
        // read at. If that stopped translating into pressure, the "terminal" phase
        // would be survivable forever.
        const open = difficultyAt(difficultyWaveAt(0));
        const later = difficultyAt(difficultyWaveAt(600));
        expect(later.hp).toBeGreaterThan(open.hp * 2);
        expect(later.damage).toBeGreaterThan(open.damage);
        expect(later.pace).toBeGreaterThan(open.pace);
    });

    it('keeps HP climbing faster than spawn pace', () => {
        // The curve's shape invariant (CLAUDE.md): pace lags hp, because
        // population ≈ cadence × time-to-kill and horde scale is a CPU cost. If
        // the phase inverted that it would buy lost frames instead of difficulty.
        const a = difficultyAt(difficultyWaveAt(0));
        const b = difficultyAt(difficultyWaveAt(1200));
        expect(b.hp / a.hp).toBeGreaterThan(b.pace / a.pace);
    });

    it('keeps the economy on its line as the phase drags on', () => {
        // Gold is the only XP source and the level/ascension ladder is calibrated
        // against wave income ∝ pace × reward. A phase where reward stopped
        // climbing would quietly freeze progression the moment it began.
        const a = difficultyAt(difficultyWaveAt(0));
        const b = difficultyAt(difficultyWaveAt(900));
        expect(b.reward).toBeGreaterThan(a.reward);
    });
});

describe('last stand — assault composition', () => {
    it('fields every archetype in every batch', () => {
        // The premise of the phase: no wave theme left to read and prepare for.
        for (const index of [0, 1, 2, 3, 7, 50]) {
            const types = lastStandBatch(index).map(e => e.type);
            for (const archetype of ['basic', 'fast', 'tank', 'healer', 'splitting', 'shield']) {
                expect(types, `batch ${index} is missing ${archetype}`).toContain(archetype);
            }
        }
    });

    it('queues BASE type strings so the roster swap upgrades them', () => {
        // Naming the wave-25 forms directly here would silently pin the phase to
        // whatever the roster looked like the day it was written. Going in as base
        // types means redSwapType resolves the strongest form that exists.
        const types = lastStandBatch(0).map(e => e.type);
        expect(types).toContain('tank');
        expect(types).not.toContain('fortress_titan');
        expect(types).not.toContain('molten_fiend');
        // …and at the terminal wave those base types DO resolve to the newest tier.
        expect(redSwapType('tank', FINAL_WAVE)).toBe('fortress_titan');
        expect(redSwapType('healer', FINAL_WAVE)).toBe('molten_fiend');
    });

    it('brings a boss on a fixed cadence, but never in the opening batch', () => {
        // The Elemental Lord whose death opened the phase is usually still being
        // cleaned up around when batch 0 queues.
        expect(batchHasBoss(0)).toBe(false);
        expect(lastStandBatch(0).some(e => e.type === 'boss')).toBe(false);
        expect(batchHasBoss(BOSS_EVERY)).toBe(true);
        expect(lastStandBatch(BOSS_EVERY).some(e => e.type === 'boss')).toBe(true);
        // Cadence holds indefinitely.
        for (let i = 0; i < 40; i++) {
            expect(batchHasBoss(i)).toBe(i > 0 && i % BOSS_EVERY === 0);
        }
    });

    it('agrees with itself about which batches carry a boss', () => {
        // batchHasBoss is what the caller raises a callout from; a disagreement
        // would announce a boss that never spawns (or vice versa).
        for (let i = 0; i < 30; i++) {
            expect(lastStandBatch(i).some(e => e.type === 'boss')).toBe(batchHasBoss(i));
        }
    });

    it('never grows the batch itself — growth belongs to the curve', () => {
        // A second growth term on top of `pace` is how the economy invariant gets
        // broken: income is ∝ pace × reward, and counts that grew independently
        // would drift the whole XP ladder.
        const first = lastStandBatch(1).filter(e => e.type !== 'boss');
        const later = lastStandBatch(100).filter(e => e.type !== 'boss');
        expect(later.map(e => e.count)).toEqual(first.map(e => e.count));
        expect(later.map(e => e.delay)).toEqual(first.map(e => e.delay));
    });

    it('spawns something on every entry, at a finite cadence', () => {
        for (const entry of lastStandBatch(BOSS_EVERY)) {
            expect(entry.count, entry.type).toBeGreaterThan(0);
            expect(entry.delay, entry.type).toBeGreaterThan(0);
            expect(Number.isFinite(entry.delay), entry.type).toBe(true);
        }
    });
});

describe('last stand — population ceiling', () => {
    it('caps concurrent enemies inside the measured horde budget', () => {
        // Not a difficulty knob: escalation raises time-to-kill without bound, so
        // an uncapped stream ends the phase in a slideshow rather than a death.
        // The perf work in CLAUDE.md is all measured at 250-270 enemies.
        expect(MAX_ALIVE).toBeGreaterThan(100);
        expect(MAX_ALIVE).toBeLessThanOrEqual(300);
    });
});
