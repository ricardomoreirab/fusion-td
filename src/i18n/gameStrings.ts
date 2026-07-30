/**
 * Localised names for gameplay content.
 *
 * One helper per content category, so a display site calls
 * `powerDisplayName(def.id, def.name)` instead of naming a `tc()` category
 * string. That matters for two reasons: the category strings stay in this file
 * (a typo cannot reach a call site), and every helper takes the DATA TABLE'S OWN
 * English literal as its fallback — which is what makes a power or item added
 * after the last translation pass render in English instead of as a raw key.
 *
 * Deliberately NOT folded into the data tables. `PowerDefinitions`,
 * `ItemCatalog` and `AscensionTrees` are pure data read by gameplay code, some of
 * it in hot paths, and none of it should acquire a dependency on the UI layer's
 * locale. The tables keep their English literal as the canonical id-adjacent
 * name; translation happens where the string is drawn.
 */

import { tc } from './index';

/** A power or fusion, by id. */
export function powerDisplayName(id: string, english: string): string {
    return tc('powerName', id, english);
}

export function powerDisplayDesc(id: string, english: string): string {
    return tc('powerDesc', id, english);
}

/** An equipment item from ItemCatalog. */
export function itemDisplayName(id: string, english: string): string {
    return tc('itemName', id, english);
}

/** A milestone-boss run item (RunItems.ItemId). */
export function runItemDisplayName(id: string, english: string): string {
    return tc('runItemName', id, english);
}

/** An ascension node. */
export function nodeDisplayName(id: string, english: string): string {
    return tc('nodeName', id, english);
}

export function nodeDisplayDesc(id: string, english: string): string {
    return tc('nodeDesc', id, english);
}

/** A manual ultimate / ability, by its id. */
export function ultDisplayName(id: string, english: string): string {
    return tc('ultName', id, english);
}

/** A milestone boss, by TIER — the tier is the identity, and the label is what
 *  the boss health plate shows. Clones append their own suffix at the call site. */
export function bossDisplayName(tier: number, english: string): string {
    return tc('bossName', String(tier), english);
}

/** An enemy archetype, by the type string the spawn path uses. */
export function enemyDisplayName(type: string, english: string): string {
    return tc('enemyName', type, english);
}

/** An element (fire/ice/arcane/physical/storm). */
export function elementDisplayName(element: string, english: string): string {
    return tc('elementName', element, english);
}
