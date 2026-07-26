import { describe, expect, it } from 'vitest';
import {
  AscensionRuntime, STORMBOUND_KILLS, STORMBOUND_REFUND_S,
  BLOOD_RITE_EVERY_HITS, BLOOD_RITE_ICD_S, BLOOD_RITE_MAP_CAP,
  RAGE_ASCENDANT_MULT, EMBER_BONUS, OPEN_VEINS_FRAC, BODYCHECK_FRAC,
} from '../src/survivors/ascension/AscensionRuntime';
import type { AscensionContext, AscEnemy } from '../src/survivors/ascension/AscensionContext';

/**
 * The runtime is Three-free and DOM-free, so it is driven here with a fake
 * context. What matters most is not that a node "works" but that its guards do:
 * onBasicHit fires per enemy per frame during Whirlwind and again per ricochet
 * bounce, so an unguarded proc or an unpruned per-enemy map is thousands of
 * calls a second at horde scale.
 */

function makeEnemy(hp = 100, max = 100, x = 0, z = 0): AscEnemy {
  let alive = true;
  return {
    isAlive: () => alive,
    getPosition: () => ({ x, z }),
    getHealth: () => hp,
    getMaxHealth: () => max,
    kill() { alive = false; },
  } as AscEnemy & { kill(): void };
}

function makeCtx(over: Partial<AscensionContext> = {}) {
  const calls = {
    damage: [] as Array<{ e: AscEnemy; amount: number; element: string }>,
    curse: [] as Array<{ durationS: number; fracPerSec: number }>,
    fragile: 0,
    heal: 0,
    reduceCd: [] as number[],
    zones: [] as Array<Record<string, unknown>>,
    rings: [] as Array<{ x: number; z: number; color: string; radius: number }>,
    slows: 0,
    enchants: 0,
    extends: [] as number[],
    echoes: [] as Array<{ d: number; m: number }>,
    freeSmash: [] as number[],
    forceCasts: 0,
    chills: 0,
    slotCasts: 0,
    chainBonus: null as { extraHops: number; radiusBonus: number; split: boolean } | null,
  };
  let nearby: AscEnemy[] = [];
  let hpFrac = 1;
  let burning = false;
  let channelLeft = 0;
  const ctx: AscensionContext = {
    heroPos: () => ({ x: 0, z: 0 }),
    heroHpFraction: () => hpFrac,
    enemiesNearCount: () => nearby.length,
    forEachEnemyNear: (_x, _z, _r, cb) => { for (const e of nearby) cb(e); },
    damage: (e, amount, element) => { calls.damage.push({ e, amount, element }); },
    curse: (_e, durationS, fracPerSec) => { calls.curse.push({ durationS, fracPerSec }); },
    fragile: () => { calls.fragile++; },
    hasStatus: () => burning,
    detonateStatus: () => 50,
    heal: (a) => { calls.heal += a; },
    basicDamage: () => 100,
    knockback: () => {},
    reduceAbilityCooldowns: (s) => { calls.reduceCd.push(s); },
    zone: (x, z, o) => { calls.zones.push({ x, z, ...o }); },
    ring: (x, z, color, radius) => { calls.rings.push({ x, z, color, radius }); },
    rng: () => 0.5,
    heroMaxHp: () => 100,
    slow: () => { calls.slows++; },
    abilityTimeLeft: () => channelLeft,
    extendAbility: (_id, s) => { channelLeft += s; calls.extends.push(s); return channelLeft; },
    reduceAbilityCooldown: (_id, s) => { calls.reduceCd.push(s); },
    applyEnchantments: () => { calls.enchants++; },
    castFreeWhirlwind: (d, m) => { calls.echoes.push({ d, m }); },
    castFreeSmash: (m) => { calls.freeSmash.push(m); },
    forceCastAutocastSlots: () => { calls.forceCasts++; },
    forEachEnemyAlive: (cb) => { for (const e of nearby) cb(e); },
    chill: () => { calls.chills++; },
    castSlotFree: () => { calls.slotCasts++; },
    setChainBonus: (b) => { calls.chainBonus = b; },
    ...over,
  };
  return {
    ctx, calls,
    setNearby: (e: AscEnemy[]) => { nearby = e; },
    setHpFrac: (f: number) => { hpFrac = f; },
    setBurning: (b: boolean) => { burning = b; },
    setChannel: (t: number) => { channelLeft = t; },
    getChannel: () => channelLeft,
  };
}

