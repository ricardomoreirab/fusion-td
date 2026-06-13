# KTG — Kill the Goblins — Claude Code Project Notes

## Project summary

Vampire Survivors-style action game built with BabylonJS + TypeScript. Single hero, 4 power slots, wave-based, open circular arena.

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
- `src/engine/AssetManager.ts` — load tracking + sound playback.

### Core game states
- `src/menu/MenuState.ts` — main menu; "Play" button routes to `survivors`.
- `src/survivors/SurvivorsGameplayState.ts` — **primary game loop**; `enter()` shows champion select then calls `startRun(type)`. Orchestrates all systems. Sets up the directional + torch shadow generators.
- `src/game-over/GameOverState.ts` — death screen; survivors path passes `SurvivorsRunSummary` via `setSurvivorsSummary()`.

### Hero systems
- `src/survivors/champions/Champion.ts` — hero mesh + animation + spin/attack FX + torch attachment (`enableTorch` reuses the pre-registered `Game.heroTorch`). `controlMode: 'ai' | 'player'`. `setPlayerVelocity()`, `getPosition()`.
- `src/survivors/champions/BarbarianBuilder.ts` — barbarian procedural mesh construction (extracted from Champion.ts).
- `src/survivors/champions/HeroBasicAttack.ts` — projectile spawning for the hero's basic attack.
- `src/survivors/HeroController.ts` — WASD + joystick input, top-down follow camera, basic auto-attack, HP tracking, death callback.

### Enemy systems
- `src/survivors/enemies/EnemyManager.ts` — enemy lifecycle, `configureSurvivorsMode()`, `spawnSurvivorsEnemy()`, `setOnEliteDeath()`, `setShadowGenerators([directional, torch])` to register casters into both shadow passes.
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
- `src/survivors/powers/PowerDrop.ts` — orb entity: spawn, magnet, pickup flash, `onPickup` callback.

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
- `src/ui/hud/Hud.ts` (class `Hud`) — **THE in-game HUD**. HP pill, wave pill, **level pill (`LV n` + XP-progress fill)**, 4 power-slot icons with cooldown sweeps, 4-item row, ultimate buttons, low-HP vignette. Built from `src/ui/primitives/` (`Pill`, `IconSlot`), styled by `src/ui/styles/components.css`; pill text via `src/ui/format.ts`.
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
- `StyleConstants.ts` — PALETTE color constants (Color3/Color4).
- `LowPolyMaterial.ts` — `createLowPolyMaterial`, `createEmissiveMaterial`, `makeFlatShaded`. Note: materials returned are **frozen** for perf; scene also has `blockMaterialDirtyMechanism = true` so lights added at runtime are invisible to existing materials.
- `MaterialCache.ts` — name-keyed material reuse.
- `ProceduralGrass.ts` — quality-tiered hardware-instanced grass blades (8k/16k/32k low/med/high) with custom ShaderMaterial. Wind animation in vertex shader; torch contribution in fragment via `setTorch()` per-frame uniforms.
- `ProceduralGrassTexture.ts` — Voronoi + multi-octave noise baked once into a 2048² texture for the ground disc.
- `ProjectilePool.ts` — pooled projectile mesh allocation.

### Survivors-only shared types
- `src/survivors/GameTypes.ts` — `ElementType`, `EnemyType`, `StatusEffect` enums. Formerly in the deleted `towers/Tower.ts`.
- `src/survivors/ItemDrop.ts`, `WaveStatus.ts`, `Map.ts` (mostly TD-era; only `buildSurvivorsArena()` is live), `LevelConfig.ts` (only consumed by Map).

## Lighting & shadows

Survivors-mode lighting (configured in `Game.setupScene` + `SurvivorsGameplayState.enter` + `applyRuinsAmbience`):

| Light | Intensity | Notes |
|---|---|---|
| `light` (HemisphericLight) | 0.55 | Single global warm fill. |
| `survivorsKey` (DirectionalLight) | 0.9 | Dominant directional; **drives shadow generator**. |
| `ruinsSpot` (SpotLight) | 1.2 | Warm orange overhead glow. |
| `heroTorch` (PointLight) | 0 → 5.0 | Pre-registered in `Game.setupScene`; `Champion.enableTorch` parents to mesh + cranks intensity. **Pre-registration is required** because `scene.blockMaterialDirtyMechanism = true` means materials never recompile for runtime-added lights. |

