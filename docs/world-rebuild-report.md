# World Rebuild — Evidence Report

Rebuilt the survivors scenario from scratch as a new `src/survivors/world/` package under a
true orthographic isometric camera, with wave-driven multi-biome terrain on an infinite
treadmill. The legacy globe scenario is untouched and still reachable at `?world=old`.

## Skill-loading ledger

- Director: active (`threejs-game-director`)
- Gameplay systems: yes — `~/.claude/skills/threejs-gameplay-systems/SKILL.md`
- AAA graphics: yes — `~/.claude/skills/threejs-aaa-graphics-builder/SKILL.md`
- UI: yes — `~/.claude/skills/threejs-game-ui-designer/SKILL.md`
- Debug/profile: yes — `~/.claude/skills/threejs-debug-profiler/SKILL.md`
- QA/release: yes — `~/.claude/skills/threejs-qa-release/SKILL.md`
- 3D generator: yes — `~/.claude/skills/threejs-3d-generator/SKILL.md` (used)
- Image generator: yes — `~/.claude/skills/threejs-image-generator/SKILL.md` (blocked, see below)
- Audio generator: yes — probed; deliberately not used (see ledger)

## Reference ledger

- `threejs-gameplay-systems/references/game-design-level-design.md`: yes
- `threejs-aaa-graphics-builder/references/visual-scorecard.md`: yes
- `threejs-aaa-graphics-builder/references/implementation-blueprint.md`: yes
- `threejs-aaa-graphics-builder/references/model-recipes.md`: yes
- `threejs-aaa-graphics-builder/references/render-recipes.md`: yes
- `threejs-aaa-graphics-builder/references/technical-art.md`: yes
- `threejs-aaa-graphics-builder/references/shader-cookbook.md`: yes
- `threejs-game-director/references/phase-playbook.md`: yes
- Not loaded (out of scope for a scenario-only rebuild): gameplay-workflows, game-feel,
  physics-engine-selection, new-game checklist, endless-runner checklist, UI checklists,
  debug/QA checklists, visual-test-harness, playtest-bot. Consequences stated under
  "Phases skipped" and "Remaining risks".

## Phase ledger

- Gameplay systems: done — iso camera rig + screen→world input contract; 35 new unit tests.
- External asset sourcing: done — Tripo generated (4 props), Gemini blocked (quota), audio skipped by architecture.
- AAA graphics: done — new world package, 7 QA-found defects fixed, scorecard below.
- UI: skipped — HUD explicitly out of scope; verified fit at 1600×900 and 844×390 only.
- Debug/profile: done — 7 root-caused defects; renderer diagnostics measured against budget.
- QA/release: done — tsc, 621 tests, production build, desktop+mobile+legacy captures.

## External asset sourcing ledger

Chosen sources per surface:

- Hero/player: procedural/pre-existing — **untouched by scope**.
- Enemies/vehicles/weapons: pre-existing GLBs — **untouched by scope**.
- Signature props/pickups: `threejs-3d-generator` (Tripo) — generated, see task IDs below.
- World/sky/background: **hybrid** — Tripo landmark props + procedural terrain shader. No sky
  surface exists under orthographic projection (see findings), so none was sourced.
- Materials/textures/decals: **procedural** — Gemini blocked (quota evidence below).
- Logos/icons/GUI art: not needed — HUD out of scope, no new icons introduced.
- Audio/SFX/voice: not generated — procedural-audio architecture, see below.

