/**
 * The last stand — what happens after the final boss dies.
 *
 * The authored ladder ends at wave 30 with the Elemental Lord. Killing it does
 * NOT clear the wave and hand out a shop: it opens the terminal phase, an endless
 * assault by the whole roster that grows in count and in strength until it kills
 * the player. There is no wave 31, and the run can only end in death.
 *
 * Pure — no Three, no Enemy, no WaveManager — so `tests/lastStand.spec.ts` can pin
 * the properties the phase depends on rather than leaving them to eyeball tuning.
 *
 * ── Escalation rides the EXISTING curve, it does not add a second one ─────────
 * `DifficultyCurve` is the only per-wave ramp in the game (see CLAUDE.md), and it
 * already extrapolates past its last anchor at the final segment's growth rate.
 * So the last stand does not introduce new scalars: it feeds the curve a VIRTUAL
 * wave that advances with time instead of with wave clears. Every existing
 * consumer — enemy HP/reward scaling, global damage, spawn cadence and count,
 * boss stats — keeps working untouched, and the economy invariant (wave income
 * ∝ pace × reward, which the level/ascension ladder is calibrated against)
 * survives automatically because `reward` climbs with the same virtual wave.
 *
 * The virtual wave is deliberately NOT the displayed wave. The HUD shows "LAST
 * STAND" and `redSwapType` / the milestone-boss tier keep reading the real wave
 * 30, so the roster stays at its wave-25 forms and last-stand bosses stay
 * Elemental Lords. Only difficulty advances.
 */

import { MAX_AUTHORED_TIER } from './enemies/bossTiers';

/**
 * The last wave with authored content, DERIVED from the boss ladder rather than
 * written down: bosses spawn every 5th wave as tiers 1..N, so the final boss's
 * wave is the last authored tier × 5. Adding a boss tier moves the last stand
 * automatically instead of leaving it stranded five waves early.
 */
export const FINAL_WAVE = MAX_AUTHORED_TIER * 5;

/**
 * Seconds of survival per virtual wave of escalation.
 *
 * At the curve's post-anchor growth rate (~16%/wave HP) this doubles enemy
 * health roughly every 3.5 minutes, which is the shape the phase needs: the
 * player's power is nearly flat by now (level 100 is reached at wave 13, and
 * ascension caps at A50), so the assault has to out-scale a fixed ceiling. Slower
 * than this and the phase stops being terminal; faster and it is over before the
 * player has seen the roster.
 */
export const ESCALATION_PERIOD_S = 45;

/**
 * Escalation is quantised to this fraction of a wave.
 *
 * `difficultyAt` memoises on the exact wave value, and the scalars are read once
 * per frame (spawn cadence) plus once per spawn. A continuously-varying virtual
 * wave would miss that memo on every single call and rebuild the scalar object
 * each time; at 0.1 the value changes every ~4.5 s, so the memo hits essentially
 * always and the ramp is still far smoother than the per-wave steps the curve was
 * designed around.
 */
const ESCALATION_STEP = 0.1;

/**
 * Hard ceiling on concurrent live enemies during the last stand.
 *
 * This is not a difficulty knob, it is the load-bearing one. Concurrent
 * population ≈ spawn cadence × time-to-kill, and the escalation raises
 * time-to-kill without bound, so an uncapped stream would grow the horde forever
 * — and horde scale in this game is a CPU traversal cost (CLAUDE.md), so the
 * phase would end in a slideshow rather than in a death. With the cap, escalation
 * past the point of saturation expresses itself as enemies that are HARDER rather
 * than as enemies that are more numerous.
 *
 * Sized to the horde the renderer is known to hold up under — the perf work in
 * CLAUDE.md is all measured at 250-270 enemies.
 */
export const MAX_ALIVE = 260;

/**
 * How many virtual waves of escalation `elapsedS` seconds of last stand is worth.
 * Monotonic, starts at 0, and quantised — see ESCALATION_STEP.
 */
export function escalationAt(elapsedS: number): number {
    if (!Number.isFinite(elapsedS) || elapsedS <= 0) return 0;
    const raw = elapsedS / ESCALATION_PERIOD_S;
    return Math.round(raw / ESCALATION_STEP) * ESCALATION_STEP;
}

/**
 * The wave number the DIFFICULTY CURVE should be read at, `elapsedS` into the
 * last stand. Never below FINAL_WAVE: the phase can only get harder than the
 * fight that opened it.
 */
export function difficultyWaveAt(elapsedS: number): number {
    return FINAL_WAVE + escalationAt(elapsedS);
}

/** One entry in an assault batch. Same shape the wave tables use. */
export interface AssaultEntry {
    type: string;
    count: number;
    /** Seconds between spawns, before the curve's `pace` divides it. */
    delay: number;
}

/**
 * Composition of assault batch `index` (0-based, refilled back to back).
 *
 * Counts here are the BASE: the caller multiplies them by the curve's `pace`
 * exactly as `startNextWave` does for an ordinary wave, so "progressively more"
 * comes from the same scalar that drives cadence and gold. Nothing here grows
 * with `index` for that reason — a second growth term on top of the curve is how
 * the economy invariant gets silently broken.
 *
 * Every archetype is present in every batch, which is the phase's whole premise:
 * there is no longer a wave theme to read and prepare for, everything comes at
 * once. `basic`/`fast`/`tank`/`healer` are the BASE type strings on purpose —
 * `redSwapType` upgrades them to their wave-25 forms (red minion, fire beetle,
 * fortress titan, molten fiend) from the real wave number, so the last stand
 * automatically fields the strongest version of each without naming any of them.
 */
export function lastStandBatch(index: number): AssaultEntry[] {
    const batch: AssaultEntry[] = [
        { type: 'basic', count: 10, delay: 0.35 },
        { type: 'fast', count: 7, delay: 0.45 },
        { type: 'tank', count: 3, delay: 1.2 },
        { type: 'healer', count: 3, delay: 1.0 },
        { type: 'splitting', count: 2, delay: 1.4 },
        { type: 'shield', count: 2, delay: 1.4 },
    ];
    // A boss joins every BOSS_EVERY batches — the escalation's exclamation mark,
    // and the reason the phase keeps feeling like it is building rather than
    // merely getting numerically worse. Not in the first batch: the Elemental
    // Lord whose death opened the phase is often still being cleaned up around.
    if (index > 0 && index % BOSS_EVERY === 0) {
        batch.push({ type: 'boss', count: 1, delay: 6.0 });
    }
    return batch;
}

/** Batches between last-stand boss appearances. */
export const BOSS_EVERY = 3;

/** True when this batch index carries a boss. Exported so the caller can raise a
 *  callout without re-deriving the rule. */
export function batchHasBoss(index: number): boolean {
    return index > 0 && index % BOSS_EVERY === 0;
}
