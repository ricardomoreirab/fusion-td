import { Vector3, MeshBuilder, StandardMaterial, Color3, Mesh, ParticleSystem, Color4, Animation } from '@babylonjs/core';
import { Game } from '../../Game';
import { ElementalTower } from './ElementalTower';
import { ElementType, StatusEffect, EnemyType } from './Tower';
import { Enemy } from '../enemies/Enemy';

/**
 * Water Tower - Deals water damage and can slow or freeze enemies
 * - Primary Effect: Slowed movement
 * - Secondary Effect: Chance to freeze
 * - Strong against: Fire, Earth
 * - Weak against: Wind, Electric
 */
export class WaterTower extends ElementalTower {
    private waterFountain: Mesh | null = null;
    private waterParticles: ParticleSystem | null = null;
    private waterWheel: Mesh | null = null; // Add rotating water wheel
    private wheelWaterParticles: ParticleSystem | null = null; // Additional particles
    
    /**
     * Constructor for the WaterTower
     * @param game The game instance
     * @param position The position of the tower
     */
    constructor(game: Game, position: Vector3) {
        // Base stats for water tower
        const damage = 8;
        const range = 6;
        const fireRate = 1.5;
        const cost = 100;
        
        super(game, position, range, damage, fireRate, cost, ElementType.WATER);
        
        // Set water-specific properties
        this.secondaryEffectChance = 0.25; // 25% chance to freeze
        this.statusEffectDuration = 2.5; // 2.5 seconds of slowing
        this.statusEffectStrength = 0.4; // 40% slow
        
        // Set targeting priorities
        this.targetPriorities = [
            EnemyType.FIRE,
            EnemyType.EARTH
        ];
        
        // Set weaknesses
        this.weakAgainst = [
            EnemyType.WIND,
            EnemyType.ELECTRIC
        ];
        
        // Update visuals to apply water appearance
        this.updateVisuals();
    }
    
