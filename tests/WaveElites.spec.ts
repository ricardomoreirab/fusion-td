import { describe, expect, it } from 'vitest';
import { computeWaveElites, type WaveElitesInput } from '../src/survivors/WaveElites';

const ELEMENTS = ['fire', 'ice', 'arcane', 'physical', 'storm'];

function seededRng(seed: number): () => number {
    let state = seed;
    return () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 0xffffffff;
    };
}

describe('computeWaveElites', () => {
    it('returns one elite for a single-type wave', () => {
        const wave: WaveElitesInput = { enemies: [{ type: 'basic', count: 5 }] };
        const elites = computeWaveElites(wave, seededRng(1));
        expect(elites).toHaveLength(1);
        expect(elites[0].type).toBe('basic');
        expect(elites[0].count).toBe(1);
        expect(ELEMENTS).toContain(elites[0].element);
    });

    it('returns one elite per distinct type, all with different elements', () => {
        const wave: WaveElitesInput = {
            enemies: [
                { type: 'basic', count: 6 },
                { type: 'fast', count: 4 },
                { type: 'tank', count: 3 },
                { type: 'healer', count: 1 },
                { type: 'splitting', count: 2 },
            ],
        };
        const elites = computeWaveElites(wave, seededRng(42));
        expect(elites).toHaveLength(5);
        expect(elites.map(e => e.type).sort()).toEqual(
            ['basic', 'fast', 'healer', 'splitting', 'tank'],
        );
        const elements = elites.map(e => e.element);
        expect(new Set(elements).size).toBe(5);
        for (const el of elements) expect(ELEMENTS).toContain(el);
    });

    it('excludes the boss type entirely', () => {
        const wave: WaveElitesInput = {
            enemies: [
                { type: 'basic', count: 6 },
                { type: 'fast', count: 4 },
                { type: 'tank', count: 2 },
                { type: 'boss', count: 1 },
            ],
        };
        const elites = computeWaveElites(wave, seededRng(7));
        expect(elites).toHaveLength(3);
        expect(elites.map(e => e.type)).not.toContain('boss');
    });

    it('returns an empty array for a boss-only wave', () => {
        const wave: WaveElitesInput = { enemies: [{ type: 'boss', count: 1 }] };
        const elites = computeWaveElites(wave, seededRng(99));
        expect(elites).toEqual([]);
    });

    it('ignores enemy groups with count <= 0', () => {
        const wave: WaveElitesInput = {
            enemies: [
                { type: 'basic', count: 5 },
                { type: 'fast', count: 0 },
            ],
        };
        const elites = computeWaveElites(wave, seededRng(3));
        expect(elites).toHaveLength(1);
        expect(elites[0].type).toBe('basic');
    });

    it('is deterministic when given the same seeded rng', () => {
        const wave: WaveElitesInput = {
            enemies: [
                { type: 'basic', count: 4 },
                { type: 'fast', count: 4 },
                { type: 'tank', count: 4 },
            ],
        };
        const a = computeWaveElites(wave, seededRng(123));
        const b = computeWaveElites(wave, seededRng(123));
        expect(a).toEqual(b);
    });

    it('dedupes when the same type appears in multiple groups', () => {
        const wave: WaveElitesInput = {
            enemies: [
                { type: 'basic', count: 3 },
                { type: 'basic', count: 2 },
                { type: 'fast', count: 1 },
            ],
        };
        const elites = computeWaveElites(wave, seededRng(11));
        expect(elites).toHaveLength(2);
        expect(elites.map(e => e.type).sort()).toEqual(['basic', 'fast']);
    });
});
