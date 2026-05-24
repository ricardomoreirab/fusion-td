/**
 * Elemental Tower Tree — Magical/Status Effect towers.
 * 30 towers across 8 tiers branching from a single Elemental Obelisk base.
 */

import { TowerDefinition } from './TowerDefinitions';
import { StatusEffect } from './Tower';

function elementalVisual(
    height: number, width: number, color: [number, number, number],
    components: TowerDefinition['visual']['components'] = [],
    particles?: TowerDefinition['visual']['particles'],
    animations?: TowerDefinition['visual']['animations']
): TowerDefinition['visual'] {
    return {
        baseShape: 'cylinder',
        baseDimensions: { width, height, tessellation: 6 },
        baseColor: color,
        components,
        particles,
        animations,
    };
}

const OBSIDIAN: [number, number, number] = [0.15, 0.10, 0.12];
const FIRE_ORANGE: [number, number, number] = [0.90, 0.35, 0.12];
const FIRE_GLOW: [number, number, number] = [1.0, 0.55, 0.10];
const EMBER: [number, number, number] = [0.80, 0.25, 0.05];
const LIGHTNING: [number, number, number] = [0.70, 0.70, 1.00];
const STORM_DARK: [number, number, number] = [0.25, 0.25, 0.38];
const PLASMA: [number, number, number] = [0.90, 0.50, 1.00];
const ICE_BLUE: [number, number, number] = [0.55, 0.80, 1.00];
const ICE_CRYSTAL: [number, number, number] = [0.70, 0.88, 1.00];
const ICE_DEEP: [number, number, number] = [0.25, 0.45, 0.80];
const TIDAL: [number, number, number] = [0.20, 0.55, 0.90];
const NATURE_GREEN: [number, number, number] = [0.30, 0.65, 0.35];
const THORN: [number, number, number] = [0.45, 0.55, 0.20];
const SHADOW_PURPLE: [number, number, number] = [0.35, 0.15, 0.45];
const VOID: [number, number, number] = [0.20, 0.08, 0.30];
const ARCANE: [number, number, number] = [0.60, 0.30, 0.85];

