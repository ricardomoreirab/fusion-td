/**
 * HealthBarField - every normal/elite enemy health bar in ONE pair of instanced
 * draws instead of two-to-three scene meshes per enemy.
 *
 * Why this exists
 * ---------------
 * Bars were the largest draw-call bucket at horde scale: ~2 meshes per enemy
 * (3 for an elite), each with its own PlaneGeometry, each a direct child of the
 * scene root. At 80 visible enemies that is ~160 draws and ~160 unique
 * 2-triangle geometries; at 250 live enemies it is ~500 permanent scene-root
 * children that `Scene.updateMatrixWorld()` walks EVERY frame - `visible=false`
 * suppresses drawing but never the walk (see CLAUDE.md "Horde scale is a
 * traversal problem").
 *
 * Here the bars are not scene objects at all. Each enemy owns a SLOT (an index
 * into flat typed arrays); once per frame `flush()` composes an instance matrix
 * per visible slot - world position, the shared camera quaternion (billboard),
 * a per-tier scale - and uploads them to three InstancedMeshes:
 *
 *   frame (renderOrder 1000) elite only: the orange glowing outline
 *   bg    (renderOrder 1001) all tiers: near-black slab (normal) / grey inset (elite)
 *   fill  (renderOrder 1002) all tiers: the band-coloured health fill
 *
 * The layering is exactly the old renderOrder ladder, and all three materials
 * keep `depthTest=false` so bars still draw over the world (the Babylon
 * depth-clear render-group equivalent). Instances are COMPACTED: only visible
 * slots are written and `count` is set to the written total, so a parked or
 * dead enemy costs zero vertices - and an empty layer hides itself, so the
 * common case (no elites on screen) is TWO draw calls for the whole horde.
 *
 * BOSS bars deliberately keep the old per-mesh path (Enemy.createHealthBar):
 * there are never more than a couple, and they carry segment dividers plus a
 * Sprite name label with a per-instance DynamicTexture that instancing cannot
 * express.
 *
 * Materials are owned here (NOT routed through MaterialCache): there are
 * exactly three of them for the whole run, they are named `healthbar_field_*`
 * so the resource watchdog buckets them recognisably, and `dispose()` frees
 * them - plus the shared geometry and the instance attribute buffers - exactly
 * once.
 */

import {
    Color,
    DynamicDrawUsage,
    InstancedMesh,
    Matrix4,
    MeshPhongMaterial,
    PlaneGeometry,
    Quaternion,
    Vector3,
    type Camera,
} from 'three';
import { disposeMesh } from '../../engine/three/primitives';
import type { SceneHost, UpdateToken } from '../../engine/three/SceneHost';

// ── Shared colour constants ──────────────────────────────────────────────────
// Health-bar band colours. Defined here (rather than in Enemy.ts) because the
// instanced field is now their primary consumer; Enemy.ts re-exports them so
// the old import path keeps working. Assigned onto materials / written into an
// instanceColor buffer - never mutated in place, so one instance is safe to
// share across every bar in the game.
export const HEALTH_COLOR_GREEN  = new Color(0.2, 0.8, 0.2);
export const HEALTH_COLOR_YELLOW = new Color(0.8, 0.8, 0.2);
export const HEALTH_COLOR_RED    = new Color(0.8, 0.2, 0.2);

/** Near-black slab behind a NORMAL-tier bar. It doubles as that tier's frame. */
const BG_COLOR_NORMAL = new Color(0.05, 0.05, 0.05);
/** Classic grey inset behind an ELITE-tier fill (the orange outline is the frame). */
const BG_COLOR_ELITE  = new Color(0.3, 0.3, 0.3);

const BAND_COLORS = [HEALTH_COLOR_GREEN, HEALTH_COLOR_YELLOW, HEALTH_COLOR_RED];

/** Base renderOrder for enemy health bars — frame/bg/fill take +0/+1/+2. */
export const HEALTH_BAR_RENDER_GROUP = 1000;

/** How much bigger than the fill the framing slab / elite outline is drawn. */
export const BAR_FRAME_PAD_X = 0.08;
export const BAR_FRAME_PAD_Y = 0.06;

/** Slot capacity. Comfortably past the largest observed horde (~250 live) plus
 *  every elite; corpses release their slot the instant they die, so this is not
 *  a "live + dead" budget. Overflow CLAMPS (the enemy simply gets no bar) and
 *  logs once — it must never throw. */
export const HEALTH_BAR_FIELD_CAPACITY = 320;

