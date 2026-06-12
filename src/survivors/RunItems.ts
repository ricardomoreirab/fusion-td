import { PlayerStats } from './PlayerStats';
import { HeroController } from './HeroController';

/** Identifiers for the four milestone-boss items. */
export type ItemId = 'extraLife' | 'multishotCleave' | 'knockback' | 'attackSpeed';

/** Which item drops at which boss tier (waveNumber / 5). Missing tiers drop nothing. */
const ITEM_BY_TIER: Record<number, ItemId> = {
    1: 'extraLife',        // wave 5
    2: 'multishotCleave',  // wave 10
    3: 'knockback',        // wave 15
    4: 'attackSpeed',      // wave 20
};

/** Per-stack tuning constants — see spec for rationale. Adjust here, not at call sites. */
const KNOCKBACK_UNITS_PER_STACK = 1.0;  // world units pushed per hit per stack
/** Exported: applyLevelBonuses() re-folds this per stack on every recompute
 *  (its `basicAttackSpeedMultiplier = …` assignment would otherwise erase it). */
export const ATTACK_SPEED_FACTOR = 2.0; // multiplier applied once per stack

export class RunItems {
    private stacks: Record<ItemId, number> = {
        extraLife: 0,
        multishotCleave: 0,
        knockback: 0,
        attackSpeed: 0,
    };

    constructor(
        private readonly stats: PlayerStats,
        private readonly championType: string,
        private readonly heroController: HeroController,
    ) {}

    public hasItem(id: ItemId): boolean {
        return this.stacks[id] > 0;
    }

    public getStacks(id: ItemId): number {
        return this.stacks[id];
    }

    /** Look up the item awarded at a given boss tier, or null if none. */
    public static itemForTier(tier: number): ItemId | null {
        return ITEM_BY_TIER[tier] ?? null;
    }

    /**
     * Increment the stack for an item and apply its effect. Safe to call
     * repeatedly; most PlayerStats fields are recomputed from the new stack
     * count (knockback is incremental — it shares its field with equipment).
     */
    public grant(id: ItemId): void {
        this.stacks[id]++;
        this.applyEffect(id);
    }

    /**
     * Consume one Extra Life charge (called after a revive fires) so the HUD slot,
     * which reads getStacks('extraLife'), empties. The HeroController owns the
     * gameplay-side charge counter and decrements it independently on revive.
     */
    public consumeExtraLife(): void {
        if (this.stacks.extraLife > 0) this.stacks.extraLife--;
    }

    private applyEffect(id: ItemId): void {
        const n = this.stacks[id];
        switch (id) {
            case 'extraLife':
                // One revive charge per stack. The HeroController owns the death-
                // interception; we just hand it the charge.
                this.heroController.addReviveCharge();
                return;

            case 'multishotCleave':
                // Same field for both classes; HeroBasicAttack interprets it based on attack mode.
                this.stats.extraAttacks = n;
                return;

            case 'knockback':
                // ADDITIVE on purpose: foldEquipmentStats() delta-swaps this shared field
                // assuming RunItems only ever +=s it — an assignment here would wipe the
                // equipment contribution and permanently desync the fold tracker.
                this.stats.knockbackOnHit += KNOCKBACK_UNITS_PER_STACK;
                return;

            case 'attackSpeed':
                // Multiplicative composition with the shop's Haste item (which also writes
                // basicAttackSpeedMultiplier and pushes through heroController.updateBasicAttackSpeed).
                // On grant we multiply by the per-stack factor and re-publish; subsequent grants
                // compound naturally.
                this.stats.basicAttackSpeedMultiplier *= ATTACK_SPEED_FACTOR;
                this.heroController.updateBasicAttackSpeed(this.stats.basicAttackSpeedMultiplier);
                return;
        }
    }
}
