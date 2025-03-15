import { Vector3, MeshBuilder, StandardMaterial, Color3, ParticleSystem, Texture } from '@babylonjs/core';
import { Game } from '../../../Game';
import { Tower, ElementType, StatusEffect, EnemyType } from '../Tower';
import { Enemy } from '../../enemies/Enemy';

/**
 * Dust Tower - Combines Earth and Wind elements
 * - Creates dust clouds that confuse and damage enemies
 * - Has a chance to stun enemies
 * - Strong against: Fire, Electric
 * - Weak against: Water, Flying
 */
export class DustTower extends Tower {
    /**
     * The radius of the dust cloud effect
     */
    private areaOfEffect: number = 3.5;
    
    /**
     * The current dust particle system
     */
    private dustParticles: ParticleSystem | null = null;
    
    /**
     * Constructor for the DustTower
     * @param game The game instance
     * @param position The position of the tower
     */
    constructor(game: Game, position: Vector3) {
        // Base stats for dust tower
        const damage = 7;
        const range = 6;
        const fireRate = 1.2;
        const cost = 225;
        
        super(game, position, range, damage, fireRate, cost);
        
        // Set dust-specific properties
        this.secondaryEffectChance = 0.3; // 30% chance for secondary effect
        this.statusEffectDuration = 2.5; // 2.5 seconds of effect
        this.statusEffectStrength = 0.8; // 80% confusion strength
        
        // Set targeting priorities
        this.targetPriorities = [
            EnemyType.FIRE,
            EnemyType.ELECTRIC
        ];
        
        // Set weaknesses
        this.weakAgainst = [
            EnemyType.WATER,
            EnemyType.FLYING
        ];
        
        // Create the tower mesh
        this.createMesh();
    }
    
    /**
     * Create the tower mesh
     */
    protected createMesh(): void {
        // Create a cylinder for the tower base
        this.mesh = MeshBuilder.CreateCylinder(
            'dustTower',
            {
                height: 1.8,
                diameter: 1.0,
                tessellation: 10
            },
            this.scene
        );
        
        // Create a material for the tower
        const material = new StandardMaterial('dustTowerMaterial', this.scene);
        material.diffuseColor = new Color3(0.6, 0.5, 0.4); // Tan/dust color
        material.specularColor = new Color3(0.3, 0.3, 0.3);
        material.emissiveColor = new Color3(0.1, 0.1, 0.05);
        
        // Apply the material to the mesh
        this.mesh.material = material;
        
        // Position the tower
        this.mesh.position = new Vector3(this.position.x, 0.9, this.position.z);
        
        // Create a dust particle system
        this.createDustEffect();
    }
    
    /**
     * Create a dust particle effect around the tower
     */
    private createDustEffect(): void {
        if (!this.mesh) return;
        
        // Create a particle system for the dust
        this.dustParticles = new ParticleSystem('dustParticles', 40, this.scene);
        
        // Set particle texture
        this.dustParticles.particleTexture = new Texture('assets/textures/particle.png', this.scene);
        
        // Set emission properties
        this.dustParticles.emitter = this.mesh;
        this.dustParticles.minEmitBox = new Vector3(-0.5, 0.2, -0.5);
        this.dustParticles.maxEmitBox = new Vector3(0.5, 1.0, 0.5);
        
        // Set particle properties
        this.dustParticles.color1 = new Color3(0.7, 0.6, 0.5).toColor4(0.5);
        this.dustParticles.color2 = new Color3(0.6, 0.5, 0.4).toColor4(0.5);
        this.dustParticles.colorDead = new Color3(0.5, 0.4, 0.3).toColor4(0);
        
        this.dustParticles.minSize = 0.1;
        this.dustParticles.maxSize = 0.3;
        
        this.dustParticles.minLifeTime = 1.0;
        this.dustParticles.maxLifeTime = 2.0;
        
        this.dustParticles.emitRate = 15;
        
        this.dustParticles.blendMode = ParticleSystem.BLENDMODE_STANDARD;
        
        this.dustParticles.direction1 = new Vector3(-0.3, 0.2, -0.3);
        this.dustParticles.direction2 = new Vector3(0.3, 0.5, 0.3);
        
        this.dustParticles.minEmitPower = 0.3;
        this.dustParticles.maxEmitPower = 0.7;
        
        this.dustParticles.updateSpeed = 0.01;
        
        // Start the particle system
        this.dustParticles.start();
    }
    
