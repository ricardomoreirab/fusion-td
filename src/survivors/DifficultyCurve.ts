/**
 * Wave-indexed difficulty curve — the single source of truth for how survivors
 * mode gets harder over a run. Pure logic, no Three/DOM. Covered by
 * tests/DifficultyCurve.spec.ts.
 *
 * `DifficultyTuning` holds the wave-INDEPENDENT base constants; this module
 * emits the per-wave scalars those bases are multiplied by. A scalar of 1.0
 * means "the DifficultyTuning base, unmodified" — which lands around wave 9-12
 * depending on the axis.
 *
 * It replaces three ramps that used to live apart and could not be reasoned
 * about together:
 *   - `WaveManager`'s `1 + 0.08 × (wave − 1)` (applied to BOTH spawn cadence and
 *     enemy count, computed independently in two places),
 *   - `EnemyManager.WAVE_HP_SCALE_PER_WAVE` = 0.06 (applied to enemy HP *and*
 *     to gold reward, so the two could never be tuned apart).
 *
 * ── Shape ────────────────────────────────────────────────────────────────────
 * Player power is front-loaded: the XP curve caps the hero at level 100 by wave
 * 13, after which growth flattens into ascension. A flat-rate enemy ramp
 * therefore loses the race early (waves 1-5 are the hardest part of a run) and
 * wins it never (wave 25 is a victory lap). This curve inverts that:
 *   - waves 1-5 sit at ~27-35% of the legacy pressure — the on-ramp, where the
 *     hero has no levels, no powers and no items;
 *   - growth accelerates from ~9%/wave to ~16%/wave, crossing the legacy curve
 *     at wave 15 and reaching ~4× it by wave 25.
 * The acceleration is gradual by construction: values interpolate geometrically
 * between anchors, so there is no step at any wave (asserted in the spec).
 *
 * ── Why HP carries the ramp and `pace` does not ──────────────────────────────
 * Concurrent enemy population ≈ spawn cadence × time-to-kill. Raising cadence
 * and HP together makes the population explode, and horde scale is a CPU
 * traversal cost (see CLAUDE.md) — a wave-25 spike would cost frames, not
 * difficulty. So `pace` decelerates (4.9%/wave → 2.4%/wave) while `hp` climbs;
 * later waves are fewer, much tankier enemies rather than an unrenderable mob.
 *
 * ── The economy invariant ────────────────────────────────────────────────────
 * Gold is the only XP source, and XP pacing is calibrated (level 100 at wave 13,
 * A50 around wave 36). Total gold in a wave ∝ enemy count × per-enemy reward
 * ∝ `pace × reward`, so the `reward` column is authored to hold that product on
 * the legacy total-gold curve `(1 + 0.08(N−1)) × (1 + 0.06(N−1))`. Fewer enemies
 * each drop more; wave income — and therefore the whole level/ascension ladder —
 * is unchanged. `tests/DifficultyCurve.spec.ts` asserts this; if you retune
 * `pace`, retune `reward` to match or XP pacing silently drifts.
 */

export interface DifficultyScalars {
    /** Multiplier on `DifficultyTuning.enemyHpMult` (and thus on elite HP too). */
    readonly hp: number;
    /** Multiplier on `DifficultyTuning.enemyDamageMult`. */
    readonly damage: number;
    /** Multiplier on BOTH `spawnRateMult` and `enemyCountMult`. Shared so wave
     *  duration stays roughly wave-invariant — cadence and population move together. */
    readonly pace: number;
    /** Multiplier on per-enemy gold reward. Counter-weights `pace`; see header. */
    readonly reward: number;
}

interface Anchor extends DifficultyScalars {
    readonly wave: number;
}

/**
 * Tuning table. Values are multipliers on the `DifficultyTuning` bases.
 * Waves between anchors interpolate geometrically; waves past the last anchor
 * keep compounding at the final segment's per-wave growth rate (endless mode is
 * meant to end — around wave 35-45 at present rates).
 */
