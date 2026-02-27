export enum MapTheme {
    NEUTRAL = 'NEUTRAL',
    FIRE = 'FIRE',
    WATER = 'WATER',
    WIND = 'WIND',
    EARTH = 'EARTH'
}

export interface LevelConfig {
    levelNumber: number;
    name: string;
    theme: MapTheme;
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
    theme: MapTheme.NEUTRAL,
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
    theme: MapTheme.NEUTRAL,
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
    theme: MapTheme.NEUTRAL,
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

// Biome templates for procedural segments
const BIOME_TEMPLATES: { name: string; zones: { zone: number; condition: (x: number, y: number) => boolean }[] }[] = [
    {
        name: 'Forest Clearing',
        zones: [
            { zone: FOREST, condition: (x, y) => x < 6 || x > 14 },
            { zone: CRYSTAL_GROVE, condition: (x, y) => x >= 8 && x <= 12 && y >= 8 && y <= 12 }
        ]
    },
    {
        name: 'Highland Pass',
        zones: [
            { zone: ROCKY_HIGHLANDS, condition: (x, y) => y < 6 || y > 14 },
            { zone: FOREST, condition: (x, y) => x < 4 }
        ]
    },
    {
        name: 'Crystal Valley',
        zones: [
            { zone: CRYSTAL_GROVE, condition: (x, y) => x > 10 },
            { zone: ROCKY_HIGHLANDS, condition: (x, y) => x < 5 && y < 10 }
        ]
    },
    {
        name: 'Enchanted Meadow',
        zones: [
            { zone: FOREST, condition: (x, y) => x < 4 && y < 8 },
            { zone: CRYSTAL_GROVE, condition: (x, y) => x > 15 && y > 12 },
            { zone: ROCKY_HIGHLANDS, condition: (x, y) => x > 12 && y < 5 }
        ]
    }
];

const SEGMENT_NAMES = [
    'Verdant Passage', 'Scorched Trail', 'Crystal Corridor', 'Twilight Path',
    'Shattered Crossing', 'Mystic Reach', 'Iron Gorge', 'Ember Road',
    'Frozen Glade', 'Abyssal Stretch', 'Sunken Pathway', 'Storm Ridge'
];

const THEME_CYCLE: MapTheme[] = [MapTheme.FIRE, MapTheme.WATER, MapTheme.WIND, MapTheme.EARTH];

const THEME_SEGMENT_NAMES: Record<MapTheme, string[]> = {
    [MapTheme.NEUTRAL]: SEGMENT_NAMES,
    [MapTheme.FIRE]: ['Ember Road', 'Cinder Path', 'Lava Crossing', 'Inferno Trail'],
    [MapTheme.WATER]: ['Tidal Corridor', 'Coral Passage', 'Flood Channel', 'Mist Walk'],
    [MapTheme.WIND]: ['Gale Ridge', 'Zephyr Heights', 'Breeze Plateau', 'Storm Pass'],
    [MapTheme.EARTH]: ['Dust Canyon', 'Quarry Descent', 'Bedrock Trail', 'Amber Gorge']
};

// Biome templates favored per theme (index into BIOME_TEMPLATES)
const THEME_BIOME_PREFERENCE: Record<MapTheme, number[]> = {
    [MapTheme.NEUTRAL]: [0, 1, 2, 3],
    [MapTheme.FIRE]: [1, 2],      // Highland Pass, Crystal Valley (rocky/mineral)
    [MapTheme.WATER]: [0, 3],      // Forest Clearing, Enchanted Meadow (lush)
    [MapTheme.WIND]: [3, 0],       // Enchanted Meadow, Forest Clearing (open)
    [MapTheme.EARTH]: [1, 2]       // Highland Pass, Crystal Valley (rocky)
};

/**
 * Generate a procedural LevelConfig for an infinite-mode segment.
 *
 * @param segmentIndex Which procedural segment this is (0 = first procedural, i.e. second overall)
 * @param previousEndX The x-coordinate of the previous segment's end position
 */
export function generateProceduralLevelConfig(segmentIndex: number, previousEndX: number): LevelConfig {
    // Seeded-ish randomness using segment index for variety
    const rand = () => Math.random();
    const randInt = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));

    // Start position: match previous segment's end x, always at y=0
    const startX = Math.max(1, Math.min(18, previousEndX));
    const startPosition = { x: startX, y: 0 };

    // Generate waypoints: alternating horizontal/vertical moves
    const waypoints: { x: number; y: number }[] = [{ x: startX, y: 0 }];
    let curX = startX;
    let curY = 0;
    const numSegments = randInt(8, 12);
    let isHorizontal = true; // Start with horizontal move

    for (let i = 0; i < numSegments - 1; i++) {
        if (isHorizontal) {
            // Horizontal move
            const moveLen = randInt(4, 10);
            const direction = rand() < 0.5 ? -1 : 1;
            let newX = curX + direction * moveLen;
            // Clamp within bounds
            newX = Math.max(1, Math.min(18, newX));
            // If we'd barely move, go the other way
            if (Math.abs(newX - curX) < 3) {
                newX = curX + (-direction) * moveLen;
                newX = Math.max(1, Math.min(18, newX));
            }
            curX = newX;
        } else {
            // Vertical move (toward y=19)
            const moveLen = randInt(3, 6);
            let newY = curY + moveLen;
            // Don't overshoot y=18 until final segment
            newY = Math.min(18, newY);
            if (newY <= curY) newY = curY + 2; // Always move forward
            newY = Math.min(18, newY);
            curY = newY;
        }
        waypoints.push({ x: curX, y: curY });
        isHorizontal = !isHorizontal;
    }

    // Final segment: go straight to y=19 for connectivity
    if (curY < 19) {
        waypoints.push({ x: curX, y: 19 });
    }

    const endPosition = { x: curX, y: 19 };

    // Pick theme from cycle
    const theme = THEME_CYCLE[segmentIndex % THEME_CYCLE.length];

    // Pick a biome template favored by theme
    const preferred = THEME_BIOME_PREFERENCE[theme];
    const biomeIdx = preferred[segmentIndex % preferred.length];
    const biome = BIOME_TEMPLATES[biomeIdx];

    // 50% chance of a river (always for water theme, never skipped for fire — it becomes lava)
    let river: LevelConfig['river'] = null;
    if (theme === MapTheme.WATER || rand() < 0.5) {
        const riverY = randInt(5, 14);
        const riverPoints: { x: number; y: number }[] = [];
        for (let rx = 0; rx < 20; rx++) {
            riverPoints.push({ x: rx, y: riverY });
        }
        river = {
            points: riverPoints,
            widenDirection: rand() < 0.5 ? -1 : 1
        };
    }

    // Money bonus scales with segment index
    const moneyBonus = 100 + segmentIndex * 50;

    const themeNames = THEME_SEGMENT_NAMES[theme];
    const nameIndex = segmentIndex % themeNames.length;
    const cycle = Math.floor(segmentIndex / themeNames.length) + 1;
    const name = `${themeNames[nameIndex]}${cycle > 1 ? ' ' + cycle : ''}`;

    return {
        levelNumber: segmentIndex + 2, // 1-indexed, segment 0 = level 2
        name,
        theme,
        startPosition,
        endPosition,
        waypoints,
        terrainZoneRules: biome.zones,
        river,
        moneyBonus
    };
}
