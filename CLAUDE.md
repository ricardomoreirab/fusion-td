# KTG — Kill the Goblins — Claude Code Project Notes

## Project summary

Vampire Survivors-style action game built with Three.js + TypeScript. Single hero, 4 power slots, wave-based, open circular arena.
(Migrated from BabylonJS in July 2026 — see `docs/three-migration-conventions.md` for the API mapping conventions.)

## Build commands

```bash
npm run build      # webpack production build → dist/
npx tsc --noEmit   # type-check only (trust this; not the IDE)
npm start          # dev server at localhost:9000
npm test           # Vitest unit tests (pure-logic modules only)
npm run test:watch # tests in watch mode
```

## Architecture

The codebase is organized by **bounded context**, not by file type:

```
src/
  engine/         cross-mode infrastructure (Game, scene, lights, asset loading)
  engine/three/   the Three.js engine layer (SceneHost, RendererHost, primitives,
                  ParticleEffect (@newkrok/three-particles wrapper), AnimGroup,
                  GLB assets, tween, audio, math)
  survivors/      survivors-mode gameplay (the only currently shipped mode)
  net/            online co-op networking (protocol, transport, codecs)
  menu/           main menu state
  game-over/      game-over state
  shared/         cross-state UI helpers
  ui/             DOM HUD + overlays (see "Survivors UI" below)
  index.ts        DOM bootstrap
worker/           Cloudflare Worker + Room Durable Object (blind WS relay)
```

### Entry & state machine
- `src/engine/Game.ts` — engine init, scene setup (lights, camera, post-processing pipeline, pre-registered hero torch), registers states (`menu`, `survivors`, `gameOver`).
- `src/engine/StateManager.ts` — `changeState()`, `getState()`, `registerState()`.
- `src/engine/GameState.ts` — base interface every state implements.
- `src/engine/three/audio.ts` — WebAudio playback. `playLoop` sets `loopStart`/`loopEnd` from `detectLoopRange()` so an MP3's decode delay + final-frame padding (tens of ms of silence at both ends) never meet at the wrap and punch a hole through a "seamless" bed. Beds that genuinely fade in from silence (> 0.12s) are left alone.
- `src/engine/AssetManager.ts` — boot audio loading + `playSound` facade. The game ships generated audio files (ElevenLabs) under `assets/audio/{sfx,ui,ambience}`, declared in the `MANIFEST` there and decoded into WebAudio buffers by `loadSoundFile` in `src/engine/three/audio.ts`. **This replaced the old procedural synthesis** — `proceduralSfx.ts` is deleted; do not reintroduce it. A failed asset degrades to silence, never an exception. Ambience is per-biome (`ambienceMeadow/Scorched/Cursed`) and cross-faded by `setAmbience()`, which the survivors state drives from `World.getAmbienceName()`; `exit()` must call `stopAllAmbience()` or the menu's `bgMusic` stacks on top of a still-playing bed.
- `src/engine/three/SceneHost.ts` — THREE.Scene + the per-frame update buses (`onBeforeRender`, `onAnimUpdate` gated by `animationsEnabled`) + particle registry. Headless-friendly (Vitest drives it with `tick(dt)`).
- `src/engine/three/RendererHost.ts` — WebGLRenderer + pmndrs postprocessing chain: RenderPass → Bloom → ACES tone mapping → FXAA. NO vignette — over the bright uniform field it reads as a "halo of shadow" stamped on the screen, not as focus. `info` getter exposes renderer counts for the resource watchdog. `setResolutionScale(r)` caps the pixel ratio (perf-trim level 3). **There is no SelectiveBloomEffect** — it re-rendered the WHOLE SCENE through a layer-filtered camera every frame (~40% of render-thread CPU at horde scale) purely to glow loot orbs. The chain is HDR end to end, so "this glows" is authored as over-range emissive that clears the bloom threshold. Do not reintroduce it.
- `src/engine/three/assets.ts` — GLB container cache + `instantiate()` (SkeletonUtils clone + per-instance materials + AnimationMixer). **Prefixes only the clone ROOT's name** — renaming descendants unbinds every animation track (THREE resolves tracks by node name) and the model T-poses.
- `src/engine/three/particles/ParticleEffect.ts` — ALL gameplay particles run on `@newkrok/three-particles` (Unity-style declarative configs) through this SceneHost-aware wrapper: synthetic ms clock (never Date.now, headless-testable), `parent` + `SimulationSpace.WORLD` for moving emitters, `autoDispose` for one-shot bursts, `fxSize()` (world units ×19 → lib point size), `fxRenderer('additive'|'normal')`, shared `getSoftParticleTexture()`. The lib's cone/box shapes emit along local +Z (rotate −π/2 X for "up"), its `angle`/`arc` are DEGREES (doc comments claiming radians are wrong), and `gravity` is a downward scalar (negative = updraft). Old Babylon sim-time tunings were converted at ×0.6 (`updateSpeed 0.01 × 60`): lifetimes ÷0.6, rates/speeds ×0.6, gravity ×0.36. package.json pins a `"three": "$three"` override — without it three-noise nests three@0.128 and double-bundles Three ("Multiple instances" warning + broken instanceof).