**Two shadow generators:**
- Directional (1024 PCF, low quality filter) on `survivorsKey` — hero + bosses + heavies cast; ground discs receive.
- Torch (512 cube + ExpShadowMap) on `heroTorch` — bosses + heavies cast (NOT hero, so it doesn't block its own light).

Bosses register into BOTH via `EnemyManager.setShadowGenerators([directional, torch])`.

## Tests

Vitest is wired for **pure-logic** modules only (no full Babylon scene; a few suites use the Babylon Null engine). Tests live under `tests/*.spec.ts` — currently ~42 spec files (~314 tests) covering player stats/items, power slots/fusions/status model, and the co-op/net stack (protocol round-trips, snapshot binary + delta codecs, connection FSM, reconciliation, damage routing, transports).

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
- The `AdvancedDynamicTexture` (`this.ui`) is created in `enter()` and disposed in `exit()`.
- `startRun(championType)` is called AFTER the champion select; no gameplay objects exist before that.
- `GameOverState.setSurvivorsSummary(summary)` must be called BEFORE `changeState('gameOver')`.
- `Game.heroTorch` is pre-registered in `setupScene` at intensity 0 so materials compile with the light slot present. **Do not create new lights at runtime** — they will be invisible to existing materials.
- Materials returned by `createLowPolyMaterial` are frozen. To re-tier a material's HP-bar light setup, increase `maxSimultaneousLights` before freezing.
- **Transient-FX materials must never leak.** The recurring multi-second freeze is always ONE class of bug: a short-lived FX mesh whose material is orphaned by the default `mesh.dispose()` (which is `dispose(false, false)` — does NOT free the material), so `scene.materials` grows monotonically until a frame stalls for seconds. Rule for any per-attack/per-cast/per-frame FX: route the material through `getCachedMaterial(scene, key, …)` with a **bounded** key (element/colour hex — finitely many; never `Math.random()`/instance ids), OR, if the mesh owns a unique animated material, free it with `mesh.dispose(false, true)`. Fade transient meshes via `mesh.visibility`, not by mutating a shared/frozen material's `.alpha`. `createEmissiveMaterial`/`createLowPolyMaterial` do NOT cache — every call is a fresh material. `exit()` calls `clearMaterialCache()` + `clearProjectilePools()`.
- **Black-screen / render-health guards (permanent).** A pure-black canvas while the game keeps running has two known cause classes: (1) **GPU context loss** — Babylon gates its whole frame on `!_contextWasLost`, so `Game.frameTick` stops and the near-black page bg shows (gameplay `clearColor` is near-black, so a vanished frame looks black, NOT sky-blue); (2) a **NaN/Infinity camera transform** — `HeroController`'s per-frame `LerpToRef(camera.position…)` makes a transient NaN sticky forever → NaN view matrix clips every mesh → near-black, and `scene.render()` does NOT throw. Guards: `src/engine/renderHealth.ts` (pure, Vitest-tested) drives `Game.installRenderWatchdog()` (a **separate `setInterval`, NOT rAF** — context loss freezes rAF) which banners+reloads on unrecovered loss / no-frame; `Game.installContextLossRecovery()` wires `onContextLost/RestoredObservable` + `webglcontextlost preventDefault`; `Game.guardActiveCamera()` + the `HeroController` follow-lerp finite-check + the `Champion.update` hero-position finite-check self-heal the NaN path. Don't remove these; keep the watchdog out of the rAF loop. Decisive repro test: if black, do the HUD pills keep updating? frozen → context loss; smooth → NaN camera.
- **Resource-leak watchdog (permanent).** `SurvivorsGameplayState.checkResourceBudget()` runs at every wave clear (arena empty → live enemies ≈ 0) and, if `scene.materials`/`textures` exceed baseline + budget or climb too fast, logs `[resource-watchdog] LEAK SUSPECTED …` with the scene list bucketed by name-prefix (`src/engine/rendering/resourceBudget.ts`) — the largest bucket names the offending allocation site. If you see it fire, the named prefix is your leak.
