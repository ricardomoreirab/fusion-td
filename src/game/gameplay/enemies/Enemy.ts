import { Vector3, Mesh, MeshBuilder, StandardMaterial, Color3, Color4, Scene, ParticleSystem, Texture, DynamicTexture, Sound } from '@babylonjs/core';
import { Game } from '../../Game';
import { EnemyType, StatusEffect } from '../towers/Tower';
import { TowerManager } from '../TowerManager';
import { Tower } from '../towers/Tower';

export class Enemy {
    protected game: Game;
    protected scene: Scene;
    protected mesh: Mesh | null = null;
    protected healthBarMesh: Mesh | null = null;
    protected healthBarBackgroundMesh: Mesh | null = null;
    protected healthBarOutlineMesh: Mesh | null = null;
    protected position: Vector3;
    protected speed: number;
    protected originalSpeed: number; // Store original speed for status effects
    protected health: number;
    protected maxHealth: number;
    protected damage: number; // Damage to player when reaching the end
    protected reward: number; // Money reward when killed
    protected alive: boolean = true;
    protected path: Vector3[] = [];
    protected currentPathIndex: number = 0;
    protected originalScale: number = 1.0; // Store original scale for health-based scaling
    
    // Tower destruction ability
    protected canDestroyTowers: boolean = false;
    protected towerDestructionRange: number = 0;
    protected towerDestructionCooldown: number = 5; // 5 seconds cooldown
    protected lastTowerDestructionTime: number = 0;
    protected towerManager: TowerManager | null = null;
    
    // Elemental properties
    protected enemyType: EnemyType = EnemyType.NORMAL;
    protected isFlying: boolean = false;
    protected isHeavy: boolean = false;
    
    // Status effect properties
    protected activeStatusEffects: Map<StatusEffect, { endTime: number, strength: number }> = new Map();
    protected statusEffectParticles: Map<StatusEffect, ParticleSystem> = new Map();
    protected isFrozen: boolean = false;
    protected isStunned: boolean = false;
    protected isConfused: boolean = false;
    protected confusedDirection: Vector3 | null = null;
    protected burnDamageInterval: number = 0.5; // Seconds between burn damage ticks
    protected lastBurnDamageTime: number = 0;
    protected burnDamagePerTick: number = 0;
    protected damageResistance: number = 0;

    constructor(game: Game, position: Vector3, path: Vector3[], speed: number, health: number, damage: number, reward: number) {
        this.game = game;
        this.scene = game.getScene();
        this.position = position.clone();
        this.path = path;
        this.speed = speed;
        this.originalSpeed = speed;
        this.health = health;
        this.maxHealth = health;
        this.damage = damage;
        this.reward = reward;
        
        try {
            // Create the enemy mesh
            this.createMesh();
            
            if (!this.mesh) {
                console.error('Enemy mesh creation failed');
            }
            
            // Create health bar
            this.createHealthBar();
        } catch (error) {
            console.error('Error creating enemy:', error);
        }
    }

    /**
     * Create the enemy mesh
     */
    protected createMesh(): void {
        // Create a simple sphere for the enemy
        this.mesh = MeshBuilder.CreateSphere('enemy', {
            diameter: 0.8
        }, this.scene);
        
        // Position at starting position
        this.mesh.position = this.position.clone();
        
        // Create material
        const material = new StandardMaterial('enemyMaterial', this.scene);
        material.diffuseColor = new Color3(0.8, 0.2, 0.2);
        this.mesh.material = material;
    }

