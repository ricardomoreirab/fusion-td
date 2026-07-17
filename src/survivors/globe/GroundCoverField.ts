import {
    BufferGeometry,
    Color,
    CylinderGeometry,
    DodecahedronGeometry,
    Float32BufferAttribute,
    IcosahedronGeometry,
    InstancedMesh,
    Matrix4,
    MeshPhongMaterial,
    Quaternion,
    SphereGeometry,
    Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { SceneHost } from '../../engine/three/SceneHost';
import { V3_UP } from '../../engine/three/math';
import { PROP_RECYCLE_DIST, GLOBE_RADIUS } from './constants';
import { curveDropAt } from './curvature';

// Scatter band: closer to the hero than the PropField tree ring so the
// midground reads as a living meadow instead of an empty green plate.
export const COVER_MIN_R = 6;
export const COVER_MAX_R = 48;

/** Recycle placement for ground cover — same forward-bias idea as
 *  PropField.computeRecycledPosition but over the cover band, so left-behind
 *  clusters respawn just past the horizon ahead of the travel direction.
 *  randAngle/randR ∈ [0,1) are injected for testability. */
export function computeCoverPosition(
    heroX: number, heroZ: number,
    dirX: number, dirZ: number,
    randAngle: number, randR: number,
): { x: number; z: number } {
    const moving = Math.hypot(dirX, dirZ) > 0.01;
    const theta = moving
        ? Math.atan2(dirZ, dirX) + (randAngle - 0.5) * ((220 * Math.PI) / 180)
        : randAngle * Math.PI * 2;
    // sqrt keeps area density uniform across the band instead of bunching
    // clusters at the inner radius.
    const r = Math.sqrt(
        COVER_MIN_R * COVER_MIN_R
        + randR * (COVER_MAX_R * COVER_MAX_R - COVER_MIN_R * COVER_MIN_R),
    );
    return { x: heroX + Math.cos(theta) * r, z: heroZ + Math.sin(theta) * r };
}

interface PaintOptions {
    /** 0..1 — how much vertices at the geometry's base darken (fake AO). */
    ao?: number;
    /** Lighten factor for up-facing verts (stump cut faces, cap tops). */
    topLight?: number;
    /** Blend the top third of the geometry toward this color (moss caps). */
    topTint?: Color;
    /** 0..1 — per-vertex value noise so hard surfaces read weathered instead
     *  of flat-colored (deterministic hash of vertex position). */
    mottle?: number;
}

/** Deterministic pseudo-noise from a vertex position — stable across runs. */
function vertexHash(x: number, y: number, z: number): number {
    const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
    return s - Math.floor(s);
}

/** Bake a per-vertex color attribute: base color, darkened toward the local
 *  bbox floor (contact AO) and optionally lightened on up-facing verts. */
function paint(geometry: BufferGeometry, base: Color, opts: PaintOptions = {}): BufferGeometry {
    const ao = opts.ao ?? 0.35;
    const topLight = opts.topLight ?? 0;
    geometry.computeBoundingBox();
    const bb = geometry.boundingBox!;
    const spanY = Math.max(bb.max.y - bb.min.y, 1e-4);
    const pos = geometry.getAttribute('position');
    const nor = geometry.getAttribute('normal');
    const colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
        const t = (pos.getY(i) - bb.min.y) / spanY;
        let f = 1 - ao * (1 - t);
        if (topLight > 0 && nor.getY(i) > 0.8) f += topLight;
        if (opts.mottle) {
            f *= 1 - opts.mottle + 2 * opts.mottle * vertexHash(pos.getX(i), pos.getY(i), pos.getZ(i));
        }
        let r = base.r, g = base.g, b = base.b;
        if (opts.topTint && t > 0.66) {
            const k = (t - 0.66) / 0.34 * 0.45;
            r += (opts.topTint.r - r) * k;
            g += (opts.topTint.g - g) * k;
            b += (opts.topTint.b - b) * k;
        }
        colors[i * 3] = Math.min(r * f, 1);
        colors[i * 3 + 1] = Math.min(g * f, 1);
        colors[i * 3 + 2] = Math.min(b * f, 1);
    }
    geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
    return geometry;
}

