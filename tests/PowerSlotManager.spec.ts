import { describe, it, expect, vi } from 'vitest';
import { Vector3 } from 'three';
import { SceneHost } from '../src/engine/three/SceneHost';
import { PowerSlotManager } from '../src/survivors/powers/PowerSlotManager';
import type { PowerDefinition } from '../src/survivors/powers/PowerDefinitions';

// Regression guard for the Whirling Blades fix.
//
// Whirling Blades is a persistent orbiting-blades power: it must update EVERY
// frame (so the blades spin even with no enemy nearby) and must NOT trigger the
// hero special-attack animation every cooldown. Previously its movement lived in
// an autocast cast() — so the blades only moved every 0.25s when an enemy was in
// range (looked frozen) and the cast callback fired the attack animation 4×/sec.
//
// The fix: a per-frame `tick` hook that runs unconditionally, and gating the
// onCast callback so only a real cast() drives the animation.

const host = new SceneHost();

function makeManager() {
    return new PowerSlotManager(
        host,
        () => new Vector3(0, 0, 0),
        () => [], // no enemies in range
    );
}

function tickPower(tickSpy: PowerDefinition['tick']): PowerDefinition {
    return {
        id: 'tick_power', name: 'Tick Power', element: 'physical', icon: 'T',
        baseCooldown: 0.25, baseDamage: 4, baseRange: 2.5, maxLevel: 5, mode: 'autocast',
        cooldownFor: (s) => 0.25 * Math.pow(0.92, s.level - 1),
        damageFor: (s) => 4 * Math.pow(1.25, s.level - 1),
        tick: tickSpy,
    };
}

describe('PowerSlotManager — tick powers', () => {
    it('calls tick every frame, even with no enemy in range', () => {
        const mgr = makeManager();
        const tick = vi.fn();
        mgr.getSlots()[0] = { def: tickPower(tick), state: { level: 1, cooldownRemaining: 0.25 } };

        mgr.update(0.016);
        mgr.update(0.016);
        mgr.update(0.016);

        expect(tick).toHaveBeenCalledTimes(3);
        // dt is forwarded so movement uses the real frame delta.
        expect(tick).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), 0.016);
    });

    it('does NOT fire the onCast callback for a tick power with no cast()', () => {
        const mgr = makeManager();
        const onCast = vi.fn();
        mgr.setOnCast(onCast);
        mgr.getSlots()[0] = { def: tickPower(vi.fn()), state: { level: 1, cooldownRemaining: 0 } };

        // Drive well past several cooldown windows.
        for (let i = 0; i < 60; i++) mgr.update(0.016);

        expect(onCast).not.toHaveBeenCalled();
    });

    it('still fires onCast for a real autocast cast() when a target is in range', () => {
        const cast = vi.fn();
        const onCast = vi.fn();
        const mgr = new PowerSlotManager(
            host,
            () => new Vector3(0, 0, 0),
            // one "enemy" within range
            () => [{ alive: true, position: new Vector3(1, 0, 0), isAlive: () => true, getPosition: () => new Vector3(1, 0, 0) } as unknown as import('../src/survivors/enemies/Enemy').Enemy],
        );
        mgr.setOnCast(onCast);
        const def: PowerDefinition = {
            id: 'cast_power', name: 'Cast Power', element: 'fire', icon: 'C',
            baseCooldown: 0.25, baseDamage: 4, baseRange: 2.5, maxLevel: 5, mode: 'autocast',
            cooldownFor: () => 0.25, damageFor: () => 4, cast,
        };
        mgr.getSlots()[0] = { def, state: { level: 1, cooldownRemaining: 0 } };

        mgr.update(0.016);

        expect(cast).toHaveBeenCalledTimes(1);
        expect(onCast).toHaveBeenCalledTimes(1);
    });
});

