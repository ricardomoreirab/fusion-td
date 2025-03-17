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
    private waterWheel: Mesh | null = null; // Used for rotating water orbs
    
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
    }
    
    /**
     * Create a rotating water effect for the tower
     */
    private createWaterWheel(): void {
        // Create an invisible parent mesh to hold the water orbs
        this.waterWheel = new Mesh("waterOrbsParent", this.scene);
        this.waterWheel.parent = this.mesh;
        this.waterWheel.position.y = 2.5; // Position at mid-height of tower
        
        // Create circulating water orbs
        const orbCount = 6;
        const orbitRadius = 1.0;
        
        for (let i = 0; i < orbCount; i++) {
            const angle = (i / orbCount) * Math.PI * 2;
            
            // Create a water orb (smaller sphere)
            const waterOrb = MeshBuilder.CreateSphere(
                `waterOrb${i}`,
                {
                    diameter: 0.25 + Math.random() * 0.15,
                    segments: 8
                },
                this.scene
            );
            
            // Position orb in a circular pattern
            waterOrb.parent = this.waterWheel;
            waterOrb.position.x = Math.sin(angle) * orbitRadius;
            waterOrb.position.z = Math.cos(angle) * orbitRadius;
            
            // Add some height variance
            waterOrb.position.y = (i % 2 === 0) ? 0.2 : -0.2;
            
            // Create translucent water material
            const waterMaterial = new StandardMaterial(`waterOrbMaterial${i}`, this.scene);
            waterMaterial.diffuseColor = new Color3(0.2, 0.5, 0.9);
            waterMaterial.specularColor = new Color3(0.4, 0.7, 1.0);
            waterMaterial.specularPower = 64; // More reflective for water
            waterMaterial.alpha = 0.7; // Translucent
            waterOrb.material = waterMaterial;
            
            // Add particle system for each orb for water trail effect
            const trailPS = new ParticleSystem(`waterTrail${i}`, 30, this.scene);
            trailPS.emitter = waterOrb;
            trailPS.minSize = 0.05;
            trailPS.maxSize = 0.15;
            trailPS.minLifeTime = 0.2;
            trailPS.maxLifeTime = 0.5;
            trailPS.emitRate = 20;
            trailPS.color1 = new Color4(0.4, 0.7, 1.0, 0.6);
            trailPS.color2 = new Color4(0.2, 0.5, 0.9, 0.4);
            trailPS.colorDead = new Color4(0.1, 0.3, 0.7, 0);
            trailPS.updateSpeed = 0.01;
            trailPS.start();
        }
        
        // Create animation for the orbit rotation
        const frameRate = 30;
        const rotateAnimation = new Animation(
            "waterOrbitRotation", 
            "rotation.y", 
            frameRate, 
            Animation.ANIMATIONTYPE_FLOAT, 
            Animation.ANIMATIONLOOPMODE_CYCLE
        );
        
        // Create animation keys - rotate 360 degrees over 180 frames (6 seconds)
        const keys = [];
        keys.push({ frame: 0, value: 0 });
        keys.push({ frame: 180, value: Math.PI * 2 });
        rotateAnimation.setKeys(keys);
        
        // Attach animation to orbit parent and play it
        this.waterWheel.animations = [];
        this.waterWheel.animations.push(rotateAnimation);
        this.scene.beginAnimation(this.waterWheel, 0, 180, true);
        
        // Add a secondary animation for gentle vertical movement
        const floatAnimation = new Animation(
            "waterFloatAnimation", 
            "position.y", 
            frameRate, 
            Animation.ANIMATIONTYPE_FLOAT, 
            Animation.ANIMATIONLOOPMODE_CYCLE
        );
        
        // Create float animation keys
        const floatKeys = [];
        floatKeys.push({ frame: 0, value: 2.5 });
        floatKeys.push({ frame: 60, value: 2.6 });
        floatKeys.push({ frame: 120, value: 2.5 });
        floatKeys.push({ frame: 180, value: 2.4 });
        floatKeys.push({ frame: 240, value: 2.5 });
        floatAnimation.setKeys(floatKeys);
        
        // Add float animation
        this.waterWheel.animations.push(floatAnimation);
        this.scene.beginAnimation(this.waterWheel, 0, 240, true);
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
        
        // Clean up water orbs and their particles
        if (this.waterWheel) {
            this.scene.stopAnimation(this.waterWheel);
            
            // Find and dispose any particle systems attached to the water orbs
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
            
            this.waterWheel.dispose();
            this.waterWheel = null;
        }
        
        super.dispose();
    }
} 