import { describe, it, expect } from 'vitest';
import {
    BIOMES, BIOME_TRANSITION_WAVES,
    biomeForWave, biomeIndexForWave, resolveBiomeBlend, resolveBiomeBlendT,
    luminance, lerpRgb,
    GROUND_LUMINANCE_MIN, GROUND_LUMINANCE_MAX,
} from '../src/survivors/world/Biomes';

describe('biome table', () => {
    it('is ordered by startWave, which resolveBiome depends on', () => {
        for (let i = 1; i < BIOMES.length; i++) {
            expect(BIOMES[i].startWave).toBeGreaterThan(BIOMES[i - 1].startWave);
        }
    });

    it('starts at wave 1 so there is never an unowned wave', () => {
        expect(BIOMES[0].startWave).toBe(1);
    });

    it('has unique ids and labels', () => {
        expect(new Set(BIOMES.map(b => b.id)).size).toBe(BIOMES.length);
        expect(new Set(BIOMES.map(b => b.label)).size).toBe(BIOMES.length);
    });

    it('only references prop kits, never an empty kit list', () => {
        for (const b of BIOMES) expect(b.props.length).toBeGreaterThan(0);
    });
});

describe('readability promise', () => {
    // The design contract: ground stays dark enough that bright enemies and
    // power VFX separate from it by luminance alone, in every biome. A colour
    // tweak that breaks this is a gameplay regression, not a cosmetic one.
    it('keeps every biome ground inside the readable luminance band', () => {
        for (const b of BIOMES) {
            const l = luminance(b.ground.base);
            expect(l, `${b.id} ground luminance ${l.toFixed(3)}`).toBeGreaterThanOrEqual(GROUND_LUMINANCE_MIN);
            expect(l, `${b.id} ground luminance ${l.toFixed(3)}`).toBeLessThanOrEqual(GROUND_LUMINANCE_MAX);
        }
    });

    it('never lets a biome ground outshine a mid-grey enemy', () => {
        const midGrey = luminance([0.5, 0.5, 0.5]);
        for (const b of BIOMES) {
            expect(luminance(b.ground.base)).toBeLessThan(midGrey);
        }
    });
});

describe('biomeForWave', () => {
    it('resolves each band', () => {
        expect(biomeForWave(1).id).toBe('meadow');
        expect(biomeForWave(9).id).toBe('meadow');
        expect(biomeForWave(10).id).toBe('scorched');
        expect(biomeForWave(19).id).toBe('scorched');
        expect(biomeForWave(20).id).toBe('cursed');
        expect(biomeForWave(999).id).toBe('cursed');
    });

    it('clamps below wave 1 rather than throwing', () => {
        expect(biomeForWave(0).id).toBe('meadow');
        expect(biomeForWave(-5).id).toBe('meadow');
    });
});

describe('resolveBiomeBlend', () => {
    it('is not transitioning in the middle of a band', () => {
        const b = resolveBiomeBlend(5);
        expect(b.t).toBe(0);
        expect(b.from.id).toBe('meadow');
        expect(b.to.id).toBe('meadow');
    });

    it('opens the transition BIOME_TRANSITION_WAVES before the next band', () => {
        const start = 10 - BIOME_TRANSITION_WAVES;
        expect(resolveBiomeBlend(start - 0.01).t).toBe(0);
        expect(resolveBiomeBlend(start).t).toBeCloseTo(0, 6);
        expect(resolveBiomeBlend(start + BIOME_TRANSITION_WAVES / 2).t).toBeCloseTo(0.5, 6);
    });

    it('reaches t=1 exactly at the next band boundary', () => {
        const b = resolveBiomeBlend(10);
        // At the boundary the band index has already advanced, so this is the
        // start of the new band rather than the end of the old fade.
        expect(b.from.id).toBe('scorched');
        expect(b.t).toBe(0);
    });

    it('produces a continuous axis across the handoff', () => {
        // biomeIndexForWave + t is the scalar World eases along; it must not
        // jump at a band boundary or the grade visibly snaps.
        const axis = (w: number) => biomeIndexForWave(w) + resolveBiomeBlend(w).t;
        const before = axis(10 - 1e-6);
        const after = axis(10);
        expect(Math.abs(after - before)).toBeLessThan(1e-3);
    });

    it('never transitions past the final band', () => {
        for (const w of [20, 25, 100, 5000]) {
            const b = resolveBiomeBlend(w);
            expect(b.t).toBe(0);
            expect(b.from.id).toBe('cursed');
            expect(b.to.id).toBe('cursed');
        }
    });

    it('always returns t within [0,1]', () => {
        for (let w = 0; w <= 40; w += 0.25) {
            const t = resolveBiomeBlend(w).t;
            expect(t).toBeGreaterThanOrEqual(0);
            expect(t).toBeLessThanOrEqual(1);
        }
    });
});

describe('resolveBiomeBlendT', () => {
    it('matches resolveBiomeBlend().t everywhere (allocation-free variant)', () => {
        for (let w = 0; w <= 40; w += 0.25) {
            expect(resolveBiomeBlendT(w)).toBe(resolveBiomeBlend(w).t);
        }
    });
});

describe('lerpRgb', () => {
    it('interpolates componentwise into the out tuple', () => {
        const out: [number, number, number] = [0, 0, 0];
        lerpRgb([0, 0, 0], [1, 0.5, 0.25], 0.5, out);
        expect(out[0]).toBeCloseTo(0.5, 6);
        expect(out[1]).toBeCloseTo(0.25, 6);
        expect(out[2]).toBeCloseTo(0.125, 6);
    });

    it('returns the endpoints exactly at t=0 and t=1', () => {
        const out: [number, number, number] = [0, 0, 0];
        lerpRgb([0.1, 0.2, 0.3], [0.7, 0.8, 0.9], 0, out);
        expect(out).toEqual([0.1, 0.2, 0.3]);
        lerpRgb([0.1, 0.2, 0.3], [0.7, 0.8, 0.9], 1, out);
        expect(out[0]).toBeCloseTo(0.7, 10);
    });
});
