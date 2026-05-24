/**
 * Shared gameplay type enumerations.
 * These were previously defined in towers/Tower.ts.
 * Moved here so enemies, powers, and other systems can import them
 * without depending on the (deleted) tower-placement module.
 */

export enum ElementType {
    NONE = 'none',
    FIRE = 'fire',
    WATER = 'water',
    WIND = 'wind',
    EARTH = 'earth',
}

export enum EnemyType {
    NORMAL = 'normal',
    FIRE = 'fire',
    WATER = 'water',
    WIND = 'wind',
    EARTH = 'earth',
    ICE = 'ice',
    PLANT = 'plant',
    FLYING = 'flying',
    HEAVY = 'heavy',
    LIGHT = 'light',
    ELECTRIC = 'electric',
}

export enum StatusEffect {
    NONE = 'none',
    BURNING = 'burning',
    SLOWED = 'slowed',
    FROZEN = 'frozen',
    STUNNED = 'stunned',
    PUSHED = 'pushed',
    CONFUSED = 'confused',
}
