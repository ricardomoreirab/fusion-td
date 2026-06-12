# Infinite Globe Map — Design Spec

**Date:** 2026-06-12
**Status:** Approved design, pending implementation plan

## Summary

Replace the bounded 25-unit circular arena with an **infinite flat plane rendered as a small globe**: the ground visibly curves away toward a horizon, and as the hero runs, terrain, props, and enemies roll over the curve — the world appears to rotate under the player. Gameplay math stays planar and unbounded; the globe is a **visual illusion only**. Enemies spawn at random angles just beyond the horizon and track the hero exactly as today.

## Decisions made (with user)

1. **Curved-world illusion**, not a true sphere simulation. All movement, AI, spawning, and co-op math remain flat-plane.
2. **Camera tilts back** to show the curved horizon and sky (enemies visibly crest the curve).
3. **World content:** infinite grass field + a recycled pool of low-poly props (rocks, ruined pillars, dead trees) that drift past and recycle ahead of the hero.
4. **Curvature implementation: CPU-side + owned shaders (Approach A).** No Babylon MaterialPlugin, no recompilation of frozen materials, no new shadow-depth shader variants. Rationale: materials are frozen and `blockMaterialDirtyMechanism = true`; the project has a documented history of cold-compile freezes and material leaks. Position writes don't dirty materials, so CPU offsets are safe by construction.

## The curvature model

Single source of truth — a pure function:

```
curveDrop(dx, dz, R) = (dx² + dz²) / (2R)
```

where `(dx, dz)` is the offset from the hero's flat position and `R` is the globe radius (tunable constant, initial guess **R ≈ 80**; tuned visually so the horizon sits ~35–40 units from the hero). Applied as a **negative Y offset relative to the hero**: things at the hero's feet are flat; things far away sink below the horizon. Lives in a new pure module (e.g. `src/survivors/globe/curvature.ts`) so it is Vitest-testable and shared by CPU consumers and as the reference for the grass shader's GLSL copy.

Optional polish (implement only if it reads well): pitch distant meshes by the curve tangent angle `atan(d/R)` so they lean over the horizon.

## Components

### 1. World & movement (unbounded plane)

- **Clamp removal:** `arenaRadius = Infinity` is passed through the existing paths (`HeroController`, host guest-ghost, guest input replay). `arenaClampScale()` in `src/survivors/integrateMove.ts` is untouched — with `Infinity` it always returns 1. All three movement consumers stay byte-identical in logic, preserving co-op prediction consistency.
- **Coordinates stay absolute and unbounded.** Verified: `src/net/SnapshotBinary.ts` encodes all positions as Float32 (no quantized range) — the co-op protocol needs **zero changes**. Float32 precision is ample for any realistic run distance (sub-millimeter error below ~16k units).
- **No origin re-centering** (YAGNI — revisit only if a run somehow exceeds tens of thousands of units).

### 2. Globe ground (replaces `buildSurvivorsArena()` ground disc)

- New module `src/survivors/globe/GlobeGround.ts`: a **pre-curved "planet cap" mesh** — a disc of visible-terrain radius ~60 units, tessellated, with vertex Y baked to `-curveDrop(d)` at build time. Built once per run, disposed in `exit()`.
- Each frame the cap **snaps to the hero's x/z** (it never rotates — the curve is radially symmetric).
- **Terrain slide:** the ground texture's UV offset is driven by hero position (`uOffset = heroPos / tileWorldSize`) so terrain visibly slides under the player. The existing `ProceduralGrassTexture` ground texture is reused; offset writes on a frozen `StandardMaterial` are safe (uniform update, no recompile — same class as the known-safe emissive writes).
- Keeps receiving shadows like the current ground disc.
- `Map.ts` / `buildSurvivorsArena()` callers switch to the new module; `getArenaRadius()` consumers are re-pointed (spawn ring gets its own constant, clamp gets `Infinity`).

### 3. Camera & horizon

- `HeroController` follow camera: lower and tilted back so the horizon + skybox are framed with the hero lower-center. Initial values: height ≈ 9, offset-Z ≈ −11 (desktop), tuned separately for mobile via the existing `getLayoutMode()` split. Final numbers come from in-browser tuning.
- The existing ruins skybox provides the sky above the curved horizon. **No fog** (stays disabled — incompatible with the projection per existing note); the curvature itself hides the world edge.
- Camera shake, lerp, and joystick behavior unchanged.

### 4. Grass treadmill (shader-side)

`src/engine/rendering/ProceduralGrass.ts` — we own this `ShaderMaterial`:

- Add `uHeroPos` uniform (already passes per-frame uniforms for torch, so the plumbing pattern exists).
- **Vertex shader wrap:** each blade's instance matrix stays static; the shader wraps the blade's world offset relative to the hero into a fixed square tile (toroidal wrap, tile size ≈ 2× visible radius), then applies the GLSL `curveDrop` so wrapped blades sink toward the horizon. Zero per-frame instance-buffer updates; the 8000-blade single draw call is preserved.
- Influencer displacement (hero/enemy push) and wind animation operate on the **wrapped** position so they keep working.

