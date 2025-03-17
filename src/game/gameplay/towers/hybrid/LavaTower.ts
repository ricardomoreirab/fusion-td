import { Vector3, MeshBuilder, StandardMaterial, Color3, ParticleSystem, Texture, Color4, Mesh, Animation } from '@babylonjs/core';
import { Game } from '../../../Game';
import { Tower, ElementType, StatusEffect, EnemyType } from '../Tower';
import { Enemy } from '../../enemies/Enemy';

/**
 * Lava Tower - Combines Fire and Earth elements
 * - Creates lava pools that damage enemies over time
 * - Deals high damage to ground units
 * - Strong against: Wind, Plant
 * - Weak against: Water
 */
export class LavaTower extends Tower {
    /**
     * The radius of the lava pool effect
     */
    private areaOfEffect: number = 2.5;
    
    /**
     * The current lava particle system
     */
    private lavaParticles: ParticleSystem | null = null;
    
    /**
     * Tower-specific meshes
     */
    private volcano: Mesh | null = null;
    private lavaRing: Mesh | null = null;
    private lavaPools: Mesh[] = [];
    
    /**
     * Constructor for the LavaTower
     * @param game The game instance
     * @param position The position of the tower
     */
    constructor(game: Game, position: Vector3) {
        // Base stats for lava tower
        const damage = 15;
        const range = 4.5;
        const fireRate = 0.8;
        const cost = 250;
        
        super(game, position, range, damage, fireRate, cost);
        
        // Set lava-specific properties
        this.secondaryEffectChance = 0.6; // 60% chance for secondary effect
        this.statusEffectDuration = 4; // 4 seconds of effect
        this.statusEffectStrength = 0.25; // 25% of damage per second for burning
        
        // Set targeting priorities
        this.targetPriorities = [
            EnemyType.WIND,
            EnemyType.PLANT
        ];
        
        // Set weaknesses
        this.weakAgainst = [
            EnemyType.WATER
        ];
        
        // Lava towers cannot target flying enemies
        this.canTargetFlying = false;
        
        // Create the tower mesh
        this.createMesh();
    }
    
