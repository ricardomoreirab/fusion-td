# Hero Damage Feedback — Design

## Goal

When the hero takes damage, the game should communicate the hit with
satisfying physicality. Today, `HeroController.takeDamage()` silently
decrements HP — the only feedback is the HP bar moving and the existing
low-HP screen vignette. The hero mesh itself does not react.

Add four coordinated effects: red mesh flash, knockback shove, blood
particle burst, and a brief camera shake.

## Constraint: contact damage is per-frame

`SurvivorsGameplayState.applyContactDamage()` calls
`heroController.takeDamage(e.contactDamagePerSecond * deltaTime * ...)`
**every frame** while an enemy overlaps the hero. Naively firing feedback
on every call would produce a permanent strobe and pin the hero in place
via knockback.

Feedback must therefore be rate-limited independently from HP loss.

## Trigger model

- `HeroController` gets `lastHitReactionTime: number` (seconds, monotonic).
- A "hit reaction" fires when `now - lastHitReactionTime >= 0.5s`. First
  hit after spawn fires immediately (initialize to `-Infinity`).
- HP loss still ticks every frame; only the four visual/physical effects
  are gated.

## Signature change

```
takeDamage(amount: number, sourcePos?: Vector3): void
```

`sourcePos` is the world-space position of the damage source (typically
the enemy that touched the hero). When provided, knockback direction is
`(heroPos - sourcePos).normalize()`. When absent (future DoTs, ranged
hits with no clear source), the other three effects still play but
knockback is skipped.

`HeroBasicAttack.ts` line 15 declares the `takeDamage` interface and
must be updated to match the new signature. Other tests/callsites: none
— the only call into hero `takeDamage` is from `applyContactDamage()`
in `SurvivorsGameplayState`.

## The four effects

### 1. Red mesh flash

Mirror `Enemy.flashHit()` (`Enemy.ts:731`) but red instead of white,
and ~150ms instead of 80ms (longer because the hero is the focal point
and a faster flash reads as a glitch on a larger mesh).

- Color: `Color3(1, 0.15, 0.15)`
- Duration: 150ms
- Implementation: new `flashHitRed()` method on `Champion`, walks
  `mesh + getChildMeshes(false)`, swaps `emissiveColor` on every
  `StandardMaterial`, restores via `setTimeout`.
- Edge case: if a second reaction fires while the first restore is
  pending, the second snapshot will capture the already-red emissive
  and restore *to red* on its timeout. Fix by tracking an in-flight
  flash and refreshing its timer instead of stacking.

### 2. Knockback shove

`HeroController` gets `knockbackVelocity: Vector3` and
`knockbackTimeRemaining: number`.

- On reaction with `sourcePos`:
  - `dir = normalize(heroPos - sourcePos)` (XZ plane; clamp Y to 0)
  - `knockbackVelocity = dir * 7.0` (units/sec)
  - `knockbackTimeRemaining = 0.15`
- Each frame in the existing movement update:
  - Decay magnitude linearly: `knockbackVelocity *= max(0, 1 - dt/0.15)`
    (or just lerp the magnitude toward 0 over remaining time)
  - **Add** `knockbackVelocity * dt` to the player-input displacement
    — do not replace input. Player retains responsiveness.
- Arena bounds: the existing position-write clamp continues to apply,
  so knockback can't push the hero outside playable area.

### 3. Blood particle burst

Babylon `ParticleSystem`, one-shot, self-disposing.

- Emitter: hero position + small Y offset (~0.8) to come from the body
  not the feet.
- Count: ~12 particles in a single burst (`manualEmitCount`).
- Color: red gradient (`Color4(0.8, 0.05, 0.05, 1)` → fading alpha).
- Velocity: outward in random XZ directions, mild upward Y, gravity
  pulls them back down (~-15 on Y).
- Lifetime: 0.25–0.4s.
- Size: 0.1–0.2.
- After all particles die, `dispose()` the system.

### 4. Camera shake

`HeroController` owns the follow camera (per CLAUDE.md). Add a shake
offset added to camera target each frame.

- On reaction: `shakeTimeRemaining = 0.1`, `shakeMagnitude = 0.15`.
- Each frame: if `shakeTimeRemaining > 0`,
  `shakeOffset = (random unit Vec2) * shakeMagnitude * (shakeTimeRemaining / 0.1)`
  applied to camera target XZ, then `shakeTimeRemaining -= dt`.
- Decay-to-zero ensures the camera always settles back; magnitude
  scales down with remaining time for a sine-like falloff.

## Files touched

| File | Change |
|---|---|
| `src/game/gameplay/HeroController.ts` | New `takeDamage` signature, rate limiter, knockback velocity integration, camera shake offset, particle spawn, call into `Champion.flashHitRed()`. |
| `src/game/gameplay/Champion.ts` | Add `flashHitRed()` method, handle in-flight flash refresh. |
| `src/game/states/SurvivorsGameplayState.ts` | Pass `ePos` as second arg to `heroController.takeDamage` in `applyContactDamage()`. |
| `src/game/gameplay/HeroBasicAttack.ts` | Update line 15 `takeDamage` interface signature. |

## Out of scope

- Low-HP red screen vignette — already exists (`HeroHud.ts` per CLAUDE.md).
- Invincibility / damage immunity frames — separate game-balance question.
- Hit sound effects — no sound system in the project yet.
- Death animation changes — death still hands off to existing path.

## Tuning summary

| Parameter | Value | Note |
|---|---|---|
| Hit reaction cooldown | 0.5 s | Felt right for ~3–5 reactions / sec of contact damage. |
| Flash color | `Color3(1, 0.15, 0.15)` | Saturated red, slight warmth. |
| Flash duration | 150 ms | Longer than enemy 80ms because hero mesh is bigger. |
| Knockback speed | 7 u/s | Hero base move speed is ~5; this feels like a shove, not a launch. |
| Knockback duration | 0.15 s | ~0.5 unit displacement before decay. |
| Particle count | 12 | One-shot burst. |
| Particle lifetime | 0.25–0.4 s | Short — bleed, not gore. |
| Camera shake magnitude | 0.15 | World units on camera target. |
| Camera shake duration | 0.1 s | Quick kick. |

All values can be reviewed in playtest; locate them as named constants
near the top of `HeroController.ts` so they're easy to find.