export const ELEMENTAL_TOWER_DEFS: TowerDefinition[] = [
    // ===== TIER 1 =====
    {
        id: 'elementalObelisk',
        name: 'Elemental Obelisk',
        description: 'A mystical obelisk channeling raw elemental energy.',
        tier: 1, tree: 'elemental', category: 'base',
        stats: { damage: 6, range: 5, fireRate: 1.2, cost: 50 },
        ability: { name: 'None', type: 'passive', cooldown: 0, effect: { kind: 'none' }, description: 'No special ability' },
        visual: elementalVisual(1.6, 0.8, ARCANE, [
            { shape: 'box', dimensions: { width: 0.6, height: 1.2, depth: 0.6 }, color: [0.50, 0.28, 0.75], position: [0, 0.6, 0] },
            { shape: 'sphere', dimensions: { diameter: 0.4, tessellation: 6 }, color: ARCANE, position: [0, 1.5, 0], emissive: 0.5 },
        ],
        [{ type: 'ambient', emitRate: 3, color1: [0.6, 0.3, 0.9, 0.4], color2: [0.4, 0.2, 0.7, 0.2], minSize: 0.05, maxSize: 0.12, minLifeTime: 0.5, maxLifeTime: 1.0, offsetY: 1.5 }]),
        upgradePaths: ['pyroclastSpire', 'cryomancerPillar'],
        parentId: null,
        projectileColor: [0.60, 0.30, 0.85],
    },

    // ===== TIER 2 — Fire Branch =====
    {
        id: 'pyroclastSpire',
        name: 'Pyroclast Spire',
        description: 'Channels destructive fire magic to burn enemies.',
        tier: 2, tree: 'elemental', category: 'fire',
        stats: { damage: 10, range: 5, fireRate: 1.2, cost: 75 },
        ability: { name: 'Ignite', type: 'passive', cooldown: 0, effect: { kind: 'burnDoT', dps: 2, duration: 2 }, description: 'Sets enemies on fire for 2 DPS over 2s' },
        visual: elementalVisual(1.8, 0.9, OBSIDIAN, [
            { shape: 'cone', dimensions: { diameter: 1.0, height: 0.8, tessellation: 6 }, color: FIRE_ORANGE, position: [0, 1.2, 0] },
            { shape: 'sphere', dimensions: { diameter: 0.3, tessellation: 6 }, color: FIRE_GLOW, position: [0, 1.7, 0], emissive: 0.6 },
        ],
        [{ type: 'fire', emitRate: 5, color1: [1, 0.5, 0.1, 0.5], color2: [1, 0.3, 0, 0.3], minSize: 0.05, maxSize: 0.15, minLifeTime: 0.3, maxLifeTime: 0.6, offsetY: 1.5 }]),
        upgradePaths: ['infernoPyre', 'stormNeedle'],
        parentId: 'elementalObelisk',
        projectileColor: [1.0, 0.4, 0.1],
        statusEffect: { effect: StatusEffect.BURNING, duration: 2, strength: 2, chance: 0.8 },
    },

    // ===== TIER 2 — Ice Branch =====
    {
        id: 'cryomancerPillar',
        name: 'Cryomancer Pillar',
        description: 'Channels frost magic to slow and control enemies.',
        tier: 2, tree: 'elemental', category: 'ice',
        stats: { damage: 7, range: 6, fireRate: 1.0, cost: 75 },
        ability: { name: 'Chill', type: 'passive', cooldown: 0, effect: { kind: 'snare', duration: 1.5, slow: 0.3 }, description: 'Slows enemies by 30% for 1.5s' },
        visual: elementalVisual(1.8, 0.9, ICE_DEEP, [
            { shape: 'box', dimensions: { width: 0.7, height: 1.0, depth: 0.7 }, color: ICE_BLUE, position: [0, 0.9, 0] },
            { shape: 'sphere', dimensions: { diameter: 0.35, tessellation: 6 }, color: ICE_CRYSTAL, position: [0, 1.6, 0], emissive: 0.5 },
        ],
        [{ type: 'ice', emitRate: 4, color1: [0.5, 0.8, 1, 0.4], color2: [0.3, 0.6, 1, 0.2], minSize: 0.05, maxSize: 0.12, minLifeTime: 0.5, maxLifeTime: 1.0, offsetY: 1.5 }]),
        upgradePaths: ['glacierMonolith', 'verdantTotem'],
        parentId: 'elementalObelisk',
        projectileColor: [0.55, 0.80, 1.00],
        statusEffect: { effect: StatusEffect.SLOWED, duration: 1.5, strength: 0.3, chance: 0.8 },
    },

    // ===== TIER 3 — Pure Fire =====
    {
        id: 'infernoPyre',
        name: 'Inferno Pyre',
        description: 'Blazing pillar of pure fire that incinerates everything nearby.',
        tier: 3, tree: 'elemental', category: 'fire',
        stats: { damage: 14, range: 5, fireRate: 1.4, cost: 100 },
        ability: { name: 'Scorch', type: 'passive', cooldown: 0, effect: { kind: 'burnDoT', dps: 4, duration: 3 }, description: 'Burns enemies for 4 DPS over 3s' },
        visual: elementalVisual(2.0, 1.0, OBSIDIAN, [
            { shape: 'cone', dimensions: { diameter: 1.2, height: 1.0, tessellation: 6 }, color: FIRE_ORANGE, position: [0, 1.3, 0] },
            { shape: 'sphere', dimensions: { diameter: 0.4, tessellation: 6 }, color: FIRE_GLOW, position: [0, 2.0, 0], emissive: 0.7 },
        ],
        [{ type: 'fire', emitRate: 8, color1: [1, 0.5, 0.1, 0.6], color2: [1, 0.3, 0, 0.4], minSize: 0.08, maxSize: 0.2, minLifeTime: 0.3, maxLifeTime: 0.7, offsetY: 1.8 }]),
        upgradePaths: ['hellfireCitadel', 'emberForge'],
        parentId: 'pyroclastSpire',
        projectileColor: [1.0, 0.45, 0.1],
        statusEffect: { effect: StatusEffect.BURNING, duration: 3, strength: 4, chance: 0.9 },
    },

    // ===== TIER 3 — Lightning =====
    {
        id: 'stormNeedle',
        name: 'Storm Needle',
        description: 'A crackling needle of lightning that chains between enemies.',
        tier: 3, tree: 'elemental', category: 'lightning',
        stats: { damage: 12, range: 7, fireRate: 1.0, cost: 100 },
        ability: { name: 'Arc Lightning', type: 'passive', cooldown: 0, effect: { kind: 'chainLightning', chains: 2, damageDecay: 0.7, chainRange: 4 }, description: 'Lightning arcs to 2 additional enemies at 70% damage' },
        visual: elementalVisual(2.2, 0.7, STORM_DARK, [
            { shape: 'cylinder', dimensions: { diameter: 0.5, height: 1.4, tessellation: 6 }, color: [0.30, 0.30, 0.45], position: [0, 1.1, 0] },
            { shape: 'sphere', dimensions: { diameter: 0.35, tessellation: 6 }, color: LIGHTNING, position: [0, 2.0, 0], emissive: 0.7 },
        ],
        [{ type: 'lightning', emitRate: 6, color1: [0.7, 0.7, 1, 0.6], color2: [0.5, 0.5, 0.9, 0.3], minSize: 0.04, maxSize: 0.1, minLifeTime: 0.2, maxLifeTime: 0.5, offsetY: 1.8 }]),
        upgradePaths: ['tempestObelisk', 'plasmaSpire'],
        parentId: 'pyroclastSpire',
        projectileColor: [0.70, 0.70, 1.00],
        statusEffect: { effect: StatusEffect.STUNNED, duration: 0.3, strength: 1.0, chance: 0.15 },
    },

    // ===== TIER 3 — Glacier =====
    {
        id: 'glacierMonolith',
        name: 'Glacier Monolith',
        description: 'Towering ice formation that freezes enemies solid.',
        tier: 3, tree: 'elemental', category: 'frost',
        stats: { damage: 10, range: 6, fireRate: 1.0, cost: 100 },
        ability: { name: 'Deep Freeze', type: 'active_auto', cooldown: 8, effect: { kind: 'freezeNova', radius: 4, duration: 1.5, damageAmp: 0.2 }, description: 'Every 8s, freezes all enemies in radius for 1.5s' },
        visual: elementalVisual(2.2, 1.0, ICE_DEEP, [
            { shape: 'box', dimensions: { width: 0.8, height: 1.4, depth: 0.8 }, color: ICE_BLUE, position: [0, 1.1, 0] },
            { shape: 'icosphere', dimensions: { radius: 0.3, subdivisions: 1 }, color: ICE_CRYSTAL, position: [0, 2.0, 0], emissive: 0.5 },
        ],
        [{ type: 'ice', emitRate: 6, color1: [0.6, 0.85, 1, 0.4], color2: [0.4, 0.65, 1, 0.2], minSize: 0.06, maxSize: 0.15, minLifeTime: 0.5, maxLifeTime: 1.0, offsetY: 1.8 }]),
        upgradePaths: ['permafrostCitadel', 'tidalShrine'],
        parentId: 'cryomancerPillar',
        projectileColor: [0.60, 0.85, 1.00],
        statusEffect: { effect: StatusEffect.SLOWED, duration: 2, strength: 0.4, chance: 0.9 },
    },

    // ===== TIER 3 — Nature =====
    {
        id: 'verdantTotem',
        name: 'Verdant Totem',
        description: 'Nature magic that poisons and entangles enemies.',
        tier: 3, tree: 'elemental', category: 'nature',
        stats: { damage: 8, range: 6, fireRate: 1.2, cost: 100 },
        ability: { name: 'Entangle', type: 'passive', cooldown: 0, effect: { kind: 'snare', duration: 2, slow: 0.4 }, description: 'Entangles enemies, slowing by 40% for 2s' },
        visual: elementalVisual(1.8, 1.0, [0.40, 0.30, 0.18], [
            { shape: 'cylinder', dimensions: { diameter: 0.8, height: 1.2, tessellation: 6 }, color: NATURE_GREEN, position: [0, 0.9, 0] },
            { shape: 'sphere', dimensions: { diameter: 0.3, tessellation: 6 }, color: [0.40, 0.80, 0.30], position: [0, 1.7, 0], emissive: 0.4 },
        ],
        [{ type: 'nature', emitRate: 4, color1: [0.3, 0.7, 0.2, 0.4], color2: [0.2, 0.5, 0.15, 0.2], minSize: 0.05, maxSize: 0.12, minLifeTime: 0.5, maxLifeTime: 1.2, offsetY: 1.5 }]),
        upgradePaths: ['thornwealdBastion', 'shadowgroveSpire'],
        parentId: 'cryomancerPillar',
        projectileColor: [0.30, 0.65, 0.35],
        statusEffect: { effect: StatusEffect.SLOWED, duration: 2, strength: 0.4, chance: 0.7 },
    },

    // ===== TIER 4 — Hellfire path =====
    {
        id: 'hellfireCitadel',
        name: 'Hellfire Citadel',
        description: 'Demonic flames that engulf entire areas in hellfire.',
        tier: 4, tree: 'elemental', category: 'fire',
        stats: { damage: 18, range: 5, fireRate: 1.5, cost: 150 },
        ability: { name: 'Hellfire', type: 'passive', cooldown: 0, effect: { kind: 'burnDoT', dps: 6, duration: 3 }, description: 'Hellfire burns for 6 DPS over 3s' },
        visual: elementalVisual(2.4, 1.2, OBSIDIAN, [
            { shape: 'cone', dimensions: { diameter: 1.4, height: 1.2, tessellation: 6 }, color: EMBER, position: [0, 1.5, 0] },
            { shape: 'sphere', dimensions: { diameter: 0.5, tessellation: 8 }, color: FIRE_GLOW, position: [0, 2.4, 0], emissive: 0.8 },
        ],
        [{ type: 'fire', emitRate: 12, color1: [1, 0.5, 0.1, 0.7], color2: [1, 0.25, 0, 0.5], minSize: 0.1, maxSize: 0.25, minLifeTime: 0.3, maxLifeTime: 0.8, offsetY: 2.0 }]),
        upgradePaths: ['infernalBastion_t5'],
        parentId: 'infernoPyre',
        projectileColor: [1.0, 0.4, 0.05],
        statusEffect: { effect: StatusEffect.BURNING, duration: 3, strength: 6, chance: 1.0 },
    },

    // ===== TIER 4 — Ember Forge path =====
    {
        id: 'emberForge',
        name: 'Ember Forge',
        description: 'Rapid-fire ember bolts that pile on burn damage.',
        tier: 4, tree: 'elemental', category: 'ember',
        stats: { damage: 10, range: 5, fireRate: 2.2, cost: 150 },
        ability: { name: 'Rapid Burn', type: 'passive', cooldown: 0, effect: { kind: 'burnDoT', dps: 3, duration: 2 }, description: 'Fast attacks each apply 3 DPS burn for 2s' },
        visual: elementalVisual(1.8, 1.2, [0.35, 0.20, 0.10], [
            { shape: 'box', dimensions: { width: 1.0, height: 0.8, depth: 1.0 }, color: [0.45, 0.25, 0.12], position: [0, 0.8, 0] },
            { shape: 'cylinder', dimensions: { diameter: 0.4, height: 0.5, tessellation: 6 }, color: FIRE_GLOW, position: [0, 1.4, 0], emissive: 0.5 },
        ],
        [{ type: 'fire', emitRate: 6, color1: [1, 0.6, 0.2, 0.5], color2: [0.9, 0.3, 0.1, 0.3], minSize: 0.04, maxSize: 0.12, minLifeTime: 0.3, maxLifeTime: 0.6, offsetY: 1.3 }]),
        upgradePaths: ['dwarvenHellforge_t5'],
        parentId: 'infernoPyre',
        projectileColor: [1.0, 0.5, 0.15],
        statusEffect: { effect: StatusEffect.BURNING, duration: 2, strength: 3, chance: 0.9 },
    },

    // ===== TIER 4 — Tempest path =====
    {
        id: 'tempestObelisk',
        name: 'Tempest Obelisk',
        description: 'A towering obelisk that summons chain lightning storms.',
        tier: 4, tree: 'elemental', category: 'lightning',
        stats: { damage: 16, range: 8, fireRate: 1.0, cost: 150 },
        ability: { name: 'Chain Storm', type: 'passive', cooldown: 0, effect: { kind: 'chainLightning', chains: 3, damageDecay: 0.65, chainRange: 5 }, description: 'Lightning chains to 3 enemies at 65% decay' },
        visual: elementalVisual(2.6, 0.8, STORM_DARK, [
            { shape: 'cylinder', dimensions: { diameter: 0.6, height: 1.8, tessellation: 6 }, color: [0.28, 0.28, 0.42], position: [0, 1.3, 0] },
            { shape: 'sphere', dimensions: { diameter: 0.4, tessellation: 6 }, color: LIGHTNING, position: [0, 2.5, 0], emissive: 0.8 },
        ],
        [{ type: 'lightning', emitRate: 8, color1: [0.7, 0.7, 1, 0.7], color2: [0.5, 0.5, 0.9, 0.4], minSize: 0.05, maxSize: 0.12, minLifeTime: 0.2, maxLifeTime: 0.4, offsetY: 2.2 }]),
        upgradePaths: ['stormcallerApex_t5'],
        parentId: 'stormNeedle',
        projectileColor: [0.75, 0.75, 1.00],
        statusEffect: { effect: StatusEffect.STUNNED, duration: 0.3, strength: 1.0, chance: 0.2 },
    },

    // ===== TIER 4 — Plasma path =====
    {
        id: 'plasmaSpire',
        name: 'Plasma Spire',
        description: 'Focuses pure plasma energy into devastating single-target beams.',
        tier: 4, tree: 'elemental', category: 'plasma',
        stats: { damage: 30, range: 9, fireRate: 0.6, cost: 150 },
        ability: { name: 'Plasma Bolt', type: 'passive', cooldown: 0, effect: { kind: 'overcharge', damageMultiplier: 2.0, duration: 0.5, cooldown: 5 }, description: 'Every 5s, next shot deals 2x damage' },
        visual: elementalVisual(2.4, 0.7, STORM_DARK, [
            { shape: 'cylinder', dimensions: { diameter: 0.5, height: 1.6, tessellation: 6 }, color: [0.30, 0.25, 0.40], position: [0, 1.2, 0] },
            { shape: 'sphere', dimensions: { diameter: 0.35, tessellation: 6 }, color: PLASMA, position: [0, 2.2, 0], emissive: 0.7 },
        ],
        [{ type: 'lightning', emitRate: 4, color1: [0.9, 0.5, 1, 0.5], color2: [0.7, 0.3, 0.9, 0.3], minSize: 0.04, maxSize: 0.1, minLifeTime: 0.3, maxLifeTime: 0.6, offsetY: 2.0 }]),
        upgradePaths: ['annihilationLens_t5'],
        parentId: 'stormNeedle',
        projectileColor: [0.90, 0.50, 1.00],
    },

    // ===== TIER 4 — Permafrost path =====
    {
        id: 'permafrostCitadel',
        name: 'Permafrost Citadel',
        description: 'An ancient ice fortress that freezes everything nearby.',
        tier: 4, tree: 'elemental', category: 'frost',
        stats: { damage: 14, range: 6, fireRate: 1.0, cost: 150 },
        ability: { name: 'Permafrost', type: 'active_auto', cooldown: 7, effect: { kind: 'freezeNova', radius: 5, duration: 2.0, damageAmp: 0.25 }, description: 'Every 7s, freezes enemies in radius 5 for 2s' },
        visual: elementalVisual(2.4, 1.2, ICE_DEEP, [
            { shape: 'box', dimensions: { width: 1.0, height: 1.6, depth: 1.0 }, color: ICE_BLUE, position: [0, 1.2, 0] },
            { shape: 'icosphere', dimensions: { radius: 0.35, subdivisions: 1 }, color: ICE_CRYSTAL, position: [0, 2.2, 0], emissive: 0.6 },
        ],
        [{ type: 'ice', emitRate: 8, color1: [0.6, 0.85, 1, 0.5], color2: [0.4, 0.7, 1, 0.3], minSize: 0.08, maxSize: 0.18, minLifeTime: 0.5, maxLifeTime: 1.0, offsetY: 2.0 }]),
        upgradePaths: ['absoluteZero_t5'],
        parentId: 'glacierMonolith',
        projectileColor: [0.55, 0.80, 1.00],
        statusEffect: { effect: StatusEffect.SLOWED, duration: 2.5, strength: 0.5, chance: 1.0 },
    },

    // ===== TIER 4 — Tidal path =====
    {
        id: 'tidalShrine',
        name: 'Tidal Shrine',
        description: 'Ocean magic that pulls and damages groups of enemies.',
        tier: 4, tree: 'elemental', category: 'tidal',
        stats: { damage: 12, range: 6, fireRate: 1.2, cost: 150 },
        ability: { name: 'Undertow', type: 'active_auto', cooldown: 5, effect: { kind: 'whirlpool', radius: 4, duration: 2, slow: 0.4, dps: 5 }, description: 'Every 5s, creates a whirlpool slowing and damaging enemies' },
        visual: elementalVisual(1.8, 1.2, [0.18, 0.40, 0.65], [
            { shape: 'cylinder', dimensions: { diameter: 1.0, height: 1.0, tessellation: 8 }, color: TIDAL, position: [0, 0.8, 0] },
            { shape: 'disc', dimensions: { radius: 0.6, tessellation: 16 }, color: [0.30, 0.60, 0.90], position: [0, 1.4, 0], rotation: [Math.PI/2, 0, 0], emissive: 0.3 },
            { shape: 'sphere', dimensions: { diameter: 0.3, tessellation: 6 }, color: [0.40, 0.75, 0.95], position: [0, 1.7, 0], emissive: 0.5 },
        ]),
        upgradePaths: ['leviathanMaw_t5'],
        parentId: 'glacierMonolith',
        projectileColor: [0.25, 0.60, 0.95],
        statusEffect: { effect: StatusEffect.SLOWED, duration: 2, strength: 0.35, chance: 0.8 },
    },

    // ===== TIER 4 — Thornweald path =====
    {
        id: 'thornwealdBastion',
        name: 'Thornweald Bastion',
        description: 'Living thorn fortress that poisons and slows enemies.',
        tier: 4, tree: 'elemental', category: 'nature',
        stats: { damage: 10, range: 5, fireRate: 1.3, cost: 150 },
        ability: { name: 'Thorn Field', type: 'active_auto', cooldown: 4, effect: { kind: 'thornAura', radius: 4, dps: 4, slow: 0.3 }, description: 'Thorns slow and damage enemies in radius' },
        visual: elementalVisual(2.0, 1.2, [0.35, 0.28, 0.15], [
            { shape: 'cylinder', dimensions: { diameter: 1.0, height: 1.2, tessellation: 6 }, color: NATURE_GREEN, position: [0, 1.0, 0] },
            { shape: 'cone', dimensions: { diameter: 0.3, height: 0.5, tessellation: 4 }, color: THORN, position: [0.4, 1.5, 0] },
            { shape: 'cone', dimensions: { diameter: 0.3, height: 0.5, tessellation: 4 }, color: THORN, position: [-0.3, 1.4, 0.3] },
            { shape: 'sphere', dimensions: { diameter: 0.3, tessellation: 6 }, color: [0.35, 0.75, 0.25], position: [0, 1.9, 0], emissive: 0.4 },
        ]),
        upgradePaths: ['worldTreeSapling_t5'],
        parentId: 'verdantTotem',
        projectileColor: [0.35, 0.65, 0.25],
        statusEffect: { effect: StatusEffect.SLOWED, duration: 2, strength: 0.3, chance: 0.7 },
    },

    // ===== TIER 4 — Shadowgrove path =====
    {
        id: 'shadowgroveSpire',
        name: 'Shadowgrove Spire',
        description: 'Dark nature magic that curses enemies, increasing damage taken.',
        tier: 4, tree: 'elemental', category: 'shadow',
        stats: { damage: 12, range: 7, fireRate: 1.0, cost: 150 },
        ability: { name: 'Shadow Curse', type: 'passive', cooldown: 0, effect: { kind: 'shadowCurse', damageAmpPerStack: 0.08, maxStacks: 5, duration: 5 }, description: 'Cursed enemies take +8% damage per stack (max 5)' },
        visual: elementalVisual(2.2, 0.9, SHADOW_PURPLE, [
            { shape: 'cylinder', dimensions: { diameter: 0.7, height: 1.4, tessellation: 6 }, color: [0.28, 0.12, 0.38], position: [0, 1.1, 0] },
            { shape: 'sphere', dimensions: { diameter: 0.3, tessellation: 6 }, color: [0.55, 0.20, 0.70], position: [0, 2.0, 0], emissive: 0.6 },
        ],
        [{ type: 'shadow', emitRate: 4, color1: [0.4, 0.1, 0.6, 0.4], color2: [0.25, 0.05, 0.4, 0.2], minSize: 0.05, maxSize: 0.12, minLifeTime: 0.5, maxLifeTime: 1.0, offsetY: 1.8 }]),
        upgradePaths: ['voidSentinel_t5'],
        parentId: 'verdantTotem',
        projectileColor: [0.45, 0.15, 0.60],
    },

    // ===== TIER 5-8 — Infernal Bastion line (AoE Burn King) =====
    {
        id: 'infernalBastion_t5',
        name: 'Infernal Bastion',
        description: 'A fortress of living flame.',
        tier: 5, tree: 'elemental', category: 'fire',
        stats: { damage: 22, range: 5, fireRate: 1.6, cost: 200 },
        ability: { name: 'Infernal Blaze', type: 'passive', cooldown: 0, effect: { kind: 'burnDoT', dps: 8, duration: 3 }, description: '8 DPS burn for 3s' },
        visual: elementalVisual(2.6, 1.3, OBSIDIAN, [
            { shape: 'cone', dimensions: { diameter: 1.5, height: 1.3, tessellation: 6 }, color: EMBER, position: [0, 1.6, 0] },
            { shape: 'sphere', dimensions: { diameter: 0.5, tessellation: 8 }, color: FIRE_GLOW, position: [0, 2.6, 0], emissive: 0.8 },
        ],
        [{ type: 'fire', emitRate: 15, color1: [1, 0.5, 0.1, 0.8], color2: [1, 0.25, 0, 0.5], minSize: 0.1, maxSize: 0.3, minLifeTime: 0.3, maxLifeTime: 0.8, offsetY: 2.2 }]),
        upgradePaths: ['infernalBastion_t6'],
        parentId: 'hellfireCitadel',
        projectileColor: [1.0, 0.35, 0.0],
        statusEffect: { effect: StatusEffect.BURNING, duration: 3, strength: 8, chance: 1.0 },
    },
    {
        id: 'infernalBastion_t6',
        name: 'Infernal Fortress',
        tier: 6, tree: 'elemental', category: 'fire', description: 'A raging inferno fortress.',
        stats: { damage: 28, range: 6, fireRate: 1.7, cost: 275 },
        ability: { name: 'Firestorm', type: 'passive', cooldown: 0, effect: { kind: 'burnDoT', dps: 10, duration: 3.5 }, description: '10 DPS burn for 3.5s' },
        visual: elementalVisual(2.8, 1.4, OBSIDIAN, [
            { shape: 'cone', dimensions: { diameter: 1.6, height: 1.4, tessellation: 6 }, color: EMBER, position: [0, 1.7, 0] },
            { shape: 'sphere', dimensions: { diameter: 0.55, tessellation: 8 }, color: FIRE_GLOW, position: [0, 2.8, 0], emissive: 0.85 },
        ],
        [{ type: 'fire', emitRate: 18, color1: [1, 0.5, 0.1, 0.8], color2: [1, 0.2, 0, 0.5], minSize: 0.12, maxSize: 0.35, minLifeTime: 0.3, maxLifeTime: 0.9, offsetY: 2.4 }]),
        upgradePaths: ['infernalBastion_t7'],
        parentId: 'infernalBastion_t5',
        projectileColor: [1.0, 0.30, 0.0],
        statusEffect: { effect: StatusEffect.BURNING, duration: 3.5, strength: 10, chance: 1.0 },
    },
    {
        id: 'infernalBastion_t7',
        name: 'Infernal Citadel',
        tier: 7, tree: 'elemental', category: 'fire', description: 'Hellfire incarnate.',
        stats: { damage: 36, range: 6, fireRate: 1.8, cost: 375 },
        ability: { name: 'Cataclysm', type: 'passive', cooldown: 0, effect: { kind: 'burnDoT', dps: 14, duration: 4 }, description: '14 DPS burn for 4s' },
        visual: elementalVisual(3.0, 1.5, OBSIDIAN, [
            { shape: 'cone', dimensions: { diameter: 1.7, height: 1.5, tessellation: 6 }, color: EMBER, position: [0, 1.8, 0] },
            { shape: 'sphere', dimensions: { diameter: 0.6, tessellation: 8 }, color: [1.0, 0.6, 0.15], position: [0, 3.0, 0], emissive: 0.9 },
        ],
        [{ type: 'fire', emitRate: 22, color1: [1, 0.5, 0.1, 0.9], color2: [1, 0.2, 0, 0.6], minSize: 0.15, maxSize: 0.4, minLifeTime: 0.3, maxLifeTime: 1.0, offsetY: 2.6 }]),
        upgradePaths: ['infernalBastion_t8'],
        parentId: 'infernalBastion_t6',
        projectileColor: [1.0, 0.25, 0.0],
        statusEffect: { effect: StatusEffect.BURNING, duration: 4, strength: 14, chance: 1.0 },
    },
    {
        id: 'infernalBastion_t8',
        name: 'Infernal Bastion',
        tier: 8, tree: 'elemental', category: 'fire', description: 'The ultimate fire tower. AoE burn king.',
        stats: { damage: 45, range: 7, fireRate: 2.0, cost: 500 },
        ability: { name: 'Apocalypse', type: 'active_auto', cooldown: 6, effect: { kind: 'eruption', radius: 5, damage: 50, burnDps: 18, burnDuration: 4 }, description: 'Every 6s, eruption deals 50 damage + 18 DPS burn in radius 5' },
        visual: elementalVisual(3.4, 1.6, OBSIDIAN, [
            { shape: 'cone', dimensions: { diameter: 1.8, height: 1.8, tessellation: 6 }, color: EMBER, position: [0, 2.0, 0] },
            { shape: 'sphere', dimensions: { diameter: 0.7, tessellation: 8 }, color: [1.0, 0.65, 0.2], position: [0, 3.2, 0], emissive: 1.0 },
            { shape: 'torus', dimensions: { diameter: 1.8, thickness: 0.08, tessellation: 16 }, color: FIRE_GLOW, position: [0, 0.5, 0], emissive: 0.5 },
        ],
        [{ type: 'fire', emitRate: 30, color1: [1, 0.5, 0.1, 1.0], color2: [1, 0.15, 0, 0.7], minSize: 0.15, maxSize: 0.5, minLifeTime: 0.3, maxLifeTime: 1.2, offsetY: 2.8 }]),
        upgradePaths: [],
        parentId: 'infernalBastion_t7',
        projectileColor: [1.0, 0.20, 0.0],
        statusEffect: { effect: StatusEffect.BURNING, duration: 4, strength: 18, chance: 1.0 },
    },

    // ===== TIER 5-8 — Dwarven Hellforge (Rapid Fire Burn) =====
    ...generateLinearLine('dwarvenHellforge', 'Dwarven Hellforge', 'ember', 'emberForge',
        [
            { tier: 5, damage: 14, range: 5, fireRate: 2.8, cost: 200, burnDps: 4, burnDur: 2 },
            { tier: 6, damage: 18, range: 6, fireRate: 3.2, cost: 275, burnDps: 5, burnDur: 2.5 },
            { tier: 7, damage: 22, range: 6, fireRate: 3.6, cost: 375, burnDps: 7, burnDur: 3 },
            { tier: 8, damage: 28, range: 7, fireRate: 4.0, cost: 500, burnDps: 10, burnDur: 3 },
        ],
        ['Forge Tower', 'Forge Citadel', 'Forge Bastion', 'Dwarven Hellforge'],
        { effect: StatusEffect.BURNING, chance: 0.9 },
        [1.0, 0.5, 0.15]
    ),

    // ===== TIER 5-8 — Stormcaller Apex (Chain Lightning AoE) =====
    ...generateLightningLine('stormcallerApex', 'Stormcaller Apex', 'lightning', 'tempestObelisk',
        [
            { tier: 5, damage: 20, range: 8, fireRate: 1.1, cost: 200, chains: 4, decay: 0.6 },
            { tier: 6, damage: 26, range: 9, fireRate: 1.1, cost: 275, chains: 5, decay: 0.55 },
            { tier: 7, damage: 34, range: 9, fireRate: 1.2, cost: 375, chains: 6, decay: 0.5 },
            { tier: 8, damage: 44, range: 10, fireRate: 1.2, cost: 500, chains: 8, decay: 0.45 },
        ],
        ['Stormcaller', 'Stormcaller Spire', 'Stormcaller Citadel', 'Stormcaller Apex'],
        [0.75, 0.75, 1.0]
    ),

    // ===== TIER 5-8 — Annihilation Lens (Single Target Boss Killer) =====
    ...generatePlasmaLine('annihilationLens', 'Annihilation Lens', 'plasma', 'plasmaSpire',
        [
            { tier: 5, damage: 45, range: 10, fireRate: 0.6, cost: 200, mult: 2.2, cd: 4.5 },
            { tier: 6, damage: 60, range: 10, fireRate: 0.7, cost: 275, mult: 2.5, cd: 4 },
            { tier: 7, damage: 80, range: 11, fireRate: 0.7, cost: 375, mult: 2.8, cd: 3.5 },
            { tier: 8, damage: 110, range: 12, fireRate: 0.8, cost: 500, mult: 3.0, cd: 3 },
        ],
        ['Plasma Cannon', 'Plasma Fortress', 'Annihilation Spire', 'Annihilation Lens'],
        [0.90, 0.50, 1.00]
    ),

    // ===== TIER 5-8 — Absolute Zero Fortress (CC King) =====
    ...generateFreezeNovaLine('absoluteZero', 'Absolute Zero', 'frost', 'permafrostCitadel',
        [
            { tier: 5, damage: 18, range: 7, fireRate: 1.0, cost: 200, radius: 5.5, dur: 2.5, amp: 0.3 },
            { tier: 6, damage: 22, range: 7, fireRate: 1.0, cost: 275, radius: 6, dur: 2.8, amp: 0.35 },
            { tier: 7, damage: 28, range: 8, fireRate: 1.0, cost: 375, radius: 6.5, dur: 3.0, amp: 0.4 },
            { tier: 8, damage: 35, range: 8, fireRate: 1.1, cost: 500, radius: 7, dur: 3.5, amp: 0.5 },
        ],
        ['Cryocore', 'Cryocore Citadel', 'Cryocore Bastion', 'Absolute Zero Fortress'],
        [0.50, 0.80, 1.00]
    ),

    // ===== TIER 5-8 — Leviathan's Maw (AoE + Pull) =====
    ...generateWhirlpoolLine('leviathanMaw', "Leviathan's Maw", 'tidal', 'tidalShrine',
        [
            { tier: 5, damage: 15, range: 6, fireRate: 1.2, cost: 200, radius: 4.5, dur: 2.5, slow: 0.45, dps: 7 },
            { tier: 6, damage: 20, range: 7, fireRate: 1.3, cost: 275, radius: 5, dur: 3, slow: 0.5, dps: 10 },
            { tier: 7, damage: 26, range: 7, fireRate: 1.3, cost: 375, radius: 5.5, dur: 3, slow: 0.55, dps: 14 },
            { tier: 8, damage: 34, range: 8, fireRate: 1.4, cost: 500, radius: 6, dur: 3.5, slow: 0.6, dps: 18 },
        ],
        ['Tidal Bastion', 'Tidal Fortress', 'Leviathan Spire', "Leviathan's Maw"],
        [0.25, 0.60, 0.95]
    ),

    // ===== TIER 5-8 — World Tree Sapling (Area Denial) =====
    ...generateThornLine('worldTreeSapling', 'World Tree Sapling', 'nature', 'thornwealdBastion',
        [
            { tier: 5, damage: 12, range: 5, fireRate: 1.4, cost: 200, radius: 4.5, dps: 6, slow: 0.35 },
            { tier: 6, damage: 16, range: 6, fireRate: 1.5, cost: 275, radius: 5, dps: 9, slow: 0.4 },
            { tier: 7, damage: 20, range: 6, fireRate: 1.6, cost: 375, radius: 5.5, dps: 12, slow: 0.45 },
            { tier: 8, damage: 26, range: 7, fireRate: 1.7, cost: 500, radius: 6, dps: 16, slow: 0.5 },
        ],
        ['Deeproot Tower', 'Deeproot Bastion', 'Ancient Tree', 'World Tree Sapling'],
        [0.30, 0.70, 0.25]
    ),

    // ===== TIER 5-8 — Void Sentinel (Debuff + Execute) =====
    ...generateShadowLine('voidSentinel', 'Void Sentinel', 'shadow', 'shadowgroveSpire',
        [
            { tier: 5, damage: 16, range: 7, fireRate: 1.0, cost: 200, ampPerStack: 0.10, maxStacks: 6, dur: 5 },
            { tier: 6, damage: 20, range: 8, fireRate: 1.1, cost: 275, ampPerStack: 0.12, maxStacks: 7, dur: 6 },
            { tier: 7, damage: 26, range: 8, fireRate: 1.1, cost: 375, ampPerStack: 0.14, maxStacks: 8, dur: 7 },
            { tier: 8, damage: 35, range: 9, fireRate: 1.2, cost: 500, ampPerStack: 0.18, maxStacks: 10, dur: 8 },
        ],
        ['Shadow Spire', 'Shadow Citadel', 'Void Tower', 'Void Sentinel'],
        [0.40, 0.12, 0.55]
    ),
];

