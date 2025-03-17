import { Vector3, MeshBuilder, StandardMaterial, Color3, Mesh, ParticleSystem, Color4, Animation } from '@babylonjs/core';
import { Game } from '../../Game';
import { ElementalTower } from './ElementalTower';
import { ElementType, StatusEffect, EnemyType } from './Tower';
import { Enemy } from '../enemies/Enemy';

/**
 * Earth Tower - Deals earth damage and can stun or confuse enemies
 * - Primary Effect: High damage to ground units
 * - Secondary Effect: Chance to confuse
 * - Strong against: Wind, Electric, Heavy
 * - Weak against: Fire, Water
 */
export class EarthTower extends ElementalTower {
    private earthParticles: ParticleSystem | null = null;
    private rockFormation: Mesh | null = null;
    private crystalOrbit: Mesh | null = null; // For rotating crystals
    
    /**
     * Constructor for the EarthTower
     * @param game The game instance
     * @param position The position of the tower
     */
    constructor(game: Game, position: Vector3) {
        // Base stats for earth tower
        const damage = 15;
        const range = 4;
        const fireRate = 0.8;
        const cost = 100;
        
        super(game, position, range, damage, fireRate, cost, ElementType.EARTH);
        
        // Set earth-specific properties
        this.secondaryEffectChance = 0.15; // 15% chance to confuse
        this.statusEffectDuration = 2.0; // 2 seconds of confusion
        this.statusEffectStrength = 0.7; // 70% confusion strength
        
        // Set targeting priorities
        this.targetPriorities = [
            EnemyType.WIND,
            EnemyType.ELECTRIC,
            EnemyType.HEAVY
        ];
        
        // Set weaknesses
        this.weakAgainst = [
            EnemyType.FIRE,
            EnemyType.WATER
        ];
        
        // Earth towers cannot target flying enemies
        this.canTargetFlying = false;
        
        // Update visuals to apply earth appearance
        this.updateVisuals();
    }
    