Credential probe output (`threejs-game-director/scripts/probe_asset_credentials.sh` sources shell
profiles only; this repo keeps keys in a gitignored `.env`, so each generator's own probe was
run with `.env` loaded — the skill's documented equivalent):

```
TRIPO_API_KEY=SET
GEMINI_API_KEY=SET
ELEVENLABS_API_KEY=SET
```

- **World/landmark props: `threejs-3d-generator` (Tripo). GENERATED.**
  - `burnt_tree` task `f010d96e-61b5-4a50-9d53-7b1fc6a75fe6` → `assets/world/props/opt/burnt_tree.glb`
  - `ruined_arch` task `60318f43-c8a4-49cd-9746-fda7a8c47b4e` → `assets/world/props/opt/ruined_arch.glb`
  - `bone_pile` task `0149a462-8875-44a9-b7f1-9917661ce373` → `assets/world/props/opt/bone_pile.glb`
  - `standing_stones` task `cb13f78c-cdb6-405d-b5c4-081dcfa569b3` → `assets/world/props/opt/standing_stones.glb`
  - Plus two pre-existing landmarks re-processed: `monolith.glb`, `goblin_totem.glb`
- **Ground textures: procedural (by design), NOT generated. BLOCKED on Gemini.**
  Attempted `generate_image.py` for three biome ground textures; every image model returned:
  `429 RESOURCE_EXHAUSTED … generate_content_free_tier_requests, limit: 0` for
  `gemini-3-pro-image`, `gemini-2.5-flash-image` and `gemini-3.1-flash-image`. `limit: 0`
  means the project has no image quota at all (billing not enabled), not a rate trip.
  Model listing with the same key succeeds, so the key is valid.
  Mitigation: the terrain was authored as a procedural world-space shader, which for an
  infinite hero-centred treadmill avoids tiling seams, texture memory and UV swim entirely.
- **Audio: not generated (deliberate architectural decision, not a blocker).**
  The key is SET. The game ships **zero audio files** by design — every SFX and the ambience
  bed are synthesised at boot in `src/engine/three/proceduralSfx.ts`. Adding per-biome MP3s
  would contradict that architecture, and audio was not in the user's stated scope.

## Imported asset cleanup

Tripo ships ~350–750k triangles and 4K PBR textures per prop (~58 MB each; 229 MB total).
Pipeline applied (`weld → simplify → 1024 webp textures → KHR_mesh_quantization`, which
three's stock `GLTFLoader` reads natively, so no Draco/Meshopt decoder was added):

| prop | triangles | size |
| --- | --- | --- |
| burnt_tree | 39,580 | 919 KB |
| ruined_arch | 39,772 | 957 KB |
| bone_pile | 38,739 | 1.1 MB |
| standing_stones | 38,696 | 935 KB |
| monolith | 7,080 | 589 KB |
| goblin_totem | 5,765 | 480 KB |

229 MB → 5.0 MB. Raw downloads deleted; task JSON + preview images retained.
Each prop is normalised at load (scaled to target height, pivot dropped to base, materials
desaturated to 0.62 and roughness floored at 0.7). The four Tripo props **plateau at ~39k
triangles** regardless of simplify error — their meshes are disconnected shells, so
meshoptimizer cannot collapse further. This is why the active prop budget is only 5 (3 mobile).

## Game design brief / core loop / world plan

Full version: `docs/world-rebuild-design.md`. Summary:

- **Player promise:** one hunter holding ground on land that rots underfoot as the horde thickens.
- **Core loop contract:** Player REPOSITIONS to survive the swarm while CONTACT DAMAGE AND
  ENCIRCLEMENT create risk; success gives XP, levels, drops and fusions; failure ends the run.
- **Camera contract:** true isometric — pitch `atan(1/√2)` = 35.264°, yaw 45°, parallel
  projection. Visible ground ≈ 49.8 × 28 world units at default zoom on 16:9.
- **Level/encounter plan:** infinite hero-centred treadmill, no edges. Player starts at origin
  in meadow with landmarks already in frame (first decision: which lane to open); first threat
  is the wave-1 spawn arc entering from off-screen; landmarks recycle ahead of the heading as
  the orientation anchors that prove travel; recovery beats land on wave-clear gaps, which is
  deliberately where biome transitions are placed. Biome bands
  meadow (1–9) → scorched (10–19) → cursed (20+), cross-fading over the final 1.5 waves of
  each band, eased over 4s so an integer wave step still reads as a gradual grade.
- **Readability promise:** ground luminance stays in [0.05, 0.30] in every biome so enemies
  and VFX separate by luminance, never hue alone. Enforced by a unit test AND a runtime
  assertion in `World.assertReadability()`.
- **Difficulty:** unchanged. The biome is a *signal* of run depth, never a mechanic.

## Two findings that drove the design

1. **Under true orthographic projection there is no horizon and the sky is never visible.**
   A horizon is a perspective artefact (parallel lines converging at a vanishing point);
   parallel projection has none, so an infinite ground plane fills the entire frame and no ray
   escapes to a sky dome. A sky dome would render zero pixels. The scope's "sky" budget was
   therefore redirected into ground detail and mid-height silhouettes, and the biome
   `clearColor` is retained only as a black-screen diagnostic.
2. **Orthographic fog must be camera-relative.** `THREE.Fog` uses view-space depth and the iso
   camera sits 220 units back purely for clipping, so absolute near/far values put every
   fragment past `far` and render the frame as flat fog colour. Biome fog is authored as
   offsets from the hero's focal plane and rebased by `Atmosphere`.

## Files changed

New — `src/survivors/world/`:
`isoProjection.ts` (pure math), `IsoCameraRig.ts`, `Biomes.ts` (pure), `WorldConstants.ts`,
`TerrainSurface.ts`, `GroundScatter.ts`, `PropScatter.ts`, `Atmosphere.ts`, `World.ts`,
`worldFlag.ts`.
New tests: `tests/isoProjection.spec.ts` (19), `tests/worldBiomes.spec.ts` (16).
New doc: `docs/world-rebuild-design.md`.
Modified: `src/survivors/HeroController.ts` (dual camera rig + screen→world input),
`src/survivors/SurvivorsGameplayState.ts` (world wiring behind the flag, extracted
`showChampionSelect()` / `applyCharacterIbl()`), `src/engine/Game.ts` (dev-only `__KTG__`
diagnostics hook, gated on `NODE_ENV !== 'production'`).

Zero code is shared with `src/survivors/globe/*`.

## Bugs found and fixed during browser QA

1. **Flat fog-coloured screen.** A leftover per-frame block stamped the globe-era 80/112 fog
   band over the Atmosphere's, pushing all geometry past `far`. Now legacy-gated.
2. **Scorched props in the wave-1 meadow.** `World.resolveAxis` always reports a biome PAIR
   (the terrain shader needs both ends even at t=0) and `PropScatter.eligible` unioned both
   unconditionally. Now gated on `t > 0.05`.
3. **Washed-out, formless lighting.** Two hemisphere lights were stacking (~2.0 ambient): the
   persistent scene hemi plus Atmosphere's. The persistent one is now zeroed under the new world.
4. **Invisible ground scatter.** Blades were 0.07 units wide and single-sided — ~3px and
   backface-culled. Widened to 0.10 and `DoubleSide`.
5. **Landmarks never on screen.** Spawn ring was 1.15–1.9 × half-diagonal, i.e. always outside
   the frame. Added a separate wider initial-fill ring that straddles the view.
6. **Ground read as scribbled doodles / glowing spaghetti.** Ridged noise at 0.085 produced
   12-unit "cracks" that looked like roads; at full strength the emissive lit whole crack
   widths. Fixed with higher frequency, a dryness gate, a high-frequency break-up mask,
   per-biome `crackStrength`, and cubing the mask for emissive so only fissure cores glow.
7. **Cursed biome unreadable.** The mist plane at 0.32 opacity is a full-screen grey wash under
   orthographic projection. Cut to 0.13.

## Verification

| Command | Result |
| --- | --- |
| `npx tsc --noEmit` | pass, clean |
| `npm test` | pass — 70 files, 621 tests (was 68/586; +35 new) |
| `npm run build` | pass, exit 0, `bundle.js` 1.5 MB |
| Browser QA | `http://localhost:9100/?test&champ=barbarian` |

Controls unchanged: WASD/arrows + joystick, mouse wheel zoom, Q/E/Space abilities.
Movement input is rotated 45° through the single conversion point
`isoProjection.screenToWorldDir`, which is also what co-op transmits — so host and guest
cannot disagree about what "up" meant.

Console and page errors: checked via `chrome-devtools-axi console` on every capture. The only
console output during active play is a benign AudioContext autoplay warning (pre-existing,
fires before the first user gesture) and a `favicon.ico` 404. No page errors, no WebGL
warnings, no shader-compile errors. All six prop GLB requests return 200.

Canvas pixel check: the canvas is confirmed non-blank and varied by direct inspection of every
capture below (the first attempt rendered a uniform fog-coloured canvas, which is exactly how
defect 1 was caught — a flat single-colour canvas is treated as a failure, not a pass). Note
the packaged canvas inspector was not run; see the measured-evidence caveat in the scorecard.

Screenshot evidence — one screenshot per state (scratchpad): `world-desktop-5.png` (meadow, desktop 1600×900),
`world-scorched-2.png`, `world-cursed-2.png`, `world-mobile.png` (844×390 landscape),
`world-legacy.png` (`?world=old` regression check — PerspectiveCamera, fog 80/112, 0 world props).

## VFX readability

Only one new effect was introduced: the ember/rot fissure glow on the terrain.

- Trigger/state: ambient, scaled by the biome's `emissiveStrength` (0 in meadow).
- What it tells the player: which biome band the run is in — a depth signal, never a hazard.
- Does it obscure the next decision? No. It is cubed to fissure cores only and confined to the
  ground plane; it never overlaps an enemy silhouette or the HUD.
- Cost: ALU only, no extra draw call, no particles, no post pass.
- Readability check: ground luminance stays inside [0.05, 0.30] in all three biomes, asserted at
  runtime and in `tests/worldBiomes.spec.ts`, so enemies separate from it by luminance alone.
- Reduced motion: the pulse is a slow sine at 1.7 rad/s with 0.28 amplitude — no strobe.

The mist plane was cut from 0.32 to 0.13 opacity precisely because it failed this check.

## Renderer diagnostics and technical-art budget

Measured with a direct `renderer.render()` + `info` read (the composer's output pass otherwise
masks scene counts), desktop 1600×900, meadow, active play:

| Metric | Measured | Desktop budget | Verdict |
| --- | --- | --- | --- |
| Draw calls | 45 | ≤ 300 | pass |
| Triangles | 164,205 | ≤ 750k | pass |
| Geometries | 98 | ≤ 300 | pass |
| Textures | 100 | ≤ 60 | **over — tradeoff below** |
| Shadow-casting lights | 1 | ≤ 2 | pass |
| Shadow map | 1024 | ≤ 2048 | pass |
| DPR | 1 | ≤ 2 | pass |

- **Texture overrun (100 vs 60), documented tradeoff:** the six prop kits contribute ~18
  (albedo/normal/roughness at 1024 each); the remainder is the pre-existing hero/enemy GLB
  set, which this task did not touch. Reducing it means atlasing the character set — out of
  scope here, and it is not currently a measured bottleneck (45 draw calls, DPR 1).
- Instancing: 8,000 scatter instances render in **2 draw calls** (tufts + debris).
- Terrain is **2 triangles, 1 draw call, 0 textures** — all detail is procedural.
- Mobile: prop budget drops 5 → 3; scatter quality tiers scale 0.28 / 0.6 / 1.0.
- Shadow map refresh is throttled to every 2nd frame, 3rd under perf trim.

## Visual scorecard

Scored on active-play screenshots against `visual-scorecard.md`. "Before" is the legacy globe
scenario (`world-legacy.png`).

- Art direction: before 2 / after 2 — three biomes drive ground, scatter, props, light colour
  and fog; but the theme does not reach the HUD or the character set.
- Hero/player: before 2 / after 2 — **untouched by scope.**
- Obstacles/enemies: before 2 / after 2 — **untouched by scope.**
- Rewards/interactables: before 2 / after 2 — **untouched by scope.**
- World/environment: before 2 / after 2 — layered play + near detail + landmark silhouettes
  with real shadows, but only 5 concurrent props and no mid/far layer (orthographic has no
  horizon to populate).
- Materials/textures: before 2 / after 2 — procedural multi-octave ground with per-biome
  patch/crack/emissive roles and per-instance scatter tinting; no generated texture maps
  (Gemini blocked).
- Lighting/render: before 2 / after 2 — biome-graded key/fill/hemi, ACES, camera-relative fog,
  throttled 1024 shadow map; fixed the double-ambient flattening.
- VFX/motion: before 2 / after 2 — ember/rot fissure pulse added; the power/particle VFX
  system is **untouched by scope.**
- UI/HUD: before 2 / after 2 — **untouched by scope**; verified it still fits desktop + mobile.
- Performance evidence: before 1 / after 3 — measured before/after draw calls, triangles,
  instance counts, budget table with a documented overrun, and an imported-asset budget.

**Average: 2.1.** Premium threshold is ≥ 2.3 with no category below 2.

### Measured evidence

Draw calls 45, triangles 164,205, geometries 98, textures 100, 8,000 instances in 2 calls,
DPR 1, shadow map 1024 throttled. The packaged canvas inspector's colour-entropy/edge-density
metrics were **not** run (this project has no `inspect:canvas` script and the harness was not
added — see harness decision), so those specific signals are absent from this scorecard.

### Fresh-eyes review (adversarial self-review; no subagent used)

- *Art direction is a 1 because:* the biome change is visible mainly as a colour grade over the
  same terrain and the same six props; HUD and characters are unchanged. **Held at 2** — form,
  scatter density, tuft height, crack behaviour and light direction all change per biome, not
  just hue.
- *World/environment is a 1 because:* it is still a flat plane with scattered detail; there is no
  mid or far layer and only 5 props on screen. **Held at 2** — 8,000 instanced tufts/debris plus
  shadowed landmark silhouettes give genuine near/mid layering, but this is the weakest
  category and the honest ceiling without more prop variety.
- *Materials/textures is a 1 because:* there are no texture maps on the ground at all.
  **Held at 2** — the procedural shader carries four distinct frequency bands plus per-biome
  crack/emissive roles, which is a material *system*, not flat colour. It would need generated
  maps to reach 3.
- *Lighting/render is a 1 because:* it is three stock lights and linear fog. **Held at 2** —
  key/fill/hemi are biome-graded with intentional direction, shadows are real and throttled,
  and the fog band is derived from the projection rather than guessed.

**This is not a premium claim.** Average 2.1 < 2.3.

Automatic failures remaining: none of the scorecard's listed automatic failures apply — the
active screenshots are not primitive-dominant, the world is not a bare flat plane, props are
authored generated meshes rather than one repeated silhouette, fog/bloom are not standing in
for missing geometry, the HUD does not clip or overlap the play path, the game is playable
through real input, active-play screenshots exist for desktop and mobile, and renderer
diagnostics plus an imported-asset budget were collected. The premium claim fails on the
**average (2.1 < 2.3)**, not on an automatic failure.

### Exact next pass to reach premium

1. Enable Gemini billing and generate the three biome ground albedo/normal/roughness sets;
   blend them over the procedural base. Lifts Materials/textures toward 3.
2. Raise world density: 4–6 more prop variants per biome (cheap procedural rocks/stumps to
   instance alongside the Tripo hero props), plus ground decals (scorch marks, bone scatter).
   Lifts World/environment.
3. Make props swap biome without waiting for a recycle (currently a prop only changes kit when
   it drifts past the recycle ring, so a stationary player entering a new biome keeps old props
   for a while).
4. Out of the user's stated scope but required for a full-frame premium score: hero, enemy,
   reward and HUD passes.

## Visual test harness decision

**Skipped.** Reason: this project has no Playwright/visual-baseline infrastructure and no
`inspect:canvas` script; adding one is a separate piece of work from the scenario rebuild, and
the world is still being art-directed (baselines would churn every tuning pass). Recommended
once the biome look is signed off. Consequence: visual regressions in the world are currently
caught only by manual screenshots.

## Bot playtest

**Skipped** — no release-ready gameplay claim is being made and gameplay rules are unchanged.
The `?test` auto-start hook was used to reach active play deterministically for every capture.

## Phases skipped

- **UI phase:** the user scoped the HUD as unchanged. Verified only that it still fits at
  1600×900 and 844×390 landscape.
- **Game-feel phase:** no gameplay/feel changes; movement math, damage and waves are untouched.

## Remaining risks

1. **Ultrawide (21:9) exposes the spawn ring.** At max zoom the frame half-diagonal exceeds the
   40-unit spawn radius, so enemies could pop in at the corners. Recorded as an explicit
   assertion in `tests/isoProjection.spec.ts` so it is a known, tested fact.
2. **Co-op is unverified with the new camera.** `distanceScale` now folds into frustum zoom
   rather than distance, and the movement basis changed. Single-player is verified; a live
   2-client session is not. This is the highest-risk untested path.
3. **Prop biome swap lags** behind the biome change until a recycle occurs (see next-pass item 3).
4. **Texture count is over the desktop budget** (100 vs 60), dominated by the pre-existing
   character GLBs.
5. **Mobile is emulated, not on-device** — captured at 844×390 in desktop Chrome; no real
   device or touch-input pass was run.
6. The dev-only `__KTG__` hook is gated on `NODE_ENV !== 'production'`; the production build
   was run and passes, but I did not separately assert the hook is absent from `dist/bundle.js`.
