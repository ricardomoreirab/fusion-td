# DOM UI — Foundation + HUD Implementation Plan (Plan 1 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the Forged Fantasy DOM/CSS design-system foundation (build pipeline, tokens, fonts, primitives) and migrate the in-game HUD from BabylonJS GUI to a responsive DOM overlay.

**Architecture:** A `#ui-root` DOM layer sits above the canvas with `pointer-events:none`; only interactive widgets opt back in, so the 3D scene still receives movement/targeting input. A `GameUI` manager owns stacked layer divs (`hud`, `fx`, `indicators`, `overlay`). The HUD is rebuilt as vanilla-TS components driven by CSS custom-property tokens; per-frame `update()` only sets CSS vars + toggles classes (CSS runs the animations). Overlays/joystick/menus stay on Babylon GUI for now (coexist on separate layers) — they migrate in Plans 2 and 3.

**Tech Stack:** TypeScript, webpack 5 (ts-loader + new css-loader/style-loader + asset/resource for fonts), vanilla DOM, CSS custom properties + `clamp()` + media/container queries, Vitest (node env, pure-logic tests only).

**Reference spec:** `docs/superpowers/specs/2026-05-29-dom-ui-design-system-design.md`

---

## Verification model (read first)

This codebase cannot unit-test DOM/Babylon code — Vitest runs in a **node** environment and is reserved for pure logic (see `vitest.config.ts`). So tasks use two verification styles:

- **Pure-logic tasks** (e.g. `format.ts`): full TDD — write a failing Vitest spec, run it red, implement, run it green.
- **DOM/CSS tasks**: verification = `npx tsc --noEmit` passes **and** `npm run build` succeeds, plus the explicit in-browser check the task names (run `npm start`, open `http://localhost:9000`). Do not claim a DOM task done without the build passing.

Commit after every task.

## File structure (created/modified in this plan)

```
Modified:
  webpack.config.js                         + css & font loader rules
  package.json                              + css-loader, style-loader (devDeps)
  src/index.html                            + <div id="ui-root">
  src/index.ts                              + import './ui/styles/index.css'
  src/survivors/SurvivorsGameplayState.ts   swap HeroHud → Hud; create/dispose GameUI

Created:
  src/ui/styles/index.css        aggregator (@import the rest)
  src/ui/styles/tokens.css       design tokens (:root custom properties)
  src/ui/styles/fonts.css        @font-face (Cinzel, EB Garamond)
  src/ui/styles/base.css         #ui-root, layers, pointer-events, resets
  src/ui/styles/components.css   primitive + HUD component styles
  src/ui/fonts/*.woff2           self-hosted font files
  src/ui/dom.ts                  el() DOM builder helper
  src/ui/format.ts               pure formatting helpers (TDD)
  src/ui/interaction.ts          onTap + haptic + pulseClass helpers
  src/ui/primitives/Frame.ts     ornate + lite frame factory
  src/ui/primitives/Pill.ts      HP / wave / gold pill
  src/ui/primitives/IconSlot.ts  power & item slot (icon, level badge, cooldown)
  src/ui/primitives/Button.ts    forged + ghost button
  src/ui/GameUI.ts               #ui-root layer manager
  src/ui/hud/Hud.ts              the in-game HUD (replaces HeroHud)
  tests/uiFormat.spec.ts         Vitest spec for format.ts
```

> `Modal.ts`, `Card.ts`, the overlays, joystick, menu, and game-over migrations are **deliberately out of scope** for this plan — they live in Plans 2 and 3, after this foundation is validated in-engine.

---

## Phase 0 — Foundation

### Task 1: Add CSS + font support to webpack

**Files:**
- Modify: `webpack.config.js:13-21` (module.rules)
- Modify: `package.json` (devDependencies)

- [ ] **Step 1: Install the loaders**

Run:
```bash
npm install -D css-loader@^6 style-loader@^3
```
Expected: both added under `devDependencies`, no errors.

- [ ] **Step 2: Add the rules**

In `webpack.config.js`, replace the `module.rules` array (currently only the ts rule) with:

```js
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: 'ts-loader',
        exclude: /node_modules/,
      },
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader'],
      },
      {
        test: /\.woff2?$/,
        type: 'asset/resource',
        generator: { filename: 'fonts/[name][ext]' },
      },
    ],
  },
```

- [ ] **Step 3: Verify the build still works (no CSS imported yet)**

Run: `npm run build`
Expected: build completes, `dist/bundle.js` emitted, no errors.

- [ ] **Step 4: Commit**

```bash
git add webpack.config.js package.json package-lock.json
git commit -m "build(ui): add css-loader, style-loader, and font asset rule"
```

---

### Task 2: Design tokens (`tokens.css`)

**Files:**
- Create: `src/ui/styles/tokens.css`

- [ ] **Step 1: Write the tokens**

```css
/* Forged Fantasy design tokens. Palette drawn from index.html's loading
   screen + the in-game element colors. */
:root {
  /* ── Color: structure ── */
  --c-void: #07050a;
  --c-stone-900: #14110c;
  --c-stone-800: #1d1a13;
  --c-stone-700: #2a2418;
  --c-leather: #241a10;
  --c-iron: #4a4438;
  --c-gold: #c9a23f;
  --c-gold-hi: #f3da8e;
  --c-gold-lo: #7a5f24;
  --c-blood: #c8302a;
  --c-blood-deep: #6a1812;
  --c-moss: #88a070;
  --c-parchment: #ece0c8;
  --c-parchment-dim: #b8a888;
  --c-parchment-faint: #8a7868;

  /* ── Color: elements + tiers ── */
  --el-fire: #ff6030;
  --el-ice: #30cfff;
  --el-arcane: #b050ff;
  --el-physical: #e0e0e0;
  --el-storm: #ffe040;
  --tier-fusion: #c060ff;
  --tier-ultimate: #ffd24d;

  /* ── Spacing ── */
  --s-1: 4px;
  --s-2: 8px;
  --s-3: 12px;
  --s-4: 16px;
  --s-6: 24px;
  --s-8: 32px;

  /* ── Radii ── */
  --r-sm: 4px;
  --r-md: 6px;
  --r-lg: 10px;
  --r-pill: 999px;

  /* ── Typography ── */
  --ff-display: 'Cinzel', 'Georgia', serif;
  --ff-body: 'EB Garamond', 'Georgia', serif;
  /* Fluid type scale: clamp(min, fluid, max) */
  --fs-100: clamp(9px, 1.6vw, 11px);
  --fs-200: clamp(11px, 1.9vw, 13px);
  --fs-300: clamp(12px, 2.2vw, 15px);
  --fs-400: clamp(14px, 2.6vw, 18px);
  --fs-500: clamp(16px, 3vw, 22px);
  --fs-600: clamp(20px, 4vw, 30px);

  /* ── Bevel / shadow recipes ── */
  --bevel-ornate:
    inset 0 1px 0 var(--c-gold-hi),
    inset 0 0 0 2px rgba(0, 0, 0, 0.55),
    inset 0 -10px 22px rgba(0, 0, 0, 0.55),
    0 8px 22px rgba(0, 0, 0, 0.7);
  --bevel-lite:
    inset 0 1px 0 rgba(243, 218, 142, 0.25),
    0 2px 6px rgba(0, 0, 0, 0.5);

  /* ── HUD sizing (fluid, landscape) ── */
  --hud-slot: clamp(32px, 6vw, 44px);
  --hud-ult: clamp(40px, 8vw, 58px);
  --hud-pad: clamp(8px, 1.6vw, 14px);

  /* ── Z layers (within #ui-root) ── */
  --z-hud: 10;
  --z-indicators: 15;
  --z-fx: 30;
  --z-overlay: 40;
}
```

