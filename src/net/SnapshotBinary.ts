// Binary snapshot codec (M6 E1). PURE — no Babylon, no DOM, safe for Vitest.
//
// Snapshots + deltas dominate the 20 Hz tick channel; as JSON a 30-enemy
// snapshot is ~3 KB, as binary ~0.9 KB. Events stay JSON — only the two
// snapshot shapes go through here. All multi-byte values are LITTLE-ENDIAN.
//
// ── Wire layout (version 1) ──────────────────────────────────────────────────
// Header (2 bytes)
//   u8  version          = 1
//   u8  msgType          1 = snapshot, 2 = snapshotDelta
//
// snapshot body (msgType 1) — ALL counts first, then the record arrays:
//   u32 tick             (20 Hz → u16 overflows in ~55 min; u32 is safe)
//   u32 ackSeq           (guest input seq, one per frame — u32)
//   f32 timeScale
//   wave block           (9 B, below)
//   u8  heroCount
//   u16 enemyCount
//   heroCount × hero record
//   enemyCount × enemy record
//
// snapshotDelta body (msgType 2) — same shape: counts first, then arrays:
//   u32 baseTick
//   u32 tick
//   u32 ackSeq
//   f32 timeScale
//   wave block
//   u8  heroCount
//   u16 changedCount
//   u16 removedCount
//   heroCount × hero record
//   changedCount × enemy record
//   removedCount × u32 enemy id
//
// wave block (9 B):   u16 n, u16 alive, u8 inProgress, f32 breather
//
// hero record (36 B, fixed):
//   u8 id, f32 x, f32 y, f32 z, f32 ry, f32 hp, u8 anim,
//   f32 dx, f32 dz, u8 alive, u8 level, f32 xp
//
// enemy record (24 B + optionals):
//   u32 id               (EnemyManager mints ids 0,1,2,… per run — u32)
//   u8  presence bitmask  bit0 = y present, bit1 = shield present
//   f32 x, f32 z, [f32 y], f32 ry, f32 hp,
//   u16 flags             (EnemyFlags packs 7 bits today; u16 = headroom)
//   u8  anim              (0/1/2 or 10+N skill codes)
//   [f32 shield]
//
// Decoders return null (never throw) on truncated/garbage/unknown-format input;
// they also reject trailing bytes so a corrupt length can't half-parse.

import type { SnapshotMsg, SnapshotHero, SnapshotEnemy } from './Protocol';
import type { SnapshotDelta } from './SnapshotDelta';

const VERSION = 1;
const TYPE_SNAPSHOT = 1;
const TYPE_DELTA = 2;

const WAVE_BYTES = 9;
const HERO_BYTES = 36;
const ENEMY_BASE_BYTES = 24;

const PRESENCE_Y = 1;
const PRESENCE_SHIELD = 1 << 1;

// ── sizing ───────────────────────────────────────────────────────────────────

function enemyBytes(e: SnapshotEnemy): number {
    return ENEMY_BASE_BYTES
        + (e.y !== undefined ? 4 : 0)
        + (e.shield !== undefined ? 4 : 0);
}

// ── writer helpers ───────────────────────────────────────────────────────────

function writeWave(view: DataView, o: number, w: SnapshotMsg['wave']): number {
    view.setUint16(o, w.n, true);
    view.setUint16(o + 2, w.alive, true);
    view.setUint8(o + 4, w.inProgress);
    view.setFloat32(o + 5, w.breather, true);
    return o + WAVE_BYTES;
}

function writeHero(view: DataView, o: number, h: SnapshotHero): number {
    view.setUint8(o, h.id); o += 1;
    view.setFloat32(o, h.x, true); o += 4;
    view.setFloat32(o, h.y, true); o += 4;
    view.setFloat32(o, h.z, true); o += 4;
    view.setFloat32(o, h.ry, true); o += 4;
    view.setFloat32(o, h.hp, true); o += 4;
    view.setUint8(o, h.anim); o += 1;
    view.setFloat32(o, h.dx, true); o += 4;
    view.setFloat32(o, h.dz, true); o += 4;
    view.setUint8(o, h.alive ? 1 : 0); o += 1;
    view.setUint8(o, h.level); o += 1;
    view.setFloat32(o, h.xp, true); o += 4;
    return o;
}