// ===== Helper generators for linear T5-T8 lines =====

function generateLinearLine(
    prefix: string, _finalName: string, category: string, parentId: string,
    tiers: { tier: number; damage: number; range: number; fireRate: number; cost: number; burnDps: number; burnDur: number }[],
    names: string[], status: { effect: StatusEffect; chance: number }, projColor: [number, number, number]
): TowerDefinition[] {
    return tiers.map((t, i) => {
        const id = `${prefix}_t${t.tier}`;
        const nextId = i < tiers.length - 1 ? `${prefix}_t${tiers[i + 1].tier}` : undefined;
        const parent = i === 0 ? parentId : `${prefix}_t${tiers[i - 1].tier}`;
        const heightScale = 1.8 + t.tier * 0.25;
        return {
            id, name: names[i],
            description: `${names[i]} — Tier ${t.tier} rapid burn tower.`,
            tier: t.tier, tree: 'elemental' as const, category,
            stats: { damage: t.damage, range: t.range, fireRate: t.fireRate, cost: t.cost },
            ability: { name: `${names[i]} Burn`, type: 'passive' as const, cooldown: 0, effect: { kind: 'burnDoT' as const, dps: t.burnDps, duration: t.burnDur }, description: `${t.burnDps} DPS burn for ${t.burnDur}s` },
            visual: elementalVisual(heightScale, 1.2 + t.tier * 0.05, [0.35, 0.20, 0.10], [
                { shape: 'box' as const, dimensions: { width: 1.0, height: 0.8 + t.tier * 0.1, depth: 1.0 }, color: [0.45, 0.25, 0.12] as [number,number,number], position: [0, heightScale * 0.4, 0] as [number,number,number] },
                { shape: 'sphere' as const, dimensions: { diameter: 0.3 + t.tier * 0.03, tessellation: 6 }, color: FIRE_GLOW, position: [0, heightScale * 0.75, 0] as [number,number,number], emissive: 0.5 + t.tier * 0.05 },
            ],
            [{ type: 'fire' as const, emitRate: 5 + t.tier * 2, color1: [1, 0.6, 0.2, 0.5] as [number,number,number,number], color2: [0.9, 0.3, 0.1, 0.3] as [number,number,number,number], minSize: 0.04, maxSize: 0.12, minLifeTime: 0.3, maxLifeTime: 0.6, offsetY: heightScale * 0.7 }]),
            upgradePaths: nextId ? [nextId] : [],
            parentId: parent,
            projectileColor: projColor,
            statusEffect: { effect: status.effect, duration: t.burnDur, strength: t.burnDps, chance: status.chance },
        };
    });
}

