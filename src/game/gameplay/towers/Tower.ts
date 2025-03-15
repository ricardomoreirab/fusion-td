import { Vector3, Mesh, MeshBuilder, StandardMaterial, Color3, Color4, Scene, ParticleSystem, Texture } from '@babylonjs/core';
import { Game } from '../../Game';
import { Enemy } from '../enemies/Enemy';

// Define element types
export enum ElementType {
    NONE = 'none',
    FIRE = 'fire',
    WATER = 'water',
    WIND = 'wind',
    EARTH = 'earth'
}

// Define enemy types for targeting priorities
export enum EnemyType {
    NORMAL = 'normal',
    FIRE = 'fire',
    WATER = 'water',
    WIND = 'wind',
    EARTH = 'earth',
    ICE = 'ice',
    PLANT = 'plant',
    FLYING = 'flying',
    HEAVY = 'heavy',
    LIGHT = 'light',
    ELECTRIC = 'electric'
}

// Define status effects
export enum StatusEffect {
    NONE = 'none',
    BURNING = 'burning',
    SLOWED = 'slowed',
    FROZEN = 'frozen',
    STUNNED = 'stunned',
    PUSHED = 'pushed',
    CONFUSED = 'confused'
}

// Define tower combination data
export interface TowerCombination {
    elements: ElementType[];
    resultType: string;
    name: string;
    description: string;
}

export abstract class Tower {
    protected game: Game;
    protected scene: Scene;
    protected position: Vector3;
    protected mesh: Mesh | null = null;
    protected range: number;
    protected damage: number;
    protected fireRate: number; // Shots per second
    protected level: number = 1;
    protected cost: number;
    protected upgradeMultiplier: number = 1.5;
    protected upgradeCost: number;
    protected sellValue: number;
    protected lastFireTime: number = 0;
    protected targetEnemy: Enemy | null = null;
    protected rangeIndicator: Mesh | null = null;
    protected showingRange: boolean = false;
    
    // Elemental properties
    protected elementType: ElementType = ElementType.NONE;
    protected secondaryEffectChance: number = 0; // Percentage chance (0-1)
    protected targetPriorities: EnemyType[] = []; // Enemy types this tower prioritizes
    protected weakAgainst: EnemyType[] = []; // Enemy types this tower is weak against
    protected statusEffectDuration: number = 0; // Duration of status effects in seconds
    protected statusEffectStrength: number = 0; // Strength of status effects (e.g., slow percentage)
    protected canTargetFlying: boolean = true; // Whether this tower can target flying enemies
    
    // Status effect tracking
    protected appliedStatusEffects: Map<Enemy, { effect: StatusEffect, endTime: number, strength: number }> = new Map();

    constructor(game: Game, position: Vector3, range: number, damage: number, fireRate: number, cost: number) {
        this.game = game;
        this.scene = game.getScene();
        this.position = position;
        this.range = range;
        this.damage = damage;
        this.fireRate = fireRate;
        this.cost = cost;
        this.upgradeCost = Math.floor(cost * 0.75);
        this.sellValue = Math.floor(cost * 0.5);
        
        // Create the tower mesh
        this.createMesh();
    }

    /**
     * Create the tower mesh
     */
    protected abstract createMesh(): void;

    /**
     * Update the tower
     * @param deltaTime Time elapsed since last update in seconds
     */
    public update(deltaTime: number): void {
        // Update status effects
        this.updateStatusEffects();
        
        // Find a target if we don't have one or if current target is dead
        if (!this.targetEnemy || !this.targetEnemy.isAlive()) {
            this.targetEnemy = null; // Clear the target if it's dead
            // Don't try to find a new target here - TowerManager will set it if available
        }
        
        // If we have a target, check if it's still in range
        if (this.targetEnemy) {
            const distance = Vector3.Distance(this.position, this.targetEnemy.getPosition());
            if (distance > this.range) {
                // Target out of range, clear it
                this.targetEnemy = null;
            }
        }
        
        // If we have a target, try to fire
        if (this.targetEnemy && this.targetEnemy.isAlive()) {
            const currentTime = performance.now();
            const timeSinceLastFire = (currentTime - this.lastFireTime) / 1000; // Convert to seconds
            
            if (timeSinceLastFire >= 1 / this.fireRate) {
                this.fire();
                this.lastFireTime = currentTime;
            }
            
            // Rotate tower to face target
            this.rotateTowerToTarget();
        }
    }