describe('PowerSlotManager — recastFree (Echo item effect)', () => {
    // Adapted from the plan's `makeManagerWithCastingDef` placeholder: build a
    // manager with one enemy in range (so autocast fires) and a cast-spy def,
    // wired into slot 0 directly like the other suites in this file.
    function makeManagerWithCastingDef() {
        const castSpy = vi.fn();
        const def: PowerDefinition = {
            id: 'echo_power', name: 'Echo Power', element: 'fire', icon: 'E',
            baseCooldown: 0.25, baseDamage: 4, baseRange: 2.5, maxLevel: 5, mode: 'autocast',
            cooldownFor: () => 0.25, damageFor: () => 4, cast: castSpy,
        };
        const manager = new PowerSlotManager(
            host,
            () => new Vector3(0, 0, 0),
            // one "enemy" within range so autocast actually fires
            () => [{ alive: true, position: new Vector3(1, 0, 0), isAlive: () => true, getPosition: () => new Vector3(1, 0, 0) } as unknown as import('../src/survivors/enemies/Enemy').Enemy],
        );
        return { manager, def, castSpy };
    }

    it('recasts the most recent cast without resetting cooldown or firing onCast', () => {
        const { manager, def, castSpy } = makeManagerWithCastingDef();
        const onCast = vi.fn();
        manager.setOnCast(onCast);
        manager.getSlots()[0] = { def, state: { level: 1, cooldownRemaining: 0 } };

        // Drive update() until the slot casts once (cooldown ready on first frame).
        manager.update(0.016);
        const castsAfterFirst = castSpy.mock.calls.length;
        const onCastAfterFirst = onCast.mock.calls.length;
        const cdAfterFirst = manager.getSlots()[0]!.state.cooldownRemaining;
        expect(castsAfterFirst).toBe(1);

        expect(manager.recastFree()).toBe(true);
        expect(castSpy.mock.calls.length).toBe(castsAfterFirst + 1);
        expect(onCast.mock.calls.length).toBe(onCastAfterFirst);      // NOT re-fired
        expect(manager.getSlots()[0]!.state.cooldownRemaining).toBe(cdAfterFirst);
    });

    it('returns false when nothing has cast yet', () => {
        const { manager } = makeManagerWithCastingDef();
        expect(manager.recastFree()).toBe(false);
    });
});

describe('Whirling Blades — per-level blade count', () => {
    const bladeCount = (mgr: PowerSlotManager) =>
        (mgr.getSlots()[0]!.state.data!['blades'] as unknown[]).length;

    it('starts with 2 blades and adds one per level (reactively, no re-init)', () => {
        const mgr = new PowerSlotManager(host, () => new Vector3(0, 0, 0), () => []);
        expect(mgr.addPower('mage_physical')).toBe(true);

        mgr.update(0.016);
        expect(bladeCount(mgr)).toBe(2); // level 1

        mgr.levelUp('mage_physical');
        mgr.update(0.016);
        expect(bladeCount(mgr)).toBe(3); // level 2

        mgr.levelUp('mage_physical');
        mgr.update(0.016);
        expect(bladeCount(mgr)).toBe(4); // level 3
    });
});

