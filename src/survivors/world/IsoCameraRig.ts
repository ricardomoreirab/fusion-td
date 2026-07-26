import { OrthographicCamera, Vector3 } from 'three';
import {
    ISO_DIR_X, ISO_DIR_Y, ISO_DIR_Z,
    ISO_CLIP_DISTANCE, ISO_NEAR, ISO_FAR,
    ISO_VIEW_HEIGHT, ISO_VIEW_HEIGHT_MOBILE,
    ISO_ZOOM_DEFAULT,
    isoFrustum, isoViewHalfDiagonal,
    stepIsoZoom, lerpIsoZoom, parsePersistedIsoZoom, clampIsoZoom,
    type OrthoFrustum,
} from './isoProjection';

const ZOOM_STORAGE_KEY = 'ktg.isoZoom';

/** Camera-local right vector on the ground plane: (1, 0, -1)/√2. */
const RIGHT_X = Math.SQRT1_2;
const RIGHT_Z = -Math.SQRT1_2;
/** Camera-local up vector: (-1, 2, -1)/√6. */
const UP_X = -1 / Math.sqrt(6);
const UP_Y = 2 / Math.sqrt(6);
const UP_Z = -1 / Math.sqrt(6);

const SHAKE_MAGNITUDE = 0.55;
const SHAKE_DURATION_S = 0.10;
/** Frame-rate-independent follow ease. Matches the old rig's feel. */
const FOLLOW_LERP = 9;

function readPersistedZoom(): string | null {
    try { return localStorage.getItem(ZOOM_STORAGE_KEY); } catch { return null; }
}
function writePersistedZoom(z: number): void {
    try { localStorage.setItem(ZOOM_STORAGE_KEY, String(z)); } catch { /* ignore */ }
}

export interface IsoFocus { x: number; z: number; distanceScale: number }

/**
 * True-orthographic isometric follow rig.
 *
 * Replaces the perspective slant camera. Three things work differently and each
 * one is a place the old code would have quietly broken:
 *
 * 1. **Zoom is frustum scale, not distance.** Under parallel projection moving
 *    the camera along its view axis changes nothing on screen. The old rig
 *    composed zoom as a multiplier on slant distance; here distance is fixed at
 *    ISO_CLIP_DISTANCE (a clipping concern only) and zoom scales left/right/
 *    top/bottom instead.
 *
 * 2. **Co-op `distanceScale` folds into zoom.** The co-op layer's contract is
 *    "1 = solo framing, >1 pulls back". Pulling back is meaningless here, so it
 *    multiplies the effective zoom. The contract is preserved; the mechanism is
 *    not. Keeping the composition in this one place is what stops the co-op path
 *    from reintroducing a distance that silently does nothing.
 *
 * 3. **Rotation is set once and never recomputed.** Same discipline as the old
 *    rig: only position moves per frame, so there is no per-frame lookAt drift
 *    that would read as the world rotating under the hero.
 */
export class IsoCameraRig {
    private readonly camera: OrthographicCamera;
    private readonly canvas: HTMLCanvasElement | null;

    private viewHeight: number;
    private zoomTarget: number;
    private zoomLive: number;
    /** Last composed zoom (user zoom × co-op scale) actually written to the
     *  projection matrix — cached so we only rebuild the matrix when it moves. */
    private appliedZoom = -1;
    private appliedAspect = -1;

    private focusProvider: (() => IsoFocus) | null = null;
    private shakeRemaining = 0;

    private readonly _frustum: OrthoFrustum = { left: -1, right: 1, top: 1, bottom: -1 };
    private readonly _desired = new Vector3();
    /** Solo-frame focus, written in place — the no-provider path runs every frame. */
    private readonly _soloFocus: IsoFocus = { x: 0, z: 0, distanceScale: 1 };
    private readonly onWheel: (e: WheelEvent) => void;

    constructor(canvas: HTMLCanvasElement | null, startX = 0, startZ = 0) {
        this.canvas = canvas;
        const vw = canvas?.clientWidth || window.innerWidth;
        this.viewHeight = vw < 700 ? ISO_VIEW_HEIGHT_MOBILE : ISO_VIEW_HEIGHT;

        this.zoomTarget = parsePersistedIsoZoom(readPersistedZoom());
        this.zoomLive = this.zoomTarget;

        this.camera = new OrthographicCamera(-1, 1, 1, -1, ISO_NEAR, ISO_FAR);
        this.camera.name = 'isoHeroCam';

        // Position along the (1,1,1) diagonal and lock the orientation once.
        this.camera.position.set(
            startX + ISO_DIR_X * ISO_CLIP_DISTANCE,
            ISO_DIR_Y * ISO_CLIP_DISTANCE,
            startZ + ISO_DIR_Z * ISO_CLIP_DISTANCE,
        );
        this.camera.lookAt(startX, 0, startZ);
        this.applyProjection(true);

        this.onWheel = (e: WheelEvent) => {
            e.preventDefault(); // stop page scroll / pinch-zoom over the canvas
            this.zoomTarget = stepIsoZoom(this.zoomTarget, e.deltaY);
            writePersistedZoom(this.zoomTarget);
        };
        this.canvas?.addEventListener('wheel', this.onWheel, { passive: false });
    }

    public getCamera(): OrthographicCamera { return this.camera; }

