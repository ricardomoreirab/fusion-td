import { Scene, Vector3, Mesh, MeshBuilder, Color3 } from '@babylonjs/core';
import { getCachedMaterial } from '../../engine/rendering/MaterialCache';
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
    private scene: Scene;
    private mesh: Mesh;
    public element: string;
    private opts: PowerDropOpts;
    private alive: boolean = true;
    private heroProvider: () => Vector3;

    constructor(
        scene: Scene,
        position: Vector3,
        element: string,
        heroProvider: () => Vector3,
        opts: PowerDropOpts,
    ) {
        this.scene = scene;
        this.element = element;
        this.opts = opts;
        this.heroProvider = heroProvider;

        this.mesh = MeshBuilder.CreateSphere('powerOrb_' + element + '_' + Math.random(), { diameter: 0.6 }, scene);
        this.mesh.position.copyFrom(position);
        this.mesh.position.y = 0.6;
        this.mesh.material = getCachedMaterial(scene, 'powerOrbMat_' + element, m => {
            m.emissiveColor = ELEMENT_COLORS[element as keyof typeof ELEMENT_COLORS] ?? new Color3(1, 1, 1);
        });
    }

    public isAlive(): boolean {
        return this.alive;
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
        this.mesh.position.y = 0.6 + Math.sin(performance.now() / 200) * 0.1;
    }

    /**
     * Scale the orb up and boost emissive for ~200 ms before it disappears.
     * The mesh will already be disposed by then; the short animation fires and forgets.
     */
    private playPickupFlash(): void {
        const col = ELEMENT_COLORS[this.element as keyof typeof ELEMENT_COLORS] ?? new Color3(1, 1, 1);
        // Cache the flash material by element (bounded). A Math.random() name recompiled
        // a shader per pickup. The cached material is shared/frozen — never disposed here.
        this.mesh.material = getCachedMaterial(this.scene, `orbFlash_${this.element}`, m => {
            m.emissiveColor = col.scale(2);  // bright burst
            m.disableLighting = true;
        });
        this.mesh.scaling.setAll(2.2);          // pop-out scale
    }

    public dispose(): void {
        this.alive = false;
        if (!this.mesh.isDisposed()) {
            this.mesh.dispose();
        }
    }
}
