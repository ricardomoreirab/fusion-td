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

    // Hybrid Towers
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

    // Enemies - Basic (Goblin Warrior: earthy greens and browns)
    ENEMY_BASIC: new Color3(0.45, 0.58, 0.28),           // Olive-green skin
    ENEMY_BASIC_HORN: new Color3(0.55, 0.18, 0.18),      // Dark red (kept for accents)
    ENEMY_BASIC_BELLY: new Color3(0.58, 0.68, 0.38),     // Lighter green belly
    ENEMY_BASIC_ARMOR: new Color3(0.50, 0.38, 0.22),     // Brown leather armor
    ENEMY_BASIC_METAL: new Color3(0.62, 0.60, 0.55),     // Dull metal for sword/shield
    ENEMY_BASIC_EYE: new Color3(1.0, 0.85, 0.15),        // Bright yellow eyes

    // Enemies - Fast (Spectral Wraith: ethereal cyans and ghostly whites)
    ENEMY_FAST: new Color3(0.25, 0.72, 0.78),            // Ghostly cyan
    ENEMY_FAST_WING: new Color3(0.40, 0.68, 0.90),       // (kept for compatibility)
    ENEMY_FAST_CLOAK: new Color3(0.15, 0.48, 0.62),      // Darker teal cloak
    ENEMY_FAST_WISP: new Color3(0.55, 0.90, 0.95),       // Pale wisp trails
    ENEMY_FAST_EYE: new Color3(0.80, 0.95, 1.0),         // Icy white glow

    // Enemies - Tank (Ironclad Beetle: dark iron and amber)
    ENEMY_TANK: new Color3(0.35, 0.32, 0.38),            // Dark iron carapace
    ENEMY_TANK_ROCK: new Color3(0.42, 0.42, 0.40),       // (kept for compatibility)
    ENEMY_TANK_SHELL: new Color3(0.28, 0.26, 0.32),      // Darker shell plates
    ENEMY_TANK_AMBER: new Color3(0.90, 0.65, 0.12),      // Amber glow vents
    ENEMY_TANK_LEG: new Color3(0.48, 0.42, 0.38),        // Brownish leg chitin
    ENEMY_TANK_MANDIBLE: new Color3(0.55, 0.48, 0.35),   // Bone-colored mandibles

    // Enemies - Boss (Abyssal Titan: deep purple, obsidian, and magenta fire)
    ENEMY_BOSS: new Color3(0.35, 0.10, 0.42),            // Deep dark purple
    ENEMY_BOSS_SPIKE: new Color3(0.72, 0.22, 0.78),      // (kept for compatibility)
    ENEMY_BOSS_BONE: new Color3(0.75, 0.68, 0.58),       // Pale bone/skull
    ENEMY_BOSS_CRYSTAL: new Color3(0.85, 0.18, 0.55),    // Magenta crystals
    ENEMY_BOSS_FIRE: new Color3(1.0, 0.30, 0.65),        // Hot magenta fire
    ENEMY_BOSS_DARK: new Color3(0.18, 0.05, 0.22),       // Near-black dark energy

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

    // Medieval non-elemental tower palette
    TOWER_BASIC_STONE: new Color3(0.72, 0.68, 0.62),      // Limestone
    TOWER_BASIC_MERLON: new Color3(0.60, 0.56, 0.50),     // Dark stone
    TOWER_BASIC_WOOD: new Color3(0.55, 0.38, 0.22),       // Timber
    TOWER_BASIC_BANNER: new Color3(0.85, 0.68, 0.18),     // Heraldic gold
    TOWER_FAST_TIMBER: new Color3(0.48, 0.32, 0.16),      // Dark log
    TOWER_FAST_TORSION: new Color3(0.65, 0.55, 0.35),     // Bronze spring
    TOWER_HEAVY_SIEGE: new Color3(0.58, 0.52, 0.45),      // Weathered stone
    TOWER_HEAVY_ARM: new Color3(0.55, 0.40, 0.22),        // Trebuchet wood
    TOWER_HEAVY_IRON: new Color3(0.35, 0.33, 0.35),       // Iron fittings
    TOWER_SNIPER_LIMESTONE: new Color3(0.80, 0.76, 0.70), // Pale spire stone
    TOWER_SNIPER_SLATE: new Color3(0.35, 0.32, 0.38),     // Roof slate
    TOWER_AOE_RUNE: new Color3(0.60, 0.28, 0.85),         // Purple rune glow
    TOWER_AOE_STONE: new Color3(0.45, 0.42, 0.48),        // Dark arcane stone
    TOWER_AOE_ORB: new Color3(0.72, 0.40, 0.95),          // Conjurer orb
} as const;
