import { describe, expect, it } from 'vitest';
import { ASCENSION_TREES, TIER_GATE, findNode, nodeXY } from '../src/survivors/ascension/AscensionTrees';
import { ASCENSION_CONFIG } from '../src/survivors/ascension/AscensionSystem';
import { BLOODTHIRST_PER_POINT, FISSURE_TRAVEL_CAP } from '../src/survivors/ascension/AscensionRuntime';
import type { ChampionType } from '../src/survivors/powers/PowerDefinitions';

/**
 * The design promise, asserted as arithmetic rather than left as a tuning hope:
 * a run can light at most TWO of the three constellations. If someone widens a
 * path, loosens a gate or raises the point budget, this fails loudly.
 */

const CLASSES: ChampionType[] = ['barbarian', 'ranger', 'mage'];
const POINT_BUDGET = ASCENSION_CONFIG.maxAscension * ASCENSION_CONFIG.pointsPerLevel;

describe('Ascension tree shape', () => {
  it('gives every class exactly 3 paths of 9 nodes', () => {
    for (const c of CLASSES) {
      const tree = ASCENSION_TREES[c];
      expect(tree, c).toHaveLength(3);
      for (const p of tree) expect(p.nodes, `${c}/${p.id}`).toHaveLength(9);
    }
  });

  it('lays out every path as 2/2/2/2/1 across tiers 1-5', () => {
    for (const c of CLASSES) {
      for (const p of ASCENSION_TREES[c]) {
        const byTier = [1, 2, 3, 4, 5].map((t) => p.nodes.filter((n) => n.tier === t).length);
        expect(byTier, `${c}/${p.id}`).toEqual([2, 2, 2, 2, 1]);
      }
    }
  });

  it('caps every node at 3 points', () => {
    for (const c of CLASSES) {
      for (const p of ASCENSION_TREES[c]) {
        for (const n of p.nodes) expect(n.max, n.id).toBe(3);
      }
    }
  });

  it('names the tier-5 node as the path capstone', () => {
    for (const c of CLASSES) {
      for (const p of ASCENSION_TREES[c]) {
        const capstone = p.nodes.find((n) => n.tier === 5)!;
        expect(p.capstoneId, p.id).toBe(capstone.id);
      }
    }
  });

  it('keeps node ids unique across ALL classes', () => {
    const seen = new Map<string, string>();
    for (const c of CLASSES) {
      for (const p of ASCENSION_TREES[c]) {
        for (const n of p.nodes) {
          expect(seen.has(n.id), `duplicate id ${n.id} (${seen.get(n.id)} and ${c}/${p.id})`).toBe(false);
          seen.set(n.id, `${c}/${p.id}`);
        }
      }
    }
    expect(seen.size).toBe(81);
  });

  it('gives every node a description that changes across its three ranks', () => {
    for (const c of CLASSES) {
      for (const p of ASCENSION_TREES[c]) {
        for (const n of p.nodes) {
          const texts = [n.desc(1), n.desc(2), n.desc(3)];
          for (const t of texts) expect(t.length, n.id).toBeGreaterThan(10);
          // P3 must be a threshold, never a third tick of the same number.
          expect(new Set(texts).size, `${n.id} ranks are not distinct`).toBe(3);
        }
      }
    }
  });

  it('places every node at a distinct position within its class', () => {
    for (const c of CLASSES) {
      const seen = new Set<string>();
      ASCENSION_TREES[c].forEach((p, pi) => {
        for (const n of p.nodes) {
          const { x, y } = nodeXY(pi, n);
          const key = `${x}:${y}`;
          expect(seen.has(key), `${n.id} overlaps another node`).toBe(false);
          seen.add(key);
        }
      });
    }
  });
});

