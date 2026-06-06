import { describe, it, expect } from 'vitest';
import { diffSnapshot, applyDelta } from '../src/net/SnapshotDelta';
import type { SnapshotMsg } from '../src/net/Protocol';

function makeSnapshot(overrides: Partial<SnapshotMsg> = {}): SnapshotMsg {
    return {
        t: 'snapshot',
        tick: 1,
        ackSeq: 0,
        timeScale: 1,
        heroes: [
            { id: 0, x: 0, y: 0, z: 0, ry: 0, hp: 100, anim: 0, dx: 0, dz: 0, alive: true, level: 1, xp: 0 },
        ],
        enemies: [],
        wave: { n: 1, alive: 0, inProgress: 0, breather: 0 },
        ...overrides,
    };
}

describe('diffSnapshot / applyDelta — round-trip', () => {
    it('identical base/next produces empty delta and round-trips correctly', () => {
        const s = makeSnapshot({ tick: 5, ackSeq: 3 });
        const delta = diffSnapshot(s, s);

        expect(delta.t).toBe('snapshotDelta');
        expect(delta.baseTick).toBe(5);
        expect(delta.tick).toBe(5);
        expect(delta.changedEnemies).toEqual([]);
        expect(delta.removedEnemyIds).toEqual([]);

        const reconstructed = applyDelta(s, delta);
        expect(reconstructed).toEqual(s);
    });

    it('empty delta: changedEnemies [] and removedEnemyIds []', () => {
        const s = makeSnapshot({ enemies: [{ id: 1, x: 1, z: 1, ry: 0, hp: 50, flags: 0, anim: 0 }] });
        const delta = diffSnapshot(s, s);
        expect(delta.changedEnemies).toEqual([]);
        expect(delta.removedEnemyIds).toEqual([]);
    });

    it('enemy moved — 1 changed, 0 removed, round-trip matches', () => {
        const base = makeSnapshot({
            tick: 10,
            enemies: [{ id: 42, x: 0, z: 0, ry: 0, hp: 80, flags: 0, anim: 1 }],
        });
        const next = makeSnapshot({
            tick: 11,
            enemies: [{ id: 42, x: 5, z: 3, ry: 1.5, hp: 80, flags: 0, anim: 1 }],
        });

        const delta = diffSnapshot(base, next);
        expect(delta.changedEnemies).toHaveLength(1);
        expect(delta.changedEnemies[0].id).toBe(42);
        expect(delta.removedEnemyIds).toEqual([]);

        const reconstructed = applyDelta(base, delta);
        expect(reconstructed).toEqual(next);
    });

    it('enemy added — appears in changedEnemies, round-trip matches', () => {
        const base = makeSnapshot({ tick: 10, enemies: [] });
        const next = makeSnapshot({
            tick: 11,
            enemies: [{ id: 7, x: 2, z: 4, ry: 0, hp: 30, flags: 0, anim: 0 }],
        });

        const delta = diffSnapshot(base, next);
        expect(delta.changedEnemies).toHaveLength(1);
        expect(delta.changedEnemies[0].id).toBe(7);
        expect(delta.removedEnemyIds).toEqual([]);

        expect(applyDelta(base, delta)).toEqual(next);
    });

    it('enemy removed — id in removedEnemyIds, round-trip matches', () => {
        const base = makeSnapshot({
            tick: 10,
            enemies: [{ id: 3, x: 0, z: 0, ry: 0, hp: 20, flags: 0, anim: 0 }],
        });
        const next = makeSnapshot({ tick: 11, enemies: [] });

        const delta = diffSnapshot(base, next);
        expect(delta.changedEnemies).toEqual([]);
        expect(delta.removedEnemyIds).toContain(3);

        expect(applyDelta(base, delta)).toEqual(next);
    });

    it('mixed: one moved, one added, one removed — round-trip matches', () => {
        const base = makeSnapshot({
            tick: 20,
            enemies: [
                { id: 1, x: 0, z: 0, ry: 0, hp: 50, flags: 0, anim: 0 },
                { id: 2, x: 1, z: 1, ry: 0, hp: 30, flags: 0, anim: 1 }, // will be removed
            ],
        });
        const next = makeSnapshot({
            tick: 21,
            enemies: [
                { id: 1, x: 10, z: 5, ry: 0.5, hp: 50, flags: 0, anim: 0 }, // moved
                { id: 3, x: 3, z: 3, ry: 0, hp: 20, flags: 0, anim: 0 },    // added
            ],
        });

        const delta = diffSnapshot(base, next);
        expect(delta.changedEnemies).toHaveLength(2);
        const ids = delta.changedEnemies.map(e => e.id);
        expect(ids).toContain(1);
        expect(ids).toContain(3);
        expect(delta.removedEnemyIds).toContain(2);

        expect(applyDelta(base, delta)).toEqual(next);
    });

    it('unchanged enemy is NOT in changedEnemies and carries over in reconstruct', () => {
        const unchanged = { id: 99, x: 5, z: 5, ry: 0, hp: 40, flags: 0, anim: 0 };
        const base = makeSnapshot({
            tick: 10,
            enemies: [
                unchanged,
                { id: 100, x: 0, z: 0, ry: 0, hp: 10, flags: 0, anim: 0 },
            ],
        });
        const next = makeSnapshot({
            tick: 11,
            enemies: [
                unchanged,
                { id: 100, x: 2, z: 2, ry: 1, hp: 9, flags: 0, anim: 1 },
            ],
        });

        const delta = diffSnapshot(base, next);
        expect(delta.changedEnemies).toHaveLength(1);
        expect(delta.changedEnemies[0].id).toBe(100);
        expect(delta.removedEnemyIds).toEqual([]);

        const reconstructed = applyDelta(base, delta);
        expect(reconstructed.enemies).toContainEqual(unchanged);
        expect(reconstructed).toEqual(next);
    });

    it('hero hp and position change — carried in delta, round-trip matches', () => {
        const base = makeSnapshot({
            tick: 5,
            heroes: [{ id: 0, x: 0, y: 0, z: 0, ry: 0, hp: 100, anim: 0, dx: 0, dz: 0, alive: true, level: 1, xp: 0 }],
        });
        const next = makeSnapshot({
            tick: 6,
            heroes: [{ id: 0, x: 3, y: 0, z: 2, ry: 0.7, hp: 85, anim: 1, dx: 0.5, dz: 0.5, alive: true, level: 1, xp: 0.3 }],
        });

        const delta = diffSnapshot(base, next);
        expect(delta.heroes).toEqual(next.heroes);

        expect(applyDelta(base, delta)).toEqual(next);
    });

    it('delta baseTick and tick are set correctly', () => {
        const base = makeSnapshot({ tick: 100 });
        const next = makeSnapshot({ tick: 101 });
        const delta = diffSnapshot(base, next);
        expect(delta.baseTick).toBe(100);
        expect(delta.tick).toBe(101);
    });

    it('delta carries ackSeq and timeScale from next snapshot', () => {
        const base = makeSnapshot({ tick: 1, ackSeq: 5, timeScale: 1 });
        const next = makeSnapshot({ tick: 2, ackSeq: 8, timeScale: 0.5 });
        const delta = diffSnapshot(base, next);
        expect(delta.ackSeq).toBe(8);
        expect(delta.timeScale).toBe(0.5);
    });

    it('flags or anim change marks enemy as changed', () => {
        const base = makeSnapshot({
            tick: 10,
            enemies: [{ id: 5, x: 0, z: 0, ry: 0, hp: 50, flags: 0, anim: 0 }],
        });
        const next = makeSnapshot({
            tick: 11,
            enemies: [{ id: 5, x: 0, z: 0, ry: 0, hp: 50, flags: 2, anim: 0 }],
        });

        const delta = diffSnapshot(base, next);
        expect(delta.changedEnemies).toHaveLength(1);
        expect(applyDelta(base, delta)).toEqual(next);
    });
});
