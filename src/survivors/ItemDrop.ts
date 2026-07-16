import { Color, Mesh, Vector3 } from 'three';
import type { SceneHost } from '../engine/three/SceneHost';
import { createCylinder, createPolyhedron, disposeMesh, isMeshDisposed } from '../engine/three/primitives';
import { getCachedMaterial } from '../engine/rendering/MaterialCache';
import { curveDropAt } from './globe/curvature';
import { ItemId } from './RunItems';

/** Visual color per item — matches the HUD slot color so the link reads. */
const ITEM_COLORS: Record<ItemId, Color> = {
    extraLife:       new Color(0.27, 0.88, 0.35),  // green
    multishotCleave: new Color(1.0, 0.85, 0.30),   // gold
    knockback:       new Color(0.30, 0.65, 1.0),   // blue
    attackSpeed:     new Color(1.0, 1.0, 0.55),    // yellow-white
    elementalCore:   new Color(1.0, 0.35, 0.18),   // ember orange
};

export interface ItemDropOpts {
    pickupRadius: number;
    magnetRadius: number;
    magnetSpeed: number;
    onPickup: (id: ItemId) => void;
}

export class ItemDrop {
    private mesh: Mesh;
    private pillar: Mesh;
    private color: Color;
    public itemId: ItemId;
    private opts: ItemDropOpts;
    private alive: boolean = true;
    private heroProvider: () => Vector3;
    private spawnTime: number = performance.now();

    constructor(
        scene: SceneHost,
        position: Vector3,
        itemId: ItemId,
        heroProvider: () => Vector3,
        opts: ItemDropOpts,
    ) {
        this.itemId = itemId;
        this.color = ITEM_COLORS[itemId] ?? new Color(1, 1, 1);
        this.opts = opts;
        this.heroProvider = heroProvider;

        // Faceted dodecahedron gem
        this.mesh = createPolyhedron(`itemGem_${itemId}`,
            { type: 2, size: 0.45 }, scene);
        this.mesh.position.copy(position);
        this.mesh.position.y = 0.8;
        // Cache by itemId (bounded: 4 ids). Math.random() suffix defeated the
        // cache and forced a shader recompile per drop.
        this.mesh.material = getCachedMaterial(`itemGemMat_${itemId}`, m => {
            m.emissive.copy(this.color);
            // Babylon set diffuse = color*0.3 + disableLighting, so only the
            // emissive rendered; black diffuse reproduces the unlit look.
            m.color.set(0, 0, 0);
            m.specular.set(0, 0, 0);
        });

        // Pillar of light — tall thin cylinder behind the gem
        this.pillar = createCylinder(`itemPillar_${itemId}`,
            { height: 8, diameterTop: 0.3, diameterBottom: 0.9, tessellation: 8 }, scene);
        this.pillar.position.copy(position);
        this.pillar.position.y = 4;
        this.pillar.material = getCachedMaterial(`itemPillarMat_${itemId}`, m => {
            m.emissive.copy(this.color);
            m.color.set(0, 0, 0);
            m.specular.set(0, 0, 0);
            m.opacity = 0.20;
            m.transparent = true;
        });
    }

    public isAlive(): boolean {
        return this.alive;
    }

    /** Blow the magnet range open so the gem rushes to the hero (magnet pickup effect). */
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
            this.playPickupFlash();
            this.opts.onPickup(this.itemId);
            this.dispose();
            return;
        }

        if (dist <= this.opts.magnetRadius && dist > 0.001) {
            const step = this.opts.magnetSpeed * deltaTime;
            this.mesh.position.x += (dx / dist) * step;
            this.mesh.position.z += (dz / dist) * step;
            this.pillar.position.x = this.mesh.position.x;
            this.pillar.position.z = this.mesh.position.z;
        }

        // Idle hover + slow spin (sunk by the render-only globe drop)
        const t = (performance.now() - this.spawnTime) / 1000;
        const itemCurveDrop = curveDropAt(this.mesh.position.x, this.mesh.position.z);
        this.mesh.position.y = 0.8 + Math.sin(t * 2.0) * 0.15 - itemCurveDrop;
        this.pillar.position.y = 4 - itemCurveDrop;
        this.mesh.rotation.y = t * 1.2;
    }

    private playPickupFlash(): void {
        // Cache by itemId (bounded: 4 ids). Math.random() suffix forced a shader
        // recompile per pickup. The gem material is shared/cached — do NOT dispose
        // it before swapping; just replace the mesh's material reference.
        this.mesh.material = getCachedMaterial(`itemFlash_${this.itemId}`, m => {
            m.emissive.copy(this.color).multiplyScalar(2.5);
            m.color.set(0, 0, 0);
            m.specular.set(0, 0, 0);
        });
        this.mesh.scale.setScalar(2.0);
    }

    public dispose(): void {
        this.alive = false;
        // All materials are shared/cached — disposeMesh keeps them (userData.cached).
        if (!isMeshDisposed(this.mesh)) disposeMesh(this.mesh);
        if (!isMeshDisposed(this.pillar)) disposeMesh(this.pillar);
    }
}
