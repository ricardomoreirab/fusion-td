# Orb-Pickup Enemy HP Buff — Design

## Summary

Every magical orb the player picks up during a survivors run increases the HP of all *future*-spawned enemies by 5 percentage points (additive). The mechanic is hidden — no UI surfaces it. Counter resets at the start of each run.

## Motivation

The orb-pickup flow already grants the player power: each pickup levels a spell, grants a perk, and silently boosts global damage. Right now the orb decision is pure upside; the only cost is the brief pause for the choice overlay. This mechanic introduces a counter-pressure so the player feels rising threat as a run progresses — picking orbs makes you stronger *and* makes enemies tougher. The intent is that orbs remain net-positive but no longer trivialise late waves.

## Design decisions (locked in via brainstorming)

| Decision | Choice |
|---|---|
| Stacking math | Additive linear (+5pp per orb) |
| Scope | Future spawns only — alive enemies are untouched |
| Enemy targets | All types, including elites, bosses, and milestone bosses |
| Persistence | Per-run; resets when a new run starts |
| UI feedback | None — hidden mechanic |
| Trigger | On physical orb collection, before the choice overlay opens |
| Cancel path | Picking the +25g cancel still triggers the HP buff (the orb was collected) |

## Architecture

A single `orbHpBonus` counter lives on `EnemyManager`. Each survivors-mode spawn applies `(1 + orbHpBonus)` to the new enemy's `health` and `maxHealth` right after construction. `SurvivorsGameplayState.onOrbPickup` increments the counter by `0.05`.

## Components

### 1. `src/survivors/enemies/Enemy.ts`

Add a public method:

```ts
public applyHealthMultiplier(mult: number): void {
    this.health *= mult;
    this.maxHealth *= mult;
}
```

`health` and `maxHealth` are currently `protected`. This method gives callers a typed, intent-named way to scale enemy HP without reaching through `(enemy as any)`.

### 2. `src/survivors/enemies/EliteSpawner.ts`

Refactor the existing `(enemy as any)` HP writes to call `enemy.applyHealthMultiplier(3)` instead. Pure refactor — same math, same outcome, removes two `any` casts.

### 3. `src/survivors/enemies/EnemyManager.ts`

- Add field: `private orbHpBonus: number = 0;`
- Add public method:

```ts
public addOrbHpBonus(amount: number): void {
    this.orbHpBonus += amount;
}
```

- Add private helper:

```ts
private _applyOrbHpBonus(enemy: Enemy): void {
    if (this.orbHpBonus > 0) {
        enemy.applyHealthMultiplier(1 + this.orbHpBonus);
    }
}
```

- Call `_applyOrbHpBonus(enemy)` at all three spawn sites:
  - End of `spawnSurvivorsEnemy` (after `makeElite`, before push)
  - Both `MiniEnemy` construction sites (currently ~lines 61 and 115, triggered when a `SplittingEnemy` dies)

Order matters: the orb multiplier runs **after** elite scaling so it compounds on top. A basic-elite with 3 orbs picked = base × 3 (elite) × 1.15 (orbs).

### 4. `src/survivors/SurvivorsGameplayState.ts`

In `onOrbPickup(element)`, at the very top of the method (before the "is another overlay open" guard), add:

```ts
this.enemyManager?.addOrbHpBonus(0.05);
```

Placing the call *before* the guard means the buff triggers whenever an orb is physically collected — even in the rare case where the choice overlay can't open. This matches the rule "orb collected = penalty applied".

## Data flow

```
PowerDrop.onPickup
   │
   ▼
SurvivorsGameplayState.onOrbPickup(element)
   │
   ├──► enemyManager.addOrbHpBonus(0.05)       ← NEW
   │
   └──► (existing) open PowerChoiceOverlay flow

Later, on every enemy spawn:
   EnemyManager.spawnSurvivorsEnemy
       │
       ├── construct enemy
       ├── makeElite (if applicable)
       └── _applyOrbHpBonus(enemy)              ← NEW
```

## Edge cases

- **Run reset**: `EnemyManager` is freshly constructed each time `SurvivorsGameplayState.startRun` runs, so the counter naturally returns to `0`. No explicit reset wiring needed.
- **Warmup spawns**: the `farAway` pre-game warmup pass happens before any orb is picked, so the multiplier is a no-op (counter still 0).
- **Mini split spawns**: scaled — minis spawned from a `SplittingEnemy` death after orbs were picked count as "future spawns" relative to *their* spawn moment.
- **Bosses & milestone bosses**: scaled, per locked-in decision. Compounds multiplicatively with `bossStrengthMultiplier` (per-wave milestone scaling).
- **Cancel path**: picking the +25g cancel still buffs enemies. Documented above.

