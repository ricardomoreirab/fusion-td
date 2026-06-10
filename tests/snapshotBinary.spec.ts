import { describe, it, expect } from 'vitest';
import {
    encodeSnapshot, decodeSnapshot,
    encodeSnapshotDelta, decodeSnapshotDelta,
    decodeBinaryMessage,
} from '../src/net/SnapshotBinary';
import type { SnapshotMsg, SnapshotHero, SnapshotEnemy } from '../src/net/Protocol';
import type { SnapshotDelta } from '../src/net/SnapshotDelta';

/** Deep-map every number through Math.fround — what a value looks like after an
 *  f32 round-trip. Integer fields (ids/ticks/flags) are < 2^24 in these tests,
 *  so fround is the identity for them and the helper stays generic. */
function f32<T>(v: T): T {
    if (typeof v === 'number') return Math.fround(v) as unknown as T;
    if (Array.isArray(v)) return v.map(f32) as unknown as T;
    if (v !== null && typeof v === 'object') {
        const out: Record<string, unknown> = {};
        for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = f32(val);
        return out as unknown as T;
    }
    return v;
}

function makeHero(overrides: Partial<SnapshotHero> = {}): SnapshotHero {
    return {
        id: 0, x: 1.5, y: 0, z: -2.0, ry: 0.7, hp: 85.5, anim: 1,
        dx: 0.6, dz: -0.8, alive: true, level: 5, xp: 0.42,
        ...overrides,
    };
}

function makeEnemy(overrides: Partial<SnapshotEnemy> = {}): SnapshotEnemy {
    return { id: 1, x: 3.25, z: 5.5, ry: 0.5, hp: 80, flags: 0, anim: 1, ...overrides };
}

function makeSnapshot(overrides: Partial<SnapshotMsg> = {}): SnapshotMsg {
    return {
        t: 'snapshot', tick: 42, ackSeq: 17, timeScale: 1,
        heroes: [makeHero()], enemies: [],
        wave: { n: 3, alive: 0, inProgress: 1, breather: 0 },
        ...overrides,
    };
}

describe('SnapshotBinary — full snapshot round-trip', () => {
    it('round-trips an empty-enemies snapshot', () => {
        const msg = makeSnapshot();
        const decoded = decodeSnapshot(encodeSnapshot(msg));
        expect(decoded).toEqual(f32(msg));
    });

    it('round-trips a single enemy', () => {
        const msg = makeSnapshot({ enemies: [makeEnemy()] });
        expect(decodeSnapshot(encodeSnapshot(msg))).toEqual(f32(msg));
    });

    it('round-trips 30+ enemies with mixed optional fields', () => {
        const enemies: SnapshotEnemy[] = [];
        const anims = [0, 1, 2, 11, 13];
        for (let i = 0; i < 34; i++) {
            enemies.push(makeEnemy({
                id: i * 7,
                x: (i - 17) * 1.37,            // negatives + non-f32-exact floats
                z: i * -0.61,
                ry: i * 0.21,
                hp: 100 - i * 1.5,
                flags: (i % 2 === 0) ? (1 << 4) : ((i % 4) << 5) | 1, // elite / meleePhase+frozen
                anim: anims[i % anims.length],
                ...(i % 3 === 0 ? { shield: i / 34 } : {}),
                ...(i % 5 === 0 ? { y: 2.5 + i * 0.1 } : {}),
            }));
        }
        const msg = makeSnapshot({ tick: 9001, enemies });
        expect(decodeSnapshot(encodeSnapshot(msg))).toEqual(f32(msg));
    });

    it('round-trips 2 heroes covering all hero fields (incl. dead hero)', () => {
        const msg = makeSnapshot({
            heroes: [
                makeHero({ id: 0, anim: 2, level: 100, xp: 0.999, hp: 12.25 }),
                makeHero({ id: 1, x: -33.7, z: 41.2, ry: -1.1, hp: 0, anim: 0, dx: -1, dz: 1, alive: false, level: 1, xp: 0 }),
            ],
        });
        expect(decodeSnapshot(encodeSnapshot(msg))).toEqual(f32(msg));
    });

    it('round-trips large tick/ackSeq (>65535) and high wave numbers', () => {
        const msg = makeSnapshot({
            tick: 1_000_000, ackSeq: 123_456,
            wave: { n: 999, alive: 250, inProgress: 0, breather: 4.5 },
        });
        expect(decodeSnapshot(encodeSnapshot(msg))).toEqual(f32(msg));
    });

    it('round-trips negative coordinates and timeScale < 1', () => {
        const msg = makeSnapshot({
            timeScale: 0.25,
            heroes: [makeHero({ x: -120.5, z: -99.875, ry: -3.1 })],
            enemies: [makeEnemy({ x: -45.5, z: -0.125, ry: -2.7 })],
        });
        expect(decodeSnapshot(encodeSnapshot(msg))).toEqual(f32(msg));
    });
});

