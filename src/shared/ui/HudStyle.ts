/**
 * HudStyle - shared style constants + small helpers for cross-state UI.
 *
 * The Babylon-GUI pill/frame factories that used to live here are gone:
 * every surviving UI surface is DOM (src/ui/primitives has the DOM
 * makeFrame/makePill equivalents).
 */

// Neon-glass style constants
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

// Element colors used by HUD + overlays.
export const ELEMENT_COLOR_HEX: Record<string, string> = {
    fire:     '#ff6030',
    ice:      '#30cfff',
    arcane:   '#b050ff',
    physical: '#e0e0e0',
    storm:    '#ffe040',
};

/** Trigger a single short vibration where supported (mobile Chrome / Android). */
export function tryHaptic(ms: number = 15): void {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        try { navigator.vibrate(ms); } catch { /* ignore */ }
    }
}