    /**
     * Update status effects on enemies
     */
    protected updateStatusEffects(): void {
        const currentTime = performance.now();
        const expiredEffects: Enemy[] = [];
        
        // Check for expired effects
        this.appliedStatusEffects.forEach((effectData, enemy) => {
            if (currentTime > effectData.endTime || !enemy.isAlive()) {
                // Effect has expired or enemy is dead
                expiredEffects.push(enemy);
            }
        });
        
        // Remove expired effects
        for (const enemy of expiredEffects) {
            this.appliedStatusEffects.delete(enemy);
        }
    }

    /**
     * Set the target enemy
     * @param enemy The enemy to target
     */
    public setTarget(enemy: Enemy | null): void {
        this.targetEnemy = enemy;
    }

    /**
     * Find a target enemy
     */
    protected findTarget(): void {
        // This is now handled by the TowerManager
        // The TowerManager will call setTarget with enemies from the EnemyManager
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
        
        // Apply primary effect based on element type
        this.applyPrimaryEffect(this.targetEnemy);
        
        // Check for secondary effect
        if (Math.random() < this.secondaryEffectChance) {
            this.applySecondaryEffect(this.targetEnemy);
        }
        
        // Create projectile effect
        this.createProjectileEffect(this.targetEnemy.getPosition());
        
        // Play sound
        this.game.getAssetManager().playSound('towerShoot');
    }
    
    /**
     * Calculate damage based on elemental strengths/weaknesses
     * @param enemy The target enemy
     * @returns The calculated damage
     */
    protected calculateDamage(enemy: Enemy): number {
        let damageMultiplier = 1.0;
        
        // Check if enemy type is in weaknesses
        if (this.weakAgainst.includes(enemy.getEnemyType())) {
            damageMultiplier *= 0.5; // 50% damage against enemies we're weak against
        }
        
        // Check if enemy type is in priorities (strengths)
        if (this.targetPriorities.includes(enemy.getEnemyType())) {
            damageMultiplier *= 1.5; // 150% damage against enemies we're strong against
        }
        
        return this.damage * damageMultiplier;
    }
    
    /**
     * Apply the primary elemental effect to the target
     * @param enemy The target enemy
     */
    protected applyPrimaryEffect(enemy: Enemy): void {
        // Override in elemental tower subclasses
    }
    
    /**
     * Apply the secondary elemental effect to the target
     * @param enemy The target enemy
     */
    protected applySecondaryEffect(enemy: Enemy): void {
        // Override in elemental tower subclasses
    }
    
    /**
     * Apply a status effect to an enemy
     * @param enemy The target enemy
     * @param effect The status effect to apply
     * @param duration Duration of the effect in seconds
     * @param strength Strength of the effect (e.g., slow percentage)
     */
    protected applyStatusEffect(enemy: Enemy, effect: StatusEffect, duration: number, strength: number): void {
        const endTime = performance.now() + (duration * 1000);
        this.appliedStatusEffects.set(enemy, { effect, endTime, strength });
        
        // Apply the effect to the enemy
        enemy.applyStatusEffect(effect, duration, strength);
    }

