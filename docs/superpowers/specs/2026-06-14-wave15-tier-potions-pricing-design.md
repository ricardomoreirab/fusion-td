# Wave-15+ Enemy Tier, Shop Potions & Price Rework — Design

**Date:** 2026-06-14
**Status:** Approved (brainstorming) → ready for implementation plan

## Summary

Three related additions to the survivors mode:

1. **Wave-15+ enemy tier** — a second enemy-swap threshold layered on top of the
   existing wave-10 red tier, introducing four new enemy behaviors plus a wave-25
   milestone boss (Elemental Lord) that drops a run-defining item.
2. **Shop potions** — four expensive single-wave consumables in a dedicated,
   always-available potion row.
3. **Price rework** — unique & mythic items ×10; all other rarities ×2.5.

All assets already exist on disk (`fire-beetle`, `horned-lizard`, `red-wizard`,
`red-super-wizard`, `elemental-lord` under `assets/`).

The work follows the proven **wave-10 red-tier pattern**: extend a blue/red base
enemy class, override 3–4 stats, reuse the base mesh via `pendingAsset` staging,
register the GLB in `ENEMY_GLB_PATHS`, add a swap case, add a spawn case, and
mirror the spawn case in `createEnemyOfType.ts` for co-op guests.

---

## Part 1 — Wave-15+ enemy tier

### 1.1 Tiered swap (`src/survivors/enemies/redSwap.ts`)

Generalize the single-threshold `redSwapType()` into tiered swaps. Wave 15+ is a
**second one-way swap applied on top of** the existing red swaps. Precedence:
check the wave-15 table first, fall back to the wave-10 table, else pass through.

| Base role | Wave 1–9 | Wave 10–14 | Wave 15+ |
|---|---|---|---|
| `basic` | blue minion | `basic_red` (red minion) | `basic_red` (unchanged) |
| `fast` | blue carriage | `fast_red` (red carriage) | **`fire_beetle`** |
| `tank` | lava golem | `tank_red` (dragon turtle) | **`horned_lizard`** |
| `healer` | blue wizard | `healer_red` (red wizard, ranged) | `healer_red` (unchanged) |
| `healer` **elite** | blue super wizard | red super wizard (cosmetic only) | **`red_super_wizard`** (ranged + AOE) |
| `shield` / `splitting` / `mini` / `boss` | pass through | pass through | pass through |

`RED_SWAP_WAVE = 10` stays; add `TIER3_SWAP_WAVE = 15`. The function stays pure
(covered by Vitest).

### 1.2 New enemy classes (`src/survivors/enemies/`)

All four reuse a base class's mesh/animation; only stats and one behavior change.
Each uses the `new.target` guard pattern (`if (new.target === ClassName) this._initEnemyVisuals()`)
established by the red-tier classes, so the mesh builds exactly once.

**`FireBeetle extends FastEnemy`** — fast skirmisher with a fire DoT on contact.
- Stats: high HP (~10× base fast, in line with `RedArtilleryCarriage`), fast,
  moderate contact DPS.
- Behavior: on contact with the hero, in addition to the normal contact DPS, apply
  a **hero burn DoT** (see §1.4). The burn keeps ticking ~3s after contact ends.

**`HornedLizard extends TankEnemy`** — heavy hitter.
- Stats: very high HP (DragonTurtle-class, ~700), slow speed, **very high contact /
  melee damage** (heaviest non-boss hitter), larger `glbScale`.
- Behavior: reuses TankEnemy's melee swing; numbers tuned upward.

**`RedSuperWizard extends RedWizard`** — ranged + AOE.
- Stats: elite-scaled (this is the wizard's elite spawn at wave 15+).
- Behavior: inherits `RedWizard`'s bolt projectile (pool key, cooldown, straight-line
  ballistics). Override impact so the bolt deals **AOE splash** in a small radius
  around the hit point (not just a point hit), with an impact burst FX. Co-op:
  broadcast the same `enemyProj` fx plus the splash via `emitCoopFx`.

`RedWizard` itself is unchanged (already ranged from the wave-10 tier).

### 1.3 Asset registration (`SurvivorsGameplayState.ts` `ENEMY_GLB_PATHS`)

```
fire_beetle:       'assets/fire-beetle/source/fire_beetle.glb'
horned_lizard:     'assets/horned-lizard/source/horned_lizard.glb'
boss_tier5:        'assets/elemental-lord/source/elemental_lord.glb'
```

`red_super_wizard` already maps via `healer_red_elite` →
`assets/red-super-wizard/source/red_super_wizard.glb` (reused as the wizard elite).

### 1.4 Hero burn DoT (`HeroController.ts`)

The hero has no status-effect system today. Add a **lightweight burn field**:
- `private burnTimer = 0; private burnDps = 0;`
- `public applyBurn(durationS, dps)` — refreshes timer to `max(current, duration)`,
  sets/raises dps.
- In the per-frame update, while `burnTimer > 0`, deal `burnDps * dt` via the
  existing damage path (respecting the revive shield / invuln gates) and decrement.
- Damage numbers themed `fire` (orange) via the element color path.

This is intentionally minimal — only FireBeetle uses it. No general hero status model.

### 1.5 Elemental Lord — wave-25 milestone boss

`MilestoneBoss` already supports tier 5+ (`tier = wave / 5`; HP scales by formula,
DPS/speed clamp at tier-4). Additions:

- `boss_tier5` asset wired (see §1.3); spawn switch already does
  `assetTier = min(4, ...)` for capping — change so tier 5 selects `boss_tier5`
  (tier 6+ can still cap at the tier-5 asset).
