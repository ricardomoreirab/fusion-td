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