    /**
     * Create a projectile effect from the tower to the target
     * @param targetPosition The position of the target
     */
    protected createProjectileEffect(targetPosition: Vector3): void {
        if (!this.mesh) return;
        
        // Create a particle system for the projectile
        const particleSystem = new ParticleSystem('projectileParticles', 20, this.scene);
        
        // Set particle texture
        particleSystem.particleTexture = new Texture('assets/textures/particle.png', this.scene);
        
        // Set emission properties
        particleSystem.emitter = this.mesh;
        particleSystem.minEmitBox = new Vector3(0, 1, 0); // Emit from top of tower
        particleSystem.maxEmitBox = new Vector3(0, 1, 0);
        
        // Calculate direction to target
        const direction = targetPosition.subtract(this.position);
        direction.normalize();
        
        // Set particle properties
        particleSystem.direction1 = direction;
        particleSystem.direction2 = direction;
        
        // Set colors based on element type
        this.setProjectileColors(particleSystem);
        
        particleSystem.minSize = 0.1;
        particleSystem.maxSize = 0.3;
        
        particleSystem.minLifeTime = 0.1;
        particleSystem.maxLifeTime = 0.2;
        
        particleSystem.emitRate = 100;
        
        particleSystem.blendMode = ParticleSystem.BLENDMODE_ONEONE;
        
        particleSystem.minEmitPower = 20;
        particleSystem.maxEmitPower = 30;
        
        particleSystem.updateSpeed = 0.01;
        
        // Start the particle system
        particleSystem.start();
        
        // Stop and dispose after a short time
        setTimeout(() => {
            particleSystem.stop();
            setTimeout(() => {
                particleSystem.dispose();
            }, 1000);
        }, 200);
    }
    
    /**
     * Set projectile colors based on element type
     * @param particleSystem The particle system to set colors for
     */
    protected setProjectileColors(particleSystem: ParticleSystem): void {
        switch (this.elementType) {
            case ElementType.FIRE:
                particleSystem.color1 = new Color4(1, 0.5, 0, 1.0); // Orange
                particleSystem.color2 = new Color4(1, 0, 0, 1.0); // Red
                particleSystem.colorDead = new Color4(0.3, 0, 0, 0.0); // Dark red
                break;
            case ElementType.WATER:
                particleSystem.color1 = new Color4(0, 0.5, 1, 1.0); // Light blue
                particleSystem.color2 = new Color4(0, 0, 1, 1.0); // Blue
                particleSystem.colorDead = new Color4(0, 0, 0.3, 0.0); // Dark blue
                break;
            case ElementType.WIND:
                particleSystem.color1 = new Color4(0.7, 1, 1, 1.0); // Light cyan
                particleSystem.color2 = new Color4(0.5, 0.8, 0.5, 1.0); // Light green
                particleSystem.colorDead = new Color4(0.2, 0.3, 0.2, 0.0); // Dark green
                break;
            case ElementType.EARTH:
                particleSystem.color1 = new Color4(0.6, 0.3, 0, 1.0); // Brown
                particleSystem.color2 = new Color4(0.4, 0.2, 0, 1.0); // Dark brown
                particleSystem.colorDead = new Color4(0.2, 0.1, 0, 0.0); // Very dark brown
                break;
            default:
                particleSystem.color1 = new Color4(1, 1, 1, 1.0); // White
                particleSystem.color2 = new Color4(0.5, 0.5, 0.5, 1.0); // Gray
                particleSystem.colorDead = new Color4(0, 0, 0, 0.0); // Black
                break;
        }
    }

    /**
     * Rotate the tower to face the target
     */
    protected rotateTowerToTarget(): void {
        if (!this.mesh || !this.targetEnemy) return;
        
        const targetPosition = this.targetEnemy.getPosition();
        
        // Calculate direction to target
        const direction = targetPosition.subtract(this.position);
        
        // Calculate rotation angle (around Y axis)
        const angle = Math.atan2(direction.x, direction.z);
        
        // Set rotation
        this.mesh.rotation.y = angle;
    }

