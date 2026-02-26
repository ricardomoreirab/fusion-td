import { Vector3, Mesh, MeshBuilder, StandardMaterial, Color3, Color4, Scene, ParticleSystem, Texture, Animation } from '@babylonjs/core';
import { Game } from '../../Game';
import { Enemy } from '../enemies/Enemy';
import { createLowPolyMaterial, createEmissiveMaterial, makeFlatShaded } from '../../rendering/LowPolyMaterial';

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
    protected upgradeMultiplier: number = 3.0; // High cost multiplier for capped upgrade system
    protected upgradeCost: number;
    protected sellValue: number;
    protected lastFireTime: number = 0;
    protected targetEnemy: Enemy | null = null;
    protected rangeIndicator: Mesh | null = null;
    protected showingRange: boolean = false;
    protected isInitialized: boolean = false;
    protected isSelected: boolean = false;
    protected selectionIndicator: Mesh | null = null;
    protected maxLevel: number = 3;
    protected towerId: string;
    
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
        this.upgradeCost = Math.floor(cost * 1.0);
        this.sellValue = Math.floor(cost * 0.6);
        this.towerId = `tower_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
        
        // Create the tower mesh
        this.createMesh();
        
        // Add a small delay before the tower can target and fire
        setTimeout(() => {
            this.isInitialized = true;
        }, 500);
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
        // Only set target if tower is initialized
        if (this.isInitialized) {
            this.targetEnemy = enemy;
        }
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
        if (!this.targetEnemy || !this.isInitialized) return;

        // Calculate damage based on elemental strengths/weaknesses
        let finalDamage = this.calculateDamage(this.targetEnemy);

        // Store target position before dealing damage (enemy might die)
        const targetPosition = this.targetEnemy.getPosition().clone();

        // Deal damage to the target
        this.targetEnemy.takeDamage(finalDamage);

        // Emit damage event for floating numbers
        const damageEvent = new CustomEvent('towerDamage', {
            detail: {
                position: targetPosition,
                damage: finalDamage,
                elementType: this.elementType
            }
        });
        document.dispatchEvent(damageEvent);

        // Apply primary effect based on element type
        this.applyPrimaryEffect(this.targetEnemy);

        // Check for secondary effect
        if (Math.random() < this.secondaryEffectChance) {
            this.applySecondaryEffect(this.targetEnemy);
        }

        // Create projectile effect
        this.createProjectileEffect(targetPosition);

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

        const direction = targetPosition.subtract(this.position);
        const distance = direction.length();
        direction.normalize();

        // Faceted icosphere projectile (diamond/low-poly look)
        const projectileMesh = MeshBuilder.CreateIcoSphere('projectile', {
            radius: 0.15,
            subdivisions: 0
        }, this.scene);
        makeFlatShaded(projectileMesh);

        const startPosition = new Vector3(
            this.position.x,
            this.position.y + 1.5,
            this.position.z
        );
        projectileMesh.position = startPosition;

        // Element-colored emissive material
        let color: Color3;
        switch (this.elementType) {
            case ElementType.FIRE: color = new Color3(1, 0.3, 0); break;
            case ElementType.WATER: color = new Color3(0, 0.5, 1); break;
            case ElementType.WIND: color = new Color3(0.7, 1, 0.7); break;
            case ElementType.EARTH: color = new Color3(0.6, 0.3, 0); break;
            default: color = new Color3(0.8, 0.8, 0.8); break;
        }
        const projectileMaterial = createEmissiveMaterial('projectileMat', color, 0.6, this.scene);
        projectileMesh.material = projectileMaterial;

        // No particle trail - clean low-poly look

        const animationSpeed = 15;
        const travelTime = distance / animationSpeed;
        const frameRate = 30;

        const projectileAnimation = new Animation(
            'projectileAnimation', 'position', frameRate,
            Animation.ANIMATIONTYPE_VECTOR3, Animation.ANIMATIONLOOPMODE_CONSTANT
        );
        projectileAnimation.setKeys([
            { frame: 0, value: startPosition },
            { frame: frameRate * travelTime, value: targetPosition }
        ]);
        projectileMesh.animations = [projectileAnimation];

        this.scene.beginAnimation(projectileMesh, 0, frameRate * travelTime, false, 1, () => {
            this.createImpactEffect(targetPosition);
            projectileMesh.dispose();
            projectileMaterial.dispose();
        });
    }
    
    /**
     * Create an impact effect at the target position
     * @param position The position to create the impact effect
     */
    protected createImpactEffect(position: Vector3): void {
        // Reduced impact burst: 15 larger particles
        const impactSystem = new ParticleSystem('impactParticles', 15, this.scene);
        impactSystem.emitter = position;
        impactSystem.minEmitBox = new Vector3(-0.1, 0, -0.1);
        impactSystem.maxEmitBox = new Vector3(0.1, 0, 0.1);

        switch (this.elementType) {
            case ElementType.FIRE:
                impactSystem.color1 = new Color4(1, 0.5, 0, 1.0);
                impactSystem.color2 = new Color4(1, 0, 0, 1.0);
                impactSystem.colorDead = new Color4(0.3, 0, 0, 0.0);
                break;
            case ElementType.WATER:
                impactSystem.color1 = new Color4(0, 0.5, 1, 1.0);
                impactSystem.color2 = new Color4(0, 0, 1, 1.0);
                impactSystem.colorDead = new Color4(0, 0, 0.3, 0.0);
                break;
            case ElementType.WIND:
                impactSystem.color1 = new Color4(0.7, 1, 0.7, 1.0);
                impactSystem.color2 = new Color4(0.5, 0.8, 0.5, 1.0);
                impactSystem.colorDead = new Color4(0.2, 0.3, 0.2, 0.0);
                break;
            case ElementType.EARTH:
                impactSystem.color1 = new Color4(0.6, 0.3, 0, 1.0);
                impactSystem.color2 = new Color4(0.4, 0.2, 0, 1.0);
                impactSystem.colorDead = new Color4(0.2, 0.1, 0, 0.0);
                break;
            default:
                impactSystem.color1 = new Color4(1, 1, 1, 1.0);
                impactSystem.color2 = new Color4(0.5, 0.5, 0.5, 1.0);
                impactSystem.colorDead = new Color4(0, 0, 0, 0.0);
                break;
        }

        impactSystem.minSize = 0.2;
        impactSystem.maxSize = 0.5;
        impactSystem.minLifeTime = 0.15;
        impactSystem.maxLifeTime = 0.35;
        impactSystem.emitRate = 80;
        impactSystem.blendMode = ParticleSystem.BLENDMODE_ONEONE;
        impactSystem.direction1 = new Vector3(-1, -1, -1);
        impactSystem.direction2 = new Vector3(1, 1, 1);
        impactSystem.minEmitPower = 1;
        impactSystem.maxEmitPower = 2.5;
        impactSystem.updateSpeed = 0.01;
        impactSystem.start();

        setTimeout(() => {
            impactSystem.stop();
            setTimeout(() => impactSystem.dispose(), 400);
        }, 150);
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
     * Get the tower's max level
     * @returns The tower's max level
     */
    public getMaxLevel(): number {
        return this.maxLevel;
    }

    /**
     * Upgrade the tower
     * @returns True if upgrade was successful
     */
    public upgrade(): boolean {
        // Can't upgrade beyond max level
        if (this.level >= this.maxLevel) return false;

        // Increase level
        this.level++;

        // Significantly improved stats per upgrade (level 3 = ~3× base damage, ~1.56× range/fireRate)
        this.range *= 1.25;
        this.damage *= 1.75;
        this.fireRate *= 1.25;
        
        // Update costs
        this.upgradeCost = Math.floor(this.upgradeCost * this.upgradeMultiplier);
        
        // Update sell value to 60% of total cost
        this.updateSellValue();
        
        // Update visuals
        this.updateVisuals();
        
        // Update range indicator if it's showing
        if (this.showingRange && this.rangeIndicator) {
            this.hideRangeIndicator();
            this.showRangeIndicator();
        }
        
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
     * Show the tower's range indicator
     */
    protected showRangeIndicator(): void {
        if (this.rangeIndicator) return;

        // Simple flat disc with solid color at alpha 0.2
        this.rangeIndicator = MeshBuilder.CreateDisc(
            'rangeIndicator' + this.mesh!.id,
            { radius: this.range, tessellation: 32, sideOrientation: Mesh.DOUBLESIDE },
            this.scene
        );
        this.rangeIndicator.position = new Vector3(this.position.x, 0.02, this.position.z);
        this.rangeIndicator.rotation = new Vector3(Math.PI / 2, 0, 0);
        this.rangeIndicator.renderingGroupId = 1;

        let rangeColor = new Color3(1.0, 0.8, 0.2);
        switch (this.elementType) {
            case ElementType.FIRE: rangeColor = new Color3(0.9, 0.3, 0.1); break;
            case ElementType.WATER: rangeColor = new Color3(0.1, 0.4, 0.9); break;
            case ElementType.WIND: rangeColor = new Color3(0.5, 0.9, 0.1); break;
            case ElementType.EARTH: rangeColor = new Color3(0.7, 0.5, 0.1); break;
        }

        const rangeMaterial = new StandardMaterial('rangeMaterial_' + this.mesh!.id, this.scene);
        rangeMaterial.diffuseColor = rangeColor;
        rangeMaterial.specularColor = Color3.Black();
        rangeMaterial.emissiveColor = rangeColor.scale(0.3);
        rangeMaterial.alpha = 0.2;
        rangeMaterial.disableLighting = true;
        this.rangeIndicator.material = rangeMaterial;

        // Thin torus ring at perimeter
        const outerRing = MeshBuilder.CreateTorus(
            'rangeRing' + this.mesh!.id,
            { diameter: this.range * 2, thickness: 0.08, tessellation: 32 },
            this.scene
        );
        outerRing.position = new Vector3(this.position.x, 0.03, this.position.z);
        outerRing.parent = this.rangeIndicator;

        const ringMaterial = new StandardMaterial('ringMaterial_' + this.mesh!.id, this.scene);
        ringMaterial.diffuseColor = rangeColor;
        ringMaterial.emissiveColor = rangeColor.scale(0.5);
        ringMaterial.specularColor = Color3.Black();
        ringMaterial.alpha = 0.6;
        ringMaterial.disableLighting = true;
        outerRing.material = ringMaterial;

        this.rangeIndicator.metadata = {};
        this.showingRange = true;
    }

    /**
     * Hide the tower's range indicator
     */
    protected hideRangeIndicator(): void {
        if (this.rangeIndicator) {
            this.rangeIndicator.dispose();
            this.rangeIndicator = null;
            this.showingRange = false;
        }
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
        
        // Remove selection indicator if it exists
        this.removeSelectionIndicator();
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
               other.getElementType() !== ElementType.NONE && 
               this.elementType !== other.getElementType();
    }

    /**
     * Select this tower
     */
    public select(): void {
        if (this.isSelected) return;
        
        this.isSelected = true;
        this.showRangeIndicator();
        this.createSelectionIndicator();
    }
    
    /**
     * Deselect this tower
     */
    public deselect(): void {
        if (!this.isSelected) return;
        
        this.isSelected = false;
        this.hideRangeIndicator();
        this.removeSelectionIndicator();
    }
    
    /**
     * Check if this tower is selected
     */
    public getIsSelected(): boolean {
        return this.isSelected;
    }
    
    /**
     * Create a visual indicator that this tower is selected
     */
    protected createSelectionIndicator(): void {
        if (this.selectionIndicator) return;

        // Simple pulsing torus ring
        this.selectionIndicator = MeshBuilder.CreateTorus('selectionIndicator', {
            diameter: 2.2,
            thickness: 0.12,
            tessellation: 16
        }, this.scene);
        this.selectionIndicator.position = new Vector3(this.position.x, 0.1, this.position.z);

        const selectionColor = new Color3(0.3, 0.8, 1.0);
        const material = createEmissiveMaterial('selectionMat', selectionColor, 0.8, this.scene);
        material.alpha = 0.7;
        this.selectionIndicator.material = material;
    }
    
    /**
     * Remove the selection indicator
     */
    protected removeSelectionIndicator(): void {
        if (this.selectionIndicator) {
            this.selectionIndicator.dispose();
            this.selectionIndicator = null;
        }
    }
    
    /**
     * Update the sell value to be 50% of the total cost spent on the tower
     */
    public updateSellValue(): void {
        // Calculate total spent (base cost + upgrades)
        const baseCost = this.cost;
        let upgradeCost = 0;
        
        // Calculate cost of all upgrades
        for (let i = 1; i < this.level; i++) {
            upgradeCost += Math.floor(this.cost * Math.pow(this.upgradeMultiplier, i - 1));
        }
        
        // Set sell value to 50% of total cost (reduced from 60%)
        const totalCost = baseCost + upgradeCost;
        this.sellValue = Math.floor(totalCost * 0.5);
    }

    /**
     * Get the tower's mesh
     * @returns The tower's mesh
     */
    public getMesh(): Mesh | null {
        return this.mesh;
    }

    /**
     * Helper method to safely create a Color4 from Color3
     * @param color3 The Color3 to convert
     * @param alpha The alpha value (default: 1.0)
     * @returns A properly initialized Color4
     */
    protected safeColor4(color3: Color3, alpha: number = 1.0): Color4 {
        if (!color3) {
            return new Color4(1, 1, 1, alpha); // Default white if color3 is null
        }
        
        try {
            return new Color4(
                color3.r !== undefined ? color3.r : 1.0,
                color3.g !== undefined ? color3.g : 1.0,
                color3.b !== undefined ? color3.b : 1.0,
                alpha
            );
        } catch (error) {
            console.error("Error creating Color4:", error);
            return new Color4(1, 1, 1, alpha);
        }
    }

    /**
     * Get the unique ID of this tower
     * @returns The tower's unique ID
     */
    public getId(): string {
        return this.towerId;
    }
} 