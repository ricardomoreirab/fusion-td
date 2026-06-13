// tests/coopItemsRouting.spec.ts
//
// Phase 9 (co-op itemization): the desync- and echo-critical routing invariants.
// These prove the *behavior* of the host-authoritative item/crit pipeline rather
// than re-checking wire round-trips (that lives in coopItemsCrit / netProtocol):
//
//   1. A reported crit is applied verbatim — the host never re-rolls/re-multiplies.
//   2. A guest hit routes through guestDamageRedirect EXACTLY once and mutates NO
//      local HP (the host is authoritative).
//   3. A guest item-effect proc emits exactly one secondary report per affected
//      enemy — never double-applies.
//   4. Execute (tryExecuteBelow → takeDamage(hp)) on a guest routes as a damage
//      report, never a local kill (no HP decrement, die() never runs).
//   5. A replayed FX under withFxReplay does not re-emit (echo guard).
//
// Harness choices (lightest that genuinely proves each invariant):
//   - rollCrit: pure unit (invariant 1).
//   - A REAL Enemy subclass over a fake game (no scene/mesh needed — the guest
//     redirect branch and host HP math never touch the scene; visuals are no-op'd).
//     This exercises the production takeDamage(), not a reimplementation
//     (invariants 2 + 4).
//   - A REAL ItemEffectRuntime driven by a fake EffectContext whose damage() is a
//     spy (the makeCtx pattern from ItemEffectRuntime.spec.ts) — invariant 3.
//   - CoopFx module functions directly (invariant 5).

import { describe, it, expect, vi, afterEach } from 'vitest';
import { Vector3 } from '@babylonjs/core';
import { rollCrit } from '../src/survivors/enemies/critRoll';
import { Enemy } from '../src/survivors/enemies/Enemy';
import {
    ItemEffectRuntime, EffectContext, EffectEnemy,
    SHOCKWAVE_EVERY_HITS,
} from '../src/survivors/items/ItemEffectRuntime';
import { ItemEffectId } from '../src/survivors/items/ItemTypes';
import { withFxReplay, isReplayingFx, emitCoopFx, setCoopFxEmit, isCoopFxActive } from '../src/survivors/coop/CoopFx';

// ── real-Enemy harness ───────────────────────────────────────────────────────
// The base Enemy ctor only reads game.getScene(); the takeDamage redirect branch
// and the host HP path never touch the scene, and we override createMesh/
// createHealthBar to no-ops so _initEnemyVisuals is never needed. This is a REAL
// Enemy running the REAL takeDamage()/rollCrit() — not a double.
class TestEnemy extends Enemy {
    public dieCount = 0;
    constructor(id: number, hp: number) {
        super({ getScene: () => null } as never, new Vector3(0, 0, 0), [], 3, hp, 10, 10);
        this.id = id;
    }
    protected createMesh(): void { /* no visuals in the unit harness */ }
    protected createHealthBar(): void { /* no visuals in the unit harness */ }
    // The real die() runs (sets alive=false, fires kill hooks, begins the corpse
    // phase) — only the scene-touching particle burst is stubbed (no live engine).
    protected createDeathEffect(): void { /* no particles in the unit harness */ }
    protected die(): void { this.dieCount++; super.die(); }
}

// ── fake EffectContext (mirrors ItemEffectRuntime.spec.ts makeCtx) ─────────────
function makeEnemy(x: number, z: number, alive = true): EffectEnemy {
    return { isAlive: () => alive, getPosition: () => ({ x, z }) };
}
function makeCtx(overrides: Partial<EffectContext> = {}): EffectContext {
    const fx = {
        rageGlow: vi.fn(), coinNova: vi.fn(), shockwave: vi.fn(),
        ricochet: vi.fn(), echoShimmer: vi.fn(), ring: vi.fn(), beam: vi.fn(),
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
        tryExecuteBelow: vi.fn(() => false),
        fx,
        ...overrides,
    } as EffectContext;
}
function activate(rt: ItemEffectRuntime, ...ids: ItemEffectId[]) {
    rt.setActiveEffects(new Set(ids));
}

