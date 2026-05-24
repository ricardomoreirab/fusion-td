# Vampire Survivors Redesign — Design Spec

**Date:** 2026-05-24
**Status:** Approved, ready for implementation plan
**Approach:** A — Repurpose in place, new `SurvivorsGameplayState`, reuse most services, delete tower-placement code

---

## 1. Overview

Repurpose the existing tower-defense game into a Vampire Survivors-style action game while reusing as much polished infrastructure as possible (waves, score, mobile UI, particles, materials, champions, enemy types, ability behaviors).

**Core fantasy:** A single hero in an open circular arena, fighting waves of enemies that pour in from all directions. The hero auto-attacks, equips up to four elemental powers that auto-fire on cooldown, and grows stronger over the course of a run via gold-bought stat upgrades and elemental power orbs dropped by elite enemies.

**Run structure:** Wave-based with between-wave shop pauses. Run ends when hero HP reaches zero. High score saved via existing `ScoreManager`.

---

## 2. Core Gameplay Decisions (locked)

| Decision | Choice |
|---|---|
| Enemy spawn direction | 360° around hero |
| Hero control | Single champion picked per run, player-moved |
| Basic attack | Always-on auto-attack independent of power slots |
| Powers | 4 slots, auto-fire on cooldown, levels via duplicate pickups |
| Power source | Elite enemies drop element-tagged orbs |
| Pickup interaction | 3-card slow-mo choice on every orb pickup |
| Run structure | Wave-based, between-wave shop, boss every 10 waves |
| Economy | Gold from regular enemies → shop; orbs from elites → powers |
| Arena | Single open circular arena, no path, no obstacles |
| Movement | WASD desktop, virtual joystick mobile |
| Contact damage | Continuous DPS while enemy overlaps hero |
| Tower fate | Behaviors repurposed as powers; tower-placement code deleted |
| Champion system | Reused — hero IS a champion, pick one per run |

---

## 3. Architecture

### 3.1 New files

| File | Responsibility |
|---|---|
| `src/game/states/SurvivorsGameplayState.ts` | New gameplay state; replaces `GameplayState` as the game-entry state |
| `src/game/gameplay/HeroController.ts` | Player input → movement, basic auto-attack targeting, camera follow, bounds clamp |
| `src/game/gameplay/PowerSlotManager.ts` | 4-slot equipped-powers tracking, cooldowns, auto-fire orchestration |
| `src/game/gameplay/PowerDrop.ts` | Elemental orb entity: spawn, magnet behavior, pickup trigger |
| `src/game/gameplay/EliteSpawner.ts` | Tags enemies as elite, assigns drop element, applies elite visual treatment |
| `src/game/gameplay/powers/PowerDefinitions.ts` | Static catalog of the 6 v1 powers and their per-level scaling |

### 3.2 Reused (with edits)

| File | Edit summary |
|---|---|
| `Champion.ts` / `ChampionManager.ts` | Add `controlMode: 'ai' \| 'player'`; expose movement API; remove TD-specific seek/AI when player-controlled |
| `EnemyManager.ts` + `enemies/*.ts` | Replace path-following with seek-hero; drop path/end-of-path damage logic; keep CC immunity, heal, split, shield regen |
| `WaveManager.ts` / `WaveStatus.ts` | Unchanged logic; wave preview UI extended to render elite rows |
| `PlayerStats.ts` | Keep gold/health; add hero stats (move speed, pickup radius, damage modifier, cooldown modifier, damage reduction) |
| `ScoreManager.ts` | Unchanged |
| `DamageNumberManager.ts` | Unchanged |
| `AbilityManager.ts` | Unchanged — Meteor Strike + Frost Nova remain as manual ultimates |
| `LevelManager.ts` / `LevelConfig.ts` | Extend wave config with `elites: { type, element, count }[]` |
| `Map.ts` | Gut path mesh + waypoints; add circular arena ground + boundary ring + invisible cylindrical clamp |
| `towers/abilities/TowerAbilitySystem.ts`, `TowerAbility.ts` | Repurposed as the engine driving hero powers (optional rename in Phase 5) |
| `rendering/*` (StyleConstants, LowPolyMaterial, TowerPreviewRenderer) | Keep; `TowerPreviewRenderer` may be repurposed into `PowerIconRenderer` for HUD |

### 3.3 Deleted (Phase 5)

