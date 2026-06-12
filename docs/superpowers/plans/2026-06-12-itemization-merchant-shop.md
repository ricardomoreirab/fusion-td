# Itemization & Traveling Merchant Shop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** MMO-style equipment (6 slots, 30-item class-gated catalog, 4 three-piece sets), visible gold economy, and a between-wave shop run by a goblin merchant (Gribble) who arrives after every wave clear.

**Architecture:** Pure-logic modules (`ItemCatalog`, `Equipment`, `ShopStock`, `ItemEffectRuntime`) are Vitest-covered and Babylon-free. Equipment never mutates `PlayerStats` directly — it exposes aggregates that `SurvivorsGameplayState.applyLevelBonuses()` folds in at its single idempotent recompute point (level-ups *assign* multiplier fields, so diff-apply would be clobbered). World/UI layers (`MerchantStand`, `ShopOverlay`, HUD gold pill) follow the existing PropField/PowerChoice/Pill patterns.

**Spec:** `docs/superpowers/specs/2026-06-12-itemization-merchant-shop-design.md`

**Tech Stack:** TypeScript, BabylonJS, DOM UI (src/ui), Vitest.

**Commands:** type-check `npx tsc --noEmit` · tests `npx vitest run <file>` · build `npm run build`

**Two deviations from the spec (discovered during planning, both noted inline):**
1. Stat application is *aggregate + fold at recompute*, not diff-apply — `applyLevelBonuses()` assigns `powerDamageMultiplier` etc. every level-up and would wipe diff-applied values.
2. The barbarian melee swing already hits ALL enemies in range (full 360°), so the RAGE 3pc "full-circle cleave" is already base behavior. RAGE is therefore: **below 50% HP → +60% basic-attack damage + red glow**.
3. The map is the infinite rolling globe — there is no fixed "arena center". The merchant spawns **8 units from the hero** instead.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/survivors/items/ItemTypes.ts` | Create | Slots, rarity, stat-mod, ItemDef/SetDef types |
| `src/survivors/items/ItemCatalog.ts` | Create | 30 items + 4 sets (pure data) |
| `src/survivors/items/Equipment.ts` | Create | Inventory, buy/sell math, aggregates, set detection |
| `src/survivors/items/foldEquipmentStats.ts` | Create | Folds aggregates into PlayerStats at the recompute point |
| `src/survivors/items/ItemEffectRuntime.ts` | Create | Unique-effect handlers (rage/echo/midas/…) |
| `src/survivors/items/ItemFx.ts` | Create | Leak-safe transient FX helpers (rings, glow, trail) |
| `src/survivors/shop/ShopStock.ts` | Create | Stock rolling, rarity weights, pity, reroll cost |
| `src/survivors/shop/GribbleBarks.ts` | Create | Bark/quip lines (pure data) |
| `src/survivors/shop/MerchantStand.ts` | Create | GLB cart+goblin world entity, proximity, bubble |
| `src/ui/overlays/ShopOverlay.ts` | Create | DOM shop UI |
| `src/ui/primitives/Pill.ts` | Modify | Add `'gold'` pill kind |
| `src/ui/hud/Hud.ts` | Modify | Gold pill, `setGold()`, horn button |
| `src/ui/styles/components.css` | Modify | Shop + gold-pill + horn styles |
| `src/survivors/PlayerStats.ts` | Modify | `basicDamageMultiplier`, `goldGainMultiplier`, `hpRegenPctPerSec`, `refundGold()` |
| `src/survivors/enemies/EnemyManager.ts:711` | Modify | Apply `goldGainMultiplier` to kill rewards |
| `src/survivors/champions/HeroBasicAttack.ts` | Modify | `setOnHit` hook; `sourceEnemy` on projectile targets |
| `src/survivors/HeroController.ts` | Modify | `setOnHurt` hook |
| `src/survivors/powers/PowerSlotManager.ts` | Modify | `recastFree()` (Echo) |
| `src/survivors/SurvivorsGameplayState.ts` | Modify | Shop phase, wave gating, pause, wiring, exit cleanup |
| `tests/ItemCatalog.spec.ts` etc. | Create | See per-task tests |

---

### Task 1: Item types + catalog

**Files:**
- Create: `src/survivors/items/ItemTypes.ts`
- Create: `src/survivors/items/ItemCatalog.ts`
- Test: `tests/ItemCatalog.spec.ts`

- [ ] **Step 1.1: Write the failing catalog-integrity test**

```typescript
// tests/ItemCatalog.spec.ts
import { describe, expect, it } from 'vitest';
import { ITEM_CATALOG, ITEM_SETS, itemById, setById } from '../src/survivors/items/ItemCatalog';
import { EQUIP_SLOTS, RARITY_BASE_PRICE } from '../src/survivors/items/ItemTypes';

describe('ItemCatalog integrity', () => {
    it('has 30 items with unique ids', () => {
        expect(ITEM_CATALOG.length).toBe(30);
        const ids = new Set(ITEM_CATALOG.map(i => i.id));
        expect(ids.size).toBe(ITEM_CATALOG.length);
    });

    it('every item has a valid slot, rarity, glyph and flavor', () => {
        for (const item of ITEM_CATALOG) {
            expect(EQUIP_SLOTS).toContain(item.slot);
            expect(RARITY_BASE_PRICE[item.rarity]).toBeGreaterThan(0);
            expect(item.glyph.length).toBeGreaterThan(0);
            expect(item.flavor.length).toBeGreaterThan(0);
        }
    });

    it('every weapon is class-gated (never "all")', () => {
        for (const item of ITEM_CATALOG.filter(i => i.slot === 'weapon')) {
            expect(item.classes).not.toBe('all');
        }
    });

    it('has 4 sets of exactly 3 existing pieces with distinct slots and back-references', () => {
        expect(ITEM_SETS.length).toBe(4);
        for (const set of ITEM_SETS) {
            expect(set.pieces.length).toBe(3);
            const slots = new Set<string>();
            for (const pieceId of set.pieces) {
                const piece = itemById(pieceId);
                expect(piece, `set ${set.id} piece ${pieceId} must exist`).toBeDefined();
                expect(piece!.setId).toBe(set.id);
                slots.add(piece!.slot);
            }
            expect(slots.size).toBe(3);
        }
    });

    it('every item setId points to an existing set that lists the item', () => {
        for (const item of ITEM_CATALOG) {
            if (!item.setId) continue;
            const set = setById(item.setId);
            expect(set).toBeDefined();
            expect(set!.pieces).toContain(item.id);
        }
    });

    it('class-specific sets only contain pieces usable by that class', () => {
        for (const set of ITEM_SETS) {
            const classLists = set.pieces.map(p => itemById(p)!.classes);
            // either all pieces are 'all', or all share one champion class
            const specific = classLists.filter(c => c !== 'all');
            if (specific.length > 0) {
                const first = (specific[0] as string[])[0];
                for (const c of specific) expect(c).toContain(first);
            }
        }
    });
});
```

- [ ] **Step 1.2: Run it to verify it fails**

Run: `npx vitest run tests/ItemCatalog.spec.ts`
Expected: FAIL — cannot resolve `../src/survivors/items/ItemCatalog`.

- [ ] **Step 1.3: Create `src/survivors/items/ItemTypes.ts`**

```typescript
import { ChampionType } from '../powers/PowerDefinitions';

export type EquipSlot = 'weapon' | 'helmet' | 'chest' | 'legs' | 'boots' | 'trinket';
export const EQUIP_SLOTS: EquipSlot[] = ['weapon', 'helmet', 'chest', 'legs', 'boots', 'trinket'];

export type Rarity = 'common' | 'rare' | 'epic' | 'legendary';
export const RARITY_BASE_PRICE: Record<Rarity, number> = {
    common: 60, rare: 120, epic: 220, legendary: 400,
};
export const RARITY_COLOR: Record<Rarity, string> = {
    common: '#9aa0a8', rare: '#3da9ff', epic: '#b050ff', legendary: '#ffb52e',
};

/** Declarative stat bonuses. Pct values are whole percentages (+20 ⇒ +20%). */
export interface ItemStatMods {
    /** Basic-attack damage only. */
    basicDamagePct?: number;
    powerDamagePct?: number;
    attackSpeedPct?: number;
    moveSpeedPct?: number;
    /** Cooldown REDUCTION: +10 ⇒ cooldowns ×0.90. */
    cooldownPct?: number;
    /** Damage-taken REDUCTION: +12 ⇒ incoming ×0.88. */
    damageTakenPct?: number;
    goldGainPct?: number;
    critChance?: number;        // additive, 0..1
    critDamage?: number;        // additive to the crit multiplier (+0.35 ⇒ 1.5→1.85)
    lifesteal?: number;         // additive, 0..1
    maxHealth?: number;         // flat HP
    hpRegenPctPerSec?: number;  // fraction of max HP per second (0.005 = 0.5%/s)
    knockback?: number;         // flat world units per basic hit
}

export type ItemEffectId =
    | 'rage' | 'ricochet' | 'echo' | 'midas'
    | 'shockwave' | 'critExplode' | 'burnOnHit' | 'thorns' | 'chrono';

export interface ItemDef {
    id: string;
    name: string;
    slot: EquipSlot;
    rarity: Rarity;
    /** 'all' or the champion classes that may buy/equip it. */
    classes: ChampionType[] | 'all';
    mods: ItemStatMods;
    effectId?: ItemEffectId;
    setId?: string;
    glyph: string;
    /** One short funny/flavor line for the shop card. */
    flavor: string;
}

export interface SetDef {
    id: string;
    name: string;
    pieces: [string, string, string];
    bonus2: ItemStatMods;
    bonus2Text: string;
    effect3: ItemEffectId;
    bonus3Text: string;
}
```

- [ ] **Step 1.4: Create `src/survivors/items/ItemCatalog.ts`** (full data — 12 set pieces, 6 standalone weapons, 12 standalone armor/trinkets)

```typescript
import { ItemDef, SetDef } from './ItemTypes';

export const ITEM_SETS: SetDef[] = [
    {
        id: 'berserkers_wrath', name: "Berserker's Wrath",
        pieces: ['gorefang', 'skullcage_of_rage', 'bloodforged_plate'],
        bonus2: { attackSpeedPct: 20 }, bonus2Text: '+20% attack speed',
        effect3: 'rage',
        bonus3Text: 'RAGE: below 50% HP, +60% basic damage and a furious red glow',
    },
    {
        id: 'windrunner', name: 'Windrunner',
        pieces: ['stormpiercer', 'galeskimmers', 'feather_of_the_zephyr'],
        bonus2: { moveSpeedPct: 15 }, bonus2Text: '+15% move speed',
        effect3: 'ricochet',
        bonus3Text: 'RICOCHET: arrows bounce to a nearby enemy at 60% damage',
    },
    {
        id: 'archmages_echo', name: "Archmage's Echo",
        pieces: ['staff_of_echoes', 'mindcrown', 'runeweave_leggings'],
        bonus2: { cooldownPct: 10 }, bonus2Text: '−10% power cooldowns',
        effect3: 'echo',
        bonus3Text: 'ECHO: power casts have a 25% chance to instantly recast free',
    },
    {
        id: 'goblin_fortune', name: 'Goblin Fortune',
        pieces: ['gribbles_lucky_coin', 'penny_pincher_loafers', 'greedhelm'],
        bonus2: { goldGainPct: 25 }, bonus2Text: '+25% gold from kills',
        effect3: 'midas',
        bonus3Text: 'MIDAS: 15% chance kills pay double; every 150g earned bursts a coin nova',
    },
];

export const ITEM_CATALOG: ItemDef[] = [
    // ── Berserker's Wrath (barbarian) ────────────────────────────────────────
    { id: 'gorefang', name: 'Gorefang', slot: 'weapon', rarity: 'rare',
      classes: ['barbarian'], setId: 'berserkers_wrath', glyph: '🪓',
      mods: { basicDamagePct: 20 },
      flavor: 'Still hungry. Always hungry.' },
    { id: 'skullcage_of_rage', name: 'Skullcage of Rage', slot: 'helmet', rarity: 'rare',
      classes: ['barbarian'], setId: 'berserkers_wrath', glyph: '💀',
      mods: { attackSpeedPct: 10, maxHealth: 10 },
      flavor: 'The previous owner is still angry about it.' },
    { id: 'bloodforged_plate', name: 'Bloodforged Plate', slot: 'chest', rarity: 'epic',
      classes: ['barbarian'], setId: 'berserkers_wrath', glyph: '🛡',
      mods: { damageTakenPct: 12, maxHealth: 30 },
      flavor: 'Forged in blood. Washed never.' },

    // ── Windrunner (ranger) ──────────────────────────────────────────────────
    { id: 'stormpiercer', name: 'Stormpiercer', slot: 'weapon', rarity: 'rare',
      classes: ['ranger'], setId: 'windrunner', glyph: '🏹',
      mods: { basicDamagePct: 15, attackSpeedPct: 10 },
      flavor: 'The wind files a complaint every time you draw it.' },
    { id: 'galeskimmers', name: 'Galeskimmers', slot: 'boots', rarity: 'rare',
      classes: ['ranger'], setId: 'windrunner', glyph: '👢',
      mods: { moveSpeedPct: 12 },
      flavor: 'Technically the boots are jogging. You just live in them.' },
    { id: 'feather_of_the_zephyr', name: 'Feather of the Zephyr', slot: 'trinket', rarity: 'epic',
      classes: ['ranger'], setId: 'windrunner', glyph: '🪶',
      mods: { moveSpeedPct: 8, critChance: 0.08 },
      flavor: 'Plucked from a very fast, very annoyed bird.' },

    // ── Archmage's Echo (mage) ───────────────────────────────────────────────
    { id: 'staff_of_echoes', name: 'Staff of Echoes', slot: 'weapon', rarity: 'rare',
      classes: ['mage'], setId: 'archmages_echo', glyph: '🪄',
      mods: { powerDamagePct: 20 },
      flavor: 'Echoes… echoes… echoes…' },
    { id: 'mindcrown', name: 'Mindcrown', slot: 'helmet', rarity: 'rare',
      classes: ['mage'], setId: 'archmages_echo', glyph: '👑',
      mods: { cooldownPct: 8 },
      flavor: 'Thinks two thoughts at once. Both are about fireballs.' },
    { id: 'runeweave_leggings', name: 'Runeweave Leggings', slot: 'legs', rarity: 'epic',
      classes: ['mage'], setId: 'archmages_echo', glyph: '✨',
      mods: { powerDamagePct: 15, moveSpeedPct: 6 },
      flavor: 'Every rune is a typo that turned out fine.' },

    // ── Goblin Fortune (all classes) ─────────────────────────────────────────
    { id: 'gribbles_lucky_coin', name: "Gribble's Lucky Coin", slot: 'trinket', rarity: 'rare',
      classes: 'all', setId: 'goblin_fortune', glyph: '🪙',
      mods: { goldGainPct: 10, critChance: 0.05 },
      flavor: '"Found it in YOUR pocket, actually." — Gribble' },
    { id: 'penny_pincher_loafers', name: 'Penny-Pincher Loafers', slot: 'boots', rarity: 'common',
      classes: 'all', setId: 'goblin_fortune', glyph: '🥿',
      mods: { moveSpeedPct: 8, goldGainPct: 5 },
      flavor: 'Squeak with joy near unattended coin.' },
    { id: 'greedhelm', name: 'Greedhelm', slot: 'helmet', rarity: 'rare',
      classes: 'all', setId: 'goblin_fortune', glyph: '⛑',
      mods: { goldGainPct: 10, maxHealth: 10 },
      flavor: 'The visor doubles as a coin slot.' },

    // ── Standalone weapons ───────────────────────────────────────────────────
    { id: 'butchers_cleaver', name: "Butcher's Cleaver", slot: 'weapon', rarity: 'common',
      classes: ['barbarian'], glyph: '🔪',
      mods: { basicDamagePct: 12 },
      flavor: 'Health code violation in 12 kingdoms.' },
    { id: 'worldsplitter', name: 'Worldsplitter', slot: 'weapon', rarity: 'legendary',
      classes: ['barbarian'], glyph: '⚒',
      mods: { basicDamagePct: 30 }, effectId: 'shockwave',
      flavor: 'The ground has learned to flinch.' },
    { id: 'oakshot_bow', name: 'Oakshot Bow', slot: 'weapon', rarity: 'common',
      classes: ['ranger'], glyph: '🏹',
      mods: { basicDamagePct: 12 },
      flavor: 'Made from a tree that owed someone money.' },
    { id: 'comet_driver', name: 'Comet Driver', slot: 'weapon', rarity: 'legendary',
      classes: ['ranger'], glyph: '☄',
      mods: { critChance: 0.15 }, effectId: 'critExplode',
      flavor: 'Aim at the goblin. Hit the postcode.' },
    { id: 'apprentice_focus', name: 'Apprentice Focus', slot: 'weapon', rarity: 'common',
      classes: ['mage'], glyph: '🔮',
      mods: { powerDamagePct: 12 },
      flavor: 'Slightly singed. Mostly enthusiastic.' },
    { id: 'emberwand', name: 'Emberwand', slot: 'weapon', rarity: 'epic',
      classes: ['mage'], glyph: '🔥',
      mods: { powerDamagePct: 15 }, effectId: 'burnOnHit',
      flavor: 'Warranty void if pointed at anything flammable. So: void.' },

    // ── Standalone armor & trinkets (all classes) ────────────────────────────
    { id: 'ironbrow_visor', name: 'Ironbrow Visor', slot: 'helmet', rarity: 'common',
      classes: 'all', glyph: '🪖',
      mods: { damageTakenPct: 8 },
      flavor: 'Blocks blows AND unsolicited advice.' },
    { id: 'crown_of_focus', name: 'Crown of Focus', slot: 'helmet', rarity: 'epic',
      classes: 'all', glyph: '👑',
      mods: { powerDamagePct: 15, critChance: 0.08 },
      flavor: 'Concentrate. Conquer. Repeat.' },
    { id: 'padded_jerkin', name: 'Padded Jerkin', slot: 'chest', rarity: 'common',
      classes: 'all', glyph: '🦺',
      mods: { maxHealth: 25 },
      flavor: 'The padding is 90% optimism.' },
    { id: 'troll_hide_vest', name: 'Troll-Hide Vest', slot: 'chest', rarity: 'rare',
      classes: 'all', glyph: '🧥',
      mods: { maxHealth: 20, hpRegenPctPerSec: 0.005 },
      flavor: 'The troll wants it back. Walk faster.' },
    { id: 'thornmail_hauberk', name: 'Thornmail Hauberk', slot: 'chest', rarity: 'epic',
      classes: 'all', glyph: '🌵',
      mods: { damageTakenPct: 10 }, effectId: 'thorns',
      flavor: 'Hugs are now a tactical decision.' },
    { id: 'marchers_greaves', name: "Marchers' Greaves", slot: 'legs', rarity: 'common',
      classes: 'all', glyph: '🦵',
      mods: { moveSpeedPct: 8 },
      flavor: 'Left. Left. Left-right-left.' },
    { id: 'juggernaut_legplates', name: 'Juggernaut Legplates', slot: 'legs', rarity: 'epic',
      classes: 'all', glyph: '🦿',
      mods: { damageTakenPct: 15, knockback: 1 },
      flavor: 'You don\'t dodge. You happen to people.' },
    { id: 'sprintweave_boots', name: 'Sprintweave Boots', slot: 'boots', rarity: 'common',
      classes: 'all', glyph: '👟',
      mods: { moveSpeedPct: 10 },
      flavor: 'Woven from pure "gotta go".' },
    { id: 'comet_treads', name: 'Comet Treads', slot: 'boots', rarity: 'epic',
      classes: 'all', glyph: '💫',
      mods: { moveSpeedPct: 12, attackSpeedPct: 10 },
      flavor: 'Leave little sparkles. Insurance doesn\'t cover them.' },
    { id: 'bloodvial', name: 'Bloodvial', slot: 'trinket', rarity: 'rare',
      classes: 'all', glyph: '🧪',
      mods: { lifesteal: 0.06 },
      flavor: 'Do not shake. Do not ask whose.' },
    { id: 'chrono_charm', name: 'Chrono Charm', slot: 'trinket', rarity: 'epic',
      classes: 'all', glyph: '⏳',
      mods: {}, effectId: 'chrono',
      flavor: 'Ticks backwards when you\'re in trouble. So: constantly.' },
    { id: 'executioners_sigil', name: "Executioner's Sigil", slot: 'trinket', rarity: 'legendary',
      classes: 'all', glyph: '⚔',
      mods: { critChance: 0.15, critDamage: 0.35 },
      flavor: 'Pre-signed. Just add a name.' },
];

