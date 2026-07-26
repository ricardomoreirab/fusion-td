import { describe, expect, it } from 'vitest';
import { PlayerStats } from '../src/survivors/PlayerStats';
import { AscensionSystem } from '../src/survivors/ascension/AscensionSystem';
import { foldAscensionStats, newAscFoldTracker } from '../src/survivors/ascension/ascensionStats';
import { foldEquipmentStats, newEquipFoldTracker } from '../src/survivors/items/foldEquipmentStats';
import type { EquipmentAggregates } from '../src/survivors/items/Equipment';
import type { ItemEffectId } from '../src/survivors/items/ItemTypes';

/**
 * The phase-0 gate. applyLevelBonuses() ASSIGNS every derived multiplier and
 * runs several times per wave (level-up, wave clear, equip, potion), so the
 * ascension fold is only correct if folding N times is indistinguishable from
 * folding once, and if the two additive fields SHARED with RunItems/equipment
 * delta-swap exactly rather than accumulating.
 *
 * These must be green before a single node effect exists.
 */

/** Re-assign exactly the fields applyLevelBonuses() assigns, so the fold sees a
 *  realistic starting point each recompute. Values mirror level 100. */
function assignLevelBonuses(ps: PlayerStats): void {
  const b = 99 * 0.005;
  const g = b * 2;
  const gp = (1 - Math.exp(-4 * b)) * 0.5;
  ps.moveSpeedMultiplier = 1 + g;
  ps.attackRangeMultiplier = 1 + g;
  ps.basicAttackSpeedMultiplier = 1 + g * 0.5;
  ps.powerDamageMultiplier = 1 + gp;
  ps.powerCooldownMultiplier = Math.max(0.05, 1 - gp);
  ps.damageReductionMultiplier = Math.max(0.3, 1 - g);
  ps.critChance = b;
  ps.critDamageMultiplier = 1.5 * (1 + g);
}

function makeAggregates(over: Partial<EquipmentAggregates> = {}): EquipmentAggregates {
  return {
    basicDamageMult: 1, powerDamageMult: 1, attackSpeedMult: 1, moveSpeedMult: 1,
    cooldownMult: 1, damageTakenMult: 1, goldGainMult: 1,
    critChance: 0, critDamage: 0, lifesteal: 0, maxHealth: 0, hpRegenPctPerSec: 0,
    knockback: 0,
    effects: new Set<ItemEffectId>(), setCounts: {},
    ...over,
  };
}

/** A maxed spread that exercises every AscensionStatContribution kind. */
function investedBarbarian(): AscensionSystem {
  const asc = new AscensionSystem('barbarian');
  asc.addXp(1_000_000); // A50 → 50 points
  // addShared x2 (knockback), addShared (lifesteal) behind its tier-1 gate.
  for (let i = 0; i < 3; i++) asc.spend('tremorbound');
  for (let i = 0; i < 3; i++) asc.spend('bloodthirst');
  return asc;
}

function snapshotStats(ps: PlayerStats): Record<string, number> {
  return {
    moveSpeedMultiplier: ps.moveSpeedMultiplier,
    attackRangeMultiplier: ps.attackRangeMultiplier,
    basicAttackSpeedMultiplier: ps.basicAttackSpeedMultiplier,
    powerDamageMultiplier: ps.powerDamageMultiplier,
    powerCooldownMultiplier: ps.powerCooldownMultiplier,
    damageReductionMultiplier: ps.damageReductionMultiplier,
    critChance: ps.critChance,
    critDamageMultiplier: ps.critDamageMultiplier,
    lifestealPct: ps.lifestealPct,
    knockbackOnHit: ps.knockbackOnHit,
    extraAttacks: ps.extraAttacks,
    ricochetBounces: ps.ricochetBounces,
    basicDamageMultiplier: ps.basicDamageMultiplier,
    goldGainMultiplier: ps.goldGainMultiplier,
    hpRegenPctPerSec: ps.hpRegenPctPerSec,
  };
}