/** Merge painted parts into one variant geometry (base resting on y=0).
 *  Everything is normalized to non-indexed first — mergeGeometries refuses
 *  mixed indexed/non-indexed inputs (polyhedra are non-indexed, cylinders
 *  are indexed), and flat shading wants split verts anyway. */
function mergeParts(parts: BufferGeometry[]): BufferGeometry {
    const flat = parts.map(p => {
        if (!p.index) return p;
        const ni = p.toNonIndexed();
        p.dispose();
        return ni;
    });
    const merged = mergeGeometries(flat, false)!;
    for (const p of flat) p.dispose();
    merged.computeBoundingBox();
    merged.translate(0, -merged.boundingBox!.min.y, 0);
    return merged;
}

function buildFlowerCluster(headColor: Color): BufferGeometry {
    const parts: BufferGeometry[] = [];
    const stemColor = new Color(0.18, 0.3, 0.11);
    const blooms = 4;
    for (let i = 0; i < blooms; i++) {
        const a = (i / blooms) * Math.PI * 2 + i * 1.7;
        const r = i === 0 ? 0 : 0.22 + 0.16 * ((i * 37) % 10) / 10;
        const x = Math.cos(a) * r;
        const z = Math.sin(a) * r;
        const h = 0.3 + 0.12 * ((i * 53) % 10) / 10;
        const stem = new CylinderGeometry(0.014, 0.024, h, 5);
        stem.translate(x, h / 2, z);
        parts.push(paint(stem, stemColor, { ao: 0.45 }));
        const head = new IcosahedronGeometry(0.065, 0);
        head.translate(x, h + 0.04, z);
        parts.push(paint(head, headColor, { ao: 0.15 }));
    }
    return mergeParts(parts);
}

function buildTuft(): BufferGeometry {
    const parts: BufferGeometry[] = [];
    const hay = new Color(0.72, 0.6, 0.3);
    const blades = 6;
    for (let i = 0; i < blades; i++) {
        const a = (i / blades) * Math.PI * 2 + i * 0.9;
        const lean = 0.12 + 0.1 * ((i * 41) % 10) / 10;
        const h = 0.55 + 0.25 * ((i * 29) % 10) / 10;
        const blade = new CylinderGeometry(0.004, 0.028, h, 4);
        blade.translate(0, h / 2, 0);
        blade.rotateX(lean * Math.cos(a));
        blade.rotateZ(lean * Math.sin(a));
        blade.translate(Math.cos(a) * 0.05, 0, Math.sin(a) * 0.05);
        parts.push(paint(blade, hay, { ao: 0.5 }));
    }
    return mergeParts(parts);
}

function buildPebbleCluster(): BufferGeometry {
    const parts: BufferGeometry[] = [];
    const stone = new Color(0.5, 0.48, 0.44);
    const sizes = [0.16, 0.11, 0.08];
    for (let i = 0; i < sizes.length; i++) {
        const rock = new DodecahedronGeometry(sizes[i], 0);
        rock.scale(1, 0.62, 1);
        rock.rotateY(i * 2.1);
        rock.translate(
            Math.cos(i * 2.4) * (0.14 + i * 0.1),
            sizes[i] * 0.45,
            Math.sin(i * 2.4) * (0.14 + i * 0.1),
        );
        const tint = stone.clone().multiplyScalar(0.92 + 0.08 * ((i * 3) % 2));
        parts.push(paint(rock, tint, { ao: 0.5, topLight: 0.08 }));
    }
    return mergeParts(parts);
}

