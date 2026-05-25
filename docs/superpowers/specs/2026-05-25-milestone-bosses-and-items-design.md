# Milestone Bosses & Run Items — Design

**Status:** Draft
**Date:** 2026-05-25
**Mode affected:** Survivors only

## Summary

Every 5th wave in survivors mode spawns a hardened "milestone" boss with
escalating stats and a lunge/dash AI that makes straight-line kiting fail.
The first time the player kills the wave 5, 10, 15, and 20 milestone bosses,
a unique permanent run item drops:

- Wave 5 → **Lifesteal** (heal % of damage dealt)
- Wave 10 → **Multishot/Cleave** (extra projectile for ranged, extra follow-up
  spin for melee)
- Wave 15 → **Knockback** (basic-attack hits push enemies)
- Wave 20 → **Attack Speed** (basic-attack speed ×2)

Items are stack-aware (one stack per drop today; the system is built so a
future change can drop the same item again at wave 25/30/… without rework).
Boss waves at wave 25 and beyond still spawn the milestone boss (tier 5+) for
the harder fight, but no new item drops.

## Goals

1. Give every 5th wave a meaningful identity beyond "more HP enemy".
2. Reward bossing with a permanent run buff that visibly changes how the hero
   plays for the rest of the run.
3. Reuse existing systems (perimeter spawn, elite-orb pickup pattern, HeroHud
   slots) so the change is small in surface area.

## Non-goals

- No new boss meshes — all four milestone bosses reuse the existing Abyssal
  Titan model from `BossEnemy`.
- No item choice overlay — each wave's item is fixed; pickup auto-grants.
- No tooltip / item-detail UI — pickup floating text + obvious icons are
  enough for v1.
- No fullscreen boss HP banner — the world-space health bar above the boss
  is sufficient at the boss's size.
- No re-balance of the existing shop, powers, or champion base stats.

## User-facing behavior

### The boss fight

When a milestone wave starts, the single boss in the wave config spawns as a
`MilestoneBoss` instead of the standard `BossEnemy`. Tier is `currentWave / 5`.

Stat scaling (multipliers applied on top of the current `BossEnemy` base
500 HP × wave difficulty × 1.1 boss bonus):

| Tier | Wave | HP mult | Speed mult | Contact DPS mult |
|------|------|---------|------------|-------------------|
| 1    | 5    | ×1.8    | ×1.4       | ×1.0              |
| 2    | 10   | ×2.6    | ×1.5       | ×1.1              |
| 3    | 15   | ×3.4    | ×1.6       | ×1.2              |
| 4    | 20   | ×4.4    | ×1.7       | ×1.3              |
| 5+   | 25+  | `4.4 + 0.6 × (tier − 4)` (wave 25 = ×5.0, wave 30 = ×5.6, …) | ×1.7 | ×1.3 |

Behavior unlocks per tier:

| Tier | Lunge | Sidestep predict | Enrage @ 30% HP | Faster lunge cadence |
|------|-------|-------------------|-----------------|----------------------|
| 1    | ✓     | —                 | —               | —                    |
| 2    | ✓     | ✓                 | —               | —                    |
| 3    | ✓     | ✓                 | ✓               | —                    |
| 4+   | ✓     | ✓                 | ✓               | ✓                    |

These numbers are the starting point; expect to re-tune after a single
playtest run through wave 20.

### Lunge/dash AI

The boss runs a four-state machine:

1. **walking** — seek the hero using the inherited `Enemy.seekTarget`
   behavior. Cooldown timer counts down toward the next lunge. Cooldown is
   4.0 s at tier 1, 3.5 s at tier 2, 3.0 s at tier 3, 2.4 s at tier 4+.
2. **telegraph** — boss roots in place for 0.6 s. A red ring is drawn on
   the ground pointing toward the locked dash destination so the player can
   read the direction. **Direction lock:**
   - Tier 1: hero's current position.
   - Tier 2+: hero's current position plus `heroVelocity * 0.4` (leads
     straight-line strafers).
3. **dashing** — boss travels 6 units toward the locked direction at
   roughly 12 u/s (≈0.5 s of dash). Cannot turn during the dash. Contact
   damage is doubled during this state.
