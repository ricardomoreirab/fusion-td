/**
 * Pure math for the true-orthographic isometric camera. No Three, no DOM —
 * safe for Vitest, and safe to import from the co-op replay path.
 *
 * "True isometric" here means the real thing, not the loose game-industry sense:
 * the view direction is the (1,1,1) body diagonal, so the three world axes
 * project to screen at exactly 120° apart and a unit step along X, Y or Z all
 * cover the same screen distance. That fixes pitch at atan(1/√2) ≈ 35.264° and
 * yaw at 45°; neither is a tuning knob. Everything that IS tunable (view height,
 * zoom range, clip distance) lives below them.
 *
 * Note that zoom scales the FRUSTUM, not camera distance: under parallel
 * projection, moving the camera along its view axis changes nothing on screen.
 */

/** Camera pitch: atan(1/√2). Fixed by the isometric definition. */
export const ISO_PITCH_RAD = Math.atan(1 / Math.SQRT2);
/** Camera yaw: 45°. Fixed by the isometric definition. */
export const ISO_YAW_RAD = Math.PI / 4;

/**
 * Unit view direction from the focus point toward the camera — the normalized
 * (1,1,1) diagonal. Under orthographic projection this only positions the
 * camera for clipping; it has no effect on framing or scale.
 */
export const ISO_DIR_X = 1 / Math.sqrt(3);
export const ISO_DIR_Y = 1 / Math.sqrt(3);
export const ISO_DIR_Z = 1 / Math.sqrt(3);

/**
 * How far back the camera sits along that diagonal. Orthographic, so this is
 * purely a clipping concern: it must clear the tallest prop plus the sky vault's
 * near face. Not a framing knob — changing it does nothing visible.
 */
export const ISO_CLIP_DISTANCE = 220;
export const ISO_NEAR = 0.1;
export const ISO_FAR = 620;

/**
 * Vertical extent of the visible ground, in world units, at zoom 1.
 * This IS the framing knob. 28 on 16:9 shows ~50 x 28 world units.
 */
export const ISO_VIEW_HEIGHT = 28;
/** Narrow screens (< 700px) pull in so the hero keeps a usable share of frame. */
export const ISO_VIEW_HEIGHT_MOBILE = 24;

/**
 * Zoom range. Deliberately tighter than the old perspective rig's [0.6, 1.6].
 *
 * The upper bound is load-bearing: enemies spawn on a ring at radius
 * SPAWN_RING_RADIUS and the Vampire Survivors contract is that they always
 * enter from off-screen. At zoom Z on aspect A the frame's half-diagonal is
 * (ISO_VIEW_HEIGHT * Z / 2) * hypot(A, 1). At 1.35 on 16:9 that is ~38.5,
 * which stays inside the ring; the old 1.6 would have shown enemies popping
 * into existence. See assertSpawnRingOffscreen below.
 */
export const ISO_ZOOM_MIN = 0.65;
export const ISO_ZOOM_MAX = 1.35;
export const ISO_ZOOM_DEFAULT = 1.0;
/** Multiplicative change per wheel notch. */
export const ISO_ZOOM_STEP = 1.08;
/** Frame-rate-independent ease factor toward the zoom target. */
export const ISO_ZOOM_LERP = 8;

/** Clamp a zoom multiplier; non-finite input falls back to the default so a bad
 *  value can never poison the projection matrix. */
export function clampIsoZoom(z: number): number {
    if (!Number.isFinite(z)) return ISO_ZOOM_DEFAULT;
    return Math.min(ISO_ZOOM_MAX, Math.max(ISO_ZOOM_MIN, z));
}

/** Apply one wheel notch. deltaY < 0 (scroll up) zooms IN. */
export function stepIsoZoom(current: number, deltaY: number): number {
    if (deltaY === 0) return clampIsoZoom(current);
    return clampIsoZoom(deltaY < 0 ? current / ISO_ZOOM_STEP : current * ISO_ZOOM_STEP);
}

/** Frame-rate-independent ease toward the target. dt <= 0 is a no-op. */
export function lerpIsoZoom(current: number, target: number, dt: number): number {
    const t = Math.min(1, Math.max(0, dt * ISO_ZOOM_LERP));
    return current + (target - current) * t;
}

