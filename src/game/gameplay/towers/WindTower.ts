import { Vector3, MeshBuilder, StandardMaterial, Color3, Mesh, ParticleSystem, Color4, Animation } from '@babylonjs/core';
import { Game } from '../../Game';
import { ElementalTower } from './ElementalTower';
import { ElementType, StatusEffect, EnemyType } from './Tower';
import { Enemy } from '../enemies/Enemy';

/**
 * Wind Tower - Deals wind damage and can push or stun enemies
 * - Primary Effect: Push enemies back
 * - Secondary Effect: Chance to stun
 * - Strong against: Water, Flying
 * - Weak against: Earth, Heavy
 */
export class WindTower extends ElementalTower {
    private windParticles: ParticleSystem | null = null;
    private windmill: Mesh | null = null;
    
    /**
     * Constructor for the WindTower
     * @param game The game instance
     * @param position The position of the tower
     */
    constructor(game: Game, position: Vector3) {
        // Base stats for wind tower
        const damage = 6;
        const range = 7;
        const fireRate = 2.0;
        const cost = 100;
        
        super(game, position, range, damage, fireRate, cost, ElementType.WIND);
        
        // Set wind-specific properties
        this.secondaryEffectChance = 0.2; // 20% chance to stun
        this.statusEffectDuration = 1.0; // 1 second of push/stun
        this.statusEffectStrength = 0.5; // 50% push strength
        
        // Set targeting priorities
        this.targetPriorities = [
            EnemyType.WATER,
            EnemyType.FLYING,
            EnemyType.LIGHT
        ];
        
        // Set weaknesses
        this.weakAgainst = [
            EnemyType.EARTH,
            EnemyType.HEAVY
        ];
        
        // Update visuals to apply wind appearance
        this.updateVisuals();
    }
    
