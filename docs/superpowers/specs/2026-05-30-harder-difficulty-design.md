# Harder Difficulty (≈+50%) + Freeze Fix — Design

Date: 2026-05-30
Branch: `feat/harder-difficulty` (worktree, on top of the boss-rework WIP)

## Goal

Make survivors mode meaningfully harder across **all four axes** — tankier
enemies, more incoming damage, bigger/faster swarms, and harder bosses/elites —
for an **aggregate** "substantial" (~50%) increase in difficulty. Separately,
**investigate and fix the remaining frame-time freezing**, which more enemies on
screen will only expose harder.

## Non-goals

- A Normal/Hard/Brutal difficulty *selector* (explicitly declined). The tuning
  lives in one constants file so a selector is trivial to add later, but we are
  not building the UI/state for it now.
- Reworking the existing per-wave `speedMultiplier` / clear-time scaling system.
  Our changes layer on top of it.
- Touching the orb-HP / geometric-wave-scaling work happening in the separate
  `debug-freezes` worktree.

## Part A — Difficulty rebalance

### Approach: one central tuning module

Add `src/survivors/DifficultyTuning.ts` exporting a plain constants object — the
single source of truth for the rebalance. Every consumer reads from it instead
of carrying a local magic number. This keeps the entire rebalance reviewable in
one place and trivially tunable after playtest.

```ts
export const DifficultyTuning = {
  enemyHpMult:    1.30, // global trash/normal-enemy max-HP multiplier
  enemyDamageMult:1.25, // global contact + melee damage multiplier
  spawnRateMult:  2.6,  // survivors spawn cadence (was 2.2)
  enemyCountMult: 1.9,  // enemies per wave   (was 1.6)
  bossHpMult:     1.30, // extra HP on milestone bosses, on top of tier mults
  bossDamageMult: 1.20, // extra contact/melee damage on milestone bosses
  eliteHpMult:    3.5,  // elite HP multiplier (was 3.0)
  playerStartHp:  110,  // starting/max hero HP (was 120)
} as const;
```

### Why modest per-axis numbers

The four axes compound multiplicatively (tankier × more-of-them × hit-harder).
1.5× on *each* axis would stack to ~3× — brutal, not substantial. The numbers
above are deliberately modest per-axis so the **aggregate** feel lands at
"substantial" (~1.5–1.7× overall).

### Injection points (all existing, single-site each)

| Knob | File:line | Change |
|---|---|---|
| spawn cadence + count | `SurvivorsGameplayState.ts:532` `setSurvivorsRates(2.2, 1.6)` | read `spawnRateMult` / `enemyCountMult` |
| global enemy HP + damage | `EnemyManager.spawnSurvivorsEnemy` (~:458, alongside `_applyWaveScaling`) | new `_applyGlobalDifficulty(enemy)` — ×`enemyHpMult` maxHealth, ×`enemyDamageMult` contact+melee damage; **skips milestone bosses** (they get their own boss mults) |
| milestone boss HP/damage | `MilestoneBoss.ts` (WIP file) | tier HP × `bossHpMult`, contact/melee damage × `bossDamageMult` |
| elite HP | `EliteSpawner.ts` (literal `3`) | read `eliteHpMult` |
| player HP | `PlayerStats` construction in `SurvivorsGameplayState` / `PlayerStats` default | `playerStartHp` (110) |

`_applyGlobalDifficulty` runs in the same per-spawn chain as the existing elite /
orb / wave-scaling multipliers, so ordering is explicit and compounding is
intentional. **Milestone bosses are excluded** from the global trash multiplier
to avoid double-scaling — they derive HP from tier and take the boss mults
instead.

### Economy

Reward already scales with the difficulty multiplier (`reward × mult^0.9` in
`Enemy.applyDifficultyMultiplier`) and elites keep their `1.5×` reward. We do not
add a separate gold knob — tankier/more enemies naturally pay out more, keeping
the shop affordable. We verify gold income still feels fair during playtest.

## Part B — Freeze investigation & fix

Treated as a **systematic-debugging** task, not a guess-and-patch:

1. **Reproduce** — run the app, play into the swarm/boss waves, confirm the hitch
   and note when it fires (spawn surge? boss spawn? death burst?).
2. **Instrument** — watch frame time alongside live counts of meshes, materials,
   textures, `scene.animatables`, and `_activeAnimatables`. The existing
   ">50ms spawn" diagnostic in `spawnSurvivorsEnemy` is one signal; add temporary
   counters as needed.
3. **Find root cause** — identify exactly what climbs / spikes when the freeze
   hits before changing anything.
4. **Fix the root cause**, then confirm the instrument no longer shows the leak/
   spike. Remove temporary instrumentation.

Prime suspects (from this project's history — to be confirmed, not assumed): per-
spawn disposal leaks, the material-cache key leak, cloned-GLB skeleton bone-matrix
textures, looping animatables, and anything the in-progress boss rework introduced.

## Verification

- `npx tsc --noEmit` clean and `npm test` green after changes (existing
  `PlayerStats`/`RunItems`/`WaveElites` specs still pass; add/extend a pure-logic
  test if a tunable lands in a testable module).
- Manual playtest: difficulty feels substantially harder but fair; gold keeps up;
  **no freezing** during swarm and boss waves (frame-time/leak instrument flat).

## Risks

- Compounding too hard → dial the `DifficultyTuning` numbers down (single file).
- Player-HP cut + damage bump together may overshoot the "incoming damage" axis →
  tune `playerStartHp` / `enemyDamageMult` independently.
- Editing `MilestoneBoss.ts` overlaps the boss-rework WIP — apply boss mults
  surgically to avoid conflicting with in-progress logic.
