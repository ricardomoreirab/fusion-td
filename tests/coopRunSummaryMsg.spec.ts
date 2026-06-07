import { describe, it, expect } from 'vitest';
import { encode, decode, type NetMessage, type CoopHeroSummary } from '../src/net/Protocol';

const hero = (id: number): CoopHeroSummary => ({
    id,
    championType: id === 0 ? 'barbarian' : 'ranger',
    kills: 42 + id,
    level: 13 + id,
    xp: 1234 + id,
    wave: 9,
    loadout: [{ name: 'Fireball', level: 3, icon: '🔥', tier: 'fusion' }],
});

describe('M4-12 co-op game-over messages', () => {
    it('round-trips a runSummary (guest → host)', () => {
        const msg: NetMessage = { t: 'runSummary', hero: hero(1) };
        expect(decode(encode(msg))).toEqual(msg);
    });

    it('round-trips a runOver with both heroes (host → guest)', () => {
        const msg: NetMessage = {
            t: 'runOver',
            timeSurvivedSec: 312.5,
            waveReached: 9,
            heroes: [hero(0), hero(1)],
        };
        expect(decode(encode(msg))).toEqual(msg);
    });

    it('round-trips a single-hero runOver (loadout may be empty)', () => {
        const lone: CoopHeroSummary = { ...hero(0), loadout: [] };
        const msg: NetMessage = { t: 'runOver', timeSurvivedSec: 5, waveReached: 1, heroes: [lone] };
        expect(decode(encode(msg))).toEqual(msg);
    });
});
