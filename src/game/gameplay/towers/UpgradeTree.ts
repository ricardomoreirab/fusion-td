/**
 * Upgrade tree traversal, validation, and path lookup utilities.
 */

import { TowerDefinition, getTowerDefinition, getUpgradeOptions, getAllTowerDefinitions } from './TowerDefinitions';

/**
 * Check if upgrading from currentId to targetId is a valid upgrade path.
 */
export function isValidUpgrade(currentId: string, targetId: string): boolean {
    const current = getTowerDefinition(currentId);
    if (!current) return false;
    return current.upgradePaths.includes(targetId);
}

/**
 * Get the full upgrade ancestry chain from a tower back to its tier-1 root.
 */
export function getAncestryChain(towerId: string): TowerDefinition[] {
    const chain: TowerDefinition[] = [];
    let currentId: string | null = towerId;
    while (currentId) {
        const def = getTowerDefinition(currentId);
        if (!def) break;
        chain.unshift(def);
        currentId = def.parentId;
    }
    return chain;
}

/**
 * Calculate total gold invested across all tiers in the ancestry chain.
 */
export function getTotalInvestment(towerId: string): number {
    const chain = getAncestryChain(towerId);
    return chain.reduce((sum, def) => sum + def.stats.cost, 0);
}

/**
 * Calculate sell value (60% of total investment).
 */
export function getSellValue(towerId: string): number {
    return Math.floor(getTotalInvestment(towerId) * 0.6);
}

/**
 * Get the upgrade cost to evolve to a target tower.
 * This is the target tower's cost (the incremental cost to upgrade).
 */
export function getUpgradeCost(targetId: string): number {
    const target = getTowerDefinition(targetId);
    return target ? target.stats.cost : 0;
}

/**
 * Get all possible end-game (tier 8) towers reachable from a given tower.
 */
export function getEndGamePaths(towerId: string): TowerDefinition[] {
    const results: TowerDefinition[] = [];
    const def = getTowerDefinition(towerId);
    if (!def) return results;

    if (def.tier === 8) {
        results.push(def);
        return results;
    }

    for (const upgradeId of def.upgradePaths) {
        results.push(...getEndGamePaths(upgradeId));
    }
    return results;
}

/**
 * Get the full tree structure for a given root tower (tier 1).
 * Returns a tree node with children.
 */
export interface TreeNode {
    definition: TowerDefinition;
    children: TreeNode[];
}

export function buildTree(rootId: string): TreeNode | null {
    const def = getTowerDefinition(rootId);
    if (!def) return null;
    return {
        definition: def,
        children: def.upgradePaths.map(id => buildTree(id)).filter((n): n is TreeNode => n !== null)
    };
}

/**
 * Get a flat list of all towers in a subtree.
 */
export function flattenTree(node: TreeNode): TowerDefinition[] {
    const result = [node.definition];
    for (const child of node.children) {
        result.push(...flattenTree(child));
    }
    return result;
}

/**
 * Find the category path label for display (e.g., "Precision > Marksman > Hawkeye").
 */
export function getCategoryPath(towerId: string): string {
    const chain = getAncestryChain(towerId);
    return chain.map(d => d.name).join(' > ');
}