    /**
     * Create health bar for the enemy
     */
    protected createHealthBar(): void {
        if (!this.mesh) return;

        // Create dark outline border (slightly larger than background)
        this.healthBarOutlineMesh = MeshBuilder.CreateBox('healthBarOutline', {
            width: 1.08,
            height: 0.14,
            depth: 0.04
        }, this.scene);

        this.healthBarOutlineMesh.position = new Vector3(
            this.position.x,
            this.position.y + 1.0,
            this.position.z
        );

        const outlineMaterial = new StandardMaterial('healthBarOutlineMaterial', this.scene);
        outlineMaterial.diffuseColor = new Color3(0, 0, 0);
        outlineMaterial.specularColor = Color3.Black();
        this.healthBarOutlineMesh.material = outlineMaterial;

        // Create background bar (gray)
        this.healthBarBackgroundMesh = MeshBuilder.CreateBox('healthBarBg', {
            width: 1.0,
            height: 0.08,
            depth: 0.05
        }, this.scene);

        // Position above the enemy
        this.healthBarBackgroundMesh.position = new Vector3(
            this.position.x,
            this.position.y + 1.0,
            this.position.z
        );

        // Create material for background
        const bgMaterial = new StandardMaterial('healthBarBgMaterial', this.scene);
        bgMaterial.diffuseColor = new Color3(0.3, 0.3, 0.3);
        bgMaterial.specularColor = Color3.Black();
        this.healthBarBackgroundMesh.material = bgMaterial;

        // Create health bar (green)
        this.healthBarMesh = MeshBuilder.CreateBox('healthBar', {
            width: 1.0,
            height: 0.08,
            depth: 0.06 // Slightly in front of background
        }, this.scene);

        // Position at the same place as background
        this.healthBarMesh.position = new Vector3(
            this.position.x,
            this.position.y + 1.0,
            this.position.z
        );

        // Create material for health bar
        const healthMaterial = new StandardMaterial('healthBarMaterial', this.scene);
        healthMaterial.diffuseColor = new Color3(0.2, 0.8, 0.2); // Green
        healthMaterial.specularColor = Color3.Black();
        this.healthBarMesh.material = healthMaterial;

        // Make health bars always face the camera
        this.healthBarOutlineMesh.billboardMode = Mesh.BILLBOARDMODE_ALL;
        this.healthBarBackgroundMesh.billboardMode = Mesh.BILLBOARDMODE_ALL;
        this.healthBarMesh.billboardMode = Mesh.BILLBOARDMODE_ALL;

        // Update health bar to match initial health
        this.updateHealthBar();
    }

    /**
     * Update the health bar based on current health
     */
    protected updateHealthBar(): void {
        if (!this.mesh || !this.healthBarMesh || !this.healthBarBackgroundMesh) return;

        // Calculate health percentage
        const healthPercent = Math.max(0, this.health / this.maxHealth);

        // Update health bar width based on health percentage
        this.healthBarMesh.scaling.x = healthPercent;

        // Adjust position to align left side
        const offset = (1 - healthPercent) * 0.5;
        this.healthBarMesh.position.x = this.position.x - offset;

        // Update health bar color based on health percentage
        const material = this.healthBarMesh.material as StandardMaterial;
        if (healthPercent > 0.6) {
            material.diffuseColor = new Color3(0.2, 0.8, 0.2); // Green
        } else if (healthPercent > 0.3) {
            material.diffuseColor = new Color3(0.8, 0.8, 0.2); // Yellow
        } else {
            material.diffuseColor = new Color3(0.8, 0.2, 0.2); // Red
        }

        // Position outline behind everything
        if (this.healthBarOutlineMesh && !this.healthBarOutlineMesh.isDisposed()) {
            this.healthBarOutlineMesh.position.x = this.position.x;
            this.healthBarOutlineMesh.position.y = this.position.y + 1.0;
            this.healthBarOutlineMesh.position.z = this.position.z;
        }

        // Position health bars above the enemy
        this.healthBarBackgroundMesh.position.x = this.position.x;
        this.healthBarBackgroundMesh.position.y = this.position.y + 1.0;
        this.healthBarBackgroundMesh.position.z = this.position.z;

        this.healthBarMesh.position.y = this.position.y + 1.0;
        this.healthBarMesh.position.z = this.position.z;
    }

