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
                  ParticleSystem, AnimGroup, GLB assets, tween, audio, math)
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
- `src/engine/AssetManager.ts` — boot sound setup + `playSound` facade. The game ships NO audio files: every sound (SFX + the looping wind/drone ambience under the `bgMusic` handle) is synthesized at boot by `src/engine/three/proceduralSfx.ts` into WebAudio buffers.
- `src/engine/three/SceneHost.ts` — THREE.Scene + the per-frame update buses (`onBeforeRender`, `onAnimUpdate` gated by `animationsEnabled`) + particle registry. Headless-friendly (Vitest drives it with `tick(dt)`).
- `src/engine/three/RendererHost.ts` — WebGLRenderer + pmndrs postprocessing chain: RenderPass → Bloom + SelectiveBloom (GLOW_LAYER=11, Babylon GlowLayer parity) → ACES tone mapping → vignette → FXAA. `info` getter exposes renderer counts for the resource watchdog.
- `src/engine/three/assets.ts` — GLB container cache + `instantiate()` (SkeletonUtils clone + per-instance materials + AnimationMixer). **Prefixes only the clone ROOT's name** — renaming descendants unbinds every animation track (THREE resolves tracks by node name) and the model T-poses.

### Core game states
- `src/menu/MenuState.ts` — main menu; "Play" button routes to `survivors`.
- `src/survivors/SurvivorsGameplayState.ts` — **primary game loop**; `enter()` shows champion select then calls `startRun(type)`. Orchestrates all systems. Sets up the key/fill directionals + the hero-following directional shadow map.
- `src/game-over/GameOverState.ts` — death screen; survivors path passes `SurvivorsRunSummary` via `setSurvivorsSummary()`.

### Hero systems
- `src/survivors/champions/Champion.ts` — hero mesh + animation + spin/attack FX + torch attachment (`enableTorch` reuses the pre-registered `Game.heroTorch`). `controlMode: 'ai' | 'player'`. `setPlayerVelocity()`, `getPosition()`.
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
- `src/ui/hud/Hud.ts` (class `Hud`) — **THE in-game HUD**. HP pill, wave pill, **run-stats pill (`⏱ mm:ss · ☠ kills`)**, **level pill (`LV n` + XP-progress fill)**, gold pill, 4 power-slot icons with cooldown sweeps, 4-item row, ultimate buttons, low-HP vignette. Built from `src/ui/primitives/` (`Pill`, `IconSlot`), styled by `src/ui/styles/components.css`; pill text via `src/ui/format.ts`.
- `src/ui/overlays/ChampionSelect.ts` — 3-card champion picker.
- `src/ui/overlays/PowerChoice.ts` — 3-card slow-mo orb pickup choice; subtitles show damage + cooldown delta.
- `src/ui/overlays/ReplaceSlot.ts` — secondary slot-replacement prompt.
- `src/ui/overlays/Leaderboard.ts` — shared leaderboard modal.

Still under `src/survivors/`:
- `src/survivors/ui/SurvivorsJoystick.ts` — virtual joystick (mobile).
- `src/survivors/ui/OffscreenEnemyIndicators.ts` — off-screen elite arrow indicators.
- `src/survivors/DamageNumberManager.ts` — pooled floating damage/reward numbers.

**Progression:** attributes grow automatically via the **XP/leveling system** (`src/survivors/LevelSystem.ts`) — each level grants +1% to every attribute except crit chance (which stays +0.5%/level) (cap level 100). It **replaced the gold Armory shop**; `src/ui/overlays/Shop.ts` was deleted.

> The legacy Babylon-GUI `src/survivors/ui/{HeroHud,ChampionSelectOverlay,PowerChoiceOverlay,ReplaceSlotOverlay}.ts` were **deleted** (superseded by the DOM versions above). Don't resurrect them — edit `src/ui/**`.

### Shared cross-state UI (in `src/shared/ui/`)
- `HudStyle.ts` — pill + frame factories, press/flash/pulse helpers.
- `responsive.ts` — `getLayoutMode()` returns `'mobile' | 'desktop'` based on viewport.
- `PauseScreen.ts` — global pause overlay.

