# Overnight session — handoff

**Branch:** `overnight/lighting-and-cleanup`
**Off:** `main` @ `06c7df7` (the last commit you deployed)
**Started:** 2026-05-26

This document is the entry point for reviewing the overnight work. **Nothing in this branch has been pushed to `main` or deployed.** Everything is reviewable before you adopt it.

---

## How to review

```bash
git checkout overnight/lighting-and-cleanup
npm install                 # only needed if I added test deps; see notes
npm run build               # confirm it compiles
npm start                   # play it in the browser
npm test                    # run the new test harness (if added)
```

Compare diff vs main:

```bash
git log main..overnight/lighting-and-cleanup --oneline
git diff main..overnight/lighting-and-cleanup -- 'src/**/*.ts'
```

---

## TL;DR — what changed

1. **Lighting actually works now.** Root cause of the "full bright" feel: `scene.blockMaterialDirtyMechanism = true` means any light added after a material's first compile is invisible to that material. The torch (added at runtime when hero spawned) never reached anything. I pre-registered it in `Game.setupScene`. Also dropped the duplicate hemispheric light, cut the overhead SpotLight from 3.0 to 1.2, dropped `environmentIntensity` from 0.6 to 0.25, and bumped the directional key light from 0.5 to 0.9. Net effect: real directional shading instead of a uniform fill.
2. **Shadows.** Single `ShadowGenerator` (PCF, 1024) attached to the directional key light. Hero + bosses + tank/shield/splitting/healer + every elite cast shadows. Swarm enemies (basic/fast/mini) don't — would blow the budget. Ground discs receive.
3. **Cleanup audit** (read-only). 3 orphan `.ts` files + 1 orphan asset folder + 14 unused `Map.ts` public methods identified. **Nothing deleted.** Detailed list below.
4. **Project structure proposal.** Proposed reorganization documented below. **No files moved.**
5. **Test harness.** Vitest installed, a few seed tests added. Detailed below.

---

## Lighting diagnosis

### What I found

| Source | Where | Intensity (before) | Notes |
|---|---|---|---|
| `light` (Hemispheric) | `Game.ts:setupScene` | 0.65 | Global fill, always on |
| `survivorsAmbient` (Hemispheric) | `SurvivorsGameplayState.enter` | 0.25 | **Duplicate hemi** — stacked on top of `light` |
| `survivorsKey` (Directional) | `SurvivorsGameplayState.enter` | 0.5 | Too weak to cut through the hemi stack |
| `ruinsSpot` (Spot) | `applyRuinsAmbience` | 3.0 | Straight down from (0,18,0) — washed out the center of the arena |
| `heroTorch` (Point) | `Champion.enableTorch` (runtime) | 2.4 (later 5.0) | **Never reached any material** (added after compile, dirty-block on) |
| `scene.environmentTexture` IBL | `applyRuinsAmbience` | 0.6 | Big uniform ambient term — main contributor to "full bright" |

### The critical bug

`Game.ts:171` has `scene.blockMaterialDirtyMechanism = true` for performance. This means **materials don't recompile their shaders**. A `StandardMaterial` compiles for the lights that exist at its first render. New lights added later are silently ignored — they have a `Light` instance in the scene but no shader code references them.

Both the previous "second directional light" experiment and the hero torch were added after every material had already compiled → invisible.

### Fix

Pre-create the torch in `Game.setupScene` at intensity 0 so every material compiles with the slot. `Champion.enableTorch` just parents the existing light to the hero and cranks the intensity up. The torch lives on Game, gets reused across runs.

