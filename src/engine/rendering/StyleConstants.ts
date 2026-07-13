import { Color } from 'three';
import { RGBA } from '../three/math';

/**
 * Warm, saturated color palette for the low-poly stylized aesthetic.
 * All colors used across the entire game should reference this palette.
 */
export const PALETTE = {
    // Scene
    SKY: new RGBA(0.55, 0.78, 0.95, 1),
    FOG: new Color(0.55, 0.78, 0.95),

    // Lighting
    LIGHT_DIFFUSE: new Color(1.0, 0.95, 0.88),
    LIGHT_GROUND: new Color(0.45, 0.38, 0.32),

    // Terrain
    GROUND: new Color(0.42, 0.65, 0.32),
    PATH: new Color(0.82, 0.72, 0.55),
    PATH_BORDER: new Color(0.65, 0.55, 0.40),

    // Decorations
    TREE_TRUNK: new Color(0.55, 0.35, 0.18),
    TREE_FOLIAGE: new Color(0.22, 0.58, 0.22),
    TREE_FOLIAGE_DARK: new Color(0.18, 0.48, 0.18),
    ROCK: new Color(0.58, 0.55, 0.52),
    ROCK_DARK: new Color(0.45, 0.42, 0.40),
    BUSH: new Color(0.30, 0.62, 0.28),
    FLOWER_STEM: new Color(0.28, 0.52, 0.22),
    FLOWER_PETAL_RED: new Color(0.90, 0.25, 0.25),
    FLOWER_PETAL_YELLOW: new Color(0.95, 0.85, 0.25),
    FLOWER_PETAL_PURPLE: new Color(0.65, 0.28, 0.82),

    // Portals
    PORTAL_START: new Color(0.15, 0.85, 0.35),
    PORTAL_END: new Color(0.90, 0.20, 0.20),

    // Medieval Tower Tree — stone, wood, iron theme
    MEDIEVAL_STONE: new Color(0.72, 0.68, 0.62),
    MEDIEVAL_DARK_STONE: new Color(0.50, 0.47, 0.42),
    MEDIEVAL_WOOD: new Color(0.55, 0.38, 0.22),
    MEDIEVAL_IRON: new Color(0.45, 0.43, 0.45),
    MEDIEVAL_GOLD: new Color(0.85, 0.70, 0.25),
    MEDIEVAL_BANNER: new Color(0.80, 0.22, 0.18),
    MEDIEVAL_ARCHER: new Color(0.65, 0.55, 0.35),
    MEDIEVAL_GARRISON: new Color(0.58, 0.55, 0.52),
    MEDIEVAL_PRECISION: new Color(0.78, 0.72, 0.58),
    MEDIEVAL_RAPIDFIRE: new Color(0.62, 0.52, 0.38),
    MEDIEVAL_SUPPORT: new Color(0.70, 0.60, 0.45),
    MEDIEVAL_DEFENSE: new Color(0.55, 0.50, 0.48),
    MEDIEVAL_ELITE_GOLD: new Color(0.90, 0.78, 0.35),
    MEDIEVAL_ELITE_DARK: new Color(0.30, 0.28, 0.32),
    MEDIEVAL_SIEGE: new Color(0.48, 0.42, 0.35),

    // Elemental Tower Tree — magical, glowing theme
    ELEMENTAL_OBSIDIAN: new Color(0.22, 0.18, 0.25),
    ELEMENTAL_CRYSTAL: new Color(0.65, 0.55, 0.85),
    ELEMENTAL_FIRE: new Color(0.90, 0.35, 0.12),
    ELEMENTAL_FIRE_GLOW: new Color(1.0, 0.55, 0.10),
    ELEMENTAL_FIRE_DARK: new Color(0.45, 0.12, 0.05),
    ELEMENTAL_LIGHTNING: new Color(0.55, 0.55, 1.0),
    ELEMENTAL_LIGHTNING_BRIGHT: new Color(0.80, 0.80, 1.0),
    ELEMENTAL_PLASMA: new Color(0.75, 0.40, 0.95),
    ELEMENTAL_ICE: new Color(0.45, 0.75, 0.95),
    ELEMENTAL_ICE_DEEP: new Color(0.20, 0.45, 0.80),
    ELEMENTAL_ICE_FROST: new Color(0.85, 0.92, 1.0),
    ELEMENTAL_WATER: new Color(0.20, 0.50, 0.85),
    ELEMENTAL_NATURE: new Color(0.35, 0.65, 0.30),
    ELEMENTAL_NATURE_DARK: new Color(0.22, 0.45, 0.18),
    ELEMENTAL_SHADOW: new Color(0.35, 0.18, 0.45),
    ELEMENTAL_SHADOW_DARK: new Color(0.18, 0.08, 0.25),
    ELEMENTAL_VOID: new Color(0.28, 0.12, 0.38),

    // Enemies - Basic (Goblin Warrior: earthy greens and browns)
    ENEMY_BASIC: new Color(0.45, 0.58, 0.28),           // Olive-green skin
    ENEMY_BASIC_HORN: new Color(0.55, 0.18, 0.18),      // Dark red (kept for accents)
    ENEMY_BASIC_BELLY: new Color(0.58, 0.68, 0.38),     // Lighter green belly
    ENEMY_BASIC_ARMOR: new Color(0.50, 0.38, 0.22),     // Brown leather armor
    ENEMY_BASIC_METAL: new Color(0.62, 0.60, 0.55),     // Dull metal for sword/shield
    ENEMY_BASIC_EYE: new Color(1.0, 0.85, 0.15),        // Bright yellow eyes

    // Enemies - Fast (Spectral Wraith: ethereal cyans and ghostly whites)
    ENEMY_FAST: new Color(0.25, 0.72, 0.78),            // Ghostly cyan
    ENEMY_FAST_WING: new Color(0.40, 0.68, 0.90),       // (kept for compatibility)
    ENEMY_FAST_CLOAK: new Color(0.15, 0.48, 0.62),      // Darker teal cloak
    ENEMY_FAST_WISP: new Color(0.55, 0.90, 0.95),       // Pale wisp trails
    ENEMY_FAST_EYE: new Color(0.80, 0.95, 1.0),         // Icy white glow

    // Enemies - Tank (Ironclad Beetle: dark iron and amber)
    ENEMY_TANK: new Color(0.35, 0.32, 0.38),            // Dark iron carapace
    ENEMY_TANK_ROCK: new Color(0.42, 0.42, 0.40),       // (kept for compatibility)
    ENEMY_TANK_SHELL: new Color(0.28, 0.26, 0.32),      // Darker shell plates
    ENEMY_TANK_AMBER: new Color(0.90, 0.65, 0.12),      // Amber glow vents
    ENEMY_TANK_LEG: new Color(0.48, 0.42, 0.38),        // Brownish leg chitin
    ENEMY_TANK_MANDIBLE: new Color(0.55, 0.48, 0.35),   // Bone-colored mandibles

    // Enemies - Boss (Abyssal Titan: deep purple, obsidian, and magenta fire)
    ENEMY_BOSS: new Color(0.35, 0.10, 0.42),            // Deep dark purple
    ENEMY_BOSS_SPIKE: new Color(0.72, 0.22, 0.78),      // (kept for compatibility)
    ENEMY_BOSS_BONE: new Color(0.75, 0.68, 0.58),       // Pale bone/skull
    ENEMY_BOSS_CRYSTAL: new Color(0.85, 0.18, 0.55),    // Magenta crystals
    ENEMY_BOSS_FIRE: new Color(1.0, 0.30, 0.65),        // Hot magenta fire
    ENEMY_BOSS_DARK: new Color(0.18, 0.05, 0.22),       // Near-black dark energy

    // Splitting Enemy (Hydra) — green/teal multi-headed serpent
    ENEMY_SPLITTING: new Color(0.30, 0.65, 0.45),       // Teal-green body
    ENEMY_SPLITTING_BELLY: new Color(0.50, 0.80, 0.55), // Lighter belly
    ENEMY_SPLITTING_EYE: new Color(1.0, 0.55, 0.10),    // Orange eyes

    // Healer Enemy (Shaman) — blue/purple mystic
    ENEMY_HEALER: new Color(0.40, 0.25, 0.65),          // Purple robes
    ENEMY_HEALER_STAFF: new Color(0.55, 0.40, 0.25),    // Wooden staff
    ENEMY_HEALER_GLOW: new Color(0.30, 0.95, 0.50),     // Green healing glow
    ENEMY_HEALER_EYE: new Color(0.50, 1.0, 0.80),       // Cyan-green eyes

    // Shield Enemy (Paladin) — silver/gold armored
    ENEMY_SHIELD: new Color(0.60, 0.58, 0.65),          // Silver armor
    ENEMY_SHIELD_GOLD: new Color(0.85, 0.70, 0.25),     // Gold accents
    ENEMY_SHIELD_PLATE: new Color(0.45, 0.43, 0.50),    // Darker shield plate
    ENEMY_SHIELD_EYE: new Color(0.90, 0.85, 0.50),      // Golden eyes

    // Champion (friendly summon)
    CHAMPION_BODY: new Color(0.85, 0.70, 0.25),     // Golden armor (#D9B340)
    CHAMPION_CAPE: new Color(0.15, 0.30, 0.65),     // Royal blue (#264DA6)
    CHAMPION_HELM: new Color(0.90, 0.80, 0.35),     // Bright gold (#E6CC59)
    CHAMPION_WEAPON: new Color(0.75, 0.72, 0.68),   // Silver blade (#BFB8AD)

    // UI
    UI_PANEL: 'rgba(28, 32, 40, 0.88)',
    UI_PANEL_BG: 'rgba(16, 20, 28, 0.82)',
    UI_PANEL_SOLID: 'rgba(22, 26, 34, 0.95)',
    UI_BORDER: 'rgba(80, 90, 110, 0.3)',
    UI_CARD_BG: 'rgba(30, 34, 42, 0.92)',
    UI_CARD_HOVER: 'rgba(50, 56, 68, 0.95)',
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

    // Tower tier accent colors (used for UI highlights)
    TIER_1: '#8B7355',
    TIER_2: '#A09080',
    TIER_3: '#B0A890',
    TIER_4: '#C0B898',
    TIER_5: '#D4C8A0',
    TIER_6: '#E0D4A8',
    TIER_7: '#F0E0B0',
    TIER_8: '#FFD54F',
} as const;