4. **recover** — 0.4 s root, then back to **walking**.

**Enrage (tier 3+).** When HP drops below 30%, the lunge cooldown halves
and the walking speed gets an additional ×1.4 multiplier (one-shot; stacks
with the tier speed mult). Visual: ground glow disc switches from magenta
to red and the body emissive pulses faster.

### Item drop & pickup

When a `MilestoneBoss` dies, the `EnemyManager` fires
`onMilestoneBossDeath(position, waveTier)`. The handler in
`SurvivorsGameplayState`:

1. Looks up the item for that tier (`ITEM_BY_TIER`). Returns if the tier
   has no mapped item (tier 5+) or if `runItems.hasItem(itemId)` is already
   true (no-op for re-drops, today's behavior).
2. Spawns an `ItemDrop` at the boss's position.

The `ItemDrop` is modeled on `PowerDrop`:

- Mesh: faceted icosahedron gem (~0.5 unit) plus a low-alpha emissive
  pillar of light behind it so it reads from across the arena.
- Color per item: red lifesteal, gold multishot/cleave, blue knockback,
  yellow-white attack speed.
- Hovers and slowly rotates; magnet radius and acceleration mirror
  `PowerDrop`.
- On hero contact: pickup flash, `RunItems.grant(itemId)`, a brief 300 ms
  0.6× time-scale slow-mo, a `+ <Item Name>` float text via
  `DamageNumberManager`, and a `HeroHud.pulseItem(itemId)` HUD pulse.

No choice overlay. The item is determined by the wave, not by the player.

### Item effects (per stack)

`PlayerStats` gains four new public fields, all default to zero / one:

```ts
public lifestealPct: number = 0;    // fraction of damage healed back to hero
public extraAttacks: number = 0;    // ranged: +N projectiles; melee: +N follow-up spins
public knockbackOnHit: number = 0;  // world units pushed per hit
```

`basicAttackSpeedMultiplier` already exists; the attack-speed item multiplies
into it.

| Item ID                         | Per-stack effect                  | Stack-1 result                                                   |
|---------------------------------|-----------------------------------|------------------------------------------------------------------|
| `lifesteal`                     | `lifestealPct += 0.05`            | Hero heals 5 % of damage dealt (capped at maxHealth)             |
| `multishotCleave` (Barb)        | `extraAttacks += 1`               | Each basic = 1 main spin + 1 follow-up spin 0.15 s later         |
| `multishotCleave` (Ranger/Mage) | `extraAttacks += 1`               | Each basic fires 2 projectiles in a ±10° fan                     |
| `knockback`                     | `knockbackOnHit += 1.0` (units)   | Every hit pushes the enemy ~1 unit radially away from the hero   |
| `attackSpeed`                   | `basicAttackSpeedMultiplier *= 2` | Basic attack speed doubled                                       |

Numbers chosen to be tunable; expect to revisit after playtest. The
multishot fan is ±10° in total (2 = ±5°, 3 = −10°/0°/+10°, 4 = ±5°/±15°,
etc).

The hero-class branching for `multishotCleave` happens inside
`RunItems.grant`. It checks the champion type once and writes to the same
`extraAttacks` field for both classes; `HeroBasicAttack` reads the field
differently depending on whether the attack mode is `'projectile'` or
`'melee'`.

### HUD — acquired items row

`HeroHud` gains a row of 4 small slots (≈36 px on desktop, scaled by
`responsive.ts`) positioned just below the existing power-slot icons (or
to the right on landscape layouts, matching the existing power-slot layout
logic). Slots use the same frame style as the power slots.

| State              | Look                                                                            |
|--------------------|---------------------------------------------------------------------------------|
| Locked             | Dim grey rounded square with a faint silhouette of the gem.                     |
| Unlocked (stack=1) | Colored gem icon on a darker frame.                                             |
| Stack > 1          | Same icon plus a small white `×N` badge in the corner.                          |
| Just picked up     | 1 s pulse: scale 1 → 1.4 → 1.0, plus an expanding emissive ring.                |

Slot color matches the world-space `ItemDrop` gem color.

Tooltips, hover details, and item names beyond the pickup float text are
out of scope for v1.

## Architecture

### New files

- `src/game/gameplay/enemies/MilestoneBoss.ts` — extends `BossEnemy`. Adds
  tier-scaled HP/speed/damage applied in the constructor, the lunge/dash
  state machine in `update()`, telegraph + dash-trail visuals, the enrage
  trigger, and a knockback override that reduces incoming knockback to
  30 %. Exposes `isMilestone: true` for the EnemyManager death hook.
- `src/game/gameplay/ItemDrop.ts` — gem pickup entity. Owns its mesh,
  hover/rotate animation, magnet logic, and pickup callback.
- `src/game/gameplay/RunItems.ts` — owns `stacks: Record<ItemId, number>`,
  exposes `hasItem`, `getStacks`, `grant(itemId)`. Holds references to
  `PlayerStats`, the champion type string, and `HeroBasicAttack` so it can
  push updated values into them.

### Modified files

- `src/game/gameplay/WaveManager.ts` — add `public getCurrentWave(): number`
  getter so `EnemyManager` can ask which wave is active.
- `src/game/gameplay/EnemyManager.ts` — in `spawnSurvivorsEnemy('boss', …)`,
  branch on `waveManager.getCurrentWave() % 5 === 0` to instantiate
  `MilestoneBoss` with `waveTier = currentWave / 5`. Add
  `setOnMilestoneBossDeath((pos, tier) => void)`. Fire it from the death
  path before the standard cleanup.
- `src/game/gameplay/enemies/Enemy.ts` — add
  `public applyKnockback(dirX: number, dirZ: number, magnitude: number)`
  which nudges `position` by `magnitude` units in the given normalized
  direction, clamps to arena radius, and no-ops if the enemy is currently
  CC-immune (freeze/stun immunity windows). Base implementation; the
  standard `BossEnemy` AND `MilestoneBoss` override to apply 30 % of the
  passed magnitude.
- `src/game/gameplay/PlayerStats.ts` — add the four new fields above.
- `src/game/gameplay/HeroBasicAttack.ts` —
  - Accept a `PlayerStats` reference through a `setPlayerStats(stats)`
    setter (parallel to `setPowerSlots`). All item effects read live
    from `PlayerStats` fields each tick — no per-item setters on
    `HeroBasicAttack` — so the shop's `basicAttackSpeedMultiplier`
    changes and `RunItems`' changes compose through a single source of
    truth.
  - In both melee and projectile paths, after damage is applied, call
    `playerStats.heal(damage * lifestealPct)` if `lifestealPct > 0`.
  - In melee: apply `knockbackOnHit` to each enemy struck. Direction is
    `(enemy.position − heroPos)` normalized.
  - In projectile: apply `knockbackOnHit` to the enemy hit. Direction is
    the projectile's travel direction at impact.
  - In projectile: when firing, spawn `1 + extraAttacks` projectiles in a
    fan totalling 20° of spread (2 = ±5°, 3 = −10°/0°/+10°, 4 = ±5°/±15°).
  - In melee: after the main swing fires, if `extraAttacks > 0`, queue
    that many follow-up swings. The follow-up queue ticks each frame
    (bypassing the normal cooldown gate) and calls `performMeleeSwing()`
    every `EXTRA_SPIN_DELAY` (= 0.15 s). Follow-ups re-run the full
    pipeline so knockback, lifesteal, and enchantments all fire again.
- `src/game/states/SurvivorsGameplayState.ts` —
  - Construct `runItems = new RunItems(playerStats, championType, heroBasicAttack)` after the hero is built.
  - Pass `runItems` into `heroHud` so the HUD row can render.
  - Register `enemyManager.setOnMilestoneBossDeath((pos, tier) => spawnItemDrop(pos, tier))`.
  - `spawnItemDrop(pos, tier)`: look up `ITEM_BY_TIER[tier]`, return if no
    mapping or item already owned, otherwise create the `ItemDrop` and
    register its pickup callback to call `runItems.grant(itemId)` plus
    pickup feedback (slow-mo, float text, hud pulse).
- `src/game/ui/HeroHud.ts` — build the 4-slot items row, accept an
  optional `RunItems` ref, update each slot from `runItems.getStacks(id)`
  on `update()`, and add `pulseItem(itemId)` that runs the 1 s pulse
  animation.

### Data flow on item pickup

```
MilestoneBoss.die()
  → EnemyManager dispatch loop (existing)
    → fires onMilestoneBossDeath(pos, tier)
      → SurvivorsGameplayState.spawnItemDrop(pos, tier)
        → new ItemDrop(itemId, pos, onPickup)
        → on hero contact:
          → runItems.grant(itemId)
            → stacks[itemId]++
            → applyEffect(itemId) writes the relevant fields into
              PlayerStats / HeroBasicAttack
          → DamageNumberManager.spawnFloat("+ <Name>", pos)
          → HeroHud.pulseItem(itemId)
          → 300 ms slow-mo
```

### Item-to-wave mapping

```ts
// src/game/gameplay/RunItems.ts
const ITEM_BY_TIER: Record<number, ItemId> = {
  1: 'lifesteal',        // wave 5
  2: 'multishotCleave',  // wave 10
  3: 'knockback',        // wave 15
  4: 'attackSpeed',      // wave 20
};
```

Tier 5+ is intentionally absent — no item, but the boss still fights.

## Edge cases & guarantees

- **Run-end cleanup.** All new state lives in objects owned by
  `SurvivorsGameplayState` (`RunItems`, `ItemDrop` instances, `MilestoneBoss`
  is just an `Enemy`). The existing `exit()` already disposes the enemy
  manager and UI; we add `runItems = null` and ensure any in-flight
  `ItemDrop` is disposed in the same teardown path.
- **Already-owned items.** The grant path is no-op-safe (no double drops
  today), but `RunItems.grant` will still increment the stack if called
  again later, so the future "drop on subsequent boss waves" extension
  needs only a change to the gate in `spawnItemDrop`.
- **CC immunity & knockback.** Knockback respects the existing freeze /
  stun immunity windows by deferring to `applyKnockback`'s no-op branch.
- **Off-arena pushes.** `applyKnockback` clamps to the arena radius using
  the same radius the hero uses for movement clamping, so knockback can't
  push enemies through the wall.
- **Dash collision with arena edge.** `MilestoneBoss` dash motion uses
  the same `Enemy` position-clamp helper as normal movement, so a dash
  toward the arena edge stops at the wall instead of escaping.
- **Multishot fan with no target.** The fan is computed in projectile
  space at fire time; if a side projectile has no target hint, it travels
  straight in its launch direction and times out via the existing 3 s
  safety timer in `spawnProjectile`.
- **Multi-spin while moving.** The barb's follow-up spins call
  `performMeleeSwing()` directly each tick of the queue, which reads the
  current hero position — so a player who keeps moving spreads the
  follow-up AOE across the path. Working as intended.
- **Boss in early-wave spawn pre-warm.** The `EnemyManager` pre-warm is
  for normal enemies on survivors-mode start; bosses are spawned through
  the standard wave queue, so no pre-warm path needs to learn about
  `MilestoneBoss`.

## Tuning knobs to revisit after first playtest

- Stat tier multipliers (HP / speed / damage).
- Lunge cooldowns per tier.
- Dash distance (6 u) and dash speed (12 u/s).
- Telegraph duration (0.6 s).
- Lifesteal per stack (5 %).
- Knockback per stack (1.0 u) and boss-knockback reduction (30 %).
- Multishot fan total spread (20°).
- Follow-up spin delay (0.15 s).
- Enrage threshold (30 % HP) and enrage speed bump (×1.4).

## Out of scope (future work, called out so we don't accidentally do them)

- Item stacking actually triggering: re-dropping the same item at wave 25+
  to reach stack 2, 3, …
- Per-class item variants beyond `multishotCleave` (e.g., a knockback
  variant that's a frontal cone for melee).
- Boss telegraph audio / haptic feedback.
- Boss death cinematic / slow-mo (today's pickup slow-mo is the only
  feedback beyond enemy-death particles).
- Tooltips / item-detail panel on the HUD row.
