import { Vector3, MeshBuilder, StandardMaterial, Color3 } from '@babylonjs/core';
import { Game } from '../../Game';
import { Enemy } from './Enemy';

export class BossEnemy extends Enemy {
    constructor(game: Game, position: Vector3, path: Vector3[]) {
        // Boss enemy has very low speed, extremely high health, high damage, and very high reward
        super(game, position, path, 0.7, 300, 30, 100);
    }

    protected createMesh(): void {
        // Create a larger sphere for the boss enemy
        const body = MeshBuilder.CreateSphere('bossBody', {
            diameter: 3
        }, this.scene);
        body.position = this.position.clone();
        
        // Create spikes on the boss
        const numSpikes = 8;
        for (let i = 0; i < numSpikes; i++) {
            const angle = (i / numSpikes) * Math.PI * 2;
            const x = Math.cos(angle) * 1.5;
            const z = Math.sin(angle) * 1.5;
            
            const spike = MeshBuilder.CreateCylinder(`bossSpike${i}`, {
                height: 1.5,
                diameterTop: 0,
                diameterBottom: 0.7
            }, this.scene);
            
            // Position and rotate the spike
            spike.position = new Vector3(
                this.position.x + x,
                this.position.y,
                this.position.z + z
            );
            
            // Point the spike outward
            const direction = new Vector3(x, 0, z).normalize();
            const rotationAxis = Vector3.Cross(Vector3.Up(), direction);
            const rotationAngle = Math.acos(Vector3.Dot(Vector3.Up(), direction));
            spike.rotate(rotationAxis, rotationAngle);
            
            // Create material for the spike
            const spikeMaterial = new StandardMaterial(`bossSpikeMaterial${i}`, this.scene);
            spikeMaterial.diffuseColor = new Color3(0.7, 0.2, 0);
            spike.material = spikeMaterial;
        }
        
        // Create material for the boss
        const material = new StandardMaterial('bossMaterial', this.scene);
        material.diffuseColor = new Color3(0.8, 0, 0);
        material.specularColor = new Color3(1, 0.5, 0.5);
        body.material = material;
        
        // Set the main mesh
        this.mesh = body;
    }
} 