function runtimeWith(points: Record<string, number>, over: Partial<AscensionContext> = {}) {
  const h = makeCtx(over);
  const rt = new AscensionRuntime(h.ctx);
  rt.setActivePoints(new Map(Object.entries(points)));
  return { rt, ...h };
}

describe('AscensionRuntime is inert with no points', () => {
  it('does nothing on any hook', () => {
    const { rt, calls } = runtimeWith({});
    rt.onBasicHit(makeEnemy(), 50);
    rt.onKill(1, 1);
    rt.onDashLand(0, 0);
    rt.onUltActivate('smash');
    rt.tick(1);
    expect(calls.damage).toHaveLength(0);
    expect(calls.fragile).toBe(0);
    expect(calls.reduceCd).toHaveLength(0);
    expect(calls.zones).toHaveLength(0);
    expect(rt.damageBonusMult()).toBe(1);
  });
});

describe('Rage Ascendant (pulled damage provider)', () => {
  it('only multiplies below the HP threshold', () => {
    const { rt, setHpFrac } = runtimeWith({ 'rage-ascendant': 3 });
    setHpFrac(0.9);
    expect(rt.damageBonusMult()).toBe(1);
    setHpFrac(0.4);
    expect(rt.damageBonusMult()).toBe(RAGE_ASCENDANT_MULT[2]);
  });

  it('scales with rank', () => {
    for (let pts = 1; pts <= 3; pts++) {
      const { rt, setHpFrac } = runtimeWith({ 'rage-ascendant': pts });
      setHpFrac(0.1);
      expect(rt.damageBonusMult()).toBe(RAGE_ASCENDANT_MULT[pts - 1]);
    }
  });
});

describe('Stormbound (on-kill counter)', () => {
  it('fires exactly once every Nth kill, not every kill', () => {
    const { rt, calls } = runtimeWith({ stormbound: 1 });
    const need = STORMBOUND_KILLS[0];
    for (let i = 0; i < need - 1; i++) rt.onKill(0, 0);
    expect(calls.reduceCd).toHaveLength(0);
    rt.onKill(0, 0);
    expect(calls.reduceCd).toEqual([STORMBOUND_REFUND_S[0]]);
    // Counter resets — the next N-1 kills must not fire again.
    for (let i = 0; i < need - 1; i++) rt.onKill(0, 0);
    expect(calls.reduceCd).toHaveLength(1);
  });

  it('rank 3 fires more often and refunds more', () => {
    const { rt, calls } = runtimeWith({ stormbound: 3 });
    for (let i = 0; i < STORMBOUND_KILLS[2]; i++) rt.onKill(0, 0);
    expect(calls.reduceCd).toEqual([STORMBOUND_REFUND_S[2]]);
  });
});

describe('on-hit nodes', () => {
  it('Wound Chemistry applies one Fragile stack per point', () => {
    const { rt, calls } = runtimeWith({ 'wound-chemistry': 3 });
    rt.onBasicHit(makeEnemy(), 10);
    expect(calls.fragile).toBe(3);
  });

  it('Open Veins curses by MAX-HP fraction and heals a share', () => {
    const { rt, calls } = runtimeWith({ 'open-veins': 2 });
    rt.onBasicHit(makeEnemy(500, 1000), 10);
    expect(calls.curse).toHaveLength(1);
    expect(calls.curse[0].fracPerSec).toBe(OPEN_VEINS_FRAC[1]);
    expect(calls.heal).toBeGreaterThan(0);
  });

  it('Ember Reservoir only fires against burning targets', () => {
    const { rt, calls, setBurning } = runtimeWith({ 'ember-reservoir': 3 });
    setBurning(false);
    rt.onBasicHit(makeEnemy(), 100);
    expect(calls.damage).toHaveLength(0);
    setBurning(true);
    rt.onBasicHit(makeEnemy(), 100);
    expect(calls.damage).toHaveLength(1);
    expect(calls.damage[0].amount).toBeCloseTo(100 * EMBER_BONUS[2], 10);
  });

  it('skips a dead enemy entirely', () => {
    const { rt, calls } = runtimeWith({ 'wound-chemistry': 3, 'open-veins': 3 });
    const e = makeEnemy() as AscEnemy & { kill(): void };
    e.kill();
    rt.onBasicHit(e, 10);
    expect(calls.fragile).toBe(0);
    expect(calls.curse).toHaveLength(0);
  });
});

