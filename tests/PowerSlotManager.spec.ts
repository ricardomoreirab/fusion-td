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
            () => [{ isAlive: () => true, getPosition: () => new Vector3(1, 0, 0) } as unknown as import('../src/survivors/enemies/Enemy').Enemy],
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
            () => [{ isAlive: () => true, getPosition: () => new Vector3(1, 0, 0) } as unknown as import('../src/survivors/enemies/Enemy').Enemy],
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
        let dist = 15;
        const enemy = {
            isAlive: () => true,
            getPosition: () => new Vector3(dist, 0, 0),
        } as unknown as FakeEnemy;
        const mgr = new PowerSlotManager(host, () => new Vector3(0, 0, 0), () => [enemy]);
        const cast = vi.fn();
        mgr.getSlots()[0] = { def: rangedDef(11, cast), state: { level: 1, cooldownRemaining: 0 } };

        mgr.update(0.016);
        expect(cast).not.toHaveBeenCalled();
        expect(mgr.getSlots()[0]!.state.cooldownRemaining).toBeLessThanOrEqual(0);

        dist = 6; // enemy closes to inside the 11u reach
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

    it('allows a 1u wind-up margin so an enemy arriving mid-animation still gets hit', () => {
        const mgr = managerWithEnemyAt(11.5); // just past an 11u power
        const cast = vi.fn();
        mgr.getSlots()[0] = { def: rangedDef(11, cast), state: { level: 1, cooldownRemaining: 0 } };

        mgr.update(0.016);

        expect(cast).toHaveBeenCalledTimes(1);
    });
});