### Core game states
- `src/menu/MenuState.ts` — main menu; "Play" button routes to `survivors`.
- `src/survivors/SurvivorsGameplayState.ts` — **primary game loop**; `enter()` shows champion select then calls `startRun(type)`. Orchestrates all systems. Sets up the key/fill directionals + the hero-following directional shadow map.
- `src/game-over/GameOverState.ts` — death screen; survivors path passes `SurvivorsRunSummary` via `setSurvivorsSummary()`.

### Hero systems
- `src/survivors/champions/Champion.ts` — hero mesh + animation + spin/attack FX + torch attachment (`enableTorch` reuses the pre-registered `Game.heroTorch`). `controlMode: 'ai' | 'player'`. `setPlayerVelocity()`, `getPosition()`.
  **Locomotion is pinned to `_run`** in the `PREFERRED` table, never inherited from the alias matcher — it takes the first clip containing "walk"/"run", which on these rigs is `_fastrun` purely because it sorts ahead of `_run` in the GLB. **`_fastrun` is not a sprint despite the name — it reads as a slow, weird walk** (on Miya its cycle is *longer*, 1.24s, than her actual run at 0.88s). There is deliberately **no sprint tier and only one locomotion clip**: a threshold that swaps clips above some move speed is exactly how this bug came back, because the XP curve pushes the hero past any such threshold within a wave or two. Extra move speed shows as a faster run cycle (`_locomotionSpeedRatio`, floored at 1.0 since a run played slower than authored simply *is* a walk, capped at `LOCOMOTION_MAX_RATIO`), never a different clip.
  **Attacking while moving runs two bone-masked layers**, not one clip and not a weight blend. The attack clip is compressed to the attack interval, so from the moment enemies stay in contact range it owns the rig ~100% of the time; giving it the whole skeleton makes the hero glide in a rooted pose, and blending locomotion back in at partial weight is worse — THREE has no bone mask and weights AVERAGE, so the legs get a fraction of the stride and read as a mushy slow shuffle. `src/engine/three/clipMask.ts` splits both clips by skeleton region (`splitClipByBody`, root + pelvis + leg chain = lower) and `_playCombatLayers` plays `<attack>__upper` and `<run>__lower` at FULL weight each: every bone is written by exactly one action. Derived layers are cached per source clip and disposed in BOTH `die()` and `dispose()` (they hold mixer actions + a `finished` listener).
- `src/survivors/champions/BarbarianBuilder.ts` — barbarian procedural mesh construction (extracted from Champion.ts).
- `src/survivors/champions/HeroBasicAttack.ts` — projectile spawning for the hero's basic attack.
- `src/survivors/HeroController.ts` — WASD + joystick input, top-down follow camera, basic auto-attack, HP tracking, death callback.

### Enemy systems
- `src/survivors/enemies/EnemyManager.ts` — enemy lifecycle, `configureSurvivorsMode()`, `spawnSurvivorsEnemy()`, `setOnEliteDeath()`, `setOnDeathLoot()` (floor-pickup roll), `setShadowGenerators([lights])` to flag heavy spawns as shadow casters.
- `src/survivors/enemies/Enemy.ts` — base enemy class. `seekTarget` field drives survivors-mode seek-hero AI. `contactDamagePerSecond`, `isElite`, `eliteDropElement`, `applyHealthBarTier()`.
- Concrete enemies in `src/survivors/enemies/`: `BasicEnemy`, `FastEnemy`, `TankEnemy`, `BossEnemy`, `MilestoneBoss`, `SplittingEnemy`, `HealerEnemy`, `ShieldEnemy`, `MiniEnemy`.
- `src/survivors/enemies/EliteSpawner.ts` — applies elite visual treatment (1.4× scale, emissive outline, orange HP bar tier).

### Wave & economy
- `src/survivors/WaveManager.ts` — wave scheduling; `setSpawnFn()` overrides spawn logic for survivors mode; `setOnWaveCleared()` triggers shop. Default `spawnFn` throws if not set — survivors mode always wires it.
- `src/survivors/PlayerStats.ts` — gold (`addGold/spendGold`), HP, shop multipliers (`powerDamageMultiplier`, `powerCooldownMultiplier`, `moveSpeedMultiplier`, `damageReductionMultiplier`, `critChance`, `critDamageMultiplier`, etc).
- `src/survivors/RunItems.ts` — milestone-boss item drops (lifesteal, multishotCleave, knockback, attackSpeed). Pure logic — covered by Vitest.