    /**
     * Create the tower mesh
     */
    protected createMesh(): void {
        try {
            // Create root mesh for the earth tower
            this.mesh = new Mesh("earthTowerRoot", this.scene);
            this.mesh.position = this.position.clone();
            
            // Create a rocky base instead of standard medieval base
            const base = MeshBuilder.CreateCylinder(
                'earthTowerBase',
                {
                    height: 1.2,
                    diameterTop: 2.0,
                    diameterBottom: 2.4,
                    tessellation: 6 // Hexagonal for a more crystalline look
                },
                this.scene
            );
            base.parent = this.mesh;
            base.position.y = 0.6; // Position relative to root
            
            // Create rugged base material - brown, rocky appearance
            const baseMaterial = new StandardMaterial('earthBaseMaterial', this.scene);
            baseMaterial.diffuseColor = new Color3(0.5, 0.35, 0.2);
            baseMaterial.specularColor = new Color3(0.2, 0.15, 0.1);
            baseMaterial.emissiveColor = new Color3(0, 0, 0);
            base.material = baseMaterial;
            
            // Add rock formations around the base
            for (let i = 0; i < 5; i++) {
                const angle = (i / 5) * Math.PI * 2;
                const rock = MeshBuilder.CreatePolyhedron(
                    `baseRock${i}`,
                    {
                        type: 1, // Rock shape (octahedron)
                        size: 0.3 + Math.random() * 0.2
                    },
                    this.scene
                );
                
                rock.parent = this.mesh;
                rock.position.x = Math.sin(angle) * 1.0;
                rock.position.z = Math.cos(angle) * 1.0;
                rock.position.y = 0.3;
                rock.rotation.y = Math.random() * Math.PI;
                
                // Random brown/grey stone material
                const rockMaterial = new StandardMaterial(`rockMaterial${i}`, this.scene);
                rockMaterial.diffuseColor = new Color3(
                    0.4 + Math.random() * 0.2,
                    0.3 + Math.random() * 0.1,
                    0.2
                );
                rockMaterial.specularColor = new Color3(0.2, 0.15, 0.1);
                rock.material = rockMaterial;
            }
            
            // Create middle section - terraced stone tower
            const middle = MeshBuilder.CreateCylinder(
                'earthTowerMiddle',
                {
                    height: 2.0,
                    diameterTop: 1.4,
                    diameterBottom: 1.8,
                    tessellation: 6
                },
                this.scene
            );
            middle.parent = this.mesh;
            middle.position.y = 2.0; // Position relative to root
            
            // Create middle material - darker stone with brown/green tint
            const middleMaterial = new StandardMaterial('earthTowerMiddleMaterial', this.scene);
            middleMaterial.diffuseColor = new Color3(0.4, 0.25, 0.15);
            middleMaterial.specularColor = new Color3(0.15, 0.1, 0.05);
            middleMaterial.emissiveColor = new Color3(0, 0, 0);
            middle.material = middleMaterial;
            
            // Create second level - terraced top
            const terraceTop = MeshBuilder.CreateCylinder(
                'earthTowerTop',
                {
                    height: 0.8,
                    diameterTop: 1.6,
                    diameterBottom: 1.2,
                    tessellation: 6
                },
                this.scene
            );
            terraceTop.parent = this.mesh;
            terraceTop.position.y = 3.4; // Position relative to root
            
            // Create terrace top material with crystal veins
            const terraceTopMaterial = new StandardMaterial('terraceTopMaterial', this.scene);
            terraceTopMaterial.diffuseColor = new Color3(0.45, 0.3, 0.15);
            terraceTopMaterial.specularColor = new Color3(0.2, 0.15, 0.1);
            terraceTopMaterial.emissiveColor = new Color3(0, 0, 0);
            terraceTop.material = terraceTopMaterial;
            
            // Add crystal formations jutting out from the sides
            for (let i = 0; i < 6; i++) {
                const angle = (i / 6) * Math.PI * 2;
                
                // Create a crystal formation
                const crystal = MeshBuilder.CreatePolyhedron(
                    `crystal${i}`,
                    {
                        type: 3, // Diamond shape
                        size: 0.25
                    },
                    this.scene
                );
                
                // Position crystal on the sides
                crystal.parent = this.mesh;
                crystal.position.x = Math.sin(angle) * 0.8;
                crystal.position.z = Math.cos(angle) * 0.8;
                crystal.position.y = 3.0 + Math.random() * 0.5;
                crystal.rotation.y = angle;
                crystal.rotation.x = Math.PI / 6; // Tilt outward
                
                // Crystal material - semi-translucent and glowing slightly
                const crystalMaterial = new StandardMaterial(`crystalMaterial${i}`, this.scene);
                
                // Use the elemental color with variations
                const safeElementColor = this.elementColor || new Color3(0.5, 0.3, 0);
                crystalMaterial.diffuseColor = safeElementColor.scale(0.8 + Math.random() * 0.4);
                crystalMaterial.specularColor = new Color3(0.8, 0.6, 0.3);
                crystalMaterial.emissiveColor = safeElementColor.scale(0.2);
                crystalMaterial.alpha = 0.9; // Slightly transparent
                
                crystal.material = crystalMaterial;
            }
            
            // Create central rock formation/earth pillar on top
            this.rockFormation = MeshBuilder.CreateCylinder(
                'rockFormation',
                {
                    height: 1.2,
                    diameterTop: 0.1, // Tapers to a point
                    diameterBottom: 0.8,
                    tessellation: 6
                },
                this.scene
            );
            this.rockFormation.parent = this.mesh;
            this.rockFormation.position.y = 4.2; // Position relative to root
            
            // Create floating stones around the central rock
            for (let i = 0; i < 3; i++) {
                const angle = (i / 3) * Math.PI * 2;
                const floatingRock = MeshBuilder.CreatePolyhedron(
                    `floatingRock${i}`,
                    {
                        type: i % 2 === 0 ? 0 : 2, // Alternate between tetrahedron and octahedron
                        size: 0.2 + Math.random() * 0.1
                    },
                    this.scene
                );
                
                floatingRock.parent = this.mesh;
                floatingRock.position.x = Math.sin(angle) * 0.4;
                floatingRock.position.z = Math.cos(angle) * 0.4;
                floatingRock.position.y = 4.5 + i * 0.25; // Staggered heights
                floatingRock.rotation.y = Math.random() * Math.PI * 2;
                
                // Stone material
                const stoneMaterial = new StandardMaterial(`stoneMaterial${i}`, this.scene);
                const safeElementColor = this.elementColor || new Color3(0.5, 0.3, 0);
                stoneMaterial.diffuseColor = safeElementColor.scale(0.6 + Math.random() * 0.4);
                stoneMaterial.specularColor = new Color3(0.3, 0.2, 0.1);
                floatingRock.material = stoneMaterial;
            }
            
            // Create rock material with explicit color definitions
            const rockMaterial = new StandardMaterial('rockMaterial', this.scene);
            // Use a safe color that is definitely defined
            const safeElementColor = this.elementColor || new Color3(0.5, 0.3, 0);
            rockMaterial.diffuseColor = safeElementColor;
            rockMaterial.specularColor = new Color3(0.2, 0.15, 0.1);
            rockMaterial.emissiveColor = new Color3(0, 0, 0); // No emission
            this.rockFormation.material = rockMaterial;
            
            // Add earth particle effect
            this.createEarthEffect();
            
            // Create rotating crystals
            this.createRotatingCrystals();
            
            // Create elemental aura - disabled
            // this.createElementalAura();
            
            // Add circling earth elements - disabled 
            // this.createCirclingElements(4, 3.0);
        } catch (error) {
            console.error("Error creating Earth Tower mesh:", error);
        }
    }
    
