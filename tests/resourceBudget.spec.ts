import { describe, expect, it } from 'vitest';
import { namePrefix, bucketByPrefix, formatBuckets } from '../src/engine/rendering/resourceBudget';

describe('resourceBudget — namePrefix', () => {
    it('strips colour-keyed variant suffixes', () => {
        expect(namePrefix('swingRingMatElem_#ff8080')).toBe('swingRingMatElem');
        expect(namePrefix('swingArcMatElem_#00ffaa')).toBe('swingArcMatElem');
    });

    it('strips numeric index segments', () => {
        expect(namePrefix('boltMat_3')).toBe('boltMat');
        expect(namePrefix('heroFireMat_0_barbarian')).toBe('heroFireMat_barbarian');
    });

    it('strips Babylon clone suffixes', () => {
        expect(namePrefix('meteorRingMat.001')).toBe('meteorRingMat');
        expect(namePrefix('meteorRingMat (2)')).toBe('meteorRingMat');
    });

    it('preserves meaningful word segments (no over-stripping)', () => {
        expect(namePrefix('fire_explosion_mat')).toBe('fire_explosion_mat');
        expect(namePrefix('frostRingMat')).toBe('frostRingMat');
        expect(namePrefix('swingRingMat')).toBe('swingRingMat');
    });
});

describe('resourceBudget — bucketByPrefix', () => {
    it('collapses many per-instance names into one bucket, largest first', () => {
        const names = [
            ...Array(42).fill(0).map((_, i) => `swingRingMatElem_#ff${i.toString(16).padStart(2, '0')}80`),
            ...Array(9).fill('meteorRingMat'),
            'frostRingMat',
        ];
        const buckets = bucketByPrefix(names);
        expect(buckets[0]).toEqual({ prefix: 'swingRingMatElem', count: 42 });
        expect(buckets[1]).toEqual({ prefix: 'meteorRingMat', count: 9 });
        expect(buckets[2]).toEqual({ prefix: 'frostRingMat', count: 1 });
    });

    it('honors the topN cap', () => {
        const names = Array(20).fill(0).map((_, i) => `mat_${i}_kind${i}`);
        expect(bucketByPrefix(names, 3).length).toBe(3);
    });

    it('buckets unnamed entries under (unnamed)', () => {
        expect(bucketByPrefix(['', '']).length).toBe(1);
        expect(bucketByPrefix(['', ''])[0]).toEqual({ prefix: '(unnamed)', count: 2 });
    });
});

describe('resourceBudget — formatBuckets', () => {
    it('renders a compact "prefix×count" line naming the top leaker', () => {
        const names = [...Array(42).fill('swingRingMatElem_#ff8080'), ...Array(9).fill('meteorRingMat')];
        expect(formatBuckets(names)).toBe('swingRingMatElem×42, meteorRingMat×9');
    });

    it('returns (none) for an empty list', () => {
        expect(formatBuckets([])).toBe('(none)');
    });
});