    /**
     * Fire at the current target
     */
    protected fire(): void {
        if (!this.targetEnemy) return;
        
        // Create a dust cloud at the target position
        this.createDustCloud(this.targetEnemy.getPosition());
        
        // Get all enemies in range of the dust cloud
        const enemiesInRange = this.getEnemiesInRange(this.targetEnemy.getPosition(), this.areaOfEffect);
        
        // Deal damage to all enemies in range
        for (const enemy of enemiesInRange) {
            // Calculate damage based on elemental strengths/weaknesses
            let finalDamage = this.calculateDamage(enemy);
            
            // Deal damage to the enemy
            enemy.takeDamage(finalDamage);
            
            // Apply primary effect (confusion)
            this.applyStatusEffect(
                enemy,
                StatusEffect.CONFUSED,
                this.statusEffectDuration,
                this.statusEffectStrength
            );
            
            // Check for secondary effect (stun)
            if (Math.random() < this.secondaryEffectChance) {
                this.applyStatusEffect(
                    enemy,
                    StatusEffect.STUNNED,
                    0.5, // 0.5 seconds of stunning
                    1.0 // 100% stun (complete stop)
                );
            }
        }
        
        // Play sound
        this.game.getAssetManager().playSound('towerShoot');
    }
    
    /**
     * Create a dust cloud effect at the target position
     * @param position The position for the dust cloud
     */
    private createDustCloud(position: Vector3): void {
        // Create a particle system for the dust cloud
        const dustCloud = new ParticleSystem('dustCloud', 100, this.scene);
        
        // Set particle texture
        dustCloud.particleTexture = new Texture('assets/textures/particle.png', this.scene);
        
        // Set emission properties
        dustCloud.emitter = new Vector3(position.x, 0.5, position.z);
        dustCloud.minEmitBox = new Vector3(-this.areaOfEffect/2, 0, -this.areaOfEffect/2);
        dustCloud.maxEmitBox = new Vector3(this.areaOfEffect/2, 1, this.areaOfEffect/2);
        
        // Set particle properties
        dustCloud.color1 = new Color3(0.7, 0.6, 0.5).toColor4(0.7);
        dustCloud.color2 = new Color3(0.6, 0.5, 0.4).toColor4(0.7);
        dustCloud.colorDead = new Color3(0.5, 0.4, 0.3).toColor4(0);
        
        dustCloud.minSize = 0.2;
        dustCloud.maxSize = 0.5;
        
        dustCloud.minLifeTime = 1.5;
        dustCloud.maxLifeTime = 2.5;
        
        dustCloud.emitRate = 50;
        
        dustCloud.blendMode = ParticleSystem.BLENDMODE_STANDARD;
        
        dustCloud.direction1 = new Vector3(-0.5, 0.2, -0.5);
        dustCloud.direction2 = new Vector3(0.5, 0.8, 0.5);
        
        dustCloud.minEmitPower = 0.5;
        dustCloud.maxEmitPower = 1.0;
        
        dustCloud.updateSpeed = 0.01;
        
        // Start the particle system
        dustCloud.start();
        
        // Stop and dispose after a short time
        setTimeout(() => {
            dustCloud.stop();
            setTimeout(() => {
                dustCloud.dispose();
            }, 2500);
        }, 500);
    }
    
    /**
     * Get all enemies within a certain range of a position
     * @param position The center position
     * @param radius The radius to check
     * @returns Array of enemies within range
     */
    private getEnemiesInRange(position: Vector3, radius: number): Enemy[] {
        // This would normally be handled by the EnemyManager
        // For now, we'll just return the current target
        if (this.targetEnemy) {
            return [this.targetEnemy];
        }
        return [];
    }
    
    /**
     * Dispose of the tower and its resources
     */
    public dispose(): void {
        // Dispose of the dust particles
        if (this.dustParticles) {
            this.dustParticles.stop();
            this.dustParticles.dispose();
            this.dustParticles = null;
        }
        
        // Call the parent dispose method
        super.dispose();
    }
} 