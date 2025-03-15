import { Vector3, MeshBuilder, StandardMaterial, Color3 } from '@babylonjs/core';
import { Game } from '../../Game';
import { Tower } from './Tower';

export class FastTower extends Tower {
    constructor(game: Game, position: Vector3) {
        // Fast tower has low range, low damage, very high fire rate, and medium cost
        super(game, position, 8, 5, 4, 75);
    }

    protected createMesh(): void {
        // Create a cylinder for the tower base
        const base = MeshBuilder.CreateCylinder('fastBase', {
            height: 0.8,
            diameter: 1.5
        }, this.scene);
        base.position = new Vector3(this.position.x, 0.4, this.position.z);
        
        // Create a box for the tower body
        const body = MeshBuilder.CreateBox('fastBody', {
            width: 0.8,
            height: 1,
            depth: 0.8
        }, this.scene);
        body.position = new Vector3(this.position.x, 1.3, this.position.z);
        
        // Create multiple small barrels for rapid fire
        const numBarrels = 4;
        const barrelRadius = 0.4;
        
        for (let i = 0; i < numBarrels; i++) {
            const angle = (i / numBarrels) * Math.PI * 2;
            const x = Math.cos(angle) * barrelRadius;
            const z = Math.sin(angle) * barrelRadius;
            
            const barrel = MeshBuilder.CreateCylinder(`fastBarrel${i}`, {
                height: 0.8,
                diameter: 0.2
            }, this.scene);
            barrel.rotation.x = Math.PI / 2; // Rotate to be horizontal
            barrel.position = new Vector3(
                this.position.x + x,
                1.3,
                this.position.z + z
            );
            
            // Parent barrel to body for rotation
            barrel.parent = body;
        }
        
        // Create materials
        const material = new StandardMaterial('fastTowerMaterial', this.scene);
        material.diffuseColor = new Color3(0.2, 0.8, 0.2); // Green
        
        base.material = material;
        body.material = material;
        
        // Set the main mesh for the tower (used for targeting)
        this.mesh = body;
    }
} 