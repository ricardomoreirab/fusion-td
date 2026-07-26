import { describe, expect, it } from 'vitest';
import { AscensionSystem, ASCENSION_CONFIG } from '../src/survivors/ascension/AscensionSystem';
import { TIER_GATE } from '../src/survivors/ascension/AscensionTrees';

/**
 * Pure logic — no Three, no DOM, no PlayerStats. Mirrors LevelSystem.spec.ts.
 */

describe('AscensionSystem curve', () => {
  it('matches the authored curve at both ends', () => {
    const asc = new AscensionSystem('barbarian');
    expect(asc.xpToNext(0)).toBe(3200);
    expect(asc.xpToNext(1)).toBe(3760);
    expect(asc.xpToNext(49)).toBe(30_640); // 3200 + 560*49
  });

  it('costs exactly 846,000 XP to reach A50', () => {
    const asc = new AscensionSystem('barbarian');
    let total = 0;
    for (let a = 0; a < ASCENSION_CONFIG.maxAscension; a++) total += asc.xpToNext(a);
    expect(total).toBe(846_000);
    // Closed form: 280A² + 2920A.
    expect(280 * 50 * 50 + 2920 * 50).toBe(846_000);
  });

  it('starts at A0 with no points', () => {
    const asc = new AscensionSystem('barbarian');
    expect(asc.getLevel()).toBe(0);
    expect(asc.getUnspent()).toBe(0);
    expect(asc.getProgress()).toBe(0);
    expect(asc.isMaxAscension()).toBe(false);
  });
});

describe('AscensionSystem.addXp', () => {
  it('grants one point per level and reports the levels gained', () => {
    const asc = new AscensionSystem('barbarian');
    expect(asc.addXp(3200)).toBe(1);
    expect(asc.getLevel()).toBe(1);
    expect(asc.getUnspent()).toBe(1);
  });

  it('carries the remainder into the next level', () => {
    const asc = new AscensionSystem('barbarian');
    asc.addXp(3200 + 1880); // A1 exactly, then half of the 3760 needed for A2
    expect(asc.getLevel()).toBe(1);
    expect(asc.getProgress()).toBeCloseTo(0.5, 6);
  });

  it('handles a multi-level grant in one call', () => {
    const asc = new AscensionSystem('barbarian');
    // 3200 + 3760 + 4320 = 11,280 → exactly A3.
    expect(asc.addXp(11_280)).toBe(3);
    expect(asc.getLevel()).toBe(3);
    expect(asc.getUnspent()).toBe(3);
    expect(asc.getProgress()).toBe(0);
  });

  it('caps at A50 and discards the surplus', () => {
    const asc = new AscensionSystem('barbarian');
    expect(asc.addXp(10_000_000)).toBe(50);
    expect(asc.getLevel()).toBe(50);
    expect(asc.getUnspent()).toBe(50);
    expect(asc.isMaxAscension()).toBe(true);
    expect(asc.getProgress()).toBe(1);
    expect(asc.addXp(10_000)).toBe(0); // no-op at the cap
    expect(asc.getUnspent()).toBe(50);
  });

  it('ignores non-positive amounts', () => {
    const asc = new AscensionSystem('barbarian');
    expect(asc.addXp(0)).toBe(0);
    expect(asc.addXp(-500)).toBe(0);
    expect(asc.getTotalXp()).toBe(0);
  });
});

