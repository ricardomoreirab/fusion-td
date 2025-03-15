import { Vector3, MeshBuilder, StandardMaterial, Color3, ParticleSystem, Texture } from '@babylonjs/core';
import { Game } from '../../../Game';
import { Tower, ElementType, StatusEffect, EnemyType } from '../Tower';
import { Enemy } from '../../enemies/Enemy';

/**
 * Mud Tower - Combines Earth and Water elements
 * - Creates mud that slows enemies and reduces their armor
 * - Effective against ground units
 * - Strong against: Fire, Heavy
 * - Weak against: Wind, Flying
 */
export class MudTower extends Tower {
    /**
     * The radius of the mud effect
     */
    private areaOfEffect: number = 3;
    
    /**
     * The current mud particle system
     */
    private mudParticles: ParticleSystem | null = null;
    
    /**
     * Tracks enemies affected by the armor reduction
     */
    private armorReducedEnemies: Map<Enemy, number> = new Map();
    
    /**
     * Constructor for the MudTower
     * @param game The game instance
     * @param position The position of the tower
     */
    constructor(game: Game, position: Vector3) {
        // Base stats for mud tower
        const damage = 8;
        const range = 5;
        const fireRate = 1.0;
        const cost = 200;
        
        super(game, position, range, damage, fireRate, cost);
        
        // Set mud-specific properties
        this.secondaryEffectChance = 0.5; // 50% chance for secondary effect
        this.statusEffectDuration = 3; // 3 seconds of effect
        this.statusEffectStrength = 0.5; // 50% slow
        
        // Set targeting priorities
        this.targetPriorities = [
            EnemyType.FIRE,
            EnemyType.HEAVY
        ];
        
        // Set weaknesses
        this.weakAgainst = [
            EnemyType.WIND,
            EnemyType.FLYING
        ];
        
        // Mud towers cannot target flying enemies
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
            'mudTower',
            {
                height: 1.0,
                diameter: 1.2,
                tessellation: 12
            },
            this.scene
        );
        
        // Create a material for the tower
        const material = new StandardMaterial('mudTowerMaterial', this.scene);
        material.diffuseColor = new Color3(0.4, 0.3, 0.2); // Brown
        material.specularColor = new Color3(0.2, 0.2, 0.2);
        material.emissiveColor = new Color3(0.1, 0.05, 0);
        
        // Apply the material to the mesh
        this.mesh.material = material;
        
        // Position the tower
        this.mesh.position = new Vector3(this.position.x, 0.5, this.position.z);
        