export const BAR_TIER_NORMAL = 0;
export const BAR_TIER_ELITE = 1;
export type BarTierIndex = typeof BAR_TIER_NORMAL | typeof BAR_TIER_ELITE;

/** Floats stored per slot: x, y, z, fraction, fillWidth, fillHeight. */
const STRIDE = 6;

// ── Pure math (unit-tested) ──────────────────────────────────────────────────

/** Fill colour band index: 0 green (>60%), 1 yellow (>30%), 2 red. Identical
 *  thresholds to the material-swap path the mesh bars used. */
export function healthBandIndex(fraction: number): 0 | 1 | 2 {
    return fraction > 0.6 ? 0 : fraction > 0.3 ? 1 : 2;
}

/**
 * Offset (along the bar's LOCAL x, i.e. camera-right) that keeps a fill of
 * width `width * fraction` glued to the left edge of a bar of width `width`,
 * so the bar drains from the right. The mesh bars applied the same
 * `-(1 - f) * w/2` shift, but in WORLD x — which under the 45°-yaw isometric
 * camera slid the fill diagonally across the slab. Rotating it by the billboard
 * quaternion (see flush) is the same anchoring, done in the plane the bar is
 * actually drawn in.
 */
export function fillAnchorOffsetX(fraction: number, width: number): number {
    return -(1 - fraction) * width * 0.5;
}

/** Camera accessor — structurally satisfied by `Game`, so this module never
 *  imports the engine root. */
export interface BarCameraSource {
    getActiveCamera(): Camera;
}

// Scratch objects reused by flush() — one set for the whole field, never
// allocated per bar per frame.
const _pos = new Vector3();
const _scale = new Vector3();
const _offset = new Vector3();
const _matrix = new Matrix4();
const _quat = new Quaternion();

export class HealthBarField {
    public readonly host: SceneHost;

    private readonly cameraSource: BarCameraSource;
    private readonly geometry: PlaneGeometry;
    private readonly frameMesh: InstancedMesh;
    private readonly bgMesh: InstancedMesh;
    private readonly fillMesh: InstancedMesh;
    private readonly token: UpdateToken;

    private readonly used: Uint8Array;
    private readonly shown: Uint8Array;
    private readonly tier: Uint8Array;
    private readonly data: Float32Array;
    /** Stack of free slot indices (descending, so pop() hands out 0,1,2,…). */
    private readonly free: number[] = [];
    /** One past the highest slot ever handed out — bounds the flush scan. */
    private highWater = 0;
    private overflowWarned = false;
    private disposed = false;

    constructor(
        host: SceneHost,
        cameraSource: BarCameraSource,
        public readonly capacity: number = HEALTH_BAR_FIELD_CAPACITY,
    ) {
        this.host = host;
        this.cameraSource = cameraSource;

        this.used = new Uint8Array(capacity);
        this.shown = new Uint8Array(capacity);
        this.tier = new Uint8Array(capacity);
        this.data = new Float32Array(capacity * STRIDE);
        for (let i = capacity - 1; i >= 0; i--) this.free.push(i);

        // ONE unit plane for every bar; per-instance scale carries the real size.
        // Flagged cache-owned so disposeMesh() leaves it to us (three meshes
        // share it — it must be freed exactly once, at the end of dispose()).
        this.geometry = new PlaneGeometry(1, 1);
        this.geometry.userData.cached = true;

        this.frameMesh = this._makeLayer('healthbar_field_frame', HEALTH_BAR_RENDER_GROUP + 0, m => {
            // Matches the old cached `healthBarFrameMat_elite`.
            m.color = new Color(1.0, 0.55, 0.15);
            m.emissive = new Color(0.35, 0.18, 0.04);
        }, false);
        this.bgMesh = this._makeLayer('healthbar_field_bg', HEALTH_BAR_RENDER_GROUP + 1, m => {
            // White base: the real grey comes from the per-instance colour, which
            // the shader multiplies into the diffuse term.
            m.color = new Color(1, 1, 1);
        }, true);
        this.fillMesh = this._makeLayer('healthbar_field_fill', HEALTH_BAR_RENDER_GROUP + 2, m => {
            m.color = new Color(1, 1, 1);
        }, true);

        this.token = host.onBeforeRender.add(() => this.flush());
    }

