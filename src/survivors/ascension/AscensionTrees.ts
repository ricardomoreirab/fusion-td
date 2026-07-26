import type { IconName } from '../../ui/icons';
import type { ChampionType } from '../powers/PowerDefinitions';

/**
 * Ascension trees — PURE DATA. No Three, no DOM, no closures over scene state.
 *
 * Node defs hold only data plus a string `runtime` id that AscensionRuntime
 * switches on. They must NEVER hold meshes, scene references or callbacks:
 * ASCENSION_TREES is a module-level singleton (the same trap POWER_DEFS /
 * FUSION_DEFS / ULTIMATE_DEFS carry), so a mutated def would leak across runs
 * AND across champion classes.
 *
 * Structure is identical in all three classes so one renderer and one gate
 * function serve every tree:
 *
 *   TIER 1  [node][node]   gate:  0 points in path
 *   TIER 2  [node][node]   gate:  4
 *   TIER 3  [node][node]   gate:  9
 *   TIER 4  [node][node]   gate: 15
 *   TIER 5  [ CAPSTONE  ]  gate: 21      → 9 nodes, 27 points per path
 *
 * 3 paths × 27 = 81 point capacity against a 50-point budget (0.617 scarcity).
 * A maxed capstone costs 24 (21 gate + 3); two cost 48 ≤ 50; three at ANY rank
 * cost 66 > 50. No run can ever light all three constellations — that is the
 * design, and tests/ascensionScarcity.spec.ts asserts it.
 */

export const TIER_GATE = { 1: 0, 2: 4, 3: 9, 4: 15, 5: 21 } as const;

export type AscensionTier = 1 | 2 | 3 | 4 | 5;

/** Fields applyLevelBonuses() re-ASSIGNS every recompute — safe to multiply onto. */
export type AscMultField =
    | 'moveSpeedMultiplier'
    | 'attackRangeMultiplier'
    | 'basicAttackSpeedMultiplier'
    | 'powerDamageMultiplier'
    | 'powerCooldownMultiplier'
    | 'damageReductionMultiplier';

/**
 * Declarative stat contribution, consumed by foldAscensionStats(). There is
 * deliberately no per-node switch in the fold: the source of truth is always the
 * POINT COUNT held outside PlayerStats, so every field is re-derived from
 * scratch on each recompute and can neither compound nor be clobbered.
 */
export type AscensionStatContribution =
    /** ps.X *= factor^points — for multiplicative fields (lower factor = better for cooldown/DR). */
    | { kind: 'multPow'; field: AscMultField; factor: number }
    /** ps.X *= (1 + perPoint*points) — linear ramp on a multiplicative field. */
    | { kind: 'multLin'; field: AscMultField; perPoint: number }
    /** ps.X += perPoint*points — safe WITHOUT a tracker: applyLevelBonuses re-assigns these. */
    | { kind: 'addAssigned'; field: 'critChance' | 'critDamageMultiplier'; perPoint: number }
    /** ps.X += perPoint*points — REQUIRES the delta-swap tracker (RunItems/equipment also +=). */
    | { kind: 'addShared'; field: 'lifestealPct' | 'knockbackOnHit'; perPoint: number };

/** A bonus clause that switches on when the player owns >=1 point in another path's node. */
export interface AscensionRiderDef {
    requiresNodeId: string;
    text: string;
}

export interface AscensionNodeDef {
    /** Stable, kebab-case, unique across ALL classes. */
    id: string;
    pathId: string;
    tier: AscensionTier;
    name: string;
    icon: IconName;
    max: 3;
    /** 0 = left, 1 = right, 0.5 = centred (capstone). Shared by the SVG and the DOM. */
    col: number;
    /** Renders the ACTIVE clause set at `points`, so the detail pane can show what point 3 buys. */
    desc: (points: number) => string;
    stat?: AscensionStatContribution;
    runtime?: string;
    rider?: AscensionRiderDef;
}

export interface AscensionPathDef {
    id: string;
    name: string;
    /** CSS custom-property name from tokens.css — never a raw hex. */
    accent: string;
    icon: IconName;
    tagline: string;
    capstoneId: string;
    /** Exactly 9. */
    nodes: AscensionNodeDef[];
}

// ── Layout (one coordinate space, shared by the SVG viewBox and the node divs) ──

export const TREE_W = 960;
export const TREE_H = 880;
const COL_W = TREE_W / 3;
const ROW_Y: Record<AscensionTier, number> = { 1: 110, 2: 285, 3: 460, 4: 635, 5: 800 };

/** Authoritative node position. The overlay uses this for BOTH the edge path and
 *  the node div, so the two can never drift apart on resize. Takes the
 *  structural minimum so the UI's view-model can be passed directly. */
export function nodeXY(
    pathIndex: number, node: { col: number; tier: number },
): { x: number; y: number } {
    const centre = COL_W * pathIndex + COL_W / 2;
    return { x: centre + (node.col - 0.5) * 150, y: ROW_Y[node.tier as AscensionTier] };
}

// ── Authoring helpers ────────────────────────────────────────────────────────

/** Per-rank description text. desc(0) previews rank 1. */
function d3(a: string, b: string, c: string): (points: number) => string {
    return (p) => (p <= 1 ? a : p === 2 ? b : c);
}

type NodeSpec = Omit<AscensionNodeDef, 'pathId' | 'max'>;

function path(
    id: string, name: string, accent: string, icon: IconName, tagline: string, nodes: NodeSpec[],
): AscensionPathDef {
    const built = nodes.map((n) => ({ ...n, pathId: id, max: 3 as const }));
    const capstone = built.find((n) => n.tier === 5);
    return { id, name, accent, icon, tagline, capstoneId: capstone ? capstone.id : '', nodes: built };
}

