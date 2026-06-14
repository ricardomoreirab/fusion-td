import { Scene, Vector3, Mesh, MeshBuilder, Color3 } from '@babylonjs/core';
import { getCachedMaterial } from '../engine/rendering/MaterialCache';
import { curveDropAt } from './globe/curvature';
import { ItemId } from './RunItems';

/** Visual color per item — matches the HUD slot color so the link reads. */
const ITEM_COLORS: Record<ItemId, Color3> = {
    extraLife:       new Color3(0.27, 0.88, 0.35),  // green
    multishotCleave: new Color3(1.0, 0.85, 0.30),   // gold
    knockback:       new Color3(0.30, 0.65, 1.0),   // blue
    attackSpeed:     new Color3(1.0, 1.0, 0.55),    // yellow-white
    elementalCore:   new Color3(1.0, 0.35, 0.18),   // ember orange
};

export interface ItemDropOpts {
    pickupRadius: number;
    magnetRadius: number;
    magnetSpeed: number;
    onPickup: (id: ItemId) => void;
}

export class ItemDrop {
    private scene: Scene;
    private mesh: Mesh;
    private pillar: Mesh;
    private color: Color3;
    public itemId: ItemId;
    private opts: ItemDropOpts;
    private alive: boolean = true;
    private heroProvider: () => Vector3;
    private spawnTime: number = performance.now();

    constructor(
        scene: Scene,
        position: Vector3,
        itemId: ItemId,
        heroProvider: () => Vector3,
        opts: ItemDropOpts,
    ) {
        this.scene = scene;
        this.itemId = itemId;
        this.color = ITEM_COLORS[itemId] ?? new Color3(1, 1, 1);
        this.opts = opts;
        this.heroProvider = heroProvider;

        // Faceted icosahedron gem
        this.mesh = MeshBuilder.CreatePolyhedron(`itemGem_${itemId}`,
            { type: 2, size: 0.45 }, scene);
        this.mesh.position.copyFrom(position);
        this.mesh.position.y = 0.8;
        // Cache by itemId (bounded: 4 ids). Math.random() suffix defeated the
        // cache and forced a shader recompile per drop.
        this.mesh.material = getCachedMaterial(scene, `itemGemMat_${itemId}`, m => {
            m.emissiveColor = this.color;
            m.diffuseColor  = this.color.scale(0.3);
            m.specularColor = Color3.Black();
            m.disableLighting = true;
        });

        // Pillar of light — tall thin cylinder behind the gem
        this.pillar = MeshBuilder.CreateCylinder(`itemPillar_${itemId}`,
            { height: 8, diameterTop: 0.3, diameterBottom: 0.9, tessellation: 8 }, scene);
        this.pillar.position.copyFrom(position);
        this.pillar.position.y = 4;
        this.pillar.material = getCachedMaterial(scene, `itemPillarMat_${itemId}`, m => {
            m.emissiveColor = this.color;
            m.diffuseColor  = new Color3(0, 0, 0);
            m.specularColor = Color3.Black();
            m.disableLighting = true;
            m.alpha = 0.20;
        });
        this.pillar.isPickable = false;
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
        this.mesh.material = getCachedMaterial(this.scene, `itemFlash_${this.itemId}`, m => {
            m.emissiveColor = this.color.scale(2.5);
            m.specularColor = Color3.Black();
            m.disableLighting = true;
        });
        this.mesh.scaling.setAll(2.0);
    }

    public dispose(): void {
        this.alive = false;
        // All materials are shared/cached — use default dispose() (keeps material).
        if (!this.mesh.isDisposed()) this.mesh.dispose();
        if (!this.pillar.isDisposed()) this.pillar.dispose();
    }
}