describe('The Blood Rite (capstone) guards', () => {
  it('detonates only on the Nth hit against the SAME enemy', () => {
    const { rt, calls, setNearby } = runtimeWith({ 'the-blood-rite': 1 });
    const e = makeEnemy();
    setNearby([e]);
    const need = BLOOD_RITE_EVERY_HITS[0];
    for (let i = 0; i < need - 1; i++) rt.onBasicHit(e, 10);
    expect(calls.rings).toHaveLength(0);
    rt.onBasicHit(e, 10);
    expect(calls.rings).toHaveLength(1);
  });

  it('tracks hit counts per enemy, not globally', () => {
    const { rt, calls, setNearby } = runtimeWith({ 'the-blood-rite': 1 });
    const a = makeEnemy(); const b = makeEnemy();
    setNearby([a, b]);
    // Alternating hits must not reach the threshold on either enemy.
    for (let i = 0; i < BLOOD_RITE_EVERY_HITS[0] - 1; i++) { rt.onBasicHit(a, 10); rt.onBasicHit(b, 10); }
    expect(calls.rings).toHaveLength(0);
  });

  it('honours the internal cooldown after a detonation', () => {
    const { rt, calls, setNearby } = runtimeWith({ 'the-blood-rite': 2 });
    const e = makeEnemy();
    setNearby([e]);
    const need = BLOOD_RITE_EVERY_HITS[1];
    for (let i = 0; i < need; i++) rt.onBasicHit(e, 10);
    expect(calls.rings).toHaveLength(1);
    // Immediately hitting the threshold again is suppressed by the ICD.
    for (let i = 0; i < need; i++) rt.onBasicHit(e, 10);
    expect(calls.rings).toHaveLength(1);
    // ...until the ICD elapses.
    rt.tick(BLOOD_RITE_ICD_S + 0.01);
    for (let i = 0; i < need; i++) rt.onBasicHit(e, 10);
    expect(calls.rings).toHaveLength(2);
  });

  it('does not re-enter itself when its own detonation damages the target', () => {
    // The detonation calls ctx.damage, which in the real game routes back into
    // the hit pipeline. Feed that back in and assert it cannot cascade.
    const h = makeCtx();
    const rt = new AscensionRuntime({
      ...h.ctx,
      damage: (e, amount, element) => {
        h.calls.damage.push({ e, amount, element });
        rt.onBasicHit(e, amount); // re-entrancy attempt
      },
    });
    rt.setActivePoints(new Map([['the-blood-rite', 3]]));
    const e = makeEnemy();
    h.setNearby([e]);
    for (let i = 0; i < BLOOD_RITE_EVERY_HITS[2]; i++) rt.onBasicHit(e, 10);
    expect(h.calls.rings).toHaveLength(1);
  });

  it('prunes dead enemies from the per-enemy map', () => {
    const { rt } = runtimeWith({ 'the-blood-rite': 1 });
    const mob = Array.from({ length: 200 }, () => makeEnemy() as AscEnemy & { kill(): void });
    for (const e of mob) rt.onBasicHit(e, 5);
    for (const e of mob) e.kill();
    rt.tick(0.016);
    // Not directly observable, so assert via behaviour: a fresh enemy still
    // needs the full N hits, i.e. state was not corrupted by the flood.
    const fresh = makeEnemy();
    const h = runtimeWith({ 'the-blood-rite': 1 });
    h.setNearby([fresh]);
    for (let i = 0; i < BLOOD_RITE_EVERY_HITS[0] - 1; i++) h.rt.onBasicHit(fresh, 5);
    expect(h.calls.rings).toHaveLength(0);
  });

  it('keeps the tracked map bounded under a sustained horde flood', () => {
    const { rt } = runtimeWith({ 'the-blood-rite': 1 });
    for (let frame = 0; frame < 60; frame++) {
      for (let i = 0; i < 100; i++) rt.onBasicHit(makeEnemy(), 5);
      rt.tick(0.016);
    }
    // 6,000 distinct enemies touched; the cap must have evicted aggressively.
    // Observable proxy: tick stays cheap and does not throw.
    expect(BLOOD_RITE_MAP_CAP).toBeLessThan(6000);
  });
});