function generateLightningLine(
    prefix: string, _finalName: string, category: string, parentId: string,
    tiers: { tier: number; damage: number; range: number; fireRate: number; cost: number; chains: number; decay: number }[],
    names: string[], projColor: [number, number, number]
): TowerDefinition[] {
    return tiers.map((t, i) => {
        const id = `${prefix}_t${t.tier}`;
        const nextId = i < tiers.length - 1 ? `${prefix}_t${tiers[i + 1].tier}` : undefined;
        const parent = i === 0 ? parentId : `${prefix}_t${tiers[i - 1].tier}`;
        const heightScale = 2.2 + t.tier * 0.25;
        return {
            id, name: names[i],
            description: `${names[i]} — Tier ${t.tier} chain lightning tower.`,
            tier: t.tier, tree: 'elemental' as const, category,
            stats: { damage: t.damage, range: t.range, fireRate: t.fireRate, cost: t.cost },
            ability: { name: `${names[i]} Storm`, type: 'passive' as const, cooldown: 0, effect: { kind: 'chainLightning' as const, chains: t.chains, damageDecay: t.decay, chainRange: 5 + t.tier * 0.3 }, description: `Lightning chains to ${t.chains} enemies` },
            visual: elementalVisual(heightScale, 0.8 + t.tier * 0.05, STORM_DARK, [
                { shape: 'cylinder' as const, dimensions: { diameter: 0.5 + t.tier * 0.03, height: heightScale * 0.6, tessellation: 6 }, color: [0.28, 0.28, 0.42] as [number,number,number], position: [0, heightScale * 0.35, 0] as [number,number,number] },
                { shape: 'sphere' as const, dimensions: { diameter: 0.3 + t.tier * 0.04, tessellation: 6 }, color: LIGHTNING, position: [0, heightScale * 0.85, 0] as [number,number,number], emissive: 0.7 + t.tier * 0.03 },
            ],
            [{ type: 'lightning' as const, emitRate: 5 + t.tier * 2, color1: [0.7, 0.7, 1, 0.6] as [number,number,number,number], color2: [0.5, 0.5, 0.9, 0.3] as [number,number,number,number], minSize: 0.04, maxSize: 0.1, minLifeTime: 0.2, maxLifeTime: 0.5, offsetY: heightScale * 0.8 }]),
            upgradePaths: nextId ? [nextId] : [],
            parentId: parent,
            projectileColor: projColor,
            statusEffect: { effect: StatusEffect.STUNNED, duration: 0.3 + t.tier * 0.02, strength: 1.0, chance: 0.15 + t.tier * 0.02 },
        };
    });
}

