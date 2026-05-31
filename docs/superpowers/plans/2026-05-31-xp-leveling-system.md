# XP / Leveling System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the gold Armory shop with an automatic XP/leveling system: kills + wave/perfect bonuses (former gold income, redirected) feed an XP bar; each level grants +0.5% to every attribute (cap level 100 ≈ +50%); tuned so a full clear hits max around wave 30.

**Architecture:** A new pure-logic `LevelSystem` (Vitest-tested, no Babylon) owns level/XP state and the bonus curve. `SurvivorsGameplayState` owns the instance, redirects the existing gold-income stream into it via a new `PlayerStats.xpSink` hook, and on each level-up writes the same `PlayerStats.*` multiplier fields the shop used to write (perks stay on a separate `runPerks` layer, untouched). The shop overlay is deleted and waves auto-advance after a short breather. The HUD swaps its gold pill for an XP bar + level pill.

**Tech Stack:** TypeScript, BabylonJS + @babylonjs/gui, Vitest, webpack.

**Spec:** `docs/superpowers/specs/2026-05-31-xp-leveling-system-design.md`

**Verification baseline:** `npx tsc --noEmit` (the source of truth per CLAUDE.md — not the IDE), `npm test`, `npm run build`.

---

## File Structure

- **Create** `src/survivors/LevelSystem.ts` — pure-logic level/XP state + curve + bonus fraction. One responsibility: the math of leveling.
- **Create** `tests/LevelSystem.spec.ts` — Vitest unit tests for the above.
- **Modify** `src/survivors/PlayerStats.ts` — add an `xpSink` hook; `addMoney` forwards income to it.
- **Modify** `src/survivors/SurvivorsGameplayState.ts` — own `LevelSystem`; `awardXp` / `applyLevelBonuses` / `showLevelUpFeedback`; remove shop wiring + handlers; auto-advance with breather; pass level/progress to the HUD; relabel game-over summary.
- **Modify** `src/survivors/ui/HeroHud.ts` — replace gold pill with an XP bar + `LV n` pill; `update()` takes `{level, progress}` instead of `gold`.
- **Delete** `src/ui/overlays/Shop.ts`.

---

### Task 1: `LevelSystem` pure-logic module (TDD)

**Files:**
- Create: `src/survivors/LevelSystem.ts`
- Test: `tests/LevelSystem.spec.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/LevelSystem.spec.ts
import { describe, it, expect } from 'vitest';
import { LevelSystem, XP_CONFIG } from '../src/survivors/LevelSystem';

describe('LevelSystem', () => {
  it('starts at level 1 with zero bonus and zero progress', () => {
    const ls = new LevelSystem();
    expect(ls.getLevel()).toBe(1);
    expect(ls.getBonusFraction()).toBe(0);
    expect(ls.getProgress()).toBe(0);
    expect(ls.isMaxLevel()).toBe(false);
  });

  it('has a strictly increasing per-level cost curve', () => {
    const ls = new LevelSystem();
    for (let L = 1; L < XP_CONFIG.maxLevel - 1; L++) {
      expect(ls.xpToNext(L + 1)).toBeGreaterThan(ls.xpToNext(L));
    }
  });

  it('does not level up below the threshold, but advances progress', () => {
    const ls = new LevelSystem();
    const need = ls.xpToNext(1);
    const ups = ls.addXp(Math.floor(need / 2));
    expect(ups).toBe(0);
    expect(ls.getLevel()).toBe(1);
    expect(ls.getProgress()).toBeGreaterThan(0);
    expect(ls.getProgress()).toBeLessThan(1);
  });

  it('levels up once when the threshold is crossed', () => {
    const ls = new LevelSystem();
    const ups = ls.addXp(ls.xpToNext(1));
    expect(ups).toBe(1);
    expect(ls.getLevel()).toBe(2);
    expect(ls.getBonusFraction()).toBeCloseTo(0.005, 6);
  });

  it('rolls a large grant into multiple level-ups and reports the count', () => {
    const ls = new LevelSystem();
    const huge = 10_000_000; // far beyond total-to-max
    const ups = ls.addXp(huge);
    expect(ls.getLevel()).toBe(XP_CONFIG.maxLevel);
    expect(ups).toBe(XP_CONFIG.maxLevel - 1);
    expect(ls.isMaxLevel()).toBe(true);
  });

  it('caps at max level: further XP is a no-op and progress stays full', () => {
    const ls = new LevelSystem();
    ls.addXp(10_000_000);
    const before = ls.getTotalXp();
    const ups = ls.addXp(5000);
    expect(ups).toBe(0);
    expect(ls.getLevel()).toBe(XP_CONFIG.maxLevel);
    expect(ls.getTotalXp()).toBe(before); // surplus discarded at cap
    expect(ls.getProgress()).toBe(1);
    expect(ls.getBonusFraction()).toBeCloseTo((XP_CONFIG.maxLevel - 1) * 0.005, 6);
  });

  it('bonus fraction equals (level-1) * bonusPerLevel', () => {
    const ls = new LevelSystem();
    ls.addXp(ls.xpToNext(1) + ls.xpToNext(2)); // -> level 3
    expect(ls.getLevel()).toBe(3);
    expect(ls.getBonusFraction()).toBeCloseTo(2 * 0.005, 6);
  });

  it('applies the gain multiplier to incoming XP', () => {
    const fast = new LevelSystem({ ...XP_CONFIG, gainMultiplier: 1000 });
    const ups = fast.addXp(fast.xpToNext(1) / 1000 + 0.001);
    expect(ups).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/LevelSystem.spec.ts`