    /**
     * Create earth particle effect for the tower
     */
    private createEarthEffect(): void {
        if (!this.rockFormation) return;
        
        try {
            // Create particle system for earth debris
            this.earthParticles = new ParticleSystem("earthParticles", 50, this.scene);
            this.earthParticles.emitter = new Vector3(
                this.position.x,
                this.position.y + 3.5, // Top of the rock formation
                this.position.z
            );
            
            // Particles configuration
            this.earthParticles.minSize = 0.05;
            this.earthParticles.maxSize = 0.15;
            this.earthParticles.minLifeTime = 1.0;
            this.earthParticles.maxLifeTime = 2.0;
            this.earthParticles.emitRate = 15; // Fewer particles for rocks/debris
            
            // Use direct Color4 initialization with explicit values
            // Define direct colors (avoid Color3 to Color4 conversion issues)
            this.earthParticles.color1 = new Color4(0.6, 0.4, 0.2, 1.0);
            this.earthParticles.color2 = new Color4(0.5, 0.3, 0.1, 1.0);
            this.earthParticles.colorDead = new Color4(0.3, 0.2, 0.1, 0.0);
            
            // Direction and behavior - falling debris and dust
            this.earthParticles.direction1 = new Vector3(-0.5, -1, -0.5);
            this.earthParticles.direction2 = new Vector3(0.5, -0.2, 0.5);
            this.earthParticles.minEmitPower = 0.2;
            this.earthParticles.maxEmitPower = 0.5;
            this.earthParticles.updateSpeed = 0.01;
            this.earthParticles.gravity = new Vector3(0, -9.8, 0); // Apply gravity
            
            // Start the earth debris effect
            this.earthParticles.start();
        } catch (error) {
            console.error("Error creating earth effect:", error);
        }
    }
    
    /**
     * Apply the primary elemental effect to the target
     * @param enemy The target enemy
     */
    protected applyPrimaryEffect(enemy: Enemy): void {
        // Earth tower doesn't apply a status effect as primary
        // Instead, it deals extra damage to ground units in the calculateDamage method
        
        // But we can apply a short stun as a primary effect
        if (enemy.getEnemyType() !== EnemyType.FLYING) {
            this.applyStatusEffect(
                enemy,
                StatusEffect.STUNNED,
                0.3, // 0.3 seconds of stunning
                1.0 // 100% stun (complete stop)
            );
        }
    }
    
    /**
     * Apply the secondary elemental effect to the target
     * @param enemy The target enemy
     */
    protected applySecondaryEffect(enemy: Enemy): void {
        // Apply confusion effect
        this.applyStatusEffect(
            enemy,
            StatusEffect.CONFUSED,
            this.statusEffectDuration,
            this.statusEffectStrength
        );
    }
    
    /**
     * Calculate damage based on elemental strengths/weaknesses
     * @param enemy The target enemy
     * @returns The calculated damage
     */
    protected calculateDamage(enemy: Enemy): number {
        let damage = super.calculateDamage(enemy);
        
        // Earth towers deal extra damage to ground units
        if (enemy.getEnemyType() !== EnemyType.FLYING) {
            damage *= 1.5; // 50% extra damage to ground units
        }
        
        return damage;
    }
    
    /**
     * Dispose of tower resources
     */
    public dispose(): void {
        if (this.earthParticles) {
            this.earthParticles.dispose();
        }
        
        // Clean up rotating crystals
        if (this.crystalOrbit) {
            this.scene.stopAnimation(this.crystalOrbit);
            
            // Find and dispose all crystal meshes and their materials
            this.crystalOrbit.getChildMeshes().forEach(crystal => {
                // Dispose any child meshes the crystal may have
                crystal.getChildMeshes().forEach(child => {
                    if (child.material) {
                        child.material.dispose();
                    }
                    child.dispose();
                });
                
                if (crystal.material) {
                    crystal.material.dispose();
                }
                crystal.dispose();
            });
            
            this.crystalOrbit.dispose();
            this.crystalOrbit = null;
        }
        
        super.dispose();
    }

