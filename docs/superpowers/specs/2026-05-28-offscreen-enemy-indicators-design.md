# Off-Screen Enemy Indicators — Design

## Goal

When an enemy is outside the camera frustum, render a small dot at the
screen edge in its direction so the player can see where threats are
coming from. The dot's size and color encode the enemy's tier (regular,
elite, boss).

Today, `src/survivors/ui/EliteIndicators.ts` already does this — but
only for elites. Extend the system to cover every alive enemy with a
visual hierarchy that keeps elites and bosses glance-readable amid the
regulars.

## Scope of change

This is a single-file change plus a rename. The existing file's
projection math, screen-edge clamping, per-frame `Map<Enemy, Rectangle>`
reuse, and `_seen` cleanup pattern are all preserved. What changes:

1. The file is renamed `EliteIndicators.ts` → `OffscreenEnemyIndicators.ts`.
2. The class is renamed `EliteIndicators` → `OffscreenEnemyIndicators`.
   Constructor signature, `update()`, and `dispose()` are unchanged.
3. The "skip if not elite" guard is removed — every alive enemy is now
   considered.
4. Per-enemy dot style (size, color, border) is chosen by tier.
5. `SurvivorsGameplayState.ts` updates its import + class name +
   field/variable names. No other call-site changes.

## Tier detection

Three tiers, evaluated in this order (highest wins):

| Tier    | Detection                       |
|---------|---------------------------------|
| Boss    | `e instanceof BossEnemy`        |
| Elite   | `e.isElite === true`            |
| Regular | otherwise                       |

`BossEnemy` is imported from `../enemies/BossEnemy`. `MilestoneBoss`
extends `BossEnemy`, so the `instanceof` check covers it automatically.

Boss precedence is defensive: today no enemy is both elite and a boss,
but ordering boss-first means a future overlap wouldn't downgrade a
boss to an elite dot.

## Tier visuals

| Tier    | Size (px) | Background                  | Border        |
|---------|-----------|-----------------------------|---------------|
| Regular | 6         | `#aaaaaa` (gray)            | none          |
| Elite   | 12        | element color (see below)   | 2px `#ffffff` |
| Boss    | 18        | `#ff3333` (red)             | 2px `#ffffff` |

Elite element colors are the existing `ELEMENT_HEX` map already in the
file:

```
fire:     #ff5500
ice:      #33aaff
arcane:   #cc55ff
physical: #cccccc
storm:    #bbbbff
```

If an elite somehow has no `eliteDropElement`, fall back to `#ffffff`
(matches today's behavior).

`Rectangle.cornerRadius` is set to `size / 2` so the rectangle renders
as a circle.

## Screen-edge clamping

Identical math to the current implementation — project the enemy
position with `Vector3.Project`, detect on-screen via the existing
`sp.z > 0 && in-bounds` check, otherwise compute the angle from screen
center and clamp to a margin.

The current margin is a hardcoded `28`. Replace with a per-tier value
so larger dots aren't cut off by the screen edge:

```
margin = size / 2 + 4   // 7px regular, 10px elite, 13px boss
```

## Performance

In late waves with 100+ off-screen enemies, this produces up to ~100
`Rectangle` GUI controls. Babylon's GUI handles this volume fine, and
the per-frame work is dominated by the existing `Vector3.Project` call
(one matrix multiply per enemy) — no different from today's elite-only
code, just run on more enemies. Controls are reused across frames via
the `Map<Enemy, Rectangle>`, so steady state allocates nothing.

No clustering, culling, or distance-based hiding. The user explicitly
chose "show all, tiny dots."

## Style switching for reused dots

A dot is created once per enemy and reused. An enemy can change tier
mid-life — specifically, an elite is upgraded after spawn by
`EliteSpawner.applyEliteTreatment`. To keep the logic simple and
correct, the dot's `width` / `height` / `background` / `thickness` /
`cornerRadius` are reassigned every frame, not only on creation. These
are cheap property writes; only `addControl` is allocation-heavy and
that still happens once.

## API surface

Unchanged:

```ts
new OffscreenEnemyIndicators(ui, scene, camera, getEnemies)
indicators.update()    // call once per frame
indicators.dispose()   // call on state exit
```

## Testing

No automated tests. The existing `EliteIndicators` has none, and this
module wraps Babylon GUI + projection math that the project's Vitest
setup (pure-logic only, no Babylon scene) cannot exercise. Verification
is manual:

- Start a survivors run, move the hero until enemies leave the screen,
  confirm gray dots appear at the correct edge angles and disappear
  when enemies re-enter the frame.
- Wait for an elite spawn, confirm its dot upgrades to the larger
  element-colored bordered dot.
- Reach the first milestone boss, confirm the dot is the large red
  bordered variant.
