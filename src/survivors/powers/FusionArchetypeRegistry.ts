// Babylon-free registry mapping a sorted element-pair key → fusion archetype impl.
// makeFusionDef (also Babylon-free) consults this at cast/hit time; the Babylon
// implementations register themselves at startup from FusionArchetypes.ts. Keeping
// this module Babylon-free preserves FusionFactory's node-only unit-testability.
import type { PowerRuntimeState, PowerContext, EnchantmentHitContext, PowerElement, ChampionType } from './PowerDefinitions';

const ELEMENT_ORDER: PowerElement[] = ['fire', 'ice', 'arcane', 'physical', 'storm'];

/** Autocast archetype: deliver the fusion's effect. `damage` is the fully-scaled
 *  per-cast damage (damageFor × multipliers) the archetype should base hits on. */
export type AutocastArchetype = (state: PowerRuntimeState, ctx: PowerContext, damage: number, championType: ChampionType) => void;
/** Passive (enchantment) archetype: triggered on each basic-attack hit. */
export type PassiveArchetype = (enemy: import('../enemies/Enemy').Enemy, level: number, ctx: EnchantmentHitContext) => void;

/** Sorted `elemA_elemB` key — order-independent. */
export function archetypeKey(a: PowerElement, b: PowerElement): string {
    return ELEMENT_ORDER.indexOf(a) <= ELEMENT_ORDER.indexOf(b) ? `${a}_${b}` : `${b}_${a}`;
}

const autocastReg = new Map<string, AutocastArchetype>();
const passiveReg = new Map<string, PassiveArchetype>();

export function registerAutocastArchetype(key: string, fn: AutocastArchetype): void { autocastReg.set(key, fn); }
export function registerPassiveArchetype(key: string, fn: PassiveArchetype): void { passiveReg.set(key, fn); }
export function getAutocastArchetype(key: string): AutocastArchetype | undefined { return autocastReg.get(key); }
export function getPassiveArchetype(key: string): PassiveArchetype | undefined { return passiveReg.get(key); }
