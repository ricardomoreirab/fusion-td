import { Vector3, Mesh, MeshBuilder, StandardMaterial, DynamicTexture, Scene, Color3 } from '@babylonjs/core';
import { Game } from '../Game';
import { ElementType } from './towers/Tower';

interface DamageNumber {
    mesh: Mesh;
    lifetime: number;
    maxLifetime: number;
    startY: number;
}

export class DamageNumberManager {
    private game: Game;
    private scene: Scene;
    private activeNumbers: DamageNumber[] = [];

    constructor(game: Game) {
        this.game = game;
        this.scene = game.getScene();
    }

    public showDamage(position: Vector3, damage: number, elementType: ElementType = ElementType.NONE): void {
        const color = this.getColorForElement(elementType);
        const text = Math.round(damage).toString();

        // Create dynamic texture for the text
        const textureSize = 128;
        const texture = new DynamicTexture('dmgTex', { width: textureSize, height: 64 }, this.scene, false);
        texture.hasAlpha = true;

        const ctx = texture.getContext() as any;
        ctx.clearRect(0, 0, textureSize, 64);

        // Draw text with outline
        ctx.font = 'bold 56px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        // Black outline
        ctx.strokeStyle = 'black';
        ctx.lineWidth = 5;
        ctx.strokeText(text, textureSize / 2, 32);

        // Colored fill
        ctx.fillStyle = color;
        ctx.fillText(text, textureSize / 2, 32);

        texture.update();

        // Create a plane that billboards toward camera
        const plane = MeshBuilder.CreatePlane('dmgNum', { width: 1.2, height: 0.6 }, this.scene);
        plane.position = new Vector3(
            position.x + (Math.random() - 0.5) * 0.5,
            position.y + 1.5,
            position.z + (Math.random() - 0.5) * 0.5
        );
        plane.billboardMode = Mesh.BILLBOARDMODE_ALL;

        const material = new StandardMaterial('dmgMat', this.scene);
        material.diffuseTexture = texture;
        material.emissiveColor = new Color3(1, 1, 1);
        material.disableLighting = true;
        material.useAlphaFromDiffuseTexture = true;
        material.backFaceCulling = false;
        plane.material = material;

        this.activeNumbers.push({
            mesh: plane,
            lifetime: 0,
            maxLifetime: 0.8,
            startY: plane.position.y
        });
    }

    public update(deltaTime: number): void {
        const toRemove: number[] = [];

        for (let i = 0; i < this.activeNumbers.length; i++) {
            const dn = this.activeNumbers[i];
            dn.lifetime += deltaTime;

            const progress = dn.lifetime / dn.maxLifetime;

            // Float upward
            dn.mesh.position.y = dn.startY + progress * 2.0;

            // Fade out in the second half
            if (progress > 0.5) {
                const fadeProgress = (progress - 0.5) / 0.5;
                (dn.mesh.material as StandardMaterial).alpha = 1 - fadeProgress;
            }

            // Pop-in scale: 0 → 1.5 → 1.0 in first 200ms (25% of 0.8s lifetime)
            let scale: number;
            const popDuration = 0.25; // 25% of lifetime
            if (progress < popDuration / 2) {
                // Scale from 0 to 1.5
                scale = (progress / (popDuration / 2)) * 1.5;
            } else if (progress < popDuration) {
                // Scale from 1.5 back to 1.0
                const t = (progress - popDuration / 2) / (popDuration / 2);
                scale = 1.5 - t * 0.5;
            } else {
                scale = 1.0;
            }
            dn.mesh.scaling.setAll(scale);

            if (progress >= 1) {
                toRemove.push(i);
            }
        }

        // Remove expired numbers (iterate backwards)
        for (let i = toRemove.length - 1; i >= 0; i--) {
            const dn = this.activeNumbers[toRemove[i]];
            dn.mesh.dispose();
            (dn.mesh.material as StandardMaterial)?.dispose();
            this.activeNumbers.splice(toRemove[i], 1);
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
        for (const dn of this.activeNumbers) {
            dn.mesh.dispose();
            (dn.mesh.material as StandardMaterial)?.dispose();
        }
        this.activeNumbers = [];
    }
}
