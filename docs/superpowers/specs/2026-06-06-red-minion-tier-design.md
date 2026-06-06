# Red Minion Tier — Wave 10+ Enemy Swap

**Date:** 2026-06-06
**Status:** Design approved, pending spec review

## Summary

From **wave 10 onward**, three "blue" base enemies are replaced by tougher "red"
variants. The swap is a hard replacement (blue versions only appear before wave 10).
The red GLB assets already exist in `assets/`, so this is wiring + tuning + one
genuinely new behavior (an enemy that fires a ranged projectile at the hero).

| Before wave 10 (blue) | Wave 10+ (red) | Change |
|---|---|---|
| blue-melee-minion (`basic`, BasicEnemy) | red-melee-minion (`basic_red`, RedMeleeMinion) | 10× HP, 2× speed, 2× attack rate |
| blue-gold-artillery-carriage (`fast`, FastEnemy) | red-gold-artillery-carriage (`fast_red`, RedArtilleryCarriage) | 10× HP only |
| blue-wizard (`healer`, HealerEnemy) | red-wizard (`healer_red`, RedWizard) | 3× HP, heal replaced by ranged attack |

## Architecture

### Swap chokepoint

`EnemyManager.spawnSurvivorsEnemy()` already reads `this.currentWave` (it uses it for
boss tiering, `wave % 5`). Add a single remap step at the top of that method, **before**
the type→class switch:

```ts
let spawnType = type;
if (this.currentWave >= 10) {
    if (type === 'basic')  spawnType = 'basic_red';
    else if (type === 'fast')   spawnType = 'fast_red';
    else if (type === 'healer') spawnType = 'healer_red';
}
// ... existing assetFor(spawnType) + switch(spawnType) ...
```

The wave scheduler (`WaveManager.generateLevel1Waves` / `generateNextWave`) is **not**
touched — it keeps emitting `'basic'`/`'fast'`/`'healer'`. This keeps the gate in one
place and avoids editing hand-tuned wave composition data.

The `assetFor(baseType)` helper and the `switch` get three new `case` arms
(`'basic_red'`, `'fast_red'`, `'healer_red'`) mapping to the new classes.

### HP scaling note

All base HP values below are **pre-difficulty-scaling**. `EnemyManager._applyGlobalDifficulty`
multiplies enemy HP by a wave-based factor identically for blue and red, so the requested
ratios (10×, 10×, 3×) are preserved relative to the blue base values after scaling.

## Components

### RedMeleeMinion (`src/survivors/enemies/RedMeleeMinion.ts`)

`extends BasicEnemy`. Thin subclass — overrides constructor stat args and stages its asset.

