# On-Screen Shop + Live Goblin Portrait — Design

**Date:** 2026-06-13
**Status:** Approved (brainstorming session)
**Supersedes:** the "Merchant world flow" section of
`2026-06-12-itemization-merchant-shop-design.md` (the rest of that spec —
items, sets, economy, stock rules, effects — is unchanged).

## Goal

Replace the **3D merchant that spawns on the map** (walk-up-to-open cart +
goblin GLBs) with a **pure on-screen shop** that auto-opens after every wave
clear, with the goblin rendered **live from his GLB in a side column of the
shop window**, speaking his barks from a comic speech bubble as you shop.

## Decisions (with the user)

- **Goblin render:** live 3D from `goblin_a_traveling_merchant.glb` (not a 2D
  portrait) — "the asset", idling, watching you shop.
- **Open flow:** the shop **auto-opens the instant a wave clears** (no walking).
- **Placement:** goblin sits in the shop window's **left column**.
- **Leave button dropped:** the shop is modal until **"To battle!"**.
- **New:** hovering an **equipped** item shows its full attributes in a tooltip.

## Why an isolated mini-renderer (the load-bearing decision)

The main scene's post-processing pipeline is bound to the main camera
(`new DefaultRenderingPipeline('mainPipeline', true, scene, [camera])`), and
`Game.guardActiveCamera()`, the render-health watchdog, and the camera-zoom
feature **all act on the single `scene.activeCamera`**. Adding a second
viewport camera to the main scene would entangle all three — exactly the
systems the project guards hardest (see CLAUDE.md black-screen invariants).

So the goblin gets its **own** `<canvas>` + WebGL `Engine` + `Scene` + camera +
light, with **zero contact** with the main render path.

## Architecture

| Module | Change |
|---|---|
| `src/survivors/shop/GoblinPortrait.ts` | **NEW.** Owns canvas + isolated Engine/Scene/camera/light; loads + frames the goblin GLB; plays its idle clip; `start()`/`stop()` its own render loop; `mount(parent)`/`detach()` its wrapper element. **Module-level singleton, lazily created, session-scoped** (same discipline as the existing GLB `_containers` cache) — never disposed per run, so no WebGL-context churn or GLB reloads. |
| `src/survivors/shop/MerchantStand.ts` | **DELETED.** No world cart/goblin, no dust ring, no proximity, no depart. |
| `src/ui/overlays/ShopOverlay.ts` | Two-column body: portrait column (mounts an opaque element handed in by the state) + main column (quip **speech bubble** → stock grid → equipment strip). **"Leave" removed.** Equipment cells gain a **hover tooltip** of the equipped item's stat/effect lines. Stays a dumb VM renderer — it never touches Babylon. |
| `src/survivors/SurvivorsGameplayState.ts` | Drop all `MerchantStand` use, the `arriving`/setup-timer/proximity/hysteresis logic, and fields `merchantStand`/`shopSetupRemaining`/`shopHysteresis`. `shopPhase` collapses to `'none' \| 'open'`. Wave-clear (solo) → `openShop()` directly. Own + start/stop the `GoblinPortrait`; `exit()` stops + detaches it. Horn button no longer shown. |

### ShopVM additions
`ShopEquipVM` gains `statLines: string[]` and `effectText: string \| null` so
the overlay can render the equipped-item hover tooltip. `buildShopVM` fills
them via the same `describeMods` / effect-text logic the stock cards already
use.

## Flow

1. **Wave clears (solo):** roll stock → `shopPhase='open'` → `openShop()` shows
   the overlay (pauses solo via the existing `isPausedForOverlay()`), portrait
   `start()`s, goblin barks his `arrive` greeting into the bubble.
2. **Shopping:** buy/reroll unchanged; bubble swaps to `buy`/`poor`/`reroll`.
3. **"To battle!":** close overlay → portrait `stop()` → 3 s breather → next
   wave (existing `endShoppingPhase`, minus the world `depart()`).
4. **`exit()`:** overlay closed, portrait stopped + detached, equipment/effects
   cleared as today.

## Layout

```
┌──────────────── Gribble's Traveling Emporium ────────────────┐
│ ╭───────────────╮                                            │
│ │ “speech       │                              🪙 1240        │
│ │  bubble”   ◄──┐  ┌─────┐┌─────┐┌─────┐   6 stock cards     │
│ ╰───────────────╯  └─────┘└─────┘└─────┘                     │
│ ┌──────────────┐   ┌─────┐┌─────┐┌─────┐                     │
│ │  live 3D     │◄──┘                                          │
│ │  goblin      │   ┌──┬──┬──┬──┬──┬──┐ equipped (hover=stats)│
│ │  (idling)    │   │Wp│Hm│Ch│Lg│Bt│Tr│                       │
│ └──────────────┘   └──┴──┴──┴──┴──┴──┘                       │
│ [🎲 Reroll (50g)]                          [⚔ To battle!]    │
└──────────────────────────────────────────────────────────────┘
```
Mobile (≤720px): portrait collapses to a short header strip above the grid.

## Co-op

Unchanged: co-op never had the shop (auto-advance breather) and still doesn't.
All new code stays behind the existing solo guard, so co-op is byte-identical.

## Risk + fallback

One extra WebGL context (the portrait). A single session-scoped singleton is
well within the browser cap and matches the codebase's "load once, keep for
session" GLB discipline. If the second context ever proves flaky, the fallback
is a baked 2D portrait image — same layout, no second context.

## Testing

- Pure logic already covered (ShopStock, Equipment, barks) is untouched.
- Add a Vitest check that `buildShopVM`-shaped equip entries carry `statLines`
  for an equipped item (via a small pure helper, if extracted) — otherwise the
  portrait/overlay are Babylon/DOM and verified by running the app.

## Out of scope (unchanged from the parent spec)

Co-op shopping, persistent meta-progression, equipment shown on the character
model, the cart GLB (now unreferenced; file kept on disk).
