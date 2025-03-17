import { Vector3, MeshBuilder, StandardMaterial, Color3, Mesh, ParticleSystem, Texture, Color4, Animation } from '@babylonjs/core';
import { Game } from '../../Game';
import { ElementalTower } from './ElementalTower';
import { ElementType, StatusEffect, EnemyType } from './Tower';
import { Enemy } from '../enemies/Enemy';

/**
 * Fire Tower - Deals fire damage and can burn enemies
 * - Primary Effect: Burning (DoT)
 * - Strong against: Wind, Earth, Plant
 * - Weak against: Water, Ice
 */
export class FireTower extends ElementalTower {
    private flameTorch: Mesh | null = null;
    private flameParticles: ParticleSystem | null = null;
    private flameRing: Mesh | null = null;
    
    /**
     * Constructor for the FireTower
     * @param game The game instance
     * @param position The position of the tower
     */
    constructor(game: Game, position: Vector3) {
        // Base stats for fire tower
        const damage = 12;
        const range = 5;
        const fireRate = 1.2;
        const cost = 100;
        
        super(game, position, range, damage, fireRate, cost, ElementType.FIRE);
        
        // Set fire-specific properties
        this.secondaryEffectChance = 0.4; // 40% chance to apply burning
        this.statusEffectDuration = 3; // 3 seconds of burning
        this.statusEffectStrength = 0.2; // 20% of damage per second
        
        // Set targeting priorities
        this.targetPriorities = [
            EnemyType.WIND,
            EnemyType.EARTH,
            EnemyType.PLANT
        ];
        
        // Set weaknesses
        this.weakAgainst = [
            EnemyType.WATER,
            EnemyType.ICE
        ];
        
        // Update visuals to apply fire appearance
        this.updateVisuals();
    }
    