    /**
     * Create the tower mesh
     */
    protected createMesh(): void {
        // Create root mesh for the water tower
        this.mesh = new Mesh("waterTowerRoot", this.scene);
        this.mesh.position = this.position.clone();
        
        // Create medieval base using the base class method
        const base = this.createMedievalBase();
        base.parent = this.mesh;
        base.position.y = 0.6; // Position relative to root
        
        // Create middle section - ocean blue hued stone
        const middle = MeshBuilder.CreateCylinder(
            'waterTowerMiddle',
            {
                height: 2.4,
                diameterTop: 1.4,
                diameterBottom: 1.8,
                tessellation: 16
            },
            this.scene
        );
        middle.parent = this.mesh;
        middle.position.y = 2.0; // Position relative to root
        
        // Create middle material - blue-tinted stone
        const middleMaterial = new StandardMaterial('waterTowerMiddleMaterial', this.scene);
        middleMaterial.diffuseColor = new Color3(0.2, 0.3, 0.4);
        middleMaterial.specularColor = new Color3(0.3, 0.4, 0.5);
        middleMaterial.specularPower = 32;
        middle.material = middleMaterial;
        
        // Create tiered fountain top
        const topTier = MeshBuilder.CreateCylinder(
            'waterTowerTopTier',
            {
                height: 0.6,
                diameterTop: 1.2,
                diameterBottom: 1.5,
                tessellation: 16
            },
            this.scene
        );
        topTier.parent = this.mesh;
        topTier.position.y = 3.5; // Position relative to root
        
        // Create top tier material
        const topTierMaterial = new StandardMaterial('topTierMaterial', this.scene);
        topTierMaterial.diffuseColor = new Color3(0.3, 0.4, 0.5);
        topTierMaterial.specularColor = new Color3(0.4, 0.5, 0.6);
        topTier.material = topTierMaterial;
        
        // Create second tier (smaller)
        const secondTier = MeshBuilder.CreateCylinder(
            'waterTowerSecondTier',
            {
                height: 0.4,
                diameterTop: 0.8,
                diameterBottom: 1.0,
                tessellation: 16
            },
            this.scene
        );
        secondTier.parent = this.mesh;
        secondTier.position.y = 4.0; // Position relative to root
        secondTier.material = topTierMaterial;
        
        // Create water basin with flowing water
        const basin = MeshBuilder.CreateTorus(
            'waterBasin',
            {
                diameter: 1.4,
                thickness: 0.4,
                tessellation: 32
            },
            this.scene
        );
        basin.parent = this.mesh;
        basin.position.y = 3.5; // Position relative to root
        
        // Create basin material - darker blue
        const basinMaterial = new StandardMaterial('basinMaterial', this.scene);
        basinMaterial.diffuseColor = new Color3(0.2, 0.3, 0.4);
        basinMaterial.specularColor = new Color3(0.4, 0.6, 0.8);
        basin.material = basinMaterial;
        
        // Create water pool inside the basin
        const waterPool = MeshBuilder.CreateDisc(
            'waterPool',
            {
                radius: 0.6,
                tessellation: 24
            },
            this.scene
        );
        waterPool.parent = this.mesh;
        waterPool.position.y = 4.25; // Position at the top
        
        // Create water material - blue and transparent
        const waterMaterial = new StandardMaterial('waterMaterial', this.scene);
        waterMaterial.diffuseColor = new Color3(0.1, 0.5, 0.9);
        waterMaterial.specularColor = new Color3(0.5, 0.7, 1.0);
        waterMaterial.specularPower = 128; // High specularity for water shine
        waterMaterial.alpha = 0.7; // Make transparent
        waterPool.material = waterMaterial;
        
        // Add water fountain in the center
        this.waterFountain = MeshBuilder.CreateCylinder(
            'waterFountain',
            {
                height: 0.8,
                diameterTop: 0.05, // Almost a point at top
                diameterBottom: 0.3,
                tessellation: 12
            },
            this.scene
        );
        this.waterFountain.parent = this.mesh;
        this.waterFountain.position.y = 4.3; // Position relative to root
        
        // Create fountain material
        const fountainMaterial = new StandardMaterial('fountainMaterial', this.scene);
        fountainMaterial.diffuseColor = new Color3(0.3, 0.5, 0.7);
        fountainMaterial.specularColor = new Color3(0.6, 0.8, 1.0);
        this.waterFountain.material = fountainMaterial;
        
        // Add water cascades/falls around the basin
        for (let i = 0; i < 4; i++) {
            const angle = (i / 4) * Math.PI * 2;
            
            // Create a water stream
            const waterStream = MeshBuilder.CreateBox(
                `waterStream${i}`,
                {
                    width: 0.15,
                    height: 0.6,
                    depth: 0.05
                },
                this.scene
            );
            
            // Position stream to flow over the side
            waterStream.parent = this.mesh;
            waterStream.position.x = Math.sin(angle) * 0.6;
            waterStream.position.z = Math.cos(angle) * 0.6;
            waterStream.position.y = 3.7;
            waterStream.rotation.x = Math.PI / 8; // Slight angle for flowing appearance
            waterStream.rotation.y = angle;
            
            // Apply water material to stream
            const streamMaterial = new StandardMaterial(`streamMaterial${i}`, this.scene);
            streamMaterial.diffuseColor = new Color3(0.2, 0.6, 1.0);
            streamMaterial.alpha = 0.5;
            waterStream.material = streamMaterial;
        }
        
        // Add water particle effect
        this.createWaterEffect();

        // Create water wheel
        this.createWaterWheel();

        // Create elemental aura - disabled
        // this.createElementalAura();

        // Add circling water elements - disabled
        // this.createCirclingElements(5, 2.6);
    }
    
