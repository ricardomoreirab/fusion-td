# UI Polish — Mobile-First HUD & Overlays Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-skin the in-game HUD and all modal overlays in a "neon glass" visual language, switch the mobile joystick to a floating-anywhere model, and add tactile feedback (press, flash, pulse, haptics) across every interactive element.

**Architecture:** A new `src/game/ui/HudStyle.ts` module owns all reusable style helpers (panel factory, pill factory, press feedback, flashes, haptics). `HeroHud.ts` and every overlay file consume those helpers so the look stays consistent. `SurvivorsJoystick.ts` is rewritten to listen on a transparent full-canvas catcher control (rather than DOM canvas events) so it naturally yields to GUI buttons via `isPointerBlocker`.

**Tech Stack:** TypeScript, BabylonJS, BabylonJS GUI (`@babylonjs/gui` — Rectangle, Ellipse, TextBlock, Control), no test framework (visual + type-check verification only).

**Spec:** `docs/superpowers/specs/2026-05-25-ui-polish-mobile-design.md`

---

## File Plan

**New file:**
- `src/game/ui/HudStyle.ts` — style constants, factory helpers (`makePill`, `makeFrame`), interaction helpers (`addPressFeedback`, `flashControl`, `pulseScale`, `tryHaptic`).

**Modified files:**
- `src/game/ui/SurvivorsJoystick.ts` — drop fixed-position logic, switch to GUI catcher control, floating-anywhere behavior.
- `src/game/ui/HeroHud.ts` — re-skin HP/Wave/Gold/slots/ultimates with `HudStyle`; apply L1 layout to both mobile + desktop; add update-loop feedback hooks (damage flash, gold pulse, wave clear flash); apply press + activation flash + haptics to ultimates.
- `src/game/ui/ChampionSelectOverlay.ts`, `src/game/ui/PowerChoiceOverlay.ts`, `src/game/ui/ReplaceSlotOverlay.ts`, `src/game/ui/BetweenWaveShopOverlay.ts`, `src/game/ui/PauseScreen.ts` — re-skin cards/buttons with `HudStyle`, add press feedback.
- `src/game/states/GameOverState.ts` — re-skin survivors summary screen + add `tryHaptic(20)` on enter.

## Verification model

The project has **no test suite** (CLAUDE.md confirms). Every task ends with:
1. `npx tsc --noEmit` — type-check passes
2. `npm run build` — webpack production build succeeds
3. Manual browser check of the changed area (devtools mobile emulation + desktop viewport)
4. Commit

---

## Task 1: Create `HudStyle.ts` foundation

**Files:**
- Create: `src/game/ui/HudStyle.ts`

- [ ] **Step 1: Create the file with the full helper module**

Create `src/game/ui/HudStyle.ts`:

```typescript
import { Rectangle, TextBlock, Control } from '@babylonjs/gui';

// ─── Neon-glass style constants ───────────────────────────────────────────
export const STYLE = {
    panelBg:            'rgba(10, 10, 22, 0.70)',
    panelBgEmpty:       'rgba(10, 10, 22, 0.40)',
    panelBorderEmpty:   'rgba(255, 255, 255, 0.20)',
    pillRadius:         999,
    frameRadius:        10,
    borderThickness:    2,
    textShadowColor:    '#000',
    textShadowBlur:     3,
    backdropDim:        'rgba(0, 0, 0, 0.65)',
} as const;

// Element colors used by HUD + overlays. Mirror of HeroHud.ELEMENT_COLOR.
export const ELEMENT_COLOR_HEX: Record<string, string> = {
    fire:     '#ff6030',
    ice:      '#30cfff',
    arcane:   '#b050ff',
    physical: '#e0e0e0',
    storm:    '#ffe040',
};

// ─── Factory helpers ──────────────────────────────────────────────────────

export interface PillResult {
    bg: Rectangle;
    text: TextBlock;
}

/**
 * Build a capsule (radius=999) labeled pill — used for HP, Wave, Gold.
 * The rect auto-fits its child width (resizeToFit on the TextBlock).
 */
export function makePill(opts: {
    name: string;
    color: string;          // border color
    initialText: string;
    fontSize: number;
    height: number;
    textColor?: string;
}): PillResult {
    const bg = new Rectangle(opts.name + 'Bg');
    bg.adaptWidthToChildren = true;
    bg.height = `${opts.height}px`;
    bg.thickness = STYLE.borderThickness;
    bg.color = opts.color;
    bg.background = STYLE.panelBg;
    bg.cornerRadius = STYLE.pillRadius;
    bg.paddingLeft = '12px';
    bg.paddingRight = '12px';

    const text = new TextBlock(opts.name + 'Text', opts.initialText);
    text.color = opts.textColor ?? '#fff';
    text.fontSize = opts.fontSize;
    text.fontStyle = 'bold';
    text.fontFamily = 'Arial';
    text.resizeToFit = true;
    text.shadowColor = STYLE.textShadowColor;
    text.shadowBlur = STYLE.textShadowBlur;
    bg.addControl(text);

    return { bg, text };
}

export interface FrameOpts {
    name: string;
    sizePx: number;             // width = height (square)
    color: string;              // border color
    isEmpty?: boolean;          // empty slot styling (low-alpha)
    cornerRadius?: number;
}

/** Build a dark-glass square frame with colored border — for slots/ults/cards. */
export function makeFrame(opts: FrameOpts): Rectangle {
    const rect = new Rectangle(opts.name);
    rect.width = `${opts.sizePx}px`;
    rect.height = `${opts.sizePx}px`;
    rect.thickness = STYLE.borderThickness;
    rect.color = opts.isEmpty ? STYLE.panelBorderEmpty : opts.color;
    rect.background = opts.isEmpty ? STYLE.panelBgEmpty : STYLE.panelBg;
    rect.cornerRadius = opts.cornerRadius ?? STYLE.frameRadius;
    return rect;
}

// ─── Interaction helpers ──────────────────────────────────────────────────

/**
 * Attach press-down scale feedback to a control. Press scales to 0.92;
 * release tweens back to 1.0 over 120ms. Optional onTap fires on release.
 * The control becomes a pointer blocker.
 */
export function addPressFeedback(control: Control, onTap?: () => void): void {
    control.isPointerBlocker = true;

    control.onPointerDownObservable.add(() => {
        control.scaleX = 0.92;
        control.scaleY = 0.92;
    });

    const release = () => {
        const start = performance.now();
        const duration = 120;
        const startScale = control.scaleX;
        const tick = () => {
            const t = Math.min(1, (performance.now() - start) / duration);
            const s = startScale + (1.0 - startScale) * t;
            control.scaleX = s;
            control.scaleY = s;
            if (t < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    };

    control.onPointerUpObservable.add(() => {
        release();
        if (onTap) onTap();
    });
    control.onPointerOutObservable.add(release);
}

/**
 * Briefly overlay a colored alpha rectangle on top of a Rectangle control.
 * Used for activation flashes (ult fired, damage taken, wave cleared).
 */
export function flashControl(parent: Rectangle, color: string, ms: number, startAlpha: number = 0.55): void {
    const flash = new Rectangle(parent.name + '_flash_' + Math.floor(Math.random() * 1e6));
    flash.width = 1.0;
    flash.height = 1.0;
    flash.thickness = 0;
    flash.background = color;
    flash.alpha = startAlpha;
    flash.cornerRadius = parent.cornerRadius;
    flash.isPointerBlocker = false;
    parent.addControl(flash);

    const start = performance.now();
    const tick = () => {
        const t = (performance.now() - start) / ms;
        if (t >= 1) {
            flash.dispose();
            return;
        }
        flash.alpha = startAlpha * (1 - t);
        requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
}

/**
 * Briefly scale a control up to `peak` and back down to its baseline.
 * Triangular ease (rise 0→1 over first half, fall back over second half).
 */
export function pulseScale(control: Control, peak: number, ms: number): void {
    const start = performance.now();
    const baseScale = control.scaleX || 1.0;
    const tick = () => {
        const t = Math.min(1, (performance.now() - start) / ms);
        const phase = t < 0.5 ? (t / 0.5) : (1 - (t - 0.5) / 0.5);
        const s = baseScale + (peak - baseScale) * phase;
        control.scaleX = s;
        control.scaleY = s;
        if (t < 1) {
            requestAnimationFrame(tick);
        } else {
            control.scaleX = baseScale;
            control.scaleY = baseScale;
        }
    };
    requestAnimationFrame(tick);
}

/** Trigger a single short vibration where supported (mobile Chrome / Android). */
export function tryHaptic(ms: number = 15): void {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        try { navigator.vibrate(ms); } catch { /* ignore */ }
    }
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: webpack production build succeeds, `dist/` updated.

- [ ] **Step 4: Commit**

```bash
git add src/game/ui/HudStyle.ts
git commit -m "feat(ui): add HudStyle module — shared neon-glass helpers"
```

---

## Task 2: Rewrite `SurvivorsJoystick` for floating-anywhere

**Files:**
- Modify: `src/game/ui/SurvivorsJoystick.ts` (full rewrite)

- [ ] **Step 1: Replace the file contents with the floating-anywhere implementation**

The new design uses a transparent full-canvas Rectangle as the pointer catcher (so UI buttons with `isPointerBlocker=true` automatically take precedence) and positions the ring + thumb dynamically at the first-touch point.

Replace the entire contents of `src/game/ui/SurvivorsJoystick.ts` with:

```typescript
import { AdvancedDynamicTexture, Ellipse, Rectangle, Control, Vector2WithInfo } from '@babylonjs/gui';

