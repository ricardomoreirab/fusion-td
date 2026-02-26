import { Color3, Color4 } from '@babylonjs/core';

/**
 * Warm, saturated color palette for the low-poly stylized aesthetic.
 * All colors used across the entire game should reference this palette.
 */
export const PALETTE = {
    // Scene
    SKY: new Color4(0.55, 0.78, 0.95, 1),
    FOG: new Color3(0.55, 0.78, 0.95),

    // Lighting
    LIGHT_DIFFUSE: new Color3(1.0, 0.95, 0.88),
    LIGHT_GROUND: new Color3(0.45, 0.38, 0.32),

    // Terrain
    GROUND: new Color3(0.42, 0.65, 0.32),
    PATH: new Color3(0.82, 0.72, 0.55),
    PATH_BORDER: new Color3(0.65, 0.55, 0.40),

    // Decorations
    TREE_TRUNK: new Color3(0.55, 0.35, 0.18),
    TREE_FOLIAGE: new Color3(0.22, 0.58, 0.22),
    TREE_FOLIAGE_DARK: new Color3(0.18, 0.48, 0.18),
    ROCK: new Color3(0.58, 0.55, 0.52),
    ROCK_DARK: new Color3(0.45, 0.42, 0.40),
    BUSH: new Color3(0.30, 0.62, 0.28),
    FLOWER_STEM: new Color3(0.28, 0.52, 0.22),
    FLOWER_PETAL_RED: new Color3(0.90, 0.25, 0.25),
    FLOWER_PETAL_YELLOW: new Color3(0.95, 0.85, 0.25),
    FLOWER_PETAL_PURPLE: new Color3(0.65, 0.28, 0.82),

    // Portals
    PORTAL_START: new Color3(0.15, 0.85, 0.35),
    PORTAL_END: new Color3(0.90, 0.20, 0.20),

    // Towers
    TOWER_BASIC: new Color3(0.70, 0.55, 0.35),
    TOWER_BASIC_ROOF: new Color3(0.55, 0.30, 0.15),
    TOWER_FIRE: new Color3(0.90, 0.35, 0.12),
    TOWER_FIRE_LAVA: new Color3(1.0, 0.55, 0.10),
    TOWER_WATER: new Color3(0.20, 0.55, 0.90),
    TOWER_WATER_CRYSTAL: new Color3(0.45, 0.78, 0.95),
    TOWER_WIND: new Color3(0.60, 0.88, 0.65),
    TOWER_WIND_BLADE: new Color3(0.85, 0.95, 0.88),
    TOWER_EARTH: new Color3(0.58, 0.48, 0.32),
    TOWER_EARTH_CRYSTAL: new Color3(0.45, 0.82, 0.55),
    TOWER_SNIPER: new Color3(0.35, 0.35, 0.45),
    TOWER_SNIPER_LENS: new Color3(0.85, 0.22, 0.22),
    TOWER_HEAVY: new Color3(0.48, 0.48, 0.50),
    TOWER_HEAVY_BARREL: new Color3(0.32, 0.32, 0.35),
    TOWER_FAST: new Color3(0.85, 0.75, 0.25),
    TOWER_FAST_BARREL: new Color3(0.65, 0.55, 0.18),
    TOWER_AOE: new Color3(0.70, 0.30, 0.80),
    TOWER_AOE_CRYSTAL: new Color3(0.85, 0.50, 0.95),

    // Enemies
    ENEMY_BASIC: new Color3(0.82, 0.28, 0.28),
    ENEMY_BASIC_HORN: new Color3(0.55, 0.18, 0.18),
    ENEMY_FAST: new Color3(0.28, 0.55, 0.82),
    ENEMY_FAST_WING: new Color3(0.40, 0.68, 0.90),
    ENEMY_TANK: new Color3(0.55, 0.55, 0.52),
    ENEMY_TANK_ROCK: new Color3(0.42, 0.42, 0.40),
    ENEMY_BOSS: new Color3(0.50, 0.15, 0.55),
    ENEMY_BOSS_SPIKE: new Color3(0.72, 0.22, 0.78),

    // UI
    UI_PANEL: 'rgba(28, 32, 40, 0.88)',
    UI_PANEL_BORDER: '#3A3F4B',
    UI_ACCENT_GOLD: '#F5A623',
    UI_TEXT_PRIMARY: '#FFFFFF',
    UI_TEXT_SECONDARY: '#B0B8C8',
    UI_BUTTON_PRIMARY: '#4CAF50',
    UI_BUTTON_PRIMARY_HOVER: '#66BB6A',
    UI_BUTTON_SECONDARY: '#2196F3',
    UI_BUTTON_SECONDARY_HOVER: '#42A5F5',
    UI_BUTTON_DANGER: '#E53935',
    UI_BUTTON_DANGER_HOVER: '#EF5350',
    UI_HEALTH: '#E53935',
    UI_GOLD: '#F5A623',
    UI_WAVE: '#42A5F5',

    // Element colors for damage numbers
    ELEMENT_FIRE: '#FF6633',
    ELEMENT_WATER: '#3399FF',
    ELEMENT_WIND: '#99FF66',
    ELEMENT_EARTH: '#CC9933',
    ELEMENT_NONE: '#FFFFFF',
} as const;
