import { Vector3, MeshBuilder, StandardMaterial, Color3, ParticleSystem, Texture } from '@babylonjs/core';
import { Game } from '../../../Game';
import { Tower, ElementType, StatusEffect, EnemyType } from '../Tower';
import { Enemy } from '../../enemies/Enemy';

/**
 * Lava Tower - Combines Fire and Earth elements
 * - Creates lava pools that damage enemies over time
 * - Deals high damage to ground units
 * - Strong against: Wind, Plant
 * - Weak against: Water
 */
export class LavaTower extends Tower {
    /**
     * The radius of the lava pool effect
     */
    private areaOfEffect: number = 2.5;
    
    /**
     * The current lava particle system
     */
    private lavaParticles: ParticleSystem | null = null;
    
    /**
     * Constructor for the LavaTower
     * @param game The game instance
     * @param position The position of the tower
     */
    constructor(game: Game, position: Vector3) {
        // Base stats for lava tower
        const damage = 15;
        const range = 4.5;
        const fireRate = 0.8;
        const cost = 250;
        
        super(game, position, range, damage, fireRate, cost);
        
        // Set lava-specific properties
        this.secondaryEffectChance = 0.6; // 60% chance for secondary effect
        this.statusEffectDuration = 4; // 4 seconds of effect
        this.statusEffectStrength = 0.25; // 25% of damage per second for burning
        
        // Set targeting priorities
        this.targetPriorities = [
            EnemyType.WIND,
            EnemyType.PLANT
        ];
        
        // Set weaknesses
        this.weakAgainst = [
            EnemyType.WATER
        ];
        
        // Lava towers cannot target flying enemies
        this.canTargetFlying = false;
        
        // Create the tower mesh
        this.createMesh();
    }
    
    /**
     * Create the tower mesh
     */
    protected createMesh(): void {
        // Create a cylinder for the tower base
        this.mesh = MeshBuilder.CreateCylinder(
            'lavaTower',
            {
                height: 1.4,
                diameter: 1.2,
                tessellation: 12
            },
            this.scene
        );
        
        // Create a material for the tower
        const material = new StandardMaterial('lavaTowerMaterial', this.scene);
        material.diffuseColor = new Color3(0.8, 0.2, 0); // Dark red-orange
        material.specularColor = new Color3(1, 0.5, 0);
        material.emissiveColor = new Color3(0.5, 0.1, 0);
        
        // Apply the material to the mesh
        this.mesh.material = material;
        
        // Position the tower
        this.mesh.position = new Vector3(this.position.x, 0.7, this.position.z);
        
        // Create a lava particle system
        this.createLavaEffect();
    }
    
    /**
     * Create a lava particle effect around the tower
     */
    private createLavaEffect(): void {
        if (!this.mesh) return;
        
        // Create a particle system for the lava
        this.lavaParticles = new ParticleSystem('lavaParticles', 30, this.scene);
        
        // Set particle texture
        this.lavaParticles.particleTexture = new Texture('assets/textures/particle.png', this.scene);
        
        // Set emission properties
        this.lavaParticles.emitter = this.mesh;
        this.lavaParticles.minEmitBox = new Vector3(-0.5, 0.2, -0.5);
        this.lavaParticles.maxEmitBox = new Vector3(0.5, 0.8, 0.5);
        
        // Set particle properties
        this.lavaParticles.color1 = new Color3(1, 0.3, 0).toColor4(0.7);
        this.lavaParticles.color2 = new Color3(0.8, 0.1, 0).toColor4(0.7);
        this.lavaParticles.colorDead = new Color3(0.4, 0, 0).toColor4(0);
        
        this.lavaParticles.minSize = 0.2;
        this.lavaParticles.maxSize = 0.5;
        
        this.lavaParticles.minLifeTime = 1.0;
        this.lavaParticles.maxLifeTime = 2.0;
        
        this.lavaParticles.emitRate = 15;
        
        this.lavaParticles.blendMode = ParticleSystem.BLENDMODE_STANDARD;
        
        this.lavaParticles.direction1 = new Vector3(-0.2, 0.2, -0.2);
        this.lavaParticles.direction2 = new Vector3(0.2, 0.5, 0.2);
        
        this.lavaParticles.minEmitPower = 0.2;
        this.lavaParticles.maxEmitPower = 0.5;
        
        this.lavaParticles.updateSpeed = 0.01;
        
        // Start the particle system
        this.lavaParticles.start();
    }
    
