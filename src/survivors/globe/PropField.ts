import { Scene, Mesh, MeshBuilder, StandardMaterial } from '@babylonjs/core';
import { getCachedMaterial } from '../../engine/rendering/MaterialCache';
import { makeFlatShaded } from '../../engine/rendering/LowPolyMaterial';
import { PROP_RECYCLE_DIST } from './constants';
import { curveDropAt } from './curvature';

export const PROP_MIN_R = 45; // just past the spawn ring / horizon
export const PROP_MAX_R = 65;
const PROP_COUNT = 18;

/** Pure recycle placement: random ring position PROP_MIN_R..PROP_MAX_R from the
 *  hero. If the hero is moving, bias the angle to ±110° around the travel
 *  direction so trees roll in over the horizon ahead; stationary → any angle.
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

/**
 * Pool of detailed low-poly trees that drift past as the hero runs and
 * silently recycle to a fresh spot beyond the horizon once left behind —
 * the motion cue that sells the rotating-globe illusion.
 *
 * Three species (pine / oak / autumn birch), each a trunk root mesh with
 * branches + flat-shaded canopy parts parented to it, so moving/rotating
 * the root carries the whole tree and the render-only curvature drop
 * applies once at the root. Canopies use TWO leaf tones per species
 * (lit top lobes + a dark under-canopy) for depth. Non-colliding
 * decoration: no pathing impact. Materials come from the bounded-key
 * material cache (8 keys, never per-instance) and are freed by exit()'s
 * clearMaterialCache().
 */
export class PropField {
    private props: { mesh: Mesh; baseY: number }[] = [];