    /**
     * Update the enemy's scale based on current health
     * This method is replaced by updateHealthBar
     */
    protected updateHealthScale(): void {
        // This method is now deprecated - using health bars instead
        // Keeping it for compatibility with child classes that might override it
    }

    /**
     * Update the enemy
     * @param deltaTime Time elapsed since last update in seconds
     * @returns True if the enemy reached the end of the path
     */
    public update(deltaTime: number): boolean {
        if (!this.alive || !this.mesh) return false;
        
        // Update status effects
        this.updateStatusEffects(deltaTime);
        
        // Check for tower destruction (for boss enemies)
        this.checkTowerDestruction(deltaTime);
        
        // Don't move if frozen or stunned
        if (this.isFrozen || this.isStunned) {
            return false;
        }
        
        // If we've reached the end of the path, return true
        if (this.currentPathIndex >= this.path.length) {
            return true;
        }
        
        // Get the next point in the path
        const targetPoint = this.path[this.currentPathIndex];
        
        // Calculate direction to the target
        let direction = targetPoint.subtract(this.position);
        
        // Find the closest point on the path if we're too far from our target
        const distanceToPath = direction.length();
        if (distanceToPath > 2) { // If we're more than 2 units away from our target
            // Reset to the last known good position
            this.position = this.path[Math.max(0, this.currentPathIndex - 1)].clone();
            direction = targetPoint.subtract(this.position);
        }
        
        // If confused, modify the direction but maintain general path following
        if (this.isConfused) {
            // Update confused direction more frequently for more erratic movement
            if (!this.confusedDirection || Math.random() < 0.1) {
                // Create a random offset perpendicular to the path direction
                const pathDirection = direction.normalize();
                const perpX = pathDirection.z;
                const perpZ = -pathDirection.x;
                const perpLength = Math.sqrt(perpX * perpX + perpZ * perpZ);
                
                if (perpLength > 0.001) {
                    const normalizedPerpX = perpX / perpLength;
                    const normalizedPerpZ = perpZ / perpLength;
                    
                    const randomOffset = new Vector3(
                        normalizedPerpX * (Math.random() - 0.5) * 0.3,
                        0,
                        normalizedPerpZ * (Math.random() - 0.5) * 0.3
                    );
                    
                    // Mix the path direction with the random offset
                    this.confusedDirection = pathDirection.add(randomOffset).normalize();
                }
            }
            
            // Use a stronger mix of confused direction to make movement more erratic
            if (this.confusedDirection) {
                direction = direction.scale(0.5).add(this.confusedDirection.scale(0.5));
            }
        } else {
            // Reset confused direction when not confused
            this.confusedDirection = null;
        }
        
        // Normalize the direction
        const distance = direction.length();
        
        // If we're close enough to the target, move to the next point
        if (distance < 0.1) {
            this.currentPathIndex++;
            
            // If we've reached the end of the path, return true
            if (this.currentPathIndex >= this.path.length) {
                return true;
            }
            
            // Ensure we're exactly on the path point when reaching it
            this.position = targetPoint.clone();
            return false;
        }
        
        direction.normalize();
        
        // Move towards the target with reduced speed when confused
        const currentSpeed = this.isConfused ? this.speed * 0.7 : this.speed;
        const movement = direction.scale(currentSpeed * deltaTime);
        this.position.addInPlace(movement);
        
        // Ensure we don't overshoot the target
        const newDistanceToTarget = this.position.subtract(targetPoint).length();
        if (newDistanceToTarget > distance) {
            this.position = targetPoint.clone();
        }
        
        // Update mesh position if it still exists
        if (this.mesh && !this.mesh.isDisposed()) {
            this.mesh.position = this.position.clone();
        }
        
        // Update health bar position if it still exists
        if (this.healthBarMesh && !this.healthBarMesh.isDisposed() && 
            this.healthBarBackgroundMesh && !this.healthBarBackgroundMesh.isDisposed()) {
            this.updateHealthBar();
        }
        
        return false;
    }
    
