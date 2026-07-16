import { Mesh, Vector3 } from 'three';
import type { SceneHost } from '../engine/three/SceneHost';
import { createSphere, createTorus, disposeMesh, isMeshDisposed } from '../engine/three/primitives';
import { markGlowing } from '../engine/rendering/LowPolyMaterial';
import { getCachedMaterial } from '../engine/rendering/MaterialCache';
import { curveDropAt } from './globe/curvature';

export type FloorPickupKind = 'heal' | 'magnet';

export interface FloorPickupOpts {
    pickupRadius: number;
    magnetRadius: number;
    magnetSpeed: number;
    onPickup: (kind: FloorPickupKind) => void;
}

/**
 * A Vampire Survivors-style floor pickup dropped by regular enemy kills:
 *  - 'heal'   — pink-red orb, restores a chunk of the hero's max HP.
 *  - 'magnet' — golden ring, vacuums every uncollected drop to the hero.
 *
 * Same lifecycle contract as PowerDrop: hovers with a bob, magnetises
 * toward the hero inside `magnetRadius`, collected inside `pickupRadius`,
 * cached (bounded-key) shared materials, disposeMesh on collection.
 */
export class FloorPickup {
    private static readonly LIFETIME_S = 45;
    /** Beyond this the pickup is far offscreen (view frustum ≈ ±35 units). */
    private static readonly STRAND_DISTANCE = 60;

    private mesh: Mesh;
    private alive = true;
    private ageS = 0;

    constructor(
        scene: SceneHost,
        position: Vector3,
        public readonly kind: FloorPickupKind,
        private readonly heroProvider: () => Vector3,
        private readonly opts: FloorPickupOpts,
    ) {
        if (kind === 'heal') {
            this.mesh = createSphere('floorPickup_heal', { diameter: 0.5, segments: 10 }, scene);
            this.mesh.material = getCachedMaterial('floorPickupMat_heal', m => {
                m.emissive.setRGB(1.0, 0.25, 0.4);
                m.color.setRGB(0.2, 0.02, 0.06);
            });
        } else {
            this.mesh = createTorus('floorPickup_magnet', { diameter: 0.7, thickness: 0.12, tessellation: 20 }, scene);
            this.mesh.material = getCachedMaterial('floorPickupMat_magnet', m => {
                m.emissive.setRGB(1.0, 0.8, 0.2);
                m.color.setRGB(0.25, 0.18, 0.02);
            });
        }
        markGlowing(this.mesh);
        this.mesh.position.copy(position);
        this.mesh.position.y = 0.6;
    }

    public isAlive(): boolean {
        return this.alive;
    }

    /** Blow the magnet range open so the drop rushes to the hero (magnet pickup effect). */
    public magnetize(): void {
        this.opts.magnetRadius = Infinity;
        this.opts.magnetSpeed = Math.max(this.opts.magnetSpeed, 18);
    }

    public update(deltaTime: number): void {
        if (!this.alive) return;
        this.ageS += deltaTime;

        const heroPos = this.heroProvider();
        const dx = heroPos.x - this.mesh.position.x;
        const dz = heroPos.z - this.mesh.position.z;
        const dist = Math.hypot(dx, dz);

        // Despawn when stale or stranded. The map is an infinite treadmill, so a
        // pickup the hero runs past is unreachable forever — and because spawn
        // caps count ALL alive pickups, stranded ones would permanently starve
        // future drops of that kind.
        if (this.ageS > FloorPickup.LIFETIME_S || dist > FloorPickup.STRAND_DISTANCE) {
            this.dispose();
            return;
        }

        if (dist <= this.opts.pickupRadius) {
            this.opts.onPickup(this.kind);
            this.dispose();
            return;
        }

        if (dist <= this.opts.magnetRadius && dist > 0.001) {
            const step = this.opts.magnetSpeed * deltaTime;
            this.mesh.position.x += (dx / dist) * step;
            this.mesh.position.z += (dz / dist) * step;
        }

        // Idle bob + a slow spin so the pickups read as "alive" loot; the
        // heal orb also breathes (scale pulse) like a heartbeat.
        this.mesh.rotation.y += deltaTime * 1.6;
        if (this.kind === 'heal') {
            this.mesh.scale.setScalar(1 + Math.sin(this.ageS * 4) * 0.12);
        }
        this.mesh.position.y = 0.6 + Math.sin(this.ageS * 3) * 0.1
            - curveDropAt(this.mesh.position.x, this.mesh.position.z); // render-only globe drop
    }

    public dispose(): void {
        this.alive = false;
        if (!isMeshDisposed(this.mesh)) {
            disposeMesh(this.mesh); // cached material is shared — leave it
        }
    }
}
