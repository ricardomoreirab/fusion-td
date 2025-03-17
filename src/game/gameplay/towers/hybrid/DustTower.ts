import { Vector3, MeshBuilder, StandardMaterial, Color3, ParticleSystem, Texture, Color4, Mesh, Animation } from '@babylonjs/core';
import { Game } from '../../../Game';
import { Tower, ElementType, StatusEffect, EnemyType } from '../Tower';
import { Enemy } from '../../enemies/Enemy';

/**
 * Dust Tower - Combines Earth and Wind elements
 * - Creates dust clouds that confuse and damage enemies
 * - Has a chance to stun enemies
 * - Strong against: Fire, Electric
 * - Weak against: Water, Flying
 */
export class DustTower extends Tower {
    /**
     * The radius of the dust cloud effect
     */
    private areaOfEffect: number = 3.5;
    
    /**
     * The current dust particle system
     */
    private dustParticles: ParticleSystem | null = null;
    
    /**
     * Tower-specific meshes
     */
    private dustFunnel: Mesh | null = null;
    private dustVortex: Mesh | null = null;
    private dustRing: Mesh | null = null;
    private rockFormations: Mesh[] = [];
    
    /**
     * Constructor for the DustTower
     * @param game The game instance
     * @param position The position of the tower
     */
    constructor(game: Game, position: Vector3) {
        // Base stats for dust tower
        const damage = 7;
        const range = 6;
        const fireRate = 1.2;
        const cost = 225;
        
        super(game, position, range, damage, fireRate, cost);
        
        // Set dust-specific properties
        this.secondaryEffectChance = 0.3; // 30% chance for secondary effect
        this.statusEffectDuration = 2.5; // 2.5 seconds of effect
        this.statusEffectStrength = 0.8; // 80% confusion strength
        
        // Set targeting priorities
        this.targetPriorities = [
            EnemyType.FIRE,
            EnemyType.ELECTRIC
        ];
        
        // Set weaknesses
        this.weakAgainst = [
            EnemyType.WATER,
            EnemyType.FLYING
        ];
        
        // Create the tower mesh
        this.createMesh();
    }
    
