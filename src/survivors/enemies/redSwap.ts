/** Wave number at/after which blue base enemies are replaced by their red variants. */
export const RED_SWAP_WAVE = 10;

/**
 * Map a base enemy type string to its red variant once the run reaches
 * RED_SWAP_WAVE. Types without a red variant (tank, boss, shield, splitting, …)
 * pass through unchanged. Pure function — unit-tested; the only logic the
 * Babylon-coupled spawn path can't cover.
 */
export function redSwapType(type: string, wave: number): string {
    if (wave < RED_SWAP_WAVE) return type;
    switch (type) {
        case 'basic':  return 'basic_red';
        case 'fast':   return 'fast_red';
        case 'healer': return 'healer_red';
        case 'tank':   return 'tank_red';
        default:       return type;
    }
}
