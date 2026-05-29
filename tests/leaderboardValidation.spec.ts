import { describe, expect, it } from 'vitest';
import { validateScore } from '../src/survivors/leaderboardValidation';

const valid = { name: 'Ricardo', wave: 12, timeSec: 305, kills: 240, gold: 1500, champion: 'mage' };

describe('validateScore', () => {
    it('accepts a valid submission', () => {
        const r = validateScore(valid);
        expect(r.ok).toBe(true);
        if (r.ok) {
            expect(r.value.name).toBe('Ricardo');
            expect(r.value.wave).toBe(12);
            expect(r.value.champion).toBe('mage');
        }
    });

    it('rejects a non-object body', () => {
        expect(validateScore(null).ok).toBe(false);
        expect(validateScore('nope').ok).toBe(false);
        expect(validateScore(42).ok).toBe(false);
    });

    it('rejects empty / whitespace-only names', () => {
        expect(validateScore({ ...valid, name: '   ' }).ok).toBe(false);
        expect(validateScore({ ...valid, name: '' }).ok).toBe(false);
    });

    it('strips control characters and clamps name length to 16', () => {
        const r = validateScore({ ...valid, name: 'a\x00b'.padEnd(40, 'x') });
        expect(r.ok).toBe(true);
        if (r.ok) {
            expect(r.value.name.includes('\x00')).toBe(false);
            expect(r.value.name.length).toBe(16);
        }
    });

    it('rejects non-integer or out-of-range wave', () => {
        expect(validateScore({ ...valid, wave: 0 }).ok).toBe(false);
        expect(validateScore({ ...valid, wave: 2.5 }).ok).toBe(false);
        expect(validateScore({ ...valid, wave: 9999 }).ok).toBe(false);
    });

    it('rejects negative kills/gold and over-cap time', () => {
        expect(validateScore({ ...valid, kills: -1 }).ok).toBe(false);
        expect(validateScore({ ...valid, gold: -5 }).ok).toBe(false);
        expect(validateScore({ ...valid, timeSec: 99999 }).ok).toBe(false);
    });

    it('treats champion as optional', () => {
        const { champion, ...noChamp } = valid;
        const r = validateScore(noChamp);
        expect(r.ok).toBe(true);
        if (r.ok) expect(r.value.champion).toBeUndefined();
    });

    it('accepts exact boundary values', () => {
        expect(validateScore({ ...valid, wave: 200 }).ok).toBe(true);
        expect(validateScore({ ...valid, timeSec: 7200 }).ok).toBe(true);
        expect(validateScore({ ...valid, kills: 100000 }).ok).toBe(true);
        expect(validateScore({ ...valid, gold: 10000000 }).ok).toBe(true);
    });

    it('rejects one-over-boundary values', () => {
        expect(validateScore({ ...valid, wave: 201 }).ok).toBe(false);
        expect(validateScore({ ...valid, timeSec: 7201 }).ok).toBe(false);
        expect(validateScore({ ...valid, kills: 100001 }).ok).toBe(false);
        expect(validateScore({ ...valid, gold: 10000001 }).ok).toBe(false);
    });
});