    /**
     * Create the tower mesh
     */
    protected createMesh(): void {
        try {
            // Create root mesh for the dust tower
            this.mesh = new Mesh("dustTowerRoot", this.scene);
            this.mesh.position = this.position.clone();
            
            // Create medieval base
            const base = this.createMedievalBase();
            base.parent = this.mesh;
            base.position.y = 0.6; // Position relative to root
            
            // Create middle section - sandy/rocky column
            const middle = MeshBuilder.CreateCylinder(
                'dustTowerMiddle',
                {
                    height: 2.2,
                    diameterTop: 1.1,
                    diameterBottom: 1.5,
                    tessellation: 10
                },
                this.scene
            );
            middle.parent = this.mesh;
            middle.position.y = 1.9; // Position relative to root
            
            // Create middle material - sandy texture
            const middleMaterial = new StandardMaterial('dustTowerMiddleMaterial', this.scene);
            middleMaterial.diffuseColor = new Color3(0.75, 0.65, 0.5); // Sandy color
            middleMaterial.specularColor = new Color3(0.2, 0.2, 0.2); // Low specularity for sand
            middle.material = middleMaterial;
            
            // Create a funnel/vortex at the top
            this.dustFunnel = MeshBuilder.CreateCylinder(
                'dustFunnel',
                {
                    height: 1.5,
                    diameterTop: 1.8, // Wider at top
                    diameterBottom: 0.9,
                    tessellation: 10
                },
                this.scene
            );
            this.dustFunnel.parent = this.mesh;
            this.dustFunnel.position.y = 3.4; // Position at top of tower
            
            // Create funnel material - swirling sand appearance
            const funnelMaterial = new StandardMaterial('funnelMaterial', this.scene);
            funnelMaterial.diffuseColor = new Color3(0.8, 0.7, 0.55);
            funnelMaterial.specularColor = new Color3(0.3, 0.3, 0.3);
            funnelMaterial.emissiveColor = new Color3(0.1, 0.1, 0.05); // Subtle glow
            this.dustFunnel.material = funnelMaterial;
            
            // Create a swirling dust vortex in the center of the funnel
            this.dustVortex = MeshBuilder.CreateCylinder(
                'dustVortex',
                {
                    height: 1.0,
                    diameterTop: 0.8,
                    diameterBottom: 0.4,
                    tessellation: 8
                },
                this.scene
            );
            this.dustVortex.parent = this.mesh;
            this.dustVortex.position.y = 3.4; // Position inside the funnel
            
            // Create vortex material - semi-transparent dust
            const vortexMaterial = new StandardMaterial('vortexMaterial', this.scene);
            vortexMaterial.diffuseColor = new Color3(0.7, 0.6, 0.5);
            vortexMaterial.alpha = 0.6; // Semi-transparent
            vortexMaterial.specularColor = new Color3(0.2, 0.2, 0.2);
            this.dustVortex.material = vortexMaterial;
            
            // Create animation for the vortex rotation (fast spin)
            const frameRate = 30;
            const rotateAnimation = new Animation(
                "vortexRotation", 
                "rotation.y", 
                frameRate, 
                Animation.ANIMATIONTYPE_FLOAT, 
                Animation.ANIMATIONLOOPMODE_CYCLE
            );
            
            // Create animation keys - rotate 360 degrees over 60 frames (2 seconds)
            const keys = [];
            keys.push({ frame: 0, value: 0 });
            keys.push({ frame: 60, value: Math.PI * 2 });
            rotateAnimation.setKeys(keys);
            
            // Attach animation to vortex and play it
            this.dustVortex.animations = [];
            this.dustVortex.animations.push(rotateAnimation);
            this.scene.beginAnimation(this.dustVortex, 0, 60, true);
            
            // Create rock formations around the base
            this.createRockFormations();
            
            // Create a rotating dust ring that will hold orbiting dust clouds
            this.dustRing = new Mesh("dustRingParent", this.scene);
            this.dustRing.parent = this.mesh;
            this.dustRing.position.y = 2.8; // Position above middle of tower
            
            // Create circulating dust clouds
            const cloudCount = 4;
            const orbitRadius = 1.4;
            
            for (let i = 0; i < cloudCount; i++) {
                const angle = (i / cloudCount) * Math.PI * 2;
                
                // Create a flattened sphere as a dust cloud
                const dustCloud = MeshBuilder.CreateSphere(
                    `dustCloud${i}`,
                    {
                        diameter: 0.5 + Math.random() * 0.2,
                        segments: 8
                    },
                    this.scene
                );
                
                // Flatten the cloud
                dustCloud.scaling.y = 0.5;
                
                // Position cloud in a circular pattern
                dustCloud.parent = this.dustRing;
                dustCloud.position.x = Math.sin(angle) * orbitRadius;
                dustCloud.position.z = Math.cos(angle) * orbitRadius;
                
                // Add some height variance
                dustCloud.position.y = (i % 2 === 0) ? 0.2 : -0.2;
                
                // Create translucent dust material
                const cloudMaterial = new StandardMaterial(`dustCloudMaterial${i}`, this.scene);
                cloudMaterial.diffuseColor = new Color3(0.7, 0.65, 0.5); // Sand color
                cloudMaterial.alpha = 0.7; // Translucent
                dustCloud.material = cloudMaterial;
                
                // Add particle system for each cloud
                const cloudPS = new ParticleSystem(`dustCloudPS${i}`, 15, this.scene);
                cloudPS.emitter = dustCloud;
                cloudPS.minSize = 0.1;
                cloudPS.maxSize = 0.25;
                cloudPS.minLifeTime = 0.4;
                cloudPS.maxLifeTime = 0.8;
                cloudPS.emitRate = 12;
                cloudPS.color1 = new Color4(0.7, 0.65, 0.5, 0.7);
                cloudPS.color2 = new Color4(0.6, 0.55, 0.4, 0.5);
                cloudPS.colorDead = new Color4(0.5, 0.45, 0.35, 0);
                cloudPS.minEmitPower = 0.1;
                cloudPS.maxEmitPower = 0.3;
                cloudPS.updateSpeed = 0.01;
                cloudPS.direction1 = new Vector3(-0.2, -0.1, -0.2);
                cloudPS.direction2 = new Vector3(0.2, 0.3, 0.2);
                cloudPS.start();
            }
            
            // Create animation for the dust ring rotation (counter to vortex)
            const ringRotateAnimation = new Animation(
                "dustRingRotation", 
                "rotation.y", 
                frameRate, 
                Animation.ANIMATIONTYPE_FLOAT, 
                Animation.ANIMATIONLOOPMODE_CYCLE
            );
            
            // Create animation keys - rotate 360 degrees over 120 frames (4 seconds)
            // Opposite direction to vortex
            const ringKeys = [];
            ringKeys.push({ frame: 0, value: 0 });
            ringKeys.push({ frame: 120, value: -Math.PI * 2 });
            ringRotateAnimation.setKeys(ringKeys);
            
            // Attach animation to dust ring and play it
            this.dustRing.animations = [];
            this.dustRing.animations.push(ringRotateAnimation);
            this.scene.beginAnimation(this.dustRing, 0, 120, true);
            
            // Create main dust effect from funnel top
            this.createDustEffect();
            
        } catch (error) {
            console.error("Error creating Dust Tower mesh:", error);
        }
    }
    
