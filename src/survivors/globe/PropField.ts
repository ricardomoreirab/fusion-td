import { Scene, Mesh, InstancedMesh, AssetContainer, LoadAssetContainerAsync, Quaternion, Vector3, Matrix } from '@babylonjs/core';
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

interface PropVariant {
    /** Hidden source meshes (transform baked to identity). Multi-mesh variants
     *  (high-poly trunk + branches) instance every part, parented to part 0. */
    sources: Mesh[];
    /** Uniform scale applied to instances of this variant. */
    scale: number;
    /** Ground offset so the variant's bounding-box floor sits on y=0. */
    baseY: number;
    /** How many copies of this variant to scatter around the map. */
    copies: number;
}

interface PlacedProp {
    root: InstancedMesh;
    baseY: number;
    /** Random yaw assigned at placement/recycle; combined per-frame with the
     *  globe-tangent tilt into root.rotationQuaternion. */
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
 * is simply empty. Sources are hidden, transform-baked to identity, and
 * instanced (shared materials — no per-instance clones, no material-cache
 * involvement). dispose() removes instances first, then the container
 * (which owns the pack's meshes/materials/textures).
 */
export class PropField {
    private props: PlacedProp[] = [];
    private container: AssetContainer | null = null;
    private disposed = false;

    constructor(scene: Scene) {
        void this.load(scene);
    }

    private async load(scene: Scene): Promise<void> {
        let container: AssetContainer;
        try {
            container = await LoadAssetContainerAsync(PACK_URL, scene);
        } catch (err) {
            console.error('[globe] forest pack failed to load — prop field stays empty:', err);
            return;
        }
        if (this.disposed) { container.dispose(); return; }
        this.container = container;
        container.addAllToScene();

        // ── Bake every leaf mesh to identity ─────────────────────────────────
        // The Sketchfab FBX wraps everything in transform nodes (unit scale,
        // axis rotation). setParent(null) folds the ancestor chain into the
        // node transform; baking folds that into the vertices, so instances
        // need no parent bookkeeping at all.
        const leaves: Mesh[] = [];
        for (const m of container.meshes) {
            if (!(m instanceof Mesh) || m.getTotalVertices() === 0) continue;
            m.setParent(null);
            m.computeWorldMatrix(true);
            m.bakeCurrentTransformIntoVertices();
            m.refreshBoundingInfo();
            m.isVisible = false;
            m.isPickable = false;
            leaves.push(m);
        }

        // ── Re-center each variant's geometry on its own base ───────────────
        // The pack authors every element at an offset from the pack origin, so
        // a baked mesh's pivot is NOT under the tree. Tilting around that
        // displaced pivot levers the whole prop into the air (the "floating"
        // bug). Translate each variant group so the pivot sits at the centre
        // of its base (bbox centre-x/z, floor-y) — done per GROUP so the
        // high-poly trunk+branch pairs stay aligned (see grouping below).

        // ── Group leaves into variants ───────────────────────────────────────
        const atlas = leaves.filter(m => m.name.startsWith('Background_Tree_Atlas'));
        const rocks = leaves.filter(m => m.name.startsWith('Rocks'));
        // High-poly trees: pair Tree_Trunk_XX[.nnn] with Tree_Branches_XX[.nnn]
        // by their shared suffix (e.g. "01.002" → trunk 01.002 + branches 01.002).
        const suffixOf = (name: string, prefix: string) =>
            name.replace(prefix, '').split('_')[0]; // "Tree_Trunk_01.002_..." → "01.002"
        const trunks = leaves.filter(m => m.name.startsWith('Tree_Trunk_'));
        const branches = leaves.filter(m => m.name.startsWith('Tree_Branches_'));
        const hiPoly: Mesh[][] = trunks.map(t => {
            const suffix = suffixOf(t.name, 'Tree_Trunk_');
            const match = branches.filter(b => suffixOf(b.name, 'Tree_Branches_') === suffix);
            return [t, ...match];
        });

        const heightOf = (ms: Mesh[]) => Math.max(...ms.map(m => {
            const bb = m.getBoundingInfo().boundingBox;
            return bb.maximum.y - bb.minimum.y;
        }));

        /** Translate a variant group so its combined bbox base-centre lands on
         *  the origin (pivot under the trunk). Same offset for every part. */
        const recenter = (ms: Mesh[]): void => {
            let minX = Infinity, maxX = -Infinity, minY = Infinity, minZ = Infinity, maxZ = -Infinity;
            for (const m of ms) {
                const bb = m.getBoundingInfo().boundingBox;
                minX = Math.min(minX, bb.minimum.x); maxX = Math.max(maxX, bb.maximum.x);
                minZ = Math.min(minZ, bb.minimum.z); maxZ = Math.max(maxZ, bb.maximum.z);
                minY = Math.min(minY, bb.minimum.y);
            }
            const t = Matrix.Translation(-(minX + maxX) / 2, -minY, -(minZ + maxZ) / 2);
            for (const m of ms) {
                m.bakeTransformIntoVertices(t);
                m.refreshBoundingInfo();
            }
        };

        // One shared factor keeps the pack's authored proportions: the tallest
        // background tree becomes TALLEST_TREE_HEIGHT, ferns/rocks stay relative.
        const packScale = TALLEST_TREE_HEIGHT / Math.max(heightOf(atlas), 0.001);

        // Pivot under every variant's base, then scatter in force — full
        // forest ambiance: tall trees ×3, ground cover ×4, rocks ×3,
        // high-poly trees ×2.
        const groups: Mesh[][] = [...atlas.map(m => [m]), ...rocks.map(m => [m]), ...hiPoly];
        for (const g of groups) recenter(g);

        const coverCutoff = TALLEST_TREE_HEIGHT * GROUND_COVER_FRACTION;
        const variants: PropVariant[] = [
            ...atlas.map(m => {
                const h = heightOf([m]) * packScale;
                return { sources: [m], scale: packScale, baseY: 0,
                         copies: h < coverCutoff ? 4 : 3 };
            }),
            ...rocks.map(m => ({ sources: [m], scale: packScale, baseY: 0, copies: 3 })),
            ...hiPoly.map(ms => ({ sources: ms, scale: packScale, baseY: 0, copies: 2 })),
        ];

        // ── Scatter all copies around the start area ─────────────────────────
        for (let i = 0; i < variants.length; i++) {
            const v = variants[i];
            for (let c = 0; c < v.copies; c++) {
                const jitter = 0.85 + Math.random() * 0.4;
                const parts = v.sources.map((src, p) =>
                    src.createInstance(`globeProp_${i}_${c}_${p}`));
                const root = parts[0];
                for (let p = 1; p < parts.length; p++) parts[p].parent = root;
                for (const part of parts) part.isPickable = false;
                root.scaling.setAll(v.scale * jitter);
                const theta = Math.random() * Math.PI * 2;
                const r = 12 + Math.random() * (PROP_MAX_R - 12);
                const baseY = v.baseY * jitter;
                root.position.set(Math.cos(theta) * r, baseY, Math.sin(theta) * r);
                root.rotationQuaternion = Quaternion.Identity(); // driven by update()
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
            if (d > 1e-3 && p.root.rotationQuaternion) {
                tilt = Math.atan(d / GLOBE_RADIUS);
                _tiltAxis.set(dz / d, 0, -dx / d); // up × radial → lean-away axis
                Quaternion.RotationAxisToRef(_tiltAxis, tilt, _tiltQ);
                Quaternion.RotationYawPitchRollToRef(p.yaw, 0, 0, _yawQ);
                _tiltQ.multiplyToRef(_yawQ, p.root.rotationQuaternion);
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
        // Instances first (they reference container-owned sources), then the
        // container, which owns the pack's meshes, materials and textures.
        for (const p of this.props) {
            for (const child of p.root.getChildMeshes()) child.dispose();
            p.root.dispose();
        }
        this.props = [];
        this.container?.dispose();
        this.container = null;
    }
}