    /**
     * Create the tower mesh
     */
    protected createMesh(): void {
        try {
            // Create root mesh for the lava tower
            this.mesh = new Mesh("lavaTowerRoot", this.scene);
            this.mesh.position = this.position.clone();
            
            // Create medieval base
            const base = this.createMedievalBase();
            base.parent = this.mesh;
            base.position.y = 0.6; // Position relative to root
            
            // Create middle section - volcano-like structure
            const middle = MeshBuilder.CreateCylinder(
                'lavaTowerMiddle',
                {
                    height: 2.0,
                    diameterTop: 1.5,
                    diameterBottom: 1.9,
                    tessellation: 10 // Less smooth for rocky appearance
                },
                this.scene
            );
            middle.parent = this.mesh;
            middle.position.y = 1.9; // Position relative to root
            
            // Create middle material - dark rocky stone
            const middleMaterial = new StandardMaterial('lavaTowerMiddleMaterial', this.scene);
            middleMaterial.diffuseColor = new Color3(0.3, 0.2, 0.15); // Dark brown stone
            middleMaterial.specularColor = new Color3(0.1, 0.1, 0.1);
            middle.material = middleMaterial;
            
            // Create volcanic crater at the top
            this.volcano = MeshBuilder.CreateCylinder(
                'volcanoCrater',
                {
                    height: 1.2,
                    diameterTop: 2.0, // Wider at top like a crater
                    diameterBottom: 1.4,
                    tessellation: 10
                },
                this.scene
            );
            this.volcano.parent = this.mesh;
            this.volcano.position.y = 3.4; // Position at top of tower
            
            // Create volcano material - dark stone with red glow
            const volcanoMaterial = new StandardMaterial('volcanoMaterial', this.scene);
            volcanoMaterial.diffuseColor = new Color3(0.4, 0.2, 0.1);
            volcanoMaterial.emissiveColor = new Color3(0.2, 0.05, 0);
            volcanoMaterial.specularColor = new Color3(0.3, 0.2, 0.1);
            this.volcano.material = volcanoMaterial;
            
            // Create lava pool inside the volcano crater
            const lavaPool = MeshBuilder.CreateDisc(
                'lavaPool',
                {
                    radius: 0.9,
                    tessellation: 18
                },
                this.scene
            );
            lavaPool.parent = this.mesh;
            lavaPool.position.y = 3.8; // Position at the top of the volcano
            
            // Create lava material with glow
            const lavaMaterial = new StandardMaterial('lavaMaterial', this.scene);
            lavaMaterial.diffuseColor = new Color3(1, 0.3, 0);
            lavaMaterial.emissiveColor = new Color3(0.8, 0.2, 0);
            lavaMaterial.specularColor = new Color3(1, 0.6, 0.3);
            lavaPool.material = lavaMaterial;
            
            // Add rock formations around the base
            this.createRockFormations();
            
            // Create lava streams flowing down the sides
            this.createLavaStreams();
            
            // Create a rotating lava ring that will hold orbiting lava rocks
            this.lavaRing = new Mesh("lavaRingParent", this.scene);
            this.lavaRing.parent = this.mesh;
            this.lavaRing.position.y = 2.8; // Position above middle of tower
            
            // Create circulating lava rocks
            const rockCount = 4;
            const orbitRadius = 1.3;
            
            for (let i = 0; i < rockCount; i++) {
                const angle = (i / rockCount) * Math.PI * 2;
                
                // Create a lava rock using polyhedron
                const lavaRock = MeshBuilder.CreatePolyhedron(
                    `lavaRock${i}`,
                    {
                        type: i % 2 === 0 ? 0 : 2, // Different rock shapes
                        size: 0.3 + Math.random() * 0.15
                    },
                    this.scene
                );
                
                // Position rock in a circular pattern
                lavaRock.parent = this.lavaRing;
                lavaRock.position.x = Math.sin(angle) * orbitRadius;
                lavaRock.position.z = Math.cos(angle) * orbitRadius;
                
                // Add some height variance
                lavaRock.position.y = (i % 2 === 0) ? 0.2 : -0.2;
                
                // Random rotation
                lavaRock.rotation.x = Math.random() * Math.PI;
                lavaRock.rotation.y = Math.random() * Math.PI;
                lavaRock.rotation.z = Math.random() * Math.PI;
                
                // Create glowing lava rock material
                const rockMaterial = new StandardMaterial(`lavaRockMaterial${i}`, this.scene);
                rockMaterial.diffuseColor = new Color3(0.8, 0.3, 0.1); // Orange-red
                rockMaterial.emissiveColor = new Color3(0.5, 0.1, 0);  // Red glow
                rockMaterial.specularColor = new Color3(1.0, 0.5, 0.2);
                lavaRock.material = rockMaterial;
                
                // Add particle system for each rock
                const rockPS = new ParticleSystem(`lavaRockPS${i}`, 15, this.scene);
                rockPS.emitter = lavaRock;
                rockPS.minSize = 0.05;
                rockPS.maxSize = 0.15;
                rockPS.minLifeTime = 0.3;
                rockPS.maxLifeTime = 0.8;
                rockPS.emitRate = 15;
                rockPS.color1 = new Color4(1.0, 0.4, 0.1, 0.7);
                rockPS.color2 = new Color4(0.8, 0.2, 0.0, 0.5);
                rockPS.colorDead = new Color4(0.5, 0.0, 0.0, 0);
                rockPS.minEmitPower = 0.1;
                rockPS.maxEmitPower = 0.3;
                rockPS.updateSpeed = 0.01;
                rockPS.direction1 = new Vector3(-0.3, -0.1, -0.3);
                rockPS.direction2 = new Vector3(0.3, 0.5, 0.3);
                rockPS.start();
            }
            
            // Create animation for the lava ring rotation
            const frameRate = 30;
            const rotateAnimation = new Animation(
                "lavaRingRotation", 
                "rotation.y", 
                frameRate, 
                Animation.ANIMATIONTYPE_FLOAT, 
                Animation.ANIMATIONLOOPMODE_CYCLE
            );
            
            // Create animation keys - rotate 360 degrees over 240 frames (8 seconds)
            const keys = [];
            keys.push({ frame: 0, value: 0 });
            keys.push({ frame: 240, value: Math.PI * 2 });
            rotateAnimation.setKeys(keys);
            
            // Attach animation to lava ring and play it
            this.lavaRing.animations = [];
            this.lavaRing.animations.push(rotateAnimation);
            this.scene.beginAnimation(this.lavaRing, 0, 240, true);
            
            // Create lava effect
            this.createLavaEffect();
            
        } catch (error) {
            console.error("Error creating Lava Tower mesh:", error);
        }
    }
    