- `src/game/states/GameplayState.ts`
- `src/game/gameplay/TowerManager.ts`
- `src/game/gameplay/towers/Tower.ts`
- `src/game/gameplay/towers/TowerDefinitions.ts`
- `src/game/gameplay/towers/MedievalTowerDefs.ts`
- `src/game/gameplay/towers/ElementalTowerDefs.ts`
- `src/game/gameplay/towers/UpgradeTree.ts`
- `src/game/gameplay/towers/TowerVisualBuilder.ts`

### 3.4 Per-tick flow in `SurvivorsGameplayState`

```
input → HeroController.update()
      → EnemyManager.update()        (enemies seek hero, apply contact DPS)
      → PowerSlotManager.update()    (cooldowns tick, auto-fire when ready)
      → AbilityManager.update()      (manual ultimates)
      → PowerDrop.update()           (magnet + pickup checks)
      → WaveManager.update()         (spawn timer, wave progression, elites)
      → DamageNumberManager.update()
      → HUD refresh
```

---

## 4. Hero, Controls, Camera

### 4.1 Champion as hero

- New field on `Champion`: `controlMode: 'ai' | 'player'`. Player mode bypasses TD-era AI; movement comes from `HeroController`.
- Each champion exposes: `baseMoveSpeed`, `basicAttackRange`, `basicAttackDamage`, `basicAttackRate`, `maxHealth`, `startingPower?` (optional fixed-element starter that fills slot 0).
- Champion visuals (mesh, idle/run animation) stay as-is.

### 4.2 Movement

- **Desktop:** WASD → unit vector → `position += dir * moveSpeed * dt`. Diagonals normalized.
- **Mobile:** virtual joystick in bottom-left thumb zone (reuse existing mobile-overlay infrastructure). Magnitude scales speed.
- **Bounds:** position clamped inside arena radius. No slide/knockback handling beyond clamp for v1.
- **Hero ↔ enemy collision:** no movement collision (enemies pass through hero geometry). Contact damage applied while bodies overlap.

### 4.3 Basic auto-attack

- Always active. Cooldown = `1 / basicAttackRate` seconds.
- Auto-targets nearest enemy within `basicAttackRange`.
- For v1: single projectile model per champion. Damage flows through the same hit pipeline as powers, so damage numbers, hit flash, and on-hit effects work automatically.

### 4.4 Camera

- Top-down follow camera (switch from `ArcRotateCamera`). Pitch ~70–80° looking down.
- Position follows hero with light lerp smoothing.
- Field of view tuned so the player sees ~15–20m radius around the hero. Mobile uses slightly tighter zoom.
- Camera is world-aligned; does not rotate with hero direction.

### 4.5 Health & damage

- `playerHealth` field reused. Bar above hero (shown when damaged) + HUD readout.
- Contact damage: while an enemy's bounding circle overlaps the hero's bounding circle, the enemy's `damagePerSecond` is applied to hero each tick (`damagePerSecond * dt`).
- Existing red vignette pulses while taking damage; idles at faint red below 25% HP.
- Hero death → `GameOverState` with extended stats (kills, time, gold, loadout).

---

## 5. Arena & Enemy Spawning

### 5.1 Arena

- Open circular ground plane, radius ~25 units (tunable in `LevelConfig`).
- Visible boundary: ring of stones or runes (low-poly mesh, tinted material). Decorative only — no collision.
- Invisible cylindrical bound clamps hero position only.
- Decoration: scattered static rocks/tufts for texture; none block movement.

### 5.2 Enemy spawning

- `WaveManager` decides what/when. `EnemyManager` decides where:
  ```
  θ = random(0, 2π)
  position = hero.position + (cos θ, 0, sin θ) * (arenaRadius + 2)
  ```
- Enemies enter just outside the visible ring so they appear from "off-screen" relative to the hero.
- Rate-limited per wave config so the screen doesn't flood instantly.

### 5.3 Enemy AI

- Per-tick locomotion replaced with seek-hero:
  ```
  dir = normalize(hero.pos - self.pos)
  self.pos += dir * speed * dt
  ```
- Flying flag retained for visual hover only (no obstacles to fly over in v1).
- Optional soft separation vector to prevent total stacking. Light tuning, not full flocking.
- **Preserved unchanged:** CC immunity windows, healer pulses, splitter death-spawn (MiniEnemies seek hero too), shield regen.
- **Removed:** any "advance along path" / "reached end → damage player" logic.

### 5.4 Elite enemies

