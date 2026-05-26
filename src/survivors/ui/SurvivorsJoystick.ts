import { AdvancedDynamicTexture, Ellipse, Control } from '@babylonjs/gui';

/**
 * Floating-anywhere virtual joystick.
 *
 * Listens to canvas DOM pointer events (reliable on touch, multi-touch
 * via real pointerId). First touch anywhere on the canvas becomes the
 * ring origin, except inside the bottom-right "reserved" corner where
 * the ultimate buttons live — touches there pass through to the GUI.
 */
export class SurvivorsJoystick {
    private ui: AdvancedDynamicTexture;
    private ring: Ellipse;
    private thumb: Ellipse;

    private readonly baseRadius: number = 52;   // ring radius in GUI px
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

    constructor(ui: AdvancedDynamicTexture) {
        this.ui = ui;

        // ── Ring (visual) ─────────────────────────────────────────────────
        this.ring = new Ellipse('joystickRing');
        this.ring.width = `${this.baseRadius * 2}px`;
        this.ring.height = `${this.baseRadius * 2}px`;
        this.ring.thickness = 1.5;
        this.ring.color = 'rgba(255, 255, 255, 0.40)';
        this.ring.background = 'rgba(255, 255, 255, 0.06)';
        this.ring.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        this.ring.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        this.ring.isVisible = false;
        this.ring.isPointerBlocker = false;
        this.ring.zIndex = -5;
        this.ui.addControl(this.ring);

        // ── Thumb (child of ring) ─────────────────────────────────────────
        this.thumb = new Ellipse('joystickThumb');
        this.thumb.width = `${this.thumbRadius * 2}px`;
        this.thumb.height = `${this.thumbRadius * 2}px`;
        this.thumb.thickness = 0;
        this.thumb.background = 'rgba(255, 255, 255, 0.70)';
        this.thumb.isPointerBlocker = false;
        this.ring.addControl(this.thumb);

        this.wireEvents();
    }

    private wireEvents(): void {
        const canvas = this.ui.getScene()?.getEngine().getRenderingCanvas();
        if (!canvas) return;
        this.canvas = canvas;

        // GUI scale: idealWidth is set on the AdvancedDynamicTexture (800),
        // so a canvas-pixel value maps to GUI by dividing by this scale.
        const guiScale = (): number => {
            const rect = canvas.getBoundingClientRect();
            const idealW = (this.ui as { idealWidth?: number }).idealWidth || rect.width;
            return rect.width / idealW;
        };

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

            const s = guiScale();
            this.ring.left = `${cx / s - this.baseRadius}px`;
            this.ring.top  = `${cy / s - this.baseRadius}px`;
            this.ring.isVisible = true;
            this.thumb.left = '0px';
            this.thumb.top  = '0px';
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

            // Convert ring's visual radius (GUI px) into canvas px for clamping
            const s = guiScale();
            const radiusCanvas = this.baseRadius * s;
            const clampedCanvas = Math.min(dist, radiusCanvas);

            this.dx = normX * (clampedCanvas / radiusCanvas);
            this.dz = -normY * (clampedCanvas / radiusCanvas);

            const thumbMaxGui = this.baseRadius - this.thumbRadius;
            this.thumb.left = `${normX * thumbMaxGui}px`;
            this.thumb.top  = `${normY * thumbMaxGui}px`;

            if (this.onDirectionCallback) this.onDirectionCallback(this.dx, this.dz);
        };

        const endSession = (e: PointerEvent) => {
            if (this.activePointerId !== e.pointerId) return;
            this.activePointerId = null;
            this.dx = 0;
            this.dz = 0;
            this.ring.isVisible = false;
            this.thumb.left = '0px';
            this.thumb.top  = '0px';
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
        this.ring.dispose();
    }
}
