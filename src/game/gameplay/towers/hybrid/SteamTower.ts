import { Vector3, MeshBuilder, StandardMaterial, Color3, ParticleSystem, Texture, Color4, Mesh, Animation } from '@babylonjs/core';
import { Game } from '../../../Game';
import { Tower, ElementType, StatusEffect, EnemyType } from '../Tower';
import { Enemy } from '../../enemies/Enemy';

/**
 * Steam Tower - Combines Fire and Water elements
 * - Creates steam clouds that damage and slow enemies
 * - Can hit multiple enemies in an area
 * - Strong against: Fire, Earth
 * - Weak against: Wind
 */
export class SteamTower extends Tower {
    /**
     * The radius of the steam cloud effect
     */
    private areaOfEffect: number = 3;
    
    /**
     * The current steam cloud particle system
     */
    private steamParticles: ParticleSystem | null = null;
    
    /**
     * Tower-specific meshes
     */
    private cauldron: Mesh | null = null;
    private steamVents: Mesh[] = [];
    private steamRing: Mesh | null = null;
    
    /**
     * Constructor for the SteamTower
     * @param game The game instance
     * @param position The position of the tower
     */
    constructor(game: Game, position: Vector3) {
        // Base stats for steam tower
        const damage = 8;
        const range = 6;
        const fireRate = 1.0;
        const cost = 200;
        
        super(game, position, range, damage, fireRate, cost);
        
        // Set steam-specific properties
        this.secondaryEffectChance = 0.5; // 50% chance for secondary effect
        this.statusEffectDuration = 3; // 3 seconds of effect
        this.statusEffectStrength = 0.3; // 30% slow
        
        // Set targeting priorities
        this.targetPriorities = [
            EnemyType.FIRE,
            EnemyType.EARTH
        ];
        
        // Set weaknesses
        this.weakAgainst = [
            EnemyType.WIND
        ];
        
        // Create the tower mesh
        this.createMesh();
    }
    
