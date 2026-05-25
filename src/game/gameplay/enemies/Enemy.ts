import { Vector3, Mesh, MeshBuilder, StandardMaterial, Color3, Color4, Scene, ParticleSystem, Texture, DynamicTexture, Sound, Animation, AnimationGroup } from '@babylonjs/core';
import { Game } from '../../Game';
import { EnemyType, StatusEffect } from '../GameTypes';

// Cached health-bar colors — shared across all enemy instances to avoid per-frame allocations
const HEALTH_COLOR_GREEN  = new Color3(0.2, 0.8, 0.2);
const HEALTH_COLOR_YELLOW = new Color3(0.8, 0.8, 0.2);
const HEALTH_COLOR_RED    = new Color3(0.8, 0.2, 0.2);

// Lazy-loaded shared texture for status-effect particle systems
let _statusEffectTexture: Texture | null = null;
export function getStatusEffectTexture(scene: Scene): Texture {
    if (!_statusEffectTexture) {
        _statusEffectTexture = new Texture('assets/textures/particle.png', scene);
    }
    return _statusEffectTexture;
}

export class Enemy {
    /**
     * Global crit provider — set once at run start by SurvivorsGameplayState.
     * Every `takeDamage()` call rolls a crit using these values. Cleared on
     * state exit so menu / non-survivors flows never accidentally inherit
     * stale stats from a prior run.
     */
    public static critProvider: (() => { chance: number; damageMult: number }) | null = null;

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

    // Survivors-mode seek-target fields
    public seekTarget: {
        getPosition: () => Vector3;
        takeDamage?: (amount: number, sourcePos?: Vector3) => void;
        isAlive?: () => boolean;
    } | null = null;
    public contactDamagePerSecond: number = 10;
    public isElite: boolean = false;
    public eliteDropElement: string | null = null;

    // Melee-swing tuning (survivors mode). Each subclass overrides these in its
    // constructor; defaults below are tuned for a basic-enemy quick jab.
    // The swing gives the enemy *reach* — without it, passive contactDamagePerSecond
    // never connects against a kiting hero because it requires literal overlap.
    protected meleeRange: number = 1.3;
    protected meleeHitRange: number = 1.6;
    protected meleeHitDamage: number = 12;
    protected meleeWindupDuration: number = 0.3;
    protected meleeStrikeDuration: number = 0.1;
    protected meleeCooldownDuration: number = 0.5;
    protected meleeRootDuringSwing: boolean = true;

    // Melee-swing state machine
    private meleeState: 'idle' | 'windup' | 'strike' | 'cooldown' = 'idle';
    private meleeTimer: number = 0;
    private meleeStrikeHasHit: boolean = false;

    /** AnimationGroups cloned by GLB instantiation. Subclasses register them
     *  here (typically `this.glbAnimationGroups = inst.animationGroups`) so
     *  dispose() can stop+release them. Without this every dead enemy left
     *  ~hundreds of animatables ticking in the scene every frame — the leak
     *  that made each subsequent wave's freeze longer than the last. */
    protected glbAnimationGroups: AnimationGroup[] = [];
    
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

    // CC immunity windows (prevent perma-CC)
    protected freezeImmunityUntil: number = 0; // timestamp when freeze immunity expires
    protected stunImmunityUntil: number = 0;   // timestamp when stun immunity expires

    // Reused per-frame array to avoid allocating a new array every update
    private _expiredStatusEffects: StatusEffect[] = [];

    // Scratch Vector3 fields — reused every frame to avoid per-frame allocations
    private _scratchDir: Vector3 = new Vector3();
    private _scratchMovement: Vector3 = new Vector3();

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