describe('AscensionSystem.spend gating', () => {
  function maxed(champ: 'barbarian' | 'ranger' | 'mage' = 'barbarian') {
    const asc = new AscensionSystem(champ);
    asc.addXp(10_000_000);
    return asc;
  }

  it('refuses to spend with no points banked', () => {
    const asc = new AscensionSystem('barbarian');
    expect(asc.canSpend('gale-force')).toBe(false);
    expect(asc.spend('gale-force')).toBe(false);
    expect(asc.getPoints('gale-force')).toBe(0);
  });

  it('allows tier 1 immediately and caps each node at 3 points', () => {
    const asc = maxed();
    expect(asc.spend('gale-force')).toBe(true);
    expect(asc.spend('gale-force')).toBe(true);
    expect(asc.spend('gale-force')).toBe(true);
    expect(asc.spend('gale-force')).toBe(false);
    expect(asc.getPoints('gale-force')).toBe(3);
    expect(asc.getUnspent()).toBe(47);
  });

  it('rejects an unknown node id', () => {
    const asc = maxed();
    expect(asc.canSpend('not-a-node')).toBe(false);
    expect(asc.spend('not-a-node')).toBe(false);
  });

  /** Pour points into a path via any currently-spendable node except `excludeId`. */
  function fillPath(asc: AscensionSystem, pathId: string, target: number, excludeId: string): void {
    const path = asc.getTree().find((p) => p.id === pathId)!;
    let guard = 0;
    while (asc.pointsInPath(pathId) < target && guard++ < 500) {
      const node = path.nodes.find((n) => n.id !== excludeId && asc.canSpend(n.id));
      if (!node) break;
      asc.spend(node.id);
    }
  }

  it('enforces every tier gate at exactly the documented threshold', () => {
    const cases: Array<[2 | 3 | 4 | 5, string]> = [
      [2, 'eye-of-the-storm'],
      [3, 'stormbound'],
      [4, 'hurricane-heart'],
      [5, 'eye-of-the-maelstrom'],
    ];
    for (const [tier, nodeId] of cases) {
      const asc = maxed();
      const gate = TIER_GATE[tier];

      fillPath(asc, 'bar-tempest', gate - 1, nodeId);
      expect(asc.pointsInPath('bar-tempest'), `tier ${tier} setup`).toBe(gate - 1);
      expect(asc.canSpend(nodeId), `tier ${tier} must stay locked one point short`).toBe(false);

      fillPath(asc, 'bar-tempest', gate, nodeId);
      expect(asc.pointsInPath('bar-tempest')).toBe(gate);
      expect(asc.canSpend(nodeId), `tier ${tier} must open at ${gate}`).toBe(true);
    }
  });

  it('opens a capstone only after 21 points in its own path', () => {
    const asc = maxed();
    fillPath(asc, 'bar-tempest', 21, 'eye-of-the-maelstrom');
    expect(asc.spend('eye-of-the-maelstrom')).toBe(true);
    // 21 + 3 = 24 for one maxed capstone; the budget of 50 cannot buy three.
    asc.spend('eye-of-the-maelstrom');
    asc.spend('eye-of-the-maelstrom');
    expect(asc.getSpent()).toBe(24);
    expect(asc.getUnspent()).toBe(26);
  });

  it('counts POINTS not nodes toward a gate', () => {
    const asc = maxed();
    // Four points in a single tier-1 node is impossible (cap 3), so use two nodes.
    asc.spend('gale-force'); asc.spend('gale-force'); asc.spend('gale-force');
    expect(asc.pointsInPath('bar-tempest')).toBe(3);
    expect(asc.canSpend('eye-of-the-storm')).toBe(false); // gate is 4
    asc.spend('unending-fury');
    expect(asc.pointsInPath('bar-tempest')).toBe(4);
    expect(asc.canSpend('eye-of-the-storm')).toBe(true);
  });

  it('keeps path totals independent', () => {
    const asc = maxed();
    asc.spend('gale-force');
    asc.spend('tremorbound');
    asc.spend('tremorbound');
    expect(asc.pointsInPath('bar-tempest')).toBe(1);
    expect(asc.pointsInPath('bar-earthshaker')).toBe(2);
    expect(asc.pointsInPath('bar-bloodsworn')).toBe(0);
    expect(asc.getSpent()).toBe(3);
  });

  it('explains why a gated node is blocked', () => {
    const asc = maxed();
    expect(asc.blockedReason('eye-of-the-storm')).toContain('4 more points');
    asc.spend('gale-force');
    expect(asc.blockedReason('eye-of-the-storm')).toContain('3 more points');
    expect(asc.blockedReason('gale-force')).toBeNull();
  });

  it('reports rider state from the named node in another path', () => {
    const asc = maxed();
    const tempest = asc.getTree().find((p) => p.id === 'bar-tempest')!;
    const eye = tempest.nodes.find((n) => n.id === 'eye-of-the-storm')!;
    expect(asc.riderActive(eye)).toBe(false);
    asc.spend('bloodthirst'); // the node its rider names, in Bloodsworn
    expect(asc.riderActive(eye)).toBe(true);
  });

  it('exposes capstone gate progress from the first point spent', () => {
    const asc = maxed();
    expect(asc.capstoneProgress('bar-tempest')).toEqual({ have: 0, need: 21 });
    asc.spend('gale-force');
    expect(asc.capstoneProgress('bar-tempest')).toEqual({ have: 1, need: 21 });
  });
});
