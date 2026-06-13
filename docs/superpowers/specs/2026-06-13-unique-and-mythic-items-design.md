# Unique Sets & Mythic Weapons — Design Spec

**Date:** 2026-06-13
**Status:** Approved skeleton; content reconciled & adversarially reviewed; ready for implementation plan.
**Touches:** `src/survivors/items/*`, `src/survivors/shop/ShopStock.ts`, `src/survivors/champions/Champion.ts`, `src/survivors/SurvivorsGameplayState.ts`, `src/survivors/coop/CoopFx.ts`, `src/ui/overlays/{ShopOverlay,CharacterProfile}.ts`, `src/ui/styles/components.css`.

---

## 1. Goal

Add two new item rarity tiers on top of the existing common/rare/epic/legendary system:

- **Unique (green `#3ddc84`):** exactly **one 6-piece set per class** (barbarian / ranger / mage) — one item per equip slot — with bonus tiers at **2 / 4 / 6** pieces, each incrementally stronger, the 6-piece being a build-defining signature effect. Class-locked: only shown in the shop to the matching champion, exactly like today's class sets. A completed unique set is the **strongest endgame chase** in a run.
- **Mythic (red `#ff3b30`):** **one weapon per class** — weapon-slot only — the single strongest weapon, with spectacular FX. A mythic **counts as its class's unique-set weapon piece** (wildcard), so equipping it instead of the unique weapon still completes the 6-piece bonus. You never choose between "best weapon" and "set bonus."

The existing 28-item catalog (4 three-piece sets + 16 standalone) stays as-is; this is purely additive content + the engine work to support it.

### Locked decisions (from brainstorming)
- New content = the new tiers only (no new common→legendary items).
- One mythic per class (3 total), class-tuned.
- Uniques are the endgame chase — 6-piece is build-defining.
- Mythic FX = persistent weapon aura + emissive glow + on-hit burst, built on the existing particle system with bounded cache keys.

---

## 2. Architecture & data-model changes

> Ground truth: items live in `src/survivors/items/`. `ChampionType = 'barbarian' | 'ranger' | 'mage'`. 6 slots: `weapon, helmet, chest, legs, boots, trinket`. `ItemStatMods` has 13 fields; pct fields are whole integers (`+20 ⇒ +20%`); `cooldownPct`/`damageTakenPct` are reductions. Effects run **Babylon-free** through an injected `EffectContext`; this is what makes them unit-testable.

### 2.1 `ItemTypes.ts`
- **`Rarity`** gains `'unique' | 'mythic'`. Because `RARITY_BASE_PRICE`, `RARITY_COLOR`, and `ShopStock.rarityWeights()`'s returned literal are all **exhaustive `Record<Rarity, …>`**, growing the union is a **type-required change in every one of them** — not optional polish. Updates:
  - `RARITY_BASE_PRICE`: `unique: 520`, `mythic: 900`.
  - `RARITY_COLOR`: `unique: '#3ddc84'`, `mythic: '#ff3b30'`. (Shop cards auto-style from the `--accent` custom property, so colors flow through with no overlay change; an optional `.shop-card--unique` / `.shop-card--mythic` selector in `components.css` can add a stronger frame/glow.)
  - `rarityWeights()` brackets: add `unique`/`mythic` columns to **all** brackets (see §6).
- **Generalize `SetDef` to N pieces with arbitrary tiers** (chosen over a parallel `UNIQUE_SETS` table — one aggregation path, one shop/profile path):
  ```ts
  export interface SetTier {
      pieces: number;            // threshold: 2, 3, 4, 6, …
      bonus?: ItemStatMods;      // stat bonus (2-/4-pc tiers)
      effect?: ItemEffectId;     // signature effect (3-pc classic, 6-pc unique)
      text: string;              // shop/profile description
  }
  export interface SetDef {
      id: string;
      name: string;
      pieces: string[];          // was [a,b,c]; now N item ids
      tiers: SetTier[];          // ascending by `pieces`
      kind: 'classic' | 'unique';
  }
  ```
  The 4 existing sets migrate mechanically to `kind:'classic'`, `tiers:[{pieces:2,bonus,…},{pieces:3,effect,…}]`. The 3 new unique sets are `kind:'unique'`, `tiers:[{2},{4},{6}]`.
