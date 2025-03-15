import { Vector3, MeshBuilder, StandardMaterial, Color3, ParticleSystem, Texture, LinesMesh } from '@babylonjs/core';
import { Game } from '../../../Game';
import { Tower, ElementType, StatusEffect, EnemyType } from '../Tower';
import { Enemy } from '../../enemies/Enemy';

/**
 * Storm Tower - Combines Wind and Fire elements
 * - Creates lightning strikes that chain between enemies
 * - Has a chance to stun enemies
 * - Strong against: Water, Flying, Electric
 * - Weak against: Earth
 */
export class StormTower extends Tower {
    /**
     * The current storm particle system
     */
    private stormParticles: ParticleSystem | null = null;
    
    /**
     * Maximum number of enemies that can be chained
     */
    private maxChainTargets: number = 3;
    
    /**
     * Maximum distance for chain lightning to jump
     */
    private chainDistance: number = 4;
    
    /**
     * Damage reduction per chain jump (multiplicative)
     */
    private chainDamageReduction: number = 0.7;
    
    /**
     * Current lightning bolt visuals
     */
    private lightningBolts: LinesMesh[] = [];
    
    /**
     * Constructor for the StormTower
     * @param game The game instance
     * @param position The position of the tower
     */
    constructor(game: Game, position: Vector3) {
        // Base stats for storm tower
        const damage = 12;
        const range = 7;
        const fireRate = 1.5;
        const cost = 275;
        
        super(game, position, range, damage, fireRate, cost);
        
        // Set storm-specific properties
        this.secondaryEffectChance = 0.4; // 40% chance for secondary effect
        this.statusEffectDuration = 1; // 1 second of effect
        this.statusEffectStrength = 1.0; // 100% stun
        
        // Set targeting priorities
        this.targetPriorities = [
            EnemyType.WATER,
            EnemyType.FLYING,
            EnemyType.ELECTRIC
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
            'stormTower',
            {
                height: 2.2,
                diameter: 0.8,
                tessellation: 8
            },
            this.scene
        );
        
        // Create a material for the tower
        const material = new StandardMaterial('stormTowerMaterial', this.scene);
        material.diffuseColor = new Color3(0.4, 0.4, 0.7); // Dark blue-purple
        material.specularColor = new Color3(0.8, 0.8, 1.0);
        material.emissiveColor = new Color3(0.2, 0.2, 0.4);
        
        // Apply the material to the mesh
        this.mesh.material = material;
        
        // Position the tower
        this.mesh.position = new Vector3(this.position.x, 1.1, this.position.z);
        
        // Create a storm particle system
        this.createStormEffect();
    }
    
    /**
     * Create a storm particle effect around the tower
     */
    private createStormEffect(): void {
        if (!this.mesh) return;
        
        // Create a particle system for the storm
        this.stormParticles = new ParticleSystem('stormParticles', 50, this.scene);
        
        // Set particle texture
        this.stormParticles.particleTexture = new Texture('assets/textures/particle.png', this.scene);
        
        // Set emission properties
        this.stormParticles.emitter = new Vector3(this.position.x, this.position.y + 2, this.position.z);
        this.stormParticles.minEmitBox = new Vector3(-1, 0, -1);
        this.stormParticles.maxEmitBox = new Vector3(1, 0.5, 1);
        
        // Set particle properties
        this.stormParticles.color1 = new Color3(0.6, 0.6, 1.0).toColor4(0.6);
        this.stormParticles.color2 = new Color3(0.3, 0.3, 0.8).toColor4(0.6);
        this.stormParticles.colorDead = new Color3(0.1, 0.1, 0.3).toColor4(0);
        
        this.stormParticles.minSize = 0.1;
        this.stormParticles.maxSize = 0.3;
        
        this.stormParticles.minLifeTime = 0.5;
        this.stormParticles.maxLifeTime = 1.5;
        
        this.stormParticles.emitRate = 20;
        
        this.stormParticles.blendMode = ParticleSystem.BLENDMODE_STANDARD;
        
        this.stormParticles.direction1 = new Vector3(-0.5, -1, -0.5);
        this.stormParticles.direction2 = new Vector3(0.5, -1, 0.5);
        
        this.stormParticles.minEmitPower = 0.5;
        this.stormParticles.maxEmitPower = 1.5;
        
        this.stormParticles.updateSpeed = 0.01;
        
        // Start the particle system
        this.stormParticles.start();
    }
    
