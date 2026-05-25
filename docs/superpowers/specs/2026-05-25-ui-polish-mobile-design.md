# UI Polish — Mobile-first HUD & Overlays

**Date:** 2026-05-25
**Status:** Design — pending implementation plan

## Goal

Bring the in-game HUD and modal overlays to a "modern arcade" level of polish, with mobile as the primary target. Replace the fixed-position joystick with a floating-anywhere model so movement can be initiated from any touch on the canvas.

## Out of scope

- New art assets (no portraits, no parchment textures, no custom fonts).
- Gameplay changes — power slots stay auto-fire-only indicators; ultimates stay tappable.
- New states or screens. Pause, elite indicators, joystick movement semantics, and ability behavior are unchanged.

## Decisions

| # | Decision | Notes |
|---|---|---|
| 1 | Floating-anywhere joystick | First touch anywhere on the canvas becomes the origin. No static visual until pressed. |
| 2 | Visual direction: "neon glass" | Dark glass panels, element-colored borders, capsule HP & pills, glow faked via larger backing rectangles. |
| 3 | Layout L1 — shared by mobile and desktop | HP top-left, Wave top-center, Gold top-right, Slots bottom-center, Ultimates bottom-right. |
| 4 | All overlays re-skinned | Champion select, between-wave shop, power choice, replace-slot, game over, pause. |

## Visual language — "neon glass"

Implementable with BabylonJS GUI primitives — no image assets needed.

| Property | Value |
|---|---|
| Panel background | `rgba(10, 10, 22, 0.70)` |
| Panel border | 2px, element/accent color |
| Corner radius — buttons | 10px |
| Corner radius — pills (HP, Wave, Gold) | 999px (capsule) |
| Glow | Larger low-alpha backing Rectangle behind each panel (no native `box-shadow`); color matches border |
| Typography | Bold Arial, drop-shadow via `shadowBlur=3 / shadowColor=#000` on light text. BabylonJS GUI has no `letterSpacing` property — pill labels are pre-uppercased with single spaces between chars where the spacing effect is desired. |
| Element colors | Re-use `ELEMENT_COLOR` map (fire `#ff6030`, ice `#30cfff`, arcane `#b050ff`, physical `#e0e0e0`, storm `#ffe040`) |
| Press feedback | scale 0.92 on `pointerdown`, tween back to 1.0 over ~120ms |

## Floating-anywhere joystick

### Behavior

1. No static visual when no finger is pressed — the container starts `isVisible = false`.
2. On `pointerdown` anywhere on the canvas **that is not consumed by a GUI control**: capture the touch, place the ring at the touch point, set ring origin = touch point.
3. On `pointermove`: same logic as today — clamp distance to `baseRadius`, compute `dx / dz ∈ [-1, 1]`, move the thumb visual.
4. On `pointerup` / `pointercancel`: hide ring, emit `(0, 0)`.
5. **Multi-touch:** only the first active pointer drives the joystick. Subsequent touches on UI buttons still activate those buttons via `isPointerBlocker`.
6. **UI button precedence:** the canvas-level handler must validate that the GUI didn't already swallow the event (e.g., by checking the `target` of the event, or by listening at a layer the GUI sits above).

### Visual

- Ring: 52×52px, 1.5px white-alpha border, faint white-alpha background. Fade-in over 80ms when activated.
- Thumb: 24×24px filled white-alpha circle with faux glow.
- Both reposition every `pointerdown` rather than staying in the bottom-left.

### What gets removed

- The bottom-left `20px` offset + fixed alignment in `SurvivorsJoystick.ts`.
- The bottom-left-quadrant guard (`cx > rect.width/2 || cy < rect.height/2`) at `SurvivorsJoystick.ts:67`.

### Optional

A faint "tap to move" hint string can fade in once per session on first canvas show, then fade out after the first successful drag.

## HUD layout — L1

Same anchors and order on both viewports. Only sizes change.

| Element | Anchor | Mobile size | Desktop size |
|---|---|---|---|
| HP bar (capsule + text) | Top-left | 140×14px | 260×20px |
| Wave pill | Top-center | auto width × 22px (`resizeToFit`) | auto × 28px |
| Gold pill | Top-right | auto width × 22px (`resizeToFit`) | auto × 28px |
| Power slots (4, 8px gap) | Bottom-center row | 42px square | 56px square |
| Ultimate buttons (2, 8px gap) | Bottom-right row | 46px square | 60px square |

- Top edge padding: 10px from top, 10px from side edges.
- Bottom edge padding: 10px from bottom; slots and ultimates share the same baseline.
- Wave text format: `WAVE 3 · 8 LEFT` (in progress), `WAVE 3 CLEARED` (between).
- Low-HP vignette: unchanged.

### Power slot details

- Frame: dark glass square, element-colored 2px border, 10px corner radius.
- Empty slot: low-alpha white-dashed-feel border + faint `+` glyph (replaces the existing `?`).
- Glyph: unchanged — re-use `POWER_GLYPH` / `ELEMENT_GLYPH` maps.
- Level badge: bottom-right corner, `L2`-style, white text + shadow.
- Cooldown overlay: dark mask sliding top-down (same as today), slightly lighter alpha so the underlying icon stays readable.
- Ready pulse: keep existing scale-pulse on cooldown→ready transition.
- Press feedback: none (slots are not tappable).

### Ultimate button details