describe('foldAscensionStats idempotency', () => {
  it('folding 20 times is byte-identical to folding once', () => {
    const asc = investedBarbarian();

    const once = new PlayerStats();
    const t1 = newAscFoldTracker();
    assignLevelBonuses(once);
    foldAscensionStats(once, asc, t1);

    const many = new PlayerStats();
    const t2 = newAscFoldTracker();
    for (let i = 0; i < 20; i++) {
      assignLevelBonuses(many); // every recompute re-assigns first
      foldAscensionStats(many, asc, t2);
    }

    expect(snapshotStats(many)).toEqual(snapshotStats(once));
  });

  it('a fold with zero points spent leaves every field at its assigned value', () => {
    const asc = new AscensionSystem('mage');
    const ps = new PlayerStats();
    const t = newAscFoldTracker();
    assignLevelBonuses(ps);
    const before = snapshotStats(ps);
    for (let i = 0; i < 5; i++) foldAscensionStats(ps, asc, t);
    expect(snapshotStats(ps)).toEqual(before);
  });
});

describe('foldAscensionStats interleaved with foldEquipmentStats', () => {
  it('keeps the shared additive fields exact and never desyncs either tracker', () => {
    const asc = investedBarbarian();
    const agg = makeAggregates({ lifesteal: 0.11, knockback: 0.7, critChance: 0.04, critDamage: 0.25 });

    const ps = new PlayerStats();
    const ascT = newAscFoldTracker();
    const eqT = newEquipFoldTracker();

    for (let i = 0; i < 12; i++) {
      assignLevelBonuses(ps);
      foldEquipmentStats(ps, agg, eqT); // equipment folds first, as in applyLevelBonuses
      foldAscensionStats(ps, asc, ascT);
    }

    // Bloodthirst 3pt = 0.09 lifesteal, equipment adds 0.11 → exactly 0.20.
    expect(ps.lifestealPct).toBeCloseTo(0.2, 10);
    // Tremorbound 3pt = 1.5 knockback, equipment adds 0.7 → exactly 2.2.
    expect(ps.knockbackOnHit).toBeCloseTo(2.2, 10);
    expect(ascT.lifesteal).toBeCloseTo(0.09, 10);
    expect(ascT.knockback).toBeCloseTo(1.5, 10);
    expect(eqT.lifesteal).toBeCloseTo(0.11, 10);
    expect(eqT.knockback).toBeCloseTo(0.7, 10);
  });

  it('a RunItems-style raw += on a shared field survives the ascension fold', () => {
    // RunItems does `stats.knockbackOnHit += X` once, outside the recompute.
    const asc = investedBarbarian();
    const ps = new PlayerStats();
    const t = newAscFoldTracker();
    assignLevelBonuses(ps);
    ps.knockbackOnHit += 2.0; // the milestone drop
    for (let i = 0; i < 8; i++) {
      assignLevelBonuses(ps);
      foldAscensionStats(ps, asc, t);
    }
    expect(ps.knockbackOnHit).toBeCloseTo(3.5, 10); // 2.0 RunItems + 1.5 ascension
  });
});