- `TIER_LABEL[5] = 'Elemental Lord'`, `TIER_ACTIONS[5] = ['dash','pull']`.
- **Larger `glbScale`** than every prior boss (visually the biggest).
- **Elemental nova:** a periodic AOE shockwave on a timer — reuses the existing
  slam/pull AOE damage application plus an `AbilityVisuals` element-themed burst
  (damage-free visual). Telegraphed before it fires. Co-op: broadcast via
  `emitCoopFx` like other boss specials.

### 1.6 Elemental Core drop (`RunItems.ts`)

- Add `'elementalCore'` to the `ItemId` union and `stacks` record.
- `ITEM_BY_TIER[5] = 'elementalCore'` (drops from the wave-25 Elemental Lord via the
  existing `setOnMilestoneBossDeath → spawnItemDrop(pos, tier)` pipeline).
- Effect: **multiply all power damage ×10**. Because `applyLevelBonuses()` reassigns
  `powerDamageMultiplier` from scratch every recompute, the core must be **re-folded
  there** (exactly like the attack-speed stack re-fold at lines ~3839):
  `ps.powerDamageMultiplier *= Math.pow(10, runItems.getStacks('elementalCore'))`.
- Add display name + float color in `ITEM_DISPLAY_NAMES` / `ITEM_FLOAT_COLOR`, and a
  HUD item slot entry, matching the other four milestone items.

### 1.7 Co-op parity

- Mirror the new spawn cases (`fire_beetle`, `horned_lizard`, wizard-elite →
  `RedSuperWizard`, `boss_tier5`) in `createEnemyOfType.ts` so guests render them.
- Ranged bolt / AOE splash / elemental nova FX replay through the existing
  `emitCoopFx` cosmetic channel (same as `RedWizard`'s `enemyProj`).
- The hero burn DoT, potions, and the Elemental Core are **per-player local stats**
  (co-op itemization is already per-player) — no host authority needed for those.
- Solo path stays byte-identical: every co-op hook stays null/guarded.

---

## Part 2 — Shop potions

### 2.1 Placement

A **dedicated 4-potion row** in `ShopOverlay`, rendered separately from the random
6-card gear grid, **always purchasable** every shop visit (not part of random stock).
Each potion is a fixed card showing name, effect, and price.

### 2.2 Potions (each lasts exactly the next combat wave)

| Potion | Price | Effect | Stat write (folded in `applyLevelBonuses`) |
|---|---|---|---|
| Lifesteal Potion | ~500g | +10% lifesteal | `lifestealPct += 0.10` |
| Power Potion | ~500g | +20% power damage | `powerDamageMultiplier ×= 1.20` |
| Shield Potion | ~500g | 20% damage reduction | `damageReductionMultiplier ×= 0.80` |
| Rage Potion | ~500g | +10% attack speed (ignores any cap) | `basicAttackSpeedMultiplier ×= 1.10` |

Price ~500g, may scale lightly with wave (final number tuned in implementation).

### 2.3 Lifecycle

- Add a `potionBuffs` layer (e.g. flags/counts for the four potions) to the gameplay
  state, **re-folded inside `applyLevelBonuses()`** after the base assignments and
  the runItems/equipment folds (so a level-up or equip change never erases them).
- **Buy:** spend gold, set the potion's flag, call `applyLevelBonuses()` to apply.
  Multiple different potions stack; buying the same one twice in a visit is a no-op
  (or refreshes — implementation detail, default: idempotent within a visit).
- **Clear:** when the shop opens at wave-clear (the same hook that resets
  `rerollsThisVisit`), clear all potion flags **before** the player buys, then
  recompute. Net effect: a potion bought in the shop after wave N applies during
  wave N+1's combat and is gone when wave N+1's shop opens — exactly one wave.
- "Rage ignores the cap": there is no hard attack-speed cap in code; the
  multiplicative fold simply applies — no clamp added.

---

## Part 3 — Price rework

`src/survivors/items/ItemTypes.ts` `RARITY_BASE_PRICE`:

| Rarity | Current | New | Factor |
|---|---|---|---|
| common | 60 | 150 | ×2.5 |
| rare | 120 | 300 | ×2.5 |
| epic | 220 | 550 | ×2.5 |
| legendary | 400 | 1000 | ×2.5 |
| **unique** | 520 | **5200** | **×10** |
| **mythic** | 900 | **9000** | **×10** |

`priceFor()` (`Equipment.ts`) and the 60% sell-back cascade automatically off these
constants — no call-site changes. Potion prices are defined separately (§2.2), not
via `RARITY_BASE_PRICE`.

---

## Testing

Pure-logic Vitest (the only kind this project runs):

- **`redSwap`** tiered mapping: wave 9 / 12 / 16 produce the correct types per role,
  including the wave-15 elite-wizard case.
- **`RunItems`**: `itemForTier(5) === 'elementalCore'`; granting it multiplies power
  damage ×10 and survives an `applyLevelBonuses()`-equivalent recompute (×10 per
  stack re-fold).
- **Potion buffs**: fold produces the right multipliers; clear-on-shop-open removes
  them; potions compose multiplicatively with level/equipment.
- **Prices**: `RARITY_BASE_PRICE` / `priceFor()` return the new values; sell-back is
  60% of the new price.

Enemy/boss meshes, ranged/AOE/nova FX, the shop potion row UI, and co-op guest
rendering are verified by manual playtest (no Babylon scene in Vitest) — reach
waves 15 and 25 solo, then a 2-client co-op smoke test.

## Out of scope / non-goals

- No general hero status-effect system (only the minimal FireBeetle burn field).
- No new boss attack types beyond reusing dash/pull + the elemental nova.
- No rebalance of waves 1–14 or existing items beyond the price constants.
- Potions are not part of random shop stock and do not reroll.
