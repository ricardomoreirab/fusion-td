import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * `mobileSession` is mostly browser API, and browser API is not what goes wrong
 * with it. What goes wrong is the GATE: a desktop player yanked into fullscreen,
 * or a phone buzzing on every hit. Both are decided by `isTouchDevice()` and by
 * the closed haptic vocabulary, and both are testable here.
 */

type MQ = { matches: boolean };
let media: Record<string, boolean> = {};
let vibrations: Array<number | number[]> = [];

function installEnv(opts: { vibrate?: boolean } = {}): void {
    const matchMedia = (q: string): MQ => ({ matches: media[q] ?? false });
    Object.defineProperty(globalThis, 'window', {
        value: { matchMedia, addEventListener: vi.fn(), removeEventListener: vi.fn() },
        configurable: true,
    });
    const nav: Record<string, unknown> = {};
    if (opts.vibrate !== false) {
        nav.vibrate = (p: number | number[]) => { vibrations.push(p); return true; };
    }
    Object.defineProperty(globalThis, 'navigator', { value: nav, configurable: true });
}

beforeEach(() => {
    media = {};
    vibrations = [];
    vi.resetModules();
});

/** Fresh import per test — the module reads the environment at call time, but
 *  resetting keeps any future module-level caching honest. */
async function load() {
    return import('../src/shared/mobileSession');
}

describe('isTouchDevice', () => {
    it('is true for a coarse pointer that cannot hover', async () => {
        media['(pointer: coarse)'] = true;
        media['(any-hover: hover)'] = false;
        installEnv();
        const { isTouchDevice } = await load();
        expect(isTouchDevice()).toBe(true);
    });

    it('is false for a mouse', async () => {
        media['(pointer: coarse)'] = false;
        media['(any-hover: hover)'] = true;
        installEnv();
        const { isTouchDevice } = await load();
        expect(isTouchDevice()).toBe(false);
    });

    it('is false for a touchscreen laptop, which CAN hover', async () => {
        // The case a single `pointer: coarse` check gets wrong: a Surface reports
        // coarse for its touchscreen while a mouse is attached. Treating it as a
        // phone would force fullscreen and lock orientation on a desktop.
        media['(pointer: coarse)'] = true;
        media['(any-hover: hover)'] = true;
        installEnv();
        const { isTouchDevice } = await load();
        expect(isTouchDevice()).toBe(false);
    });

    it('is false where matchMedia does not exist at all', async () => {
        Object.defineProperty(globalThis, 'window', { value: {}, configurable: true });
        Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true });
        const { isTouchDevice } = await load();
        expect(isTouchDevice()).toBe(false);
    });
});

describe('installMobileSession', () => {
    it('does nothing on a desktop', async () => {
        media['(pointer: coarse)'] = false;
        media['(any-hover: hover)'] = true;
        installEnv();
        const { installMobileSession } = await load();
        installMobileSession();
        // No gesture listener, so a mouse click can never trigger fullscreen.
        expect((globalThis.window.addEventListener as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
    });

    it('returns a teardown even when it no-ops', async () => {
        media['(pointer: coarse)'] = false;
        installEnv();
        const { installMobileSession } = await load();
        expect(() => installMobileSession()()).not.toThrow();
    });
});

describe('haptics', () => {
    it('fires only on touch devices', async () => {
        media['(pointer: coarse)'] = false;
        media['(any-hover: hover)'] = true;
        installEnv();
        const { haptic } = await load();
        haptic('hurt');
        expect(vibrations).toEqual([]);
    });

    it('fires the pattern for a touch device', async () => {
        media['(pointer: coarse)'] = true;
        installEnv();
        const { haptic } = await load();
        haptic('hurt');
        expect(vibrations).toHaveLength(1);
    });

    it('gives each event a DISTINCT pattern', async () => {
        // The vocabulary IS the design — three events that feel the same are
        // three events the player learns nothing from.
        media['(pointer: coarse)'] = true;
        installEnv();
        const { haptic } = await load();
        haptic('hurt');
        haptic('levelUp');
        haptic('death');
        expect(vibrations).toHaveLength(3);
        expect(new Set(vibrations.map(v => JSON.stringify(v))).size).toBe(3);
    });

    it('keeps every pattern short enough to read as feedback', async () => {
        // A long buzz stops being feedback and becomes an interruption. 400ms is
        // already generous for the death pattern, which is the longest.
        media['(pointer: coarse)'] = true;
        installEnv();
        const { haptic } = await load();
        for (const p of ['hurt', 'levelUp', 'death'] as const) haptic(p);
        for (const v of vibrations) {
            const total = Array.isArray(v) ? v.reduce((a, b) => a + b, 0) : v;
            expect(total, `${JSON.stringify(v)} is too long`).toBeLessThanOrEqual(400);
        }
    });

    it('survives a device with no vibration API', async () => {
        // iOS Safari has never shipped navigator.vibrate — this must be decoration
        // by construction, never a thrown error mid-frame.
        media['(pointer: coarse)'] = true;
        installEnv({ vibrate: false });
        const { haptic } = await load();
        expect(() => haptic('death')).not.toThrow();
    });

    it('survives a vibrate that throws', async () => {
        media['(pointer: coarse)'] = true;
        installEnv();
        Object.defineProperty(globalThis, 'navigator', {
            value: { vibrate: () => { throw new Error('denied'); } },
            configurable: true,
        });
        const { haptic } = await load();
        expect(() => haptic('hurt')).not.toThrow();
    });
});