    /**
     * Create rotating crystal elements around the tower
     */
    private createRotatingCrystals(): void {
        // Create parent mesh for rotation
        this.crystalOrbit = new Mesh("crystalOrbitParent", this.scene);
        this.crystalOrbit.parent = this.mesh;
        this.crystalOrbit.position.y = 3.2; // Position around middle-upper part of tower
        
        // Create multiple crystal formations that orbit around
        const crystalCount = 5;
        const radius = 1.3;
        
        for (let i = 0; i < crystalCount; i++) {
            const angle = (i / crystalCount) * Math.PI * 2;
            
            // Create a crystal formation using polyhedron
            const crystal = MeshBuilder.CreatePolyhedron(
                `orbitCrystal${i}`,
                {
                    type: 3, // Diamond shape
                    size: 0.25 + Math.random() * 0.15
                },
                this.scene
            );
            
            // Position crystal around the orbit
            crystal.parent = this.crystalOrbit;
            crystal.position.x = Math.sin(angle) * radius;
            crystal.position.z = Math.cos(angle) * radius;
            
            // Add some random rotation to each crystal
            crystal.rotation.x = Math.random() * Math.PI;
            crystal.rotation.y = Math.random() * Math.PI;
            crystal.rotation.z = Math.random() * Math.PI;
            
            // Create crystal material - semi-translucent and glowing
            const crystalMaterial = new StandardMaterial(`crystalMaterial${i}`, this.scene);
            
            // Use different colors for variety
            const colorVariation = Math.random() * 0.3;
            crystalMaterial.diffuseColor = new Color3(
                0.5 + colorVariation, 
                0.3 + colorVariation * 0.5, 
                0.1 + colorVariation * 0.2
            );
            crystalMaterial.specularColor = new Color3(0.8, 0.6, 0.3);
            crystalMaterial.emissiveColor = new Color3(0.2 + colorVariation * 0.2, 0.1, 0);
            
            // Add some transparency based on size
            if (i % 2 === 0) {
                crystalMaterial.alpha = 0.8;
            }
            
            crystal.material = crystalMaterial;
            
            // Add a smaller crystal connected to the main one
            if (i % 2 === 0) {
                const smallCrystal = MeshBuilder.CreatePolyhedron(
                    `smallCrystal${i}`,
                    {
                        type: 3, // Diamond shape
                        size: 0.15
                    },
                    this.scene
                );
                
                // Position small crystal as an offshoot of the main crystal
                smallCrystal.parent = crystal;
                smallCrystal.position.x = 0.2;
                smallCrystal.position.y = 0.1;
                
                // Random rotation
                smallCrystal.rotation.x = Math.random() * Math.PI;
                smallCrystal.rotation.y = Math.random() * Math.PI;
                
                // Create similar material but slightly different color
                const smallCrystalMaterial = new StandardMaterial(`smallCrystalMaterial${i}`, this.scene);
                smallCrystalMaterial.diffuseColor = new Color3(
                    0.6 + colorVariation * 0.8, 
                    0.4 + colorVariation * 0.4, 
                    0.2 + colorVariation * 0.1
                );
                smallCrystalMaterial.specularColor = new Color3(0.9, 0.7, 0.4);
                smallCrystalMaterial.emissiveColor = new Color3(0.3 + colorVariation * 0.2, 0.15, 0);
                smallCrystal.material = smallCrystalMaterial;
            }
        }
        
        // Create animation for the orbit rotation - slower than other elements
        const frameRate = 30;
        const rotateAnimation = new Animation(
            "crystalOrbitRotation", 
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
        
        // Attach animation to orbit parent and play it
        this.crystalOrbit.animations = [];
        this.crystalOrbit.animations.push(rotateAnimation);
        this.scene.beginAnimation(this.crystalOrbit, 0, 300, true);
        
        // Add secondary animation for small up and down movement
        const floatAnimation = new Animation(
            "crystalFloatAnimation", 
            "position.y", 
            frameRate, 
            Animation.ANIMATIONTYPE_FLOAT, 
            Animation.ANIMATIONLOOPMODE_CYCLE
        );
        
        // Create float animation keys - move slightly up and down
        const floatKeys = [];
        floatKeys.push({ frame: 0, value: 3.2 });
        floatKeys.push({ frame: 60, value: 3.3 });
        floatKeys.push({ frame: 120, value: 3.2 });
        floatKeys.push({ frame: 180, value: 3.1 });
        floatKeys.push({ frame: 240, value: 3.2 });
        floatAnimation.setKeys(floatKeys);
        
        // Add float animation
        this.crystalOrbit.animations.push(floatAnimation);
        this.scene.beginAnimation(this.crystalOrbit, 0, 240, true);
    }
} 