Expected: FAIL — `Cannot find module '../src/survivors/LevelSystem'`.

- [ ] **Step 3: Implement `LevelSystem`**

```ts
// src/survivors/LevelSystem.ts
/**
 * LevelSystem — pure-logic hero leveling (no Babylon, no PlayerStats import, so it
 * is unit-testable). The gameplay state owns the instance and wires its effects:
 * on each level-up it pushes the +0.5%/level attribute bonus onto PlayerStats and
 * shows feedback. XP is fed from the former gold-income stream (kills + wave/perfect
 * bonuses) via PlayerStats.setXpSink. See
 * docs/superpowers/specs/2026-05-31-xp-leveling-system-design.md.
 */
export interface XpConfig {
  /** Hard level cap. */
  maxLevel: number;
  /** Bonus fraction added per level: 0.005 = +0.5% per level (≈+50% at level 100). */
  bonusPerLevel: number;
  /** XP needed to go from level 1 → 2. */
  curveBase: number;
  /** Linear growth of the per-level cost: xpToNext(L) = curveBase + curveStep*(L-1). */
  curveStep: number;
  /** Global scalar applied to every addXp() amount — the calibration knob. */
  gainMultiplier: number;
}

/**
 * PROVISIONAL — calibrated post-build via the [xp] wave-clear log (see plan Task 5).
 * Defaults size total-to-max ≈ 35k XP so a full clear lands near wave 30.
 */
export const XP_CONFIG: XpConfig = {
  maxLevel: 100,
  bonusPerLevel: 0.005,
  curveBase: 60,
  curveStep: 6,
  gainMultiplier: 1.0,
};

export class LevelSystem {
  private cfg: XpConfig;
  private level = 1;
  private xpIntoLevel = 0; // XP accumulated toward the NEXT level
  private totalXp = 0;     // lifetime XP actually consumed (excludes surplus at cap)

  constructor(cfg: XpConfig = XP_CONFIG) {
    this.cfg = cfg;
  }

  getLevel(): number { return this.level; }
  getTotalXp(): number { return this.totalXp; }
  isMaxLevel(): boolean { return this.level >= this.cfg.maxLevel; }

  /** Bonus fraction at the current level: (level-1) * bonusPerLevel. */
  getBonusFraction(): number {
    return (this.level - 1) * this.cfg.bonusPerLevel;
  }

  /** 0..1 fill of the current level (1 when maxed). */
  getProgress(): number {
    if (this.isMaxLevel()) return 1;
    const need = this.xpToNext(this.level);
    return need > 0 ? Math.min(1, this.xpIntoLevel / need) : 0;
  }

  /** XP required to advance FROM `level` to `level+1`. */
  xpToNext(level: number): number {
    return Math.round(this.cfg.curveBase + this.cfg.curveStep * (level - 1));
  }

  /**
   * Add XP (scaled by gainMultiplier). Returns the number of level-ups gained so
   * the caller can fire per-level side effects/feedback. Surplus XP at the cap is
   * discarded.
   */
  addXp(amount: number): number {
    if (this.isMaxLevel() || amount <= 0) return 0;
    let remaining = amount * this.cfg.gainMultiplier;
    let ups = 0;
    while (remaining > 0 && !this.isMaxLevel()) {
      const need = this.xpToNext(this.level) - this.xpIntoLevel;
      if (remaining >= need) {
        remaining -= need;
        this.totalXp += need;
        this.xpIntoLevel = 0;
        this.level++;
        ups++;
      } else {
        this.xpIntoLevel += remaining;
        this.totalXp += remaining;
        remaining = 0;
      }
    }
    if (this.isMaxLevel()) this.xpIntoLevel = 0; // surplus discarded
    return ups;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/LevelSystem.spec.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Type-check & commit**

```bash
npx tsc --noEmit
git add src/survivors/LevelSystem.ts tests/LevelSystem.spec.ts
git commit -m "feat(xp): pure-logic LevelSystem + unit tests (+0.5%/level, cap 100)"
```

---

### Task 2: `PlayerStats.xpSink` hook

**Files:**
- Modify: `src/survivors/PlayerStats.ts` (add field + setter near line 78; forward in `addMoney` ~144-149)

- [ ] **Step 1: Add the hook field + setter**

After the `purchaseCounts` field (PlayerStats.ts:78), add:

```ts
    /** Optional sink: every gold-income amount is mirrored here (folded into XP). */
    private xpSink: ((amount: number) => void) | null = null;
    /** Route gold income into the XP/level system. Set once by SurvivorsGameplayState. */
    public setXpSink(cb: ((amount: number) => void) | null): void {
        this.xpSink = cb;
    }
