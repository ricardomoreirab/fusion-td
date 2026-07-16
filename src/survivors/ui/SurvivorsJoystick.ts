/**
 * Floating-anywhere virtual joystick (DOM).
 *
 * Listens to canvas DOM pointer events (reliable on touch, multi-touch
 * via real pointerId). First touch anywhere on the canvas becomes the
 * ring origin, except inside the bottom-right "reserved" corner where
 * the ultimate buttons live — touches there pass through to the HUD.
 *
 * Visuals are two absolutely-positioned divs (ring + thumb) mounted into
 * #ui-root (the DOM HUD root; falls back to document.body). They are
 * pointer-events: none — all input capture happens on the canvas itself.
 */
export class SurvivorsJoystick {
    private ring: HTMLDivElement;
    private thumb: HTMLDivElement;

    private readonly baseRadius: number = 52;   // ring radius in CSS px
    private readonly thumbRadius: number = 12;

    // Bottom-right reserved zone (canvas pixels). Ult row is ~130×70 css px
    // on a wide-aspect viewport with the current sizes. Generous padding.
    private readonly reservedBR_W: number = 150;
    private readonly reservedBR_H: number = 80;

    private dx: number = 0;
    private dz: number = 0;
    private activePointerId: number | null = null;
    private originCanvasX: number = 0;
    private originCanvasY: number = 0;

    private onDirectionCallback: ((dx: number, dz: number) => void) | null = null;

    // Saved event listeners + canvas ref for dispose
    private canvas: HTMLCanvasElement | null = null;
    private onPointerDown!: (e: PointerEvent) => void;
    private onPointerMove!: (e: PointerEvent) => void;
    private onPointerUp!:   (e: PointerEvent) => void;

    constructor(canvas: HTMLCanvasElement) {
        const mountParent = document.getElementById('ui-root') ?? document.body;

        // ── Ring (visual) ─────────────────────────────────────────────────
        this.ring = document.createElement('div');
        const rs = this.ring.style;
        rs.position = 'absolute';
        rs.width = `${this.baseRadius * 2}px`;
        rs.height = `${this.baseRadius * 2}px`;
        rs.border = '1.5px solid rgba(255, 255, 255, 0.40)';
        rs.background = 'rgba(255, 255, 255, 0.06)';
        rs.borderRadius = '50%';
        rs.boxSizing = 'border-box';
        rs.pointerEvents = 'none';
        rs.zIndex = '0'; // under the HUD layers (old GUI zIndex -5)
        rs.display = 'none';
        mountParent.appendChild(this.ring);

        // ── Thumb (child of ring) ─────────────────────────────────────────
        this.thumb = document.createElement('div');
        const ts = this.thumb.style;
        ts.position = 'absolute';
        ts.width = `${this.thumbRadius * 2}px`;
        ts.height = `${this.thumbRadius * 2}px`;
        ts.background = 'rgba(255, 255, 255, 0.70)';
        ts.borderRadius = '50%';
        ts.pointerEvents = 'none';
        this.setThumb(0, 0);
        this.ring.appendChild(this.thumb);

        this.wireEvents(canvas);
    }

    /** Position the thumb by its offset from the ring centre (CSS px). */
    private setThumb(offsetX: number, offsetY: number): void {
        // -1.5 compensates for the ring's border (box-sizing: border-box shrinks
        // the content box the thumb is positioned in).
        this.thumb.style.left = `${this.baseRadius - this.thumbRadius + offsetX - 1.5}px`;
        this.thumb.style.top  = `${this.baseRadius - this.thumbRadius + offsetY - 1.5}px`;
    }

    private wireEvents(canvas: HTMLCanvasElement): void {
        this.canvas = canvas;
        // Babylon set touch-action: none on its rendering canvas; the Three
        // renderer does not — without it, touch drags scroll/zoom the page.
        canvas.style.touchAction = 'none';

        this.onPointerDown = (e: PointerEvent) => {
            if (this.activePointerId !== null) return;
            const rect = canvas.getBoundingClientRect();
            const cx = e.clientX - rect.left;
            const cy = e.clientY - rect.top;

            // Skip if inside the bottom-right reserved (ult-button) corner.
            if (rect.width - cx < this.reservedBR_W && rect.height - cy < this.reservedBR_H) {
                return;
            }

            this.activePointerId = e.pointerId;
            this.originCanvasX = cx;
            this.originCanvasY = cy;

            // #ui-root is position: fixed, inset 0 — viewport coords ARE its coords.
            this.ring.style.left = `${e.clientX - this.baseRadius}px`;
            this.ring.style.top  = `${e.clientY - this.baseRadius}px`;
            this.ring.style.display = 'block';
            this.setThumb(0, 0);
        };

        this.onPointerMove = (e: PointerEvent) => {
            if (this.activePointerId !== e.pointerId) return;
            const rect = canvas.getBoundingClientRect();
            const cx = e.clientX - rect.left;
            const cy = e.clientY - rect.top;

            const rawDx = cx - this.originCanvasX;
            const rawDy = cy - this.originCanvasY;
            const dist = Math.hypot(rawDx, rawDy);
            const normX = dist > 0 ? rawDx / dist : 0;
            const normY = dist > 0 ? rawDy / dist : 0;

            // Ring radius is CSS px == canvas client px (no GUI ideal-width scale).
            const radius = this.baseRadius;
            const clamped = Math.min(dist, radius);

            this.dx = normX * (clamped / radius);
            this.dz = -normY * (clamped / radius);

            const thumbMax = this.baseRadius - this.thumbRadius;
            this.setThumb(normX * thumbMax, normY * thumbMax);

            if (this.onDirectionCallback) this.onDirectionCallback(this.dx, this.dz);
        };

        const endSession = (e: PointerEvent) => {
            if (this.activePointerId !== e.pointerId) return;
            this.activePointerId = null;
            this.dx = 0;
            this.dz = 0;
            this.ring.style.display = 'none';
            this.setThumb(0, 0);
            if (this.onDirectionCallback) this.onDirectionCallback(0, 0);
        };
        this.onPointerUp = endSession;

        canvas.addEventListener('pointerdown',   this.onPointerDown);
        canvas.addEventListener('pointermove',   this.onPointerMove);
        canvas.addEventListener('pointerup',     this.onPointerUp);
        canvas.addEventListener('pointercancel', this.onPointerUp);
    }

    public onDirection(fn: (dx: number, dz: number) => void): void {
        this.onDirectionCallback = fn;
    }

    public getDx(): number { return this.dx; }
    public getDz(): number { return this.dz; }

    public dispose(): void {
        if (this.canvas) {
            this.canvas.removeEventListener('pointerdown',   this.onPointerDown);
            this.canvas.removeEventListener('pointermove',   this.onPointerMove);
            this.canvas.removeEventListener('pointerup',     this.onPointerUp);
            this.canvas.removeEventListener('pointercancel', this.onPointerUp);
            this.canvas = null;
        }
        this.ring.remove();
    }
}
