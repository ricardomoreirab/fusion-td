# Co-op Itemization — Design Spec

**Date:** 2026-06-13
**Status:** Approved skeleton; ready for implementation plan.
**Depends on:** the single-player itemization feature (unique sets + mythic weapons), now on `main`.
**Branch:** `feat/coop-itemization`.

---

## 1. Goal

Bring the full single-player itemization experience to 2-player online co-op: each player has their own equipment, shop, gold, item effects, unique sets, and mythic weapon — **full parity** with solo. Today itemization is gated `if (solo)` (`SurvivorsGameplayState.ts:1207-1225`) with the comment *"Co-op gets NONE of this… byte-identical to main."* This lifts that gate without breaking host authority or the single-player path.

### Locked decisions
- **Scope:** full parity — flat stats, item effects, unique sets, mythic auras, move-speed.
- **Economy:** per-player gold (kills credited to the killer); independent per-player shops.
- **Shopping:** non-blocking and independent — co-op never pauses; each player shops any time; the wave auto-advances after the usual breather.
- **Crit:** rolled on the **acting client**; `DamageReportMsg` carries the post-crit `amount` + `isCrit`; the host stops re-rolling redirected reports.
- **Unique sets:** strictly **per-hero** — a player's set count is their own 6 equipped slots; no cross-player stacking.

---

## 2. How co-op works today (the relevant model)

- **Host authority.** One peer is `host`, one `guest` (`sourceHeroId: 1`). The host runs the entire authoritative simulation — enemy AI, waves, spawns, HP, death, rewards. The guest renders host-authoritative enemy copies (render-only `GuestEnemies`) and never owns enemy state.
- **Per-client systems already exist.** `PlayerSlot` (`SurvivorsGameplayState.ts:242-251`) holds `{stats, level, hero, powers, abilities, items}` per player; the local player's systems resolve through get/set accessors (`:279-291`), so existing `this.playerStats` / `this.equipment` call-sites already mean *the local client's slot*. The host does **not** hold a full `PlayerStats` for the guest (guest HP is the scalar `guestHeroHp`; the guest hero is simulated only for movement via `_driveGuestGhostFromInput`, the `coopGhost`).
- **How guest hero damage reaches enemies.**
  - Basic attacks route via `HeroBasicAttack.damageRouter` *before* `takeDamage` (`HeroBasicAttack.ts:348, 747-751`). The guest computes the final number locally — `effectiveDamage = this.damage * damageMultiplierProvider()` (`:134-136`), captured per-projectile at spawn (`:677-678`) — and sends that number.
  - Powers/abilities/DoT call `enemy.takeDamage()`; the guest's `Enemy.guestDamageRedirect` static (`Enemy.ts:1404-1408`) intercepts centrally, sends `(id, amount, element)` to the host, applies nothing locally. Parallel statics: `guestStatusRedirect`, `guestKnockbackRedirect` (`Enemy.ts:176-181`).
- **Host re-resolves.** `onDamageReport` (`SurvivorsGameplayState.ts:2070-2097`) validates range then `e.takeDamage(amount, element)`. Inside, the host **re-rolls crit** from `Enemy.critProvider` (`Enemy.ts:1415-1419`) which reads the host's `this.playerStats` (`:836-839`) — the central per-player-crit blocker.
- **Per-tick sync.** `SnapshotHero` = `id, x,y,z, ry, hp, anim, dx,dz, alive, level, xp` (`SnapshotBinary.ts:37-39`). No stats/loadout. `level`/`xp` are wired but the builder hardcodes `1, 0`.
- **Shop/pause/economy.** Solo opens a blocking shop at each wave clear; co-op does not (`soloNow` re-check `:1112`, breather `:1118-1119`). Co-op **never pauses** — `isPausedForOverlay()` returns `false` when a `coopSession` exists (`~:3339`). Reward callbacks fire **host-only** (`~:960-969`), so the guest currently earns no gold/XP.
- **Teammate ghost.** `coopGhost` is a full `Champion` (weapon anchor + animation), host-driven from guest input.