    /**
     * Create the tower mesh
     */
    protected createMesh(): void {
        // Create root mesh for the wind tower
        this.mesh = new Mesh("windTowerRoot", this.scene);
        this.mesh.position = this.position.clone();
        
        // Create medieval base using the base class method
        const base = this.createMedievalBase();
        base.parent = this.mesh;
        base.position.y = 0.6; // Position relative to root
        
        // Create middle section - slender tower with open-air design
        const middle = MeshBuilder.CreateCylinder(
            'windTowerMiddle',
            {
                height: 3.0,
                diameterTop: 1.0,
                diameterBottom: 1.6,
                tessellation: 8
            },
            this.scene
        );
        middle.parent = this.mesh;
        middle.position.y = 2.2; // Position relative to root
        
        // Create middle material - light gray with green tint
        const middleMaterial = new StandardMaterial('windTowerMiddleMaterial', this.scene);
        middleMaterial.diffuseColor = new Color3(0.7, 0.8, 0.7);
        middleMaterial.specularColor = new Color3(0.3, 0.4, 0.3);
        middle.material = middleMaterial;
        
        // Create open-air platform at the top
        const platform = MeshBuilder.CreateCylinder(
            'windTowerPlatform',
            {
                height: 0.2,
                diameter: 1.4,
                tessellation: 8
            },
            this.scene
        );
        platform.parent = this.mesh;
        platform.position.y = 3.7; // Position relative to root
        
        // Create platform material
        const platformMaterial = new StandardMaterial('platformMaterial', this.scene);
        platformMaterial.diffuseColor = new Color3(0.6, 0.7, 0.6);
        platform.material = platformMaterial;
        
        // Create central wind column - a translucent cyclone
        const cyclone = MeshBuilder.CreateCylinder(
            'windColumn',
            {
                height: 2.0,
                diameterTop: 0.2, // Narrows at top
                diameterBottom: 0.8,
                tessellation: 16
            },
            this.scene
        );
        cyclone.parent = this.mesh;
        cyclone.position.y = 4.3; // Position relative to root
        
        // Create cyclone material - translucent with swirl
        const cycloneMaterial = new StandardMaterial('cycloneMaterial', this.scene);
        cycloneMaterial.diffuseColor = new Color3(0.7, 0.9, 0.7);
        cycloneMaterial.alpha = 0.5; // Translucent
        cycloneMaterial.specularColor = new Color3(0.8, 1.0, 0.8);
        cycloneMaterial.emissiveColor = new Color3(0.2, 0.3, 0.2);
        cyclone.material = cycloneMaterial;
        
        // Create wind vanes/blades around the tower
        this.createWindmillBlades();
        
        // Add ring of pillars around the top to suggest air flowing through
        for (let i = 0; i < 6; i++) {
            const angle = (i / 6) * Math.PI * 2;
            
            // Create a pillar
            const pillar = MeshBuilder.CreateCylinder(
                `windPillar${i}`,
                {
                    height: 1.0,
                    diameter: 0.15,
                    tessellation: 8
                },
                this.scene
            );
            
            // Position pillar in a circle
            pillar.parent = this.mesh;
            pillar.position.x = Math.sin(angle) * 0.6;
            pillar.position.z = Math.cos(angle) * 0.6;
            pillar.position.y = 4.2; // Position at top
            
            // Create leaf/wind-catcher at top of each pillar
            const leaf = MeshBuilder.CreateBox(
                `windLeaf${i}`,
                {
                    width: 0.3,
                    height: 0.05,
                    depth: 0.4
                },
                this.scene
            );
            leaf.parent = this.mesh;
            leaf.position.x = Math.sin(angle) * 0.6;
            leaf.position.z = Math.cos(angle) * 0.6;
            leaf.position.y = 4.8;
            leaf.rotation.y = angle + Math.PI / 4; // Offset rotation for better visual
            
            // Create pillar and leaf materials
            const pillarMaterial = new StandardMaterial(`pillarMaterial${i}`, this.scene);
            pillarMaterial.diffuseColor = new Color3(0.6, 0.7, 0.6);
            pillar.material = pillarMaterial;
            
            const leafMaterial = new StandardMaterial(`leafMaterial${i}`, this.scene);
            leafMaterial.diffuseColor = new Color3(0.5, 0.8, 0.5);
            leaf.material = leafMaterial;
        }
        
        // Create air spiral at the top
        const spiral = MeshBuilder.CreateTorus(
            'airSpiral',
            {
                diameter: 0.8,
                thickness: 0.1,
                tessellation: 24
            },
            this.scene
        );
        spiral.parent = this.mesh;
        spiral.position.y = 4.0;
        spiral.rotation.x = Math.PI / 2; // Horizontal orientation
        
        // Create spiral material
        const spiralMaterial = new StandardMaterial('spiralMaterial', this.scene);
        spiralMaterial.diffuseColor = new Color3(0.6, 0.9, 0.6);
        spiralMaterial.alpha = 0.6;
        spiralMaterial.emissiveColor = new Color3(0.2, 0.3, 0.2);
        spiral.material = spiralMaterial;
        
        // Create elemental banner
        // this.createElementalBanner(this.mesh, new Vector3(0, 2.0, 1.0));
        
        // Add wind particle effect
        this.createWindEffect();
        
        // Create elemental aura - disabled
        // this.createElementalAura();
        
        // Add circling wind elements - disabled
        // this.createCirclingElements(5, 2.5);
    }
    
    /**
     * Create windmill blades attached to the tower
     */
    private createWindmillBlades(): void {
        // Create a central hub for the blades
        const hub = MeshBuilder.CreateSphere(
            'windmillHub',
            {
                diameter: 0.4,
                segments: 12
            },
            this.scene
        );
        hub.parent = this.mesh;
        hub.position.y = 4.5; // Position higher at tower top
        
        // Create hub material
        const hubMaterial = new StandardMaterial('hubMaterial', this.scene);
        hubMaterial.diffuseColor = new Color3(0.7, 0.8, 0.7);
        hub.material = hubMaterial;
        
        // Create rod connecting hub to tower
        const rod = MeshBuilder.CreateCylinder(
            'windmillRod',
            {
                height: 0.6,
                diameter: 0.15,
                tessellation: 8
            },
            this.scene
        );
        rod.parent = this.mesh;
        rod.position.y = 4.5;
        rod.rotation.x = Math.PI / 2; // Make horizontal
        
        // Create rod material
        const rodMaterial = new StandardMaterial('rodMaterial', this.scene);
        rodMaterial.diffuseColor = new Color3(0.6, 0.7, 0.6);
        rod.material = rodMaterial;
        
        // Create main windmill blades (4)
        for (let i = 0; i < 4; i++) {
            // Angle for the current blade
            const angle = (i / 4) * Math.PI * 2;
            
            // Create a blade
            const blade = MeshBuilder.CreateBox(
                `windmillBlade${i}`,
                {
                    width: 0.1,
                    height: 1.4,
                    depth: 0.3
                },
                this.scene
            );
            
            // Position and rotate blade
            blade.parent = hub;
            
            // Position the blades horizontally to extend outward from the hub
            blade.position.x = Math.sin(angle) * 0.7;
            blade.position.z = Math.cos(angle) * 0.7;
            
            // Rotate blade to face the wind direction
            blade.rotation.y = angle + Math.PI / 2; // Perpendicular to radius
            
            // Create blade material
            const bladeMaterial = new StandardMaterial(`bladeMaterial${i}`, this.scene);
            bladeMaterial.diffuseColor = new Color3(0.8, 0.9, 0.8);
            blade.material = bladeMaterial;
        }
        
        // Store reference to windmill for rotation
        this.windmill = hub;
        
        // Create a simple animation for the hub rotation
        const frameRate = 30;
        const rotateAnimation = new Animation(
            "windmillRotation", 
            "rotation.y", // Change to y axis rotation for horizontal blades
            frameRate, 
            Animation.ANIMATIONTYPE_FLOAT, 
            Animation.ANIMATIONLOOPMODE_CYCLE
        );
        
        // Create animation keys - rotate 360 degrees over 60 frames
        const keys = [];
        keys.push({ frame: 0, value: 0 });
        keys.push({ frame: 60, value: Math.PI * 2 });
        rotateAnimation.setKeys(keys);
        
        // Attach animation to hub and play it
        hub.animations = [];
        hub.animations.push(rotateAnimation);
        this.scene.beginAnimation(hub, 0, 60, true);
    }
    
