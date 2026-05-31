# XP / Leveling System — Replace the Armory Shop with Automatic Progression

- **Date:** 2026-05-31
- **Status:** Approved-to-implement (user delegated implementation; will review the result)
- **Branch:** `feat/xp-leveling-system` (off `main` checkpoint `a50ad25`)
- **Scope:** new `src/survivors/LevelSystem.ts` + `tests/LevelSystem.spec.ts`; edits to `SurvivorsGameplayState.ts`, `PlayerStats.ts`, `HeroHud.ts`, `WaveManager.ts`; delete `src/ui/overlays/Shop.ts`.

## 1. Summary

Replace the between-wave gold **Armory shop** with an automatic **XP / leveling** system. The hero earns XP continuously (kills + wave-clear/perfect bonuses — i.e. the former *gold income*, redirected), levels up automatically, and each level grants **+0.5% to every attribute**, capping at **level 100 ≈ +50%**. There is **no per-level choice** — leveling is friction-free passive growth. The curve is tuned so a normal full-clear run reaches max level around **wave 30**.

The orb **power-choice** flow (powers, fusions, ultimates, and perk cards) is **untouched** — that is the only remaining "choose something" moment, and it stays exactly as-is.

## 2. Goals & non-goals

**Goals**
- Remove the gold Armory shop entirely (no more Haste / Power / Vitality / Swiftness / Reach / Bulwark / Precision / Savagery purchases). Those attribute bumps now come automatically from leveling.
- A single progression currency: gold is **folded into XP** (gold pill removed from the HUD).
- Every level-up grants +0.5% to all attributes; +50% cap at level 100.
- Hybrid XP feed: most XP from kills (smooth bar mid-wave), plus the wave-clear / perfect-wave chunks. Tuned so full-clear ≈ level 100 by wave 30 (approximate, by design).
- `LevelSystem` is pure logic (no Babylon), unit-tested like `PlayerStats` / `RunItems`.

**Non-goals**
- The orb power-choice (PowerChoiceOverlay / ReplaceSlotOverlay / fusions / ultimates / perk cards) is unchanged.
- Manual abilities (ultimates row, Q/E/Space) unchanged.
- No new enemies, powers, classes, or elements.

## 3. Locked design decisions

| Decision | Choice |
|---|---|
| What XP replaces | The gold **Armory shop** only. Power-choice stays. |
| Gold | **Folded into XP.** Gold income → XP; gold pill removed. `PlayerStats.money` kept internally (harmless) but never displayed/spent. |
| XP feed | **Hybrid** — kills + wave-clear + perfect-wave bonuses (the former gold-income stream, redirected to XP). |
| Level bonus | **+0.5% per level**, linear; level 100 ≈ **+49.5%** (treated as the "+50% cap" the user specified — see §5 for the exact-50 note). |
| Level cap | **100.** |
| Wave 30 → max | **Approximate** (curve-calibrated, hybrid). Not a hard guarantee. |
| Between-wave flow | Shop removed → waves **auto-advance** after a short breather (~2 s). The slow-mo orb power-choice still provides pauses. |

## 4. New module: `LevelSystem` (pure logic)

`src/survivors/LevelSystem.ts` — no Babylon, no `PlayerStats` import (keeps it unit-testable; the gameplay state owns the wiring).

```ts
export interface XpConfig {
  maxLevel: number;        // 100
  bonusPerLevel: number;   // 0.005  (+0.5% per level)
  curveBase: number;       // xpToNext(1)         — provisional, calibrated
  curveStep: number;       // linear growth/level — provisional, calibrated
  gainMultiplier: number;  // global income scalar for calibration (default 1.0)
}

export class LevelSystem {
  getLevel(): number;            // 1..maxLevel
  getProgress(): number;         // 0..1 into the current level (for the bar)
  getBonusFraction(): number;    // b = (level-1) * bonusPerLevel, capped
  getTotalXp(): number;
  isMaxLevel(): boolean;
  xpToNext(level: number): number;     // curveBase + curveStep*(level-1)
  addXp(amount: number): number;       // applies gainMultiplier; returns # of level-ups gained (0 if none)
}
```

- `addXp` rolls overflow into subsequent levels (a single large grant can yield multiple level-ups), stops at `maxLevel`, and returns the count so the caller fires per-level side-effects/feedback.
- All tuning lives in one `XP_CONFIG` literal in this file.

## 5. Attribute scaling — "+0.5% of each attribute"