### Power system
- `src/survivors/powers/PowerSlotManager.ts` — 4 slots, cooldowns, auto-fire orchestration.
- `src/survivors/powers/PowerDefinitions.ts` — 6 powers per champion class: Fireball (fire), Frost Shards (ice), Arcane Nova (arcane), Piercing Arrow (physical), Whirling Blades (physical), Lightning Chain (storm).
- `src/survivors/powers/PowerDrop.ts` — orb entity: spawn, magnet, pickup flash, `onPickup` callback, `magnetize()`.
- `src/survivors/FloorPickup.ts` — VS-style floor loot from regular kills (2% heal orb = 20% max HP, 0.4% magnet ring that vacuums all drops via `magnetize()` on every live drop). **Single-player only** — the roll is skipped in co-op.

### Manual ultimates
- `src/survivors/abilities/AbilityManager.ts` — Meteor Strike (45s, click-to-target), Frost Nova (30s, instant), and per-champion class ults. `triggerFrostNova()`, `triggerMeteorAtNearest()`. Constructed with `(game, enemyManager)`.
- `src/survivors/abilities/AbilityVisuals.ts` — damage-free visual builders split out of AbilityManager, shared by the local cast AND the co-op remote-fx replay.

### Online co-op (host-authoritative, 2 players)
- `src/net/` — `Protocol.ts` (all wire messages), `NetClient.ts` (message pump), `WebSocketTransport.ts` / `FakeTransport.ts` (tests), `RoomService.ts` (room mint/connect interface; `PrivateRoomService` is the live impl), `SnapshotBinary.ts` (binary tick codec), `SnapshotDelta.ts` (delta vs last snapshot + keyframes), `Interpolation.ts` (jitter buffer), `ConnectionMachine.ts` (reconnect FSM).
- `src/survivors/coop/` — `CoopSession.ts` (typed send/receive over NetClient), `GuestEnemies.ts` (guest render-only enemy registry driven by host snapshots), `CoopFx.ts` (cosmetic-fx channel: `emitCoopFx`/`withFxReplay`), `PendingCoop.ts` (lobby → startRun handoff; cleared in `exit()`), `reconcile.ts` (input-replay reconciliation).
- `worker/` — Cloudflare Room Durable Object: blind WS relay. Control frames: `hello`, `peer-left`, `peer-joined` (normal second join), `peer-rejoined` (resume). A dropped peer can resume its role within a 30s grace window.
- **Entry:** menu Co-op lobby (`src/ui/overlays/CoopLobby.ts`) connects while still in the menu → stashes the live session via `PendingCoop` → `startRun()` takes it. Dev flow: `?host` / `?join[=CODE]` URL params (fixed dev room `TESTER`).
- **Invariants:** the HOST simulates everything (enemy AI, waves, damage). The guest renders host-authoritative copies and routes damage/status/knockback through the `Enemy.guest*Redirect` statics — ALL cleared in `exit()`. Cosmetic fx replays are gameplay-inert (`withFxReplay` guard stops re-broadcast echoes). Single-player must stay byte-identical: every co-op hook is null/guarded.
- **Shared movement math:** `src/survivors/integrateMove.ts` — single source of truth for HeroController, the host's guest-ghost, and guest input replay.

### Survivors UI — migrated to **DOM** (in `src/ui/`)
The HUD and overlays were migrated off Babylon-GUI to DOM (see `docs/superpowers/plans/2026-05-29-dom-ui-foundation-and-hud.md`). The live UI is:
- `src/ui/hud/Hud.ts` (class `Hud`) — **THE in-game HUD**, composed as **three zones inside one flex `.hud__topbar`** (never absolutely positioned — see the layout invariant below):
  - top-left *vitals*: level medallion + segmented HP meter (damage-lag ghost) + thin arcane XP rail. The **medallion is the character-sheet button** (`setOnOpenCharacter` adds `.medallion--clickable`, so it stays inert in co-op where there is no sheet). The always-visible 6-cell equipment strip that used to sit beneath was removed — the shop's gear ledger covers "what am I wearing" where it matters;
  - top-centre *objective* plate: wave · goblins left · run clock · kills, divided by engraved rules, plus the transient event banner (`showBanner`);
  - top-right: gold purse + pause.
  Bottom-left holds the 4 power slots over the run-item row; bottom-right the ultimates. Built from `src/ui/primitives/` (`Meter`, `IconSlot`, `Frame`, `Button`, `Card`, `Modal`), styled by `src/ui/styles/components.css`; numbers via `src/ui/format.ts`.