const _byId = new Map(ITEM_CATALOG.map(i => [i.id, i]));
const _setById = new Map(ITEM_SETS.map(s => [s.id, s]));

export function itemById(id: string): ItemDef | undefined { return _byId.get(id); }
export function setById(id: string): SetDef | undefined { return _setById.get(id); }
```

- [ ] **Step 1.5: Run the test — verify it passes**

Run: `npx vitest run tests/ItemCatalog.spec.ts`
Expected: PASS (6 tests).

- [ ] **Step 1.6: Type-check and commit**

Run: `npx tsc --noEmit` — expect no errors.

```bash
git add src/survivors/items/ItemTypes.ts src/survivors/items/ItemCatalog.ts tests/ItemCatalog.spec.ts
git commit -m "feat(items): equipment types + 30-item class-gated catalog with 4 sets"
```

---

### Task 2: PlayerStats fields + gold-gain at the kill site

**Files:**
- Modify: `src/survivors/PlayerStats.ts` (fields after line 76; method near `addMoney`)
- Modify: `src/survivors/enemies/EnemyManager.ts:711`
- Test: `tests/PlayerStats.spec.ts` (append a describe block)

- [ ] **Step 2.1: Write the failing tests** — append to `tests/PlayerStats.spec.ts`:

```typescript
describe('equipment economy additions', () => {
    it('refundGold adds money without feeding the XP sink or earned total', () => {
        const stats = new PlayerStats(120, 100);
        const sink = vi.fn();
        stats.setXpSink(sink);
        const earnedBefore = stats.getTotalMoneyEarned();
        stats.refundGold(40);
        expect(stats.getGold()).toBe(140);
        expect(sink).not.toHaveBeenCalled();
        expect(stats.getTotalMoneyEarned()).toBe(earnedBefore);
    });

    it('spending gold never feeds the XP sink', () => {
        const stats = new PlayerStats(120, 100);
        const sink = vi.fn();
        stats.setXpSink(sink);
        expect(stats.spendGold(60)).toBe(true);
        expect(sink).not.toHaveBeenCalled();
    });

    it('new equipment stat fields default to neutral', () => {
        const stats = new PlayerStats();
        expect(stats.basicDamageMultiplier).toBe(1.0);
        expect(stats.goldGainMultiplier).toBe(1.0);
        expect(stats.hpRegenPctPerSec).toBe(0);
    });
});
```

(Check the file's imports include `vi` from vitest; add it if missing.)

- [ ] **Step 2.2: Run to verify failure**

Run: `npx vitest run tests/PlayerStats.spec.ts`
Expected: FAIL — `refundGold` / new fields don't exist.

- [ ] **Step 2.3: Implement in `PlayerStats.ts`** — after the `purchaseCounts` field (line 78), add:

```typescript
    // ── Equipment (shop itemization) stat fields ────────────────────────────
    /** Multiplier applied to basic-attack damage only (equipment weapons). */
    public basicDamageMultiplier: number = 1.0;
    /** Multiplier applied to gold earned from kills (equipment gold-find). */
    public goldGainMultiplier: number = 1.0;
    /** Fraction of max HP regenerated per second (equipment regen). */
    public hpRegenPctPerSec: number = 0;
```

After `addMoney` (line ~157), add:

```typescript
    /** Add gold WITHOUT feeding the XP sink or the earned-total tracker.
     *  Used for shop sell-back credits — refunds are not income. */
    public refundGold(amount: number): void {
        if (!this.unlimitedMoney) {
            this.money += amount;
        }
    }
```

- [ ] **Step 2.4: Apply goldGainMultiplier at the kill-reward site** — `src/survivors/enemies/EnemyManager.ts:711`, change:

```typescript
                    this.playerStats.addMoney(enemy.getReward());
```
to:
```typescript
                    this.playerStats.addMoney(Math.round(enemy.getReward() * this.playerStats.goldGainMultiplier));
```

- [ ] **Step 2.5: Run tests + type-check**

Run: `npx vitest run tests/PlayerStats.spec.ts && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 2.6: Commit**

```bash
git add src/survivors/PlayerStats.ts src/survivors/enemies/EnemyManager.ts tests/PlayerStats.spec.ts
git commit -m "feat(items): PlayerStats equipment fields + refundGold; gold-gain multiplier on kill rewards"
```

### Task 3: Equipment (pure inventory + aggregates) and stat fold

**Files:**
- Create: `src/survivors/items/Equipment.ts`
- Create: `src/survivors/items/foldEquipmentStats.ts`
- Test: `tests/Equipment.spec.ts`

**Why fold-at-recompute instead of diff-apply:** `SurvivorsGameplayState.applyLevelBonuses()` (line ~3527) ASSIGNS `moveSpeedMultiplier`, `basicAttackSpeedMultiplier`, `powerDamageMultiplier`, `powerCooldownMultiplier`, `damageReductionMultiplier`, `critChance`, `critDamageMultiplier` on every level-up. Anything diff-applied to those fields is wiped. So Equipment owns *aggregates*, and `foldEquipmentStats` multiplies/adds them in immediately after those assignments. `lifestealPct`/`knockbackOnHit` are never assigned (RunItems `+=`s them), so for those two the fold uses exact delta-tracking.

- [ ] **Step 3.1: Write the failing tests**

```typescript
// tests/Equipment.spec.ts
import { describe, expect, it, vi } from 'vitest';
import { Equipment, priceFor, sellValueOf } from '../src/survivors/items/Equipment';
import { foldEquipmentStats, newEquipFoldTracker } from '../src/survivors/items/foldEquipmentStats';
import { itemById } from '../src/survivors/items/ItemCatalog';
import { PlayerStats } from '../src/survivors/PlayerStats';

const gorefang = () => itemById('gorefang')!;
const skullcage = () => itemById('skullcage_of_rage')!;
const bloodplate = () => itemById('bloodforged_plate')!;
const cleaver = () => itemById('butchers_cleaver')!;
const bloodvial = () => itemById('bloodvial')!;

describe('pricing', () => {
    it('scales base price with wave', () => {
        expect(priceFor(gorefang(), 0)).toBe(120);
        expect(priceFor(gorefang(), 5)).toBe(Math.ceil(120 * 1.3)); // 156
    });
    it('sell value is 60% of price paid, floored', () => {
        expect(sellValueOf(156)).toBe(93);
    });
});

describe('Equipment buy/replace', () => {
    it('buys into an empty slot, spending the wave-scaled price', () => {
        const stats = new PlayerStats(120, 300);
        const eq = new Equipment(stats);
        expect(eq.buy(gorefang(), 0)).toBe(true);
        expect(stats.getGold()).toBe(180);
        expect(eq.get('weapon')!.def.id).toBe('gorefang');
    });

    it('refuses when gold (plus replacement credit) is insufficient', () => {
        const stats = new PlayerStats(120, 50);
        const eq = new Equipment(stats);
        expect(eq.buy(gorefang(), 0)).toBe(false);
        expect(stats.getGold()).toBe(50);
        expect(eq.get('weapon')).toBeNull();
    });

    it('replacing credits 60% of the old price paid, without feeding XP', () => {
        const stats = new PlayerStats(120, 300);
        const sink = vi.fn();
        stats.setXpSink(sink);
        const eq = new Equipment(stats);
        eq.buy(gorefang(), 0);                       // -120 → 180
        expect(eq.buy(cleaver(), 0)).toBe(true);     // -60 +72 credit → 192
        expect(stats.getGold()).toBe(192);
        expect(eq.get('weapon')!.def.id).toBe('butchers_cleaver');
        expect(sink).not.toHaveBeenCalled();
    });

    it('counts owned ids and set pieces', () => {
        const stats = new PlayerStats(120, 1000);
        const eq = new Equipment(stats);
        eq.buy(gorefang(), 0);
        eq.buy(skullcage(), 0);
        expect(eq.ownedIds().has('gorefang')).toBe(true);
        expect(eq.setCount('berserkers_wrath')).toBe(2);
    });
});

describe('Equipment aggregates', () => {
    it('multiplies pct mods and sums additive mods', () => {
        const stats = new PlayerStats(120, 10000);
        const eq = new Equipment(stats);
        eq.buy(cleaver(), 0);     // +12% basic damage
        eq.buy(bloodvial(), 0);   // +6% lifesteal
        const agg = eq.aggregates();
        expect(agg.basicDamageMult).toBeCloseTo(1.12);
        expect(agg.lifesteal).toBeCloseTo(0.06);
        expect(agg.effects.size).toBe(0);
    });

    it('includes the 2pc set bonus at 2 pieces but not 1', () => {
        const stats = new PlayerStats(120, 10000);
        const eq = new Equipment(stats);
        eq.buy(gorefang(), 0);    // item: +20% basic dmg, +0% atkspeed
        expect(eq.aggregates().attackSpeedMult).toBeCloseTo(1.0);
        eq.buy(skullcage(), 0);   // item +10% atkspeed; 2pc +20% atkspeed
        expect(eq.aggregates().attackSpeedMult).toBeCloseTo(1.10 * 1.20);
    });

    it('adds the set signature effect at 3 pieces', () => {
        const stats = new PlayerStats(120, 10000);
        const eq = new Equipment(stats);
        eq.buy(gorefang(), 0);
        eq.buy(skullcage(), 0);
        expect(eq.aggregates().effects.has('rage')).toBe(false);
        eq.buy(bloodplate(), 0);
        expect(eq.aggregates().effects.has('rage')).toBe(true);
    });

    it('includes item effectIds', () => {
        const stats = new PlayerStats(120, 10000);
        const eq = new Equipment(stats);
        eq.buy(itemById('thornmail_hauberk')!, 0);
        expect(eq.aggregates().effects.has('thorns')).toBe(true);
    });

    it('reset clears everything', () => {
        const stats = new PlayerStats(120, 10000);
        const eq = new Equipment(stats);
        eq.buy(gorefang(), 0);
        eq.reset();
        expect(eq.get('weapon')).toBeNull();
        expect(eq.aggregates().basicDamageMult).toBe(1);
    });
});

describe('foldEquipmentStats', () => {
    /** Simulates applyLevelBonuses(): assign level-derived values, then fold. */
    function recompute(ps: PlayerStats, eq: Equipment, t: ReturnType<typeof newEquipFoldTracker>) {
        ps.moveSpeedMultiplier = 1.05;
        ps.basicAttackSpeedMultiplier = 1.02;
        ps.powerDamageMultiplier = 1.10;
        ps.powerCooldownMultiplier = 0.95;
        ps.damageReductionMultiplier = 0.95;
        ps.critChance = 0.01;
        ps.critDamageMultiplier = 1.55;
        foldEquipmentStats(ps, eq.aggregates(), t);
    }

    it('is idempotent across repeated recomputes', () => {
        const ps = new PlayerStats(120, 10000);
        const eq = new Equipment(ps);
        const t = newEquipFoldTracker();
        eq.buy(itemById('sprintweave_boots')!, 0);   // +10% move speed
        eq.buy(bloodvial(), 0);                      // +6% lifesteal (delta-tracked)
        recompute(ps, eq, t);
        const move1 = ps.moveSpeedMultiplier;
        const ls1 = ps.lifestealPct;
        recompute(ps, eq, t);
        expect(ps.moveSpeedMultiplier).toBeCloseTo(move1);   // 1.05 × 1.10
        expect(ps.lifestealPct).toBeCloseTo(ls1);            // no double-add
        expect(move1).toBeCloseTo(1.05 * 1.10);
        expect(ls1).toBeCloseTo(0.06);
    });

    it('preserves external += additions to lifesteal (RunItems interplay)', () => {
        const ps = new PlayerStats(120, 10000);
        const eq = new Equipment(ps);
        const t = newEquipFoldTracker();
        eq.buy(bloodvial(), 0);
        recompute(ps, eq, t);
        ps.lifestealPct += 0.10;          // RunItems-style external addition
        recompute(ps, eq, t);
        expect(ps.lifestealPct).toBeCloseTo(0.16);
    });

    it('writes the equipment-only fields directly', () => {
        const ps = new PlayerStats(120, 10000);
        const eq = new Equipment(ps);
        const t = newEquipFoldTracker();
        eq.buy(cleaver(), 0);            // +12% basic damage
        recompute(ps, eq, t);
        expect(ps.basicDamageMultiplier).toBeCloseTo(1.12);
        eq.reset();
        recompute(ps, eq, t);
        expect(ps.basicDamageMultiplier).toBe(1);
    });
});
```

