import { describe, expect, it } from 'vitest';
import { getReaction, registerReaction } from '../src/survivors/powers/StatusReactions';

describe('StatusReactions', () => {
    it('returns the built-in Overload reaction for storm hitting a burning enemy', () => {
        expect(getReaction('storm', 'burn')).toEqual({ kind: 'overload' });
    });

    it('returns undefined for an unmapped pair', () => {
        expect(getReaction('ice', 'burn')).toBeUndefined();
        expect(getReaction('storm', 'fragile')).toBeUndefined();
    });

    it('lets callers register new reactions', () => {
        registerReaction('fire', 'chill', { kind: 'overload' });
        expect(getReaction('fire', 'chill')).toEqual({ kind: 'overload' });
    });
});