Let `b = getBonusFraction() = (level − 1) × 0.005`. So `b(1) = 0`, `b(100) = 0.495` (**≈ +50%**, the cap the user described).

> **Exact-50 note:** literal "+0.5%/level" over levels 1→100 is 99 steps = +49.5%. Landing on exactly +50% is a one-constant tweak (`bonusPerLevel = 0.5/99 ≈ 0.00505`, or start the bonus at level 1). I'm shipping the literal +0.5%/level (≈+49.5% cap); flag on review if you want exact 50%.

On **every level-up**, `SurvivorsGameplayState.applyLevelBonuses()` recomputes and writes the same `PlayerStats` multiplier fields the shop used to mutate (validated: perk cards write to a *separate* `runPerks` object, so XP owning `playerStats.*` is safe and perks still stack multiplicatively on top):

| Attribute (`PlayerStats` field) | Set to | At L100 | Runtime push |
|---|---|---|---|
| `moveSpeedMultiplier` | `1 + b` | ×1.495 | `heroController.updateMoveSpeed(playerStats.moveSpeedMultiplier × runPerks.moveSpeedMultiplier)` |
| `attackRangeMultiplier` | `1 + b` | ×1.495 | `heroController.updateBasicAttackRange(… × runPerks.attackRangeMultiplier)` |
| `basicAttackSpeedMultiplier` | `1 + b` | ×1.495 | `heroController.updateBasicAttackSpeed(playerStats.basicAttackSpeedMultiplier)` |
| `powerDamageMultiplier` | `1 + b` | ×1.495 | pulled live by power context (`× runPerks.damageMultiplier`) — no push |
| `powerCooldownMultiplier` | `1 − b` | ×0.505 (≈−50% cd) | pulled live — no push |
| `damageReductionMultiplier` | `1 − b` | ×0.505 (≈−50% taken) | pulled live — no push |
| `critChance` | `b` | ≈0.495 | pulled live by `Enemy.critProvider` — no push |
| `critDamageMultiplier` | `1.5 × (1 + b)` | ≈2.24× | pulled live — no push |
| max HP | `round(baseMaxHealth × (1 + b))` | +49.5% HP | `heroController.addMaxHealth(delta)` + `heal(delta)` on the delta vs. previously-applied max |

`applyLevelBonuses()` is also called **once at run start** (level 1 → b=0, a no-op baseline) and is idempotent (it *sets*, never accumulates), so calling it after a multi-level grant is correct regardless of how many levels were gained.

## 6. XP economy (folding gold into XP)

**Principle:** every place that currently grants *gold income* becomes XP, with zero edits to the manager classes, via a single hook on `PlayerStats`:

```ts
// PlayerStats
private xpSink: ((amount: number) => void) | null = null;
public setXpSink(cb: (n: number) => void): void { this.xpSink = cb; }
// inside addMoney(amount): after the existing money/tracking lines →
this.xpSink?.(amount);
```

`SurvivorsGameplayState` sets the sink to `(amount) => this.awardXp(amount)`. Because the existing income sites already call `playerStats.addMoney(...)`, they now feed XP automatically:

| Source | Site | Note |
|---|---|---|
| Kill reward | `EnemyManager.ts:589` `addMoney(enemy.getReward())` | the smooth, bulk feed (scales with enemy difficulty) |
| Wave reward | `WaveManager.ts:598` `addMoney(wave.getReward())` | the wave-clear chunk |
| Perfect-wave bonus | `WaveManager.ts:860` `addMoney(perfectBonus)` | +5 HP heal stays |
| Boss / milestone | `AbilityManager.ts:1356`, `SurvivorsGameplayState.ts:1503/1552` | bonus XP |

`awardXp(amount)`:
```
const ups = this.levelSystem.addXp(amount);     // gainMultiplier applied inside
this.playerStats... (money still tracked, ignored)
if (ups > 0) { this.applyLevelBonuses(); this.showLevelUpFeedback(ups); }
```
HUD level/progress is refreshed every frame from `levelSystem` regardless.

**Curve & calibration.** `xpToNext(L) = curveBase + curveStep × (L−1)` (per-level cost rises linearly = "increasing scaling"). Provisional defaults: `curveBase = 60`, `curveStep = 6` ⇒ total-to-100 ≈ 35 000 XP; `gainMultiplier = 1.0`. These are **calibration targets, not final** — exact gold/XP yield across 30 procedural waves can't be computed statically. Implementation adds a wave-clear dev log:
```
[xp] wave=N level=L progress=P% totalXp=T (+dXp this wave)
```
After a measured full-clear run we tune `gainMultiplier` (or `curveBase/Step`) so the level-100 point lands near wave 30. This calibration is an explicit step in the plan, flagged for the user's review run.