    /**
     * Create rock formations around the tower base
     */
    private createRockFormations(): void {
        // Add rock formations around the base
        for (let i = 0; i < 6; i++) {
            const angle = (i / 6) * Math.PI * 2;
            
            // Create a rock using polyhedron
            const rock = MeshBuilder.CreatePolyhedron(
                `baseRock${i}`,
                {
                    type: i % 3, // Different rock shapes
                    size: 0.25 + Math.random() * 0.15
                },
                this.scene
            );
            
            // Position around base
            rock.parent = this.mesh;
            rock.position.x = Math.sin(angle) * 1.0;
            rock.position.z = Math.cos(angle) * 1.0;
            rock.position.y = 0.3;
            rock.rotation.y = Math.random() * Math.PI;
            
            // Random scaling
            rock.scaling.x = 0.8 + Math.random() * 0.4;
            rock.scaling.y = 0.8 + Math.random() * 0.4;
            rock.scaling.z = 0.8 + Math.random() * 0.4;
            
            // Create rock material
            const rockMaterial = new StandardMaterial(`rockMaterial${i}`, this.scene);
            rockMaterial.diffuseColor = new Color3(
                0.6 + Math.random() * 0.2,
                0.5 + Math.random() * 0.15,
                0.4 + Math.random() * 0.1
            );
            rockMaterial.specularColor = new Color3(0.2, 0.2, 0.2);
            rock.material = rockMaterial;
            
            // Store for later disposal
            this.rockFormations.push(rock);
            
            // Add small dust particle effect for some of the rocks
            if (i % 2 === 0) {
                const rockDustPS = new ParticleSystem(`rockDustPS${i}`, 5, this.scene);
                rockDustPS.emitter = rock;
                rockDustPS.minSize = 0.05;
                rockDustPS.maxSize = 0.1;
                rockDustPS.minLifeTime = 0.5;
                rockDustPS.maxLifeTime = 1.0;
                rockDustPS.emitRate = 3;
                rockDustPS.color1 = new Color4(0.7, 0.65, 0.5, 0.5);
                rockDustPS.color2 = new Color4(0.6, 0.55, 0.4, 0.3);
                rockDustPS.colorDead = new Color4(0.5, 0.45, 0.35, 0);
                rockDustPS.direction1 = new Vector3(-0.1, 0.1, -0.1);
                rockDustPS.direction2 = new Vector3(0.1, 0.3, 0.1);
                rockDustPS.minEmitPower = 0.05;
                rockDustPS.maxEmitPower = 0.1;
                rockDustPS.updateSpeed = 0.01;
                rockDustPS.start();
            }
        }
    }
    
    /**
     * Create a medieval-style base for the tower
     */
    private createMedievalBase(): Mesh {
        // Create a cylinder for the base
        const base = MeshBuilder.CreateCylinder(
            'dustTowerBase',
            {
                height: 1.2,
                diameterTop: 1.6,
                diameterBottom: 2.0,
                tessellation: 10
            },
            this.scene
        );
        
        // Create material for the base
        const baseMaterial = new StandardMaterial('baseMaterial', this.scene);
        baseMaterial.diffuseColor = new Color3(0.6, 0.55, 0.45); // Sandy stone color
        baseMaterial.specularColor = new Color3(0.2, 0.2, 0.2);
        base.material = baseMaterial;
        
        return base;
    }
    
