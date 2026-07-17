import { Mesh, Vector3 } from 'three';
import type { SceneHost } from '../engine/three/SceneHost';
import { createCylinder, createDisc, createSphere, createTorus, disposeMesh, isMeshDisposed } from '../engine/three/primitives';
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
            // Health potion: rounded flask body + neck + cork — an authored
            // silhouette instead of a bare sphere. The body is the root mesh
            // (bob/spin/scale act on the whole flask).
            this.mesh = createSphere('floorPickup_heal', { diameter: 0.62, segments: 10 }, scene);
            this.mesh.scale.set(1, 1.15, 1);
            this.mesh.material = getCachedMaterial('floorPickupMat_heal', m => {
                m.emissive.setRGB(1.0, 0.22, 0.38); // glowing red liquid
                m.color.setRGB(0.25, 0.03, 0.08);
            });
            const neck = createCylinder('floorPickup_healNeck',
                { diameterTop: 0.2, diameterBottom: 0.3, height: 0.28, tessellation: 10 });
            neck.position.y = 0.38;
            neck.material = getCachedMaterial('floorPickupMat_healGlass', m => {
                m.emissive.setRGB(0.5, 0.65, 0.7);
                m.color.setRGB(0.3, 0.4, 0.45);
                m.transparent = true;
                m.opacity = 0.7;
            });
            this.mesh.add(neck);
            const cork = createCylinder('floorPickup_healCork',
                { diameterTop: 0.16, diameterBottom: 0.19, height: 0.14, tessellation: 8 });
            cork.position.y = 0.56;
            cork.material = getCachedMaterial('floorPickupMat_healCork', m => {
                m.color.setRGB(0.5, 0.36, 0.2);
                m.emissive.setRGB(0.12, 0.08, 0.04);
            });
            this.mesh.add(cork);
        } else {
            this.mesh = createTorus('floorPickup_magnet', { diameter: 0.85, thickness: 0.14, tessellation: 20 }, scene);
            this.mesh.material = getCachedMaterial('floorPickupMat_magnet', m => {
                m.emissive.setRGB(1.0, 0.8, 0.2);
                m.color.setRGB(0.25, 0.18, 0.02);
            });
        }
        markGlowing(this.mesh);

        // Beacon pillar + ground contact glow so floor loot is spottable
        // through the horde and from spawn distance (mirrors PowerDrop).
        const r = kind === 'heal' ? [1.0, 0.3, 0.42] : [1.0, 0.8, 0.25];
        const beacon = createCylinder(`floorPickupBeacon_${kind}`,
            { diameterTop: 0.14, diameterBottom: 0.3, height: 3.2, tessellation: 8 });
        beacon.position.y = 1.4;
        beacon.material = getCachedMaterial(`floorPickupBeaconMat_${kind}`, m => {
            m.emissive.setRGB(r[0], r[1], r[2]);
            m.color.set(0, 0, 0);
            m.transparent = true;
            m.opacity = 0.4;
            m.depthWrite = false;
        });
        markGlowing(beacon); // bloom lifts the pillar so it reads at distance
        this.mesh.add(beacon);
        const glow = createDisc(`floorPickupGlow_${kind}`, { radius: 0.6, tessellation: 18 });
        glow.rotation.x = -Math.PI / 2;
        glow.position.y = -0.5;
        glow.material = getCachedMaterial(`floorPickupGlowMat_${kind}`, m => {
            m.emissive.setRGB(r[0] * 0.6, r[1] * 0.6, r[2] * 0.6);
            m.color.set(0, 0, 0);
            m.transparent = true;
            m.opacity = 0.3;
            m.depthWrite = false;
        });
        this.mesh.add(glow);

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
            // Heartbeat pulse preserving the flask's 1.15× vertical stretch.
            const s = 1 + Math.sin(this.ageS * 4) * 0.12;
            this.mesh.scale.set(s, s * 1.15, s);
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