    private _makeLayer(
        name: string,
        renderOrder: number,
        setup: (m: MeshPhongMaterial) => void,
        perInstanceColor: boolean,
    ): InstancedMesh {
        const material = new MeshPhongMaterial();
        material.name = name;
        material.specular = new Color(0, 0, 0);
        // Same "always on top" contract the mesh bars had: no depth interaction
        // at all, ordering comes purely from renderOrder.
        material.depthTest = false;
        material.depthWrite = false;
        setup(material);

        const mesh = new InstancedMesh(this.geometry, material, this.capacity);
        mesh.name = name;
        mesh.renderOrder = renderOrder;
        // Instances span the whole view; the per-enemy off-screen cull already
        // decides what is written, so a whole-object frustum test is both wrong
        // (the object's bounds are the unit plane at the origin) and pointless.
        mesh.frustumCulled = false;
        mesh.instanceMatrix.setUsage(DynamicDrawUsage);
        mesh.count = 0;
        mesh.visible = false;
        if (perInstanceColor) {
            mesh.setColorAt(0, HEALTH_COLOR_GREEN);
            mesh.instanceColor!.setUsage(DynamicDrawUsage);
        }
        this.host.scene.add(mesh);
        return mesh;
    }

    public get isDisposed(): boolean {
        return this.disposed;
    }

    /** Slots currently handed out — diagnostics + tests. */
    public get activeCount(): number {
        return this.capacity - this.free.length;
    }

    /** Instances written by the most recent flush, per layer. */
    public get drawnCounts(): { frame: number; bg: number; fill: number } {
        return { frame: this.frameMesh.count, bg: this.bgMesh.count, fill: this.fillMesh.count };
    }

    /**
     * Reserve a bar. Returns the slot index, or -1 when the field is full or
     * disposed — callers must treat -1 as "this enemy has no bar", never as an
     * error (a missing bar is a cosmetic loss, a throw is a dead frame).
     */
    public acquire(tier: BarTierIndex, fillWidth: number, fillHeight: number): number {
        if (this.disposed) return -1;
        const slot = this.free.pop();
        if (slot === undefined) {
            if (!this.overflowWarned) {
                this.overflowWarned = true;
                console.warn(`[healthbar] field at capacity (${this.capacity}) — extra bars are skipped`);
            }
            return -1;
        }
        this.used[slot] = 1;
        this.shown[slot] = 1;
        this.tier[slot] = tier;
        const o = slot * STRIDE;
        this.data[o] = 0;
        this.data[o + 1] = 0;
        this.data[o + 2] = 0;
        this.data[o + 3] = 1;
        this.data[o + 4] = fillWidth;
        this.data[o + 5] = fillHeight;
        if (slot >= this.highWater) this.highWater = slot + 1;
        return slot;
    }

    /** Hand a slot back. Idempotent and safe with -1 / a disposed field. */
    public release(slot: number): void {
        if (this.disposed || slot < 0 || slot >= this.capacity) return;
        if (!this.used[slot]) return;
        this.used[slot] = 0;
        this.shown[slot] = 0;
        this.free.push(slot);
    }

    /** Per-frame state: where the bar sits and how full it is. */
    public setState(slot: number, x: number, y: number, z: number, fraction: number): void {
        if (this.disposed || slot < 0 || slot >= this.capacity || !this.used[slot]) return;
        const o = slot * STRIDE;
        this.data[o] = x;
        this.data[o + 1] = y;
        this.data[o + 2] = z;
        this.data[o + 3] = fraction < 0 ? 0 : fraction > 1 ? 1 : fraction;
    }

    /** Off-screen cull hook: a hidden slot is skipped by flush entirely. */
    public setVisible(slot: number, visible: boolean): void {
        if (this.disposed || slot < 0 || slot >= this.capacity || !this.used[slot]) return;
        this.shown[slot] = visible ? 1 : 0;
    }

