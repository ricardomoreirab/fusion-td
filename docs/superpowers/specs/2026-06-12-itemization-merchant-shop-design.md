# Itemization & Traveling Merchant Shop — Design

**Date:** 2026-06-12
**Status:** Approved (brainstorming session)

## Goal

Give the survivors mode an MMO-style equipment layer with a gold economy and a
between-wave shop run by a funny goblin merchant ("Gribble"). Items are
class-flavored, powerful, and include 3-piece sets with big signature effects.

## Decisions made with the user

- Merchant appears **after every wave clear**.
- Shop opens by **walking up to the merchant** (it becomes accessible 5 s after
  the wave clears).
- **Wave waits for the shop** — no time pressure; next wave starts only on an
  explicit "To battle!" action.
- **Single-player first**; co-op is best-effort and guarded (no pause, local
  purchases, host-only wave gating).

## Current-state facts (verified)

- Kills already grant gold: `EnemyManager.ts:711` calls
  `playerStats.addMoney(enemy.getReward())`, which also mirrors the amount into
  XP via `xpSink` (`PlayerStats.ts:151-157`). Gold accrues but is invisible —
  no HUD display and no sink since the Armory shop was deleted.
- Wave clear currently starts a 2 s breather
  (`SurvivorsGameplayState.WAVE_BREATHER_SECONDS`) then auto-starts the next
  wave.
- PowerChoice/ReplaceSlot overlays fully pause single-player via
  `isPausedForOverlay()` (`SurvivorsGameplayState.ts:3169`); co-op never pauses.
- GLB assets exist: `assets/goblin_a_traveling_merchant.glb` (2.3 MB) and
  `assets/travelling_merchants_mobile_shop.glb` (1.3 MB). Static-prop loading
  pattern exists (`PropField.ts`); the module-level `_glbAssets` cache pattern
  exists in `SurvivorsGameplayState.ts:132-175`.
- `PlayerStats` exposes composable multiplier/additive fields (power damage,
  cooldown, attack speed, move speed, damage reduction, crit, lifesteal,
  knockback, extraAttacks, bonusMaxHealth).
- `RunItems` (milestone-boss drops) and its 4-slot HUD row are a separate
  system and stay untouched.

## Architecture

New bounded context `src/survivors/items/` plus shop modules:

| Module | Responsibility |
|---|---|
| `src/survivors/items/ItemTypes.ts` | `EquipSlot`, `Rarity`, `ItemDef`, `SetDef`, stat-mod types. |
| `src/survivors/items/ItemCatalog.ts` | Pure data: all items + sets (tables below). |
| `src/survivors/items/Equipment.ts` | Pure logic: per-run inventory (slot → item), buy / replace / sell-back gold math, stat application, set-bonus detection. Vitest-covered. |
| `src/survivors/items/ItemEffectRuntime.ts` | Unique-effect handlers driven by combat event hooks. |
| `src/survivors/shop/ShopStock.ts` | Pure logic: stock rolling (class filter, rarity weights, pity weighting, reroll pricing). Injectable RNG. Vitest-covered. |
| `src/survivors/shop/MerchantStand.ts` | World entity: GLB cart + goblin spawn/despawn, proximity detection, barks. |
| `src/ui/overlays/ShopOverlay.ts` | DOM shop UI (follows PowerChoice/Modal patterns). |

### Stat application (chosen approach: diff-apply)

Item stat mods are declarative, e.g. `{ powerDamagePct: 20, critChance: 0.05 }`.
On equip, `Equipment` multiplies the matching `PlayerStats` multiplier by
`(1 + pct/100)`; on unequip it divides it back out. Additive stats
(crit chance, lifesteal, bonusMaxHealth) add/subtract. Multiplication and
addition commute, so this stays correct while LevelSystem and RunItems mutate
the same fields. No consumer changes needed.

**New `PlayerStats` fields** (with their single consumption point):

- `basicDamageMultiplier` (default 1.0) — consumed in `HeroBasicAttack` damage
  calculation.
- `goldGainMultiplier` (default 1.0) — consumed at the `EnemyManager.ts:711`
  kill-reward grant (applies to gold AND the XP mirror, by design — gold-find
  items also accelerate leveling slightly; acceptable).
- `hpRegenPerSec` (default 0) — consumed by a tick in `SurvivorsGameplayState`.

### Unique-effect hook runtime

`ItemEffectRuntime` registers handlers keyed by effect id. Event sources are
wired by `SurvivorsGameplayState` (all hooks null-guarded; single-player
byte-identical when no items equipped):

- `onBasicHit(target, damage, isCrit)` — from `HeroBasicAttack` hit resolution.
- `onKill(enemy, reward)` — from the existing kill-reward path.
- `onHeroHurt(amount)` — from `HeroController` damage intake.
- `onPowerCast(slotIndex, def)` — from `PowerSlotManager`.
- `onGoldEarned(amount)` — from `PlayerStats.addMoney`.
- `tick(dt)` — per-frame (skipped while paused).

