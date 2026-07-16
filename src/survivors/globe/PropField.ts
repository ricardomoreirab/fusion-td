import { BufferGeometry, Material, Mesh, Quaternion, Vector3 } from 'three';
import type { SceneHost } from '../../engine/three/SceneHost';
import { loadContainer } from '../../engine/three/assets';
import { V3_UP } from '../../engine/three/math';
import { PROP_RECYCLE_DIST, GLOBE_RADIUS } from './constants';
import { curveDropAt } from './curvature';

// Tight band just around the horizon: recycled trees crest into view quickly
// instead of waiting 20+ units below the curve — keeps the forward view wooded.
export const PROP_MIN_R = 38;
export const PROP_MAX_R = 58;

const PACK_URL = 'assets/low_poly_forest_tree_pack.glb';
/** Tallest background tree is normalised to this world height; everything else
 *  in the pack keeps its authored proportions relative to it (ferns/shrubs stay
 *  small, rocks stay rock-sized). */
const TALLEST_TREE_HEIGHT = 11; // ~5× hero height — proper forest scale
/** Bases sink this far into the ground so trunks/rocks sit IN the grass, not
 *  on it — plus extra with tilt (see update) so the up-slope base edge never
 *  hangs in the air ("floating" look). */
const PROP_EMBED = 0.45;
/** Atlas meshes shorter than this fraction of the tallest tree are ground
 *  cover (ferns/shrubs) — placed in multiples, allowed closer to the hero. */
const GROUND_COVER_FRACTION = 0.3;

/** Pure recycle placement: random ring position PROP_MIN_R..PROP_MAX_R from the
 *  hero. If the hero is moving, bias the angle to ±110° around the travel
 *  direction so props roll in over the horizon ahead; stationary → any angle.
 *  randAngle/randR ∈ [0,1) are injected for testability. */
export function computeRecycledPosition(
    heroX: number, heroZ: number,
    dirX: number, dirZ: number,
    randAngle: number, randR: number,
): { x: number; z: number } {
    const moving = Math.hypot(dirX, dirZ) > 0.01;
    const theta = moving
        ? Math.atan2(dirZ, dirX) + (randAngle - 0.5) * ((220 * Math.PI) / 180)
        : randAngle * Math.PI * 2;
    const r = PROP_MIN_R + randR * (PROP_MAX_R - PROP_MIN_R);
    return { x: heroX + Math.cos(theta) * r, z: heroZ + Math.sin(theta) * r };
}

/** One source part of a variant: a baked (identity-transform) geometry clone
 *  plus the pack's SHARED material — instances never clone materials. */
interface PropSource {
    name: string;
    geometry: BufferGeometry;
    material: Material | Material[];
}

interface PropVariant {
    /** Source parts (transform baked to identity). Multi-part variants
     *  (high-poly trunk + branches) build a mesh per part, parented to part 0. */
    sources: PropSource[];
    /** Uniform scale applied to instances of this variant. */
    scale: number;
    /** Ground offset so the variant's bounding-box floor sits on y=0. */
    baseY: number;
    /** How many copies of this variant to scatter around the map. */
    copies: number;
}

interface PlacedProp {
    root: Mesh;
    baseY: number;
    /** Random yaw assigned at placement/recycle; combined per-frame with the
     *  globe-tangent tilt into root.quaternion. */
    yaw: number;
}

// Scratch objects for the per-frame tilt math (no per-frame allocations).
const _tiltAxis = new Vector3();
const _tiltQ = new Quaternion();
const _yawQ = new Quaternion();

/**
 * Pool of forest props from the low_poly_forest_tree_pack GLB (12 unique
 * trees + ferns/shrubs, 9 rocks, 4 high-poly trunk+branch trees). Every
 * variant in the pack is placed exactly once around the hero; props that
 * fall behind silently recycle to a fresh spot beyond the horizon — the
 * motion cue that sells the rotating-globe illusion.
 *
 * The GLB loads async; until it resolves update() is a no-op and the field
 * is simply empty. Instances are plain Meshes sharing the baked geometry
 * clones + the pack's SOURCE materials (no per-instance clones, no
 * material-cache involvement). dispose() removes instances, then frees the
 * baked geometry clones; the cached container keeps the pack's source
 * meshes/materials/textures.
 */
