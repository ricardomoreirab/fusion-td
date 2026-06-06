import { describe, it, expect } from 'vitest';
import { encode, decode, type NetMessage } from '../src/net/Protocol';
import { packEnemyFlags, unpackEnemyFlags } from '../src/net/EnemyFlags';

describe('M3 protocol', () => {
  it('round-trips a snapshot', () => {
    const msg: NetMessage = {
      t: 'snapshot', tick: 5, ackSeq: 3, timeScale: 1,
      heroes: [{ id: 0, x: 1, y: 0, z: 2, ry: 0.5, hp: 90, anim: 1 }],
      enemies: [{ id: 7, x: 3, z: -4, ry: 1.2, hp: 20, flags: 0b101, anim: 2 }],
      wave: { n: 3, alive: 12, inProgress: 1, breather: 0 },
    };
    expect(decode(encode(msg))).toEqual(msg);
  });
  it('round-trips spawn/death/damage/wave events', () => {
    const msgs: NetMessage[] = [
      { t: 'spawn', id: 1, type: 'basic', x: 0, z: 0, maxHealth: 30 },
      { t: 'death', id: 1, x: 0, z: 0, isElite: false, isClone: false, reward: 10 },
      { t: 'damageReport', enemyId: 1, amount: 12, element: 'fire', sourceHeroId: 1 },
      { t: 'damageResult', enemyId: 1, amount: 12, isCrit: false, element: 'fire', x: 0, z: 0 },
      { t: 'wave-start', wave: 4 },
      { t: 'wave-clear', wave: 3 },
    ];
    for (const m of msgs) expect(decode(encode(m))).toEqual(m);
  });
  it('packs/unpacks the enemy flag bitfield', () => {
    const f = { frozen: true, stunned: false, confused: true, flying: false, elite: true, meleePhase: 2 };
    expect(unpackEnemyFlags(packEnemyFlags(f))).toEqual(f);
  });
  it('packs all meleePhase values 0..3 and all booleans', () => {
    for (let p = 0; p <= 3; p++) {
      const f = { frozen: true, stunned: true, confused: true, flying: true, elite: true, meleePhase: p };
      expect(unpackEnemyFlags(packEnemyFlags(f))).toEqual(f);
    }
    const z = { frozen: false, stunned: false, confused: false, flying: false, elite: false, meleePhase: 0 };
    expect(unpackEnemyFlags(packEnemyFlags(z))).toEqual(z);
  });
});
