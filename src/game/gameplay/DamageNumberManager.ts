import { Vector3, Mesh, MeshBuilder, StandardMaterial, DynamicTexture, Scene, Color3 } from '@babylonjs/core';
import { Game } from '../Game';
import { ElementType } from './GameTypes';

/**
 * Pre-allocated reusable damage-number slot. We keep N of these alive for the
 * lifetime of the manager and recycle them on each showDamage/showReward call.
 *
 * Why: the original implementation allocated a fresh DynamicTexture + Mesh +
 * StandardMaterial on every hit. During wave bursts (e.g. Frost Nova hitting
 * 20+ enemies at once) that was 20+ GPU texture uploads in one frame — the
 * dominant cause of mid-game ~1 second freezes.
 */
interface DamageNumberSlot {
    mesh: Mesh;
    texture: DynamicTexture;
    material: StandardMaterial;
    inUse: boolean;
    lifetime: number;
    maxLifetime: number;
    startY: number;
    critScale: number;
}

const POOL_SIZE = 24;
const TEX_WIDTH = 160;
const TEX_HEIGHT = 80;

export class DamageNumberManager {
    private scene: Scene;
    private pool: DamageNumberSlot[] = [];
    private nextSlotIdx: number = 0;

    constructor(game: Game) {
        this.scene = game.getScene();

        for (let i = 0; i < POOL_SIZE; i++) {
            const texture = new DynamicTexture(`dmgTex${i}`, { width: TEX_WIDTH, height: TEX_HEIGHT }, this.scene, false);
            texture.hasAlpha = true;

            const material = new StandardMaterial(`dmgMat${i}`, this.scene);
            material.diffuseTexture = texture;
            material.emissiveColor = new Color3(1, 1, 1);
            material.disableLighting = true;
            material.useAlphaFromDiffuseTexture = true;
            material.backFaceCulling = false;

            const mesh = MeshBuilder.CreatePlane(`dmgNum${i}`, { width: 1.5, height: 0.75 }, this.scene);
            mesh.billboardMode = Mesh.BILLBOARDMODE_ALL;
            mesh.material = material;
            mesh.setEnabled(false);

            this.pool.push({
                mesh,
                texture,
                material,
                inUse: false,
                lifetime: 0,
                maxLifetime: 0,
                startY: 0,
                critScale: 1.0,
            });
        }
    }

    /**
     * Take a slot from the pool. If everything is in use, recycle the oldest
     * one — bursting beyond POOL_SIZE simultaneously is rare and dropping a
     * stale floating number is better than allocating new GPU resources.
     */
    private acquireSlot(): DamageNumberSlot {
        for (let i = 0; i < POOL_SIZE; i++) {
            const idx = (this.nextSlotIdx + i) % POOL_SIZE;
            if (!this.pool[idx].inUse) {
                this.nextSlotIdx = (idx + 1) % POOL_SIZE;
                return this.pool[idx];
            }
        }
        const slot = this.pool[this.nextSlotIdx];
        this.nextSlotIdx = (this.nextSlotIdx + 1) % POOL_SIZE;
        return slot;
    }

    private drawText(slot: DamageNumberSlot, text: string, color: string, fontSize: number): void {
        const ctx = slot.texture.getContext() as CanvasRenderingContext2D;
        ctx.clearRect(0, 0, TEX_WIDTH, TEX_HEIGHT);
        ctx.font = `bold ${fontSize}px Arial`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.strokeStyle = 'black';
        ctx.lineWidth = 5;
        ctx.strokeText(text, TEX_WIDTH / 2, TEX_HEIGHT / 2);
        ctx.fillStyle = color;
        ctx.fillText(text, TEX_WIDTH / 2, TEX_HEIGHT / 2);
        slot.texture.update();
    }

    public showDamage(
        position: Vector3,
        damage: number,
        elementType: ElementType = ElementType.NONE,
        isCrit: boolean = false,
    ): void {
        const slot = this.acquireSlot();
        const color = isCrit ? '#FFD000' : this.getColorForElement(elementType);
        const fontSize = isCrit ? 90 : 70;
        const text = isCrit ? `${Math.round(damage)}!` : Math.round(damage).toString();
        this.drawText(slot, text, color, fontSize);
        slot.mesh.position.x = position.x + (Math.random() - 0.5) * 0.5;
        slot.mesh.position.y = position.y + 1.5;
        slot.mesh.position.z = position.z + (Math.random() - 0.5) * 0.5;
        slot.material.alpha = 1;
        slot.inUse = true;
        slot.lifetime = 0;
        slot.maxLifetime = isCrit ? 1.1 : 0.8;
        slot.startY = slot.mesh.position.y;
        slot.critScale = isCrit ? 1.6 : 1.0;
        slot.mesh.setEnabled(true);
    }

    /** Show arbitrary float text at a world position (used by item pickups). */
    public showText(position: Vector3, text: string, color: string = '#FFFFFF', fontSize: number = 55): void {
        const slot = this.acquireSlot();
        this.drawText(slot, text, color, fontSize);
        slot.mesh.position.x = position.x;
        slot.mesh.position.y = position.y + 1.8;
        slot.mesh.position.z = position.z;
        slot.material.alpha = 1;
        slot.inUse = true;
        slot.lifetime = 0;
        slot.maxLifetime = 1.2;
        slot.startY = slot.mesh.position.y;
        slot.critScale = 1.0;
        slot.mesh.setEnabled(true);
    }

    public showReward(position: Vector3, reward: number): void {
        const slot = this.acquireSlot();
        this.drawText(slot, `+$${reward}`, '#FFD700', 60);
        slot.mesh.position.x = position.x;
        slot.mesh.position.y = position.y + 1.8;
        slot.mesh.position.z = position.z;
        slot.material.alpha = 1;
        slot.inUse = true;
        slot.lifetime = 0;
        slot.maxLifetime = 1.0;
        slot.startY = slot.mesh.position.y;
        slot.critScale = 1.0;
        slot.mesh.setEnabled(true);
    }

    public update(deltaTime: number): void {
        for (let i = 0; i < this.pool.length; i++) {
            const slot = this.pool[i];
            if (!slot.inUse) continue;

            slot.lifetime += deltaTime;
            const progress = slot.lifetime / slot.maxLifetime;

            slot.mesh.position.y = slot.startY + progress * 2.0;

            if (progress > 0.5) {
                slot.material.alpha = 1 - (progress - 0.5) / 0.5;
            }

            const popDuration = 0.25;
            const restScale = slot.critScale;
            const peakScale = restScale * 1.5;
            let scale: number;
            if (progress < popDuration / 2) {
                scale = (progress / (popDuration / 2)) * peakScale;
            } else if (progress < popDuration) {
                const t = (progress - popDuration / 2) / (popDuration / 2);
                scale = peakScale - t * (peakScale - restScale);
            } else {
                scale = restScale;
            }
            slot.mesh.scaling.setAll(scale);

            if (progress >= 1) {
                slot.inUse = false;
                slot.mesh.setEnabled(false);
            }
        }
    }

    private getColorForElement(elementType: ElementType): string {
        switch (elementType) {
            case ElementType.FIRE: return '#FF6633';
            case ElementType.WATER: return '#3399FF';
            case ElementType.WIND: return '#99FF66';
            case ElementType.EARTH: return '#CC9933';
            default: return '#FFFFFF';
        }
    }

    public dispose(): void {
        for (const slot of this.pool) {
            slot.mesh.dispose();
            slot.material.dispose();
            slot.texture.dispose();
        }
        this.pool = [];
    }
}
