import { ChampionType } from '../powers/PowerDefinitions';

export type EquipSlot = 'weapon' | 'helmet' | 'chest' | 'legs' | 'boots' | 'trinket';
export const EQUIP_SLOTS: EquipSlot[] = ['weapon', 'helmet', 'chest', 'legs', 'boots', 'trinket'];

export type Rarity = 'common' | 'rare' | 'epic' | 'legendary';
export const RARITY_BASE_PRICE: Record<Rarity, number> = {
    common: 60, rare: 120, epic: 220, legendary: 400,
};
export const RARITY_COLOR: Record<Rarity, string> = {
    common: '#9aa0a8', rare: '#3da9ff', epic: '#b050ff', legendary: '#ffb52e',
};

/** Declarative stat bonuses. Pct values are whole percentages (+20 ⇒ +20%). */
export interface ItemStatMods {
    /** Basic-attack damage only. */
    basicDamagePct?: number;
    powerDamagePct?: number;
    attackSpeedPct?: number;
    moveSpeedPct?: number;
    /** Cooldown REDUCTION: +10 ⇒ cooldowns ×0.90. */
    cooldownPct?: number;
    /** Damage-taken REDUCTION: +12 ⇒ incoming ×0.88. */
    damageTakenPct?: number;
    goldGainPct?: number;
    critChance?: number;        // additive, 0..1
    critDamage?: number;        // additive to the crit multiplier (+0.35 ⇒ 1.5→1.85)
    lifesteal?: number;         // additive, 0..1
    maxHealth?: number;         // flat HP
    hpRegenPctPerSec?: number;  // fraction of max HP per second (0.005 = 0.5%/s)
    knockback?: number;         // flat world units per basic hit
}

export type ItemEffectId =
    | 'rage' | 'ricochet' | 'echo' | 'midas'
    | 'shockwave' | 'critExplode' | 'burnOnHit' | 'thorns' | 'chrono';

export interface ItemDef {
    id: string;
    name: string;
    slot: EquipSlot;
    rarity: Rarity;
    /** 'all' or the champion classes that may buy/equip it. */
    classes: ChampionType[] | 'all';
    mods: ItemStatMods;
    effectId?: ItemEffectId;
    setId?: string;
    glyph: string;
    /** One short funny/flavor line for the shop card. */
    flavor: string;
}

export interface SetDef {
    id: string;
    name: string;
    pieces: [string, string, string];
    bonus2: ItemStatMods;
    bonus2Text: string;
    effect3: ItemEffectId;
    bonus3Text: string;
}