- New `Enemy` fields: `isElite: boolean`, `eliteDropElement?: ElementType`.
- No new enemy class — any existing type can be flagged elite per wave.
- Visual treatment: 1.4× scale, emissive outline tinted to drop element, small particle aura.
- Stats: ~3× HP, ~1.5× gold versus base type.
- On death: spawn a `PowerDrop` orb at corpse position, colored to its element.
- Cadence: each wave includes 1–N elites via wave config. Early waves: 1 elite. Later waves: 2–3, possibly mixed elements.
- Off-screen elite indicator arrows shown at screen edges (color-tinted to element).

### 5.5 Bosses

- Existing boss-wave concept retained (waves 10, 20, 30…).
- Boss waves contain a boss but no elites.
- Boss drops larger gold + one **pick-any-power orb** on death (player chooses element from a 6-card overlay).

### 5.6 Performance plan

- Build naive first. Profile.
- If frame rate dips below 60 with target enemy counts: introduce object pooling for enemy meshes and a spatial hash for hero-proximity queries.
- Both are deferrable; not blocking for v1 playable.

---

## 6. Power System

### 6.1 Slots

- Hero has **4 power slots**, all empty at run start.
- Optional `champion.startingPower` may pre-fill slot 0 to give some champions flavor.

### 6.2 PowerDefinition shape

```ts
PowerDefinition {
  id: string;
  name: string;
  element: ElementType;
  icon: string;
  baseCooldown: number;
  baseDamage: number;
  baseRange: number;
  baseProjectileCount?: number;
  baseAOERadius?: number;
  perLevelGrowth: { damage: number; cooldown: number; range?: number };
  maxLevel: number;                  // 5 for v1
  levelPerks?: Record<number, string>; // e.g., { 3: "+1 projectile" }
  behavior: (state, hero, enemies, scene) => void;
}
```

### 6.3 Initial roster (6 powers, all ported from existing tower behaviors)

| Power | Element | Behavior source |
|---|---|---|
| Fireball | Fire | FireTower projectile + burn DoT |
| Frost Shards | Ice | Elemental ice projectile + slow on hit |
| Arcane Nova | Arcane | AOETower-style pulse around hero on cooldown |
| Piercing Arrow | Physical | SniperTower long-range piercing projectile |
| Whirling Blades | Physical | New: blades orbit hero (polar motion); damages on contact |
| Lightning Chain | Storm | Hybrid storm: strike nearest, chain to N nearby |

### 6.4 Level scaling

- Damage × 1.25 per level
- Cooldown × 0.92 per level (faster firing)
- Per-power perks at specific levels (defined in `PowerDefinition.levelPerks`):
  - Fireball Lv3 → splits into 2 projectiles
  - Arcane Nova Lv4 → expanded radius
  - Whirling Blades Lv3 → +1 blade
  - (others tuned during implementation)
- Max level = 5. A maxed Lv5 power feels ~3× damage and ~2× firing rate plus its perk.

### 6.5 Power orb pickup flow

