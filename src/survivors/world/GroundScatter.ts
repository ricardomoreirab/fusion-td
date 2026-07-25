import {
    BufferAttribute, BufferGeometry, Color, DoubleSide, DynamicDrawUsage,
    InstancedMesh, MeshStandardMaterial, Matrix4, Quaternion, Vector3,
} from 'three';
import type { SceneHost } from '../../engine/three/SceneHost';
import type { BiomeDef } from './Biomes';
import {
    SCATTER_TILE, SCATTER_TUFTS_HIGH, SCATTER_DEBRIS_HIGH, SCATTER_QUALITY_SCALE,
} from './WorldConstants';

/**
 * Instanced ground detail: grass/stubble tufts and pebble/bone debris.
 *
 * This is the layer that stops the terrain reading as a painted plane. Under an
 * orthographic isometric camera there is no horizon and no perspective
 * foreshortening, so *ground* detail is the only thing carrying surface texture
 * and scale — which is why this gets the instance budget rather than a sky.
 *
 * Treadmill strategy: instances live on a lattice with period SCATTER_TILE. Each
 * frame every instance is tested against the hero and, if it has fallen more
 * than half a tile behind, it is snapped forward by a whole tile. Because the
 * jump is exactly one lattice period the field is seamless and world-anchored:
 * a tuft appears bolted to the ground even though its instance is being reused.
 *
 * The wrap runs on the CPU rather than in a vertex shader on purpose. A shader
 * wrap would have to be duplicated into `worldpos_vertex` (shadow lookup) and
 * the depth material (shadow casting) or the two would silently disagree; the
 * CPU test is a flat compare over a typed array and lets these keep stock
 * MeshStandardMaterial with shadows and fog intact.
 */

const TMP_MAT = new Matrix4();
const TMP_POS = new Vector3();
const TMP_QUAT = new Quaternion();
const TMP_SCALE = new Vector3();
const UP = new Vector3(0, 1, 0);

/** Deterministic hash → [0,1). Keeps layout reproducible across runs/tests. */
function hash(n: number): number {
    const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return s - Math.floor(s);
}

/**
 * A grass/stubble clump: three tapered blades rising from a shared base, each
 * bent slightly outward. Solid geometry, no alpha — alpha-tested cards would
 * cost fill rate and force sorting for no gain at this on-screen size.
 */
function buildTuftGeometry(): BufferGeometry {
    const blades = 3;
    const verts: number[] = [];
    const norms: number[] = [];
    const cols: number[] = [];
    // Root is darker than the tip: a cheap fake AO that grounds the clump.
    const root = [0.45, 0.45, 0.45];
    const tip = [1.25, 1.25, 1.25];

    for (let b = 0; b < blades; b++) {
        const a = (b / blades) * Math.PI * 2 + 0.4;
        // Width is load-bearing: at 0.035 the blades rendered ~3px wide on an
        // orthographic frame and simply disappeared into the ground.
        const w = 0.10;
        const h = 0.34 + hash(b * 7.3) * 0.20;
        const lean = 0.09 + hash(b * 3.1) * 0.07;
        const cx = Math.cos(a), cz = Math.sin(a);
        // Perpendicular gives the blade its width.
        const px = -cz * w, pz = cx * w;

        verts.push(-px, 0, -pz,  px, 0, pz,  cx * lean, h, cz * lean);
        for (let i = 0; i < 3; i++) norms.push(cx * 0.35, 0.9, cz * 0.35);
        cols.push(...root, ...root, ...tip);
    }

    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(verts), 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array(norms), 3));
    g.setAttribute('color', new BufferAttribute(new Float32Array(cols), 3));
    return g;
}

/** A faceted pebble / bone shard. Six triangles, irregular so it never reads as
 *  a repeated primitive when instanced thousands of times. */
function buildDebrisGeometry(): BufferGeometry {
    const verts: number[] = [];
    const norms: number[] = [];
    const cols: number[] = [];
    const rings = 5;
    const top = new Vector3(0, 0.16, 0);
    const pts: Vector3[] = [];
    for (let i = 0; i < rings; i++) {
        const a = (i / rings) * Math.PI * 2;
        const r = 0.10 + hash(i * 5.7) * 0.06;
        pts.push(new Vector3(Math.cos(a) * r, hash(i * 2.9) * 0.03, Math.sin(a) * r));
    }
    const n = new Vector3();
    for (let i = 0; i < rings; i++) {
        const p0 = pts[i], p1 = pts[(i + 1) % rings];
        verts.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z, top.x, top.y, top.z);
        n.copy(p0).add(p1).add(top).normalize();
        for (let k = 0; k < 3; k++) norms.push(n.x, n.y, n.z);
        const shade = 0.7 + hash(i * 11.3) * 0.5;
        for (let k = 0; k < 3; k++) cols.push(shade, shade, shade);
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(verts), 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array(norms), 3));
    g.setAttribute('color', new BufferAttribute(new Float32Array(cols), 3));
    return g;
}

