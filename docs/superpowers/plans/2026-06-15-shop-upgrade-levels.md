# Shop Upgrade Levels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a permanent, uncapped shop upgrade level (`+N`) that makes every item on offer a stronger, pricier `+N` version, so the player keeps spending gold all run.

**Architecture:** A new pure module `ShopUpgrade.ts` owns all the scaling math (upgrade cost curve, bonus scale, item-price scale, `scaleMods`). `Equipment` captures the shop level at purchase into each `EquippedItem` and scales that item's stat mods by its captured level when aggregating — so equipped gear is frozen at the level it was bought, and re-buying from a higher shop level installs the stronger version. `SurvivorsGameplayState` holds `shopLevel` as run state and adds an upgrade action; the `ShopOverlay` gets an upgrade button + `+N` badges.

**Tech Stack:** TypeScript, BabylonJS (DOM UI), Vitest.

**Key scaling rules:**
- Upgrade cost (N→N+1): `round(300 × 1.6^N)` → 300, 480, 768, 1229, … 20616 at +9→+10. Uncapped.
- Bonus scale at level N: `1 + 0.10·N` (applies to an item's own `ItemStatMods` only).
- Item price scale at level N: `1 + 0.12·N` (multiplies the existing wave-scaled price).
- **NOT scaled:** set bonuses (2/4/6-pc tiers) and named effects (rage, midas, …) stay at catalog values.

---

## File Structure

- **Create** `src/survivors/shop/ShopUpgrade.ts` — pure scaling math (cost curve, scale factors, `scaleMods`).
- **Create** `tests/ShopUpgrade.spec.ts` — unit tests for the above.
- **Modify** `src/survivors/items/Equipment.ts` — `EquippedItem.level`, `priceFor` shopLevel arg, `buy` captures level, `aggregates` scales by level.
- **Modify** `tests/Equipment.spec.ts` — new cases for level capture + level-scaled aggregates.
- **Modify** `src/survivors/items/describeMods.ts` — round integer-display fields so scaled (fractional) mods render cleanly.
- **Modify** `src/ui/overlays/ShopOverlay.ts` — `ShopVM`/`ShopCardVM` fields, upgrade button, `Shop +N` label, `+N` card badge, `onUpgrade` callback.
- **Modify** `src/survivors/SurvivorsGameplayState.ts` — `shopLevel` run field + reset, `handleShopUpgrade`, pass `shopLevel` into buy/buildShopVM, scale stat-line previews.
- **Modify** `src/ui/styles/components.css` — upgrade button, shop-level label, `+N` badge.

---

## Task 1: ShopUpgrade pure module

**Files:**
- Create: `src/survivors/shop/ShopUpgrade.ts`
- Test: `tests/ShopUpgrade.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/ShopUpgrade.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
    shopUpgradeCost, bonusScaleFor, itemPriceScaleFor, scaleMods,
} from '../src/survivors/shop/ShopUpgrade';
import { ItemStatMods } from '../src/survivors/items/ItemTypes';

describe('shopUpgradeCost', () => {
    it('follows round(300 * 1.6^level), uncapped', () => {
        expect(shopUpgradeCost(0)).toBe(300);
        expect(shopUpgradeCost(1)).toBe(480);
        expect(shopUpgradeCost(2)).toBe(768);
        expect(shopUpgradeCost(3)).toBe(1229);
        expect(shopUpgradeCost(5)).toBe(3146);
        expect(shopUpgradeCost(9)).toBe(20616);
    });
});

describe('scale factors', () => {
    it('bonus scale is +10% of base per level', () => {
        expect(bonusScaleFor(0)).toBeCloseTo(1.0);
        expect(bonusScaleFor(1)).toBeCloseTo(1.1);
        expect(bonusScaleFor(4)).toBeCloseTo(1.4);
        expect(bonusScaleFor(8)).toBeCloseTo(1.8);
    });
    it('item-price scale is +12% per level', () => {
        expect(itemPriceScaleFor(0)).toBeCloseTo(1.0);
        expect(itemPriceScaleFor(3)).toBeCloseTo(1.36);
        expect(itemPriceScaleFor(6)).toBeCloseTo(1.72);
    });
});

describe('scaleMods', () => {
    it('multiplies every present numeric field by the factor, exactly (no rounding)', () => {
        const mods: ItemStatMods = { basicDamagePct: 30, critChance: 0.05, maxHealth: 40 };
        const out = scaleMods(mods, 1.1);
        expect(out.basicDamagePct).toBeCloseTo(33);
        expect(out.critChance).toBeCloseTo(0.055);
        expect(out.maxHealth).toBeCloseTo(44);
    });
    it('leaves absent fields absent and never mutates the input', () => {
        const mods: ItemStatMods = { powerDamagePct: 20 };
        const out = scaleMods(mods, 1.4);
        expect(out.powerDamagePct).toBeCloseTo(28);
        expect(out.basicDamagePct).toBeUndefined();
        expect(mods.powerDamagePct).toBe(20); // input untouched
    });
    it('factor 1.0 is an identity copy', () => {
        const mods: ItemStatMods = { attackSpeedPct: 15, lifesteal: 0.06 };
        expect(scaleMods(mods, 1.0)).toEqual(mods);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ShopUpgrade.spec.ts`
Expected: FAIL — cannot resolve `../src/survivors/shop/ShopUpgrade`.

- [ ] **Step 3: Write minimal implementation**

Create `src/survivors/shop/ShopUpgrade.ts`:

```ts
import { ItemStatMods } from '../items/ItemTypes';

/** Permanent, uncapped shop upgrade level (`+N`). Spending gold raises it; at
 *  `+N` every item on offer is its +N version — stat mods ×(1+0.10·N), price
 *  ×(1+0.12·N). Set bonuses and named effects are NOT scaled (see scaleMods use). */

export const SHOP_UPGRADE_BASE = 300;
export const SHOP_UPGRADE_GROWTH = 1.6;
export const BONUS_SCALE_PER_LEVEL = 0.10;
export const ITEM_PRICE_SCALE_PER_LEVEL = 0.12;

/** Gold to go from `level` → `level+1`. round(300 · 1.6^level). */
export function shopUpgradeCost(level: number): number {
    return Math.round(SHOP_UPGRADE_BASE * Math.pow(SHOP_UPGRADE_GROWTH, level));
}

/** Multiplier applied to an item's own stat mods at the given shop level. */
export function bonusScaleFor(level: number): number {
    return 1 + BONUS_SCALE_PER_LEVEL * level;
}

/** Multiplier applied to an item's wave-scaled price at the given shop level. */
export function itemPriceScaleFor(level: number): number {
    return 1 + ITEM_PRICE_SCALE_PER_LEVEL * level;
}

/** A new ItemStatMods with every present numeric field multiplied by `factor`.
 *  Exact (no rounding) — display rounding lives in describeMods. Input untouched. */
export function scaleMods(mods: ItemStatMods, factor: number): ItemStatMods {
    const out: ItemStatMods = {};
    for (const k of Object.keys(mods) as (keyof ItemStatMods)[]) {
        const v = mods[k];
        if (v !== undefined) out[k] = v * factor;
    }
    return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/ShopUpgrade.spec.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/survivors/shop/ShopUpgrade.ts tests/ShopUpgrade.spec.ts
git commit -m "feat(shop): ShopUpgrade pure module (cost curve + scale math)"
```

---

## Task 2: Equipment captures + scales by shop level

**Files:**
- Modify: `src/survivors/items/Equipment.ts`
- Test: `tests/Equipment.spec.ts`

- [ ] **Step 1: Write the failing tests**

Append these to `tests/Equipment.spec.ts` (inside the file, after the existing `describe('Equipment aggregates', …)` block — they reference the already-imported `Equipment`, `priceFor`, `itemById`, `PlayerStats`):

```ts
describe('shop-level pricing + scaling', () => {
    it('priceFor multiplies the wave price by +12% per shop level', () => {
        // gorefang is rare → base 300. Wave 0, shop 0 → 300.
        expect(priceFor(gorefang(), 0, 0)).toBe(300);
        // Wave 0, shop +3 → ceil(300 × 1.36) = 408.
        expect(priceFor(gorefang(), 0, 3)).toBe(Math.ceil(300 * 1.36));
        // Stacks with wave scaling: wave 5 (×1.3), shop +2 (×1.24).
        expect(priceFor(gorefang(), 5, 2)).toBe(Math.ceil(300 * 1.3 * 1.24));
    });
    it('priceFor defaults shopLevel to 0 (back-compat)', () => {
        expect(priceFor(gorefang(), 5)).toBe(Math.ceil(300 * 1.3));
    });

    it('buy captures the shop level onto the equipped item', () => {
        const eq = new Equipment(new PlayerStats(120, 100000));
        expect(eq.buy(gorefang(), 0, 2)).toBe(true);
        expect(eq.get('weapon')!.level).toBe(2);
    });

    it('aggregates scales an item’s own mods by its captured level', () => {
        const eq = new Equipment(new PlayerStats(120, 100000));
        eq.buy(cleaver(), 0, 4);   // common: +12% basic damage; +4 → ×1.40 → 16.8% → ×1.168
        expect(eq.aggregates().basicDamageMult).toBeCloseTo(1 + 0.12 * 1.40, 5);
    });

    it('keeps each item frozen at its own bought level (no retroactive change)', () => {
        const eq = new Equipment(new PlayerStats(120, 100000));
        eq.buy(cleaver(), 0, 2);   // +12% basic dmg at +2 → ×1.20 → 14.4%
        const before = eq.aggregates().basicDamageMult;
        // A later, higher-level item in a DIFFERENT slot must not change the weapon's bonus.
        eq.buy(itemById('sprintweave_boots')!, 0, 9);
        expect(eq.aggregates().basicDamageMult).toBeCloseTo(before, 5);
        expect(before).toBeCloseTo(1 + 0.12 * 1.20, 5);
    });

    it('does NOT scale set bonuses by item level (only the item’s own mods)', () => {
        const eq = new Equipment(new PlayerStats(120, 100000));
        // 2-pc Berserker's Wrath = +20% attack speed (fixed). gorefang +0% atkspd,
        // skullcage +10% atkspd. Both bought at +5 → item mods scale, set bonus does not.
        eq.buy(gorefang(), 0, 5);     // atkspd mod 0 → still 0
        eq.buy(skullcage(), 0, 5);    // atkspd item mod 10 → ×1.5 → 15%
        const agg = eq.aggregates();
        // item 15% (scaled) × set 20% (UNSCALED) = 1.15 × 1.20
        expect(agg.attackSpeedMult).toBeCloseTo(1.15 * 1.20, 5);
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/Equipment.spec.ts`
Expected: FAIL — `priceFor` takes 2 args (TS/arity), `EquippedItem.level` undefined, aggregates not scaled.

- [ ] **Step 3: Implement the changes**

In `src/survivors/items/Equipment.ts`:

(a) Add the import at the top (after the existing imports on lines 1-3):

```ts
import { bonusScaleFor, itemPriceScaleFor, scaleMods } from '../shop/ShopUpgrade';
```

(b) Add `level` to `EquippedItem` (replace the interface at lines 5-8):

```ts
export interface EquippedItem {
    def: ItemDef;
    pricePaid: number;
    /** Shop upgrade level captured at purchase; freezes this item's bonus tier. */
    level: number;
}
```

(c) Replace `priceFor` (lines 33-35) to take an optional `shopLevel`:

```ts
export function priceFor(def: ItemDef, wave: number, shopLevel = 0): number {
    return Math.ceil(RARITY_BASE_PRICE[def.rarity] * (1 + 0.06 * wave) * itemPriceScaleFor(shopLevel));
}
```

(d) Replace `buy` (lines 65-77) to accept + capture `shopLevel`:

```ts
    public buy(def: ItemDef, wave: number, shopLevel = 0): boolean {
        const price = priceFor(def, wave, shopLevel);
        const old = this.slots.get(def.slot) ?? null;
        const credit = old ? sellValueOf(old.pricePaid) : 0;
        if (this.stats.getGold() + credit < price) return false;
        if (credit > price) {
            this.stats.refundGold(credit - price);
        } else {
            this.stats.spendGold(price - credit);
        }
        this.slots.set(def.slot, { def, pricePaid: price, level: shopLevel });
        return true;
    }
```

(e) In `aggregates` (lines 87-91), scale each item's own mods by its captured level. Replace the per-item loop body — change the `this.foldMods(agg, e.def.mods)` line to:

```ts
        for (const e of this.slots.values()) {
            this.foldMods(agg, scaleMods(e.def.mods, bonusScaleFor(e.level)));
            if (e.def.effectId) agg.effects.add(e.def.effectId);
            if (e.def.setId) agg.setCounts[e.def.setId] = (agg.setCounts[e.def.setId] ?? 0) + 1;
        }
```

(The set-tier loop below it stays unchanged — set bonuses are NOT scaled.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/Equipment.spec.ts`
Expected: PASS — new cases plus all pre-existing cases (they pass `buy(def, 0)` / `priceFor(def, n)`, which default `shopLevel` to 0 and are unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/survivors/items/Equipment.ts tests/Equipment.spec.ts
git commit -m "feat(items): equipped items capture + scale by shop level"
```

---

## Task 3: describeMods renders scaled (fractional) mods cleanly

**Files:**
- Modify: `src/survivors/items/describeMods.ts`
- Test: `tests/ShopUpgrade.spec.ts` (add a describeMods rendering case)

Scaled mods are floats (e.g. `30 × 1.1 = 33`, `12 × 1.4 = 16.8`). The integer-display lines currently interpolate the raw number, which would print `16.8%`. Round those for display. Fractional fields already format via `toFixed`/`Math.round`, so they're fine.

- [ ] **Step 1: Write the failing test**

Append to `tests/ShopUpgrade.spec.ts`:

```ts
import { describeMods } from '../src/survivors/items/describeMods';

describe('describeMods rounds scaled percentage fields for display', () => {
    it('rounds a scaled basicDamagePct to a whole percent', () => {
        const scaled = scaleMods({ basicDamagePct: 12 }, 1.4); // 16.8
        expect(describeMods(scaled)).toContain('+17% basic damage');
    });
    it('rounds scaled maxHealth and knockback', () => {
        const scaled = scaleMods({ maxHealth: 40, knockback: 1 }, 1.1); // 44, 1.1
        expect(describeMods(scaled)).toContain('+44 max HP');
        expect(describeMods(scaled)).toContain('+1 knockback');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ShopUpgrade.spec.ts`
Expected: FAIL — output contains `+16.8% basic damage` / `+1.1 knockback`.

- [ ] **Step 3: Implement the rounding**

Replace the body of `describeMods` in `src/survivors/items/describeMods.ts` (lines 24-40) with the rounded integer-display version (fractional fields unchanged):

```ts
export function describeMods(mods: ItemStatMods): string[] {
    const out: string[] = [];
    if (mods.basicDamagePct) out.push(`+${Math.round(mods.basicDamagePct)}% basic damage`);
    if (mods.powerDamagePct) out.push(`+${Math.round(mods.powerDamagePct)}% power damage`);
    if (mods.attackSpeedPct) out.push(`+${Math.round(mods.attackSpeedPct)}% attack speed`);
    if (mods.moveSpeedPct) out.push(`+${Math.round(mods.moveSpeedPct)}% move speed`);
    if (mods.cooldownPct) out.push(`−${Math.round(mods.cooldownPct)}% power cooldowns`);
    if (mods.damageTakenPct) out.push(`−${Math.round(mods.damageTakenPct)}% damage taken`);
    if (mods.goldGainPct) out.push(`+${Math.round(mods.goldGainPct)}% gold from kills`);
    if (mods.critChance) out.push(`+${Math.round(mods.critChance * 100)}% crit chance`);
    if (mods.critDamage) out.push(`+${mods.critDamage.toFixed(2)} crit damage`);
    if (mods.lifesteal) out.push(`+${Math.round(mods.lifesteal * 100)}% lifesteal`);
    if (mods.maxHealth) out.push(`+${Math.round(mods.maxHealth)} max HP`);
    if (mods.hpRegenPctPerSec) out.push(`Regenerate ${(mods.hpRegenPctPerSec * 100).toFixed(1)}% max HP/s`);
    if (mods.knockback) out.push(`+${Math.round(mods.knockback)} knockback`);
    return out;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/ShopUpgrade.spec.ts`
Expected: PASS. Then `npx vitest run tests/ItemCatalog.spec.ts` to confirm the rounding didn't break any catalog snapshot expectations (catalog values are integers → `Math.round` is a no-op for them).
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/survivors/items/describeMods.ts tests/ShopUpgrade.spec.ts
git commit -m "feat(items): round scaled stat lines for display"
```

---

## Task 4: ShopVM fields + ShopOverlay upgrade UI

**Files:**
- Modify: `src/ui/overlays/ShopOverlay.ts`

No unit test (DOM overlay — verified by `tsc` + build + the Task 6 manual check). Keep edits faithful to the exact shapes below.

- [ ] **Step 1: Extend the view-model interfaces**

In `src/ui/overlays/ShopOverlay.ts`, add `itemLevel` to `ShopCardVM` (after the `def` field, line 10):

```ts
export interface ShopCardVM {
    def: ItemDef;
    /** Shop upgrade level this for-sale copy represents (drives the +N badge). */
    itemLevel: number;
    price: number;
    affordable: boolean;
```

Add the three shop-level fields to `ShopVM` (replace the interface at lines 41-48):

```ts
export interface ShopVM {
    gold: number;
    cards: ShopCardVM[];
    potions: PotionCardVM[];
    rerollCost: number;
    rerollAffordable: boolean;
    /** Current shop upgrade level (0 = base). */
    shopLevel: number;
    /** Gold to raise the shop to shopLevel+1. */
    upgradeCost: number;
    upgradeAffordable: boolean;
    quip: string;
}
```

Add `onUpgrade` to `ShopCallbacks` (after `onReroll()`, line 56):

```ts
    onReroll(): void;
    /** Raise the shop upgrade level by one. */
    onUpgrade(): void;
```

- [ ] **Step 2: Add the upgrade button + level label fields**

Add two private fields alongside `rerollBtn` (after line 75):

```ts
    private rerollBtn: HTMLDivElement | null = null;
    private upgradeBtn: HTMLDivElement | null = null;
    private shopLevelEl: HTMLDivElement | null = null;
```

- [ ] **Step 3: Build the level label in the topbar and the upgrade button in the footer**

In `show()`, replace the topbar line (line 98) so the shop-level label sits beside the gold:

```ts
        this.goldEl = el('div', { class: 'shop-gold' });
        this.shopLevelEl = el('div', { class: 'shop-level' });
        const topbar = el('div', { class: 'shop-topbar' }, [this.goldEl, this.shopLevelEl]);
```

In `show()`, replace the footer block (lines 107-115) so the upgrade button sits between reroll and battle:

```ts
        this.rerollBtn = makeButton({
            label: '', variant: 'ghost', class: 'shop-reroll',
            onClick: () => this.callbacks?.onReroll(),
        });
        this.upgradeBtn = makeButton({
            label: '', variant: 'ghost', class: 'shop-upgrade',
            onClick: () => this.callbacks?.onUpgrade(),
        });
        const battle = makeButton({
            label: '⚔ To battle!', variant: 'forged', class: 'shop-battle',
            onClick: () => { this.callbacks?.onBattle(); },
        });
        modal.body.appendChild(el('div', { class: 'shop-footer' }, [this.rerollBtn, this.upgradeBtn, battle]));
```

- [ ] **Step 4: Render the dynamic upgrade state in `refresh()`**

In `refresh()`, after the existing reroll lines (139-140), add:

```ts
        this.rerollBtn!.textContent = `🎲 Reroll (${vm.rerollCost}g)`;
        this.rerollBtn!.classList.toggle('shop-reroll--poor', !vm.rerollAffordable);

        this.shopLevelEl!.textContent = `Shop +${vm.shopLevel}`;
        this.upgradeBtn!.textContent = `⬆ Upgrade → +${vm.shopLevel + 1} (${vm.upgradeCost}g)`;
        this.upgradeBtn!.classList.toggle('shop-upgrade--poor', !vm.upgradeAffordable);
```

- [ ] **Step 5: Render the `+N` badge on each card**

In `buildCard()`, after the name/emblem `root.append(...)` block (line 159), add the badge:

```ts
        if (card.itemLevel > 0) {
            root.appendChild(el('div', { class: 'shop-card__plus', text: `+${card.itemLevel}` }));
        }
```

- [ ] **Step 6: Null the new fields in `closeSilently()`**

In `closeSilently()` (after line 225, `this.rerollBtn = null;`), add:

```ts
        this.rerollBtn = null;
        this.upgradeBtn = null;
        this.shopLevelEl = null;
```

- [ ] **Step 7: Type-check**

Run: `npx tsc --noEmit`
Expected: errors ONLY in `SurvivorsGameplayState.ts` (it doesn't yet supply `itemLevel`/`shopLevel`/`upgradeCost`/`upgradeAffordable`/`onUpgrade`). That's expected — Task 5 fixes them. No errors inside `ShopOverlay.ts` itself.

- [ ] **Step 8: Commit**

```bash
git add src/ui/overlays/ShopOverlay.ts
git commit -m "feat(shop): upgrade button, Shop +N label, +N card badge in overlay"
```

---

## Task 5: Wire shop level into the gameplay state

**Files:**
- Modify: `src/survivors/SurvivorsGameplayState.ts`

No unit test (orchestration layer — verified by `tsc` + build + Task 6 manual check).

- [ ] **Step 1: Import the upgrade helpers**

Near the existing shop imports (around line 53, `import { rollStock, rerollCost } from './shop/ShopStock';`), add:

```ts
import { shopUpgradeCost, bonusScaleFor, scaleMods } from './shop/ShopUpgrade';
```

- [ ] **Step 2: Add the run-state field**

After `private rerollsThisVisit = 0;` (line 553), add:

```ts
    /** Permanent, uncapped shop upgrade level (`+N`). Reset to 0 in exit(). */
    private shopLevel = 0;
```

- [ ] **Step 3: Reset it on exit**

In `exit()`, after `this.rerollsThisVisit = 0;` (line 2773), add:

```ts
        this.rerollsThisVisit = 0;
        this.shopLevel = 0;
```

- [ ] **Step 4: Wire the `onUpgrade` callback in `openShop()`**

In `openShop()`, in the callbacks object (after `onReroll: () => this.handleShopReroll(),`, line 4027), add:

```ts
            onReroll: () => this.handleShopReroll(),
            onUpgrade: () => this.handleShopUpgrade(),
```

- [ ] **Step 5: Add `handleShopUpgrade()`**

Right after `handleShopReroll()` (which ends at line 4222), add:

```ts
    /** Raise the permanent shop upgrade level by one (uncapped). Does NOT touch
     *  equipped gear — items only get stronger when re-bought from the upgraded
     *  shop. Just re-renders the stock at the new prices + scaled stat previews. */
    private handleShopUpgrade(): void {
        if (!this.playerStats) return;
        const cost = shopUpgradeCost(this.shopLevel);
        if (!this.playerStats.spendGold(cost)) {
            this.shopOverlay?.refresh(this.buildShopVM(pickBark('poor')));
            return;
        }
        this.shopLevel++;
        this.shopOverlay?.refresh(this.buildShopVM(pickBark('buy')));
    }
```

- [ ] **Step 6: Pass `shopLevel` into `buy()` in `handleShopBuy()`**

In `handleShopBuy()` (line 4111), change the buy call:

```ts
        if (!this.equipment.buy(def, wave, this.shopLevel)) {
```

- [ ] **Step 7: Build the upgraded VM in `buildShopVM()`**

In `buildShopVM()` (lines 4068-4103), (a) scale the for-sale price + stat lines by the shop level, scale the equipped comparison by the equipped item's own level, and set `itemLevel`; (b) add the three new VM fields.

Replace the `const cards = …` block (lines 4068-4087) with:

```ts
        const cards: ShopCardVM[] = this.currentStock.map(def => {
            const price = priceFor(def, wave, this.shopLevel);
            const old = eq.get(def.slot);
            const credit = old ? sellValueOf(old.pricePaid) : 0;
            return {
                def,
                itemLevel: this.shopLevel,
                price,
                sold: this.purchasedIds.has(def.id),
                affordable: ps.getGold() + credit >= price,
                replaces: old?.def.name ?? null,
                sellCredit: credit,
                setProgress: def.setId
                    ? `${setById(def.setId)!.name} ${eq.setCount(def.setId)}/${setById(def.setId)!.pieces.length}`
                    : null,
                // For-sale copy shows the +N (current shop level) stat preview.
                statLines: describeMods(scaleMods(def.mods, bonusScaleFor(this.shopLevel))),
                effectText: this.itemEffectText(def),
                // Comparison: the equipped piece scaled by ITS OWN captured level.
                equippedStatLines: old ? describeMods(scaleMods(old.def.mods, bonusScaleFor(old.level))) : [],
                equippedEffectText: old ? this.itemEffectText(old.def) : null,
            };
        });
```

Then in the returned object (lines 4088-4103), add the three fields next to `rerollCost`:

```ts
            rerollCost: rerollCost(this.rerollsThisVisit),
            rerollAffordable: ps.getGold() >= rerollCost(this.rerollsThisVisit),
            shopLevel: this.shopLevel,
            upgradeCost: shopUpgradeCost(this.shopLevel),
            upgradeAffordable: ps.getGold() >= shopUpgradeCost(this.shopLevel),
```

- [ ] **Step 8: Scale the equipped stat lines in the HUD/character sheet**

In `buildGearSlots()` (line 4148), so the always-visible inventory + character sheet show the true equipped bonus for each item's captured level, change:

```ts
                statLines: item ? describeMods(scaleMods(item.def.mods, bonusScaleFor(item.level))) : [],
```

- [ ] **Step 9: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS (0 errors) — the ShopOverlay VM contract from Task 4 is now fully satisfied.

- [ ] **Step 10: Commit**

```bash
git add src/survivors/SurvivorsGameplayState.ts
git commit -m "feat(shop): wire permanent shop upgrade level into gameplay state"
```

---

## Task 6: Style the upgrade UI + full verification

**Files:**
- Modify: `src/ui/styles/components.css`

- [ ] **Step 1: Add the CSS**

Append after the `.shop-reroll--poor` rule (line 541) in `src/ui/styles/components.css`:

```css
.shop-upgrade--poor { opacity: 0.5; pointer-events: none; }

/* Current shop upgrade level, shown beside the gold bar. */
.shop-level {
  font-family: var(--ff-display); font-weight: 700; font-size: var(--fs-200);
  color: #7ad7ff; letter-spacing: 0.06em;
}

/* +N tier badge on a for-sale card (top-left corner). */
.shop-card__plus {
  position: absolute; top: var(--s-2); left: var(--s-2);
  font-family: var(--ff-display); font-weight: 700; font-size: var(--fs-200);
  color: #7ad7ff; text-shadow: 0 1px 2px rgba(0,0,0,0.6);
}
```

- [ ] **Step 2: Type-check, test, and build**

Run: `npx tsc --noEmit`
Expected: PASS (0 errors).

Run: `npm test`
Expected: PASS — all suites green, including the new `ShopUpgrade` cases and the extended `Equipment` cases.

Run: `npm run build`
Expected: webpack build succeeds, no errors.

- [ ] **Step 3: Manual smoke check (optional but recommended)**

Run: `npm start`, play to the first shop. Verify:
- Footer shows `⬆ Upgrade → +1 (300g)` beside Reroll; topbar shows `Shop +0`.
- Clicking it deducts 300g, topbar reads `Shop +1`, cards show a `+1` badge, stat previews tick up (~+10%), and prices rise (~+12%).
- The next upgrade costs `480g`, then `768g` (escalating).
- Buying an item, then upgrading again and re-buying it, installs the stronger version; an item NOT re-bought keeps its old numbers (check the character sheet).

- [ ] **Step 4: Commit**

```bash
git add src/ui/styles/components.css
git commit -m "feat(shop): style upgrade button, shop-level label and +N badge"
```

---

## Self-Review notes (verified against the spec)

- **Spec coverage:** cost curve (Task 1) · bonus scale + scaleMods (Task 1) · item-price scale (Tasks 1-2) · EquippedItem.level capture + level-frozen scaling (Task 2) · set bonuses/effects NOT scaled (Task 2 test) · run-state field + reset (Task 5) · handleShopUpgrade + wiring (Task 5) · upgrade button + `+N` badge + `Shop +N` label (Tasks 4, 6) · scaled stat previews incl. equipped comparison + character sheet (Tasks 3, 5) · TDD pure-logic tests (Tasks 1-3). Co-op: no code — `shopLevel` is per-player run state folding through the existing per-player equipment path (spec "Co-op" section).
- **Type consistency:** `shopUpgradeCost`/`bonusScaleFor`/`itemPriceScaleFor`/`scaleMods` names match across all tasks; `EquippedItem.level`, `ShopCardVM.itemLevel`, and `ShopVM.{shopLevel,upgradeCost,upgradeAffordable}` used identically in producer (Task 5) and consumer (Task 4).
- **Back-compat:** `priceFor`/`buy` add a defaulted `shopLevel = 0`, so all pre-existing `Equipment.spec.ts` calls keep passing unchanged.
```