Required small API additions: `PowerSlotManager.recastFree(slotIndex)` (for
Echo), a projectile-spawn helper on `HeroBasicAttack` (for Ricochet).

**FX discipline:** every effect visual routes materials through
`getCachedMaterial` with bounded keys (element/colour) or
`dispose(false, true)` — per the project's transient-FX invariant.

## Economy

- **HUD gold pill** (coin glyph + amount) added next to the level pill in
  `src/ui/hud/Hud.ts`; updates per frame.
- Kill rewards unchanged at the source; `goldGainMultiplier` scales them.
- **Price formula:** `ceil(basePrice × (1 + 0.06 × waveNumber))`.
- **Sell-back: 60%** of price paid (project convention). Buying into an
  occupied slot auto-sells the old piece at 60%.
- Base prices by rarity: Common 60 g, Rare 120 g, Epic 220 g, Legendary 400 g.

## Equipment model

- **6 slots:** Weapon, Helmet, Chest, Legs, Boots, Trinket.
- One inventory per run (one champion per run ⇒ per-champion by nature).
  Items are class-gated (`classes: ChampionType[] | 'all'`).
- Fully reset in `exit()`.

## Item catalog (30 items, 4 sets)

Rarity colors: Common gray, Rare blue, Epic purple, Legendary gold.

### Sets (3 pieces each; 2pc minor bonus, 3pc signature effect)

**Berserker's Wrath** (barbarian) — 2pc: +20% attack speed.
3pc **RAGE**: below 50% HP → +60% all damage and basic swings cleave a full
circle; hero glows red.

| Piece | Slot | Rarity | Stats |
|---|---|---|---|
| Gorefang | Weapon | Rare | +20% basic damage |
| Skullcage of Rage | Helmet | Rare | +10% attack speed, +10 max HP |
| Bloodforged Plate | Chest | Epic | −12% damage taken, +30 max HP |

**Windrunner** (ranger) — 2pc: +15% move speed.
3pc **RICOCHET**: basic projectiles bounce to one nearby enemy (≤8 u) at 60%
damage.

| Piece | Slot | Rarity | Stats |
|---|---|---|---|
| Stormpiercer | Weapon | Rare | +15% basic damage, +10% attack speed |
| Galeskimmers | Boots | Rare | +12% move speed |
| Feather of the Zephyr | Trinket | Epic | +8% move speed, +8% crit chance |

**Archmage's Echo** (mage) — 2pc: −10% power cooldowns.
3pc **ECHO**: power casts have a 25% chance to instantly recast free (shimmer
FX).

| Piece | Slot | Rarity | Stats |
|---|---|---|---|
| Staff of Echoes | Weapon | Rare | +20% power damage |
| Mindcrown | Helmet | Rare | −8% power cooldowns |
| Runeweave Leggings | Legs | Epic | +15% power damage, +6% move speed |

**Goblin Fortune** (all classes) — 2pc: +25% gold from kills.
3pc **MIDAS**: 15% chance kills pay double; every 150 g earned releases a coin
nova (radius 6, damage `25 + 5 × wave`).

| Piece | Slot | Rarity | Stats |
|---|---|---|---|
| Gribble's Lucky Coin | Trinket | Rare | +10% gold, +5% crit chance |
| Penny-Pincher Loafers | Boots | Common | +8% move speed, +5% gold |
| Greedhelm | Helmet | Rare | +10% gold, +10 max HP |

### Standalone weapons (class-gated)

| Item | Class | Rarity | Effect |
|---|---|---|---|
| Butcher's Cleaver | Barbarian | Common | +12% basic damage |
| Worldsplitter | Barbarian | Legendary | +30% basic damage; every 6th swing: shockwave (radius 5, 40 dmg, 1 s stun) |
| Oakshot Bow | Ranger | Common | +12% basic damage |
| Comet Driver | Ranger | Legendary | +15% crit chance; crits explode (radius 3, 50% of hit damage as AoE) |
| Apprentice Focus | Mage | Common | +12% power damage |
| Emberwand | Mage | Epic | +15% power damage; basic attacks apply burn (fire DoT) |

### Standalone armor & trinkets (all classes)

| Item | Slot | Rarity | Effect |
|---|---|---|---|
| Ironbrow Visor | Helmet | Common | −8% damage taken |
| Crown of Focus | Helmet | Epic | +15% power damage, +8% crit chance |
| Padded Jerkin | Chest | Common | +25 max HP |
| Troll-Hide Vest | Chest | Rare | +20 max HP; regen 0.5% max HP/s |
| Thornmail Hauberk | Chest | Epic | −10% damage taken; when hit by contact damage, deal 3× that damage to enemies within 2.5 u |
| Marchers' Greaves | Legs | Common | +8% move speed |
| Juggernaut Legplates | Legs | Epic | −15% damage taken, +1 knockback on hit |
| Sprintweave Boots | Boots | Common | +10% move speed |
| Comet Treads | Boots | Epic | +12% move speed, +10% attack speed |
| Bloodvial | Trinket | Rare | +6% lifesteal |
| Chrono Charm | Trinket | Epic | When hit: refund 10% of current power cooldowns (1 s internal cooldown) |
| Executioner's Sigil | Trinket | Legendary | +15% crit chance, +0.35 crit damage |