function generatePlasmaLine(
    prefix: string, _finalName: string, category: string, parentId: string,
    tiers: { tier: number; damage: number; range: number; fireRate: number; cost: number; mult: number; cd: number }[],
    names: string[], projColor: [number, number, number]
): TowerDefinition[] {
    return tiers.map((t, i) => {
        const id = `${prefix}_t${t.tier}`;
        const nextId = i < tiers.length - 1 ? `${prefix}_t${tiers[i + 1].tier}` : undefined;
        const parent = i === 0 ? parentId : `${prefix}_t${tiers[i - 1].tier}`;
        const heightScale = 2.0 + t.tier * 0.3;
        return {
            id, name: names[i],
            description: `${names[i]} — Tier ${t.tier} plasma boss killer.`,
            tier: t.tier, tree: 'elemental' as const, category,
            stats: { damage: t.damage, range: t.range, fireRate: t.fireRate, cost: t.cost },
            ability: { name: `${names[i]} Beam`, type: 'passive' as const, cooldown: 0, effect: { kind: 'overcharge' as const, damageMultiplier: t.mult, duration: 0.5, cooldown: t.cd }, description: `Every ${t.cd}s, next shot deals ${t.mult}x damage` },
            visual: elementalVisual(heightScale, 0.7 + t.tier * 0.05, STORM_DARK, [
                { shape: 'cylinder' as const, dimensions: { diameter: 0.5, height: heightScale * 0.6, tessellation: 6 }, color: [0.30, 0.25, 0.40] as [number,number,number], position: [0, heightScale * 0.35, 0] as [number,number,number] },
                { shape: 'sphere' as const, dimensions: { diameter: 0.3 + t.tier * 0.04, tessellation: 6 }, color: PLASMA, position: [0, heightScale * 0.85, 0] as [number,number,number], emissive: 0.7 + t.tier * 0.04 },
            ],
            [{ type: 'lightning' as const, emitRate: 3 + t.tier, color1: [0.9, 0.5, 1, 0.5] as [number,number,number,number], color2: [0.7, 0.3, 0.9, 0.3] as [number,number,number,number], minSize: 0.04, maxSize: 0.1, minLifeTime: 0.3, maxLifeTime: 0.6, offsetY: heightScale * 0.8 }]),
            upgradePaths: nextId ? [nextId] : [],
            parentId: parent,
            projectileColor: projColor,
        };
    });
}

