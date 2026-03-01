import { Color3, Color4 } from '@babylonjs/core';
import { MapTheme } from '../gameplay/LevelConfig';

/**
 * Modern design-system palette for a polished tower defense game.
 * Inspired by Kingdom Rush / Bloons TD 6 visual language.
 * Uses a dark, glass-morphism UI with warm gold accents.
 */

// ==================== FONT CONSTANTS ====================
export const FONTS = {
    TITLE: "'Cinzel', serif",
    UI: "'Inter', sans-serif",
    MONO: "'JetBrains Mono', monospace",
} as const;

// ==================== UI DESIGN TOKENS ====================
export const UI = {
    // Spacing scale (4px base)
    SPACE_XS: '4px',
    SPACE_SM: '8px',
    SPACE_MD: '12px',
    SPACE_LG: '16px',
    SPACE_XL: '24px',
    SPACE_2XL: '32px',

    // Border radius
    RADIUS_SM: 6,
    RADIUS_MD: 10,
    RADIUS_LG: 14,
    RADIUS_XL: 20,
    RADIUS_PILL: 999,

    // Font sizes
    FONT_XS: 10,
    FONT_SM: 12,
    FONT_MD: 14,
    FONT_LG: 18,
    FONT_XL: 24,
    FONT_2XL: 32,
    FONT_3XL: 48,
    FONT_TITLE: 72,

    // Shadows
    SHADOW_SM: 'rgba(0,0,0,0.25)',
    SHADOW_MD: 'rgba(0,0,0,0.4)',
    SHADOW_LG: 'rgba(0,0,0,0.6)',
    SHADOW_GLOW_GOLD: 'rgba(245,166,35,0.3)',
    SHADOW_GLOW_GREEN: 'rgba(46,160,67,0.3)',
    SHADOW_GLOW_RED: 'rgba(218,54,51,0.3)',
    SHADOW_GLOW_BLUE: 'rgba(56,139,253,0.3)',

    // Blur values
    BLUR_SM: 4,
    BLUR_MD: 8,
    BLUR_LG: 16,
    BLUR_XL: 24,
} as const;

