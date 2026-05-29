# DOM UI Design System — Forged Fantasy

- **Date:** 2026-05-29
- **Status:** Approved (design)
- **Topic:** Migrate the game UI to a responsive DOM/CSS overlay with a "Forged Fantasy" design system.

## 1. Problem & goals

The game's UI is built entirely with BabylonJS GUI (canvas-drawn controls across 9 files). It works but:

- Responsiveness is ad-hoc: a desktop/mobile boolean (`getLayoutMode`) with hardcoded pixel values duplicated across `_buildDesktop`/`_buildMobile` branches, and manual `rebuild()`-on-resize.
- There is no shared design system — no spacing scale, type scale, or sizing tokens. Fonts/sizes are picked per-file.
- Real overlap risks on small screens: the joystick reserves a hardcoded `150×80px` corner; `PauseScreen` stacks buttons at fixed `top` offsets; the HUD pause button is placed with a fragile `10 + 110 + 8` sum.

**Goals:**

1. Make the UI distinctly **game-like** (a "Forged Fantasy" dungeon-RPG aesthetic).
2. Make it **fully responsive** for landscape across phone-landscape → tablet → desktop, with **no element overlap** guaranteed structurally.
3. Establish an **adaptable design system** (tokens + primitives) so future UI work is consistent and cheap.

## 2. Locked decisions

| Decision | Choice | Rationale |
|---|---|---|
| Rendering | **Full DOM/CSS overlay** over the canvas | Real flexbox, media/container queries, `clamp()` fluid scaling — the platform does responsiveness. |
| Styling stack | **Vanilla TS + CSS custom-property tokens** | Matches the codebase's "pure TS, no framework" convention; no heavy runtime deps. |
| Visual direction | **Forged Fantasy** (stone/iron frames, gold trim, beveled edges, serif display) | Chosen from 3 mockups; aligns with the palette already in `index.html`'s loading screen. |
| HUD weight | **Light forged HUD, ornate menus** | Always-on HUD stays unobtrusive during play; full ornamentation reserved for modals/screens. |
| Fonts | **Bundle a fantasy font pair** (display + body), self-hosted woff2 | Distinctive look, works offline. Display = Cinzel; body = EB Garamond (both OFL). |
| Orientation | **Landscape only** | Matches today. Portrait already blocked by the `#rotatePrompt` `@media (orientation: portrait)` in `index.html` — unchanged. |
| Responsive engine | **CSS-first fluid + breakpoints** | `clamp()` for smooth scaling; a few landscape breakpoints + container queries for layout; minimal JS. |

## 3. Architecture

### Overlay mount & layering

A single UI root sits above the canvas. Pointer-events passthrough keeps the 3D scene interactive where the UI is not.

```
#renderCanvas        z:0     receives all input the UI does not claim
#ui-root             z:10    pointer-events:none   ← new DOM overlay
  ├ .layer-hud               none; interactive widgets opt back in (pointer-events:auto)
  ├ .layer-fx        z:30    none  (low-HP vignette, damage/flash FX)
  ├ .layer-indicators z:15   none  (off-screen enemy arrows)
  └ .layer-overlay   z:40    auto  (modals: scrim + ornate panel)
#loadingScreen       z:100   unchanged — covers UI during load
#rotatePrompt        z:9999  unchanged — portrait block
```

- **Input passthrough rule:** containers are `pointer-events:none`; only interactive elements (buttons, power slots, ult buttons, joystick active zone, modal scrim) set `pointer-events:auto`. Empty HUD space passes taps to the canvas so movement, camera, and click-to-target abilities (e.g. Meteor) keep working.
- **Lifecycle:** a `GameUI` manager mounts its DOM subtree into `#ui-root` and is fully removed on state `exit()` — preserving the "all UI disposed on exit" invariant. Created in `enter()`, mirroring today's `AdvancedDynamicTexture` lifecycle.
- **Per-frame update:** the game loop calls `hud.update(state)` each frame as today, but updates are **diffed** and mostly set CSS variables (`--hp`, `--cd-0…3`) and toggle classes. CSS runs the animations (cooldown sweep, pulses, flashes). This replaces the current per-property Babylon GUI writes and the cached-rgb micro-optimizations.

