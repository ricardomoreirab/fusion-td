import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { pickCastTarget, type PowerContext } from '../src/survivors/powers/PowerDefinitions';
import type { Enemy } from '../src/survivors/enemies/Enemy';

// pickCastTarget is the single target scan behind every autocast power. Its whole
// job is to make PowerSlotManager's fire gate and the cast's own targeting agree:
// whenever they disagreed, the champion played the shot animation and no
// projectile came out. Two disagreements shipped — a fusion whose archetype
// scanned a hardcoded 12u while the gate used the fusion's advertised (up to 18u)
// reach, and a wind-up long enough for the hero to run the target out of range.

function fakeEnemy(x: number, alive = true): Enemy {
    const position = new Vector3(x, 0, 0);
    return { alive, position, isAlive: () => alive, getPosition: () => position } as unknown as Enemy;
}

function ctxWith(range: number, enemies: Enemy[], committedTarget?: Enemy | null): PowerContext {
    return {
        scene: null as never,
        heroPosition: new Vector3(0, 0, 0),
        enemies,
        damageMultiplier: 1,
        element: 'physical',
        range,
        committedTarget,
    };
}

describe('pickCastTarget', () => {
    it('picks the nearest live enemy inside the slot\'s reach', () => {
        const far = fakeEnemy(9);
        const near = fakeEnemy(4);
        expect(pickCastTarget(ctxWith(12, [far, near]))).toBe(near);
    });

    it('skips the dead', () => {
        const corpse = fakeEnemy(2, false);
        const live = fakeEnemy(7);
        expect(pickCastTarget(ctxWith(12, [corpse, live]))).toBe(live);
    });

    it('scans the SLOT\'s reach, not a hardcoded one', () => {
        // A ranger fusion advertises max(parent ranges) — up to 18u — and the cast
        // gate fires at that distance. An archetype that scanned its own 12u
        // instead came up empty between 12u and 18u: animation, no arrow.
        const target = fakeEnemy(15);
        expect(pickCastTarget(ctxWith(12, [target]))).toBeNull();
        expect(pickCastTarget(ctxWith(18, [target]))).toBe(target);
    });

    it('honours a committed target that has drifted out of reach', () => {
        const committed = fakeEnemy(14);
        expect(pickCastTarget(ctxWith(11, [committed], committed))).toBe(committed);
    });

    it('falls back to its own scan when the committed target is dead', () => {
        const committed = fakeEnemy(14, false);
        const other = fakeEnemy(6);
        expect(pickCastTarget(ctxWith(11, [committed, other], committed))).toBe(other);
    });

    it('returns null when the arena is empty inside the reach', () => {
        expect(pickCastTarget(ctxWith(11, [fakeEnemy(30)]))).toBeNull();
    });
});