- Base HP: **300** (10× of BasicEnemy's 30)
- Speed: **6** (2× of 3)
- Melee hit damage: **10** (unchanged)
- Melee cooldown: **0.25s** (half of 0.5 → 2× attack rate)
- `contactDamagePerSecond`: **16** (2× of 8, consistent with doubled attack rate)
- Asset: `basic_red` → `red-melee-minion/source/red_melee_minion.glb`
- Static `pendingAsset` slot consumed in `createMesh()` (same pattern as BasicEnemy).

### RedArtilleryCarriage (`src/survivors/enemies/RedArtilleryCarriage.ts`)

`extends FastEnemy`. Thin subclass.

- Base HP: **200** (10× of FastEnemy's 20)
- Speed: **6** (unchanged)
- Melee hit damage: **7** (unchanged)
- Melee cooldown: **0.35s** (unchanged)
- `isFlying`: true (inherited)
- Asset: `fast_red` → `red-gold-artillery-carriage/source/red_gold_artillery_carriage.glb`

### RedWizard (`src/survivors/enemies/RedWizard.ts`)

`extends Enemy` (new behavior — NOT a HealerEnemy subclass; the heal is removed entirely).

- Base HP: **75** (3× of HealerEnemy's 25)
- Speed: **3.5** (same as HealerEnemy)
- `contactDamagePerSecond`: **2** (low — it's a backline ranged threat; body-block still nicks)
- No heal event, no heal pulse ring.
- Asset: `healer_red` → `red-wizard/source/red_wizard.glb`

**Ranged attack (the only substantial new code):**

Models its cadence on HealerEnemy's per-frame timer, and reuses the hero-projectile
movement pattern (`scene.onBeforeRenderObservable` closure + `ProjectilePool`).

- Fields: `attackTimer` (s), `attackCooldown = 2.0`, `attackRange = 12`,
  `boltDamage = 12`, `boltSpeed = 14`.
- In `update(dt)`: call `super.update(dt)` first, then `attackTimer += dt`. When
  `attackTimer >= attackCooldown` AND `seekTarget` exists AND hero within `attackRange`,
  fire a bolt and reset `attackTimer = 0`.
- **Dodgeable (non-homing):** at launch, capture the hero's current position and compute a
  fixed direction. The bolt flies straight along that direction at `boltSpeed`. The player
  can sidestep. (Homing would be undodgeable — explicitly avoided.)
- **Hit test:** each frame, if distance(bolt, current hero position) < ~0.6, call
  `seekTarget.takeDamage(boltDamage, bolt.position)` and release the bolt.
- **Expiry:** release the bolt after a ~3s safety timeout or if it travels past max range.

**Bolt mesh + leak-safety (per CLAUDE.md transient-FX invariants):**

- Mesh acquired via `acquireProjectile(scene, 'red-wizard-bolt', () => createBolt())` and
  returned via `releaseProjectile('red-wizard-bolt', mesh)`.
- Bolt material via `getCachedMaterial(scene, 'red-wizard-bolt', …)` — a **bounded** key
  (one material total, never per-instance/random). Fade via `mesh.visibility`, never by
  mutating the shared material's alpha.
- The `onBeforeRenderObservable` observer is **removed** on every exit path: hit, timeout,
  out-of-range, and if `!this.alive` / `!seekTarget?.isAlive?.()` (wizard died or run exited
  mid-flight). This mirrors the established `HeroBasicAttack` pattern.

### Asset wiring (`src/survivors/SurvivorsGameplayState.ts`, `ENEMY_GLB_PATHS`)

Add five rows (all assets already exist on disk; they preload with the existing set):

```ts
basic_red:        { dir: 'assets/red-melee-minion/source/',           file: 'red_melee_minion.glb' },
fast_red:         { dir: 'assets/red-gold-artillery-carriage/source/', file: 'red_gold_artillery_carriage.glb' },
healer_red:       { dir: 'assets/red-wizard/source/',                 file: 'red_wizard.glb' },
basic_red_elite:  { dir: 'assets/red-super-melee-minion/source/',     file: 'red_super_melee_minion.glb' },
healer_red_elite: { dir: 'assets/red-super-wizard/source/',           file: 'red_super_wizard.glb' },
```

The two `*_elite` rows are a free upgrade: when a red minion/wizard spawns as an elite,
`assetFor` appends `_elite` and finds the proper `red-super-*` art. There is no
`red-super-artillery-carriage`, so an elite red carriage's `fast_red_elite` lookup misses
and `assetFor` falls back to `fast_red` (its own red carriage mesh, scaled up by the elite
treatment) — handled automatically by the existing fallback chain, no special-casing.

## Data flow

1. `WaveManager` emits a wave entry, e.g. `{ type: 'basic', count: N }`.
2. Spawn fn → `EnemyManager.spawnSurvivorsEnemy('basic', eliteElement, …)`.
3. Remap: `currentWave >= 10` → `spawnType = 'basic_red'`.
4. `assetFor('basic_red')` → staged GLB (elite path: `'basic_red_elite'`).
5. `switch(spawnType)` → `new RedMeleeMinion(...)`; `createMesh()` consumes `pendingAsset`.
6. Per frame, `Enemy.update(dt)` runs seek + melee; RedWizard additionally ticks its
   ranged-attack timer and may fire a bolt.

## Error handling / edge cases

- **GLB load failure:** each red class falls back to its parent's procedural mesh (same
  `pendingAsset ?? procedural` pattern as BasicEnemy/FastEnemy). RedWizard, having no
  procedural healer art of its own, falls back to a minimal procedural mesh (reuse
  HealerEnemy's procedural builder shape or a simple robed figure — implementation detail
  for the plan).
- **Bolt orphaned on death/exit:** covered by the observer-removal exit paths above.
- **Wave exactly 10:** boundary is inclusive (`>= 10`), so wave 10 is the first red wave.

## Testing

- Per project convention, Vitest covers **pure-logic** modules only (no Babylon scene).
  The stat overrides and the remap function are the testable surface.
- If the remap is extracted into a pure helper (e.g. `redSwapType(type, wave)`), add a
  Vitest spec asserting: `<10` returns the blue type; `>=10` maps basic/fast/healer to red;
  other types pass through unchanged.
- The ranged-attack closure and mesh/material lifecycle are verified manually in-game
  (reach wave 10, confirm reds spawn with correct art/stats, wizard fires dodgeable bolts,
  and `[resource-watchdog]` does not fire at wave-clear after sustained wizard fire).

## Scope boundaries (YAGNI)

- Blue `basic`/`fast`/`healer` still appear **before** wave 10 — unchanged.
- Tanks, splitting, shield, bosses — untouched.
- No new HUD/UI, no retuning of other enemies, no new wave compositions.
