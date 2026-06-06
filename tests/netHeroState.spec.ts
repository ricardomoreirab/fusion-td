import { describe, it, expect } from 'vitest';
import { encode, decode, type NetMessage } from '../src/net/Protocol';

describe('HeroState message', () => {
    it('round-trips a heroState message', () => {
        const msg: NetMessage = {
            t: 'heroState', seq: 3, x: 1.5, y: 2, z: -4.25, ry: 0.7,
            champ: 'ranger', anim: 1,
        };
        expect(decode(encode(msg))).toEqual(msg);
    });

    it('is accepted as a known tag', () => {
        expect(() => decode(JSON.stringify({ t: 'heroState', seq: 0, x: 0, y: 0, z: 0, ry: 0, champ: 'mage', anim: 0 }))).not.toThrow();
    });
});