function writeEnemy(view: DataView, o: number, e: SnapshotEnemy): number {
    view.setUint32(o, e.id, true); o += 4;
    const presence = (e.y !== undefined ? PRESENCE_Y : 0)
        | (e.shield !== undefined ? PRESENCE_SHIELD : 0);
    view.setUint8(o, presence); o += 1;
    view.setFloat32(o, e.x, true); o += 4;
    view.setFloat32(o, e.z, true); o += 4;
    if (e.y !== undefined) { view.setFloat32(o, e.y, true); o += 4; }
    view.setFloat32(o, e.ry, true); o += 4;
    view.setFloat32(o, e.hp, true); o += 4;
    view.setUint16(o, e.flags, true); o += 2;
    view.setUint8(o, e.anim); o += 1;
    if (e.shield !== undefined) { view.setFloat32(o, e.shield, true); o += 4; }
    return o;
}

// ── reader (cursor-based; DataView throws RangeError past the end, which the
//    public decoders catch and turn into null) ─────────────────────────────────

interface Cursor { o: number }

function readWave(view: DataView, c: Cursor): SnapshotMsg['wave'] {
    const n = view.getUint16(c.o, true);
    const alive = view.getUint16(c.o + 2, true);
    const inProgress = (view.getUint8(c.o + 4) ? 1 : 0) as 0 | 1;
    const breather = view.getFloat32(c.o + 5, true);
    c.o += WAVE_BYTES;
    return { n, alive, inProgress, breather };
}

function readHero(view: DataView, c: Cursor): SnapshotHero {
    const h: SnapshotHero = {
        id: (view.getUint8(c.o) & 1) as 0 | 1,
        x: view.getFloat32(c.o + 1, true),
        y: view.getFloat32(c.o + 5, true),
        z: view.getFloat32(c.o + 9, true),
        ry: view.getFloat32(c.o + 13, true),
        hp: view.getFloat32(c.o + 17, true),
        anim: view.getUint8(c.o + 21),
        dx: view.getFloat32(c.o + 22, true),
        dz: view.getFloat32(c.o + 26, true),
        alive: view.getUint8(c.o + 30) !== 0,
        level: view.getUint8(c.o + 31),
        xp: view.getFloat32(c.o + 32, true),
    };
    c.o += HERO_BYTES;
    return h;
}

function readEnemy(view: DataView, c: Cursor): SnapshotEnemy {
    const id = view.getUint32(c.o, true); c.o += 4;
    const presence = view.getUint8(c.o); c.o += 1;
    const x = view.getFloat32(c.o, true); c.o += 4;
    const z = view.getFloat32(c.o, true); c.o += 4;
    let y: number | undefined;
    if (presence & PRESENCE_Y) { y = view.getFloat32(c.o, true); c.o += 4; }
    const ry = view.getFloat32(c.o, true); c.o += 4;
    const hp = view.getFloat32(c.o, true); c.o += 4;
    const flags = view.getUint16(c.o, true); c.o += 2;
    const anim = view.getUint8(c.o); c.o += 1;
    let shield: number | undefined;
    if (presence & PRESENCE_SHIELD) { shield = view.getFloat32(c.o, true); c.o += 4; }

    const e: SnapshotEnemy = { id, x, z, ry, hp, flags, anim };
    if (y !== undefined) e.y = y;
    if (shield !== undefined) e.shield = shield;
    return e;
}

// ── public API ───────────────────────────────────────────────────────────────

export function encodeSnapshot(msg: SnapshotMsg): ArrayBuffer {
    let size = 2 + 4 + 4 + 4 + WAVE_BYTES + 1 + 2
        + msg.heroes.length * HERO_BYTES;
    for (const e of msg.enemies) size += enemyBytes(e);

    const buf = new ArrayBuffer(size);
    const view = new DataView(buf);
    let o = 0;
    view.setUint8(o, VERSION); o += 1;
    view.setUint8(o, TYPE_SNAPSHOT); o += 1;
    view.setUint32(o, msg.tick, true); o += 4;
    view.setUint32(o, msg.ackSeq, true); o += 4;
    view.setFloat32(o, msg.timeScale, true); o += 4;
    o = writeWave(view, o, msg.wave);
    view.setUint8(o, msg.heroes.length); o += 1;
    view.setUint16(o, msg.enemies.length, true); o += 2;
    for (const h of msg.heroes) o = writeHero(view, o, h);
    for (const e of msg.enemies) o = writeEnemy(view, o, e);
    return buf;
}

