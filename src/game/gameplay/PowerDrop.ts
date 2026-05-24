import { Scene, Vector3, Mesh, MeshBuilder, StandardMaterial, Color3 } from '@babylonjs/core';

const ELEMENT_COLORS: Record<string, Color3> = {
    fire:     new Color3(1, 0.4, 0),
    ice:      new Color3(0.3, 0.7, 1),
    arcane:   new Color3(0.8, 0.3, 1),
    physical: new Color3(0.9, 0.9, 0.9),
    storm:    new Color3(0.8, 0.8, 1),
};

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
        const mat = new StandardMaterial('powerOrbMat_' + element, scene);
        mat.emissiveColor = ELEMENT_COLORS[element] ?? new Color3(1, 1, 1);
        this.mesh.material = mat;
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
        const col = ELEMENT_COLORS[this.element] ?? new Color3(1, 1, 1);
        const flashMat = new StandardMaterial('orbFlash_' + Math.random(), this.scene);
        flashMat.emissiveColor = col.scale(2);  // bright burst
        // Temporarily replace material for the flash
        this.mesh.material = flashMat;
        this.mesh.scaling.setAll(2.2);          // pop-out scale
        // No setTimeout needed — we dispose right after, the flash is just the last frame render
    }

    public dispose(): void {
        this.alive = false;
        if (!this.mesh.isDisposed()) {
            this.mesh.dispose();
        }
    }
}
