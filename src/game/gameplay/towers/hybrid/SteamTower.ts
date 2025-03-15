import { Vector3, MeshBuilder, StandardMaterial, Color3, ParticleSystem, Texture } from '@babylonjs/core';
import { Game } from '../../../Game';
import { Tower, ElementType, StatusEffect, EnemyType } from '../Tower';
import { Enemy } from '../../enemies/Enemy';

/**
 * Steam Tower - Combines Fire and Water elements
 * - Creates steam clouds that damage and slow enemies
 * - Can hit multiple enemies in an area
 * - Strong against: Fire, Earth
 * - Weak against: Wind
 */
export class SteamTower extends Tower {
    /**
     * The radius of the steam cloud effect
     */
    private areaOfEffect: number = 3;
    
    /**
     * The current steam cloud particle system
     */
    private steamParticles: ParticleSystem | null = null;
    
    /**
     * Constructor for the SteamTower
     * @param game The game instance
     * @param position The position of the tower
     */
    constructor(game: Game, position: Vector3) {
        // Base stats for steam tower
        const damage = 8;
        const range = 6;
        const fireRate = 1.0;
        const cost = 200;
        
        super(game, position, range, damage, fireRate, cost);
        
        // Set steam-specific properties
        this.secondaryEffectChance = 0.5; // 50% chance for secondary effect
        this.statusEffectDuration = 3; // 3 seconds of effect
        this.statusEffectStrength = 0.3; // 30% slow
        
        // Set targeting priorities
        this.targetPriorities = [
            EnemyType.FIRE,
            EnemyType.EARTH
        ];
        
        // Set weaknesses
        this.weakAgainst = [
            EnemyType.WIND
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
            'steamTower',
            {
                height: 1.8,
                diameter: 1.2,
                tessellation: 16
            },
            this.scene
        );
        
        // Create a material for the tower
        const material = new StandardMaterial('steamTowerMaterial', this.scene);
        material.diffuseColor = new Color3(0.6, 0.6, 0.8); // Light blue-gray
        material.specularColor = new Color3(0.8, 0.8, 0.9);
        material.emissiveColor = new Color3(0.2, 0.2, 0.3);
        
        // Apply the material to the mesh
        this.mesh.material = material;
        
        // Position the tower
        this.mesh.position = new Vector3(this.position.x, 0.9, this.position.z);
        
        // Create a steam particle system
        this.createSteamEffect();
    }
    
    /**
     * Create a steam particle effect around the tower
     */
    private createSteamEffect(): void {
        if (!this.mesh) return;
        
        // Create a particle system for the steam
        this.steamParticles = new ParticleSystem('steamParticles', 50, this.scene);
        
        // Set particle texture
        this.steamParticles.particleTexture = new Texture('assets/textures/particle.png', this.scene);
        
        // Set emission properties
        this.steamParticles.emitter = this.mesh;
        this.steamParticles.minEmitBox = new Vector3(-0.5, 0.5, -0.5);
        this.steamParticles.maxEmitBox = new Vector3(0.5, 1.5, 0.5);
        
        // Set particle properties
        this.steamParticles.color1 = new Color3(0.8, 0.8, 0.9).toColor4(0.7);
        this.steamParticles.color2 = new Color3(0.6, 0.6, 0.8).toColor4(0.7);
        this.steamParticles.colorDead = new Color3(0.5, 0.5, 0.6).toColor4(0);
        
        this.steamParticles.minSize = 0.3;
        this.steamParticles.maxSize = 0.8;
        
        this.steamParticles.minLifeTime = 1.0;
        this.steamParticles.maxLifeTime = 2.0;
        
        this.steamParticles.emitRate = 20;
        
        this.steamParticles.blendMode = ParticleSystem.BLENDMODE_STANDARD;
        
        this.steamParticles.direction1 = new Vector3(-0.2, 0.5, -0.2);
        this.steamParticles.direction2 = new Vector3(0.2, 1, 0.2);
        
        this.steamParticles.minEmitPower = 0.5;
        this.steamParticles.maxEmitPower = 1.5;
        
        this.steamParticles.updateSpeed = 0.01;
        
        // Start the particle system
        this.steamParticles.start();
    }
    
    /**
     * Fire at the current target
     */
    protected fire(): void {
        if (!this.targetEnemy) return;
        
        // Create a steam cloud at the target position
        this.createSteamCloud(this.targetEnemy.getPosition());
        
        // Get all enemies in range of the steam cloud
        const enemiesInRange = this.getEnemiesInRange(this.targetEnemy.getPosition(), this.areaOfEffect);
        
        // Deal damage to all enemies in range
        for (const enemy of enemiesInRange) {
            // Calculate damage based on elemental strengths/weaknesses
            let finalDamage = this.calculateDamage(enemy);
            
            // Deal damage to the enemy
            enemy.takeDamage(finalDamage);
            
            // Apply primary effect (slow)
            this.applyStatusEffect(
                enemy,
                StatusEffect.SLOWED,
                this.statusEffectDuration,
                this.statusEffectStrength
            );
            
            // Check for secondary effect (burning)
            if (Math.random() < this.secondaryEffectChance) {
                this.applyStatusEffect(
                    enemy,
                    StatusEffect.BURNING,
                    1.5, // 1.5 seconds of burning
                    0.15 // 15% of damage per second
                );
            }
        }
        
        // Play sound
        this.game.getAssetManager().playSound('towerShoot');
    }
    
    /**
     * Create a steam cloud effect at the target position
     * @param position The position for the steam cloud
     */
    private createSteamCloud(position: Vector3): void {
        // Create a particle system for the steam cloud
        const steamCloud = new ParticleSystem('steamCloud', 100, this.scene);
        
        // Set particle texture
        steamCloud.particleTexture = new Texture('assets/textures/particle.png', this.scene);
        
        // Set emission properties
        steamCloud.emitter = position;
        steamCloud.minEmitBox = new Vector3(-1, 0, -1);
        steamCloud.maxEmitBox = new Vector3(1, 0.5, 1);
        
        // Set particle properties
        steamCloud.color1 = new Color3(0.8, 0.8, 0.9).toColor4(0.8);
        steamCloud.color2 = new Color3(0.6, 0.6, 0.8).toColor4(0.8);
        steamCloud.colorDead = new Color3(0.5, 0.5, 0.6).toColor4(0);
        
        steamCloud.minSize = 0.5;
        steamCloud.maxSize = 1.5;
        
        steamCloud.minLifeTime = 1.0;
        steamCloud.maxLifeTime = 2.0;
        
        steamCloud.emitRate = 50;
        
        steamCloud.blendMode = ParticleSystem.BLENDMODE_STANDARD;
        
        steamCloud.direction1 = new Vector3(-0.2, 0.5, -0.2);
        steamCloud.direction2 = new Vector3(0.2, 1, 0.2);
        
        steamCloud.minEmitPower = 0.5;
        steamCloud.maxEmitPower = 1.5;
        
        steamCloud.updateSpeed = 0.01;
        
        // Start the particle system
        steamCloud.start();
        
        // Stop and dispose after a short time
        setTimeout(() => {
            steamCloud.stop();
            setTimeout(() => {
                steamCloud.dispose();
            }, 2000);
        }, 1000);
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
        // Dispose of the steam particles
        if (this.steamParticles) {
            this.steamParticles.stop();
            this.steamParticles.dispose();
            this.steamParticles = null;
        }
        
        // Call the parent dispose method
        super.dispose();
    }
} 