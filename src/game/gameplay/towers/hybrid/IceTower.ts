import { Vector3, MeshBuilder, StandardMaterial, Color3, ParticleSystem, Texture } from '@babylonjs/core';
import { Game } from '../../../Game';
import { Tower, ElementType, StatusEffect, EnemyType } from '../Tower';
import { Enemy } from '../../enemies/Enemy';

/**
 * Ice Tower - Combines Water and Wind elements
 * - Freezes enemies and deals bonus damage to frozen targets
 * - Has a chance to completely freeze enemies for a short time
 * - Strong against: Fire, Flying
 * - Weak against: Earth
 */
export class IceTower extends Tower {
    /**
     * The current ice particle system
     */
    private iceParticles: ParticleSystem | null = null;
    
    /**
     * Tracks which enemies are currently frozen
     */
    private frozenEnemies: Set<Enemy> = new Set();
    
    /**
     * Constructor for the IceTower
     * @param game The game instance
     * @param position The position of the tower
     */
    constructor(game: Game, position: Vector3) {
        // Base stats for ice tower
        const damage = 10;
        const range = 6.5;
        const fireRate = 1.2;
        const cost = 225;
        
        super(game, position, range, damage, fireRate, cost);
        
        // Set ice-specific properties
        this.secondaryEffectChance = 0.3; // 30% chance for secondary effect
        this.statusEffectDuration = 2; // 2 seconds of effect
        this.statusEffectStrength = 0.6; // 60% slow
        
        // Set targeting priorities
        this.targetPriorities = [
            EnemyType.FIRE,
            EnemyType.FLYING
        ];
        
        // Set weaknesses
        this.weakAgainst = [
            EnemyType.EARTH
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
            'iceTower',
            {
                height: 1.6,
                diameter: 0.9,
                tessellation: 8
            },
            this.scene
        );
        
        // Create a material for the tower
        const material = new StandardMaterial('iceTowerMaterial', this.scene);
        material.diffuseColor = new Color3(0.7, 0.9, 1.0); // Light blue
        material.specularColor = new Color3(1, 1, 1);
        material.emissiveColor = new Color3(0.2, 0.4, 0.6);
        
        // Apply the material to the mesh
        this.mesh.material = material;
        
        // Position the tower
        this.mesh.position = new Vector3(this.position.x, 0.8, this.position.z);
        
        // Create an ice particle system
        this.createIceEffect();
    }
    
    /**
     * Create an ice particle effect around the tower
     */
    private createIceEffect(): void {
        if (!this.mesh) return;
        
        // Create a particle system for the ice
        this.iceParticles = new ParticleSystem('iceParticles', 40, this.scene);
        
        // Set particle texture
        this.iceParticles.particleTexture = new Texture('assets/textures/particle.png', this.scene);
        
        // Set emission properties
        this.iceParticles.emitter = this.mesh;
        this.iceParticles.minEmitBox = new Vector3(-0.4, 0.4, -0.4);
        this.iceParticles.maxEmitBox = new Vector3(0.4, 1.2, 0.4);
        
        // Set particle properties
        this.iceParticles.color1 = new Color3(0.8, 0.9, 1.0).toColor4(0.6);
        this.iceParticles.color2 = new Color3(0.6, 0.8, 1.0).toColor4(0.6);
        this.iceParticles.colorDead = new Color3(0.5, 0.7, 0.9).toColor4(0);
        
        this.iceParticles.minSize = 0.05;
        this.iceParticles.maxSize = 0.15;
        
        this.iceParticles.minLifeTime = 1.0;
        this.iceParticles.maxLifeTime = 2.0;
        
        this.iceParticles.emitRate = 25;
        
        this.iceParticles.blendMode = ParticleSystem.BLENDMODE_STANDARD;
        
        this.iceParticles.direction1 = new Vector3(-0.1, 0.1, -0.1);
        this.iceParticles.direction2 = new Vector3(0.1, 0.3, 0.1);
        
        this.iceParticles.minEmitPower = 0.2;
        this.iceParticles.maxEmitPower = 0.5;
        
        this.iceParticles.updateSpeed = 0.01;
        
        // Start the particle system
        this.iceParticles.start();
    }
    