    /**
     * Update active status effects
     * @param deltaTime Time elapsed since last update in seconds
     */
    protected updateStatusEffects(deltaTime: number): void {
        const currentTime = performance.now();
        const expiredEffects: StatusEffect[] = [];
        
        // Check for expired effects
        this.activeStatusEffects.forEach((effectData, effect) => {
            if (currentTime > effectData.endTime) {
                // Effect has expired
                expiredEffects.push(effect);
            } else {
                // Process active effects
                switch (effect) {
                    case StatusEffect.BURNING:
                        this.processBurningEffect(deltaTime);
                        break;
                    // Other effects are handled by their state flags (isFrozen, isSlowed, etc.)
                }
            }
        });
        
        // Remove expired effects
        for (const effect of expiredEffects) {
            this.removeStatusEffect(effect);
        }
    }
    
    /**
     * Process burning damage over time
     * @param deltaTime Time elapsed since last update in seconds
     */
    protected processBurningEffect(deltaTime: number): void {
        const currentTime = performance.now();
        const burnData = this.activeStatusEffects.get(StatusEffect.BURNING);
        
        if (!burnData) return;
        
        // Check if it's time for another burn damage tick
        if (currentTime - this.lastBurnDamageTime > this.burnDamageInterval * 1000) {
            // Apply burn damage
            this.takeDamage(this.burnDamagePerTick);
            this.lastBurnDamageTime = currentTime;
        }
    }

    /**
     * Apply a status effect to this enemy
     * @param effect The status effect to apply
     * @param duration Duration of the effect in seconds
     * @param strength Strength of the effect (e.g., slow percentage, damage per tick)
     */
    public applyStatusEffect(effect: StatusEffect, duration: number, strength: number): void {
        const endTime = performance.now() + (duration * 1000);
        
        // Store the effect data
        this.activeStatusEffects.set(effect, { endTime, strength });
        
        // Apply effect-specific changes
        switch (effect) {
            case StatusEffect.BURNING:
                this.burnDamagePerTick = strength;
                this.lastBurnDamageTime = performance.now();
                this.createStatusEffectParticles(effect);
                break;
                
            case StatusEffect.SLOWED:
                // Reduce speed by the slow percentage
                this.speed = this.originalSpeed * (1 - strength);
                this.createStatusEffectParticles(effect);
                break;
                
            case StatusEffect.FROZEN:
                this.isFrozen = true;
                this.speed = 0;
                this.createStatusEffectParticles(effect);
                break;
                
            case StatusEffect.STUNNED:
                this.isStunned = true;
                this.createStatusEffectParticles(effect);
                break;
                
            case StatusEffect.PUSHED:
                // Push logic is handled in the tower's effect application
                break;
                
            case StatusEffect.CONFUSED:
                this.isConfused = true;
                this.confusedDirection = null; // Will be set on next update
                this.createStatusEffectParticles(effect);
                break;
        }
    }
    
    /**
     * Remove a status effect
     * @param effect The status effect to remove
     */
    protected removeStatusEffect(effect: StatusEffect): void {
        this.activeStatusEffects.delete(effect);
        
        // Remove effect-specific changes
        switch (effect) {
            case StatusEffect.BURNING:
                // Stop burning particles
                this.stopStatusEffectParticles(effect);
                break;
                
            case StatusEffect.SLOWED:
                // Restore original speed
                this.speed = this.originalSpeed;
                this.stopStatusEffectParticles(effect);
                break;
                
            case StatusEffect.FROZEN:
                this.isFrozen = false;
                this.speed = this.originalSpeed;
                this.stopStatusEffectParticles(effect);
                break;
                
            case StatusEffect.STUNNED:
                this.isStunned = false;
                this.stopStatusEffectParticles(effect);
                break;
                
            case StatusEffect.CONFUSED:
                this.isConfused = false;
                this.confusedDirection = null;
                this.stopStatusEffectParticles(effect);
                break;
        }
    }
    