```

- [ ] **Step 2: Forward income from `addMoney`**

In `addMoney` (PlayerStats.ts:144-149), after the existing body, add the forward:

```ts
    public addMoney(amount: number): void {
        if (!this.unlimitedMoney) {
            this.money += amount;
        }
        this.totalMoneyEarned += amount;
        this.xpSink?.(amount); // gold income folds into XP
    }
```

- [ ] **Step 3: Type-check & commit**

```bash
npx tsc --noEmit
git add src/survivors/PlayerStats.ts
git commit -m "feat(xp): PlayerStats.xpSink hook — gold income forwards to XP"
```

Note: pure-logic, but the existing `tests/PlayerStats.spec.ts` must still pass (no sink set → no behavior change). Verify with `npx vitest run tests/PlayerStats.spec.ts`.

---

### Task 3: Wire `LevelSystem` into `SurvivorsGameplayState` (no UI yet)

**Files:**
- Modify: `src/survivors/SurvivorsGameplayState.ts` — import; fields; create in `startRun`; `awardXp`; `applyLevelBonuses`; baseline call; reset in `exit`.

- [ ] **Step 1: Import + fields**

Add import near the other survivors imports:
```ts
import { LevelSystem } from './LevelSystem';
```
Add fields near `playerStats` declaration:
```ts
    private levelSystem: LevelSystem | null = null;
    /** Hero base max HP captured at run start — XP scales max HP off this. */
    private baseMaxHealth = 0;
    /** How much max-HP bonus has already been pushed to the hero (delta-applied). */
    private appliedMaxHpBonus = 0;
    /** Seconds remaining in the post-wave breather before auto-advancing. */
    private waveBreatherRemaining = 0;
    private static readonly WAVE_BREATHER_SECONDS = 2;
```

- [ ] **Step 2: Create the system in `startRun`**

Right after `this.playerStats = new PlayerStats(heroHp, 100);` (SurvivorsGameplayState.ts:442) add:
```ts
        // XP / leveling replaces the gold shop. Gold income is folded into XP via
        // the sink below; each level-up pushes +0.5%/level onto every attribute.
        this.levelSystem = new LevelSystem();
        this.baseMaxHealth = heroHp;
        this.appliedMaxHpBonus = 0;
        this.playerStats.setXpSink((amount) => this.awardXp(amount));