- **`ItemDef`** gains:
  - `wildcardSetPiece?: boolean` — set `true` on mythic weapons. (See §2.3 — the *counting* falls out of `setId`; this flag is the explicit marker used by the runtime assert, shop labeling, and tests.)
  - `mythicFx?: MythicFxConfig` — `{ auraColor: string; style: string; onHitColor: string }` describing the persistent aura + on-hit burst (consumed by the Champion hook, §5).
- **Runtime assert:** a dev-mode invariant that `rarity === 'mythic' ⇒ slot === 'weapon'` (catalog hygiene; cheap one-liner over `ITEM_CATALOG` at module load).

### 2.2 `Equipment.aggregates()` — tiered set bonuses
Replace the hardwired `>=2` / `>=3` checks with a generic loop over each set's `tiers`: for every tier where `setCounts[set.id] >= tier.pieces`, fold `tier.bonus` (via the existing `foldMods`) and, if present, add `tier.effect` to the `effects` set. This handles classic (2/3) and unique (2/4/6) sets identically. `foldEquipmentStats.ts` is unchanged unless a new stat field is introduced (none is — all content uses existing `ItemStatMods` fields).

### 2.3 The wildcard mechanic (precise semantics)
**A mythic weapon simply carries `setId = <its class's unique set>` plus `wildcardSetPiece: true`.** Then:
- `aggregates()` already does `setCounts[setId]++` for **every** equipped item regardless of rarity (`Equipment.ts:90`), so the mythic naturally advances the unique set's 2/4/6 thresholds. **No special counting code is required beyond assigning the `setId`.**
- The mythic contributes **its own `mods`** (its strong stat line) and **its own `effectId`** (its mythic signature effect), *not* the unique weapon's. Set tier bonuses (`bonus2/4`, `effect6`) are fixed per `SetDef` and applied purely by count — independent of *which* pieces are equipped.
- Because the weapon slot holds exactly one item, you equip **either** the unique weapon **or** the mythic; both feed +1 to the set count, so the 6-piece is reachable on either path. The unique weapon stays relevant as the cheaper/earlier route to the 6-piece before a mythic drops.
- Net: mage wielding Nullbrand + the 5 other Voidcaller pieces gets **Singularity (mythic effect) + Arcane Cascade (6-pc set effect)** simultaneously — each with its own internal cooldown, so no recast loop.

**Spec invariant to encode in a test:** "wildcard mythic + 5 unique armor pieces ⇒ setCount = 6 ⇒ all three tiers active; the mythic's own mods are folded, not the unique weapon's."

### 2.4 New `EffectContext` / `EffectFx` surface (load-bearing prereqs)
The effects below need three additions to the Babylon-free effect interface (`ItemEffectRuntime.ts`), each implemented by the gameplay-state adapter:
- **`EffectContext.tryExecuteBelow(e: EffectEnemy, fraction: number): boolean`** — the adapter owns the real `Enemy` (which has public `getHealth()`/`getMaxHealth()`), so it can read HP and route a kill through the **normal death path** (death FX, lifesteal, gold). Returns whether it executed. This replaces the rejected "deal 99999 damage" magic number and the silently-degraded fallback. Needed by `apex_cleave`.
- **`EffectFx.ring(x, z, colorHex, radius)`** and **`EffectFx.beam(x0, z0, x1, z1, colorHex)`** — palette-constrained generic visuals (wrapping `ItemFx.spawnExpandingRing` / `spawnTrail`). `colorHex` must come from the finite palette (§5) so the underlying `getCachedMaterial` key stays bounded. `radius` is **geometry**, not material — scaling it (e.g. bigger quakes with momentum) is leak-safe because the material is keyed by color only. Effects reach visuals **only** through `ctx.fx` — never `scene` directly.

