import { Color, Mesh, Vector3 } from 'three';
import type { SceneHost } from '../../engine/three/SceneHost';
import { createSphere, disposeMesh, isMeshDisposed } from '../../engine/three/primitives';
import { getCachedMaterial } from '../../engine/rendering/MaterialCache';
import { curveDropAt } from '../globe/curvature';
import { ELEMENT_COLOR as ELEMENT_COLORS } from '../ElementColors';

export interface PowerDropOpts {
    pickupRadius: number;
    magnetRadius: number;
    magnetSpeed: number;
    onPickup: (element: string) => void;
}

/**
 * A power orb dropped by elite enemies.
 * Hovers in place, magnetises toward the hero within `magnetRadius`,
 * and is collected when within `pickupRadius`.
 *
 * Phase 3: onPickup just heals the hero 1 HP.
 * Phase 4 will replace onPickup with the 3-card power-choice overlay.
 */
export class PowerDrop {
    private mesh: Mesh;
    public element: string;
    private opts: PowerDropOpts;
    private alive: boolean = true;
    private heroProvider: () => Vector3;

    constructor(
        scene: SceneHost,
        position: Vector3,
        element: string,
        heroProvider: () => Vector3,
        opts: PowerDropOpts,
    ) {
        this.element = element;
        this.opts = opts;
        this.heroProvider = heroProvider;

        this.mesh = createSphere('powerOrb_' + element + '_' + Math.random(), { diameter: 0.6 }, scene);
        this.mesh.position.copy(position);
        this.mesh.position.y = 0.6;
        this.mesh.material = getCachedMaterial('powerOrbMat_' + element, m => {
            m.emissive.copy(ELEMENT_COLORS[element as keyof typeof ELEMENT_COLORS] ?? new Color(1, 1, 1));
        });
    }

    public isAlive(): boolean {
        return this.alive;
    }

    /** Blow the magnet range open so the orb rushes to the hero (magnet pickup effect). */
    public magnetize(): void {
        this.opts.magnetRadius = Infinity;
        this.opts.magnetSpeed = Math.max(this.opts.magnetSpeed, 18);
    }

    public update(deltaTime: number): void {
        if (!this.alive) return;

        const heroPos = this.heroProvider();
        const dx = heroPos.x - this.mesh.position.x;
        const dz = heroPos.z - this.mesh.position.z;
        const dist = Math.hypot(dx, dz);

        if (dist <= this.opts.pickupRadius) {
            // Brief burst effect before disposal
            this.playPickupFlash();
            this.opts.onPickup(this.element);
            this.dispose();
            return;
        }

        if (dist <= this.opts.magnetRadius && dist > 0.001) {
            const step = this.opts.magnetSpeed * deltaTime;
            this.mesh.position.x += (dx / dist) * step;
            this.mesh.position.z += (dz / dist) * step;
        }

        // Idle bob
        this.mesh.position.y = 0.6 + Math.sin(performance.now() / 200) * 0.1
            - curveDropAt(this.mesh.position.x, this.mesh.position.z); // render-only globe drop
    }

    /**
     * Scale the orb up and boost emissive for ~200 ms before it disappears.
     * The mesh will already be disposed by then; the short animation fires and forgets.
     */
    private playPickupFlash(): void {
        const col = ELEMENT_COLORS[this.element as keyof typeof ELEMENT_COLORS] ?? new Color(1, 1, 1);
        // Cache the flash material by element (bounded). A Math.random() name recompiled
        // a shader per pickup. The cached material is shared — never disposed here.
        this.mesh.material = getCachedMaterial(`orbFlash_${this.element}`, m => {
            m.emissive.copy(col).multiplyScalar(2); // bright burst
            m.color.set(0, 0, 0);                   // unlit look (Babylon disableLighting)
        });
        this.mesh.scale.setScalar(2.2);         // pop-out scale
    }

    public dispose(): void {
        this.alive = false;
        if (!isMeshDisposed(this.mesh)) {
            disposeMesh(this.mesh);
        }
    }
}
