import { AdvancedDynamicTexture } from '@babylonjs/gui';

/** Viewport widths below this are treated as mobile. */
export const MOBILE_BREAKPOINT = 700;

/** Viewport heights below this trigger tighter vertical layouts. */
export const NARROW_HEIGHT = 500;

export type LayoutMode = 'mobile' | 'desktop';

/**
 * Returns 'mobile' when the canvas render width is below MOBILE_BREAKPOINT.
 * Call at overlay show-time so the value is current.
 */
export function getLayoutMode(ui: AdvancedDynamicTexture): LayoutMode {
    const w = ui.getScene()?.getEngine().getRenderWidth() ?? 9999;
    return w < MOBILE_BREAKPOINT ? 'mobile' : 'desktop';
}

/**
 * Returns true when the canvas render height is below NARROW_HEIGHT.
 */
export function isNarrowHeight(ui: AdvancedDynamicTexture): boolean {
    const h = ui.getScene()?.getEngine().getRenderHeight() ?? 9999;
    return h < NARROW_HEIGHT;
}

/**
 * Returns the current canvas render width in pixels.
 */
export function getRenderWidth(ui: AdvancedDynamicTexture): number {
    return ui.getScene()?.getEngine().getRenderWidth() ?? 800;
}

/**
 * Returns the current canvas render height in pixels.
 */
export function getRenderHeight(ui: AdvancedDynamicTexture): number {
    return ui.getScene()?.getEngine().getRenderHeight() ?? 600;
}