interface Layer {
    mesh: InstancedMesh;
    geometry: BufferGeometry;
    material: MeshStandardMaterial;
    /** Lattice base position per instance (world XZ), pre-wrap. */
    baseX: Float32Array;
    baseZ: Float32Array;
    /** Live wrapped world position. */
    curX: Float32Array;
    curZ: Float32Array;
    rot: Float32Array;
    scale: Float32Array;
    count: number;
    /** Fraction of instances currently visible (density blend). */
    activeFraction: number;
}

export class GroundScatter {
    private readonly tufts: Layer;
    private readonly debris: Layer;
    private readonly _colA = new Color();
    private readonly _colB = new Color();
    private lastHeroX = Number.NaN;
    private lastHeroZ = Number.NaN;

    constructor(host: SceneHost, quality: string) {
        const q = SCATTER_QUALITY_SCALE[quality] ?? 1.0;
        this.tufts = this.buildLayer(
            host, 'worldTufts', buildTuftGeometry(),
            Math.round(SCATTER_TUFTS_HIGH * q), 0.55, 1.35, 1,
        );
        this.debris = this.buildLayer(
            host, 'worldDebris', buildDebrisGeometry(),
            Math.round(SCATTER_DEBRIS_HIGH * q), 0.5, 1.5, 977,
        );
    }

    private buildLayer(
        host: SceneHost, name: string, geometry: BufferGeometry,
        count: number, minScale: number, maxScale: number, seed: number,
    ): Layer {
        const material = new MeshStandardMaterial({
            name: `${name}Mat`,
            vertexColors: true,
            roughness: 0.95,
            metalness: 0.0,
            // Blades are single-quad triangles, so half of them face away from
            // the (fixed) isometric camera. Backface culling would silently
            // delete roughly half the field.
            side: DoubleSide,
        });
        const mesh = new InstancedMesh(geometry, material, count);
        mesh.name = name;
        mesh.instanceMatrix.setUsage(DynamicDrawUsage);
        // Tiny props: casting shadows would double their cost for detail nobody
        // can resolve at this on-screen size. They still RECEIVE the key light's
        // shadow, which is what actually grounds them.
        mesh.castShadow = false;
        mesh.receiveShadow = true;
        // Instances are wrapped to the hero every frame, so the bounding volume
        // three computes at construction is meaningless — culling it would pop
        // the whole layer out of view.
        mesh.frustumCulled = false;

        const baseX = new Float32Array(count);
        const baseZ = new Float32Array(count);
        const curX = new Float32Array(count);
        const curZ = new Float32Array(count);
        const rot = new Float32Array(count);
        const scale = new Float32Array(count);

        // Per-instance colour jitter. Without it thousands of identical clumps
        // read as one stamped texture rather than as ground cover; a little
        // hue/value spread is what makes a scatter field look grown.
        const tint = new Color();
        for (let i = 0; i < count; i++) {
            baseX[i] = (hash(i * 1.37 + seed) - 0.5) * SCATTER_TILE;
            baseZ[i] = (hash(i * 2.71 + seed * 3) - 0.5) * SCATTER_TILE;
            curX[i] = baseX[i];
            curZ[i] = baseZ[i];
            rot[i] = hash(i * 4.11 + seed) * Math.PI * 2;
            scale[i] = minScale + hash(i * 6.53 + seed) * (maxScale - minScale);

            const v = 0.66 + hash(i * 8.17 + seed) * 0.62;   // value spread
            const h = (hash(i * 9.43 + seed) - 0.5) * 0.10;  // slight hue drift
            tint.setRGB(v * (1 + h), v, v * (1 - h * 0.6));
            mesh.setColorAt(i, tint);
        }
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

        host.scene.add(mesh);
        const layer: Layer = {
            mesh, geometry, material, baseX, baseZ, curX, curZ, rot, scale,
            count, activeFraction: 1,
        };
        this.writeAll(layer);
        return layer;
    }

    /** Rebuild every instance matrix. Used at construction and whenever the
     *  density fraction changes enough to matter. */
    private writeAll(layer: Layer): void {
        for (let i = 0; i < layer.count; i++) this.writeInstance(layer, i);
        layer.mesh.instanceMatrix.needsUpdate = true;
    }