## Testing

No Vitest test possible — the change lives in scene-aware classes (`EnemyManager`, `Enemy`, `SurvivorsGameplayState`). Verification is by manual playtest:

1. Take a run, pick up ~10 orbs by clearing elites.
2. Confirm enemies spawning after pickups visibly take longer to kill than first-wave spawns at equivalent player damage.
3. Confirm existing alive enemies do **not** suddenly gain HP at pickup time.
4. Confirm `npx tsc --noEmit` passes.
5. Confirm the `EliteSpawner` refactor leaves existing elite HP unchanged (still 3× base).

## Non-goals

- No HUD indicator, toast, or footer text.
- No persistence across runs.
- No per-enemy-type tuning of the multiplier (all enemies scale the same).
- No retroactive scaling of already-alive enemies.

---

## Revision (2026-05-29): geometric orb buff + per-wave baseline scaling

### Motivation

The original additive +5pp/orb could not keep up with enemy time-to-kill, because
the player's per-orb damage gain is **multiplicative**: every orb pickup applies a
guaranteed `runPerks.damageMultiplier *= 1.06` (the `GLOBAL_POWER_BUMP`) on top of
the chosen card (a power level = ×1.25 on that spell, or a +5% perk), for a realized
~+10–12% DPS per orb. Against that, an additive HP curve falls progressively
behind — by ~20 orbs enemies died roughly 3× faster than wave 1, trivializing late
waves. The fix is to (a) make the orb HP buff geometric so it can track the player,
and (b) add a separate per-wave baseline so wave number — not just orb count —
carries part of the difficulty curve. (Previously `WaveManager.difficultyMultiplier`
was computed and logged but never applied to survivors-mode spawns.)

### Change 1 — Orb buff: additive → geometric, +5% → +8%/orb

- `EnemyManager.orbHpBonus: number = 0` → `orbHpMultiplier: number = 1`.
- `addOrbHpBonus(amount)`: `this.orbHpMultiplier *= (1 + amount)` (was `+= amount`).
- `_applyOrbHpBonus`: `if (orbHpMultiplier > 1) enemy.applyHealthMultiplier(orbHpMultiplier)`.
- `SurvivorsGameplayState.onOrbPickup`: `addOrbHpBonus(0.05)` → `addOrbHpBonus(0.08)`.
- Result: 10 orbs ×2.16 HP · 20 orbs ×4.66 · 30 orbs ×10.06 — sits just under the
  player's ~+10%/orb damage growth, so orbs stay net-positive but stop trivializing.

### Change 2 — Per-wave baseline (HP + reward), gentle linear

- New `Enemy.applyRewardMultiplier(mult)` — typed setter, `this.reward = Math.floor(this.reward * mult)`
  (avoids `(enemy as any).reward`).
- New `EnemyManager.WAVE_HP_SCALE_PER_WAVE = 0.06` constant + `_applyWaveScaling(enemy)`
  helper, called in `spawnSurvivorsEnemy` right after `_applyOrbHpBonus`.
- Formula: `waveMult = 1 + 0.06 × (wave − 1)`, applied to **both** HP and reward so the
  shop economy keeps pace with rising HP. Contact damage is left as-is (already
  DPS-based and tuned).
- **Milestone bosses are exempt** (`if (enemy instanceof MilestoneBoss) return`) —
  their tier HP already derives from the wave number, so scaling again would
  double-count.
- Wave 1 ×1.0 · wave 10 ×1.54 · wave 20 ×2.14 · wave 30 ×2.74.

### Stacking order (all multiplicative)

```
finalHP = baseHP × [elite ×3] × orbMult(1.08^orbs) × waveMult(1 + 0.06·(wave−1))
```

Both magnitudes are single named constants (`addOrbHpBonus` arg = 0.08,
`WAVE_HP_SCALE_PER_WAVE` = 0.06), easy to playtest-tune.

### Edge cases (additions)

- **Mini-split spawns**: receive the orb buff (existing) but **not** per-wave scaling —
  they spawn via the `enemySplit` handler, not `spawnSurvivorsEnemy`. Acceptable: they
  inherit toughness from the splitter's death context.
- **Warmup / wave 1**: both multipliers are exactly 1 → no-ops.
- **Run reset**: `orbHpMultiplier` returns to 1 (EnemyManager reconstructed per run);
  wave reads fresh from `WaveManager`.
