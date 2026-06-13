# Unique Sets & Mythic Weapons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two new item rarity tiers — class-locked 6-piece **unique** sets (green, 2/4/6 bonus tiers) and weapon-only **mythic** weapons (red, spectacular FX, wildcard set piece) — on top of the existing item system.

**Architecture:** Generalize the existing `SetDef` to N-piece sets with arbitrary `tiers[]` (the 4 existing 3-piece sets migrate, behavior-preserved). The mythic-as-wildcard mechanic falls out of giving each mythic weapon its class's unique `setId` — `Equipment.aggregates()` already counts pieces by `setId` regardless of rarity. Effects run through the existing Babylon-free `ItemEffectRuntime`/`EffectContext`; two new context methods (`tryExecuteBelow`, `fx.ring`/`fx.beam`) and one net-new `Champion.setMythicAura` persistent weapon-bone aura complete the wiring.

**Tech Stack:** TypeScript, BabylonJS, Vitest. Build: `npm run build`; type-check: `npx tsc --noEmit`; tests: `npm test`.

**Spec:** `docs/superpowers/specs/2026-06-13-unique-and-mythic-items-design.md` (authoritative for stat values / balance rationale).

---

## File map

| File | Responsibility | Change |
|---|---|---|
| `src/survivors/items/ItemTypes.ts` | type model | Grow `Rarity`; add `MythicFxConfig`, `ItemDef.wildcardSetPiece`/`mythicFx`; replace `SetDef` with `{pieces, tiers, kind}` + `SetTier`; add 6 `ItemEffectId`s |
| `src/survivors/items/ItemCatalog.ts` | data | Migrate 4 sets to `tiers[]`; add 3 unique sets + 18 unique items + 3 mythic weapons; mythic⇒weapon assert |
| `src/survivors/items/Equipment.ts` | aggregation | Generic tier loop (2/4/6 + classic 2/3) |
| `src/survivors/shop/ShopStock.ts` | shop rolls | New `rarityWeights` brackets w/ unique+mythic; proportional set-pity |
| `src/survivors/items/ItemEffectRuntime.ts` | effects | `EffectContext.tryExecuteBelow`; `EffectFx.ring`/`beam`; 6 new effects + tuning |
| `src/survivors/items/describeMods.ts` | shop copy | 6 new `EFFECT_TEXT` entries |
| `src/survivors/SurvivorsGameplayState.ts` | adapter + UI VMs | Implement `tryExecuteBelow`/`fx.ring`/`fx.beam`; drive `setMythicAura`; migrate `itemEffectText`/`setProgress`/`buildCharacterSets` to `tiers[]` |
| `src/survivors/champions/Champion.ts` | hero visuals | `setMythicAura(cfg|null)` persistent aura + dispose in `_releaseChampionFx` |
| `src/ui/overlays/CharacterProfile.ts` | profile UI | `CharSetVM` → generic tier list + rendering |
| `src/survivors/coop/CoopFx.ts` | co-op (Phase 9) | Replay mythic aura + new fx procs to guest |
| `tests/*.spec.ts` | tests | Update migrated assertions; add tier/wildcard/effect/pity tests |

**Glyph reassignment (spec glyphs collide with the existing 30-item catalog; `ItemCatalog.spec` enforces global glyph uniqueness). Use these 21 collision-free glyphs:**
- Titan's Oath: maul 🔨, helmet 🗿, chest 🦴, legs 🌋, boots 🦬, trinket 🫀
- Tempest Stalker: bow 🎯, helmet 🦅, chest 🪂, legs 🌬, boots 🪽, trinket 🌩
- Voidcaller's Sequence: scepter 🔱, helmet 🔯, chest 🌌, legs 🪐, boots 🕳, trinket 👁
- Mythics: Skullsplitter ☠, Windsong 🌪, Nullbrand 🌑

---

## Phase 1 — Type model + migration (build stays green)

Changing `SetDef`'s shape and growing `Rarity` cascades into every consumer; this phase reshapes the type and migrates all consumers with behavior preserved, then updates the affected existing tests. No new content yet.

### Task 1.1: Grow types in `ItemTypes.ts`

**Files:**
- Modify: `src/survivors/items/ItemTypes.ts`

- [ ] **Step 1: Edit the rarity + ItemDef + SetDef definitions.** Replace lines 6–61 (the `Rarity` block through `SetDef`) with:

```ts
export type Rarity = 'common' | 'rare' | 'epic' | 'legendary' | 'unique' | 'mythic';
export const RARITY_BASE_PRICE: Record<Rarity, number> = {
    common: 60, rare: 120, epic: 220, legendary: 400, unique: 520, mythic: 900,
};
export const RARITY_COLOR: Record<Rarity, string> = {
    common: '#9aa0a8', rare: '#3da9ff', epic: '#b050ff', legendary: '#ffb52e',
    unique: '#3ddc84', mythic: '#ff3b30',
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
    | 'shockwave' | 'critExplode' | 'burnOnHit' | 'thorns' | 'chrono'
    | 'earthbreaker' | 'tempest_volley' | 'arcane_cascade'
    | 'apex_cleave' | 'storm_quiver' | 'singularity';

/** Persistent weapon-bone FX for a mythic weapon (consumed by Champion.setMythicAura). */
export interface MythicFxConfig {
    /** Lowercase literal hex — bounded material-cache key. */
    auraColor: string;
    /** Particle preset: 'embers' | 'ribbon' | 'motes'. */
    style: 'embers' | 'ribbon' | 'motes';
    /** Lowercase literal hex for the on-hit burst. */
    onHitColor: string;
}

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
    /** Mythic weapons set this: counts toward its class unique set as the weapon piece. */
    wildcardSetPiece?: boolean;
    /** Mythic weapons only: persistent weapon-bone visual. */
    mythicFx?: MythicFxConfig;
    glyph: string;
    /** One short funny/flavor line for the shop card. */
    flavor: string;
}

/** One activation threshold of a set. `bonus` (stat slab) and/or `effect` fire at `pieces`. */
export interface SetTier {
    pieces: number;
    bonus?: ItemStatMods;
    effect?: ItemEffectId;
    text: string;
}

export interface SetDef {
    id: string;
    name: string;
    /** Item ids that compose the set (3 for classic, 6 for unique). */
    pieces: string[];
    /** Ascending by `pieces` (e.g. classic [2,3]; unique [2,4,6]). */
    tiers: SetTier[];
    kind: 'classic' | 'unique';
}
```