describe('the stat nodes that are wired today actually reach PlayerStats', () => {
  /** Pour points into a path until `target`, avoiding the node under test. */
  function fillPath(asc: AscensionSystem, pathId: string, target: number, exclude: string): void {
    const path = asc.getTree().find((p) => p.id === pathId)!;
    let guard = 0;
    while (asc.pointsInPath(pathId) < target && guard++ < 500) {
      const n = path.nodes.find((x) => x.id !== exclude && asc.canSpend(x.id));
      if (!n) break;
      asc.spend(n.id);
    }
  }

  /** Max one node (filling its path to the tier gate first) and fold. */
  function investAndFold(champ: 'barbarian' | 'ranger' | 'mage', nodeId: string): PlayerStats {
    const asc = new AscensionSystem(champ);
    asc.addXp(1_000_000);
    const path = asc.getTree().find((p) => p.nodes.some((n) => n.id === nodeId))!;
    const node = path.nodes.find((n) => n.id === nodeId)!;
    fillPath(asc, path.id, { 1: 0, 2: 4, 3: 9, 4: 15, 5: 21 }[node.tier]!, nodeId);
    for (let i = 0; i < 3; i++) expect(asc.spend(nodeId), `${nodeId} spend ${i}`).toBe(true);
    expect(asc.getPoints(nodeId)).toBe(3);

    const ps = new PlayerStats(); // pristine defaults, no level bonuses
    foldAscensionStats(ps, asc, newAscFoldTracker());
    return ps;
  }

  it('Tremorbound adds knockback (shared additive)', () => {
    expect(investAndFold('barbarian', 'tremorbound').knockbackOnHit).toBeCloseTo(1.5, 10);
  });

  it('Bloodthirst adds lifesteal (shared additive)', () => {
    expect(investAndFold('barbarian', 'bloodthirst').lifestealPct).toBeCloseTo(0.09, 10);
  });

  it('Keen Edge adds crit chance (assigned additive)', () => {
    expect(investAndFold('ranger', 'keen-edge').critChance).toBeCloseTo(0.18, 10);
  });

  it('Second Nature multiplies attack speed', () => {
    expect(investAndFold('ranger', 'second-nature').basicAttackSpeedMultiplier).toBeCloseTo(1.42, 10);
  });

  it('The Long Stride multiplies move speed', () => {
    expect(investAndFold('ranger', 'the-long-stride').moveSpeedMultiplier).toBeCloseTo(1.27, 10);
  });

  it('Quickened Tongue compounds the power cooldown multiplier', () => {
    expect(investAndFold('mage', 'quickened-tongue').powerCooldownMultiplier)
      .toBeCloseTo(0.92 ** 3, 10);
  });

  it('Glacial Reach multiplies attack range', () => {
    expect(investAndFold('mage', 'glacial-reach').attackRangeMultiplier).toBeCloseTo(1.15, 10);
  });

  it('every OTHER node is inert — it carries a runtime id with no runtime yet', () => {
    // Honest accounting: 7 of 81 nodes are wired. The rest render, gate and
    // spend correctly but have no combat effect until AscensionRuntime lands.
    const wired = new Set([
      'tremorbound', 'bloodthirst', 'keen-edge', 'second-nature',
      'the-long-stride', 'quickened-tongue', 'glacial-reach',
    ]);
    let total = 0, withStat = 0;
    for (const champ of ['barbarian', 'ranger', 'mage'] as const) {
      for (const p of new AscensionSystem(champ).getTree()) {
        for (const n of p.nodes) {
          total++;
          if (n.stat) { withStat++; expect(wired.has(n.id), `${n.id} gained a stat`).toBe(true); }
        }
      }
    }
    expect(total).toBe(81);
    expect(withStat).toBe(7);
  });
});

describe('foldAscensionStats guard rails', () => {
  it('re-clamps the two floors after the ascension term', () => {
    const asc = new AscensionSystem('mage');
    asc.addXp(1_000_000);
    for (let i = 0; i < 3; i++) asc.spend('quickened-tongue'); // multPow 0.92^3 on cooldown

    const ps = new PlayerStats();
    const t = newAscFoldTracker();
    assignLevelBonuses(ps);
    // Drive both fields under their floors the way equipment + potions can.
    ps.powerCooldownMultiplier = 0.02;
    ps.damageReductionMultiplier = 0.05;
    foldAscensionStats(ps, asc, t);

    expect(ps.powerCooldownMultiplier).toBe(0.05);
    expect(ps.damageReductionMultiplier).toBe(0.25);
  });

  it('never writes the five fields owned by RunItems or equipment', () => {
    const asc = investedBarbarian();
    const ps = new PlayerStats();
    const t = newAscFoldTracker();

    // Values only RunItems / equipment are allowed to own.
    ps.extraAttacks = 2;
    ps.ricochetBounces = 3;
    ps.basicDamageMultiplier = 1.4;
    ps.goldGainMultiplier = 1.25;
    ps.hpRegenPctPerSec = 0.02;

    for (let i = 0; i < 10; i++) foldAscensionStats(ps, asc, t);

    expect(ps.extraAttacks).toBe(2);
    expect(ps.ricochetBounces).toBe(3);
    expect(ps.basicDamageMultiplier).toBe(1.4);
    expect(ps.goldGainMultiplier).toBe(1.25);
    expect(ps.hpRegenPctPerSec).toBe(0.02);
  });

  it('applies a multPow contribution as factor^points, not per-point addition', () => {
    const asc = new AscensionSystem('mage');
    asc.addXp(1_000_000);
    asc.spend('quickened-tongue');
    asc.spend('quickened-tongue');

    const ps = new PlayerStats();
    ps.powerCooldownMultiplier = 1;
    foldAscensionStats(ps, asc, newAscFoldTracker());
    expect(ps.powerCooldownMultiplier).toBeCloseTo(0.92 * 0.92, 10);
  });
});