- [ ] **Step 2: Verify CSS parses (build after it is imported in Task 4)**

No standalone check here — `tokens.css` is imported via `index.css` in Task 4; the build verification there covers it.

- [ ] **Step 3: Commit**

```bash
git add src/ui/styles/tokens.css
git commit -m "feat(ui): forged-fantasy design tokens"
```

---

### Task 3: Bundle the fonts (`fonts.css` + woff2)

**Files:**
- Create: `src/ui/fonts/cinzel-400.woff2`, `src/ui/fonts/cinzel-700.woff2`, `src/ui/fonts/ebgaramond-400.woff2`, `src/ui/fonts/ebgaramond-700.woff2`
- Create: `src/ui/styles/fonts.css`

- [ ] **Step 1: Download the font files (OFL-licensed, self-hosted)**

Run:
```bash
mkdir -p src/ui/fonts
curl -L -o src/ui/fonts/cinzel-400.woff2      https://cdn.jsdelivr.net/fontsource/fonts/cinzel@latest/latin-400-normal.woff2
curl -L -o src/ui/fonts/cinzel-700.woff2      https://cdn.jsdelivr.net/fontsource/fonts/cinzel@latest/latin-700-normal.woff2
curl -L -o src/ui/fonts/ebgaramond-400.woff2  https://cdn.jsdelivr.net/fontsource/fonts/eb-garamond@latest/latin-400-normal.woff2
curl -L -o src/ui/fonts/ebgaramond-700.woff2  https://cdn.jsdelivr.net/fontsource/fonts/eb-garamond@latest/latin-700-normal.woff2
```
Expected: four non-empty `.woff2` files (each > 10KB). Verify with `ls -l src/ui/fonts`.

- [ ] **Step 2: Write the @font-face declarations**

```css
/* Self-hosted display + body faces. url() resolves through webpack's
   asset/resource rule (Task 1) → dist/fonts/. */
@font-face {
  font-family: 'Cinzel';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url('../fonts/cinzel-400.woff2') format('woff2');
}
@font-face {
  font-family: 'Cinzel';
  font-style: normal;
  font-weight: 700;
  font-display: swap;
  src: url('../fonts/cinzel-700.woff2') format('woff2');
}
@font-face {
  font-family: 'EB Garamond';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url('../fonts/ebgaramond-400.woff2') format('woff2');
}
@font-face {
  font-family: 'EB Garamond';
  font-style: normal;
  font-weight: 700;
  font-display: swap;
  src: url('../fonts/ebgaramond-700.woff2') format('woff2');
}
```

- [ ] **Step 3: Commit**

```bash
git add src/ui/fonts src/ui/styles/fonts.css
git commit -m "feat(ui): bundle Cinzel + EB Garamond fonts"
```

---

### Task 4: Base layer CSS + `#ui-root` mount + style import

**Files:**
- Create: `src/ui/styles/base.css`
- Create: `src/ui/styles/components.css` (empty stub for now)
- Create: `src/ui/styles/index.css`
- Modify: `src/index.html:218` (after the canvas)
- Modify: `src/index.ts:1` (add the CSS import)

- [ ] **Step 1: Write `base.css`**

```css
/* The DOM UI overlay. Sits above the canvas; transparent to pointer
   events except where a widget opts back in with .interactive. */
#ui-root {
  position: fixed;
  inset: 0;
  z-index: 10;
  pointer-events: none;
  font-family: var(--ff-body);
  color: var(--c-parchment);
  -webkit-user-select: none;
  user-select: none;
  -webkit-touch-callout: none;
  -webkit-tap-highlight-color: transparent;
}

#ui-root .layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
}
#ui-root .layer-hud { z-index: var(--z-hud); }
#ui-root .layer-indicators { z-index: var(--z-indicators); }
#ui-root .layer-fx { z-index: var(--z-fx); }
#ui-root .layer-overlay { z-index: var(--z-overlay); }

/* Opt back into pointer events for interactive widgets. */
#ui-root .interactive { pointer-events: auto; }

/* Honour notches in landscape. */
#ui-root .layer-hud {
  padding:
    max(var(--hud-pad), env(safe-area-inset-top))
    max(var(--hud-pad), env(safe-area-inset-right))
    max(var(--hud-pad), env(safe-area-inset-bottom))
    max(var(--hud-pad), env(safe-area-inset-left));
}
```

- [ ] **Step 2: Create the empty components stub**

Create `src/ui/styles/components.css` with a single comment so the import resolves:
```css
/* Component styles are appended by later tasks. */
```

- [ ] **Step 3: Write the aggregator `index.css`**

```css
@import './tokens.css';
@import './fonts.css';
@import './base.css';
@import './components.css';
```

- [ ] **Step 4: Add `#ui-root` to the HTML**

In `src/index.html`, immediately after `<canvas id="renderCanvas"></canvas>` (line 218) add:
```html
    <div id="ui-root"></div>
```

- [ ] **Step 5: Import the styles in the entry point**

At the very top of `src/index.ts` (before the `Game` import) add:
```ts
import './ui/styles/index.css';
```

- [ ] **Step 6: Verify build + fonts load**

Run: `npm run build`
Expected: build succeeds; `dist/fonts/` contains the four woff2 files.

Then run: `npm start`, open `http://localhost:9000`. Expected: game looks unchanged (the overlay is empty + transparent). In DevTools, confirm `#ui-root` exists and the Network tab shows the woff2 files loading 200.

- [ ] **Step 7: Commit**

```bash
git add src/ui/styles src/index.html src/index.ts
git commit -m "feat(ui): mount #ui-root overlay + wire design-system stylesheet"
```

---

### Task 5: `dom.ts` element builder

**Files:**
- Create: `src/ui/dom.ts`

- [ ] **Step 1: Write the helper**

```ts
/** Minimal DOM builder. No framework — just typed element creation. */
export interface ElProps {
  class?: string;
  text?: string;
  /** Inline style: either a CSS string or property map. Supports custom props (--x). */
  style?: string | Record<string, string>;
  /** data-* attributes. */
  data?: Record<string, string>;
  /** Arbitrary attributes (aria-*, role, etc.). */
  attrs?: Record<string, string>;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: ElProps = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props.class) node.className = props.class;
  if (props.text !== undefined) node.textContent = props.text;
  if (props.style) {
    if (typeof props.style === 'string') {
      node.style.cssText = props.style;
    } else {
      for (const [k, v] of Object.entries(props.style)) {
        node.style.setProperty(k, v);
      }
    }
  }
  if (props.data) {
    for (const [k, v] of Object.entries(props.data)) node.dataset[k] = v;
  }
  if (props.attrs) {
    for (const [k, v] of Object.entries(props.attrs)) node.setAttribute(k, v);
  }
  for (const c of children) {
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

/** Set a CSS custom property on an element (typed convenience). */
export function setVar(node: HTMLElement, name: `--${string}`, value: string): void {
  node.style.setProperty(name, value);
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/ui/dom.ts
git commit -m "feat(ui): el() DOM builder helper"
```