- [ ] **Step 2: Type-check (expect cascading errors in consumers — that's expected; later tasks fix them).**

Run: `npx tsc --noEmit 2>&1 | head -30`
Expected: errors in `ItemCatalog.ts`, `Equipment.ts`, `SurvivorsGameplayState.ts`, `CharacterProfile.ts`, `ShopStock.ts` referencing removed `bonus2`/`effect3`/`bonus2Text`/`bonus3Text` and missing `unique`/`mythic` rarity keys. (Do NOT commit yet — fixed across 1.2–1.7.)

### Task 1.2: Migrate the 4 existing sets to `tiers[]`

**Files:**
- Modify: `src/survivors/items/ItemCatalog.ts:3-32`

- [ ] **Step 1: Replace the `ITEM_SETS` array (lines 3–32) with the tiered form (kind `'classic'`).**

```ts
export const ITEM_SETS: SetDef[] = [
    {
        id: 'berserkers_wrath', name: "Berserker's Wrath", kind: 'classic',
        pieces: ['gorefang', 'skullcage_of_rage', 'bloodforged_plate'],
        tiers: [
            { pieces: 2, bonus: { attackSpeedPct: 20 }, text: '+20% attack speed' },
            { pieces: 3, effect: 'rage', text: 'RAGE: below 50% HP, +60% basic damage and a furious red glow' },
        ],
    },
    {
        id: 'windrunner', name: 'Windrunner', kind: 'classic',
        pieces: ['stormpiercer', 'galeskimmers', 'feather_of_the_zephyr'],
        tiers: [
            { pieces: 2, bonus: { moveSpeedPct: 15 }, text: '+15% move speed' },
            { pieces: 3, effect: 'ricochet', text: 'RICOCHET: arrows bounce to a nearby enemy at 60% damage' },
        ],
    },
    {
        id: 'archmages_echo', name: "Archmage's Echo", kind: 'classic',
        pieces: ['staff_of_echoes', 'mindcrown', 'runeweave_leggings'],
        tiers: [
            { pieces: 2, bonus: { cooldownPct: 10 }, text: '−10% power cooldowns' },
            { pieces: 3, effect: 'echo', text: 'ECHO: power casts have a 25% chance to instantly recast free' },
        ],
    },
    {
        id: 'goblin_fortune', name: 'Goblin Fortune', kind: 'classic',
        pieces: ['gribbles_lucky_coin', 'penny_pincher_loafers', 'greedhelm'],
        tiers: [
            { pieces: 2, bonus: { goldGainPct: 25 }, text: '+25% gold from kills' },
            { pieces: 3, effect: 'midas', text: 'MIDAS: 15% chance kills pay double; every 150g earned bursts a coin nova' },
        ],
    },
];
```

### Task 1.3: Generic tier loop in `Equipment.aggregates()`

**Files:**
- Modify: `src/survivors/items/Equipment.ts:92-96`

- [ ] **Step 1: Replace the legacy 2/3 block (lines 92–96) with a generic loop.**

```ts
        for (const set of ITEM_SETS) {
            const count = agg.setCounts[set.id] ?? 0;
            for (const tier of set.tiers) {
                if (count < tier.pieces) continue;
                if (tier.bonus) this.foldMods(agg, tier.bonus);
                if (tier.effect) agg.effects.add(tier.effect);
            }
        }
```

(No wildcard-specific code is needed: a mythic weapon's `setId` already increments `setCounts` at line 90 regardless of rarity.)

### Task 1.4: Migrate `SurvivorsGameplayState` set-text consumers

**Files:**
- Modify: `src/survivors/SurvivorsGameplayState.ts` (`itemEffectText` ~3847, `setProgress` ~3868, `buildCharacterSets` ~3952)

- [ ] **Step 1: Replace `itemEffectText` (the `def.effectId ? … : …` body, ~3847-3851) with:**

```ts
    private itemEffectText(def: ItemDef): string | null {
        // Mythic / standalone-effect items show their own effect text.
        if (def.effectId && (def.rarity === 'mythic' || !def.setId)) return EFFECT_TEXT[def.effectId];
        // Set pieces show the set's highest (signature) tier text.
        if (def.setId) {
            const set = setById(def.setId);
            if (set && set.tiers.length > 0) return set.tiers[set.tiers.length - 1].text;
        }
        return null;
    }
```

- [ ] **Step 2: Fix the hardcoded `/3` in `setProgress` (~3868).** Replace:

```ts
                setProgress: def.setId
                    ? `${setById(def.setId)!.name} ${eq.setCount(def.setId)}/${setById(def.setId)!.pieces.length}`
                    : null,
```

- [ ] **Step 3: Replace `buildCharacterSets` (~3949-3957) with the tier-list form.**

```ts
    private buildCharacterSets(): CharSetVM[] {
        const counts = this.equipment?.aggregates().setCounts ?? {};
        const out: CharSetVM[] = [];
        for (const set of ITEM_SETS) {
            const count = counts[set.id] ?? 0;
            if (count < 2) continue;
            out.push({
                name: set.name, count, total: set.pieces.length,
                tiers: set.tiers.map(t => ({ pieces: t.pieces, text: t.text, active: count >= t.pieces })),
            });
        }
        return out;
    }
```

### Task 1.5: Migrate `CharSetVM` + rendering in `CharacterProfile.ts`

**Files:**
- Modify: `src/ui/overlays/CharacterProfile.ts:22-28` (type), `:77-94` (rendering)

- [ ] **Step 1: Replace the `CharSetVM` interface (lines 22–28) with:**

```ts
/** A set the player has ≥2 pieces of. */
export interface CharSetVM {
    name: string;
    count: number;
    total: number;
    tiers: { pieces: number; text: string; active: boolean }[];
}
```

- [ ] **Step 2: Replace the set-rendering block (lines 77–94) with a generic tier loop.**

```ts
        if (vm.sets.length > 0) {
            const setsBox = el('div', { class: 'char-sets' });
            setsBox.appendChild(el('div', { class: 'char-sets__title', text: 'Set Bonuses' }));
            for (const set of vm.sets) {
                const block = el('div', { class: 'char-set' });
                block.appendChild(el('div', { class: 'char-set__name', text: `${set.name} (${set.count}/${set.total})` }));
                for (const tier of set.tiers) {
                    block.appendChild(el('div', {
                        class: `char-set__bonus${tier.active ? ' char-set__bonus--on' : ''}`,
                        text: `${tier.pieces}pc — ${tier.text}`,
                    }));
                }
                setsBox.appendChild(block);
            }
            side.appendChild(setsBox);
        }
```

### Task 1.6: Fix the stale `describeMods.ts` comment

**Files:**
- Modify: `src/survivors/items/describeMods.ts:3-4`

- [ ] **Step 1: Update the doc comment (lines 3–4) to reflect tiers.**

```ts
/** Shop-card copy for each unique item effect (non-set items show this;
 *  set pieces show their set's highest tier text instead). */
```

### Task 1.7: New `rarityWeights` brackets in `ShopStock.ts`

**Files:**
- Modify: `src/survivors/shop/ShopStock.ts:25-30`

- [ ] **Step 1: Replace `rarityWeights` (lines 25–30) with the late-gated brackets (unique ≥ wave 8, mythic ≥ wave 11).**

```ts
export function rarityWeights(wave: number): Record<Rarity, number> {
    if (wave <= 4)  return { common: 60, rare: 30, epic: 10, legendary: 0,  unique: 0,  mythic: 0 };
    if (wave <= 7)  return { common: 35, rare: 38, epic: 22, legendary: 5,  unique: 0,  mythic: 0 };
    if (wave <= 10) return { common: 18, rare: 34, epic: 30, legendary: 12, unique: 6,  mythic: 0 };
    if (wave <= 14) return { common: 8,  rare: 24, epic: 32, legendary: 18, unique: 13, mythic: 5 };
    return { common: 4, rare: 16, epic: 30, legendary: 22, unique: 20, mythic: 8 };
}
```

### Task 1.8: Update existing tests broken by the migration

**Files:**
- Modify: `tests/ItemCatalog.spec.ts:32-45`, `tests/ShopStock.spec.ts:22-32`

- [ ] **Step 1: In `ItemCatalog.spec.ts`, replace the "4 sets of exactly 3 pieces" test (lines 32–45) with a per-kind test** (classic=3 pieces, unique=6, distinct slots). Note `ITEM_CATALOG.length` and `ITEM_SETS.length` assertions move to Phase 2 (after content is added) — for now keep them as-is so this phase's commit is green only AFTER content; if running Phase 1 standalone, temporarily expect the migrated-but-not-yet-extended counts. Use:

```ts
    it('every set lists kind-appropriate pieces with distinct slots and back-references', () => {
        for (const set of ITEM_SETS) {
            const expected = set.kind === 'unique' ? 6 : 3;
            expect(set.pieces.length, `${set.id}`).toBe(expected);
            const slots = new Set<string>();
            for (const pieceId of set.pieces) {
                const piece = itemById(pieceId);
                expect(piece, `set ${set.id} piece ${pieceId} must exist`).toBeDefined();
                expect(piece!.setId).toBe(set.id);
                slots.add(piece!.slot);
            }
            expect(slots.size, `${set.id} distinct slots`).toBe(expected);
            expect(set.tiers.every((t, i) => i === 0 || t.pieces > set.tiers[i - 1].pieces),
                `${set.id} tiers ascending`).toBe(true);
        }
    });
```

- [ ] **Step 2: In `ItemCatalog.spec.ts`, update the setId-back-reference test (lines 47–54)** to exempt wildcard mythics (they carry `setId` but are not listed in `pieces`):

```ts
    it('every item setId points to an existing set; non-wildcard items are listed in it', () => {
        for (const item of ITEM_CATALOG) {
            if (!item.setId) continue;
            const set = setById(item.setId);
            expect(set).toBeDefined();
            if (!item.wildcardSetPiece) expect(set!.pieces).toContain(item.id);
        }
    });
```

- [ ] **Step 3: In `ShopStock.spec.ts`, replace the `rarityWeights` assertions (lines 22–32) for the new brackets.**

```ts
describe('rarityWeights', () => {
    it('no legendary until wave 5', () => {
        expect(rarityWeights(4).legendary).toBe(0);
        expect(rarityWeights(5).legendary).toBeGreaterThan(0);
    });
    it('no unique until wave 8, no mythic until wave 11', () => {
        expect(rarityWeights(7).unique).toBe(0);
        expect(rarityWeights(8).unique).toBeGreaterThan(0);
        expect(rarityWeights(10).mythic).toBe(0);
        expect(rarityWeights(11).mythic).toBeGreaterThan(0);
    });
    it('rarer tiers grow with wave', () => {
        expect(rarityWeights(15).unique).toBeGreaterThan(rarityWeights(9).unique);
    });
});
```

- [ ] **Step 4: Type-check + run tests + commit.**

Run: `npx tsc --noEmit && npm test`
Expected: tsc clean; all suites pass (counts in `ItemCatalog.spec` for `ITEM_CATALOG.length`/`ITEM_SETS.length` still pass because content arrives in Phase 2 — if you split commits, temporarily relax those two; otherwise land Phase 1+2 together). Then:

```bash
git add src/survivors/items/ItemTypes.ts src/survivors/items/ItemCatalog.ts src/survivors/items/Equipment.ts src/survivors/items/describeMods.ts src/survivors/shop/ShopStock.ts src/survivors/SurvivorsGameplayState.ts src/ui/overlays/CharacterProfile.ts tests/ItemCatalog.spec.ts tests/ShopStock.spec.ts
git commit -m "refactor(items): generalize SetDef to N-piece tiers; add unique/mythic rarities"
```

---

## Phase 2 — Content: unique sets + mythic weapons

### Task 2.1: Add the 3 unique sets to `ITEM_SETS`

**Files:**
- Modify: `src/survivors/items/ItemCatalog.ts` (append to `ITEM_SETS`)

- [ ] **Step 1: Append the 3 unique `SetDef`s (after `goblin_fortune`, inside the array).**

```ts
    {
        id: 'titans_oath', name: "Titan's Oath", kind: 'unique',
        pieces: ['oathbreaker_maul', 'browplate_of_the_titan', 'ribcage_bulwark',
                 'quakestride_faulds', 'stampede_sabatons', 'heart_of_the_warbeast'],
        tiers: [
            { pieces: 2, bonus: { attackSpeedPct: 15 }, text: '+15% attack speed' },
            { pieces: 4, bonus: { basicDamagePct: 18, maxHealth: 40, lifesteal: 0.05 }, text: '+18% basic damage, +40 max HP, +5% lifesteal' },
            { pieces: 6, effect: 'earthbreaker', text: 'EARTHBREAKER: every 4th hit quakes the ground at your target — AoE damage + 1s stun, growing with each swing' },
        ],
    },
    {
        id: 'tempest_stalker', name: 'Tempest Stalker', kind: 'unique',
        pieces: ['stormcaller_longbow', 'hawkeye_hood', 'stalkers_raincloak',
                 'windstep_chaps', 'galewalker_boots', 'stormeye_pendant'],
        tiers: [
            { pieces: 2, bonus: { attackSpeedPct: 15 }, text: '+15% attack speed' },
            { pieces: 4, bonus: { critChance: 0.10, critDamage: 0.30, moveSpeedPct: 8 }, text: '+10% crit chance, +0.30 crit damage, +8% move speed' },
            { pieces: 6, effect: 'tempest_volley', text: 'TEMPEST VOLLEY: every 8th hit fans 3 storm arrows; every 4th hit chains lightning to 2 nearby foes' },
        ],
    },
    {
        id: 'voidcallers_sequence', name: "Voidcaller's Sequence", kind: 'unique',
        pieces: ['voidcallers_scepter', 'circlet_of_the_ninth_truth', 'shroud_of_quiet_stars',
                 'leggings_of_drifting_aeons', 'treads_of_the_event_horizon', 'oculus_of_the_devourer'],
        tiers: [
            { pieces: 2, bonus: { powerDamagePct: 12 }, text: '+12% power damage' },
            { pieces: 4, bonus: { powerDamagePct: 12, cooldownPct: 12 }, text: '+12% power damage, −12% power cooldowns' },
            { pieces: 6, effect: 'arcane_cascade', text: 'ARCANE CASCADE: every power cast bursts a void nova, arcs to 3 foes, and refunds 8% of all cooldowns' },
        ],
    },
```

### Task 2.2: Add the 18 unique items + 3 mythic weapons to `ITEM_CATALOG`

**Files:**
- Modify: `src/survivors/items/ItemCatalog.ts` (append to `ITEM_CATALOG`, before the closing `]`)

- [ ] **Step 1: Append the unique pieces + mythic weapons.** (Mythics carry `setId` of their class set + `wildcardSetPiece: true` + `mythicFx`; they are NOT listed in the set's `pieces`.)

```ts
    // ── Titan's Oath (barbarian unique) ──────────────────────────────────────
    { id: 'oathbreaker_maul', name: 'Oathbreaker Maul', slot: 'weapon', rarity: 'unique',
      classes: ['barbarian'], setId: 'titans_oath', glyph: '🔨',
      mods: { basicDamagePct: 24, attackSpeedPct: 8 },
      flavor: 'Made a solemn vow once. Broke it. Broke a lot of things, actually.' },
    { id: 'browplate_of_the_titan', name: 'Browplate of the Titan', slot: 'helmet', rarity: 'unique',
      classes: ['barbarian'], setId: 'titans_oath', glyph: '🗿',
      mods: { maxHealth: 30, damageTakenPct: 8 },
      flavor: 'Headbutting is a valid opening, a valid middle, and a valid ending.' },
    { id: 'ribcage_bulwark', name: 'Ribcage Bulwark', slot: 'chest', rarity: 'unique',
      classes: ['barbarian'], setId: 'titans_oath', glyph: '🦴',
      mods: { maxHealth: 45, hpRegenPctPerSec: 0.006 },
      flavor: "Bigger than your ribcage. Roomier, too. Don't ask how it knows." },
    { id: 'quakestride_faulds', name: 'Quakestride Faulds', slot: 'legs', rarity: 'unique',
      classes: ['barbarian'], setId: 'titans_oath', glyph: '🌋',
      mods: { damageTakenPct: 12, knockback: 2 },
      flavor: 'Each step files a noise complaint with the bedrock.' },
    { id: 'stampede_sabatons', name: 'Stampede Sabatons', slot: 'boots', rarity: 'unique',
      classes: ['barbarian'], setId: 'titans_oath', glyph: '🦬',
      mods: { moveSpeedPct: 12, attackSpeedPct: 6 },
      flavor: 'There is no brake pedal. There was never a brake pedal.' },
    { id: 'heart_of_the_warbeast', name: 'Heart of the Warbeast', slot: 'trinket', rarity: 'unique',
      classes: ['barbarian'], setId: 'titans_oath', glyph: '🫀',
      mods: { lifesteal: 0.07, maxHealth: 20 },
      flavor: 'Still beating. Still angry. Still yours now, somehow.' },

    // ── Tempest Stalker (ranger unique) ──────────────────────────────────────
    { id: 'stormcaller_longbow', name: 'Stormcaller Longbow', slot: 'weapon', rarity: 'unique',
      classes: ['ranger'], setId: 'tempest_stalker', glyph: '🎯',
      mods: { basicDamagePct: 18, attackSpeedPct: 12 },
      flavor: 'Pull the string and somewhere, distantly, thunder agrees.' },
    { id: 'hawkeye_hood', name: 'Hawkeye Hood', slot: 'helmet', rarity: 'unique',
      classes: ['ranger'], setId: 'tempest_stalker', glyph: '🦅',
      mods: { critChance: 0.09, attackSpeedPct: 6 },
      flavor: 'Sees the bullseye. Also your bad posture. Sit up.' },
    { id: 'stalkers_raincloak', name: "Stalker's Raincloak", slot: 'chest', rarity: 'unique',
      classes: ['ranger'], setId: 'tempest_stalker', glyph: '🪂',
      mods: { maxHealth: 30, damageTakenPct: 8 },
      flavor: 'Waterproof, goblinproof, and faintly smug about both.' },
    { id: 'windstep_chaps', name: 'Windstep Chaps', slot: 'legs', rarity: 'unique',
      classes: ['ranger'], setId: 'tempest_stalker', glyph: '🌬',
      mods: { moveSpeedPct: 10, critChance: 0.06 },
      flavor: 'The legs that taught the wind to keep up.' },
    { id: 'galewalker_boots', name: 'Galewalker Boots', slot: 'boots', rarity: 'unique',
      classes: ['ranger'], setId: 'tempest_stalker', glyph: '🪽',
      mods: { moveSpeedPct: 12, attackSpeedPct: 8 },
      flavor: 'Outran a tornado once. The tornado wants a rematch.' },
    { id: 'stormeye_pendant', name: 'Stormeye Pendant', slot: 'trinket', rarity: 'unique',
      classes: ['ranger'], setId: 'tempest_stalker', glyph: '🌩',
      mods: { critChance: 0.10, critDamage: 0.30 },
      flavor: 'It blinks once per crit. It has not blinked in some time.' },

    // ── Voidcaller's Sequence (mage unique) ──────────────────────────────────
    { id: 'voidcallers_scepter', name: "Voidcaller's Scepter", slot: 'weapon', rarity: 'unique',
      classes: ['mage'], setId: 'voidcallers_sequence', glyph: '🔱',
      mods: { powerDamagePct: 26, cooldownPct: 6 },
      flavor: 'It hums in a key that makes reality apologize.' },
    { id: 'circlet_of_the_ninth_truth', name: 'Circlet of the Ninth Truth', slot: 'helmet', rarity: 'unique',
      classes: ['mage'], setId: 'voidcallers_sequence', glyph: '🔯',
      mods: { powerDamagePct: 10, cooldownPct: 10 },
      flavor: 'Knows eight forbidden things. The ninth is where you left your keys.' },
    { id: 'shroud_of_quiet_stars', name: 'Shroud of Quiet Stars', slot: 'chest', rarity: 'unique',
      classes: ['mage'], setId: 'voidcallers_sequence', glyph: '🌌',
      mods: { maxHealth: 35, damageTakenPct: 10 },
      flavor: 'Woven from the night sky. The night sky is still mad about it.' },
    { id: 'leggings_of_drifting_aeons', name: 'Leggings of Drifting Aeons', slot: 'legs', rarity: 'unique',
      classes: ['mage'], setId: 'voidcallers_sequence', glyph: '🪐',
      mods: { powerDamagePct: 16, moveSpeedPct: 8 },
      flavor: 'Each step happens slightly before you decide to take it.' },
    { id: 'treads_of_the_event_horizon', name: 'Treads of the Event Horizon', slot: 'boots', rarity: 'unique',
      classes: ['mage'], setId: 'voidcallers_sequence', glyph: '🕳',
      mods: { moveSpeedPct: 10, cooldownPct: 6 },
      flavor: 'Nothing escapes them. Especially not the floor.' },
    { id: 'oculus_of_the_devourer', name: 'Oculus of the Devourer', slot: 'trinket', rarity: 'unique',
      classes: ['mage'], setId: 'voidcallers_sequence', glyph: '👁',
      mods: { powerDamagePct: 12, critChance: 0.10 },
      flavor: "It blinks when you're not looking. You are never not looking." },

    // ── Mythic weapons (one per class; wildcard set piece) ────────────────────
    { id: 'skullsplitter_apex', name: 'Skullsplitter, the Apex', slot: 'weapon', rarity: 'mythic',
      classes: ['barbarian'], setId: 'titans_oath', wildcardSetPiece: true, glyph: '☠',
      mods: { basicDamagePct: 38, attackSpeedPct: 10, lifesteal: 0.05, knockback: 2 },
      effectId: 'apex_cleave',
      mythicFx: { auraColor: '#ff3a1f', style: 'embers', onHitColor: '#ff7a2f' },
      flavor: 'The last thing 1,000 goblins agreed on: "Yeah, that\'ll do it."' },
    { id: 'windsong_stormbow', name: 'Windsong, the Storm Bow', slot: 'weapon', rarity: 'mythic',
      classes: ['ranger'], setId: 'tempest_stalker', wildcardSetPiece: true, glyph: '🌪',
      mods: { basicDamagePct: 32, attackSpeedPct: 18, critChance: 0.15, critDamage: 0.30 },
      effectId: 'storm_quiver',
      mythicFx: { auraColor: '#5fb8ff', style: 'ribbon', onHitColor: '#bfe9ff' },
      flavor: 'Every arrow leaves a little weather behind. Bring a coat.' },
    { id: 'nullbrand_devouring_staff', name: 'Nullbrand, the Devouring Staff', slot: 'weapon', rarity: 'mythic',
      classes: ['mage'], setId: 'voidcallers_sequence', wildcardSetPiece: true, glyph: '🌑',
      mods: { powerDamagePct: 32, cooldownPct: 10, critChance: 0.08, critDamage: 0.12 },
      effectId: 'singularity',
      mythicFx: { auraColor: '#7a18ff', style: 'motes', onHitColor: '#b070ff' },
      flavor: 'It eats spells, screams, and the occasional goblin. Mostly the goblin.' },
```

- [ ] **Step 2: Add a load-time mythic⇒weapon assert** (after the `_byId`/`_setById` maps, ~line 168):

```ts
for (const _i of ITEM_CATALOG) {
    if (_i.rarity === 'mythic' && _i.slot !== 'weapon') {
        throw new Error(`mythic item ${_i.id} must be a weapon (got slot ${_i.slot})`);
    }
}
```

### Task 2.3: Update + extend `ItemCatalog.spec.ts` counts

**Files:**
- Modify: `tests/ItemCatalog.spec.ts:6-10`

- [ ] **Step 1: Update the count assertions and add unique/mythic coverage.** Replace the "has 30 items" test body:

```ts
    it('has 51 items with unique ids', () => {
        expect(ITEM_CATALOG.length).toBe(51);
        const ids = new Set(ITEM_CATALOG.map(i => i.id));
        expect(ids.size).toBe(ITEM_CATALOG.length);
    });

    it('has 7 sets (4 classic + 3 unique)', () => {
        expect(ITEM_SETS.length).toBe(7);
        expect(ITEM_SETS.filter(s => s.kind === 'unique').length).toBe(3);
    });

    it('every mythic is a weapon, class-locked, wildcard, with mythicFx + its class setId', () => {
        const mythics = ITEM_CATALOG.filter(i => i.rarity === 'mythic');
        expect(mythics.length).toBe(3);
        for (const m of mythics) {
            expect(m.slot).toBe('weapon');
            expect(m.classes).not.toBe('all');
            expect(m.wildcardSetPiece).toBe(true);
            expect(m.mythicFx).toBeDefined();
            const set = setById(m.setId!);
            expect(set?.kind).toBe('unique');
        }
    });
```

- [ ] **Step 2: Type-check + test + commit.**

Run: `npx tsc --noEmit && npm test`
Expected: all pass.

```bash
git add src/survivors/items/ItemCatalog.ts tests/ItemCatalog.spec.ts
git commit -m "feat(items): add 3 unique sets (18 items) + 3 mythic weapons"
```

---

## Phase 3 — Tier + wildcard aggregation tests

### Task 3.1: Test 2/4/6 tiers + mythic wildcard in `Equipment.spec.ts`

**Files:**
- Modify: `tests/Equipment.spec.ts`

- [ ] **Step 1: Add a describe block.** (Helper `buy` mirrors existing tests — equip by giving the player gold then `eq.buy(itemById(id)!, 1)`.)

```ts
import { itemById } from '../src/survivors/items/ItemCatalog';
// ... inside the file:
describe('unique sets + mythic wildcard', () => {
    function equip(eq: Equipment, ps: PlayerStats, ...ids: string[]) {
        for (const id of ids) { ps.addGold(100000); expect(eq.buy(itemById(id)!, 1)).toBe(true); }
    }

    it('applies the 2-piece tier at 2 unique pieces, not the 4/6', () => {
        const ps = new PlayerStats(); const eq = new Equipment(ps);
        equip(eq, ps, 'oathbreaker_maul', 'browplate_of_the_titan');
        const agg = eq.aggregates();
        expect(agg.setCounts['titans_oath']).toBe(2);
        expect(agg.attackSpeedMult).toBeGreaterThan(1);     // 2-pc +15% atkspd
        expect(agg.effects.has('earthbreaker')).toBe(false); // 6-pc not yet
    });

    it('a mythic weapon counts as the unique set weapon piece (wildcard ⇒ 6-pc)', () => {
        const ps = new PlayerStats(); const eq = new Equipment(ps);
        // 5 unique armor pieces + the mythic weapon (NOT the unique weapon)
        equip(eq, ps, 'browplate_of_the_titan', 'ribcage_bulwark', 'quakestride_faulds',
              'stampede_sabatons', 'heart_of_the_warbeast', 'skullsplitter_apex');
        const agg = eq.aggregates();
        expect(agg.setCounts['titans_oath']).toBe(6);
        expect(agg.effects.has('earthbreaker')).toBe(true);  // 6-pc set effect
        expect(agg.effects.has('apex_cleave')).toBe(true);   // mythic's own effect
        expect(agg.basicDamageMult).toBeCloseTo((1 + 38 / 100), 5); // mythic's OWN mods folded
    });
});
```

- [ ] **Step 2: Run + commit.**

Run: `npm test -- Equipment`
Expected: PASS.

```bash
git add tests/Equipment.spec.ts
git commit -m "test(items): 2/4/6 tier thresholds + mythic wildcard counting"
```

---

## Phase 4 — Shop: proportional set-pity

### Task 4.1: Proportional pity in `buildWeightedPool`

**Files:**
- Modify: `src/survivors/shop/ShopStock.ts:38-50`
- Test: `tests/ShopStock.spec.ts`

- [ ] **Step 1: Write the failing test** (add to `ShopStock.spec.ts`):

```ts
import { itemById } from '../src/survivors/items/ItemCatalog';
describe('proportional set pity', () => {
    it('weights a unique piece higher the more of its set is owned', () => {
        const def = itemById('ribcage_bulwark')!; // titans_oath unique
        const base = buildWeightedPool([def], {
            champion: 'barbarian', wave: 15, ownedIds: new Set(), setCounts: {}, rng: () => 0,
        })[0].weight;
        const withThree = buildWeightedPool([def], {
            champion: 'barbarian', wave: 15, ownedIds: new Set(), setCounts: { titans_oath: 3 }, rng: () => 0,
        })[0].weight;
        expect(withThree).toBeCloseTo(base * (1 + 0.5 * 3), 5); // 1 + 0.5·owned
    });
});
```

- [ ] **Step 2: Run to verify it fails.**

Run: `npm test -- ShopStock`
Expected: FAIL (current flat `×2.5` gives `base * 2.5`, not `base * 2.5` for n=3 — i.e. `withThree` equals `base*2.5`, expected `base*2.5`… the assertion `base*(1+0.5*3)=base*2.5` happens to equal at n=3; change the test to n=4 to force a real failure). Use `setCounts: { titans_oath: 4 }` and `base * (1 + 0.5 * 4)` (= base*3) — flat pity gives base*2.5, so it FAILS.

- [ ] **Step 3: Implement proportional pity.** Replace line 46:

```ts
        const owned = def.setId ? (opts.setCounts[def.setId] ?? 0) : 0;
        if (owned >= 1) weight *= 1 + 0.5 * owned;
```

- [ ] **Step 4: Run + commit.**

Run: `npm test -- ShopStock`
Expected: PASS (after setting the test to n=4 as in Step 2).

```bash
git add src/survivors/shop/ShopStock.ts tests/ShopStock.spec.ts
git commit -m "feat(shop): proportional set pity for the 6-piece unique grind"
```

---

## Phase 5 — New effects + EffectContext/EffectFx surface

### Task 5.1: Extend the `EffectContext` / `EffectFx` interfaces

**Files:**
- Modify: `src/survivors/items/ItemEffectRuntime.ts:11-38`

- [ ] **Step 1: Add `ring`/`beam` to `EffectFx` (after `echoShimmer`, line 16) and `tryExecuteBelow` to `EffectContext` (after `critChance`, line 36).**

```ts
// in EffectFx:
    /** Expanding ring at (x,z). colorHex MUST be a finite-palette literal. */
    ring(x: number, z: number, colorHex: string, radius: number): void;
    /** Straight beam between two points. colorHex MUST be a finite-palette literal. */
    beam(x0: number, z0: number, x1: number, z1: number, colorHex: string): void;
```

```ts
// in EffectContext:
    /** If the enemy is at/below `fraction` of max HP, route a lethal hit through
     *  the normal death path (gold/FX) and return true. */
    tryExecuteBelow(e: EffectEnemy, fraction: number): boolean;
```

### Task 5.2: Add tuning constants + effect state fields

**Files:**
- Modify: `src/survivors/items/ItemEffectRuntime.ts` (after line 60 constants; fields after line 73)

- [ ] **Step 1: Append the tuning constants (after `BURN_STRENGTH`, line 60).**

```ts
// Earthbreaker (Titan's Oath 6-pc)
export const QUAKE_EVERY_HITS = 4, QUAKE_COOLDOWN_S = 1.2, QUAKE_RADIUS = 4.5;
export const QUAKE_BASE_DAMAGE = 45, QUAKE_DAMAGE_PER_STACK = 6, MOMENTUM_MAX = 12, QUAKE_STUN_S = 1;
// Tempest Volley (Tempest Stalker 6-pc)
export const TEMPEST_EVERY_HITS = 8, TEMPEST_COOLDOWN_S = 0.5, TEMPEST_FAN_COUNT = 3;
export const TEMPEST_FAN_RANGE = 9, TEMPEST_FAN_FRACTION = 0.7;
export const TEMPEST_STATIC_EVERY = 4, TEMPEST_CHAIN_TARGETS = 2, TEMPEST_CHAIN_RANGE = 6, TEMPEST_CHAIN_FRACTION = 0.45;
// Arcane Cascade (Voidcaller's Sequence 6-pc)
export const CASCADE_NOVA_BASE = 40, CASCADE_NOVA_PER_WAVE = 6, CASCADE_NOVA_RADIUS = 5;
export const CASCADE_ARC_TARGETS = 3, CASCADE_ARC_RANGE = 8, CASCADE_ARC_FRACTION = 0.5;
export const CASCADE_CD_REFUND = 0.08, CASCADE_COOLDOWN_S = 0.5;
// Apex Cleave (Skullsplitter mythic)
export const CLEAVE_RADIUS = 3, CLEAVE_FRACTION = 0.55, EXECUTE_HP_FRACTION = 0.12;
// Storm Quiver (Windsong mythic)
export const STORM_CHARGE_PER_HIT = 1, STORM_CHARGE_MAX = 10, STORM_STRIKE_TARGETS = 5;
export const STORM_STRIKE_RADIUS = 8, STORM_STRIKE_BASE = 45, STORM_STRIKE_PER_WAVE = 6, STORM_STUN_S = 0.6;
// Singularity (Nullbrand mythic)
export const SINGULARITY_RADIUS = 6, SINGULARITY_BASE = 70, SINGULARITY_PER_WAVE = 9;
export const SINGULARITY_CLUSTER_BONUS = 0.06, SINGULARITY_CLUSTER_CAP = 0.6, SINGULARITY_COOLDOWN_S = 0.6;
```

- [ ] **Step 2: Add state fields (after line 73, `inDoublePay`).**

```ts
    private quakeHits = 0; private quakeCd = 0; private momentum = 0;
    private tempestHits = 0; private staticHits = 0; private volleyCd = 0;
    private cascadeCd = 0; private inCascade = false;
    private stormCharge = 0;
    private singularityCd = 0; private inSingularity = false;
```

### Task 5.3: Implement the on-hit effects (`earthbreaker`, `tempest_volley`, `apex_cleave`, `storm_quiver`)

**Files:**
- Modify: `src/survivors/items/ItemEffectRuntime.ts` (`onBasicHit`, ~103; `tick`, ~91)
- Test: `tests/ItemEffectRuntime.spec.ts`

- [ ] **Step 1: Write failing tests** (use the existing fake-ctx pattern in the spec file; add a fan/quake/execute fake). Add:

```ts
describe('earthbreaker', () => {
    it('quakes every 4th hit, damaging + stunning nearby enemies, scaling with momentum', () => {
        const hits: number[] = []; const stuns: number[] = [];
        const near = [{ isAlive: () => true, getPosition: () => ({ x: 0, z: 0 }) }];
        const rt = new ItemEffectRuntime(fakeCtx({
            enemiesNear: () => near as any,
            damage: (_e, amt) => hits.push(amt),
            stun: (_e, s) => stuns.push(s),
        }));
        rt.setActiveEffects(new Set(['earthbreaker']));
        const t = { isAlive: () => true, getPosition: () => ({ x: 0, z: 0 }) } as any;
        for (let i = 0; i < 4; i++) rt.onBasicHit(t, 10);
        expect(hits.length).toBe(1);              // fired on 4th hit
        expect(hits[0]).toBeGreaterThanOrEqual(QUAKE_BASE_DAMAGE);
        expect(stuns[0]).toBe(QUAKE_STUN_S);
    });
});
describe('apex_cleave', () => {
    it('cleaves nearby foes and executes via tryExecuteBelow', () => {
        let executed = 0;
        const near = [{ isAlive: () => true, getPosition: () => ({ x: 1, z: 0 }) }];
        const rt = new ItemEffectRuntime(fakeCtx({
            enemiesNear: () => near as any,
            tryExecuteBelow: () => { executed++; return true; },
        }));
        rt.setActiveEffects(new Set(['apex_cleave']));
        const t = { isAlive: () => true, getPosition: () => ({ x: 0, z: 0 }) } as any;
        rt.onBasicHit(t, 100);
        expect(executed).toBeGreaterThan(0);
    });
});
```

(If the spec file lacks a `fakeCtx` helper, add one that returns a full `EffectContext` with no-op defaults overridable by the partial arg — including `tryExecuteBelow: () => false` and `fx.ring`/`fx.beam` no-ops.)

- [ ] **Step 2: Run to verify failure.**

Run: `npm test -- ItemEffectRuntime`
Expected: FAIL (effects not implemented).

- [ ] **Step 3: Implement the four on-hit effects inside `onBasicHit` (append after the `shockwave` block, before the method's closing brace).**

```ts
        if (this.active.has('earthbreaker')) {
            this.quakeHits++;
            this.momentum = Math.min(MOMENTUM_MAX, this.momentum + 1);
            if (this.quakeHits >= QUAKE_EVERY_HITS && this.quakeCd <= 0) {
                this.quakeHits = 0; this.quakeCd = QUAKE_COOLDOWN_S;
                const tp = target.getPosition();
                const dmg = QUAKE_BASE_DAMAGE + this.momentum * QUAKE_DAMAGE_PER_STACK;
                for (const e of this.ctx.enemiesNear(tp.x, tp.z, QUAKE_RADIUS)) {
                    this.ctx.damage(e, dmg, 'physical');
                    this.ctx.stun(e, QUAKE_STUN_S);
                }
                this.ctx.fx.ring(tp.x, tp.z, '#c47a2c', QUAKE_RADIUS * (1 + this.momentum / MOMENTUM_MAX * 0.6));
                this.momentum = 0;
            }
        }
        if (this.active.has('tempest_volley')) {
            const tp = target.getPosition();
            this.tempestHits++;
            if (this.tempestHits >= TEMPEST_EVERY_HITS && this.volleyCd <= 0) {
                this.tempestHits = 0; this.volleyCd = TEMPEST_COOLDOWN_S;
                const foes = this.ctx.enemiesNear(tp.x, tp.z, TEMPEST_FAN_RANGE)
                    .filter(e => e !== target && e.isAlive()).slice(0, TEMPEST_FAN_COUNT);
                for (const e of foes) {
                    const ep = e.getPosition();
                    this.ctx.damage(e, Math.round(damage * TEMPEST_FAN_FRACTION), 'storm');
                    this.ctx.fx.beam(tp.x, tp.z, ep.x, ep.z, '#7fd4ff');
                }
            }
            this.staticHits++;
            if (this.staticHits >= TEMPEST_STATIC_EVERY) {
                this.staticHits = 0;
                const foes = this.ctx.enemiesNear(tp.x, tp.z, TEMPEST_CHAIN_RANGE)
                    .filter(e => e !== target && e.isAlive()).slice(0, TEMPEST_CHAIN_TARGETS);
                for (const e of foes) {
                    const ep = e.getPosition();
                    this.ctx.damage(e, Math.round(damage * TEMPEST_CHAIN_FRACTION), 'storm');
                    this.ctx.fx.beam(tp.x, tp.z, ep.x, ep.z, '#bfe9ff');
                }
            }
        }
        if (this.active.has('apex_cleave')) {
            const tp = target.getPosition();
            for (const e of this.ctx.enemiesNear(tp.x, tp.z, CLEAVE_RADIUS)) {
                if (e === target) continue;
                this.ctx.damage(e, Math.round(damage * CLEAVE_FRACTION), 'physical');
                this.ctx.tryExecuteBelow(e, EXECUTE_HP_FRACTION);
            }
            this.ctx.tryExecuteBelow(target, EXECUTE_HP_FRACTION);
            this.ctx.fx.ring(tp.x, tp.z, '#ff3a1f', CLEAVE_RADIUS);
        }
        if (this.active.has('storm_quiver')) {
            this.stormCharge += STORM_CHARGE_PER_HIT;
            if (this.stormCharge >= STORM_CHARGE_MAX) {
                this.stormCharge = 0;
                const hp = this.ctx.heroPos();
                const dmg = STORM_STRIKE_BASE + STORM_STRIKE_PER_WAVE * this.ctx.wave();
                const foes = this.ctx.enemiesNear(hp.x, hp.z, STORM_STRIKE_RADIUS)
                    .filter(e => e.isAlive()).slice(0, STORM_STRIKE_TARGETS);
                for (const e of foes) {
                    const ep = e.getPosition();
                    this.ctx.damage(e, dmg, 'storm');
                    this.ctx.stun(e, STORM_STUN_S);
                    this.ctx.fx.ring(ep.x, ep.z, '#bfe9ff', 1.6);
                }
            }
        }
```

- [ ] **Step 4: Add cooldown decrements in `tick(dt)` (after the existing `chronoCd` line, ~93).**

```ts
        this.quakeCd = Math.max(0, this.quakeCd - dt);
        this.volleyCd = Math.max(0, this.volleyCd - dt);
        this.cascadeCd = Math.max(0, this.cascadeCd - dt);
        this.singularityCd = Math.max(0, this.singularityCd - dt);
```

- [ ] **Step 5: Run + verify pass.**

Run: `npm test -- ItemEffectRuntime`
Expected: PASS.

### Task 5.4: Implement the cast effects (`arcane_cascade`, `singularity`) + reset

**Files:**
- Modify: `src/survivors/items/ItemEffectRuntime.ts` (`onPowerCast`, ~179; `reset`, ~192)

- [ ] **Step 1: Write failing test.**

```ts
describe('cast effects', () => {
    it('arcane_cascade novas once per cast and refunds cooldowns', () => {
        let refunds = 0; const near = [{ isAlive: () => true, getPosition: () => ({ x: 0, z: 0 }) }];
        const rt = new ItemEffectRuntime(fakeCtx({
            enemiesNear: () => near as any, refundCooldownPct: () => refunds++,
        }));
        rt.setActiveEffects(new Set(['arcane_cascade']));
        rt.onPowerCast();
        expect(refunds).toBe(1);
    });
    it('singularity scales damage with enemy count', () => {
        const dmgs: number[] = [];
        const makeCtx = (n: number) => fakeCtx({
            enemiesNear: () => Array.from({ length: n }, () => ({ isAlive: () => true, getPosition: () => ({ x: 0, z: 0 }) })) as any,
            damage: (_e, amt) => dmgs.push(amt), wave: () => 1,
        });
        const r1 = new ItemEffectRuntime(makeCtx(1)); r1.setActiveEffects(new Set(['singularity'])); r1.onPowerCast();
        const single = dmgs[0]; dmgs.length = 0;
        const r5 = new ItemEffectRuntime(makeCtx(5)); r5.setActiveEffects(new Set(['singularity'])); r5.onPowerCast();
        expect(dmgs[0]).toBeGreaterThan(single); // clustering bonus
    });
});
```

- [ ] **Step 2: Run to verify failure.** `npm test -- ItemEffectRuntime` → FAIL.

- [ ] **Step 3: Implement in `onPowerCast` (the echo block stays; append after it).**

```ts
        if (this.active.has('arcane_cascade') && !this.inCascade && this.cascadeCd <= 0) {
            this.inCascade = true; this.cascadeCd = CASCADE_COOLDOWN_S;
            try {
                const hp = this.ctx.heroPos();
                const dmg = CASCADE_NOVA_BASE + CASCADE_NOVA_PER_WAVE * this.ctx.wave();
                const inRadius = this.ctx.enemiesNear(hp.x, hp.z, CASCADE_NOVA_RADIUS).filter(e => e.isAlive());
                for (const e of inRadius) this.ctx.damage(e, dmg, 'arcane');
                const arc = this.ctx.enemiesNear(hp.x, hp.z, CASCADE_ARC_RANGE)
                    .filter(e => e.isAlive() && !inRadius.includes(e)).slice(0, CASCADE_ARC_TARGETS);
                for (const e of arc) this.ctx.damage(e, Math.round(dmg * CASCADE_ARC_FRACTION), 'arcane');
                this.ctx.refundCooldownPct(CASCADE_CD_REFUND);
                this.ctx.fx.ring(hp.x, hp.z, '#8a3cff', CASCADE_NOVA_RADIUS);
            } finally { this.inCascade = false; }
        }
        if (this.active.has('singularity') && !this.inSingularity && this.singularityCd <= 0) {
            this.inSingularity = true; this.singularityCd = SINGULARITY_COOLDOWN_S;
            try {
                const hp = this.ctx.heroPos();
                const foes = this.ctx.enemiesNear(hp.x, hp.z, SINGULARITY_RADIUS).filter(e => e.isAlive());
                const base = SINGULARITY_BASE + SINGULARITY_PER_WAVE * this.ctx.wave();
                const mult = 1 + Math.min(SINGULARITY_CLUSTER_CAP, Math.max(0, foes.length - 1) * SINGULARITY_CLUSTER_BONUS);
                const dmg = Math.round(base * mult);
                for (const e of foes) this.ctx.damage(e, dmg, 'arcane');
                this.ctx.fx.ring(hp.x, hp.z, '#7a18ff', SINGULARITY_RADIUS);
                this.ctx.fx.ring(hp.x, hp.z, '#b070ff', 1.5);
            } finally { this.inSingularity = false; }
        }
```

- [ ] **Step 4: Extend `reset()` (after `inDoublePay = false`, ~201) to zero the new fields.**

```ts
        this.quakeHits = 0; this.quakeCd = 0; this.momentum = 0;
        this.tempestHits = 0; this.staticHits = 0; this.volleyCd = 0;
        this.cascadeCd = 0; this.inCascade = false;
        this.stormCharge = 0;
        this.singularityCd = 0; this.inSingularity = false;
```

- [ ] **Step 5: Run + commit.**

Run: `npx tsc --noEmit && npm test -- ItemEffectRuntime`
Expected: PASS.

```bash
git add src/survivors/items/ItemEffectRuntime.ts tests/ItemEffectRuntime.spec.ts
git commit -m "feat(items): implement 6 unique/mythic effects + context surface"
```

### Task 5.5: Add `EFFECT_TEXT` entries

**Files:**
- Modify: `src/survivors/items/describeMods.ts:5-15`

- [ ] **Step 1: Add the 6 entries to `EFFECT_TEXT` (before the closing brace).**

```ts
    earthbreaker: 'EARTHBREAKER: every 4th hit quakes the ground — AoE damage + 1s stun, growing with each swing',
    tempest_volley: 'TEMPEST VOLLEY: every 8th hit fans 3 storm arrows; every 4th hit chains lightning to 2 foes',
    arcane_cascade: 'ARCANE CASCADE: every cast bursts a void nova, arcs to 3 foes, refunds 8% cooldowns',
    apex_cleave: 'APEX CLEAVE: every hit cleaves nearby foes for 55% and executes anything under 12% HP',
    storm_quiver: 'STORM QUIVER: hits charge a 5-target lightning volley',
    singularity: 'SINGULARITY: every cast implodes a void nova, dealing more the more foes are caught',
```

- [ ] **Step 2: Type-check + commit.**

Run: `npx tsc --noEmit && npm test`
Expected: PASS (the `EFFECT_TEXT: Record<ItemEffectId,…>` is now exhaustive again).

```bash
git add src/survivors/items/describeMods.ts
git commit -m "feat(items): shop copy for the 6 new effects"
```

---

## Phase 6 — Adapter wiring in `SurvivorsGameplayState`

### Task 6.1: Implement `tryExecuteBelow` + `fx.ring`/`fx.beam` in `buildEffectContext`

**Files:**
- Modify: `src/survivors/SurvivorsGameplayState.ts` (`buildEffectContext`, ~3768-3818)

- [ ] **Step 1: Add `tryExecuteBelow` to the returned object (after `critChance`, ~3806).**

```ts
            tryExecuteBelow: (e, fraction) => {
                const en = e as Enemy;
                const hp = en.getHealth(); const max = en.getMaxHealth();
                if (max <= 0 || hp <= 0) return false;
                if (hp / max <= fraction) {
                    en.takeDamage(hp, 'physical' as PowerElement); // exactly lethal → normal death path
                    return true;
                }
                return false;
            },
```

- [ ] **Step 2: Add `ring`/`beam` to the `fx` object (after `echoShimmer`, ~3815).**

```ts
                ring: (x, z, colorHex, radius) => { if (this.scene) spawnExpandingRing(this.scene, x, z, colorHex, radius); },
                beam: (x0, z0, x1, z1, colorHex) => { if (this.scene) spawnTrail(this.scene, x0, z0, x1, z1, colorHex); },
```

- [ ] **Step 3: Type-check.** `npx tsc --noEmit` → clean.

### Task 6.2: Drive `setMythicAura` from the equipment recompute

**Files:**
- Modify: `src/survivors/SurvivorsGameplayState.ts` (`applyLevelBonuses`, after line 3733 `setActiveEffects`)

- [ ] **Step 1: After `this.itemEffects?.setActiveEffects(agg.effects);` add:**

```ts
            const weapon = this.equipment.get('weapon');
            const mythicFx = weapon?.def.rarity === 'mythic' ? (weapon.def.mythicFx ?? null) : null;
            this.hero?.setMythicAura(mythicFx);
```

- [ ] **Step 2: Type-check.** `npx tsc --noEmit` → expect ONE error: `setMythicAura` does not exist on Champion (fixed in Phase 7). Do not commit yet.

---

## Phase 7 — Champion mythic aura hook

### Task 7.1: Add `setMythicAura` + persistent aura + disposal

**Files:**
- Modify: `src/survivors/champions/Champion.ts` (field near line 71; method near 2057; dispose in `_releaseChampionFx` ~1883)

- [ ] **Step 1: Add fields near `glbWeaponAnchor` (line 71).**

```ts
    private mythicAuraPs: ParticleSystem | null = null;
    private mythicAuraKey: string | null = null;
```

- [ ] **Step 2: Add the method (after `updateElementVisuals`, ~2057).** Imports `ParticleSystem`, `Color4`, `Vector3`, `getStatusEffectTexture`, `Color3.FromHexString` are already used in this file.

```ts
    /** Persistent mythic weapon aura at the weapon bone. Idempotent: rebuilds
     *  only when the config changes; null tears it down. ONE particle system;
     *  dispose(false) keeps the shared status-effect texture. */
    public setMythicAura(cfg: MythicFxConfig | null): void {
        const key = cfg ? `${cfg.style}_${cfg.auraColor}` : null;
        if (key === this.mythicAuraKey) return;
        this.mythicAuraKey = key;
        if (this.mythicAuraPs) { this.mythicAuraPs.stop(); this.mythicAuraPs.dispose(false); this.mythicAuraPs = null; }
        if (!cfg) return;
        const anchor = this.getWeaponAnchor();
        if (!anchor) return;
        const c = Color3.FromHexString(cfg.auraColor);
        const ps = new ParticleSystem('mythicAura', 64, this.scene);
        ps.emitter = anchor;
        ps.particleTexture = getStatusEffectTexture(this.scene);
        ps.blendMode = ParticleSystem.BLENDMODE_ONEONE;
        ps.color1 = new Color4(c.r, c.g, c.b, 1);
        ps.color2 = new Color4(c.r * 0.7, c.g * 0.7, c.b * 0.7, 1);
        ps.colorDead = new Color4(c.r * 0.15, c.g * 0.15, c.b * 0.15, 0);
        ps.minEmitBox = new Vector3(-0.3, -0.05, -0.3);
        ps.maxEmitBox = new Vector3(0.3, 0.5, 0.3);
        ps.gravity = Vector3.Zero();
        switch (cfg.style) {
            case 'embers':
                ps.minSize = 0.18; ps.maxSize = 0.42; ps.minLifeTime = 0.4; ps.maxLifeTime = 0.9; ps.emitRate = 50;
                ps.direction1 = new Vector3(-0.3, 0.7, -0.3); ps.direction2 = new Vector3(0.3, 1.4, 0.3);
                ps.minEmitPower = 0.5; ps.maxEmitPower = 1.2; break;
            case 'ribbon':
                ps.minSize = 0.10; ps.maxSize = 0.24; ps.minLifeTime = 0.15; ps.maxLifeTime = 0.4; ps.emitRate = 70;
                ps.direction1 = new Vector3(-1, -0.4, -1); ps.direction2 = new Vector3(1, 1, 1);
                ps.minEmitPower = 1.2; ps.maxEmitPower = 2.4; break;
            case 'motes':
                ps.minSize = 0.16; ps.maxSize = 0.34; ps.minLifeTime = 0.8; ps.maxLifeTime = 1.5; ps.emitRate = 28;
                ps.direction1 = new Vector3(-0.4, 0.1, -0.4); ps.direction2 = new Vector3(0.4, 0.5, 0.4);
                ps.minEmitPower = 0.15; ps.maxEmitPower = 0.5; break;
        }
        ps.start();
        this.mythicAuraPs = ps;
    }
```

- [ ] **Step 3: Add disposal in `_releaseChampionFx` (after the `elementAuraPs` clear, ~1883).**

```ts
        if (this.mythicAuraPs) {
            this.mythicAuraPs.stop();
            this.mythicAuraPs.dispose(false); // shared status-effect texture singleton
            this.mythicAuraPs = null;
        }
        this.mythicAuraKey = null;
```

- [ ] **Step 4: Ensure `MythicFxConfig` is imported.** At the Champion item-types import line, add `MythicFxConfig`. Then type-check.

Run: `npx tsc --noEmit`
Expected: clean (Phase 6.2's error resolved).

- [ ] **Step 5: Commit Phases 6 + 7 together.**

```bash
git add src/survivors/SurvivorsGameplayState.ts src/survivors/champions/Champion.ts
git commit -m "feat(items): wire mythic effects context + Champion mythic weapon aura"
```

- [ ] **Step 6: Manual verify.** `npm start`, reach wave 11+ as each class, buy a mythic weapon: confirm the weapon aura appears, on-hit/cast FX fire, no console errors, and (critical) the aura disappears on death/return-to-menu without a multi-second freeze on the next run (resource watchdog: no `[resource-watchdog] LEAK SUSPECTED` at wave clear).

---

## Phase 8 — Optional polish: rarity card styling

### Task 8.1: Stronger shop-card frames for unique/mythic

**Files:**
- Modify: `src/ui/styles/components.css`

- [ ] **Step 1: Add selectors** (the overlay already sets `--accent` from `RARITY_COLOR`, so this is cosmetic emphasis — a brighter border/glow for the two top tiers). Append:

```css
.shop-card--unique { box-shadow: 0 0 0 1px var(--accent), 0 0 14px -2px var(--accent); }
.shop-card--mythic { box-shadow: 0 0 0 2px var(--accent), 0 0 22px -1px var(--accent); }
```

- [ ] **Step 2: Build + commit.**

Run: `npm run build`
Expected: build succeeds.

```bash
git add src/ui/styles/components.css
git commit -m "style(shop): brighter frames for unique + mythic cards"
```

---

## Phase 9 — Co-op FX replay (guest visibility)

> Single-player + host already work after Phase 7 (effects run host-authoritatively). This phase makes the guest SEE the new cosmetics. If deferred, the feature still functions; the guest just won't see the mythic aura / on-hit bursts.

### Task 9.1: Replay mythic aura + ring/beam over `CoopFx`

**Files:**
- Modify: `src/survivors/coop/CoopFx.ts`, and the `fx.ring`/`fx.beam`/`setMythicAura` call sites.

- [ ] **Step 1: Read `src/survivors/coop/CoopFx.ts`** to learn the existing fx-channel message shape (`emitCoopFx`/`withFxReplay`).

- [ ] **Step 2: Add `ring`/`beam`/`mythicAura` fx kinds** to the channel, emit them from the gameplay-state `fx.ring`/`fx.beam` adapter and from `setMythicAura` (host side), and replay on the guest (guarded by `withFxReplay` so echoes don't rebroadcast). Mirror exactly how `shockwave`/`ricochet` are already replayed.

- [ ] **Step 3: Run co-op net tests + commit.**

Run: `npm test -- coop && npx tsc --noEmit`
Expected: PASS.

```bash
git add src/survivors/coop/CoopFx.ts src/survivors/SurvivorsGameplayState.ts src/survivors/champions/Champion.ts
git commit -m "feat(coop): replay mythic aura + ring/beam fx to the guest"
```

---

## Phase 10 — Final verification

### Task 10.1: Full type-check + test + build + manual playtest

- [ ] **Step 1: Full gate.**

Run: `npx tsc --noEmit && npm test && npm run build`
Expected: tsc clean, all suites pass, build succeeds.

- [ ] **Step 2: Manual playtest checklist** (`npm start`):
  - Each class at wave 8–10: its 6 unique pieces appear in the shop (and only its class's); buying 2 then 4 then 6 shows incrementally stronger character-sheet tier rows lit up.
  - Completing 6 unique pieces activates the capstone effect (visible FX on hit/cast).
  - At wave 11+: the class mythic appears; buying it shows the weapon aura, its own effect text on the card, and — wearing it + 5 unique armor — the character sheet shows the set at 6/6 with the 6-pc bonus active (wildcard).
  - No `[resource-watchdog] LEAK SUSPECTED` at wave clears; no multi-second freeze across a death→new-run cycle (mythic aura disposed).

- [ ] **Step 3: Finish the branch** via the `superpowers:finishing-a-development-branch` skill (PR vs merge decision).

---

## Self-review notes (author)

- **Spec coverage:** §2 type model → Task 1.1; SetDef migration → 1.2–1.6; `tiers[]` aggregation → 1.3; rarity weights → 1.7; §3 unique sets → 2.1/2.2; §4 mythics → 2.2; wildcard → 1.3 + 3.1; §5 effects → 5.2–5.5; `tryExecuteBelow`/`fx.ring`/`fx.beam` → 5.1 + 6.1; §6 shop weights/pity → 1.7 + 4.1; §7 Champion aura → 6.2 + 7.1; co-op → 9.1; testing → 1.8, 2.3, 3.1, 4.1, 5.3–5.4; §9 baseline → 10.1.
- **Type consistency:** `MythicFxConfig` (1.1) used in 2.2 catalog + 6.2 drive + 7.1 method; `SetTier.text`/`tiers[]` used consistently in 1.2/1.4/1.5/2.1; `tryExecuteBelow` signature identical in 5.1 (interface) and 6.1 (impl); `fx.ring(x,z,colorHex,radius)`/`fx.beam(x0,z0,x1,z1,colorHex)` identical in 5.1 / 5.3 / 6.1; effect ids match between `ItemTypes` union (1.1), catalog (2.1/2.2), runtime (5.3/5.4), and `EFFECT_TEXT` (5.5).
- **Known pre-existing IDE noise:** `setOnHit`/`setOnHurt`/`cameraZoom.spec` LSP errors are stale false positives (verified the methods exist); rely on `tsc`/`npm test`, per CLAUDE.md.
```