export const PALETTE = {
    // ==================== SCENE ====================
    SKY: new Color4(0.55, 0.78, 0.95, 1),
    FOG: new Color3(0.55, 0.78, 0.95),

    // ==================== LIGHTING ====================
    LIGHT_DIFFUSE: new Color3(1.0, 0.95, 0.88),
    LIGHT_GROUND: new Color3(0.45, 0.38, 0.32),

    // ==================== TERRAIN ====================
    GROUND: new Color3(0.42, 0.65, 0.32),
    PATH: new Color3(0.82, 0.72, 0.55),
    PATH_BORDER: new Color3(0.65, 0.55, 0.40),

    // ==================== DECORATIONS ====================
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

    // ==================== PORTALS ====================
    PORTAL_START: new Color3(0.15, 0.85, 0.35),
    PORTAL_END: new Color3(0.90, 0.20, 0.20),

    // ==================== TOWERS (BASE) ====================
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

    // ==================== HYBRID TOWERS ====================
    TOWER_STEAM_COPPER: new Color3(0.72, 0.45, 0.20),
    TOWER_STEAM_PIPE: new Color3(0.50, 0.50, 0.55),
    TOWER_STEAM_CLOUD: new Color3(0.80, 0.82, 0.88),
    TOWER_LAVA_ROCK: new Color3(0.30, 0.18, 0.10),
    TOWER_LAVA_GLOW: new Color3(1.00, 0.40, 0.05),
    TOWER_LAVA_CRUST: new Color3(0.50, 0.22, 0.08),
    TOWER_ICE_CRYSTAL: new Color3(0.70, 0.88, 1.00),
    TOWER_ICE_FROST: new Color3(0.85, 0.92, 1.00),
    TOWER_ICE_DEEP: new Color3(0.25, 0.45, 0.80),
    TOWER_STORM_DARK: new Color3(0.25, 0.25, 0.38),
    TOWER_STORM_LIGHTNING: new Color3(0.70, 0.70, 1.00),
    TOWER_STORM_ORB: new Color3(0.45, 0.45, 0.95),
    TOWER_MUD_DARK: new Color3(0.32, 0.22, 0.12),
    TOWER_MUD_WET: new Color3(0.42, 0.32, 0.18),
    TOWER_MUD_POOL: new Color3(0.38, 0.28, 0.15),
    TOWER_DUST_SAND: new Color3(0.78, 0.68, 0.48),
    TOWER_DUST_ROCK: new Color3(0.62, 0.52, 0.38),
    TOWER_DUST_VORTEX: new Color3(0.72, 0.62, 0.45),

    // ==================== ENEMIES ====================
    // Basic (Goblin Warrior)
    ENEMY_BASIC: new Color3(0.45, 0.58, 0.28),
    ENEMY_BASIC_HORN: new Color3(0.55, 0.18, 0.18),
    ENEMY_BASIC_BELLY: new Color3(0.58, 0.68, 0.38),
    ENEMY_BASIC_ARMOR: new Color3(0.50, 0.38, 0.22),
    ENEMY_BASIC_METAL: new Color3(0.62, 0.60, 0.55),
    ENEMY_BASIC_EYE: new Color3(1.0, 0.85, 0.15),
    // Fast (Spectral Wraith)
    ENEMY_FAST: new Color3(0.25, 0.72, 0.78),
    ENEMY_FAST_WING: new Color3(0.40, 0.68, 0.90),
    ENEMY_FAST_CLOAK: new Color3(0.15, 0.48, 0.62),
    ENEMY_FAST_WISP: new Color3(0.55, 0.90, 0.95),
    ENEMY_FAST_EYE: new Color3(0.80, 0.95, 1.0),
    // Tank (Ironclad Beetle)
    ENEMY_TANK: new Color3(0.35, 0.32, 0.38),
    ENEMY_TANK_ROCK: new Color3(0.42, 0.42, 0.40),
    ENEMY_TANK_SHELL: new Color3(0.28, 0.26, 0.32),
    ENEMY_TANK_AMBER: new Color3(0.90, 0.65, 0.12),
    ENEMY_TANK_LEG: new Color3(0.48, 0.42, 0.38),
    ENEMY_TANK_MANDIBLE: new Color3(0.55, 0.48, 0.35),
    // Boss (Abyssal Titan)
    ENEMY_BOSS: new Color3(0.35, 0.10, 0.42),
    ENEMY_BOSS_SPIKE: new Color3(0.72, 0.22, 0.78),
    ENEMY_BOSS_BONE: new Color3(0.75, 0.68, 0.58),
    ENEMY_BOSS_CRYSTAL: new Color3(0.85, 0.18, 0.55),
    ENEMY_BOSS_FIRE: new Color3(1.0, 0.30, 0.65),
    ENEMY_BOSS_DARK: new Color3(0.18, 0.05, 0.22),

    // ==================== UI COLORS (Glass-morphism Dark Theme) ====================
    // Backgrounds
    UI_PANEL: 'rgba(13, 17, 23, 0.92)',
    UI_PANEL_BG: 'rgba(22, 27, 34, 0.88)',
    UI_PANEL_SOLID: 'rgba(22, 27, 34, 0.96)',
    UI_PANEL_GLASS: 'rgba(30, 36, 48, 0.75)',
    UI_BORDER: 'rgba(48, 54, 61, 0.6)',
    UI_BORDER_LIGHT: 'rgba(139, 148, 158, 0.15)',
    UI_CARD_BG: 'rgba(33, 38, 45, 0.92)',
    UI_CARD_HOVER: 'rgba(48, 54, 61, 0.95)',
    UI_CARD_ACTIVE: 'rgba(56, 139, 253, 0.15)',
    UI_PANEL_BORDER: '#30363D',
    UI_DIVIDER: 'rgba(48, 54, 61, 0.5)',

    // Accent colors
    UI_ACCENT_GOLD: '#F5A623',
    UI_ACCENT_GOLD_LIGHT: '#FFD54F',
    UI_ACCENT_GOLD_DIM: 'rgba(245, 166, 35, 0.6)',

    // Text
    UI_TEXT_PRIMARY: '#F0F6FC',
    UI_TEXT_SECONDARY: '#8B949E',
    UI_TEXT_TERTIARY: '#6E7681',
    UI_TEXT_GOLD: '#FFD54F',

    // Buttons
    UI_BUTTON_PRIMARY: '#2EA043',
    UI_BUTTON_PRIMARY_HOVER: '#3FB950',
    UI_BUTTON_SECONDARY: '#388BFD',
    UI_BUTTON_SECONDARY_HOVER: '#58A6FF',
    UI_BUTTON_DANGER: '#DA3633',
    UI_BUTTON_DANGER_HOVER: '#F85149',
    UI_BUTTON_MUTED: '#21262D',
    UI_BUTTON_MUTED_HOVER: '#30363D',

    // Status colors
    UI_HEALTH: '#DA3633',
    UI_HEALTH_LOW: '#F85149',
    UI_HEALTH_MED: '#D29922',
    UI_HEALTH_HIGH: '#2EA043',
    UI_GOLD: '#F5A623',
    UI_WAVE: '#58A6FF',
    UI_XP: '#A371F7',

    // Element colors for damage numbers
    ELEMENT_FIRE: '#FF6633',
    ELEMENT_WATER: '#3399FF',
    ELEMENT_WIND: '#99FF66',
    ELEMENT_EARTH: '#CC9933',
    ELEMENT_NONE: '#FFFFFF',

    // ==================== MEDIEVAL TOWER PALETTE ====================
    TOWER_BASIC_STONE: new Color3(0.72, 0.68, 0.62),
    TOWER_BASIC_MERLON: new Color3(0.60, 0.56, 0.50),
    TOWER_BASIC_WOOD: new Color3(0.55, 0.38, 0.22),
    TOWER_BASIC_BANNER: new Color3(0.85, 0.68, 0.18),
    TOWER_FAST_TIMBER: new Color3(0.48, 0.32, 0.16),
    TOWER_FAST_TORSION: new Color3(0.65, 0.55, 0.35),
    TOWER_HEAVY_SIEGE: new Color3(0.58, 0.52, 0.45),
    TOWER_HEAVY_ARM: new Color3(0.55, 0.40, 0.22),
    TOWER_HEAVY_IRON: new Color3(0.35, 0.33, 0.35),
    TOWER_SNIPER_LIMESTONE: new Color3(0.80, 0.76, 0.70),
    TOWER_SNIPER_SLATE: new Color3(0.35, 0.32, 0.38),
    TOWER_AOE_RUNE: new Color3(0.60, 0.28, 0.85),
    TOWER_AOE_STONE: new Color3(0.45, 0.42, 0.48),
    TOWER_AOE_ORB: new Color3(0.72, 0.40, 0.95),
} as const;