```
(`heroHp` is the variant HP used two lines above for `new HeroController(... heroHp ...)`, so it is the hero's true base max.)

- [ ] **Step 3: Add `awardXp` + `applyLevelBonuses`**

Add these private methods (near the former shop section, which Task 4 removes):
```ts
    /** Feed XP and, on any level-up, push the new attribute bonuses + show feedback. */
    private awardXp(amount: number): void {
        if (!this.levelSystem) return;
        const ups = this.levelSystem.addXp(amount);
        if (ups > 0) {
            this.applyLevelBonuses();
            this.showLevelUpFeedback(this.levelSystem.getLevel());
        }
    }

    /**
     * Write the level bonus onto the same PlayerStats multiplier fields the shop
     * used to mutate. Idempotent (SETS, never accumulates) so it is correct after a
     * multi-level grant. Perks live on the separate runPerks layer and still stack.
     */
    private applyLevelBonuses(): void {
        if (!this.playerStats || !this.levelSystem) return;
        const b = this.levelSystem.getBonusFraction();
        const ps = this.playerStats;
        ps.moveSpeedMultiplier        = 1 + b;
        ps.attackRangeMultiplier      = 1 + b;
        ps.basicAttackSpeedMultiplier = 1 + b;
        ps.powerDamageMultiplier      = 1 + b;
        ps.powerCooldownMultiplier    = 1 - b; // lower = faster
        ps.damageReductionMultiplier  = 1 - b; // lower = tankier
        ps.critChance                 = b;
        ps.critDamageMultiplier       = 1.5 * (1 + b);

        // Max HP: scale off base, apply only the delta to the hero (and heal it).
        const targetBonus = Math.round(this.baseMaxHealth * b);
        const delta = targetBonus - this.appliedMaxHpBonus;
        if (delta !== 0 && this.heroController) {
            this.heroController.addMaxHealth(delta);
            if (delta > 0) this.heroController.heal(delta);
            this.appliedMaxHpBonus = targetBonus;
        }

        // Re-push the multipliers that are PUSHED (not pulled live), combined with runPerks.
        this.heroController?.updateMoveSpeed(ps.moveSpeedMultiplier * this.runPerks.moveSpeedMultiplier);
        this.heroController?.updateBasicAttackRange(ps.attackRangeMultiplier * this.runPerks.attackRangeMultiplier);
        this.heroController?.updateBasicAttackSpeed(ps.basicAttackSpeedMultiplier);
    }
```

- [ ] **Step 4: Baseline call after `runPerks` reset**

`runPerks` is reset at `SurvivorsGameplayState.ts:1085` (`this.runPerks = { damageMultiplier: 1.0, moveSpeedMultiplier: 1.0, attackRangeMultiplier: 1.0 };`). Immediately AFTER that line add:
```ts
        // Establish the level-1 baseline (b=0): sets multipliers to their neutral
        // values and pushes them once. heroController already exists here.
        this.applyLevelBonuses();
```
> **Ordering note (verify at execution):** `applyLevelBonuses` reads `runPerks` and `heroController`. Confirm line 1085 runs during `startRun` AFTER `heroController` (created at :427) is assigned. It is null-safe regardless, but the baseline push must happen once with both ready. If 1085 precedes hero creation in some path, move the baseline call to just after Step 2 instead.

- [ ] **Step 5: Add the `[xp]` calibration log + reset in `exit`**

In the wave-cleared handler (edited in Task 4) add a dev log; and in `exit()` clear the system. In `exit()` (near where `shopOverlay` is nulled, ~:996) add:
```ts
        this.levelSystem = null;
        this.appliedMaxHpBonus = 0;
        this.waveBreatherRemaining = 0;
```

- [ ] **Step 6: Type-check & commit**

```bash
npx tsc --noEmit
git add src/survivors/SurvivorsGameplayState.ts
git commit -m "feat(xp): wire LevelSystem — gold income -> XP, level-up pushes +0.5%/level"
```
(Will still compile with the shop present; shop removal is Task 4.)

---

### Task 4: Remove the Armory shop + auto-advance waves

**Files:**
- Modify: `src/survivors/SurvivorsGameplayState.ts`
- Delete: `src/ui/overlays/Shop.ts`

- [ ] **Step 1: Rewrite the wave-cleared handler**

Replace the body of `setOnWaveCleared` (SurvivorsGameplayState.ts:613-626) with:
```ts
        this.waveManager.setOnWaveCleared(() => {
            const clearedWave = this.waveManager?.getCurrentWave() ?? 0;
            this.checkResourceBudget(clearedWave);
            this.maybeDisableEnemyShadows(clearedWave);
            // Calibration log (read in a ?test run to tune XP_CONFIG so level 100
            // lands near wave 30). See the XP spec §6.
            if (this.levelSystem) {
                console.log(`[xp] wave=${clearedWave} level=${this.levelSystem.getLevel()} ` +
                    `progress=${Math.round(this.levelSystem.getProgress() * 100)}% ` +
                    `totalXp=${Math.round(this.levelSystem.getTotalXp())}`);
            }
            // No shop: auto-advance after a short breather (the slow-mo orb
            // power-choice still provides the only real pause). ?test advances now.
            if (this.testMode) { this.waveManager?.startNextWave(); return; }
            this.waveBreatherRemaining = SurvivorsGameplayState.WAVE_BREATHER_SECONDS;
        });
