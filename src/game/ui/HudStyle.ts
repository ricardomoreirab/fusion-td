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
