import { describe, it, expect } from 'vitest';
import { encode, decode, type SnapshotMsg } from '../src/net/Protocol';

describe('SnapshotHero extended fields (dx/dz/alive/level/xp)', () => {
  function makeSnapshot(heroOverrides: Partial<SnapshotMsg['heroes'][number]> = {}): SnapshotMsg {
    return {
      t: 'snapshot',
      tick: 10,
      ackSeq: 5,
      timeScale: 1,
      heroes: [{
        id: 0,
        x: 1.5, y: 0, z: -2.0,
        ry: 0.7,
        hp: 85,
        anim: 1,
        dx: 0.6,
        dz: -0.8,
        alive: true,
        level: 5,
        xp: 0.42,
        ...heroOverrides,
      }],
      enemies: [],
      wave: { n: 3, alive: 0, inProgress: 0, breather: 0 },
    };
  }

  it('round-trips a full snapshot with all extended hero fields', () => {
    const msg = makeSnapshot();
    expect(decode(encode(msg))).toEqual(msg);
  });

  it('round-trips with alive:false', () => {
    const msg = makeSnapshot({ alive: false, hp: 0 });
    expect(decode(encode(msg))).toEqual(msg);
  });

  it('round-trips with level:1 and xp:0 (default/initial values)', () => {
    const msg = makeSnapshot({ dx: 0, dz: 0, alive: true, level: 1, xp: 0 });
    expect(decode(encode(msg))).toEqual(msg);
  });

  it('round-trips with xp at 1.0 (just leveled up)', () => {
    const msg = makeSnapshot({ xp: 1.0 });
    expect(decode(encode(msg))).toEqual(msg);
  });

  it('round-trips two heroes (id 0 and id 1) with extended fields', () => {
    const msg: SnapshotMsg = {
      t: 'snapshot',
      tick: 20,
      ackSeq: 18,
      timeScale: 1,
      heroes: [
        { id: 0, x: 1, y: 0, z: 2, ry: 0, hp: 100, anim: 0, dx: 1, dz: 0, alive: true, level: 3, xp: 0.5 },
        { id: 1, x: -3, y: 0, z: 4, ry: 1.5, hp: 60, anim: 1, dx: 0, dz: -1, alive: true, level: 7, xp: 0.9 },
      ],
      enemies: [],
      wave: { n: 5, alive: 4, inProgress: 1, breather: 0 },
    };
    expect(decode(encode(msg))).toEqual(msg);
  });
});