## 3. Why items are solo-only today

1. **Combat-hook asymmetry (the real blocker).** `ItemEffectRuntime` fires on `onBasicHit`/`onHeroHurt`, but on the guest these never fire: `HeroBasicAttack.applyHit` guards `if (!this.damageRouter) { onHitCallback?.(…) }` (`HeroBasicAttack.ts:348-372, 740-776`), and `setOnHurt` isn't wired in co-op. So effects have no trigger point, and the host can't reconstruct effect state from a bare `(id, amount, element)` report.
2. **Crit is a single host-global provider** keyed to the host's stats (`Enemy.critProvider` → `:836-839`).
3. **Stat→simulation coupling.** Move-speed feeds the host's authoritative guest-ghost integrator, which doesn't model per-run multipliers yet (`~:1615-1627`); the host doesn't simulate the guest's attack cadence.
4. **Byte-identical invariant.** The `if (solo)` gate is the cheapest guarantee while items are unproven in co-op.

**Already client-local (work for free once items are constructed per client):** damage multipliers folded into the guest's locally-computed attack number; lifesteal (`HeroBasicAttack.ts:351-353`); incoming damage-reduction (`HeroController`); extra-attacks (separate damage events); cooldown refunds (client-local power slots); attack-speed (the guest fires its own attacks).

---

## 4. Architecture & guiding principle

**Each client owns its hero's items end-to-end; the host stays the single authority for enemy HP.** The wire carries only *final numbers* and *cosmetic hints* — never item state for the host to re-simulate. All secondary effect damage/status/knockback flows through the three existing redirect statics, so there is exactly **one** authoritative HP-mutation site (`onDamageReport → takeDamage`).

Rejected alternative: the host fully simulates both heroes' item logic (mirror every client's equipment, effect timers, crit). That recreates the entire desync surface this design avoids.

## 5. Detailed design

### 5.1 Lift the gate *(S)*
Construct `equipment`, `equipTracker`, `rageGlow`, `itemEffects`, `shopOverlay`, `goblinPortrait`, `characterProfile` for *each local client* in co-op — i.e. run the body of the `if (solo)` block (`SurvivorsGameplayState.ts:1207-1225`) for co-op clients too. Everything resolves through the per-`PlayerSlot` accessors, so the change is additive. The combat-hook wiring inside that block changes (see 5.4).

### 5.2 Client-local stats *(M)*
Damage / lifesteal / regen / gold / cooldown / defense / attack-speed need **no host involvement**: each client folds its equipment into its own `PlayerStats` (`applyLevelBonuses` → `foldEquipmentStats`), and the guest's `damageMultiplierProvider` already multiplies in `basicDamageMultiplier` + `itemEffects.damageBonusMult()` (`:1034-1039`) once `itemEffects` is non-null. The host forwards the guest's final number unchanged.