    /**
     * Create the tower mesh
     */
    protected createMesh(): void {
        // Create root mesh for the fire tower
        this.mesh = new Mesh("fireTowerRoot", this.scene);
        this.mesh.position = this.position.clone();
        
        // Create medieval base using the base class method
        const base = this.createMedievalBase();
        base.parent = this.mesh;
        base.position.y = 0.6; // Position relative to root
        
        // Create middle section - darker stone with red hue
        const middle = MeshBuilder.CreateCylinder(
            'fireTowerMiddle',
            {
                height: 2.5,
                diameterTop: 1.2,
                diameterBottom: 1.8,
                tessellation: 12
            },
            this.scene
        );
        middle.parent = this.mesh;
        middle.position.y = 2.2; // Position relative to root
        
        // Create middle material - dark stone with red tint
        const middleMaterial = new StandardMaterial('fireTowerMiddleMaterial', this.scene);
        middleMaterial.diffuseColor = new Color3(0.4, 0.2, 0.1);
        middleMaterial.specularColor = new Color3(0.3, 0.1, 0);
        middle.material = middleMaterial;
        
        // Create volcano-like opening at the top
        const volcanoTop = MeshBuilder.CreateCylinder(
            'fireTowerTop',
            {
                height: 0.8,
                diameterTop: 1.5, // Wider at top like a volcano mouth
                diameterBottom: 1.1,
                tessellation: 12
            },
            this.scene
        );
        volcanoTop.parent = this.mesh;
        volcanoTop.position.y = 3.8; // Position relative to root
        
        // Create volcano top material
        const volcanoMaterial = new StandardMaterial('volcanoMaterial', this.scene);
        volcanoMaterial.diffuseColor = new Color3(0.3, 0.1, 0.05);
        volcanoMaterial.emissiveColor = new Color3(0.2, 0.05, 0);
        volcanoTop.material = volcanoMaterial;
        
        // Create lava pool inside the volcano
        const lavaPool = MeshBuilder.CreateDisc(
            'lavaPool',
            {
                radius: 0.7,
                tessellation: 24
            },
            this.scene
        );
        lavaPool.parent = this.mesh;
        lavaPool.position.y = 4.25; // Position at the top of the volcano
        
        // Create lava material with glow
        const lavaMaterial = new StandardMaterial('lavaMaterial', this.scene);
        lavaMaterial.diffuseColor = new Color3(1, 0.3, 0);
        lavaMaterial.emissiveColor = new Color3(0.8, 0.2, 0);
        lavaMaterial.specularColor = new Color3(1, 0.6, 0.3);
        lavaPool.material = lavaMaterial;
        
        // Create glowing rim around the volcano mouth
        const rimMaterial = new StandardMaterial('rimMaterial', this.scene);
        rimMaterial.diffuseColor = new Color3(0.8, 0.2, 0);
        rimMaterial.emissiveColor = new Color3(0.6, 0.1, 0);
        rimMaterial.specularColor = new Color3(1, 0.5, 0.2);
        
        // Add flame cracks around the middle section
        for (let i = 0; i < 5; i++) {
            const angle = (i / 5) * Math.PI * 2;
            const crackMesh = MeshBuilder.CreateBox(
                `flameCrack${i}`,
                {
                    width: 0.15,
                    height: 0.8 + Math.random() * 0.4,
                    depth: 0.1
                },
                this.scene
            );
            
            crackMesh.parent = this.mesh;
            crackMesh.position.x = Math.sin(angle) * 0.85;
            crackMesh.position.z = Math.cos(angle) * 0.85;
            crackMesh.position.y = 2.2 + Math.random() * 0.5;
            crackMesh.rotation.y = angle;
            
            const crackMaterial = new StandardMaterial(`crackMaterial${i}`, this.scene);
            crackMaterial.diffuseColor = new Color3(1, 0.3, 0);
            crackMaterial.emissiveColor = new Color3(0.8, 0.2, 0);
            crackMesh.material = crackMaterial;
        }
        
        // Add flame torch at the top as a central pillar of fire
        this.flameTorch = MeshBuilder.CreateCylinder(
            'fireTorch',
            {
                height: 1.2,
                diameter: 0.4,
                tessellation: 12
            },
            this.scene
        );
        this.flameTorch.parent = this.mesh;
        this.flameTorch.position.y = 4.8; // Position relative to root
        
        // Create torch material - glowing flame
        const torchMaterial = new StandardMaterial('torchMaterial', this.scene);
        torchMaterial.diffuseColor = new Color3(1, 0.4, 0);
        torchMaterial.emissiveColor = new Color3(0.8, 0.3, 0);
        torchMaterial.specularColor = new Color3(1, 0.7, 0.3);
        this.flameTorch.material = torchMaterial;
        
        // Add flame particle effect
        this.createFlameEffect();

        // Create rotating flame rings
        this.createRotatingFlameRings();

        // Create elemental aura
        // this.createElementalAura();

        // Add circling fire elements
        // this.createCirclingElements(4, 2.5);
    }
    
    /**
     * Create flame particle effect for the tower
     */
    private createFlameEffect(): void {
        if (!this.flameTorch) return;
        
        // Create particle system for flames
        this.flameParticles = new ParticleSystem("flameParticles", 100, this.scene);
        this.flameParticles.emitter = new Vector3(
            this.position.x,
            this.position.y + 3.5, // Top of the torch
            this.position.z
        );
        
        // Particles configuration
        this.flameParticles.minSize = 0.2;
        this.flameParticles.maxSize = 0.5;
        this.flameParticles.minLifeTime = 0.3;
        this.flameParticles.maxLifeTime = 1.0;
        this.flameParticles.emitRate = 50;
        
        // Define direct colors (avoid Color3 to Color4 conversion issues)
        this.flameParticles.color1 = new Color4(1, 0.5, 0, 1.0);
        this.flameParticles.color2 = new Color4(1, 0.2, 0, 1.0);
        this.flameParticles.colorDead = new Color4(0.5, 0, 0, 0.0);
        
        // Direction and behavior
        this.flameParticles.direction1 = new Vector3(-0.2, 1, -0.2);
        this.flameParticles.direction2 = new Vector3(0.2, 1, 0.2);
        this.flameParticles.minEmitPower = 0.5;
        this.flameParticles.maxEmitPower = 2;
        this.flameParticles.updateSpeed = 0.01;
        
        // Start the flames
        this.flameParticles.start();
    }
    