---

## 3. Unique Sets (content)

Three sets, one per class, 6 pieces (one per slot), class-locked (`classes:[thatClass]`), shared `setId`, rarity `unique`. Per-piece magnitude sits one notch above epic anchors; cumulative full-set power is the run's strongest. Tier ladders are equal-shaped across classes (2-pc = one strong stat line, 4-pc = multi-stat slab, 6-pc = signature effect). No class is strictly best: barbarian wins single-target sustain, ranger wins multi-target burst + mobility, mage wins cooldown-chaining AoE.

### 3.1 Barbarian — Titan's Oath (`titans_oath`)

| Slot | id | Name | Glyph | Mods | Flavor |
|---|---|---|---|---|---|
| weapon | `oathbreaker_maul` | Oathbreaker Maul | 🔨 | `basicDamagePct:24, attackSpeedPct:8` | Made a solemn vow once. Broke it. Broke a lot of things, actually. |
| helmet | `browplate_of_the_titan` | Browplate of the Titan | 🪖 | `maxHealth:30, damageTakenPct:8` | Headbutting is a valid opening, a valid middle, and a valid ending. |
| chest | `ribcage_bulwark` | Ribcage Bulwark | 🛡 | `maxHealth:45, hpRegenPctPerSec:0.006` | Bigger than your ribcage. Roomier, too. Don't ask how it knows. |
| legs | `quakestride_faulds` | Quakestride Faulds | 🦿 | `damageTakenPct:12, knockback:2` | Each step files a noise complaint with the bedrock. |
| boots | `stampede_sabatons` | Stampede Sabatons | 👢 | `moveSpeedPct:12, attackSpeedPct:6` | There is no brake pedal. There was never a brake pedal. |
| trinket | `heart_of_the_warbeast` | Heart of the Warbeast | 🫀 | `lifesteal:0.07, maxHealth:20` | Still beating. Still angry. Still yours now, somehow. |

| Pieces | Bonus | Text |
|---|---|---|
| 2 | `attackSpeedPct:15` | +15% attack speed |
| 4 | `basicDamagePct:18, maxHealth:40, lifesteal:0.05` | +18% basic damage, +40 max HP, +5% lifesteal |
| 6 | effect `earthbreaker` | EARTHBREAKER: every 4th hit quakes the ground at your target — AoE damage + 1s stun, growing with each swing |

### 3.2 Ranger — Tempest Stalker (`tempest_stalker`)

| Slot | id | Name | Glyph | Mods | Flavor |
|---|---|---|---|---|---|
| weapon | `stormcaller_longbow` | Stormcaller Longbow | 🏹 | `basicDamagePct:18, attackSpeedPct:12` | Pull the string and somewhere, distantly, thunder agrees. |
| helmet | `hawkeye_hood` | Hawkeye Hood | 🦅 | `critChance:0.09, attackSpeedPct:6` | Sees the bullseye. Also your bad posture. Sit up. |
| chest | `stalkers_raincloak` | Stalker's Raincloak | 🧥 | `maxHealth:30, damageTakenPct:8` | Waterproof, goblinproof, and faintly smug about both. |
| legs | `windstep_chaps` | Windstep Chaps | 🌬 | `moveSpeedPct:10, critChance:0.06` | The legs that taught the wind to keep up. |
| boots | `galewalker_boots` | Galewalker Boots | 👢 | `moveSpeedPct:12, attackSpeedPct:8` | Outran a tornado once. The tornado wants a rematch. |
| trinket | `stormeye_pendant` | Stormeye Pendant | 🌩 | `critChance:0.10, critDamage:0.30` | It blinks once per crit. It has not blinked in some time. |

| Pieces | Bonus | Text |
|---|---|---|
| 2 | `attackSpeedPct:15` | +15% attack speed |
| 4 | `critChance:0.10, critDamage:0.30, moveSpeedPct:8` | +10% crit chance, +0.30 crit damage, +8% move speed |
| 6 | effect `tempest_volley` | TEMPEST VOLLEY: every 8th hit fans 3 storm arrows; every 4th hit chains lightning to 2 nearby foes |