    /**
     * Create particles for a status effect
     * @param effect The status effect to create particles for
     */
    protected createStatusEffectParticles(effect: StatusEffect): void {
        if (!this.mesh) return;
        
        // Stop any existing particles for this effect
        this.stopStatusEffectParticles(effect);
        
        // Create a new particle system
        const particleSystem = new ParticleSystem(`${effect}Particles`, 20, this.scene);
        
        // Set particle texture
        particleSystem.particleTexture = new Texture('assets/textures/particle.png', this.scene);
        
        // Set emission properties
        particleSystem.emitter = this.mesh;
        particleSystem.minEmitBox = new Vector3(-0.4, 0, -0.4);
        particleSystem.maxEmitBox = new Vector3(0.4, 0.8, 0.4);
        
        // Set particle properties based on effect
        switch (effect) {
            case StatusEffect.BURNING:
                particleSystem.color1 = new Color4(1, 0.5, 0, 1.0);
                particleSystem.color2 = new Color4(1, 0, 0, 1.0);
                particleSystem.colorDead = new Color4(0.3, 0, 0, 0.0);
                particleSystem.minSize = 0.1;
                particleSystem.maxSize = 0.3;
                particleSystem.minLifeTime = 0.2;
                particleSystem.maxLifeTime = 0.4;
                particleSystem.emitRate = 30;
                particleSystem.direction1 = new Vector3(0, 1, 0);
                particleSystem.direction2 = new Vector3(0, 1, 0);
                particleSystem.minEmitPower = 1;
                particleSystem.maxEmitPower = 2;
                break;
                
            case StatusEffect.SLOWED:
                particleSystem.color1 = new Color4(0, 0.5, 1, 1.0);
                particleSystem.color2 = new Color4(0, 0, 1, 1.0);
                particleSystem.colorDead = new Color4(0, 0, 0.3, 0.0);
                particleSystem.minSize = 0.1;
                particleSystem.maxSize = 0.2;
                particleSystem.minLifeTime = 0.5;
                particleSystem.maxLifeTime = 1.0;
                particleSystem.emitRate = 10;
                particleSystem.direction1 = new Vector3(-0.5, -1, -0.5);
                particleSystem.direction2 = new Vector3(0.5, -1, 0.5);
                particleSystem.minEmitPower = 0.5;
                particleSystem.maxEmitPower = 1;
                break;
                
            case StatusEffect.FROZEN:
                particleSystem.color1 = new Color4(0.8, 0.8, 1, 1.0);
                particleSystem.color2 = new Color4(0.5, 0.5, 1, 1.0);
                particleSystem.colorDead = new Color4(0, 0, 0.5, 0.0);
                particleSystem.minSize = 0.05;
                particleSystem.maxSize = 0.15;
                particleSystem.minLifeTime = 1.0;
                particleSystem.maxLifeTime = 2.0;
                particleSystem.emitRate = 20;
                particleSystem.direction1 = new Vector3(-0.1, 0.1, -0.1);
                particleSystem.direction2 = new Vector3(0.1, 0.1, 0.1);
                particleSystem.minEmitPower = 0.1;
                particleSystem.maxEmitPower = 0.3;
                break;
                
            case StatusEffect.STUNNED:
                particleSystem.color1 = new Color4(1, 1, 0, 1.0);
                particleSystem.color2 = new Color4(1, 0.5, 0, 1.0);
                particleSystem.colorDead = new Color4(0.5, 0.5, 0, 0.0);
                particleSystem.minSize = 0.1;
                particleSystem.maxSize = 0.2;
                particleSystem.minLifeTime = 0.3;
                particleSystem.maxLifeTime = 0.6;
                particleSystem.emitRate = 15;
                particleSystem.direction1 = new Vector3(-0.5, 1, -0.5);
                particleSystem.direction2 = new Vector3(0.5, 1, 0.5);
                particleSystem.minEmitPower = 1;
                particleSystem.maxEmitPower = 2;
                break;
                
            case StatusEffect.CONFUSED:
                particleSystem.color1 = new Color4(1, 0, 1, 1.0);
                particleSystem.color2 = new Color4(0.5, 0, 0.5, 1.0);
                particleSystem.colorDead = new Color4(0.3, 0, 0.3, 0.0);
                particleSystem.minSize = 0.1;
                particleSystem.maxSize = 0.3;
                particleSystem.minLifeTime = 0.5;
                particleSystem.maxLifeTime = 1.0;
                particleSystem.emitRate = 10;
                particleSystem.direction1 = new Vector3(-1, 1, -1);
                particleSystem.direction2 = new Vector3(1, 1, 1);
                particleSystem.minEmitPower = 0.5;
                particleSystem.maxEmitPower = 1;
                break;
        }
        
        // Start the particle system
        particleSystem.start();
        
        // Store the particle system
        this.statusEffectParticles.set(effect, particleSystem);
    }
    
