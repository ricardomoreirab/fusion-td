import { AdvancedDynamicTexture, Ellipse, Control } from '@babylonjs/gui';

/**
 * Minimal virtual joystick for mobile hero movement.
 * Renders in the bottom-left corner; dragging produces a [-1, 1] direction vector.
 */
export class SurvivorsJoystick {
    private container: Ellipse;
    private thumb: Ellipse;
    private ui: AdvancedDynamicTexture;

    private dx: number = 0;
    private dz: number = 0;
    private active: boolean = false;
    private baseRadius: number = 55; // px

    private onDirectionCallback: ((dx: number, dz: number) => void) | null = null;

    constructor(ui: AdvancedDynamicTexture) {
        this.ui = ui;

        // Outer ring
        this.container = new Ellipse('joystickBase');
        this.container.width = `${this.baseRadius * 2}px`;
        this.container.height = `${this.baseRadius * 2}px`;
        this.container.thickness = 3;
        this.container.color = 'rgba(255,255,255,0.4)';
        this.container.background = 'rgba(255,255,255,0.08)';
        this.container.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        this.container.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
        this.container.left = '30px';
        this.container.top = '-30px';
        this.ui.addControl(this.container);

        // Inner thumb
        this.thumb = new Ellipse('joystickThumb');
        this.thumb.width = '40px';
        this.thumb.height = '40px';
        this.thumb.thickness = 0;
        this.thumb.background = 'rgba(255,255,255,0.55)';
        this.container.addControl(this.thumb);

        this.wireEvents();
    }

    private wireEvents(): void {
        const canvas = this.ui.getScene()?.getEngine().getRenderingCanvas();
        if (!canvas) return;

        let pointerId: number | null = null;
        let baseX = 0;
        let baseY = 0;

        const onStart = (e: PointerEvent) => {
            if (pointerId !== null) return;
            // Only activate for touches in the bottom-left quadrant
            const rect = canvas.getBoundingClientRect();
            const cx = e.clientX - rect.left;
            const cy = e.clientY - rect.top;
            if (cx > rect.width / 2 || cy < rect.height / 2) return;

            pointerId = e.pointerId;
            baseX = cx;
            baseY = cy;
            this.active = true;
        };

        const onMove = (e: PointerEvent) => {
            if (e.pointerId !== pointerId || !this.active) return;
            const rect = canvas.getBoundingClientRect();
            const cx = e.clientX - rect.left;
            const cy = e.clientY - rect.top;

            const rawDx = cx - baseX;
            const rawDz = cy - baseY; // screen Y+ → world Z-

            const dist = Math.hypot(rawDx, rawDz);
            const clampedDist = Math.min(dist, this.baseRadius);
            const normX = clampedDist > 0 ? (rawDx / dist) : 0;
            const normY = clampedDist > 0 ? (rawDz / dist) : 0;

            this.dx = normX * (clampedDist / this.baseRadius);
            this.dz = -normY * (clampedDist / this.baseRadius); // invert Y for world Z

            // Move thumb visual
            const thumbMaxPx = this.baseRadius - 20;
            this.thumb.left = `${normX * thumbMaxPx}px`;
            this.thumb.top = `${normY * thumbMaxPx}px`;

            if (this.onDirectionCallback) {
                this.onDirectionCallback(this.dx, this.dz);
            }
        };

        const onEnd = (e: PointerEvent) => {
            if (e.pointerId !== pointerId) return;
            pointerId = null;
            this.active = false;
            this.dx = 0;
            this.dz = 0;
            this.thumb.left = '0px';
            this.thumb.top = '0px';
            if (this.onDirectionCallback) {
                this.onDirectionCallback(0, 0);
            }
        };

        canvas.addEventListener('pointerdown', onStart);
        canvas.addEventListener('pointermove', onMove);
        canvas.addEventListener('pointerup', onEnd);
        canvas.addEventListener('pointercancel', onEnd);
    }

    public onDirection(fn: (dx: number, dz: number) => void): void {
        this.onDirectionCallback = fn;
    }

    public getDx(): number { return this.dx; }
    public getDz(): number { return this.dz; }

    public dispose(): void {
        this.container.dispose();
    }
}