describe('Ascension riders', () => {
  it('always point at a real node in a DIFFERENT path of the same class', () => {
    for (const c of CLASSES) {
      const tree = ASCENSION_TREES[c];
      for (const p of tree) {
        for (const n of p.nodes) {
          if (!n.rider) continue;
          const target = findNode(tree, n.rider.requiresNodeId);
          expect(target, `${n.id} rider → ${n.rider.requiresNodeId}`).not.toBeNull();
          expect(target!.pathId, `${n.id} rider must cross paths`).not.toBe(n.pathId);
        }
      }
    }
  });

  it('gives every class at least one rider in each direction', () => {
    for (const c of CLASSES) {
      const tree = ASCENSION_TREES[c];
      const riders = tree.flatMap((p) => p.nodes.filter((n) => n.rider));
      expect(riders.length, c).toBeGreaterThanOrEqual(5);
      // Every path both depends on another and is depended upon.
      for (const p of tree) {
        const outgoing = p.nodes.filter((n) => n.rider).length;
        const incoming = tree.flatMap((q) => q.nodes)
          .filter((n) => n.rider && findNode(tree, n.rider.requiresNodeId)!.pathId === p.id).length;
        expect(outgoing, `${c}/${p.id} outgoing riders`).toBeGreaterThanOrEqual(1);
        expect(incoming, `${c}/${p.id} incoming riders`).toBeGreaterThanOrEqual(1);
      }
    }
  });
});

describe('runtime constants that mirror node data', () => {
  it('keeps BLOODTHIRST_PER_POINT equal to the node def stat', () => {
    // The below-40% "doubling" re-heals exactly the node's OWN lifesteal slice.
    // If these two drift, the doubling goes quietly WRONG rather than breaking.
    const node = findNode(ASCENSION_TREES.barbarian, 'bloodthirst')!;
    expect(node.stat).toBeDefined();
    expect(node.stat!.kind).toBe('addShared');
    expect((node.stat as { perPoint: number }).perPoint).toBe(BLOODTHIRST_PER_POINT);
  });

  it('caps The Fissure travel at the animation-LOD radius', () => {
    // Past ANIM_FULL_RATE_RADIUS (16u) the wave hits enemies posing at 30Hz.
    expect(FISSURE_TRAVEL_CAP).toBe(16);
  });
});

describe('Ascension scarcity', () => {
  const PATH_CAPACITY = 9 * 3;            // 27
  const TREE_CAPACITY = PATH_CAPACITY * 3; // 81
  const CAPSTONE_AT_RANK_1 = TIER_GATE[5] + 1; // 22
  const CAPSTONE_MAXED = TIER_GATE[5] + 3;     // 24

  it('budgets 50 points against 81 capacity', () => {
    expect(POINT_BUDGET).toBe(50);
    expect(TREE_CAPACITY).toBe(81);
    expect(POINT_BUDGET / TREE_CAPACITY).toBeCloseTo(0.617, 3);
  });

  it('lets a perfect run max exactly two capstones', () => {
    expect(CAPSTONE_MAXED * 2).toBe(48);
    expect(CAPSTONE_MAXED * 2).toBeLessThanOrEqual(POINT_BUDGET);
  });

  it('makes THREE capstones unreachable at any rank', () => {
    expect(CAPSTONE_AT_RANK_1 * 3).toBe(66);
    expect(CAPSTONE_AT_RANK_1 * 3).toBeGreaterThan(POINT_BUDGET);
    expect(CAPSTONE_MAXED * 3).toBeGreaterThan(POINT_BUDGET);
  });

  it('holds for every class, since all three trees share the structure', () => {
    for (const c of CLASSES) {
      const capacity = ASCENSION_TREES[c].reduce(
        (sum, p) => sum + p.nodes.reduce((s, n) => s + n.max, 0), 0,
      );
      expect(capacity, c).toBe(TREE_CAPACITY);
      expect(capacity).toBeGreaterThan(POINT_BUDGET);
    }
  });

  it('cannot reach a capstone without committing most of a path', () => {
    // The whole divergence thesis: 21 of a path's 27 points before tier 5 opens.
    expect(TIER_GATE[5] / PATH_CAPACITY).toBeGreaterThan(0.75);
    expect(TIER_GATE[1]).toBe(0); // tier 1 always open
    const gates = [TIER_GATE[1], TIER_GATE[2], TIER_GATE[3], TIER_GATE[4], TIER_GATE[5]];
    for (let i = 1; i < gates.length; i++) expect(gates[i]).toBeGreaterThan(gates[i - 1]);
  });

  it('keeps every gate reachable within its own path', () => {
    // A gate above 24 would be unreachable before the capstone's own 3 points.
    expect(TIER_GATE[5]).toBeLessThanOrEqual(PATH_CAPACITY - 3);
  });
});
