import { Color, Mesh, Vector3 } from 'three';
import type { SceneHost, UpdateToken } from '../../engine/three/SceneHost';
import { createCylinder, createDisc, createSphere, createTorus, disposeMesh, isMeshDisposed } from '../../engine/three/primitives';
import { getCachedMaterial } from '../../engine/rendering/MaterialCache';
import { markGlowing, setMeshOpacity } from '../../engine/rendering/LowPolyMaterial';
import { ELEMENT_COLOR as ELEMENT_COLORS } from '../ElementColors';

export interface PowerDropOpts {
    pickupRadius: number;
    magnetRadius: number;
    magnetSpeed: number;
    onPickup: (element: string) => void;
}

/**
 * A power orb dropped by elite enemies — the run's most valuable floor loot,
 * so it must read from across the arena: faceted core + orbiting halo ring
 * (both selective-bloomed), a vertical beacon pillar, and a soft ground
 * contact glow. Idle spin/bob; magnetises toward the hero within
 * `magnetRadius`; collected within `pickupRadius`.
 *
 * All materials are cached by BOUNDED element keys and shared across drops;
 * disposeMesh traverses the child assembly and leaves cached materials alone.
 */
export class PowerDrop {
    private mesh: Mesh;
    private ring: Mesh;
    public element: string;
    private opts: PowerDropOpts;
    private alive: boolean = true;
    private ageS = 0;
    private heroProvider: () => Vector3;
    private scene: SceneHost;
    private magnetized = false;

    constructor(
        scene: SceneHost,
        position: Vector3,
        element: string,
        heroProvider: () => Vector3,
        opts: PowerDropOpts,
    ) {
        this.scene = scene;
        this.element = element;
        this.opts = opts;
        this.heroProvider = heroProvider;
        const col = ELEMENT_COLORS[element as keyof typeof ELEMENT_COLORS] ?? new Color(1, 1, 1);

        // Faceted core — low segment count keeps the gem-like silhouette.
        this.mesh = createSphere('powerOrb_' + element, { diameter: 0.7, segments: 5 }, scene);
        this.mesh.position.copy(position);
        this.mesh.position.y = 0.7;
        this.mesh.material = getCachedMaterial('powerOrbMat_' + element, m => {
            m.emissive.copy(col);
        });
        markGlowing(this.mesh);

        // Orbiting halo ring, tilted so the spin reads from the top-down camera.
        this.ring = createTorus('powerOrbRing_' + element, { diameter: 1.1, thickness: 0.06, tessellation: 24 });
        this.ring.rotation.x = Math.PI / 2.6;
        this.ring.material = getCachedMaterial('powerOrbRingMat_' + element, m => {
            m.emissive.copy(col).multiplyScalar(1.4);
            m.color.set(0, 0, 0);
        });
        markGlowing(this.ring);
        this.mesh.add(this.ring);

        // Beacon pillar — a faint additive-looking column so the drop is
        // findable when it spawns offscreen or behind the horde.
        const beacon = createCylinder('powerOrbBeacon_' + element,
            { diameterTop: 0.16, diameterBottom: 0.34, height: 3.6, tessellation: 8 });
        beacon.position.y = 1.6;
        beacon.material = getCachedMaterial('powerOrbBeaconMat_' + element, m => {
            m.emissive.copy(col).multiplyScalar(1.1);
            m.color.set(0, 0, 0);
            m.transparent = true;
            m.opacity = 0.42;
            m.depthWrite = false;
        });
        markGlowing(beacon); // bloom carries the pillar across the arena
        this.mesh.add(beacon);

        // Soft ground contact glow anchors the hover.
        const glow = createDisc('powerOrbGlow_' + element, { radius: 0.85, tessellation: 20 });
        glow.rotation.x = -Math.PI / 2;
        glow.position.y = -0.55;
        glow.material = getCachedMaterial('powerOrbGlowMat_' + element, m => {
            m.emissive.copy(col).multiplyScalar(0.6);
            m.color.set(0, 0, 0);
            m.transparent = true;
            m.opacity = 0.35;
            m.depthWrite = false;
        });
        this.mesh.add(glow);
    }