1. Elite/boss dies → `PowerDrop` orb spawns at corpse, colored to its element.
2. Orb has pickup radius (~1.5u) and magnet radius (~4u, modified by hero's pickup-radius stat). Within magnet, orb flies toward hero; within pickup, it is collected.
3. **On pickup → game enters slow-mo (0.2× time scale), "Power Choice" overlay appears with 3 cards:**
   - **Card A — The orb's element:** "New: Fireball" (Lv1) if hero doesn't own it, or "Fireball Lv N → N+1" if owned.
   - **Card B — Wildcard upgrade:** a random level-up of another already-equipped power. If hero has fewer than 2 powers, replaced with another new-power offer.
   - **Card C — Run perk:** +5% damage OR +5% move speed OR +10% pickup radius (one rolled per pickup).
4. Tap a card → effect applied → slow-mo ends → gameplay resumes.
5. **Replacement case:** if player picks Card A and it's a new power AND all 4 slots are full, secondary "Replace which slot?" prompt appears with the 4 current powers as cards.
6. Cancel button in corner: skip selection, gain +25 gold instead.

### 6.6 Firing

- `PowerSlotManager` ticks per frame.
- Each equipped power has `cooldownRemaining`. When it hits 0, `behavior` runs: queries `EnemyManager` for targets (reusing helpers like `getClosestEnemy`, `getStrongestEnemy`), spawns projectiles/effects, deals damage via the existing pipeline. Cooldown resets, scaled by level.
- Powers fire from hero position (or orbit around hero for Whirling Blades). No manual aiming.

### 6.7 Manual ultimates (separate, unchanged)

- `AbilityManager`'s Meteor Strike (45s) and Frost Nova (30s) remain on HUD as the hero's two manual ultimates.
- They do not consume power slots.

---

## 7. Wave Structure & Economy

### 7.1 Wave loop

1. **Countdown** (5s): wave preview UI shows enemy composition including elite rows.
2. **Active wave:** enemies stream in 360°; hero auto-attacks + powers fire; player collects gold and orbs.
3. **Wave cleared:** existing "WAVE CLEARED!" animation, game pauses into shop.
4. **Shop phase:** modal overlay; player spends gold on stat upgrades; "Start Next Wave" button resumes.
5. Repeat. Boss every 10 waves: solo boss spawn, no elites that wave, guaranteed pick-any-power orb on death.

### 7.2 Currencies

- **Gold** (existing): drops from every regular enemy kill. Magnetized to hero with larger magnet radius than orbs (gold should never be missed). Persists only within the run.
- **Power orbs** (new): drop only from elites and bosses. Element-tagged.

### 7.3 Shop items (6 items, between waves)

| Item | Effect per buy | Base cost | Cost growth | Cap |
|---|---|---|---|---|
| Vitality | +20 max HP, heal +20 | 30 | ×1.5 | none |
| Swiftness | +10% move speed | 40 | ×1.6 | none |
| Magnetism | +25% pickup radius | 25 | ×1.5 | none |
| Power | +10% all power damage | 50 | ×1.7 | none |
| Haste | −5% all power cooldowns | 60 | ×1.7 | total reduction capped at −50% |
| Bulwark | −5% contact damage taken | 45 | ×1.5 | total reduction capped at −80% |

- Items don't reset between waves. No purchase is forced. Shop closes via "Start Next Wave."

### 7.4 Wave-config schema additions

```ts
WaveConfig {
  // existing
  enemies: { type: string; count: number; spawnInterval: number }[];
  isBossWave?: boolean;
  // new
  elites?: { type: string; element: ElementType; count: number }[];
}
```

### 7.5 Run-end

- Hero HP → 0 → `GameOverState`.
- Game-over screen extended to show: waves cleared, kills, time survived, gold collected, final loadout (equipped powers + levels), high score comparison.

---

## 8. UI / HUD

### 8.1 Desktop layout

```
┌──────────────────────────────────────────────────────────────┐
│ Wave 7 / 30        ⏱ 03:42        🏆 Best: 14              │
│ Enemies: 23                                                 │
│                                                              │
│                    [arena / hero / enemies]                  │
│                                                              │
│ ❤ 78 / 120  ████████░░  💰 245                              │
│ [🔥 Lv3] [❄ Lv2] [⚡ Lv1] [ ? ]   [☄ 12s] [❄ 24s]          │
└──────────────────────────────────────────────────────────────┘
```

- Top bar: wave number, run time, best score, enemies remaining.
- Bottom-left: HP bar + gold, large and always-visible.
- Power slots: 4 icons across, each shows element icon, level number, radial cooldown sweep. Empty slot = dim "?". Reuses card-style visual language from existing tower-select UI.
- Ultimates: to the right of slots, two manual ultimate buttons with cooldown overlays (same as today).
- Above hero: thin floating HP bar shown only when damaged. Damage numbers float as today.

### 8.2 Mobile layout

```
┌────────────────────────────┐
│ Wave 7  ⏱ 03:42  ❤ 78/120 │
│                            │
│       [arena]              │
│                            │
│ ⊙           [☄] [❄] 💰 245│
│ joystick   [🔥][❄][⚡][?] │
└────────────────────────────┘
```

- Joystick: bottom-left thumb zone, reuses existing virtual joystick.
- Power slots: row sized to 44px+ tap targets.
- Ultimates: tap-to-fire, bottom-right.
- HP and gold collapse into top bar.

### 8.3 Overlays

1. **Champion Select** — entered at new run; card per champion (portrait, name, stats, starting power); tap to start.
2. **Power Choice (slow-mo)** — 3 cards when an orb is picked up; gameplay at 0.2× speed; cancel button → +25 gold.
3. **Boss Power Pick** — variant of Power Choice triggered by the boss-dropped pick-any-power orb; shows 6 cards (one per power, "New" or "+1 Level" labeled per current loadout); no cancel.
4. **Replace Slot** — secondary prompt when picking a new power with full slots; tap the slot to discard.
5. **Between-Wave Shop** — modal after wave clear; grid of 6 items; "Start Next Wave" button; no timer.
6. **Pause** — existing pause screen, add "back to menu" option. Trigger: Space (desktop), pause button top-right (mobile).
7. **Game Over** — existing `GameOverState`, extended per §7.5.

### 8.4 Visual feedback

Existing (kept): hit flash, damage numbers, red vignette, wave clear text, particle bursts, gold float text.

New:
- Power orb pickup → bright element-colored flash on hero + brief screen tint in element color.
- Low-HP danger pulse — faint red vignette idle below 25% HP, pulses on heartbeat.
- Off-screen elite indicator arrows at screen edges, color-tinted by element.

### 8.5 Removed from current UI

- Tower selector panel
- Tower preview overlay during placement
- Confirm-placement buttons
- Tower info panel (stats, sell, upgrade, cycle targeting)
- Sell-tower flow

---

## 9. Migration Phases

### Phase 1 — Scaffolding
- Create `SurvivorsGameplayState.ts` as a stripped copy of `GameplayState.ts` with all tower-placement code removed.
- Wire `MenuState` "Play" button to launch `SurvivorsGameplayState`. Keep `GameplayState.ts` in tree (unused) until Phase 5.
- New state compiles and runs: empty arena, hero spawned in middle, no enemies, no HUD wired yet. Proves the new entry point works.

### Phase 2 — Hero & arena
- Build `HeroController` (WASD + joystick, top-down follow camera, basic auto-attack).
- Add `controlMode: 'ai' | 'player'` to `Champion`; route player mode through `HeroController`.
- Rebuild `Map.ts`: remove path; add circular ground + boundary ring + invisible clamp.
- Hero takes contact DPS. Hero death → `GameOverState`.

### Phase 3 — Enemies & waves
- Replace path-following with seek-hero in each enemy class. Drop path/end-of-path logic.
- Update spawner: spawn at random angle on `arenaRadius + 2`.
- Verify all 7 enemy types + MiniEnemy work; preserve CC immunity, heal, split, shield regen.
- `WaveManager` + preview UI: extend preview to render elite rows.
- Add `isElite` + `eliteDropElement` to `Enemy`; apply elite visual treatment.

### Phase 4 — Powers & shop
- New `PowerDefinitions.ts` with 6 powers ported from existing tower behaviors via `TowerAbilitySystem`.
- New `PowerSlotManager` (slots, cooldowns, auto-fire).
- New `PowerDrop` (orb spawn, magnet, pickup).
- Power-choice overlay (3-card slow-mo) + replace-slot prompt.
- Between-wave shop overlay with 6 stat items.
- Off-screen elite indicator arrows.

### Phase 5 — Polish & cleanup
- Game-over screen extension (kills, time, loadout, score).
- Champion-select overlay at run start.
- Manual ultimates HUD reused from `AbilityManager` (already exists).
- Delete old tower files and `GameplayState.ts`. Update `LevelConfig` schema for elites.
- Performance pass: object-pool enemies if needed; profile on mobile.

---

## 10. Scope Boundaries

**Explicitly OUT of v1 (deferred):**

- XP / level-up system (we use elite-only orb drops + shop)
- Meta-progression / unlockables across runs
- Multiple arenas (single arena via `LevelManager`)
- Environmental hazards
- Hero dash / dodge (reserved Shift slot, no implementation)
- Multiplayer
- New sound design beyond what's currently in place

---

## 11. Risk Callouts

1. **Performance with high enemy counts.** VS hordes are heavier than TD path-walkers. Build naive, profile, pool enemy meshes and add spatial hash only if needed.
2. **`GameplayState.ts` is 4,667 lines.** Copying as a shell carries cruft risk. Discipline during Phase 1: aggressively delete tower-UI fields/methods. Goal: new state under ~1,500 lines.
3. **`Champion` is 751 lines and built for AI.** Adding `controlMode` cleanly may require refactoring its update loop. Budget time in Phase 2.

---

## 12. Open Tuning Knobs

These numbers are starting points, not commitments. Adjust during implementation playtesting:

- Power slot count (default 4)
- Power max level (default 5)
- Arena radius (default 25u)
- Pickup radius (default 1.5u) / magnet radius (default 4u)
- Slow-mo factor during power choice (default 0.2×)
- Cancel-orb gold reward (default 25)
- Boss wave cadence (default every 10)
- Shop item base costs and growth multipliers (see §7.3)
