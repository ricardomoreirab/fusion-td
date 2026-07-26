// tests/canvasSize.spec.ts
//
// The observed-canvas-size helper exists for one reason: `clientWidth` reads on
// a per-frame path force a synchronous document layout. What has to hold is that
// it reads the canvas EXACTLY once per real size change and never again, and
// that it hands back the same raw numbers a direct read would — the callers
// apply their own `|| window.innerWidth` fallbacks and a helpful fallback in
// here would silently change what they compute.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { observeCanvasSize } from '../src/engine/canvasSize';

type ROCallback = () => void;

/** Minimal ResizeObserver stand-in that records what it observed and lets the
 *  test fire the callback by hand. */
class FakeResizeObserver {
    public static live: FakeResizeObserver[] = [];
    public observed: unknown[] = [];
    public disconnected = false;
    constructor(private cb: ROCallback) { FakeResizeObserver.live.push(this); }
    observe(target: unknown): void { this.observed.push(target); }
    disconnect(): void { this.disconnected = true; }
    fire(): void { this.cb(); }
}

interface FakeCanvas { clientWidth: number; clientHeight: number; reads: number }

function fakeCanvas(width: number, height: number): FakeCanvas {
    const c = { _w: width, _h: height, reads: 0 } as unknown as FakeCanvas & { _w: number; _h: number };
    Object.defineProperty(c, 'clientWidth', {
        get() { c.reads++; return (c as unknown as { _w: number })._w; },
        set(v: number) { (c as unknown as { _w: number })._w = v; },
    });
    Object.defineProperty(c, 'clientHeight', {
        get() { return (c as unknown as { _h: number })._h; },
        set(v: number) { (c as unknown as { _h: number })._h = v; },
    });
    return c;
}

function installDom() {
    FakeResizeObserver.live = [];
    const listeners: Record<string, ROCallback[]> = {};
    const win = {
        addEventListener: (t: string, fn: ROCallback) => { (listeners[t] ??= []).push(fn); },
        removeEventListener: (t: string, fn: ROCallback) => {
            listeners[t] = (listeners[t] ?? []).filter(f => f !== fn);
        },
        listeners,
    };
    vi.stubGlobal('window', win);
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    return win;
}

afterEach(() => vi.unstubAllGlobals());

describe('observeCanvasSize', () => {
    it('reads the canvas eagerly so the first frame is never a zero size', () => {
        installDom();
        const canvas = fakeCanvas(1600, 900);
        const size = observeCanvasSize(canvas as unknown as HTMLCanvasElement);
        expect(size.width).toBe(1600);
        expect(size.height).toBe(900);
    });

    it('serves repeat reads from cache — the whole point of the module', () => {
        installDom();
        const canvas = fakeCanvas(1600, 900);
        const size = observeCanvasSize(canvas as unknown as HTMLCanvasElement);
        const after = canvas.reads;
        for (let i = 0; i < 100; i++) { void size.width; void size.height; }
        expect(canvas.reads).toBe(after);
    });

    it('re-reads when the observer reports a resize', () => {
        installDom();
        const canvas = fakeCanvas(1600, 900);
        const size = observeCanvasSize(canvas as unknown as HTMLCanvasElement);
        canvas.clientWidth = 800;
        canvas.clientHeight = 600;
        expect(size.width).toBe(1600); // still cached until the browser says so
        FakeResizeObserver.live[0].fire();
        expect(size.width).toBe(800);
        expect(size.height).toBe(600);
    });

    it('re-reads on a window resize too, for hosts without ResizeObserver', () => {
        const win = installDom();
        const canvas = fakeCanvas(1600, 900);
        const size = observeCanvasSize(canvas as unknown as HTMLCanvasElement);
        canvas.clientWidth = 1024;
        win.listeners['resize'].forEach(fn => fn());
        expect(size.width).toBe(1024);
    });

    it('refresh() re-reads immediately for a caller that resized the canvas itself', () => {
        installDom();
        const canvas = fakeCanvas(1600, 900);
        const size = observeCanvasSize(canvas as unknown as HTMLCanvasElement);
        canvas.clientWidth = 640;
        size.refresh();
        expect(size.width).toBe(640);
    });

    it('reports the RAW client size — callers own their fallbacks', () => {
        installDom();
        const canvas = fakeCanvas(0, 0);
        const size = observeCanvasSize(canvas as unknown as HTMLCanvasElement);
        expect(size.width).toBe(0);
        expect(size.height).toBe(0);
    });

    it('tolerates a null canvas (the iso rig allows one)', () => {
        installDom();
        const size = observeCanvasSize(null);
        expect(size.width).toBe(0);
        expect(FakeResizeObserver.live).toHaveLength(0);
        size.dispose();
    });

    it('dispose() unsubscribes both sources so a torn-down run stops observing', () => {
        const win = installDom();
        const canvas = fakeCanvas(1600, 900);
        const size = observeCanvasSize(canvas as unknown as HTMLCanvasElement);
        size.dispose();
        expect(FakeResizeObserver.live[0].disconnected).toBe(true);
        expect(win.listeners['resize']).toHaveLength(0);
    });

    it('works with no ResizeObserver in the host', () => {
        installDom();
        vi.stubGlobal('ResizeObserver', undefined);
        const canvas = fakeCanvas(1280, 720);
        const size = observeCanvasSize(canvas as unknown as HTMLCanvasElement);
        expect(size.width).toBe(1280);
        expect(() => size.dispose()).not.toThrow();
    });
});