// ==================== MAP THEME PALETTES ====================
// (Retained as a type for any future themed-area work — survivors mode has no
// themes; the old TD-era Map + LevelConfig that consumed MAP_THEMES is gone.)

export interface MapThemePalette {
    sky: RGBA;
    fog: Color;
    ground: Color;
    path: Color;
    pathBorder: Color;
    waterColor: Color;
    waterDeep: Color;
    waterEmissive: boolean;
    treeTrunk: Color;
    treeFoliage: Color;
    treeFoliageDark: Color;
    rock: Color;
    rockDark: Color;
    bush: Color;
    crystalColors: Color[];
    particleColor1: RGBA;
    particleColor2: RGBA;
    particleDead: RGBA;
    // Terrain overlay colors
    forestOverlay: Color;
    highlandOverlay: Color;
    crystalOverlay: Color;
    riversideOverlay: Color;
}

export const MAP_THEMES: Record<string, MapThemePalette> = {
    NEUTRAL: {
        sky: new RGBA(0.55, 0.78, 0.95, 1),
        fog: new Color(0.55, 0.78, 0.95),
        ground: new Color(0.42, 0.65, 0.32),
        path: new Color(0.82, 0.72, 0.55),
        pathBorder: new Color(0.65, 0.55, 0.40),
        waterColor: new Color(0.25, 0.55, 0.85),
        waterDeep: new Color(0.15, 0.40, 0.70),
        waterEmissive: false,
        treeTrunk: new Color(0.55, 0.35, 0.18),
        treeFoliage: new Color(0.22, 0.58, 0.22),
        treeFoliageDark: new Color(0.18, 0.48, 0.18),
        rock: new Color(0.58, 0.55, 0.52),
        rockDark: new Color(0.45, 0.42, 0.40),
        bush: new Color(0.30, 0.62, 0.28),
        crystalColors: [
            new Color(0.65, 0.30, 0.85),
            new Color(0.45, 0.78, 0.95),
            new Color(0.85, 0.50, 0.95)
        ],
        particleColor1: new RGBA(0.8, 0.95, 0.3, 0.7),
        particleColor2: new RGBA(0.6, 0.85, 0.2, 0.5),
        particleDead: new RGBA(0.3, 0.4, 0.1, 0.0),
        forestOverlay: new Color(0.25, 0.45, 0.18),
        highlandOverlay: new Color(0.52, 0.48, 0.42),
        crystalOverlay: new Color(0.45, 0.35, 0.55),
        riversideOverlay: new Color(0.30, 0.55, 0.28)
    },
    FIRE: {
        sky: new RGBA(0.35, 0.15, 0.10, 1),
        fog: new Color(0.40, 0.18, 0.12),
        ground: new Color(0.28, 0.18, 0.12),
        path: new Color(0.55, 0.38, 0.25),
        pathBorder: new Color(0.40, 0.28, 0.18),
        waterColor: new Color(0.95, 0.45, 0.10),      // Lava orange
        waterDeep: new Color(0.85, 0.25, 0.05),        // Deep lava
        waterEmissive: true,
        treeTrunk: new Color(0.22, 0.15, 0.10),        // Charred
        treeFoliage: new Color(0.35, 0.18, 0.08),      // Burnt orange leaves
        treeFoliageDark: new Color(0.25, 0.12, 0.05),
        rock: new Color(0.38, 0.30, 0.28),             // Volcanic rock
        rockDark: new Color(0.22, 0.18, 0.18),         // Obsidian
        bush: new Color(0.40, 0.22, 0.10),             // Scorched bush
        crystalColors: [
            new Color(1.0, 0.50, 0.10),                // Ember
            new Color(0.95, 0.30, 0.05),                // Hot orange
            new Color(0.80, 0.20, 0.10)                 // Deep red
        ],
        particleColor1: new RGBA(1.0, 0.55, 0.10, 0.8),  // Ember particles
        particleColor2: new RGBA(0.95, 0.30, 0.05, 0.6),
        particleDead: new RGBA(0.3, 0.1, 0.0, 0.0),
        forestOverlay: new Color(0.22, 0.12, 0.08),
        highlandOverlay: new Color(0.32, 0.22, 0.18),
        crystalOverlay: new Color(0.45, 0.20, 0.10),
        riversideOverlay: new Color(0.35, 0.18, 0.10)
    },
    WATER: {
        sky: new RGBA(0.40, 0.65, 0.85, 1),
        fog: new Color(0.45, 0.68, 0.88),
        ground: new Color(0.28, 0.52, 0.38),           // Lush blue-green
        path: new Color(0.65, 0.72, 0.78),             // Pale stone
        pathBorder: new Color(0.48, 0.55, 0.62),
        waterColor: new Color(0.20, 0.50, 0.85),       // Deep blue
        waterDeep: new Color(0.10, 0.35, 0.70),
        waterEmissive: false,
        treeTrunk: new Color(0.38, 0.32, 0.22),
        treeFoliage: new Color(0.18, 0.52, 0.38),      // Blue-green
        treeFoliageDark: new Color(0.12, 0.42, 0.32),
        rock: new Color(0.48, 0.55, 0.58),             // Wet stone
        rockDark: new Color(0.35, 0.42, 0.48),
        bush: new Color(0.22, 0.55, 0.40),
        crystalColors: [
            new Color(0.30, 0.70, 0.95),               // Aqua
            new Color(0.45, 0.85, 0.90),                // Light cyan
            new Color(0.20, 0.55, 0.80)                 // Ocean blue
        ],
        particleColor1: new RGBA(0.60, 0.85, 0.95, 0.4),  // Mist
        particleColor2: new RGBA(0.50, 0.75, 0.90, 0.3),
        particleDead: new RGBA(0.40, 0.60, 0.70, 0.0),
        forestOverlay: new Color(0.20, 0.42, 0.30),
        highlandOverlay: new Color(0.38, 0.45, 0.50),
        crystalOverlay: new Color(0.30, 0.45, 0.58),
        riversideOverlay: new Color(0.22, 0.48, 0.35)
    },
    WIND: {
        sky: new RGBA(0.72, 0.85, 0.92, 1),
        fog: new Color(0.75, 0.88, 0.92),
        ground: new Color(0.52, 0.68, 0.42),           // Pale green highlands
        path: new Color(0.78, 0.75, 0.65),
        pathBorder: new Color(0.62, 0.58, 0.50),
        waterColor: new Color(0.35, 0.65, 0.80),
        waterDeep: new Color(0.25, 0.50, 0.68),
        waterEmissive: false,
        treeTrunk: new Color(0.50, 0.40, 0.25),
        treeFoliage: new Color(0.40, 0.68, 0.35),      // Bright green
        treeFoliageDark: new Color(0.32, 0.58, 0.28),
        rock: new Color(0.62, 0.62, 0.58),             // Light grey
        rockDark: new Color(0.50, 0.50, 0.48),
        bush: new Color(0.48, 0.70, 0.38),             // Wispy green
        crystalColors: [
            new Color(0.75, 0.92, 0.80),               // Pale green
            new Color(0.85, 0.95, 0.88),                // Near white
            new Color(0.60, 0.85, 0.70)                 // Mint
        ],
        particleColor1: new RGBA(0.85, 0.95, 0.88, 0.5),  // Wispy leaves
        particleColor2: new RGBA(0.70, 0.90, 0.75, 0.3),
        particleDead: new RGBA(0.50, 0.70, 0.55, 0.0),
        forestOverlay: new Color(0.35, 0.55, 0.30),
        highlandOverlay: new Color(0.55, 0.58, 0.50),
        crystalOverlay: new Color(0.50, 0.60, 0.52),
        riversideOverlay: new Color(0.40, 0.62, 0.35)
    },
    EARTH: {
        sky: new RGBA(0.62, 0.55, 0.42, 1),
        fog: new Color(0.65, 0.58, 0.45),
        ground: new Color(0.48, 0.38, 0.25),           // Rocky brown
        path: new Color(0.72, 0.60, 0.42),
        pathBorder: new Color(0.55, 0.45, 0.32),
        waterColor: new Color(0.45, 0.35, 0.22),       // Muddy river
        waterDeep: new Color(0.35, 0.28, 0.18),
        waterEmissive: false,
        treeTrunk: new Color(0.42, 0.30, 0.18),
        treeFoliage: new Color(0.38, 0.48, 0.22),      // Olive
        treeFoliageDark: new Color(0.30, 0.38, 0.18),
        rock: new Color(0.62, 0.52, 0.38),             // Sandstone
        rockDark: new Color(0.48, 0.40, 0.30),
        bush: new Color(0.42, 0.48, 0.25),
        crystalColors: [
            new Color(0.85, 0.65, 0.25),               // Amber
            new Color(0.75, 0.55, 0.20),                // Gold
            new Color(0.65, 0.45, 0.15)                 // Bronze
        ],
        particleColor1: new RGBA(0.75, 0.60, 0.35, 0.4),  // Dust
        particleColor2: new RGBA(0.60, 0.50, 0.30, 0.3),
        particleDead: new RGBA(0.45, 0.35, 0.20, 0.0),
        forestOverlay: new Color(0.35, 0.30, 0.18),
        highlandOverlay: new Color(0.50, 0.42, 0.32),
        crystalOverlay: new Color(0.55, 0.42, 0.25),
        riversideOverlay: new Color(0.40, 0.35, 0.22)
    }
};