// ── BARBARIAN ────────────────────────────────────────────────────────────────

const TEMPEST = path('bar-tempest', 'The Tempest', '--el-storm', 'whirlwind', 'I never stop spinning.', [
    {
        id: 'gale-force', tier: 1, col: 0, name: 'Gale Force', icon: 'whirlwind',
        runtime: 'galeForce',
        desc: d3(
            'Whirlwind radius 7.0 → 7.8u. +0.2u melee reach.',
            'Whirlwind radius 8.6u. +0.4u melee reach.',
            'Whirlwind radius 9.4u. +0.6u melee reach.',
        ),
    },
    {
        id: 'unending-fury', tier: 1, col: 1, name: 'Unending Fury', icon: 'clock',
        runtime: 'unendingFury',
        desc: d3(
            'Ability cooldowns -1.5% per nearby enemy (max 8). Kills refund 0.5s.',
            'Ability cooldowns -2.5% per nearby enemy (max 8). Kills refund 0.5s.',
            'Ability cooldowns -3.5% per nearby enemy (max 10). Kills refund 0.9s.',
        ),
    },
    {
        id: 'eye-of-the-storm', tier: 2, col: 0, name: 'Eye of the Storm', icon: 'shield',
        runtime: 'eyeOfTheStorm',
        rider: { requiresNodeId: 'bloodthirst', text: 'Lifesteal is doubled while channelling.' },
        desc: d3(
            'While channelling, damage taken x0.85. 12% of tick damage heals you.',
            'While channelling, damage taken x0.72. 12% of tick damage heals you.',
            'While channelling, damage taken x0.61. 12% of tick damage heals you.',
        ),
    },
    {
        id: 'cyclone-cadence', tier: 2, col: 1, name: 'Cyclone Cadence', icon: 'cleave',
        runtime: 'cycloneCadence',
        desc: d3(
            'Whirlwind ticks every 0.26s (was 0.30s).',
            'Whirlwind ticks every 0.22s.',
            'Whirlwind ticks every 0.18s. Knockback is suppressed for the channel.',
        ),
    },
    {
        id: 'stormbound', tier: 3, col: 0, name: 'Stormbound', icon: 'bolt',
        runtime: 'stormbound',
        rider: { requiresNodeId: 'aftershock', text: 'The counter also advances per shockwave.' },
        desc: d3(
            'Every 12 kills, -4s off everything on cooldown.',
            'Every 12 kills, -8s off everything on cooldown.',
            'Every 8 kills, -12s off everything on cooldown.',
        ),
    },
    {
        id: 'rending-winds', tier: 3, col: 1, name: 'Rending Winds', icon: 'claw',
        runtime: 'rendingWinds',
        rider: { requiresNodeId: 'wound-chemistry', text: 'Whirlwind ticks also refresh Curse.' },
        desc: d3(
            'Each Whirlwind tick applies 1 Fragile stack.',
            'Each Whirlwind tick applies 2 Fragile stacks.',
            'Each Whirlwind tick applies 3 Fragile stacks, lasting 8s.',
        ),
    },
    {
        id: 'hurricane-heart', tier: 4, col: 0, name: 'Hurricane Heart', icon: 'heart',
        runtime: 'hurricaneHeart',
        desc: d3(
            'Whirlwind lasts 6.2s (was 5.0s). Move speed x1.25 while channelling.',
            'Whirlwind lasts 7.4s. Move speed x1.25 while channelling.',
            'Whirlwind lasts 8.6s. Move speed x1.25 while channelling.',
        ),
    },
    {
        id: 'bladestorm-echo', tier: 4, col: 1, name: 'Bladestorm Echo', icon: 'fusion',
        runtime: 'bladestormEcho',
        desc: d3(
            'When Whirlwind ends it re-fires free for 1.5s at 70% radius.',
            'When Whirlwind ends it re-fires free for 2.2s at 70% radius.',
            'When Whirlwind ends it re-fires free for 3.0s, plus a free Smash at 60%.',
        ),
    },
    {
        id: 'eye-of-the-maelstrom', tier: 5, col: 0.5, name: 'Eye of the Maelstrom', icon: 'ultimate',
        runtime: 'eyeOfTheMaelstrom',
        desc: d3(
            'Kills inside the radius extend the channel, with diminishing returns up to +6.0s. Basic damage x1.35 while channelling.',
            'Kills extend the channel up to +10.0s. Basic damage x1.35 while channelling.',
            'Kills extend the channel up to +15.0s (23.6s hard maximum). Basic damage x1.35 while channelling.',
        ),
    },
]);