    /**
     * Fire at the current target
     */
    protected fire(): void {
        if (!this.targetEnemy) return;
        
        // Create a lava pool at the target position
        this.createLavaPool(this.targetEnemy.getPosition());
        
        // Get all enemies in range of the lava pool
        const enemiesInRange = this.getEnemiesInRange(this.targetEnemy.getPosition(), this.areaOfEffect);
        
        // Deal damage to all enemies in range
        for (const enemy of enemiesInRange) {
            // Skip flying enemies
            if (enemy.getEnemyType() === EnemyType.FLYING) {
                continue;
            }
            
            // Calculate damage based on elemental strengths/weaknesses
            let finalDamage = this.calculateDamage(enemy);
            
            // Deal damage to the enemy
            enemy.takeDamage(finalDamage);
            
            // Apply primary effect (burning)
            this.applyStatusEffect(
                enemy,
                StatusEffect.BURNING,
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
     * Create a lava pool effect at the target position
     * @param position The position for the lava pool
     */
    private createLavaPool(position: Vector3): void {
        // Create a particle system for the lava pool
        const lavaPool = new ParticleSystem('lavaPool', 80, this.scene);
        
        // Set particle texture
        lavaPool.particleTexture = new Texture('assets/textures/particle.png', this.scene);
        
        // Set emission properties
        lavaPool.emitter = new Vector3(position.x, 0.1, position.z); // Just above ground
        lavaPool.minEmitBox = new Vector3(-this.areaOfEffect/2, 0, -this.areaOfEffect/2);
        lavaPool.maxEmitBox = new Vector3(this.areaOfEffect/2, 0.1, this.areaOfEffect/2);
        
        // Set particle properties
        lavaPool.color1 = new Color3(1, 0.3, 0).toColor4(0.8);
        lavaPool.color2 = new Color3(0.8, 0.1, 0).toColor4(0.8);
        lavaPool.colorDead = new Color3(0.4, 0, 0).toColor4(0);
        
        lavaPool.minSize = 0.3;
        lavaPool.maxSize = 0.7;
        
        lavaPool.minLifeTime = 1.5;
        lavaPool.maxLifeTime = 3.0;
        
        lavaPool.emitRate = 40;
        
        lavaPool.blendMode = ParticleSystem.BLENDMODE_STANDARD;
        
        lavaPool.direction1 = new Vector3(-0.1, 0.2, -0.1);
        lavaPool.direction2 = new Vector3(0.1, 0.4, 0.1);
        
        lavaPool.minEmitPower = 0.1;
        lavaPool.maxEmitPower = 0.3;
        
        lavaPool.updateSpeed = 0.01;
        
        // Start the particle system
        lavaPool.start();
        
        // Stop and dispose after a short time
        setTimeout(() => {
            lavaPool.stop();
            setTimeout(() => {
                lavaPool.dispose();
            }, 3000);
        }, 2000);
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
     * Calculate damage based on elemental strengths/weaknesses
     * @param enemy The target enemy
     * @returns The calculated damage
     */
    protected calculateDamage(enemy: Enemy): number {
        let damage = super.calculateDamage(enemy);
        
        // Lava towers deal extra damage to ground units
        if (enemy.getEnemyType() !== EnemyType.FLYING) {
            damage *= 1.3; // 30% extra damage to ground units
        }
        
        return damage;
    }
    
    /**
     * Dispose of the tower and its resources
     */
    public dispose(): void {
        // Dispose of the lava particles
        if (this.lavaParticles) {
            this.lavaParticles.stop();
            this.lavaParticles.dispose();
            this.lavaParticles = null;
        }
        
        // Call the parent dispose method
        super.dispose();
    }
} 