const ANCHORS: readonly Anchor[] = [
    { wave:  1, hp:  0.60, damage: 0.72, pace: 0.62, reward: 1.61 },
    { wave:  5, hp:  0.85, damage: 0.90, pace: 0.75, reward: 2.18 },
    { wave: 10, hp:  1.58, damage: 1.12, pace: 0.90, reward: 2.94 },
    { wave: 15, hp:  2.95, damage: 1.32, pace: 1.05, reward: 3.72 },
    { wave: 20, hp:  5.90, damage: 1.52, pace: 1.20, reward: 4.49 },
    { wave: 25, hp: 12.30, damage: 1.72, pace: 1.35, reward: 5.28 },
];

/**
 * Milestone bosses already carry their own wave ramp (`tierHpMult` grows with
 * `waveTier`) plus a strength multiplier derived from the wave's boss count, so
 * handing them the raw HP curve would ramp them three times over. They take a
 * fractional power of it instead: still discounted through the early tiers,
 * still climbing late, without the compounding blowing past any plausible DPS.
 */
const BOSS_HP_CURVE_EXPONENT = 0.6;

const FIRST = ANCHORS[0];
const LAST = ANCHORS[ANCHORS.length - 1];

/** Geometric interpolation: `a` at t=0, `b` at t=1, constant %-growth between. */
function geomLerp(a: number, b: number, t: number): number {
    return a * Math.pow(b / a, t);
}

function computeScalars(wave: number): DifficultyScalars {
    if (wave <= FIRST.wave) return FIRST;

    if (wave >= LAST.wave) {
        // Extrapolate at the final segment's per-wave growth rate.
        const prev = ANCHORS[ANCHORS.length - 2];
        const span = LAST.wave - prev.wave;
        const t = (wave - LAST.wave) / span;
        return Object.freeze({
            hp: geomLerp(prev.hp, LAST.hp, 1 + t),
            damage: geomLerp(prev.damage, LAST.damage, 1 + t),
            pace: geomLerp(prev.pace, LAST.pace, 1 + t),
            reward: geomLerp(prev.reward, LAST.reward, 1 + t),
        });
    }

    let lo = FIRST;
    let hi = LAST;
    for (let i = 1; i < ANCHORS.length; i++) {
        if (ANCHORS[i].wave >= wave) {
            lo = ANCHORS[i - 1];
            hi = ANCHORS[i];
            break;
        }
    }
    const t = (wave - lo.wave) / (hi.wave - lo.wave);
    return Object.freeze({
        hp: geomLerp(lo.hp, hi.hp, t),
        damage: geomLerp(lo.damage, hi.damage, t),
        pace: geomLerp(lo.pace, hi.pace, t),
        reward: geomLerp(lo.reward, hi.reward, t),
    });
}

let memoWave = -1;
let memoValue: DifficultyScalars = FIRST;

/**
 * Difficulty scalars for `wave` (1-based). Non-finite or sub-1 waves clamp to
 * wave 1 — spawns can be requested before the first wave starts (warmup) and a
 * NaN must never reach a health multiplier.
 */
export function difficultyAt(wave: number): DifficultyScalars {
    const w = Number.isFinite(wave) ? Math.max(1, wave) : 1;
    if (w !== memoWave) {
        memoValue = computeScalars(w);
        memoWave = w;
    }
    return memoValue;
}

/**
 * HP/damage scalars for a milestone boss on `wave`. HP is softened by
 * `BOSS_HP_CURVE_EXPONENT` because the boss's own tier ramp already encodes the
 * wave; damage takes the curve as-is (tier DPS barely ramps).
 */
export function bossDifficultyAt(wave: number): { hp: number; damage: number } {
    const d = difficultyAt(wave);
    return { hp: Math.pow(d.hp, BOSS_HP_CURVE_EXPONENT), damage: d.damage };
}

/** Test-only accessor for the raw table. */
export const DIFFICULTY_ANCHORS = ANCHORS;