const EARTHSHAKER = path('bar-earthshaker', 'The Earthshaker', '--c-gold', 'smash', 'I do not swing, I detonate.', [
    {
        id: 'tremorbound', tier: 1, col: 0, name: 'Tremorbound', icon: 'impact',
        stat: { kind: 'addShared', field: 'knockbackOnHit', perPoint: 0.5 },
        runtime: 'tremorbound',
        desc: d3(
            'Knockback +0.5u. Shoved enemies take 10% of that hit again on landing.',
            'Knockback +1.0u. Shoved enemies take 16% of that hit again on landing.',
            'Knockback +1.5u. Landing deals 24%, and splashes enemies within 1.5u.',
        ),
    },
    {
        id: 'bodycheck-bar', tier: 1, col: 1, name: 'Bodycheck', icon: 'dash',
        runtime: 'bodycheck',
        desc: d3(
            'Your dash landing deals 90% of basic damage in 3.6u.',
            'Your dash landing deals 150% of basic damage in 4.2u.',
            'Your dash landing deals 220% in 5.0u, knocks back and applies 2 Fragile.',
        ),
    },
    {
        id: 'aftershock', tier: 2, col: 0, name: 'Aftershock', icon: 'impact',
        runtime: 'aftershock',
        rider: { requiresNodeId: 'runeblooded', text: 'The shockwave fires your enchantments.' },
        desc: d3(
            'Every 6th swing releases a 4.5u shockwave for 60% damage.',
            'Every 5th swing releases a 4.5u shockwave for 90% damage.',
            'Every 4th swing releases a 4.5u shockwave for 130% damage and knocks back 3u.',
        ),
    },
    {
        id: 'seismic-reach', tier: 2, col: 1, name: 'Seismic Reach', icon: 'spear',
        runtime: 'seismicReach',
        desc: d3(
            'Melee reach 5.1u, slash corridor half-width 1.7u.',
            'Melee reach 5.7u, corridor half-width 1.9u.',
            'Melee reach 6.3u, corridor half-width 2.1u. Smash radius 10 → 13u.',
        ),
    },
    {
        id: 'weight-of-the-mountain', tier: 3, col: 0, name: 'Weight of the Mountain', icon: 'keep',
        runtime: 'weightOfTheMountain',
        rider: { requiresNodeId: 'cyclone-cadence', text: 'The aura expands to the Whirlwind radius while channelling.' },
        desc: d3(
            'Damage taken x0.90, move speed x0.96. A 3u aura slows enemies 25%.',
            'Damage taken x0.81, move speed x0.92. A 3u aura slows enemies 25%.',
            'Damage taken x0.73, move speed x0.885. A 3u aura slows enemies 25%.',
        ),
    },
    {
        id: 'fault-line', tier: 3, col: 1, name: 'Fault Line', icon: 'flame',
        runtime: 'faultLine',
        rider: { requiresNodeId: 'open-veins', text: 'The fissure also applies Curse.' },
        desc: d3(
            'Smash leaves a 5u fissure for 4s dealing 12/s. It crawls at 2 u/s.',
            'Smash leaves a 5u fissure for 5s dealing 18/s. It crawls at 2 u/s.',
            'Smash leaves a 5u fissure for 6s dealing 26/s. It crawls at 2 u/s.',
        ),
    },
    {
        id: 'crater-maker', tier: 4, col: 0, name: 'Crater Maker', icon: 'meteor',
        runtime: 'craterMaker',
        desc: d3(
            'Smash x1.6 damage, 22s cooldown, 11.5u radius.',
            'Smash x2.3 damage, 19s cooldown, 13u radius.',
            'Smash x3.2 damage, 16s cooldown, 15u radius, and fires twice — the second pulse pulls inward.',
        ),
    },
    {
        id: 'standing-stone', tier: 4, col: 1, name: 'Standing Stone', icon: 'shield',
        runtime: 'standingStone',
        desc: d3(
            'After 4s without taking damage, the next hit is fully negated.',
            'After 3s without taking damage, the next hit is fully negated.',
            'After 2.5s, the next hit is negated and you release a free Smash at 50%.',
        ),
    },
    {
        id: 'the-fissure', tier: 5, col: 0.5, name: 'The Fissure', icon: 'ultimate',
        runtime: 'theFissure',
        desc: d3(
            'Your slash wave no longer expires at melee range: it travels up to 10u, dealing +25% corridor damage.',
            'It travels up to 13u for +50%, leaving a 1.4u burning trench for 2.5s.',
            'Travel and width now scale with every point spent in Earthshaker, up to a 16u hard cap.',
        ),
    },
]);