export function decodeSnapshot(buf: ArrayBuffer): SnapshotMsg | null {
    try {
        const view = new DataView(buf);
        if (view.getUint8(0) !== VERSION || view.getUint8(1) !== TYPE_SNAPSHOT) return null;
        const c: Cursor = { o: 2 };
        const tick = view.getUint32(c.o, true); c.o += 4;
        const ackSeq = view.getUint32(c.o, true); c.o += 4;
        const timeScale = view.getFloat32(c.o, true); c.o += 4;
        const wave = readWave(view, c);
        const heroCount = view.getUint8(c.o); c.o += 1;
        const enemyCount = view.getUint16(c.o, true); c.o += 2;
        const heroes: SnapshotHero[] = [];
        for (let i = 0; i < heroCount; i++) heroes.push(readHero(view, c));
        const enemies: SnapshotEnemy[] = [];
        for (let i = 0; i < enemyCount; i++) enemies.push(readEnemy(view, c));
        if (c.o !== buf.byteLength) return null; // trailing garbage → reject
        return { t: 'snapshot', tick, ackSeq, timeScale, heroes, enemies, wave };
    } catch {
        return null; // truncated / malformed
    }
}

export function encodeSnapshotDelta(msg: SnapshotDelta): ArrayBuffer {
    let size = 2 + 4 + 4 + 4 + 4 + WAVE_BYTES + 1 + 2 + 2
        + msg.heroes.length * HERO_BYTES
        + msg.removedEnemyIds.length * 4;
    for (const e of msg.changedEnemies) size += enemyBytes(e);

    const buf = new ArrayBuffer(size);
    const view = new DataView(buf);
    let o = 0;
    view.setUint8(o, VERSION); o += 1;
    view.setUint8(o, TYPE_DELTA); o += 1;
    view.setUint32(o, msg.baseTick, true); o += 4;
    view.setUint32(o, msg.tick, true); o += 4;
    view.setUint32(o, msg.ackSeq, true); o += 4;
    view.setFloat32(o, msg.timeScale, true); o += 4;
    o = writeWave(view, o, msg.wave);
    view.setUint8(o, msg.heroes.length); o += 1;
    view.setUint16(o, msg.changedEnemies.length, true); o += 2;
    view.setUint16(o, msg.removedEnemyIds.length, true); o += 2;
    for (const h of msg.heroes) o = writeHero(view, o, h);
    for (const e of msg.changedEnemies) o = writeEnemy(view, o, e);
    for (const id of msg.removedEnemyIds) { view.setUint32(o, id, true); o += 4; }
    return buf;
}

export function decodeSnapshotDelta(buf: ArrayBuffer): SnapshotDelta | null {
    try {
        const view = new DataView(buf);
        if (view.getUint8(0) !== VERSION || view.getUint8(1) !== TYPE_DELTA) return null;
        const c: Cursor = { o: 2 };
        const baseTick = view.getUint32(c.o, true); c.o += 4;
        const tick = view.getUint32(c.o, true); c.o += 4;
        const ackSeq = view.getUint32(c.o, true); c.o += 4;
        const timeScale = view.getFloat32(c.o, true); c.o += 4;
        const wave = readWave(view, c);
        const heroCount = view.getUint8(c.o); c.o += 1;
        const changedCount = view.getUint16(c.o, true); c.o += 2;
        const removedCount = view.getUint16(c.o, true); c.o += 2;
        const heroes: SnapshotHero[] = [];
        for (let i = 0; i < heroCount; i++) heroes.push(readHero(view, c));
        const changedEnemies: SnapshotEnemy[] = [];
        for (let i = 0; i < changedCount; i++) changedEnemies.push(readEnemy(view, c));
        const removedEnemyIds: number[] = [];
        for (let i = 0; i < removedCount; i++) { removedEnemyIds.push(view.getUint32(c.o, true)); c.o += 4; }
        if (c.o !== buf.byteLength) return null; // trailing garbage → reject
        return { t: 'snapshotDelta', baseTick, tick, ackSeq, timeScale, heroes, changedEnemies, removedEnemyIds, wave };
    } catch {
        return null; // truncated / malformed
    }
}

/** Route an incoming binary frame by its type byte. Returns null for anything
 *  this build doesn't understand (wrong version, unknown type, garbage). */
export function decodeBinaryMessage(buf: ArrayBuffer): SnapshotMsg | SnapshotDelta | null {
    if (buf.byteLength < 2) return null;
    const type = new DataView(buf).getUint8(1);
    if (type === TYPE_SNAPSHOT) return decodeSnapshot(buf);
    if (type === TYPE_DELTA) return decodeSnapshotDelta(buf);
    return null;
}