    /**
     * Create rock formations around the tower base
     */
    private createRockFormations(): void {
        // Add rock formations around the base
        for (let i = 0; i < 5; i++) {
            const angle = (i / 5) * Math.PI * 2;
            
            // Create a rock using polyhedron
            const rock = MeshBuilder.CreatePolyhedron(
                `baseRock${i}`,
                {
                    type: 1, // 1 = octahedron
                    size: 0.3 + Math.random() * 0.2
                },
                this.scene
            );
            
            // Position around base
            rock.parent = this.mesh;
            rock.position.x = Math.sin(angle) * 1.0;
            rock.position.z = Math.cos(angle) * 1.0;
            rock.position.y = 0.3;
            rock.rotation.y = Math.random() * Math.PI;
            
            // Create rock material
            const rockMaterial = new StandardMaterial(`rockMaterial${i}`, this.scene);
            rockMaterial.diffuseColor = new Color3(
                0.3 + Math.random() * 0.2,
                0.2 + Math.random() * 0.1,
                0.1
            );
            rockMaterial.specularColor = new Color3(0.1, 0.1, 0.1);
            rock.material = rockMaterial;
        }
    }
    
    /**
     * Create lava streams flowing down the sides of the tower
     */
    private createLavaStreams(): void {
        const streamCount = 3;
        for (let i = 0; i < streamCount; i++) {
            const angle = (i / streamCount) * Math.PI * 2;
            
            // Create a lava stream
            const stream = MeshBuilder.CreateBox(
                `lavaStream${i}`,
                {
                    width: 0.15,
                    height: 1.8,
                    depth: 0.1
                },
                this.scene
            );
            
            // Position stream to flow over the side
            stream.parent = this.mesh;
            stream.position.x = Math.sin(angle) * 0.7;
            stream.position.z = Math.cos(angle) * 0.7;
            stream.position.y = 2.5;
            stream.rotation.x = Math.PI / 12; // Slight angle for flowing appearance
            stream.rotation.y = angle;
            
            // Create lava material
            const streamMaterial = new StandardMaterial(`lavaStreamMaterial${i}`, this.scene);
            streamMaterial.diffuseColor = new Color3(1, 0.3, 0);
            streamMaterial.emissiveColor = new Color3(0.8, 0.2, 0);
            streamMaterial.alpha = 0.8;
            stream.material = streamMaterial;
            
            // Add small lava pool at bottom of stream
            const lavaPoolRadius = 0.3 + Math.random() * 0.2;
            const lavaPool = MeshBuilder.CreateDisc(
                `lavaPool${i}`,
                {
                    radius: lavaPoolRadius,
                    tessellation: 12
                },
                this.scene
            );
            
            // Position pool at bottom of stream
            lavaPool.parent = this.mesh;
            lavaPool.position.x = Math.sin(angle) * 0.9;
            lavaPool.position.z = Math.cos(angle) * 0.9;
            lavaPool.position.y = 0.15;
            lavaPool.rotation.x = Math.PI / 2; // Flat on ground
            
            // Use same material as stream
            lavaPool.material = streamMaterial.clone(`lavaPoolMaterial${i}`);
            
            // Store for later disposal
            this.lavaPools.push(lavaPool);
            
            // Add particle system for the pool
            const poolPS = new ParticleSystem(`lavaPoolPS${i}`, 10, this.scene);
            poolPS.emitter = lavaPool;
            poolPS.minSize = 0.1;
            poolPS.maxSize = 0.2;
            poolPS.minLifeTime = 0.5;
            poolPS.maxLifeTime = 1.0;
            poolPS.emitRate = 10;
            poolPS.color1 = new Color4(1.0, 0.4, 0.1, 0.7);
            poolPS.color2 = new Color4(0.8, 0.2, 0.0, 0.5);
            poolPS.colorDead = new Color4(0.5, 0.0, 0.0, 0);
            poolPS.minEmitPower = 0.1;
            poolPS.maxEmitPower = 0.3;
            poolPS.updateSpeed = 0.01;
            poolPS.direction1 = new Vector3(-0.1, 0.5, -0.1);
            poolPS.direction2 = new Vector3(0.1, 1.0, 0.1);
            poolPS.start();
        }
    }
    