describe('PowerSlotManager — per-power cast range gate', () => {
    type FakeEnemy = import('../src/survivors/enemies/Enemy').Enemy;

    /** One stationary enemy `dist` units east of the hero at the origin. */
    function managerWithEnemyAt(dist: number) {
        const enemy = {
            alive: true,
            position: new Vector3(dist, 0, 0),
            isAlive: () => true,
            getPosition: () => new Vector3(dist, 0, 0),
        } as unknown as FakeEnemy;
        return new PowerSlotManager(host, () => new Vector3(0, 0, 0), () => [enemy]);
    }

    function rangedDef(baseRange: number, cast: PowerDefinition['cast']): PowerDefinition {
        return {
            id: 'ranged_power', name: 'Ranged Power', element: 'ice', icon: 'R',
            baseCooldown: 0.25, baseDamage: 4, baseRange, maxLevel: 5, mode: 'autocast',
            cooldownFor: () => 0.25, damageFor: () => 4, cast,
        };
    }

    it('does not cast — or animate — at an enemy beyond the power\'s own range', () => {
        // The bug: a single shared 20u radius let ANY slot fire whenever anything
        // was loosely nearby. An 11u power then played the cast animation at an
        // enemy 15u out and its cast() silently found no target.
        const mgr = managerWithEnemyAt(15);
        const cast = vi.fn();
        const onCast = vi.fn();
        mgr.setOnCast(onCast);
        mgr.getSlots()[0] = { def: rangedDef(11, cast), state: { level: 1, cooldownRemaining: 0 } };

        for (let i = 0; i < 30; i++) mgr.update(0.016);

        expect(cast).not.toHaveBeenCalled();
        expect(onCast).not.toHaveBeenCalled();
    });

    it('holds the cooldown while out of range so it fires the instant range is met', () => {
        // The scan reads `alive`/`position` directly (megamorphic-accessor rule),
        // so the double has to MOVE its own vector — a getPosition() that computes
        // a fresh answer is invisible to it.
        const pos = new Vector3(15, 0, 0);
        const enemy = {
            alive: true,
            position: pos,
            isAlive: () => true,
            getPosition: () => pos,
        } as unknown as FakeEnemy;
        const mgr = new PowerSlotManager(host, () => new Vector3(0, 0, 0), () => [enemy]);
        const cast = vi.fn();
        mgr.getSlots()[0] = { def: rangedDef(11, cast), state: { level: 1, cooldownRemaining: 0 } };

        mgr.update(0.016);
        expect(cast).not.toHaveBeenCalled();
        expect(mgr.getSlots()[0]!.state.cooldownRemaining).toBeLessThanOrEqual(0);

        pos.set(6, 0, 0); // enemy closes to inside the 11u reach
        mgr.update(0.016);
        expect(cast).toHaveBeenCalledTimes(1);
    });

    it('gates each slot on ITS OWN range, not a shared radius', () => {
        const mgr = managerWithEnemyAt(13);
        const shortCast = vi.fn();
        const longCast = vi.fn();
        mgr.getSlots()[0] = { def: { ...rangedDef(4.5, shortCast), id: 'short' }, state: { level: 1, cooldownRemaining: 0 } };
        mgr.getSlots()[1] = { def: { ...rangedDef(18, longCast), id: 'long' }, state: { level: 1, cooldownRemaining: 0 } };

        mgr.update(0.016);

        expect(shortCast).not.toHaveBeenCalled();
        expect(longCast).toHaveBeenCalledTimes(1);
    });

    it('gives the gate NO slack over the power\'s own range', () => {
        // The gate used to add a 1u wind-up margin, on the theory that a closing
        // enemy would arrive by the release point. When it did not — a kiting
        // hero, a ranged enemy holding its distance — the cast() scan came up
        // empty and the champion mimed the shot. Slack belongs in the commitment
        // (below), not in the gate.
        const mgr = managerWithEnemyAt(11.5); // just past an 11u power
        const cast = vi.fn();
        const onCast = vi.fn();
        mgr.setOnCast(onCast);
        mgr.getSlots()[0] = { def: rangedDef(11, cast), state: { level: 1, cooldownRemaining: 0 } };

        mgr.update(0.016);

        expect(cast).not.toHaveBeenCalled();
        expect(onCast).not.toHaveBeenCalled();
    });

    it('hands the cast the target it gated on, so gate and cast cannot disagree', () => {
        const mgr = managerWithEnemyAt(9);
        const cast = vi.fn();
        mgr.getSlots()[0] = { def: rangedDef(11, cast), state: { level: 1, cooldownRemaining: 0 } };

        mgr.update(0.016);

        const ctx = cast.mock.calls[0][1];
        expect(ctx.range).toBe(11);                       // the slot's own reach
        expect(ctx.committedTarget?.position.x).toBe(9);
    });
});

