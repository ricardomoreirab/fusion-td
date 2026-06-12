/** Tuning constants for the infinite globe-map illusion. Roles are fixed by the
 *  design spec (docs/superpowers/specs/2026-06-12-infinite-globe-map-design.md);
 *  values are expected to change during visual tuning. */
export const GLOBE_RADIUS = 80;            // curvature radius R of the illusion
export const VISIBLE_TERRAIN_RADIUS = 60;  // ground cap half-size (world units)
export const SPAWN_RING_RADIUS = 40;       // enemy spawn distance from hero (just past horizon)
export const PROP_RECYCLE_DIST = 70;       // props farther than this from the hero recycle ahead
export const GRASS_TILE_SIZE = 44;         // grass treadmill tile edge (≈ old disc area → same density)
