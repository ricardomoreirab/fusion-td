import { ASCENSION_TREES, TIER_GATE, findNode, AscensionPathDef, AscensionNodeDef } from './AscensionTrees';
import type { ChampionType } from '../powers/PowerDefinitions';

/**
 * AscensionSystem — pure-logic post-level-100 progression (no Three, no DOM, no
 * PlayerStats import, so it is unit-testable). Modelled on LevelSystem.
 *
 * Once the hero hits level 100, LevelSystem.addXp() discards every further point
 * of XP. SurvivorsGameplayState routes that surplus here instead (see awardXp —
 * it captures isMaxLevel() BEFORE calling addXp, or the cap-crossing grant is
 * counted twice). Each ascension level grants 1 point, spent in the per-class
 * tree in AscensionTrees.ts.
 *
 * Run-scoped: the gameplay state constructs one per run and nulls it in exit().
 * There is no persistence layer and no respec — a spend is final for the run.
 *
 * The system NEVER touches PlayerStats. Stat nodes are folded from the point
 * counts by foldAscensionStats(); everything else is read by AscensionRuntime.
 */
export interface AscensionConfig {
    /** Hard ascension cap. */
    maxAscension: number;
    /** XP for A0 → A1. */
    curveBase: number;
    /** Linear growth: ascXpToNext(A) = curveBase + curveStep*A. */
    curveStep: number;
    /** Global scalar on every addXp() amount — the calibration knob. */
    gainMultiplier: number;
    /** Points granted per ascension level. */
    pointsPerLevel: number;
}

/**
 * Sized against the REAL XP economy, not the stale "wave 30" claim in
 * LevelSystem.ts: gold is the only XP source, level 100 lands at wave 13, and
 * wave 14 alone yields ~14.5k XP.
 *
 *   cost(A) = 3200A + 280A(A-1) = 280A² + 2920A   →   cost(50) = 846,000 XP
 *
 * A1 arrives ~6s after the cap (3,200 = 22% of one wave-14 clear); A25 lands
 * around wave 24; A50 around wave 36 (wave 31 at 1.6x gold-find, wave 41 at
 * 0.7x). Most runs never reach A50 — that is intended.
 */
export const ASCENSION_CONFIG: AscensionConfig = {
    maxAscension: 50,
    curveBase: 3200,
    curveStep: 560,
    gainMultiplier: 1.0,
    pointsPerLevel: 1,
};

export class AscensionSystem {
    private cfg: AscensionConfig;
    private readonly tree: AscensionPathDef[];
    private level = 0;
    private xpIntoLevel = 0;
    private totalXp = 0;
    private unspent = 0;
    /** nodeId → 0..3. Absent means 0. */
    private points = new Map<string, number>();
    /** pathId → total points spent in it. Kept in sync on every spend. */
    private pathTotals = new Map<string, number>();

    constructor(championType: ChampionType, cfg: AscensionConfig = ASCENSION_CONFIG) {
        this.cfg = cfg;
        this.tree = ASCENSION_TREES[championType];
    }

    getTree(): AscensionPathDef[] { return this.tree; }
    getLevel(): number { return this.level; }
    getTotalXp(): number { return this.totalXp; }
    getUnspent(): number { return this.unspent; }
    isMaxAscension(): boolean { return this.level >= this.cfg.maxAscension; }

    /** XP required to advance FROM ascension level `a` to `a+1`. */
    xpToNext(a: number): number {
        return Math.round(this.cfg.curveBase + this.cfg.curveStep * a);
    }

    /** 0..1 fill of the current ascension level (1 when maxed). */
    getProgress(): number {
        if (this.isMaxAscension()) return 1;
        const need = this.xpToNext(this.level);
        return need > 0 ? Math.min(1, this.xpIntoLevel / need) : 0;
    }

    /**
     * Add ascension XP (scaled by gainMultiplier). Returns the number of levels
     * gained so the caller can fire feedback; each grants `pointsPerLevel`.
     * Surplus at the cap is discarded, mirroring LevelSystem.
     */
    addXp(amount: number): number {
        if (this.isMaxAscension() || amount <= 0) return 0;
        let remaining = amount * this.cfg.gainMultiplier;
        let ups = 0;
        while (remaining > 0 && !this.isMaxAscension()) {
            const need = this.xpToNext(this.level) - this.xpIntoLevel;
            if (remaining >= need) {
                remaining -= need;
                this.totalXp += need;
                this.xpIntoLevel = 0;
                this.level++;
                this.unspent += this.cfg.pointsPerLevel;
                ups++;
            } else {
                this.xpIntoLevel += remaining;
                this.totalXp += remaining;
                remaining = 0;
            }
        }
        if (this.isMaxAscension()) this.xpIntoLevel = 0;
        return ups;
    }

    getPoints(nodeId: string): number {
        return this.points.get(nodeId) ?? 0;
    }

    /** Points spent in a path — the currency every tier gate reads. */
    pointsInPath(pathId: string): number {
        return this.pathTotals.get(pathId) ?? 0;
    }

    /** Total points spent across the whole tree. */
    getSpent(): number {
        let n = 0;
        for (const v of this.points.values()) n += v;
        return n;
    }

    /**
     * The pure gate check. Gates count POINTS, not nodes — 4 points can be one
     * maxed node or two at rank 2, so breadth vs depth inside a tier is free.
     */
    canSpend(nodeId: string): boolean {
        if (this.unspent < 1) return false;
        const node = findNode(this.tree, nodeId);
        if (!node) return false;
        if (this.getPoints(nodeId) >= node.max) return false;
        return this.pointsInPath(node.pathId) >= TIER_GATE[node.tier];
    }

    /** Why canSpend() failed, for the overlay's disabled-button reason string. */
    blockedReason(nodeId: string): string | null {
        const node = findNode(this.tree, nodeId);
        if (!node) return 'Unknown node';
        if (this.getPoints(nodeId) >= node.max) return 'Fully invested';
        const have = this.pointsInPath(node.pathId);
        const need = TIER_GATE[node.tier];
        if (have < need) {
            const path = this.tree.find((p) => p.id === node.pathId);
            return `${path ? path.name : 'This path'} ${have}/${need} — ${need - have} more points in this path`;
        }
        if (this.unspent < 1) return 'No ascension points available';
        return null;
    }

    /** Spend one point. Returns false (and changes nothing) if the gate rejects it. */
    spend(nodeId: string): boolean {
        if (!this.canSpend(nodeId)) return false;
        const node = findNode(this.tree, nodeId)!;
        this.points.set(nodeId, this.getPoints(nodeId) + 1);
        this.pathTotals.set(node.pathId, this.pointsInPath(node.pathId) + 1);
        this.unspent--;
        return true;
    }

    /** Read-only view for the fold and the runtime. */
    snapshot(): ReadonlyMap<string, number> {
        return this.points;
    }

    /** Capstone gate progress for a path, rendered in the overlay column header. */
    capstoneProgress(pathId: string): { have: number; need: number } {
        return { have: this.pointsInPath(pathId), need: TIER_GATE[5] };
    }

    /** Every node the player currently owns at least one point in. */
    activeNodes(): AscensionNodeDef[] {
        const out: AscensionNodeDef[] = [];
        for (const p of this.tree) {
            for (const n of p.nodes) if (this.getPoints(n.id) > 0) out.push(n);
        }
        return out;
    }

    /** True when the player owns >=1 point in the node a rider clause names. */
    riderActive(node: AscensionNodeDef): boolean {
        return node.rider ? this.getPoints(node.rider.requiresNodeId) > 0 : false;
    }
}
