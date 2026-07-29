import { describe, it, expect } from 'vitest';
import {
    APEX_TIER, GUARDIAN_TIER, LORD_TIER, MAX_AUTHORED_TIER,
    APEX_CAPABILITIES, EXCLUSIVE_CAPABILITIES, LORD_CAPABILITIES, BOSS_CAPABILITIES,
    FRENZY_SPEED_FACTOR,
    hasClone, hasSidestepPredict, hasLeapDash, hasRunningPull, hasFrenziedEnrage,
    hasVerdantNova, hasElementalNova, hasElementalBarrage,
} from '../src/survivors/enemies/bossTiers';

/** Milestone bosses spawn at waves 5/10/15/20/25/30 as tiers 1..6. */
const SHIPPED_TIERS = [1, 2, 3, 4, 5, 6];
/** Tiers a wave-35+ run can construct, past everything hand-authored. */
const PAST_THE_LADDER = [7, 9, 20];
const ALL_TIERS = [...SHIPPED_TIERS, ...PAST_THE_LADDER];

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
        // Each later boss is Apex PLUS its own move, never Apex minus anything
        // Apex actually has.
        for (const cap of APEX_CAPABILITIES) {
            for (const tier of ALL_TIERS.filter(t => t > APEX_TIER)) {
                expect(cap.has(tier), `tier ${tier} is missing ${cap.name}`).toBe(true);
            }
        }
    });

    it('confines every exclusive capability to its owner tier', () => {
        // The deliberate exceptions to "Apex is all of the above". If any of
        // these ever reads true elsewhere, a fight has silently changed shape:
        // the twin would make a late wave a pair fight again, and the verdant
        // nova would give the Lord two AoE pulses on one body.
        for (const cap of EXCLUSIVE_CAPABILITIES) {
            expect(cap.has(cap.owner), `tier ${cap.owner} is missing ${cap.name}`).toBe(true);
            for (const tier of ALL_TIERS.filter(t => t !== cap.owner)) {
                expect(cap.has(tier), `tier ${tier} must not have ${cap.name}`).toBe(false);
            }
        }
    });

    it('starts the Lord capabilities at the Lord and keeps them past it', () => {
        // Tiers past the ladder ARE the Lord with a bigger stat block, so losing
        // a capability there would quietly strip the endgame boss of its kit.
        for (const cap of LORD_CAPABILITIES) {
            for (const tier of ALL_TIERS) {
                expect(cap.has(tier), `${cap.name} at tier ${tier}`).toBe(tier >= LORD_TIER);
            }
        }
    });

    it('splits every capability into exactly one of the three lists', () => {
        // BOSS_CAPABILITIES is what the totality check walks; a predicate added to
        // none of the lists would be invisible to every assertion in this file.
        const listed = [...APEX_CAPABILITIES, ...EXCLUSIVE_CAPABILITIES, ...LORD_CAPABILITIES];
        expect(BOSS_CAPABILITIES.map(c => c.name).sort()).toEqual(listed.map(c => c.name).sort());
        expect(new Set(listed.map(c => c.name)).size).toBe(listed.length);
    });

    it('gives each tier its own signature, not the others', () => {
        // Ravager leaps, Warden pulls on the move, Gemini frenzies, the Guardian
        // pulses, the Lord barrages. If these overlapped, the bosses would stop
        // feeling different.
        const signature = (tier: number) => [
            hasLeapDash(tier), hasRunningPull(tier), hasFrenziedEnrage(tier),
            hasVerdantNova(tier), hasElementalBarrage(tier),
        ];
        expect(signature(1)).toEqual([true, false, false, false, false]);
        expect(signature(2)).toEqual([false, true, false, false, false]);
        expect(signature(3)).toEqual([false, false, true, false, false]);
        expect(signature(GUARDIAN_TIER)).toEqual([true, true, false, true, false]);
        expect(signature(LORD_TIER)).toEqual([true, true, false, false, true]);
    });

    it('never gives one boss two novas', () => {
        // The two pulses are the same move in different colours; a body running
        // both would pulse twice as often for no added read.
        for (const tier of ALL_TIERS) {
            expect(hasVerdantNova(tier) && hasElementalNova(tier), `tier ${tier} has both novas`)
                .toBe(false);
        }
    });

    it('keeps the pre-existing tier gates where they were', () => {
        expect(SHIPPED_TIERS.map(hasSidestepPredict)).toEqual([false, true, true, true, true, true]);
        expect(SHIPPED_TIERS.map(hasClone)).toEqual([false, false, true, false, false, false]);
    });

    it('only frenzies tiers that can actually enrage from a twin', () => {
        // The frenzy rides on the twin-death enrage, so a tier that never spawns
        // a twin could never reach it — a frenzy flag there would be dead code.
        for (const tier of ALL_TIERS) {
            if (hasFrenziedEnrage(tier)) expect(hasClone(tier)).toBe(true);
        }
    });

    it('frenzy is a speed-UP, never a nerf', () => {
        expect(FRENZY_SPEED_FACTOR).toBeGreaterThan(1);
    });

    it('is total over every tier a boss can spawn at', () => {
        // bossDifficultyAt clamps asset tiers but not the wave tier itself, so a
        // wave-35+ run can construct a tier past the ladder. Nothing may go undefined.
        for (const cap of BOSS_CAPABILITIES) {
            for (const tier of ALL_TIERS) {
                expect(typeof cap.has(tier)).toBe('boolean');
            }
        }
    });

    it('keeps MAX_AUTHORED_TIER on the last tier that has an identity', () => {
        // The clamp every model/label/behaviour lookup runs through. If a tier
        // gains an identity without this moving, its GLB and name silently
        // resolve to the tier below.
        expect(MAX_AUTHORED_TIER).toBe(LORD_TIER);
        expect(LORD_TIER).toBeGreaterThan(GUARDIAN_TIER);
        expect(GUARDIAN_TIER).toBeGreaterThan(APEX_TIER);
    });
});