describe('PowerSlotManager — the cast animation\'s wind-up commitment', () => {
    type FakeEnemy = import('../src/survivors/enemies/Enemy').Enemy;

    /** Hero + one enemy, both movable, and a cast wind-up of `delay` seconds. */
    function scene(delay: number, startDist: number) {
        const heroPos = new Vector3(0, 0, 0);
        const enemyPos = new Vector3(startDist, 0, 0);
        const enemy = {
            alive: true,
            position: enemyPos,
            isAlive: () => enemy.alive,
            getPosition: () => enemyPos,
        } as unknown as FakeEnemy & { alive: boolean };
        const mgr = new PowerSlotManager(host, () => heroPos, () => [enemy]);
        mgr.setCastDelayProvider(() => delay);
        const cast = vi.fn();
        mgr.getSlots()[0] = {
            def: {
                id: 'wind_up', name: 'Wind Up', element: 'ice', icon: 'W',
                baseCooldown: 5, baseDamage: 4, baseRange: 11, maxLevel: 5, mode: 'autocast',
                cooldownFor: () => 5, damageFor: () => 4, cast,
            },
            state: { level: 1, cooldownRemaining: 0 },
        };
        return { mgr, cast, heroPos, enemy };
    }

    it('fires at the committed target even though the hero ran out of range mid-wind-up', () => {
        // THE ranger bug: the animation starts with the target at 9u, the hero
        // backpedals ~3u over the 0.35s draw, and the release-time scan — which
        // only ever looked inside 11u from wherever the hero now stands — found
        // nothing and dropped the shot the animation had already promised.
        const { mgr, cast, heroPos } = scene(0.35, 9);

        mgr.update(0.016);
        expect(cast).not.toHaveBeenCalled(); // still winding up

        heroPos.set(-3, 0, 0); // enemy is now 12u out, past the 11u reach
        for (let i = 0; i < 30; i++) mgr.update(0.016);

        expect(cast).toHaveBeenCalledTimes(1);
        expect(cast.mock.calls[0][1].committedTarget?.position.x).toBe(9);
    });

    it('releases the commitment when the committed target dies mid-wind-up', () => {
        const { mgr, cast, enemy } = scene(0.35, 9);

        mgr.update(0.016);
        enemy.alive = false;
        for (let i = 0; i < 30; i++) mgr.update(0.016);

        // The cast still runs — it may find another target — but it must not be
        // handed a corpse to home in on.
        expect(cast).toHaveBeenCalledTimes(1);
        expect(cast.mock.calls[0][1].committedTarget).toBeNull();
    });
});