## 7. Removing the Armory shop

- `SurvivorsGameplayState` wave-cleared handler (~`:613-626`): drop the `openShop()` call. Income is already awarded via the redirected `addMoney` → XP. After a short breather (~2 s; reuse the existing "WAVE CLEARED" display window / `autoWaveDelay`), **auto-advance** via `waveManager.startNextWave()`. (The `?test` path already auto-advances — this generalizes it to all runs.)
- Delete `src/ui/overlays/Shop.ts` (`BetweenWaveShopOverlay`) and remove its import/field/`openShop()`/`shopItems` definitions + all `apply()` handlers in `SurvivorsGameplayState` (the repo's dead-code-deletion convention).
- `PlayerStats.spendMoney` / `getPurchaseCount` / `incrementPurchase` become unused; leave the methods (cheap, referenced by tests) but they're no longer exercised in-run.

## 8. HUD changes (`HeroHud.ts`)

- **Remove** the gold pill (`goldText` and its pill), both desktop & mobile layouts.
- **Add** a thin full-width **XP bar** pinned to the very top edge (classic survivors), same Babylon-GUI `Rectangle` fill pattern as the HP bar (fill `width` = `levelSystem.getProgress()`), plus a **`LV n`** pill where the gold pill was (top-right).
- `HeroHud.update(...)` signature swaps the `gold` argument for `{ level, progress }`.

```
┌──────────────────────────────────────────────────────────┐
│██████████████████░░░░░░░░░░░░░░░░  ← XP bar (full-width top)│
│ [HP ▓▓▓▓▓░ 84/120]    WAVE 7 · 12 LEFT          ⬡ LV 23  ⏸│
│ [⚡][🔥][❄][✦] [items]                  [ult] [ult]        │
└──────────────────────────────────────────────────────────┘
```

## 9. Level-up feedback

On level-up (`ups > 0`): a brief **"LEVEL UP — Lv N"** toast + a flash on the XP bar (reuse `HudStyle` flash/pulse helpers); optional small sound. **No overlay, no pause** — friction-free is the whole point. If `ups > 1` from one big grant, show the final level.

## 10. Game-over summary

`totalMoneyEarned` now equals total XP earned (it accrues in `addMoney`). Relabel the summary's "gold earned" → "XP earned" and add "Level reached: N". No structural change to `SurvivorsRunSummary` required beyond labels (verify field availability during implementation).

## 11. Files

- **New:** `src/survivors/LevelSystem.ts`, `tests/LevelSystem.spec.ts`
- **Edit:** `SurvivorsGameplayState.ts` (own `LevelSystem`; `awardXp`/`applyLevelBonuses`/`showLevelUpFeedback`; remove shop wiring + handlers; auto-advance; wire `playerStats.setXpSink`), `PlayerStats.ts` (`xpSink` hook), `HeroHud.ts` (XP bar + `LV`, drop gold), `WaveManager.ts` (only if the breather/auto-advance needs a hook — prefer driving it from the state's handler)
- **Delete:** `src/ui/overlays/Shop.ts`

## 12. Testing

`tests/LevelSystem.spec.ts` (Vitest, pure logic):
- starts at level 1, `b = 0`;
- `xpToNext` strictly increasing;
- `addXp` below threshold → no level-up, progress advances;
- `addXp` of a large grant → multiple level-ups, returns the correct count;
- caps at level 100 (further XP is a no-op, `isMaxLevel()` true, `b = (100−1)×0.005`);
- `getBonusFraction()` monotonic, equals `(level−1)×0.005`.

Plus `npx tsc --noEmit` clean and a manual `?test` run to read the `[xp]` calibration log.

## 13. Risks

- **Calibration** (wave-30 target) is empirical — provisional constants + dev log + a tuning pass (§6). Accepted as approximate per the hybrid choice.
- **Auto-advance pacing** — removing the shop removes the only hard between-wave pause; the ~2 s breather + orb power-choice slow-mo must keep runs readable. Tune the breather on the review run.
- **No new transient FX** here, so the recurring material-orphan freeze class is not in scope — but the level-up flash must reuse cached/`HudStyle` GUI helpers, not allocate per level-up.