const BLOODSWORN = path('bar-bloodsworn', 'The Bloodsworn', '--c-blood', 'lifeRune', 'My damage is how many debuffs are in the field.', [
    {
        id: 'runeblooded', tier: 1, col: 0, name: 'Runeblooded', icon: 'rune',
        runtime: 'runeblooded',
        desc: d3(
            'Your weapon enchantments fire as if one level higher.',
            'As above, plus +12% basic damage against already-statused targets.',
            'As above, and enchantments also fire on the first enemy hit by Smash and by your dash landing.',
        ),
    },
    {
        id: 'bloodthirst', tier: 1, col: 1, name: 'Bloodthirst', icon: 'lifeRune',
        stat: { kind: 'addShared', field: 'lifestealPct', perPoint: 0.03 },
        runtime: 'bloodthirst',
        desc: d3(
            '+3% lifesteal, doubled below 40% HP.',
            '+6% lifesteal, doubled below 40% HP.',
            '+9% lifesteal, doubled below 40% HP, and it now fires on enchantment damage.',
        ),
    },
    {
        id: 'wound-chemistry', tier: 2, col: 0, name: 'Wound Chemistry', icon: 'claw',
        runtime: 'woundChemistry',
        rider: { requiresNodeId: 'tremorbound', text: 'Shoved enemies gain 2 extra stacks on landing.' },
        desc: d3(
            'Basic hits apply 1 Fragile stack.',
            'Basic hits apply 2 Fragile stacks.',
            'Basic hits apply 3 Fragile stacks, lasting 8s.',
        ),
    },
    {
        id: 'open-veins', tier: 2, col: 1, name: 'Open Veins', icon: 'skull',
        runtime: 'openVeins',
        desc: d3(
            'Basic hits Curse for 0.6% of the target MAX HP per second for 4s. You heal 30% of it.',
            'Curse deals 1.0% of max HP per second for 4s.',
            'Curse deals 1.5% of max HP per second for 5s, and executes anything a tick leaves below 20%.',
        ),
    },
    {
        id: 'ember-reservoir', tier: 3, col: 0, name: 'Ember Reservoir', icon: 'flame',
        runtime: 'emberReservoir',
        rider: { requiresNodeId: 'eye-of-the-storm', text: 'Radius 4u and a 0.2s cooldown refund while channelling.' },
        desc: d3(
            '+15% damage to burning targets.',
            '+25% damage to burning targets.',
            '+40% damage, and burning enemies you kill detonate their remaining burn in 2.5u.',
        ),
    },
    {
        id: 'rage-ascendant', tier: 3, col: 1, name: 'Rage Ascendant', icon: 'flame',
        runtime: 'rageAscendant',
        desc: d3(
            'Basic damage x1.15 while below 50% HP.',
            'Basic damage x1.25 while below 50% HP.',
            'Basic damage x1.40 below 50% HP, and +40% attack speed below 30%.',
        ),
    },
    {
        id: 'twin-enchant', tier: 4, col: 0, name: 'Twin Enchant', icon: 'fusion',
        runtime: 'twinEnchant',
        desc: d3(
            'Enchantments fire one further level higher, with a 20% chance to fire twice.',
            'Two further levels, 35% chance to fire twice.',
            'Three further levels, 55% chance — and the repeat is always a different enchantment.',
        ),
    },
    {
        id: 'sanguine-ward', tier: 4, col: 1, name: 'Sanguine Ward', icon: 'shield',
        runtime: 'sanguineWard',
        desc: d3(
            'Overhealing is stored as a shield, up to 15% of max HP.',
            'Stored up to 25% of max HP.',
            'Stored up to 40% of max HP, and the shield explodes when it breaks.',
        ),
    },
    {
        id: 'the-blood-rite', tier: 5, col: 0.5, name: 'The Blood Rite', icon: 'ultimate',
        runtime: 'theBloodRite',
        desc: d3(
            'Every 5th hit on the same enemy consumes all its statuses, detonating for 200% of its burn plus 8% of its max HP in 3u.',
            'Every 3rd hit, detonating in 4.5u.',
            'The detonation now COPIES the statuses to everything within 5u instead of removing them.',
        ),
    },
]);

// ── RANGER ───────────────────────────────────────────────────────────────────

const QUIVER = path('rng-quiver', 'The Endless Quiver', '--el-physical', 'bow', 'Count is its own kind of accuracy.', [
    {
        id: 'split-nock', tier: 1, col: 0, name: 'Split Nock', icon: 'multishot',
        runtime: 'splitNock',
        desc: d3(
            '+1 arrow per volley.',
            '+2 arrows per volley.',
            '+3 arrows per volley, a wider fan, and attack speed converts to arrows faster.',
        ),
    },
    {
        id: 'whispering-fletch', tier: 1, col: 1, name: 'Whispering Fletch', icon: 'ricochet',
        runtime: 'whisperingFletch',
        desc: d3(
            '+1 ricochet bounce, search radius 7u.',
            '+2 ricochet bounces, search radius 8u.',
            '+3 bounces, radius 9u, and a bounce with no fresh target may re-strike once.',
        ),
    },
    {
        id: 'barbed-shafts', tier: 2, col: 0, name: 'Barbed Shafts', icon: 'claw',
        runtime: 'barbedShafts',
        desc: d3(
            'Arrows apply 1 Fragile stack, or +20% bonus damage if the target is already saturated.',
            '2 stacks, or +35% bonus damage when saturated.',
            '3 stacks lasting 8s, or +55% bonus damage when saturated.',
        ),
    },
    {
        id: 'hail-of-steel', tier: 2, col: 1, name: 'Hail of Steel', icon: 'multishot',
        runtime: 'hailOfSteel',
        rider: { requiresNodeId: 'widowmaker', text: 'Executions proc this at 100% and ignore the cooldown once.' },
        desc: d3(
            'An arrow kill has a 25% chance to loose a free full-damage arrow.',
            '40% chance.',
            '60% chance, and the free arrows can chain up to 3 links.',
        ),
    },
    {
        id: 'splinter-salvo', tier: 3, col: 0, name: 'Splinter Salvo', icon: 'spear',
        runtime: 'splinterSalvo',
        rider: { requiresNodeId: 'long-draw', text: 'Splinters inherit the extended range.' },
        desc: d3(
            'Surplus arrows double up on the nearest enemies instead of fanning into empty ground.',
            'As above, with a 30% wider search.',
            'As above, and every arrow past the fourth deals +8% cumulatively.',
        ),
    },
    {
        id: 'second-nature', tier: 3, col: 1, name: 'Second Nature', icon: 'clock',
        stat: { kind: 'multLin', field: 'basicAttackSpeedMultiplier', perPoint: 0.14 },
        runtime: 'secondNature',
        desc: d3(
            '+14% attack speed.',
            '+28% attack speed.',
            '+42% attack speed, and attack speed converts to arrow count at 1.5x weight.',
        ),
    },
    {
        id: 'unspent-shafts', tier: 4, col: 0, name: 'Unspent Shafts', icon: 'scroll',
        runtime: 'unspentShafts',
        desc: d3(
            'Every 6 arrows that expire without hitting anything loose a free 3-arrow volley.',
            'Every 4 wasted arrows.',
            'Every 3 wasted arrows, and killing arrows count as half a wasted arrow.',
        ),
    },
    {
        id: 'the-hundredfold', tier: 4, col: 1, name: 'The Hundredfold', icon: 'multishot',
        runtime: 'theHundredfold',
        desc: d3(
            'Multishot lasts 6.2s and fires 40 arrows, which finally scale with your damage multiplier.',
            '7.4s and 52 arrows.',
            '8.6s and 66 arrows, and every force-cast tick fires twice.',
        ),
    },
    {
        id: 'the-thousand', tier: 5, col: 0.5, name: 'The Thousand', icon: 'ultimate',
        runtime: 'theThousand',
        desc: d3(
            'Arrow cap raised to 15. Each arrow past the sixth deals +6% cumulatively.',
            'Arrow cap 18, +9% per arrow.',
            'Arrow cap 22, +12% per arrow, and the escalation no longer resets between volleys (capped at +150%).',
        ),
    },
]);