        // Update health bar color based on health percentage (use cached Color3 to avoid per-frame allocs)
        const material = this.healthBarMesh.material as StandardMaterial;
        if (healthPercent > 0.6) {
            material.diffuseColor = HEALTH_COLOR_GREEN;
        } else if (healthPercent > 0.3) {
            material.diffuseColor = HEALTH_COLOR_YELLOW;
        } else {
            material.diffuseColor = HEALTH_COLOR_RED;
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

        // --- Survivors seek-target branch ---
        if (this.seekTarget) {
            // Always tick status effects so slow/freeze/stun/burn still work
            this.updateStatusEffects(deltaTime);

            // Don't move if frozen or stunned (also cancel any in-progress swing)
            if (this.isFrozen || this.isStunned) {
                if (this.meleeState !== 'idle') this.cancelMeleeAttack();
                return false;
            }

            // Fetch the hero position ONCE per frame — Champion.getPosition() clones
            // a fresh Vector3 on each call, so calling it twice per enemy per frame
            // (once for the swing tick, once for movement) doubles GC pressure and
            // eventually triggers a stop-the-world pause that looks like a freeze.
            const targetPos = this.seekTarget.getPosition();

            // Tick the melee-swing state machine BEFORE movement so we can root
            // the enemy (skip movement) during windup + strike frames.
            this.updateMeleeAttack(deltaTime, targetPos);
            const rooted = this.meleeRootDuringSwing &&
                (this.meleeState === 'windup' || this.meleeState === 'strike');

            targetPos.subtractToRef(this.position, this._scratchDir);
            this._scratchDir.y = 0;
            const dist = this._scratchDir.length();

            if (dist > 0.001 && !rooted) {
                this._scratchDir.normalize();
                // Respect slow/freeze speed modifications already applied to this.speed
                this._scratchDir.scaleToRef(this.speed * deltaTime, this._scratchMovement);
                this.position.addInPlace(this._scratchMovement);
            } else if (dist > 0.001) {
                // Rooted: still normalize the direction so the mesh faces the hero
                this._scratchDir.normalize();
            }

            if (this.mesh && !this.mesh.isDisposed()) {
                this.mesh.position.copyFrom(this.position);
                if (dist > 0.01) {
                    this.mesh.rotation.y = Math.atan2(-this._scratchDir.x, -this._scratchDir.z);
                }
            }

            // Update health bar
            if (this.healthBarMesh && !this.healthBarMesh.isDisposed() &&
                this.healthBarBackgroundMesh && !this.healthBarBackgroundMesh.isDisposed()) {
                this.updateHealthBar();
            }

            return false; // Never "reach end of path" in survivors mode
        }
        // --- End survivors branch ---

        // Update status effects
        this.updateStatusEffects(deltaTime);

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
        targetPoint.subtractToRef(this.position, this._scratchDir);

        // Find the closest point on the path if we're too far from our target
        const distanceToPath = this._scratchDir.length();
        if (distanceToPath > 2) { // If we're more than 2 units away from our target
            // Reset to the last known good position
            this.position = this.path[Math.max(0, this.currentPathIndex - 1)].clone();
            targetPoint.subtractToRef(this.position, this._scratchDir);
        }
        
        // If confused, modify the direction but maintain general path following
        if (this.isConfused) {
            // Update confused direction more frequently for more erratic movement
            if (!this.confusedDirection || Math.random() < 0.1) {
                // Create a random offset perpendicular to the path direction
                const pathDirection = this._scratchDir.normalizeToNew();
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
                this._scratchDir.scaleInPlace(0.5);
                this.confusedDirection.scaleToRef(0.5, this._scratchMovement);
                this._scratchDir.addInPlace(this._scratchMovement);
            }
        } else {
            // Reset confused direction when not confused
            this.confusedDirection = null;
        }

        // Normalize the direction
        const distance = this._scratchDir.length();

        // If we're close enough to the target, move to the next point
        if (distance < 0.1) {
            this.currentPathIndex++;

            // If we've reached the end of the path, return true
            if (this.currentPathIndex >= this.path.length) {
                return true;
            }

            // Ensure we're exactly on the path point when reaching it
            this.position.copyFrom(targetPoint);
            return false;
        }

        this._scratchDir.normalize();

        // Move towards the target with reduced speed when confused
        const currentSpeed = this.isConfused ? this.speed * 0.7 : this.speed;
        this._scratchDir.scaleToRef(currentSpeed * deltaTime, this._scratchMovement);
        this.position.addInPlace(this._scratchMovement);

        // Ensure we don't overshoot the target
        this.position.subtractToRef(targetPoint, this._scratchMovement);
        const newDistanceToTarget = this._scratchMovement.length();
        if (newDistanceToTarget > distance) {
            this.position.copyFrom(targetPoint);
        }

        // Update mesh position if it still exists
        if (this.mesh && !this.mesh.isDisposed()) {
            this.mesh.position.copyFrom(this.position);
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
        this._expiredStatusEffects.length = 0;

        // Check for expired effects
        this.activeStatusEffects.forEach((effectData, effect) => {
            if (currentTime > effectData.endTime) {
                // Effect has expired
                this._expiredStatusEffects.push(effect);
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
        for (const effect of this._expiredStatusEffects) {
            this.removeStatusEffect(effect);
        }
    }

    /** True while a swing is winding up, striking, or recovering. Subclasses
     *  with their own attack timing (e.g., MilestoneBoss lunge) can check this. */
    public isMeleeAttacking(): boolean { return this.meleeState !== 'idle'; }

    /** Subclasses override to disable the swing under specific conditions
     *  (e.g., MilestoneBoss only swings while in its 'walking' lunge state). */
    protected canMeleeAttack(): boolean { return true; }

    /** Hook for subclass-specific swing visuals (e.g., the boss's overhead claw
     *  smash). `progress` is 0..1 within the current phase. */
    protected onMeleeAttackPhase(
        _state: 'windup' | 'strike' | 'cooldown',
        _progress: number,
    ): void {}

    /** Drive the melee-swing state machine. Called from the seek-target branch
     *  every frame. Damage applies on the FIRST frame of 'strike' if the hero is
     *  still inside meleeHitRange — a clean dodge if you backstep on telegraph.
     *  `heroPos` is passed in (not fetched) to avoid an extra Champion.getPosition
     *  clone per enemy per frame. */
    private updateMeleeAttack(deltaTime: number, heroPos: Vector3): void {
        if (!this.canMeleeAttack() || !this.seekTarget) {
            if (this.meleeState !== 'idle') this.cancelMeleeAttack();
            return;
        }

        this.meleeTimer -= deltaTime;
        const dx = heroPos.x - this.position.x;
        const dz = heroPos.z - this.position.z;
        const distSq = dx * dx + dz * dz;

        switch (this.meleeState) {
            case 'idle': {
                if (distSq <= this.meleeRange * this.meleeRange) {
                    this.meleeState = 'windup';
                    this.meleeTimer = this.meleeWindupDuration;
                    this.meleeStrikeHasHit = false;
                }
                break;
            }
            case 'windup': {
                this.onMeleeAttackPhase('windup', 1 - this.meleeTimer / this.meleeWindupDuration);
                if (this.meleeTimer <= 0) {
                    this.meleeState = 'strike';
                    this.meleeTimer = this.meleeStrikeDuration;
                }
                break;
            }
            case 'strike': {
                if (!this.meleeStrikeHasHit) {
                    if (distSq <= this.meleeHitRange * this.meleeHitRange) {
                        // Pass this.position by reference — triggerHitReaction only
                        // reads it for direction, never stores or mutates it.
                        this.seekTarget.takeDamage?.(this.meleeHitDamage, this.position);
                    }
                    this.meleeStrikeHasHit = true;
                }
                this.onMeleeAttackPhase('strike', 1 - this.meleeTimer / this.meleeStrikeDuration);
                if (this.meleeTimer <= 0) {
                    this.meleeState = 'cooldown';
                    this.meleeTimer = this.meleeCooldownDuration;
                }
                break;
            }
            case 'cooldown': {
                this.onMeleeAttackPhase('cooldown', 1 - this.meleeTimer / this.meleeCooldownDuration);
                if (this.meleeTimer <= 0) this.meleeState = 'idle';
                break;
            }
        }
    }

    private cancelMeleeAttack(): void {
        this.meleeState = 'idle';
        this.meleeTimer = 0;
        this.meleeStrikeHasHit = false;
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
        const currentTime = performance.now();
        const endTime = currentTime + (duration * 1000);

        // Apply effect-specific changes
        switch (effect) {
            case StatusEffect.BURNING:
                this.activeStatusEffects.set(effect, { endTime, strength });
                this.burnDamagePerTick = strength;
                this.lastBurnDamageTime = currentTime;
                this.createStatusEffectParticles(effect);
                break;

            case StatusEffect.SLOWED:
                // Cap slow at 80% (prevent 100% slow = freeze)
                this.activeStatusEffects.set(effect, { endTime, strength });
                this.speed = this.originalSpeed * Math.max(0.2, 1 - strength);
                this.createStatusEffectParticles(effect);
                break;

            case StatusEffect.FROZEN:
                // Check freeze immunity window (3s after last freeze ends)
                if (currentTime < this.freezeImmunityUntil) return;
                this.activeStatusEffects.set(effect, { endTime, strength });
                this.isFrozen = true;
                this.speed = 0;
                this.createStatusEffectParticles(effect);
                break;

            case StatusEffect.STUNNED:
                // Check stun immunity window (5s after last stun ends)
                if (currentTime < this.stunImmunityUntil) return;
                this.activeStatusEffects.set(effect, { endTime, strength });
                this.isStunned = true;
                this.createStatusEffectParticles(effect);
                break;

            case StatusEffect.PUSHED:
                this.activeStatusEffects.set(effect, { endTime, strength });
                // Push logic is handled in the tower's effect application
                break;

            case StatusEffect.CONFUSED:
                this.activeStatusEffects.set(effect, { endTime, strength });
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
                // 3 second immunity window after freeze ends
                this.freezeImmunityUntil = performance.now() + 3000;
                this.stopStatusEffectParticles(effect);
                break;

            case StatusEffect.STUNNED:
                this.isStunned = false;
                // 5 second immunity window after stun ends
                this.stunImmunityUntil = performance.now() + 5000;
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
        
        // Set particle texture (shared singleton — avoids N parallel texture loads on AoE bursts)
        particleSystem.particleTexture = getStatusEffectTexture(this.scene);
        
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

        // Roll for crit using the global provider (player run stats). DoT ticks
        // and chained sub-hits all flow through here, so every damage source —
        // basic attack, power, enchantment — gets one crit roll per call.
        let isCrit = false;
        let actualDamage = amount;
        const cp = Enemy.critProvider?.();
        if (cp && cp.chance > 0 && Math.random() < cp.chance) {
            isCrit = true;
            actualDamage *= cp.damageMult;
        }

        // Apply damage resistance if it exists
        if (this.damageResistance && this.damageResistance > 0) {
            actualDamage = actualDamage * (1 - this.damageResistance);
        }

        this.health -= actualDamage;

        // Update health bar instead of scaling
        this.updateHealthBar();

        // Hit flash: briefly turn mesh white for 80ms
        this.flashHit();

        const dmgEvent = new CustomEvent('enemyDamage', {
            detail: {
                position: this.position.clone(),
                damage: actualDamage,
                isCrit,
            },
        });
        document.dispatchEvent(dmgEvent);

        if (this.health <= 0) {
            this.health = 0;
            this.die();
            return true;
        }

        return false;
    }

    /**
     * Flash the enemy mesh white briefly on hit (80ms emissive pulse)
     */
    protected flashHit(): void {
        if (!this.mesh || this.mesh.isDisposed()) return;

        // Collect all materials from this mesh and children
        const meshes = [this.mesh, ...this.mesh.getChildMeshes(false)];
        const originalEmissives: { mat: StandardMaterial, color: Color3 }[] = [];

        for (const m of meshes) {
            const mat = m.material as StandardMaterial;
            if (mat && mat.emissiveColor !== undefined) {
                originalEmissives.push({ mat, color: mat.emissiveColor.clone() });
                mat.emissiveColor = new Color3(1, 1, 1);
            }
        }

        // Restore after 80ms
        setTimeout(() => {
            for (const entry of originalEmissives) {
                try {
                    entry.mat.emissiveColor = entry.color;
                } catch (_) {
                    // Material may have been disposed
                }
            }
        }, 80);
    }

    /**
     * Handle enemy death
     */
    protected die(): void {
        if (!this.alive) return;

        this.alive = false;

        // Tear down any in-progress melee swing.
        this.cancelMeleeAttack();

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
     * Create a death effect — particle burst + gold reward float text
     */
    protected createDeathEffect(): void {
        const deathPos = this.position.clone();
        deathPos.y += 0.5;

        // --- Particle burst ---
        const ps = new ParticleSystem('deathBurst', 30, this.scene);
        ps.emitter = deathPos;
        ps.minEmitBox = new Vector3(-0.2, 0, -0.2);
        ps.maxEmitBox = new Vector3(0.2, 0, 0.2);
        ps.color1 = new Color4(1, 0.8, 0.3, 1);
        ps.color2 = new Color4(0.8, 0.3, 0.1, 1);
        ps.colorDead = new Color4(0.3, 0.1, 0, 0);
        ps.minSize = 0.1;
        ps.maxSize = 0.35;
        ps.minLifeTime = 0.2;
        ps.maxLifeTime = 0.5;
        ps.emitRate = 100;
        ps.blendMode = ParticleSystem.BLENDMODE_ONEONE;
        ps.direction1 = new Vector3(-1, 1, -1);
        ps.direction2 = new Vector3(1, 2, 1);
        ps.minEmitPower = 1;
        ps.maxEmitPower = 3;
        ps.gravity = new Vector3(0, -5, 0);
        ps.start();
        setTimeout(() => { ps.stop(); setTimeout(() => ps.dispose(), 600); }, 150);

        // --- Gold reward float-up text ---
        this.showGoldRewardText(deathPos);
    }

    /**
     * Show floating gold reward text at the death position
     */
    protected showGoldRewardText(position: Vector3): void {
        const rewardEvent = new CustomEvent('enemyReward', {
            detail: {
                position: position,
                reward: this.reward
            }
        });
        document.dispatchEvent(rewardEvent);
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
     * Get the current health
     */
    public getHealth(): number {
        return this.health;
    }

    /**
     * Get the max health
     */
    public getMaxHealth(): number {
        return this.maxHealth;
    }

    /**
     * Get the current path index (how far along the path this enemy is)
     */
    public getPathIndex(): number {
        return this.currentPathIndex;
    }

    /**
     * Heal this enemy by the specified amount (capped at maxHealth)
     */
    public heal(amount: number): void {
        if (!this.alive) return;
        this.health = Math.min(this.maxHealth, this.health + amount);
        this.updateHealthBar();
    }

    /**
     * Clean up resources
     */
    public dispose(): void {
        this.cancelMeleeAttack();

        // Stop + dispose every AnimationGroup that GLB instantiation cloned
        // for this enemy. Without this the animatables keep running every
        // frame even though the mesh is gone — the dominant leak that made
        // scene._activeAnimatables grow to ~1900 with only a few enemies alive.
        for (const ag of this.glbAnimationGroups) {
            try { ag.stop(); } catch (_) { /* already stopped */ }
            try { ag.dispose(); } catch (_) { /* already disposed */ }
        }
        this.glbAnimationGroups.length = 0;

        if (this.mesh) {
            // disposeMaterialAndTextures=true releases the per-instance materials
            // the GLB pipeline clones (instantiateModelsToScene with cloneMaterials=true).
            // Without this every enemy death leaked 3-10 materials into scene.materials.
            this.mesh.dispose(false, true);
            this.mesh = null;
        }

        // Health bar materials are per-enemy `new StandardMaterial(...)` allocations
        // (see createHealthBar). Dispose them explicitly along with their meshes.
        if (this.healthBarMesh) {
            const m = this.healthBarMesh.material;
            this.healthBarMesh.dispose();
            if (m) m.dispose();
            this.healthBarMesh = null;
        }
        if (this.healthBarBackgroundMesh) {
            const m = this.healthBarBackgroundMesh.material;
            this.healthBarBackgroundMesh.dispose();
            if (m) m.dispose();
            this.healthBarBackgroundMesh = null;
        }
        if (this.healthBarOutlineMesh) {
            const m = this.healthBarOutlineMesh.material;
            this.healthBarOutlineMesh.dispose();
            if (m) m.dispose();
            this.healthBarOutlineMesh = null;
        }

        // Dispose all status-effect particle systems
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
     * Extend this enemy's path with additional waypoints.
     * Used when a new map segment is appended so in-flight enemies continue into it.
     */
    public extendPath(additionalPoints: Vector3[]): void {
        this.path.push(...additionalPoints);
    }

    /**
     * Push this enemy radially by `magnitude` world units in the given normalized
     * direction. No-op if the enemy is frozen or stunned (CC-immune window).
     * Boss subclasses may override to apply a fraction of the requested magnitude.
     *
     * Note: this only mutates `this.position` — the next seek-target frame will
     * pull the enemy back toward the hero, so the push is naturally bounded and
     * the enemy does not need to clamp itself to the arena radius.
     */
    public applyKnockback(dirX: number, dirZ: number, magnitude: number): void {
        if (!this.alive) return;
        if (this.isFrozen || this.isStunned) return;
        this.position.x += dirX * magnitude;
        this.position.z += dirZ * magnitude;
        if (this.mesh && !this.mesh.isDisposed()) {
            this.mesh.position.copyFrom(this.position);
        }
    }

}