    /**
     * Apply the primary elemental effect to the target
     * @param enemy The target enemy
     */
    protected applyPrimaryEffect(enemy: Enemy): void {
        // Apply burning effect
        this.applyStatusEffect(
            enemy,
            StatusEffect.BURNING,
            this.statusEffectDuration,
            this.statusEffectStrength
        );
    }
    
    /**
     * Apply the secondary elemental effect to the target
     * @param enemy The target enemy
     */
    protected applySecondaryEffect(enemy: Enemy): void {
        // For fire tower, secondary effect is just additional burning damage
        // Apply a shorter but more intense burning effect
        this.applyStatusEffect(
            enemy,
            StatusEffect.BURNING,
            1.5, // 1.5 seconds
            this.statusEffectStrength * 2 // Double strength
        );
    }
    
    /**
     * Dispose of tower resources
     */
    public dispose(): void {
        if (this.flameParticles) {
            this.flameParticles.dispose();
        }
        
        // Clean up flame ring particles
        if (this.flameRing) {
            this.scene.stopAnimation(this.flameRing);
            
            // Find and dispose any particle systems using the flame elements as emitters
            this.flameRing.getChildMeshes().forEach(mesh => {
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
            
            this.flameRing.dispose();
            this.flameRing = null;
        }
        
        super.dispose();
    }

    /**
     * Create rotating flame rings around the tower
     */
    private createRotatingFlameRings(): void {
        // Create a ring parent that will rotate
        this.flameRing = new Mesh("flameRingParent", this.scene);
        this.flameRing.parent = this.mesh;
        this.flameRing.position.y = 3.0; // Position at middle-top of tower
        
        // Create several flame elements around the ring
        const ringCount = 4;
        const radius = 1.3;
        
        for (let i = 0; i < ringCount; i++) {
            const angle = (i / ringCount) * Math.PI * 2;
            
            // Create a flame shape using a flattened sphere
            const flameMesh = MeshBuilder.CreateSphere(
                `flameElement${i}`,
                {
                    diameter: 0.5,
                    segments: 8
                },
                this.scene
            );
            
            // Flatten and stretch the flame shape
            flameMesh.scaling = new Vector3(0.3, 1.0, 0.3);
            
            // Position around the ring
            flameMesh.parent = this.flameRing;
            flameMesh.position.x = Math.sin(angle) * radius;
            flameMesh.position.z = Math.cos(angle) * radius;
            
            // Rotate to point outward
            flameMesh.rotation.y = angle + Math.PI / 2;
            
            // Create glowing flame material
            const flameMaterial = new StandardMaterial(`flameMaterial${i}`, this.scene);
            flameMaterial.diffuseColor = new Color3(1.0, 0.3, 0);
            flameMaterial.emissiveColor = new Color3(0.8, 0.2, 0);
            flameMaterial.specularColor = new Color3(1, 0.5, 0.2);
            flameMesh.material = flameMaterial;
            
            // Add smaller particle system for each flame
            const flamePS = new ParticleSystem(`flamePS${i}`, 20, this.scene);
            flamePS.emitter = flameMesh;
            flamePS.minSize = 0.1;
            flamePS.maxSize = 0.3;
            flamePS.minLifeTime = 0.2;
            flamePS.maxLifeTime = 0.5;
            flamePS.emitRate = 15;
            flamePS.color1 = new Color4(1, 0.5, 0, 1);
            flamePS.color2 = new Color4(1, 0.2, 0, 1);
            flamePS.colorDead = new Color4(0.5, 0, 0, 0);
            flamePS.direction1 = new Vector3(0, 1, 0);
            flamePS.direction2 = new Vector3(0, 1, 0);
            flamePS.minEmitPower = 0.5;
            flamePS.maxEmitPower = 1.5;
            flamePS.updateSpeed = 0.01;
            flamePS.start();
        }
        
        // Create animation for the ring rotation
        const frameRate = 30;
        const rotateAnimation = new Animation(
            "flameRingRotation", 
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
        
        // Attach animation to the ring and play it
        this.flameRing.animations = [];
        this.flameRing.animations.push(rotateAnimation);
        this.scene.beginAnimation(this.flameRing, 0, 180, true);
    }
} 