```

- [ ] **Step 2: Drive the breather from the update loop**

In the main per-frame update (the method containing `this.heroController.update(dt)` ~:1111), add — guarded so it only ticks between waves and not while an overlay is open:
```ts
        // Between-wave breather → auto-advance (shop removed).
        if (this.waveBreatherRemaining > 0) {
            this.waveBreatherRemaining -= dt;
            if (this.waveBreatherRemaining <= 0) {
                this.waveBreatherRemaining = 0;
                this.waveManager?.startNextWave();
            }
        }
```
> Place this AFTER the pause/overlay early-returns in the update method so it does not tick while paused or while the power-choice overlay is up (it uses real dt, which is already 0/halted under slow-mo handling — verify it advances at a sensible wall-clock rate during execution; if slow-mo scales dt, gate on `!this.powerChoice?.isOpen()`).

- [ ] **Step 3: Remove shop wiring**

Delete each of these in `SurvivorsGameplayState.ts`:
- Import (line 23): `import { BetweenWaveShopOverlay, ShopItem } from '../ui/overlays/Shop';`
- Field (line 246): `private shopOverlay: BetweenWaveShopOverlay | null = null;`
- Construction (line 723): `this.shopOverlay = new BetweenWaveShopOverlay(this.gameUI!.layer('overlay'));`
- `openShop()` method (lines 1560-1572) and `buildShopItems()` (1574 through its closing `];`/`}` — the full returned array of shop items) and any `this.shopItems` field + its assignment (search `shopItems`).
- `exit()` cleanup (lines 996-997): `this.shopOverlay?.close(); this.shopOverlay = null;`
- Overlay-open checks referencing the shop: line ~1242 `this.shopOverlay?.isOpen()` (in the overlay-active guard) and line ~1874 `if (this.shopOverlay?.isOpen()) overlays.push('shop');` — remove the shop term from each expression.

Use `grep -n "shopOverlay\|shopItems\|openShop\|buildShopItems\|BetweenWaveShopOverlay\|ShopItem" src/survivors/SurvivorsGameplayState.ts` to confirm zero remaining references after editing.

- [ ] **Step 4: Delete the shop overlay file**

```bash
git rm src/ui/overlays/Shop.ts
```
Then confirm nothing else imports it:
```bash
grep -rn "overlays/Shop" src/ || echo "no remaining importers"
```

- [ ] **Step 5: Type-check & commit**

```bash
npx tsc --noEmit
git add -A
git commit -m "feat(xp): remove Armory shop; waves auto-advance after a breather"
```
Expected `tsc`: clean. If unused-import errors appear for `ShopItem`/`makePill` etc., remove the now-dead imports.

---

### Task 5: HUD — XP bar + `LV n` pill, drop gold

**Files:**
- Modify: `src/survivors/ui/HeroHud.ts` (gold pill blocks ~256-272 desktop & ~426-442 mobile; `update()` signature :763 + body :791-795, :840; add `xpFill` + `levelText` fields :56-80)
- Modify: `src/survivors/SurvivorsGameplayState.ts` (the `this.hud.update(...)` call at :1211-1217)

- [ ] **Step 1: Swap fields**

In HeroHud field block (~:56, :80), replace the gold fields with:
```ts
    private levelText!: TextBlock;          // "LV n" pill text (was goldText)
    private levelPillBg: Rectangle | null = null;
    private xpFill!: Rectangle;             // full-width top XP bar fill
    private prevLevel = -1;                 // for level-up pulse (was prevGold)
