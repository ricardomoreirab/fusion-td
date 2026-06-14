import { ChampionType } from '../powers/PowerDefinitions';

export type EquipSlot = 'weapon' | 'helmet' | 'chest' | 'legs' | 'boots' | 'trinket';
export const EQUIP_SLOTS: EquipSlot[] = ['weapon', 'helmet', 'chest', 'legs', 'boots', 'trinket'];

export type Rarity = 'common' | 'rare' | 'epic' | 'legendary' | 'unique' | 'mythic';
export const RARITY_BASE_PRICE: Record<Rarity, number> = {
    // Price rework 2026-06-14: unique/mythic ×10, others ×2.5.
    common: 150, rare: 300, epic: 550, legendary: 1000, unique: 5200, mythic: 9000,
};
export const RARITY_COLOR: Record<Rarity, string> = {
    common: '#9aa0a8', rare: '#3da9ff', epic: '#b050ff', legendary: '#ffb52e',
    unique: '#3ddc84', mythic: '#ff3b30',
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
    | 'shockwave' | 'critExplode' | 'burnOnHit' | 'thorns' | 'chrono'
    | 'earthbreaker' | 'tempest_volley' | 'arcane_cascade'
    | 'apex_cleave' | 'storm_quiver' | 'singularity';

/** Persistent weapon-bone FX for a mythic weapon (consumed by Champion.setMythicAura). */
export interface MythicFxConfig {
    /** Lowercase literal hex — bounded material-cache key. */
    auraColor: string;
    /** Particle preset. */
    style: 'embers' | 'ribbon' | 'motes';
    /** Lowercase literal hex for the on-hit burst. */
    onHitColor: string;
}

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
    /** Mythic weapons set this: counts toward its class unique set as the weapon piece. */
    wildcardSetPiece?: boolean;
    /** Mythic weapons only: persistent weapon-bone visual. */
    mythicFx?: MythicFxConfig;
    glyph: string;
    /** One short funny/flavor line for the shop card. */
    flavor: string;
}

/** One activation threshold of a set. `bonus` (stat slab) and/or `effect` fire at `pieces`. */
export interface SetTier {
    pieces: number;
    bonus?: ItemStatMods;
    effect?: ItemEffectId;
    text: string;
}

export interface SetDef {
    id: string;
    name: string;
    /** Item ids that compose the set (3 for classic, 6 for unique). */
    pieces: string[];
    /** Ascending by `pieces` (e.g. classic [2,3]; unique [2,4,6]). */
    tiers: SetTier[];
    kind: 'classic' | 'unique';
}