export class PropField {
    private props: PlacedProp[] = [];
    private bakedGeometries: BufferGeometry[] = [];
    private disposed = false;

    constructor(host: SceneHost) {
        void this.load(host);
    }

    private async load(host: SceneHost): Promise<void> {
        let packRoot;
        try {
            packRoot = (await loadContainer(PACK_URL)).gltf.scene;
        } catch (err) {
            console.error('[globe] forest pack failed to load — prop field stays empty:', err);
            return;
        }
        if (this.disposed) return;

        // ── Bake every leaf mesh to identity ─────────────────────────────────
        // The Sketchfab FBX wraps everything in transform nodes (unit scale,
        // axis rotation). Baking each mesh's WORLD matrix into a private
        // geometry clone folds the whole ancestor chain away, so instances
        // need no parent bookkeeping at all. (Clones, not the sources — the
        // source geometries are shared with the module-level container cache
        // and must survive for the next run.)
        packRoot.updateMatrixWorld(true);
        const leaves: PropSource[] = [];
        packRoot.traverse(node => {
            const m = node as Mesh;
            if (!m.isMesh || (m.geometry.getAttribute('position')?.count ?? 0) === 0) return;
            const geometry = m.geometry.clone();
            geometry.applyMatrix4(m.matrixWorld);
            geometry.computeBoundingBox();
            leaves.push({ name: m.name, geometry, material: m.material });
        });
        this.bakedGeometries = leaves.map(l => l.geometry);

        // ── Re-center each variant's geometry on its own base ───────────────
        // The pack authors every element at an offset from the pack origin, so
        // a baked mesh's pivot is NOT under the tree. Tilting around that
        // displaced pivot levers the whole prop into the air (the "floating"
        // bug). Translate each variant group so the pivot sits at the centre
        // of its base (bbox centre-x/z, floor-y) — done per GROUP so the
        // high-poly trunk+branch pairs stay aligned (see grouping below).

        // ── Group leaves into variants ───────────────────────────────────────
        const atlas = leaves.filter(l => l.name.startsWith('Background_Tree_Atlas'));
        const rocks = leaves.filter(l => l.name.startsWith('Rocks'));
        // High-poly trees: pair Tree_Trunk_XX[.nnn] with Tree_Branches_XX[.nnn]
        // by their shared suffix (e.g. "01.002" → trunk 01.002 + branches 01.002).
        const suffixOf = (name: string, prefix: string) =>
            name.replace(prefix, '').split('_')[0]; // "Tree_Trunk_01.002_..." → "01.002"
        const trunks = leaves.filter(l => l.name.startsWith('Tree_Trunk_'));
        const branches = leaves.filter(l => l.name.startsWith('Tree_Branches_'));
        const hiPoly: PropSource[][] = trunks.map(t => {
            const suffix = suffixOf(t.name, 'Tree_Trunk_');
            const match = branches.filter(b => suffixOf(b.name, 'Tree_Branches_') === suffix);
            return [t, ...match];
        });

        const heightOf = (ls: PropSource[]) => Math.max(...ls.map(l => {
            const bb = l.geometry.boundingBox!;
            return bb.max.y - bb.min.y;
        }));

        /** Translate a variant group so its combined bbox base-centre lands on
         *  the origin (pivot under the trunk). Same offset for every part. */
        const recenter = (ls: PropSource[]): void => {
            let minX = Infinity, maxX = -Infinity, minY = Infinity, minZ = Infinity, maxZ = -Infinity;
            for (const l of ls) {
                const bb = l.geometry.boundingBox!;
                minX = Math.min(minX, bb.min.x); maxX = Math.max(maxX, bb.max.x);
                minZ = Math.min(minZ, bb.min.z); maxZ = Math.max(maxZ, bb.max.z);
                minY = Math.min(minY, bb.min.y);
            }
            for (const l of ls) {
                l.geometry.translate(-(minX + maxX) / 2, -minY, -(minZ + maxZ) / 2);
                l.geometry.computeBoundingBox();
            }
        };

        // One shared factor keeps the pack's authored proportions: the tallest
        // background tree becomes TALLEST_TREE_HEIGHT, ferns/rocks stay relative.
        const packScale = TALLEST_TREE_HEIGHT / Math.max(heightOf(atlas), 0.001);

        // Pivot under every variant's base, then scatter in force — full
        // forest ambiance: tall trees ×3, ground cover ×4, rocks ×3,
        // high-poly trees ×2.
        const groups: PropSource[][] = [...atlas.map(l => [l]), ...rocks.map(l => [l]), ...hiPoly];
        for (const g of groups) recenter(g);

        const coverCutoff = TALLEST_TREE_HEIGHT * GROUND_COVER_FRACTION;
        const variants: PropVariant[] = [
            ...atlas.map(l => {
                const h = heightOf([l]) * packScale;
                return { sources: [l], scale: packScale, baseY: 0,
                         copies: h < coverCutoff ? 4 : 3 };
            }),
            ...rocks.map(l => ({ sources: [l], scale: packScale, baseY: 0, copies: 3 })),
            ...hiPoly.map(ls => ({ sources: ls, scale: packScale, baseY: 0, copies: 2 })),
        ];

        // ── Scatter all copies around the start area ─────────────────────────
        for (let i = 0; i < variants.length; i++) {
            const v = variants[i];
            for (let c = 0; c < v.copies; c++) {
                const jitter = 0.85 + Math.random() * 0.4;
                const parts = v.sources.map((src, p) => {
                    const part = new Mesh(src.geometry, src.material);
                    part.name = `globeProp_${i}_${c}_${p}`;
                    return part;
                });
                const root = parts[0];
                for (let p = 1; p < parts.length; p++) root.add(parts[p]);
                host.scene.add(root);
                root.scale.setScalar(v.scale * jitter);
                const theta = Math.random() * Math.PI * 2;
                const r = 12 + Math.random() * (PROP_MAX_R - 12);
                const baseY = v.baseY * jitter;
                root.position.set(Math.cos(theta) * r, baseY, Math.sin(theta) * r);
                this.props.push({ root, baseY, yaw: Math.random() * Math.PI * 2 });
            }
        }
    }