    /**
     * Create a lava particle effect from the volcano
     */
    private createLavaEffect(): void {
        if (!this.mesh) return;
        
        try {
            // Create a particle system for the lava
            this.lavaParticles = new ParticleSystem('lavaParticles', 50, this.scene);
            
            // Set emission properties - from volcano top
            this.lavaParticles.emitter = new Vector3(
                this.position.x,
                this.position.y + 3.8, // Top of volcano
                this.position.z
            );
            
            // Set particle properties
            this.lavaParticles.minSize = 0.2;
            this.lavaParticles.maxSize = 0.5;
            this.lavaParticles.minLifeTime = 1.0;
            this.lavaParticles.maxLifeTime = 2.0;
            this.lavaParticles.emitRate = 20;
            
            // Define direct colors (avoid Color3 to Color4 conversion issues)
            this.lavaParticles.color1 = new Color4(1, 0.5, 0, 1.0);
            this.lavaParticles.color2 = new Color4(1, 0.2, 0, 1.0);
            this.lavaParticles.colorDead = new Color4(0.5, 0, 0, 0.0);
            
            // Direction and behavior - erupting upward and outward
            this.lavaParticles.direction1 = new Vector3(-0.3, 1, -0.3);
            this.lavaParticles.direction2 = new Vector3(0.3, 2, 0.3);
            this.lavaParticles.minEmitPower = 0.5;
            this.lavaParticles.maxEmitPower = 1.5;
            this.lavaParticles.updateSpeed = 0.01;
            this.lavaParticles.gravity = new Vector3(0, -2, 0); // Falling back down
            
            // Start the particle system
            this.lavaParticles.start();
        } catch (error) {
            console.error("Error creating lava effect:", error);
        }
    }
    
    /**
     * Fire at the current target
     */
    protected fire(): void {
        if (!this.targetEnemy) return;
        
        // Create a lava pool at the target position
        this.createLavaPool(this.targetEnemy.getPosition());
        
        // Get all enemies in range of the lava pool
        const enemiesInRange = this.getEnemiesInRange(this.targetEnemy.getPosition(), this.areaOfEffect);
        
        // Deal damage to all enemies in range
        for (const enemy of enemiesInRange) {
            // Skip flying enemies
            if (enemy.getEnemyType() === EnemyType.FLYING && !this.canTargetFlying) {
                continue;
            }
            
            // Calculate damage based on elemental strengths/weaknesses
            let finalDamage = this.calculateDamage(enemy);
            
            // Deal damage to the enemy
            enemy.takeDamage(finalDamage);
            
            // Apply primary effect (burning)
            this.applyStatusEffect(
                enemy,
                StatusEffect.BURNING,
                this.statusEffectDuration,
                this.statusEffectStrength
            );
            
            // Check for secondary effect (slowed)
            if (Math.random() < this.secondaryEffectChance) {
                this.applyStatusEffect(
                    enemy,
                    StatusEffect.SLOWED,
                    2.0, // 2 seconds of slowing
                    0.3 // 30% slow
                );
            }
        }
        
        // Play sound
        this.game.getAssetManager().playSound('towerShoot');
    }
    