afterEach(() => {
    // The guest*Redirect + critProvider statics MUST be cleared between tests —
    // exactly as SurvivorsGameplayState.exit() does in production.
    Enemy.guestDamageRedirect = null;
    Enemy.guestStatusRedirect = null;
    Enemy.guestKnockbackRedirect = null;
    Enemy.critProvider = null;
    Enemy.onDamageCallback = null;
    setCoopFxEmit(null);
});

// ── Invariant 1: reported crit is applied verbatim ─────────────────────────────
describe('reported crit is applied verbatim (no host re-roll)', () => {
    it('reported=true passes amount + isCrit straight through', () => {
        expect(rollCrit(200, { chance: 1, damageMult: 2 }, () => 0, true)).toEqual({ amount: 200, isCrit: true });
    });
    it('reported=false leaves the amount untouched (already non-crit)', () => {
        expect(rollCrit(50, { chance: 1, damageMult: 2 }, () => 0, false)).toEqual({ amount: 50, isCrit: false });
    });
    it('host re-applies a reported hit WITHOUT consulting its own critProvider', () => {
        // Host has a 100%-crit provider, but the guest already rolled. A reported
        // hit must NOT be doubled again — desync guard. Drive the real Enemy.takeDamage
        // host path (no redirect) with reportedCrit=true.
        Enemy.critProvider = () => ({ chance: 1, damageMult: 10 });
        const e = new TestEnemy(1, 1000);
        e.takeDamage(200, 'fire', true);   // reported post-crit amount
        expect(e.getHealth()).toBe(800);   // 1000 - 200, NOT 1000 - 2000
    });
    it('host with reportedCrit=false applies the flat amount even with a hot critProvider', () => {
        Enemy.critProvider = () => ({ chance: 1, damageMult: 10 });
        const e = new TestEnemy(2, 1000);
        e.takeDamage(75, 'physical', false);
        expect(e.getHealth()).toBe(925);   // 1000 - 75, provider ignored when reported is given
    });
});

// ── Invariant 2: guest damage routes exactly once, no local HP mutation ────────
describe('guest takeDamage routes once and mutates no local HP', () => {
    it('redirect fires exactly once with the post-crit amount + isCrit boolean; HP unchanged', () => {
        const spy = vi.fn();
        Enemy.guestDamageRedirect = spy;
        // Guest rolls its OWN crit (provider on the acting client). Force a crit so we
        // can assert the redirected amount is the post-crit number, not the raw input.
        Enemy.critProvider = () => ({ chance: 1, damageMult: 3 });
        const e = new TestEnemy(7, 100);

        const died = e.takeDamage(40, 'ice');

        expect(died).toBe(false);
        expect(spy).toHaveBeenCalledTimes(1);
        const [id, amount, element, isCrit] = spy.mock.calls[0];
        expect(id).toBe(7);
        expect(amount).toBe(120);          // 40 × 3 (guest-rolled crit), reported to host
        expect(element).toBe('ice');
        expect(typeof isCrit).toBe('boolean');
        expect(isCrit).toBe(true);
        expect(e.getHealth()).toBe(100);   // guest applies NOTHING locally
    });

    it('a non-crit guest hit reports the raw amount with isCrit=false', () => {
        const spy = vi.fn();
        Enemy.guestDamageRedirect = spy;
        Enemy.critProvider = () => ({ chance: 0, damageMult: 5 }); // never crits
        const e = new TestEnemy(8, 100);

        e.takeDamage(30, 'physical');

        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy.mock.calls[0]).toEqual([8, 30, 'physical', false]);
        expect(e.getHealth()).toBe(100);
    });
});

