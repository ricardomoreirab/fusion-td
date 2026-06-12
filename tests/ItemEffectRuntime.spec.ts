// tests/ItemEffectRuntime.spec.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    CHRONO_COOLDOWN_S, ECHO_CHANCE, ItemEffectRuntime, MIDAS_NOVA_GOLD,
    RAGE_DAMAGE_BONUS, SHOCKWAVE_EVERY_HITS, THORNS_MULTIPLIER,
    EffectContext, EffectEnemy,
} from '../src/survivors/items/ItemEffectRuntime';
import { ItemEffectId } from '../src/survivors/items/ItemTypes';

function makeEnemy(x: number, z: number, alive = true): EffectEnemy {
    return { isAlive: () => alive, getPosition: () => ({ x, z }) };
}

function makeCtx(overrides: Partial<EffectContext> = {}): EffectContext & {
    fx: Record<string, ReturnType<typeof vi.fn>>;
} {
    const fx = {
        rageGlow: vi.fn(), coinNova: vi.fn(), shockwave: vi.fn(),
        ricochet: vi.fn(), echoShimmer: vi.fn(),
    };
    return {
        heroPos: () => ({ x: 0, z: 0 }),
        heroHpFraction: () => 1,
        enemiesNear: () => [],
        damage: vi.fn(),
        stun: vi.fn(),
        burn: vi.fn(),
        addGold: vi.fn(),
        refundCooldownPct: vi.fn(),
        recastFree: vi.fn(),
        wave: () => 5,
        rng: () => 0.99,
        critChance: () => 0,
        fx,
        ...overrides,
    } as EffectContext & { fx: Record<string, ReturnType<typeof vi.fn>> };
}

function activate(rt: ItemEffectRuntime, ...ids: ItemEffectId[]) {
    rt.setActiveEffects(new Set(ids));
}

describe('rage', () => {
    it('toggles glow + damage bonus crossing the 50% HP threshold', () => {
        let hp = 1;
        const ctx = makeCtx({ heroHpFraction: () => hp });
        const rt = new ItemEffectRuntime(ctx);
        activate(rt, 'rage');
        rt.tick(0.016);
        expect(rt.damageBonusMult()).toBe(1);
        hp = 0.4;
        rt.tick(0.016);
        expect(rt.damageBonusMult()).toBeCloseTo(1 + RAGE_DAMAGE_BONUS);
        expect(ctx.fx.rageGlow).toHaveBeenLastCalledWith(true);
        hp = 0.8;
        rt.tick(0.016);
        expect(rt.damageBonusMult()).toBe(1);
        expect(ctx.fx.rageGlow).toHaveBeenLastCalledWith(false);
    });

    it('drops the glow when the set is unequipped mid-rage', () => {
        const ctx = makeCtx({ heroHpFraction: () => 0.2 });
        const rt = new ItemEffectRuntime(ctx);
        activate(rt, 'rage');
        rt.tick(0.016);
        expect(rt.damageBonusMult()).toBeGreaterThan(1);
        activate(rt); // none
        expect(rt.damageBonusMult()).toBe(1);
        expect(ctx.fx.rageGlow).toHaveBeenLastCalledWith(false);
    });
});

describe('echo', () => {
    it('recasts when the roll passes and never re-enters', () => {
        const ctx = makeCtx({ rng: () => ECHO_CHANCE - 0.01 });
        const rt = new ItemEffectRuntime(ctx);
        activate(rt, 'echo');
        // Simulate recastFree triggering another onPowerCast (the real wiring
        // does NOT fire onCast for free recasts, but guard anyway):
        (ctx.recastFree as any).mockImplementation(() => rt.onPowerCast());
        rt.onPowerCast();
        expect(ctx.recastFree).toHaveBeenCalledTimes(1);
        expect(ctx.fx.echoShimmer).toHaveBeenCalledTimes(1);
    });

    it('does nothing when the roll fails', () => {
        const ctx = makeCtx({ rng: () => ECHO_CHANCE + 0.01 });
        const rt = new ItemEffectRuntime(ctx);
        activate(rt, 'echo');
        rt.onPowerCast();
        expect(ctx.recastFree).not.toHaveBeenCalled();
    });
});

