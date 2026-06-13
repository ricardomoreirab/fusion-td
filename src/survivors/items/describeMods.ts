import { ItemEffectId, ItemStatMods } from './ItemTypes';

/** Shop-card copy for each unique item effect (non-set items show this;
 *  set pieces show their set's highest tier text instead). */
export const EFFECT_TEXT: Record<ItemEffectId, string> = {
    shockwave: 'Every 6th hit: ground slam — AoE damage + 1s stun',
    critExplode: 'Crits explode for 50% AoE damage',
    burnOnHit: 'Basic attacks set enemies on fire',
    thorns: 'Reflects 3× contact damage to nearby enemies',
    chrono: 'When hit: refund 10% of power cooldowns',
    rage: 'RAGE: below 50% HP → +60% basic damage',
    ricochet: 'Arrows bounce to a nearby enemy at 60% damage',
    echo: '25% chance powers recast free',
    midas: '15% double gold; coin novas every 150g',
    earthbreaker: 'EARTHBREAKER: every 4th hit quakes the ground — AoE damage + 1s stun, growing with each swing',
    tempest_volley: 'TEMPEST VOLLEY: every 8th hit fans 3 storm arrows; every 4th hit chains lightning to 2 foes',
    arcane_cascade: 'ARCANE CASCADE: every cast bursts a void nova, arcs to 3 foes, refunds 8% cooldowns',
    apex_cleave: 'APEX CLEAVE: every hit cleaves nearby foes for 55% and executes anything under 12% HP',
    storm_quiver: 'STORM QUIVER: hits charge a 5-target lightning volley',
    singularity: 'SINGULARITY: every cast implodes a void nova, dealing more the more foes are caught',
};

/** Human-readable stat lines for a shop card, e.g. "+20% basic damage". */
export function describeMods(mods: ItemStatMods): string[] {
    const out: string[] = [];
    if (mods.basicDamagePct) out.push(`+${mods.basicDamagePct}% basic damage`);
    if (mods.powerDamagePct) out.push(`+${mods.powerDamagePct}% power damage`);
    if (mods.attackSpeedPct) out.push(`+${mods.attackSpeedPct}% attack speed`);
    if (mods.moveSpeedPct) out.push(`+${mods.moveSpeedPct}% move speed`);
    if (mods.cooldownPct) out.push(`−${mods.cooldownPct}% power cooldowns`);
    if (mods.damageTakenPct) out.push(`−${mods.damageTakenPct}% damage taken`);
    if (mods.goldGainPct) out.push(`+${mods.goldGainPct}% gold from kills`);
    if (mods.critChance) out.push(`+${Math.round(mods.critChance * 100)}% crit chance`);
    if (mods.critDamage) out.push(`+${mods.critDamage.toFixed(2)} crit damage`);
    if (mods.lifesteal) out.push(`+${Math.round(mods.lifesteal * 100)}% lifesteal`);
    if (mods.maxHealth) out.push(`+${mods.maxHealth} max HP`);
    if (mods.hpRegenPctPerSec) out.push(`Regenerate ${(mods.hpRegenPctPerSec * 100).toFixed(1)}% max HP/s`);
    if (mods.knockback) out.push(`+${mods.knockback} knockback`);
    return out;
}