    public isAlive(): boolean {
        return this.alive;
    }

    /** Blow the magnet range open so the orb rushes to the hero (magnet pickup effect). */
    public magnetize(): void {
        this.opts.magnetRadius = Infinity;
        this.opts.magnetSpeed = Math.max(this.opts.magnetSpeed, 18);
        this.magnetized = true;
    }

    public update(deltaTime: number): void {
        if (!this.alive) return;
        this.ageS += deltaTime;

        const heroPos = this.heroProvider();
        const dx = heroPos.x - this.mesh.position.x;
        const dz = heroPos.z - this.mesh.position.z;
        const dist = Math.hypot(dx, dz);

        if (dist <= this.opts.pickupRadius) {
            spawnPickupBurst(this.scene, this.mesh.position, this.element);
            this.opts.onPickup(this.element);
            this.dispose();
            return;
        }

        if (dist <= this.opts.magnetRadius && dist > 0.001) {
            const step = this.opts.magnetSpeed * deltaTime;
            this.mesh.position.x += (dx / dist) * step;
            this.mesh.position.z += (dz / dist) * step;
        }

        // Idle spin + counter-spinning halo + bob.
        this.mesh.rotation.y += deltaTime * 1.8;
        this.ring.rotation.z -= deltaTime * 2.6;
        this.mesh.position.y = 0.7 + Math.sin(this.ageS * 5) * 0.12;

        // Magnetized attract cue: stretch the core toward the hero so the
        // rush-in reads as a directed pull rather than a plain slide.
        if (this.magnetized && dist > 0.001) {
            const stretch = Math.min(1.8, 1 + 12 / Math.max(dist, 0.5));
            this.mesh.scale.set(1, 1, stretch);
            this.mesh.lookAt(heroPos.x, this.mesh.position.y, heroPos.z);
        }
    }

    public dispose(): void {
        this.alive = false;
        if (!isMeshDisposed(this.mesh)) {
            disposeMesh(this.mesh); // traverses the beacon/ring/glow children too
        }
    }
}

/**
 * Standalone one-shot collect flash — an expanding emissive burst that
 * outlives the orb mesh itself (the orb disposes the same frame it's
 * collected, so animating the orb's own material/scale would never render).
 * Cached material keyed by element; disposeMesh + setMeshOpacity keep the
 * fade lifecycle audited like every other transient FX in this codebase.
 */
function spawnPickupBurst(scene: SceneHost, position: Vector3, element: string): void {
    const col = ELEMENT_COLORS[element as keyof typeof ELEMENT_COLORS] ?? new Color(1, 1, 1);
    const burst = createSphere('powerOrbBurst_' + element, { diameter: 0.9, segments: 8 }, scene);
    burst.position.copy(position);
    burst.material = getCachedMaterial(`orbBurstMat_${element}`, m => {
        m.emissive.copy(col).multiplyScalar(2.4);
        m.color.set(0, 0, 0);
        m.transparent = true;
        m.opacity = 0.9;
        m.depthWrite = false;
    });
    markGlowing(burst);

    const ring = createTorus('powerOrbBurstRing_' + element, { diameter: 0.5, thickness: 0.08, tessellation: 20 });
    ring.rotation.x = Math.PI / 2.6;
    ring.material = getCachedMaterial(`orbBurstRingMat_${element}`, m => {
        m.emissive.copy(col).multiplyScalar(2);
        m.color.set(0, 0, 0);
        m.transparent = true;
        m.opacity = 0.85;
        m.depthWrite = false;
    });
    burst.add(ring);

    const duration = 0.28;
    let elapsed = 0;
    let token: UpdateToken | null = null;
    token = scene.onBeforeRender.add(() => {
        elapsed += scene.deltaSeconds;
        const t = Math.min(elapsed / duration, 1);
        const s = 1 + t * 2.6;
        burst.scale.setScalar(s);
        setMeshOpacity(burst, 0.9 * (1 - t));
        ring.scale.setScalar(1 + t * 3.2);
        setMeshOpacity(ring, 0.85 * (1 - t));
        if (t >= 1) {
            disposeMesh(burst); // traverses the ring child too
            scene.onBeforeRender.remove(token);
        }
    });
}
