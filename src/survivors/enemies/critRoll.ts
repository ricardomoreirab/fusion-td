export interface CritParams { chance: number; damageMult: number; }
/** Roll (or accept) crit. `reported` (host applying a client's post-crit report)
 *  bypasses the roll: amount is already final, isCrit is the report's value. */
export function rollCrit(amount: number, cp: CritParams | undefined, rng: () => number, reported?: boolean): { amount: number; isCrit: boolean } {
    if (reported !== undefined) return { amount, isCrit: reported };
    if (cp && cp.chance > 0 && rng() < cp.chance) return { amount: amount * cp.damageMult, isCrit: true };
    return { amount, isCrit: false };
}