function generateFreezeNovaLine(
    prefix: string, _finalName: string, category: string, parentId: string,
    tiers: { tier: number; damage: number; range: number; fireRate: number; cost: number; radius: number; dur: number; amp: number }[],
    names: string[], projColor: [number, number, number]
): TowerDefinition[] {
    return tiers.map((t, i) => {
        const id = `${prefix}_t${t.tier}`;
        const nextId = i < tiers.length - 1 ? `${prefix}_t${tiers[i + 1].tier}` : undefined;
        const parent = i === 0 ? parentId : `${prefix}_t${tiers[i - 1].tier}`;
        const heightScale = 2.0 + t.tier * 0.3;
        return {
            id, name: names[i],
            description: `${names[i]} — Tier ${t.tier} CC frost tower.`,
            tier: t.tier, tree: 'elemental' as const, category,
            stats: { damage: t.damage, range: t.range, fireRate: t.fireRate, cost: t.cost },
            ability: { name: `${names[i]} Nova`, type: 'active_auto' as const, cooldown: 6, effect: { kind: 'freezeNova' as const, radius: t.radius, duration: t.dur, damageAmp: t.amp }, description: `Every 6s, freeze enemies in radius ${t.radius} for ${t.dur}s` },
            visual: elementalVisual(heightScale, 1.0 + t.tier * 0.08, ICE_DEEP, [
                { shape: 'box' as const, dimensions: { width: 0.8 + t.tier * 0.05, height: heightScale * 0.6, depth: 0.8 + t.tier * 0.05 }, color: ICE_BLUE, position: [0, heightScale * 0.35, 0] as [number,number,number] },
                { shape: 'icosphere' as const, dimensions: { radius: 0.3 + t.tier * 0.03, subdivisions: 1 }, color: ICE_CRYSTAL, position: [0, heightScale * 0.85, 0] as [number,number,number], emissive: 0.5 + t.tier * 0.05 },
            ],
            [{ type: 'ice' as const, emitRate: 5 + t.tier * 2, color1: [0.6, 0.85, 1, 0.5] as [number,number,number,number], color2: [0.4, 0.7, 1, 0.3] as [number,number,number,number], minSize: 0.06, maxSize: 0.15, minLifeTime: 0.5, maxLifeTime: 1.0, offsetY: heightScale * 0.8 }]),
            upgradePaths: nextId ? [nextId] : [],
            parentId: parent,
            projectileColor: projColor,
            statusEffect: { effect: StatusEffect.SLOWED, duration: t.dur, strength: 0.5 + t.tier * 0.03, chance: 1.0 },
        };
    });
}