function buildMushroomCluster(): BufferGeometry {
    const parts: BufferGeometry[] = [];
    const stemColor = new Color(0.82, 0.76, 0.62);
    const capColor = new Color(0.68, 0.24, 0.13);
    const caps = [
        { x: 0, z: 0, s: 1 },
        { x: 0.16, z: 0.1, s: 0.65 },
    ];
    for (const c of caps) {
        const stemH = 0.13 * c.s;
        const stem = new CylinderGeometry(0.028 * c.s, 0.042 * c.s, stemH, 6);
        stem.translate(c.x, stemH / 2, c.z);
        parts.push(paint(stem, stemColor, { ao: 0.4 }));
        const cap = new SphereGeometry(0.095 * c.s, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2);
        cap.scale(1, 0.62, 1);
        cap.translate(c.x, stemH, c.z);
        parts.push(paint(cap, capColor, { ao: 0.25 }));
    }
    return mergeParts(parts);
}

function buildLog(): BufferGeometry {
    const parts: BufferGeometry[] = [];
    const bark = new Color(0.3, 0.21, 0.13);
    const trunk = new CylinderGeometry(0.13, 0.16, 1.5, 7);
    trunk.rotateZ(Math.PI / 2);
    trunk.translate(0, 0.14, 0);
    parts.push(paint(trunk, bark, { ao: 0.45, mottle: 0.12 }));
    const stub = new CylinderGeometry(0.045, 0.06, 0.3, 5);
    stub.rotateX(-0.5);
    stub.translate(0.35, 0.3, 0.06);
    parts.push(paint(stub, bark, { ao: 0.3 }));
    return mergeParts(parts);
}

function buildStump(): BufferGeometry {
    const bark = new Color(0.34, 0.24, 0.15);
    const stump = new CylinderGeometry(0.26, 0.33, 0.34, 7);
    stump.translate(0, 0.17, 0);
    return mergeParts([paint(stump, bark, { ao: 0.45, topLight: 0.5, mottle: 0.12 })]);
}

const STONE = new Color(0.4, 0.39, 0.37);
const MOSS_TINT = new Color(0.32, 0.5, 0.24);

/** Tapered 4-sided menhir (standing stone) — the landmark building block. */
function menhir(w: number, h: number): CylinderGeometry {
    const geo = new CylinderGeometry(w * 0.32, w * 0.5, h, 4);
    geo.rotateY(Math.PI / 4);
    geo.translate(0, h / 2, 0);
    return geo;
}

/** Ancient standing-stone circle: five weathered menhirs (one toppled) around
 *  a low altar slab — THE landmark silhouette that crests the horizon and
 *  gives the endless meadow a sense of place. Moss-capped via topTint. */
function buildStoneCircle(): BufferGeometry {
    const parts: BufferGeometry[] = [];
    const stones = 5;
    for (let i = 0; i < stones; i++) {
        const a = (i / stones) * Math.PI * 2 + 0.4;
        const h = 2.2 + 0.7 * ((i * 43) % 10) / 10;
        const s = menhir(0.75, h);
        s.rotateY(a);
        if (i === 3) {
            // One toppled stone sells age better than five perfect uprights.
            s.rotateZ(Math.PI / 2 - 0.12);
            s.translate(0, 0.35, 0);
        } else {
            s.rotateX(0.06 * Math.cos(a * 3));
            s.rotateZ(0.05 * Math.sin(a * 2));
        }
        s.translate(Math.cos(a) * 2.3, 0, Math.sin(a) * 2.3);
        parts.push(paint(s, STONE, { ao: 0.5, topLight: 0.1, topTint: MOSS_TINT, mottle: 0.14 }));
    }
    const altar = new CylinderGeometry(1.0, 1.15, 0.4, 6);
    altar.translate(0, 0.2, 0);
    parts.push(paint(altar, STONE.clone().multiplyScalar(0.9), { ao: 0.45, topLight: 0.25, topTint: MOSS_TINT, mottle: 0.12 }));
    return mergeParts(parts);
}

