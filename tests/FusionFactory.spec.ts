import { describe, expect, it, vi } from 'vitest';
import { makeFusionDef, fusionId, FUSION_DMG, FUSION_CD, FUSION_PASSIVE_BONUS } from '../src/survivors/powers/FusionFactory';
import type { PowerDefinition } from '../src/survivors/powers/PowerDefinitions';

// Minimal fake parent defs — no Babylon, no scene.
function fakeAutocast(id: string, element: string, baseCd: number, baseDmg: number, castSpy = vi.fn()): PowerDefinition {
    return {
        id, name: id, element: element as PowerDefinition['element'], icon: 'x',
        baseCooldown: baseCd, baseDamage: baseDmg, baseRange: 10, maxLevel: 5, mode: 'autocast',
        cooldownFor: (s) => baseCd * Math.pow(0.92, s.level - 1),
        damageFor:   (s) => baseDmg * Math.pow(1.25, s.level - 1),
        cast: castSpy,
    };
}
function fakePassive(id: string, element: string, onHitSpy = vi.fn(), rangeBonus?: (l: number) => number): PowerDefinition {
    return {
        id, name: id, element: element as PowerDefinition['element'], icon: 'x',
        baseCooldown: 0, baseDamage: 0, baseRange: 0, maxLevel: 5, mode: 'passive',
        cooldownFor: () => 0, damageFor: () => 0, onHit: onHitSpy, rangeBonus,
    };
}

describe('fusionId — canonical ordering', () => {
    it('is order-independent (Fire+Ice === Ice+Fire)', () => {
        expect(fusionId('mage', 'fire', 'ice')).toBe(fusionId('mage', 'ice', 'fire'));
    });
    it('encodes class and sorted elements', () => {
        expect(fusionId('mage', 'ice', 'fire')).toBe('fuse_mage_fire_ice');
    });
});

describe('makeFusionDef — metadata', () => {
    it('sets tier, parents, elements, championType, and a fixed id/name', () => {
        const a = fakeAutocast('mage_fire', 'fire', 1.4, 14);
        const b = fakeAutocast('mage_ice', 'ice', 1.2, 9);
        const f = makeFusionDef(a, b);
        expect(f.id).toBe('fuse_mage_fire_ice');
        expect(f.tier).toBe('fusion');
        expect(f.championType).toBe('mage');
        expect(f.parents).toEqual(['mage_fire', 'mage_ice']);
        expect(f.elements).toEqual(['fire', 'ice']);
        expect(f.name).toBe('Frostfire');
        expect(f.maxLevel).toBe(5);
    });
});

describe('makeFusionDef — autocast composition', () => {
    it('cooldown = averaged parent cooldowns × FUSION_CD', () => {
        const a = fakeAutocast('mage_fire', 'fire', 2, 14);
        const b = fakeAutocast('mage_ice', 'ice', 1, 9);
        const f = makeFusionDef(a, b);
        const s = { level: 1, cooldownRemaining: 0 };
        expect(f.cooldownFor(s)).toBeCloseTo(((2 + 1) / 2) * FUSION_CD, 5);
    });
    it('damage (display) = sum of parent damages', () => {
        const a = fakeAutocast('mage_fire', 'fire', 2, 14);
        const b = fakeAutocast('mage_ice', 'ice', 1, 9);
        const f = makeFusionDef(a, b);
        const s = { level: 1, cooldownRemaining: 0 };
        expect(f.damageFor(s)).toBeCloseTo(14 + 9, 5);
    });
    it('cast fires BOTH parents with the fusion-boosted damage multiplier and fusion level', () => {
        const castA = vi.fn();
        const castB = vi.fn();
        const a = fakeAutocast('mage_fire', 'fire', 2, 14, castA);
        const b = fakeAutocast('mage_ice', 'ice', 1, 9, castB);
        const f = makeFusionDef(a, b);
        const state = { level: 4, cooldownRemaining: 0 };
        const ctx = { scene: {} as never, heroPosition: {} as never, enemies: [], damageMultiplier: 2 };
        f.init?.(state, ctx);
        f.cast?.(state, ctx);
        expect(castA).toHaveBeenCalledTimes(1);
        expect(castB).toHaveBeenCalledTimes(1);
        // Each parent sees damageMultiplier scaled by FUSION_DMG…
        expect(castA.mock.calls[0][1].damageMultiplier).toBeCloseTo(2 * FUSION_DMG, 5);
        // …and a sub-state whose level mirrors the fusion's level.
        expect(castA.mock.calls[0][0].level).toBe(4);
    });
});

