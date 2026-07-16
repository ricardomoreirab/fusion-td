import { Vector3, Sprite, SpriteMaterial } from 'three';
import { Game } from '../engine/Game';
import { PowerElement } from './powers/PowerDefinitions';
import { ELEMENT_HEX } from './ElementColors';
import { DynamicTexture } from '../engine/three/DynamicTexture';
import type { SceneHost } from '../engine/three/SceneHost';

/**
 * Pre-allocated reusable damage-number slot. We keep N of these alive for the
 * lifetime of the manager and recycle them on each showDamage/showReward call.
 *
 * Why: the original implementation allocated a fresh DynamicTexture + Mesh +
 * material on every hit. During wave bursts (e.g. Frost Nova hitting
 * 20+ enemies at once) that was 20+ GPU texture uploads in one frame — the
 * dominant cause of mid-game ~1 second freezes.
 */
interface DamageNumberSlot {
    /** THREE.Sprite = always-camera-facing quad (Babylon BILLBOARDMODE_ALL plane). */
    mesh: Sprite;
    texture: DynamicTexture;
    /** Slot-owned material (flagged ownedMaterial) — its opacity is mutated per
     *  frame for the fade, which is safe because nothing else references it. */
    material: SpriteMaterial;
    inUse: boolean;
    lifetime: number;
    maxLifetime: number;
    startY: number;
    critScale: number;
    /** `text|color|fontSize` of the last drawText — identical re-shows skip the
     *  canvas redraw AND the GPU texture upload (the per-show cost that's left
     *  after pooling). Repeats are the common case: every non-crit hit of the
     *  same power renders the same string. */
    lastDrawn: string;
}

const POOL_SIZE = 24;
// Canvas resolution per pooled number. Sized generously so long strings
// ("LEVEL UP!") and large crit numbers are never clipped; drawText() auto-shrinks
// the font as a final safety net for anything still wider than the canvas.
const TEX_WIDTH = 384;
const TEX_HEIGHT = 160;
// Billboard world size. Kept at a constant 0.009375 world-units-per
// texture-pixel (TEX_WIDTH * 0.009375 = PLANE_WIDTH, same for height) so text
// renders at the EXACT same apparent size as the original 160×80 / 1.5×0.75
// setup — we only added canvas margin around the text, we did not rescale it.
// A Sprite's world size is its scale, so scale = (PLANE_WIDTH, PLANE_HEIGHT)
// at rest and is multiplied by the pop animation below.
const PLANE_WIDTH = 3.6;
const PLANE_HEIGHT = 1.5;
// Pixels kept clear around the text (also absorbs the stroke spread).
const TEXT_PAD = 10;

export class DamageNumberManager {
    private scene: SceneHost;
    private pool: DamageNumberSlot[] = [];
    private nextSlotIdx: number = 0;