/** Broken obelisk: a leaning snapped column with its fallen tip beside it. */
function buildObelisk(): BufferGeometry {
    const parts: BufferGeometry[] = [];
    const column = menhir(1.0, 3.4);
    column.rotateZ(0.09);
    parts.push(paint(column, STONE, { ao: 0.5, topLight: 0.12, topTint: MOSS_TINT, mottle: 0.14 }));
    const tip = menhir(0.7, 1.3);
    tip.rotateZ(Math.PI / 2 - 0.2);
    tip.rotateY(0.7);
    tip.translate(1.5, 0.3, 0.5);
    parts.push(paint(tip, STONE.clone().multiplyScalar(0.94), { ao: 0.45, topTint: MOSS_TINT, mottle: 0.14 }));
    return mergeParts(parts);
}

/** Flat irregular ground patch (dirt / moss / dry grass): a triangle fan over
 *  a radius-jittered ring, vertex-colored darker toward the rim so the patch
 *  melts into the field instead of reading as a stamped disc. Breaks up the
 *  single-green ground between the grass blades. */
function buildPatch(base: Color, radius: number, seed: number): BufferGeometry {
    const segments = 11;
    const ring: [number, number][] = [];
    for (let i = 0; i < segments; i++) {
        const a = (i / segments) * Math.PI * 2;
        const jitter = 0.7 + 0.55 * (((i * 61 + seed * 37) % 10) / 10);
        ring.push([Math.cos(a) * radius * jitter, Math.sin(a) * radius * jitter]);
    }
    const positions: number[] = [];
    const normals: number[] = [];
    const colors: number[] = [];
    const uvs: number[] = [];
    const pushVert = (x: number, z: number, edge: number) => {
        positions.push(x, 0, z);
        normals.push(0, 1, 0);
        const f = 1 - 0.25 * edge;
        // RGBA vertex color: solid-ish center, fully transparent rim — the
        // patch dissolves into the field instead of ending at a hard slab
        // edge (the patch material is transparent + depthWrite:false; opaque
        // grass blades in front still win the depth test).
        colors.push(base.r * f, base.g * f, base.b * f, 0.75 * (1 - edge));
        uvs.push(0, 0);
    };
    for (let i = 0; i < segments; i++) {
        const [ax, az] = ring[i];
        const [bx, bz] = ring[(i + 1) % segments];
        pushVert(0, 0, 0);
        // Fan winding: center → next → current yields up-facing triangles
        // (counter-clockwise seen from +Y).
        pushVert(bx, bz, 1);
        pushVert(ax, az, 1);
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(positions, 3));
    geo.setAttribute('normal', new Float32BufferAttribute(normals, 3));
    geo.setAttribute('color', new Float32BufferAttribute(colors, 4));
    geo.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
    geo.computeBoundingBox();
    return geo;
}

interface CoverVariantSpec {
    geometry: BufferGeometry;
    count: number;
    minScale: number;
    maxScale: number;
    /** How far the base sinks into the ground so bases never hover. */
    embed: number;
    /** Flat ground patch: floats just above the ground (polygon-offset
     *  material, no tilt-sink) instead of embedding like a 3D prop. */
    flat?: boolean;
    /** Landmark-scale variant: casts into the key light's shadow map. */
    castShadow?: boolean;
}

interface CoverInstance {
    x: number;
    z: number;
    yaw: number;
    scale: number;
}

// Scratch objects for the per-frame matrix rebuild (no per-frame allocations).
const _pos = new Vector3();
const _scale = new Vector3();
const _tiltAxis = new Vector3();
const _tiltQ = new Quaternion();
const _yawQ = new Quaternion();
const _mat = new Matrix4();

/**
 * Instanced meadow dressing between the hero and the PropField tree ring:
 * wildflower clusters (3 hues), dry seed-head tufts, pebbles, mushrooms,
 * fallen logs and stumps. One merged vertex-colored geometry + one
 * InstancedMesh per variant (8 draw calls total), all sharing a single
 * flat-shaded Phong material. Pure decoration — nothing here collides.
 *
 * Instances follow the same rolling-globe contract as PropField: recycled
 * ahead of the travel direction once left behind, tilted to the globe
 * tangent, and sunk by the render-only curvature drop each frame.
 */