- [ ] **Step 3.2: Run to verify failure**

Run: `npx vitest run tests/Equipment.spec.ts`
Expected: FAIL — modules don't exist.

- [ ] **Step 3.3: Create `src/survivors/items/Equipment.ts`**

```typescript
import { PlayerStats } from '../PlayerStats';
import { EquipSlot, ItemDef, ItemEffectId, ItemStatMods, RARITY_BASE_PRICE } from './ItemTypes';
import { ITEM_SETS } from './ItemCatalog';

export interface EquippedItem {
    def: ItemDef;
    pricePaid: number;
}

/** Aggregated contribution of all equipped items + active 2pc set bonuses.
 *  Mults default to 1, additives to 0. Folded into PlayerStats by
 *  foldEquipmentStats() inside the state's applyLevelBonuses() recompute. */
export interface EquipmentAggregates {
    basicDamageMult: number;
    powerDamageMult: number;
    attackSpeedMult: number;
    moveSpeedMult: number;
    cooldownMult: number;      // <1 = faster
    damageTakenMult: number;   // <1 = tankier
    goldGainMult: number;
    critChance: number;
    critDamage: number;
    lifesteal: number;
    maxHealth: number;
    hpRegenPctPerSec: number;
    knockback: number;
    /** Item effectIds + 3pc set signature effects currently active. */
    effects: Set<ItemEffectId>;
    /** setId → owned piece count (drives shop pity weighting + UI badges). */
    setCounts: Record<string, number>;
}

export function priceFor(def: ItemDef, wave: number): number {
    return Math.ceil(RARITY_BASE_PRICE[def.rarity] * (1 + 0.06 * wave));
}

export function sellValueOf(pricePaid: number): number {
    return Math.floor(pricePaid * 0.6);
}

/** Per-run equipment inventory. Pure logic — no Babylon, no DOM.
 *  Only touches PlayerStats gold (spendGold/refundGold), never stat fields. */
export class Equipment {
    private slots = new Map<EquipSlot, EquippedItem>();

    constructor(private stats: PlayerStats) {}

    public get(slot: EquipSlot): EquippedItem | null {
        return this.slots.get(slot) ?? null;
    }

    public ownedIds(): Set<string> {
        return new Set([...this.slots.values()].map(e => e.def.id));
    }

    public setCount(setId: string): number {
        let n = 0;
        for (const e of this.slots.values()) if (e.def.setId === setId) n++;
        return n;
    }

    /** Buy `def` at the wave-scaled price. A piece already in the slot is
     *  auto-sold at 60% of what was paid for it (credited via refundGold so
     *  sell-backs never count as income/XP). Returns false if unaffordable. */
    public buy(def: ItemDef, wave: number): boolean {
        const price = priceFor(def, wave);
        const old = this.slots.get(def.slot) ?? null;
        const credit = old ? sellValueOf(old.pricePaid) : 0;
        if (this.stats.getGold() + credit < price) return false;
        if (credit >= price) {
            this.stats.refundGold(credit - price);
        } else {
            this.stats.spendGold(price - credit);
        }
        this.slots.set(def.slot, { def, pricePaid: price });
        return true;
    }

    public aggregates(): EquipmentAggregates {
        const agg: EquipmentAggregates = {
            basicDamageMult: 1, powerDamageMult: 1, attackSpeedMult: 1,
            moveSpeedMult: 1, cooldownMult: 1, damageTakenMult: 1, goldGainMult: 1,
            critChance: 0, critDamage: 0, lifesteal: 0, maxHealth: 0,
            hpRegenPctPerSec: 0, knockback: 0,
            effects: new Set<ItemEffectId>(), setCounts: {},
        };
        for (const e of this.slots.values()) {
            this.foldMods(agg, e.def.mods);
            if (e.def.effectId) agg.effects.add(e.def.effectId);
            if (e.def.setId) agg.setCounts[e.def.setId] = (agg.setCounts[e.def.setId] ?? 0) + 1;
        }
        for (const set of ITEM_SETS) {
            const count = agg.setCounts[set.id] ?? 0;
            if (count >= 2) this.foldMods(agg, set.bonus2);
            if (count >= 3) agg.effects.add(set.effect3);
        }
        return agg;
    }

    private foldMods(agg: EquipmentAggregates, mods: ItemStatMods): void {
        if (mods.basicDamagePct)  agg.basicDamageMult *= 1 + mods.basicDamagePct / 100;
        if (mods.powerDamagePct)  agg.powerDamageMult *= 1 + mods.powerDamagePct / 100;
        if (mods.attackSpeedPct)  agg.attackSpeedMult *= 1 + mods.attackSpeedPct / 100;
        if (mods.moveSpeedPct)    agg.moveSpeedMult   *= 1 + mods.moveSpeedPct / 100;
        if (mods.cooldownPct)     agg.cooldownMult    *= 1 - mods.cooldownPct / 100;
        if (mods.damageTakenPct)  agg.damageTakenMult *= 1 - mods.damageTakenPct / 100;
        if (mods.goldGainPct)     agg.goldGainMult    *= 1 + mods.goldGainPct / 100;
        if (mods.critChance)      agg.critChance      += mods.critChance;
        if (mods.critDamage)      agg.critDamage      += mods.critDamage;
        if (mods.lifesteal)       agg.lifesteal       += mods.lifesteal;
        if (mods.maxHealth)       agg.maxHealth       += mods.maxHealth;
        if (mods.hpRegenPctPerSec) agg.hpRegenPctPerSec += mods.hpRegenPctPerSec;
        if (mods.knockback)       agg.knockback       += mods.knockback;
    }

    public reset(): void {
        this.slots.clear();
    }
}
```

- [ ] **Step 3.4: Create `src/survivors/items/foldEquipmentStats.ts`**

```typescript
import { PlayerStats } from '../PlayerStats';
import { EquipmentAggregates } from './Equipment';

/** Tracks the equipment contribution currently sitting inside the two additive
 *  fields that are SHARED with RunItems (which +=s them and is never re-run).
 *  Everything else is either re-assigned by applyLevelBonuses() each recompute
 *  (safe to multiply/add onto) or owned exclusively by equipment (assigned). */
export interface EquipFoldTracker {
    lifesteal: number;
    knockback: number;
}

export function newEquipFoldTracker(): EquipFoldTracker {
    return { lifesteal: 0, knockback: 0 };
}

/** Fold equipment aggregates into PlayerStats. MUST be called immediately after
 *  applyLevelBonuses() re-assigns the level-derived fields — it multiplies/adds
 *  on top of those assignments, which makes the whole recompute idempotent.
 *  Max-HP is NOT handled here (the state applies it as a hero-controller delta,
 *  mirroring the level system's appliedMaxHpBonus pattern). */
export function foldEquipmentStats(
    ps: PlayerStats,
    agg: EquipmentAggregates,
    t: EquipFoldTracker,
): void {
    // Fields re-assigned by applyLevelBonuses() every recompute:
    ps.moveSpeedMultiplier        *= agg.moveSpeedMult;
    ps.basicAttackSpeedMultiplier *= agg.attackSpeedMult;
    ps.powerDamageMultiplier      *= agg.powerDamageMult;
    ps.powerCooldownMultiplier    *= agg.cooldownMult;
    ps.damageReductionMultiplier  *= agg.damageTakenMult;
    ps.critChance                 += agg.critChance;
    ps.critDamageMultiplier       += agg.critDamage;

    // Fields owned exclusively by equipment (nothing else writes them):
    ps.basicDamageMultiplier = agg.basicDamageMult;
    ps.goldGainMultiplier    = agg.goldGainMult;
    ps.hpRegenPctPerSec      = agg.hpRegenPctPerSec;

    // Shared additive fields (RunItems +=s them) — exact delta swap:
    ps.lifestealPct   += agg.lifesteal - t.lifesteal;
    t.lifesteal = agg.lifesteal;
    ps.knockbackOnHit += agg.knockback - t.knockback;
    t.knockback = agg.knockback;
}
```

- [ ] **Step 3.5: Run tests + type-check**

Run: `npx vitest run tests/Equipment.spec.ts && npx tsc --noEmit`
Expected: PASS (12 tests), no type errors.

- [ ] **Step 3.6: Commit**

```bash
git add src/survivors/items/Equipment.ts src/survivors/items/foldEquipmentStats.ts tests/Equipment.spec.ts
git commit -m "feat(items): Equipment inventory with buy/sell-back, set detection, aggregate stat fold"
```

---

### Task 4: ShopStock (stock rolling)

**Files:**
- Create: `src/survivors/shop/ShopStock.ts`
- Test: `tests/ShopStock.spec.ts`

- [ ] **Step 4.1: Write the failing tests**

```typescript
// tests/ShopStock.spec.ts
import { describe, expect, it } from 'vitest';
import {
    buildWeightedPool, rarityWeights, rerollCost, rollStock, STOCK_SIZE, SLOT_SOFT_CAP,
} from '../src/survivors/shop/ShopStock';
import { ITEM_CATALOG } from '../src/survivors/items/ItemCatalog';

/** Deterministic rng from a fixed sequence (loops). */
function seqRng(seq: number[]): () => number {
    let i = 0;
    return () => seq[i++ % seq.length];
}

const baseOpts = {
    champion: 'barbarian' as const,
    wave: 5,
    ownedIds: new Set<string>(),
    setCounts: {} as Record<string, number>,
    rng: seqRng([0.1, 0.5, 0.9, 0.3, 0.7, 0.2, 0.8, 0.4, 0.6]),
};

describe('rarityWeights', () => {
    it('locks legendaries out before wave 4', () => {
        expect(rarityWeights(3).legendary).toBe(0);
        expect(rarityWeights(4).legendary).toBeGreaterThan(0);
    });
    it('shifts weight toward high rarity late', () => {
        expect(rarityWeights(12).epic).toBeGreaterThan(rarityWeights(2).epic);
    });
});

describe('rerollCost', () => {
    it('escalates 25, 50, 75…', () => {
        expect(rerollCost(0)).toBe(25);
        expect(rerollCost(1)).toBe(50);
        expect(rerollCost(2)).toBe(75);
    });
});

describe('buildWeightedPool', () => {
    it('excludes other classes\' items and owned items', () => {
        const pool = buildWeightedPool(ITEM_CATALOG, {
            ...baseOpts, ownedIds: new Set(['gorefang']),
        });
        const ids = pool.map(p => p.def.id);
        expect(ids).not.toContain('stormpiercer');   // ranger weapon
        expect(ids).not.toContain('gorefang');       // owned
        expect(ids).toContain('butchers_cleaver');   // barbarian weapon
        expect(ids).toContain('bloodvial');          // 'all'
    });

    it('applies 2.5x pity weight to started sets', () => {
        const without = buildWeightedPool(ITEM_CATALOG, baseOpts);
        const withPity = buildWeightedPool(ITEM_CATALOG, {
            ...baseOpts, setCounts: { berserkers_wrath: 1 },
        });
        const w0 = without.find(p => p.def.id === 'skullcage_of_rage')!.weight;
        const w1 = withPity.find(p => p.def.id === 'skullcage_of_rage')!.weight;
        expect(w1).toBeCloseTo(w0 * 2.5);
    });

    it('drops zero-weight rarities (legendary on wave 1)', () => {
        const pool = buildWeightedPool(ITEM_CATALOG, { ...baseOpts, wave: 1 });
        expect(pool.some(p => p.def.rarity === 'legendary')).toBe(false);
    });
});

describe('rollStock', () => {
    it('returns STOCK_SIZE distinct items, all class-eligible', () => {
        const stock = rollStock(ITEM_CATALOG, baseOpts);
        expect(stock.length).toBe(STOCK_SIZE);
        expect(new Set(stock.map(i => i.id)).size).toBe(STOCK_SIZE);
        for (const item of stock) {
            expect(item.classes === 'all' || item.classes.includes('barbarian')).toBe(true);
        }
    });

    it('respects the per-slot soft cap', () => {
        for (let seed = 0; seed < 10; seed++) {
            const rng = seqRng([0.1 * seed + 0.05, 0.37, 0.83, 0.59, 0.21, 0.94, 0.45, 0.68, 0.12]);
            const stock = rollStock(ITEM_CATALOG, { ...baseOpts, rng });
            const perSlot: Record<string, number> = {};
            for (const item of stock) perSlot[item.slot] = (perSlot[item.slot] ?? 0) + 1;
            for (const n of Object.values(perSlot)) expect(n).toBeLessThanOrEqual(SLOT_SOFT_CAP);
        }
    });

    it('is deterministic for a given rng', () => {
        const a = rollStock(ITEM_CATALOG, { ...baseOpts, rng: seqRng([0.42, 0.17, 0.93, 0.55]) });
        const b = rollStock(ITEM_CATALOG, { ...baseOpts, rng: seqRng([0.42, 0.17, 0.93, 0.55]) });
        expect(a.map(i => i.id)).toEqual(b.map(i => i.id));
    });
});
```

- [ ] **Step 4.2: Run to verify failure**

Run: `npx vitest run tests/ShopStock.spec.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 4.3: Create `src/survivors/shop/ShopStock.ts`**

```typescript
import { ChampionType } from '../powers/PowerDefinitions';
import { EquipSlot, ItemDef, Rarity } from '../items/ItemTypes';

export const STOCK_SIZE = 6;
export const SLOT_SOFT_CAP = 2;
export const PITY_WEIGHT_MULT = 2.5;
export const REROLL_BASE_COST = 25;
export const REROLL_COST_STEP = 25;

export interface StockOpts {
    champion: ChampionType;
    wave: number;
    /** Item ids the player already owns (excluded from stock). */
    ownedIds: Set<string>;
    /** setId → owned piece count (pity weighting for started sets). */
    setCounts: Record<string, number>;
    /** Injectable RNG in [0,1) for testability. */
    rng: () => number;
}

export function rerollCost(rerollsThisVisit: number): number {
    return REROLL_BASE_COST + REROLL_COST_STEP * rerollsThisVisit;
}

export function rarityWeights(wave: number): Record<Rarity, number> {
    if (wave <= 3)  return { common: 60, rare: 35, epic: 5,  legendary: 0 };
    if (wave <= 6)  return { common: 40, rare: 40, epic: 18, legendary: 2 };
    if (wave <= 10) return { common: 25, rare: 40, epic: 28, legendary: 7 };
    return { common: 15, rare: 35, epic: 35, legendary: 15 };
}

export interface WeightedItem {
    def: ItemDef;
    weight: number;
}

/** Class-filtered, owned-excluded, rarity- and pity-weighted candidate pool. */
export function buildWeightedPool(catalog: ItemDef[], opts: StockOpts): WeightedItem[] {
    const weights = rarityWeights(opts.wave);
    const pool: WeightedItem[] = [];
    for (const def of catalog) {
        if (opts.ownedIds.has(def.id)) continue;
        if (def.classes !== 'all' && !def.classes.includes(opts.champion)) continue;
        let weight = weights[def.rarity];
        if (weight <= 0) continue;
        if (def.setId && (opts.setCounts[def.setId] ?? 0) >= 1) weight *= PITY_WEIGHT_MULT;
        pool.push({ def, weight });
    }
    return pool;
}

/** Weighted sample without replacement; items past the per-slot soft cap are
 *  discarded and drawing continues until STOCK_SIZE or pool exhaustion. */