// ==================== MAP THEME PALETTES ====================

export interface MapThemePalette {
    sky: Color4;
    fog: Color3;
    ground: Color3;
    path: Color3;
    pathBorder: Color3;
    waterColor: Color3;
    waterDeep: Color3;
    waterEmissive: boolean;
    treeTrunk: Color3;
    treeFoliage: Color3;
    treeFoliageDark: Color3;
    rock: Color3;
    rockDark: Color3;
    bush: Color3;
    crystalColors: Color3[];
    particleColor1: Color4;
    particleColor2: Color4;
    particleDead: Color4;
    // Terrain overlay colors
    forestOverlay: Color3;
    highlandOverlay: Color3;
    crystalOverlay: Color3;
    riversideOverlay: Color3;
}

export const MAP_THEMES: Record<MapTheme, MapThemePalette> = {
    [MapTheme.NEUTRAL]: {
        sky: new Color4(0.55, 0.78, 0.95, 1),
        fog: new Color3(0.55, 0.78, 0.95),
        ground: new Color3(0.42, 0.65, 0.32),
        path: new Color3(0.82, 0.72, 0.55),
        pathBorder: new Color3(0.65, 0.55, 0.40),
        waterColor: new Color3(0.25, 0.55, 0.85),
        waterDeep: new Color3(0.15, 0.40, 0.70),
        waterEmissive: false,
        treeTrunk: new Color3(0.55, 0.35, 0.18),
        treeFoliage: new Color3(0.22, 0.58, 0.22),
        treeFoliageDark: new Color3(0.18, 0.48, 0.18),
        rock: new Color3(0.58, 0.55, 0.52),
        rockDark: new Color3(0.45, 0.42, 0.40),
        bush: new Color3(0.30, 0.62, 0.28),
        crystalColors: [
            new Color3(0.65, 0.30, 0.85),
            new Color3(0.45, 0.78, 0.95),
            new Color3(0.85, 0.50, 0.95)
        ],
        particleColor1: new Color4(0.8, 0.95, 0.3, 0.7),
        particleColor2: new Color4(0.6, 0.85, 0.2, 0.5),
        particleDead: new Color4(0.3, 0.4, 0.1, 0.0),
        forestOverlay: new Color3(0.25, 0.45, 0.18),
        highlandOverlay: new Color3(0.52, 0.48, 0.42),
        crystalOverlay: new Color3(0.45, 0.35, 0.55),
        riversideOverlay: new Color3(0.30, 0.55, 0.28)
    },
    [MapTheme.FIRE]: {
        sky: new Color4(0.35, 0.15, 0.10, 1),
        fog: new Color3(0.40, 0.18, 0.12),
        ground: new Color3(0.28, 0.18, 0.12),
        path: new Color3(0.55, 0.38, 0.25),
        pathBorder: new Color3(0.40, 0.28, 0.18),
        waterColor: new Color3(0.95, 0.45, 0.10),
        waterDeep: new Color3(0.85, 0.25, 0.05),
        waterEmissive: true,
        treeTrunk: new Color3(0.22, 0.15, 0.10),
        treeFoliage: new Color3(0.35, 0.18, 0.08),
        treeFoliageDark: new Color3(0.25, 0.12, 0.05),
        rock: new Color3(0.38, 0.30, 0.28),
        rockDark: new Color3(0.22, 0.18, 0.18),
        bush: new Color3(0.40, 0.22, 0.10),
        crystalColors: [
            new Color3(1.0, 0.50, 0.10),
            new Color3(0.95, 0.30, 0.05),
            new Color3(0.80, 0.20, 0.10)
        ],
        particleColor1: new Color4(1.0, 0.55, 0.10, 0.8),
        particleColor2: new Color4(0.95, 0.30, 0.05, 0.6),
        particleDead: new Color4(0.3, 0.1, 0.0, 0.0),
        forestOverlay: new Color3(0.22, 0.12, 0.08),
        highlandOverlay: new Color3(0.32, 0.22, 0.18),
        crystalOverlay: new Color3(0.45, 0.20, 0.10),
        riversideOverlay: new Color3(0.35, 0.18, 0.10)
    },
    [MapTheme.WATER]: {
        sky: new Color4(0.40, 0.65, 0.85, 1),
        fog: new Color3(0.45, 0.68, 0.88),
        ground: new Color3(0.28, 0.52, 0.38),
        path: new Color3(0.65, 0.72, 0.78),
        pathBorder: new Color3(0.48, 0.55, 0.62),
        waterColor: new Color3(0.20, 0.50, 0.85),
        waterDeep: new Color3(0.10, 0.35, 0.70),
        waterEmissive: false,
        treeTrunk: new Color3(0.38, 0.32, 0.22),
        treeFoliage: new Color3(0.18, 0.52, 0.38),
        treeFoliageDark: new Color3(0.12, 0.42, 0.32),
        rock: new Color3(0.48, 0.55, 0.58),
        rockDark: new Color3(0.35, 0.42, 0.48),
        bush: new Color3(0.22, 0.55, 0.40),
        crystalColors: [
            new Color3(0.30, 0.70, 0.95),
            new Color3(0.45, 0.85, 0.90),
            new Color3(0.20, 0.55, 0.80)
        ],
        particleColor1: new Color4(0.60, 0.85, 0.95, 0.4),
        particleColor2: new Color4(0.50, 0.75, 0.90, 0.3),
        particleDead: new Color4(0.40, 0.60, 0.70, 0.0),
        forestOverlay: new Color3(0.20, 0.42, 0.30),
        highlandOverlay: new Color3(0.38, 0.45, 0.50),
        crystalOverlay: new Color3(0.30, 0.45, 0.58),
        riversideOverlay: new Color3(0.22, 0.48, 0.35)
    },
    [MapTheme.WIND]: {
        sky: new Color4(0.72, 0.85, 0.92, 1),
        fog: new Color3(0.75, 0.88, 0.92),
        ground: new Color3(0.52, 0.68, 0.42),
        path: new Color3(0.78, 0.75, 0.65),
        pathBorder: new Color3(0.62, 0.58, 0.50),
        waterColor: new Color3(0.35, 0.65, 0.80),
        waterDeep: new Color3(0.25, 0.50, 0.68),
        waterEmissive: false,
        treeTrunk: new Color3(0.50, 0.40, 0.25),
        treeFoliage: new Color3(0.40, 0.68, 0.35),
        treeFoliageDark: new Color3(0.32, 0.58, 0.28),
        rock: new Color3(0.62, 0.62, 0.58),
        rockDark: new Color3(0.50, 0.50, 0.48),
        bush: new Color3(0.48, 0.70, 0.38),
        crystalColors: [
            new Color3(0.75, 0.92, 0.80),
            new Color3(0.85, 0.95, 0.88),
            new Color3(0.60, 0.85, 0.70)
        ],
        particleColor1: new Color4(0.85, 0.95, 0.88, 0.5),
        particleColor2: new Color4(0.70, 0.90, 0.75, 0.3),
        particleDead: new Color4(0.50, 0.70, 0.55, 0.0),
        forestOverlay: new Color3(0.35, 0.55, 0.30),
        highlandOverlay: new Color3(0.55, 0.58, 0.50),
        crystalOverlay: new Color3(0.50, 0.60, 0.52),
        riversideOverlay: new Color3(0.40, 0.62, 0.35)
    },
    [MapTheme.EARTH]: {
        sky: new Color4(0.62, 0.55, 0.42, 1),
        fog: new Color3(0.65, 0.58, 0.45),
        ground: new Color3(0.48, 0.38, 0.25),
        path: new Color3(0.72, 0.60, 0.42),
        pathBorder: new Color3(0.55, 0.45, 0.32),
        waterColor: new Color3(0.45, 0.35, 0.22),
        waterDeep: new Color3(0.35, 0.28, 0.18),
        waterEmissive: false,
        treeTrunk: new Color3(0.42, 0.30, 0.18),
        treeFoliage: new Color3(0.38, 0.48, 0.22),
        treeFoliageDark: new Color3(0.30, 0.38, 0.18),
        rock: new Color3(0.62, 0.52, 0.38),
        rockDark: new Color3(0.48, 0.40, 0.30),
        bush: new Color3(0.42, 0.48, 0.25),
        crystalColors: [
            new Color3(0.85, 0.65, 0.25),
            new Color3(0.75, 0.55, 0.20),
            new Color3(0.65, 0.45, 0.15)
        ],
        particleColor1: new Color4(0.75, 0.60, 0.35, 0.4),
        particleColor2: new Color4(0.60, 0.50, 0.30, 0.3),
        particleDead: new Color4(0.45, 0.35, 0.20, 0.0),
        forestOverlay: new Color3(0.35, 0.30, 0.18),
        highlandOverlay: new Color3(0.50, 0.42, 0.32),
        crystalOverlay: new Color3(0.55, 0.42, 0.25),
        riversideOverlay: new Color3(0.40, 0.35, 0.22)
    }
};

// ==================== UI HELPER FUNCTIONS ====================

/**
 * Create a standard button style configuration object.
 */
export function getButtonStyle(variant: 'primary' | 'secondary' | 'danger' | 'muted' = 'primary') {
    const styles = {
        primary: { bg: PALETTE.UI_BUTTON_PRIMARY, hover: PALETTE.UI_BUTTON_PRIMARY_HOVER, glow: UI.SHADOW_GLOW_GREEN },
        secondary: { bg: PALETTE.UI_BUTTON_SECONDARY, hover: PALETTE.UI_BUTTON_SECONDARY_HOVER, glow: UI.SHADOW_GLOW_BLUE },
        danger: { bg: PALETTE.UI_BUTTON_DANGER, hover: PALETTE.UI_BUTTON_DANGER_HOVER, glow: UI.SHADOW_GLOW_RED },
        muted: { bg: PALETTE.UI_BUTTON_MUTED, hover: PALETTE.UI_BUTTON_MUTED_HOVER, glow: 'rgba(0,0,0,0)' },
    };
    return styles[variant];
}