/**
 * Floating-anywhere virtual joystick.
 *
 * The joystick has no static visual. The first pointer-down on the GUI's
 * transparent catcher (any area not consumed by another GUI button)
 * positions the ring at that touch point. Dragging produces a [-1, 1]
 * direction. Release hides the ring and emits (0, 0).
 *
 * UI button precedence comes for free: any control with isPointerBlocker
 * set on top of the catcher (slots, ults, overlays) consumes the touch
 * before it reaches the catcher.
 */
export class SurvivorsJoystick {
    private ui: AdvancedDynamicTexture;
    private catcher: Rectangle;
    private ring: Ellipse;
    private thumb: Ellipse;

    private readonly baseRadius: number = 52; // visual radius (matches ring half-size)
    private readonly thumbRadius: number = 12;

    private dx: number = 0;
    private dz: number = 0;
    private activePointerId: number | null = null;
    private originX: number = 0;
    private originY: number = 0;

    private onDirectionCallback: ((dx: number, dz: number) => void) | null = null;

    constructor(ui: AdvancedDynamicTexture) {
        this.ui = ui;

        // ── Transparent full-canvas catcher ────────────────────────────────
        this.catcher = new Rectangle('joystickCatcher');
        this.catcher.width = '100%';
        this.catcher.height = '100%';
        this.catcher.thickness = 0;
        this.catcher.background = '';
        this.catcher.isPointerBlocker = true; // consumes events that reach it
        this.catcher.zIndex = -10;            // lowest — UI buttons sit above
        this.ui.addControl(this.catcher);

        // ── Ring ──────────────────────────────────────────────────────────
        this.ring = new Ellipse('joystickRing');
        this.ring.width = `${this.baseRadius * 2}px`;
        this.ring.height = `${this.baseRadius * 2}px`;
        this.ring.thickness = 1.5;
        this.ring.color = 'rgba(255, 255, 255, 0.40)';
        this.ring.background = 'rgba(255, 255, 255, 0.06)';
        this.ring.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        this.ring.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        this.ring.isVisible = false;
        this.ring.isPointerBlocker = false;
        this.ring.zIndex = -5; // above catcher, below buttons
        this.ui.addControl(this.ring);

        // ── Thumb ─────────────────────────────────────────────────────────
        this.thumb = new Ellipse('joystickThumb');
        this.thumb.width = `${this.thumbRadius * 2}px`;
        this.thumb.height = `${this.thumbRadius * 2}px`;
        this.thumb.thickness = 0;
        this.thumb.background = 'rgba(255, 255, 255, 0.70)';
        this.thumb.isPointerBlocker = false;
        this.ring.addControl(this.thumb);

        this.wireEvents();
    }

    private wireEvents(): void {
        this.catcher.onPointerDownObservable.add((coords: Vector2WithInfo) => {
            if (this.activePointerId !== null) return;
            // coords are in GUI (top-left origin) pixel space relative to the host canvas.
            // BabylonJS GUI's Vector2WithInfo has .x and .y as the local coords.
            this.activePointerId = coords.buttonIndex; // unique per touch; use as id surrogate
            this.originX = coords.x;
            this.originY = coords.y;

            // Position the ring centered on the touch
            this.ring.left = `${coords.x - this.baseRadius}px`;
            this.ring.top = `${coords.y - this.baseRadius}px`;
            this.ring.isVisible = true;
            this.thumb.left = '0px';
            this.thumb.top = '0px';
        });

        this.catcher.onPointerMoveObservable.add((coords: Vector2WithInfo) => {
            if (this.activePointerId === null) return;
            const rawDx = coords.x - this.originX;
            const rawDy = coords.y - this.originY;
            const dist = Math.hypot(rawDx, rawDy);
            const normX = dist > 0 ? rawDx / dist : 0;
            const normY = dist > 0 ? rawDy / dist : 0;
            const clamped = Math.min(dist, this.baseRadius);

            this.dx = normX * (clamped / this.baseRadius);
            this.dz = -normY * (clamped / this.baseRadius); // screen Y+ → world Z-

            // Visual thumb — bounded to ring interior
            const thumbMax = this.baseRadius - this.thumbRadius;
            this.thumb.left = `${normX * thumbMax}px`;
            this.thumb.top = `${normY * thumbMax}px`;

            if (this.onDirectionCallback) {
                this.onDirectionCallback(this.dx, this.dz);
            }
        });

        const reset = () => {
            this.activePointerId = null;
            this.dx = 0;
            this.dz = 0;
            this.ring.isVisible = false;
            this.thumb.left = '0px';
            this.thumb.top = '0px';
            if (this.onDirectionCallback) {
                this.onDirectionCallback(0, 0);
            }
        };

        this.catcher.onPointerUpObservable.add(reset);
        this.catcher.onPointerOutObservable.add(() => {
            // If the user drags outside the catcher (off-screen), keep input alive
            // — actual end comes via pointerup.
        });
    }