---

### Task 6: `format.ts` pure helpers (TDD)

**Files:**
- Create: `tests/uiFormat.spec.ts`
- Create: `src/ui/format.ts`

- [ ] **Step 1: Write the failing test**

`tests/uiFormat.spec.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { cooldownFraction, waveLabel, goldLabel } from '../src/ui/format';

describe('cooldownFraction', () => {
  it('clamps to 0..1', () => {
    expect(cooldownFraction(5, 10)).toBe(0.5);
    expect(cooldownFraction(20, 10)).toBe(1);
    expect(cooldownFraction(-1, 10)).toBe(0);
  });
  it('returns 0 when total is non-positive', () => {
    expect(cooldownFraction(5, 0)).toBe(0);
  });
});

describe('waveLabel', () => {
  it('formats an in-progress wave', () => {
    expect(waveLabel({ wave: 3, enemiesAlive: 12, inProgress: true })).toBe('WAVE 3 · 12 LEFT');
  });
  it('formats the starting state', () => {
    expect(waveLabel({ wave: 0, enemiesAlive: 0, inProgress: false })).toBe('WAVE 1 STARTING');
  });
  it('formats a cleared wave', () => {
    expect(waveLabel({ wave: 4, enemiesAlive: 0, inProgress: false })).toBe('WAVE 4 CLEARED');
  });
  it('returns empty string when no info', () => {
    expect(waveLabel(undefined)).toBe('');
  });
});

describe('goldLabel', () => {
  it('prefixes the coin glyph', () => {
    expect(goldLabel(240)).toBe('◯ 240');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/uiFormat.spec.ts`
Expected: FAIL — `Cannot find module '../src/ui/format'`.

- [ ] **Step 3: Implement `format.ts`**

```ts
/** Pure formatting helpers shared by HUD components. No DOM, no Babylon. */

export interface WaveInfo {
  wave: number;
  enemiesAlive: number;
  inProgress: boolean;
}

/** Clamp remaining/total to a 0..1 cooldown fraction. */
export function cooldownFraction(remaining: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(1, Math.max(0, remaining / total));
}

/** The wave-indicator label. Mirrors the legacy HeroHud wording. */
export function waveLabel(info?: WaveInfo): string {
  if (!info) return '';
  if (info.inProgress) return `WAVE ${info.wave} · ${info.enemiesAlive} LEFT`;
  if (info.wave === 0) return 'WAVE 1 STARTING';
  return `WAVE ${info.wave} CLEARED`;
}

/** Gold pill text. */
export function goldLabel(gold: number): string {
  return `◯ ${gold}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/uiFormat.spec.ts`
Expected: PASS (8 assertions).

- [ ] **Step 5: Commit**

```bash
git add tests/uiFormat.spec.ts src/ui/format.ts
git commit -m "feat(ui): pure HUD format helpers (cooldown/wave/gold)"
```

---

### Task 7: `interaction.ts` — tap + haptic + one-shot class

**Files:**
- Create: `src/ui/interaction.ts`

- [ ] **Step 1: Write the helpers**

```ts
/** Tap/press + haptic + transient-class helpers for DOM UI.
   Visual press feedback (scale on :active) is handled in CSS — this file
   only wires behaviour. */

/** Fire `fn` on tap (pointerup inside the element) and buzz where supported.
   The element is made an interactive pointer target. Returns a disposer. */
export function onTap(node: HTMLElement, fn: () => void): () => void {
  node.classList.add('interactive');
  const handler = (e: PointerEvent) => {
    e.preventDefault();
    haptic(12);
    fn();
  };
  node.addEventListener('pointerup', handler);
  return () => node.removeEventListener('pointerup', handler);
}

/** Single short vibration where supported (mobile Chrome / Android). */
export function haptic(ms: number = 12): void {
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    try { navigator.vibrate(ms); } catch { /* ignore */ }
  }
}

/** Add a class, then remove it when its CSS animation ends (one-shot FX).
   Re-adds cleanly if called again mid-animation. */
