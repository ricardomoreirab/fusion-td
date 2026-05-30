import { PlayerStats } from './PlayerStats';
import { HeroController } from './HeroController';

/** Identifiers for the four milestone-boss items. */
export type ItemId = 'lifesteal' | 'multishotCleave' | 'knockback' | 'attackSpeed';

/** Which item drops at which boss tier (waveNumber / 5). Missing tiers drop nothing. */
const ITEM_BY_TIER: Record<number, ItemId> = {
    1: 'lifesteal',        // wave 5
    2: 'multishotCleave',  // wave 10
    3: 'knockback',        // wave 15
    4: 'attackSpeed',      // wave 20
};

/** Per-stack tuning constants — see spec for rationale. Adjust here, not at call sites. */
const LIFESTEAL_PCT_PER_STACK   = 0.05; // 5% of damage healed per stack
const KNOCKBACK_UNITS_PER_STACK = 1.0;  // world units pushed per hit per stack
const ATTACK_SPEED_FACTOR       = 2.0;  // multiplier applied once per stack

export class RunItems {
    private stacks: Record<ItemId, number> = {
        lifesteal: 0,
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
     * Increment the stack for an item and re-apply its effect. Safe to call
     * repeatedly; PlayerStats fields are recomputed from the new stack count.
     */
    public grant(id: ItemId): void {
        this.stacks[id]++;
        this.applyEffect(id);
    }

    private applyEffect(id: ItemId): void {
        const n = this.stacks[id];
        switch (id) {
            case 'lifesteal':
                this.stats.lifestealPct = LIFESTEAL_PCT_PER_STACK * n;
                return;

            case 'multishotCleave':
                // Same field for both classes; HeroBasicAttack interprets it based on attack mode.
                this.stats.extraAttacks = n;
                return;

            case 'knockback':
                this.stats.knockbackOnHit = KNOCKBACK_UNITS_PER_STACK * n;
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