    /**
     * Stop particles for a status effect
     * @param effect The status effect to stop particles for
     */
    protected stopStatusEffectParticles(effect: StatusEffect): void {
        const particleSystem = this.statusEffectParticles.get(effect);
        if (particleSystem) {
            particleSystem.stop();
            particleSystem.dispose();
            this.statusEffectParticles.delete(effect);
        }
    }

    /**
     * Apply a difficulty multiplier to the enemy's stats
     * @param multiplier The multiplier to apply
     */
    public applyDifficultyMultiplier(multiplier: number): void {
        // Health scales linearly with multiplier (was multiplier^1.5 which made late game impossible)
        const healthMultiplier = multiplier;
        this.maxHealth = Math.floor(this.maxHealth * healthMultiplier);
        this.health = this.maxHealth;

        // Damage scales slightly less than linearly
        this.damage = Math.floor(this.damage * Math.pow(multiplier, 0.8));

        // Reward scales meaningfully with difficulty so economy keeps up
        this.reward = Math.floor(this.reward * Math.pow(multiplier, 0.9));

        // Damage resistance caps at 40% (was 70% which made enemies nearly invincible)
        // Ramps slowly: at 5x multiplier = 24%, at 10x = 36%, approaches 40% asymptotically
        this.damageResistance = Math.min(0.4, (multiplier - 1) * 0.08);

        // Update health bar
        this.updateHealthBar();

        console.log(`Enemy stats multiplied by ${multiplier.toFixed(2)}, health: ${this.maxHealth} (×${healthMultiplier.toFixed(2)}), resistance: ${(this.damageResistance * 100).toFixed(0)}%`);
    }
    
    /**
     * Apply damage to the enemy with damage resistance
     * @param amount The amount of damage to apply
     * @returns True if the enemy died from this damage
     */
    public takeDamage(amount: number): boolean {
        if (!this.alive) return false;
        
        // Apply damage resistance if it exists
        let actualDamage = amount;
        if (this.damageResistance && this.damageResistance > 0) {
            actualDamage = amount * (1 - this.damageResistance);
        }
        
        this.health -= actualDamage;
        
        // Update health bar instead of scaling
        this.updateHealthBar();
        
        if (this.health <= 0) {
            this.health = 0;
            this.die();
            return true;
        }
        
        return false;
    }

