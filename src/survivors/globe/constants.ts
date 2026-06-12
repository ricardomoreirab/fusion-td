/** Tuning constants for the infinite globe-map illusion. Roles are fixed by the
 *  design spec (docs/superpowers/specs/2026-06-12-infinite-globe-map-design.md);
 *  values are expected to change during visual tuning. */
export const GLOBE_RADIUS = 80;            // curvature radius R of the illusion
export const VISIBLE_TERRAIN_RADIUS = 60;  // ground cap half-size (world units)
export const SPAWN_RING_RADIUS = 40;       // enemy spawn distance from hero (just past horizon)
export const PROP_RECYCLE_DIST = 70;       // props farther than this from the hero recycle ahead
export const GRASS_TILE_SIZE = 44;         // near grass treadmill tile edge (≈ old disc area → same density)
// Far-field grass layer — coarser blades filling the band between the near
// tile's edge (±22) and the terrain cap rim, which the isometric camera's
// telephoto lens magnifies. The radial fade clips it just past the rim
// (VISIBLE_TERRAIN_RADIUS): overhanging blades sink behind the crest, so the
// horizon line stays grassy without floating blades over open sky.
export const GRASS_FAR_TILE_SIZE = 130;    // covers the fade disc + wrap margin
export const GRASS_FAR_FADE_START = 56;    // full height up to here (dist from hero)
export const GRASS_FAR_FADE_END = 63;      // zero height past here (rim is at 60)