## Shop stock rules

- **6 cards per visit.** Class-filtered; owned items excluded; soft cap of 2
  items per slot per roll.
- Rarity weights by wave:
  - Waves 1–3: C 60 / R 35 / E 5 / L 0
  - Waves 4–6: C 40 / R 40 / E 18 / L 2
  - Waves 7–10: C 25 / R 40 / E 28 / L 7
  - Waves 11+: C 15 / R 35 / E 35 / L 15
- **Pity weighting:** items belonging to a set the player owns ≥1 piece of get
  ×2.5 weight — 3-piece completion is achievable.
- **Reroll:** 25 g, +25 g per reroll within the same visit (resets next visit).

## Merchant world flow

1. **On wave clear:** caravan + Gribble spawn at the arena center with a dust
   puff. For 5 s the stand is "setting up" (no interaction).
2. **At 5 s:** shop opens — lantern glow / indicator, Gribble barks a greeting.
3. **Proximity open:** hero within 4 u → single-player pause
   (`isPausedForOverlay()` extended to include the shop) + ShopOverlay opens.
   Hysteresis: after closing, hero must leave 6 u before it reopens.
4. **Wave gating:** the next wave does NOT auto-start. It starts only when the
   player presses **"To battle!"** (shop footer) or the HUD **"⚔ Sound the
   horn"** button (shown while the merchant is open). Then the merchant packs
   up and departs (fade + dust), 3 s countdown, wave starts. The old 2 s
   auto-breather is replaced by this shopping phase.
5. **Death/exit:** merchant meshes, cloned materials, and animation groups are
   disposed per the GLB lifecycle rules; equipment + hooks fully cleared.

GLB loading reuses the `_glbAssets` cache; pivots re-centered (known FBX
gotcha); goblin idle animation played if the GLB has one.

### Gribble's humor

Rotating bark lines, shown as a world-space speech bubble (DOM element
projected from the goblin's position each frame) and as a quip line in the
shop header. Categories: arriving, browsing, after purchase, too poor,
leaving empty-handed. Tone: cheeky goblin capitalist
(*"For you? Triple price. Kidding! …Mostly."*,
*"Fell off a caravan. ALL of it fell off a caravan."*).

## Shop UI

DOM overlay following the Modal/PowerChoice pattern, styled via
`components.css` extensions, mobile-friendly:

- **Header:** Gribble name + rotating quip (updates on buy / poor / reroll).
- **Stock grid:** 6 item cards — rarity-colored frame, slot tag, icon glyph,
  name, price, stat lines, unique-effect text, set progress badge
  ("Goblin Fortune 1/3"). Hover/tap shows comparison vs the equipped piece.
  Unaffordable cards are dimmed with a red price.
- **Equipment strip:** the player's 6 slots (paper-doll style) with equipped
  item names + rarity colors.
- **Footer:** gold counter, Reroll button (with current cost), prominent
  **"To battle!"** button.

## Co-op (guarded, best-effort)

- Gold drops and equipment work locally per player; purchases are NOT
  replicated to the peer in v1 (no visual sync of merchant interactions).
- Shop overlay does not pause the sim in co-op (same rule as PowerChoice).
- Wave gating is host-only; the guest sees a "waiting for host" hint if the
  host is still shopping.
- Every hook is null-guarded; if any of this threatens the single-player
  byte-identical invariant, the co-op merchant is feature-flagged off and
  becomes a follow-up.

## Testing (Vitest, pure-logic modules)

- **ItemCatalog:** unique ids, valid slots/classes/rarities, every set has
  exactly 3 pieces and every set piece references an existing set.
- **Equipment:** buy/spend gold math, replace auto-sells at 60%, stat
  apply/remove round-trips exactly (multipliers return to baseline), 2pc/3pc
  set detection, reset clears everything.
- **ShopStock:** class filtering, owned-item exclusion, slot soft-cap, rarity
  weights per wave bracket, pity weighting, reroll cost escalation, injectable
  RNG determinism.
- **PlayerStats additions:** goldGainMultiplier applied to rewards; spending
  gold never touches XP.

## Out of scope (v1)

- Persistent meta-progression (inventory is per-run).
- Consumables, item upgrading/crafting, more than one merchant.
- Replicated co-op shopping / synced purchases.
- Equipment visible on the character model (stat/FX only, except set
  signature FX like the RAGE glow).