describe('makeFusionDef — passive composition', () => {
    it('onHit fires both parents then applies the fusion bonus damage', () => {
        const hitA = vi.fn();
        const hitB = vi.fn();
        const a = fakePassive('barbarian_fire', 'fire', hitA);
        const b = fakePassive('barbarian_ice', 'ice', hitB);
        const f = makeFusionDef(a, b);
        const takeDamage = vi.fn();
        const enemy = { takeDamage } as never;
        const ctx = { scene: {} as never, heroPosition: {} as never, enemies: [], baseDamage: 10 };
        f.onHit?.(enemy, 3, ctx);
        expect(hitA).toHaveBeenCalledTimes(1);
        expect(hitB).toHaveBeenCalledTimes(1);
        expect(takeDamage).toHaveBeenCalledWith(10 * FUSION_PASSIVE_BONUS * 3);
    });
    it('rangeBonus sums the parents', () => {
        const a = fakePassive('barbarian_physical', 'physical', vi.fn(), (l) => l * 0.3);
        const b = fakePassive('barbarian_fire', 'fire', vi.fn());
        const f = makeFusionDef(a, b);
        expect(f.rangeBonus?.(4)).toBeCloseTo(1.2, 5);
    });
});

describe('makeFusionDef — parent lifecycle (init/dispose)', () => {
    it('runs each parent init on its own sub-state, and disposes that same sub-state', () => {
        const initA = vi.fn();
        const disposeA = vi.fn();
        const a: PowerDefinition = { ...fakeAutocast('mage_physical', 'physical', 0.25, 4), init: initA, dispose: disposeA };
        const b = fakeAutocast('mage_fire', 'fire', 1.4, 14);
        const f = makeFusionDef(a, b);
        const state = { level: 2, cooldownRemaining: 0 };
        const ctx = { scene: {} as never, heroPosition: {} as never, enemies: [], damageMultiplier: 1 };

        f.init?.(state, ctx);
        expect(initA).toHaveBeenCalledTimes(1);
        // Parent init receives its OWN sub-state, not the fusion's state.
        expect(initA.mock.calls[0][0]).not.toBe(state);

        f.dispose?.(state);
        expect(disposeA).toHaveBeenCalledTimes(1);
        // Dispose acts on the same sub-state init created (no mesh leak).
        expect(disposeA.mock.calls[0][0]).toBe(initA.mock.calls[0][0]);
    });
});

describe('makeFusionDef — persistent tick forwarding (Whirling Blades in a fusion)', () => {
    it('forwards tick to a tick-bearing parent on its own sub-state, syncing the level', () => {
        const tickA = vi.fn();
        const a: PowerDefinition = { ...fakeAutocast('mage_physical', 'physical', 0.25, 4), tick: tickA };
        const b = fakeAutocast('mage_fire', 'fire', 1.4, 14);
        const f = makeFusionDef(a, b);
        const state = { level: 3, cooldownRemaining: 0 };
        const ctx = { scene: {} as never, heroPosition: {} as never, enemies: [], damageMultiplier: 1 };

        expect(f.tick).toBeTypeOf('function');
        f.tick?.(state, ctx, 0.016);

        expect(tickA).toHaveBeenCalledTimes(1);
        const [sub, , dt] = tickA.mock.calls[0];
        // Parent tick runs on its OWN sub-state, not the fusion's state...
        expect(sub).not.toBe(state);
        // ...whose level tracks the fusion's (so blade count scales with level-ups)...
        expect(sub.level).toBe(3);
        // ...and gets the real frame delta forwarded.
        expect(dt).toBe(0.016);
    });

    it('omits tick entirely when neither parent has one', () => {
        const f = makeFusionDef(fakeAutocast('mage_fire', 'fire', 1.4, 14), fakeAutocast('mage_ice', 'ice', 1.2, 9));
        expect(f.tick).toBeUndefined();
    });
});

describe('makeFusionDef — guards', () => {
    it('throws when the two parents have different modes', () => {
        const a = fakeAutocast('mage_fire', 'fire', 1.4, 14);
        const b = fakePassive('mage_ice', 'ice');
        expect(() => makeFusionDef(a, b)).toThrow();
    });
});
