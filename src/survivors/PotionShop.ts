/** Single-wave consumable potions sold in their own shop row. Pure logic — the
 *  gameplay state owns the active set and folds potionBuffs() into PlayerStats. */
export type PotionId = 'lifesteal' | 'power' | 'shield' | 'rage';

export interface PotionDef {
    id: PotionId;
    name: string;
    desc: string;
    glyph: string;
    price: number;
}

export const POTION_PRICE = 500;

export const POTIONS: PotionDef[] = [
    { id: 'lifesteal', name: 'Lifesteal Potion', desc: '+10% lifesteal',       glyph: '\u{1F9EA}', price: POTION_PRICE },
    { id: 'power',     name: 'Power Potion',     desc: '+20% power damage',     glyph: '\u{2697}\u{FE0F}', price: POTION_PRICE },
    { id: 'shield',    name: 'Shield Potion',    desc: '20% damage reduction',  glyph: '\u{1F6E1}\u{FE0F}', price: POTION_PRICE },
    { id: 'rage',      name: 'Rage Potion',      desc: '+10% attack speed',     glyph: '\u{1F525}', price: POTION_PRICE },
];

export interface PotionBuffs {
    powerMult: number;        // ×powerDamageMultiplier
    atkSpeedMult: number;     // ×basicAttackSpeedMultiplier
    dmgReductionMult: number; // ×damageReductionMultiplier (lower = tankier)
    lifestealAdd: number;     // +lifestealPct
}

/** Resolve the active potion set into stat deltas. Deterministic — same set in,
 *  same buffs out (so applyLevelBonuses can fold it idempotently every recompute). */
export function potionBuffs(active: Set<PotionId>): PotionBuffs {
    return {
        powerMult:        active.has('power')     ? 1.2 : 1,
        atkSpeedMult:     active.has('rage')      ? 1.1 : 1,
        dmgReductionMult: active.has('shield')    ? 0.8 : 1,
        lifestealAdd:     active.has('lifesteal') ? 0.1 : 0,
    };
}
