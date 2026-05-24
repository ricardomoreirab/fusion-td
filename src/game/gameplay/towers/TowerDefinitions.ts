/**
 * Data-driven tower definition system.
 * Every tower in the game is defined as config data rather than a separate class.
 */

import { AbilityDefinition } from './abilities/TowerAbility';
import { StatusEffect } from './Tower';

export type TowerTree = 'medieval' | 'elemental';

export interface TowerVisualComponent {
    shape: 'cylinder' | 'box' | 'cone' | 'sphere' | 'torus' | 'icosphere' | 'disc';
    dimensions: { width?: number; height?: number; depth?: number; diameter?: number; radius?: number; tessellation?: number; thickness?: number; subdivisions?: number };
    color: [number, number, number];
    emissive?: number; // emissive strength (0 = no emissive)
    position: [number, number, number];
    rotation?: [number, number, number];
    scale?: [number, number, number];
    flatShaded?: boolean;
}

export interface TowerParticleConfig {
    type: 'ambient' | 'fire' | 'ice' | 'lightning' | 'nature' | 'shadow';
    emitRate: number;
    color1: [number, number, number, number];
    color2: [number, number, number, number];
    minSize: number;
    maxSize: number;
    minLifeTime: number;
    maxLifeTime: number;
    offsetY?: number;
}

export interface TowerAnimationConfig {
    type: 'rotate' | 'pulse' | 'bob';
    speed: number;
    amplitude?: number;
    componentIndex?: number; // which component to animate
}

export interface TowerVisualDefinition {
    baseShape: 'cylinder' | 'box' | 'cone';
    baseDimensions: { width: number; height: number; depth?: number; tessellation?: number };
    baseColor: [number, number, number];
    components: TowerVisualComponent[];
    particles?: TowerParticleConfig[];
    animations?: TowerAnimationConfig[];
}

export interface TowerDefinition {
    id: string;
    name: string;
    description: string;
    tier: number; // 1-8
    tree: TowerTree;
    category: string; // 'precision', 'rapidfire', 'support', etc.
    stats: {
        damage: number;
        range: number;
        fireRate: number;
        cost: number;
    };
    ability: AbilityDefinition;
    visual: TowerVisualDefinition;
    upgradePaths: string[]; // IDs of towers this can upgrade to (0-2 options)
    parentId: string | null; // ID of previous tier tower
    projectileColor: [number, number, number];
    statusEffect?: {
        effect: StatusEffect;
        duration: number;
        strength: number;
        chance: number; // 0-1
    };
}

// Master registry of all tower definitions
const towerRegistry: Map<string, TowerDefinition> = new Map();

export function registerTowerDefinitions(defs: TowerDefinition[]): void {
    for (const def of defs) {
        towerRegistry.set(def.id, def);
    }
}

export function getTowerDefinition(id: string): TowerDefinition | undefined {
    return towerRegistry.get(id);
}

export function getAllTowerDefinitions(): TowerDefinition[] {
    return Array.from(towerRegistry.values());
}

export function getTowersByTree(tree: TowerTree): TowerDefinition[] {
    return getAllTowerDefinitions().filter(d => d.tree === tree);
}

export function getTowersByTier(tier: number): TowerDefinition[] {
    return getAllTowerDefinitions().filter(d => d.tier === tier);
}

export function getBaseTowers(): TowerDefinition[] {
    return getAllTowerDefinitions().filter(d => d.tier === 1);
}

export function getUpgradeOptions(towerId: string): TowerDefinition[] {
    const def = getTowerDefinition(towerId);
    if (!def) return [];
    return def.upgradePaths
        .map(id => getTowerDefinition(id))
        .filter((d): d is TowerDefinition => d !== undefined);
}
