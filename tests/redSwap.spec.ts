import { describe, expect, it } from 'vitest';
import { redSwapType, RED_SWAP_WAVE } from '../src/survivors/enemies/redSwap';

describe('redSwapType', () => {
    it('passes base types through before the swap wave', () => {
        expect(redSwapType('basic', 9)).toBe('basic');
        expect(redSwapType('fast', 1)).toBe('fast');
        expect(redSwapType('healer', RED_SWAP_WAVE - 1)).toBe('healer');
    });

    it('swaps basic/fast/healer/tank to red variants at and after the swap wave', () => {
        expect(redSwapType('basic', RED_SWAP_WAVE)).toBe('basic_red');
        expect(redSwapType('fast', 10)).toBe('fast_red');
        expect(redSwapType('healer', 25)).toBe('healer_red');
        expect(redSwapType('tank', 10)).toBe('tank_red');
    });

    it('passes the tank through before the swap wave', () => {
        expect(redSwapType('tank', RED_SWAP_WAVE - 1)).toBe('tank');
    });

    it('leaves non-swapped types unchanged at any wave', () => {
        expect(redSwapType('boss', 20)).toBe('boss');
        expect(redSwapType('shield', 50)).toBe('shield');
        expect(redSwapType('splitting', 50)).toBe('splitting');
    });
});
