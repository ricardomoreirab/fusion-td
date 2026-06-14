import { describe, it, expect } from 'vitest';
import { redSwapType, RED_SWAP_WAVE, TIER3_SWAP_WAVE } from '../src/survivors/enemies/redSwap';

describe('tiered enemy swap', () => {
    it('keeps base types before wave 10', () => {
        expect(redSwapType('fast', 9)).toBe('fast');
        expect(redSwapType('tank', 9)).toBe('tank');
    });
    it('applies red tier at wave 10-14', () => {
        expect(redSwapType('fast', 12)).toBe('fast_red');
        expect(redSwapType('tank', 12)).toBe('tank_red');
        expect(redSwapType('healer', 12)).toBe('healer_red');
        expect(redSwapType('basic', 12)).toBe('basic_red');
    });
    it('applies wave-15 tier at wave 15+', () => {
        expect(redSwapType('fast', 16)).toBe('fire_beetle');
        expect(redSwapType('tank', 16)).toBe('horned_lizard');
        // healer stays the red wizard; its ELITE upgrade is decided in the spawn switch
        expect(redSwapType('healer', 16)).toBe('healer_red');
        expect(redSwapType('basic', 16)).toBe('basic_red');
    });
    it('exposes the thresholds', () => {
        expect(RED_SWAP_WAVE).toBe(10);
        expect(TIER3_SWAP_WAVE).toBe(15);
    });
});
