import { Vector3, MeshBuilder, StandardMaterial, Color3 } from '@babylonjs/core';
import { Game } from '../../Game';
import { Tower } from './Tower';

export class AOETower extends Tower {
    constructor(game: Game, position: Vector3) {
        // AOE tower has medium range, low damage, high fire rate, and high cost
        super(game, position, 15, 5, 2, 150);
    }

    protected createMesh(): void {
        // Create a cylinder for the tower base
        const base = MeshBuilder.CreateCylinder('aoeBase', {
            height: 1,
            diameter: 2.5
        }, this.scene);
        base.position = new Vector3(this.position.x, 0.5, this.position.z);
        
        // Create a sphere for the tower body
        const body = MeshBuilder.CreateSphere('aoeBody', {
            diameter: 1.5
        }, this.scene);
        body.position = new Vector3(this.position.x, 1.75, this.position.z);
        
        // Create smaller spheres around the main sphere
        const orbitRadius = 1;
        const numOrbiters = 4;
        
        for (let i = 0; i < numOrbiters; i++) {
            const angle = (i / numOrbiters) * Math.PI * 2;
            const x = this.position.x + Math.cos(angle) * orbitRadius;
            const z = this.position.z + Math.sin(angle) * orbitRadius;
            
            const orbiter = MeshBuilder.CreateSphere(`aoeOrbiter${i}`, {
                diameter: 0.5
            }, this.scene);
            orbiter.position = new Vector3(x, 1.75, z);
            
            // Create material for the orbiter
            const orbiterMaterial = new StandardMaterial(`aoeOrbiterMaterial${i}`, this.scene);
            orbiterMaterial.diffuseColor = new Color3(0, 0.8, 0.8);
            orbiterMaterial.emissiveColor = new Color3(0, 0.4, 0.4);
            orbiter.material = orbiterMaterial;
        }
        
        // Create materials
        const baseMaterial = new StandardMaterial('aoeBaseMaterial', this.scene);
        baseMaterial.diffuseColor = new Color3(0.3, 0.3, 0.6);
        base.material = baseMaterial;
        
        const bodyMaterial = new StandardMaterial('aoeBodyMaterial', this.scene);
        bodyMaterial.diffuseColor = new Color3(0.1, 0.1, 0.8);
        bodyMaterial.emissiveColor = new Color3(0, 0, 0.3);
        body.material = bodyMaterial;
        
        // Set the main mesh for the tower (used for targeting)
        this.mesh = body;
    }
} 