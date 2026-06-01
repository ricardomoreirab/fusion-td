# Boss Entrance Cinematic — Design

**Date:** 2026-06-01
**Status:** Approved (pending spec review)

## Goal

Play a short, dramatic cinematic when each of the first three milestone bosses
appears. The cinematic freezes the battlefield, pans the camera onto a dedicated
"entrance" model striking its authored action pose, then hands off to the real
boss — which materializes exactly where the camera was looking and combat resumes.

## Scope

| Tier | Wave | Boss | Entrance asset | Clip played |
|---|---|---|---|---|
| 1 | 5 | Thamuz, Lord of Lava | `assets/thamuz-lord-lava-entrance/source/thamuz_lord_lava_entrance.glb` | `thamuz_lord_lava_entrance_city_action` |
| 2 | 10 | Thamuz, Lord of Wraith | `assets/thamuz-lord-of-wraith-entrance/source/thamuz_lord_of_wraith_entrance.glb` | `thamuz_lord_of_wraith_entrance_city_action` |
| 3 | 15 | Helcurt, Shadowbringer | `assets/helcurt-shadowbringer-entrance/source/helcurt_shadowbringer_entrance.glb` | `helcurt_shadowbringer_entrance_city_action` |

Each entrance GLB exposes two clips: `<prefix>_city_action` (the dramatic pose,
played here) and `<prefix>_city_idle` (unused).

**Excluded:** waves 20+ (tiers 4/5 — no entrance asset, spawn normally); boss
clones/twins (tier 3/4 echoes never get an entrance); no slow-mo, no letterbox
bars, no entrance sound (no roar asset exists; trivial to add later).

## Decisions

- **Style:** cinematic interrupt — hard freeze of all gameplay, not slow-mo.
- **Camera:** pan from the hero to the boss spawn point, hold, pan back.
- **Duration:** ~2.2s total — **0.6s glide-in / 1.0s hold / 0.6s glide-back**.
- **Asset loading:** preload all three entrance GLBs at run start, alongside the
  existing enemy GLBs, so the cinematic never stalls.

## Architecture

### New module: `src/survivors/BossEntranceCinematic.ts`

Self-contained controller. No knowledge of waves, powers, or enemy AI.

```
class BossEntranceCinematic {
  constructor(game, getCamera: () => FreeCamera)
  setEntranceAssets(map: Record<number, AssetContainer>)   // tier -> preloaded container
  hasEntrance(tier: number): boolean
  isActive(): boolean
  play(tier: number, spawnPos: Vector3, heroPos: Vector3): Promise<void>
  update(rawDeltaTime: number): void   // advances phase clock + camera; only ticks while active
  dispose(): void                      // safety cleanup if run exits mid-cinematic
}
```

Responsibilities:
1. **Instantiate** the tier's entrance model at `spawnPos` (boss scale ~2.2,
   feet-on-ground offset, same orientation flip as `MilestoneBoss.createMeshFromGLB`),
   oriented to face `heroPos`. Use `instantiateModelsToScene(cloneMaterials=false)`
   — the model is never recolored, so cloning textures would only leak.