// Regression guard: every cast gets its OWN PowerContext.
//
// A power's cast() registers an onBeforeRender observer that keeps the context
// alive for the projectile's whole flight and reads ctx.element off it on every
// frame — that is what colours the damage numbers and the element-tinted impact
// FX. update() used to build ONE context lazily and hand it to every slot that
// fired in the same tick, so the second slot's `ctx.element = ...` silently
// repainted the first slot's in-flight projectile.
describe('PowerSlotManager — per-cast context isolation', () => {
    type FakeEnemy = import('../src/survivors/enemies/Enemy').Enemy;

    /** Manager with one enemy well inside every power's range. */
    function managerOn(scene: SceneHost) {
        const enemy = {
            alive: true,
            position: new Vector3(1, 0, 0),
            isAlive: () => true,
            getPosition: () => new Vector3(1, 0, 0),
        } as unknown as FakeEnemy;
        return new PowerSlotManager(scene, () => new Vector3(0, 0, 0), () => [enemy]);
    }

    function elementDef(
        id: string,
        element: PowerDefinition['element'],
        cast: PowerDefinition['cast'],
    ): PowerDefinition {
        return {
            id, name: id, element, icon: 'X',
            baseCooldown: 0.25, baseDamage: 4, baseRange: 12, maxLevel: 5, mode: 'autocast',
            cooldownFor: () => 0.25, damageFor: () => 4, cast,
        };
    }

    it('two slots firing in the SAME tick each keep their own element', () => {
        const scene = new SceneHost();
        const mgr = managerOn(scene);
        // Capture the context REFERENCE, exactly like a projectile observer's
        // closure does — the bug is in what it reads later, not at call time.
        const seenAtCast: string[] = [];
        const held: { element: string }[] = [];
        const capture = (element: string) => ((_s: unknown, ctx: { element: string }) => {
            seenAtCast.push(ctx.element);
            held.push(ctx);
            void element;
        }) as unknown as PowerDefinition['cast'];

        mgr.getSlots()[0] = {
            def: elementDef('fire_slot', 'fire', capture('fire')),
            state: { level: 1, cooldownRemaining: 0 },
        };
        mgr.getSlots()[1] = {
            def: elementDef('ice_slot', 'ice', capture('ice')),
            state: { level: 1, cooldownRemaining: 0 },
        };

        mgr.update(0.016);

        expect(seenAtCast).toEqual(['fire', 'ice']);
        expect(held).toHaveLength(2);
        // The retained references must be DISTINCT objects...
        expect(held[0]).not.toBe(held[1]);
        // ...and each must still report its own element after the tick, which is
        // what the in-flight projectile reads every frame.
        expect(held[0].element).toBe('fire');
        expect(held[1].element).toBe('ice');
    });

    it('a retained context still reads its own element from a later frame observer', () => {
        const scene = new SceneHost();
        const mgr = managerOn(scene);
        // Mirror the real thing: cast() registers a per-frame observer off
        // ctx.scene and reports ctx.element on every subsequent frame.
        const observed: Record<string, string[]> = { fire_slot: [], storm_slot: [] };
        const castWithObserver = (id: string) => ((
            _s: unknown,
            ctx: { element: string; scene: SceneHost },
        ) => {
            ctx.scene.onBeforeRender.add(() => observed[id].push(ctx.element));
        }) as unknown as PowerDefinition['cast'];

        mgr.getSlots()[0] = {
            def: elementDef('fire_slot', 'fire', castWithObserver('fire_slot')),
            state: { level: 1, cooldownRemaining: 0 },
        };
        mgr.getSlots()[1] = {
            def: elementDef('storm_slot', 'storm', castWithObserver('storm_slot')),
            state: { level: 1, cooldownRemaining: 0 },
        };

        mgr.update(0.016);   // both cast, both register a flight observer
        scene.tick(0.016);   // one "flight" frame
        scene.tick(0.016);   // another

        expect(observed.fire_slot).toEqual(['fire', 'fire']);
        expect(observed.storm_slot).toEqual(['storm', 'storm']);
    });

    it('forceCastAutocastSlots gives every slot in the burst its own context', () => {
        const scene = new SceneHost();
        const mgr = managerOn(scene);
        const held: { element: string }[] = [];
        const capture = (() => ((_s: unknown, ctx: { element: string }) => {
            held.push(ctx);
        }) as unknown as PowerDefinition['cast'])();

        mgr.getSlots()[0] = { def: elementDef('a', 'fire', capture), state: { level: 1, cooldownRemaining: 9 } };
        mgr.getSlots()[1] = { def: elementDef('b', 'ice', capture), state: { level: 1, cooldownRemaining: 9 } };
        mgr.getSlots()[2] = { def: elementDef('c', 'arcane', capture), state: { level: 1, cooldownRemaining: 9 } };

        expect(mgr.forceCastAutocastSlots()).toBe(3);
        expect(held.map(c => c.element)).toEqual(['fire', 'ice', 'arcane']);
        expect(new Set(held).size).toBe(3); // three distinct objects
    });

    it('the per-frame tick context is still REUSED (the allocation fix stays)', () => {
        const scene = new SceneHost();
        const mgr = managerOn(scene);
        const seen: unknown[] = [];
        const def: PowerDefinition = {
            id: 'ticker', name: 'ticker', element: 'physical', icon: 'T',
            baseCooldown: 0.25, baseDamage: 4, baseRange: 12, maxLevel: 5, mode: 'autocast',
            cooldownFor: () => 0.25, damageFor: () => 4,
            tick: (_s, ctx) => { seen.push(ctx); },
        };
        mgr.getSlots()[0] = { def, state: { level: 1, cooldownRemaining: 9 } };

        mgr.update(0.016);
        mgr.update(0.016);
        mgr.update(0.016);

        expect(seen).toHaveLength(3);
        expect(new Set(seen).size).toBe(1); // same object every frame
    });
});