function generateWhirlpoolLine(
    prefix: string, _finalName: string, category: string, parentId: string,
    tiers: { tier: number; damage: number; range: number; fireRate: number; cost: number; radius: number; dur: number; slow: number; dps: number }[],
    names: string[], projColor: [number, number, number]
): TowerDefinition[] {
    return tiers.map((t, i) => {
        const id = `${prefix}_t${t.tier}`;
        const nextId = i < tiers.length - 1 ? `${prefix}_t${tiers[i + 1].tier}` : undefined;
        const parent = i === 0 ? parentId : `${prefix}_t${tiers[i - 1].tier}`;
        const heightScale = 1.8 + t.tier * 0.25;
        return {
            id, name: names[i],
            description: `${names[i]} — Tier ${t.tier} tidal tower.`,
            tier: t.tier, tree: 'elemental' as const, category,
            stats: { damage: t.damage, range: t.range, fireRate: t.fireRate, cost: t.cost },
            ability: { name: `${names[i]} Tide`, type: 'active_auto' as const, cooldown: 5, effect: { kind: 'whirlpool' as const, radius: t.radius, duration: t.dur, slow: t.slow, dps: t.dps }, description: `Every 5s, whirlpool: ${t.slow * 100}% slow + ${t.dps} DPS in radius ${t.radius}` },
            visual: elementalVisual(heightScale, 1.2 + t.tier * 0.05, [0.18, 0.40, 0.65] as [number,number,number], [
                { shape: 'cylinder' as const, dimensions: { diameter: 1.0 + t.tier * 0.05, height: heightScale * 0.5, tessellation: 8 }, color: TIDAL, position: [0, heightScale * 0.3, 0] as [number,number,number] },
                { shape: 'sphere' as const, dimensions: { diameter: 0.3 + t.tier * 0.03, tessellation: 6 }, color: [0.40, 0.75, 0.95] as [number,number,number], position: [0, heightScale * 0.8, 0] as [number,number,number], emissive: 0.5 + t.tier * 0.04 },
            ]),
            upgradePaths: nextId ? [nextId] : [],
            parentId: parent,
            projectileColor: projColor,
            statusEffect: { effect: StatusEffect.SLOWED, duration: t.dur, strength: t.slow, chance: 0.8 },
        };
    });
}