    /**
     * Create a dust particle effect from the top of the tower
     */
    private createDustEffect(): void {
        if (!this.mesh) return;
        
        try {
            // Create a particle system for the dust
            this.dustParticles = new ParticleSystem('dustParticles', 60, this.scene);
            
            // Set emission properties - from funnel top
            this.dustParticles.emitter = new Vector3(
                this.position.x,
                this.position.y + 4.2, // Top of funnel
                this.position.z
            );
            
            // Set particle properties
            this.dustParticles.minSize = 0.15;
            this.dustParticles.maxSize = 0.4;
            this.dustParticles.minLifeTime = 1.0;
            this.dustParticles.maxLifeTime = 2.0;
            this.dustParticles.emitRate = 30;
            
            // Direct color initialization (avoid Color3 to Color4 conversion issues)
            this.dustParticles.color1 = new Color4(0.7, 0.65, 0.5, 0.7);
            this.dustParticles.color2 = new Color4(0.6, 0.55, 0.4, 0.6);
            this.dustParticles.colorDead = new Color4(0.5, 0.45, 0.35, 0);
            
            // Direction and behavior - swirling outward
            this.dustParticles.direction1 = new Vector3(-0.5, 0.2, -0.5);
            this.dustParticles.direction2 = new Vector3(0.5, 0.5, 0.5);
            this.dustParticles.minEmitPower = 0.5;
            this.dustParticles.maxEmitPower = 1.0;
            this.dustParticles.updateSpeed = 0.01;
            
            // Add slight gravity
            this.dustParticles.gravity = new Vector3(0, -0.1, 0);
            
            // Start the particle system
            this.dustParticles.start();
        } catch (error) {
            console.error("Error creating dust effect:", error);
        }
    }
    
    /**
     * Fire at the current target
     */
    protected fire(): void {
        if (!this.targetEnemy) return;
        
        // Create a dust cloud at the target position
        this.createDustCloud(this.targetEnemy.getPosition());
        
        // Get all enemies in range of the dust cloud
        const enemiesInRange = this.getEnemiesInRange(this.targetEnemy.getPosition(), this.areaOfEffect);
        
        // Deal damage to all enemies in range
        for (const enemy of enemiesInRange) {
            // Calculate damage based on elemental strengths/weaknesses
            let finalDamage = this.calculateDamage(enemy);
            
            // Deal damage to the enemy
            enemy.takeDamage(finalDamage);
            
            // Apply primary effect (confusion)
            this.applyStatusEffect(
                enemy,
                StatusEffect.CONFUSED,
                this.statusEffectDuration,
                this.statusEffectStrength
            );
            
            // Check for secondary effect (stun)
            if (Math.random() < this.secondaryEffectChance) {
                this.applyStatusEffect(
                    enemy,
                    StatusEffect.STUNNED,
                    0.5, // 0.5 seconds of stunning
                    1.0 // 100% stun (complete stop)
                );
            }
        }
        
        // Play sound
        this.game.getAssetManager().playSound('towerShoot');
    }
    