```
Remove `goldText`, `goldPillBg`, and the `prevGold` field/usages.

- [ ] **Step 2: Build the LV pill + XP bar (desktop, ~:256-272)**

Replace the desktop gold-pill block with a `LV` pill (same `makePill` shape/position) plus a thin full-width XP bar pinned to the top edge. Mirror the existing HP-bar `Rectangle` construction (HeroHud ~:209-226) for the fill:
```ts
        // LV pill (top-right, where gold used to be)
        const levelPill = makePill({ text: 'LV 1', /* match gold pill width/style */ });
        levelPill.bg.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
        levelPill.bg.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        levelPill.bg.top = '10px';
        levelPill.bg.left = '-10px';
        this.ui.addControl(levelPill.bg);
        this.builtControls.push(levelPill.bg);
        this.levelText = levelPill.text;
        this.levelPillBg = levelPill.bg;

        // XP bar — thin, full width, pinned to the very top edge.
        const xpTrack = new Rectangle('xpTrack');
        xpTrack.width = 1.0; xpTrack.height = '6px';
        xpTrack.thickness = 0; xpTrack.background = 'rgba(0,0,0,0.45)';
        xpTrack.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        xpTrack.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
        xpTrack.top = '0px';
        this.ui.addControl(xpTrack); this.builtControls.push(xpTrack);
        this.xpFill = new Rectangle('xpFill');
        this.xpFill.width = 0; this.xpFill.height = 1.0; this.xpFill.thickness = 0;
        this.xpFill.background = '#6cf';
        this.xpFill.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        xpTrack.addControl(this.xpFill);
```
> Use the project's element/accent palette (`STYLE`/`ELEMENT_COLOR`) for the fill color instead of a raw hex if a fitting constant exists. Match `makePill` args to the real signature (read the gold pill call for the exact options).

- [ ] **Step 3: Mirror for mobile (~:426-442)**

Apply the same swap in the mobile layout block. The mobile XP bar can reuse the same full-width top-edge track (it is layout-agnostic — build it once if the desktop/mobile builders share a path, otherwise duplicate height `'5px'`).

- [ ] **Step 4: Change `update()` signature + body**

Signature (HeroHud.ts:763): replace `gold: number,` with:
```ts
        xp: { level: number; progress: number },
```
Body: replace the gold-pulse block (:791-795) with a level-up pulse:
```ts
        if (this.prevLevel >= 0 && xp.level > this.prevLevel && this.levelPillBg) {
            pulseScale(this.levelPillBg, 1.15, 220);
        }
        this.prevLevel = xp.level;
```
Replace the gold text line (:840) with:
```ts
        this.levelText.text = `LV ${xp.level}`;
        this.xpFill.width = Math.max(0, Math.min(1, xp.progress));
```

- [ ] **Step 5: Update the call site**

In `SurvivorsGameplayState.ts` (:1211-1217) replace `this.playerStats.getGold(),` with:
```ts
                { level: this.levelSystem?.getLevel() ?? 1, progress: this.levelSystem?.getProgress() ?? 0 },
```

- [ ] **Step 6: Type-check & commit**

```bash
npx tsc --noEmit
git add src/survivors/ui/HeroHud.ts src/survivors/SurvivorsGameplayState.ts
git commit -m "feat(xp): HUD shows XP bar + LV pill (gold pill removed)"
```

---

### Task 6: Level-up feedback toast

**Files:**
- Modify: `src/survivors/SurvivorsGameplayState.ts` — add `showLevelUpFeedback`; optionally `HeroHud.flashXpBar()`.

- [ ] **Step 1: Add `showLevelUpFeedback`**

Reuse the existing floating-text / toast facility (the project has `DamageNumberManager` and `HudStyle` flash helpers — prefer an existing path; do NOT allocate a new material/mesh per level-up, per the freeze-class invariant in CLAUDE.md). Minimal version using the damage-number manager's world-text, or a HUD flash:
```ts
    private showLevelUpFeedback(level: number): void {
        // Lightweight, allocation-free feedback. Prefer an existing toast/flash.
        console.log(`[xp] LEVEL UP -> Lv ${level}`);
        this.hud?.flashXpBar?.();         // optional bar flash (Step 2)
        // If a floating-text helper exists at the hero, show "LEVEL UP! Lv N" there.
    }
```

- [ ] **Step 2 (optional): `HeroHud.flashXpBar()`**

```ts
    public flashXpBar(): void {
        if (this.xpFill) flashControl(this.xpFill, '#ffffff', 200, 0.7);
    }