    /**
     * Create the tower mesh
     */
    protected createMesh(): void {
        try {
            // Create root mesh for the steam tower
            this.mesh = new Mesh("steamTowerRoot", this.scene);
            this.mesh.position = this.position.clone();
            
            // Create medieval base
            const base = this.createMedievalBase();
            base.parent = this.mesh;
            base.position.y = 0.6; // Position relative to root
            
            // Create middle section - cylindrical tower with stone texture
            const middle = MeshBuilder.CreateCylinder(
                'steamTowerMiddle',
                {
                    height: 2.0,
                    diameterTop: 1.3,
                    diameterBottom: 1.7,
                    tessellation: 16
                },
                this.scene
            );
            middle.parent = this.mesh;
            middle.position.y = 1.9; // Position relative to root
            
            // Create middle material - stone with blue-gray tint
            const middleMaterial = new StandardMaterial('steamTowerMiddleMaterial', this.scene);
            middleMaterial.diffuseColor = new Color3(0.5, 0.55, 0.6); // Bluish-gray stone
            middleMaterial.specularColor = new Color3(0.2, 0.25, 0.3);
            middle.material = middleMaterial;
            
            // Create large cauldron/basin at the top
            this.cauldron = MeshBuilder.CreateCylinder(
                'steamCauldron',
                {
                    height: 0.8,
                    diameterTop: 1.6,
                    diameterBottom: 1.4,
                    tessellation: 16
                },
                this.scene
            );
            this.cauldron.parent = this.mesh;
            this.cauldron.position.y = 3.3; // Position at top of tower
            
            // Create cauldron material - copper-like metal
            const cauldronMaterial = new StandardMaterial('cauldronMaterial', this.scene);
            cauldronMaterial.diffuseColor = new Color3(0.6, 0.4, 0.2); // Copper color
            cauldronMaterial.specularColor = new Color3(0.8, 0.6, 0.3);
            cauldronMaterial.specularPower = 64; // Shiny metal
            this.cauldron.material = cauldronMaterial;
            
            // Create water surface inside cauldron - flat disc
            const waterSurface = MeshBuilder.CreateDisc(
                'waterSurface',
                {
                    radius: 0.7,
                    tessellation: 24
                },
                this.scene
            );
            waterSurface.parent = this.mesh;
            waterSurface.position.y = 3.4; // Slightly above cauldron bottom
            
            // Create water material - blue and partially transparent
            const waterMaterial = new StandardMaterial('waterMaterial', this.scene);
            waterMaterial.diffuseColor = new Color3(0.2, 0.4, 0.8);  // Water blue
            waterMaterial.specularColor = new Color3(0.3, 0.6, 1.0);
            waterMaterial.emissiveColor = new Color3(0.1, 0.2, 0.4); // Slight glow
            waterMaterial.alpha = 0.7; // Partially transparent
            waterSurface.material = waterMaterial;
            
            // Create steam vents around the cauldron rim
            const ventCount = 4;
            for (let i = 0; i < ventCount; i++) {
                const angle = (i / ventCount) * Math.PI * 2;
                
                // Create a vent pipe
                const vent = MeshBuilder.CreateCylinder(
                    `steamVent${i}`,
                    {
                        height: 0.4,
                        diameter: 0.2,
                        tessellation: 8
                    },
                    this.scene
                );
                
                // Position vent around cauldron rim
                vent.parent = this.mesh;
                vent.position.x = Math.sin(angle) * 0.7;
                vent.position.z = Math.cos(angle) * 0.7;
                vent.position.y = 3.5; // At cauldron top
                
                // Create vent material - dark metal
                const ventMaterial = new StandardMaterial(`ventMaterial${i}`, this.scene);
                ventMaterial.diffuseColor = new Color3(0.3, 0.3, 0.3); // Dark metal
                ventMaterial.specularColor = new Color3(0.5, 0.5, 0.5);
                vent.material = ventMaterial;
                
                // Store for later use
                this.steamVents.push(vent);
            }
            
            // Create a rotating steam ring that will hold orbiting steam elements
            this.steamRing = new Mesh("steamRingParent", this.scene);
            this.steamRing.parent = this.mesh;
            this.steamRing.position.y = 2.8; // Position above middle of tower
            
            // Create circulating steam clouds
            const cloudCount = 5;
            const orbitRadius = 1.2;
            
            for (let i = 0; i < cloudCount; i++) {
                const angle = (i / cloudCount) * Math.PI * 2;
                
                // Create a flattened sphere as a steam cloud
                const steamCloud = MeshBuilder.CreateSphere(
                    `steamCloud${i}`,
                    {
                        diameter: 0.5 + Math.random() * 0.2,
                        segments: 8
                    },
                    this.scene
                );
                
                // Flatten the cloud
                steamCloud.scaling.y = 0.5;
                
                // Position cloud in a circular pattern
                steamCloud.parent = this.steamRing;
                steamCloud.position.x = Math.sin(angle) * orbitRadius;
                steamCloud.position.z = Math.cos(angle) * orbitRadius;
                
                // Add some height variance
                steamCloud.position.y = (i % 2 === 0) ? 0.2 : -0.2;
                
                // Create translucent steam material
                const cloudMaterial = new StandardMaterial(`steamCloudMaterial${i}`, this.scene);
                cloudMaterial.diffuseColor = new Color3(0.8, 0.8, 0.9); // Light gray-blue
                cloudMaterial.alpha = 0.6; // Translucent
                steamCloud.material = cloudMaterial;
                
                // Add particle system for each cloud
                const cloudPS = new ParticleSystem(`steamCloudPS${i}`, 20, this.scene);
                cloudPS.emitter = steamCloud;
                cloudPS.minSize = 0.1;
                cloudPS.maxSize = 0.3;
                cloudPS.minLifeTime = 0.5;
                cloudPS.maxLifeTime = 1.0;
                cloudPS.emitRate = 10;
                cloudPS.color1 = new Color4(0.8, 0.8, 0.9, 0.7);
                cloudPS.color2 = new Color4(0.6, 0.7, 0.9, 0.5);
                cloudPS.colorDead = new Color4(0.5, 0.6, 0.8, 0);
                cloudPS.minEmitPower = 0.1;
                cloudPS.maxEmitPower = 0.3;
                cloudPS.updateSpeed = 0.01;
                cloudPS.start();
            }
            
            // Create animation for the steam ring rotation
            const frameRate = 30;
            const rotateAnimation = new Animation(
                "steamRingRotation", 
                "rotation.y", 
                frameRate, 
                Animation.ANIMATIONTYPE_FLOAT, 
                Animation.ANIMATIONLOOPMODE_CYCLE
            );
            
            // Create animation keys - rotate 360 degrees over 210 frames (7 seconds)
            const keys = [];
            keys.push({ frame: 0, value: 0 });
            keys.push({ frame: 210, value: Math.PI * 2 });
            rotateAnimation.setKeys(keys);
            
            // Attach animation to steam ring and play it
            this.steamRing.animations = [];
            this.steamRing.animations.push(rotateAnimation);
            this.scene.beginAnimation(this.steamRing, 0, 210, true);
            
            // Create main steam effect from cauldron
            this.createSteamEffect();
            
        } catch (error) {
            console.error("Error creating Steam Tower mesh:", error);
        }
    }
    