export class GroundCoverField {
    private meshes: InstancedMesh[] = [];
    private geometries: BufferGeometry[] = [];
    private instances: CoverInstance[][] = [];
    private embeds: number[] = [];
    private flats: boolean[] = [];
    private readonly material: MeshPhongMaterial;
    private readonly patchMaterial: MeshPhongMaterial;

    constructor(host: SceneHost) {
        this.material = new MeshPhongMaterial({
            name: 'groundCover',
            vertexColors: true,
            flatShading: true,
            shininess: 4,
        });
        // Patches sit a hair above the curved ground cap (the 0.04 lift in
        // updateMatrices). NO polygon offset: pulling patches forward in depth
        // made them clip grass-blade bases into ugly striped smears — with
        // plain depth the blades draw naturally over the patch.
        this.patchMaterial = new MeshPhongMaterial({
            name: 'groundCoverPatch',
            vertexColors: true, // RGBA attribute — alpha fades the rim to zero
            transparent: true,
            depthWrite: false,
            flatShading: true,
            shininess: 2,
        });

        // Scales are tuned against the ~1-unit-tall grass blades: cover must
        // crest the grass to read at gameplay camera distance, so everything
        // sits 2-3× its "real" size.
        const variants: CoverVariantSpec[] = [
            { geometry: buildFlowerCluster(new Color(0.95, 0.93, 0.85)), count: 34, minScale: 1.9, maxScale: 2.9, embed: 0.06 },
            { geometry: buildFlowerCluster(new Color(1.0, 0.78, 0.22)), count: 34, minScale: 1.9, maxScale: 2.9, embed: 0.06 },
            { geometry: buildFlowerCluster(new Color(0.72, 0.5, 0.92)), count: 26, minScale: 1.8, maxScale: 2.7, embed: 0.06 },
            { geometry: buildTuft(), count: 56, minScale: 2.1, maxScale: 3.3, embed: 0.08 },
            { geometry: buildPebbleCluster(), count: 22, minScale: 1.7, maxScale: 3.0, embed: 0.12 },
            { geometry: buildMushroomCluster(), count: 14, minScale: 1.9, maxScale: 2.8, embed: 0.04 },
            { geometry: buildLog(), count: 5, minScale: 1.8, maxScale: 2.4, embed: 0.12 },
            { geometry: buildStump(), count: 5, minScale: 1.6, maxScale: 2.2, embed: 0.1 },
            // Ground-variation decals: bare dirt, moss shade, sun-dried grass.
            // Colors run dark/earthy — the warm key + hemi lift flat up-facing
            // normals hard, so brighter values read salmon instead of soil.
            { geometry: buildPatch(new Color(0.3, 0.23, 0.13), 2.0, 1), count: 10, minScale: 1.0, maxScale: 2.0, embed: 0, flat: true },
            { geometry: buildPatch(new Color(0.22, 0.32, 0.12), 1.7, 2), count: 14, minScale: 1.0, maxScale: 2.2, embed: 0, flat: true },
            { geometry: buildPatch(new Color(0.44, 0.38, 0.18), 1.9, 3), count: 10, minScale: 1.0, maxScale: 2.0, embed: 0, flat: true },
            // Landmarks: rare, big, shadow-casting — give the endless field
            // recognizable places without breaking the rolling-globe recycle.
            { geometry: buildStoneCircle(), count: 1, minScale: 1.6, maxScale: 2.0, embed: 0.15, castShadow: true },
            { geometry: buildObelisk(), count: 2, minScale: 1.5, maxScale: 2.1, embed: 0.15, castShadow: true },
        ];

        for (const v of variants) {
            const mesh = new InstancedMesh(v.geometry, v.flat ? this.patchMaterial : this.material, v.count);
            mesh.name = 'groundCover';
            if (v.castShadow) mesh.castShadow = true;
            // The band always surrounds the camera target; skipping culling
            // avoids per-frame instanced-bounds recomputes.
            mesh.frustumCulled = false;
            const list: CoverInstance[] = [];
            for (let i = 0; i < v.count; i++) {
                const theta = Math.random() * Math.PI * 2;
                const r = Math.sqrt(
                    COVER_MIN_R * COVER_MIN_R
                    + Math.random() * (COVER_MAX_R * COVER_MAX_R - COVER_MIN_R * COVER_MIN_R),
                );
                list.push({
                    x: Math.cos(theta) * r,
                    z: Math.sin(theta) * r,
                    yaw: Math.random() * Math.PI * 2,
                    scale: v.minScale + Math.random() * (v.maxScale - v.minScale),
                });
            }
            this.geometries.push(v.geometry);
            this.instances.push(list);
            this.meshes.push(mesh);
            host.scene.add(mesh);
        }
        this.embeds = variants.map(v => v.embed);
        this.flats = variants.map(v => !!v.flat);
        this.updateMatrices(0, 0);
    }