Other changes:
- Removed the duplicate `survivorsAmbient` hemi (Game's `light` is the single global fill, 0.65 → 0.55).
- `survivorsKey` 0.5 → 0.9 (now dominant directional, drives form).
- `ruinsSpot` 3.0 → 1.2 (was washing out the center).
- `scene.environmentIntensity` 0.6 → 0.25 (less uniform IBL flood; PBR heroes still get sky reflection).
- `groundMat.maxSimultaneousLights = 8` so the torch slot is never culled.

Commit: `d493b47`.

---

## Shadows attempt

### Setup

- One `ShadowGenerator(1024)` attached to `survivorsKey` (DirectionalLight).
- Filtering: `usePercentageCloserFiltering = true` + `QUALITY_LOW`. PCF gives soft edges; `QUALITY_LOW` keeps the per-pixel sample count down.
- Frustum: ortho box `[-32, 32]` covering the arena (radius ~25u + headroom). `shadowMinZ=1`, `shadowMaxZ=80`.
- `darkness=0.4`, `bias=0.0008`, `normalBias=0.02`, `frustumEdgeFalloff=0.05`.

### Casters

Registered at spawn time via `EnemyManager._registerAsShadowCaster` (only when `setShadowGenerator` was called by the survivors state):

- Hero mesh (in `startRun` after `enableTorch`).
- Boss, tank, shield, splitting, healer enemies.
- Anything elite (any base type with `eliteElement` set).

**Deliberately excluded:** basic / fast / mini swarm enemies. 60+ casters per frame would multiply the shadow-pass draw calls and tank the framerate. Their absence reads OK from the top-down camera — the swarm is small relative to the boss.

### Receivers

- The 1 `ruinsGrassMat` ground disc.
- The 5 stacked `arenaGround{0..4}` LowPolyMaterial discs from `Map.buildSurvivorsArena`.

### How to verify on wake

Spawn a wave with a boss or elites and check that they cast a shadow on the grass. The hero should also have a shadow that moves with them. If the framerate hitches significantly during big waves, the shadow generator can be killed entirely by commenting out the block in `SurvivorsGameplayState.applyRuinsAmbience` lines 596-633.

### Trade-offs to call out

- **Skinned meshes are more expensive to render in the shadow pass** because the vertex shader runs the bone transforms again. The hero + GLB enemies will all incur this. If perf becomes an issue, the cheapest fix is to drop the shadow map size 1024 → 512.
- **The grass blades don't receive shadows** — they use a custom `ShaderMaterial` that doesn't sample the shadow map. Could be added the same way I added the torch contribution.
- **The torch doesn't cast shadows** — only the directional does, by design (point-light shadows are 6x more expensive). The torch lights the scene additively without occluding.

Commit: `65aedf8`.

---

## Cleanup audit

**I did not delete anything.** All items below are candidates pending your approval.

### Orphan `.ts` files (zero references from any other file)

| File | Lines | Notes |
|---|---|---|
| `src/game/gameplay/ChampionManager.ts` | 89 | TD-era champion-as-AI-unit manager. Survivors uses `Champion` directly via `SurvivorsGameplayState.hero`. |
| `src/game/gameplay/ScoreManager.ts` | 78 | TD-era localStorage high-score tracker. Survivors mode uses `SurvivorsRunSummary` instead. |
| `src/game/gameplay/LevelManager.ts` | 281 | TD-era multi-level loader. Survivors only has one arena. Also still has `bridgeGround.receiveShadows = true` referencing the old TD river. |

Total dead code: **448 lines.**

### Dead `Map.ts` API surface

`Map.ts` is 2070 lines. Only **5 methods are called from outside** by survivors mode:
- `dispose()`
- `getArenaRadius()`
- `buildSurvivorsArena()`
- `getPath()` (still called by `EnemyManager.createEnemy`, which is itself dead — see below)
- `getStartPosition()` (same — dead via `createEnemy`)

The other 14 public methods are TD-era leftovers:
- `initialize`, `getThemePalette`, `gridToWorld`, `worldToGrid`, `canPlaceTower`, `setTowerPlaced`, `getEndPosition`, `getZOffsetValue`, `getStartPositionGrid`, `getEndPositionGrid`, `removeEndPortal`, `removeFarWall`
- Plus all the private TD methods they cascade into: `setupLighting`, `defineTerrainZones`, `generateHeightMap`, `createGround`, `generatePathWithTurns`, `createRiver`, `createPathVisuals`, `createBridges`, `addDecorations`, `addCellIndicators`, `addPathBorders`, `createPortals`, `addAtmosphericEffects`, `addThemeParticles`, `addParticleEffects` — all called only from `initialize()` which is itself unused in survivors mode.

**Conservative estimate: ~1700 of Map.ts's 2070 lines are dead.** Refactor proposal: extract `SurvivorsArena.ts` from the live `buildSurvivorsArena()` method, then delete `Map.ts` entirely.

### Dead `WaveManager.ts` methods

- `generateLevel2Waves` (tsc warns it's never read)
- `generateLevel3Waves` (tsc warns it's never read)
- `createEnemyWithDifficulty` → calls dead `EnemyManager.createEnemy`. Only used as the default `spawnFn`, which survivors immediately overrides with `setSpawnFn(spawnSurvivorsEnemy)`. So this entire fallback path is dead.

### Dead `EnemyManager.ts` methods

- `createEnemy` (used only by the dead `createEnemyWithDifficulty` above)

### Orphan asset folder

| Folder | Size | Notes |
|---|---|---|
| `assets/grock-fortress-titan-in-game/` | 1.9 MiB | Referenced by 0 `.ts` files. Currently shipped in the deploy (webpack `copy-webpack-plugin` copies the whole `assets/` dir wholesale). |

Removing this folder saves 1.9 MiB on every page load.

### Recommendation

1. **Easiest win:** delete `assets/grock-fortress-titan-in-game/` and the 3 orphan `.ts` files. Saves 1.9 MiB + 448 lines.
2. **Medium-effort win:** extract `SurvivorsArena.ts` from `Map.ts`, delete the rest. Saves ~1700 lines of TD-era code.
3. **Cleanup of dead WaveManager / EnemyManager methods** can happen alongside the Map refactor — they're all coupled.

---

## Structure proposal

(No files moved — proposal only.)

Current layout has everything under `src/game/` with subfolders by type (`states/`, `managers/`, `gameplay/`, `ui/`, `rendering/`). That's reasonable for the current size but mixes survivors-specific code with engine plumbing.

**Proposed:**

```
src/
  engine/                          # cross-mode infrastructure
    Game.ts                        # scene + render loop
    AssetManager.ts
    StateManager.ts
    rendering/
      LowPolyMaterial.ts
      MaterialCache.ts
      ProceduralGrass.ts
      ProceduralGrassTexture.ts
      StyleConstants.ts
  survivors/                       # everything survivors-mode-specific
    SurvivorsGameplayState.ts
    SurvivorsArena.ts              # extracted from Map.buildSurvivorsArena
    HeroController.ts
    PlayerStats.ts
    RunItems.ts
    WaveManager.ts
    powers/
      PowerSlotManager.ts
      PowerDefinitions.ts
      PowerDrop.ts
    abilities/
      AbilityManager.ts
    champions/
      Champion.ts
      BarbarianBuilder.ts
      HeroBasicAttack.ts
    enemies/
      Enemy.ts
      BasicEnemy.ts
      ... (each enemy)
      EnemyManager.ts
      EliteSpawner.ts
    ui/                            # only survivors-mode HUDs/overlays
      HeroHud.ts
      ChampionSelectOverlay.ts
      ... (etc)
  menu/                            # menu state + its UI
    MenuState.ts
  game-over/
    GameOverState.ts
  shared/
    ui/                            # cross-state UI helpers
      HudStyle.ts
      responsive.ts
      PauseScreen.ts
  index.ts
```

**Pros:**
- Clear boundary between engine plumbing and survivors gameplay.
- Easy to add a second mode (or restore TD mode) without re-tangling things.
- Test-friendly — pure-logic modules under `survivors/` can be tested without spinning up a scene.

**Cons:**
- Touches every import path in the codebase.
- Invalidates every `CLAUDE.md` path reference (would need to be regenerated).
- Rots `git blame` on file moves unless we use `git mv` carefully.
- No actual functional improvement.

**I would not do this without your sign-off** — the blast radius is huge for a cosmetic improvement. If you do want it, I'd recommend doing it as its own dedicated session with no other changes, and exclusively `git mv` so blame is preserved.

---

## Test harness

### Setup

- **Runner:** Vitest 3.2 (added as a dev dep). Lightweight, fast, supports TypeScript out of the box.
- **Config:** `vitest.config.ts` at repo root. Tests live under `tests/`, file pattern `*.spec.ts`.
- **No DOM / no WebGL setup.** All tests are pure-logic, run in Node — they don't import any module that touches `@babylonjs/core` at module load time.

### Scripts

```bash
npm test          # run once
npm run test:watch  # rerun on file change
```

### Current coverage

| File | Tests | Covers |
|---|---|---|
| `tests/PlayerStats.spec.ts` | 12 | money / gold aliases / spend-affordability, health damage + clamping, purchase-count tracking, neutral default multipliers. |
| `tests/RunItems.spec.ts` | 8 | tier-to-item mapping, stack effects for all 4 items (lifesteal pct, knockback units, multishot count, attack-speed doubling), multiplicative composition with prior shop purchases. |

**20 tests, ~5ms execution time.** Everything passes.

### Recommended next tests (not added — would take longer to mock cleanly)

- `WaveManager.generateLevel1Waves` — pure: should produce a deterministic schedule given a seed. Currently uses `Math.random` directly though, so would need a seam.
- `BetweenWaveShopOverlay` `pctDelta` / `pctInv` formatters — currently inline in `buildShopItems`; would benefit from extracting to a utility module first.
- `DamageNumberManager.acquireSlot` pool wrap-around — pure pool logic; would need to stub out `Scene` + `DynamicTexture` types, which is messy. Skip unless you hit pool-related bugs.

---

## Did not do

- **Did not restructure the project layout.** Proposal above; awaiting sign-off.
- **Did not delete any files.** All cleanup candidates documented; awaiting sign-off.
- **Did not enable shadows on the grass blades** — they use a custom shader that doesn't sample the shadow map. Could be added but the visual gain is marginal because blades are small.
- **Did not enable point-light (torch) shadows.** Point-light shadows are 6× more expensive than directional. Torch contributes light additively without occluding.
- **Did not push to `main` or run `wrangler deploy`.** All work is on this branch only.
- **Did not amend or rewrite any existing commits.**