    /**
     * Create wind particle effect for the tower
     */
    private createWindEffect(): void {
        // Create particle system for wind
        this.windParticles = new ParticleSystem("windParticles", 200, this.scene);
        this.windParticles.emitter = new Vector3(
            this.position.x,
            this.position.y + 4.0, // Higher to match the windmill position
            this.position.z
        );
        
        // Particles configuration - more dynamic
        this.windParticles.minSize = 0.08;
        this.windParticles.maxSize = 0.25;
        this.windParticles.minLifeTime = 0.5;
        this.windParticles.maxLifeTime = 2.0;
        this.windParticles.emitRate = 60; // More particles
        
        // Define direct colors (avoid Color3 to Color4 conversion issues)
        this.windParticles.color1 = new Color4(0.7, 1.0, 0.7, 0.7); // More visible
        this.windParticles.color2 = new Color4(0.8, 1.0, 0.8, 0.7);
        this.windParticles.colorDead = new Color4(1.0, 1.0, 1.0, 0.0);
        
        // Direction and behavior - more dynamic swirling wind
        this.windParticles.direction1 = new Vector3(-1.5, 0.1, -1.5);
        this.windParticles.direction2 = new Vector3(1.5, 0.5, 1.5);
        this.windParticles.minEmitPower = 1.5;
        this.windParticles.maxEmitPower = 3.5;
        this.windParticles.updateSpeed = 0.015;
        
        // Create stronger swirling effect
        this.windParticles.minAngularSpeed = 2.0;
        this.windParticles.maxAngularSpeed = 4.0;
        
        // Add some random circular motion
        this.windParticles.addVelocityGradient(0, 0.5);
        this.windParticles.addVelocityGradient(0.1, 1.0);
        this.windParticles.addVelocityGradient(0.7, 1.0);
        this.windParticles.addVelocityGradient(1.0, 0.5);
        
        // Start the wind effect
        this.windParticles.start();
    }
    
    /**
     * Update the tower each frame
     * @param deltaTime Time since last update
     */
    public update(deltaTime: number): void {
        super.update(deltaTime);
        
        // Rotate the windmill blades
        if (this.windmill) {
            this.windmill.rotation.y += deltaTime * 1.5; // Rotate based on time
        }
    }
    
    /**
     * Apply the primary elemental effect to the target
     * @param enemy The target enemy
     */
    protected applyPrimaryEffect(enemy: Enemy): void {
        // Apply push effect
        this.applyStatusEffect(
            enemy,
            StatusEffect.PUSHED,
            this.statusEffectDuration,
            this.statusEffectStrength
        );
    }
    
    /**
     * Apply the secondary elemental effect to the target
     * @param enemy The target enemy
     */
    protected applySecondaryEffect(enemy: Enemy): void {
        // Apply stunning effect
        this.applyStatusEffect(
            enemy,
            StatusEffect.STUNNED,
            0.5, // 0.5 seconds of stunning
            1.0 // 100% stun (complete stop)
        );
    }
    
    /**
     * Dispose of tower resources
     */
    public dispose(): void {
        if (this.windParticles) {
            this.windParticles.dispose();
        }
        
        super.dispose();
    }
} 