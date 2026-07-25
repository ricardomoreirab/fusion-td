/**
 * Tuning constants for the rebuilt world. Dependency-free so tests and the pure
 * iso math can import it.
 *
 * Sizing is driven by one number: the camera's visible ground half-diagonal,
 * which at the widest supported framing (ISO_VIEW_HEIGHT 28 × ISO_ZOOM_MAX 1.35
 * on 16:9) is about 38.5 world units. Everything below is derived from that
 * with headroom, so a framing change is a one-line edit here rather than a hunt
 * through five modules.
 */

/**
 * Distance from the hero at which enemies spawn.
 *
 * Gameplay, not scenery: EnemyManager reads this. It lives here because the
 * Vampire Survivors contract ("enemies always enter from off-screen") couples it
 * to the camera's visible extent — see isoProjection.isSpawnRingOffscreen, which
 * asserts the frame half-diagonal stays inside this radius.
 */
export const SPAWN_RING_RADIUS = 40;

/** Widest ground half-diagonal the camera can show. See isoProjection. */
export const VIEW_HALF_DIAGONAL_MAX = 39;

/**
 * Edge length of the terrain quad. Generous headroom over the frame corner so
 * ultrawide aspect ratios and a zoomed-out co-op framing can never expose an
 * edge. Fragment cost does not scale with world size (it is 2 triangles), so
 * the only cost of being generous here is shadow-frustum coverage.
 */
export const TERRAIN_EXTENT = 260;

/**
 * Ground-scatter treadmill tile. Scatter is distributed across a square tile
 * centred on the hero and recycled as the hero leaves it, so this must comfortably
 * exceed the frame corner or tufts will visibly pop in at the screen edge.
 */
export const SCATTER_TILE = 80;

/** Base instance counts per scatter layer at graphics quality "high". Biome
 *  density multipliers scale these; quality tiers scale them again. */
export const SCATTER_TUFTS_HIGH = 6200;
export const SCATTER_DEBRIS_HIGH = 1800;

/** Quality-tier multipliers applied to the counts above. */
export const SCATTER_QUALITY_SCALE: Record<string, number> = {
    low: 0.28,
    medium: 0.6,
    high: 1.0,
};

/**
 * Landmark props.
 *
 * PROP_ACTIVE_* is deliberately small. The Tripo-generated landmarks floor out
 * at ~39k triangles each (their meshes are disconnected shells, so meshoptimizer
 * cannot collapse them further), which makes each visible instance expensive.
 * Five on desktop is ~200k triangles worst case, inside the 750k budget; three
 * on mobile keeps it inside 300k. See the technical-art budget in the report.
 */
export const PROP_ACTIVE_DESKTOP = 5;
export const PROP_ACTIVE_MOBILE = 3;

/**
 * Ring props are RECYCLED onto, as a fraction of the frame half-diagonal.
 * Just outside the frame so they stream in as the hero advances rather than
 * popping into view, but close enough that the hero reaches them quickly.
 */
export const PROP_SPAWN_RING_MIN = 1.05;
export const PROP_SPAWN_RING_MAX = 1.5;
/** Recycle a prop once it drifts past this multiple of the frame half-diagonal. */
export const PROP_RECYCLE_RING = 1.9;

/**
 * Ring used for the FIRST fill only, which deliberately straddles the frame.
 *
 * Seeding every prop outside the view (as the recycle ring does) meant a player
 * standing still at wave 1 saw an empty field — the landmarks existed but were
 * all off-screen, defeating the one job they have. The initial fill therefore
 * places some inside the frame, just never on top of the hero.
 */
export const PROP_INITIAL_RING_MIN = 0.35;
export const PROP_INITIAL_RING_MAX = 1.4;

/**
 * Minimum separation between a landmark prop and the hero's spawn point, and
 * between props. Landmarks are the orientation anchors (design doc): clumping
 * them defeats the purpose, and one landing on the hero would occlude play.
 */
export const PROP_MIN_SEPARATION = 14;

/** Vertical cap on anything placed near the play area. The readability promise
 *  forbids props that can hide a threat. */
export const PROP_MAX_HEIGHT = 4.0;

/** Ground mist plane size and height.
 *  Under orthographic projection a translucent horizontal plane covers the WHOLE
 *  frame uniformly — there is no horizon for it to hug — so it acts as a flat
 *  grey wash over everything. Opacity must stay low or it destroys the contrast
 *  the readability promise depends on. */
export const MIST_EXTENT = 150;
export const MIST_HEIGHT = 0.38;

/** Seconds the biome cross-fade takes to ease toward its target. Decoupled from
 *  the wave counter so an integer wave step still reads as a smooth grade. */
export const BIOME_EASE_SECONDS = 4.0;

/** Contact-shadow blob radius multiplier and opacity. */
export const CONTACT_SHADOW_OPACITY = 0.42;
