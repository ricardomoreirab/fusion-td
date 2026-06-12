import { Scene, Mesh, MeshBuilder } from '@babylonjs/core';
import { getCachedMaterial } from '../../engine/rendering/MaterialCache';
import { PROP_RECYCLE_DIST } from './constants';
import { curveDropAt } from './curvature';

export const PROP_MIN_R = 45; // just past the spawn ring / horizon
export const PROP_MAX_R = 65;
const PROP_COUNT = 20;

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

/**
 * Pool of low-poly decorative props (rocks, broken pillars, dead trees) that
 * drift past as the hero runs and silently recycle to a fresh spot beyond the
 * horizon once left behind — they sell the "globe rotating under you" motion.
 * Non-colliding decoration: no pathing impact, enemies and hero walk through.
 * Materials come from the bounded-key material cache (3 keys, never
 * per-instance) and are freed by exit()'s clearMaterialCache().
 */
export class PropField {
    private props: { mesh: Mesh; baseY: number }[] = [];

    constructor(scene: Scene) {
        const makers: ((i: number) => { mesh: Mesh; baseY: number })[] = [
            (i) => { // rock — squashed octahedron
                const m = MeshBuilder.CreatePolyhedron(`globeProp_rock_${i}`, { type: 1, size: 0.9 }, scene);
                m.scaling.set(1.2, 0.7, 1.0);
                m.material = getCachedMaterial(scene, 'globePropRock', mat => {
                    mat.diffuseColor.set(0.45, 0.43, 0.40);
                    mat.specularColor.set(0, 0, 0);
                });
                return { mesh: m, baseY: 0.35 };
            },
            (i) => { // broken pillar — stubby leaning cylinder
                const h = 1.4 + (i % 3) * 0.7;
                const m = MeshBuilder.CreateCylinder(`globeProp_pillar_${i}`, { height: h, diameter: 0.9, tessellation: 8 }, scene);
                m.rotation.z = 0.06;
                m.material = getCachedMaterial(scene, 'globePropPillar', mat => {
                    mat.diffuseColor.set(0.55, 0.52, 0.46);
                    mat.specularColor.set(0, 0, 0);
                });
                return { mesh: m, baseY: h / 2 };
            },
            (i) => { // dead tree — bare tapered trunk
                const m = MeshBuilder.CreateCylinder(`globeProp_tree_${i}`, { height: 3.2, diameterBottom: 0.5, diameterTop: 0.06, tessellation: 6 }, scene);
                m.rotation.z = 0.1;
                m.material = getCachedMaterial(scene, 'globePropTree', mat => {
                    mat.diffuseColor.set(0.30, 0.22, 0.15);
                    mat.specularColor.set(0, 0, 0);
                });
                return { mesh: m, baseY: 1.6 };
            },
        ];

        for (let i = 0; i < PROP_COUNT; i++) {
            const prop = makers[i % makers.length](i);
            prop.mesh.isPickable = false;
            // Initial scatter: anywhere in the visible field (full circle, radius
            // 10..PROP_MAX_R) so the run doesn't start on an empty plain.
            const theta = Math.random() * Math.PI * 2;
            const r = 10 + Math.random() * (PROP_MAX_R - 10);
            prop.mesh.position.set(Math.cos(theta) * r, prop.baseY, Math.sin(theta) * r);
            prop.mesh.rotation.y = Math.random() * Math.PI * 2;
            this.props.push(prop);
        }
    }

    /** Per-frame: recycle left-behind props ahead of the hero + apply the
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
        // Materials are cache-owned (clearMaterialCache in exit() frees them) —
        // default dispose (no material free) is correct here.
        for (const p of this.props) p.mesh.dispose();
        this.props = [];
    }
}