    /**
     * Create water particle effect for the tower
     */
    private createWaterEffect(): void {
        if (!this.waterFountain) return;
        
        // Create particle system for water fountain
        this.waterParticles = new ParticleSystem("waterParticles", 200, this.scene);
        this.waterParticles.emitter = new Vector3(
            this.position.x,
            this.position.y + 4.1, // Top of the fountain
            this.position.z
        );
        
        // Particles configuration
        this.waterParticles.minSize = 0.05;
        this.waterParticles.maxSize = 0.15;
        this.waterParticles.minLifeTime = 1.0;
        this.waterParticles.maxLifeTime = 2.0;
        this.waterParticles.emitRate = 60;
        
        // Define direct colors (avoid Color3 to Color4 conversion issues)
        this.waterParticles.color1 = new Color4(0.4, 0.6, 1.0, 0.8);
        this.waterParticles.color2 = new Color4(0.2, 0.4, 0.8, 0.8);
        this.waterParticles.colorDead = new Color4(0.1, 0.2, 0.5, 0.0);
        
        // Direction and behavior - fountain-like
        this.waterParticles.direction1 = new Vector3(-0.5, 3, -0.5);
        this.waterParticles.direction2 = new Vector3(0.5, 3, 0.5);
        this.waterParticles.minEmitPower = 0.5;
        this.waterParticles.maxEmitPower = 1.0;
        this.waterParticles.updateSpeed = 0.01;
        this.waterParticles.gravity = new Vector3(0, -9.8, 0); // Apply gravity
        
        // Start the water effect
        this.waterParticles.start();
        
        // Add a second particle system for water falling from the wheel
        this.wheelWaterParticles = new ParticleSystem("wheelWaterParticles", 50, this.scene);
        this.wheelWaterParticles.emitter = new Vector3(
            this.position.x + 0.5, // Match wheel x position
            this.position.y + 1.6, // Below the wheel
            this.position.z + 0.8  // Match wheel z position
        );
        
        // Configure wheel water particles
        this.wheelWaterParticles.minSize = 0.03;
        this.wheelWaterParticles.maxSize = 0.1;
        this.wheelWaterParticles.minLifeTime = 0.5;
        this.wheelWaterParticles.maxLifeTime = 1.0;
        this.wheelWaterParticles.emitRate = 30;
        
        // Colors
        this.wheelWaterParticles.color1 = new Color4(0.4, 0.7, 1.0, 0.7);
        this.wheelWaterParticles.color2 = new Color4(0.2, 0.5, 0.9, 0.6);
        this.wheelWaterParticles.colorDead = new Color4(0.1, 0.3, 0.7, 0.0);
        
        // Direction - falling down and slightly forward
        this.wheelWaterParticles.direction1 = new Vector3(-0.2, -1, -0.2);
        this.wheelWaterParticles.direction2 = new Vector3(0.2, -1, 0.2);
        this.wheelWaterParticles.minEmitPower = 0.3;
        this.wheelWaterParticles.maxEmitPower = 0.8;
        this.wheelWaterParticles.updateSpeed = 0.01;
        this.wheelWaterParticles.gravity = new Vector3(0, -9.8, 0);
        
        // Start the wheel water effect
        this.wheelWaterParticles.start();
    }
    