const DEADEYE = path('rng-deadeye', 'The Deadeye', '--c-gold', 'spear', 'One arrow, correctly placed.', [
    {
        id: 'long-draw', tier: 1, col: 0, name: 'Long Draw', icon: 'bow',
        runtime: 'longDraw',
        desc: d3(
            'Range 11u, arrow speed 26 u/s.',
            'Range 13u, arrow speed 30 u/s.',
            'Range 15.5u, speed 34 u/s, and +1.5% damage per world unit travelled.',
        ),
    },
    {
        id: 'keen-edge', tier: 1, col: 1, name: 'Keen Edge', icon: 'gem',
        stat: { kind: 'addAssigned', field: 'critChance', perPoint: 0.06 },
        runtime: 'keenEdge',
        desc: d3(
            '+6% critical chance, +0.35 critical damage.',
            '+12% critical chance, +0.60 critical damage.',
            '+18% critical chance, +0.90 critical damage, and a crit consumes no pierce or bounce budget.',
        ),
    },
    {
        id: 'puncture', tier: 2, col: 0, name: 'Puncture', icon: 'spear',
        runtime: 'puncture',
        rider: { requiresNodeId: 'whispering-fletch', text: 'Unspent pierce converts to bounces at half rate.' },
        desc: d3(
            'Arrows pierce 1 body, dealing 75% to it.',
            'Pierce 2 bodies at 90%.',
            'Pierce 3 bodies at 110%, dragging each pierced body 0.6u.',
        ),
    },
    {
        id: 'mark-of-the-moon', tier: 2, col: 1, name: 'Mark of the Moon', icon: 'star',
        runtime: 'markOfTheMoon',
        desc: d3(
            'Your first hit marks a target for 6s. Hits on the mark deal +12% as arcane.',
            '8s mark, +20%.',
            '10s mark, +32%, and the mark jumps to the nearest enemy when its host dies.',
        ),
    },
    {
        id: 'the-still-breath', tier: 3, col: 0, name: 'The Still Breath', icon: 'orb',
        runtime: 'theStillBreath',
        rider: { requiresNodeId: 'hunters-mark', text: 'Steady doubles your curse tick rate.' },
        desc: d3(
            'Stand still 0.8s to become Steady: +25% damage, +8% crit.',
            '0.6s to Steady: +45% damage, +14% crit.',
            '0.5s to Steady: +70% damage, +22% crit, ignoring 40% of enemy resistance.',
        ),
    },
    {
        id: 'widowmaker', tier: 3, col: 1, name: 'Widowmaker', icon: 'skull',
        runtime: 'widowmaker',
        desc: d3(
            'Execute enemies below 12% of their max HP.',
            'Execute below 18%.',
            'Execute below 25%; each execution refunds 1.5s off every ability and re-looses the arrow.',
        ),
    },
    {
        id: 'the-high-ground', tier: 4, col: 0, name: 'The High Ground', icon: 'keep',
        runtime: 'theHighGround',
        desc: d3(
            'Shots landing beyond 60% of your range deal +30% and gain +1 pierce.',
            'Beyond 45% of range: +50%, +2 pierce.',
            'Beyond 30% of range: +75%, +3 pierce, and a long-shot kill looses a second arrow at the furthest enemy.',
        ),
    },
    {
        id: 'the-one-shot', tier: 4, col: 1, name: 'The One Shot', icon: 'bow',
        runtime: 'theOneShot',
        rider: { requiresNodeId: 'bodycheck-rng', text: 'Each great arrow detonates a Bodycheck where it lands.' },
        desc: d3(
            'Multishot inverts: 6 great arrows at 8x basic damage with arena-length pierce.',
            '8 great arrows at 12x.',
            '10 great arrows at 16x, each leaving a moonlit scar for 3s.',
        ),
    },
    {
        id: 'the-moonlit-lane', tier: 5, col: 0.5, name: 'The Moonlit Lane', icon: 'ultimate',
        runtime: 'theMoonlitLane',
        desc: d3(
            'Your basic attack now targets the FURTHEST enemy and pierces everything between. Speed 40 u/s.',
            'Range 22u, and the arrow continues past its target.',
            'Range 30u, no pierce cap, and +2% damage per point spent in Deadeye.',
        ),
    },
]);