    /** Per-frame: recycle left-behind clusters ahead of the hero, then rebuild
     *  every instance matrix with the globe tilt + curvature drop. */
    public update(heroX: number, heroZ: number, dirX: number, dirZ: number): void {
        for (let v = 0; v < this.meshes.length; v++) {
            for (const inst of this.instances[v]) {
                const dx = inst.x - heroX;
                const dz = inst.z - heroZ;
                if (dx * dx + dz * dz > PROP_RECYCLE_DIST * PROP_RECYCLE_DIST) {
                    const np = computeCoverPosition(heroX, heroZ, dirX, dirZ, Math.random(), Math.random());
                    inst.x = np.x;
                    inst.z = np.z;
                    inst.yaw = Math.random() * Math.PI * 2;
                }
            }
        }
        this.updateMatrices(heroX, heroZ);
    }

    private updateMatrices(heroX: number, heroZ: number): void {
        for (let v = 0; v < this.meshes.length; v++) {
            const mesh = this.meshes[v];
            const list = this.instances[v];
            for (let i = 0; i < list.length; i++) {
                const inst = list[i];
                const dx = inst.x - heroX;
                const dz = inst.z - heroZ;
                const d = Math.hypot(dx, dz);
                let tilt = 0;
                _yawQ.setFromAxisAngle(V3_UP as Vector3, inst.yaw);
                if (d > 1e-3) {
                    // Same lean-away-from-the-hero tangent tilt as PropField —
                    // cover must roll over the curve with the trees.
                    tilt = Math.atan(d / GLOBE_RADIUS);
                    _tiltAxis.set(dz / d, 0, -dx / d);
                    _tiltQ.setFromAxisAngle(_tiltAxis, tilt);
                    _tiltQ.multiply(_yawQ);
                } else {
                    _tiltQ.copy(_yawQ);
                }
                _pos.set(
                    inst.x,
                    (this.flats[v]
                        ? 0.04 // flat decal: hover above the cap, no tilt-sink
                        : -this.embeds[v] * inst.scale - Math.sin(tilt) * 0.25)
                        - curveDropAt(inst.x, inst.z),
                    inst.z,
                );
                _scale.setScalar(inst.scale);
                _mat.compose(_pos, _tiltQ, _scale);
                mesh.setMatrixAt(i, _mat);
            }
            mesh.instanceMatrix.needsUpdate = true;
        }
    }

    public dispose(): void {
        for (const mesh of this.meshes) {
            mesh.removeFromParent();
            mesh.dispose();
        }
        this.meshes = [];
        for (const geo of this.geometries) geo.dispose();
        this.geometries = [];
        this.instances = [];
        this.material.dispose();
        this.patchMaterial.dispose();
    }
}