    /**
     * Fire at the current target
     */
    protected fire(): void {
        if (!this.targetEnemy) return;
        
        // Clear any existing lightning bolts
        this.clearLightningBolts();
        
        // Find chain targets
        const chainTargets = this.findChainTargets(this.targetEnemy);
        
        // Deal damage to all targets in the chain
        let currentDamage = this.damage;
        let previousTarget = this.targetEnemy;
        
        // Deal damage to the primary target
        currentDamage = this.calculateDamage(this.targetEnemy);
        this.targetEnemy.takeDamage(currentDamage);
        
        // Apply primary effect (stun) to primary target
        this.applyStatusEffect(
            this.targetEnemy,
            StatusEffect.STUNNED,
            this.statusEffectDuration,
            this.statusEffectStrength
        );
        
        // Create lightning effect to primary target
        this.createLightningBolt(this.position, this.targetEnemy.getPosition());
        
        // Process chain targets
        for (let i = 0; i < chainTargets.length; i++) {
            const target = chainTargets[i];
            
            // Reduce damage for each jump
            currentDamage *= this.chainDamageReduction;
            
            // Calculate damage based on elemental strengths/weaknesses
            const finalDamage = this.calculateDamage(target, currentDamage);
            
            // Deal damage to the target
            target.takeDamage(finalDamage);
            
            // Check for secondary effect (stun)
            if (Math.random() < this.secondaryEffectChance) {
                this.applyStatusEffect(
                    target,
                    StatusEffect.STUNNED,
                    this.statusEffectDuration / 2, // Half duration for chain targets
                    this.statusEffectStrength
                );
            }
            
            // Create lightning effect between targets
            this.createLightningBolt(previousTarget.getPosition(), target.getPosition());
            
            // Update previous target for next iteration
            previousTarget = target;
        }
        
        // Play sound
        this.game.getAssetManager().playSound('towerShoot');
    }
    
    /**
     * Find targets for chain lightning
     * @param primaryTarget The primary target
     * @returns Array of chain targets
     */
    private findChainTargets(primaryTarget: Enemy): Enemy[] {
        const chainTargets: Enemy[] = [];
        
        // This would normally be handled by the EnemyManager
        // For now, we'll just return an empty array
        
        return chainTargets;
    }
    
    /**
     * Calculate damage based on elemental strengths/weaknesses
     * @param enemy The target enemy
     * @param baseDamage Optional base damage to use instead of this.damage
     * @returns The calculated damage
     */
    protected calculateDamage(enemy: Enemy, baseDamage?: number): number {
        const damage = baseDamage !== undefined ? baseDamage : this.damage;
        let damageMultiplier = 1.0;
        
        // Check if enemy type is in weaknesses
        if (this.weakAgainst.includes(enemy.getEnemyType())) {
            damageMultiplier *= 0.5; // 50% damage against enemies we're weak against
        }
        
        // Check if enemy type is in priorities (strengths)
        if (this.targetPriorities.includes(enemy.getEnemyType())) {
            damageMultiplier *= 1.5; // 150% damage against enemies we're strong against
        }
        
        return damage * damageMultiplier;
    }
    
    /**
     * Create a lightning bolt effect between two points
     * @param start The start position
     * @param end The end position
     */
    private createLightningBolt(start: Vector3, end: Vector3): void {
        // Calculate direction and distance
        const direction = end.subtract(start);
        const distance = direction.length();
        
        // Create points for the lightning bolt with some randomness
        const numSegments = Math.ceil(distance * 2); // More segments for longer distances
        const points: Vector3[] = [];
        
        points.push(start);
        
        for (let i = 1; i < numSegments; i++) {
            const fraction = i / numSegments;
            const point = start.add(direction.scale(fraction));
            
            // Add some randomness perpendicular to the direction
            const perpX = direction.z;
            const perpZ = -direction.x;
            const perpLength = Math.sqrt(perpX * perpX + perpZ * perpZ);
            
            if (perpLength > 0.001) {
                const normalizedPerpX = perpX / perpLength;
                const normalizedPerpZ = perpZ / perpLength;
                
                const randomOffset = (Math.random() - 0.5) * distance * 0.2;
                point.x += normalizedPerpX * randomOffset;
                point.z += normalizedPerpZ * randomOffset;
                
                // Add some vertical randomness too
                point.y += (Math.random() - 0.5) * distance * 0.1;
            }
            
            points.push(point);
        }
        
        points.push(end);
        
        // Create the lightning bolt mesh
        const lightning = MeshBuilder.CreateLines(
            'lightningBolt',
            {
                points: points,
                updatable: false
            },
            this.scene
        );
        
        // Set color
        lightning.color = new Color3(0.6, 0.6, 1.0);
        
        // Add to the list
        this.lightningBolts.push(lightning);
        
        // Remove after a short time
        setTimeout(() => {
            const index = this.lightningBolts.indexOf(lightning);
            if (index !== -1) {
                this.lightningBolts.splice(index, 1);
                lightning.dispose();
            }
        }, 200);
    }
    
    /**
     * Clear all lightning bolt visuals
     */
    private clearLightningBolts(): void {
        for (const bolt of this.lightningBolts) {
            bolt.dispose();
        }
        this.lightningBolts = [];
    }
    
    /**
     * Dispose of the tower and its resources
     */
    public dispose(): void {
        // Dispose of the storm particles
        if (this.stormParticles) {
            this.stormParticles.stop();
            this.stormParticles.dispose();
            this.stormParticles = null;
        }
        
        // Clear lightning bolts
        this.clearLightningBolts();
        
        // Call the parent dispose method
        super.dispose();
    }
} 