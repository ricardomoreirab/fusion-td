/**
 * Pure decision logic for the render-health watchdog — the recovery "brain" that
 * guarantees a black canvas can never persist silently. NO Babylon, NO DOM imports,
 * so it is unit-testable under the pure-logic Vitest harness.
 *
 * Background — the "ranger black screen" investigation found two failure classes
 * that produce a permanent PURE-BLACK canvas while the JS game loop keeps running
 * (input + DOM HUD still respond). The gameplay clear color is near-black
 * (SurvivorsGameplayState sets Color4(0.04,0.03,0.05)), and #renderCanvas has no
 * CSS background, so an emptied or gone framebuffer reads as solid black:
 *
 *   (a) GPU context loss with no recovery handler. Babylon gates its whole frame
 *       on `!_contextWasLost`, so the render loop (Game.frameTick) itself stops and
 *       the canvas reveals the near-black page background. Nothing self-heals.
 *   (b) A NaN/Infinity poisoning the camera view matrix (e.g. the per-frame
 *       follow-lerp turning sticky-NaN). scene.render() keeps SUCCEEDING but every
 *       mesh clips out, leaving the near-black clear color.
 *
 * `evaluateRenderHealth` decides, from a snapshot of observable state, whether to
 * do nothing, surface a recovery banner ('warn'), or hard-reload as a last resort
 * ('reload'). It is deliberately conservative about the timing heuristic: a
 * backgrounded tab throttles BOTH requestAnimationFrame and setInterval, so a
 * "no frame in N seconds" reading is only trustworthy when the page is visible,
 * unpaused, and the watchdog's own clock is ticking on time.
 */

export type RenderHealthAction = 'none' | 'warn' | 'reload';

export interface RenderHealthSnapshot {
    /** The render loop has started (past asset-load/menu bootstrap). */
    running: boolean;
    /** Latched context-loss flag (true between onContextLost and onContextRestored). */
    contextLost: boolean;
    /** Wall-clock ms the context has been continuously lost (0 when not lost). */
    contextLostForMs: number;
    /** Wall-clock ms since the last SUCCESSFUL scene.render(). */
    msSinceLastRenderOk: number;
    /** document.visibilityState === 'visible'. */
    visible: boolean;
    /** Game is paused (render still runs, but we choose not to act on a stall). */
    paused: boolean;
    /**
     * The watchdog's own timer is firing at roughly its expected cadence. False when
     * the main thread or timer was throttled/blocked — in which case
     * `msSinceLastRenderOk` is inflated by the same block and must NOT be read as a
     * render stall.
     */
    jsClockHealthy: boolean;
}

export const RENDER_HEALTH = {
    /** Unrecovered context loss past this → reload (the GPU context is provably dead). */
    CONTEXT_LOST_RELOAD_MS: 8_000,
    /** No successful render this long (visible + unpaused + healthy clock) → warn banner. */
    STALL_WARN_MS: 6_000,
    /** No successful render this long → reload as a last resort. Set well above any
     *  legitimate multi-second hitch (GLB/shader compile, GC) so a hitch never reloads. */
    STALL_RELOAD_MS: 20_000,
} as const;

export function evaluateRenderHealth(s: RenderHealthSnapshot): RenderHealthAction {
    if (!s.running) return 'none';

    // Context loss is a DEFINITIVE signal (not a timing guess) → zero false positives.
    // Warn immediately; reload only after a grace window, in case Babylon auto-restores.
    if (s.contextLost) {
        return s.contextLostForMs >= RENDER_HEALTH.CONTEXT_LOST_RELOAD_MS ? 'reload' : 'warn';
    }

    // Timing heuristic for a silent black frame (NaN camera that renders "successfully"
    // into black, a per-frame render throw, or any unanticipated stall). Only trust it
    // when the page is visible, unpaused, and the JS clock is ticking normally.
    if (!s.visible || s.paused || !s.jsClockHealthy) return 'none';

    if (s.msSinceLastRenderOk >= RENDER_HEALTH.STALL_RELOAD_MS) return 'reload';
    if (s.msSinceLastRenderOk >= RENDER_HEALTH.STALL_WARN_MS) return 'warn';
    return 'none';
}

/** True iff all three components are finite numbers (rejects NaN and ±Infinity). */
export function isFiniteVec3(x: number, y: number, z: number): boolean {
    return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z);
}

/**
 * True iff EVERY element of a matrix's backing array is finite. The camera-position
 * finiteness check (isFiniteVec3) is not enough on its own: a camera whose `position`
 * is perfectly finite can still carry a NaN/Infinity VIEW or PROJECTION matrix — most
 * commonly a NaN aspect ratio when the render canvas is momentarily 0-height (a display
 * / resolution / monitor-wake event). That poisons the projection, clips every mesh, and
 * renders "successfully" into the near-black clear colour: a silent black screen no
 * position check catches. Validate the transforms themselves and recover.
 */
export function isFiniteMatrix(m: ArrayLike<number>): boolean {
    for (let i = 0; i < m.length; i++) {
        if (!Number.isFinite(m[i])) return false;
    }
    return true;
}
