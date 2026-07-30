import { describe, expect, it } from 'vitest';
import {
    redSwapType, RED_SWAP_WAVE, TIER3_SWAP_WAVE, TIER4_SWAP_WAVE,
} from '../src/survivors/enemies/redSwap';

/** Every base type the spawn path can hand to the swap. */
const BASE_TYPES = ['basic', 'fast', 'tank', 'healer'];

describe('redSwapType', () => {
    it('passes base types through before the swap wave', () => {
        expect(redSwapType('basic', 9)).toBe('basic');
        expect(redSwapType('fast', 1)).toBe('fast');
        expect(redSwapType('healer', RED_SWAP_WAVE - 1)).toBe('healer');
        expect(redSwapType('tank', RED_SWAP_WAVE - 1)).toBe('tank');
    });

    it('swaps to red variants at and after the red swap wave', () => {
        expect(redSwapType('basic', RED_SWAP_WAVE)).toBe('basic_red');
        expect(redSwapType('fast', RED_SWAP_WAVE)).toBe('fast_red');
        expect(redSwapType('healer', RED_SWAP_WAVE)).toBe('healer_red');
        expect(redSwapType('tank', RED_SWAP_WAVE)).toBe('tank_red');
    });

    it('swaps to the fire/lizard tier at and after wave 15', () => {
        expect(redSwapType('fast', TIER3_SWAP_WAVE)).toBe('fire_beetle');
        expect(redSwapType('tank', TIER3_SWAP_WAVE)).toBe('horned_lizard');
        expect(redSwapType('basic', TIER3_SWAP_WAVE)).toBe('basic_red');
        expect(redSwapType('healer', TIER3_SWAP_WAVE)).toBe('healer_red');
    });

    it('swaps the heavy and the caster again at and after wave 25', () => {
        expect(redSwapType('tank', TIER4_SWAP_WAVE)).toBe('fortress_titan');
        expect(redSwapType('healer', TIER4_SWAP_WAVE)).toBe('molten_fiend');
    });

    it('falls the wave-25 tier through to wave-15 forms for slots it does not fill', () => {
        // Only two of the four slots have a wave-25 form. The others must keep
        // their newest EXISTING variant rather than reverting to a base type —
        // the failure mode of a swap table that reassigns instead of returning.
        expect(redSwapType('fast', TIER4_SWAP_WAVE)).toBe('fire_beetle');
        expect(redSwapType('basic', TIER4_SWAP_WAVE)).toBe('basic_red');
    });

    it('never downgrades a slot as the wave climbs', () => {
        // Each threshold is one-way, so a given slot's variant may only change at
        // a threshold and must then stay changed. Walking every wave catches an
        // off-by-one in a boundary or a case dropped from a later tier.
        for (const type of BASE_TYPES) {
            const seen: string[] = [];
            for (let wave = 1; wave <= 40; wave++) {
                const variant = redSwapType(type, wave);
                if (variant !== seen[seen.length - 1]) seen.push(variant);
            }
            // A slot upgrades at most once per threshold, and never returns to a
            // variant it already left behind.
            expect(new Set(seen).size, `${type}: ${seen.join(' → ')}`).toBe(seen.length);
            expect(seen.length).toBeLessThanOrEqual(4);
        }
    });

    it('leaves non-swapped types unchanged at any wave', () => {
        expect(redSwapType('boss', 20)).toBe('boss');
        expect(redSwapType('shield', 50)).toBe('shield');
        expect(redSwapType('splitting', 50)).toBe('splitting');
    });

    it('orders the thresholds so a later tier can override an earlier one', () => {
        expect(RED_SWAP_WAVE).toBeLessThan(TIER3_SWAP_WAVE);
        expect(TIER3_SWAP_WAVE).toBeLessThan(TIER4_SWAP_WAVE);
    });
});
