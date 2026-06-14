/** Wave number at/after which blue base enemies are replaced by their red variants. */
export const RED_SWAP_WAVE = 10;
/** Wave at/after which the red tier upgrades again to the wave-15 roster. */
export const TIER3_SWAP_WAVE = 15;

/**
 * Map a base enemy type to the toughest variant unlocked at `wave`. Two one-way
 * thresholds: wave 10 (red tier) then wave 15 (fire/lizard tier). Types without a
 * variant pass through. Pure function — unit-tested; the only logic the
 * Babylon-coupled spawn path can't cover. NOTE: the wizard's wave-15 AOE "super"
 * form is an ELITE decision made in EnemyManager (it needs the eliteElement flag),
 * so `healer` stays `healer_red` here.
 */
export function redSwapType(type: string, wave: number): string {
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