export function flashClass(node: HTMLElement, className: string): void {
  node.classList.remove(className);
  // Force reflow so re-adding restarts the animation.
  void node.offsetWidth;
  node.classList.add(className);
  const done = () => {
    node.classList.remove(className);
    node.removeEventListener('animationend', done);
  };
  node.addEventListener('animationend', done);
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/ui/interaction.ts
git commit -m "feat(ui): tap/haptic/flash interaction helpers"
```

---

### Task 8: `Frame` primitive + CSS

The `.frame--lite` CSS class is consumed immediately by `Pill` and `IconSlot` (Tasks 9–10). The `makeFrame()` factory's first caller is Plan 2's `Modal`/`Card` (ornate frames) — it ships here because it is the foundational frame primitive, not dead code.

**Files:**
- Create: `src/ui/primitives/Frame.ts`
- Modify: `src/ui/styles/components.css`

- [ ] **Step 1: Write the factory**

```ts
import { el } from '../dom';

export type FrameVariant = 'ornate' | 'lite';

export interface FrameOpts {
  variant: FrameVariant;
  /** Optional accent color (element/tier) applied as the --accent custom prop. */
  accent?: string;
  class?: string;
}

/** A forged panel. `ornate` for menus, `lite` for the in-game HUD. */
export function makeFrame(opts: FrameOpts): HTMLDivElement {
  const node = el('div', {
    class: `frame frame--${opts.variant}${opts.class ? ' ' + opts.class : ''}`,
  });
  if (opts.accent) node.style.setProperty('--accent', opts.accent);
  return node;
}
```

- [ ] **Step 2: Append the CSS**

Append to `src/ui/styles/components.css`:
```css
/* ── Frame ───────────────────────────────────────────────── */
.frame {
  --accent: var(--c-gold);
  position: relative;
  box-sizing: border-box;
}
.frame--ornate {
  background: linear-gradient(180deg, var(--c-stone-700), var(--c-stone-900));
  border: 2px solid var(--c-gold);
  border-radius: var(--r-md);
  box-shadow: var(--bevel-ornate);
}
.frame--ornate::before,
.frame--ornate::after {
  content: '';
  position: absolute;
  width: 12px;
  height: 12px;
  border: 2px solid var(--c-gold-hi);
  opacity: 0.85;
  pointer-events: none;
}
.frame--ornate::before { top: 5px; left: 5px; border-right: none; border-bottom: none; }
.frame--ornate::after { bottom: 5px; right: 5px; border-left: none; border-top: none; }
.frame--lite {
  background: linear-gradient(180deg, rgba(36, 28, 18, 0.72), rgba(14, 11, 8, 0.72));
  border: 1px solid color-mix(in srgb, var(--accent) 55%, transparent);
  border-radius: var(--r-sm);
  box-shadow: var(--bevel-lite);
}
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npm run build`
Expected: both succeed.

- [ ] **Step 4: Commit**

```bash
git add src/ui/primitives/Frame.ts src/ui/styles/components.css
git commit -m "feat(ui): Frame primitive (ornate + lite)"
```

---

### Task 9: `Pill` primitive + CSS

**Files:**
- Create: `src/ui/primitives/Pill.ts`
- Modify: `src/ui/styles/components.css`

- [ ] **Step 1: Write the factory**

```ts
import { el } from '../dom';

export type PillKind = 'hp' | 'wave' | 'gold';

export interface PillController {
  root: HTMLDivElement;
  /** Set the displayed text. */
  setText(text: string): void;
  /** For the HP pill only — set the fill ratio 0..1. */
  setFill(ratio: number): void;
}

/** A light-forged capsule (HP / wave / gold). The HP variant carries a fill bar. */
export function makePill(kind: PillKind): PillController {
  const root = el('div', { class: `pill pill--${kind} frame frame--lite interactive` });

  let fill: HTMLDivElement | null = null;
  if (kind === 'hp') {
    fill = el('div', { class: 'pill__fill' });
    root.appendChild(fill);
  }
  const txt = el('div', { class: 'pill__txt' });
  root.appendChild(txt);

  return {
    root,
    setText(text) { if (txt.textContent !== text) txt.textContent = text; },
    setFill(ratio) {
      if (fill) fill.style.width = `${Math.max(0, Math.min(1, ratio)) * 100}%`;
    },
  };
}
```

- [ ] **Step 2: Append the CSS**

Append to `src/ui/styles/components.css`:
```css
/* ── Pill ────────────────────────────────────────────────── */
.pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--s-1);
  padding: var(--s-1) var(--s-3);
  font-family: var(--ff-body);
  font-weight: 700;
  font-size: var(--fs-200);
  line-height: 1;
  position: relative;
  overflow: hidden;
  white-space: nowrap;
}
.pill__txt { position: relative; text-shadow: 0 1px 2px #000; }
.pill--hp { --accent: var(--c-parchment-dim); min-width: clamp(110px, 22vw, 160px); }
.pill__fill {
  position: absolute;
  inset: 0;
  width: 100%;
  background: linear-gradient(180deg, #d2453c, #7a1f1f);
}
.pill__fill::after {
  content: '';
  position: absolute;
  inset: 0 0 auto 0;
  height: 45%;
  background: rgba(255, 255, 255, 0.18);
}
.pill--wave { --accent: var(--c-gold); color: var(--c-gold-hi); letter-spacing: 0.06em; }
.pill--gold { --accent: var(--c-gold); color: #ffd76a; }

/* Transient feedback animations */
@keyframes pill-flash-white { from { box-shadow: inset 0 0 0 999px rgba(255,255,255,0.4); } to {} }
@keyframes pill-flash-green { from { box-shadow: inset 0 0 0 999px rgba(0,255,128,0.45); } to {} }
@keyframes pill-pulse { 0%,100% { transform: scale(1); } 50% { transform: scale(1.1); } }
.pill--flash-dmg { animation: pill-flash-white 80ms linear; }
.pill--flash-clear { animation: pill-flash-green 300ms ease-out; }
.pill--pulse { animation: pill-pulse 180ms ease-out; }
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npm run build`
Expected: both succeed.

- [ ] **Step 4: Commit**

```bash
git add src/ui/primitives/Pill.ts src/ui/styles/components.css
git commit -m "feat(ui): Pill primitive (hp/wave/gold)"
```

---

### Task 10: `IconSlot` primitive + CSS

**Files:**
- Create: `src/ui/primitives/IconSlot.ts`
- Modify: `src/ui/styles/components.css`

- [ ] **Step 1: Write the factory**

```ts
import { el } from '../dom';

export interface IconSlotController {
  root: HTMLDivElement;
  setIcon(glyph: string, color: string): void;
  setAccent(color: string): void;
  setEmpty(isEmpty: boolean): void;
  /** Cooldown sweep 0..1 (1 = fully masked / just fired). */
  setCooldown(frac: number): void;
  setLevel(level: number): void;
  /** Trigger the ready-pulse FX (cooldown just completed). */
  pulseReady(): void;
}

/** A square power/item slot: icon, level badge, top-down cooldown mask. */
export function makeIconSlot(extraClass = ''): IconSlotController {
  const root = el('div', { class: `slot frame frame--lite${extraClass ? ' ' + extraClass : ''}` });
  const icon = el('div', { class: 'slot__icon' });
  const level = el('div', { class: 'slot__level' });
  const cd = el('div', { class: 'slot__cd' });
  root.append(icon, level, cd);

  let curLevel = -1;
  return {
    root,
    setIcon(glyph, color) {
      if (icon.textContent !== glyph) icon.textContent = glyph;
      icon.style.color = color;
    },
    setAccent(color) { root.style.setProperty('--accent', color); },
    setEmpty(isEmpty) { root.classList.toggle('slot--empty', isEmpty); },
    setCooldown(frac) { cd.style.height = `${Math.max(0, Math.min(1, frac)) * 100}%`; },
    setLevel(lv) {
      if (lv === curLevel) return;
      curLevel = lv;
      if (lv > 1) { level.textContent = `×${lv}`; level.style.display = ''; }
      else level.style.display = 'none';
    },
    pulseReady() {
      root.classList.remove('slot--ready');
      void root.offsetWidth;
      root.classList.add('slot--ready');
    },
  };
}
```

- [ ] **Step 2: Append the CSS**

Append to `src/ui/styles/components.css`:
```css
/* ── IconSlot ────────────────────────────────────────────── */
.slot {
  width: var(--hud-slot);
  height: var(--hud-slot);
  border-radius: var(--r-sm);
  position: relative;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  background:
    linear-gradient(180deg,
      color-mix(in srgb, var(--accent) 18%, var(--c-stone-900)),
      var(--c-stone-900));
  box-shadow:
    inset 0 1px 0 color-mix(in srgb, var(--accent) 35%, transparent),
    0 0 7px color-mix(in srgb, var(--accent) 30%, transparent);
}
.slot__icon { font-size: calc(var(--hud-slot) * 0.5); line-height: 1; }
.slot__level {
  position: absolute;
  right: 2px;
  bottom: 1px;
  font-family: var(--ff-body);
  font-weight: 800;
  font-size: calc(var(--hud-slot) * 0.26);
  color: #fff;
  text-shadow: 0 1px 1px #000;
  display: none;
}
.slot__cd {
  position: absolute;
  left: 0; right: 0; top: 0;
  height: 0;
  background: rgba(0, 0, 0, 0.55);
  pointer-events: none;
}
.slot--empty {
  border-style: dashed;
  border-color: rgba(201, 162, 63, 0.3);
  background: rgba(14, 11, 8, 0.4);
  box-shadow: none;
}
.slot--empty .slot__icon { color: rgba(201, 162, 63, 0.4); }
@keyframes slot-ready { 0% { transform: scale(1); } 50% { transform: scale(1.05); } 100% { transform: scale(1); } }
.slot--ready { animation: slot-ready 400ms ease-out; }
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npm run build`
Expected: both succeed.

- [ ] **Step 4: Commit**

```bash
git add src/ui/primitives/IconSlot.ts src/ui/styles/components.css
git commit -m "feat(ui): IconSlot primitive (cooldown sweep + level badge)"
```

---

### Task 11: `Button` primitive + CSS

**Files:**
- Create: `src/ui/primitives/Button.ts`
- Modify: `src/ui/styles/components.css`

- [ ] **Step 1: Write the factory**

```ts
import { el } from '../dom';
import { onTap } from '../interaction';

export type ButtonVariant = 'forged' | 'ghost';

export interface ButtonOpts {
  label: string;
  variant?: ButtonVariant;
  onClick: () => void;
  class?: string;
}

export function makeButton(opts: ButtonOpts): HTMLDivElement {
  const node = el('div', {
    class: `btn btn--${opts.variant ?? 'forged'}${opts.class ? ' ' + opts.class : ''}`,
    text: opts.label,
    attrs: { role: 'button', tabindex: '0' },
  });
  onTap(node, opts.onClick);
  return node;
}
```

- [ ] **Step 2: Append the CSS**

Append to `src/ui/styles/components.css`:
```css
/* ── Button ──────────────────────────────────────────────── */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-family: var(--ff-display);
  font-weight: 700;
  font-size: var(--fs-400);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  padding: var(--s-3) var(--s-6);
  border-radius: var(--r-sm);
  cursor: pointer;
  user-select: none;
  transition: transform 100ms ease;
}
.btn:active { transform: scale(0.94); }
.btn--forged {
  color: #1a1206;
  border: 2px solid var(--c-gold);
  background: linear-gradient(180deg, var(--c-gold-hi), var(--c-gold) 55%, #9a7a2e);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.5), 0 3px 0 #5a4418, 0 5px 10px rgba(0, 0, 0, 0.5);
}
.btn--ghost {
  color: var(--c-parchment);
  border: 2px solid var(--c-gold);
  background: linear-gradient(180deg, var(--c-stone-700), var(--c-stone-900));
  box-shadow: inset 0 1px 0 rgba(243, 218, 142, 0.2), 0 3px 0 #000, 0 5px 10px rgba(0, 0, 0, 0.5);
}
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npm run build`
Expected: both succeed.

- [ ] **Step 4: Commit**

```bash
git add src/ui/primitives/Button.ts src/ui/styles/components.css
git commit -m "feat(ui): Button primitive (forged + ghost)"
```

---

### Task 12: `GameUI` layer manager

**Files:**
- Create: `src/ui/GameUI.ts`

- [ ] **Step 1: Write the manager**

```ts
import { el } from './dom';

export type LayerName = 'hud' | 'fx' | 'indicators' | 'overlay';

/** Owns the layer divs inside #ui-root. One instance per game state that
   needs DOM UI; dispose() removes everything so the overlay resets fully. */
export class GameUI {
  private root: HTMLElement;
  private layers: Record<LayerName, HTMLDivElement>;

  constructor(rootId = 'ui-root') {
    const root = document.getElementById(rootId);
    if (!root) throw new Error(`#${rootId} not found — is it in index.html?`);
    this.root = root;

    const make = (name: LayerName) => el('div', { class: `layer layer-${name}` });
    this.layers = {
      hud: make('hud'),
      fx: make('fx'),
      indicators: make('indicators'),
      overlay: make('overlay'),
    };
    // Append in render order (z-index also enforces stacking).
    this.root.append(this.layers.fx, this.layers.indicators, this.layers.hud, this.layers.overlay);
  }

  layer(name: LayerName): HTMLDivElement {
    return this.layers[name];
  }

  /** Remove all layers and their contents from the DOM. */
  dispose(): void {
    for (const node of Object.values(this.layers)) node.remove();
  }
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/ui/GameUI.ts
git commit -m "feat(ui): GameUI layer manager for #ui-root"
```

---

### Task 13: Phase 0 smoke test — overlay renders + input passes through

This is the spec's critical Phase-0 gate: prove a DOM widget renders over the canvas **and** the canvas still receives movement + click-to-target input. We add a temporary demo, verify, then revert it.

**Files:**
- Modify (temporarily): `src/survivors/SurvivorsGameplayState.ts`

- [ ] **Step 1: Add a temporary demo widget**

In `src/survivors/SurvivorsGameplayState.ts`, add the imports at the top:
```ts
import { GameUI } from '../ui/GameUI';
import { makePill } from '../ui/primitives/Pill';
import { makeButton } from '../ui/primitives/Button';
```
Then inside `enter()`, immediately after `this.ui = AdvancedDynamicTexture.CreateFullscreenUI(...)` (line ~236), add:
```ts
// TEMP smoke test — remove in Step 4.
const _demoUI = new GameUI();
const _demoPill = makePill('wave');
_demoPill.setText('DOM OVERLAY OK');
_demoPill.root.style.position = 'absolute';
_demoPill.root.style.top = '60px';
_demoPill.root.style.left = '50%';
_demoPill.root.style.transform = 'translateX(-50%)';
_demoUI.layer('hud').appendChild(_demoPill.root);
const _demoBtn = makeButton({ label: 'TAP ME', variant: 'forged', onClick: () => console.log('DOM button tapped') });
_demoBtn.style.position = 'absolute';
_demoBtn.style.top = '110px';
_demoBtn.style.left = '50%';
_demoBtn.style.transform = 'translateX(-50%)';
_demoUI.layer('hud').appendChild(_demoBtn);
(this as unknown as { _demoUI: GameUI })._demoUI = _demoUI;
```

- [ ] **Step 2: Build and run**

Run: `npm run build` then `npm start`, open `http://localhost:9000`, start a run (pick a champion).
Expected: a gold "DOM OVERLAY OK" pill + "TAP ME" button render centered over the scene in the Forged Fantasy style.

- [ ] **Step 3: Manually verify passthrough (the gate)**

Confirm ALL of the following in the running game:
1. Move the hero with WASD / drag — works (canvas receives movement input).
2. Tap empty screen space to trigger a click-to-target ability (e.g. Meteor when off cooldown) — the target lands where you clicked (canvas receives the click).
3. Tapping the "TAP ME" button logs `DOM button tapped` in the console AND does **not** move/target the hero (the button claims the event; the scene does not).

If any of these fail, the pointer-events setup is wrong — fix `base.css` (`.interactive` / layer `pointer-events`) before proceeding. Do not continue until all three pass.

- [ ] **Step 4: Revert the demo**

Remove the three temporary imports and the entire `// TEMP smoke test` block added in Step 1. Run `npx tsc --noEmit` to confirm the file is clean (no unused imports).

- [ ] **Step 5: Commit (records the verified foundation; no demo code remains)**

```bash
git add src/survivors/SurvivorsGameplayState.ts
git commit -m "test(ui): verify DOM overlay renders + input passthrough (Phase 0 gate)"
```

---

## Phase 1 — In-game HUD

The new `Hud` replaces `HeroHud`. It keeps the **exact same public API** so the swap in `SurvivorsGameplayState` is mechanical: `new Hud(layer, abilityManager, game)`, `setRunItems`, `pulseItem`, `triggerUltimateByIndex`, `update(hp, gold, slots, dt, waveInfo)`, `dispose`.

Reference the legacy implementation `src/survivors/ui/HeroHud.ts` for the element/power/item glyph + color maps and the ultimate-display metadata — copy those constant maps verbatim into the new file.

### Task 14: `Hud` — top bar (HP / wave / gold)

**Files:**
- Create: `src/ui/hud/Hud.ts`
- Modify: `src/ui/styles/components.css`

- [ ] **Step 1: Write the Hud skeleton with the top bar**

```ts
import { GameUI } from '../GameUI';
import { Game } from '../../engine/Game';
import { PowerSlot } from '../../survivors/powers/PowerSlotManager';
import { AbilityManager } from '../../survivors/abilities/AbilityManager';
import { RunItems, ItemId } from '../../survivors/RunItems';
import { el } from '../dom';
import { makePill, PillController } from '../primitives/Pill';
import { flashClass } from '../interaction';
import { cooldownFraction, waveLabel, goldLabel, WaveInfo } from '../format';

// Copied verbatim from HeroHud.ts — keep in sync until HeroHud is deleted.
const ELEMENT_GLYPH: Record<string, string> = {
  fire: '🔥', ice: '◆', arcane: '◉', physical: '➤', storm: '⚡',
};
const POWER_GLYPH: Record<string, string> = {
  fireball: '🔥', frost_shards: '◆', arcane_nova: '◉',
  piercing_arrow: '➤', whirling_blades: '✦', lightning_chain: '⚡',
};
const ELEMENT_COLOR: Record<string, string> = {
  fire: '#ff6030', ice: '#30cfff', arcane: '#b050ff', physical: '#e0e0e0', storm: '#ffe040',
};

export class Hud {
  private gameUI: GameUI;
  private game: Game | null;
  private abilityManager: AbilityManager | null;
  private runItems: RunItems | null = null;

  private root: HTMLDivElement;
  private hpPill: PillController;
  private wavePill: PillController;
  private goldPill: PillController;

  // diff trackers
  private prevHp = -1;
  private prevGold = -1;
  private prevWaveInProgress = false;

  constructor(gameUI: GameUI, abilityManager?: AbilityManager, game?: Game) {
    this.gameUI = gameUI;
    this.abilityManager = abilityManager ?? null;
    this.game = game ?? null;

    this.root = el('div', { class: 'hud' });
    gameUI.layer('hud').appendChild(this.root);

    // Top bar: [HP | wave | gold]
    const topBar = el('div', { class: 'hud__topbar' });
    this.hpPill = makePill('hp');
    this.wavePill = makePill('wave');
    this.goldPill = makePill('gold');
    topBar.append(this.hpPill.root, this.wavePill.root, this.goldPill.root);
    this.root.appendChild(topBar);
  }

  setRunItems(runItems: RunItems): void { this.runItems = runItems; }

  update(
    hp: { current: number; max: number },
    gold: number,
    slots: (PowerSlot | null)[],
    deltaTime = 0,
    waveInfo?: WaveInfo,
  ): void {
    const ratio = Math.max(0, hp.current / hp.max);
    this.hpPill.setFill(ratio);
    this.hpPill.setText(`❤ ${Math.ceil(hp.current)} / ${hp.max}`);
    if (this.prevHp >= 0 && hp.current < this.prevHp - 0.01) {
      flashClass(this.hpPill.root, 'pill--flash-dmg');
    }
    this.prevHp = hp.current;

    this.goldPill.setText(goldLabel(gold));
    if (this.prevGold >= 0 && gold > this.prevGold) {
      flashClass(this.goldPill.root, 'pill--pulse');
    }
    this.prevGold = gold;

    this.wavePill.setText(waveLabel(waveInfo));
    if (waveInfo && this.prevWaveInProgress && !waveInfo.inProgress) {
      flashClass(this.wavePill.root, 'pill--flash-clear');
    }
    if (waveInfo) this.prevWaveInProgress = waveInfo.inProgress;
  }

  // Stubs completed in later tasks (kept so the API exists from the start).
  pulseItem(_id: ItemId): void { /* Task 15 */ }
  triggerUltimateByIndex(_index: number): void { /* Task 16 */ }

  dispose(): void {
    this.root.remove();
  }

  // Helpers used by later tasks
  protected glyphFor(slot: PowerSlot): { glyph: string; color: string } {
    const tier = slot.def.tier;
    const glyph = tier === 'ultimate' ? '✪'
      : tier === 'fusion' ? '✦'
      : (POWER_GLYPH[slot.def.id] ?? ELEMENT_GLYPH[slot.def.element] ?? '?');
    const color = tier === 'ultimate' ? '#ffd24d'
      : tier === 'fusion' ? '#c060ff'
      : (ELEMENT_COLOR[slot.def.element] ?? '#fff');
    return { glyph, color };
  }
  protected cdFraction = cooldownFraction;
}
```

- [ ] **Step 2: Append the HUD layout CSS**

Append to `src/ui/styles/components.css`:
```css
/* ── HUD layout ──────────────────────────────────────────── */
.hud { position: absolute; inset: 0; pointer-events: none; }
.hud__topbar {
  position: absolute;
  top: 0; left: 0; right: 0;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--s-2);
}
.hud__topbar .pill { pointer-events: none; }
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npm run build`
Expected: both succeed (Hud is not yet wired into the game — that is Task 17 — so no runtime check yet).

- [ ] **Step 4: Commit**

```bash
git add src/ui/hud/Hud.ts src/ui/styles/components.css
git commit -m "feat(ui): Hud top bar (HP/wave/gold) with tactile feedback"
```

---

### Task 15: `Hud` — power slots + item row

**Files:**
- Modify: `src/ui/hud/Hud.ts`
- Modify: `src/ui/styles/components.css`

- [ ] **Step 1: Add the glyph/color maps for items**

Below the existing constant maps in `Hud.ts`, add (copied from `HeroHud.ts`):
```ts
const ITEM_GLYPH: Record<ItemId, string> = {
  lifesteal: '♥︎', multishotCleave: '✦', knockback: '➤', attackSpeed: '⚡︎',
};
const ITEM_COLOR: Record<ItemId, string> = {
  lifesteal: '#ff2a40', multishotCleave: '#ffd84a', knockback: '#4ea7ff', attackSpeed: '#fff080',
};
const ITEM_IDS: ItemId[] = ['lifesteal', 'multishotCleave', 'knockback', 'attackSpeed'];
```

- [ ] **Step 2: Add slot fields + import**

Add the import near the top:
```ts
import { makeIconSlot, IconSlotController } from '../primitives/IconSlot';
```
Add fields to the class:
```ts
  private powerSlots: IconSlotController[] = [];
  private itemSlots: Record<ItemId, IconSlotController | null> = {
    lifesteal: null, multishotCleave: null, knockback: null, attackSpeed: null,
  };
  private prevCooldownRemaining: number[] = [-1, -1, -1, -1];
  private itemPulse: Record<ItemId, boolean> = {
    lifesteal: false, multishotCleave: false, knockback: false, attackSpeed: false,
  };
```

- [ ] **Step 3: Build the bottom-left cluster in the constructor**

At the end of the constructor, after the top bar:
```ts
    // Bottom-left cluster: 4 power slots + 4 item slots.
    const bottomLeft = el('div', { class: 'hud__cluster hud__cluster--left' });
    const powerRow = el('div', { class: 'hud__row' });
    for (let i = 0; i < 4; i++) {
      const slot = makeIconSlot();
      this.powerSlots.push(slot);
      powerRow.appendChild(slot.root);
    }
    const itemRow = el('div', { class: 'hud__row' });
    for (const id of ITEM_IDS) {
      const slot = makeIconSlot('slot--item');
      slot.setIcon(ITEM_GLYPH[id], '#3a3a46');
      slot.setAccent('#3a3a46');
      this.itemSlots[id] = slot;
      itemRow.appendChild(slot.root);
    }
    bottomLeft.append(powerRow, itemRow);
    this.root.appendChild(bottomLeft);
```

- [ ] **Step 4: Implement `pulseItem` and the power/item update logic**

Replace the `pulseItem` stub:
```ts
  pulseItem(id: ItemId): void { this.itemPulse[id] = true; }
```
At the end of `update()`, before the closing brace, add:
```ts
    // Power slots
    for (let i = 0; i < 4; i++) {
      const slot = slots[i];
      const ui = this.powerSlots[i];
      if (!slot) {
        ui.setEmpty(true);
        ui.setIcon('+', '#666');
        ui.setLevel(0);
        ui.setCooldown(0);
        this.prevCooldownRemaining[i] = -1;
        continue;
      }
      ui.setEmpty(false);
      const { glyph, color } = this.glyphFor(slot);
      ui.setIcon(glyph, color);
      ui.setAccent(color);
      ui.setLevel(slot.state.level);
      const total = slot.def.cooldownFor(slot.state);
      const remaining = Math.max(0, slot.state.cooldownRemaining);
      ui.setCooldown(this.cdFraction(remaining, total));
      const prev = this.prevCooldownRemaining[i];
      if (prev >= 0 && prev < 0.05 && remaining > total * 0.9) ui.pulseReady();
      this.prevCooldownRemaining[i] = remaining;
    }

    // Item row
    for (const id of ITEM_IDS) {
      const ui = this.itemSlots[id];
      if (!ui) continue;
      const stacks = this.runItems?.getStacks(id) ?? 0;
      const owned = stacks > 0;
      ui.setIcon(ITEM_GLYPH[id], owned ? ITEM_COLOR[id] : '#3a3a46');
      ui.setAccent(owned ? ITEM_COLOR[id] : '#3a3a46');
      ui.setLevel(stacks);
      if (this.itemPulse[id]) { ui.pulseReady(); this.itemPulse[id] = false; }
    }
```

- [ ] **Step 5: Append the cluster CSS**

Append to `src/ui/styles/components.css`:
```css
.hud__cluster { position: absolute; display: flex; gap: var(--s-2); }
.hud__cluster--left { left: 0; bottom: 0; flex-direction: column; }
.hud__row { display: flex; gap: var(--s-2); }
.hud__row .slot { pointer-events: none; }
.slot--item { --accent: #3a3a46; }
@media (max-height: 430px) { .hud__cluster { gap: var(--s-1); } .hud__row { gap: var(--s-1); } }
```

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit && npm run build`
Expected: both succeed.

- [ ] **Step 7: Commit**

```bash
git add src/ui/hud/Hud.ts src/ui/styles/components.css
git commit -m "feat(ui): Hud power slots + item row"
```

---

### Task 16: `Hud` — ultimate buttons + cooldown text

**Files:**
- Modify: `src/ui/hud/Hud.ts`
- Modify: `src/ui/styles/components.css`

- [ ] **Step 1: Add ult display metadata + import**

Extend the existing interaction import (added in Task 14) to also bring in `onTap`:
```ts
import { flashClass, onTap } from '../interaction';
```

Add the metadata map (copied from `HeroHud.ULT_DISPLAY`):
```ts
const ULT_DISPLAY: Record<string, { glyph: string; color: string }> = {
  meteor: { glyph: '☄', color: '#c04010' },
  frostNova: { glyph: '❄', color: '#3080c0' },
  whirlwind: { glyph: '\u{1F300}', color: '#4090d0' },
  smash: { glyph: '\u{1F4A5}', color: '#d06030' },
  multishot: { glyph: '\u{1F3F9}', color: '#60c060' },
  explosiveArrow: { glyph: '\u{1F4A2}', color: '#e06030' },
  dash: { glyph: '➤', color: '#a0a8c0' },
};
```

- [ ] **Step 2: Add ult fields**

```ts
  private ultButtons: { root: HTMLDivElement; label: HTMLDivElement; cd: HTMLDivElement; cdText: HTMLDivElement; id: string }[] = [];
  private ultimateActivators: (() => void)[] = [];
```

- [ ] **Step 3: Build the ult cluster in the constructor**

At the end of the constructor:
```ts
    // Bottom-right cluster: ultimate buttons.
    const bottomRight = el('div', { class: 'hud__cluster hud__cluster--right' });
    const ultDefs = this.resolveUltimateDefs();
    for (const def of ultDefs) {
      const root = el('div', { class: 'ult slot interactive' });
      root.style.setProperty('--accent', def.color);
      const label = el('div', { class: 'ult__label', text: def.glyph });
      const cd = el('div', { class: 'slot__cd' });
      const cdText = el('div', { class: 'ult__cdtext' });
      root.append(label, cd, cdText);
      const activate = () => {
        if (!this.abilityManager) return;
        if (this.abilityManager.activate(def.id)) flashClass(root, 'ult--fire');
      };
      onTap(root, activate);
      this.ultimateActivators.push(activate);
      this.ultButtons.push({ root, label, cd, cdText, id: def.id });
      bottomRight.appendChild(root);
    }
    this.root.appendChild(bottomRight);
```

- [ ] **Step 4: Add `resolveUltimateDefs` + implement `triggerUltimateByIndex` + ult update**

Add the method (ported from `HeroHud._resolveUltimateDefs`):
```ts
  private resolveUltimateDefs(): { id: string; glyph: string; color: string }[] {
    const fallback = [
      { id: 'meteor', glyph: '☄', color: '#c04010' },
      { id: 'frostNova', glyph: '❄', color: '#3080c0' },
    ];
    if (!this.abilityManager) return fallback;
    const ids = this.abilityManager.getRegisteredAbilityIds();
    if (ids.length === 0) return fallback;
    return ids.map(id => {
      const meta = ULT_DISPLAY[id];
      return { id, glyph: meta?.glyph ?? '◉', color: meta?.color ?? '#808080' };
    });
  }
```
Replace the `triggerUltimateByIndex` stub:
```ts
  triggerUltimateByIndex(index: number): void { this.ultimateActivators[index]?.(); }
```
At the end of `update()`, add the ult cooldown sync:
```ts
    if (this.abilityManager) {
      const ids = this.abilityManager.getRegisteredAbilityIds();
      for (let i = 0; i < this.ultButtons.length; i++) {
        const btn = this.ultButtons[i];
        const ability = this.abilityManager.getAbility(ids[i]);
        if (!ability) continue;
        if (ability.isReady) {
          btn.cd.style.height = '0%';
          btn.cdText.textContent = '';
          btn.label.style.opacity = '1';
        } else {
          btn.cd.style.height = `${this.cdFraction(ability.currentCooldown, ability.cooldown) * 100}%`;
          const secs = ability.currentCooldown;
          btn.cdText.textContent = secs >= 10 ? `${Math.ceil(secs)}` : secs.toFixed(1);
          btn.label.style.opacity = '0.35';
        }
      }
    }
```

- [ ] **Step 5: Append the ult CSS**

Append to `src/ui/styles/components.css`:
```css
/* ── Ultimate buttons ────────────────────────────────────── */
.hud__cluster--right { right: 0; bottom: 0; flex-direction: row; }
.ult {
  width: var(--hud-ult);
  height: var(--hud-ult);
  border-radius: var(--r-md);
  cursor: pointer;
}
.ult__label { font-size: calc(var(--hud-ult) * 0.45); line-height: 1; transition: opacity 120ms; }
.ult__cdtext {
  position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: center;
  font-family: var(--ff-body); font-weight: 800;
  font-size: calc(var(--hud-ult) * 0.3); color: #fff;
}
@keyframes ult-fire { from { box-shadow: inset 0 0 0 999px rgba(255,255,255,0.6); } to {} }
.ult--fire { animation: ult-fire 200ms linear; }
```

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit && npm run build`
Expected: both succeed.

- [ ] **Step 7: Commit**

```bash
git add src/ui/hud/Hud.ts src/ui/styles/components.css
git commit -m "feat(ui): Hud ultimate buttons with cooldown countdown"
```

---

### Task 17: `Hud` — pause button + low-HP vignette, then swap into the game

**Files:**
- Modify: `src/ui/hud/Hud.ts`
- Modify: `src/ui/styles/components.css`
- Modify: `src/survivors/SurvivorsGameplayState.ts` (lines 236-ish, 569-580, 843-844)

- [ ] **Step 1: Add the pause button + vignette in the constructor**

Add fields:
```ts
  private pauseIcon!: HTMLDivElement;
  private vignette!: HTMLDivElement;
  private lowHpTime = 0;
```
At the end of the constructor:
```ts
    // Pause button (top-right, left of gold).
    const pauseBtn = el('div', { class: 'hud__pause interactive', attrs: { role: 'button' } });
    this.pauseIcon = el('div', { class: 'hud__pause-icon', text: '⏸' });
    pauseBtn.appendChild(this.pauseIcon);
    onTap(pauseBtn, () => {
      if (!this.game) return;
      this.game.togglePause();
      this.pauseIcon.textContent = this.game.getIsPaused() ? '▶' : '⏸';
    });
    this.root.appendChild(pauseBtn);

    // Low-HP vignette lives on the fx layer.
    this.vignette = el('div', { class: 'hud__vignette' });
    this.gameUI.layer('fx').appendChild(this.vignette);
```

- [ ] **Step 2: Drive the vignette in `update()`**

At the end of `update()`:
```ts
    const inDanger = ratio < 0.25;
    if (inDanger) {
      this.lowHpTime += deltaTime;
      const a = 0.08 + 0.1 * Math.max(0, Math.sin(this.lowHpTime * Math.PI * 1.8));
      this.vignette.style.opacity = `${a}`;
    } else {
      this.vignette.style.opacity = '0';
      this.lowHpTime = 0;
    }
```

- [ ] **Step 3: Update `dispose()` to remove the vignette too**

```ts
  dispose(): void {
    this.root.remove();
    this.vignette.remove();
  }
```

- [ ] **Step 4: Append the pause + vignette CSS**

Append to `src/ui/styles/components.css`:
```css
/* ── Pause button + vignette ─────────────────────────────── */
.hud__pause {
  position: absolute;
  top: 0;
  right: clamp(100px, 22vw, 130px); /* clears the gold pill */
  width: clamp(30px, 5vw, 36px);
  height: clamp(30px, 5vw, 36px);
  display: flex; align-items: center; justify-content: center;
  border-radius: var(--r-pill);
  background: linear-gradient(180deg, rgba(36,28,18,.8), rgba(14,11,8,.8));
  border: 1px solid var(--c-gold);
  cursor: pointer;
}
.hud__pause-icon { font-size: clamp(14px, 2.6vw, 18px); color: var(--c-parchment); }

/* Touch devices: guarantee 44px minimum tap targets on interactive HUD widgets. */
@media (pointer: coarse) {
  .hud__pause { width: 44px; height: 44px; }
  .ult { min-width: 44px; min-height: 44px; }
}
.hud__vignette {
  position: absolute; inset: 0;
  opacity: 0;
  pointer-events: none;
  background: radial-gradient(ellipse at center, transparent 45%, rgba(200,20,20,0.85) 100%);
  transition: opacity 120ms linear;
}
```

- [ ] **Step 5: Swap `HeroHud` → `Hud` in the gameplay state**

In `src/survivors/SurvivorsGameplayState.ts`:

a) Replace the import (line 22):
```ts
import { Hud } from '../ui/hud/Hud';
import { GameUI } from '../ui/GameUI';
```
(delete `import { HeroHud } from './ui/HeroHud';`)

b) Change the field (line ~198):
```ts
    private hud: Hud | null = null;
    private gameUI: GameUI | null = null;
```

c) In `enter()`, right after `this.ui = AdvancedDynamicTexture.CreateFullscreenUI(...)` (line ~236), create the DOM UI manager:
```ts
        this.gameUI = new GameUI();
```

d) Replace the HUD construction (line ~576):
```ts
        this.hud = new Hud(this.gameUI, this.abilityManager, this.game);
```