    /**
     * Handle enemy death
     */
    protected die(): void {
        if (!this.alive) return;
        
        this.alive = false;
        
        // Create death effect
        this.createDeathEffect();
        
        // Remove from scene
        if (this.mesh) {
            this.mesh.dispose();
            this.mesh = null;
        }
        
        // Remove health bar
        if (this.healthBarMesh) {
            this.healthBarMesh.dispose();
            this.healthBarMesh = null;
        }

        if (this.healthBarBackgroundMesh) {
            this.healthBarBackgroundMesh.dispose();
            this.healthBarBackgroundMesh = null;
        }

        if (this.healthBarOutlineMesh) {
            this.healthBarOutlineMesh.dispose();
            this.healthBarOutlineMesh = null;
        }
        
        // Remove status effect particles
        this.statusEffectParticles.forEach(particleSystem => {
            particleSystem.stop();
            particleSystem.dispose();
        });
        this.statusEffectParticles.clear();
        
        // Note: Money reward is handled by the EnemyManager which has access to PlayerStats
        // We don't need to award money here as it's done in EnemyManager.update()
    }

    /**
     * Create a death effect
     */
    protected createDeathEffect(): void {
        // This would create a particle effect or animation when the enemy dies
        // For simplicity, we'll just log it
        console.log('Enemy died at', this.position);
    }

    /**
     * Check if the enemy is alive
     * @returns True if the enemy is alive
     */
    public isAlive(): boolean {
        return this.alive;
    }

    /**
     * Get the enemy's position
     * @returns The enemy's position
     */
    public getPosition(): Vector3 {
        return this.position;
    }

    /**
     * Get the damage this enemy deals to the player
     * @returns The damage amount
     */
    public getDamage(): number {
        return this.damage;
    }

    /**
     * Get the reward for killing this enemy
     * @returns The reward amount
     */
    public getReward(): number {
        return this.reward;
    }

    /**
     * Clean up resources
     */
    public dispose(): void {
        if (this.mesh) {
            this.mesh.dispose();
            this.mesh = null;
        }

        if (this.healthBarMesh) {
            this.healthBarMesh.dispose();
            this.healthBarMesh = null;
        }

        if (this.healthBarBackgroundMesh) {
            this.healthBarBackgroundMesh.dispose();
            this.healthBarBackgroundMesh = null;
        }

        if (this.healthBarOutlineMesh) {
            this.healthBarOutlineMesh.dispose();
            this.healthBarOutlineMesh = null;
        }

        // Dispose all particle systems
        this.statusEffectParticles.forEach(particleSystem => {
            particleSystem.dispose();
        });
        this.statusEffectParticles.clear();
    }

    /**
     * Get the enemy type
     * @returns The enemy type
     */
    public getEnemyType(): EnemyType {
        return this.enemyType;
    }
    
    /**
     * Check if the enemy is flying
     * @returns True if the enemy is flying
     */
    public isEnemyFlying(): boolean {
        return this.isFlying;
    }
    
    /**
     * Check if the enemy is heavy
     * @returns True if the enemy is heavy
     */
    public isEnemyHeavy(): boolean {
        return this.isHeavy;
    }
    
    /**
     * Set the enemy type
     * @param type The enemy type
     */
    public setEnemyType(type: EnemyType): void {
        this.enemyType = type;
        
        // Update flying and heavy flags based on type
        this.isFlying = type === EnemyType.FLYING;
        this.isHeavy = type === EnemyType.HEAVY;
        
        // Update visuals based on type
        this.updateTypeVisuals();
    }
    