describe('midas', () => {
    it('double-pays a kill when the roll passes, reentrancy-guarded', () => {
        const ctx = makeCtx({ rng: () => 0.01 });
        const rt = new ItemEffectRuntime(ctx);
        activate(rt, 'midas');
        (ctx.addGold as any).mockImplementation((n: number) => rt.onGoldEarned(n));
        rt.onGoldEarned(20);
        expect(ctx.addGold).toHaveBeenCalledTimes(1);
        expect(ctx.addGold).toHaveBeenCalledWith(20);
    });

    it('bursts a coin nova for every 150g earned', () => {
        const near = [makeEnemy(1, 1), makeEnemy(2, 0)];
        const ctx = makeCtx({ rng: () => 0.99, enemiesNear: () => near });
        const rt = new ItemEffectRuntime(ctx);
        activate(rt, 'midas');
        rt.onGoldEarned(MIDAS_NOVA_GOLD - 1);
        expect(ctx.fx.coinNova).not.toHaveBeenCalled();
        rt.onGoldEarned(1);
        expect(ctx.fx.coinNova).toHaveBeenCalledTimes(1);
        expect(ctx.damage).toHaveBeenCalledTimes(near.length);
        // damage scales with wave: 25 + 5×wave(5) = 50
        expect((ctx.damage as any).mock.calls[0][1]).toBe(50);
    });
});

describe('thorns + chrono (onHeroHurt)', () => {
    it('thorns reflects 3x to nearby enemies', () => {
        const near = [makeEnemy(0.5, 0)];
        const ctx = makeCtx({ enemiesNear: () => near });
        const rt = new ItemEffectRuntime(ctx);
        activate(rt, 'thorns');
        rt.onHeroHurt(10);
        expect(ctx.damage).toHaveBeenCalledWith(near[0], 10 * THORNS_MULTIPLIER, 'physical');
    });

    it('chrono refunds cooldowns with an internal cooldown', () => {
        const ctx = makeCtx();
        const rt = new ItemEffectRuntime(ctx);
        activate(rt, 'chrono');
        rt.onHeroHurt(5);
        rt.onHeroHurt(5);
        expect(ctx.refundCooldownPct).toHaveBeenCalledTimes(1);
        rt.tick(CHRONO_COOLDOWN_S + 0.01);
        rt.onHeroHurt(5);
        expect(ctx.refundCooldownPct).toHaveBeenCalledTimes(2);
    });
});

describe('onBasicHit effects', () => {
    it('burnOnHit burns the target', () => {
        const ctx = makeCtx();
        const rt = new ItemEffectRuntime(ctx);
        activate(rt, 'burnOnHit');
        const target = makeEnemy(1, 0);
        rt.onBasicHit(target, 20);
        expect(ctx.burn).toHaveBeenCalledWith(target, expect.any(Number), expect.any(Number));
    });

    it('ricochet bounces 60% damage to the nearest OTHER enemy in range', () => {
        const target = makeEnemy(0, 0);
        const close = makeEnemy(2, 0);
        const far = makeEnemy(100, 0);
        const ctx = makeCtx({ enemiesNear: () => [target, close, far] });
        const rt = new ItemEffectRuntime(ctx);
        activate(rt, 'ricochet');
        rt.onBasicHit(target, 50);
        expect(ctx.damage).toHaveBeenCalledTimes(1);
        expect(ctx.damage).toHaveBeenCalledWith(close, 30, 'physical');
        expect(ctx.fx.ricochet).toHaveBeenCalled();
    });

    it('shockwave fires every Nth hit, stunning nearby enemies', () => {
        const near = [makeEnemy(1, 1)];
        const ctx = makeCtx({ enemiesNear: () => near });
        const rt = new ItemEffectRuntime(ctx);
        activate(rt, 'shockwave');
        const target = makeEnemy(0, 0);
        for (let i = 0; i < SHOCKWAVE_EVERY_HITS - 1; i++) rt.onBasicHit(target, 10);
        expect(ctx.fx.shockwave).not.toHaveBeenCalled();
        rt.onBasicHit(target, 10);
        expect(ctx.fx.shockwave).toHaveBeenCalledTimes(1);
        expect(ctx.stun).toHaveBeenCalledWith(near[0], expect.any(Number));
    });

    it('critExplode AoEs 50% of the hit on a successful roll', () => {
        const target = makeEnemy(0, 0);
        const near = [target, makeEnemy(1, 0)];
        const ctx = makeCtx({ critChance: () => 0.5, rng: () => 0.4, enemiesNear: () => near });
        const rt = new ItemEffectRuntime(ctx);
        activate(rt, 'critExplode');
        rt.onBasicHit(target, 40);
        // explodes on everyone near EXCEPT the original target
        expect(ctx.damage).toHaveBeenCalledTimes(1);
        expect(ctx.damage).toHaveBeenCalledWith(near[1], 20, 'physical');
    });
});

describe('reset', () => {
    it('clears counters, rage state and active effects', () => {
        const ctx = makeCtx({ heroHpFraction: () => 0.1 });
        const rt = new ItemEffectRuntime(ctx);
        activate(rt, 'rage');
        rt.tick(0.016);
        expect(rt.damageBonusMult()).toBeGreaterThan(1);
        rt.reset();
        expect(rt.damageBonusMult()).toBe(1);
        rt.onPowerCast(); // no active effects → no-op
        expect(ctx.recastFree).not.toHaveBeenCalled();
    });
});