/** Parse a persisted localStorage value; null/garbage/NaN falls back to default. */
export function parsePersistedIsoZoom(raw: string | null): number {
    if (raw === null) return ISO_ZOOM_DEFAULT;
    return clampIsoZoom(parseFloat(raw));
}

export interface OrthoFrustum { left: number; right: number; top: number; bottom: number }

/**
 * Orthographic frustum half-extents for a view height, aspect, and zoom.
 * Writes into `out` so the per-frame path allocates nothing.
 */
export function isoFrustum(
    viewHeight: number,
    aspect: number,
    zoom: number,
    out: OrthoFrustum,
): void {
    const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
    const halfH = (viewHeight * clampIsoZoom(zoom)) / 2;
    const halfW = halfH * safeAspect;
    out.left = -halfW;
    out.right = halfW;
    out.top = halfH;
    out.bottom = -halfH;
}

/** Half-diagonal of the visible ground rectangle — the distance from the hero to
 *  the frame corner, which is what the spawn ring must clear. */
export function isoViewHalfDiagonal(viewHeight: number, aspect: number, zoom: number): number {
    const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
    const halfH = (viewHeight * clampIsoZoom(zoom)) / 2;
    return Math.hypot(halfH * safeAspect, halfH);
}

/**
 * True when enemies spawning on `spawnRingRadius` are still off-screen at the
 * given framing. The world system asserts this at construction; if a future
 * aspect ratio or zoom change breaks it, that is a design regression, not a
 * cosmetic one — enemies would visibly pop in.
 */
export function isSpawnRingOffscreen(
    spawnRingRadius: number,
    viewHeight: number,
    aspect: number,
    zoom: number,
): boolean {
    return isoViewHalfDiagonal(viewHeight, aspect, zoom) < spawnRingRadius;
}

/**
 * Screen-space input intent → world-space direction.
 *
 * Under 45° yaw the ground axes run diagonally across the screen, so raw WASD
 * has to be rotated or "up" walks the hero diagonally.
 *
 * The basis comes from the camera's own axes. THREE's lookAt builds them as
 * z = normalize(eye - target)  (pointing BACKWARD, toward the camera),
 * x = normalize(worldUp × z), y = z × x. With eye - target = (1,1,1)/√3:
 *
 *   camera right = (+1, 0, -1)/√2
 *   camera up    = (-1, 2, -1)/√6  →  ground projection (-1, 0, -1)/√2
 *
 * So D (inputX = +1) walks toward (+X, -Z), and W (inputY = +1) walks toward
 * (-X, -Z).
 *
 * The up axis is the easy one to get backwards: the intuitive "project the
 * camera's view direction onto the ground" gives (-1,0,-1) only if you use
 * FORWARD. Using -forward instead yields (+1,0,+1), which points toward the
 * camera — i.e. DOWN the screen — and inverts W/S while leaving A/D correct,
 * because the right vector is unaffected. That was the original bug.
 *
 * This is the single conversion point between screen intent and world motion —
 * HeroController's live movement AND its co-op wire payload both go through it,
 * so host and guest cannot disagree about what "up" meant.
 *
 * Input is NOT normalized here (analog joystick magnitude below 1 must survive);
 * callers still run capInputLen afterwards exactly as before.
 */
export const ISO_BASIS = Math.SQRT1_2; // 1/√2, the shared basis component

export function screenToWorldDir(
    inputX: number,
    inputY: number,
    out: { dx: number; dz: number },
): void {
    out.dx = ISO_BASIS * (inputX - inputY);
    out.dz = -ISO_BASIS * (inputX + inputY);
}

/**
 * Inverse of screenToWorldDir: world-space ground direction → screen intent.
 * Used by UI that has to draw a world direction in screen terms (off-screen
 * indicators keep using camera projection, but aim cones and the joystick
 * echo need this).
 */
export function worldToScreenDir(
    worldDx: number,
    worldDz: number,
    out: { x: number; y: number },
): void {
    out.x = ISO_BASIS * (worldDx - worldDz);
    out.y = -ISO_BASIS * (worldDx + worldDz);
}