### State binding / data flow

- Imperative push, internally diffed. `Hud.update({ hp, gold, slots, items, ultimates, waveInfo })` writes only changed values.
- Overlays are show/hide with the **same callback contracts** the current overlays use (`onSelect`, `onCancel`, etc.), so the orchestration in `SurvivorsGameplayState` changes minimally (swap the constructor/types, keep the wiring).
- Pause/slow-mo coordination with overlays is preserved.

## 4. Design tokens (`src/ui/styles/tokens.css`)

CSS custom properties on `:root` — the adaptable core:

- **Color (semantic):** `--c-void`, `--c-stone-900/800/700`, `--c-leather`, `--c-iron`, `--c-gold`, `--c-gold-hi`, `--c-gold-lo`, `--c-blood`, `--c-blood-deep`, `--c-moss`, `--c-parchment`, `--c-parchment-dim`, `--c-parchment-faint`. **Elements:** `--el-fire #ff6030`, `--el-ice #30cfff`, `--el-arcane #b050ff`, `--el-physical #e0e0e0`, `--el-storm #ffe040`. **Tiers:** `--tier-fusion #c060ff`, `--tier-ultimate #ffd24d`.
- **Spacing:** `--s-1:4px`, `--s-2:8px`, `--s-3:12px`, `--s-4:16px`, `--s-6:24px`, `--s-8:32px`.
- **Radii:** `--r-sm:4px`, `--r-md:6px`, `--r-lg:10px`, `--r-pill:999px`.
- **Type:** `--ff-display:'Cinzel',serif`, `--ff-body:'EB Garamond','Georgia',serif`; fluid scale `--fs-100 … --fs-800`, each `clamp(min, vw-relative, max)`.
- **Bevel/shadow recipes** (as vars, so every frame is consistent): `--bevel-ornate`, `--bevel-lite`, `--glow-el` (element glow takes a color via `--glow-color`).
- **Z-index:** `--z-hud`, `--z-indicators`, `--z-fx`, `--z-overlay`.

Element/tier tinting is applied by setting a single `--accent` (or `--glow-color`) custom property on a slot/card; the frame recipes consume it. This keeps one frame definition instead of five.

## 5. Component library (`src/ui/`)

New bounded context. Vanilla TS builder functions + small controller classes, each exposing `mount(parent) → HTMLElement`, `update(state)`, `dispose()`.

```
src/ui/
  dom.ts                 // el(tag, props, children) helper; no framework
  GameUI.ts              // top-level: creates #ui-root layers, owns sub-UIs, dispose()
  styles/
    tokens.css
    base.css             // reset, layer setup, @font-face, pointer-events rules
    components.css        // primitives + screens styling (or split per component)
  fonts/                 // self-hosted woff2 (Cinzel, EB Garamond)
  primitives/
    Frame.ts             // ornate + lite variants
    Pill.ts              // HP / wave / gold
    IconSlot.ts          // power & item slot: icon, level badge, cooldown sweep
    Button.ts            // forged (gold) + ghost (stone)
    Modal.ts             // scrim + ornate panel + title scaffold
    Card.ts              // choice card
    interaction.ts       // pressFeedback + haptic, ported from HudStyle
  hud/
    Hud.ts               // replaces HeroHud (light forged)
    Joystick.ts          // DOM virtual joystick
    OffscreenIndicators.ts
  overlays/
    ChampionSelect.ts
    PowerChoice.ts
    ReplaceSlot.ts
    Shop.ts
    PauseMenu.ts
  screens/
    MainMenu.ts          // migrates MenuState UI
    GameOver.ts          // migrates GameOverState UI
```

## 6. Responsive rules (the "no overlap" guarantee)