- Same neon-glass frame as slots, slightly larger.
- Border color follows the per-ability tint already in `HeroHud.ULT_DISPLAY`.
- Press feedback: scale 0.92 → 1.0 tween.
- Activation flash: white-alpha overlay 200ms when an ability is triggered.
- When cooling: existing dark mask + glyph desaturates to gray.

## Overlay re-skin

Affected files:
- `src/game/ui/ChampionSelectOverlay.ts`
- `src/game/ui/PowerChoiceOverlay.ts`
- `src/game/ui/ReplaceSlotOverlay.ts`
- `src/game/ui/BetweenWaveShopOverlay.ts`
- `src/game/states/GameOverState.ts` (survivors summary)
- `src/game/ui/PauseScreen.ts`

### Treatment

- Backdrop: existing dim, slightly darker (`rgba(0,0,0,0.65)`).
- Card body: dark-glass surface, 12px corner radius, 2px element/champion-colored border.
- Card header: bold, letter-spaced, drop shadow.
- Card hover/press: scale to 1.04 on pointer-over (desktop) or pointer-down (mobile); brighten border alpha.
- Card layout: unchanged — same card count, same picker/callback logic. Style-only changes.
- Mobile sizing: cards reflow to a vertical column under the breakpoint (existing responsive switch kept).

## Tactile feedback inventory

| Trigger | Feedback | Status |
|---|---|---|
| Ultimate tapped | Scale 0.92 → 1.0 (120ms) | NEW |
| Ultimate fired | White-alpha flash overlay (200ms) | NEW |
| Card / button tapped (overlays) | Scale 0.95 → 1.04 (140ms) | NEW |
| Slot ready (cooldown→0) | Scale pulse | existing |
| Low HP (< 25%) | Red vignette pulse + HP-bar color pulse | existing |
| Hero takes damage | HP bar flashes white briefly (80ms) over fill | NEW |
| Gold pickup | Gold pill pulses to 1.10 scale (180ms) | NEW |
| Wave cleared | Wave pill flashes green-alpha (300ms) | NEW |

### Haptics

Mobile only. Single `navigator.vibrate(15)` on ultimate activation and on game over. Guarded behind a feature check; no-op on desktop and iOS Safari (which ignores the API).

## Code organization

### New file: `src/game/ui/HudStyle.ts`

Single source of truth for the neon-glass language. Exports:

| Symbol | Purpose |
|---|---|
| `STYLE` | Const object with `panelBg`, `panelBorderAlpha`, `pillRadius`, `buttonRadius`, etc. |
| `makePill(text, color)` | Rectangle + TextBlock styled as a capsule (HP, Wave, Gold). |
| `makeFrame(opts)` | Rectangle with corner radius, border, dark-glass background. Takes element color. |
| `addPressFeedback(control, onTap)` | Wires pointerdown/up handlers, scale tween, optional callback. |
| `flashControl(control, color, ms)` | Temporary alpha overlay for activation flashes. |

### Modified: `src/game/ui/SurvivorsJoystick.ts`

- Drop static positioning. Container starts `isVisible = false`.
- Rewrite `wireEvents()` for the floating model.
- Validate that GUI didn't consume the event before activating.

### Modified: `src/game/ui/HeroHud.ts`

- Replace separate `_buildMobile` / `_buildDesktop` with a single `_build(layout)` that takes a size profile (mobile vs. desktop dimensions).
- Use `HudStyle` helpers for every element.
- Add the new feedback hooks (damage flash, gold pulse, wave flash, ult activation flash).
- Reposition HP bar from current bottom-left desktop / top-center mobile to top-left in both layouts. Move wave text from its own line into a top-center pill.

### Modified: overlays

- Each overlay imports from `HudStyle` and replaces its custom rectangles with helper-built panels.
- No structural changes to selection logic, callbacks, or state.

## Risks & watch-outs

- **`isPointerBlocker` reliability:** BabylonJS GUI's pointer-blocker semantics can be inconsistent across pointer events. The floating-joystick handler must validate that the touch wasn't already consumed before activating. Will require manual testing on the actual canvas.
- **"Glow via larger bg rectangle":** adds 1 extra Control per slot. Fine at 6 buttons (4 slots + 2 ults); watch the GUI control count if this pattern proliferates.
- **Cooldown mask + corner radius:** masks currently use a top-anchored rectangle with the same corner radius as the parent. With the new pill HP bar this is fine, but on the rounded slot frames the mask may bleed at corners. Workaround: inset the mask slightly inside the frame.
- **Hint string fade:** keep the "tap to move" hint behind a one-shot flag so it doesn't reappear every session.

## Verification

No automated tests (project has no test suite). Verify manually:

1. `npm run build` succeeds.
2. `npx tsc --noEmit` passes.
3. `npm start` — visually check:
   - Mobile viewport (DevTools device emulation, e.g., iPhone 12): HP/Wave/Gold top row; slots centered bottom; ults bottom-right; touch anywhere on canvas summons the joystick at that point.
   - Tap the canvas → joystick appears and tracks; release → joystick disappears.
   - Tap an ultimate button → button does NOT trigger the joystick AND fires the ability.
   - Trigger every feedback path: take damage, pick up gold, clear a wave, fire an ultimate.
   - Desktop viewport: same layout, larger sizes; mouse-drag also drives the floating joystick.
4. Visit each overlay (champion select, orb-pickup power choice, between-wave shop, replace-slot, game over, pause) — confirm neon-glass treatment is consistent.