### 3.3 Mage — Voidcaller's Sequence (`voidcallers_sequence`)

| Slot | id | Name | Glyph | Mods | Flavor |
|---|---|---|---|---|---|
| weapon | `voidcallers_scepter` | Voidcaller's Scepter | 🔱 | `powerDamagePct:26, cooldownPct:6` | It hums in a key that makes reality apologize. |
| helmet | `circlet_of_the_ninth_truth` | Circlet of the Ninth Truth | 🜨 | `powerDamagePct:10, cooldownPct:10` | Knows eight forbidden things. The ninth is where you left your keys. |
| chest | `shroud_of_quiet_stars` | Shroud of Quiet Stars | 🌌 | `maxHealth:35, damageTakenPct:10` | Woven from the night sky. The night sky is still mad about it. |
| legs | `leggings_of_drifting_aeons` | Leggings of Drifting Aeons | 🪐 | `powerDamagePct:16, moveSpeedPct:8` | Each step happens slightly before you decide to take it. |
| boots | `treads_of_the_event_horizon` | Treads of the Event Horizon | 🕳 | `moveSpeedPct:10, cooldownPct:6` | Nothing escapes them. Especially not the floor. |
| trinket | `oculus_of_the_devourer` | Oculus of the Devourer | 👁 | `powerDamagePct:12, critChance:0.10` | It blinks when you're not looking. You are never not looking. |

| Pieces | Bonus | Text |
|---|---|---|
| 2 | `powerDamagePct:12` | +12% power damage |
| 4 | `powerDamagePct:12, cooldownPct:12` | +12% power damage, −12% power cooldowns |
| 6 | effect `arcane_cascade` | ARCANE CASCADE: every power cast bursts a void nova, arcs to 3 foes, and refunds 8% of all cooldowns |

