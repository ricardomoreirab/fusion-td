export interface LevelConfig {
    levelNumber: number;
    name: string;
    waypoints: { x: number; y: number }[];
    startPosition: { x: number; y: number };
    endPosition: { x: number; y: number };
    terrainZoneRules: { zone: number; condition: (x: number, y: number) => boolean }[];
    river: { points: { x: number; y: number }[]; widenDirection: number } | null;
    moneyBonus: number;
}

// Terrain zone enum values (must match Map.ts TerrainZone)
const MEADOW = 0;
const ROCKY_HIGHLANDS = 1;
const FOREST = 2;
const RIVERSIDE = 3;
const CRYSTAL_GROVE = 4;

/**
 * Level 1 — "The Enchanted Forest"
 * Current map preserved exactly: path enters from forest (0,3), winds through meadow,
 * crosses river, traverses highlands, exits at crystal grove (19,16).
 */
export const LEVEL_1: LevelConfig = {
    levelNumber: 1,
    name: 'The Enchanted Forest',
    startPosition: { x: 0, y: 3 },
    endPosition: { x: 19, y: 16 },
    waypoints: [
        { x: 0, y: 3 },
        { x: 3, y: 3 },
        { x: 3, y: 7 },
        { x: 7, y: 7 },
        { x: 7, y: 12 },
        { x: 4, y: 12 },
        { x: 4, y: 16 },
        { x: 9, y: 16 },
        { x: 9, y: 13 },
        { x: 12, y: 13 },
        { x: 12, y: 8 },
        { x: 15, y: 8 },
        { x: 15, y: 4 },
        { x: 17, y: 4 },
        { x: 17, y: 10 },
        { x: 19, y: 10 },
        { x: 19, y: 16 }
    ],
    terrainZoneRules: [
        { zone: FOREST, condition: (x, y) => x < 5 && y < 8 },
        { zone: ROCKY_HIGHLANDS, condition: (x, y) => x > 12 && y < 7 },
        { zone: CRYSTAL_GROVE, condition: (x, y) => x > 15 && y > 13 }
        // RIVERSIDE is handled by isNearRiver; MEADOW is the default
    ],
    river: {
        points: [
            { x: 17, y: 0 }, { x: 16, y: 1 }, { x: 15, y: 2 }, { x: 14, y: 3 },
            { x: 14, y: 4 }, { x: 13, y: 5 }, { x: 13, y: 6 }, { x: 12, y: 7 },
            { x: 11, y: 8 }, { x: 11, y: 9 }, { x: 10, y: 10 }, { x: 10, y: 11 },
            { x: 9, y: 12 }, { x: 8, y: 13 }, { x: 8, y: 14 }, { x: 7, y: 15 },
            { x: 6, y: 16 }, { x: 6, y: 17 }, { x: 5, y: 18 }, { x: 4, y: 19 }
        ],
        widenDirection: -1 // widen to the left (x-1)
    },
    moneyBonus: 0
};

/**
 * Level 2 — "The Scorched Highlands"
 * Path enters mid-left, snakes south with switchbacks, exits upper-right.
 * Predominantly rocky highlands terrain. No river.
 */
export const LEVEL_2: LevelConfig = {
    levelNumber: 2,
    name: 'The Scorched Highlands',
    startPosition: { x: 0, y: 10 },
    endPosition: { x: 19, y: 5 },
    waypoints: [
        { x: 0, y: 10 },
        { x: 4, y: 10 },
        { x: 4, y: 16 },
        { x: 10, y: 16 },
        { x: 10, y: 12 },
        { x: 6, y: 12 },
        { x: 6, y: 6 },
        { x: 10, y: 6 },
        { x: 10, y: 2 },
        { x: 14, y: 2 },
        { x: 14, y: 8 },
        { x: 17, y: 8 },
        { x: 17, y: 5 },
        { x: 19, y: 5 }
    ],
    terrainZoneRules: [
        { zone: ROCKY_HIGHLANDS, condition: (x, y) => x > 10 || y < 5 },
        { zone: FOREST, condition: (x, y) => x < 3 && y > 12 },
        { zone: CRYSTAL_GROVE, condition: (x, y) => x > 16 && y > 14 }
    ],
    river: null,
    moneyBonus: 150
};

/**
 * Level 3 — "The Crystal Abyss"
 * Path enters top-center, winds west then east, exits bottom-center.
 * Full crystal grove theme. Horizontal river at y=6.
 */
export const LEVEL_3: LevelConfig = {
    levelNumber: 3,
    name: 'The Crystal Abyss',
    startPosition: { x: 10, y: 0 },
    endPosition: { x: 10, y: 19 },
    waypoints: [
        { x: 10, y: 0 },
        { x: 10, y: 3 },
        { x: 4, y: 3 },
        { x: 4, y: 7 },
        { x: 8, y: 7 },
        { x: 8, y: 10 },
        { x: 2, y: 10 },
        { x: 2, y: 14 },
        { x: 8, y: 14 },
        { x: 8, y: 17 },
        { x: 14, y: 17 },
        { x: 14, y: 13 },
        { x: 16, y: 13 },
        { x: 16, y: 17 },
        { x: 10, y: 17 },
        { x: 10, y: 19 }
    ],
    terrainZoneRules: [
        { zone: CRYSTAL_GROVE, condition: (x, y) => x > 14 || (x > 10 && y < 5) },
        { zone: ROCKY_HIGHLANDS, condition: (x, y) => x < 3 && y > 14 },
        { zone: FOREST, condition: (x, y) => x < 4 && y < 3 }
    ],
    river: {
        points: [
            { x: 0, y: 6 }, { x: 1, y: 6 }, { x: 2, y: 6 }, { x: 3, y: 6 },
            { x: 4, y: 6 }, { x: 5, y: 6 }, { x: 6, y: 6 }, { x: 7, y: 6 },
            { x: 8, y: 6 }, { x: 9, y: 6 }, { x: 10, y: 6 }, { x: 11, y: 6 },
            { x: 12, y: 6 }, { x: 13, y: 6 }, { x: 14, y: 6 }, { x: 15, y: 6 },
            { x: 16, y: 6 }, { x: 17, y: 6 }, { x: 18, y: 6 }, { x: 19, y: 6 }
        ],
        widenDirection: 1 // widen downward (y+1)
    },
    moneyBonus: 250
};

export const ALL_LEVELS: LevelConfig[] = [LEVEL_1, LEVEL_2, LEVEL_3];
