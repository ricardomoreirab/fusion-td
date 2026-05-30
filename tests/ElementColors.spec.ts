import { describe, it, expect } from 'vitest';
import { ELEMENT_HEX, ELEMENT_COLOR, blendElements } from '../src/survivors/ElementColors';

describe('ElementColors', () => {
    it('exposes a hex + Color3 entry for every element', () => {
        for (const el of ['fire', 'ice', 'arcane', 'physical', 'storm'] as const) {
            expect(ELEMENT_HEX[el]).toMatch(/^#[0-9a-fA-F]{6}$/);
            expect(ELEMENT_COLOR[el]).toBeDefined();
        }
    });

    it('blends a single element to its own color', () => {
        const fire = ELEMENT_COLOR.fire;
        const blended = blendElements(['fire']);
        expect(blended.r).toBeCloseTo(fire.r, 5);
        expect(blended.g).toBeCloseTo(fire.g, 5);
        expect(blended.b).toBeCloseTo(fire.b, 5);
    });

    it('blends two elements to their component-wise average', () => {
        const blended = blendElements(['fire', 'ice']);
        expect(blended.r).toBeCloseTo((ELEMENT_COLOR.fire.r + ELEMENT_COLOR.ice.r) / 2, 5);
        expect(blended.g).toBeCloseTo((ELEMENT_COLOR.fire.g + ELEMENT_COLOR.ice.g) / 2, 5);
        expect(blended.b).toBeCloseTo((ELEMENT_COLOR.fire.b + ELEMENT_COLOR.ice.b) / 2, 5);
    });

    it('returns a neutral white for an empty set', () => {
        const blended = blendElements([]);
        expect(blended.r).toBeCloseTo(1, 5);
        expect(blended.g).toBeCloseTo(1, 5);
        expect(blended.b).toBeCloseTo(1, 5);
    });
});
