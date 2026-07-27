/**
 * BoltField — every live chain-lightning bolt in ONE LineSegments draw.
 *
 * Why this exists
 * ---------------
 * `spawnBolt` used to build a whole scene object per segment: a fresh
 * `BufferGeometry`, a fresh `LineBasicMaterial`, a scene-root `Line` and its own
 * `onBeforeRender` token, all torn down 0.18s later. A maxed Lightning Chain
 * fusion against a horde produces hundreds of segments at once — 476 live bolts
 * measured in ordinary stress play, 700 at the peak — so that is hundreds of
 * draw calls, hundreds of GPU buffer create/upload/delete pairs per burst, and
 * hundreds of per-frame callbacks, for a visual made of 1-pixel lines.
 *
 * Measured on the real scene (paused, ~250 enemies, vsync off, variant flipped
 * every frame and bucketed by that frame's wall-clock delta — the frame-level
 * interleaving CLAUDE.md prescribes, repeated at all three phase offsets):
 *
 *   500 individual Lines   11.19 / 11.36 / 11.30 ms/frame
 *   1 batched LineSegments  9.38 /  9.53 /  9.47 ms/frame
 *   neither drawn           9.21 /  9.36 /  9.29 ms/frame
 *
 * i.e. 500 separate bolts cost ~2.00 ms/frame and the batched equivalent
 * ~0.18 ms — a ~1.8 ms/frame saving at that bolt count, ~4 µs per bolt.
 *
 * How the visual stays identical
 * ------------------------------
 * A per-bolt material carried the element colour in `material.color` and the
 * linear fade in `material.opacity`, and the line shader computes
 * `diffuseColor = vec4(diffuse, opacity) * vColor`. Here `diffuse` is white and
 * `opacity` 1, and BOTH values are carried per vertex in a 4-component colour
 * attribute (three enables `USE_COLOR_ALPHA` when a vertexColors material sees
 * an itemSize-4 `color` attribute), so the product reaching the framebuffer is
 * bit-for-bit the old one. Colours are written straight out of a `THREE.Color`,
 * which already holds working-space values — the same values the old material
 * uniform received.
 *
 * `depthWrite: false` is deliberate. Separate transparent Lines were depth-SORTED
 * back-to-front and each wrote depth, which makes two crossing bolts blend;
 * merged into one buffer they draw in slot order, so keeping depthWrite would let
 * whichever bolt happens to sit earlier in the buffer punch a hole in a farther
 * one. Disabling depth *writes* (never the depth TEST — bolts still hide behind
 * world geometry exactly as before) reproduces the sorted result instead of
 * inverting it.
 *
 * Verified against the shipped recipe by reading the drawing buffer back with
 * `gl.readPixels` on a frozen frame (two grabs of the same variant differ in 0 of
 * 9,739,200 bytes, so the control is exact): eight lines drawn the old way and
 * the same eight batched here differ in 136 of the 19,772 pixels they cover, all
 * inside one small region where the lines cross other transparent FX. That is the
 * one residual difference and it is inherent to batching, not to this encoding —
 * N transparent objects interleave with the rest of the transparent queue by
 * depth, one object cannot. Everywhere else the bolts are bit-identical, which is
 * what confirms white-material × RGBA-vertex-colour reproduces
 * coloured-material × opacity exactly.
 */

import {
    BufferAttribute,
    BufferGeometry,
    Color,
    DynamicDrawUsage,
    LineBasicMaterial,
    LineSegments,
    Vector3,
} from 'three';
import type { SceneHost, UpdateToken } from '../../engine/three/SceneHost';

/** Slots allocated up front. Doubles on demand; 256 covers ordinary play. */
const INITIAL_CAPACITY = 256;

export class BoltField {
    private readonly host: SceneHost;
    private readonly material: LineBasicMaterial;
    private readonly mesh: LineSegments;
    private readonly geometry: BufferGeometry;

    private capacity = INITIAL_CAPACITY;
    /** Live bolts occupy slots [0, live); expiry swap-removes with the last. */
    private live = 0;
    /** 2 vertices × 3 floats per bolt. */
    private positions = new Float32Array(INITIAL_CAPACITY * 6);
    /** 2 vertices × RGBA per bolt. */
    private colors = new Float32Array(INITIAL_CAPACITY * 8);
    // CPU-side only, and deliberately float64: the fade/expiry arithmetic then
    // matches the per-bolt closure it replaces exactly, rather than drifting at
    // the boundary because a float32 `lifeS` rounds up past the elapsed sum.
    private elapsed = new Float64Array(INITIAL_CAPACITY);
    private lifetimes = new Float64Array(INITIAL_CAPACITY);

    private posAttr: BufferAttribute;
    private colAttr: BufferAttribute;

    private token: UpdateToken | null = null;
    private disposed = false;