### 5. Prop treadmill (CPU-side)

New module `src/survivors/globe/PropField.ts`:

- Pool of **~16–24** low-poly props (3–4 variants: rock, broken pillar, dead tree), built once per run with `createLowPolyMaterial` through `getCachedMaterial` with **bounded keys** (variant name — never per-instance ids).
- Per-frame: any prop further than ~70 units from the hero **recycles** to a random position just beyond the horizon, biased to the hero's movement direction half-plane so props roll in over the curve ahead.
- Props get the CPU curvature Y-offset every frame.
- Props are **non-colliding decoration** (no pathing/obstacle logic — enemies and hero walk through; acceptable at this density, and avoids touching seek AI).
- Recycling logic is pure (positions in/out) → Vitest-covered. Disposed in `exit()`.

### 6. Enemies & spawning

- **Spawn ring:** `EnemyManager.spawnSurvivorsEnemy()` changes its ring radius from `arenaRadius + 2` to a `SPAWN_RING_RADIUS` constant ≈ horizon distance + small margin (~40 units). Random angle is already uniform — this is exactly the "monsters come from random places" requirement. Tracking is untouched (`seekTarget` / `resolveSeekTarget()` already follow the hero).
- **Curvature application (CPU):** each frame, after normal updates, a single pass applies `mesh.position.y_visual = baseY − curveDrop(distToHero)` to: enemies, power orbs (`PowerDrop`), item drops, and pooled projectiles. Implementation detail for the plan: keep gameplay Y (`baseY`) separate from rendered Y — either via a parent/offset node or by applying the offset to the mesh while hit/contact math uses flat positions. **Gameplay distances are always computed in flat space.**
- Damage numbers and health bars follow their mesh, so they inherit the offset for free.
- `OffscreenEnemyIndicators` keeps using true flat positions (unchanged).
- **Co-op:** the host simulates flat positions and snapshots them as today; the guest applies the same render-side curvature locally (pure cosmetic, satisfies the "cosmetic effects are gameplay-inert" invariant). `GuestEnemies` gets the same curvature pass.

### 7. Shadows

- The directional shadow generator's fixed ortho frustum (currently centered near the origin) must **follow the hero** — update the light's position/ortho center to the hero's x/z each frame (or snapped to a coarse grid to avoid shimmer). The torch shadow already follows (parented to the hero).
- No new shadow generators, no new caster categories → no new depth-shader compiles (prewarm path untouched).

## Error handling / invariants honored

- **No runtime material creation per frame**; props/ground use cached or run-owned materials; FX rules unchanged. The resource watchdog (`checkResourceBudget`) remains the guard and should stay silent.
- **No runtime lights** added.
- All new run state (globe ground, prop field) is owned by `SurvivorsGameplayState` and fully reset in `exit()`.
- Single-player and co-op share the identical render path (curvature is unconditional, not a co-op hook), so the "single-player stays byte-identical" co-op invariant is not implicated.

## Testing

**Vitest (pure logic):**
- `curvature.ts`: drop is 0 at the hero, monotonic in distance, matches `d²/2R`.
- `integrateMove` with `arenaRadius = Infinity`: clamp factor is always 1; existing bounded-arena specs still pass.
- Prop recycling: props beyond the recycle distance get repositioned beyond the horizon in the forward half-plane; props in range untouched.
- Spawn ring: spawn positions are at `SPAWN_RING_RADIUS` from the hero, angle-uniform.

**In-browser verification:**
- Run + observe: horizon curve visible, terrain/props/enemies crest the curve, grass treadmill seamless (no popping at the wrap boundary), no `[resource-watchdog]` logs across several waves, shadows stay attached far from origin.
- Co-op smoke test (`?host` / `?join`): guest sees identical curvature; reconciliation stable with the clamp removed.

## Out of scope (YAGNI)

- True sphere simulation, great-circle pathing.
- Biome variation / terrain height / obstacles with collision.
- Fog or atmospheric scattering.
- Origin re-centering for extreme run distances.
- Minimap.

## Tuning constants (single place, e.g. `src/survivors/globe/constants.ts`)

| Constant | Initial | Meaning |
|---|---|---|
| `GLOBE_RADIUS` (R) | 80 | Curvature radius of the illusion |
| `VISIBLE_TERRAIN_RADIUS` | 60 | Ground cap + grass tile half-size |
| `SPAWN_RING_RADIUS` | 40 | Enemy spawn distance from hero |
| `PROP_RECYCLE_DIST` | 70 | Distance behind hero at which props recycle |
| Camera height / offset-Z | 9 / −11 | Desktop framing (mobile tuned separately) |

All five are expected to change during visual tuning; the spec fixes their *roles*, not their final values.