    /**
     * Fire at the current target
     */
    protected fire(): void {
        if (!this.targetEnemy) return;
        
        // Calculate damage based on elemental strengths/weaknesses
        let finalDamage = this.calculateDamage(this.targetEnemy);
        
        // Deal damage to the target
        this.targetEnemy.takeDamage(finalDamage);
        
        // Apply primary effect (slow)
        this.applyStatusEffect(
            this.targetEnemy,
            StatusEffect.SLOWED,
            this.statusEffectDuration,
            this.statusEffectStrength
        );
        
        // Check for secondary effect (freeze)
        if (Math.random() < this.secondaryEffectChance) {
            this.applyStatusEffect(
                this.targetEnemy,
                StatusEffect.FROZEN,
                1.0, // 1 second of freezing
                1.0 // 100% freeze (complete stop)
            );
            
            // Track this enemy as frozen
            this.frozenEnemies.add(this.targetEnemy);
            
            // Set a timeout to remove from frozen list
            setTimeout(() => {
                this.frozenEnemies.delete(this.targetEnemy!);
            }, 1000);
        }
        
        // Create projectile effect
        this.createIceProjectile(this.targetEnemy.getPosition());
        
        // Play sound
        this.game.getAssetManager().playSound('towerShoot');
    }
    
    /**
     * Create an ice projectile effect
     * @param targetPosition The position of the target
     */
    private createIceProjectile(targetPosition: Vector3): void {
        if (!this.mesh) return;
        
        // Create a particle system for the ice projectile
        const iceProjectile = new ParticleSystem('iceProjectile', 60, this.scene);
        
        // Set particle texture
        iceProjectile.particleTexture = new Texture('assets/textures/particle.png', this.scene);
        
        // Set emission properties
        iceProjectile.emitter = this.mesh;
        iceProjectile.minEmitBox = new Vector3(0, 1, 0);
        iceProjectile.maxEmitBox = new Vector3(0, 1, 0);
        
        // Calculate direction to target
        const direction = targetPosition.subtract(this.position);
        direction.normalize();
        
        // Set particle properties
        iceProjectile.direction1 = direction;
        iceProjectile.direction2 = direction;
        
        iceProjectile.color1 = new Color3(0.8, 0.9, 1.0).toColor4(0.8);
        iceProjectile.color2 = new Color3(0.6, 0.8, 1.0).toColor4(0.8);
        iceProjectile.colorDead = new Color3(0.5, 0.7, 0.9).toColor4(0);
        
        iceProjectile.minSize = 0.1;
        iceProjectile.maxSize = 0.2;
        
        iceProjectile.minLifeTime = 0.1;
        iceProjectile.maxLifeTime = 0.2;
        
        iceProjectile.emitRate = 100;
        
        iceProjectile.blendMode = ParticleSystem.BLENDMODE_STANDARD;
        
        iceProjectile.minEmitPower = 20;
        iceProjectile.maxEmitPower = 30;
        
        iceProjectile.updateSpeed = 0.01;
        
        // Start the particle system
        iceProjectile.start();
        
        // Stop and dispose after a short time
        setTimeout(() => {
            iceProjectile.stop();
            setTimeout(() => {
                iceProjectile.dispose();
            }, 1000);
        }, 200);
    }
    
    /**
     * Calculate damage based on elemental strengths/weaknesses
     * @param enemy The target enemy
     * @returns The calculated damage
     */
    protected calculateDamage(enemy: Enemy): number {
        let damage = super.calculateDamage(enemy);
        
        // Ice towers deal extra damage to frozen enemies
        if (this.frozenEnemies.has(enemy)) {
            damage *= 2.0; // Double damage to frozen enemies
        }
        
        return damage;
    }
    
    /**
     * Dispose of the tower and its resources
     */
    public dispose(): void {
        // Dispose of the ice particles
        if (this.iceParticles) {
            this.iceParticles.stop();
            this.iceParticles.dispose();
            this.iceParticles = null;
        }
        
        // Clear frozen enemies set
        this.frozenEnemies.clear();
        
        // Call the parent dispose method
        super.dispose();
    }
} 