import { Vector3, MeshBuilder, StandardMaterial, Color3, Color4, ParticleSystem, Texture } from '@babylonjs/core';
import { Game } from '../../Game';
import { Enemy } from './Enemy';

export class BasicEnemy extends Enemy {
    constructor(game: Game, position: Vector3, path: Vector3[]) {
        // Basic enemy has medium speed, low health, low damage, and low reward
        super(game, position, path, 3, 30, 10, 10);
    }

    /**
     * Create the enemy mesh
     */
    protected createMesh(): void {
        // Create a simple sphere for the enemy
        this.mesh = MeshBuilder.CreateSphere('basicEnemy', {
            diameter: 0.8
        }, this.scene);
        
        // Position at starting position
        this.mesh.position = this.position.clone();
        
        // Create material
        const material = new StandardMaterial('basicEnemyMaterial', this.scene);
        material.diffuseColor = new Color3(0.8, 0.2, 0.2); // Red color
        this.mesh.material = material;
    }

    /**
     * Create a death effect
     */
    protected createDeathEffect(): void {
        if (!this.mesh) return;
        
        // Create a simple explosion effect
        const particleSystem = new ParticleSystem('deathParticles', 50, this.scene);
        
        // Set particle texture
        particleSystem.particleTexture = new Texture('assets/textures/particle.png', this.scene);
        
        // Set emission properties
        particleSystem.emitter = this.position.clone();
        particleSystem.minEmitBox = new Vector3(-0.2, 0, -0.2);
        particleSystem.maxEmitBox = new Vector3(0.2, 0, 0.2);
        
        // Set particle properties
        particleSystem.color1 = new Color4(1, 0.5, 0, 1.0);
        particleSystem.color2 = new Color4(1, 0, 0, 1.0);
        particleSystem.colorDead = new Color4(0, 0, 0, 0.0);
        
        particleSystem.minSize = 0.1;
        particleSystem.maxSize = 0.5;
        
        particleSystem.minLifeTime = 0.3;
        particleSystem.maxLifeTime = 1.0;
        
        particleSystem.emitRate = 100;
        
        particleSystem.blendMode = ParticleSystem.BLENDMODE_ONEONE;
        
        particleSystem.gravity = new Vector3(0, 8, 0);
        
        particleSystem.direction1 = new Vector3(-1, 8, -1);
        particleSystem.direction2 = new Vector3(1, 8, 1);
        
        particleSystem.minAngularSpeed = 0;
        particleSystem.maxAngularSpeed = Math.PI;
        
        particleSystem.minEmitPower = 1;
        particleSystem.maxEmitPower = 3;
        particleSystem.updateSpeed = 0.01;
        
        // Start the particle system
        particleSystem.start();
        
        // Stop and dispose after 1 second
        setTimeout(() => {
            particleSystem.stop();
            setTimeout(() => {
                particleSystem.dispose();
            }, 1000);
        }, 1000);
    }
} 