export function rollStock(catalog: ItemDef[], opts: StockOpts): ItemDef[] {
    const pool = buildWeightedPool(catalog, opts);
    const out: ItemDef[] = [];
    const slotCount: Partial<Record<EquipSlot, number>> = {};
    while (out.length < STOCK_SIZE && pool.length > 0) {
        let total = 0;
        for (const entry of pool) total += entry.weight;
        let r = opts.rng() * total;
        let idx = pool.length - 1;
        for (let i = 0; i < pool.length; i++) {
            r -= pool[i].weight;
            if (r <= 0) { idx = i; break; }
        }
        const picked = pool.splice(idx, 1)[0].def;
        const count = slotCount[picked.slot] ?? 0;
        if (count >= SLOT_SOFT_CAP) continue;
        slotCount[picked.slot] = count + 1;
        out.push(picked);
    }
    return out;
}
```

- [ ] **Step 4.4: Run tests + type-check**

Run: `npx vitest run tests/ShopStock.spec.ts && npx tsc --noEmit`
Expected: PASS (9 tests), no type errors.

- [ ] **Step 4.5: Commit**

```bash
git add src/survivors/shop/ShopStock.ts tests/ShopStock.spec.ts
git commit -m "feat(shop): weighted stock rolling with class filter, pity weighting, reroll pricing"
```

### Task 5: ItemEffectRuntime (unique effects)

**Files:**
- Create: `src/survivors/items/ItemEffectRuntime.ts`
- Test: `tests/ItemEffectRuntime.spec.ts`

**Design notes:**
- The runtime is Babylon-free: all world interaction goes through an injected `EffectContext`, all visuals through `EffectFx`. The gameplay state implements both (Task 11).
- Gold flows: `onGoldEarned` is called from the state's `xpSink` lambda (which already sees every gold income). MIDAS double-pay re-enters `addGold` → re-fires `onGoldEarned`, so the double-pay roll is reentrancy-guarded (the bonus still feeds the coin-nova accumulator — that's fine and fun).
- `critExplode` rolls its own chance from `ctx.critChance()` — actual crits are rolled inside `Enemy.takeDamage` (static critProvider) and aren't observable at the hit hook. Statistically identical.
- RAGE only multiplies basic-attack damage, exposed via `damageBonusMult()` which the state folds into the existing `setDamageMultiplierProvider` lambda (`SurvivorsGameplayState.ts:983`). It never mutates PlayerStats fields (recompute would clobber it).

- [ ] **Step 5.1: Write the failing tests**

```typescript
// tests/ItemEffectRuntime.spec.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    CHRONO_COOLDOWN_S, ECHO_CHANCE, ItemEffectRuntime, MIDAS_NOVA_GOLD,
    RAGE_DAMAGE_BONUS, SHOCKWAVE_EVERY_HITS, THORNS_MULTIPLIER,
    EffectContext, EffectEnemy,
} from '../src/survivors/items/ItemEffectRuntime';
import { ItemEffectId } from '../src/survivors/items/ItemTypes';

function makeEnemy(x: number, z: number, alive = true): EffectEnemy {
    return { isAlive: () => alive, getPosition: () => ({ x, z }) };
}

function makeCtx(overrides: Partial<EffectContext> = {}): EffectContext & {
    fx: Record<string, ReturnType<typeof vi.fn>>;
} {
    const fx = {
        rageGlow: vi.fn(), coinNova: vi.fn(), shockwave: vi.fn(),
        ricochet: vi.fn(), echoShimmer: vi.fn(),
    };
    return {
        heroPos: () => ({ x: 0, z: 0 }),
        heroHpFraction: () => 1,
        enemiesNear: () => [],
        damage: vi.fn(),
        stun: vi.fn(),
        burn: vi.fn(),
        addGold: vi.fn(),
        refundCooldownPct: vi.fn(),
        recastFree: vi.fn(),
        wave: () => 5,
        rng: () => 0.99,
        critChance: () => 0,
        fx,
        ...overrides,
    } as EffectContext & { fx: Record<string, ReturnType<typeof vi.fn>> };
}

function activate(rt: ItemEffectRuntime, ...ids: ItemEffectId[]) {
    rt.setActiveEffects(new Set(ids));
}

describe('rage', () => {
    it('toggles glow + damage bonus crossing the 50% HP threshold', () => {
        let hp = 1;
        const ctx = makeCtx({ heroHpFraction: () => hp });
        const rt = new ItemEffectRuntime(ctx);
        activate(rt, 'rage');
        rt.tick(0.016);
        expect(rt.damageBonusMult()).toBe(1);
        hp = 0.4;
        rt.tick(0.016);
        expect(rt.damageBonusMult()).toBeCloseTo(1 + RAGE_DAMAGE_BONUS);
        expect(ctx.fx.rageGlow).toHaveBeenLastCalledWith(true);
        hp = 0.8;
        rt.tick(0.016);
        expect(rt.damageBonusMult()).toBe(1);
        expect(ctx.fx.rageGlow).toHaveBeenLastCalledWith(false);
    });

    it('drops the glow when the set is unequipped mid-rage', () => {
        const ctx = makeCtx({ heroHpFraction: () => 0.2 });
        const rt = new ItemEffectRuntime(ctx);
        activate(rt, 'rage');
        rt.tick(0.016);
        expect(rt.damageBonusMult()).toBeGreaterThan(1);
        activate(rt); // none
        expect(rt.damageBonusMult()).toBe(1);
        expect(ctx.fx.rageGlow).toHaveBeenLastCalledWith(false);
    });
});

describe('echo', () => {
    it('recasts when the roll passes and never re-enters', () => {
        const ctx = makeCtx({ rng: () => ECHO_CHANCE - 0.01 });
        const rt = new ItemEffectRuntime(ctx);
        activate(rt, 'echo');
        // Simulate recastFree triggering another onPowerCast (the real wiring
        // does NOT fire onCast for free recasts, but guard anyway):
        (ctx.recastFree as any).mockImplementation(() => rt.onPowerCast());
        rt.onPowerCast();
        expect(ctx.recastFree).toHaveBeenCalledTimes(1);
        expect(ctx.fx.echoShimmer).toHaveBeenCalledTimes(1);
    });

    it('does nothing when the roll fails', () => {
        const ctx = makeCtx({ rng: () => ECHO_CHANCE + 0.01 });
        const rt = new ItemEffectRuntime(ctx);
        activate(rt, 'echo');
        rt.onPowerCast();
        expect(ctx.recastFree).not.toHaveBeenCalled();
    });
});

describe('midas', () => {
    it('double-pays a kill when the roll passes, reentrancy-guarded', () => {
        const ctx = makeCtx({ rng: () => 0.01 });
        const rt = new ItemEffectRuntime(ctx);
        activate(rt, 'midas');
        (ctx.addGold as any).mockImplementation((n: number) => rt.onGoldEarned(n));
        rt.onGoldEarned(20);
        expect(ctx.addGold).toHaveBeenCalledTimes(1);
        expect(ctx.addGold).toHaveBeenCalledWith(20);
    });

    it('bursts a coin nova for every 150g earned', () => {
        const near = [makeEnemy(1, 1), makeEnemy(2, 0)];
        const ctx = makeCtx({ rng: () => 0.99, enemiesNear: () => near });
        const rt = new ItemEffectRuntime(ctx);
        activate(rt, 'midas');
        rt.onGoldEarned(MIDAS_NOVA_GOLD - 1);
        expect(ctx.fx.coinNova).not.toHaveBeenCalled();
        rt.onGoldEarned(1);
        expect(ctx.fx.coinNova).toHaveBeenCalledTimes(1);
        expect(ctx.damage).toHaveBeenCalledTimes(near.length);
        // damage scales with wave: 25 + 5×wave(5) = 50
        expect((ctx.damage as any).mock.calls[0][1]).toBe(50);
    });
});

describe('thorns + chrono (onHeroHurt)', () => {
    it('thorns reflects 3x to nearby enemies', () => {
        const near = [makeEnemy(0.5, 0)];
        const ctx = makeCtx({ enemiesNear: () => near });
        const rt = new ItemEffectRuntime(ctx);
        activate(rt, 'thorns');
        rt.onHeroHurt(10);
        expect(ctx.damage).toHaveBeenCalledWith(near[0], 10 * THORNS_MULTIPLIER, 'physical');
    });

    it('chrono refunds cooldowns with an internal cooldown', () => {
        const ctx = makeCtx();
        const rt = new ItemEffectRuntime(ctx);
        activate(rt, 'chrono');
        rt.onHeroHurt(5);
        rt.onHeroHurt(5);
        expect(ctx.refundCooldownPct).toHaveBeenCalledTimes(1);
        rt.tick(CHRONO_COOLDOWN_S + 0.01);
        rt.onHeroHurt(5);
        expect(ctx.refundCooldownPct).toHaveBeenCalledTimes(2);
    });
});

describe('onBasicHit effects', () => {
    it('burnOnHit burns the target', () => {
        const ctx = makeCtx();
        const rt = new ItemEffectRuntime(ctx);
        activate(rt, 'burnOnHit');
        const target = makeEnemy(1, 0);
        rt.onBasicHit(target, 20);
        expect(ctx.burn).toHaveBeenCalledWith(target, expect.any(Number), expect.any(Number));
    });

    it('ricochet bounces 60% damage to the nearest OTHER enemy in range', () => {
        const target = makeEnemy(0, 0);
        const close = makeEnemy(2, 0);
        const far = makeEnemy(100, 0);
        const ctx = makeCtx({ enemiesNear: () => [target, close, far] });
        const rt = new ItemEffectRuntime(ctx);
        activate(rt, 'ricochet');
        rt.onBasicHit(target, 50);
        expect(ctx.damage).toHaveBeenCalledTimes(1);
        expect(ctx.damage).toHaveBeenCalledWith(close, 30, 'physical');
        expect(ctx.fx.ricochet).toHaveBeenCalled();
    });

    it('shockwave fires every Nth hit, stunning nearby enemies', () => {
        const near = [makeEnemy(1, 1)];
        const ctx = makeCtx({ enemiesNear: () => near });
        const rt = new ItemEffectRuntime(ctx);
        activate(rt, 'shockwave');
        const target = makeEnemy(0, 0);
        for (let i = 0; i < SHOCKWAVE_EVERY_HITS - 1; i++) rt.onBasicHit(target, 10);
        expect(ctx.fx.shockwave).not.toHaveBeenCalled();
        rt.onBasicHit(target, 10);
        expect(ctx.fx.shockwave).toHaveBeenCalledTimes(1);
        expect(ctx.stun).toHaveBeenCalledWith(near[0], expect.any(Number));
    });

    it('critExplode AoEs 50% of the hit on a successful roll', () => {
        const target = makeEnemy(0, 0);
        const near = [target, makeEnemy(1, 0)];
        const ctx = makeCtx({ critChance: () => 0.5, rng: () => 0.4, enemiesNear: () => near });
        const rt = new ItemEffectRuntime(ctx);
        activate(rt, 'critExplode');
        rt.onBasicHit(target, 40);
        // explodes on everyone near EXCEPT the original target
        expect(ctx.damage).toHaveBeenCalledTimes(1);
        expect(ctx.damage).toHaveBeenCalledWith(near[1], 20, 'physical');
    });
});

describe('reset', () => {
    it('clears counters, rage state and active effects', () => {
        const ctx = makeCtx({ heroHpFraction: () => 0.1 });
        const rt = new ItemEffectRuntime(ctx);
        activate(rt, 'rage');
        rt.tick(0.016);
        expect(rt.damageBonusMult()).toBeGreaterThan(1);
        rt.reset();
        expect(rt.damageBonusMult()).toBe(1);
        rt.onPowerCast(); // no active effects → no-op
        expect(ctx.recastFree).not.toHaveBeenCalled();
    });
});
```

- [ ] **Step 5.2: Run to verify failure**

Run: `npx vitest run tests/ItemEffectRuntime.spec.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 5.3: Create `src/survivors/items/ItemEffectRuntime.ts`**

```typescript
import { ItemEffectId } from './ItemTypes';

/** Minimal enemy view the effects need — implemented by Enemy, faked in tests. */
export interface EffectEnemy {
    isAlive(): boolean;
    getPosition(): { x: number; z: number };
}

/** Visual hooks. Implemented with ItemFx helpers by the gameplay state;
 *  every implementation must follow the transient-FX material rules. */
export interface EffectFx {
    rageGlow(on: boolean): void;
    coinNova(x: number, z: number): void;
    shockwave(x: number, z: number, radius: number): void;
    ricochet(fromX: number, fromZ: number, toX: number, toZ: number): void;
    echoShimmer(): void;
}

/** World access for effects. Implemented by SurvivorsGameplayState. */
export interface EffectContext {
    heroPos(): { x: number; z: number };
    heroHpFraction(): number;
    /** Alive enemies within `radius` of (x,z). */
    enemiesNear(x: number, z: number, radius: number): EffectEnemy[];
    damage(e: EffectEnemy, amount: number, element: string): void;
    stun(e: EffectEnemy, seconds: number): void;
    burn(e: EffectEnemy, seconds: number, strength: number): void;
    addGold(amount: number): void;
    /** Reduce every power slot's remaining cooldown by `fraction` (0..1). */
    refundCooldownPct(fraction: number): void;
    /** Recast the most recently cast power for free (no cooldown reset). */
    recastFree(): void;
    wave(): number;
    rng(): number;
    /** Player's current crit chance (critExplode rolls its own). */
    critChance(): number;
    fx: EffectFx;
}

export const RAGE_THRESHOLD = 0.5;
export const RAGE_DAMAGE_BONUS = 0.6;
export const ECHO_CHANCE = 0.25;
export const MIDAS_DOUBLE_CHANCE = 0.15;
export const MIDAS_NOVA_GOLD = 150;
export const MIDAS_NOVA_RADIUS = 6;
export const SHOCKWAVE_EVERY_HITS = 6;
export const SHOCKWAVE_COOLDOWN_S = 1.5;
export const SHOCKWAVE_RADIUS = 5;
export const SHOCKWAVE_DAMAGE = 40;
export const SHOCKWAVE_STUN_S = 1;
export const RICOCHET_RANGE = 8;
export const RICOCHET_DAMAGE_FRACTION = 0.6;
export const CRIT_EXPLODE_RADIUS = 3;
export const CRIT_EXPLODE_FRACTION = 0.5;
export const THORNS_MULTIPLIER = 3;
export const THORNS_RADIUS = 2.5;
export const CHRONO_REFUND_FRACTION = 0.1;
export const CHRONO_COOLDOWN_S = 1;
export const BURN_DURATION_S = 3;
export const BURN_STRENGTH = 3;

/** Runs the unique item/set effects. Babylon-free: all world interaction goes
 *  through the injected EffectContext. The gameplay state calls the on*()
 *  entry points from its existing hooks and tick(dt) once per unpaused frame. */
export class ItemEffectRuntime {
    private active = new Set<ItemEffectId>();
    private rageOn = false;
    private hitCounter = 0;
    private shockwaveCd = 0;
    private chronoCd = 0;
    private novaAccum = 0;
    private inEcho = false;
    private inDoublePay = false;

    constructor(private ctx: EffectContext) {}

    public setActiveEffects(ids: Set<ItemEffectId>): void {
        this.active = ids;
        if (!ids.has('rage') && this.rageOn) {
            this.rageOn = false;
            this.ctx.fx.rageGlow(false);
        }
    }

    /** Basic-attack damage multiplier contributed by effects (RAGE). The state
     *  folds this into the hero's damageMultiplierProvider. */
    public damageBonusMult(): number {
        return this.rageOn ? 1 + RAGE_DAMAGE_BONUS : 1;
    }

    public tick(dt: number): void {
        this.shockwaveCd = Math.max(0, this.shockwaveCd - dt);
        this.chronoCd = Math.max(0, this.chronoCd - dt);
        if (this.active.has('rage')) {
            const low = this.ctx.heroHpFraction() < RAGE_THRESHOLD;
            if (low !== this.rageOn) {
                this.rageOn = low;
                this.ctx.fx.rageGlow(low);
            }
        }
    }

    public onBasicHit(target: EffectEnemy, damage: number): void {
        if (this.active.has('burnOnHit')) {
            this.ctx.burn(target, BURN_DURATION_S, BURN_STRENGTH);
        }
        if (this.active.has('ricochet')) {
            const tp = target.getPosition();
            let best: EffectEnemy | null = null;
            let bestDistSq = RICOCHET_RANGE * RICOCHET_RANGE;
            for (const e of this.ctx.enemiesNear(tp.x, tp.z, RICOCHET_RANGE)) {
                if (e === target || !e.isAlive()) continue;
                const p = e.getPosition();
                const dSq = (p.x - tp.x) ** 2 + (p.z - tp.z) ** 2;
                if (dSq < bestDistSq) { bestDistSq = dSq; best = e; }
            }
            if (best) {
                const bp = best.getPosition();
                this.ctx.damage(best, Math.round(damage * RICOCHET_DAMAGE_FRACTION), 'physical');
                this.ctx.fx.ricochet(tp.x, tp.z, bp.x, bp.z);
            }
        }
        if (this.active.has('critExplode') && this.ctx.rng() < this.ctx.critChance()) {
            const tp = target.getPosition();
            for (const e of this.ctx.enemiesNear(tp.x, tp.z, CRIT_EXPLODE_RADIUS)) {
                if (e === target) continue;
                this.ctx.damage(e, Math.round(damage * CRIT_EXPLODE_FRACTION), 'physical');
            }
            this.ctx.fx.shockwave(tp.x, tp.z, CRIT_EXPLODE_RADIUS);
        }
        if (this.active.has('shockwave')) {
            this.hitCounter++;
            if (this.hitCounter >= SHOCKWAVE_EVERY_HITS && this.shockwaveCd <= 0) {
                this.hitCounter = 0;
                this.shockwaveCd = SHOCKWAVE_COOLDOWN_S;
                const hp = this.ctx.heroPos();
                for (const e of this.ctx.enemiesNear(hp.x, hp.z, SHOCKWAVE_RADIUS)) {
                    this.ctx.damage(e, SHOCKWAVE_DAMAGE, 'physical');
                    this.ctx.stun(e, SHOCKWAVE_STUN_S);
                }
                this.ctx.fx.shockwave(hp.x, hp.z, SHOCKWAVE_RADIUS);
            }
        }
    }

    /** Called from the state's xpSink lambda — sees every gold income. */
    public onGoldEarned(amount: number): void {
        if (!this.active.has('midas')) return;
        if (!this.inDoublePay && this.ctx.rng() < MIDAS_DOUBLE_CHANCE) {
            this.inDoublePay = true;
            try { this.ctx.addGold(amount); } finally { this.inDoublePay = false; }
        }
        this.novaAccum += amount;
        while (this.novaAccum >= MIDAS_NOVA_GOLD) {
            this.novaAccum -= MIDAS_NOVA_GOLD;
            const hp = this.ctx.heroPos();
            const dmg = 25 + 5 * this.ctx.wave();
            for (const e of this.ctx.enemiesNear(hp.x, hp.z, MIDAS_NOVA_RADIUS)) {
                this.ctx.damage(e, dmg, 'physical');
            }
            this.ctx.fx.coinNova(hp.x, hp.z);
        }
    }

    public onHeroHurt(amount: number): void {
        if (amount <= 0) return;
        if (this.active.has('thorns')) {
            const hp = this.ctx.heroPos();
            for (const e of this.ctx.enemiesNear(hp.x, hp.z, THORNS_RADIUS)) {
                this.ctx.damage(e, amount * THORNS_MULTIPLIER, 'physical');
            }
        }
        if (this.active.has('chrono') && this.chronoCd <= 0) {
            this.chronoCd = CHRONO_COOLDOWN_S;
            this.ctx.refundCooldownPct(CHRONO_REFUND_FRACTION);
        }
    }

    public onPowerCast(): void {
        if (!this.active.has('echo') || this.inEcho) return;
        if (this.ctx.rng() < ECHO_CHANCE) {
            this.inEcho = true;
            try {
                this.ctx.recastFree();
                this.ctx.fx.echoShimmer();
            } finally {
                this.inEcho = false;
            }
        }
    }

    public reset(): void {
        if (this.rageOn) this.ctx.fx.rageGlow(false);
        this.active = new Set();
        this.rageOn = false;
        this.hitCounter = 0;
        this.shockwaveCd = 0;
        this.chronoCd = 0;
        this.novaAccum = 0;
        this.inEcho = false;
        this.inDoublePay = false;
    }
}
```