const WILD_HUNT = path('rng-wildhunt', 'The Wild Hunt', '--c-moss', 'boot', 'Nothing that stands still survives.', [
    {
        id: 'bodycheck-rng', tier: 1, col: 0, name: 'Bodycheck', icon: 'dash',
        runtime: 'bodycheck',
        desc: d3(
            'Your dash landing deals 120% of basic damage in 3.6u.',
            'Your dash landing deals 200% in 4.2u.',
            '320% in 5.0u, and the whole flight path deals 80% and shoves.',
        ),
    },
    {
        id: 'hunters-mark', tier: 1, col: 1, name: "Hunter's Mark", icon: 'skull',
        runtime: 'huntersMark',
        desc: d3(
            'Basic hits Curse for 0.6% of the target MAX HP per second for 4s. You heal 30% of it.',
            'Curse deals 1.0% of max HP per second.',
            'Curse deals 1.5% for 5s, and executes below 20% max HP.',
        ),
    },
    {
        id: 'briar-trail', tier: 2, col: 0, name: 'Briar Trail', icon: 'claw',
        runtime: 'briarTrail',
        rider: { requiresNodeId: 'barbed-shafts', text: 'The briar applies 1 Fragile stack per tick.' },
        desc: d3(
            'Your dash lays a 2u briar strip for 4s, slowing 35%. It crawls at 2 u/s.',
            '6s, slowing 50%.',
            '8s, slowing 65%.',
        ),
    },
    {
        id: 'the-long-stride', tier: 2, col: 1, name: 'The Long Stride', icon: 'boot',
        stat: { kind: 'multLin', field: 'moveSpeedMultiplier', perPoint: 0.09 },
        runtime: 'theLongStride',
        desc: d3(
            '+9% move speed, dash cooldown 5.8s.',
            '+18% move speed, dash cooldown 4.8s.',
            '+27% move speed, dash cooldown 3.9s, and you build +4% arrow damage per 3u travelled.',
        ),
    },
    {
        id: 'skirmishers-grace', tier: 3, col: 0, name: "Skirmisher's Grace", icon: 'dash',
        runtime: 'skirmishersGrace',
        rider: { requiresNodeId: 'second-nature', text: 'The burst attack speed counts toward arrow count.' },
        desc: d3(
            'For 1.2s after a dash: +40% attack speed, -20% damage taken.',
            'For 1.8s: +65% attack speed, -30% damage taken.',
            'For 2.5s: +95% attack speed, -40% damage taken, and every arrow mirrors a second backward.',
        ),
    },
    {
        id: 'withering', tier: 3, col: 1, name: 'Withering', icon: 'rune',
        runtime: 'withering',
        rider: { requiresNodeId: 'mark-of-the-moon', text: 'The mark prefers cursed targets and curses 1.5x harder.' },
        desc: d3(
            'A cursed enemy that dies spreads its curse within 4u.',
            'Within 6u, at full refreshed duration.',
            'Within 8u, and cursed enemies carry 2 Fragile stacks refreshed every 1.5s.',
        ),
    },
    {
        id: 'the-falling-sky', tier: 4, col: 0, name: 'The Falling Sky', icon: 'explosiveArrow',
        runtime: 'theFallingSky',
        desc: d3(
            'Explosive Arrow lasts 4.5s with 4u craters lingering 2s.',
            '6.0s, faster ticks, 5u craters lingering 3s.',
            '7.5s and 30 arrows, 6u craters lingering 4s, and craters apply your curse.',
        ),
    },
    {
        id: 'unseen', tier: 4, col: 1, name: 'Unseen', icon: 'orb',
        runtime: 'unseen',
        desc: d3(
            'After 2.5s undamaged, the next hit is negated and you step 4u away.',
            'After 2.0s.',
            'After 1.5s, and the step detonates a Bodycheck at both endpoints.',
        ),
    },
    {
        id: 'the-wild-hunt', tier: 5, col: 0.5, name: 'The Wild Hunt', icon: 'ultimate',
        runtime: 'theWildHunt',
        desc: d3(
            'While MOVING you leave a burning briar wake that curses. Move speed x1.15.',
            'A wider, longer wake that also slows 45%.',
            'Wake damage scales +3% per point spent in Wild Hunt, and kills extend it up to a 6s cap.',
        ),
    },
]);

// ── MAGE ─────────────────────────────────────────────────────────────────────

