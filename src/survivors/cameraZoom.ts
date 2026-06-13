// Pure mouse-wheel zoom math for the isometric follow camera — no Babylon, no DOM,
// safe for Vitest. HeroController wires DOM wheel events + a per-frame ease onto these
// helpers. "Zoom" is a multiplier on the camera's BASE slant distance: scaling camera
// height AND z-offset by the same factor keeps the look-down angle (the perspective)
// exactly constant, because the camera's locked rotation never changes.

/** Closest the camera may zoom in (0.6x the base slant distance). */
export const CAMERA_ZOOM_MIN = 0.6;
/** Farthest the camera may zoom out (1.6x the base slant distance). */
export const CAMERA_ZOOM_MAX = 1.6;
/** Zoom multiplier when nothing is persisted. */
export const CAMERA_ZOOM_DEFAULT = 1.0;
/** Multiplicative change per wheel notch (~5 notches across the full range). */
export const CAMERA_ZOOM_STEP = 1.1;
/** Frame-rate-independent ease factor for gliding the live zoom toward its target. */
export const CAMERA_ZOOM_LERP = 8;

/** Clamp a zoom multiplier into [MIN, MAX]; non-finite input falls back to DEFAULT
 *  so a bad value can never poison the camera transform. */
export function clampZoom(z: number): number {
    if (!Number.isFinite(z)) return CAMERA_ZOOM_DEFAULT;
    return Math.min(CAMERA_ZOOM_MAX, Math.max(CAMERA_ZOOM_MIN, z));
}

/** Apply one wheel notch to the current zoom target. Wheel deltaY < 0 (scroll up)
 *  zooms IN (smaller multiplier = closer); deltaY > 0 zooms OUT; deltaY === 0 is a
 *  no-op. Result is clamped to the range. */
export function stepZoom(current: number, deltaY: number): number {
    if (deltaY === 0) return clampZoom(current);
    const next = deltaY < 0 ? current / CAMERA_ZOOM_STEP : current * CAMERA_ZOOM_STEP;
    return clampZoom(next);
}

/** Frame-rate-independent ease of the live zoom toward its target, matching the
 *  camera-position lerp pattern (factor = min(1, dt*LERP)). dt <= 0 -> no move. */
export function lerpZoom(current: number, target: number, dt: number): number {
    const t = Math.min(1, Math.max(0, dt * CAMERA_ZOOM_LERP));
    return current + (target - current) * t;
}

/** Parse a persisted localStorage value into a clamped zoom; null/garbage/NaN -> DEFAULT. */
export function parsePersistedZoom(raw: string | null): number {
    if (raw === null) return CAMERA_ZOOM_DEFAULT;
    return clampZoom(parseFloat(raw));
}
