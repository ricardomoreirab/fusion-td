/**
 * The two things a mobile browser does that a mobile GAME cannot live with:
 * it keeps ~15% of the screen for its own chrome, and it turns the display off
 * mid-run.
 *
 * Both fixes require a user gesture and both are best-effort — every call here
 * is allowed to fail silently, because a browser that refuses (desktop Safari,
 * an iOS home-screen app that is already fullscreen, a locked-down webview) must
 * not take the game down with it. Nothing in this module is load-bearing for
 * gameplay.
 *
 * ── Why it hangs off the first gesture rather than boot ────────────────────
 * `requestFullscreen` and `screen.orientation.lock` are gated on transient user
 * activation: calling them at boot throws, and calling them from a `pointerdown`
 * that the player did not intend as "go fullscreen" is the reason so many web
 * games feel like they hijack the phone. The listener is installed once, fires on
 * the first real tap, and removes itself.
 *
 * Desktop is untouched: the whole module no-ops unless the device actually has a
 * coarse pointer, so a mouse user never gets yanked into fullscreen.
 */

/** True for a touch-first device. Coarse pointer AND no hover — a Surface with a
 *  mouse attached reports coarse for the touchscreen but still hovers. */
export function isTouchDevice(): boolean {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia('(pointer: coarse)').matches
        && !window.matchMedia('(any-hover: hover)').matches;
}

type WakeLockSentinelLike = { released: boolean; release(): Promise<void> };
type WakeLockLike = { request(type: 'screen'): Promise<WakeLockSentinelLike> };

let sentinel: WakeLockSentinelLike | null = null;
let visibilityHandler: (() => void) | null = null;
let gestureHandler: ((e: Event) => void) | null = null;

function wakeLockApi(): WakeLockLike | null {
    const nav = navigator as unknown as { wakeLock?: WakeLockLike };
    return nav.wakeLock ?? null;
}

/**
 * Hold the screen awake. Idempotent.
 *
 * The lock is dropped by the browser whenever the page is hidden and is NOT
 * restored automatically, so re-acquiring on `visibilitychange` is not optional —
 * without it the screen sleeps on the first notification the player swipes away.
 */
async function acquireWakeLock(): Promise<void> {
    const api = wakeLockApi();
    if (!api) return;
    try {
        if (sentinel && !sentinel.released) return;
        sentinel = await api.request('screen');
    } catch {
        // Denied (battery saver, unsupported) — the screen will dim, which is
        // an annoyance rather than a fault.
    }
}

async function requestFullscreen(): Promise<void> {
    const el = document.documentElement as HTMLElement & {
        webkitRequestFullscreen?: () => Promise<void>;
    };
    if (document.fullscreenElement) return;
    try {
        if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
        else if (el.webkitRequestFullscreen) await el.webkitRequestFullscreen();
    } catch {
        // iOS Safari has no element fullscreen for non-video; the game just runs
        // with the browser chrome visible.
    }
}

/**
 * Ask to stay in landscape. Only meaningful once fullscreen succeeded (the spec
 * requires it), which is why this runs after and not in parallel.
 *
 * The game already gates portrait behind a rotate prompt, so this does not
 * change what is playable — it stops the layout thrashing when a player's phone
 * rotates mid-run.
 */
async function lockLandscape(): Promise<void> {
    const orientation = screen.orientation as ScreenOrientation & {
        lock?: (o: string) => Promise<void>;
    };
    if (!orientation?.lock) return;
    try {
        await orientation.lock('landscape');
    } catch {
        // Not permitted outside fullscreen, or unsupported (all of iOS).
    }
}

/**
 * Install the one-shot first-gesture handler and the wake-lock keep-alive.
 *
 * Safe to call more than once; safe to call on desktop (no-ops). Returns a
 * teardown for symmetry with the rest of the codebase, though in practice this
 * lives for the life of the page.
 */
export function installMobileSession(): () => void {
    if (!isTouchDevice()) return () => {};

    gestureHandler = () => {
        removeGesture();
        void (async () => {
            await requestFullscreen();
            await lockLandscape();
            await acquireWakeLock();
        })();
    };
    // `pointerup`, not `pointerdown`: a tap that turns out to be the start of a
    // joystick drag should not also be the tap that changes the display mode.
    window.addEventListener('pointerup', gestureHandler, { once: true, passive: true });

    visibilityHandler = () => {
        if (document.visibilityState === 'visible') void acquireWakeLock();
    };
    document.addEventListener('visibilitychange', visibilityHandler);

    return teardownMobileSession;
}

function removeGesture(): void {
    if (!gestureHandler) return;
    window.removeEventListener('pointerup', gestureHandler);
    gestureHandler = null;
}

export function teardownMobileSession(): void {
    removeGesture();
    if (visibilityHandler) {
        document.removeEventListener('visibilitychange', visibilityHandler);
        visibilityHandler = null;
    }
    if (sentinel && !sentinel.released) void sentinel.release().catch(() => {});
    sentinel = null;
}

// ── Haptics ─────────────────────────────────────────────────────────────────
/**
 * Short vibrations for the events a player feels rather than reads.
 *
 * Deliberately a CLOSED set of named patterns rather than a duration parameter:
 * haptics stop being feedback and become noise the moment every event buzzes, so
 * the vocabulary is the design. Three patterns, each earning its place —
 * `hurt` (you are losing the run), `levelUp` (choose something), `death` (it is
 * over). Notably NOT on hits landed: at survivors-mode kill rates that is a
 * continuous buzz.
 *
 * `navigator.vibrate` is Android-only (iOS Safari has never shipped it) and is
 * silently ignored where the user has disabled it, so this is decoration by
 * construction.
 */
export type HapticPattern = 'hurt' | 'levelUp' | 'death';

const PATTERNS: Record<HapticPattern, number | number[]> = {
    hurt: 18,
    levelUp: [0, 22, 60, 22],
    death: [0, 60, 80, 140],
};

export function haptic(pattern: HapticPattern): void {
    const nav = navigator as unknown as { vibrate?: (p: number | number[]) => boolean };
    if (!nav.vibrate || !isTouchDevice()) return;
    try {
        nav.vibrate(PATTERNS[pattern]);
    } catch {
        // Never a reason to interrupt a frame.
    }
}
