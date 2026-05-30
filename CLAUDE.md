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
  menu/           main menu state
  game-over/      game-over state
  shared/         cross-state UI helpers
  index.ts        DOM bootstrap
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

### Survivors UI (in `src/survivors/ui/`)
- `HeroHud.ts` — HP bar, gold, 4 power-slot icons with cooldown sweeps, 4-item lifesteal/etc row, ultimate buttons with countdown text, low-HP red vignette pulse.
- `ChampionSelectOverlay.ts` — 3-card champion picker.
- `PowerChoiceOverlay.ts` — 3-card slow-mo orb pickup choice; subtitles show damage + cooldown delta.
- `ReplaceSlotOverlay.ts` — secondary slot-replacement prompt.
- The between-wave shop ("Armory") is a **DOM** overlay at `src/ui/overlays/Shop.ts` (class `BetweenWaveShopOverlay`) — 8 items in a 4×2 grid, each showing its current attribute value inline. (The old Babylon-GUI `src/survivors/ui/BetweenWaveShopOverlay.ts` was deleted.)
- `EliteIndicators.ts` — off-screen elite arrow indicators.
- `SurvivorsJoystick.ts` — virtual joystick (mobile).
- `DamageNumberManager.ts` (in `src/survivors/`) — pooled floating damage/reward numbers.

### Shared cross-state UI (in `src/shared/ui/`)
- `HudStyle.ts` — pill + frame factories, press/flash/pulse helpers.
- `responsive.ts` — `getLayoutMode()` returns `'mobile' | 'desktop'` based on viewport.
- `PauseScreen.ts` — global pause overlay.

### Rendering helpers (in `src/engine/rendering/`)
- `StyleConstants.ts` — PALETTE color constants (Color3/Color4).
- `LowPolyMaterial.ts` — `createLowPolyMaterial`, `createEmissiveMaterial`, `makeFlatShaded`. Note: materials returned are **frozen** for perf; scene also has `blockMaterialDirtyMechanism = true` so lights added at runtime are invisible to existing materials.
- `MaterialCache.ts` — name-keyed material reuse.
- `ProceduralGrass.ts` — 8000 hardware-instanced grass blades with custom ShaderMaterial. Wind animation in vertex shader; torch contribution in fragment via `setTorch()` per-frame uniforms.
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

Vitest is wired for **pure-logic** modules only (no Babylon scene). Tests live under `tests/*.spec.ts`. Currently:
- `tests/PlayerStats.spec.ts` — money/health/purchase counts.
- `tests/RunItems.spec.ts` — tier-to-item mapping + stack effects.

## Balance (current)

- Power damage scaling: ×1.25 per level; cooldown: ×0.92 per level.
- Contact DPS: Basic 8/s, Fast 5/s, Tank 20/s, Boss 30/s.
- Slow cap: 80% max (speed never below 0.2× original).
- Freeze immunity: 3s after freeze ends. Stun immunity: 5s after stun ends.

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
- **Resource-leak watchdog (permanent).** `SurvivorsGameplayState.checkResourceBudget()` runs at every wave clear (arena empty → live enemies ≈ 0) and, if `scene.materials`/`textures` exceed baseline + budget or climb too fast, logs `[resource-watchdog] LEAK SUSPECTED …` with the scene list bucketed by name-prefix (`src/engine/rendering/resourceBudget.ts`) — the largest bucket names the offending allocation site. If you see it fire, the named prefix is your leak.