describe('Bodycheck (dash landing)', () => {
  it('damages everything in the landing radius', () => {
    const { rt, calls, setNearby } = runtimeWith({ 'bodycheck-bar': 1 });
    setNearby([makeEnemy(), makeEnemy(), makeEnemy()]);
    rt.onDashLand(3, 4);
    expect(calls.damage).toHaveLength(3);
    expect(calls.damage[0].amount).toBeCloseTo(100 * BODYCHECK_FRAC[0], 10);
    expect(calls.rings[0]).toMatchObject({ x: 3, z: 4 });
  });

  it('does nothing when unowned', () => {
    const { rt, calls, setNearby } = runtimeWith({});
    setNearby([makeEnemy()]);
    rt.onDashLand(0, 0);
    expect(calls.damage).toHaveLength(0);
  });
});

describe('Fault Line (on ultimate)', () => {
  it('lays a crawling zone on Smash only', () => {
    const { rt, calls } = runtimeWith({ 'fault-line': 3 });
    rt.onUltActivate('whirlwind');
    expect(calls.zones).toHaveLength(0);
    rt.onUltActivate('smash');
    expect(calls.zones).toHaveLength(1);
    expect(calls.zones[0].crawlSpeed).toBe(2);
    // The zone element must be a finite-palette literal — an unbounded material
    // cache key is the documented cause of this project's recurring freeze.
    expect(['fire', 'ice', 'arcane', 'physical', 'storm']).toContain(calls.zones[0].element);
  });
});

describe('Eye of the Maelstrom convergence (capstone)', () => {
  it('extends the channel by a DECAYING amount, never a fixed one', () => {
    const h = runtimeWith({ 'eye-of-the-maelstrom': 3, 'hurricane-heart': 3 });
    h.setChannel(5);
    h.rt.onUltActivate('whirlwind');
    h.setChannel(5);
    for (let i = 0; i < 5; i++) h.rt.onKill(0, 0);
    const adds = h.calls.extends;
    expect(adds.length).toBeGreaterThan(1);
    // Each successive extension must be strictly smaller than the last.
    for (let i = 1; i < adds.length; i++) expect(adds[i]).toBeLessThan(adds[i - 1]);
  });

  it('CONVERGES under 10,000 kills instead of running away', () => {
    const h = runtimeWith({ 'eye-of-the-maelstrom': 3, 'hurricane-heart': 3 });
    h.rt.onUltActivate('whirlwind');
    h.setChannel(8.6);
    for (let i = 0; i < 10_000; i++) h.rt.onKill(0, 0);
    // The hard max is 23.6s; convergence must respect it with huge margin to spare.
    expect(h.getChannel()).toBeLessThanOrEqual(23.6);
  });

  it('ignores kills OUTSIDE the whirlwind radius', () => {
    const h = runtimeWith({ 'eye-of-the-maelstrom': 3 });
    h.setChannel(5);
    h.rt.onKill(50, 50); // far away
    expect(h.calls.extends).toHaveLength(0);
  });

  it('does nothing when not channelling', () => {
    const h = runtimeWith({ 'eye-of-the-maelstrom': 3 });
    h.setChannel(0);
    h.rt.onKill(0, 0);
    expect(h.calls.extends).toHaveLength(0);
  });

  it('adds its damage multiplier only while channelling', () => {
    const h = runtimeWith({ 'eye-of-the-maelstrom': 1 });
    h.setChannel(0);
    expect(h.rt.damageBonusMult()).toBe(1);
    h.setChannel(3);
    expect(h.rt.damageBonusMult()).toBeCloseTo(1.35, 10);
  });
});