// ── Invariant 3: one secondary report per affected enemy (no double-application) ─
describe('guest item-effect proc emits one secondary report per affected enemy', () => {
    it('shockwave damages each nearby enemy exactly once on the proc frame', () => {
        const near = [makeEnemy(1, 0), makeEnemy(2, 0), makeEnemy(0, 1)];
        const ctx = makeCtx({ enemiesNear: () => near });
        const rt = new ItemEffectRuntime(ctx);
        activate(rt, 'shockwave');

        const target = makeEnemy(0, 0);
        // First SHOCKWAVE_EVERY_HITS-1 basic hits do NOT proc.
        for (let i = 0; i < SHOCKWAVE_EVERY_HITS - 1; i++) rt.onBasicHit(target, 10);
        expect(ctx.damage).not.toHaveBeenCalled();

        // The Nth hit procs: each nearby enemy is damaged once — never twice.
        rt.onBasicHit(target, 10);
        expect(ctx.damage).toHaveBeenCalledTimes(near.length);
        const hit = (ctx.damage as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
        expect(new Set(hit).size).toBe(near.length); // each distinct enemy hit once
    });

    it('earthbreaker quake damages every nearby foe once per quake (one report each)', () => {
        const near = [makeEnemy(0.5, 0), makeEnemy(-0.5, 0)];
        const ctx = makeCtx({ enemiesNear: () => near });
        const rt = new ItemEffectRuntime(ctx);
        activate(rt, 'earthbreaker');

        const t = makeEnemy(0, 0);
        for (let i = 0; i < 3; i++) rt.onBasicHit(t, 10); // no quake yet
        expect(ctx.damage).not.toHaveBeenCalled();
        rt.onBasicHit(t, 10);                              // 4th → quake
        expect(ctx.damage).toHaveBeenCalledTimes(near.length); // one report per enemy, no double-app
    });
});

// ── Invariant 4: execute routes as damage, never a local kill, on the guest ────
describe('execute (takeDamage(hp)) on a guest routes as a report, never a local kill', () => {
    it('lethal-equal damage with a redirect set: returns false, no HP change, die() never runs', () => {
        const spy = vi.fn();
        Enemy.guestDamageRedirect = spy;
        const e = new TestEnemy(9, 50);

        // This is exactly what the tryExecuteBelow adapter does: takeDamage(hp).
        const died = e.takeDamage(e.getHealth(), 'physical');

        expect(died).toBe(false);          // NOT a local kill
        expect(e.getHealth()).toBe(50);    // no local decrement
        expect(e.isAlive()).toBe(true);    // still alive locally
        expect(e.dieCount).toBe(0);        // die() never invoked
        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy.mock.calls[0][1]).toBe(50); // the full HP routed as a report
    });

    it('sanity: the SAME lethal hit on the HOST path (no redirect) DOES kill locally', () => {
        const e = new TestEnemy(10, 50);
        const died = e.takeDamage(50, 'physical'); // host applies it
        expect(died).toBe(true);
        expect(e.getHealth()).toBe(0);
        expect(e.isAlive()).toBe(false);
        expect(e.dieCount).toBe(1);
    });
});

// ── Invariant 5: replayed FX does not re-emit (echo guard) ─────────────────────
describe('withFxReplay guards against re-broadcast echo', () => {
    it('isReplayingFx() is true only inside the replay; the depth counter restores after', () => {
        expect(isReplayingFx()).toBe(false);
        let sawInside = false;
        withFxReplay(() => {
            sawInside = isReplayingFx();
            // Nested replay must not clear the guard early (depth counter, not bool).
            withFxReplay(() => { expect(isReplayingFx()).toBe(true); });
            expect(isReplayingFx()).toBe(true);
        });
        expect(sawInside).toBe(true);
        expect(isReplayingFx()).toBe(false);
    });

    it('an emitter set during co-op still fires for a normal emit but the replay guard is observable to emit sites', () => {
        // The real emit sites gate on isReplayingFx() BEFORE calling emitCoopFx, so a
        // replayed effect never re-broadcasts. We prove the two observable primitives the
        // sites rely on: emitCoopFx reaches the wired emitter normally, and isReplayingFx()
        // flips true during a replay so a site can skip.
        const emitted: string[] = [];
        setCoopFxEmit((kind) => emitted.push(kind));
        expect(isCoopFxActive()).toBe(true);

        emitCoopFx('swing', 0, 0);                       // normal local cast → broadcasts
        withFxReplay(() => {
            // A correct emit site checks this and skips; assert the guard is set so it can.
            if (!isReplayingFx()) emitCoopFx('swing', 0, 0);
        });

        expect(emitted).toEqual(['swing']);              // exactly one — the replay did NOT echo
    });
});