    /** Current eased user-zoom multiplier (co-op scale NOT included). */
    public getZoom(): number { return this.zoomLive; }

    /** Visible ground half-diagonal at the current framing — the world system
     *  uses this to keep terrain/scatter coverage just past the frame corner. */
    public getViewHalfDiagonal(): number {
        return isoViewHalfDiagonal(this.viewHeight, this.currentAspect(), this.zoomLive);
    }

    /** Vertical world-unit extent at zoom 1, before zoom is applied. */
    public getViewHeight(): number { return this.viewHeight; }

    public setFocusProvider(fn: (() => IsoFocus) | null): void {
        this.focusProvider = fn;
    }

    /** Trigger a shake of at least `durationS` seconds. */
    public shake(durationS: number = SHAKE_DURATION_S): void {
        this.shakeRemaining = Math.max(this.shakeRemaining, durationS);
    }

    private currentAspect(): number {
        const w = this.canvas?.clientWidth || window.innerWidth;
        const h = Math.max(1, this.canvas?.clientHeight || window.innerHeight);
        const a = w / h;
        return Number.isFinite(a) && a > 0 ? a : 1;
    }

    /** Rebuild the projection matrix when zoom or aspect actually changed.
     *  Re-picks the mobile/desktop view height here too, so a viewport change
     *  self-heals without needing an explicit resize hook wired through Game. */
    private applyProjection(force: boolean, coopScale = 1): void {
        const aspect = this.currentAspect();
        const vw = this.canvas?.clientWidth || window.innerWidth;
        const wantHeight = vw < 700 ? ISO_VIEW_HEIGHT_MOBILE : ISO_VIEW_HEIGHT;
        if (wantHeight !== this.viewHeight) {
            this.viewHeight = wantHeight;
            force = true;
        }
        const composed = clampIsoZoom(this.zoomLive * coopScale);
        if (!force && composed === this.appliedZoom && aspect === this.appliedAspect) return;

        isoFrustum(this.viewHeight, aspect, composed, this._frustum);
        this.camera.left = this._frustum.left;
        this.camera.right = this._frustum.right;
        this.camera.top = this._frustum.top;
        this.camera.bottom = this._frustum.bottom;
        this.camera.updateProjectionMatrix();
        this.appliedZoom = composed;
        this.appliedAspect = aspect;
    }

    /**
     * Per-frame follow. `fallbackX/Z` is the hero position, used when no co-op
     * focus provider is installed.
     */
    public update(deltaTime: number, fallbackX: number, fallbackZ: number): void {
        let focus = this.focusProvider?.() ?? null;
        if (!focus) {
            this._soloFocus.x = fallbackX;
            this._soloFocus.z = fallbackZ;
            this._soloFocus.distanceScale = 1;
            focus = this._soloFocus;
        }

        // Guard: a non-finite focus would poison camera.position permanently,
        // because a lerp of NaN stays NaN forever and a NaN view matrix clips
        // every mesh (the known black-screen class — see CLAUDE.md).
        const fx = Number.isFinite(focus.x) ? focus.x : fallbackX;
        const fz = Number.isFinite(focus.z) ? focus.z : fallbackZ;
        const scale = Number.isFinite(focus.distanceScale) && focus.distanceScale > 0
            ? focus.distanceScale : 1;

        this.zoomLive = lerpIsoZoom(this.zoomLive, this.zoomTarget, deltaTime);
        this.applyProjection(false, scale);

        // Desired position: focus point pushed back along the fixed view diagonal.
        this._desired.set(
            fx + ISO_DIR_X * ISO_CLIP_DISTANCE,
            ISO_DIR_Y * ISO_CLIP_DISTANCE,
            fz + ISO_DIR_Z * ISO_CLIP_DISTANCE,
        );

        const t = Math.min(1, Math.max(0, deltaTime * FOLLOW_LERP));
        this.camera.position.lerp(this._desired, t);

        // Re-guard after the lerp; if anything went non-finite, snap rather than
        // stay poisoned.
        const p = this.camera.position;
        if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) {
            p.copy(this._desired);
        }

        // Shake AFTER the lerp, along the camera's own screen axes so it reads as
        // screen jitter rather than a world-space nudge. Applying it before the
        // lerp would let the smoothing eat it down to ~1px of motion.
        if (this.shakeRemaining > 0) {
            const k = this.shakeRemaining / SHAKE_DURATION_S;
            const angle = Math.random() * Math.PI * 2;
            const sx = Math.cos(angle) * SHAKE_MAGNITUDE * k;
            const sy = Math.sin(angle) * SHAKE_MAGNITUDE * k;
            p.x += RIGHT_X * sx + UP_X * sy;
            p.y += UP_Y * sy;
            p.z += RIGHT_Z * sx + UP_Z * sy;
            this.shakeRemaining -= deltaTime;
        }
    }

    /** Viewport changed: re-pick the mobile/desktop view height and rebuild. */
    public resize(): void {
        const vw = this.canvas?.clientWidth || window.innerWidth;
        this.viewHeight = vw < 700 ? ISO_VIEW_HEIGHT_MOBILE : ISO_VIEW_HEIGHT;
        this.applyProjection(true);
    }

    public dispose(): void {
        this.canvas?.removeEventListener('wheel', this.onWheel);
    }
}

export { ISO_ZOOM_DEFAULT };