### 5.3 Crit per-source *(M)*
One mechanism: **the acting client always rolls its own crit and sends the post-crit number + an `isCrit` flag; the host applies it verbatim and never re-rolls a redirected report.**
- Both guest damage paths carry the flag: the basic-attack number (computed in `HeroBasicAttack` with the guest's own crit) and the `guestDamageRedirect` report (powers/effects/DoT). The `DamageReportMsg` on the wire gains `isCrit: boolean` and carries the already-post-crit `amount`; `guestDamageRedirect`'s signature gains `isCrit` so the client passes its own roll.
- `onDamageReport` (`:2070-2097`) applies `amount` with the provided `isCrit` and **does not** invoke `Enemy.critProvider`. The host's *own* hero attacks keep rolling crit locally (the host is the acting client for its own hits) — `Enemy.critProvider` is only consulted for the host's local, non-report path.
- Net: crit is per-acting-player with **zero** crit-stat sync. The `critProvider` global stops being the single source of truth for redirected damage.

### 5.4 Item effects *(L — riskiest)*
Each client runs its own `ItemEffectRuntime` against its own hero pos/HP/power-slots:
- **Fire the combat hooks on the guest.** Split the `if (!this.damageRouter)` guard in `HeroBasicAttack` (`:348-372, 740-776`) so the **primary** hit still routes via `damageRouter` **and** `onHitCallback` fires locally with the post-crit damage. Wire `HeroController.setOnHurt` in co-op.
- **Secondary damage/status/knockback** from effects route through the existing `guestDamageRedirect`/`guestStatusRedirect`/`guestKnockbackRedirect` — same as today's powers. One authoritative HP mutation.
- **Role-aware enemy reads.** `buildEffectContext().enemiesNear` (`:3772-3833`) uses the role-aware `activeAttackEnemies()` (`:1029, 1138`) so it returns the render registry on the guest. `tryExecuteBelow` reads HP from the guest's render copies (HP is snapshot-synced) but the *execute kill* routes as damage to the host — never a local kill.

### 5.5 Per-player economy + XP *(M)*
- Host attributes each kill to the killing-blow's `sourceHeroId` and sends a per-hero reward delta (`goldGained`) — `onRewardCallback`/`onKillCallback` fire host-only today (`~:960-969`).
- The receiving client applies it to its own `PlayerStats.addGold` → `xpSink` → `levelSystem`. Both gold (for the shop) and XP/leveling advance per-player from the same delta.
- Populate `SnapshotHero.level/xp` per player (currently hardcoded `1,0`) so each side shows the correct partner level.

### 5.6 Cosmetics → teammate *(M)*
- Route every item-FX proc (the new `EffectFx.ring`/`beam`, plus `shockwave`/`coinNova`/`rageGlow`) and the **mythic-aura toggle** through `emitCoopFx(kind, x, z, tx?, tz?, hint)` with a **bounded-palette** colorHex literal in `hint` (never a lerped/computed hex — cache-key safety). The partner replays under `withFxReplay` via the existing `playRemoteFx` dispatch (`:2301`).
- The teammate's mythic aura attaches to the `coopGhost` Champion via a `setMythicAura` config message (a new `itemfx_mythic` fx kind carrying `{style, auraColor}`).
- **Rejoin:** on `onRequestState`, each client re-emits its current mythic-aura config so the partner re-syncs cosmetics.

### 5.7 Move-speed into the ghost sim *(M)*
Feed the guest's `moveSpeedMultiplier` into the host's `_driveGuestGhostFromInput` (unmodelled today, `~:1615-1627`) — sync the scalar (small addition to the per-tick hero state or a dedicated message) so the host integrates the guest ghost at the correct speed. `integrateMove.ts` already centralizes the math.

### 5.8 Unique sets + mythics
Strictly per-hero (5.2/5.4 already make each client compute its own set bonuses + effects). The mythic weapon's persistent aura is visible to the teammate via 5.6.

### 5.9 Shop UX *(S)*
Non-blocking and independent: allow `shopOverlay` to open in co-op without pausing (keep `isPausedForOverlay()` returning `false` for co-op); the sim runs on and the wave auto-advances after the breather. Each client rolls its own class-filtered stock and spends its own gold.

## 6. Protocol changes

- `DamageReportMsg` += `isCrit: boolean`.
- Reward path: a per-hero `goldGained` delta reaches the guest (extend the existing reward/kill message or add a `RewardMsg { heroId, gold }`).
- `SnapshotHero.level/xp`: populate per-player (fields already exist in the codec).
- FX channel: a new `kind: 'itemfx_mythic'` carrying `{style, auraColor}` in `hint` for aura on/off; reuse `ring`/`beam` kinds for proc cosmetics.
- Optional: guest `moveSpeedMultiplier` scalar (piggyback on hero state or a small message) for 5.7.

All new fields are additive; the codec/`SnapshotBinary` changes are versioned with the existing tick format.

## 7. The desync risk + de-risking

The risk concentrates in 5.3 + 5.4. De-risking:
- **Crit-as-number** collapses "host must know guest crit/effect state" into "host trusts a number" — which the redirect already does.
- **One HP-mutation site:** all effect secondary damage/status/knockback stays on `guestDamageRedirect`/`guestStatusRedirect`/`guestKnockbackRedirect` → `onDamageReport → takeDamage`. No effect ever mutates enemy HP locally on the guest.
- **No-echo:** cosmetic replays run under `withFxReplay` so replayed procs don't re-broadcast.
- **Focused Vitest suite** mirroring the existing damage-routing specs: guest effect proc → redirect → host applies **once** → echoes **one** `damageResult`; assert no double-application, no re-broadcast echo, and that an execute routes as damage (never a local guest kill).

## 8. Testing

Pure-logic Vitest + the existing co-op net suite (must stay green):
- Protocol round-trips for `DamageReportMsg.isCrit`, the reward delta, and `SnapshotHero.level/xp` populated.
- Crit-as-number: redirected report applies the given `amount`+`isCrit` and the host does **not** re-roll.
- Role-aware effect reads: `enemiesNear` returns the render registry on the guest; `tryExecuteBelow` never kills locally on the guest.
- No-double-apply / no-echo invariants (the focused suite in §7).
- Per-player economy: a kill attributed to hero N credits only hero N's gold/XP.
- Existing `Equipment`/`ShopStock`/`ItemEffectRuntime` specs unchanged (item logic is identical; only its wiring/role differs).

## 9. What stays unchanged

- **Single-player:** every change is gated by `coopSession` presence or sits behind the per-`PlayerSlot` accessors; the redirect statics are null in solo, so `takeDamage` behaves exactly as today.
- **Co-op without items would no longer exist** — co-op now has items. The "byte-identical to main" invariant is *intentionally retired* for co-op, replaced by the per-client item ownership model above. (Single-player remains the byte-identical-to-main reference for non-item behavior.)

## 10. Work breakdown (ordered)

1. *(S)* Lift the `if (solo)` gate — construct item systems per co-op client. `SurvivorsGameplayState.ts`.
2. *(M)* Confirm client-local stat flow (damage/lifesteal/regen/gold/cooldown/defense/attack-speed) needs no host change. `SurvivorsGameplayState.ts`.
3. *(M)* Crit per-source — `DamageReportMsg.isCrit`, client-side roll, host stops re-rolling reports. `Protocol.ts`, `Enemy.ts`, `SurvivorsGameplayState.ts`, codec.
4. *(L)* Combat-hook wiring on the guest — split the `damageRouter` guard, wire `setOnHurt`; effect secondary damage via redirects. `HeroBasicAttack.ts`, `HeroController.ts`, `SurvivorsGameplayState.ts`, `Enemy.ts`.
5. *(M)* Role-aware effect enemy reads. `SurvivorsGameplayState.ts` (`buildEffectContext`).
6. *(M)* Per-player economy + XP — kill attribution + reward delta + snapshot level/xp. `SurvivorsGameplayState.ts`, `Protocol.ts`, `SnapshotBinary.ts`, `EnemyManager.ts`.
7. *(M)* Move-speed into the ghost integrator. `SurvivorsGameplayState.ts`, `integrateMove.ts`.
8. *(M)* Cosmetic FX replication + mythic aura on `coopGhost` + rejoin re-emit. `CoopFx.ts`, `ItemFx.ts`, `ItemEffectRuntime.ts`, `Protocol.ts`, `Champion.ts`, `CoopSession.ts`.
9. *(S)* Non-blocking shop in co-op. `SurvivorsGameplayState.ts`, shop overlay.
10. *(S)* Focused desync/echo Vitest suite + protocol round-trip specs.

Riskiest: #3 + #4 (do together, behind the de-risking in §7). Everything else is additive and independently testable.

## 11. Out of scope / future
- Shared-loot or trading between players.
- A synchronized wave-clear ready-up pause (explicitly rejected — co-op stays non-blocking).
- Cross-player set/aura interactions (sets are strictly per-hero).
- Spectating a dead teammate's inventory.
