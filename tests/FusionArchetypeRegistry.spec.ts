import { describe, expect, it } from 'vitest';
import {
    registerAutocastArchetype, registerPassiveArchetype,
    getAutocastArchetype, getPassiveArchetype, archetypeKey,
} from '../src/survivors/powers/FusionArchetypeRegistry';

describe('FusionArchetypeRegistry', () => {
    it('builds a sorted element-pair key (order-independent)', () => {
        expect(archetypeKey('fire', 'ice')).toBe('fire_ice');
        expect(archetypeKey('ice', 'fire')).toBe('fire_ice');
        expect(archetypeKey('storm', 'physical')).toBe('physical_storm');
    });

    it('stores and retrieves autocast + passive archetypes by key', () => {
        const auto = () => {};
        const pass = () => {};
        registerAutocastArchetype('fire_ice', auto);
        registerPassiveArchetype('fire_ice', pass);
        expect(getAutocastArchetype('fire_ice')).toBe(auto);
        expect(getPassiveArchetype('fire_ice')).toBe(pass);
    });

    it('returns undefined for unregistered keys', () => {
        expect(getAutocastArchetype('arcane_storm')).toBeUndefined();
        expect(getPassiveArchetype('arcane_storm')).toBeUndefined();
    });
});
