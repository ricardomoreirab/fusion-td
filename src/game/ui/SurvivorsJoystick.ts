import { AdvancedDynamicTexture, Ellipse, Rectangle, Control, Vector2WithInfo } from '@babylonjs/gui';
import { Vector2 } from '@babylonjs/core/Maths/math.vector';

/**
 * Floating-anywhere virtual joystick.
 *
 * The joystick has no static visual. The first pointer-down on the GUI's
 * transparent catcher (any area not consumed by another GUI button)
 * positions the ring at that touch point. Dragging produces a [-1, 1]
 * direction. Release hides the ring and emits (0, 0).
 *
 * UI button precedence comes for free: any control with isPointerBlocker
 * set on top of the catcher (slots, ults, overlays) consumes the touch
 * before it reaches the catcher.
 */
export class SurvivorsJoystick {
    private ui: AdvancedDynamicTexture;
    private catcher: Rectangle;
    private ring: Ellipse;
    private thumb: Ellipse;

    private readonly baseRadius: number = 52; // visual radius (matches ring half-size)
    private readonly thumbRadius: number = 12;

    private dx: number = 0;
    private dz: number = 0;
    private activePointerId: number | null = null;
    private phantomDownCount: number = 0;
    private originX: number = 0;
    private originY: number = 0;

    private onDirectionCallback: ((dx: number, dz: number) => void) | null = null;

    constructor(ui: AdvancedDynamicTexture) {
        this.ui = ui;

        // ── Transparent full-canvas catcher ────────────────────────────────
        this.catcher = new Rectangle('joystickCatcher');
        this.catcher.width = '100%';
        this.catcher.height = '100%';
        this.catcher.thickness = 0;
        this.catcher.background = '';
        this.catcher.isPointerBlocker = true; // consumes events that reach it
        this.catcher.zIndex = -10;            // lowest — UI buttons sit above
        this.ui.addControl(this.catcher);

        // ── Ring ──────────────────────────────────────────────────────────
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
        this.ring.zIndex = -5; // above catcher, below buttons
        this.ui.addControl(this.ring);

        // ── Thumb ─────────────────────────────────────────────────────────
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
        this.catcher.onPointerDownObservable.add((coords: Vector2WithInfo) => {
            if (this.activePointerId !== null) {
                this.phantomDownCount++; // secondary finger — track so its up doesn't kill the session
                return;
            }
            this.activePointerId = coords.buttonIndex;
            this.originX = coords.x;
            this.originY = coords.y;

            this.ring.left = `${coords.x - this.baseRadius}px`;
            this.ring.top = `${coords.y - this.baseRadius}px`;
            this.ring.isVisible = true;
            this.thumb.left = '0px';
            this.thumb.top = '0px';
        });

        this.catcher.onPointerMoveObservable.add((coords: Vector2) => {
            if (this.activePointerId === null) return;
            const rawDx = coords.x - this.originX;
            const rawDy = coords.y - this.originY;
            const dist = Math.hypot(rawDx, rawDy);
            const normX = dist > 0 ? rawDx / dist : 0;
            const normY = dist > 0 ? rawDy / dist : 0;
            const clamped = Math.min(dist, this.baseRadius);

            this.dx = normX * (clamped / this.baseRadius);
            this.dz = -normY * (clamped / this.baseRadius);

            const thumbMax = this.baseRadius - this.thumbRadius;
            this.thumb.left = `${normX * thumbMax}px`;
            this.thumb.top = `${normY * thumbMax}px`;

            if (this.onDirectionCallback) {
                this.onDirectionCallback(this.dx, this.dz);
            }
        });

        const reset = () => {
            this.activePointerId = null;
            this.dx = 0;
            this.dz = 0;
            this.ring.isVisible = false;
            this.thumb.left = '0px';
            this.thumb.top = '0px';
            if (this.onDirectionCallback) {
                this.onDirectionCallback(0, 0);
            }
        };

        this.catcher.onPointerUpObservable.add(() => {
            if (this.phantomDownCount > 0) {
                this.phantomDownCount--; // phantom finger lifting — don't end session
                return;
            }
            reset();
        });
        this.catcher.onPointerOutObservable.add(() => {
            // off-screen: keep input alive; pointer-up handles end
        });
    }

    public onDirection(fn: (dx: number, dz: number) => void): void {
        this.onDirectionCallback = fn;
    }

    public getDx(): number { return this.dx; }
    public getDz(): number { return this.dz; }

    public dispose(): void {
        this.catcher.dispose();
        this.ring.dispose();
    }
}
