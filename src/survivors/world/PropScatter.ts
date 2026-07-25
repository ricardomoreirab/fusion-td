import { Box3, Color, Group, Mesh, MeshStandardMaterial, Object3D, Vector3 } from 'three';
import type { SceneHost } from '../../engine/three/SceneHost';
import { loadContainer } from '../../engine/three/assets';
import type { BiomeDef } from './Biomes';
import {
    PROP_ACTIVE_DESKTOP, PROP_ACTIVE_MOBILE, PROP_MAX_HEIGHT,
    PROP_MIN_SEPARATION, PROP_RECYCLE_RING, PROP_SPAWN_RING_MIN, PROP_SPAWN_RING_MAX,
    PROP_INITIAL_RING_MIN, PROP_INITIAL_RING_MAX,
} from './WorldConstants';

/**
 * Landmark props — the orientation anchors.
 *
 * On an infinite hero-centred treadmill the ground alone cannot prove the player
 * is moving: a world-anchored noise pattern slides, but the eye reads that as
 * texture, not travel. Landmarks are what make motion legible, which is why the
 * design doc requires one to two of them on screen at all times and why they
 * respawn biased toward the hero's heading rather than uniformly.
 *
 * Budget note: these are Tripo-generated meshes that floor out at ~39k triangles
 * each (disconnected shells defeat further simplification), so the active count
 * is deliberately tiny and mobile drops to three. Detail per prop is high;
 * quantity is not. See WorldConstants.
 */

interface PropKit {
    id: string;
    url: string;
    /** World height the prop is normalised to. Capped by PROP_MAX_HEIGHT so a
     *  landmark can never hide an approaching enemy. */
    targetHeight: number;
}

const PROP_KITS: readonly PropKit[] = [
    { id: 'standing_stones', url: 'assets/world/props/opt/standing_stones.glb', targetHeight: 3.2 },
    { id: 'monolith',        url: 'assets/world/props/opt/monolith.glb',        targetHeight: 3.8 },
    { id: 'burnt_tree',      url: 'assets/world/props/opt/burnt_tree.glb',      targetHeight: 3.9 },
    { id: 'ruined_arch',     url: 'assets/world/props/opt/ruined_arch.glb',     targetHeight: 3.6 },
    { id: 'bone_pile',       url: 'assets/world/props/opt/bone_pile.glb',       targetHeight: 1.3 },
    { id: 'goblin_totem',    url: 'assets/world/props/opt/goblin_totem.glb',    targetHeight: 3.0 },
] as const;

/**
 * Desaturation applied to every generated prop at load.
 *
 * The generated assets come back with fully saturated accent colours (the
 * standing stones' moss in particular reads neon against a dusk palette).
 * Grading once at load — rather than per frame — keeps the props inside the art
 * direction without touching shared material state during gameplay.
 */
const PROP_SATURATION = 0.62;
const PROP_VALUE = 0.86;

interface ActiveProp {
    root: Object3D;
    kitId: string;
    x: number;
    z: number;
}

export class PropScatter {
    private readonly host: SceneHost;
    private readonly group = new Group();
    /** Loaded + normalised template per kit id. */
    private readonly templates = new Map<string, Object3D>();
    private readonly active: ActiveProp[] = [];
    private readonly maxActive: number;

    private heroPrevX = 0;
    private heroPrevZ = 0;
    private headingX = 0;
    private headingZ = 1;
    private ready = false;
    private disposed = false;
    /** False until the opening layout has been placed; drives the wider
     *  initial ring exactly once. */
    private seeded = false;
    private rngSeed = 1;

    constructor(host: SceneHost, isMobile: boolean) {
        this.host = host;
        this.maxActive = isMobile ? PROP_ACTIVE_MOBILE : PROP_ACTIVE_DESKTOP;
        this.group.name = 'worldProps';
        host.scene.add(this.group);
        void this.loadAll();
    }

    /** Deterministic RNG so a run's landmark layout is reproducible in tests. */
    private rand(): number {
        this.rngSeed = (this.rngSeed * 1664525 + 1013904223) % 4294967296;
        return this.rngSeed / 4294967296;
    }