    /**
     * Create a steam particle effect around the tower
     */
    private createSteamEffect(): void {
        if (!this.mesh) return;
        
        try {
            // Create a particle system for the main steam from cauldron
            this.steamParticles = new ParticleSystem('steamParticles', 100, this.scene);
            
            // Set emission properties - from cauldron top
            this.steamParticles.emitter = new Vector3(
                this.position.x,
                this.position.y + 3.4, // Top of cauldron
                this.position.z
            );
            
            // Set particle properties
            this.steamParticles.minSize = 0.3;
            this.steamParticles.maxSize = 0.8;
            this.steamParticles.minLifeTime = 1.5;
            this.steamParticles.maxLifeTime = 3.0;
            this.steamParticles.emitRate = 40;
            
            // Direct color initialization to avoid Color3 to Color4 issues
            this.steamParticles.color1 = new Color4(0.8, 0.8, 0.9, 0.7); // Light blue-gray
            this.steamParticles.color2 = new Color4(0.7, 0.8, 1.0, 0.6); // Light blue
            this.steamParticles.colorDead = new Color4(0.6, 0.7, 0.8, 0);
            
            // Direction and behavior
            this.steamParticles.direction1 = new Vector3(-0.5, 2, -0.5);
            this.steamParticles.direction2 = new Vector3(0.5, 3, 0.5);
            this.steamParticles.minEmitPower = 0.5;
            this.steamParticles.maxEmitPower = 1.5;
            this.steamParticles.updateSpeed = 0.01;
            
            // Start the steam effect
            this.steamParticles.start();
            
            // Create smaller steam effects from each vent
            this.steamVents.forEach((vent, index) => {
                const ventPS = new ParticleSystem(`ventSteam${index}`, 30, this.scene);
                ventPS.emitter = vent;
                ventPS.minSize = 0.1;
                ventPS.maxSize = 0.3;
                ventPS.minLifeTime = 0.5;
                ventPS.maxLifeTime = 1.5;
                ventPS.emitRate = 15;
                ventPS.color1 = new Color4(0.8, 0.8, 0.9, 0.6);
                ventPS.color2 = new Color4(0.7, 0.8, 1.0, 0.5);
                ventPS.colorDead = new Color4(0.6, 0.7, 0.8, 0);
                ventPS.direction1 = new Vector3(-0.2, 1, -0.2);
                ventPS.direction2 = new Vector3(0.2, 1.5, 0.2);
                ventPS.minEmitPower = 0.3;
                ventPS.maxEmitPower = 0.8;
                ventPS.updateSpeed = 0.01;
                ventPS.start();
                
                // Store reference for disposal
                this.scene.onBeforeRenderObservable.add(() => {
                    if (!this.mesh) {
                        ventPS.dispose();
                    }
                });
            });
        } catch (error) {
            console.error("Error creating Steam Tower effect:", error);
        }
    }
    
