/**
 * resourceBudget — pure helpers for the runtime resource-leak watchdog.
 *
 * The recurring multi-second freeze in this game has always been the same class
 * of bug: transient FX allocate a material / texture / mesh that is never freed,
 * so a per-frame-walked scene list (scene.materials, scene.textures) grows
 * monotonically until list-walking + heap pressure stalls a frame for seconds.
 *
 * Past instances were only found by manual bisecting after the fact. These helpers
 * power a standing watchdog (see SurvivorsGameplayState.checkResourceBudget) that,
 * the moment growth crosses a budget, buckets the offending list by name-prefix
 * and logs the largest buckets — so the next regression NAMES its own culprit
 * (e.g. "swingRingMatElem×42") instead of being a silent mystery.
 *
 * Everything here is pure string/array logic (no Babylon types) so it is covered
 * by Vitest — the unit test is itself a permanent guard on the guard.
 */

/**
 * Reduce a Babylon object name to a stable allocation-site prefix by stripping
 * the per-instance suffixes our code and Babylon append:
 *   - Babylon clone suffixes:      "swingRingMat.001", "swingRingMat (1)"
 *   - our colour-keyed variants:   "swingRingMatElem_#ff8080" -> "swingRingMatElem"
 *   - our numeric index variants:  "heroFireMat_0_barbarian"  -> "heroFireMat_barbarian"
 *                                  "boltMat_3"                -> "boltMat"
 * Meaningful word segments ("fire_explosion_mat") are preserved.
 */
export function namePrefix(name: string): string {
    return name
        .replace(/\.\d+$/, '')           // "Name.001" clone suffix
        .replace(/ \(\d+\)$/, '')        // "Name (1)" clone suffix
        .replace(/_#[0-9a-fA-F]+/g, '')  // "_#ff8080" colour-keyed segment
        .replace(/_\d+/g, '');           // "_0" numeric-index segment
}

export interface PrefixBucket {
    prefix: string;
    count: number;
}

/**
 * Tally names by their {@link namePrefix}, returning the largest buckets first.
 * Many orphaned instances of one allocation site collapse into a single bucket,
 * so the top entry points straight at the leaking call site.
 */
export function bucketByPrefix(names: string[], topN: number = 8): PrefixBucket[] {
    const counts = new Map<string, number>();
    for (const n of names) {
        const p = namePrefix(n) || '(unnamed)';
        counts.set(p, (counts.get(p) ?? 0) + 1);
    }
    return [...counts.entries()]
        .map(([prefix, count]) => ({ prefix, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, topN);
}

/** Compact one-line rendering of the top buckets: "swingRingMatElem×42, meteorRingMat×9". */
export function formatBuckets(names: string[], topN: number = 8): string {
    const buckets = bucketByPrefix(names, topN);
    if (buckets.length === 0) return '(none)';
    return buckets.map(b => `${b.prefix}×${b.count}`).join(', ');
}