- `src/ui/hud/BossBar.ts` — **the screen-space boss plate.** Boss-tier enemies render NO world health bar (`Enemy.createHealthBar` returns early for the tier); they get a wide segmented bar under the top bar instead. It is appended to the HUD root, NOT to `.hud__zone--tc` — a bar that wide inside the top bar's flex row would shove the vitals/purse flanks outward. Rows are keyed by enemy id and pooled (a tier-3/4 boss spawns a twin, so the stack grows/shrinks without rebuilding DOM at 60 Hz); every write is diffed. `SurvivorsGameplayState.collectBosses()` feeds it from the SAME role-aware list as targeting, so the co-op guest drives it from `GuestEnemies` (host-authoritative HP). Removing the world bar also retired the only per-instance `DynamicTexture` in the enemy layer (the canvas boss-name sprite).
- `src/ui/icons.ts` — **the authored SVG icon set and the UI's only glyph source.** ~50 engraved-line icons on a 24×24 viewBox using `currentColor`. Gameplay data tables (`ItemCatalog`, `PowerDefinitions`, `UltimateDefinitions`) still carry legacy emoji strings; `iconForGlyph()` / `glyphEl()` map those to authored icons so the catalogues never had to change. **Do not put emoji in the UI** — they render as platform-coloured stickers over the forged-bronze chrome and were removed wholesale.
- `src/ui/elementMeta.ts` — element/tier → icon + colour for the HUD, power choice and replace-slot prompt. Colours re-export the canonical `survivors/ElementColors.ELEMENT_HEX`; these three surfaces each used to keep their own copy.
- `src/ui/overlays/ChampionSelect.ts` — 3-card champion picker.
- `src/ui/overlays/PowerChoice.ts` — 3-card slow-mo orb pickup choice; subtitles show damage + cooldown delta.
- `src/ui/overlays/ReplaceSlot.ts` — secondary slot-replacement prompt.
- `src/ui/overlays/Leaderboard.ts` — shared leaderboard modal (a 4-column CSS grid; the old `Courier New` string-padded version is gone).
- `src/shared/ui/PauseScreen.ts` — pause overlay, styled by `.pause-screen`/`.pause-panel` in components.css (it used to be Arial + inline `cssText`).

**UI design system (`src/ui/styles/`).** `tokens.css` fixes five colour ROLES and the whole interface obeys them: bronze/gold = chrome + currency, blood = health/danger, arcane = XP/fusion, moss = positive, parchment = text. Anything outside them (the old `#5fb0e8` XP blue, `#9aa4b0` stat grey) reads as another game's UI and was removed. Chrome is built from `--rim-bronze` + `--fill-plate` painted as two backgrounds (border-box / padding-box) so a `clip-path` chamfer cuts rim and fill as one plate.

**Two CSS invariants that bite:**
1. **`clip-path` clips outer `box-shadow`s away.** Chamfered plates get their separation from the bright meadow via `filter: var(--lift)` (a `drop-shadow` pair), never an outer box-shadow.
2. **The top bar must stay a flex row.** Absolutely-positioned zones look identical on desktop and drive the objective plate straight through the vitals cluster on a phone. The flanks are `flex: 1 1 0; min-width: min-content`, which centres the plate on screen while never shrinking into their own content; below 560px the plate wraps to its own row.

Still under `src/survivors/`:
- `src/survivors/ui/SurvivorsJoystick.ts` — virtual joystick (mobile).
- `src/survivors/ui/OffscreenEnemyIndicators.ts` — off-screen elite arrow indicators.
- `src/survivors/DamageNumberManager.ts` — pooled floating damage/reward numbers.

**Progression:** attributes grow automatically via the **XP/leveling system** (`src/survivors/LevelSystem.ts`) — each level grants +1% to every attribute except crit chance (which stays +0.5%/level) (cap level 100). It **replaced the gold Armory shop**; `src/ui/overlays/Shop.ts` was deleted.

