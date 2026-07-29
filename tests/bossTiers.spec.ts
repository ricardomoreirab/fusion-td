import { describe, it, expect } from 'vitest';
import {
    APEX_TIER, APEX_CAPABILITIES, GEMINI_ONLY_CAPABILITIES, BOSS_CAPABILITIES,
    FRENZY_SPEED_FACTOR,
    hasClone, hasSidestepPredict, hasLeapDash, hasRunningPull, hasFrenziedEnrage,
} from '../src/survivors/enemies/bossTiers';

/** Milestone bosses spawn at waves 5/10/15/20/25 as tiers 1..5. */
const SHIPPED_TIERS = [1, 2, 3, 4, 5];

describe('milestone-boss tier capabilities', () => {
    it('gives Apex every INHERITED capability — that IS the tier', () => {
        // The property the roster is designed around, and the one most likely to
        // rot: each capability is authored as "tier N, or Apex and up", so adding
        // one and forgetting the Apex clause silently downgrades the hardest boss.
        for (const cap of APEX_CAPABILITIES) {
            expect(cap.has(APEX_TIER), `Apex is missing ${cap.name}`).toBe(true);
        }
    });

    it('carries every inherited capability past Apex too', () => {
        // Tier 5 (Elemental Lord) is Apex plus a nova, never Apex minus anything
        // Apex actually has.
        for (const cap of APEX_CAPABILITIES) {
            expect(cap.has(5), `tier 5 is missing ${cap.name}`).toBe(true);
        }
    });

    it('keeps the twin exclusive to Gemini', () => {
        // The deliberate exception to "Apex is all of the above": two of the
        // hardest boss at once is a different encounter, so Apex and the
        // Elemental Lord are each ONE larger body. If this ever reads true at
        // tier 4+, wave 20/25 has silently gone back to being a pair fight.
        for (const cap of GEMINI_ONLY_CAPABILITIES) {
            expect(cap.has(3), `Gemini is missing ${cap.name}`).toBe(true);
            for (const tier of [1, 2, 4, 5, 6, 9]) {
                expect(cap.has(tier), `tier ${tier} must not have ${cap.name}`).toBe(false);
            }
        }
    });

    it('splits every capability into exactly one of the two lists', () => {
        // BOSS_CAPABILITIES is what the totality check walks; a predicate added to
        // neither list would be invisible to every assertion in this file.
        expect(BOSS_CAPABILITIES.map(c => c.name).sort()).toEqual(
            [...APEX_CAPABILITIES, ...GEMINI_ONLY_CAPABILITIES].map(c => c.name).sort(),
        );
        const apex = new Set(APEX_CAPABILITIES.map(c => c.name));
        for (const cap of GEMINI_ONLY_CAPABILITIES) {
            expect(apex.has(cap.name), `${cap.name} is in both lists`).toBe(false);
        }
    });

    it('gives each early tier its own signature, not the others', () => {
        // Ravager leaps, Warden pulls on the move, Gemini frenzies. If these
        // overlapped, the first three bosses would stop feeling different.
        expect([hasLeapDash(1), hasRunningPull(1), hasFrenziedEnrage(1)]).toEqual([true, false, false]);
        expect([hasLeapDash(2), hasRunningPull(2), hasFrenziedEnrage(2)]).toEqual([false, true, false]);
        expect([hasLeapDash(3), hasRunningPull(3), hasFrenziedEnrage(3)]).toEqual([false, false, true]);
    });

    it('keeps the pre-existing tier gates where they were', () => {
        expect(SHIPPED_TIERS.map(hasSidestepPredict)).toEqual([false, true, true, true, true]);
        expect(SHIPPED_TIERS.map(hasClone)).toEqual([false, false, true, false, false]);
    });

    it('only frenzies tiers that can actually enrage from a twin', () => {
        // The frenzy rides on the twin-death enrage, so a tier that never spawns
        // a twin could never reach it — a frenzy flag there would be dead code.
        for (const tier of [...SHIPPED_TIERS, 6, 9, 20]) {
            if (hasFrenziedEnrage(tier)) expect(hasClone(tier)).toBe(true);
        }
    });

    it('frenzy is a speed-UP, never a nerf', () => {
        expect(FRENZY_SPEED_FACTOR).toBeGreaterThan(1);
    });

    it('is total over every tier a boss can spawn at', () => {
        // bossDifficultyAt clamps asset tiers but not the wave tier itself, so a
        // wave-30+ run can construct a tier past 5. Nothing may go undefined.
        for (const cap of BOSS_CAPABILITIES) {
            for (const tier of [...SHIPPED_TIERS, 6, 9, 20]) {
                expect(typeof cap.has(tier)).toBe('boolean');
            }
        }
    });
});