- [ ] **Step 5.4: Run tests + type-check**

Run: `npx vitest run tests/ItemEffectRuntime.spec.ts && npx tsc --noEmit`
Expected: PASS (12 tests), no type errors.

- [ ] **Step 5.5: Commit**

```bash
git add src/survivors/items/ItemEffectRuntime.ts tests/ItemEffectRuntime.spec.ts
git commit -m "feat(items): unique-effect runtime (rage/echo/midas/thorns/chrono/ricochet/shockwave/critExplode/burn)"
```

---

### Task 6: Combat hooks (HeroBasicAttack, HeroController, PowerSlotManager)

**Files:**
- Modify: `src/survivors/champions/HeroBasicAttack.ts`
- Modify: `src/survivors/HeroController.ts` (takeDamage at line ~326)
- Modify: `src/survivors/powers/PowerSlotManager.ts`
- Test: `tests/PowerSlotManager.spec.ts` (append)

- [ ] **Step 6.1: Write the failing recastFree test** — append to `tests/PowerSlotManager.spec.ts` (mirror the file's existing helper for creating a manager + defs; adapt names to what's there):

```typescript
describe('recastFree (Echo item effect)', () => {
    it('recasts the most recent cast without resetting cooldown or firing onCast', () => {
        // Use the file's existing manager/def factory. The def's cast must be a vi.fn().
        const { manager, def, castSpy } = makeManagerWithCastingDef(); // adapt to existing helpers
        const onCast = vi.fn();
        manager.setOnCast(onCast);
        manager.addPower(def.id);
        // Drive update() until the slot casts once (cooldown elapses):
        manager.update(def.baseCooldown + 0.1);
        const castsAfterFirst = castSpy.mock.calls.length;
        const onCastAfterFirst = onCast.mock.calls.length;
        const cdAfterFirst = manager.getSlots()[0]!.state.cooldownRemaining;

        expect(manager.recastFree()).toBe(true);
        expect(castSpy.mock.calls.length).toBe(castsAfterFirst + 1);
        expect(onCast.mock.calls.length).toBe(onCastAfterFirst);      // NOT re-fired
        expect(manager.getSlots()[0]!.state.cooldownRemaining).toBe(cdAfterFirst);
    });

    it('returns false when nothing has cast yet', () => {
        const { manager } = makeManagerWithCastingDef();
        expect(manager.recastFree()).toBe(false);
    });
});
```

**Note for the implementer:** read `tests/PowerSlotManager.spec.ts` first — it already constructs managers with fake `PowerDefinition`s and providers. Reuse its factory; only the assertions above are new. If autocast requires an enemy in range, use the file's existing enemy-provider stub.

- [ ] **Step 6.2: Run to verify failure**

