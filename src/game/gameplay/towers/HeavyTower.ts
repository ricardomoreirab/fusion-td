import { Vector3, MeshBuilder, StandardMaterial, Color3 } from '@babylonjs/core';
import { Game } from '../../Game';
import { Tower } from './Tower';

export class HeavyTower extends Tower {
    constructor(game: Game, position: Vector3) {
        // Heavy tower has medium range, very high damage, very low fire rate, and high cost
        super(game, position, 12, 40, 0.3, 125);
    }

    protected createMesh(): void {
        // Create a cylinder for the tower base
        const base = MeshBuilder.CreateCylinder('heavyBase', {
            height: 1.2,
            diameter: 2.2
        }, this.scene);
        base.position = new Vector3(this.position.x, 0.6, this.position.z);
        
        // Create a box for the tower body
        const body = MeshBuilder.CreateBox('heavyBody', {
            width: 1.5,
            height: 1.2,
            depth: 1.5
        }, this.scene);
        body.position = new Vector3(this.position.x, 1.8, this.position.z);
        
        // Create a large barrel
        const barrel = MeshBuilder.CreateCylinder('heavyBarrel', {
            height: 2.5,
            diameter: 0.8
        }, this.scene);
        barrel.rotation.x = Math.PI / 2; // Rotate to be horizontal
        barrel.position = new Vector3(this.position.x, 1.8, this.position.z + 1.25);
        
        // Create materials
        const baseMaterial = new StandardMaterial('heavyBaseMaterial', this.scene);
        baseMaterial.diffuseColor = new Color3(0.4, 0.4, 0.4); // Dark gray
        base.material = baseMaterial;
        
        const bodyMaterial = new StandardMaterial('heavyBodyMaterial', this.scene);
        bodyMaterial.diffuseColor = new Color3(0.6, 0.3, 0); // Brown
        body.material = bodyMaterial;
        
        const barrelMaterial = new StandardMaterial('heavyBarrelMaterial', this.scene);
        barrelMaterial.diffuseColor = new Color3(0.3, 0.3, 0.3); // Darker gray
        barrel.material = barrelMaterial;
        
        // Set the main mesh for the tower (used for targeting)
        this.mesh = body;
        
        // Parent barrel to body for rotation
        barrel.parent = body;
    }
} 