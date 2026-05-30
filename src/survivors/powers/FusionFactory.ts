// Babylon-free fusion factory. Uses TYPE-ONLY imports from PowerDefinitions so
// importing this module never loads @babylonjs/core — keeps it unit-testable
// under the project's node-only Vitest harness.
import type {
    PowerDefinition,
    PowerRuntimeState,
    PowerContext,
    EnchantmentHitContext,
    PowerElement,
    ChampionType,
} from './PowerDefinitions';
import { archetypeKey, getAutocastArchetype, getPassiveArchetype } from './FusionArchetypeRegistry';

/** Each parent effect hits this much harder inside a fusion. */
export const FUSION_DMG = 1.25;
/** Multiplier applied to the averaged parent cooldown. */
export const FUSION_CD = 0.85;
/** Passive fusion bonus: extra weapon-damage fraction per level, applied per hit. */
export const FUSION_PASSIVE_BONUS = 0.25;

const ELEMENT_ORDER: PowerElement[] = ['fire', 'ice', 'arcane', 'physical', 'storm'];
const FUSION_ICON = '✦';

/** Hand-picked names keyed by sorted `elemA_elemB`. Class-agnostic. */
const FUSION_NAMES: Record<string, string> = {
    fire_ice:        'Frostfire',
    fire_arcane:     'Hexflame',
    fire_physical:   'Molten Edge',
    fire_storm:      'Tempest Ember',
    ice_arcane:      'Rimecaster',
    ice_physical:    'Glacial Edge',
    ice_storm:       'Blizzard',
    arcane_physical: 'Runeblade',
    arcane_storm:    'Voltaic Rune',
    physical_storm:  'Thunderstrike',
};

function classOfBaseId(id: string): ChampionType {
    return id.split('_')[0] as ChampionType;
}

function sortElems(a: PowerElement, b: PowerElement): [PowerElement, PowerElement] {
    return ELEMENT_ORDER.indexOf(a) <= ELEMENT_ORDER.indexOf(b) ? [a, b] : [b, a];
}

export function fusionId(classType: ChampionType, e1: PowerElement, e2: PowerElement): string {
    const [a, b] = sortElems(e1, e2);
    return `fuse_${classType}_${a}_${b}`;
}

/**
 * Compose two base PowerDefinitions of the same class+mode into a fusion.
 * Autocast fusions fire both parents' cast() each trigger; passive fusions
 * apply both parents' onHit() each hit. Persistent parent data (e.g. Whirling
 * Blades' meshes) lives in per-parent sub-states under state.data.__subStates.
 */
export function makeFusionDef(a: PowerDefinition, b: PowerDefinition): PowerDefinition {
    if (a.mode !== b.mode) {
        throw new Error(`Cannot fuse powers of different modes: ${a.id} (${a.mode}) + ${b.id} (${b.mode})`);
    }
    // Prefer the explicit championType (set on fusion/ultimate defs); base defs
    // encode it as `<class>_<element>`, so fall back to the id's first segment.
    const classType = a.championType ?? classOfBaseId(a.id);
    const id = fusionId(classType, a.element, b.element);
    const [e1, e2] = sortElems(a.element, b.element);
    const archKey = archetypeKey(a.element, b.element);
    const name = FUSION_NAMES[`${e1}_${e2}`] ?? `${a.name} + ${b.name}`;
    const parents = [a, b];

    const ensureSubStates = (
        state: PowerRuntimeState,
        ctx: PowerContext | null,
    ): Record<string, PowerRuntimeState> => {
        if (!state.data) state.data = {};
        let subs = state.data['__subStates'] as Record<string, PowerRuntimeState> | undefined;
        if (!subs) {
            subs = {};
            for (const p of parents) {
                const sub: PowerRuntimeState = { level: state.level, cooldownRemaining: 0, data: {} };
                // ctx is always present from cast()/init(); the null guard only
                // skips parent init in degenerate (never-initialised) call paths.
                if (p.init && ctx) p.init(sub, ctx);
                subs[p.id] = sub;
            }
            state.data['__subStates'] = subs;
        }
        return subs;
    };

    const def: PowerDefinition = {
        id,
        name,
        element: e1,                 // primary element (HUD fallback / card border)
        icon: FUSION_ICON,
        baseCooldown: ((a.baseCooldown + b.baseCooldown) / 2) * FUSION_CD,
        baseDamage: a.baseDamage + b.baseDamage,
        baseRange: Math.max(a.baseRange, b.baseRange),
        maxLevel: 5,
        mode: a.mode,
        tier: 'fusion',
        championType: classType,
        parents: [a.id, b.id],
        elements: [a.element, b.element],
        // Parents read only s.level from the passed state; the fusion's own
        // state is the canonical level source, so passing it here is correct.
        cooldownFor: (s) => ((a.cooldownFor(s) + b.cooldownFor(s)) / 2) * FUSION_CD,
        damageFor:   (s) => a.damageFor(s) + b.damageFor(s),
        description: (lvl) =>
            `Fused: ${parents.map(p => (p.description ? p.description(lvl) : p.name)).join('  +  ')}`,
        init: (state, ctx) => { ensureSubStates(state, ctx); },
        dispose: (state) => {
            const subs = state.data?.['__subStates'] as Record<string, PowerRuntimeState> | undefined;
            if (!subs) return;
            for (const p of parents) {
                const sub = subs[p.id];
                if (sub && p.dispose) p.dispose(sub);
            }
        },
    };

    if (a.mode === 'passive') {
        def.onHit = (enemy, level, ctx: EnchantmentHitContext) => {
            const arch = getPassiveArchetype(archKey);
            if (arch) { arch(enemy, level, ctx); return; }
            // Fallback (un-migrated pair): run both parents + the flat fusion bonus.
            for (const p of parents) p.onHit?.(enemy, level, ctx);
            enemy.takeDamage(ctx.baseDamage * FUSION_PASSIVE_BONUS * level);
        };
        def.rangeBonus = (level) =>
            parents.reduce((sum, p) => sum + (p.rangeBonus ? p.rangeBonus(level) : 0), 0);
    } else {
        def.cast = (state, ctx) => {
            const arch = getAutocastArchetype(archKey);
            if (arch) { arch(state, ctx, def.damageFor(state) * ctx.damageMultiplier, classType); return; }
            // Fallback (un-migrated pair): run both parents at the fusion damage bump.
            const subs = ensureSubStates(state, ctx);
            const synthCtx: PowerContext = { ...ctx, damageMultiplier: ctx.damageMultiplier * FUSION_DMG };
            for (const p of parents) {
                const sub = subs[p.id];
                sub.level = state.level;
                p.cast?.(sub, synthCtx);
            }
        };
    }

    return def;
}