### Rendering helpers (in `src/engine/rendering/`)
- `StyleConstants.ts` — PALETTE color constants (THREE.Color / rgba tuples).
- `LowPolyMaterial.ts` — `createLowPolyMaterial(name, color)`, `createEmissiveMaterial(name, color, strength)` (each call = fresh material, NOT cached), `makeFlatShaded`, `markGlowing(mesh)` (adds to the selective-bloom GLOW_LAYER), `setMeshOpacity(mesh, a)` (clone-on-write fade — replaces Babylon `mesh.visibility`; never mutate a shared material's opacity).
- `MaterialCache.ts` — `getCachedMaterial(key, setup)` name-keyed material reuse (no scene param). Cached materials have `userData.cached = true` so `disposeMesh` leaves them alone. Cache keys must be BOUNDED (element/colour), never instance ids.
- `src/engine/three/primitives.ts` — `createSphere/Torus/Disc/...` mesh factories (Babylon orientations baked in), plus the disposal funnel: `disposeMesh(mesh)` (frees geometry unless cache-owned + owned materials) and `isMeshDisposed(mesh)`.
- `ProceduralGrass.ts` — quality-tiered hardware-instanced grass blades (8k/16k/32k low/med/high) with custom ShaderMaterial. Wind animation in vertex shader; torch contribution in fragment via `setTorch()` per-frame uniforms.
- `ProceduralGrassTexture.ts` — Voronoi + multi-octave noise baked once into a 2048² texture for the ground disc.
- `ProjectilePool.ts` — pooled projectile mesh allocation.

### Survivors-only shared types
- `src/survivors/GameTypes.ts` — `ElementType`, `EnemyType`, `StatusEffect` enums. Formerly in the deleted `towers/Tower.ts`.
- `src/survivors/ItemDrop.ts`, `WaveStatus.ts`, `Map.ts` (mostly TD-era; only `buildSurvivorsArena()` is live), `LevelConfig.ts` (only consumed by Map).

## Lighting, tone mapping & shadows

The frame renders into an HDR half-float chain and goes through **ACES filmic tone
mapping + a subtle vignette** (RendererHost post stack). Light intensities are tuned
FOR that curve — if you touch tone mapping, retune the lights.

Survivors-mode lighting (configured in `Game.setupScene` + `SurvivorsGameplayState`):

| Light | Intensity | Notes |
|---|---|---|
| `light` (HemisphereLight) | 0.75 menu / 1.0 survivors | Global warm fill, persistent (`userData.persistent`); survivors `enter()` raises it, `exit()` restores. |
| `survivorsKey` (DirectionalLight) | 1.35 | Warm dominant key; **owns the shadow map**; position + target follow the hero every frame. |
| `survivorsFill` (DirectionalLight) | 1.0 | Cool back-fill, no shadows — rims the dark GLB characters so they separate from the grass. Kept below the key. |
| `heroTorch` (PointLight) | 0 → 5.0 | Created once in `Game.setupScene`, persistent; `Champion.enableTorch` parents it to the hero + cranks intensity (castShadow stays off). |
| env cube (`scene.environment`) | 1.6 | IBL — read ONLY by the PBR GLB characters (grass/low-poly Phong ignore it), so it is the character-brightness knob that leaves the field untouched. The cube itself is a dark dusk map, hence the hot intensity. |

**Globe ground normals stay flat-up.** The curved cap (`GlobeGround`) bakes the
curvature into positions but does NOT `computeVertexNormals()` — curved normals
tilt up to ~30° at the rim and the hemi+key lights paint a huge radial bright/dark
band that follows the hero (the "dark ellipse" bug). Grass blades light with
un-tilted normals too, keeping ground and grass consistent.

**Shadows:** THREE has no ShadowGenerator — casting is per-mesh (`castShadow`) and
the 1024 PCF map lives on `survivorsKey.shadow` with a fixed ±35-unit ortho frustum
following the hero. Refresh is throttled (`light.shadow.autoUpdate = false`; update()
sets `needsUpdate` every `_shadowRefreshInterval` frames — 2 normally, 3 under perf
trim). Heavy enemies get `castShadow = true` via `EnemyManager.setShadowGenerators`;
after wave 5 enemy shadow-casting is cut off entirely (hordes outgrow the cost).
The grass shader samples the directional's shadow map directly.

**Note:** the Babylon-era "never create lights at runtime" rule is GONE — THREE
recompiles affected materials on demand (a one-frame cost; prewarm if it matters).

## Tests

Vitest is wired for **pure-logic** modules (no WebGL; SceneHost is headless and suites drive it with `tick(dt)`). Tests live under `tests/*.spec.ts` — currently ~65 spec files (~522 tests) covering player stats/items, power slots/fusions/status model, the engine/three layer (primitives, particles, tween, math), and the co-op/net stack (protocol round-trips, snapshot binary + delta codecs, connection FSM, reconciliation, damage routing, transports).

## Balance (current)

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
- **Black-screen / render-health guards (permanent).** A pure-black canvas while the game keeps running has two known cause classes: (1) **GPU context loss** — the frame vanishes and the near-black page bg shows (gameplay clear color is near-black, so a vanished frame looks black, NOT sky-blue); (2) a **NaN/Infinity camera transform** — `HeroController`'s per-frame follow lerp makes a transient NaN sticky forever → NaN view matrix clips every mesh → near-black, and rendering does NOT throw. Guards: `src/engine/renderHealth.ts` (pure, Vitest-tested) drives `Game.installRenderWatchdog()` (a **separate `setInterval`, NOT rAF** — context loss freezes rAF) which banners+reloads on unrecovered loss / no-frame; `Game.installContextLossRecovery()` wires the RendererHost `webglcontextlost/restored` callbacks; `Game.guardActiveCamera()` + the `HeroController` follow-lerp finite-check + the `Champion.update` hero-position finite-check self-heal the NaN path. Don't remove these; keep the watchdog out of the rAF loop. Decisive repro test: if black, do the HUD pills keep updating? frozen → context loss; smooth → NaN camera.
- **Resource-leak watchdog (permanent).** `SurvivorsGameplayState.checkResourceBudget()` runs at every wave clear (arena empty → live enemies ≈ 0). THREE has no global material/texture lists, so `collectSceneResources()` walks the scene graph for the live material set and reads texture/geometry/program counts from `RendererHost.info`. If materials exceed baseline + budget or climb too fast, it logs `[resource-watchdog] LEAK SUSPECTED …` bucketed by name-prefix (`src/engine/rendering/resourceBudget.ts`) — the largest bucket names the offending allocation site. If you see it fire, the named prefix is your leak.
