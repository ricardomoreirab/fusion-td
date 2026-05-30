import { ULTIMATE_ARCHETYPES } from './UltimateArchetypes';
import type { PowerDefinition, PowerElement, ChampionType } from './PowerDefinitions';

const CLASSES: ChampionType[] = ['barbarian', 'ranger', 'mage'];
const ELEMENTS: PowerElement[] = ['fire', 'ice', 'arcane', 'physical', 'storm'];

/** Class-flavored display names per element (mechanic is shared; this is skin). */
const ULTIMATE_NAMES: Record<ChampionType, Record<PowerElement, string>> = {
    mage:      { fire: 'Cataclysm',     ice: 'Absolute Zero',  arcane: 'Singularity',  physical: 'Maelstrom',      storm: 'Thunderstorm' },
    ranger:    { fire: 'Rain of Fire',  ice: 'Frozen Barrage', arcane: 'Void Quiver',  physical: 'Arrow Storm',    storm: 'Storm Volley' },
    barbarian: { fire: 'Volcanic Wrath',ice: 'Glacial Cataclysm', arcane: 'Rift Smash', physical: 'Whirlwind Fury', storm: 'Thunderclap' },
};

export function makeUltimateDef(cls: ChampionType, element: PowerElement): PowerDefinition {
    const id = `${cls}_ult_${element}`;
    const baseDamage = 60, baseCooldown = 7;
    return {
        id,
        name: ULTIMATE_NAMES[cls][element],
        element,
        icon: '✪',
        championType: cls,
        tier: 'ultimate',
        elements: [element],
        baseCooldown,
        baseDamage,
        baseRange: 16,
        maxLevel: 5,
        mode: 'autocast',
        cooldownFor: (s) => baseCooldown * Math.pow(0.94, s.level - 1),
        damageFor:   (s) => baseDamage  * Math.pow(1.25, s.level - 1),
        cast: (state, ctx) => {
            const damage = baseDamage * Math.pow(1.25, state.level - 1) * ctx.damageMultiplier;
            ULTIMATE_ARCHETYPES[element](ctx, damage, cls);
        },
    };
}

/** All 15 ultimate defs, keyed by id. */
export const ULTIMATE_DEFS: Record<string, PowerDefinition> = (() => {
    const out: Record<string, PowerDefinition> = {};
    for (const c of CLASSES) for (const e of ELEMENTS) { const d = makeUltimateDef(c, e); out[d.id] = d; }
    return out;
})();

export function getUltimateForClassElement(cls: ChampionType, element: PowerElement): PowerDefinition | undefined {
    return ULTIMATE_DEFS[`${cls}_ult_${element}`];
}

/** Offer = the class's ultimate for each element in the UNION of the two fusions'
 *  elements (deduped, stable order). Two distinct fusions share 0–1 elements => 3–4. */
export function getUltimateOfferForFusions(cls: ChampionType, a: PowerDefinition, b: PowerDefinition): PowerDefinition[] {
    const seen = new Set<PowerElement>();
    const union: PowerElement[] = [];
    for (const e of [...(a.elements ?? [a.element]), ...(b.elements ?? [b.element])]) {
        if (!seen.has(e)) { seen.add(e); union.push(e); }
    }
    return union.map(e => getUltimateForClassElement(cls, e)).filter((d): d is PowerDefinition => !!d);
}