    constructor(scene: Scene) {
        const mat = (key: string, r: number, g: number, b: number): StandardMaterial =>
            getCachedMaterial(scene, key, m => {
                m.diffuseColor.set(r, g, b);
                m.specularColor.set(0, 0, 0);
            });
        const trunkMat = () => mat('globeTreeTrunk', 0.36, 0.25, 0.16);

        /** Faceted canopy lobe: icosahedron, flat-shaded so every face catches
         *  the key light separately — the chunky "3D" low-poly read. */
        const lobe = (name: string, diameter: number, material: StandardMaterial, parent: Mesh,
                      x: number, y: number, z: number, yRot: number): void => {
            const blob = MeshBuilder.CreatePolyhedron(name, { type: 3, size: diameter / 2 }, scene);
            makeFlatShaded(blob);
            blob.material = material;
            blob.parent = parent;
            blob.position.set(x, y, z);
            blob.rotation.y = yRot;
            // Slight squash so canopies read as foliage masses, not balls.
            blob.scaling.set(1, 0.85, 1);
            blob.isPickable = false;
        };

        /** Short tilted branch cylinder poking from the trunk into the canopy. */
        const branch = (name: string, parent: Mesh, y: number, yRot: number, tilt: number, len: number): void => {
            const b = MeshBuilder.CreateCylinder(name,
                { height: len, diameterBottom: 0.16, diameterTop: 0.07, tessellation: 5 }, scene);
            b.material = trunkMat();
            b.parent = parent;
            b.position.y = y;
            b.rotation.set(0, yRot, tilt);
            // Shift outward along the tilt so the branch base meets the trunk.
            b.position.x = Math.sin(tilt) * len * 0.5 * Math.cos(yRot);
            b.position.z = -Math.sin(tilt) * len * 0.5 * Math.sin(yRot);
            b.isPickable = false;
        };

        /** Root flare: a stubby wider ring at the trunk base. */
        const rootFlare = (name: string, parent: Mesh, trunkH: number, dia: number): void => {
            const f = MeshBuilder.CreateCylinder(name,
                { height: 0.35, diameterBottom: dia, diameterTop: dia * 0.55, tessellation: 7 }, scene);
            makeFlatShaded(f);
            f.material = trunkMat();
            f.parent = parent;
            f.position.y = -trunkH / 2 + 0.17;
            f.isPickable = false;
        };

        const makers: ((i: number) => { mesh: Mesh; baseY: number })[] = [
            (i) => { // pine — tall trunk, root flare, 4 stacked flat-shaded cones
                const trunkH = 2.4;
                const trunk = MeshBuilder.CreateCylinder(`globeProp_pine_${i}`,
                    { height: trunkH, diameterBottom: 0.55, diameterTop: 0.3, tessellation: 7 }, scene);
                makeFlatShaded(trunk);
                trunk.material = trunkMat();
                rootFlare(`globeProp_pine_${i}_root`, trunk, trunkH, 1.0);
                const leaf = mat('globeTreeLeafPine', 0.10, 0.32, 0.14);
                const leafDark = mat('globeTreeLeafPineDark', 0.06, 0.22, 0.10);
                // Four canopy tiers; the lowest uses the dark tone (under-canopy shadow).
                const tiers: [number, number, number, StandardMaterial][] = [ // [dia, height, yCentre, mat]
                    [3.8, 2.0, trunkH / 2 + 0.5, leafDark],
                    [3.1, 2.0, trunkH / 2 + 1.5, leaf],
                    [2.3, 1.8, trunkH / 2 + 2.6, leaf],
                    [1.4, 1.6, trunkH / 2 + 3.6, leaf],
                ];
                for (let t = 0; t < tiers.length; t++) {
                    const [d, h, y, m] = tiers[t];
                    const cone = MeshBuilder.CreateCylinder(`globeProp_pine_${i}_c${t}`,
                        { height: h, diameterBottom: d, diameterTop: 0.05, tessellation: 7 }, scene);
                    makeFlatShaded(cone);
                    cone.material = m;
                    cone.parent = trunk;
                    cone.position.y = y;
                    cone.rotation.y = t * 0.45; // de-align tier facets
                    cone.isPickable = false;
                }
                return { mesh: trunk, baseY: trunkH / 2 };
            },
            (i) => { // oak — stout trunk, root flare, 3 branches, 6-lobe two-tone canopy
                const trunkH = 2.0;
                const trunk = MeshBuilder.CreateCylinder(`globeProp_oak_${i}`,
                    { height: trunkH, diameterBottom: 0.75, diameterTop: 0.42, tessellation: 7 }, scene);
                makeFlatShaded(trunk);
                trunk.material = trunkMat();
                rootFlare(`globeProp_oak_${i}_root`, trunk, trunkH, 1.25);
                branch(`globeProp_oak_${i}_b0`, trunk, trunkH / 2 - 0.3, 0.4, 0.7, 1.5);
                branch(`globeProp_oak_${i}_b1`, trunk, trunkH / 2 - 0.5, 2.5, -0.6, 1.3);
                branch(`globeProp_oak_${i}_b2`, trunk, trunkH / 2 - 0.1, 4.4, 0.55, 1.2);
                const leaf = mat('globeTreeLeafOak', 0.22, 0.45, 0.16);
                const leafDark = mat('globeTreeLeafOakDark', 0.13, 0.30, 0.10);
                // Dark under-canopy lobes first, lit lobes on top.
                lobe(`globeProp_oak_${i}_u0`, 2.4, leafDark, trunk,  0.5, trunkH / 2 + 0.7,  0.4, 0.3);
                lobe(`globeProp_oak_${i}_u1`, 2.2, leafDark, trunk, -0.7, trunkH / 2 + 0.8, -0.3, 1.1);
                lobe(`globeProp_oak_${i}_l0`, 2.8, leaf, trunk,  0.0, trunkH / 2 + 1.6,  0.0, 0.0);
                lobe(`globeProp_oak_${i}_l1`, 1.9, leaf, trunk,  1.1, trunkH / 2 + 1.2,  0.4, 0.7);
                lobe(`globeProp_oak_${i}_l2`, 1.8, leaf, trunk, -1.0, trunkH / 2 + 1.3, -0.5, 1.4);
                lobe(`globeProp_oak_${i}_l3`, 1.6, leaf, trunk,  0.1, trunkH / 2 + 2.5, -0.2, 2.1);
                return { mesh: trunk, baseY: trunkH / 2 };
            },
            (i) => { // autumn birch — slim pale trunk, 2 branches, amber two-tone lobes
                const trunkH = 2.8;
                const trunk = MeshBuilder.CreateCylinder(`globeProp_birch_${i}`,
                    { height: trunkH, diameterBottom: 0.4, diameterTop: 0.2, tessellation: 6 }, scene);
                makeFlatShaded(trunk);
                trunk.material = mat('globeTreeTrunkBirch', 0.72, 0.70, 0.62);
                branch(`globeProp_birch_${i}_b0`, trunk, trunkH / 2 - 0.6, 1.0, 0.65, 1.1);
                branch(`globeProp_birch_${i}_b1`, trunk, trunkH / 2 - 0.2, 3.8, -0.55, 1.0);
                const leaf = mat('globeTreeLeafAutumn', 0.74, 0.48, 0.12);
                const leafDark = mat('globeTreeLeafAutumnDark', 0.55, 0.32, 0.08);
                lobe(`globeProp_birch_${i}_u0`, 1.8, leafDark, trunk, -0.3, trunkH / 2 + 0.6, -0.2, 0.5);
                lobe(`globeProp_birch_${i}_l0`, 2.1, leaf, trunk,  0.1, trunkH / 2 + 1.2,  0.1, 0.0);
                lobe(`globeProp_birch_${i}_l1`, 1.5, leaf, trunk,  0.5, trunkH / 2 + 2.0,  0.3, 0.9);
                lobe(`globeProp_birch_${i}_l2`, 1.2, leaf, trunk, -0.5, trunkH / 2 + 1.9, -0.3, 1.7);
                return { mesh: trunk, baseY: trunkH / 2 };
            },
        ];

        for (let i = 0; i < PROP_COUNT; i++) {
            const prop = makers[i % makers.length](i);
            prop.mesh.isPickable = false;
            // Per-tree variety without per-instance materials: scale + spin.
            // Trees are horizon set-pieces — keep them reasonably large.
            const s = 1.0 + Math.random() * 0.6;
            prop.mesh.scaling.setAll(s);
            prop.baseY *= s;
            // Initial scatter: anywhere in the visible field (full circle, radius
            // 10..PROP_MAX_R) so the run doesn't start on an empty plain.
            const theta = Math.random() * Math.PI * 2;
            const r = 10 + Math.random() * (PROP_MAX_R - 10);
            prop.mesh.position.set(Math.cos(theta) * r, prop.baseY, Math.sin(theta) * r);
            prop.mesh.rotation.y = Math.random() * Math.PI * 2;
            this.props.push(prop);
        }
    }

    /** Per-frame: recycle left-behind trees ahead of the hero + apply the
     *  render-only curvature drop. dirX/dirZ = hero travel direction (any
     *  magnitude; ~zero means stationary → full-circle recycle). */
    public update(heroX: number, heroZ: number, dirX: number, dirZ: number): void {
        for (const p of this.props) {
            const dx = p.mesh.position.x - heroX;
            const dz = p.mesh.position.z - heroZ;
            if (dx * dx + dz * dz > PROP_RECYCLE_DIST * PROP_RECYCLE_DIST) {
                const np = computeRecycledPosition(heroX, heroZ, dirX, dirZ, Math.random(), Math.random());
                p.mesh.position.x = np.x;
                p.mesh.position.z = np.z;
                p.mesh.rotation.y = Math.random() * Math.PI * 2;
            }
            p.mesh.position.y = p.baseY - curveDropAt(p.mesh.position.x, p.mesh.position.z);
        }
    }

    public dispose(): void {
        // mesh.dispose() recurses into the parented branch/canopy parts by
        // default. Materials are cache-owned (clearMaterialCache frees them).
        for (const p of this.props) p.mesh.dispose();
        this.props = [];
    }
}