e) In `exit()`, after `this.hud = null;` (line ~844), add:
```ts
        this.gameUI?.dispose();
        this.gameUI = null;
```

- [ ] **Step 6: Verify in-engine (the Phase 1 acceptance check)**

Run: `npx tsc --noEmit && npm run build`, then `npm start`, open `http://localhost:9000`, start a run.

Confirm:
1. HP / wave / gold pills render top in the new Forged style; HP bar drains and the pill flashes white when you take damage; gold pill pulses when gold increases; wave pill flashes green on wave clear.
2. Power slots show element glyphs + level badges; the cooldown mask sweeps down and the slot pulses when a power comes off cooldown.
3. Item slots light up / show stack counts as items are picked up.
4. Ultimate buttons fire on tap (and Q/E/Space); cooldown text counts down; tapping a ready ult flashes it.
5. Pause button toggles pause and swaps ⏸/▶.
6. Low-HP red vignette pulses below 25% HP.
7. Resize the window from desktop width down to phone-landscape width — every element scales and **nothing overlaps** (the old Babylon GUI HUD is gone; overlays/joystick still render via GUI — expected).

- [ ] **Step 7: Commit**

```bash
git add src/ui/hud/Hud.ts src/ui/styles/components.css src/survivors/SurvivorsGameplayState.ts
git commit -m "feat(ui): pause button + low-HP vignette; swap HeroHud → DOM Hud"
```