Run: `npx vitest run tests/PowerSlotManager.spec.ts`
Expected: the two new tests FAIL (`recastFree` doesn't exist).

- [ ] **Step 6.3: Implement `recastFree` in `PowerSlotManager.ts`**

Add a field near the other privates:

```typescript
    /** Most recently cast slot — target for the Echo item effect's free recast. */
    private lastCastSlot: PowerSlot | null = null;
```

There are three places a slot's `cast()` runs (grep `def.cast(`): the pending-cast flush in `update()` (~line 222), the cooldown-ready cast (~line 261), and `forceCastAutocastSlots` (~line 285). After each `cast(...)` call add:

```typescript
                this.lastCastSlot = slot;        // (or pending.slot in the flush)
```

Then add the public method:

```typescript
    /** Echo item effect: recast the most recently cast power for free — fresh
     *  context, no cooldown reset, and deliberately NO onCast notification
     *  (free recasts must not re-trigger cast-driven hooks like Echo itself). */
    public recastFree(): boolean {
        const slot = this.lastCastSlot;
        if (!slot || !this.slots.includes(slot) || !slot.def.cast) return false;
        const ctx = this.buildContext();
        ctx.element = slot.def.element;
        slot.def.cast(slot.state, ctx);
        return true;
    }
```

(`buildContext()` already exists — it's used by the pending-cast flush. Match its actual name/signature. Also clear `lastCastSlot = null` in `dispose()` and wherever slots are replaced/fused if the slot is removed — simplest is the `this.slots.includes(slot)` guard above, which already covers it.)

- [ ] **Step 6.4: Add the hurt hook to `HeroController.ts`**

Near the other callback fields (line ~68):

```typescript
    /** Item-effect hook: fired with the post-mitigation damage actually applied. */
    private onHurtCallback: ((amount: number) => void) | null = null;
    public setOnHurt(fn: ((amount: number) => void) | null): void {
        this.onHurtCallback = fn;
    }
```

In `takeDamage` (line ~326), immediately after `this.currentHealth -= amount;` add:

```typescript
        this.onHurtCallback?.(amount);
```

(After the invulnerable/shield early-return, so it only fires for damage that landed.)

- [ ] **Step 6.5: Add the hit hook to `HeroBasicAttack.ts`**

Near `setHealCallback` (~line 140):

```typescript
    /** Item-effect hook: fired once per enemy actually hit by a basic attack
     *  (melee swing AND projectile), with the pre-crit damage dealt. */
    private onHitCallback: ((target: Enemy, damage: number) => void) | null = null;
    public setOnHit(fn: ((target: Enemy, damage: number) => void) | null): void {
        this.onHitCallback = fn;
    }
```

At the end of `applyHit` (after `this.applyEnchantments(e, fromPos, enemies);`, ~line 360):

```typescript
        this.onHitCallback?.(e, dmg);
```

For the projectile path: the `BasicAttackTarget` wrapper (interface at line ~18) closes over the real enemy but doesn't expose it. Add to the interface:

```typescript
    /** The real Enemy behind this target, when there is one (item-effect hooks). */
    sourceEnemy?: Enemy;
```

Set `sourceEnemy: e` (or `sourceEnemy: target` as appropriate) at the wrapper-construction sites (~lines 543 and 595 — grep `takeDamage: (amount` to find both object literals). Then in the projectile hit-resolution block (~line 735, where lifesteal/knockback are applied with `f.capturedDamage`), add:

```typescript
            if (f.target.sourceEnemy) {
                this.onHitCallback?.(f.target.sourceEnemy, f.capturedDamage);
            }
```

(Adapt `f.target` to the actual local names in that block — read the surrounding 20 lines first. Place it next to the existing lifesteal/knockback application so it fires under the same "hit landed" condition, and on the host/single-player path only — the block already has a guest guard for `takeDamage`; the hook goes on the non-guest side.)

- [ ] **Step 6.6: Run tests + type-check**

Run: `npx vitest run tests/PowerSlotManager.spec.ts && npx tsc --noEmit`
Expected: PASS including the 2 new tests; no type errors.

- [ ] **Step 6.7: Commit**

```bash
git add src/survivors/powers/PowerSlotManager.ts src/survivors/HeroController.ts src/survivors/champions/HeroBasicAttack.ts tests/PowerSlotManager.spec.ts
git commit -m "feat(items): combat hooks — basic-hit + hero-hurt callbacks, PowerSlotManager.recastFree"
```

### Task 7: HUD — gold pill + "Sound the horn" button

**Files:**
- Modify: `src/ui/primitives/Pill.ts`
- Modify: `src/ui/hud/Hud.ts`
- Modify: `src/ui/styles/components.css`

No unit tests (DOM/HUD is exercised manually) — keep changes minimal and mirror existing pill/button patterns.

- [ ] **Step 7.1: Add the `'gold'` pill kind in `Pill.ts`**

```typescript
export type PillKind = 'hp' | 'wave' | 'level' | 'gold';
```
(No fill bar for gold — the existing `if (kind === 'hp' || kind === 'level')` stays as-is.)

- [ ] **Step 7.2: Add the gold pill to `Hud.ts`**

Field next to the other pills (line ~50):

```typescript
  private goldPill: PillController;
  private prevGold = -1;
```

In the constructor's top-bar block (line ~82-87), create and append it after `levelPill`:

```typescript
    this.goldPill = makePill('gold');
    topBar.append(this.hpPill.root, this.wavePill.root, this.levelPill.root, this.goldPill.root);
```
(Replace the existing `topBar.append(...)` line.)

Add the setter (near `flashXpBar`):

```typescript
  /** Update the gold pill (called every frame by the gameplay state). */
  setGold(gold: number): void {
    if (gold === this.prevGold) return;
    if (this.prevGold >= 0 && gold > this.prevGold) flashClass(this.goldPill.root, 'pill--pulse');
    this.prevGold = gold;
    this.goldPill.setText(`🪙 ${gold}`);
  }
```

- [ ] **Step 7.3: Add the horn button to `Hud.ts`**

This is the always-available "start the next wave" control during the shopping phase (the shop's "To battle!" button is only reachable by walking to the merchant — without the horn an AFK-averse player could soft-lock the run).

Fields:

```typescript
  private hornBtn!: HTMLDivElement;
  private onHorn: () => void = () => {};
```

In the constructor (after the pause-button block):

```typescript
    // "Sound the horn" — starts the next wave during the merchant/shopping phase.
    this.hornBtn = el('div', { class: 'hud__horn frame frame--lite interactive', attrs: { role: 'button' } });
    this.hornBtn.appendChild(el('div', { class: 'hud__horn-label', text: '⚔ Next wave' }));
    this.hornBtn.style.display = 'none';
    onTap(this.hornBtn, () => this.onHorn());
    this.root.appendChild(this.hornBtn);
```

Public API (near `setGold`):

```typescript
  setOnHorn(fn: () => void): void { this.onHorn = fn; }
  setHornVisible(visible: boolean): void {
    this.hornBtn.style.display = visible ? '' : 'none';
  }
```

- [ ] **Step 7.4: Add CSS to `components.css`** — read the file's pill/ult sections first and match its variable/spacing conventions; the intent:

```css
/* ── Gold pill ─────────────────────────────────────────────── */
.pill--gold .pill__txt { color: #ffd84a; }

/* ── Horn button (next-wave during shopping phase) ─────────── */
.hud__horn {
  position: absolute;
  bottom: 118px;
  left: 50%;
  transform: translateX(-50%);
  padding: 10px 22px;
  cursor: pointer;
  pointer-events: auto;
}
.hud__horn-label {
  font-weight: 700;
  letter-spacing: 0.08em;
  color: #ffd84a;
  text-transform: uppercase;
  font-size: 14px;
}
```

- [ ] **Step 7.5: Type-check + commit**

Run: `npx tsc --noEmit` — expect clean.

```bash
git add src/ui/primitives/Pill.ts src/ui/hud/Hud.ts src/ui/styles/components.css
git commit -m "feat(hud): gold pill + sound-the-horn next-wave button"
```

---

### Task 8: ItemFx — leak-safe transient visuals

**Files:**
- Create: `src/survivors/items/ItemFx.ts`

**Material rules (project invariant):** every material here goes through `getCachedMaterial` with a BOUNDED key; meshes fade via `mesh.visibility`, never via material `.alpha` mutation; meshes dispose with `dispose(false, false)` because their materials are cache-owned.

- [ ] **Step 8.1: Create `src/survivors/items/ItemFx.ts`**

```typescript
import { Color3, Mesh, MeshBuilder, Scene, Vector3 } from '@babylonjs/core';
import { getCachedMaterial } from '../../engine/rendering/MaterialCache';
import { createEmissiveMaterial } from '../../engine/rendering/LowPolyMaterial';

/** Spawn a flat expanding ring that fades out over `durationS`. Material is
 *  cache-owned (bounded key = colorHex), so dispose(false, false). */
export function spawnExpandingRing(
    scene: Scene, x: number, z: number,
    colorHex: string, maxRadius: number, durationS = 0.45,
): void {
    const ring = MeshBuilder.CreateTorus(`itemfx_ring`, {
        diameter: 1, thickness: 0.18, tessellation: 32,
    }, scene);
    ring.position.set(x, 0.25, z);
    ring.material = getCachedMaterial(scene, `itemfx_ring_${colorHex}`, () =>
        createEmissiveMaterial(scene, Color3.FromHexString(colorHex), `itemfx_ring_${colorHex}`));
    ring.isPickable = false;
    let t = 0;
    const obs = scene.onBeforeRenderObservable.add(() => {
        t += scene.getEngine().getDeltaTime() / 1000;
        const f = Math.min(1, t / durationS);
        const d = 0.5 + f * maxRadius * 2;
        ring.scaling.set(d, 1, d);
        ring.visibility = 1 - f;
        if (f >= 1) {
            scene.onBeforeRenderObservable.remove(obs);
            ring.dispose(false, false);
        }
    });
}

/** Quick straight trail between two points (ricochet). Cache-owned material. */
export function spawnTrail(
    scene: Scene, fromX: number, fromZ: number, toX: number, toZ: number,
    colorHex: string, durationS = 0.25,
): void {
    const dx = toX - fromX;
    const dz = toZ - fromZ;
    const len = Math.hypot(dx, dz);
    if (len < 0.01) return;
    const beam = MeshBuilder.CreateBox(`itemfx_trail`, { width: 0.12, height: 0.12, depth: len }, scene);
    beam.position.set((fromX + toX) / 2, 0.8, (fromZ + toZ) / 2);
    beam.rotation.y = Math.atan2(dx, dz);
    beam.material = getCachedMaterial(scene, `itemfx_trail_${colorHex}`, () =>
        createEmissiveMaterial(scene, Color3.FromHexString(colorHex), `itemfx_trail_${colorHex}`));
    beam.isPickable = false;
    let t = 0;
    const obs = scene.onBeforeRenderObservable.add(() => {
        t += scene.getEngine().getDeltaTime() / 1000;
        const f = Math.min(1, t / durationS);
        beam.visibility = 1 - f;
        if (f >= 1) {
            scene.onBeforeRenderObservable.remove(obs);
            beam.dispose(false, false);
        }
    });
}

/** Persistent rage glow: an emissive disc that follows the hero while active.
 *  ONE mesh, toggled by visibility — created lazily, disposed by dispose(). */
export class RageGlow {
    private disc: Mesh | null = null;

    constructor(private scene: Scene, private getHeroPos: () => Vector3 | null) {}

    public setActive(on: boolean): void {
        if (on && !this.disc) {
            this.disc = MeshBuilder.CreateDisc('itemfx_rage_disc', { radius: 1.4, tessellation: 24 }, this.scene);
            this.disc.rotation.x = Math.PI / 2;
            this.disc.material = getCachedMaterial(this.scene, 'itemfx_rage', () =>
                createEmissiveMaterial(this.scene, Color3.FromHexString('#ff2818'), 'itemfx_rage'));
            this.disc.visibility = 0.45;
            this.disc.isPickable = false;
        }
        if (this.disc) this.disc.setEnabled(on);
    }

    /** Call per frame while active — follows the hero. */
    public update(): void {
        if (!this.disc || !this.disc.isEnabled()) return;
        const p = this.getHeroPos();
        if (p) this.disc.position.set(p.x, 0.15, p.z);
    }

    public dispose(): void {
        this.disc?.dispose(false, false);
        this.disc = null;
    }
}
```

**Implementer note:** check `createEmissiveMaterial`'s actual signature in `src/engine/rendering/LowPolyMaterial.ts` before using (arg order/name parameter) and adapt; same for `getCachedMaterial` (key, factory) in `MaterialCache.ts` — the MaterialCache spec tests show usage. Per-frame observables MUST remove themselves (they do above) — verify no observer leaks if the scene is torn down mid-animation by also guarding `if (ring.isDisposed())`.

- [ ] **Step 8.2: Type-check + commit**

Run: `npx tsc --noEmit` — expect clean.

```bash
git add src/survivors/items/ItemFx.ts
git commit -m "feat(items): leak-safe transient FX helpers (rings, trail, rage glow)"
```

---

### Task 9: Gribble's barks + ShopOverlay (DOM UI)

**Files:**
- Create: `src/survivors/shop/GribbleBarks.ts`
- Create: `src/ui/overlays/ShopOverlay.ts`
- Modify: `src/ui/styles/components.css`

- [ ] **Step 9.1: Create `src/survivors/shop/GribbleBarks.ts`**

```typescript
/** Gribble the traveling merchant — bark lines. Pure data, picked with an
 *  injected rng so tests (and the bark rotation) stay deterministic. */
export const GRIBBLE_NAME = 'Gribble';

export type BarkCategory = 'arrive' | 'browse' | 'buy' | 'poor' | 'leave' | 'reroll';

export const GRIBBLE_BARKS: Record<BarkCategory, string[]> = {
    arrive: [
        'Fresh goods! Fell off a caravan. ALL of it fell off a caravan.',
        'Gribble\'s Emporium is OPEN! No refunds, no questions, no witnesses.',
        'Psst! Hero! Yes you, the stabby one. Come spend!',
        'I followed the screaming. Screaming means customers!',
    ],
    browse: [
        'For you? Triple price. Kidding! …Mostly.',
        'That one\'s cursed. The price, I mean. The item\'s fine.',
        'Try it on! If it bites, that\'s a feature.',
        'Quality goods! Gribble only steals from the BEST.',
    ],
    buy: [
        'Pleasure doin\' business, tall person!',
        'SOLD! Gribble eats tonight!',
        'Excellent choice. The last owner barely used it. Briefly.',
        'A coin saved is a coin Gribble doesn\'t have. Spend more!',
    ],
    poor: [
        'Come back when yer pockets jingle!',
        'No gold, no goods. Gribble\'s heart says yes, Gribble\'s ledger says NO.',
        'I take gold, not exposure.',
    ],
    leave: [
        'Window shoppers don\'t keep Gribble fed!',
        'Fine, FINE! Go fight monsters in DISCOUNT gear!',
        'You\'ll be back. They\'re always back. Usually bleeding.',
    ],
    reroll: [
        'Shake the wagon, see what falls out!',
        'New stock! Don\'t ask where from.',
        'Gribble\'s cousin "found" these this morning.',
    ],
};

export function pickBark(category: BarkCategory, rng: () => number = Math.random): string {
    const lines = GRIBBLE_BARKS[category];
    return lines[Math.floor(rng() * lines.length) % lines.length];
}
```

- [ ] **Step 9.2: Create `src/ui/overlays/ShopOverlay.ts`**

Follows the `PowerChoiceOverlay` pattern (constructor takes the parent layer; `show`/`close`/`isOpen`; modal via `makeModal`). The overlay is *dumb*: it renders a view-model and forwards clicks — all gold math, stock state and equipment live in the gameplay state.

```typescript
import { makeModal, ModalController } from '../primitives/Modal';
import { makeButton } from '../primitives/Button';
import { el } from '../dom';
import { onTap } from '../interaction';
import { EquipSlot, EQUIP_SLOTS, ItemDef, Rarity, RARITY_COLOR } from '../../survivors/items/ItemTypes';
import { GRIBBLE_NAME } from '../../survivors/shop/GribbleBarks';

export interface ShopCardVM {
    def: ItemDef;
    price: number;
    affordable: boolean;
    /** Name of the piece currently in that slot (sell-back hint), if any. */
    replaces: string | null;
    sellCredit: number;
    /** e.g. "Goblin Fortune 2/3" when the item belongs to a set. */
    setProgress: string | null;
    /** Human-readable stat lines, e.g. "+20% basic damage". */
    statLines: string[];
    /** Unique-effect / set-bonus text, if any. */
    effectText: string | null;
}

export interface ShopEquipVM {
    slot: EquipSlot;
    name: string | null;
    glyph: string | null;
    rarity: Rarity | null;
}

export interface ShopVM {
    gold: number;
    cards: ShopCardVM[];
    equipment: ShopEquipVM[];
    rerollCost: number;
    rerollAffordable: boolean;
    quip: string;
}

export interface ShopCallbacks {
    /** Buy the card at `index` in the current VM. */
    onBuy(index: number): void;
    onReroll(): void;
    /** Close shop AND start the next wave. */
    onBattle(): void;
    /** Closed without battle (walked away / X) — game unpauses, merchant stays. */
    onClosed(): void;
}

const SLOT_LABEL: Record<EquipSlot, string> = {
    weapon: 'Weapon', helmet: 'Helmet', chest: 'Chest',
    legs: 'Legs', boots: 'Boots', trinket: 'Trinket',
};
const SLOT_GLYPH: Record<EquipSlot, string> = {
    weapon: '⚔', helmet: '🪖', chest: '🛡', legs: '🦵', boots: '👢', trinket: '📿',
};

export class ShopOverlay {
    private modal: ModalController | null = null;
    private callbacks: ShopCallbacks | null = null;
    private quipEl: HTMLDivElement | null = null;
    private goldEl: HTMLDivElement | null = null;

    constructor(private parent: HTMLElement) {}

    public show(vm: ShopVM, callbacks: ShopCallbacks): void {
        this.closeSilently();
        this.callbacks = callbacks;

        const modal = makeModal({ title: `${GRIBBLE_NAME}'s Traveling Emporium`, panelClass: 'shop-panel' });

        // Header: quip + gold
        const header = el('div', { class: 'shop-header' });
        this.quipEl = el('div', { class: 'shop-quip' });
        this.goldEl = el('div', { class: 'shop-gold' });
        header.append(this.quipEl, this.goldEl);
        modal.body.appendChild(header);

        // Stock grid
        const grid = el('div', { class: 'shop-grid' });
        grid.dataset.role = 'grid';
        modal.body.appendChild(grid);

        // Equipment strip
        const strip = el('div', { class: 'shop-equip' });
        strip.dataset.role = 'equip';
        modal.body.appendChild(strip);

        // Footer: reroll + battle
        const footer = el('div', { class: 'shop-footer' });
        const reroll = makeButton({
            label: '', variant: 'ghost',
            onClick: () => this.callbacks?.onReroll(),
        });
        reroll.classList.add('shop-reroll');
        const battle = makeButton({
            label: '⚔ To battle!', variant: 'primary',
            onClick: () => { this.callbacks?.onBattle(); },
        });
        battle.classList.add('shop-battle');
        const leave = makeButton({
            label: 'Leave', variant: 'ghost',
            onClick: () => this.close(),
        });
        footer.append(reroll, leave, battle);
        modal.body.appendChild(footer);
        (this as any)._rerollBtn = reroll;

        this.parent.appendChild(modal.root);
        this.modal = modal;
        this.refresh(vm);
    }

    /** Re-render the dynamic parts after a buy/reroll. */
    public refresh(vm: ShopVM): void {
        if (!this.modal) return;
        this.setQuip(vm.quip);
        this.goldEl!.textContent = `🪙 ${vm.gold}`;

        const grid = this.modal.body.querySelector('[data-role="grid"]') as HTMLDivElement;
        grid.replaceChildren();
        vm.cards.forEach((card, index) => {
            grid.appendChild(this.buildCard(card, index));
        });

        const strip = this.modal.body.querySelector('[data-role="equip"]') as HTMLDivElement;
        strip.replaceChildren();
        for (const eq of vm.equipment) {
            const cell = el('div', { class: `shop-equip__cell${eq.name ? '' : ' shop-equip__cell--empty'}` });
            if (eq.rarity) cell.style.setProperty('--accent', RARITY_COLOR[eq.rarity]);
            cell.append(
                el('div', { class: 'shop-equip__glyph', text: eq.glyph ?? SLOT_GLYPH[eq.slot] }),
                el('div', { class: 'shop-equip__slot', text: SLOT_LABEL[eq.slot] }),
                el('div', { class: 'shop-equip__name', text: eq.name ?? '—' }),
            );
            strip.appendChild(cell);
        }

        const rerollBtn = (this as any)._rerollBtn as HTMLButtonElement | HTMLDivElement;
        rerollBtn.textContent = `🎲 Reroll (${vm.rerollCost}g)`;
        rerollBtn.classList.toggle('shop-reroll--poor', !vm.rerollAffordable);
    }

    public setQuip(text: string): void {
        if (this.quipEl) this.quipEl.textContent = `“${text}”`;
    }

    private buildCard(card: ShopCardVM, index: number): HTMLDivElement {
        const root = el('div', {
            class: `shop-card shop-card--${card.def.rarity}${card.affordable ? '' : ' shop-card--poor'}`,
        });
        root.style.setProperty('--accent', RARITY_COLOR[card.def.rarity]);
        root.append(
            el('div', { class: 'shop-card__kind', text: `${card.def.rarity} · ${SLOT_LABEL[card.def.slot]}` }),
            el('div', { class: 'shop-card__emblem', text: card.def.glyph }),
            el('div', { class: 'shop-card__name', text: card.def.name }),
        );
        for (const line of card.statLines) {
            root.appendChild(el('div', { class: 'shop-card__stat', text: line }));
        }
        if (card.effectText) {
            root.appendChild(el('div', { class: 'shop-card__effect', text: card.effectText }));
        }
        if (card.setProgress) {
            root.appendChild(el('div', { class: 'shop-card__set', text: card.setProgress }));
        }
        if (card.replaces) {
            root.appendChild(el('div', {
                class: 'shop-card__replaces',
                text: `Replaces ${card.replaces} (+${card.sellCredit}g back)`,
            }));
        }
        root.appendChild(el('div', { class: 'shop-card__flavor', text: card.def.flavor }));
        root.appendChild(el('div', { class: 'shop-card__price', text: `🪙 ${card.price}` }));
        root.classList.add('interactive');
        onTap(root, () => this.callbacks?.onBuy(index));
        return root;
    }

    /** Close without firing onClosed (internal re-show). */
    private closeSilently(): void {
        this.modal?.dispose();
        this.modal = null;
        this.quipEl = null;
        this.goldEl = null;
    }

    public close(): void {
        if (!this.modal) return;
        this.closeSilently();
        const cb = this.callbacks;
        this.callbacks = null;
        cb?.onClosed();
    }

    public isOpen(): boolean {
        return this.modal !== null;
    }
}
```

**Implementer notes:** check `makeButton`'s return type and option names in `src/ui/primitives/Button.ts` and adapt (`label` updates may need a setter rather than `textContent`). Verify `el()`'s attr API for `dataset` (use `attrs: { 'data-role': 'grid' }` if needed). The export `EQUIP_SLOTS` is imported but only needed if you choose to render empty slots from it — keep imports clean.

- [ ] **Step 9.3: Add shop CSS to `components.css`** — match the file's existing custom-property / frame conventions; the intent:

```css
/* ── Shop overlay ──────────────────────────────────────────── */
.shop-panel { max-width: 880px; width: min(92vw, 880px); }
.shop-header { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 10px; }
.shop-quip { font-style: italic; opacity: 0.85; font-size: 14px; }
.shop-gold { font-weight: 700; color: #ffd84a; font-size: 16px; white-space: nowrap; }

.shop-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}
.shop-card {
  position: relative;
  border: 1px solid var(--accent, #555);
  border-radius: 8px;
  padding: 10px 10px 30px;
  background: rgba(10, 10, 16, 0.85);
  cursor: pointer;
  transition: transform 0.08s ease, box-shadow 0.08s ease;
}
.shop-card:hover { transform: translateY(-2px); box-shadow: 0 0 14px color-mix(in srgb, var(--accent) 40%, transparent); }
.shop-card--poor { opacity: 0.55; filter: saturate(0.6); }
.shop-card--poor .shop-card__price { color: #ff5050; }
.shop-card__kind { font-size: 10px; text-transform: uppercase; letter-spacing: 0.1em; color: var(--accent); }
.shop-card__emblem { font-size: 26px; line-height: 1.4; }
.shop-card__name { font-weight: 700; font-size: 14px; margin-bottom: 4px; }
.shop-card__stat { font-size: 12px; color: #b8e6b8; }
.shop-card__effect { font-size: 12px; color: #ffd84a; margin-top: 3px; }
.shop-card__set { font-size: 11px; color: var(--accent); margin-top: 3px; }
.shop-card__replaces { font-size: 11px; color: #9aa0a8; margin-top: 3px; }
.shop-card__flavor { font-size: 11px; font-style: italic; opacity: 0.6; margin-top: 5px; }
.shop-card__price { position: absolute; bottom: 8px; right: 10px; font-weight: 700; color: #ffd84a; }

.shop-equip { display: grid; grid-template-columns: repeat(6, 1fr); gap: 6px; margin: 12px 0; }
.shop-equip__cell { text-align: center; border: 1px solid var(--accent, #333); border-radius: 6px; padding: 6px 2px; }
.shop-equip__cell--empty { opacity: 0.45; }
.shop-equip__glyph { font-size: 18px; }
.shop-equip__slot { font-size: 9px; text-transform: uppercase; letter-spacing: 0.08em; opacity: 0.7; }
.shop-equip__name { font-size: 10px; }

.shop-footer { display: flex; justify-content: space-between; gap: 10px; }
.shop-reroll--poor { opacity: 0.5; pointer-events: none; }

/* Mobile: 2-column grid, tighter paddings */
@media (max-width: 700px) {
  .shop-grid { grid-template-columns: repeat(2, 1fr); }
  .shop-equip { grid-template-columns: repeat(3, 1fr); }
}
```

- [ ] **Step 9.4: Type-check + commit**

Run: `npx tsc --noEmit` — expect clean.

```bash
git add src/survivors/shop/GribbleBarks.ts src/ui/overlays/ShopOverlay.ts src/ui/styles/components.css
git commit -m "feat(shop): Gribble bark lines + DOM shop overlay with rarity cards and equipment strip"
```

### Task 10: MerchantStand (GLB world entity)

**Files:**
- Create: `src/survivors/shop/MerchantStand.ts`

**Assets:** `assets/travelling_merchants_mobile_shop.glb` (cart, 1.3 MB) and `assets/goblin_a_traveling_merchant.glb` (goblin, 2.3 MB). Known gotchas that apply (from project memory): FBX-pack pivots can be off-origin → compute bounding box and re-center; cloned GLB skeletons leak a bone-matrix RawTexture unless `inst.skeletons` are disposed; cloned animation groups must be stopped+disposed; instantiate with `cloneMaterials` **false** (the merchant never flash-hits, so shared materials are safe and leak-free).

- [ ] **Step 10.1: Create `src/survivors/shop/MerchantStand.ts`**

```typescript
import {
    AbstractMesh, AnimationGroup, AssetContainer, LoadAssetContainerAsync,
    Scene, Skeleton, TransformNode, Vector3,
} from '@babylonjs/core';
import { pickBark, BarkCategory } from './GribbleBarks';

const CART_URL = 'assets/travelling_merchants_mobile_shop.glb';
const GOBLIN_URL = 'assets/goblin_a_traveling_merchant.glb';
const CART_HEIGHT = 3.2;     // world units the cart is normalised to
const GOBLIN_HEIGHT = 1.5;   // goblin stands hero-ish height
/** Hero within this range opens the shop… */
export const SHOP_OPEN_RANGE = 4;
/** …and must leave this range before it can re-open (hysteresis). */
export const SHOP_REOPEN_RANGE = 6;
/** Seconds of "setting up" before the shop becomes interactive. */
export const SHOP_SETUP_SECONDS = 5;

// Module-level container cache (PropField/_glbAssets pattern): load once per
// session, instantiate per spawn.
const _containers: Record<string, AssetContainer> = {};
const _pending: Record<string, Promise<AssetContainer> | undefined> = {};

async function loadContainer(scene: Scene, url: string): Promise<AssetContainer> {
    if (_containers[url]) return _containers[url];
    if (!_pending[url]) {
        _pending[url] = LoadAssetContainerAsync(url, scene)
            .then(c => { _containers[url] = c; return c; })
            .catch(err => { delete _pending[url]; throw err; });
    }
    return _pending[url]!;
}

type StandState = 'none' | 'arriving' | 'open' | 'departing';

/** The traveling merchant: cart + goblin GLBs spawned near the hero after a
 *  wave clear. Owns its instantiated meshes/anim-groups/skeletons and a DOM
 *  speech bubble; everything is released in despawn()/dispose(). */
export class MerchantStand {
    private state: StandState = 'none';
    private root: TransformNode | null = null;
    private instancedMeshes: AbstractMesh[] = [];
    private animGroups: AnimationGroup[] = [];
    private skeletons: Skeleton[] = [];
    private bubble: HTMLDivElement | null = null;
    private bubbleTimer = 0;
    private departTimer = 0;
    private disposed = false;

    constructor(
        private scene: Scene,
        /** DOM layer for the speech bubble (gameUI fx layer). */
        private bubbleParent: HTMLElement,
    ) {}

    public getState(): StandState { return this.state; }
    public isInteractive(): boolean { return this.state === 'open'; }

    public position(): Vector3 | null {
        return this.root ? this.root.position : null;
    }

    /** Spawn cart+goblin at (x, z). Async (GLB load on first call); the stand
     *  is 'arriving' immediately so game logic can run its 5s setup timer. */
    public spawn(x: number, z: number): void {
        if (this.state !== 'none') return;
        this.state = 'arriving';
        void this.build(x, z);
    }

    private async build(x: number, z: number): Promise<void> {
        let cart: AssetContainer, goblin: AssetContainer;
        try {
            [cart, goblin] = await Promise.all([
                loadContainer(this.scene, CART_URL),
                loadContainer(this.scene, GOBLIN_URL),
            ]);
        } catch (err) {
            console.error('[merchant] GLB load failed — merchant stays away:', err);
            this.state = 'none';
            return;
        }
        if (this.disposed || this.state !== 'arriving') return;

        this.root = new TransformNode('merchant_root', this.scene);
        this.root.position.set(x, 0, z);

        this.instantiate(cart, 'merchant_cart', CART_HEIGHT, new Vector3(0, 0, 0));
        this.instantiate(goblin, 'merchant_goblin', GOBLIN_HEIGHT, new Vector3(1.6, 0, 0.6));

        // Play the goblin's idle animation if the GLB has one.
        const idle = this.animGroups.find(g => /idle/i.test(g.name)) ?? this.animGroups[0];
        idle?.start(true);
    }

    /** Instantiate a container under root, normalised to `targetHeight` with
     *  its bounding-box bottom-center re-seated on the ground at `offset`. */
    private instantiate(container: AssetContainer, prefix: string, targetHeight: number, offset: Vector3): void {
        const inst = container.instantiateModelsToScene(name => `${prefix}_${name}`, false);
        this.animGroups.push(...inst.animationGroups);
        this.skeletons.push(...inst.skeletons);
        for (const node of inst.rootNodes) {
            node.parent = this.root;
            // Measure: merge child bounding boxes in WORLD space at unit scale.
            let min = new Vector3(Infinity, Infinity, Infinity);
            let max = new Vector3(-Infinity, -Infinity, -Infinity);
            for (const m of node.getChildMeshes()) {
                this.instancedMeshes.push(m);
                m.isPickable = false;
                const bb = m.getBoundingInfo().boundingBox;
                min = Vector3.Minimize(min, bb.minimumWorld);
                max = Vector3.Maximize(max, bb.maximumWorld);
            }
            const height = Math.max(0.001, max.y - min.y);
            const scale = targetHeight / height;
            node.scaling.scaleInPlace(scale);
            // Re-center: pivot may be off-origin (FBX gotcha) — sit the box's
            // bottom-center on the ground at `offset`.
            const cx = (min.x + max.x) / 2;
            const cz = (min.z + max.z) / 2;
            node.position = new Vector3(
                offset.x - cx * scale,
                offset.y - min.y * scale,
                offset.z - cz * scale,
            );
        }
    }

    /** The 5s setup finished — shop is open for business. */
    public setOpen(): void {
        if (this.state !== 'arriving') return;
        this.state = 'open';
        this.bark('arrive');
    }

    public bark(category: BarkCategory): void {
        if (!this.bubble) {
            this.bubble = document.createElement('div');
            this.bubble.className = 'merchant-bubble';
            this.bubbleParent.appendChild(this.bubble);
        }
        this.bubble.textContent = pickBark(category);
        this.bubble.style.opacity = '1';
        this.bubbleTimer = 3.5;
    }

    public heroInRange(heroPos: Vector3, range: number): boolean {
        if (!this.root) return false;
        const dx = heroPos.x - this.root.position.x;
        const dz = heroPos.z - this.root.position.z;
        return dx * dx + dz * dz <= range * range;
    }

    /** Pack up and leave: brief shrink, then despawn. */
    public depart(): void {
        if (this.state === 'none' || this.state === 'departing') {
            if (this.state === 'none') return;
        }
        this.state = 'departing';
        this.departTimer = 0.4;
        this.bark('leave');
    }

    /** Per-frame: bubble projection + fade, depart shrink. */
    public update(dt: number): void {
        if (this.bubble && this.bubbleTimer > 0) {
            this.bubbleTimer -= dt;
            if (this.bubbleTimer <= 0.5) this.bubble.style.opacity = `${Math.max(0, this.bubbleTimer * 2)}`;
            if (this.root) {
                // Project the goblin's head position to screen space.
                const engine = this.scene.getEngine();
                const cam = this.scene.activeCamera;
                if (cam) {
                    const p = Vector3.Project(
                        this.root.position.add(new Vector3(1.6, GOBLIN_HEIGHT + 0.6, 0.6)),
                        undefined as any, // identity world matrix — see implementer note
                        this.scene.getTransformMatrix(),
                        cam.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight()),
                    );
                    this.bubble.style.left = `${p.x}px`;
                    this.bubble.style.top = `${p.y}px`;
                }
            }
        }
        if (this.state === 'departing' && this.root) {
            this.departTimer -= dt;
            const f = Math.max(0, this.departTimer / 0.4);
            this.root.scaling.set(f, f, f);
            if (this.departTimer <= 0) this.despawn();
        }
    }

    /** Release everything created by spawn(); cached containers stay for reuse. */
    public despawn(): void {
        for (const g of this.animGroups) { g.stop(); g.dispose(); }
        this.animGroups = [];
        for (const s of this.skeletons) s.dispose();
        this.skeletons = [];
        for (const m of this.instancedMeshes) m.dispose(false, false);
        this.instancedMeshes = [];
        this.root?.dispose();
        this.root = null;
        this.bubble?.remove();
        this.bubble = null;
        this.state = 'none';
    }

    public dispose(): void {
        this.disposed = true;
        this.despawn();
    }
}
```

**Implementer notes:**
- `Vector3.Project`'s second arg is the world matrix — use `Matrix.IdentityReadOnly` (import `Matrix`), not `undefined`. Look at how `OffscreenEnemyIndicators` (`src/survivors/ui/OffscreenEnemyIndicators.ts`) projects world→screen and copy its exact call — it already solves this.
- Materials are container-owned (`cloneMaterials=false`) — meshes dispose with `(false, false)` and the container keeps its materials for the next spawn. The resource watchdog should stay flat across waves; if `[resource-watchdog]` names `merchant_`, the instantiate/dispose pairing is wrong.
- After implementing, verify bounding-box measurement happens AFTER `computeWorldMatrix` — call `node.computeWorldMatrix(true)` and `m.computeWorldMatrix(true)` before reading `boundingBox.minimumWorld`, or the values are stale.
- Add the bubble CSS to `components.css`:

```css
/* ── Merchant speech bubble ────────────────────────────────── */
.merchant-bubble {
  position: absolute;
  transform: translate(-50%, -100%);
  max-width: 240px;
  padding: 8px 12px;
  border-radius: 10px;
  background: rgba(14, 12, 8, 0.92);
  border: 1px solid #c89b3c;
  color: #ffe9b0;
  font-size: 13px;
  font-style: italic;
  pointer-events: none;
  transition: opacity 0.2s ease;
  z-index: 5;
}
.merchant-bubble::after {
  content: '';
  position: absolute;
  left: 50%;
  bottom: -6px;
  transform: translateX(-50%);
  border: 6px solid transparent;
  border-top-color: #c89b3c;
  border-bottom: none;
}
```

- [ ] **Step 10.2: Type-check + commit**

Run: `npx tsc --noEmit` — expect clean.

```bash
git add src/survivors/shop/MerchantStand.ts src/ui/styles/components.css
git commit -m "feat(shop): merchant stand world entity — cached GLB cart+goblin, barks, proximity, depart"
```

---

### Task 11: SurvivorsGameplayState wiring

**Files:**
- Modify: `src/survivors/SurvivorsGameplayState.ts`

This is integration-only — no new logic beyond glue. Anchors are given as `symbol (line ~N)`; line numbers may have drifted, grep the symbol. **Single-player-first rule: every hook below is built only when `solo` is true** (`const solo = !this.coopSession;` — verify the actual field name for an active co-op session, grep `coopSession` / `CoopSession` in the file; if co-op state is expressed differently, use whatever condition the wave-clear handler already uses to distinguish host/guest and require "not co-op at all"). In co-op the run behaves exactly as today (old breather, no merchant, no equipment).

- [ ] **Step 11.1: Fields + imports**

Add imports:

```typescript
import { Equipment, priceFor, sellValueOf } from './items/Equipment';
import { foldEquipmentStats, newEquipFoldTracker, EquipFoldTracker } from './items/foldEquipmentStats';
import { ITEM_CATALOG, ITEM_SETS, setById } from './items/ItemCatalog';
import { ItemDef, ItemStatMods } from './items/ItemTypes';
import { ItemEffectRuntime, RICOCHET_RANGE } from './items/ItemEffectRuntime';
import { RageGlow, spawnExpandingRing, spawnTrail } from './items/ItemFx';
import { rollStock, rerollCost } from './shop/ShopStock';
import { MerchantStand, SHOP_OPEN_RANGE, SHOP_REOPEN_RANGE, SHOP_SETUP_SECONDS } from './shop/MerchantStand';
import { ShopOverlay, ShopVM, ShopCardVM } from '../ui/overlays/ShopOverlay';
import { pickBark } from './shop/GribbleBarks';
import { StatusEffect } from './GameTypes';
```

Add fields near `powerChoice` (line ~502):

```typescript
    // ── Itemization & merchant shop (single-player only; null in co-op) ─────
    private equipment: Equipment | null = null;
    private equipTracker: EquipFoldTracker = newEquipFoldTracker();
    private itemEffects: ItemEffectRuntime | null = null;
    private rageGlow: RageGlow | null = null;
    private shopOverlay: ShopOverlay | null = null;
    private merchantStand: MerchantStand | null = null;
    private shopPhase: 'none' | 'arriving' | 'open' = 'none';
    private shopSetupRemaining = 0;
    private shopHysteresis = false;   // hero must leave SHOP_REOPEN_RANGE before reopening
    private currentStock: ItemDef[] = [];
    private rerollsThisVisit = 0;
    private equipMaxHpApplied = 0;
```

- [ ] **Step 11.2: Construct in `startRun` (after `playerStats`, `heroController`, `powerSlots` exist; near the Hud construction at line ~1132)**

```typescript
        // ── Itemization + merchant shop (single-player only) ────────────────
        if (solo) {
            this.equipment = new Equipment(this.playerStats);
            this.equipTracker = newEquipFoldTracker();
            this.rageGlow = new RageGlow(this.game.scene, () => this.hero?.getPosition() ?? null);
            this.itemEffects = new ItemEffectRuntime(this.buildEffectContext());
            this.shopOverlay = new ShopOverlay(this.gameUI!.layer('overlay'));
            this.merchantStand = new MerchantStand(this.game.scene, this.gameUI!.layer('fx'));
            this.hud?.setOnHorn(() => this.soundHorn());
        }
```

(Define `solo` once near the top of `startRun` per the task preamble. `this.game.scene` / `this.hero` — match the file's actual accessors; the state has both, grep `this.game.scene` and `this.hero` for usage.)

- [ ] **Step 11.3: Implement `buildEffectContext()` + FX (new private methods, near the XP section ~line 3508)**

```typescript
    /** World adapter handed to ItemEffectRuntime. All damage goes through
     *  Enemy.takeDamage with an element so damage numbers colour correctly. */
    private buildEffectContext(): import('./items/ItemEffectRuntime').EffectContext {
        return {
            heroPos: () => {
                const p = this.hero?.getPosition();
                return p ? { x: p.x, z: p.z } : { x: 0, z: 0 };
            },
            heroHpFraction: () => {
                const hc = this.heroController;
                if (!hc) return 1;
                const { current, max } = hc.getHealth();
                return max > 0 ? current / max : 1;
            },
            enemiesNear: (x, z, radius) => {
                const out: import('./items/ItemEffectRuntime').EffectEnemy[] = [];
                const rSq = radius * radius;
                for (const e of this.enemyManager?.getEnemies() ?? []) {
                    if (!e.isAlive()) continue;
                    const p = e.getPosition();
                    const dx = p.x - x, dz = p.z - z;
                    if (dx * dx + dz * dz <= rSq) out.push(e);
                }
                return out;
            },
            damage: (e, amount, element) =>
                (e as import('./enemies/Enemy').Enemy).takeDamage(amount, element as any),
            stun: (e, seconds) =>
                (e as import('./enemies/Enemy').Enemy).applyStatusEffect(StatusEffect.STUNNED, seconds, 1),
            burn: (e, seconds, strength) =>
                (e as import('./enemies/Enemy').Enemy).applyStatusEffect(StatusEffect.BURNING, seconds, strength),
            addGold: (amount) => this.playerStats?.addGold(amount),
            refundCooldownPct: (fraction) => {
                for (const slot of this.powerSlots?.getSlots() ?? []) {
                    if (slot) slot.state.cooldownRemaining *= 1 - fraction;
                }
            },
            recastFree: () => { this.powerSlots?.recastFree(); },
            wave: () => this.waveManager?.getCurrentWave() ?? 1,
            rng: Math.random,
            critChance: () => this.playerStats?.critChance ?? 0,
            fx: {
                rageGlow: (on) => this.rageGlow?.setActive(on),
                coinNova: (x, z) => spawnExpandingRing(this.game.scene, x, z, '#ffd84a', 6),
                shockwave: (x, z, radius) => spawnExpandingRing(this.game.scene, x, z, '#e0e0e0', radius),
                ricochet: (fx, fz, tx, tz) => spawnTrail(this.game.scene, fx, fz, tx, tz, '#60ff90'),
                echoShimmer: () => {
                    const p = this.hero?.getPosition();
                    if (p) spawnExpandingRing(this.game.scene, p.x, p.z, '#b050ff', 3, 0.3);
                },
            },
        };
    }
```

(Adapt the small API mismatches by reading the real signatures: `heroController.getHealth()` shape — the Hud update call at line ~3121 shows it returns `{ current, max }`; `enemyManager.getEnemies()` — grep for the actual list accessor.)

- [ ] **Step 11.4: Hook the combat events (same wiring block as Step 11.2, after construction)**

```typescript
        if (solo && this.itemEffects) {
            this.heroController.setOnHurt((amount) => this.itemEffects?.onHeroHurt(amount));
            // Basic-attack hits — heroController owns the HeroBasicAttack:
            this.heroController.getBasicAttack()?.setOnHit((enemy, dmg) =>
                this.itemEffects?.onBasicHit(enemy, dmg));
        }
```

(`getBasicAttack()` — find how the state reaches the `ba` object at line ~1878 (`ba.damageRouter = …`) and reuse that exact accessor.)

Extend the existing `setOnCast` at line ~949 — append inside its callback:

```typescript
            this.itemEffects?.onPowerCast();
```

Extend the existing `setXpSink` lambda at line ~785:

```typescript
        this.playerStats.setXpSink((amount) => {
            this.awardXp(amount);
            this.itemEffects?.onGoldEarned(amount);
        });
```

Fold effect damage into the basic-attack provider at line ~983:

```typescript
        this.heroController.setDamageMultiplierProvider(
            () => (this.playerStats?.powerDamageMultiplier ?? 1.0)
                * (this.playerStats?.basicDamageMultiplier ?? 1.0)
                * (this.itemEffects?.damageBonusMult() ?? 1.0)
                * this.runPerks.damageMultiplier,
        );
```

- [ ] **Step 11.5: Fold equipment into `applyLevelBonuses()` (line ~3527)**

At the END of the assignment block (after `ps.critDamageMultiplier = …`, BEFORE the max-HP delta + re-push section), add:

```typescript
        // Equipment: fold aggregates on top of the level assignments. Order
        // matters — fold AFTER the assignments, BEFORE the re-push below.
        if (this.equipment) {
            const agg = this.equipment.aggregates();
            foldEquipmentStats(ps, agg, this.equipTracker);
            // Equipment max-HP as a hero-controller delta (mirrors appliedMaxHpBonus):
            const hpDelta = agg.maxHealth - this.equipMaxHpApplied;
            if (hpDelta !== 0 && this.heroController) {
                this.heroController.addMaxHealth(hpDelta);
                if (hpDelta > 0) this.heroController.heal(hpDelta);
                this.equipMaxHpApplied = agg.maxHealth;
            }
            this.itemEffects?.setActiveEffects(agg.effects);
        }
```

- [ ] **Step 11.6: Wave-clear → merchant spawn (the `setOnWaveCleared` callback, line ~1029-1054)**

The callback currently ends with (line ~1053):

```typescript
            if (this.testMode) { this.waveManager?.startNextWave(); return; }
            this.waveBreatherRemaining = SurvivorsGameplayState.WAVE_BREATHER_SECONDS;
```

Replace with:

```typescript
            if (this.testMode) { this.waveManager?.startNextWave(); return; }
            if (solo && this.merchantStand) {
                // Merchant phase replaces the auto-breather: Gribble rolls in
                // near the hero; the wave waits for "To battle!" / the horn.
                const heroPos = this.hero?.getPosition();
                const angle = Math.random() * Math.PI * 2;
                const mx = (heroPos?.x ?? 0) + Math.cos(angle) * 8;
                const mz = (heroPos?.z ?? 0) + Math.sin(angle) * 8;
                this.merchantStand.spawn(mx, mz);
                spawnExpandingRing(this.game.scene, mx, mz, '#c89b3c', 3);
                this.shopPhase = 'arriving';
                this.shopSetupRemaining = SHOP_SETUP_SECONDS;
                this.currentStock = [];
                this.rerollsThisVisit = 0;
                this.hud?.setHornVisible(true);
            } else {
                this.waveBreatherRemaining = SurvivorsGameplayState.WAVE_BREATHER_SECONDS;
            }
```

(`solo` must be visible in this callback — compute it inside the callback from the same condition as Step 11.2 rather than capturing a stale value.)

- [ ] **Step 11.7: Shop phase in the update loop (next to the breather countdown, line ~2856)**

After the existing `waveBreatherRemaining` block, add:

```typescript
        // ── Merchant/shopping phase (single-player only) ────────────────────
        if (this.shopPhase !== 'none' && this.merchantStand) {
            this.merchantStand.update(deltaTime);
            if (this.shopPhase === 'arriving') {
                this.shopSetupRemaining -= deltaTime;
                if (this.shopSetupRemaining <= 0) {
                    this.merchantStand.setOpen();
                    this.shopPhase = 'open';
                }
            } else if (this.shopPhase === 'open' && !this.shopOverlay?.isOpen()) {
                const heroPos = this.hero?.getPosition();
                if (heroPos) {
                    if (this.shopHysteresis) {
                        if (!this.merchantStand.heroInRange(heroPos, SHOP_REOPEN_RANGE)) {
                            this.shopHysteresis = false;
                        }
                    } else if (this.merchantStand.heroInRange(heroPos, SHOP_OPEN_RANGE)) {
                        this.openShop();
                    }
                }
            }
        }
        this.rageGlow?.update();
        // Equipment HP regen (Troll-Hide Vest):
        const regen = this.playerStats?.hpRegenPctPerSec ?? 0;
        if (regen > 0 && this.heroController) {
            this.heroController.heal(this.heroController.getMaxHealth() * regen * deltaTime);
        }
        this.itemEffects?.tick(deltaTime);
```

**Placement matters:** this must run on frames where gameplay runs (i.e., below the `isPausedForOverlay()` early-return so the setup timer freezes while the shop UI is open — that's correct and intended), and on the non-guest path. Read the surrounding block and place it with the other once-per-frame solo systems.

- [ ] **Step 11.8: `openShop()` / `soundHorn()` / VM builder (new private methods)**

```typescript
    private openShop(): void {
        if (!this.equipment || !this.shopOverlay || !this.playerStats) return;
        if (this.currentStock.length === 0) this.rollShopStock();
        this.shopOverlay.show(this.buildShopVM(pickBark('browse')), {
            onBuy: (index) => this.handleShopBuy(index),
            onReroll: () => this.handleShopReroll(),
            onBattle: () => { this.shopOverlay?.close(); this.endShoppingPhase(); },
            onClosed: () => { this.shopHysteresis = true; },
        });
    }

    private rollShopStock(): void {
        if (!this.equipment) return;
        const agg = this.equipment.aggregates();
        this.currentStock = rollStock(ITEM_CATALOG, {
            champion: this.championType!,           // grep the field that stores the picked champion
            wave: this.waveManager?.getCurrentWave() ?? 1,
            ownedIds: this.equipment.ownedIds(),
            setCounts: agg.setCounts,
            rng: Math.random,
        });
    }

    private buildShopVM(quip: string): ShopVM {
        const eq = this.equipment!;
        const ps = this.playerStats!;
        const wave = this.waveManager?.getCurrentWave() ?? 1;
        const cards: ShopCardVM[] = this.currentStock.map(def => {
            const price = priceFor(def, wave);
            const old = eq.get(def.slot);
            const credit = old ? sellValueOf(old.pricePaid) : 0;
            return {
                def, price,
                affordable: ps.getGold() + credit >= price,
                replaces: old?.def.name ?? null,
                sellCredit: credit,
                setProgress: def.setId
                    ? `${setById(def.setId)!.name} ${eq.setCount(def.setId)}/3`
                    : null,
                statLines: describeMods(def.mods),
                effectText: def.effectId
                    ? (def.setId ? null : EFFECT_TEXT[def.effectId])
                    : (def.setId ? setById(def.setId)!.bonus3Text : null),
            };
        });
        return {
            gold: ps.getGold(),
            cards,
            equipment: (['weapon', 'helmet', 'chest', 'legs', 'boots', 'trinket'] as const).map(slot => {
                const item = eq.get(slot);
                return {
                    slot,
                    name: item?.def.name ?? null,
                    glyph: item?.def.glyph ?? null,
                    rarity: item?.def.rarity ?? null,
                };
            }),
            rerollCost: rerollCost(this.rerollsThisVisit),
            rerollAffordable: ps.getGold() >= rerollCost(this.rerollsThisVisit),
            quip,
        };
    }

    private handleShopBuy(index: number): void {
        const def = this.currentStock[index];
        if (!def || !this.equipment || !this.playerStats) return;
        const wave = this.waveManager?.getCurrentWave() ?? 1;
        if (!this.equipment.buy(def, wave)) {
            this.merchantStand?.bark('poor');
            this.shopOverlay?.refresh(this.buildShopVM(pickBark('poor')));
            return;
        }
        this.currentStock.splice(index, 1);
        this.applyLevelBonuses();   // recompute: level + equipment fold + effects
        this.shopOverlay?.refresh(this.buildShopVM(pickBark('buy')));
    }

    private handleShopReroll(): void {
        const cost = rerollCost(this.rerollsThisVisit);
        if (!this.playerStats?.spendGold(cost)) {
            this.shopOverlay?.refresh(this.buildShopVM(pickBark('poor')));
            return;
        }
        this.rerollsThisVisit++;
        this.rollShopStock();
        this.shopOverlay?.refresh(this.buildShopVM(pickBark('reroll')));
    }

    /** Horn pressed or "To battle!": merchant leaves, short countdown, next wave. */
    private endShoppingPhase(): void {
        if (this.shopPhase === 'none') return;
        this.shopPhase = 'none';
        this.shopHysteresis = false;
        this.merchantStand?.depart();
        this.hud?.setHornVisible(false);
        this.waveBreatherRemaining = 3;
    }

    private soundHorn(): void {
        if (this.shopOverlay?.isOpen()) this.shopOverlay.close();
        this.endShoppingPhase();
    }
```

And a module-level helper + effect-text map (bottom of the file or a small `src/survivors/items/describeMods.ts` — implementer's choice; keep `EFFECT_TEXT` next to it):

```typescript
const EFFECT_TEXT: Record<string, string> = {
    shockwave: 'Every 6th hit: ground slam — AoE damage + 1s stun',
    critExplode: 'Crits explode for 50% AoE damage',
    burnOnHit: 'Basic attacks set enemies on fire',
    thorns: 'Reflects 3× contact damage to nearby enemies',
    chrono: 'When hit: refund 10% of power cooldowns',
    rage: 'RAGE: below 50% HP → +60% basic damage',
    ricochet: 'Arrows bounce to a nearby enemy at 60% damage',
    echo: '25% chance powers recast free',
    midas: '15% double gold; coin novas every 150g',
};

function describeMods(mods: ItemStatMods): string[] {
    const out: string[] = [];
    if (mods.basicDamagePct) out.push(`+${mods.basicDamagePct}% basic damage`);
    if (mods.powerDamagePct) out.push(`+${mods.powerDamagePct}% power damage`);
    if (mods.attackSpeedPct) out.push(`+${mods.attackSpeedPct}% attack speed`);
    if (mods.moveSpeedPct) out.push(`+${mods.moveSpeedPct}% move speed`);
    if (mods.cooldownPct) out.push(`−${mods.cooldownPct}% power cooldowns`);
    if (mods.damageTakenPct) out.push(`−${mods.damageTakenPct}% damage taken`);
    if (mods.goldGainPct) out.push(`+${mods.goldGainPct}% gold from kills`);
    if (mods.critChance) out.push(`+${Math.round(mods.critChance * 100)}% crit chance`);
    if (mods.critDamage) out.push(`+${mods.critDamage.toFixed(2)} crit damage`);
    if (mods.lifesteal) out.push(`+${Math.round(mods.lifesteal * 100)}% lifesteal`);
    if (mods.maxHealth) out.push(`+${mods.maxHealth} max HP`);
    if (mods.hpRegenPctPerSec) out.push(`Regenerate ${(mods.hpRegenPctPerSec * 100).toFixed(1)}% max HP/s`);
    if (mods.knockback) out.push(`+${mods.knockback} knockback`);
    return out;
}
```

- [ ] **Step 11.9: Pause + HUD gold + exit cleanup**

`isPausedForOverlay()` (line ~3169) — add to the expression:

```typescript
            this.shopOverlay?.isOpen() ||
```

Next to the `hud.update(...)` call (line ~3120), add:

```typescript
            this.hud.setGold(this.playerStats.getGold());
```

In `exit()` (line ~2494, near the powerChoice cleanup at ~2522):

```typescript
        this.shopOverlay?.close();
        this.shopOverlay = null;
        this.merchantStand?.dispose();
        this.merchantStand = null;
        this.itemEffects?.reset();
        this.itemEffects = null;
        this.rageGlow?.dispose();
        this.rageGlow = null;
        this.equipment = null;
        this.equipTracker = newEquipFoldTracker();
        this.shopPhase = 'none';
        this.shopHysteresis = false;
        this.currentStock = [];
        this.rerollsThisVisit = 0;
        this.equipMaxHpApplied = 0;
```

**Careful:** `shopOverlay.close()` fires `onClosed` → sets `shopHysteresis` — harmless here, but `endShoppingPhase` must NOT be called from exit (no wave scheduling during teardown). The `close()` path above only fires `onClosed`, which is fine.

- [ ] **Step 11.10: Type-check, full test suite, manual smoke**

Run: `npx tsc --noEmit && npx vitest run`
Expected: clean compile, all ~330+ tests green.

Manual smoke (use the project's headless recipe — see memory `headless_verify_fusion_td`: Playwright needs `--use-angle=metal`; click "Begin the Hunt", `?test` auto-picks):
1. `npm start`, play wave 1 → on clear, Gribble + cart appear ~8u away with a gold ring puff; horn button appears.
2. After 5s, "OPEN" bark bubble appears; walk into range → game freezes, shop UI opens with 6 class-correct cards.
3. Buy a stat item → gold pill drops, stats change (e.g. move speed visibly faster after Sprintweave Boots); buy into an occupied slot → credit applied.
4. Reroll → new stock, cost escalates 25/50/75.
5. "To battle!" → shop closes, merchant shrinks away, 3s later wave 2 starts.
6. Walk away instead (Leave) → unpaused, walk back → reopens only after leaving 6u (hysteresis).
7. Horn without visiting → merchant departs, wave starts.
8. Die and restart run → equipment/gold pill reset; `[resource-watchdog]` stays quiet across several waves.
9. Co-op dev flow (`?host` / `?join`): NO merchant appears, waves auto-start with the old 2s breather.

- [ ] **Step 11.11: Commit**

```bash
git add src/survivors/SurvivorsGameplayState.ts
git commit -m "feat(shop): wire merchant phase, shop overlay, equipment fold + item effects into the game loop"
```

---

### Task 12: Final verification

- [ ] **Step 12.1: Full gate**

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: all green, production build succeeds.

- [ ] **Step 12.2: Resource-leak check**

Play 5+ waves with shop visits and item effects firing (buy Emberwand/Thornmail early). Watch the console: no `[resource-watchdog] LEAK SUSPECTED` lines; `itemfx_`/`merchant_` material buckets stay bounded.

- [ ] **Step 12.3: Balance sanity pass**

Confirm gold flow supports the economy: with starting 300g and wave rewards, a player should afford ~1 common after wave 1-2 and a rare by wave 4-5. If kills feel too poor, tune `RARITY_BASE_PRICE` (single source) — do NOT touch enemy rewards (they also feed XP).

- [ ] **Step 12.4: Use superpowers:requesting-code-review, then superpowers:finishing-a-development-branch**

---

## Self-Review Notes (already applied)

- **Spec coverage:** gold restore = visible pill + sink (Task 7/11); 6-slot inventory (Task 3); 30-item catalog + 4 sets (Task 1); pity/reroll stock (Task 4); unique effects (Task 5/6); merchant GLBs + 5s setup + proximity + hysteresis (Task 10/11); wave gating with horn fallback (Task 7/11); pause via `isPausedForOverlay` (Task 11.9); co-op = feature-off guard (Task 11 preamble); exit cleanup (Task 11.9); Vitest coverage per spec §Testing.
- **Type consistency:** `EffectContext`/`EffectFx`/`EffectEnemy` defined in Task 5 and consumed in Task 11.3; `ShopVM`/`ShopCardVM` defined in Task 9.2 and built in Task 11.8; `EquipmentAggregates.setCounts` consumed by `rollShopStock` and the VM.
- **Known intentional deviations** from spec are listed at the top of this plan (fold-vs-diff, RAGE rider, merchant near hero instead of fixed center).