    /**
     * Update visuals based on enemy type
     */
    protected updateTypeVisuals(): void {
        if (!this.mesh) return;
        
        const material = this.mesh.material as StandardMaterial;
        
        switch (this.enemyType) {
            case EnemyType.FIRE:
                material.diffuseColor = new Color3(1, 0.3, 0);
                break;
                
            case EnemyType.WATER:
                material.diffuseColor = new Color3(0, 0.5, 1);
                break;
                
            case EnemyType.WIND:
                material.diffuseColor = new Color3(0.7, 1, 0.7);
                break;
                
            case EnemyType.EARTH:
                material.diffuseColor = new Color3(0.6, 0.3, 0);
                break;
                
            case EnemyType.ICE:
                material.diffuseColor = new Color3(0.8, 0.9, 1);
                break;
                
            case EnemyType.PLANT:
                material.diffuseColor = new Color3(0, 0.8, 0);
                break;
                
            case EnemyType.FLYING:
                material.diffuseColor = new Color3(0.8, 0.8, 1);
                // Make flying enemies hover higher
                this.mesh.position.y = 1.5;
                break;
                
            case EnemyType.HEAVY:
                material.diffuseColor = new Color3(0.5, 0.5, 0.5);
                // Make heavy enemies larger
                this.mesh.scaling = new Vector3(1.5, 1.5, 1.5);
                break;
                
            case EnemyType.LIGHT:
                material.diffuseColor = new Color3(1, 1, 0.8);
                // Make light enemies smaller
                this.mesh.scaling = new Vector3(0.7, 0.7, 0.7);
                break;
                
            case EnemyType.ELECTRIC:
                material.diffuseColor = new Color3(0.9, 0.9, 0);
                break;
                
            default:
                material.diffuseColor = new Color3(0.8, 0.2, 0.2);
                break;
        }
    }

    /**
     * Set the tower manager reference
     * @param towerManager The tower manager instance
     */
    public setTowerManager(towerManager: TowerManager): void {
        this.towerManager = towerManager;
    }
    
    /**
     * Check for towers in destruction range and destroy one if cooldown allows
     * @param deltaTime Time elapsed since last update
     * @returns True if a tower was destroyed
     */
    protected checkTowerDestruction(deltaTime: number): boolean {
        // Only process if this enemy can destroy towers
        if (!this.canDestroyTowers || !this.towerManager || !this.mesh) {
            return false;
        }
        
        // Check cooldown
        const currentTime = performance.now() / 1000;
        if (currentTime - this.lastTowerDestructionTime < this.towerDestructionCooldown) {
            return false;
        }
        
        // Find the closest tower in range
        const closestTower = this.towerManager.getClosestTower(this.position, this.towerDestructionRange);
        if (closestTower) {
            // Destroy the tower
            this.destroyTower(closestTower);
            
            // Update cooldown time
            this.lastTowerDestructionTime = currentTime;
            return true;
        }
        
        return false;
    }
    
    /**
     * Destroy a tower and create a destruction effect
     * @param tower The tower to destroy
     */
    protected destroyTower(tower: Tower): void {
        if (!this.towerManager) return;
        
        // Simply remove the tower without any special effects
        this.towerManager.sellTower(tower);
        
        // Show a message on the screen
        this.showTowerDestroyedMessage();
        
        // Log the tower destruction
        console.log("Tower destroyed by boss enemy");
    }
    
    /**
     * Show a message when a tower is destroyed
     */
    protected showTowerDestroyedMessage(): void {
        const scene = this.scene;
        if (!scene) return;
        
        // Create a text block in the center of the screen
        const message = document.createElement('div');
        message.style.position = 'absolute';
        message.style.top = '50%';
        message.style.left = '50%';
        message.style.transform = 'translate(-50%, -50%)';
        message.style.background = 'rgba(200, 0, 0, 0.7)';
        message.style.color = 'white';
        message.style.padding = '15px 30px';
        message.style.borderRadius = '5px';
        message.style.fontFamily = 'Arial, sans-serif';
        message.style.fontSize = '24px';
        message.style.fontWeight = 'bold';
        message.style.zIndex = '1000';
        message.innerText = 'The boss destroyed your tower!';
        
        // Add to document
        document.body.appendChild(message);
        
        // Remove after 2 seconds
        setTimeout(() => {
            document.body.removeChild(message);
        }, 2000);
    }
    
    /**
     * Create a destruction effect at the tower position
     * This method is kept empty to avoid trying to load external assets
     * @param position The position of the destroyed tower
     */
    protected createTowerDestructionEffect(position: Vector3): void {
        // Method intentionally left empty to prevent asset loading errors
        console.log("Tower destroyed at position", position);
    }
} 