- **Structural layout only:** flex/grid + anchored regions, zero absolute-px corner math. HUD grid — top row `[HP | wave | gold]`, bottom row `[slots | spacer | ults]`; joystick anchored bottom-left with a guaranteed gap column. Overlap is prevented by the layout model, not by tuning offsets.
- **Breakpoints (landscape):** `compact ≤760px`, `regular 761–1100px`, `wide ≥1101px`, plus a short-height guard `@media (max-height:430px)` for small phones in landscape. Modal cards use **container queries** so they adapt to panel width, not just viewport.
- **Fluid sizing:** `clamp()` for font sizes, slot sizes, and gaps; breakpoints only change layout/density and enforce touch minimums.
- **Safe areas:** `env(safe-area-inset-*)` padding for notched devices.
- **Touch:** min 44px interactive targets under `(pointer:coarse)`.

## 7. Build changes (`webpack.config.js`)

- Add dev deps **`css-loader`** + **`style-loader`**; add rule `{ test:/\.css$/, use:['style-loader','css-loader'] }`. CSS is imported from TS (`import './ui/styles/tokens.css'`). style-loader injects into `<head>` (no FOUC concern — the canvas/loading screen covers startup).
- **Fonts:** add rule `{ test:/\.woff2?$/, type:'asset/resource' }`; `@font-face` in `base.css` referencing the bundled woff2 files. Fonts are OFL-licensed and self-hosted (offline-safe). _Alternative considered:_ ship a static stylesheet + fonts via the existing `CopyWebpackPlugin` (zero new deps) — rejected for worse DX (no import graph / HMR), but noted as a fallback if adding loaders proves problematic.

## 8. Migration phasing

Each phase ends in a working, verifiable build.

- **Phase 0 — Foundation.** Build config (CSS + fonts), `#ui-root` + `GameUI` layer mount + input passthrough, `tokens.css`/`base.css`, fonts, primitives (`Frame`, `Pill`, `IconSlot`, `Button`, `Modal`, `Card`, `interaction`). **Smoke test:** a sample pill renders over the canvas AND the canvas still receives movement + click-to-target input.
- **Phase 1 — HUD.** Migrate `HeroHud` → `Hud` (light forged): HP/wave/gold pills, power slots with cooldown sweeps + level badges, item row, ultimate buttons with countdowns, pause button, low-HP vignette, and the tactile feedback (HP-damage flash, gold pulse, wave-clear flash) — now via CSS.
- **Phase 2 — In-run overlays (ornate).** `PowerChoice`, `ReplaceSlot`, `Shop`, `ChampionSelect`, `PauseMenu`. Reuse existing callback contracts so `SurvivorsGameplayState` wiring barely changes.
- **Phase 3 — Periphery.** DOM `Joystick`, `OffscreenIndicators`, `MainMenu`, `GameOver`.
- **Phase 4 — Cleanup.** Delete old Babylon GUI UI files, `src/shared/ui/HudStyle.ts`, `src/shared/ui/responsive.ts`. Drop `@babylonjs/gui` dependency **if** no remaining imports. Update `CLAUDE.md` (architecture + lighting/shadow sections reference the GUI; revise the UI sections).

## 9. Testing

- Vitest stays pure-logic (no DOM/Babylon). Add focused unit tests for pure helpers where they exist: `dom.el()` output shape, cooldown-fraction → sweep-height mapping, any number/label formatting.
- UI correctness is primarily **manual responsive QA** against a checklist: compact / regular / wide + short-height, verifying no overlap, touch targets, and input passthrough. Use the `/verify` or `/run` flow to drive the app and resize.

## 10. Scope boundaries & risks

**Out of scope / unchanged:**
- `DamageNumberManager` — world-space 3D billboards, not screen UI. Left as-is.

**Risks & mitigations:**
- *Input passthrough correctness* (movement + click-to-target must still reach the canvas) → verified explicitly in the Phase 0 smoke test before any HUD work.
- *Z-index interplay* with the existing loading screen (z:100) and rotate prompt (z:9999) → UI root sits at z:10–40, between canvas and loading.
- *Dropping `@babylonjs/gui`* → only after a repo-wide check that nothing else imports it (off-screen indicators and overlays are the main current users; all migrate).
- *FOUC / font flash* → negligible; the loading screen covers startup and the UI mounts after the run begins.

## 11. Open questions

None blocking. Exact body font face (EB Garamond vs keeping system Georgia to trim bundle) can be finalized during Phase 0 when we see it in-engine.
