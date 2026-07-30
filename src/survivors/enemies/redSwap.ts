/** Wave number at/after which blue base enemies are replaced by their red variants. */
export const RED_SWAP_WAVE = 10;
/** Wave at/after which the red tier upgrades again to the wave-15 roster. */
export const TIER3_SWAP_WAVE = 15;
/** Wave at/after which the heavy and the caster upgrade once more — the titan
 *  and the fiend. The skirmisher and the minion have no wave-25 form and keep
 *  their wave-15 ones. */
export const TIER4_SWAP_WAVE = 25;

/**
 * Map a base enemy type to the toughest variant unlocked at `wave`. Three one-way
 * thresholds: wave 10 (red tier), wave 15 (fire/lizard tier), wave 25 (titan/fiend
 * tier). Types without a variant pass through, and a tier that does not replace a
 * slot falls through to the tier below it — which is why the thresholds are
 * ordered highest-first and each one returns rather than reassigns.
 *
 * Pure function — unit-tested; the only logic the Three-coupled spawn path can't
 * cover. NOTE: the wizard's wave-15 AOE "super" form is an ELITE decision made in
 * EnemyManager (it needs the eliteElement flag), so `healer` stays `healer_red`
 * there.
 */
export function redSwapType(type: string, wave: number): string {
    if (wave >= TIER4_SWAP_WAVE) {
        switch (type) {
            case 'tank':   return 'fortress_titan';
            case 'healer': return 'molten_fiend';
        }
    }
    if (wave >= TIER3_SWAP_WAVE) {
        switch (type) {
            case 'fast':   return 'fire_beetle';
            case 'tank':   return 'horned_lizard';
            case 'basic':  return 'basic_red';
            case 'healer': return 'healer_red';
        }
    }
    if (wave >= RED_SWAP_WAVE) {
        switch (type) {
            case 'basic':  return 'basic_red';
            case 'fast':   return 'fast_red';
            case 'healer': return 'healer_red';
            case 'tank':   return 'tank_red';
        }
    }
    return type;
}