    /** Per-frame: recycle left-behind props ahead of the hero + apply the
     *  render-only curvature drop. dirX/dirZ = hero travel direction (any
     *  magnitude; ~zero means stationary → full-circle recycle). */
    public update(heroX: number, heroZ: number, dirX: number, dirZ: number): void {
        for (const p of this.props) {
            let dx = p.root.position.x - heroX;
            let dz = p.root.position.z - heroZ;
            if (dx * dx + dz * dz > PROP_RECYCLE_DIST * PROP_RECYCLE_DIST) {
                const np = computeRecycledPosition(heroX, heroZ, dirX, dirZ, Math.random(), Math.random());
                p.root.position.x = np.x;
                p.root.position.z = np.z;
                p.yaw = Math.random() * Math.PI * 2;
                dx = np.x - heroX;
                dz = np.z - heroZ;
            }
            // Plant the prop perpendicular to the curved surface: lean it AWAY
            // from the hero by the globe tangent angle atan(d/R). Without this,
            // props stay bolt-vertical while the surface tilts (~30° at the
            // horizon) and read as "rising out of the ground" when approached
            // instead of rotating over the curve.
            const d = Math.hypot(dx, dz);
            let tilt = 0;
            if (d > 1e-3) {
                tilt = Math.atan(d / GLOBE_RADIUS);
                _tiltAxis.set(dz / d, 0, -dx / d); // up × radial → lean-away axis
                _tiltQ.setFromAxisAngle(_tiltAxis, tilt);
                _yawQ.setFromAxisAngle(V3_UP as Vector3, p.yaw);
                p.root.quaternion.copy(_tiltQ).multiply(_yawQ);
            }

            // Embed the base in the ground — a flat constant plus extra with
            // tilt, so the up-slope edge of a leaning base never hangs in the
            // air ("floating" look).
            p.root.position.y = p.baseY - PROP_EMBED - Math.sin(tilt) * 0.8
                - curveDropAt(p.root.position.x, p.root.position.z);
        }
    }

    public dispose(): void {
        this.disposed = true;
        // Instances first (they reference the baked geometries), then the
        // baked geometry clones. Materials stay — they belong to the cached
        // GLB container.
        for (const p of this.props) p.root.removeFromParent();
        this.props = [];
        for (const geo of this.bakedGeometries) geo.dispose();
        this.bakedGeometries = [];
    }
}