    constructor(game: Game) {
        this.scene = game.getScene();

        for (let i = 0; i < POOL_SIZE; i++) {
            const texture = new DynamicTexture(`dmgTex${i}`, { width: TEX_WIDTH, height: TEX_HEIGHT });

            const material = new SpriteMaterial({
                map: texture.texture,
                transparent: true,
                depthWrite: false,
            });
            material.name = `dmgMat${i}`;

            const mesh = new Sprite(material);
            mesh.name = `dmgNum${i}`;
            mesh.scale.set(PLANE_WIDTH, PLANE_HEIGHT, 1);
            mesh.visible = false;
            mesh.userData.ownedMaterial = true; // slot-owned; freed in dispose()
            this.scene.scene.add(mesh);

            this.pool.push({
                mesh,
                texture,
                material,
                inUse: false,
                lifetime: 0,
                maxLifetime: 0,
                startY: 0,
                critScale: 1.0,
                lastDrawn: '',
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
        const key = `${text}|${color}|${fontSize}`;
        if (slot.lastDrawn === key) return; // texture already shows exactly this
        slot.lastDrawn = key;
        const ctx = slot.texture.getContext();
        ctx.clearRect(0, 0, TEX_WIDTH, TEX_HEIGHT);

        // Fit the requested font to the canvas so text is NEVER clipped: cap by
        // height first, then shrink to fit the width for long strings / huge crits.
        const maxW = TEX_WIDTH - TEXT_PAD * 2;
        const maxH = TEX_HEIGHT - TEXT_PAD * 2;
        let size = Math.min(fontSize, maxH);
        ctx.font = `bold ${size}px Arial`;
        const measured = ctx.measureText(text).width + 5; // + stroke spread
        if (measured > maxW) {
            size = Math.max(8, Math.floor((size * maxW) / measured));
            ctx.font = `bold ${size}px Arial`;
        }

        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineJoin = 'round';
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
        element?: PowerElement,
        isCrit: boolean = false,
    ): void {
        const slot = this.acquireSlot();
        const color = isCrit ? '#FFD000' : this.getColorForElement(element);
        const fontSize = isCrit ? 90 : 70;
        const text = isCrit ? `${Math.round(damage)}!` : Math.round(damage).toString();
        this.drawText(slot, text, color, fontSize);
        slot.mesh.position.x = position.x + (Math.random() - 0.5) * 0.5;
        slot.mesh.position.y = position.y + 1.5;
        slot.mesh.position.z = position.z + (Math.random() - 0.5) * 0.5;
        slot.material.opacity = 1;
        slot.inUse = true;
        slot.lifetime = 0;
        slot.maxLifetime = isCrit ? 1.1 : 0.8;
        slot.startY = slot.mesh.position.y;
        slot.critScale = isCrit ? 1.6 : 1.0;
        slot.mesh.visible = true;
    }

    /** Show arbitrary float text at a world position (used by item pickups). */
    public showText(position: Vector3, text: string, color: string = '#FFFFFF', fontSize: number = 55): void {
        const slot = this.acquireSlot();
        this.drawText(slot, text, color, fontSize);
        slot.mesh.position.x = position.x;
        slot.mesh.position.y = position.y + 1.8;
        slot.mesh.position.z = position.z;
        slot.material.opacity = 1;
        slot.inUse = true;
        slot.lifetime = 0;
        slot.maxLifetime = 1.2;
        slot.startY = slot.mesh.position.y;
        slot.critScale = 1.0;
        slot.mesh.visible = true;
    }

    public showReward(position: Vector3, reward: number): void {
        const slot = this.acquireSlot();
        this.drawText(slot, `+$${reward}`, '#FFD700', 60);
        slot.mesh.position.x = position.x;
        slot.mesh.position.y = position.y + 1.8;
        slot.mesh.position.z = position.z;
        slot.material.opacity = 1;
        slot.inUse = true;
        slot.lifetime = 0;
        slot.maxLifetime = 1.0;
        slot.startY = slot.mesh.position.y;
        slot.critScale = 1.0;
        slot.mesh.visible = true;
    }

    public update(deltaTime: number): void {
        for (let i = 0; i < this.pool.length; i++) {
            const slot = this.pool[i];
            if (!slot.inUse) continue;

            slot.lifetime += deltaTime;
            const progress = slot.lifetime / slot.maxLifetime;

            slot.mesh.position.y = slot.startY + progress * 2.0;

            if (progress > 0.5) {
                slot.material.opacity = 1 - (progress - 0.5) / 0.5;
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
            // Sprite scale IS its world size — multiply the base plane dimensions
            // by the pop factor (Babylon animated mesh.scaling on a fixed-size plane).
            slot.mesh.scale.set(PLANE_WIDTH * scale, PLANE_HEIGHT * scale, 1);

            if (progress >= 1) {
                slot.inUse = false;
                slot.mesh.visible = false;
            }
        }
    }

    private getColorForElement(element?: PowerElement): string {
        return element ? ELEMENT_HEX[element] : '#FFFFFF';
    }

    public dispose(): void {
        for (const slot of this.pool) {
            slot.mesh.removeFromParent();
            slot.material.dispose();
            slot.texture.dispose();
        }
        this.pool = [];
    }
}