**Ascension (`src/survivors/ascension/`)** — post-cap progression, **single-player only**, run-scoped (no persistence). Gold is the only XP source, so the cap is reached at **wave 13** (35,046 XP total), and every point after it used to be discarded by `LevelSystem.addXp`. It now feeds `AscensionSystem`: 50 ascension levels (846,000 XP; A50 ≈ wave 36) granting 1 point each, spent in a per-class 3-path × 9-node tree where each node holds 3 points. 50 points against 81 capacity means **no run can light more than two of the three capstones** — asserted in `tests/ascensionScarcity.spec.ts`, not left to tuning.
- `AscensionTrees.ts` is PURE DATA (a module-level singleton like `POWER_DEFS`): node defs hold no closures, meshes or scene refs, only a string `runtime` id.
- `ascensionStats.ts` `foldAscensionStats()` is folded from POINT COUNTS inside `applyLevelBonuses()` — **after the potion fold, before the re-push** — so it can neither compound nor be clobbered. Same contract as `foldEquipmentStats`: that is the only legal call site. It must never write `extraAttacks`/`ricochetBounces` (RunItems assigns those outside the recompute) — the types make that unrepresentable.
- `awardXp` samples `isMaxLevel()` **before** `addXp`, or the cap-crossing grant is counted twice. Co-op is gated at CALL time (the session resolves after `startRun`, so a construction-time guard silently skips wiring — see `maybeSpawnFloorPickup`).
- `AscensionRuntime.ts` runs every non-stat node. Structural clone of `ItemEffectRuntime`, and **type-only** imports from `HeroBasicAttack` — a value import would drag `three` in and break its no-Three/no-DOM contract. Effects reach gameplay through three channels only: the stat fold, PULLED providers (`damageBonusMult`, `damageReductionMult`, `moveSpeedMult`, `attackSpeedMult`, `powerDamageMult`, `ultCooldownMult`, `abilityTuning`), and hooks CHAINED into the existing single-owner lambdas (`setOnHit`, `setOnSwing`, `onKillCallback`, dash `onComplete`, `setOnActivate`, `setOnCast`, `setOnChannelEnd`). **Never reassign a hook slot** — it unsubscribes its current owner.
- `AscensionContext` deliberately has **no `enemiesNear`** — only `enemiesNearCount` / `forEachEnemyNear` / `forEachEnemyAlive` visitors, so no node *can* allocate in the hot path. `onBasicHit` fires per enemy per frame during Whirlwind and again per ricochet bounce.
- Two provider objects carry the per-class surface: `BasicAttackMods` (melee reach, slash travel/width, enchant level/repeat) and `ArrowPolicy` (volley count/cap/fan, range, speed, bounces). Both MAX rather than sum when two nodes write one field. Non-ranger classes get a frozen `NULL_ARROW_POLICY`.
- Every capstone must **converge**, asserted in `tests/AscensionRuntime.spec.ts`: Maelstrom extends by `(1 − ext/ceiling)`, Resonance costs 8 per discharge but grants 1 per cast (forced casts grant none), The Long Winter runs at 1 Hz, curse strength is clamped, shatter chains are link-capped.

> The legacy Babylon-GUI `src/survivors/ui/{HeroHud,ChampionSelectOverlay,PowerChoiceOverlay,ReplaceSlotOverlay}.ts` were **deleted** (superseded by the DOM versions above). Don't resurrect them — edit `src/ui/**`.
> `src/ui/primitives/Pill.ts` was **deleted** in the 2026-07-25 premium UI pass — the HP/XP pills became `Meter.ts` and the wave/stats/gold pills became the objective plate and purse.

### Shared cross-state UI (in `src/shared/ui/`)
- `HudStyle.ts` — pill + frame factories, press/flash/pulse helpers.
- `responsive.ts` — `getLayoutMode()` returns `'mobile' | 'desktop'` based on viewport.
- `PauseScreen.ts` — global pause overlay.