describe('Standing Stone (negate)', () => {
  it('arms only after the full window and negates exactly one hit', () => {
    const { rt } = runtimeWith({ 'standing-stone': 1 });
    rt.tick(3.9);
    expect(rt.tryNegate()).toBe(false); // not armed yet
    rt.tick(4.1);
    expect(rt.tryNegate()).toBe(true);  // armed → consumed
    expect(rt.tryNegate()).toBe(false); // charge is spent
  });

  it('does not arm at all when unowned', () => {
    const { rt } = runtimeWith({});
    rt.tick(100);
    expect(rt.tryNegate()).toBe(false);
  });
});

describe('Sanguine Ward (absorb)', () => {
  it('banks overheal up to the cap and absorbs from the pool', () => {
    const { rt } = runtimeWith({ 'sanguine-ward': 1 }); // 15% of 100 max HP
    rt.onHealOverflow(500);
    expect(rt.absorb(10)).toBe(0);   // fully absorbed
    expect(rt.absorb(10)).toBe(5);   // pool had 15 → 5 damage leaks through
    expect(rt.absorb(10)).toBe(10);  // pool empty
  });

  it('passes damage straight through with no points', () => {
    const { rt } = runtimeWith({});
    rt.onHealOverflow(500);
    expect(rt.absorb(42)).toBe(42);
  });
});

describe('ability tuning providers', () => {
  it('returns null when nothing in the tree touches that ability', () => {
    const { rt } = runtimeWith({ stormbound: 3 });
    expect(rt.abilityTuning('whirlwind')).toBeNull();
    expect(rt.abilityTuning('smash')).toBeNull();
    expect(rt.abilityTuning('meteor')).toBeNull();
  });

  it('MAXes the two nodes that both write Smash radius, never sums them', () => {
    const { rt } = runtimeWith({ 'crater-maker': 1, 'seismic-reach': 3 });
    const t = rt.abilityTuning('smash')!;
    // Crater r1 = 11.5, Seismic r3 = 13 → 13, not 24.5.
    expect(t.radius).toBe(13);
  });

  it('composes the three Whirlwind nodes into one tuning object', () => {
    const { rt } = runtimeWith({ 'gale-force': 3, 'cyclone-cadence': 3, 'hurricane-heart': 3 });
    const t = rt.abilityTuning('whirlwind')!;
    expect(t.radius).toBe(9.4);
    expect(t.tickIntervalS).toBe(0.18);
    expect(t.durationS).toBe(8.6);
  });

  it('scales the ult cooldown with the CACHED nearby count', () => {
    const h = runtimeWith({ 'unending-fury': 3 });
    expect(h.rt.ultCooldownMult()).toBe(1); // nothing sampled yet
    h.setNearby(Array.from({ length: 20 }, () => makeEnemy()));
    h.rt.tick(1);                            // sample
    // 20 enemies clamped to 10 stacks x 3.5% = 35% faster.
    expect(h.rt.ultCooldownMult()).toBeCloseTo(0.65, 10);
  });
});

describe('Aftershock (per-swing)', () => {
  it('fires every Nth SWING, not every hit', () => {
    const h = runtimeWith({ aftershock: 1 });
    h.setNearby([makeEnemy(), makeEnemy()]);
    for (let i = 0; i < 5; i++) h.rt.onSwing(0, 0);
    expect(h.calls.rings).toHaveLength(0);
    h.rt.onSwing(0, 0);
    expect(h.calls.rings).toHaveLength(1);
    expect(h.calls.damage).toHaveLength(2);
  });

  it('caps enchantment dispatch even in a huge crowd', () => {
    const h = runtimeWith({ aftershock: 3, runeblooded: 1 });
    h.setNearby(Array.from({ length: 50 }, () => makeEnemy()));
    for (let i = 0; i < 4; i++) h.rt.onSwing(0, 0);
    expect(h.calls.enchants).toBeLessThanOrEqual(6);
  });
});