const CHOIR = path('mag-choir', 'The Unbound Choir', '--el-storm', 'bolt', 'The spell does not end when I stop speaking.', [
    {
        id: 'quickened-tongue', tier: 1, col: 0, name: 'Quickened Tongue', icon: 'clock',
        stat: { kind: 'multPow', field: 'powerCooldownMultiplier', factor: 0.92 },
        runtime: 'quickenedTongue',
        desc: d3(
            'Power cooldowns -8%. Cast wind-up x0.80.',
            'Power cooldowns -15.4%. Cast wind-up x0.62.',
            'Power cooldowns -22.1%. Casts are instant.',
        ),
    },
    {
        id: 'arc-resonance', tier: 1, col: 1, name: 'Arc Resonance', icon: 'rune',
        runtime: 'arcResonance',
        desc: d3(
            'Each cast grants 1 Resonance (max 10). +2.5% power damage per stack.',
            '+4% power damage per stack.',
            '+6% per stack, and at full stacks your next cast echoes free.',
        ),
    },
    {
        id: 'forked-lightning', tier: 2, col: 0, name: 'Forked Lightning', icon: 'bolt',
        runtime: 'forkedLightning',
        rider: { requiresNodeId: 'rimebound', text: 'Chains apply 1 chill stack per hop.' },
        desc: d3(
            '+1 chain hop, chain radius 5u.',
            '+2 chain hops, radius 6u.',
            '+3 hops, radius 7u, and chains SPLIT.',
        ),
    },
    {
        id: 'blinkstorm', tier: 2, col: 1, name: 'Blinkstorm', icon: 'dash',
        runtime: 'blinkstorm',
        desc: d3(
            'Blink cooldown 5.6s. Landing detonates for 120% in 3.5u.',
            'Blink cooldown 4.5s. Landing detonates for 200% in 4.5u.',
            'Blink cooldown 3.6s, 320% in 5.5u, and the departure point detonates too.',
        ),
    },
    {
        id: 'the-second-voice', tier: 3, col: 0, name: 'The Second Voice', icon: 'fusion',
        runtime: 'theSecondVoice',
        rider: { requiresNodeId: 'the-hollow-mouth', text: 'The echo curses for 1s.' },
        desc: d3(
            'The echo recasts a DIFFERENT slot at 70%, triggering at 8 Resonance.',
            'At 85%, triggering at 7 Resonance.',
            'At 100%, triggering at 6 Resonance, and it also fires on blink.',
        ),
    },
    {
        id: 'storm-born', tier: 3, col: 1, name: 'Storm-Born', icon: 'bolt',
        runtime: 'stormBorn',
        desc: d3(
            'Kills refund 3% of every slot cooldown. Every 10 kills refunds 1.0s of blink.',
            '5% refund; every 8 kills refunds 1.6s.',
            '7% refund; every 6 kills refunds 2.4s and grants 2 Resonance.',
        ),
    },
    {
        id: 'thunderhead', tier: 4, col: 0, name: 'Thunderhead', icon: 'bolt',
        runtime: 'thunderhead',
        desc: d3(
            'Every 8th cast calls down 8 hops at 140% power damage, applying 2 Fragile.',
            'Every 6th cast, 10 hops at 180%.',
            'Every 5th cast, 12 hops at 240%, inheriting the split.',
        ),
    },
    {
        id: 'untethered', tier: 4, col: 1, name: 'Untethered', icon: 'boot',
        runtime: 'untethered',
        desc: d3(
            'After a blink: move x1.35 for 2.0s, -25% damage taken for 1.2s.',
            'x1.5 for 2.6s, -40% for 1.6s.',
            'x1.7 for 3.2s, -55% for 2.0s, and the first hit in the window is negated.',
        ),
    },
    {
        id: 'the-endless-canticle', tier: 5, col: 0.5, name: 'The Endless Canticle', icon: 'ultimate',
        runtime: 'theEndlessCanticle',
        desc: d3(
            'Resonance cap 10 → 16, and at max stacks power cooldowns drop a further x0.7.',
            'Resonance cap 22, and the echo now fires two slots.',
            'Resonance cap 28; at 22+ Resonance every cast force-casts all autocast slots for 8 Resonance.',
        ),
    },
]);

const LONG_WINTER = path('mag-winter', 'The Long Winter', '--el-ice', 'snowflake', 'Everything stops eventually.', [
    {
        id: 'rimebound', tier: 1, col: 0, name: 'Rimebound', icon: 'snowflake',
        runtime: 'rimebound',
        desc: d3(
            'Basic hits apply 1 chill stack for 3s.',
            'Chill lasts 5s, with a bonus stack against already-chilled targets.',
            '2 stacks for 6s, and anything your chill freezes is primed to shatter for 90% in 3u.',
        ),
    },
    {
        id: 'glacial-reach', tier: 1, col: 1, name: 'Glacial Reach', icon: 'orb',
        stat: { kind: 'multLin', field: 'attackRangeMultiplier', perPoint: 0.05 },
        runtime: 'glacialReach',
        desc: d3(
            'Attack range 9.2u. Hits slow 20%.',
            'Attack range 10.4u. Hits slow 30%.',
            'Attack range 11.6u, hits slow 35%, and a permanent 3u frost aura slows 35%.',
        ),
    },
    {
        id: 'killing-cold', tier: 2, col: 0, name: 'Killing Cold', icon: 'snowflake',
        runtime: 'killingCold',
        rider: { requiresNodeId: 'arc-resonance', text: 'Also applies to the primary target of every power cast.' },
        desc: d3(
            '+20% damage to chilled, +35% to frozen.',
            '+35% to chilled, +60% to frozen.',
            '+55% to chilled, +95% to frozen, plus 2 Fragile on frozen targets.',
        ),
    },
    {
        id: 'white-silence', tier: 2, col: 1, name: 'White Silence', icon: 'frostNova',
        runtime: 'whiteSilence',
        desc: d3(
            'Frost Nova cooldown 25s, freeze 3.2s, frozen enemies primed to shatter for 60%.',
            'Cooldown 20s, freeze 3.9s, shatter 100%.',
            'Cooldown 16s, freeze 4.6s, shatter 160%, leaving a rime field.',
        ),
    },
    {
        id: 'the-shattering', tier: 3, col: 0, name: 'The Shattering', icon: 'impact',
        runtime: 'theShattering',
        rider: { requiresNodeId: 'the-hollow-mouth', text: 'The shatter also spreads the corpse curse.' },
        desc: d3(
            'Chilled or frozen kills detonate for 80% in 3u, chilling survivors.',
            '130% in 4u.',
            '200% in 5u, and shatters chain up to 3 links.',
        ),
    },
    {
        id: 'winters-patience', tier: 3, col: 1, name: "Winter's Patience", icon: 'shield',
        runtime: 'wintersPatience',
        desc: d3(
            'Enemies within 5u deal 20% less contact damage.',
            '32% less, aura 6u.',
            '45% less, aura 7.5u, and 3 continuous seconds inside freezes them for 2s.',
        ),
    },
    {
        id: 'absolute-zero', tier: 4, col: 0, name: 'Absolute Zero', icon: 'frostNova',
        runtime: 'absoluteZero',
        desc: d3(
            'Frost Nova sends 1 follow-up nova at 70% duration.',
            '2 follow-up novas.',
            '3 follow-ups, and every nova after the first applies 3 Fragile arena-wide.',
        ),
    },
    {
        id: 'hoarfrost-crawl', tier: 4, col: 1, name: 'Hoarfrost Crawl', icon: 'snowflake',
        runtime: 'hoarfrostCrawl',
        desc: d3(
            'Your ice zones crawl at 1.5 u/s and last 2s longer.',
            'Crawl at 2.5 u/s, +4s, up to 2 concurrent.',
            'Crawl at 3.5 u/s, +6s, up to 3 concurrent, and overlapping zones merge.',
        ),
    },
    {
        id: 'the-long-winter', tier: 5, col: 0.5, name: 'The Long Winter', icon: 'ultimate',
        runtime: 'theLongWinter',
        desc: d3(
            'Your aura is no longer a radius, it is the arena: every living enemy is permanently chilled at 1 stack.',
            '2 stacks, and every Shattering value scales with your points in this path.',
            '3 stacks, and anything the arena-chill freezes is primed to shatter for 250%.',
        ),
    },
]);