> **CDR budget (review fix #5).** `cooldownMult` has **no floor/clamp** in the engine (`PowerSlotManager.ts:271`, `foldEquipmentStats.ts:32` multiply straight through), so gear CDR must be bounded by hand. Boots trimmed `10→6`. Totals now: unique-weapon path = scepter 6 + helmet 10 + boots 6 + 4-pc 12 = **−34%**; mythic-weapon path = Nullbrand 10 + helmet 10 + boots 6 + 4-pc 12 = **−38%** (just under the "−40% feels mandatory" line). XP-level `×0.92/level` stacks multiplicatively on top — that is the existing system and applies to all builds; the spec bounds only the gear contribution.

---

## 4. Mythic Weapons (content)

One per class, slot `weapon`, rarity `mythic`, `wildcardSetPiece: true`, `setId` = the class unique set (so it completes the 6-piece). Each beats the legendary +30% basic anchor on its primary axis and headlines a distinct spectacular effect.

| Class | id | Name | Glyph | Mods | effectId | Flavor |
|---|---|---|---|---|---|---|
| barbarian | `skullsplitter_apex` | Skullsplitter, the Apex | 🪓 | `basicDamagePct:38, attackSpeedPct:10, lifesteal:0.05, knockback:2` | `apex_cleave` | The last thing 1,000 goblins agreed on: "Yeah, that'll do it." |
| ranger | `windsong_stormbow` | Windsong, the Storm Bow | 🌪 | `basicDamagePct:32, attackSpeedPct:18, critChance:0.15, critDamage:0.30` | `storm_quiver` | Every arrow leaves a little weather behind. Bring a coat. |
| mage | `nullbrand_devouring_staff` | Nullbrand, the Devouring Staff | 🌑 | `powerDamagePct:32, cooldownPct:10, critChance:0.08, critDamage:0.12` | `singularity` | It eats spells, screams, and the occasional goblin. Mostly the goblin. |

`mythicFx` per weapon (`style` is a descriptor string the Champion aura hook maps to a particle preset):
- **Skullsplitter** — `auraColor:'#ff3a1f'`, `style:'embers'` (blood-red rising sparks), `onHitColor:'#ff7a2f'`.
- **Windsong** — `auraColor:'#5fb8ff'`, `style:'ribbon'` (cyan storm ribbon that brightens as charge builds), `onHitColor:'#bfe9ff'`.
- **Nullbrand** — `auraColor:'#7a18ff'`, `style:'motes'` (void-purple, inward-spiraling motes), `onHitColor:'#b070ff'`.

---

## 5. New Effects (6)

All run through the real `ItemEffectRuntime` hooks (`onBasicHit`, `onPowerCast`, `onHeroHurt`, `onGoldEarned`, `tick(dt)`, `damageBonusMult()`) and the `EffectContext`. All are deterministic counters/timers (no `Math.random`/`Date.now`; `ctx.rng()` only where a roll is genuinely meaningful — none here need it). Each adds: an `ItemEffectId`, a tuning-constant block, an `EFFECT_TEXT` line, and `ctx.fx` visuals. Reentrancy guards mirror the existing `inEcho`/`inDoublePay` pattern.

**FX palette (finite, bounded cache keys):** `#c47a2c #ff3a1f #ff7a2f #7fd4ff #bfe9ff #5fb8ff #8a3cff #b070ff #7a18ff`.

### 5.1 `earthbreaker` — Titan's Oath 6-pc
- **Mechanic:** `onBasicHit` counter; every `QUAKE_EVERY_HITS` hits (gated by `quakeCd` decremented in `tick`), erupt a quake **centered on the struck enemy**: `enemiesNear(tx,tz,QUAKE_RADIUS)` take `QUAKE_BASE_DAMAGE + momentum*QUAKE_DAMAGE_PER_STACK` as `physical` + `stun(e, QUAKE_STUN_S)`. `momentum` +1 per basic hit, caps at `MOMENTUM_MAX`, resets to 0 on quake — sustained swinging detonates bigger quakes. (Draft's "shove" dropped — no displacement primitive; stun + ring sell the shock.)
- **Hooks:** `onBasicHit`, `tick`.
- **Tuning:** `QUAKE_EVERY_HITS=4, QUAKE_COOLDOWN_S=1.2, QUAKE_RADIUS=4.5, QUAKE_BASE_DAMAGE=45, QUAKE_DAMAGE_PER_STACK=6, MOMENTUM_MAX=12, QUAKE_STUN_S=1, QUAKE_ELEMENT='physical'`.
- **FX:** `ctx.fx.ring(tx, tz, '#c47a2c', QUAKE_RADIUS * (1 + momentum/MOMENTUM_MAX*0.6))` — radius scales with momentum (geometry, leak-safe), so quakes visibly grow.

### 5.2 `tempest_volley` — Tempest Stalker 6-pc
- **Mechanic:** Two `onBasicHit` counters. (a) **Volley** — every `TEMPEST_EVERY_HITS` hits (gated by `volleyCd`), hit up to `TEMPEST_FAN_COUNT` nearest distinct foes within `TEMPEST_FAN_RANGE` for `damage*TEMPEST_FAN_FRACTION` as `storm`. (b) **Static chain** — every `TEMPEST_STATIC_EVERY` hits, lightning leaps from the target to up to `TEMPEST_CHAIN_TARGETS` foes within `TEMPEST_CHAIN_RANGE` for `damage*TEMPEST_CHAIN_FRACTION` as `storm`.
- **Hooks:** `onBasicHit`, `tick`.
- **Tuning:** `TEMPEST_EVERY_HITS=8, TEMPEST_COOLDOWN_S=0.5, TEMPEST_FAN_COUNT=3, TEMPEST_FAN_RANGE=9, TEMPEST_FAN_FRACTION=0.7, TEMPEST_STATIC_EVERY=4, TEMPEST_CHAIN_TARGETS=2, TEMPEST_CHAIN_RANGE=6, TEMPEST_CHAIN_FRACTION=0.45, TEMPEST_ELEMENT='storm'`.
- **FX:** per fan arrow `ctx.fx.beam(tx,tz,ex,ez,'#7fd4ff')`; per chain `ctx.fx.beam(...,'#bfe9ff')` + `ctx.fx.ring(tx,tz,'#7fd4ff',1.2)`.

### 5.3 `arcane_cascade` — Voidcaller's Sequence 6-pc
- **Mechanic:** `onPowerCast`, gated by `cascadeCd` + `inCascade` reentrancy flag. Hero-centered void nova: `enemiesNear(hx,hz,CASCADE_NOVA_RADIUS)` take `CASCADE_NOVA_BASE + CASCADE_NOVA_PER_WAVE*wave()` as `arcane`, then arc to up to `CASCADE_ARC_TARGETS` further foes at `CASCADE_ARC_FRACTION`. Each detonation `refundCooldownPct(CASCADE_CD_REFUND)` on all slots — chaining accelerates the next, bounded by the powers' own cooldowns. (Confirmed no loop: `refundCooldownPct` only shortens `cooldownRemaining`, never calls `cast()`; `recastFree`/echo skips `onCastCallback`.) Internal cooldown ensures a multi-projectile cast fires the nova once.
- **Hooks:** `onPowerCast`, `tick`.
- **Tuning:** `CASCADE_NOVA_BASE=40, CASCADE_NOVA_PER_WAVE=6, CASCADE_NOVA_RADIUS=5, CASCADE_ARC_TARGETS=3, CASCADE_ARC_RANGE=8, CASCADE_ARC_FRACTION=0.5, CASCADE_CD_REFUND=0.08, CASCADE_COOLDOWN_S=0.5, CASCADE_ELEMENT='arcane'`.
- **FX:** `ctx.fx.ring(hx,hz,'#8a3cff',CASCADE_NOVA_RADIUS)`; per arc `ctx.fx.beam(hx,hz,ex,ez,'#b070ff')`.

### 5.4 `apex_cleave` — Skullsplitter mythic
- **Mechanic:** `onBasicHit`. (1) **Cleave** — `enemiesNear(tx,tz,CLEAVE_RADIUS)` (excluding the struck target) take `damage*CLEAVE_FRACTION` as `physical` (a wide arc, guaranteed every hit). (2) **Execute** — for the target and each cleaved foe, `ctx.tryExecuteBelow(e, EXECUTE_HP_FRACTION)` routes a real kill through the normal death/lifesteal/gold path when the enemy is at/below 12% HP. (Draft's "bloodfrenzy attack-speed ramp" dropped — no runtime attack-speed primitive; the weapon's lifesteal on extra kills is the sustain payoff.)
- **Hooks:** `onBasicHit`.
- **Tuning:** `CLEAVE_RADIUS=3, CLEAVE_FRACTION=0.55, EXECUTE_HP_FRACTION=0.12, CLEAVE_ELEMENT='physical'`.
- **FX:** cleave `ctx.fx.ring(tx,tz,'#ff3a1f',CLEAVE_RADIUS)`; execute `ctx.fx.ring(ex,ez,'#ff7a2f',1.5)`.
- **Depends on prereq:** `EffectContext.tryExecuteBelow` (§2.4). Do **not** ship the silent "fallback" that drops the execute promise.

### 5.5 `storm_quiver` — Windsong mythic
- **Mechanic:** **Charge** builds on `onBasicHit` (`charge += STORM_CHARGE_PER_HIT`). At `charge >= STORM_CHARGE_MAX`: strike up to `STORM_STRIKE_TARGETS` nearest foes within `STORM_STRIKE_RADIUS` for `STORM_STRIKE_BASE + STORM_STRIKE_PER_WAVE*wave()` as `storm` + `stun(e, STORM_STUN_S)`, reset charge to 0. (Review fixes #2 & #6: **crit-bonus-charge removed** — `onBasicHit` has no crit flag and gets pre-crit damage; **passive squall removed** — it was free always-on DPS. Output is now fully gated on the player attacking.)
- **Hooks:** `onBasicHit`.
- **Tuning:** `STORM_CHARGE_PER_HIT=1, STORM_CHARGE_MAX=10, STORM_STRIKE_TARGETS=5, STORM_STRIKE_RADIUS=8, STORM_STRIKE_BASE=45, STORM_STRIKE_PER_WAVE=6, STORM_STUN_S=0.6, STORM_ELEMENT='storm'`.
- **FX:** per discharge target a vertical `ctx.fx.beam` (`'#5fb8ff'`) capped by `ctx.fx.ring(ex,ez,'#bfe9ff',STORM_STRIKE_RADIUS)`; the Champion aura flares on release (via the aura hook, §7) and settles as charge resets.

### 5.6 `singularity` — Nullbrand mythic
- **Mechanic:** `onPowerCast`, gated by `singularityCd` + `inSingularity` flag. Count `n = enemiesNear(hx,hz,SINGULARITY_RADIUS).length`; deal `(SINGULARITY_BASE + SINGULARITY_PER_WAVE*wave()) * (1 + min(SINGULARITY_CLUSTER_CAP, (n-1)*SINGULARITY_CLUSTER_BONUS))` as `arcane` to all in radius — rewards grouped foes. (Draft's literal "pull inward" dropped — no displacement primitive; the cluster-damage bonus is the "punish clumping" stand-in, the inverted-feel ring sells the implosion.) Stacks with Arcane Cascade when the full set is worn; separate internal cooldowns ⇒ no loop.
- **Hooks:** `onPowerCast`, `tick`.
- **Tuning:** `SINGULARITY_RADIUS=6, SINGULARITY_BASE=70, SINGULARITY_PER_WAVE=9, SINGULARITY_CLUSTER_BONUS=0.06, SINGULARITY_CLUSTER_CAP=0.6, SINGULARITY_COOLDOWN_S=0.6, SINGULARITY_ELEMENT='arcane'`.
- **FX:** paired rings for implode→burst read: `ctx.fx.ring(hx,hz,'#7a18ff',SINGULARITY_RADIUS)` + `ctx.fx.ring(hx,hz,'#b070ff',1.5)`.

---

## 6. Shop & economy

`priceFor()` already scales any rarity by `(1 + 0.06·wave)`. Additions:

**`RARITY_BASE_PRICE`:** `unique: 520`, `mythic: 900`.

**`rarityWeights()` — all brackets get unique/mythic columns** (type-required). Unique gated ≥ wave 8, mythic ≥ wave 11:

| Bracket | common | rare | epic | legendary | unique | mythic |
|---|---|---|---|---|---|---|
| waves 1–4 | 60 | 30 | 10 | 0 | 0 | 0 |
| waves 5–7 | 35 | 38 | 22 | 5 | 0 | 0 |
| waves 8–10 | 18 | 34 | 30 | 12 | 6 | 0 |
| waves 11–14 | 8 | 24 | 32 | 18 | 13 | 5 |
| waves 15+ | 4 | 16 | 30 | 22 | 20 | 8 |

**Set pity (review fix #8):** today `buildWeightedPool` applies a flat `PITY_WEIGHT_MULT=2.5` once when `setCounts[setId] >= 1` (binary). A 6-piece grind needs a proportional curve — rewrite to multiply a unique piece's weight by `1 + 0.5·piecesOwnedInThatSet` so a near-complete set is much likelier to finish. (Classic 3-piece sets can keep the flat 2.5 or adopt the same curve.) Per-class filtering (`ShopStock.ts:43`) already hides off-class items, so each champion only ever sees its own unique set + mythic.

---

## 7. FX & Champion integration

Items have **zero hero visuals today**; the mythic aura is **net-new engineering** (review fix #4), not "reuse." Required:
- **`Champion.setMythicAura(cfg: MythicFxConfig | null)`** — builds **one** persistent particle system at the existing `glbWeaponAnchor` (the invisible mesh parented to the weapon bone), plus an emissive glow where the mesh supports a tintable `_weapon` material (barbarian/Aulus) — else aura-only (ranger/mage meshes bake the weapon into the body material). Idempotent: diff against the last-applied mythic id; rebuild only on change; pass `null` to tear down.
- **Drive point:** call it from the equipment recompute in `applyLevelBonuses()` (where `setActiveEffects()` already runs at wave-clear, the only time equipment changes). No new per-equip event needed.
- **Disposal:** `exit()` must dispose the persistent system (a never-disposed persistent PS is a guaranteed cross-run leak per the shadow/aura disposal history). Name its meshes/materials with a clear prefix (e.g. `mythicAura_`) so `checkResourceBudget()` can attribute any leak.
- **Leak rules (non-negotiable):** transient on-hit bursts via `ctx.fx.ring/beam` → `ItemFx` with **bounded** palette-hex cache keys (`itemfx_ring_${hex}` / `itemfx_trail_${hex}`); meshes `dispose(false,false)` (cache-owned material); fade via `mesh.visibility`; never `Math.random`/instance-id keys.
- **Co-op:** mythic aura config (id/color) + the new on-hit fx procs must be added to the `CoopFx` channel (`emitCoopFx`/`withFxReplay`) so the guest sees the host's aura and bursts. Host already simulates all effects; single-player stays byte-identical (null-guarded).

---

## 8. Testing (pure-logic Vitest, project convention)

The effect runtime is Babylon-free, so effects are unit-testable with a fake `EffectContext`/`EffectFx` (as the existing effect tests do). Plan:
- **Equipment aggregation:** N-piece tier thresholds fire at exactly 2/4/6; classic 3-piece sets still fire at 2/3 (regression); `foldMods` math (mult vs additive) for the new bonuses; idempotent recompute via `foldEquipmentStats`.
- **Wildcard:** mythic + 5 unique armor ⇒ count 6 ⇒ all tiers; the mythic's **own** mods + **own** effect are applied (not the unique weapon's); unique-weapon path and mythic path both reach 6; mythic effect + 6-pc effect both active.
- **ShopStock:** new weights per bracket; unique gated ≥8, mythic ≥11; class filtering hides off-class uniques/mythics; proportional set-pity `1+0.5·n`; `mythic ⇒ weapon` assert.
- **Effects:** counter/cooldown/momentum/charge/cluster logic for all 6 with a fake ctx — e.g. earthbreaker fires every 4th hit and scales with momentum; `apex_cleave` calls `tryExecuteBelow` at ≤12% HP; `arcane_cascade`/`singularity` fire once per multi-projectile cast and don't recurse.
- **Type/text:** `describeMods` / `EFFECT_TEXT` entries for all new content render.

---

## 9. Implementation baseline & prerequisites

- **Baseline check first:** run `npx tsc --noEmit` and `npm test` to confirm a clean tree before starting. (The IDE/LSP showed stale false-positive diagnostics for `setOnHit`/`setOnHurt`/`cameraZoom.spec` during design; direct reads confirm `setOnHit`@`HeroBasicAttack.ts:150` and `setOnHurt`@`HeroController.ts:397` exist. Trust `tsc`, not the IDE — per CLAUDE.md. Resolve any *real* pre-existing failure before layering this feature on top.)
- **Load-bearing prereqs (the feature, not optional):** (1) `Rarity` union growth → update `RARITY_BASE_PRICE`/`RARITY_COLOR`/all `rarityWeights` literals; (2) `SetDef` → `tiers[]` + migrate the 4 existing sets; (3) `aggregates()` generic tier loop + wildcard-via-`setId`; (4) `EffectContext.tryExecuteBelow` + `EffectFx.ring`/`beam`; (5) `Champion.setMythicAura` + equip-recompute drive + `exit()` disposal; (6) 6 new `ItemEffectId`s wired in `ItemEffectRuntime`.

## 10. Out of scope / future
- New common→legendary items or additional classic sets (explicitly deferred).
- Per-mythic unique 3D weapon meshes (we tint/aura the existing mesh; no new GLBs).
- Balance retuning of existing items.
- More than one unique set or one mythic per class.
```