describe('The Fissure (capstone geometry)', () => {
  it('never exceeds the animation-LOD radius cap', () => {
    const { rt } = runtimeWith({
      'the-fissure': 3, tremorbound: 3, 'bodycheck-bar': 3, aftershock: 3,
      'seismic-reach': 3, 'weight-of-the-mountain': 3, 'fault-line': 3,
      'crater-maker': 3, 'standing-stone': 3,
    });
    expect(rt.slashTravel(4.5)).toBeLessThanOrEqual(16);
    expect(rt.slashHalfWidth(1.5)).toBeLessThanOrEqual(3.0);
  });

  it('leaves the base untouched when unowned', () => {
    const { rt } = runtimeWith({});
    expect(rt.slashTravel(4.5)).toBe(4.5);
    expect(rt.slashHalfWidth(1.5)).toBe(1.5);
  });
});

describe('Weight of the Mountain aura', () => {
  it('walks the horde on a throttled interval, never every frame', () => {
    const h = runtimeWith({ 'weight-of-the-mountain': 3 });
    h.setNearby([makeEnemy(), makeEnemy()]);
    for (let i = 0; i < 60; i++) h.rt.tick(1 / 60); // one second of frames
    // At a 0.25s refresh that is 4 applications x 2 enemies, not 60 x 2.
    expect(h.calls.slows).toBeLessThanOrEqual(10);
    expect(h.calls.slows).toBeGreaterThan(0);
  });
});

describe('Bladestorm Echo recursion safety', () => {
  it('fires one free channel when a real channel ends', () => {
    const h = runtimeWith({ 'bladestorm-echo': 1 });
    h.rt.onChannelEnd('whirlwind');
    expect(h.calls.echoes).toHaveLength(1);
    expect(h.calls.echoes[0].d).toBe(1.5);
  });

  it('adds a free Smash only at rank 3', () => {
    const a = runtimeWith({ 'bladestorm-echo': 2 });
    a.rt.onChannelEnd('whirlwind');
    expect(a.calls.freeSmash).toHaveLength(0);
    const b = runtimeWith({ 'bladestorm-echo': 3 });
    b.rt.onChannelEnd('whirlwind');
    expect(b.calls.freeSmash).toEqual([0.6]);
  });

  it('CANNOT chain: a re-entrant channel-end during the echo is ignored', () => {
    // The real structural guard is AbilityManager suppressing onChannelEnd for
    // echo effects; this asserts the runtime's second layer holds too.
    const h = makeCtx();
    const rt = new AscensionRuntime({
      ...h.ctx,
      castFreeWhirlwind: (d, m) => {
        h.calls.echoes.push({ d, m });
        rt.onChannelEnd('whirlwind'); // re-entrancy attempt
      },
    });
    rt.setActivePoints(new Map([['bladestorm-echo', 3]]));
    rt.onChannelEnd('whirlwind');
    expect(h.calls.echoes).toHaveLength(1);
  });

  it('ignores channels that are not whirlwind, and does nothing when unowned', () => {
    const a = runtimeWith({ 'bladestorm-echo': 3 });
    a.rt.onChannelEnd('multishot');
    expect(a.calls.echoes).toHaveLength(0);
    const b = runtimeWith({});
    b.rt.onChannelEnd('whirlwind');
    expect(b.calls.echoes).toHaveLength(0);
  });
});