    /**
     * Fire at the current target
     */
    protected fire(): void {
        if (!this.targetEnemy) return;
        
        // Create a steam cloud at the target position
        this.createSteamCloud(this.targetEnemy.getPosition());
        
        // Get all enemies in range of the steam cloud
        const enemiesInRange = this.getEnemiesInRange(this.targetEnemy.getPosition(), this.areaOfEffect);
        
        // Deal damage to all enemies in range
        for (const enemy of enemiesInRange) {
            // Calculate damage based on elemental strengths/weaknesses
            let finalDamage = this.calculateDamage(enemy);
            
            // Deal damage to the enemy
            enemy.takeDamage(finalDamage);
            
            // Apply primary effect (slow)
            this.applyStatusEffect(
                enemy,
                StatusEffect.SLOWED,
                this.statusEffectDuration,
                this.statusEffectStrength
            );
            
            // Check for secondary effect (burning)
            if (Math.random() < this.secondaryEffectChance) {
                this.applyStatusEffect(
                    enemy,
                    StatusEffect.BURNING,
                    1.5, // 1.5 seconds of burning
                    0.15 // 15% of damage per second
                );
            }
        }
        
        // Play sound
        this.game.getAssetManager().playSound('towerShoot');
    }
    
    /**
     * Create a steam cloud effect at the target position
     * @param position The position for the steam cloud
     */
    private createSteamCloud(position: Vector3): void {
        try {
            // Create a particle system for the steam cloud
            const steamCloud = new ParticleSystem('steamCloud', 100, this.scene);
            
            // Set emission properties
            steamCloud.emitter = position.clone();
            steamCloud.minEmitBox = new Vector3(-1, 0, -1);
            steamCloud.maxEmitBox = new Vector3(1, 0.5, 1);
            
            // Set particle properties
            steamCloud.minSize = 0.5;
            steamCloud.maxSize = 1.5;
            steamCloud.minLifeTime = 1.0;
            steamCloud.maxLifeTime = 2.0;
            steamCloud.emitRate = 50;
            
            // Direct color initialization
            steamCloud.color1 = new Color4(0.8, 0.8, 0.9, 0.8);
            steamCloud.color2 = new Color4(0.7, 0.8, 1.0, 0.7);
            steamCloud.colorDead = new Color4(0.6, 0.7, 0.8, 0);
            
            steamCloud.direction1 = new Vector3(-0.2, 0.5, -0.2);
            steamCloud.direction2 = new Vector3(0.2, 1, 0.2);
            steamCloud.minEmitPower = 0.5;
            steamCloud.maxEmitPower = 1.5;
            steamCloud.updateSpeed = 0.01;
            
            // Start the particle system
            steamCloud.start();
            
            // Stop and dispose after a short time
            setTimeout(() => {
                steamCloud.stop();
                setTimeout(() => {
                    steamCloud.dispose();
                }, 2000);
            }, 1000);
        } catch (error) {
            console.error("Error creating steam cloud:", error);
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
     * Create a medieval-style base for the tower
     */
    private createMedievalBase(): Mesh {
        // Create a cylinder for the base
        const base = MeshBuilder.CreateCylinder(
            'steamTowerBase',
            {
                height: 1.2,
                diameterTop: 1.8,
                diameterBottom: 2.2,
                tessellation: 16
            },
            this.scene
        );
        
        // Create material for the base
        const baseMaterial = new StandardMaterial('baseMaterial', this.scene);
        baseMaterial.diffuseColor = new Color3(0.5, 0.5, 0.6); // Stone color
        baseMaterial.specularColor = new Color3(0.1, 0.1, 0.1);
        base.material = baseMaterial;
        
        return base;
    }
    
    /**
     * Dispose of the tower and its resources
     */
    public dispose(): void {
        // Dispose of the steam particles
        if (this.steamParticles) {
            this.steamParticles.stop();
            this.steamParticles.dispose();
            this.steamParticles = null;
        }
        
        // Stop animations
        if (this.steamRing) {
            this.scene.stopAnimation(this.steamRing);
        }
        
        // Clean up vent particles
        if (this.mesh) {
            // Find and dispose any remaining particle systems
            this.scene.particleSystems.forEach(ps => {
                if (ps.name.startsWith('ventSteam') || ps.name.startsWith('steamCloudPS')) {
                    ps.dispose();
                }
            });
        }
        
        // Call base class dispose
        super.dispose();
    }
} 