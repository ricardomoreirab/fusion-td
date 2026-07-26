/**
 * Cached CSS size of a canvas.
 *
 * `clientWidth` / `clientHeight` are layout-derived: reading either one after any
 * style write in the same frame forces a synchronous layout of the whole
 * document. Two per-frame paths read them — the iso camera's aspect check and
 * the off-screen enemy indicators — and the indicator pass runs immediately
 * after the HUD writes its per-frame styles, so every frame paid a full reflow
 * (over a DOM that carries one absolutely-positioned dot per off-screen enemy)
 * for a number that only changes when the viewport does.
 *
 * A ResizeObserver reports the same number out of the browser's own layout pass.
 * It also catches canvas resizes that fire no window `resize` event, which is
 * exactly the case the per-frame polling existed to cover — so this replaces the
 * polling rather than trading it away.
 *
 * `width`/`height` are the RAW client size (0 when there is no canvas or it has
 * not been laid out). Callers keep whatever fallback they had, so swapping a
 * direct read for this cannot change what they compute.
 */
export interface CanvasSize {
    readonly width: number;
    readonly height: number;
    /** Re-read now. For a caller that resized the canvas itself and needs the
     *  new size within the same frame, before the observer has fired. */
    refresh(): void;
    dispose(): void;
}

export function observeCanvasSize(canvas: HTMLCanvasElement | null): CanvasSize {
    let width = 0;
    let height = 0;

    // Reading layout inside the observer callback is free: it runs after the
    // browser has already laid out, and nothing here writes style back.
    const read = (): void => {
        width = canvas?.clientWidth ?? 0;
        height = canvas?.clientHeight ?? 0;
    };
    read();

    let observer: ResizeObserver | null = null;
    if (canvas && typeof ResizeObserver !== 'undefined') {
        observer = new ResizeObserver(read);
        observer.observe(canvas);
    }

    // Belt and braces for environments without ResizeObserver, and for the
    // window-relative fallbacks callers apply when the canvas measures 0.
    const onWindowResize = (): void => read();
    const hasWindow = typeof window !== 'undefined';
    if (hasWindow) window.addEventListener('resize', onWindowResize);

    return {
        get width() { return width; },
        get height() { return height; },
        refresh: read,
        dispose() {
            observer?.disconnect();
            observer = null;
            if (hasWindow) window.removeEventListener('resize', onWindowResize);
        },
    };
}