---

## Done-when (this plan)

- The in-game HUD renders entirely via DOM/CSS in the Forged Fantasy style, driven by design tokens.
- It is fluidly responsive across phone-landscape → desktop with no overlap, verified by resizing.
- Input passthrough is proven: movement + click-to-target work; HUD widgets capture their own taps.
- `HeroHud.ts` is no longer referenced by the gameplay state (it is left on disk for reference and deleted in Plan 3's cleanup phase, along with `HudStyle.ts`/`responsive.ts` and the `@babylonjs/gui` dependency once overlays/menus have migrated).
- All Vitest tests pass; `npx tsc --noEmit` and `npm run build` are clean.

## Next plans

- **Plan 2 — In-run overlays (ornate):** `Modal` + `Card` primitives, then `PowerChoice`, `ReplaceSlot`, `Shop`, `ChampionSelect`, `PauseMenu` migrated to DOM, reusing the existing callback contracts.
- **Plan 3 — Periphery + cleanup:** DOM `Joystick`, `OffscreenIndicators`, `MainMenu`, `GameOver`; then delete legacy Babylon GUI UI (`HeroHud.ts`, all `survivors/ui/*`, `shared/ui/HudStyle.ts`, `shared/ui/responsive.ts`, `PauseScreen.ts`), drop `@babylonjs/gui` if unused, and update `CLAUDE.md`.
```