    private async loadAll(): Promise<void> {
        await Promise.all(PROP_KITS.map(async (kit) => {
            try {
                const container = await loadContainer(kit.url);
                if (this.disposed) return;
                const template = this.normalise(container.gltf.scene, kit);
                this.templates.set(kit.id, template);
            } catch (err) {
                // A missing prop must never take the world down with it — the
                // run degrades to fewer landmarks rather than a black screen.
                console.warn(`[world] prop kit "${kit.id}" failed to load`, err);
            }
        }));
        if (!this.disposed && this.templates.size > 0) this.ready = true;
    }

    /**
     * Normalise a generated GLB: scale to target height, drop its pivot to the
     * base, and grade its materials. Generated assets arrive at arbitrary scale
     * with an arbitrary pivot, so skipping this makes props float or tower.
     */
    private normalise(scene: Object3D, kit: PropKit): Object3D {
        const root = scene.clone(true);
        const box = new Box3().setFromObject(root);
        const size = new Vector3();
        box.getSize(size);

        const height = Math.max(1e-4, size.y);
        const target = Math.min(kit.targetHeight, PROP_MAX_HEIGHT);
        const s = target / height;
        root.scale.setScalar(s);

        // Re-measure after scaling and sink the pivot to the base so the prop
        // sits ON the ground rather than through it.
        const scaled = new Box3().setFromObject(root);
        const centre = new Vector3();
        scaled.getCenter(centre);
        root.position.x -= centre.x;
        root.position.z -= centre.z;
        root.position.y -= scaled.min.y;

        // Wrap so the offsets above survive being repositioned per instance.
        const wrapper = new Group();
        wrapper.add(root);

        wrapper.traverse((o) => {
            const m = o as Mesh;
            if (!m.isMesh) return;
            m.castShadow = true;
            m.receiveShadow = true;
            const mat = m.material as MeshStandardMaterial | MeshStandardMaterial[];
            const grade = (mm: MeshStandardMaterial) => {
                if (!mm || !mm.color) return;
                const hsl = { h: 0, s: 0, l: 0 };
                mm.color.getHSL(hsl);
                mm.color.setHSL(hsl.h, hsl.s * PROP_SATURATION, hsl.l * PROP_VALUE);
                // Generated PBR often ships mirror-smooth; that reads as plastic
                // under a stylised key light.
                mm.roughness = Math.max(mm.roughness ?? 1, 0.7);
                mm.metalness = Math.min(mm.metalness ?? 0, 0.1);
            };
            if (Array.isArray(mat)) mat.forEach(grade); else grade(mat);
        });

        return wrapper;
    }

    /**
     * Kits eligible right now.
     *
     * The incoming biome's props only join the pool once the transition has
     * actually started. World.resolveAxis always reports a biome PAIR (the
     * terrain shader needs both ends even at t=0), so unioning unconditionally
     * put burnt trees in the wave-1 meadow — the props leaked a biome early.
     */
    private eligible(a: BiomeDef, b: BiomeDef, t: number): string[] {
        const ids = new Set<string>();
        for (const id of a.props) if (this.templates.has(id)) ids.add(id);
        if (t > 0.05) {
            for (const id of b.props) if (this.templates.has(id)) ids.add(id);
        }
        return [...ids];
    }

