import { PlayerStats } from '../PlayerStats';
import { EquipSlot, ItemDef, ItemEffectId, ItemStatMods, RARITY_BASE_PRICE } from './ItemTypes';
import { ITEM_SETS } from './ItemCatalog';
import { bonusScaleFor, itemPriceScaleFor, scaleMods } from '../shop/ShopUpgrade';

export interface EquippedItem {
    def: ItemDef;
    pricePaid: number;
    /** Shop upgrade level captured at purchase; freezes this item's bonus tier. */
    level: number;
}

/** Aggregated contribution of all equipped items + active 2pc set bonuses.
 *  Mults default to 1, additives to 0. Folded into PlayerStats by
 *  foldEquipmentStats() inside the state's applyLevelBonuses() recompute. */
export interface EquipmentAggregates {
    basicDamageMult: number;
    powerDamageMult: number;
    attackSpeedMult: number;
    moveSpeedMult: number;
    cooldownMult: number;      // <1 = faster
    damageTakenMult: number;   // <1 = tankier
    goldGainMult: number;
    critChance: number;
    critDamage: number;
    lifesteal: number;
    maxHealth: number;
    hpRegenPctPerSec: number;
    knockback: number;
    /** Item effectIds + 3pc set signature effects currently active. */
    effects: Set<ItemEffectId>;
    /** setId → owned piece count (drives shop pity weighting + UI badges). */
    setCounts: Record<string, number>;
}

export function priceFor(def: ItemDef, wave: number, shopLevel = 0): number {
    return Math.ceil(RARITY_BASE_PRICE[def.rarity] * (1 + 0.06 * wave) * itemPriceScaleFor(shopLevel));
}

export function sellValueOf(pricePaid: number): number {
    return Math.floor(pricePaid * 0.6);
}

/** Per-run equipment inventory. Pure logic — no Babylon, no DOM.
 *  Only touches PlayerStats gold (spendGold/refundGold), never stat fields. */
export class Equipment {
    private slots = new Map<EquipSlot, EquippedItem>();

    constructor(private stats: PlayerStats) {}

    public get(slot: EquipSlot): EquippedItem | null {
        return this.slots.get(slot) ?? null;
    }

    public ownedIds(): Set<string> {
        return new Set([...this.slots.values()].map(e => e.def.id));
    }

    /** id → captured shop level for each equipped item. Drives shop stock so an
     *  owned item reappears once the shop can sell a higher-level version. */
    public ownedLevels(): Map<string, number> {
        const m = new Map<string, number>();
        for (const e of this.slots.values()) m.set(e.def.id, e.level);
        return m;
    }

    public setCount(setId: string): number {
        let n = 0;
        for (const e of this.slots.values()) if (e.def.setId === setId) n++;
        return n;
    }

    /** Buy `def` at the wave-scaled price. A piece already in the slot is
     *  auto-sold at 60% of what was paid for it (credited via refundGold so
     *  sell-backs never count as income/XP). Returns false if unaffordable. */
    public buy(def: ItemDef, wave: number, shopLevel = 0): boolean {
        const price = priceFor(def, wave, shopLevel);
        const old = this.slots.get(def.slot) ?? null;
        const credit = old ? sellValueOf(old.pricePaid) : 0;
        if (this.stats.getGold() + credit < price) return false;
        if (credit > price) {
            this.stats.refundGold(credit - price);
        } else {
            this.stats.spendGold(price - credit);
        }
        this.slots.set(def.slot, { def, pricePaid: price, level: shopLevel });
        return true;
    }

    public aggregates(): EquipmentAggregates {
        const agg: EquipmentAggregates = {
            basicDamageMult: 1, powerDamageMult: 1, attackSpeedMult: 1,
            moveSpeedMult: 1, cooldownMult: 1, damageTakenMult: 1, goldGainMult: 1,
            critChance: 0, critDamage: 0, lifesteal: 0, maxHealth: 0,
            hpRegenPctPerSec: 0, knockback: 0,
            effects: new Set<ItemEffectId>(), setCounts: {},
        };
        for (const e of this.slots.values()) {
            this.foldMods(agg, scaleMods(e.def.mods, bonusScaleFor(e.level)));
            if (e.def.effectId) agg.effects.add(e.def.effectId);
            if (e.def.setId) agg.setCounts[e.def.setId] = (agg.setCounts[e.def.setId] ?? 0) + 1;
        }
        for (const set of ITEM_SETS) {
            const count = agg.setCounts[set.id] ?? 0;
            for (const tier of set.tiers) {
                if (count < tier.pieces) continue;
                if (tier.bonus) this.foldMods(agg, tier.bonus);
                if (tier.effect) agg.effects.add(tier.effect);
            }
        }
        return agg;
    }

    private foldMods(agg: EquipmentAggregates, mods: ItemStatMods): void {
        if (mods.basicDamagePct  !== undefined) agg.basicDamageMult *= 1 + mods.basicDamagePct / 100;
        if (mods.powerDamagePct  !== undefined) agg.powerDamageMult *= 1 + mods.powerDamagePct / 100;
        if (mods.attackSpeedPct  !== undefined) agg.attackSpeedMult *= 1 + mods.attackSpeedPct / 100;
        if (mods.moveSpeedPct    !== undefined) agg.moveSpeedMult   *= 1 + mods.moveSpeedPct / 100;
        if (mods.cooldownPct     !== undefined) agg.cooldownMult    *= 1 - mods.cooldownPct / 100;
        if (mods.damageTakenPct  !== undefined) agg.damageTakenMult *= 1 - mods.damageTakenPct / 100;
        if (mods.goldGainPct     !== undefined) agg.goldGainMult    *= 1 + mods.goldGainPct / 100;
        if (mods.critChance      !== undefined) agg.critChance      += mods.critChance;
        if (mods.critDamage      !== undefined) agg.critDamage      += mods.critDamage;
        if (mods.lifesteal       !== undefined) agg.lifesteal       += mods.lifesteal;
        if (mods.maxHealth       !== undefined) agg.maxHealth       += mods.maxHealth;
        if (mods.hpRegenPctPerSec !== undefined) agg.hpRegenPctPerSec += mods.hpRegenPctPerSec;
        if (mods.knockback       !== undefined) agg.knockback       += mods.knockback;
    }

    public reset(): void {
        this.slots.clear();
    }
}