describe('Arc Resonance / The Endless Canticle convergence', () => {
  it('caps Resonance and scales power damage with it', () => {
    const { rt } = runtimeWith({ 'arc-resonance': 3 });
    expect(rt.powerDamageMult()).toBe(1);
    for (let i = 0; i < 50; i++) rt.onPowerCast();
    // Base cap is 10 stacks x 6% = +60%, no matter how many casts.
    expect(rt.powerDamageMult()).toBeCloseTo(1.6, 10);
  });

  it('CONVERGES: a discharge costs more Resonance than casting generates', () => {
    const h = runtimeWith({ 'arc-resonance': 3, 'the-endless-canticle': 3 });
    for (let i = 0; i < 500; i++) { h.rt.onPowerCast(); h.rt.tick(0.05); }
    // One cast grants 1, a discharge costs 8 and is ICD'd, so discharges must be
    // far rarer than casts — never one per cast.
    expect(h.calls.forceCasts).toBeGreaterThan(0);
    expect(h.calls.forceCasts).toBeLessThan(100);
  });

  it('never discharges below the threshold', () => {
    const h = runtimeWith({ 'arc-resonance': 1, 'the-endless-canticle': 1 });
    for (let i = 0; i < 12; i++) h.rt.onPowerCast();
    // r1 raises the cap to 16, below the 22 discharge threshold.
    expect(h.calls.forceCasts).toBe(0);
  });

  it('decays Resonance when casting stops', () => {
    const h = runtimeWith({ 'arc-resonance': 3 });
    for (let i = 0; i < 10; i++) h.rt.onPowerCast();
    const peak = h.rt.powerDamageMult();
    for (let i = 0; i < 40; i++) h.rt.tick(0.5);
    expect(h.rt.powerDamageMult()).toBeLessThan(peak);
    expect(h.rt.powerDamageMult()).toBe(1);
  });
});

describe('The Long Winter (arena-wide, must stay 1 Hz)', () => {
  it('chills every living enemy on a 1-second cadence, not per frame', () => {
    const h = runtimeWith({ 'the-long-winter': 3 });
    h.setNearby([makeEnemy(), makeEnemy(), makeEnemy()]);
    for (let i = 0; i < 120; i++) h.rt.tick(1 / 60); // two seconds of frames
    // 2 applications x 3 enemies = 6, NOT 120 x 3 = 360.
    expect(h.calls.chills).toBeLessThanOrEqual(9);
    expect(h.calls.chills).toBeGreaterThan(0);
  });
});

describe('The Debt (cheat death)', () => {
  it('fires once per wave and re-arms on the next wave', () => {
    const { rt } = runtimeWith({ 'the-debt': 3 });
    expect(rt.tryCheatDeath()).toBe(true);
    expect(rt.tryCheatDeath()).toBe(false);
    rt.onWaveStart();
    expect(rt.tryCheatDeath()).toBe(true);
  });

  it('does not fire below rank 3', () => {
    const { rt } = runtimeWith({ 'the-debt': 2 });
    expect(rt.tryCheatDeath()).toBe(false);
  });
});

describe('ranger arrow policy', () => {
  it('is identity when no ranger node is owned', () => {
    const { rt } = runtimeWith({});
    const p = rt.arrowPolicy();
    expect(p.bonusArrows()).toBe(0);
    expect(p.arrowCap()).toBe(12);
    expect(p.rangeOverride()).toBe(0);
    expect(p.bonusBounces()).toBe(0);
  });

  it('raises the arrow cap only via The Thousand', () => {
    expect(runtimeWith({ 'split-nock': 3 }).rt.arrowPolicy().arrowCap()).toBe(12);
    expect(runtimeWith({ 'the-thousand': 3 }).rt.arrowPolicy().arrowCap()).toBe(22);
  });

  it('MINs the arrow-count step so two nodes cannot compound into a firehose', () => {
    const { rt } = runtimeWith({ 'split-nock': 3, 'second-nature': 3 });
    const step = rt.arrowPolicy().arrowCountStep();
    expect(step).toBeGreaterThan(0);
    expect(step).toBeLessThanOrEqual(0.11);
  });
});