    /**
     * Create a rotating water wheel for the tower
     */
    private createWaterWheel(): void {
        // Create the main wheel
        const wheel = MeshBuilder.CreateCylinder(
            'waterWheel',
            {
                height: 0.2,
                diameter: 1.8, // Slightly smaller
                tessellation: 16
            },
            this.scene
        );
        
        // Create wheel material
        const wheelMaterial = new StandardMaterial('wheelMaterial', this.scene);
        wheelMaterial.diffuseColor = new Color3(0.1, 0.2, 0.3);
        wheelMaterial.specularColor = new Color3(0.3, 0.4, 0.6);
        wheel.material = wheelMaterial;
        
        // Position the wheel to stick out from the side of the tower - adjusted positioning
        wheel.parent = this.mesh;
        wheel.position.y = 2.2; // Lower slightly
        wheel.position.z = 0.8; // Closer to the tower
        wheel.position.x = 0.5; // Offset to the side a bit
        wheel.rotation.x = Math.PI / 2; // Rotate to be vertical
        
        // Create paddles for the water wheel
        const paddleCount = 8;
        for (let i = 0; i < paddleCount; i++) {
            const angle = (i / paddleCount) * Math.PI * 2;
            
            // Create paddle
            const paddle = MeshBuilder.CreateBox(
                `paddle${i}`,
                {
                    width: 0.7,
                    height: 0.15,
                    depth: 0.25
                },
                this.scene
            );
            
            // Position paddle around the wheel
            paddle.parent = wheel;
            paddle.position.x = Math.sin(angle) * 0.7; // Slightly smaller radius
            paddle.position.y = Math.cos(angle) * 0.7;
            
            // Rotate paddle to face outward
            paddle.rotation.z = angle;
            
            // Create paddle material - blue with water tint
            const paddleMaterial = new StandardMaterial(`paddleMaterial${i}`, this.scene);
            paddleMaterial.diffuseColor = new Color3(0.2, 0.5, 0.7);
            paddleMaterial.specularColor = new Color3(0.4, 0.6, 0.8);
            paddle.material = paddleMaterial;
            
            // Add water drip effect to each paddle
            if (i % 2 === 0) { // Only add to every other paddle to reduce particle count
                const dripPS = new ParticleSystem(`dripPS${i}`, 10, this.scene);
                dripPS.emitter = paddle;
                dripPS.minSize = 0.05;
                dripPS.maxSize = 0.1;
                dripPS.minLifeTime = 0.5;
                dripPS.maxLifeTime = 0.8;
                dripPS.emitRate = 5;
                dripPS.color1 = new Color4(0.4, 0.7, 1.0, 0.7);
                dripPS.color2 = new Color4(0.3, 0.6, 0.9, 0.5);
                dripPS.colorDead = new Color4(0.2, 0.5, 0.8, 0);
                dripPS.direction1 = new Vector3(0, -1, 0);
                dripPS.direction2 = new Vector3(0, -1, 0);
                dripPS.gravity = new Vector3(0, -9.8, 0);
                dripPS.minEmitPower = 0.5;
                dripPS.maxEmitPower = 1.0;
                dripPS.updateSpeed = 0.01;
                dripPS.start();
            }
        }
        
        // Add support structure for water wheel
        const support = MeshBuilder.CreateBox(
            'wheelSupport',
            {
                width: 0.15,
                height: 0.8,
                depth: 0.15
            },
            this.scene
        );
        support.parent = this.mesh;
        support.position.y = 2.2;
        support.position.z = 0.45;
        support.position.x = 0.5;
        
        const supportMaterial = new StandardMaterial('supportMaterial', this.scene);
        supportMaterial.diffuseColor = new Color3(0.3, 0.2, 0.1);
        supportMaterial.specularColor = new Color3(0.1, 0.1, 0.1);
        support.material = supportMaterial;
        
        // Store reference to water wheel
        this.waterWheel = wheel;
        
        // Create animation for water wheel rotation
        const frameRate = 30;
        const rotateAnimation = new Animation(
            "waterWheelRotation", 
            "rotation.z", 
            frameRate, 
            Animation.ANIMATIONTYPE_FLOAT, 
            Animation.ANIMATIONLOOPMODE_CYCLE
        );
        
        // Create animation keys - rotate 360 degrees over 240 frames (8 seconds)
        // Water wheel rotates more slowly than windmill
        const keys = [];
        keys.push({ frame: 0, value: 0 });
        keys.push({ frame: 240, value: Math.PI * 2 });
        rotateAnimation.setKeys(keys);
        
        // Attach animation to water wheel and play it
        wheel.animations = [];
        wheel.animations.push(rotateAnimation);
        this.scene.beginAnimation(wheel, 0, 240, true);
    }
    
    /**
     * Apply the primary elemental effect to the target
     * @param enemy The target enemy
     */
    protected applyPrimaryEffect(enemy: Enemy): void {
        // Apply slowing effect
        this.applyStatusEffect(
            enemy,
            StatusEffect.SLOWED,
            this.statusEffectDuration,
            this.statusEffectStrength
        );
    }
    
    /**
     * Apply the secondary elemental effect to the target
     * @param enemy The target enemy
     */
    protected applySecondaryEffect(enemy: Enemy): void {
        // Apply freezing effect
        this.applyStatusEffect(
            enemy,
            StatusEffect.FROZEN,
            1.0, // 1 second of freezing
            1.0 // 100% freeze (complete stop)
        );
    }
    
    /**
     * Dispose of tower resources
     */
    public dispose(): void {
        if (this.waterParticles) {
            this.waterParticles.dispose();
        }
        
        if (this.wheelWaterParticles) {
            this.wheelWaterParticles.dispose();
        }
        
        // Clean up water wheel and its particles
        if (this.waterWheel) {
            this.scene.stopAnimation(this.waterWheel);
            
            // Find and dispose any particle systems attached to the water wheel
            this.waterWheel.getChildMeshes().forEach(mesh => {
                this.scene.particleSystems.forEach(ps => {
                    if (ps.emitter === mesh) {
                        ps.dispose();
                    }
                });
                
                if (mesh.material) {
                    mesh.material.dispose();
                }
                mesh.dispose();
            });
            
            if (this.waterWheel.material) {
                this.waterWheel.material.dispose();
            }
            this.waterWheel.dispose();
            this.waterWheel = null;
        }
        
        // Find and dispose wheel support
        if (this.mesh) {
            const support = this.mesh.getChildMeshes().find(mesh => mesh.name === 'wheelSupport');
            if (support) {
                if (support.material) {
                    support.material.dispose();
                }
                support.dispose();
            }
        }
        
        super.dispose();
    }
} 