    /** Compose and upload one frame's worth of instances. Registered on the
     *  SceneHost's onBeforeRender bus, which runs AFTER gameplay has moved every
     *  enemy and BEFORE the renderer reads the buffers. */
    public flush(): void {
        if (this.disposed) return;

        const camera = this.cameraSource.getActiveCamera();
        if (!camera) {
            this._publish(0, 0, 0);
            return;
        }
        _quat.copy(camera.quaternion);

        const d = this.data;
        let nFrame = 0, nBg = 0, nFill = 0;

        for (let slot = 0; slot < this.highWater; slot++) {
            if (!this.used[slot] || !this.shown[slot]) continue;

            const o = slot * STRIDE;
            const x = d[o], y = d[o + 1], z = d[o + 2];
            const fraction = d[o + 3], w = d[o + 4], h = d[o + 5];

            _pos.set(x, y, z);

            if (this.tier[slot] === BAR_TIER_ELITE) {
                // Elite: glowing outline behind a grey inset the fill sits on.
                _scale.set(w + BAR_FRAME_PAD_X, h + BAR_FRAME_PAD_Y, 1);
                _matrix.compose(_pos, _quat, _scale);
                this.frameMesh.setMatrixAt(nFrame++, _matrix);

                _scale.set(w, h, 1);
                _matrix.compose(_pos, _quat, _scale);
                this.bgMesh.setMatrixAt(nBg, _matrix);
                this.bgMesh.setColorAt(nBg, BG_COLOR_ELITE);
                nBg++;
            } else {
                // Normal: the frame-sized near-black slab IS the frame.
                _scale.set(w + BAR_FRAME_PAD_X, h + BAR_FRAME_PAD_Y, 1);
                _matrix.compose(_pos, _quat, _scale);
                this.bgMesh.setMatrixAt(nBg, _matrix);
                this.bgMesh.setColorAt(nBg, BG_COLOR_NORMAL);
                nBg++;
            }

            // Left-anchored fill: shrink along the bar's own x and shift by half
            // the removed width so the left edge stays put.
            _offset.set(fillAnchorOffsetX(fraction, w), 0, 0).applyQuaternion(_quat);
            _pos.set(x + _offset.x, y + _offset.y, z + _offset.z);
            // Never exactly zero: a singular instance matrix makes the normal
            // transform divide by zero (NaN lighting) even though the triangles
            // have no area. 1e-4 world units is sub-pixel.
            _scale.set(Math.max(w * fraction, 1e-4), h, 1);
            _matrix.compose(_pos, _quat, _scale);
            this.fillMesh.setMatrixAt(nFill, _matrix);
            this.fillMesh.setColorAt(nFill, BAND_COLORS[healthBandIndex(fraction)]);
            nFill++;
        }

        this._publish(nFrame, nBg, nFill);
    }

    private _publish(nFrame: number, nBg: number, nFill: number): void {
        this.frameMesh.count = nFrame;
        this.frameMesh.visible = nFrame > 0;
        if (nFrame > 0) this.frameMesh.instanceMatrix.needsUpdate = true;

        this.bgMesh.count = nBg;
        this.bgMesh.visible = nBg > 0;
        if (nBg > 0) {
            this.bgMesh.instanceMatrix.needsUpdate = true;
            if (this.bgMesh.instanceColor) this.bgMesh.instanceColor.needsUpdate = true;
        }

        this.fillMesh.count = nFill;
        this.fillMesh.visible = nFill > 0;
        if (nFill > 0) {
            this.fillMesh.instanceMatrix.needsUpdate = true;
            if (this.fillMesh.instanceColor) this.fillMesh.instanceColor.needsUpdate = true;
        }
    }

    /**
     * Free everything this field owns: the update-bus hook, the three
     * InstancedMeshes (materials via the disposeMesh funnel, instance attribute
     * buffers via InstancedMesh.dispose — disposeMesh does NOT know about
     * those) and, last, the one shared geometry.
     */
    public dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.host.onBeforeRender.remove(this.token);
        for (const mesh of [this.frameMesh, this.bgMesh, this.fillMesh]) {
            disposeMesh(mesh, { materials: true });
            mesh.dispose();
        }
        this.geometry.userData.cached = false;
        this.geometry.dispose();
        this.free.length = 0;
    }
}

// ── Shared instance ──────────────────────────────────────────────────────────
// One field per run. Created lazily by the first enemy that needs a bar and
// released by EnemyManager.dispose(); enemies keep a direct reference plus
// their slot, and every field method is a no-op once disposed, so a teardown
// racing a late enemy release can never write into a fresh field.

let _shared: HealthBarField | null = null;

export function getHealthBarField(host: SceneHost, cameraSource: BarCameraSource): HealthBarField {
    if (_shared && (_shared.isDisposed || _shared.host !== host)) {
        _shared.dispose();
        _shared = null;
    }
    if (!_shared) _shared = new HealthBarField(host, cameraSource);
    return _shared;
}

export function disposeHealthBarField(): void {
    _shared?.dispose();
    _shared = null;
}

/** Test/diagnostic accessor — null when no run has created a field yet. */
export function peekHealthBarField(): HealthBarField | null {
    return _shared;
}
