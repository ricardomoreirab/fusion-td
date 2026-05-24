/**
 * Tower ability type definitions for the data-driven tower system.
 */

export interface AbilityDefinition {
    name: string;
    type: 'passive' | 'active_auto' | 'active_targeted';
    cooldown: number; // seconds (0 for passive)
    effect: AbilityEffect;
    description: string;
}

export type AbilityEffect =
    | { kind: 'none' }
    | { kind: 'criticalHit'; chance: number; multiplier: number }
    | { kind: 'piercingShot'; cooldown: number; maxTargets: number }
    | { kind: 'aoeVolley'; cooldown: number; projectiles: number; radius: number }
    | { kind: 'spinUp'; maxBonus: number; perSecond: number }
    | { kind: 'armorShatter'; reductionPerStack: number; maxStacks: number; duration: number }
    | { kind: 'auraBuff'; bonusDamage: number; bonusFireRate: number; bonusRange: number; radius: number }
    | { kind: 'trapField'; trapType: string; radius: number; duration: number; dps: number; slow: number }
    | { kind: 'burnDoT'; dps: number; duration: number }
    | { kind: 'chainLightning'; chains: number; damageDecay: number; chainRange: number }
    | { kind: 'freezeNova'; radius: number; duration: number; damageAmp: number }
    | { kind: 'whirlpool'; radius: number; duration: number; slow: number; dps: number }
    | { kind: 'shadowCurse'; damageAmpPerStack: number; maxStacks: number; duration: number }
    | { kind: 'spawnUnit'; unitHp: number; unitDps: number; duration: number }
    | { kind: 'multishot'; extraProjectiles: number }
    | { kind: 'siegeShot'; bonusDamage: number; splashRadius: number }
    | { kind: 'snare'; duration: number; slow: number }
    | { kind: 'poisonCloud'; radius: number; duration: number; dps: number }
    | { kind: 'thornAura'; radius: number; dps: number; slow: number }
    | { kind: 'executeThreshold'; healthPercent: number; bonusDamage: number }
    | { kind: 'overcharge'; damageMultiplier: number; duration: number; cooldown: number }
    | { kind: 'eruption'; radius: number; damage: number; burnDps: number; burnDuration: number }
    | { kind: 'pullVortex'; radius: number; pullStrength: number; dps: number };