    /**
     * Upgrade the tower
     * @returns True if upgrade was successful
     */
    public upgrade(): boolean {
        // Increase level
        this.level++;
        
        // Increase stats
        this.range *= 1.2;
        this.damage *= 1.5;
        this.fireRate *= 1.2;
        
        // Update costs
        this.upgradeCost = Math.floor(this.upgradeCost * this.upgradeMultiplier);
        this.sellValue = Math.floor((this.cost + (this.upgradeCost / this.upgradeMultiplier)) * 0.5);
        
        // Update visuals
        this.updateVisuals();
        
        return true;
    }

    /**
     * Update tower visuals after upgrade
     */
    protected updateVisuals(): void {
        // This would be implemented by each tower type
        // For example, changing color, size, or adding effects
    }

    /**
     * Toggle showing the range indicator
     */
    public toggleRangeIndicator(): void {
        if (this.showingRange) {
            this.hideRangeIndicator();
        } else {
            this.showRangeIndicator();
        }
    }

    /**
     * Show the range indicator
     */
    protected showRangeIndicator(): void {
        if (this.rangeIndicator) return;
        
        // Create a disc to show the range
        this.rangeIndicator = MeshBuilder.CreateDisc('rangeIndicator', {
            radius: this.range,
            tessellation: 64
        }, this.scene);
        
        // Position at tower base
        this.rangeIndicator.position = new Vector3(this.position.x, 0.05, this.position.z);
        
        // Rotate to be flat on the ground
        this.rangeIndicator.rotation.x = Math.PI / 2;
        
        // Create material
        const material = new StandardMaterial('rangeIndicatorMaterial', this.scene);
        material.diffuseColor = new Color3(0.3, 0.6, 1);
        material.alpha = 0.3;
        this.rangeIndicator.material = material;
        
        this.showingRange = true;
    }

    /**
     * Hide the range indicator
     */
    protected hideRangeIndicator(): void {
        if (this.rangeIndicator) {
            this.rangeIndicator.dispose();
            this.rangeIndicator = null;
        }
        
        this.showingRange = false;
    }

    /**
     * Get the tower's position
     * @returns The tower's position
     */
    public getPosition(): Vector3 {
        return this.position;
    }

    /**
     * Get the tower's range
     * @returns The tower's range
     */
    public getRange(): number {
        return this.range;
    }

    /**
     * Get the tower's damage
     * @returns The tower's damage
     */
    public getDamage(): number {
        return this.damage;
    }

    /**
     * Get the tower's fire rate
     * @returns The tower's fire rate
     */
    public getFireRate(): number {
        return this.fireRate;
    }

    /**
     * Get the tower's level
     * @returns The tower's level
     */
    public getLevel(): number {
        return this.level;
    }

    /**
     * Get the tower's upgrade cost
     * @returns The tower's upgrade cost
     */
    public getUpgradeCost(): number {
        return this.upgradeCost;
    }

    /**
     * Get the tower's sell value
     * @returns The tower's sell value
     */
    public getSellValue(): number {
        return this.sellValue;
    }

    /**
     * Clean up resources
     */
    public dispose(): void {
        if (this.mesh) {
            this.mesh.dispose();
            this.mesh = null;
        }
        
        this.hideRangeIndicator();
    }

    /**
     * Get the element type of this tower
     * @returns The element type
     */
    public getElementType(): ElementType {
        return this.elementType;
    }
    
    /**
     * Get the grid position of this tower
     * @returns The grid position {x, y}
     */
    public getGridPosition(): { x: number, y: number } {
        // This requires access to the Map class, so we'll implement it in TowerManager
        return { x: 0, y: 0 }; // Placeholder
    }
    
    /**
     * Check if this tower can be combined with another tower
     * @param other The other tower to check
     * @returns True if the towers can be combined
     */
    public canCombineWith(other: Tower): boolean {
        // Different element types can be combined
        return this.elementType !== ElementType.NONE && 
               other.elementType !== ElementType.NONE && 
               this.elementType !== other.elementType;
    }
} 