import { Vector3, MeshBuilder, StandardMaterial, Color3, ParticleSystem, Texture, Color4, Mesh, Animation } from '@babylonjs/core';
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
     * Tower-specific meshes
     */
    private mudPool: Mesh | null = null;
    private mudPipes: Mesh[] = [];
    private mudDrips: Mesh[] = [];
    private mudRing: Mesh | null = null;
    
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
        try {
            // Create root mesh for the mud tower
            this.mesh = new Mesh("mudTowerRoot", this.scene);
            this.mesh.position = this.position.clone();
            
            // Create medieval base
            const base = this.createMedievalBase();
            base.parent = this.mesh;
            base.position.y = 0.6; // Position relative to root
            
            // Create middle section - stone cylindrical structure
            const middle = MeshBuilder.CreateCylinder(
                'mudTowerMiddle',
                {
                    height: 2.0,
                    diameterTop: 1.2,
                    diameterBottom: 1.6,
                    tessellation: 12
                },
                this.scene
            );
            middle.parent = this.mesh;
            middle.position.y = 1.8; // Position relative to root
            
            // Create material for middle section - weathered stone
            const middleMaterial = new StandardMaterial('mudTowerMiddleMaterial', this.scene);
            middleMaterial.diffuseColor = new Color3(0.5, 0.45, 0.4); // Gray-brown stone
            middleMaterial.specularColor = new Color3(0.1, 0.1, 0.1); // Low specularity
            middle.material = middleMaterial;
            
            // Create a mud pool at the top of the tower
            this.mudPool = MeshBuilder.CreateCylinder(
                'mudPool',
                {
                    height: 0.5,
                    diameterTop: 1.6,
                    diameterBottom: 1.2,
                    tessellation: 12
                },
                this.scene
            );
            this.mudPool.parent = this.mesh;
            this.mudPool.position.y = 3.0; // Position at top of tower
            
            // Create mud pool material
            const mudMaterial = new StandardMaterial('mudMaterial', this.scene);
            mudMaterial.diffuseColor = new Color3(0.35, 0.25, 0.15); // Dark brown
            mudMaterial.specularColor = new Color3(0.2, 0.2, 0.2);
            mudMaterial.emissiveColor = new Color3(0.1, 0.05, 0); // Subtle glow
            this.mudPool.material = mudMaterial;
            
            // Create mud surface inside the pool
            const mudSurface = MeshBuilder.CreateDisc(
                'mudSurface',
                {
                    radius: 0.7,
                    tessellation: 24
                },
                this.scene
            );
            mudSurface.parent = this.mesh;
            mudSurface.position.y = 3.1; // Slightly above pool rim
            
            // Create rippling mud material
            const mudSurfaceMaterial = new StandardMaterial('mudSurfaceMaterial', this.scene);
            mudSurfaceMaterial.diffuseColor = new Color3(0.4, 0.3, 0.15);
            mudSurfaceMaterial.specularColor = new Color3(0.3, 0.2, 0.1);
            mudSurfaceMaterial.alpha = 0.9; // Slightly transparent
            mudSurface.material = mudSurfaceMaterial;
            
            // Create animation for mud surface to simulate bubbling
            const frameRate = 15;
            const bubbleAnimation = new Animation(
                "mudBubbling", 
                "position.y", 
                frameRate, 
                Animation.ANIMATIONTYPE_FLOAT, 
                Animation.ANIMATIONLOOPMODE_CYCLE
            );
            
            // Create animation keys - subtle up/down movement
            const keys = [];
            keys.push({ frame: 0, value: 3.1 });
            keys.push({ frame: frameRate/2, value: 3.15 });
            keys.push({ frame: frameRate, value: 3.1 });
            bubbleAnimation.setKeys(keys);
            
            // Attach animation to mud surface and play it
            mudSurface.animations = [];
            mudSurface.animations.push(bubbleAnimation);
            this.scene.beginAnimation(mudSurface, 0, frameRate, true);
            
            // Create mud dripping pipes around the sides
            this.createMudPipes();
            
            // Create a rotating mud ring that will hold orbiting mud blobs
            this.mudRing = new Mesh("mudRingParent", this.scene);
            this.mudRing.parent = this.mesh;
            this.mudRing.position.y = 2.5; // Position near top of tower
            
            // Create mud blobs orbiting around the tower
            const blobCount = 5;
            const orbitRadius = 1.2;
            
            for (let i = 0; i < blobCount; i++) {
                const angle = (i / blobCount) * Math.PI * 2;
                
                // Create mud blob using irregular sphere
                const mudBlob = MeshBuilder.CreateSphere(
                    `mudBlob${i}`,
                    {
                        diameter: 0.3 + Math.random() * 0.2,
                        segments: 8
                    },
                    this.scene
                );
                
                // Make the blob slightly irregular
                mudBlob.scaling.x = 0.8 + Math.random() * 0.4;
                mudBlob.scaling.z = 0.8 + Math.random() * 0.4;
                mudBlob.scaling.y = 0.6 + Math.random() * 0.3;
                
                // Position blob in circular pattern
                mudBlob.parent = this.mudRing;
                mudBlob.position.x = Math.sin(angle) * orbitRadius;
                mudBlob.position.z = Math.cos(angle) * orbitRadius;
                
                // Add height variance
                mudBlob.position.y = (i % 2 === 0) ? 0.2 : -0.2;
                
                // Random rotation
                mudBlob.rotation.x = Math.random() * Math.PI;
                mudBlob.rotation.y = Math.random() * Math.PI;
                mudBlob.rotation.z = Math.random() * Math.PI;
                
                // Create mud blob material
                const blobMaterial = new StandardMaterial(`mudBlobMaterial${i}`, this.scene);
                blobMaterial.diffuseColor = new Color3(
                    0.35 + Math.random() * 0.1,
                    0.25 + Math.random() * 0.1,
                    0.15 + Math.random() * 0.05
                );
                blobMaterial.specularColor = new Color3(0.3, 0.2, 0.1);
                mudBlob.material = blobMaterial;
                
                // Add mud drip particle system
                const dripPS = new ParticleSystem(`mudDripPS${i}`, 10, this.scene);
                dripPS.emitter = mudBlob;
                dripPS.minSize = 0.03;
                dripPS.maxSize = 0.08;
                dripPS.minLifeTime = 0.3;
                dripPS.maxLifeTime = 0.6;
                dripPS.emitRate = 5;
                dripPS.color1 = new Color4(0.4, 0.3, 0.2, 0.8);
                dripPS.color2 = new Color4(0.35, 0.25, 0.15, 0.8);
                dripPS.colorDead = new Color4(0.3, 0.2, 0.1, 0);
                dripPS.minEmitPower = 0.1;
                dripPS.maxEmitPower = 0.2;
                dripPS.updateSpeed = 0.01;
                dripPS.direction1 = new Vector3(0, -1, 0);
                dripPS.direction2 = new Vector3(0, -1, 0);
                dripPS.gravity = new Vector3(0, -9.81, 0);
                dripPS.start();
                
                // Store blob for disposal
                this.mudDrips.push(mudBlob);
            }
            
            // Create animation for the mud ring rotation (slow spin)
            const rotateAnimation = new Animation(
                "mudRingRotation", 
                "rotation.y", 
                frameRate, 
                Animation.ANIMATIONTYPE_FLOAT, 
                Animation.ANIMATIONLOOPMODE_CYCLE
            );
            
            // Create animation keys - rotate 360 degrees over 180 frames (12 seconds at 15fps)
            const ringKeys = [];
            ringKeys.push({ frame: 0, value: 0 });
            ringKeys.push({ frame: 180, value: Math.PI * 2 });
            rotateAnimation.setKeys(ringKeys);
            
            // Attach animation to mud ring and play it
            this.mudRing.animations = [];
            this.mudRing.animations.push(rotateAnimation);
            this.scene.beginAnimation(this.mudRing, 0, 180, true);
            
            // Create main mud effect from pool
            this.createMudEffect();
            
        } catch (error) {
            console.error("Error creating Mud Tower mesh:", error);
        }
    }
    
    /**
     * Create a medieval-style base for the tower
     */
    private createMedievalBase(): Mesh {
        // Create a cylinder for the base
        const base = MeshBuilder.CreateCylinder(
            'mudTowerBase',
            {
                height: 1.2,
                diameterTop: 1.7,
                diameterBottom: 2.1,
                tessellation: 12
            },
            this.scene
        );
        
        // Create material for the base
        const baseMaterial = new StandardMaterial('baseMaterial', this.scene);
        baseMaterial.diffuseColor = new Color3(0.45, 0.4, 0.35); // Brown-gray stone color
        baseMaterial.specularColor = new Color3(0.1, 0.1, 0.1);
        base.material = baseMaterial;
        
        return base;
    }
    
    /**
     * Create mud pipes around the sides of the tower
     */
    private createMudPipes(): void {
        const pipeCount = 4;
        
        for (let i = 0; i < pipeCount; i++) {
            const angle = (i / pipeCount) * Math.PI * 2;
            
            // Create a pipe extending from tower
            const pipe = MeshBuilder.CreateCylinder(
                `mudPipe${i}`,
                {
                    height: 0.7,
                    diameter: 0.25,
                    tessellation: 8
                },
                this.scene
            );
            
            // Position and rotate pipe to extend from tower
            pipe.parent = this.mesh;
            pipe.rotation.x = Math.PI / 2; // Rotate to horizontal
            pipe.rotation.y = angle; // Position around tower
            pipe.position.y = 2.3; // Middle of tower
            pipe.position.x = Math.sin(angle) * 0.6; // Offset from center
            pipe.position.z = Math.cos(angle) * 0.6; // Offset from center
            
            // Create pipe material
            const pipeMaterial = new StandardMaterial(`pipeMaterial${i}`, this.scene);
            pipeMaterial.diffuseColor = new Color3(0.3, 0.25, 0.2); // Dark wood/stone
            pipeMaterial.specularColor = new Color3(0.1, 0.1, 0.1);
            pipe.material = pipeMaterial;
            
            // Store for later disposal
            this.mudPipes.push(pipe);
            
            // Create a flowing mud particle system from pipe
            const mudStream = new ParticleSystem(`mudStream${i}`, 20, this.scene);
            
            // Calculate pipe end position for emitter
            const emitterPos = new Vector3(
                this.position.x + Math.sin(angle) * 0.95,
                this.position.y + 2.3,
                this.position.z + Math.cos(angle) * 0.95
            );
            
            mudStream.emitter = emitterPos;
            mudStream.minSize = 0.1;
            mudStream.maxSize = 0.2;
            mudStream.minLifeTime = 0.5;
            mudStream.maxLifeTime = 1.0;
            mudStream.emitRate = 15;
            mudStream.color1 = new Color4(0.4, 0.3, 0.2, 0.8);
            mudStream.color2 = new Color4(0.35, 0.25, 0.15, 0.8);
            mudStream.colorDead = new Color4(0.3, 0.2, 0.1, 0);
            
            // Set direction downward
            mudStream.direction1 = new Vector3(0, -1, 0);
            mudStream.direction2 = new Vector3(0, -1, 0);
            mudStream.minEmitPower = 0.5;
            mudStream.maxEmitPower = 1.0;
            mudStream.gravity = new Vector3(0, -9.81, 0);
            mudStream.updateSpeed = 0.01;
            
            mudStream.start();
        }
    }
    
    /**
     * Create a mud effect around the tower
     */
    private createMudEffect(): void {
        if (!this.mesh) return;
        
        try {
            // Create a particle system for the mud bubbling from the pool
            this.mudParticles = new ParticleSystem('mudParticles', 40, this.scene);
            
            // Set emission properties - from mud pool
            this.mudParticles.emitter = new Vector3(
                this.position.x,
                this.position.y + 3.2, // Top of mud pool
                this.position.z
            );
            
            // Set particle size
            this.mudParticles.minSize = 0.1;
            this.mudParticles.maxSize = 0.3;
            
            // Set particle lifetime
            this.mudParticles.minLifeTime = 1.0;
            this.mudParticles.maxLifeTime = 2.0;
            
            // Set emission rate
            this.mudParticles.emitRate = 20;
            
            // Define colors - brown mud tones
            this.mudParticles.color1 = new Color4(0.45, 0.35, 0.25, 0.7);
            this.mudParticles.color2 = new Color4(0.4, 0.3, 0.2, 0.7);
            this.mudParticles.colorDead = new Color4(0.35, 0.25, 0.15, 0);
            
            // Set direction and power - bubbling up and out
            this.mudParticles.direction1 = new Vector3(-0.3, 0.5, -0.3);
            this.mudParticles.direction2 = new Vector3(0.3, 1.0, 0.3);
            this.mudParticles.minEmitPower = 0.2;
            this.mudParticles.maxEmitPower = 0.5;
            
            // Add slight gravity
            this.mudParticles.gravity = new Vector3(0, -0.5, 0);
            
            this.mudParticles.updateSpeed = 0.01;
            
            // Start the particle system
            this.mudParticles.start();
        } catch (error) {
            console.error("Error creating mud effect:", error);
        }
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
        try {
            // Create a mud pool mesh at target location
            const mudPoolMesh = MeshBuilder.CreateDisc(
                'targetMudPool',
                {
                    radius: this.areaOfEffect / 2, // Half the effect radius
                    tessellation: 16
                },
                this.scene
            );
            
            // Position slightly above ground
            mudPoolMesh.position = new Vector3(position.x, 0.05, position.z);
            mudPoolMesh.rotation.x = Math.PI / 2; // Make it flat on ground
            
            // Create mud material
            const mudPoolMaterial = new StandardMaterial('targetMudMaterial', this.scene);
            mudPoolMaterial.diffuseColor = new Color3(0.4, 0.3, 0.2);
            mudPoolMaterial.specularColor = new Color3(0.2, 0.2, 0.2);
            mudPoolMaterial.alpha = 0.8; // Slightly transparent
            mudPoolMesh.material = mudPoolMaterial;
            
            // Create mud splash particle effect
            const mudSplash = new ParticleSystem('mudSplash', 80, this.scene);
            mudSplash.emitter = position;
            mudSplash.minEmitBox = new Vector3(-0.2, 0, -0.2);
            mudSplash.maxEmitBox = new Vector3(0.2, 0.1, 0.2);
            mudSplash.minSize = 0.2;
            mudSplash.maxSize = 0.5;
            mudSplash.minLifeTime = 0.5;
            mudSplash.maxLifeTime = 1.5;
            mudSplash.emitRate = 40;
            mudSplash.color1 = new Color4(0.45, 0.35, 0.25, 0.8);
            mudSplash.color2 = new Color4(0.4, 0.3, 0.2, 0.8);
            mudSplash.colorDead = new Color4(0.35, 0.25, 0.15, 0);
            mudSplash.direction1 = new Vector3(-1, 1, -1);
            mudSplash.direction2 = new Vector3(1, 2, 1);
            mudSplash.minEmitPower = 1;
            mudSplash.maxEmitPower = 2;
            mudSplash.updateSpeed = 0.01;
            mudSplash.gravity = new Vector3(0, -9.81, 0);
            
            // Create expanding and fading animation for mud pool
            const frameRate = 24;
            const expandAnimation = new Animation(
                "mudPoolExpand",
                "scaling",
                frameRate,
                Animation.ANIMATIONTYPE_VECTOR3,
                Animation.ANIMATIONLOOPMODE_CONSTANT
            );
            
            const fadeAnimation = new Animation(
                "mudPoolFade",
                "material.alpha",
                frameRate,
                Animation.ANIMATIONTYPE_FLOAT,
                Animation.ANIMATIONLOOPMODE_CONSTANT
            );
            
            // Animation keys - expand over time
            const scaleKeys = [];
            scaleKeys.push({ frame: 0, value: new Vector3(0.5, 1, 0.5) });
            scaleKeys.push({ frame: frameRate * 2, value: new Vector3(1.5, 1, 1.5) });
            expandAnimation.setKeys(scaleKeys);
            
            // Animation keys - fade out
            const fadeKeys = [];
            fadeKeys.push({ frame: 0, value: 0.8 });
            fadeKeys.push({ frame: frameRate * 0.5, value: 0.8 }); // Hold for half a second
            fadeKeys.push({ frame: frameRate * 2, value: 0 });
            fadeAnimation.setKeys(fadeKeys);
            
            // Set animations
            mudPoolMesh.animations = [];
            mudPoolMesh.animations.push(expandAnimation);
            mudPoolMesh.animations.push(fadeAnimation);
            
            // Start animation and emit particles
            mudSplash.start();
            const animRef = this.scene.beginAnimation(mudPoolMesh, 0, frameRate * 2, false);
            
            // Cleanup when animation ends
            animRef.onAnimationEnd = () => {
                mudSplash.stop();
                setTimeout(() => {
                    if (mudPoolMesh.material) {
                        mudPoolMesh.material.dispose();
                    }
                    mudPoolMesh.dispose();
                    mudSplash.dispose();
                }, 1500);
            };
        } catch (error) {
            console.error("Error creating mud splash:", error);
        }
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
        
        // Stop animations
        if (this.mudRing) {
            this.scene.stopAnimation(this.mudRing);
        }
        
        // Clear armor reduced enemies map
        this.armorReducedEnemies.clear();
        
        // Dispose mud pipes
        this.mudPipes.forEach(pipe => {
            if (pipe.material) {
                pipe.material.dispose();
            }
            pipe.dispose();
        });
        this.mudPipes = [];
        
        // Dispose mud drips
        this.mudDrips.forEach(drip => {
            if (drip.material) {
                drip.material.dispose();
            }
            drip.dispose();
        });
        this.mudDrips = [];
        
        // Find and dispose any remaining particle systems
        if (this.mesh) {
            this.scene.particleSystems.forEach(ps => {
                if (ps.name.startsWith('mudStream') || 
                    ps.name.startsWith('mudDripPS')) {
                    ps.dispose();
                }
            });
        }
        
        // Call base class dispose
        super.dispose();
    }
} 