    private writeInstance(layer: Layer, i: number): void {
        // Density blend: instances past the active fraction collapse to zero
        // scale instead of being removed, so the count can breathe between
        // biomes without reallocating the InstancedMesh.
        const visible = (i / layer.count) < layer.activeFraction;
        const s = visible ? layer.scale[i] : 0;
        TMP_POS.set(layer.curX[i], 0, layer.curZ[i]);
        TMP_QUAT.setFromAxisAngle(UP, layer.rot[i]);
        TMP_SCALE.set(s, s, s);
        TMP_MAT.compose(TMP_POS, TMP_QUAT, TMP_SCALE);
        layer.mesh.setMatrixAt(i, TMP_MAT);
    }

    /**
     * Wrap instances that have fallen behind the hero. Returns true if any
     * matrix was rewritten, so the caller only flags the buffer when needed.
     */
    private wrapLayer(layer: Layer, heroX: number, heroZ: number): boolean {
        const half = SCATTER_TILE * 0.5;
        let dirty = false;
        for (let i = 0; i < layer.count; i++) {
            let x = layer.curX[i];
            let z = layer.curZ[i];
            let moved = false;
            // Snap by whole tiles so the instance lands back on the same lattice
            // it started on — that is what makes the recycling invisible.
            while (x - heroX > half)  { x -= SCATTER_TILE; moved = true; }
            while (heroX - x > half)  { x += SCATTER_TILE; moved = true; }
            while (z - heroZ > half)  { z -= SCATTER_TILE; moved = true; }
            while (heroZ - z > half)  { z += SCATTER_TILE; moved = true; }
            if (moved) {
                layer.curX[i] = x;
                layer.curZ[i] = z;
                this.writeInstance(layer, i);
                dirty = true;
            }
        }
        return dirty;
    }

    /** Per-frame: recycle instances and push the blended biome look. */
    public update(heroX: number, heroZ: number, a: BiomeDef, b: BiomeDef, t: number): void {
        // Density/colour blend.
        const tuftFrac = a.scatter.tuftDensity + (b.scatter.tuftDensity - a.scatter.tuftDensity) * t;
        const debrisFrac = a.scatter.debrisDensity + (b.scatter.debrisDensity - a.scatter.debrisDensity) * t;
        const tuftH = a.scatter.tuftHeight + (b.scatter.tuftHeight - a.scatter.tuftHeight) * t;

        this._colA.setRGB(a.scatter.tuft[0], a.scatter.tuft[1], a.scatter.tuft[2]);
        this._colB.setRGB(b.scatter.tuft[0], b.scatter.tuft[1], b.scatter.tuft[2]);
        this.tufts.material.color.copy(this._colA).lerp(this._colB, t);

        this._colA.setRGB(a.scatter.debris[0], a.scatter.debris[1], a.scatter.debris[2]);
        this._colB.setRGB(b.scatter.debris[0], b.scatter.debris[1], b.scatter.debris[2]);
        this.debris.material.color.copy(this._colA).lerp(this._colB, t);

        // Tuft height rides on the mesh scale so it needs no matrix rewrite.
        this.tufts.mesh.scale.set(1, tuftH, 1);

        // Density changes are rare relative to frames; only rebuild on a real step.
        if (Math.abs(tuftFrac - this.tufts.activeFraction) > 0.02) {
            this.tufts.activeFraction = tuftFrac;
            this.writeAll(this.tufts);
        }
        if (Math.abs(debrisFrac - this.debris.activeFraction) > 0.02) {
            this.debris.activeFraction = debrisFrac;
            this.writeAll(this.debris);
        }

        // Skip the wrap scan entirely while the hero is stationary.
        if (heroX === this.lastHeroX && heroZ === this.lastHeroZ) return;
        this.lastHeroX = heroX;
        this.lastHeroZ = heroZ;

        if (this.wrapLayer(this.tufts, heroX, heroZ)) {
            this.tufts.mesh.instanceMatrix.needsUpdate = true;
        }
        if (this.wrapLayer(this.debris, heroX, heroZ)) {
            this.debris.mesh.instanceMatrix.needsUpdate = true;
        }
    }

    /** Total live instances — reported in the technical-art budget. */
    public getInstanceCount(): number {
        return this.tufts.count + this.debris.count;
    }

    public dispose(): void {
        for (const l of [this.tufts, this.debris]) {
            l.mesh.removeFromParent();
            l.mesh.dispose();
            l.geometry.dispose();
            l.material.dispose();
        }
    }
}
