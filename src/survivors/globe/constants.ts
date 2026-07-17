/** Tuning constants for the infinite globe-map illusion. Roles are fixed by the
 *  design spec (docs/superpowers/specs/2026-06-12-infinite-globe-map-design.md);
 *  values are expected to change during visual tuning. */
export const GLOBE_RADIUS = 80;            // curvature radius R of the illusion
export const VISIBLE_TERRAIN_RADIUS = 95;  // ground cap half-size — large enough that its square edge sinks below the curved horizon (never visible)
export const SPAWN_RING_RADIUS = 40;       // enemy spawn distance from hero (just past horizon)
export const PROP_RECYCLE_DIST = 70;       // props farther than this from the hero recycle ahead
export const GRASS_TILE_SIZE = 44;         // near grass treadmill tile edge (≈ old disc area → same density)
// Far-field grass layer — coarser blades carpeting the WHOLE visible ground out
// to (and past) the terrain-cap edge, so the camera never sees a bare-ground
// "square" boundary. The fade now lives BEYOND the visible horizon: blades keep
// full height across the entire cap and only collapse where the globe curvature
// has already sunk them out of view, so the fade itself is never seen.
export const GRASS_FAR_TILE_SIZE = 200;    // blades cover ±100 — past the cap corners (±95 square)
export const GRASS_FAR_FADE_START = 88;    // full height up to here (dist from hero)
export const GRASS_FAR_FADE_END = 102;     // zero height past here — already below the horizon

// ── Horizon distance fog ─────────────────────────────────────────────────────
// Linear fog that blends the finite (square) terrain cap + the grass-fade seam
// into the sky's horizon band when the camera is zoomed out (and gently even at
// default zoom). Distances are CAMERA distance (THREE.Fog near/far) - measured
// at DEFAULT zoom; the gameplay layer shifts the band outward as the camera
// recedes with zoom (HeroController.getCameraDistanceFromDefault) so the hero +
// spawn ring stay crisp. Tune START/END by eye in a zoomed-out playtest:
// raise END to push the haze farther out, lower START for a thicker horizon.
// Atmospheric horizon blend only: the square edge is now hidden structurally
// (grass + cap extend past the horizon), so fog's only job is to melt the FAR
// grass into the sky band — not to hide a hard edge. Keep it past the play area.
// 60/92 put the onset arc MID-FIELD at high zoom: the linear ramp's kink at
// fog.near sliced the ground in a visible ellipse around the hero ("weird
// circles" bug). 80/112 hugs the band to the dome's horizon rim where it blends
// into the sky; the far-grass fade (88-102 world units ≈ 110+ camera units) and
// the ±95 cap edge still land fully inside the haze.
export const FOG_START = 80;   // camera-distance where haze begins
export const FOG_END   = 112;  // fully hazed beyond here — far grass dissolves into the sky
// Matches the GlobeSky horizon band (GlobeSky.ts `horizon`) so ground/grass melt
// into the sky rather than into a flat grey. A tuple keeps this module
// dependency-free (no 'three' import).
export const FOG_COLOR_RGB: [number, number, number] = [0.68, 0.55, 0.66];