describe('SnapshotBinary — delta round-trip', () => {
    it('round-trips a delta with changed + removed enemies', () => {
        const delta: SnapshotDelta = {
            t: 'snapshotDelta',
            baseTick: 70_000, tick: 70_001, ackSeq: 88_888, timeScale: 1,
            heroes: [makeHero(), makeHero({ id: 1, x: 4.4 })],
            changedEnemies: [
                makeEnemy({ id: 12, shield: 0.4 }),
                makeEnemy({ id: 300_000, x: -8.8, anim: 13 }),
            ],
            removedEnemyIds: [3, 99, 70_001],
            wave: { n: 12, alive: 31, inProgress: 1, breather: 0 },
        };
        expect(decodeSnapshotDelta(encodeSnapshotDelta(delta))).toEqual(f32(delta));
    });

    it('round-trips an empty delta (no changes, no removals)', () => {
        const delta: SnapshotDelta = {
            t: 'snapshotDelta',
            baseTick: 5, tick: 6, ackSeq: 0, timeScale: 1,
            heroes: [makeHero()],
            changedEnemies: [], removedEnemyIds: [],
            wave: { n: 1, alive: 0, inProgress: 0, breather: 2.0 },
        };
        expect(decodeSnapshotDelta(encodeSnapshotDelta(delta))).toEqual(f32(delta));
    });
});

describe('SnapshotBinary — garbage rejection (no throw)', () => {
    it('returns null on random garbage bytes', () => {
        const garbage = new Uint8Array([7, 9, 255, 1, 2, 3, 4, 5]).buffer;
        expect(decodeSnapshot(garbage)).toBeNull();
        expect(decodeSnapshotDelta(garbage)).toBeNull();
        expect(decodeBinaryMessage(garbage)).toBeNull();
    });

    it('returns null on an empty buffer', () => {
        const empty = new ArrayBuffer(0);
        expect(decodeSnapshot(empty)).toBeNull();
        expect(decodeSnapshotDelta(empty)).toBeNull();
    });

    it('returns null on a truncated valid message', () => {
        const buf = encodeSnapshot(makeSnapshot({ enemies: [makeEnemy()] }));
        expect(decodeSnapshot(buf.slice(0, buf.byteLength - 3))).toBeNull();
    });

    it('returns null on a valid message with trailing bytes appended', () => {
        const buf = encodeSnapshot(makeSnapshot({ enemies: [makeEnemy()] }));
        const padded = new Uint8Array(buf.byteLength + 1);
        padded.set(new Uint8Array(buf), 0); // valid frame + 1 garbage byte
        expect(decodeSnapshot(padded.buffer)).toBeNull();
    });

    it('returns null on wrong version or wrong message type', () => {
        const buf = encodeSnapshot(makeSnapshot());
        const bumped = buf.slice(0);
        new DataView(bumped).setUint8(0, 99);                 // unknown version
        expect(decodeSnapshot(bumped)).toBeNull();
        expect(decodeSnapshotDelta(buf)).toBeNull();          // snapshot fed to delta decoder
        expect(decodeSnapshot(encodeSnapshotDelta({
            t: 'snapshotDelta', baseTick: 1, tick: 2, ackSeq: 0, timeScale: 1,
            heroes: [], changedEnemies: [], removedEnemyIds: [],
            wave: { n: 1, alive: 0, inProgress: 0, breather: 0 },
        }))).toBeNull();                                       // delta fed to snapshot decoder
    });
});

describe('SnapshotBinary — decodeBinaryMessage dispatcher', () => {
    it('routes by the type byte', () => {
        const snap = makeSnapshot({ enemies: [makeEnemy()] });
        const decodedSnap = decodeBinaryMessage(encodeSnapshot(snap));
        expect(decodedSnap?.t).toBe('snapshot');

        const delta: SnapshotDelta = {
            t: 'snapshotDelta', baseTick: 1, tick: 2, ackSeq: 0, timeScale: 1,
            heroes: [makeHero()], changedEnemies: [makeEnemy()], removedEnemyIds: [4],
            wave: { n: 1, alive: 1, inProgress: 1, breather: 0 },
        };
        const decodedDelta = decodeBinaryMessage(encodeSnapshotDelta(delta));
        expect(decodedDelta?.t).toBe('snapshotDelta');
    });
});

describe('SnapshotBinary — size win vs JSON', () => {
    it('binary is much smaller than JSON for a 30-enemy snapshot', () => {
        const enemies: SnapshotEnemy[] = [];
        for (let i = 0; i < 30; i++) {
            enemies.push(makeEnemy({
                id: i, x: i * 1.234567, z: -i * 2.345678, ry: i * 0.1,
                hp: 100 - i, flags: i % 32, anim: i % 3,
                ...(i % 6 === 0 ? { shield: 0.5 } : {}),
            }));
        }
        const msg = makeSnapshot({ heroes: [makeHero(), makeHero({ id: 1 })], enemies });
        const jsonBytes = JSON.stringify(msg).length;
        const binBytes = encodeSnapshot(msg).byteLength;
        // eslint-disable-next-line no-console
        console.log(`[snapshotBinary] 30-enemy snapshot: JSON ${jsonBytes} B vs binary ${binBytes} B (${(100 * binBytes / jsonBytes).toFixed(1)}%)`);
        expect(binBytes).toBeLessThan(jsonBytes / 2);
    });
});
