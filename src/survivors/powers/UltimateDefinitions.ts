import { ULTIMATE_ARCHETYPES } from './UltimateArchetypes';
import { autocastStatRows } from './PowerDefinitions';
import type { PowerDefinition, PowerElement, ChampionType, PowerStatRow } from './PowerDefinitions';

const CLASSES: ChampionType[] = ['barbarian', 'ranger', 'mage'];
const ELEMENTS: PowerElement[] = ['fire', 'ice', 'arcane', 'physical', 'storm'];

/** Class-flavored display names per element (mechanic is shared; this is skin). */
const ULTIMATE_NAMES: Record<ChampionType, Record<PowerElement, string>> = {
    mage:      { fire: 'Cataclysm',     ice: 'Absolute Zero',  arcane: 'Singularity',  physical: 'Maelstrom',      storm: 'Thunderstorm' },
    ranger:    { fire: 'Rain of Fire',  ice: 'Frozen Barrage', arcane: 'Void Quiver',  physical: 'Arrow Storm',    storm: 'Storm Volley' },
    barbarian: { fire: 'Volcanic Wrath',ice: 'Glacial Cataclysm', arcane: 'Rift Smash', physical: 'Whirlwind Fury', storm: 'Thunderclap' },
};

/** What each element's ultimate actually does on the field, and the extra stat
 *  rows that describe it. Mirrors ULTIMATE_ARCHETYPES — keep the two in sync. */
const ULTIMATE_MECHANICS: Record<PowerElement, {
    summary: string;
    /** `dmg` is the ultimate's damage at the displayed level. */
    rows: (dmg: number) => PowerStatRow[];
}> = {
    fire: {
        summary: 'A rolling meteor storm. Six strikes rain down across the arena, each bursting for full damage and leaving the ground burning.',
        rows: (dmg) => [
            { label: 'Strikes', value: '6, one every 0.12s' },
            { label: 'Blast radius', value: '3.2 u each' },
            { label: 'Burn', value: `${(dmg * 0.1).toFixed(1)} dmg/s for 3s` },
            { label: 'Total damage', value: `${Math.round(dmg * 6)} across all strikes` },
        ],
    },
    ice: {
        summary: 'Absolute zero erupts from you. Everything in a huge radius takes the hit, freezes solid, and is primed to shatter on death.',
        rows: (dmg) => [
            { label: 'Blast radius', value: '9 u around you' },
            { label: 'Freeze', value: '7 chill stacks for 3s' },
            { label: 'Shatter on death', value: `${Math.round(dmg * 0.6)} ice nova` },
            { label: 'Targets', value: 'All enemies in radius' },
        ],
    },
    arcane: {
        summary: 'Tears open a gravity well that drags the horde into its centre for over two seconds, then implodes.',
        rows: (dmg) => [
            { label: 'Vortex radius', value: '7 u' },
            { label: 'Duration', value: '2.2s' },
            { label: 'Pull damage', value: `${Math.round(dmg * 0.25)} every 0.2s` },
            { label: 'Implosion', value: `${Math.round(dmg * 1.2)} damage` },
        ],
    },
    physical: {
        summary: 'Five shrapnel detonations tear across the field, each spraying ten blades outward and leaving survivors fragile.',
        rows: (dmg) => [
            { label: 'Bursts', value: '5, one every 0.14s' },
            { label: 'Blades per burst', value: '10' },
            { label: 'Damage per blade', value: Math.round(dmg * 0.4).toString() },
            { label: 'Fragile', value: '3s on every hit' },
        ],
    },
    storm: {
        summary: 'Eight lightning strikes fork across the arena, each splitting through five more enemies as it travels.',
        rows: (dmg) => [
            { label: 'Strikes', value: '8, one every 0.1s' },
            { label: 'Chain hops', value: '5 per strike, splitting' },
            { label: 'Damage per hop', value: `${Math.round(dmg * 0.6)} (×0.85 falloff)` },
            { label: 'Fragile', value: '3s on every hit' },
        ],
    },
};

export function makeUltimateDef(cls: ChampionType, element: PowerElement): PowerDefinition {
    const id = `${cls}_ult_${element}`;
    const baseDamage = 60, baseCooldown = 7;
    const mech = ULTIMATE_MECHANICS[element];
    const def: PowerDefinition = {
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
        summary: mech.summary,
        cooldownFor: (s) => baseCooldown * Math.pow(0.94, s.level - 1),
        damageFor:   (s) => baseDamage  * Math.pow(1.25, s.level - 1),
        cast: (state, ctx) => {
            const damage = baseDamage * Math.pow(1.25, state.level - 1) * ctx.damageMultiplier;
            ULTIMATE_ARCHETYPES[element](ctx, damage, cls);
        },
    };
    def.description = (lvl) => `${Math.round(def.damageFor({ level: lvl, cooldownRemaining: 0 }))} base damage — ${mech.summary}`;
    def.stats = (lvl, next) => [
        ...autocastStatRows(def, lvl, next).filter(r => r.label !== 'Damage / sec'),
        ...mech.rows(def.damageFor({ level: lvl, cooldownRemaining: 0 })),
    ];
    return def;
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