    /**
     * Place one prop.
     *
     * `initial` seeds the opening layout and straddles the frame so landmarks
     * are visible from the first frame; recycling uses the tighter off-screen
     * ring, biased ahead of the hero so props stream toward the player.
     */
    private placeProp(
        prop: ActiveProp, heroX: number, heroZ: number, halfDiag: number, initial = false,
    ): void {
        const ringMin = halfDiag * (initial ? PROP_INITIAL_RING_MIN : PROP_SPAWN_RING_MIN);
        const ringMax = halfDiag * (initial ? PROP_INITIAL_RING_MAX : PROP_SPAWN_RING_MAX);

        for (let attempt = 0; attempt < 8; attempt++) {
            // Bias toward the heading so landmarks stream toward the player,
            // which is what sells travel. The initial fill uses a full circle
            // instead — there is no heading yet, and surrounding the spawn point
            // gives the player orientation cues in every direction.
            const headingAngle = initial
                ? this.rand() * Math.PI * 2
                : Math.atan2(this.headingZ, this.headingX);
            const spread = initial ? 0 : (this.rand() - 0.5) * (Math.PI * 0.85);
            const angle = headingAngle + spread + (!initial && this.rand() < 0.25 ? Math.PI : 0);
            const r = ringMin + this.rand() * (ringMax - ringMin);
            const x = heroX + Math.cos(angle) * r;
            const z = heroZ + Math.sin(angle) * r;

            let clear = true;
            for (const other of this.active) {
                if (other === prop) continue;
                if (Math.hypot(other.x - x, other.z - z) < PROP_MIN_SEPARATION) { clear = false; break; }
            }
            if (!clear && attempt < 7) continue;

            prop.x = x;
            prop.z = z;
            prop.root.position.set(x, 0, z);
            prop.root.rotation.y = this.rand() * Math.PI * 2;
            const s = 0.85 + this.rand() * 0.35;
            prop.root.scale.setScalar(s);
            return;
        }
    }

    /** Swap a slot to a different kit (used when the biome changes). */
    private assignKit(prop: ActiveProp, kitId: string): void {
        const template = this.templates.get(kitId);
        if (!template) return;
        if (prop.root.parent) prop.root.removeFromParent();
        const clone = template.clone(true); // shares geometry + materials
        clone.name = `prop_${kitId}`;
        this.group.add(clone);
        prop.root = clone;
        prop.kitId = kitId;
    }

    public update(
        heroX: number, heroZ: number, halfDiag: number, a: BiomeDef, b: BiomeDef, t: number,
    ): void {
        if (!this.ready) return;

        // Track heading from actual displacement; ignore sub-pixel jitter so a
        // stationary hero does not spin the spawn bias.
        const dx = heroX - this.heroPrevX;
        const dz = heroZ - this.heroPrevZ;
        if (Math.hypot(dx, dz) > 0.02) {
            const len = Math.hypot(dx, dz);
            this.headingX = dx / len;
            this.headingZ = dz / len;
        }
        this.heroPrevX = heroX;
        this.heroPrevZ = heroZ;

        const kits = this.eligible(a, b, t);
        if (kits.length === 0) return;

        // Fill empty slots.
        while (this.active.length < this.maxActive) {
            const kitId = kits[Math.floor(this.rand() * kits.length) % kits.length];
            const template = this.templates.get(kitId);
            if (!template) break;
            const clone = template.clone(true);
            clone.name = `prop_${kitId}`;
            this.group.add(clone);
            const prop: ActiveProp = { root: clone, kitId, x: heroX, z: heroZ };
            this.active.push(prop);
            // First fill straddles the frame so landmarks read immediately.
            this.placeProp(prop, heroX, heroZ, halfDiag, !this.seeded);
        }
        this.seeded = true;

        // Recycle anything that has drifted out of relevance.
        const recycleDist = halfDiag * PROP_RECYCLE_RING;
        for (const prop of this.active) {
            if (Math.hypot(prop.x - heroX, prop.z - heroZ) <= recycleDist) continue;
            // Off-screen is the only safe moment to change a prop's identity,
            // so the biome swap rides on the recycle rather than popping in view.
            if (!kits.includes(prop.kitId)) {
                this.assignKit(prop, kits[Math.floor(this.rand() * kits.length) % kits.length]);
            }
            this.placeProp(prop, heroX, heroZ, halfDiag);
        }
    }

    /** Live prop count — reported in the technical-art budget. */
    public getActiveCount(): number { return this.active.length; }

    public dispose(): void {
        this.disposed = true;
        this.ready = false;
        // Clones share the templates' geometry/materials, so only the templates
        // own GPU resources and only they are disposed.
        this.group.clear();
        this.group.removeFromParent();
        for (const template of this.templates.values()) {
            template.traverse((o) => {
                const m = o as Mesh;
                if (!m.isMesh) return;
                m.geometry?.dispose();
                const mat = m.material as MeshStandardMaterial | MeshStandardMaterial[];
                if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
                else mat?.dispose();
            });
        }
        this.templates.clear();
        this.active.length = 0;
        void this.host;
        void Color;
    }
}