```

- [ ] **Step 3: Type-check & commit**

```bash
npx tsc --noEmit
git add src/survivors/SurvivorsGameplayState.ts src/survivors/ui/HeroHud.ts
git commit -m "feat(xp): level-up feedback (XP-bar flash + log)"
```

---

### Task 7: Game-over summary relabel

**Files:**
- Modify: `src/survivors/SurvivorsGameplayState.ts` — summary build (~:963-973)
- Possibly: `src/game-over/GameOverState.ts` / `SurvivorsRunSummary` (labels only)

- [ ] **Step 1: Inspect the summary shape**

Run: `grep -n "SurvivorsRunSummary" src/game-over/GameOverState.ts` and read the interface + the build block at SurvivorsGameplayState.ts:963.

- [ ] **Step 2: Add level reached / relabel gold→XP**

In the `summary` object, where gold/money-earned is reported, surface the level and treat `totalMoneyEarned` as XP earned. Example (adapt to the real fields):
```ts
        // 'gold earned' is now 'XP earned' (income folds into XP); add level reached.
        const summary: SurvivorsRunSummary = {
            // ...existing fields...
            // goldEarned: this.playerStats.getTotalMoneyEarned(),  -> relabel in UI as "XP earned"
            levelReached: this.levelSystem?.getLevel() ?? 1,
        };
```
If `SurvivorsRunSummary` has no `levelReached`, add the optional field to its interface and render it in `GameOverState` next to the existing stats. Keep it minimal — labels + one new number.

- [ ] **Step 3: Type-check & commit**

```bash
npx tsc --noEmit
git add -A
git commit -m "feat(xp): game-over summary shows level reached; gold->XP label"
```

---

### Task 8: Full verification + calibration pass

- [ ] **Step 1: Type-check, tests, build**

```bash
npx tsc --noEmit && echo TSC_OK
npm test
npm run build
```
Expected: `tsc` clean; all Vitest specs pass (LevelSystem + PlayerStats + RunItems + existing); webpack build succeeds.

- [ ] **Step 2: Manual calibration run**

Start `npm start`, open `http://localhost:9000/?test` (auto-starts, auto-advances). Watch the console `[xp] wave=… level=… progress=… totalXp=…` lines. Confirm:
- XP bar fills smoothly during waves; `LV` pill increments; no gold pill.
- Level climbs and reaches ~100 around wave ~30. If it maxes far too early/late, tune `XP_CONFIG.gainMultiplier` (or `curveBase`/`curveStep`) in `LevelSystem.ts` and re-run. Lower `gainMultiplier` → slower leveling.
- No `[resource-watchdog] LEAK SUSPECTED` lines (the level-up feedback must not allocate per-level).

- [ ] **Step 3: Commit any calibration tweak**

```bash
git add src/survivors/LevelSystem.ts
git commit -m "tune(xp): calibrate curve so level 100 lands ~wave 30"
```

---

## Self-Review

**Spec coverage:**
- §3 shop removal → Task 4. Gold folded into XP → Task 2 + Task 3 Step 2. Power-choice untouched → no task touches it (verified). ✔
- §4 LevelSystem API (getLevel/getProgress/getBonusFraction/getTotalXp/isMaxLevel/xpToNext/addXp, XpConfig) → Task 1 (all present, names match). ✔
- §5 attribute table (8 multipliers + maxHP, inverted cooldown/dmg-taken, additive crit, push vs pull, idempotent, baseline call) → Task 3 Steps 3-4. ✔
- §6 income hook + all four income sites via `addMoney` + curve + gainMultiplier + `[xp]` log → Task 2, Task 3, Task 4 Step 1. ✔
- §7 auto-advance + delete Shop.ts + leave spendMoney → Task 4. ✔
- §8 HUD XP bar + LV pill, drop gold, `{level,progress}` arg → Task 5. ✔
- §9 level-up feedback, no per-level allocation → Task 6. ✔
- §10 summary relabel + level reached → Task 7. ✔
- §12 tests → Task 1; tsc/build/manual → Task 8. ✔

**Placeholder scan:** Steps that touch GUI (Task 5) reference "mirror the existing HP-bar construction / match makePill args" — these point to concrete existing code to copy, not vague TODOs; full surrounding code is given. No "TBD"/"handle edge cases". ✔

**Type consistency:** `addXp` returns `number` (level-up count) used by `awardXp`; `getBonusFraction()`/`getProgress()`/`getLevel()` names identical across Task 1 def and Tasks 3/5 uses; HUD `update` `xp:{level,progress}` matches the call site object; `setXpSink`/`xpSink` consistent (Task 2 ↔ Task 3). ✔
