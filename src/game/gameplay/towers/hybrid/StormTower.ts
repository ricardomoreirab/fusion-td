import { Vector3, MeshBuilder, StandardMaterial, Color3, ParticleSystem, Texture, LinesMesh, Color4, Mesh, Animation } from '@babylonjs/core';
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
     * Tower-specific meshes
     */
    private spire: Mesh | null = null;
    private stormOrb: Mesh | null = null;
    private cloudRing: Mesh | null = null;
    private lightningRods: Mesh[] = [];
    
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
        try {
            // Create root mesh for the storm tower
            this.mesh = new Mesh("stormTowerRoot", this.scene);
            this.mesh.position = this.position.clone();
            
            // Create medieval base
            const base = this.createMedievalBase();
            base.parent = this.mesh;
            base.position.y = 0.6; // Position relative to root
            
            // Create middle section - stone tower structure
            const middle = MeshBuilder.CreateCylinder(
                'stormTowerMiddle',
                {
                    height: 2.5,
                    diameterTop: 0.9,
                    diameterBottom: 1.3,
                    tessellation: 8
                },
                this.scene
            );
            middle.parent = this.mesh;
            middle.position.y = 2.0; // Position relative to root
            
            // Create middle material - dark stone with blue tint
            const middleMaterial = new StandardMaterial('stormTowerMiddleMaterial', this.scene);
            middleMaterial.diffuseColor = new Color3(0.3, 0.35, 0.45); // Blue-gray stone
            middleMaterial.specularColor = new Color3(0.2, 0.2, 0.4);
            middleMaterial.emissiveColor = new Color3(0.05, 0.05, 0.1); // Subtle blue glow
            middle.material = middleMaterial;
            
            // Create a tall spire at the top with lightning conductor
            this.spire = MeshBuilder.CreateCylinder(
                'stormSpire',
                {
                    height: 2.0,
                    diameterTop: 0.05, // Very narrow at top
                    diameterBottom: 0.4,
                    tessellation: 8
                },
                this.scene
            );
            this.spire.parent = this.mesh;
            this.spire.position.y = 3.8; // Position at top of tower
            
            // Create spire material - metallic conductor
            const spireMaterial = new StandardMaterial('spireMaterial', this.scene);
            spireMaterial.diffuseColor = new Color3(0.4, 0.4, 0.5); // Metal color
            spireMaterial.specularColor = new Color3(0.8, 0.8, 0.9); // High specularity for metal
            spireMaterial.emissiveColor = new Color3(0.1, 0.1, 0.2); // Subtle glow
            this.spire.material = spireMaterial;
            
            // Create a storm orb at the center of the tower
            this.stormOrb = MeshBuilder.CreateSphere(
                'stormOrb',
                {
                    diameter: 0.8,
                    segments: 16
                },
                this.scene
            );
            this.stormOrb.parent = this.mesh;
            this.stormOrb.position.y = 3.3; // Position near top of middle section
            
            // Create glowing orb material
            const orbMaterial = new StandardMaterial('orbMaterial', this.scene);
            orbMaterial.diffuseColor = new Color3(0.4, 0.4, 0.9); // Blue
            orbMaterial.emissiveColor = new Color3(0.3, 0.3, 0.7); // Strong blue glow
            orbMaterial.specularColor = new Color3(0.9, 0.9, 1.0);
            orbMaterial.alpha = 0.7; // Slightly transparent
            this.stormOrb.material = orbMaterial;
            
            // Create pulsing animation for the orb
            const frameRate = 20;
            const pulseAnimation = new Animation(
                "orbPulse", 
                "scaling", 
                frameRate, 
                Animation.ANIMATIONTYPE_VECTOR3, 
                Animation.ANIMATIONLOOPMODE_CYCLE
            );
            
            // Create animation keys - pulse in and out
            const pulseKeys = [];
            pulseKeys.push({ frame: 0, value: new Vector3(1, 1, 1) });
            pulseKeys.push({ frame: frameRate/2, value: new Vector3(1.2, 1.2, 1.2) });
            pulseKeys.push({ frame: frameRate, value: new Vector3(1, 1, 1) });
            pulseAnimation.setKeys(pulseKeys);
            
            // Attach animation to orb and play it
            this.stormOrb.animations = [];
            this.stormOrb.animations.push(pulseAnimation);
            this.scene.beginAnimation(this.stormOrb, 0, frameRate, true);
            
            // Create lightning rods around the tower
            this.createLightningRods();
            
            // Create a cloud ring rotating around the tower
            this.cloudRing = new Mesh("cloudRingParent", this.scene);
            this.cloudRing.parent = this.mesh;
            this.cloudRing.position.y = 3.2; // Position at top of tower
            
            // Create cloud puffs orbiting around the tower
            const cloudCount = 6;
            const orbitRadius = 1.2;
            
            for (let i = 0; i < cloudCount; i++) {
                const angle = (i / cloudCount) * Math.PI * 2;
                
                // Create an elongated sphere as a cloud puff
                const cloud = MeshBuilder.CreateSphere(
                    `cloudPuff${i}`,
                    {
                        diameter: 0.6 + Math.random() * 0.3,
                        segments: 8
                    },
                    this.scene
                );
                
                // Flatten and stretch the cloud puff
                cloud.scaling.y = 0.5 + Math.random() * 0.2;
                cloud.scaling.x = 0.8 + Math.random() * 0.4;
                cloud.scaling.z = 0.8 + Math.random() * 0.3;
                
                // Position cloud in circular pattern
                cloud.parent = this.cloudRing;
                cloud.position.x = Math.sin(angle) * orbitRadius;
                cloud.position.z = Math.cos(angle) * orbitRadius;
                
                // Add height variance
                cloud.position.y = (i % 2 === 0) ? 0.15 : -0.15;
                
                // Random rotation
                cloud.rotation.y = Math.random() * Math.PI * 2;
                
                // Create cloud material - stormy clouds
                const cloudMaterial = new StandardMaterial(`cloudMaterial${i}`, this.scene);
                cloudMaterial.diffuseColor = new Color3(
                    0.3 + Math.random() * 0.1,
                    0.3 + Math.random() * 0.1,
                    0.4 + Math.random() * 0.1
                );
                cloudMaterial.specularColor = new Color3(0.2, 0.2, 0.3);
                cloudMaterial.alpha = 0.8; // Slightly transparent
                cloud.material = cloudMaterial;
                
                // Add mini-lightning particle system for some clouds
                if (i % 2 === 0) {
                    const lightningPS = new ParticleSystem(`cloudLightningPS${i}`, 5, this.scene);
                    lightningPS.emitter = cloud;
                    lightningPS.minSize = 0.05;
                    lightningPS.maxSize = 0.1;
                    lightningPS.minLifeTime = 0.1;
                    lightningPS.maxLifeTime = 0.3;
                    lightningPS.emitRate = 3;
                    lightningPS.color1 = new Color4(0.6, 0.6, 1.0, 0.8);
                    lightningPS.color2 = new Color4(0.3, 0.3, 0.8, 0.8);
                    lightningPS.colorDead = new Color4(0.1, 0.1, 0.3, 0);
                    lightningPS.direction1 = new Vector3(-0.3, -1, -0.3);
                    lightningPS.direction2 = new Vector3(0.3, -1, 0.3);
                    lightningPS.minEmitPower = 0.1;
                    lightningPS.maxEmitPower = 0.3;
                    lightningPS.updateSpeed = 0.01;
                    lightningPS.start();
                }
            }
            
            // Create animation for the cloud ring rotation
            const rotateAnimation = new Animation(
                "cloudRingRotation", 
                "rotation.y", 
                frameRate, 
                Animation.ANIMATIONTYPE_FLOAT, 
                Animation.ANIMATIONLOOPMODE_CYCLE
            );
            
            // Create animation keys - rotate 360 degrees over 240 frames (12 seconds at 20fps)
            const rotateKeys = [];
            rotateKeys.push({ frame: 0, value: 0 });
            rotateKeys.push({ frame: 240, value: Math.PI * 2 });
            rotateAnimation.setKeys(rotateKeys);
            
            // Attach animation to cloud ring and play it
            this.cloudRing.animations = [];
            this.cloudRing.animations.push(rotateAnimation);
            this.scene.beginAnimation(this.cloudRing, 0, 240, true);
            
            // Create main storm effect
            this.createStormEffect();
            
        } catch (error) {
            console.error("Error creating Storm Tower mesh:", error);
        }
    }
    
    /**
     * Create a medieval-style base for the tower
     */
    private createMedievalBase(): Mesh {
        // Create a cylinder for the base
        const base = MeshBuilder.CreateCylinder(
            'stormTowerBase',
            {
                height: 1.2,
                diameterTop: 1.4,
                diameterBottom: 1.8,
                tessellation: 8
            },
            this.scene
        );
        
        // Create material for the base
        const baseMaterial = new StandardMaterial('baseMaterial', this.scene);
        baseMaterial.diffuseColor = new Color3(0.35, 0.35, 0.4); // Dark gray stone color
        baseMaterial.specularColor = new Color3(0.2, 0.2, 0.3);
        base.material = baseMaterial;
        
        return base;
    }
    
    /**
     * Create lightning rods around the tower
     */
    private createLightningRods(): void {
        const rodCount = 4;
        
        for (let i = 0; i < rodCount; i++) {
            const angle = (i / rodCount) * Math.PI * 2;
            
            // Create rod base
            const rodBase = MeshBuilder.CreateBox(
                `rodBase${i}`,
                {
                    width: 0.2,
                    height: 0.1,
                    depth: 0.2
                },
                this.scene
            );
            
            // Position rod base
            rodBase.parent = this.mesh;
            rodBase.position.x = Math.sin(angle) * 0.6; // Position on edge of tower
            rodBase.position.z = Math.cos(angle) * 0.6;
            rodBase.position.y = 3.0; // At top of middle section
            
            // Create the rod
            const rod = MeshBuilder.CreateCylinder(
                `lightningRod${i}`,
                {
                    height: 0.8,
                    diameter: 0.05,
                    tessellation: 6
                },
                this.scene
            );
            
            // Position rod on base
            rod.parent = this.mesh;
            rod.position.x = Math.sin(angle) * 0.6;
            rod.position.z = Math.cos(angle) * 0.6;
            rod.position.y = 3.45; // Above the base
            
            // Create material for rod and base
            const rodMaterial = new StandardMaterial(`rodMaterial${i}`, this.scene);
            rodMaterial.diffuseColor = new Color3(0.4, 0.4, 0.5); // Metal color
            rodMaterial.specularColor = new Color3(0.8, 0.8, 0.9); // Highly reflective
            
            rod.material = rodMaterial;
            rodBase.material = rodMaterial;
            
            // Store for later disposal
            this.lightningRods.push(rod);
            this.lightningRods.push(rodBase);
            
            // Create occasional small sparks from the rod tips
            const sparkPS = new ParticleSystem(`rodSparkPS${i}`, 10, this.scene);
            sparkPS.emitter = new Vector3(
                this.position.x + Math.sin(angle) * 0.6,
                this.position.y + 3.85, // Rod tip
                this.position.z + Math.cos(angle) * 0.6
            );
            sparkPS.minSize = 0.02;
            sparkPS.maxSize = 0.08;
            sparkPS.minLifeTime = 0.05;
            sparkPS.maxLifeTime = 0.2;
            sparkPS.emitRate = 4;
            sparkPS.color1 = new Color4(0.6, 0.6, 1.0, 1.0);
            sparkPS.color2 = new Color4(0.4, 0.4, 0.9, 1.0);
            sparkPS.colorDead = new Color4(0.1, 0.1, 0.3, 0);
            sparkPS.direction1 = new Vector3(-0.2, 0.5, -0.2);
            sparkPS.direction2 = new Vector3(0.2, 1.0, 0.2);
            sparkPS.minEmitPower = 0.3;
            sparkPS.maxEmitPower = 0.7;
            sparkPS.updateSpeed = 0.01;
            sparkPS.start();
        }
    }
    
    /**
     * Create a storm particle effect around the tower
     */
    private createStormEffect(): void {
        if (!this.mesh || !this.stormOrb) return;
        
        try {
            // Create a particle system for the storm around the orb
            this.stormParticles = new ParticleSystem('stormParticles', 80, this.scene);
            
            // Set emission properties - from storm orb
            this.stormParticles.emitter = this.stormOrb;
            
            // Set particle properties
            this.stormParticles.minSize = 0.1;
            this.stormParticles.maxSize = 0.3;
            this.stormParticles.minLifeTime = 0.5;
            this.stormParticles.maxLifeTime = 1.5;
            this.stormParticles.emitRate = 40;
            
            // Define colors - blue-white lightning colors
            this.stormParticles.color1 = new Color4(0.6, 0.6, 1.0, 0.6);
            this.stormParticles.color2 = new Color4(0.3, 0.3, 0.8, 0.6);
            this.stormParticles.colorDead = new Color4(0.1, 0.1, 0.3, 0);
            
            // Direction and behavior - swirling around
            this.stormParticles.direction1 = new Vector3(-1, -0.5, -1);
            this.stormParticles.direction2 = new Vector3(1, 0.5, 1);
            this.stormParticles.minEmitPower = 0.5;
            this.stormParticles.maxEmitPower = 1.0;
            this.stormParticles.minAngularSpeed = 1.0;
            this.stormParticles.maxAngularSpeed = 2.0;
            
            // Add storm-like behavior
            this.stormParticles.updateSpeed = 0.01;
            
            // Start the particle system
            this.stormParticles.start();
            
            // Create a second particle system for lightning strikes from the top
            const lightningParticles = new ParticleSystem('lightningParticles', 20, this.scene);
            
            // Set emission properties - from top of spire
            lightningParticles.emitter = new Vector3(
                this.position.x,
                this.position.y + 4.85, // Top of spire
                this.position.z
            );
            
            // Set lightning particle properties
            lightningParticles.minSize = 0.05;
            lightningParticles.maxSize = 0.15;
            lightningParticles.minLifeTime = 0.1;
            lightningParticles.maxLifeTime = 0.3;
            lightningParticles.emitRate = 8;
            
            // Define colors - bright lightning
            lightningParticles.color1 = new Color4(0.8, 0.8, 1.0, 0.8);
            lightningParticles.color2 = new Color4(0.6, 0.6, 1.0, 0.8);
            lightningParticles.colorDead = new Color4(0.3, 0.3, 0.6, 0);
            
            // Direction - strike downward
            lightningParticles.direction1 = new Vector3(-0.3, -1, -0.3);
            lightningParticles.direction2 = new Vector3(0.3, -1, 0.3);
            lightningParticles.minEmitPower = 3.0;
            lightningParticles.maxEmitPower = 5.0;
            
            lightningParticles.updateSpeed = 0.005;
            
            lightningParticles.start();
        } catch (error) {
            console.error("Error creating storm effect:", error);
        }
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
        
        // Create a particle effect at the impact point
        const impactParticles = new ParticleSystem('impactParticles', 50, this.scene);
        impactParticles.emitter = end;
        impactParticles.minSize = 0.1;
        impactParticles.maxSize = 0.3;
        impactParticles.minLifeTime = 0.1;
        impactParticles.maxLifeTime = 0.3;
        impactParticles.emitRate = 100;
        impactParticles.manualEmitCount = 20; // Burst emission
        impactParticles.color1 = new Color4(0.8, 0.8, 1.0, 0.8);
        impactParticles.color2 = new Color4(0.6, 0.6, 1.0, 0.8);
        impactParticles.colorDead = new Color4(0.3, 0.3, 0.6, 0);
        impactParticles.direction1 = new Vector3(-1, -1, -1);
        impactParticles.direction2 = new Vector3(1, 1, 1);
        impactParticles.minEmitPower = 1.0;
        impactParticles.maxEmitPower = 2.0;
        impactParticles.updateSpeed = 0.01;
        
        // Emit once then dispose
        impactParticles.start();
        impactParticles.manualEmitCount = 0;
        setTimeout(() => {
            impactParticles.dispose();
        }, 500);
        
        // Remove the lightning bolt after a short time
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
        
        // Stop animations
        if (this.stormOrb) {
            this.scene.stopAnimation(this.stormOrb);
        }
        
        if (this.cloudRing) {
            this.scene.stopAnimation(this.cloudRing);
        }
        
        // Dispose lightning rods
        this.lightningRods.forEach(rod => {
            if (rod.material) {
                rod.material.dispose();
            }
            rod.dispose();
        });
        this.lightningRods = [];
        
        // Clear lightning bolts
        this.clearLightningBolts();
        
        // Find and dispose any remaining particle systems
        if (this.mesh) {
            this.scene.particleSystems.forEach(ps => {
                if (ps.name.startsWith('rodSparkPS') || 
                    ps.name.startsWith('cloudLightningPS') || 
                    ps.name.startsWith('lightningParticles')) {
                    ps.dispose();
                }
            });
        }
        
        // Call base class dispose
        super.dispose();
    }
} 