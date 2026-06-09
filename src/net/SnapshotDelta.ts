// Pure snapshot delta-compression codec. No Babylon, safe for Vitest.
import type { SnapshotMsg, SnapshotHero, SnapshotEnemy } from './Protocol';

export interface SnapshotDelta {
    t: 'snapshotDelta';
    baseTick: number;
    tick: number;
    ackSeq: number;
    timeScale: number;
    /** Full hero list (only 2 heroes — cheap to send whole). */
    heroes: SnapshotHero[];
    /** Enemies that are new or changed vs base. */
    changedEnemies: SnapshotEnemy[];
    /** IDs of enemies present in base but absent from next. */
    removedEnemyIds: number[];
    wave: SnapshotMsg['wave'];
}

function enemyChanged(a: SnapshotEnemy, b: SnapshotEnemy): boolean {
    return (
        a.x !== b.x ||
        a.z !== b.z ||
        a.y !== b.y ||
        a.ry !== b.ry ||
        a.hp !== b.hp ||
        a.flags !== b.flags ||
        a.anim !== b.anim ||
        a.shield !== b.shield
    );
}

/**
 * Build a delta from base → next.
 * An enemy is "changed" if absent from base or any of x/z/ry/hp/flags/anim differ.
 * An unchanged enemy is carried forward implicitly (not in changedEnemies, not in removedEnemyIds).
 */
export function diffSnapshot(base: SnapshotMsg, next: SnapshotMsg): SnapshotDelta {
    const baseMap = new Map<number, SnapshotEnemy>();
    for (const e of base.enemies) baseMap.set(e.id, e);

    const nextMap = new Map<number, SnapshotEnemy>();
    for (const e of next.enemies) nextMap.set(e.id, e);

    const changedEnemies: SnapshotEnemy[] = [];
    for (const [id, nextEnemy] of nextMap) {
        const baseEnemy = baseMap.get(id);
        if (!baseEnemy || enemyChanged(baseEnemy, nextEnemy)) {
            changedEnemies.push(nextEnemy);
        }
    }

    const removedEnemyIds: number[] = [];
    for (const id of baseMap.keys()) {
        if (!nextMap.has(id)) removedEnemyIds.push(id);
    }

    return {
        t: 'snapshotDelta',
        baseTick: base.tick,
        tick: next.tick,
        ackSeq: next.ackSeq,
        timeScale: next.timeScale,
        heroes: next.heroes,
        changedEnemies,
        removedEnemyIds,
        wave: next.wave,
    };
}

/**
 * Apply a delta onto a base snapshot to reconstruct the next full snapshot.
 * Caller must hold the base whose tick === delta.baseTick.
 */
export function applyDelta(base: SnapshotMsg, delta: SnapshotDelta): SnapshotMsg {
    // Start from base enemies, apply removals, then upsert changed.
    const removed = new Set(delta.removedEnemyIds);
    const upsertMap = new Map<number, SnapshotEnemy>();
    for (const e of delta.changedEnemies) upsertMap.set(e.id, e);

    const enemies: SnapshotEnemy[] = [];
    for (const e of base.enemies) {
        if (removed.has(e.id)) continue;
        enemies.push(upsertMap.has(e.id) ? upsertMap.get(e.id)! : e);
        upsertMap.delete(e.id);
    }
    // Append brand-new enemies (those that were in changedEnemies but not in base).
    for (const e of upsertMap.values()) {
        enemies.push(e);
    }

    return {
        t: 'snapshot',
        tick: delta.tick,
        ackSeq: delta.ackSeq,
        timeScale: delta.timeScale,
        heroes: delta.heroes,
        enemies,
        wave: delta.wave,
    };
}