### Rendering helpers (in `src/engine/rendering/`)
- `StyleConstants.ts` — PALETTE color constants (THREE.Color / rgba tuples).
- `LowPolyMaterial.ts` — `createLowPolyMaterial(name, color)`, `createEmissiveMaterial(name, color, strength)` (each call = fresh material, NOT cached), `makeFlatShaded`, `markGlowing(mesh)` (tags GLOW_LAYER; since the selective pass was removed this is a marker only — the glow itself comes from emissive over the bloom threshold), `setMeshOpacity(mesh, a)` (clone-on-write fade — replaces Babylon `mesh.visibility`; never mutate a shared material's opacity).
- `MaterialCache.ts` — `getCachedMaterial(key, setup)` name-keyed material reuse (no scene param). Cached materials have `userData.cached = true` so `disposeMesh` leaves them alone. Cache keys must be BOUNDED (element/colour), never instance ids.
- `src/engine/three/primitives.ts` — `createSphere/Torus/Disc/...` mesh factories (Babylon orientations baked in), plus the disposal funnel: `disposeMesh(mesh)` (frees geometry unless cache-owned + owned materials) and `isMeshDisposed(mesh)`.
- `ProjectilePool.ts` — pooled projectile mesh allocation.

### The world / scenario (in `src/survivors/world/`)
Rebuilt from scratch (2026-07-25) under a **true orthographic isometric** camera. Replaced
`src/survivors/globe/*` + `ProceduralGrass*` wholesale — those are **deleted; do not resurrect**.
- `isoProjection.ts` — pure camera math (pitch `atan(1/√2)`=35.264°, yaw 45°, zoom, frustum,
  `screenToWorldDir`). No Three/DOM, Vitest-covered.
- `IsoCameraRig.ts` — the OrthographicCamera follow rig; owns framing, zoom, shake, finite-guards.
- `Biomes.ts` — biome table + wave→blend resolution (pure). `World.ts` — facade.
- `TerrainSurface.ts` (procedural ground shader), `GroundScatter.ts` (instanced tufts/debris),
  `PropScatter.ts` (Tripo landmark GLBs), `Atmosphere.ts` (lights + fog + mist).

**Two projection facts that bite:**
1. **There is no horizon and the sky is never visible.** A horizon is a perspective artefact;
   under parallel projection an infinite ground plane fills the whole frame. A sky dome would
   render zero pixels — that is why there isn't one.
2. **Fog must be camera-relative.** `THREE.Fog` uses view-space depth and the camera sits
   `ISO_CLIP_DISTANCE` (220) back for clipping, so biome fog is authored as OFFSETS from the
   hero's focal plane and rebased in `Atmosphere`. Absolute near/far renders a flat fog screen.

### Survivors-only shared types
- `src/survivors/GameTypes.ts` — `ElementType`, `EnemyType`, `StatusEffect` enums. Formerly in the deleted `towers/Tower.ts`.
- `src/survivors/ItemDrop.ts`, `WaveStatus.ts`, `Map.ts` (mostly TD-era; only `buildSurvivorsArena()` is live), `LevelConfig.ts` (only consumed by Map).

## Lighting, tone mapping & shadows

The frame renders into an HDR half-float chain and goes through **ACES filmic tone
mapping** (RendererHost post stack; deliberately NO vignette). Light intensities are
tuned FOR that curve — if you touch tone mapping, retune the lights.

Survivors-mode lighting (configured in `Game.setupScene` + `SurvivorsGameplayState`):

| Light | Intensity | Notes |
|---|---|---|
| `light` (HemisphereLight) | 0.75 menu / **0 survivors** | Persistent global fill. Survivors `enter()` ZEROES it because `Atmosphere` owns the full rig — leaving both hot stacked ~2.0 of ambient and flattened every surface. `exit()` restores it. |
| `worldKey` (DirectionalLight) | biome-graded ~1.1-1.35 | Warm dominant key; **owns the shadow map**; follows the hero. Owned by `world/Atmosphere`. |
| `worldFill` (DirectionalLight) | biome-graded ~0.6-0.85 | Cool back-fill, no shadows — rims the dark GLB characters. Kept below the key. |
| `worldHemi` (HemisphereLight) | biome-graded ~0.8-0.95 | Scenario ambient, owned by `Atmosphere`. |
| `heroTorch` (PointLight) | 0 → 5.0 | Created once in `Game.setupScene`, persistent; `Champion.enableTorch` parents it to the hero + cranks intensity (castShadow stays off). |
| env cube (`scene.environment`) | 1.6 | IBL — read ONLY by the PBR GLB characters (grass/low-poly Phong ignore it), so it is the character-brightness knob that leaves the field untouched. The cube itself is a dark dusk map, hence the hot intensity. |

**Shadows:** THREE has no ShadowGenerator — casting is per-mesh (`castShadow`) and the 1024 PCF
map lives on `worldKey.shadow` with a fixed ±42-unit ortho frustum following the hero. Refresh is
throttled (`shadow.autoUpdate = false`; `Atmosphere.update` sets `needsUpdate` every Nth frame — 2
normally, 3 under perf trim via `World.setShadowInterval`). Heavy enemies get `castShadow = true`
via `EnemyManager.setShadowGenerators`; after wave 5 enemy shadow-casting is cut off entirely.
`SurvivorsGameplayState.exit()` must NOT dispose `shadowSourceLight` — it is borrowed from
`Atmosphere`, which disposes it in `world.dispose()`.

**Note:** the Babylon-era "never create lights at runtime" rule is GONE — THREE
recompiles affected materials on demand (a one-frame cost; prewarm if it matters).

## Tests

Vitest is wired for **pure-logic** modules (no WebGL; SceneHost is headless and suites drive it with `tick(dt)`). Tests live under `tests/*.spec.ts` — currently 66 spec files (599 tests) covering player stats/items, power slots/fusions/status model, the engine/three layer (primitives, particles, tween, math), and the co-op/net stack (protocol round-trips, snapshot binary + delta codecs, connection FSM, reconciliation, damage routing, transports).

## Balance (current)

- **Difficulty is two layers, and both must be read together.** `DifficultyTuning.ts` holds the wave-INDEPENDENT base constants; `DifficultyCurve.ts` (pure, Vitest-covered) emits the per-wave scalars they are multiplied by. A constant in `DifficultyTuning` is "the value once the curve reaches 1.0" (~wave 10), NOT what wave 1 feels like. The curve is the only per-wave ramp — it replaced three that used to live apart (`WaveManager`'s `1 + 0.08(N−1)`, duplicated in two places, and `EnemyManager.WAVE_HP_SCALE_PER_WAVE`). Consumers: `EnemyManager._applyWaveScaling`/`_applyGlobalDifficulty`, `WaveManager` (cadence + count), `MilestoneBoss` (via `bossDifficultyAt`, which softens HP because the boss's `tierHpMult` already ramps with the wave).
  Three properties of the curve are load-bearing and asserted in `tests/DifficultyCurve.spec.ts`:
  1. **Shape.** Player power is front-loaded (level 100 by wave 13), so a flat-rate enemy ramp makes waves 1-5 the hardest part of a run and wave 25 a victory lap. The curve sits at ~0.27× the legacy pressure at wave 1, crosses it at wave 15, and reaches ~4× by wave 25. It accelerates geometrically (≈9%/wave → ≈16%/wave) — there is deliberately **no step at wave 5**, and a max-per-wave-jump assertion keeps it that way.
  2. **`pace` deliberately lags `hp`.** Concurrent population ≈ cadence × time-to-kill, and horde scale is a CPU traversal cost, so ramping both would buy frames-lost instead of difficulty. Late waves are fewer, much tankier enemies. `pace` drives spawn cadence AND enemy count from one scalar so wave duration stays roughly wave-invariant.
  3. **The economy invariant.** Gold is the only XP source and XP pacing is calibrated (level 100 at wave 13, A50 ≈ wave 36). Wave income ∝ `pace × reward`, so the `reward` column is authored to hold that product on the legacy total-gold curve — fewer enemies each drop more. **Retuning `pace` without retuning `reward` silently drifts the whole level/ascension ladder.**
- **Boss last-stand enrage.** Below `ENRAGE_HEALTH_FRACTION` (30%) every milestone boss becomes 50% more durable, faster (movement + melee cadence + special cadence) and harder-hitting. Two things about it are deliberate: (1) tankiness is bought as **damage reduction composed onto `damageResistance`**, never extra max HP — adding HP at 30% would push the HUD boss bar *backwards*, and a boss bar that can rise reads as a bug; (2) it is a **separate one-shot flag** from the tier-3/4 twin-death enrage, so both can fire in one fight. `isEnraged()` falls back to the health fraction when the flag is unset, which is what makes the HUD flip correctly on the co-op guest (whose bosses never tick AI).
- Power damage scaling: ×1.25 per level; cooldown: ×0.92 per level.
- Contact DPS: Basic 8/s, Fast 5/s, Tank 20/s, Boss 30/s.
- Slow cap: 80% max (speed never below 0.2× original).
- Freeze immunity: 3s after freeze ends. Stun immunity: 5s after stun ends.
- Curse DoT ticks at 0.5s intervals (integral-preserving — same total damage as the old per-frame tick); burn AND curse flush their accumulator tail on expiry so no damage is lost.

## Deleted (cleanup history)

**Phase 5 (tower-placement era removal):** `GameplayState.ts`, all `towers/*`, `TowerPreviewRenderer.ts`.

**Overnight session cleanup:** `ChampionManager.ts`, `ScoreManager.ts`, `LevelManager.ts`, asset folder `grock-fortress-titan-in-game/`. Also removed dead methods: `WaveManager.generateLevel2Waves` / `generateLevel3Waves` / `createEnemyWithDifficulty`, `EnemyManager.createEnemy`.

## Key design invariants

- All game state lives in `SurvivorsGameplayState`; it is fully reset on `exit()`.
- The DOM UI root (`this.gameUI`, class `GameUI`) is created in `enter()` and disposed in `exit()`.
- `startRun(championType)` is called AFTER the champion select; no gameplay objects exist before that.
- `GameOverState.setSurvivorsSummary(summary)` must be called BEFORE `changeState('gameOver')`.
- **Transient-FX materials must never leak.** The recurring multi-second freeze is always ONE class of bug: a short-lived FX mesh whose per-instance material is orphaned on disposal, so live materials grow monotonically until a frame stalls for seconds. Rule for any per-attack/per-cast/per-frame FX: route the material through `getCachedMaterial(key, …)` with a **bounded** key (element/colour — finitely many; never `Math.random()`/instance ids), OR mark a uniquely-owned animated material with `userData.ownedMaterial` so `disposeMesh` frees it. Fade transient meshes via `setMeshOpacity(mesh, a)` (clone-on-write), never by mutating a shared material's `.opacity`. Always dispose via `disposeMesh(mesh)` — raw `removeFromParent()` leaks geometry. `createEmissiveMaterial`/`createLowPolyMaterial` do NOT cache — every call is a fresh material. `exit()` calls `clearMaterialCache()` + `clearProjectilePools()`.
- **GLB clones must not rename descendants.** THREE binds animation tracks by node name; `GlbContainer.instantiate` prefixes only the root. Renaming bones = every model silently T-poses (only console warnings).
- **Horde scale is a traversal problem, not a draw problem.** Gameplay logic costs ~1ms even at 250 enemies (measured 0.3-0.6ms); the frame goes to rendering + skeleton posing, both of which scale with the number of enemies *in the scene graph* rather than the number on screen. Three mechanisms keep that bounded and all must stay wired: (1) `EnemyManager.setCullCamera()` → `_cullOffscreen()` → `Enemy.setRenderActive()` parks off-screen enemies, which removes ~86% of an enemy's per-frame CPU; (2) parked enemies drop to `ContainerInstance.setAnimationLod('reduced')` (10 Hz) because `mixer.update()` runs regardless of visibility — frustum culling only skips DRAWING, never posing; (3) VISIBLE enemies further than `ANIM_FULL_RATE_RADIUS` (16u) from the hero drop to `'half'` (30 Hz) via `Enemy.setVisibleAnimationLod()`, graded in the same `_cullOffscreen` pass; elites/bosses are exempt. The animation bus is the largest CPU item after render — measured at ~245 enemies: **full 2.9-3.4ms, half 2.2ms, reduced 0.8-1.1ms per frame**. Note `visible = false` does NOT skip `scene.updateMatrixWorld()` (it recurses into every child unconditionally), which is why `setRenderActive(false)` **detaches** the model root. The scene itself has `matrixWorldAutoUpdate = false`; `SceneHost.tick()` owns the one world-matrix pass per frame.
- **Frame-time measurement.** Automated Chrome pins rAF, and CPU-side timing of `composer.render()` is dominated by unpredictable GPU back-pressure stalls (same scenario measured 2.5ms and 26ms minutes apart) — the render phase is NOT resolvable this way, so don't A/B it. What IS stable and repeatable: the scene-tick sub-phases (`onAnimUpdate` bus, particle tick, `updateMatrixWorld`) and `stateManager.update`. Measure those, and force-set the variable under test on every enemy rather than waiting for a scenario to produce it. Spawning 250 enemies at once is NOT a representative horde: they converge onto the hero within seconds, so ~96% land inside the near radius and nothing is off-screen.
- **Black-screen / render-health guards (permanent).** A pure-black canvas while the game keeps running has two known cause classes: (1) **GPU context loss** — the frame vanishes and the near-black page bg shows (gameplay clear color is near-black, so a vanished frame looks black, NOT sky-blue); (2) a **NaN/Infinity camera transform** — `HeroController`'s per-frame follow lerp makes a transient NaN sticky forever → NaN view matrix clips every mesh → near-black, and rendering does NOT throw. Guards: `src/engine/renderHealth.ts` (pure, Vitest-tested) drives `Game.installRenderWatchdog()` (a **separate `setInterval`, NOT rAF** — context loss freezes rAF) which banners+reloads on unrecovered loss / no-frame; `Game.installContextLossRecovery()` wires the RendererHost `webglcontextlost/restored` callbacks; `Game.guardActiveCamera()` + the `HeroController` follow-lerp finite-check + the `Champion.update` hero-position finite-check self-heal the NaN path. Don't remove these; keep the watchdog out of the rAF loop. Decisive repro test: if black, do the HUD pills keep updating? frozen → context loss; smooth → NaN camera.
- **Resource-leak watchdog (permanent).** `SurvivorsGameplayState.checkResourceBudget()` runs at every wave clear (arena empty → live enemies ≈ 0). THREE has no global material/texture lists, so `collectSceneResources()` walks the scene graph for the live material set and reads texture/geometry/program counts from `RendererHost.info`. If materials exceed baseline + budget or climb too fast, it logs `[resource-watchdog] LEAK SUSPECTED …` bucketed by name-prefix (`src/engine/rendering/resourceBudget.ts`) — the largest bucket names the offending allocation site. If you see it fire, the named prefix is your leak.