    /**
     * Create a lava pool effect at the target position
     * @param position The position for the lava pool
     */
    private createLavaPool(position: Vector3): void {
        try {
            // Create disc for lava pool
            const lavaPoolMesh = MeshBuilder.CreateDisc(
                'targetLavaPool',
                {
                    radius: this.areaOfEffect / 2, // Half the effect radius for visuals
                    tessellation: 18
                },
                this.scene
            );
            
            // Position at target location, slightly above ground
            lavaPoolMesh.position = new Vector3(position.x, 0.05, position.z);
            lavaPoolMesh.rotation.x = Math.PI / 2; // Make it flat on the ground
            
            // Create lava material with glow
            const lavaMaterial = new StandardMaterial('targetLavaMaterial', this.scene);
            lavaMaterial.diffuseColor = new Color3(1, 0.3, 0);
            lavaMaterial.emissiveColor = new Color3(0.8, 0.2, 0);
            lavaMaterial.specularColor = new Color3(1, 0.6, 0.3);
            lavaMaterial.alpha = 0.7; // Slightly transparent
            lavaPoolMesh.material = lavaMaterial;
            
            // Create a particle system for the lava pool
            const poolParticles = new ParticleSystem('targetLavaPoolParticles', 50, this.scene);
            
            // Set emission properties
            poolParticles.emitter = lavaPoolMesh;
            poolParticles.minSize = 0.1;
            poolParticles.maxSize = 0.3;
            poolParticles.minLifeTime = 0.5;
            poolParticles.maxLifeTime = 1.5;
            poolParticles.emitRate = 20;
            
            // Direct color initialization
            poolParticles.color1 = new Color4(1, 0.5, 0, 0.7);
            poolParticles.color2 = new Color4(1, 0.2, 0, 0.7);
            poolParticles.colorDead = new Color4(0.5, 0, 0, 0);
            
            poolParticles.direction1 = new Vector3(-0.1, 0.5, -0.1);
            poolParticles.direction2 = new Vector3(0.1, 1, 0.1);
            poolParticles.minEmitPower = 0.1;
            poolParticles.maxEmitPower = 0.3;
            poolParticles.updateSpeed = 0.01;
            
            // Start the particle system
            poolParticles.start();
            
            // Create animation to fade out the pool
            const frameRate = 24;
            const fadeAnimation = new Animation(
                "lavaPoolFade",
                "material.alpha",
                frameRate,
                Animation.ANIMATIONTYPE_FLOAT,
                Animation.ANIMATIONLOOPMODE_CONSTANT
            );
            
            // Create animation keys
            const keys = [];
            keys.push({ frame: 0, value: 0.7 });  // Start at 70% opacity
            keys.push({ frame: 50, value: 0.7 });  // Hold for ~2 seconds
            keys.push({ frame: 70, value: 0 });    // Fade out over ~1 second
            fadeAnimation.setKeys(keys);
            
            // Add animation to mesh
            lavaPoolMesh.animations = [];
            lavaPoolMesh.animations.push(fadeAnimation);
            
            // Play animation and dispose after completed
            const animationRef = this.scene.beginAnimation(lavaPoolMesh, 0, 70, false);
            animationRef.onAnimationEnd = () => {
                poolParticles.stop();
                setTimeout(() => {
                    poolParticles.dispose();
                    if (lavaPoolMesh.material) {
                        lavaPoolMesh.material.dispose();
                    }
                    lavaPoolMesh.dispose();
                }, 1500); // Dispose after particles die out
            };
            
        } catch (error) {
            console.error("Error creating target lava pool:", error);
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
     * Calculate damage based on enemy type
     * @param enemy The enemy to calculate damage for
     * @returns The calculated damage
     */
    protected calculateDamage(enemy: Enemy): number {
        let damage = this.damage;
        
        // Bonus damage to earth-based enemies
        if (enemy.getEnemyType() === EnemyType.EARTH) {
            damage *= 1.5;
        }
        // Reduced damage to water-based enemies
        else if (enemy.getEnemyType() === EnemyType.WATER) {
            damage *= 0.5;
        }
        
        return damage;
    }
    
    /**
     * Create a medieval-style base for the tower
     */
    private createMedievalBase(): Mesh {
        // Create a cylinder for the base
        const base = MeshBuilder.CreateCylinder(
            'lavaTowerBase',
            {
                height: 1.2,
                diameterTop: 1.8,
                diameterBottom: 2.2,
                tessellation: 10 // Less smooth for rocky appearance
            },
            this.scene
        );
        
        // Create material for the base
        const baseMaterial = new StandardMaterial('baseMaterial', this.scene);
        baseMaterial.diffuseColor = new Color3(0.3, 0.2, 0.1); // Dark stone color
        baseMaterial.specularColor = new Color3(0.1, 0.1, 0.1);
        base.material = baseMaterial;
        
        return base;
    }
    
    /**
     * Dispose of the tower and its resources
     */
    public dispose(): void {
        // Dispose of the lava particles
        if (this.lavaParticles) {
            this.lavaParticles.stop();
            this.lavaParticles.dispose();
            this.lavaParticles = null;
        }
        
        // Stop animations
        if (this.lavaRing) {
            this.scene.stopAnimation(this.lavaRing);
        }
        
        // Clean up lava pools
        this.lavaPools.forEach(pool => {
            if (pool.material) {
                pool.material.dispose();
            }
            pool.dispose();
        });
        this.lavaPools = [];
        
        // Find and dispose any remaining particle systems
        if (this.mesh) {
            this.scene.particleSystems.forEach(ps => {
                if (ps.name.startsWith('lavaPoolPS') || 
                    ps.name.startsWith('lavaRockPS')) {
                    ps.dispose();
                }
            });
        }
        
        // Call base class dispose
        super.dispose();
    }
} 