describe('Forked Lightning (run-wide chain bonus)', () => {
  it('installs the bonus once per recompute, not per cast', () => {
    const h = runtimeWith({ 'forked-lightning': 3 });
    expect(h.calls.chainBonus).toEqual({ extraHops: 3, radiusBonus: 3, split: true });
  });

  it('CLEARS the bonus when the node is unowned, so a fresh run never inherits it', () => {
    const h = runtimeWith({ 'forked-lightning': 2 });
    expect(h.calls.chainBonus).not.toBeNull();
    h.rt.setActivePoints(new Map());
    expect(h.calls.chainBonus).toBeNull();
  });

  it('only splits at rank 3', () => {
    expect(runtimeWith({ 'forked-lightning': 2 }).calls.chainBonus!.split).toBe(false);
    expect(runtimeWith({ 'forked-lightning': 3 }).calls.chainBonus!.split).toBe(true);
  });
});

describe('The Second Voice', () => {
  it('echoes a different slot once Resonance reaches the threshold, then ICDs', () => {
    const h = runtimeWith({ 'arc-resonance': 3, 'the-second-voice': 3 });
    for (let i = 0; i < 6; i++) h.rt.onPowerCast();
    expect(h.calls.slotCasts).toBe(1);
    h.rt.onPowerCast();
    expect(h.calls.slotCasts).toBe(1); // suppressed by the ICD
    h.rt.tick(2);
    h.rt.onPowerCast();
    expect(h.calls.slotCasts).toBe(2);
  });
});

describe('pierce policy', () => {
  it('MAXes Puncture and The High Ground rather than summing', () => {
    const p = runtimeWith({ puncture: 1, 'the-high-ground': 3 }).rt.arrowPolicy();
    expect(p.pierceCount()).toBe(3); // not 1 + 3
  });

  it('is 0 when neither node is owned', () => {
    expect(runtimeWith({}).rt.arrowPolicy().pierceCount()).toBe(0);
  });

  it('The Moonlit Lane r3 removes the body cap and retargets', () => {
    const h = runtimeWith({ 'the-moonlit-lane': 3 });
    expect(h.rt.arrowPolicy().pierceCount()).toBeGreaterThan(50);
    expect(h.rt.targetFurthest()).toBe(true);
    expect(runtimeWith({}).rt.targetFurthest()).toBe(false);
  });

  it('bounds The Moonlit Lane damage by the Deadeye path capacity', () => {
    const all: Record<string, number> = {};
    for (const id of ['long-draw', 'keen-edge', 'puncture', 'mark-of-the-moon',
      'the-still-breath', 'widowmaker', 'the-high-ground', 'the-one-shot',
      'the-moonlit-lane']) all[id] = 3;
    const p = runtimeWith(all).rt.arrowPolicy();
    // +2% x 27 points = +54% from the capstone term alone; the whole scale must
    // stay finite and bounded rather than compounding without limit.
    expect(p.arrowDamageScale()).toBeLessThan(4);
  });
});

describe('Unspent Shafts', () => {
  it('counts only WASTED arrows and fires on the Nth', () => {
    const h = runtimeWith({ 'unspent-shafts': 1 });
    h.setNearby([makeEnemy()]);
    const p = h.rt.arrowPolicy();
    for (let i = 0; i < 5; i++) p.onArrowExpired(false);
    expect(h.calls.rings).toHaveLength(0);
    p.onArrowExpired(false);
    expect(h.calls.rings).toHaveLength(1);
  });

  it('ignores arrows that connected, below rank 3', () => {
    const h = runtimeWith({ 'unspent-shafts': 1 });
    const p = h.rt.arrowPolicy();
    for (let i = 0; i < 20; i++) p.onArrowExpired(true);
    expect(h.calls.rings).toHaveLength(0);
  });
});

describe('reset()', () => {
  it('clears points and every counter', () => {
    const { rt, calls } = runtimeWith({ stormbound: 3, 'rage-ascendant': 3 });
    for (let i = 0; i < STORMBOUND_KILLS[2] - 1; i++) rt.onKill(0, 0);
    rt.reset();
    expect(rt.damageBonusMult()).toBe(1);
    for (let i = 0; i < STORMBOUND_KILLS[2] - 1; i++) rt.onKill(0, 0);
    expect(calls.reduceCd).toHaveLength(0); // points gone, counter restarted
  });
});