    public onDirection(fn: (dx: number, dz: number) => void): void {
        this.onDirectionCallback = fn;
    }

    public getDx(): number { return this.dx; }
    public getDz(): number { return this.dz; }

    public dispose(): void {
        this.catcher.dispose();
        this.ring.dispose();
        // thumb is a child of ring; ring.dispose handles it
    }
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Visual verification — start dev server**

Run: `npm start`
Open: `http://localhost:9000`

Open DevTools → enable device emulation (iPhone 12 / 390×844). Pick a champion → enter gameplay.

Verify each:
- Touch in the **center** of the canvas — ring appears centered on touch, thumb follows drag.
- Touch in the **top-right** — ring appears there.
- Touch in the **bottom-left** — ring appears there (was the only working zone before).
- Release touch — ring disappears, hero stops.
- **Tap an ultimate button** — ability fires, the joystick ring does NOT appear at the button position.
- **Drag from a power slot** — slots are not interactive, so drag should activate joystick (slots have no `isPointerBlocker` by default). This is acceptable — slot taps don't do anything anyway.

Stop server (Ctrl+C).

- [ ] **Step 5: Commit**

```bash
git add src/game/ui/SurvivorsJoystick.ts
git commit -m "feat(ui): floating-anywhere joystick — drag from any canvas touch"
```

---

## Task 3: Re-skin HUD top row (HP/Wave/Gold pills) — both mobile + desktop

**Files:**
- Modify: `src/game/ui/HeroHud.ts:121-322` (the top-bar portions of `_buildDesktop` and `_buildMobile`)

The top bar in both layouts gets the same three pills (HP, Wave, Gold) styled with `makePill`. Only the sizes differ. Hover-state, low-HP behavior, and the HP danger-zone marker are preserved.

- [ ] **Step 1: Add the imports to `HeroHud.ts`**

In `src/game/ui/HeroHud.ts` change the top imports from:

```typescript
import { AdvancedDynamicTexture, Rectangle, TextBlock, Control } from '@babylonjs/gui';
import { PowerSlot } from '../gameplay/PowerSlotManager';
import { AbilityManager } from '../gameplay/AbilityManager';
import { getLayoutMode, getRenderWidth } from './responsive';
```

to:

```typescript
import { AdvancedDynamicTexture, Rectangle, TextBlock, Control } from '@babylonjs/gui';
import { PowerSlot } from '../gameplay/PowerSlotManager';
import { AbilityManager } from '../gameplay/AbilityManager';
import { getLayoutMode, getRenderWidth } from './responsive';
import { makePill, STYLE } from './HudStyle';
```

- [ ] **Step 2: Replace the HP-bar + Gold + Wave block in `_buildDesktop`**

In `_buildDesktop()` (around lines 121-192), replace the entire HP-bar / gold / wave construction block with:

```typescript
        // ── HP bar — top-left pill ─────────────────────────────────────────
        const hpW = 260;
        const hpH = 20;
        const hpBg = new Rectangle('hpBg');
        hpBg.width = `${hpW}px`;
        hpBg.height = `${hpH}px`;
        hpBg.thickness = STYLE.borderThickness;
        hpBg.color = '#c0c0d0';
        hpBg.background = STYLE.panelBg;
        hpBg.cornerRadius = STYLE.pillRadius;
        hpBg.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        hpBg.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        hpBg.left = '10px';
        hpBg.top = '10px';
        this.ui.addControl(hpBg);
        this.builtControls.push(hpBg);

        this.hpFill = new Rectangle('hpFill');
        this.hpFill.width = 1.0;
        this.hpFill.height = 1.0;
        this.hpFill.thickness = 0;
        this.hpFill.background = '#c33';
        this.hpFill.cornerRadius = STYLE.pillRadius;
        this.hpFill.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        hpBg.addControl(this.hpFill);

        // Danger-zone marker at 25%
        this.hpDangerZone = new Rectangle('hpDangerZone');
        this.hpDangerZone.width = '2px';
        this.hpDangerZone.height = '100%';
        this.hpDangerZone.thickness = 0;
        this.hpDangerZone.background = '#ffe040';
        this.hpDangerZone.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        this.hpDangerZone.left = `${Math.round(hpW * 0.25) - 1}px`;
        hpBg.addControl(this.hpDangerZone);

        this.hpText = new TextBlock('hpText', '');
        this.hpText.color = '#fff';
        this.hpText.fontSize = 13;
        this.hpText.fontStyle = 'bold';
        this.hpText.fontFamily = 'Arial';
        this.hpText.shadowColor = STYLE.textShadowColor;
        this.hpText.shadowBlur = STYLE.textShadowBlur;
        hpBg.addControl(this.hpText);

        // ── Wave pill — top-center ─────────────────────────────────────────
        const wavePill = makePill({
            name: 'wave',
            color: '#ffe040',
            initialText: '',
            fontSize: 16,
            height: 28,
            textColor: '#ffe040',
        });
        wavePill.bg.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
        wavePill.bg.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        wavePill.bg.top = '10px';
        this.ui.addControl(wavePill.bg);
        this.builtControls.push(wavePill.bg);
        this.waveText = wavePill.text;

        // ── Gold pill — top-right ──────────────────────────────────────────
        const goldPill = makePill({
            name: 'gold',
            color: '#ffd700',
            initialText: '◯ 0',
            fontSize: 16,
            height: 28,
            textColor: '#ffd700',
        });
        goldPill.bg.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
        goldPill.bg.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        goldPill.bg.top = '10px';
        goldPill.bg.paddingRight = '10px';
        this.ui.addControl(goldPill.bg);
        this.builtControls.push(goldPill.bg);
        this.goldText = goldPill.text;
```

- [ ] **Step 3: Replace the HP-bar + Gold + Wave block in `_buildMobile`**

In `_buildMobile()` (around lines 246-322), replace the HP bar / gold / wave construction with the mobile-sized equivalent:

```typescript
        // ── HP bar — top-left pill ─────────────────────────────────────────
        const hpW = 140;
        const hpH = 14;
        const hpBg = new Rectangle('hpBg');
        hpBg.width = `${hpW}px`;
        hpBg.height = `${hpH}px`;
        hpBg.thickness = STYLE.borderThickness;
        hpBg.color = '#c0c0d0';
        hpBg.background = STYLE.panelBg;
        hpBg.cornerRadius = STYLE.pillRadius;
        hpBg.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        hpBg.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        hpBg.left = '10px';
        hpBg.top = '10px';
        this.ui.addControl(hpBg);
        this.builtControls.push(hpBg);

        this.hpFill = new Rectangle('hpFill');
        this.hpFill.width = 1.0;
        this.hpFill.height = 1.0;
        this.hpFill.thickness = 0;
        this.hpFill.background = '#c33';
        this.hpFill.cornerRadius = STYLE.pillRadius;
        this.hpFill.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        hpBg.addControl(this.hpFill);

        this.hpDangerZone = new Rectangle('hpDangerZone');
        this.hpDangerZone.width = '2px';
        this.hpDangerZone.height = '100%';
        this.hpDangerZone.thickness = 0;
        this.hpDangerZone.background = '#ffe040';
        this.hpDangerZone.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        this.hpDangerZone.left = `${Math.round(hpW * 0.25) - 1}px`;
        hpBg.addControl(this.hpDangerZone);

        this.hpText = new TextBlock('hpText', '');
        this.hpText.color = '#fff';
        this.hpText.fontSize = 10;
        this.hpText.fontStyle = 'bold';
        this.hpText.fontFamily = 'Arial';
        this.hpText.shadowColor = STYLE.textShadowColor;
        this.hpText.shadowBlur = STYLE.textShadowBlur;
        hpBg.addControl(this.hpText);

        // ── Wave pill — top-center ─────────────────────────────────────────
        const wavePill = makePill({
            name: 'wave',
            color: '#ffe040',
            initialText: '',
            fontSize: 12,
            height: 22,
            textColor: '#ffe040',
        });
        wavePill.bg.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
        wavePill.bg.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        wavePill.bg.top = '10px';
        this.ui.addControl(wavePill.bg);
        this.builtControls.push(wavePill.bg);
        this.waveText = wavePill.text;

        // ── Gold pill — top-right ──────────────────────────────────────────
        const goldPill = makePill({
            name: 'gold',
            color: '#ffd700',
            initialText: '◯ 0',
            fontSize: 12,
            height: 22,
            textColor: '#ffd700',
        });
        goldPill.bg.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
        goldPill.bg.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        goldPill.bg.top = '10px';
        goldPill.bg.paddingRight = '10px';
        this.ui.addControl(goldPill.bg);
        this.builtControls.push(goldPill.bg);
        this.goldText = goldPill.text;
```

- [ ] **Step 4: Update the wave-text format in `update()`**

Locate the wave-indicator block at the end of `update()` (around lines 629-640). Replace:

```typescript
        if (waveInfo) {
            if (waveInfo.inProgress) {
                this.waveText.text = `WAVE ${waveInfo.wave}  ·  ${waveInfo.enemiesAlive} enemies`;
            } else if (waveInfo.wave === 0) {
                this.waveText.text = `WAVE 1 STARTING...`;
            } else {
                this.waveText.text = `WAVE ${waveInfo.wave} CLEARED`;
            }
        } else {
            this.waveText.text = '';
        }
```

with:

```typescript
        if (waveInfo) {
            if (waveInfo.inProgress) {
                this.waveText.text = `WAVE ${waveInfo.wave} · ${waveInfo.enemiesAlive} LEFT`;
            } else if (waveInfo.wave === 0) {
                this.waveText.text = `WAVE 1 STARTING`;
            } else {
                this.waveText.text = `WAVE ${waveInfo.wave} CLEARED`;
            }
        } else {
            this.waveText.text = '';
        }
```

- [ ] **Step 5: Type-check + build**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 6: Visual verification**

Run: `npm start` → open `http://localhost:9000`.

Mobile viewport (iPhone 12): HP capsule top-left, wave pill top-center, gold pill top-right. All three sit in a 10px-from-top row.
Desktop viewport (1280×800): same arrangement, larger sizes.
Take damage → HP fill shrinks, danger-zone tick still visible at 25%.
Pick up gold → number increases.
Start a wave → wave text shows `WAVE 1 · N LEFT`. Clear it → shows `WAVE 1 CLEARED`.

- [ ] **Step 7: Commit**

```bash
git add src/game/ui/HeroHud.ts
git commit -m "feat(hud): top-bar L1 layout — HP/Wave/Gold pills with neon glass"
```

---

## Task 4: Re-skin power slots in HUD — both layouts

**Files:**
- Modify: `src/game/ui/HeroHud.ts` — the slot-construction blocks inside `_buildDesktop` and `_buildMobile`, and the slot-rendering loop in `update()`

- [ ] **Step 1: Update imports**

Add `makeFrame` to the HudStyle import:

```typescript
import { makePill, makeFrame, STYLE } from './HudStyle';
```

- [ ] **Step 2: Replace the slot-row block in `_buildDesktop`**

Find the slot-construction loop in `_buildDesktop` (around lines 193-233). Replace it with:

```typescript
        // ── 4 power-slot icons — bottom-center row ────────────────────────
        const slotSize = 56;
        const slotGap = 8;
        const slotRowWidth = slotSize * 4 + slotGap * 3;

        const slotRow = new Rectangle('slotRow');
        slotRow.width = `${slotRowWidth}px`;
        slotRow.height = `${slotSize}px`;
        slotRow.thickness = 0;
        slotRow.background = '';
        slotRow.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
        slotRow.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
        slotRow.top = '-10px';
        this.ui.addControl(slotRow);
        this.builtControls.push(slotRow);

        for (let i = 0; i < 4; i++) {
            const bg = makeFrame({
                name: `slotBg_${i}`,
                sizePx: slotSize,
                color: STYLE.panelBorderEmpty,
                isEmpty: true,
            });
            bg.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
            bg.left = `${i * (slotSize + slotGap)}px`;
            slotRow.addControl(bg);

            const icon = new TextBlock(`slotIcon_${i}`, '+');
            icon.color = '#666';
            icon.fontSize = 26;
            icon.fontFamily = 'Arial';
            icon.shadowColor = STYLE.textShadowColor;
            icon.shadowBlur = STYLE.textShadowBlur;
            bg.addControl(icon);

            const level = new TextBlock(`slotLvl_${i}`, '');
            level.color = '#fff';
            level.fontSize = 11;
            level.fontStyle = 'bold';
            level.fontFamily = 'Arial';
            level.shadowColor = STYLE.textShadowColor;
            level.shadowBlur = STYLE.textShadowBlur;
            level.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
            level.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
            level.paddingRight = '4px';
            level.paddingBottom = '2px';
            bg.addControl(level);

            const cdMask = new Rectangle(`slotCd_${i}`);
            cdMask.width = 1.0;
            cdMask.height = 0;
            cdMask.thickness = 0;
            cdMask.background = 'rgba(0, 0, 0, 0.55)';
            cdMask.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
            cdMask.cornerRadius = STYLE.frameRadius;
            cdMask.isPointerBlocker = false;
            bg.addControl(cdMask);

            this.slotContainers.push({ bg, icon, level, cdMask });
        }
```

- [ ] **Step 3: Replace the slot-row block in `_buildMobile`**

Find the mobile slot-construction loop (around lines 323-363). Replace with:

```typescript
        // ── 4 power-slot icons — bottom-center row ────────────────────────
        const slotSize = 42;
        const slotGap = 8;
        const slotRowWidth = slotSize * 4 + slotGap * 3;

        const slotRow = new Rectangle('slotRow');
        slotRow.width = `${slotRowWidth}px`;
        slotRow.height = `${slotSize}px`;
        slotRow.thickness = 0;
        slotRow.background = '';
        slotRow.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
        slotRow.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
        slotRow.top = '-10px';
        this.ui.addControl(slotRow);
        this.builtControls.push(slotRow);

        for (let i = 0; i < 4; i++) {
            const bg = makeFrame({
                name: `slotBg_${i}`,
                sizePx: slotSize,
                color: STYLE.panelBorderEmpty,
                isEmpty: true,
            });
            bg.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
            bg.left = `${i * (slotSize + slotGap)}px`;
            slotRow.addControl(bg);

            const icon = new TextBlock(`slotIcon_${i}`, '+');
            icon.color = '#666';
            icon.fontSize = 20;
            icon.fontFamily = 'Arial';
            icon.shadowColor = STYLE.textShadowColor;
            icon.shadowBlur = STYLE.textShadowBlur;
            bg.addControl(icon);

            const level = new TextBlock(`slotLvl_${i}`, '');
            level.color = '#fff';
            level.fontSize = 9;
            level.fontStyle = 'bold';
            level.fontFamily = 'Arial';
            level.shadowColor = STYLE.textShadowColor;
            level.shadowBlur = STYLE.textShadowBlur;
            level.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
            level.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
            level.paddingRight = '3px';
            level.paddingBottom = '2px';
            bg.addControl(level);

            const cdMask = new Rectangle(`slotCd_${i}`);
            cdMask.width = 1.0;
            cdMask.height = 0;
            cdMask.thickness = 0;
            cdMask.background = 'rgba(0, 0, 0, 0.55)';
            cdMask.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
            cdMask.cornerRadius = STYLE.frameRadius;
            cdMask.isPointerBlocker = false;
            bg.addControl(cdMask);

            this.slotContainers.push({ bg, icon, level, cdMask });
        }
```

- [ ] **Step 4: Update the slot render loop in `update()`**

In `update()`, locate the per-slot block (around lines 558-610). The current `!slot` branch sets `icon.text = '?'`. Update it to use the empty `+` styling and to restore the empty border when a slot becomes empty. Replace the `if (!slot)` branch:

```typescript
            if (!slot) {
                icon.text = '+';
                icon.color = '#666';
                level.text = '';
                cdMask.height = 0;
                bg.color = STYLE.panelBorderEmpty;
                bg.background = STYLE.panelBgEmpty;
                bg.scaleX = 1;
                bg.scaleY = 1;
                this.prevCooldownRemaining[i] = -1;
                this.slotPulseActive[i] = false;
            } else {
```

And in the populated-slot branch (`else { ... }`), update the bg styling to switch back to a populated state. Replace the lines that set `icon.text`, `icon.color`, `level.text`, `bg.color`:

```typescript
            } else {
                const glyph = POWER_GLYPH[slot.def.id] ?? ELEMENT_GLYPH[slot.def.element] ?? '?';
                const elemColor = ELEMENT_COLOR[slot.def.element] ?? '#fff';
                icon.text = glyph;
                icon.color = elemColor;
                level.text = `L${slot.state.level}`;
                bg.color = elemColor;
                bg.background = STYLE.panelBg;
                // ... rest of the existing logic (cooldown frac, pulse) unchanged
```

The rest of the populated branch (cooldown calculation, pulse tracking) stays exactly as it is.

- [ ] **Step 5: Type-check + build**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 6: Visual verification**

Run: `npm start`. Mobile + desktop viewports.
- Empty slots show faint `+` with low-alpha border.
- Pick up a power orb → slot lights up with element color and shows `L1`.
- Cooldown sweeps dark mask top-down; once ready, slot pulse-scales.
- Slots are centered horizontally at the bottom of both layouts.

- [ ] **Step 7: Commit**

```bash
git add src/game/ui/HeroHud.ts
git commit -m "feat(hud): power slots — neon-glass frame, centered row, plus-glyph empty state"
```

---

## Task 5: Re-skin ultimate buttons + press feedback + activation flash + haptics

**Files:**
- Modify: `src/game/ui/HeroHud.ts` — `_buildUltimateButtons`, `_buildMobileUltimateButtons`

- [ ] **Step 1: Update imports**

Add the interaction helpers:

```typescript
import { makePill, makeFrame, addPressFeedback, flashControl, tryHaptic, STYLE } from './HudStyle';
```

- [ ] **Step 2: Replace `_buildUltimateButtons` (desktop)**

Find `_buildUltimateButtons(startLeft, stride, btnSize, fontSize, bottomOffset, cdRadius)` around lines 412-461. The desktop call site (`this._buildUltimateButtons(400, 56, 50, 22, 8, 15);` near line 236) will be updated in the next step. For now, rewrite the method to take a row of buttons at the bottom-right and apply the new styling + feedback:

```typescript
    private _buildUltimateButtons(opts: {
        btnSize: number;
        fontSize: number;
        gap: number;
        bottomOffset: number;
        rightOffset: number;
    }): void {
        const ultimateDefs = this._resolveUltimateDefs();
        const rowWidth = ultimateDefs.length * opts.btnSize + (ultimateDefs.length - 1) * opts.gap;

        const ultRow = new Rectangle('ultRow');
        ultRow.width = `${rowWidth}px`;
        ultRow.height = `${opts.btnSize}px`;
        ultRow.thickness = 0;
        ultRow.background = '';
        ultRow.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
        ultRow.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
        ultRow.top = `-${opts.bottomOffset}px`;
        ultRow.paddingRight = `${opts.rightOffset}px`;
        this.ui.addControl(ultRow);
        this.builtControls.push(ultRow);

        ultimateDefs.forEach((def, i) => {
            const bg = makeFrame({
                name: `ultBg_${i}`,
                sizePx: opts.btnSize,
                color: def.color,
                cornerRadius: 12,
            });
            bg.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
            bg.left = `${i * (opts.btnSize + opts.gap)}px`;
            ultRow.addControl(bg);

            const label = new TextBlock(`ultLbl_${i}`, def.label);
            label.color = '#fff';
            label.fontSize = opts.fontSize;
            label.fontFamily = 'Arial';
            label.shadowColor = STYLE.textShadowColor;
            label.shadowBlur = STYLE.textShadowBlur;
            bg.addControl(label);

            const cdMask = new Rectangle(`ultCd_${i}`);
            cdMask.width = 1.0;
            cdMask.height = 0;
            cdMask.thickness = 0;
            cdMask.background = 'rgba(0, 0, 0, 0.65)';
            cdMask.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
            cdMask.cornerRadius = 12;
            cdMask.isPointerBlocker = false;
            bg.addControl(cdMask);

            const capturedId = def.id;
            addPressFeedback(bg, () => {
                if (!this.abilityManager) return;
                const fired = this.abilityManager.activate(capturedId);
                if (fired) {
                    flashControl(bg, '#ffffff', 200);
                    tryHaptic(15);
                }
            });

            this.ultimateContainers.push({ bg, label, cdMask });
        });
    }
```

- [ ] **Step 3: Remove `_buildMobileUltimateButtons` and update call sites**

Delete the `_buildMobileUltimateButtons()` method entirely (around lines 467-510 — it's now redundant; the unified method above handles both).

Then update the desktop call site (was around line 236):

```typescript
        // ── Ultimate ability buttons ──────────────────────────────────────
        this._buildUltimateButtons({
            btnSize: 60,
            fontSize: 24,
            gap: 8,
            bottomOffset: 10,
            rightOffset: 10,
        });
```

And update the mobile call site (was around line 367 calling `_buildMobileUltimateButtons()`):

```typescript
        // ── Ultimate ability buttons — bottom-right ───────────────────────
        this._buildUltimateButtons({
            btnSize: 46,
            fontSize: 18,
            gap: 8,
            bottomOffset: 10,
            rightOffset: 10,
        });
```

- [ ] **Step 4: Type-check + build**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 5: Visual verification**

Run: `npm start`. Mobile + desktop:
- Ultimate buttons sit bottom-right, side-by-side (not stacked vertically on mobile).
- Tap an ultimate while it's ready → button briefly scales down, then back up; white flash overlays the button; ability fires.
- Tap while cooling → press scale animates, but no flash, no fire.
- On mobile Chrome (real device or DevTools "Sensors → Vibration") → confirm vibrate(15) is called (DevTools logs `navigator.vibrate(15)`).

- [ ] **Step 6: Commit**

```bash
git add src/game/ui/HeroHud.ts
git commit -m "feat(hud): ultimate buttons — neon-glass + press feedback + flash + haptics"
```

---

## Task 6: Add HUD feedback hooks — damage flash, gold pulse, wave-clear flash

**Files:**
- Modify: `src/game/ui/HeroHud.ts` — add diff-tracking state + flash calls in `update()`

- [ ] **Step 1: Add new state fields**

In `HeroHud` (around the existing private fields, near line 60), add:

```typescript
    // Diff-based feedback tracking
    private prevHp: number = -1;
    private prevGold: number = -1;
    private prevWaveInProgress: boolean = false;
    private hpBg: Rectangle | null = null;
    private goldPillBg: Rectangle | null = null;
    private wavePillBg: Rectangle | null = null;
```

- [ ] **Step 2: Capture the pill backgrounds in both build methods**

In `_buildDesktop` and `_buildMobile`, immediately after creating the HP / wave / gold pills, assign:

In `_buildDesktop` after the HP block:

```typescript
        this.hpBg = hpBg;
```

After the wave pill creation in `_buildDesktop`:

```typescript
        this.wavePillBg = wavePill.bg;
```

After the gold pill creation in `_buildDesktop`:

```typescript
        this.goldPillBg = goldPill.bg;
```

Repeat the same three assignments in the corresponding spots in `_buildMobile`.

- [ ] **Step 3: Update imports to include `pulseScale`**

```typescript
import { makePill, makeFrame, addPressFeedback, flashControl, pulseScale, tryHaptic, STYLE } from './HudStyle';
```

- [ ] **Step 4: Wire diff-based feedback into `update()`**

At the top of `update()`, just below the line `const ratio = Math.max(0, hp.current / hp.max);`, add:

```typescript
        // ── Diff-based tactile feedback ─────────────────────────────────────
        const currentHp = hp.current;
        if (this.prevHp >= 0 && currentHp < this.prevHp - 0.01 && this.hpBg) {
            // Hero took damage — flash the HP bar white briefly
            flashControl(this.hpBg, '#ffffff', 80, 0.40);
        }
        this.prevHp = currentHp;

        if (this.prevGold >= 0 && gold > this.prevGold && this.goldPillBg) {
            // Gold went up — pulse the gold pill
            pulseScale(this.goldPillBg, 1.10, 180);
        }
        this.prevGold = gold;

        if (waveInfo && this.prevWaveInProgress && !waveInfo.inProgress && this.wavePillBg) {
            // Wave just cleared — flash the wave pill green
            flashControl(this.wavePillBg, '#00ff80', 300, 0.45);
        }
        if (waveInfo) {
            this.prevWaveInProgress = waveInfo.inProgress;
        }
```

- [ ] **Step 5: Reset trackers on rebuild**

In `rebuild()` (around line 108), after the dispose loop and before `this.build()`, reset the diff state so a layout change doesn't trigger a fake flash:

```typescript
    private rebuild(): void {
        // Dispose all layout controls
        if (this.lowHpVignette) {
            this.lowHpVignette.dispose();
        }
        for (const ctrl of this.builtControls) {
            ctrl.dispose();
        }
        this.prevHp = -1;
        this.prevGold = -1;
        this.prevWaveInProgress = false;
        this.hpBg = null;
        this.goldPillBg = null;
        this.wavePillBg = null;
        this.build();
    }
```

- [ ] **Step 6: Type-check + build**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 7: Visual verification**

Run: `npm start`. In gameplay:
- Take a hit → HP bar flashes white over the colored fill for ~80ms.
- Pick up gold (kill an enemy) → gold pill pulses up to ~1.10× and back.
- Clear a wave → wave pill flashes green for ~300ms before the text switches to "WAVE N CLEARED".

- [ ] **Step 8: Commit**

```bash
git add src/game/ui/HeroHud.ts
git commit -m "feat(hud): tactile feedback — damage flash, gold pulse, wave-clear flash"
```

---

## Task 7: Re-skin `ChampionSelectOverlay`

**Files:**
- Modify: `src/game/ui/ChampionSelectOverlay.ts`

- [ ] **Step 1: Inspect the file to find the card-build sites**

Run: `grep -nE "new Rectangle|onPointerClickObservable|cornerRadius" src/game/ui/ChampionSelectOverlay.ts`

Identify the card backgrounds (each champion's card panel) and the click handlers.

- [ ] **Step 2: Add the HudStyle import**

At the top of the file:

```typescript
import { makeFrame, addPressFeedback, STYLE } from './HudStyle';
```

- [ ] **Step 3: Replace card-background construction**

For each champion card's outer panel (each is a `new Rectangle('cardX')` block):

- Remove the manual `width / height / thickness / color / background / cornerRadius` assignments.
- Replace with a call to `makeFrame({ name: 'cardX', sizePx: <existing width>, color: <existing borderColor>, cornerRadius: 12 })`. If the card is not square, set `card.height` after the call.
- Apply the existing positioning (alignment, top/left/paddingLeft).

The exact mapping depends on the existing structure; preserve the existing per-champion border color (mage purple, barbarian red, archer green, etc).

- [ ] **Step 4: Replace click handlers with `addPressFeedback`**

For each card, find the existing `onPointerClickObservable.add(() => { ... })` or button click handler. Wrap the existing callback in `addPressFeedback(card, () => { <existing callback body> })`. Remove any prior `onPointerClickObservable` registration (the press helper installs its own).

- [ ] **Step 5: Restyle the backdrop**

If the overlay has a backdrop Rectangle (full-screen dim), change its `background` to `STYLE.backdropDim`.

- [ ] **Step 6: Type-check + build**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 7: Visual verification**

Run: `npm start`. Click "Play". Champion picker appears:
- Cards have dark glass background, colored border per champion, 12px corner.
- Hover → border feels slightly brighter (no explicit hover state; that's fine).
- Tap a card → card scales down briefly, then up; champion is selected.

- [ ] **Step 8: Commit**

```bash
git add src/game/ui/ChampionSelectOverlay.ts
git commit -m "feat(ui): re-skin champion select — neon-glass cards + press feedback"
```

---

## Task 8: Re-skin `PowerChoiceOverlay`

**Files:**
- Modify: `src/game/ui/PowerChoiceOverlay.ts`

- [ ] **Step 1: Add the HudStyle import**

```typescript
import { makeFrame, addPressFeedback, STYLE } from './HudStyle';
```

- [ ] **Step 2: Replace card-background construction**

Find each of the 3 power-card panels (kind = power/wildcard/perk; each has its own border color from `KIND_CONFIG`). For each:

- Replace the manual Rectangle styling with `makeFrame({ name: <cardName>, sizePx: <existing width>, color: <existing border color>, cornerRadius: 12 })`.
- If cards aren't square, override `height` after the helper call.

- [ ] **Step 3: Replace click handlers with `addPressFeedback`**

Wrap each card's click callback in `addPressFeedback(cardBg, () => { <existing callback> })`. Remove the manual `onPointerClickObservable` setup for those cards.

- [ ] **Step 4: Restyle the backdrop**

Change the full-screen dim's `background` to `STYLE.backdropDim`.

- [ ] **Step 5: Type-check + build**

Run: `npx tsc --noEmit`
Run: `npm run build`
Expected: both succeed.

- [ ] **Step 6: Visual verification**

Run: `npm start`. Play until you pick up a power orb. The 3-card slow-mo picker appears:
- Each card has neon-glass background with the kind's border color (gray/white/gold).
- Tap a card → press scale, card scales back up, choice is applied.

- [ ] **Step 7: Commit**

```bash
git add src/game/ui/PowerChoiceOverlay.ts
git commit -m "feat(ui): re-skin power-choice overlay — neon-glass cards + press feedback"
```

---

## Task 9: Re-skin `ReplaceSlotOverlay`

**Files:**
- Modify: `src/game/ui/ReplaceSlotOverlay.ts`

- [ ] **Step 1: Add imports**

```typescript
import { makeFrame, addPressFeedback, STYLE } from './HudStyle';
```

- [ ] **Step 2: Replace slot/button styling**

Find the 4 slot-replacement choice rectangles and the cancel button. For each:

- Replace manual Rectangle config with `makeFrame({ name, sizePx, color, cornerRadius: 10 })`. For non-square cancel button, set height after the call.
- Use the element color of the slot being replaced for the border (matches existing logic).
- Wrap the existing click callback in `addPressFeedback(...)`.

- [ ] **Step 3: Restyle backdrop**

Set the backdrop Rectangle's `background` to `STYLE.backdropDim`.

- [ ] **Step 4: Type-check + build**

Run: `npx tsc --noEmit`
Run: `npm run build`

- [ ] **Step 5: Visual verification**

Run: `npm start`. Fill all 4 slots, then pick up a 5th orb → replace-slot prompt appears.
- 4 slot tiles + a cancel button, all neon-glass.
- Tap each tile → press scale; replacement applies.

- [ ] **Step 6: Commit**

```bash
git add src/game/ui/ReplaceSlotOverlay.ts
git commit -m "feat(ui): re-skin replace-slot overlay — neon-glass + press feedback"
```

---

## Task 10: Re-skin `BetweenWaveShopOverlay`

**Files:**
- Modify: `src/game/ui/BetweenWaveShopOverlay.ts`

This file is the largest overlay (459 lines, 6 shop items + reroll/skip + cost displays). Apply the same treatment systematically.

- [ ] **Step 1: Add imports**

```typescript
import { makeFrame, addPressFeedback, STYLE } from './HudStyle';
```

- [ ] **Step 2: Replace shop-item card construction**

Find the loop that builds the 6 shop-item cards. For each card:

- Replace its manual Rectangle config with `makeFrame({ name, sizePx, color: <existing rarity color>, cornerRadius: 12 })`. Adjust `height` after if needed.
- Wrap the buy callback in `addPressFeedback`.

- [ ] **Step 3: Replace reroll + skip buttons**

For the reroll button: replace its Rectangle config with `makeFrame({ name: 'rerollBtn', sizePx: <width>, color: '#ffe040', cornerRadius: 10 })`, set height, wrap callback with `addPressFeedback`.

Same for skip button (use a neutral border color like `'#888'`).

- [ ] **Step 4: Restyle backdrop**

Set `background` of the full-screen dim Rectangle to `STYLE.backdropDim`.

- [ ] **Step 5: Type-check + build**

Run: `npx tsc --noEmit`
Run: `npm run build`

- [ ] **Step 6: Visual verification**

Run: `npm start`. Clear wave 1. Shop appears:
- 6 item cards in neon-glass style with rarity-colored borders.
- Reroll + skip buttons styled the same.
- Tap each → press scale; purchase / reroll / skip works.

- [ ] **Step 7: Commit**

```bash
git add src/game/ui/BetweenWaveShopOverlay.ts
git commit -m "feat(ui): re-skin between-wave shop — neon-glass cards + press feedback"
```

---

## Task 11: Re-skin `PauseScreen`

**Files:**
- Modify: `src/game/ui/PauseScreen.ts`

- [ ] **Step 1: Add imports**

```typescript
import { makeFrame, addPressFeedback, STYLE } from './HudStyle';
```

- [ ] **Step 2: Restyle backdrop + buttons**

Find the backdrop Rectangle and set its `background` to `STYLE.backdropDim`.

Find the Resume / Restart / Main Menu buttons. For each:

- Replace the manual Rectangle config with `makeFrame({ name, sizePx: <width>, color: <existing border color>, cornerRadius: 10 })`, set `height` after the call to match existing height.
- Wrap each button's click callback with `addPressFeedback(btn, () => { <existing callback> })`.

- [ ] **Step 3: Type-check + build**

Run: `npx tsc --noEmit`
Run: `npm run build`

- [ ] **Step 4: Visual verification**

Run: `npm start`. Start a run, hit pause (Esc or pause button).
- Backdrop dims the screen with `rgba(0,0,0,0.65)`.
- Three buttons in neon glass.
- Tap each → press scale; correct action triggers.

- [ ] **Step 5: Commit**

```bash
git add src/game/ui/PauseScreen.ts
git commit -m "feat(ui): re-skin pause screen — neon-glass buttons + press feedback"
```

---

## Task 12: Re-skin `GameOverState` summary + add haptic

**Files:**
- Modify: `src/game/states/GameOverState.ts`

- [ ] **Step 1: Locate the survivors-summary build path**

Run: `grep -nE "(setSurvivorsSummary|new Rectangle|onPointerClickObservable)" src/game/states/GameOverState.ts`

Find where the summary screen is built (likely in `enter()` or a build helper).

- [ ] **Step 2: Add imports**

```typescript
import { makeFrame, addPressFeedback, tryHaptic, STYLE } from '../ui/HudStyle';
```

- [ ] **Step 3: Re-skin the summary panels**

For the main summary panel (stats card with wave reached, kills, gold, time):

- Replace its Rectangle config with `makeFrame({ name: 'summaryPanel', sizePx: <width>, color: '#c33', cornerRadius: 14 })`. Override `height` to match existing.

For each action button (Restart / Main Menu):

- Replace with `makeFrame({ name, sizePx: <width>, color: <existing border>, cornerRadius: 10 })`. Override `height`.
- Wrap callback with `addPressFeedback`.

For the backdrop, set `background` to `STYLE.backdropDim`.

- [ ] **Step 4: Add game-over haptic**

In `enter()`, near the top (after `setSurvivorsSummary` or wherever the death state is finalized), add:

```typescript
        tryHaptic(20);
```

- [ ] **Step 5: Type-check + build**

Run: `npx tsc --noEmit`
Run: `npm run build`

- [ ] **Step 6: Visual verification**

Run: `npm start`. Let the hero die.
- Game over screen shows neon-glass summary panel + restart/menu buttons.
- On mobile, vibration fires (single 20ms pulse, may not be perceptible on emulator — verify on a real device or check DevTools).
- Tap restart → press scale; restarts run.

- [ ] **Step 7: Commit**

```bash
git add src/game/states/GameOverState.ts
git commit -m "feat(ui): re-skin game-over summary + add death haptic"
```

---

## Task 13: Final verification + cleanup pass

**Files:** none (verification only)

- [ ] **Step 1: Full type-check + build**

Run: `npx tsc --noEmit`
Expected: no errors anywhere in the project.

Run: `npm run build`
Expected: webpack production build succeeds, dist/ updated.

- [ ] **Step 2: End-to-end manual verification**

Run: `npm start`. Walk through the full mobile flow (DevTools iPhone 12 emulation):

1. Main menu loads.
2. Click Play → champion select appears in neon glass; tap a champion → press scale, run starts.
3. In gameplay: HP/Wave/Gold pills along top; slots centered bottom; ults bottom-right side-by-side.
4. Touch anywhere on the canvas → joystick ring appears at touch, hero moves.
5. Tap an ultimate while ready → press scale + flash + (mobile) vibrate + ability fires.
6. Take damage → HP bar white-flashes + HP fill shrinks.
7. Pick up gold → gold pill pulses.
8. Clear a wave → wave pill green-flashes.
9. Pick up a power orb → power-choice cards (neon glass), tap one → press scale, choice applies.
10. Fill all 4 slots, pick up a 5th → replace-slot overlay (neon glass).
11. Clear a wave → shop appears (neon glass), buy / reroll / skip work.
12. Pause (button or Esc) → pause screen (neon glass), tap Resume → resumes.
13. Die → game over (neon glass), tap Restart → restarts.

Repeat steps 3–13 in a desktop viewport (1280×800): same layout (larger), mouse drives the floating joystick.

- [ ] **Step 3: Cleanup — search for dead code**

Run: `grep -nE "_buildMobileUltimateButtons|MOBILE_BREAKPOINT" src/game/ui/SurvivorsJoystick.ts`
Expected: no matches (the file no longer needs MOBILE_BREAKPOINT since both layouts use the same floating joystick).

If the `MOBILE_BREAKPOINT` import in `SurvivorsJoystick.ts` is unused (it will be after Task 2), confirm it was removed. If not, remove it now in a final commit.

- [ ] **Step 4: Final commit (if cleanup needed)**

```bash
git add -A
git commit -m "chore(ui): remove unused MOBILE_BREAKPOINT import from joystick"
```

If nothing to clean up, skip this commit.

---

## Self-review checklist (for the implementing engineer)

Before opening a PR, scan the spec (`docs/superpowers/specs/2026-05-25-ui-polish-mobile-design.md`) against your implementation:

- [ ] Floating-anywhere joystick — touch anywhere summons the ring; UI buttons take precedence.
- [ ] All 5 top-bar/bottom-bar elements (HP/Wave/Gold/Slots/Ults) match the L1 layout table.
- [ ] All 8 feedback moments from the spec's Tactile feedback inventory work.
- [ ] All 6 overlay files in the spec's "affected overlays" list have been re-skinned with `HudStyle`.
- [ ] No unit tests added (per CLAUDE.md — no test suite in this project).
- [ ] Type-check and build both pass.