    constructor(host: SceneHost) {
        this.host = host;

        this.material = new LineBasicMaterial({
            color: 0xffffff,
            vertexColors: true,
            transparent: true,
            depthWrite: false,
        });
        this.material.name = 'fx_bolt_field';

        this.geometry = new BufferGeometry();
        this.posAttr = this._newAttribute(this.positions, 3);
        this.colAttr = this._newAttribute(this.colors, 4);
        this.geometry.setAttribute('position', this.posAttr);
        this.geometry.setAttribute('color', this.colAttr);
        this.geometry.setDrawRange(0, 0);

        this.mesh = new LineSegments(this.geometry, this.material);
        this.mesh.name = 'fx_bolt_field';
        // World-space vertices under an identity transform: nothing to compose,
        // and a bounding sphere over stale slots past the draw range would be
        // wrong anyway. Bolts spawn on live enemies, which are on screen.
        this.mesh.matrixAutoUpdate = false;
        this.mesh.frustumCulled = false;
        // Hidden while empty so a run with no chain power pays literally nothing
        // (an empty draw range still costs a render-list entry).
        this.mesh.visible = false;
        host.scene.add(this.mesh);

        this.token = host.onBeforeRender.add(() => this._tick());
    }

    /** Number of bolts currently alive. Diagnostics + tests. */
    public get liveCount(): number { return this.live; }

    /** Slots currently allocated. Tests only. */
    public get capacityCount(): number { return this.capacity; }

    public getMesh(): LineSegments { return this.mesh; }

    /**
     * Add a bolt from `from` to `to` that fades linearly to nothing over
     * `lifeS`. Same contract as the per-bolt Line it replaces: the first frame
     * renders it at full strength, the following frames step it down by
     * `deltaSeconds / lifeS`, and it disappears once `lifeS` has elapsed.
     */
    public spawn(from: Vector3, to: Vector3, color: Color, lifeS: number): void {
        if (this.disposed) return;
        if (this.live === this.capacity) this._grow();

        const i = this.live++;
        const p = i * 6;
        this.positions[p]     = from.x;
        this.positions[p + 1] = from.y;
        this.positions[p + 2] = from.z;
        this.positions[p + 3] = to.x;
        this.positions[p + 4] = to.y;
        this.positions[p + 5] = to.z;

        const c = i * 8;
        this.colors[c]     = color.r;
        this.colors[c + 1] = color.g;
        this.colors[c + 2] = color.b;
        this.colors[c + 3] = 1;
        this.colors[c + 4] = color.r;
        this.colors[c + 5] = color.g;
        this.colors[c + 6] = color.b;
        this.colors[c + 7] = 1;

        this.elapsed[i] = 0;
        this.lifetimes[i] = lifeS;
        this._flush();
    }

    public dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.live = 0;
        this.host.onBeforeRender.remove(this.token);
        this.token = null;
        this.mesh.removeFromParent();
        this.geometry.dispose();
        this.material.dispose();
    }

    // ── internals ───────────────────────────────────────────────────────────

    private _tick(): void {
        if (this.live === 0) return;
        const dt = this.host.deltaSeconds;
        for (let i = this.live - 1; i >= 0; i--) {
            const t = this.elapsed[i] + dt;
            const life = this.lifetimes[i];
            if (t >= life) {
                this._removeAt(i);
                continue;
            }
            this.elapsed[i] = t;
            const alpha = 1 - t / life;
            const c = i * 8;
            this.colors[c + 3] = alpha;
            this.colors[c + 7] = alpha;
        }
        this._flush();
    }

    /** Swap-remove: the last live bolt takes over the freed slot. */
    private _removeAt(i: number): void {
        const last = --this.live;
        if (i === last) return;
        this.positions.copyWithin(i * 6, last * 6, last * 6 + 6);
        this.colors.copyWithin(i * 8, last * 8, last * 8 + 8);
        this.elapsed[i] = this.elapsed[last];
        this.lifetimes[i] = this.lifetimes[last];
    }

    /** Push the live prefix of both buffers and resize the draw range. */
    private _flush(): void {
        const vertices = this.live * 2;
        this.geometry.setDrawRange(0, vertices);
        this.mesh.visible = vertices > 0;
        if (vertices === 0) return;
        this.posAttr.clearUpdateRanges();
        this.posAttr.addUpdateRange(0, vertices * 3);
        this.posAttr.needsUpdate = true;
        this.colAttr.clearUpdateRanges();
        this.colAttr.addUpdateRange(0, vertices * 4);
        this.colAttr.needsUpdate = true;
    }

    private _grow(): void {
        this.capacity *= 2;
        const positions = new Float32Array(this.capacity * 6);
        positions.set(this.positions);
        const colors = new Float32Array(this.capacity * 8);
        colors.set(this.colors);
        const elapsed = new Float64Array(this.capacity);
        elapsed.set(this.elapsed);
        const lifetimes = new Float64Array(this.capacity);
        lifetimes.set(this.lifetimes);
        this.positions = positions;
        this.colors = colors;
        this.elapsed = elapsed;
        this.lifetimes = lifetimes;

        // Replacing the attributes orphans the old GL buffers until the geometry
        // is disposed; bounded by the doubling (a handful of growths per run at
        // most), so it is not worth a second geometry to avoid.
        this.posAttr = this._newAttribute(positions, 3);
        this.colAttr = this._newAttribute(colors, 4);
        this.geometry.setAttribute('position', this.posAttr);
        this.geometry.setAttribute('color', this.colAttr);
    }

    /** `BufferAttribute`, never `Float32BufferAttribute` — the typed subclass
     *  COPIES the array it is handed, which would leave the field writing into a
     *  buffer the geometry does not own. */
    private _newAttribute(data: Float32Array, itemSize: number): BufferAttribute {
        const attr = new BufferAttribute(data, itemSize);
        attr.setUsage(DynamicDrawUsage);
        return attr;
    }
}