    /**
     * Create a dust cloud effect at the target position
     * @param position The position for the dust cloud
     */
    private createDustCloud(position: Vector3): void {
        try {
            // Create a mesh for the dust cloud
            const cloudMesh = MeshBuilder.CreateSphere(
                'targetDustCloud',
                {
                    diameter: 1.0,
                    segments: 8
                },
                this.scene
            );
            
            // Position at target location, slightly above ground
            cloudMesh.position = new Vector3(position.x, 0.5, position.z);
            cloudMesh.scaling = new Vector3(1, 0.6, 1); // Flatten slightly
            
            // Create dust cloud material - translucent dust
            const cloudMaterial = new StandardMaterial('targetCloudMaterial', this.scene);
            cloudMaterial.diffuseColor = new Color3(0.7, 0.65, 0.5);
            cloudMaterial.alpha = 0.6; // Translucent
            cloudMaterial.specularColor = new Color3(0.2, 0.2, 0.2);
            cloudMesh.material = cloudMaterial;
            
            // Create a particle system for the dust cloud
            const dustCloudPS = new ParticleSystem('targetDustPS', 100, this.scene);
            dustCloudPS.emitter = cloudMesh;
            dustCloudPS.minSize = 0.2;
            dustCloudPS.maxSize = 0.5;
            dustCloudPS.minLifeTime = 0.8;
            dustCloudPS.maxLifeTime = 1.5;
            dustCloudPS.emitRate = 50;
            dustCloudPS.color1 = new Color4(0.7, 0.65, 0.5, 0.7);
            dustCloudPS.color2 = new Color4(0.6, 0.55, 0.4, 0.6);
            dustCloudPS.colorDead = new Color4(0.5, 0.45, 0.35, 0);
            dustCloudPS.minEmitPower = 0.2;
            dustCloudPS.maxEmitPower = 0.5;
            dustCloudPS.updateSpeed = 0.01;
            dustCloudPS.direction1 = new Vector3(-0.5, 0.1, -0.5);
            dustCloudPS.direction2 = new Vector3(0.5, 0.3, 0.5);
            dustCloudPS.start();
            
            // Create expanding and fading animation for dust cloud
            const frameRate = 24;
            const expandAnimation = new Animation(
                "cloudExpand",
                "scaling",
                frameRate,
                Animation.ANIMATIONTYPE_VECTOR3,
                Animation.ANIMATIONLOOPMODE_CONSTANT
            );
            
            const fadeAnimation = new Animation(
                "cloudFade",
                "material.alpha",
                frameRate,
                Animation.ANIMATIONTYPE_FLOAT,
                Animation.ANIMATIONLOOPMODE_CONSTANT
            );
            
            // Animation keys for expanding
            const scaleKeys = [];
            scaleKeys.push({ frame: 0, value: new Vector3(1, 0.6, 1) });
            scaleKeys.push({ frame: frameRate * 2, value: new Vector3(this.areaOfEffect, this.areaOfEffect * 0.4, this.areaOfEffect) });
            expandAnimation.setKeys(scaleKeys);
            
            // Animation keys for fading
            const fadeKeys = [];
            fadeKeys.push({ frame: 0, value: 0.6 });
            fadeKeys.push({ frame: frameRate * 0.5, value: 0.6 }); // Hold for half a second
            fadeKeys.push({ frame: frameRate * 2, value: 0 });
            fadeAnimation.setKeys(fadeKeys);
            
            // Add animations to cloud
            cloudMesh.animations = [];
            cloudMesh.animations.push(expandAnimation);
            cloudMesh.animations.push(fadeAnimation);
            
            // Play animations and handle cleanup
            const animationRef = this.scene.beginAnimation(cloudMesh, 0, frameRate * 2, false);
            animationRef.onAnimationEnd = () => {
                dustCloudPS.stop();
                setTimeout(() => {
                    dustCloudPS.dispose();
                    if (cloudMesh.material) {
                        cloudMesh.material.dispose();
                    }
                    cloudMesh.dispose();
                }, 1500); // Wait for particles to die out
            };
        } catch (error) {
            console.error("Error creating target dust cloud:", error);
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
        // Dispose of the dust particles
        if (this.dustParticles) {
            this.dustParticles.stop();
            this.dustParticles.dispose();
            this.dustParticles = null;
        }
        
        // Stop animations
        if (this.dustVortex) {
            this.scene.stopAnimation(this.dustVortex);
        }
        
        if (this.dustRing) {
            this.scene.stopAnimation(this.dustRing);
        }
        
        // Clean up rock formations
        this.rockFormations.forEach(rock => {
            if (rock.material) {
                rock.material.dispose();
            }
            rock.dispose();
        });
        this.rockFormations = [];
        
        // Find and dispose any remaining particle systems
        if (this.mesh) {
            this.scene.particleSystems.forEach(ps => {
                if (ps.name.startsWith('rockDustPS') || 
                    ps.name.startsWith('dustCloudPS')) {
                    ps.dispose();
                }
            });
        }
        
        // Call base class dispose
        super.dispose();
    }
} 