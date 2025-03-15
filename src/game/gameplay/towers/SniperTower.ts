import { Vector3, MeshBuilder, StandardMaterial, Color3 } from '@babylonjs/core';
import { Game } from '../../Game';
import { Tower } from './Tower';

export class SniperTower extends Tower {
    constructor(game: Game, position: Vector3) {
        // Sniper tower has high range, high damage, low fire rate, and medium cost
        super(game, position, 20, 30, 0.5, 100);
    }

    protected createMesh(): void {
        // Create a cylinder for the tower base
        const base = MeshBuilder.CreateCylinder('sniperBase', {
            height: 1.5,
            diameter: 1.8
        }, this.scene);
        base.position = new Vector3(this.position.x, 0.75, this.position.z);
        
        // Create a box for the tower body
        const body = MeshBuilder.CreateBox('sniperBody', {
            width: 1,
            height: 1,
            depth: 1
        }, this.scene);
        body.position = new Vector3(this.position.x, 2, this.position.z);
        
        // Create a cylinder for the barrel
        const barrel = MeshBuilder.CreateCylinder('sniperBarrel', {
            height: 3,
            diameter: 0.3
        }, this.scene);
        barrel.rotation.x = Math.PI / 2; // Rotate to be horizontal
        barrel.position = new Vector3(this.position.x, 2, this.position.z + 1.5);
        
        // Create materials
        const material = new StandardMaterial('sniperMaterial', this.scene);
        material.diffuseColor = new Color3(0.6, 0.2, 0.2); // Red
        
        base.material = material;
        body.material = material;
        barrel.material = material;
        
        // Set the main mesh for the tower (used for targeting)
        this.mesh = body;
        
        // Parent barrel to body for rotation
        barrel.parent = body;
    }
} 