const HOLLOW_STAR = path('mag-hollow', 'The Hollow Star', '--c-arcane', 'rune', 'I do not cast spells. I open holes.', [
    {
        id: 'the-hollow-mouth', tier: 1, col: 0, name: 'The Hollow Mouth', icon: 'skull',
        runtime: 'theHollowMouth',
        desc: d3(
            'Your hits Curse for 0.5% of the target MAX HP per second for 4s. You heal 25% of it.',
            '0.9% per second, healing 30%.',
            '1.4% per second for 5s, healing 35%, and executing below 20% max HP.',
        ),
    },
    {
        id: 'grave-weight', tier: 1, col: 1, name: 'Grave Weight', icon: 'orb',
        runtime: 'graveWeight',
        desc: d3(
            'Every cast drags enemies within 6u inward 1.2u and deals 25% of the power damage again as arcane.',
            'Within 7u, dragging 2.0u for 40%.',
            'Within 8u for 60%, leaving a 2s gravity well that works even on bosses.',
        ),
    },
    {
        id: 'the-star-falls', tier: 2, col: 0, name: 'The Star Falls', icon: 'meteor',
        runtime: 'theStarFalls',
        desc: d3(
            'Meteor Strike calls 7 meteors, cooldown 38s, radius 4.8u.',
            '9 meteors, cooldown 32s, radius 5.6u.',
            '12 meteors, cooldown 26s, radius 6.4u, and each crater leaves a collapsing well.',
        ),
    },
    {
        id: 'dread', tier: 2, col: 1, name: 'Dread', icon: 'rune',
        runtime: 'dread',
        rider: { requiresNodeId: 'rimebound', text: 'A target that is both cursed and chilled takes a further +25%.' },
        desc: d3(
            '+20% damage to cursed targets, applying 1 Fragile.',
            '+35%, applying 2 Fragile.',
            '+55%, applying 3 Fragile, and a cursed death spreads the curse 5u.',
        ),
    },
    {
        id: 'event-horizon', tier: 3, col: 0, name: 'Event Horizon', icon: 'orb',
        runtime: 'eventHorizon',
        desc: d3(
            'Gravity wells pull twice as hard, ticking for 30%, and last 0.8s longer.',
            'Ticking for 45%, lasting 1.4s longer.',
            'Ticking for 60%, lasting 2.0s longer, and expiring wells implode for 300%.',
        ),
    },
    {
        id: 'the-debt', tier: 3, col: 1, name: 'The Debt', icon: 'pact',
        runtime: 'theDebt',
        desc: d3(
            'Curse heals you for 45% of its damage. With 5+ cursed nearby you take 15% less damage.',
            '60% healing, 25% less damage.',
            '80% healing, 35% less damage, and once per wave a lethal hit with 8+ cursed nearby leaves you at 1 HP and detonates every curse.',
        ),
    },
    {
        id: 'collapse', tier: 4, col: 0, name: 'Collapse', icon: 'orb',
        runtime: 'collapse',
        desc: d3(
            'Every 10th kill opens a gravity well at the corpse.',
            'Every 7th kill.',
            'Every 5th kill, and a well that consumes 12+ kills collapses into a free meteor impact.',
        ),
    },
    {
        id: 'unmaking', tier: 4, col: 1, name: 'Unmaking', icon: 'skull',
        runtime: 'unmaking',
        desc: d3(
            'Execute enemies below 8% of max HP, refunding 4% of every slot cooldown.',
            'Below 13%, refunding 7%.',
            'Below 20%, refunding 10%, and each execution curses everything within 4u.',
        ),
    },
    {
        id: 'the-hollow-star', tier: 5, col: 0.5, name: 'The Hollow Star', icon: 'ultimate',
        runtime: 'theHollowStar',
        desc: d3(
            'Your curse no longer expires — it lasts the whole wave.',
            'Curse strength grows +3% per point in this path, and applications ADD instead of overwriting.',
            'Meteor Strike becomes THE COLLAPSE: one vast well that implodes for 900% and executes below 35% max HP.',
        ),
    },
]);

export const ASCENSION_TREES: Record<ChampionType, AscensionPathDef[]> = {
    barbarian: [TEMPEST, EARTHSHAKER, BLOODSWORN],
    ranger: [QUIVER, DEADEYE, WILD_HUNT],
    mage: [CHOIR, LONG_WINTER, HOLLOW_STAR],
};

/** Flat lookup across every class — ids are unique tree-wide. */
export function findNode(tree: AscensionPathDef[], nodeId: string): AscensionNodeDef | null {
    for (const p of tree) {
        for (const n of p.nodes) if (n.id === nodeId) return n;
    }
    return null;
}