function generateThornLine(
    prefix: string, _finalName: string, category: string, parentId: string,
    tiers: { tier: number; damage: number; range: number; fireRate: number; cost: number; radius: number; dps: number; slow: number }[],
    names: string[], projColor: [number, number, number]
): TowerDefinition[] {
    return tiers.map((t, i) => {
        const id = `${prefix}_t${t.tier}`;
        const nextId = i < tiers.length - 1 ? `${prefix}_t${tiers[i + 1].tier}` : undefined;
        const parent = i === 0 ? parentId : `${prefix}_t${tiers[i - 1].tier}`;
        const heightScale = 1.8 + t.tier * 0.3;
        return {
            id, name: names[i],
            description: `${names[i]} — Tier ${t.tier} nature area denial tower.`,
            tier: t.tier, tree: 'elemental' as const, category,
            stats: { damage: t.damage, range: t.range, fireRate: t.fireRate, cost: t.cost },
            ability: { name: `${names[i]} Thorns`, type: 'active_auto' as const, cooldown: 3, effect: { kind: 'thornAura' as const, radius: t.radius, dps: t.dps, slow: t.slow }, description: `Thorn aura: ${t.dps} DPS + ${t.slow * 100}% slow in radius ${t.radius}` },
            visual: elementalVisual(heightScale, 1.0 + t.tier * 0.08, [0.35, 0.28, 0.15] as [number,number,number], [
                { shape: 'cylinder' as const, dimensions: { diameter: 0.9 + t.tier * 0.06, height: heightScale * 0.6, tessellation: 6 }, color: NATURE_GREEN, position: [0, heightScale * 0.35, 0] as [number,number,number] },
                { shape: 'cone' as const, dimensions: { diameter: 0.3, height: 0.4 + t.tier * 0.05, tessellation: 4 }, color: THORN, position: [0.35, heightScale * 0.6, 0] as [number,number,number] },
                { shape: 'sphere' as const, dimensions: { diameter: 0.25 + t.tier * 0.03, tessellation: 6 }, color: [0.35, 0.75, 0.25] as [number,number,number], position: [0, heightScale * 0.85, 0] as [number,number,number], emissive: 0.4 + t.tier * 0.05 },
            ],
            [{ type: 'nature' as const, emitRate: 3 + t.tier, color1: [0.3, 0.7, 0.2, 0.4] as [number,number,number,number], color2: [0.2, 0.5, 0.15, 0.2] as [number,number,number,number], minSize: 0.05, maxSize: 0.12, minLifeTime: 0.5, maxLifeTime: 1.2, offsetY: heightScale * 0.7 }]),
            upgradePaths: nextId ? [nextId] : [],
            parentId: parent,
            projectileColor: projColor,
            statusEffect: { effect: StatusEffect.SLOWED, duration: 2 + t.tier * 0.1, strength: t.slow, chance: 0.7 },
        };
    });
}

function generateShadowLine(
    prefix: string, _finalName: string, category: string, parentId: string,
    tiers: { tier: number; damage: number; range: number; fireRate: number; cost: number; ampPerStack: number; maxStacks: number; dur: number }[],
    names: string[], projColor: [number, number, number]
): TowerDefinition[] {
    return tiers.map((t, i) => {
        const id = `${prefix}_t${t.tier}`;
        const nextId = i < tiers.length - 1 ? `${prefix}_t${tiers[i + 1].tier}` : undefined;
        const parent = i === 0 ? parentId : `${prefix}_t${tiers[i - 1].tier}`;
        const heightScale = 2.0 + t.tier * 0.3;
        return {
            id, name: names[i],
            description: `${names[i]} — Tier ${t.tier} shadow debuff tower.`,
            tier: t.tier, tree: 'elemental' as const, category,
            stats: { damage: t.damage, range: t.range, fireRate: t.fireRate, cost: t.cost },
            ability: { name: `${names[i]} Curse`, type: 'passive' as const, cooldown: 0, effect: { kind: 'shadowCurse' as const, damageAmpPerStack: t.ampPerStack, maxStacks: t.maxStacks, duration: t.dur }, description: `+${(t.ampPerStack * 100).toFixed(0)}% damage taken per stack (max ${t.maxStacks})` },
            visual: elementalVisual(heightScale, 0.9 + t.tier * 0.05, SHADOW_PURPLE, [
                { shape: 'cylinder' as const, dimensions: { diameter: 0.7 + t.tier * 0.03, height: heightScale * 0.6, tessellation: 6 }, color: [0.28, 0.12, 0.38] as [number,number,number], position: [0, heightScale * 0.35, 0] as [number,number,number] },
                { shape: 'sphere' as const, dimensions: { diameter: 0.25 + t.tier * 0.04, tessellation: 6 }, color: [0.55, 0.20, 0.70] as [number,number,number], position: [0, heightScale * 0.85, 0] as [number,number,number], emissive: 0.6 + t.tier * 0.04 },
            ],
            [{ type: 'shadow' as const, emitRate: 3 + t.tier, color1: [0.4, 0.1, 0.6, 0.4] as [number,number,number,number], color2: [0.25, 0.05, 0.4, 0.2] as [number,number,number,number], minSize: 0.05, maxSize: 0.12, minLifeTime: 0.5, maxLifeTime: 1.0, offsetY: heightScale * 0.8 }]),
            upgradePaths: nextId ? [nextId] : [],
            parentId: parent,
            projectileColor: projColor,
        };
    });
}
