import { Vector3, MeshBuilder, StandardMaterial, Color3 } from '@babylonjs/core';
import { Game } from '../../Game';
import { Tower } from './Tower';

export class BasicTower extends Tower {
    constructor(game: Game, position: Vector3) {
        // Basic tower has medium range, medium damage, medium fire rate, and low cost
        super(game, position, 10, 10, 1, 50);
    }

    /**
     * Create the tower mesh
     */
    protected createMesh(): void {
        // Create a simple cylinder for the tower base
        const base = MeshBuilder.CreateCylinder('towerBase', {
            height: 1,
            diameter: 2
        }, this.scene);
        base.position = new Vector3(this.position.x, 0.5, this.position.z);
        
        // Create a box for the tower turret
        const turret = MeshBuilder.CreateBox('towerTurret', {
            width: 1,
            height: 0.5,
            depth: 1.5
        }, this.scene);
        turret.position = new Vector3(this.position.x, 1.25, this.position.z);
        
        // Create material for the tower
        const material = new StandardMaterial('towerMaterial', this.scene);
        material.diffuseColor = new Color3(0.2, 0.4, 0.8);
        base.material = material;
        turret.material = material;
        
        // Set the main mesh for the tower (used for targeting)
        this.mesh = turret;
    }

    /**
     * Update tower visuals after upgrade
     */
    protected updateVisuals(): void {
        if (!this.mesh) return;
        
        // Find the turret
        const turret = this.scene.getMeshByName('towerTurret');
        if (turret && turret.parent === this.mesh) {
            // Scale up the turret based on level
            const scale = 1 + (this.level - 1) * 0.2;
            turret.scaling.setAll(scale);
            
            // Update color based on level
            const material = turret.material as StandardMaterial;
            if (material) {
                // Make it more red as it levels up
                const greenValue = Math.max(0.1, 0.8 - (this.level - 1) * 0.15);
                const redValue = Math.min(1, 0.1 + (this.level - 1) * 0.2);
                material.diffuseColor = new Color3(redValue, greenValue, 0.1);
            }
        }
    }
} 