        // Create a mud particle system
        this.createMudEffect();
    }
    
    /**
     * Create a mud particle effect around the tower
     */
    private createMudEffect(): void {
        if (!this.mesh) return;
        
        // Create a particle system for the mud
        this.mudParticles = new ParticleSystem('mudParticles', 30, this.scene);
        
        // Set particle texture
        this.mudParticles.particleTexture = new Texture('assets/textures/particle.png', this.scene);
        
        // Set emission properties
        this.mudParticles.emitter = this.mesh;
        this.mudParticles.minEmitBox = new Vector3(-0.5, 0, -0.5);
        this.mudParticles.maxEmitBox = new Vector3(0.5, 0.2, 0.5);
        
        // Set particle properties
        this.mudParticles.color1 = new Color3(0.4, 0.3, 0.2).toColor4(0.7);
        this.mudParticles.color2 = new Color3(0.3, 0.2, 0.1).toColor4(0.7);
        this.mudParticles.colorDead = new Color3(0.2, 0.1, 0).toColor4(0);
        
        this.mudParticles.minSize = 0.2;
        this.mudParticles.maxSize = 0.4;
        
        this.mudParticles.minLifeTime = 1.0;
        this.mudParticles.maxLifeTime = 2.0;
        
        this.mudParticles.emitRate = 10;
        
        this.mudParticles.blendMode = ParticleSystem.BLENDMODE_STANDARD;
        
        this.mudParticles.direction1 = new Vector3(-0.1, 0.1, -0.1);
        this.mudParticles.direction2 = new Vector3(0.1, 0.2, 0.1);
        
        this.mudParticles.minEmitPower = 0.1;
        this.mudParticles.maxEmitPower = 0.3;
        
        this.mudParticles.updateSpeed = 0.01;
        
        // Start the particle system
        this.mudParticles.start();
    }
    
    /**
     * Fire at the current target
     */
    protected fire(): void {
        if (!this.targetEnemy) return;
        
        // Create a mud splash at the target position
        this.createMudSplash(this.targetEnemy.getPosition());
        
        // Get all enemies in range of the mud splash
        const enemiesInRange = this.getEnemiesInRange(this.targetEnemy.getPosition(), this.areaOfEffect);
        
        // Deal damage to all enemies in range
        for (const enemy of enemiesInRange) {
            // Skip flying enemies
            if (enemy.getEnemyType() === EnemyType.FLYING) {
                continue;
            }
            
            // Calculate damage based on elemental strengths/weaknesses
            let finalDamage = this.calculateDamage(enemy);
            
            // Apply armor reduction if active
            if (this.armorReducedEnemies.has(enemy)) {
                const armorReduction = this.armorReducedEnemies.get(enemy) || 0;
                finalDamage *= (1 + armorReduction);
            }
            
            // Deal damage to the enemy
            enemy.takeDamage(finalDamage);
            
            // Apply primary effect (slow)
            this.applyStatusEffect(
                enemy,
                StatusEffect.SLOWED,
                this.statusEffectDuration,
                this.statusEffectStrength
            );
            
            // Check for secondary effect (armor reduction)
            if (Math.random() < this.secondaryEffectChance) {
                // Apply armor reduction (implemented as a damage multiplier)
                this.armorReducedEnemies.set(enemy, 0.3); // 30% increased damage
                
                // Set a timeout to remove the armor reduction
                setTimeout(() => {
                    this.armorReducedEnemies.delete(enemy);
                }, this.statusEffectDuration * 1000);
            }
        }
        
        // Play sound
        this.game.getAssetManager().playSound('towerShoot');
    }
    
    /**
     * Create a mud splash effect at the target position
     * @param position The position for the mud splash
     */
    private createMudSplash(position: Vector3): void {
        // Create a particle system for the mud splash
        const mudSplash = new ParticleSystem('mudSplash', 60, this.scene);
        
        // Set particle texture
        mudSplash.particleTexture = new Texture('assets/textures/particle.png', this.scene);
        
        // Set emission properties
        mudSplash.emitter = new Vector3(position.x, 0.1, position.z); // Just above ground
        mudSplash.minEmitBox = new Vector3(-0.2, 0, -0.2);
        mudSplash.maxEmitBox = new Vector3(0.2, 0.1, 0.2);
        
        // Set particle properties
        mudSplash.color1 = new Color3(0.4, 0.3, 0.2).toColor4(0.8);
        mudSplash.color2 = new Color3(0.3, 0.2, 0.1).toColor4(0.8);
        mudSplash.colorDead = new Color3(0.2, 0.1, 0).toColor4(0);
        
        mudSplash.minSize = 0.2;
        mudSplash.maxSize = 0.5;
        
        mudSplash.minLifeTime = 1.0;
        mudSplash.maxLifeTime = 2.0;
        
        mudSplash.emitRate = 30;
        
        mudSplash.blendMode = ParticleSystem.BLENDMODE_STANDARD;
        
        mudSplash.direction1 = new Vector3(-1, 1, -1);
        mudSplash.direction2 = new Vector3(1, 2, 1);
        
        mudSplash.minEmitPower = 1;
        mudSplash.maxEmitPower = 2;
        
        mudSplash.updateSpeed = 0.01;
        
        mudSplash.gravity = new Vector3(0, -9.81, 0);
        
        // Start the particle system
        mudSplash.start();
        
        // Stop and dispose after a short time
        setTimeout(() => {
            mudSplash.stop();
            setTimeout(() => {
                mudSplash.dispose();
            }, 2000);
        }, 200);
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
        // Dispose of the mud particles
        if (this.mudParticles) {
            this.mudParticles.stop();
            this.mudParticles.dispose();
            this.mudParticles = null;
        }
        
        // Clear armor reduced enemies map
        this.armorReducedEnemies.clear();
        
        // Call the parent dispose method
        super.dispose();
    }
} 