2. **Play** the `*_city_action` clip (looping for the cinematic's duration).
3. **Camera pan** across three phases driven by its own clock:
   - **glide-in (0.6s):** lerp camera position from the saved hero-follow position
     to a framing pose `boss + (0, ~10, ~-8)`; ease the look-target from the hero
     to the boss.
   - **hold (1.0s):** keep the framing pose locked on the boss.
   - **glide-back (0.6s):** lerp position + look-target back toward the saved
     hero-follow values.
   - On completion: **hard-restore** the camera's exact saved position and
     rotation, re-enable hero follow, dispose the model, resolve the promise.
4. **Dispose** the temp model with `root.dispose(false, true)` plus
   `animationGroups.forEach(ag => ag.dispose())` and `skeletons.forEach(s => s.dispose())`
   — per the transient-FX leak rules (CLAUDE.md: default `dispose()` orphans
   materials/animatables). Uses an easing helper (smoothstep) for the lerps.

### `HeroController` change

The follow-cam lerps **position only** and keeps a rotation snapshotted at
construction; it never calls `setTarget()` again. The cinematic *does* call
`setTarget()` (to angle at the boss), which mutates rotation — so:

- Add `setCameraSuspended(b: boolean)`. While suspended, `update()` skips the
  entire camera-follow + camera-shake block. Hero input still resolves to zero
  movement (gameplay is frozen anyway).
- The cinematic snapshots `camera.position.clone()` + `camera.rotation.clone()`
  at `play()` start and hard-restores both at the end, so follow resumes with the
  exact original top-down angle — no drift.

### `EnemyManager` change

Add an optional `spawnPosOverride?: Vector3` to `spawnSurvivorsEnemy(type,
eliteElement, bossStrengthMultiplier, spawnPosOverride?)`. When provided, it is
used verbatim instead of the random ring position. Everything else (asset
staging, scaling, shadow registration) is unchanged.

### `SurvivorsGameplayState` orchestration

- **Construct** a `BossEntranceCinematic` in run setup; hand it `() => heroController.getCamera()`.
- **Preload** the three entrance GLBs (new `boss_entrance1/2/3` entries in the
  enemy GLB path registry) during the same asset-load step as the other enemy
  GLBs, and pass the resolved containers to the cinematic via `setEntranceAssets`.
- **Intercept** in the `setSpawnFn` wrapper:
  ```
  setSpawnFn((type, eliteElement, strength) => {
    if (type === 'boss' && this.shouldPlayBossEntrance()) {
      this.spawnBossWithEntrance(strength);   // async, fire-and-forget
    } else {
      this.enemyManager.spawnSurvivorsEnemy(type, eliteElement, strength);
    }
  });
  ```
  - `shouldPlayBossEntrance()`: current wave % 5 === 0, `tier = wave/5` in {1,2,3},
    cinematic has the asset, and not already played for this wave.
  - `spawnBossWithEntrance(strength)`: compute the spawn point (arena-ring point
    near the hero, same radius logic EnemyManager uses), call
    `cinematic.play(tier, spawnPos, heroPos)`, then on resolve call
    `enemyManager.spawnSurvivorsEnemy('boss', undefined, strength, spawnPos)`.
- **Freeze** at the top of `update(deltaTime)`: if `cinematic.isActive()`, call
  `cinematic.update(deltaTime)` (raw, unscaled) and `return` before any
  hero/wave/enemy/power tick. The battlefield holds; enemy idle anims keep looping
  in place (acceptable). The wave cannot be flagged clear during the freeze, and
  the real boss exists before normal updates resume.
- **Cleanup:** `exit()` calls `cinematic.dispose()` to cover a run abandoned
  mid-cinematic (restore camera suspend flag + dispose any live model).

## Data flow

```
WaveManager.update (inside Gameplay.update)
  └─ spawnFn('boss', …)  ── milestone tier 1-3? ──► spawnBossWithEntrance()
                                                       │
                                  cinematic.play(tier, spawnPos, heroPos)  ──┐
                                                                            │ (async ~2.2s)
   Gameplay.update (next frames): cinematic.isActive() ► cinematic.update();│ return  ← FREEZE
                                                                            │
                                  play() resolves ◄───────────────────────┘
                                       │
                                       └─► enemyManager.spawnSurvivorsEnemy('boss', …, spawnPos)
                                            camera follow re-enabled, combat resumes
```

## Error handling / edge cases

- **Missing/failed asset:** `hasEntrance(tier)` is false → `shouldPlayBossEntrance()`
  returns false → boss spawns normally. The feature degrades to current behavior.
- **Run exits mid-cinematic:** `exit()` → `cinematic.dispose()` un-suspends the
  camera and disposes the live model. The deferred boss spawn is guarded by an
  `alive`/state check so it no-ops if the run already tore down.
- **Re-entrancy:** `shouldPlayBossEntrance()` guards against a second trigger for
  the same wave; `isActive()` prevents overlapping plays.
- **Resource leaks:** model disposed with `dispose(false, true)` + group/skeleton
  disposal; the wave-clear resource watchdog (`checkResourceBudget`) continues to
  guard against regressions.

## Testing

- **Manual (primary):** reach waves 5 / 10 / 15; confirm the cinematic plays with
  the correct model, the camera pans and returns to the exact prior angle, the
  boss appears where the camera looked, and combat resumes cleanly. Confirm no
  `[resource-watchdog] LEAK SUSPECTED` after the boss wave clears.
- **Type-check:** `npx tsc --noEmit` clean.
- The cinematic controller and orchestration are Babylon-scene-bound, so they fall
  outside the pure-logic Vitest suite (consistent with existing enemy/boss code).
```

