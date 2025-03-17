import { Vector3, MeshBuilder, StandardMaterial, Color3, ParticleSystem, Texture, Color4, Mesh, Animation } from '@babylonjs/core';
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
     * Tower-specific meshes
     */
    private spire: Mesh | null = null;
    private iceRing: Mesh | null = null;
    private iceCrystals: Mesh[] = [];
    
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
        try {
            // Create root mesh for the ice tower
            this.mesh = new Mesh("iceTowerRoot", this.scene);
            this.mesh.position = this.position.clone();
            
            // Create medieval base
            const base = this.createMedievalBase();
            base.parent = this.mesh;
            base.position.y = 0.6; // Position relative to root
            
            // Create middle section - twisted blue-white spire
            const middle = MeshBuilder.CreateCylinder(
                'iceTowerMiddle',
                {
                    height: 2.0,
                    diameterTop: 0.9,
                    diameterBottom: 1.2,
                    tessellation: 8 // Octagonal for crystalline look
                },
                this.scene
            );
            middle.parent = this.mesh;
            middle.position.y = 1.9; // Position relative to root
            
            // Create middle material - ice-like blue crystal
            const middleMaterial = new StandardMaterial('iceTowerMiddleMaterial', this.scene);
            middleMaterial.diffuseColor = new Color3(0.7, 0.85, 1.0); // Light blue
            middleMaterial.specularColor = new Color3(0.9, 0.95, 1.0); // Highly reflective
            middleMaterial.emissiveColor = new Color3(0.1, 0.3, 0.5); // Subtle blue glow
            middle.material = middleMaterial;
            
            // Create a twisted spire at the top
            this.spire = MeshBuilder.CreateCylinder(
                'iceSpire',
                {
                    height: 2.4,
                    diameterTop: 0.1, // Narrow point at top
                    diameterBottom: 0.8,
                    tessellation: 8
                },
                this.scene
            );
            this.spire.parent = this.mesh;
            this.spire.position.y = 3.6; // Position at top of tower
            
            // Twist the spire by adjusting vertices
            const spirePositions = this.spire.getVerticesData('position');
            if (spirePositions) {
                for (let i = 0; i < spirePositions.length; i += 3) {
                    // Only modify vertices above the base
                    const vertexHeight = spirePositions[i + 1];
                    
                    // Apply a twist based on height
                    if (vertexHeight > 0) {
                        const heightPercent = vertexHeight / 2.4;
                        const twistAngle = heightPercent * Math.PI * 0.8; // Twist by ~145 degrees
                        
                        // Get original x,z position
                        const x = spirePositions[i];
                        const z = spirePositions[i + 2];
                        
                        // Apply rotation to x,z coordinates
                        spirePositions[i] = x * Math.cos(twistAngle) - z * Math.sin(twistAngle);
                        spirePositions[i + 2] = x * Math.sin(twistAngle) + z * Math.cos(twistAngle);
                    }
                }
                
                // Update the mesh with the new vertex positions
                this.spire.updateVerticesData('position', spirePositions);
            }
            
            // Create spire material - translucent ice crystal
            const spireMaterial = new StandardMaterial('iceSpirematerial', this.scene);
            spireMaterial.diffuseColor = new Color3(0.8, 0.9, 1.0);
            spireMaterial.alpha = 0.7; // Slightly transparent
            spireMaterial.specularColor = new Color3(1.0, 1.0, 1.0);
            spireMaterial.emissiveColor = new Color3(0.2, 0.4, 0.8); // Blue glow
            this.spire.material = spireMaterial;
            
            // Create ice crystals floating around the tower
            this.createIceCrystals();
            
            // Create a rotating ice ring that will hold orbiting snowflakes
            this.iceRing = new Mesh("iceRingParent", this.scene);
            this.iceRing.parent = this.mesh;
            this.iceRing.position.y = 2.8; // Position above middle of tower
            
            // Create orbiting snowflakes
            const flakeCount = 6;
            const orbitRadius = 1.3;
            
            for (let i = 0; i < flakeCount; i++) {
                const angle = (i / flakeCount) * Math.PI * 2;
                
                // Create a simple plane to represent a snowflake
                const snowflake = MeshBuilder.CreatePlane(
                    `snowflake${i}`,
                    {
                        width: 0.25 + Math.random() * 0.15,
                        height: 0.25 + Math.random() * 0.15
                    },
                    this.scene
                );
                
                // Position snowflake in a circular pattern
                snowflake.parent = this.iceRing;
                snowflake.position.x = Math.sin(angle) * orbitRadius;
                snowflake.position.z = Math.cos(angle) * orbitRadius;
                
                // Add height variance
                snowflake.position.y = (i % 2 === 0) ? 0.2 : -0.2;
                
                // Make the snowflake face outward
                snowflake.billboardMode = 7; // All axes
                
                // Create snowflake material
                const snowflakeMaterial = new StandardMaterial(`snowflakeMaterial${i}`, this.scene);
                snowflakeMaterial.diffuseColor = new Color3(0.9, 0.95, 1.0);
                snowflakeMaterial.emissiveColor = new Color3(0.5, 0.7, 0.9);
                snowflakeMaterial.specularColor = new Color3(1.0, 1.0, 1.0);
                snowflakeMaterial.backFaceCulling = false;
                snowflake.material = snowflakeMaterial;
                
                // Add particle system for each snowflake
                const flakePS = new ParticleSystem(`snowflakePS${i}`, 15, this.scene);
                flakePS.emitter = snowflake;
                flakePS.minSize = 0.03;
                flakePS.maxSize = 0.08;
                flakePS.minLifeTime = 0.3;
                flakePS.maxLifeTime = 0.8;
                flakePS.emitRate = 12;
                flakePS.color1 = new Color4(0.8, 0.9, 1.0, 0.7);
                flakePS.color2 = new Color4(0.7, 0.8, 1.0, 0.5);
                flakePS.colorDead = new Color4(0.6, 0.7, 0.9, 0);
                flakePS.minEmitPower = 0.1;
                flakePS.maxEmitPower = 0.3;
                flakePS.updateSpeed = 0.01;
                flakePS.direction1 = new Vector3(-0.2, -0.1, -0.2);
                flakePS.direction2 = new Vector3(0.2, 0.3, 0.2);
                flakePS.start();
            }
            
            // Create animation for the ice ring rotation (slow, majestic rotation)
            const frameRate = 30;
            const rotateAnimation = new Animation(
                "iceRingRotation", 
                "rotation.y", 
                frameRate, 
                Animation.ANIMATIONTYPE_FLOAT, 
                Animation.ANIMATIONLOOPMODE_CYCLE
            );
            
            // Create animation keys - rotate 360 degrees over 300 frames (10 seconds)
            const keys = [];
            keys.push({ frame: 0, value: 0 });
            keys.push({ frame: 300, value: Math.PI * 2 });
            rotateAnimation.setKeys(keys);
            
            // Attach animation to ice ring and play it
            this.iceRing.animations = [];
            this.iceRing.animations.push(rotateAnimation);
            this.scene.beginAnimation(this.iceRing, 0, 300, true);
            
            // Create frost effect from top of the spire
            this.createIceEffect();
            
        } catch (error) {
            console.error("Error creating Ice Tower mesh:", error);
        }
    }
    
    /**
     * Create a medieval-style base for the tower
     */
    private createMedievalBase(): Mesh {
        // Create a cylinder for the base
        const base = MeshBuilder.CreateCylinder(
            'iceTowerBase',
            {
                height: 1.2,
                diameterTop: 1.6,
                diameterBottom: 2.0,
                tessellation: 8 // Octagonal base for theme
            },
            this.scene
        );
        
        // Create material for the base
        const baseMaterial = new StandardMaterial('baseMaterial', this.scene);
        baseMaterial.diffuseColor = new Color3(0.5, 0.6, 0.7); // Blueish stone color
        baseMaterial.specularColor = new Color3(0.3, 0.3, 0.4); // Some shine
        base.material = baseMaterial;
        
        return base;
    }
    
    /**
     * Create ice crystals around the tower
     */
    private createIceCrystals(): void {
        // Create several ice crystals around the base
        for (let i = 0; i < 5; i++) {
            const angle = (i / 5) * Math.PI * 2;
            
            // Create a crystal using a cone
            const crystal = MeshBuilder.CreatePolyhedron(
                `iceBasecrystal${i}`,
                {
                    type: 3, // Type 3 is icosahedron for crystal look
                    size: 0.25 + Math.random() * 0.15
                },
                this.scene
            );
            
            // Position around base at random distances
            crystal.parent = this.mesh;
            crystal.position.x = Math.sin(angle) * (0.8 + Math.random() * 0.3);
            crystal.position.z = Math.cos(angle) * (0.8 + Math.random() * 0.3);
            crystal.position.y = 0.3 + Math.random() * 0.2; // Slight height variation
            
            // Random rotation for variety
            crystal.rotation.x = Math.random() * Math.PI;
            crystal.rotation.y = Math.random() * Math.PI;
            crystal.rotation.z = Math.random() * Math.PI;
            
            // Scale the crystal to make it tall and pointy
            crystal.scaling.y = 1.5 + Math.random();
            
            // Create crystal material - translucent blue ice
            const crystalMaterial = new StandardMaterial(`iceCrystalMaterial${i}`, this.scene);
            crystalMaterial.diffuseColor = new Color3(0.75, 0.85, 1.0);
            crystalMaterial.alpha = 0.6 + Math.random() * 0.3;
            crystalMaterial.specularColor = new Color3(0.8, 0.9, 1.0);
            crystalMaterial.emissiveColor = new Color3(0.1, 0.2, 0.5);
            crystal.material = crystalMaterial;
            
            // Store for later disposal
            this.iceCrystals.push(crystal);
            
            // Add frost particle effect for some of the crystals
            if (i % 2 === 0) {
                const frostPS = new ParticleSystem(`frostPS${i}`, 10, this.scene);
                frostPS.emitter = crystal;
                frostPS.minSize = 0.05;
                frostPS.maxSize = 0.15;
                frostPS.minLifeTime = 0.8;
                frostPS.maxLifeTime = 1.5;
                frostPS.emitRate = 8;
                frostPS.color1 = new Color4(0.8, 0.9, 1.0, 0.6);
                frostPS.color2 = new Color4(0.7, 0.8, 1.0, 0.5);
                frostPS.colorDead = new Color4(0.6, 0.7, 0.9, 0);
                frostPS.minEmitPower = 0.1;
                frostPS.maxEmitPower = 0.3;
                frostPS.direction1 = new Vector3(-0.1, 0.5, -0.1);
                frostPS.direction2 = new Vector3(0.1, 1.0, 0.1);
                frostPS.updateSpeed = 0.01;
                frostPS.start();
            }
        }
    }
    
    /**
     * Create an ice particle effect from the tower's spire
     */
    private createIceEffect(): void {
        if (!this.mesh) return;
        
        try {
            // Create a particle system for the ice
            this.iceParticles = new ParticleSystem('iceParticles', 50, this.scene);
            
            // Set emission properties
            this.iceParticles.emitter = new Vector3(
                this.position.x,
                this.position.y + 4.5, // Top of spire
                this.position.z
            );
            
            // Set particle properties
            this.iceParticles.minSize = 0.05;
            this.iceParticles.maxSize = 0.15;
            this.iceParticles.minLifeTime = 1.5;
            this.iceParticles.maxLifeTime = 2.5;
            this.iceParticles.emitRate = 30;
            
            // Define direct colors (avoid Color3 to Color4 conversion issues)
            this.iceParticles.color1 = new Color4(0.8, 0.9, 1.0, 0.7);
            this.iceParticles.color2 = new Color4(0.7, 0.8, 1.0, 0.6);
            this.iceParticles.colorDead = new Color4(0.6, 0.7, 0.9, 0.0);
            
            // Direction and behavior - falling like snow
            this.iceParticles.direction1 = new Vector3(-0.5, -0.2, -0.5);
            this.iceParticles.direction2 = new Vector3(0.5, 0.0, 0.5);
            this.iceParticles.minEmitPower = 0.3;
            this.iceParticles.maxEmitPower = 0.7;
            this.iceParticles.updateSpeed = 0.01;
            
            // Add slight gravity
            this.iceParticles.gravity = new Vector3(0, -0.1, 0);
            
            // Start the particle system
            this.iceParticles.start();
        } catch (error) {
            console.error("Error creating ice effect:", error);
        }
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
        if (!this.mesh || !this.spire) return;
        
        try {
            // Get the top of the spire as the launch position
            const launchPosition = new Vector3(
                this.position.x,
                this.position.y + 4.4, // Top of spire
                this.position.z
            );
            
            // Create ice shard mesh for projectile
            const iceShard = MeshBuilder.CreatePolyhedron(
                'iceProjectile',
                {
                    type: 3, // Icosahedron
                    size: 0.15
                },
                this.scene
            );
            
            // Position at top of spire
            iceShard.position = launchPosition.clone();
            
            // Create ice material for the shard
            const shardMaterial = new StandardMaterial('projectileMaterial', this.scene);
            shardMaterial.diffuseColor = new Color3(0.7, 0.9, 1.0);
            shardMaterial.alpha = 0.7; // Slightly transparent
            shardMaterial.specularColor = new Color3(1.0, 1.0, 1.0);
            shardMaterial.emissiveColor = new Color3(0.3, 0.5, 0.9); // Strong blue glow
            iceShard.material = shardMaterial;
            
            // Create a simple particle trail for the projectile
            const iceTrail = new ParticleSystem('iceProjectileTrail', 60, this.scene);
            iceTrail.emitter = iceShard;
            iceTrail.minSize = 0.05;
            iceTrail.maxSize = 0.1;
            iceTrail.minLifeTime = 0.2;
            iceTrail.maxLifeTime = 0.5;
            iceTrail.emitRate = 40;
            iceTrail.color1 = new Color4(0.8, 0.9, 1.0, 0.7);
            iceTrail.color2 = new Color4(0.7, 0.8, 1.0, 0.5);
            iceTrail.colorDead = new Color4(0.6, 0.7, 0.9, 0);
            iceTrail.minEmitPower = 0.1;
            iceTrail.maxEmitPower = 0.2;
            iceTrail.updateSpeed = 0.01;
            iceTrail.start();
            
            // Calculate direction to target
            const direction = targetPosition.subtract(launchPosition);
            const distance = direction.length();
            direction.normalize();
            
            // Calculate flight time based on distance (speed of 15 units per second)
            const flightTime = distance / 15;
            
            // Create animation to move projectile to target
            const frameRate = 60;
            const moveAnimation = new Animation(
                "projectileMove",
                "position",
                frameRate,
                Animation.ANIMATIONTYPE_VECTOR3,
                Animation.ANIMATIONLOOPMODE_CONSTANT
            );
            
            // Create animation keys
            const positionKeys = [];
            positionKeys.push({ frame: 0, value: launchPosition });
            
            // Add a slight arc to the trajectory
            const midPoint = launchPosition.add(direction.scale(distance * 0.5));
            midPoint.y += 1.0; // Arc height
            
            positionKeys.push({ frame: frameRate * flightTime * 0.5, value: midPoint });
            positionKeys.push({ frame: frameRate * flightTime, value: targetPosition });
            
            moveAnimation.setKeys(positionKeys);
            
            // Add animation to shard
            iceShard.animations = [];
            iceShard.animations.push(moveAnimation);
            
            // Play animation and handle impact when complete
            const animationRef = this.scene.beginAnimation(iceShard, 0, frameRate * flightTime, false);
            animationRef.onAnimationEnd = () => {
                // Create impact effect
                this.createIceImpact(targetPosition);
                
                // Dispose projectile
                iceTrail.stop();
                setTimeout(() => {
                    if (iceShard.material) {
                        iceShard.material.dispose();
                    }
                    iceShard.dispose();
                    iceTrail.dispose();
                }, 500);
            };
        } catch (error) {
            console.error("Error creating ice projectile:", error);
        }
    }
    
    /**
     * Create an ice impact effect at the target
     * @param position Position for the impact
     */
    private createIceImpact(position: Vector3): void {
        try {
            // Create an expanding frost ring
            const frostRing = MeshBuilder.CreateDisc(
                'frostRing',
                {
                    radius: 0.1,
                    tessellation: 16
                },
                this.scene
            );
            
            // Position slightly above ground
            frostRing.position = new Vector3(position.x, 0.05, position.z);
            frostRing.rotation.x = Math.PI / 2; // Lay flat
            
            // Create frost material
            const frostMaterial = new StandardMaterial('frostMaterial', this.scene);
            frostMaterial.diffuseColor = new Color3(0.8, 0.9, 1.0);
            frostMaterial.alpha = 0.7;
            frostMaterial.emissiveColor = new Color3(0.4, 0.6, 0.9);
            frostRing.material = frostMaterial;
            
            // Create expanding and fading animation for frost ring
            const frameRate = 60;
            const expandAnimation = new Animation(
                "frostExpand",
                "scaling",
                frameRate,
                Animation.ANIMATIONTYPE_VECTOR3,
                Animation.ANIMATIONLOOPMODE_CONSTANT
            );
            
            const fadeAnimation = new Animation(
                "frostFade",
                "material.alpha",
                frameRate,
                Animation.ANIMATIONTYPE_FLOAT,
                Animation.ANIMATIONLOOPMODE_CONSTANT
            );
            
            // Animation keys
            const scaleKeys = [];
            scaleKeys.push({ frame: 0, value: new Vector3(1, 1, 1) });
            scaleKeys.push({ frame: frameRate * 1.5, value: new Vector3(this.areaOfEffect * 2, 1, this.areaOfEffect * 2) });
            expandAnimation.setKeys(scaleKeys);
            
            const fadeKeys = [];
            fadeKeys.push({ frame: 0, value: 0.7 });
            fadeKeys.push({ frame: frameRate * 1.5, value: 0 });
            fadeAnimation.setKeys(fadeKeys);
            
            // Add animations
            frostRing.animations = [];
            frostRing.animations.push(expandAnimation);
            frostRing.animations.push(fadeAnimation);
            
            // Play animations
            const animationRef = this.scene.beginAnimation(frostRing, 0, frameRate * 1.5, false);
            animationRef.onAnimationEnd = () => {
                if (frostRing.material) {
                    frostRing.material.dispose();
                }
                frostRing.dispose();
            };
            
            // Create particle burst for impact
            const impactBurst = new ParticleSystem('iceImpact', 80, this.scene);
            impactBurst.emitter = position;
            impactBurst.minSize = 0.1;
            impactBurst.maxSize = 0.3;
            impactBurst.minLifeTime = 0.5;
            impactBurst.maxLifeTime = 1.0;
            impactBurst.emitRate = 100;
            impactBurst.manualEmitCount = 60; // Burst amount
            impactBurst.color1 = new Color4(0.8, 0.9, 1.0, 0.8);
            impactBurst.color2 = new Color4(0.7, 0.8, 1.0, 0.7);
            impactBurst.colorDead = new Color4(0.6, 0.7, 0.9, 0);
            impactBurst.minEmitPower = 0.5;
            impactBurst.maxEmitPower = 1.5;
            impactBurst.updateSpeed = 0.01;
            // Set emission box using minEmitBox and maxEmitBox
            impactBurst.minEmitBox = new Vector3(-0.1, -0.1, -0.1);
            impactBurst.maxEmitBox = new Vector3(0.1, 0.1, 0.1);
            
            // Emit once and then dispose
            impactBurst.start();
            impactBurst.manualEmitCount = 0;
            
            setTimeout(() => {
                impactBurst.dispose();
            }, 1500); // Dispose after particles fade
            
        } catch (error) {
            console.error("Error creating ice impact:", error);
        }
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
     * Define area of effect for frost
     */
    private get areaOfEffect(): number {
        return 2.0; // 2 units radius for frost effects
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
        
        // Stop animations
        if (this.iceRing) {
            this.scene.stopAnimation(this.iceRing);
        }
        
        // Clean up ice crystals
        this.iceCrystals.forEach(crystal => {
            if (crystal.material) {
                crystal.material.dispose();
            }
            crystal.dispose();
        });
        this.iceCrystals = [];
        
        // Clear frozen enemies tracker
        this.frozenEnemies.clear();
        
        // Find and dispose any remaining particle systems
        if (this.mesh) {
            this.scene.particleSystems.forEach(ps => {
                if (ps.name.startsWith('snowflakePS') || 
                    ps.name.startsWith('frostPS')) {
                    ps.dispose();
                }
            });
        }
        
        // Call base class dispose
        super.dispose();
    }
} 