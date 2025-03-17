import { Scene, Vector3, Color3, Color4, ParticleSystem, Mesh, MeshBuilder, StandardMaterial, Animation } from '@babylonjs/core';
import { Game } from '../../Game';
import { Tower, ElementType, StatusEffect, EnemyType } from './Tower';
import { Enemy } from '../enemies/Enemy';

/**
 * Base class for all elemental towers
 */
export abstract class ElementalTower extends Tower {
    /**
     * The color of the tower based on its element
     */
    protected elementColor: Color3;

    /**
     * The color of the projectiles fired by this tower
     */
    protected projectileColor: Color3;

    /**
     * The element type of this tower
     */
    protected elementType: ElementType;

    /**
     * Decorative elements for the medieval theme
     */
    protected banners: Mesh[] = [];
    protected flagpole: Mesh | null = null;
    protected towerTop: Mesh | null = null;
    
    /**
     * Circling elemental particles
     */
    protected circlingParticles: ParticleSystem | null = null;
    protected circlingEmitter: Mesh | null = null;

    /**
     * Helper method to safely create a Color4 from Color3
     * @param color3 The Color3 to convert
     * @param alpha The alpha value (default: 1.0)
     * @returns A properly initialized Color4
     */
    protected safeColor4(color3: Color3, alpha: number = 1.0): Color4 {
        if (!color3) {
            return new Color4(1, 1, 1, alpha); // Default white if color3 is null
        }
        
        try {
            return new Color4(
                color3.r !== undefined ? color3.r : 1.0,
                color3.g !== undefined ? color3.g : 1.0,
                color3.b !== undefined ? color3.b : 1.0,
                alpha
            );
        } catch (error) {
            console.error("Error creating Color4:", error);
            return new Color4(1, 1, 1, alpha);
        }
    }

    /**
     * Constructor for the ElementalTower
     * @param game The game instance
     * @param scene The scene
     * @param position The position of the tower
     * @param elementType The element type of the tower
     */
    constructor(
        game: Game,
        position: Vector3,
        range: number,
        damage: number,
        fireRate: number,
        cost: number,
        elementType: ElementType
    ) {
        super(game, position, range, damage, fireRate, cost);
        
        // Initialize banners array
        this.banners = [];
        
        // Set the element type
        this.elementType = elementType;
        
        // Set default secondary effect chance
        this.secondaryEffectChance = 0.3;
        
        // Set element color based on element type
        switch (elementType) {
            case ElementType.FIRE:
                this.elementColor = new Color3(1, 0.3, 0);
                this.projectileColor = new Color3(1, 0.5, 0);
                break;
            case ElementType.WATER:
                this.elementColor = new Color3(0, 0.5, 1);
                this.projectileColor = new Color3(0.4, 0.7, 1);
                break;
            case ElementType.WIND:
                this.elementColor = new Color3(0.7, 1, 0.7);
                this.projectileColor = new Color3(0.8, 1, 0.8);
                break;
            case ElementType.EARTH:
                this.elementColor = new Color3(0.5, 0.3, 0);
                this.projectileColor = new Color3(0.6, 0.4, 0.1);
                break;
            default:
                this.elementColor = new Color3(0.7, 0.7, 0.7);
                this.projectileColor = new Color3(0.9, 0.9, 0.9);
                break;
        }
    }

    /**
     * Create medieval tower base with stone texture appearance
     */
    protected createMedievalBase(): Mesh {
        // Create a cylinder for the stone base
        const base = MeshBuilder.CreateCylinder(
            'medievalBase',
            {
                height: 1.2,
                diameter: 2.2,
                tessellation: 8 // Octagonal base for medieval feel
            },
            this.scene
        );
        
        // Create stone-like material
        const stoneMaterial = new StandardMaterial('stoneMaterial', this.scene);
        stoneMaterial.diffuseColor = new Color3(0.6, 0.6, 0.6);
        stoneMaterial.specularColor = new Color3(0.2, 0.2, 0.2);
        
        // Apply material
        base.material = stoneMaterial;
        
        return base;
    }

    /**
     * Create medieval tower top with battlements
     */
    protected createMedievalTop(parentMesh: Mesh, topHeight: number = 0.5, topColor: Color3 = new Color3(0.5, 0.5, 0.5)): Mesh {
        // Create top part with battlements/crenellations
        this.towerTop = MeshBuilder.CreateCylinder(
            'towerTop',
            {
                height: topHeight,
                diameter: 2.0,
                tessellation: 8 // Match the base
            },
            this.scene
        );
        
        // Create material
        const topMaterial = new StandardMaterial('topMaterial', this.scene);
        topMaterial.diffuseColor = topColor;
        
        // Apply material
        this.towerTop.material = topMaterial;
        
        // Parent to main mesh
        this.towerTop.parent = parentMesh;
        
        return this.towerTop;
    }

    /**
     * Create a banner with the elemental color
     */
    protected createElementalBanner(parentMesh: Mesh, position: Vector3): void {
        // Ensure banners array is initialized
        if (!this.banners) {
            this.banners = [];
        }
        
        // Create flagpole
        this.flagpole = MeshBuilder.CreateCylinder(
            'flagpole',
            {
                height: 2.0,
                diameter: 0.1,
                tessellation: 8
            },
            this.scene
        );
        
        // Position flagpole
        this.flagpole.position = position;
        this.flagpole.parent = parentMesh;
        
        try {
            // Create banner/flag
            const banner = MeshBuilder.CreatePlane(
                'banner',
                {
                    width: 0.8,
                    height: 0.6
                },
                this.scene
            );
            
            // Create banner material
            const bannerMaterial = new StandardMaterial('bannerMaterial', this.scene);
            
            // Use direct color3 assignment instead of converting from undefined
            const safeColor = this.elementColor ? this.elementColor : new Color3(0.7, 0.7, 0.7);
            bannerMaterial.diffuseColor = safeColor;
            bannerMaterial.backFaceCulling = false; // Show both sides
            
            // Apply material
            banner.material = bannerMaterial;
            
            // Position banner
            banner.position = new Vector3(position.x, position.y + 0.5, position.z + 0.3);
            banner.parent = parentMesh;
            
            // Add banner to the array
            this.banners.push(banner);
        } catch (error) {
            console.error("Error creating banner:", error);
        }
    }

    /**
     * Create circling element particles around the tower
     */
    protected createCirclingElements(count: number = 3, height: number = 2.0): void {
        try {
            // Create an invisible mesh to act as an emitter that will rotate
            this.circlingEmitter = new Mesh("circlingEmitter", this.scene);
            this.circlingEmitter.parent = this.mesh;
            this.circlingEmitter.position.y = height; // Adjust height based on tower
            
            // Create elemental aura around the tower
            this.createElementalAura();
            
            // Create elemental particles for each orbiting element
            for (let i = 0; i < count; i++) {
                const angle = (i / count) * Math.PI * 2;
                const orbitRadius = 1.8; // Increased distance from tower center
                
                // Create an element mesh with element-specific shape
                let elementMesh: Mesh;
                
                // Different mesh shapes based on element type
                switch (this.elementType) {
                    case ElementType.FIRE:
                        // Fire uses an icosphere for flame-like appearance
                        elementMesh = MeshBuilder.CreateIcoSphere(
                            `fireOrb${i}`,
                            {
                                radius: 0.3,
                                subdivisions: 3,
                                flat: false
                            },
                            this.scene
                        );
                        break;
                        
                    case ElementType.WATER:
                        // Water uses a sphere for droplet-like appearance
                        elementMesh = MeshBuilder.CreateSphere(
                            `waterOrb${i}`,
                            {
                                diameter: 0.5,
                                segments: 16
                            },
                            this.scene
                        );
                        // Slightly flatten the water droplet
                        elementMesh.scaling.y = 0.8;
                        break;
                        
                    case ElementType.WIND:
                        // Wind uses a torus for cyclone/vortex appearance
                        elementMesh = MeshBuilder.CreateTorus(
                            `windOrb${i}`,
                            {
                                diameter: 0.5,
                                thickness: 0.2,
                                tessellation: 16
                            },
                            this.scene
                        );
                        // Rotate to show the hole of the torus
                        elementMesh.rotation.x = Math.PI / 2;
                        break;
                        
                    case ElementType.EARTH:
                        // Earth uses a polyhedron for crystal/rock appearance
                        elementMesh = MeshBuilder.CreatePolyhedron(
                            `earthOrb${i}`,
                            {
                                type: 2, // Octahedron type
                                size: 0.25
                            },
                            this.scene
                        );
                        break;
                        
                    default:
                        // Default fallback is a sphere
                        elementMesh = MeshBuilder.CreateSphere(
                            `elementOrb${i}`,
                            {
                                diameter: 0.4,
                                segments: 12
                            },
                            this.scene
                        );
                        break;
                }
                
                // Position element around the circle
                elementMesh.position = new Vector3(
                    Math.sin(angle) * orbitRadius,
                    0,
                    Math.cos(angle) * orbitRadius
                );
                
                // Parent to the rotating emitter
                elementMesh.parent = this.circlingEmitter;
                
                // Create material with the element color
                const elementMaterial = new StandardMaterial(`elementMaterial${i}`, this.scene);
                elementMaterial.diffuseColor = this.elementColor;
                
                // Element-specific material properties
                switch (this.elementType) {
                    case ElementType.FIRE:
                        // Fire has high emissive for glow effect
                        elementMaterial.emissiveColor = this.elementColor.scale(0.9);
                        elementMaterial.specularColor = new Color3(1, 0.6, 0.3);
                        elementMaterial.specularPower = 32;
                        break;
                        
                    case ElementType.WATER:
                        // Water has transparency and reflection
                        elementMaterial.alpha = 0.8;
                        elementMaterial.emissiveColor = this.elementColor.scale(0.5);
                        elementMaterial.specularColor = new Color3(1, 1, 1);
                        elementMaterial.specularPower = 64;
                        break;
                        
                    case ElementType.WIND:
                        // Wind has semi-transparency and lower reflection
                        elementMaterial.alpha = 0.7;
                        elementMaterial.emissiveColor = this.elementColor.scale(0.6);
                        elementMaterial.specularColor = new Color3(0.8, 1, 0.8);
                        break;
                        
                    case ElementType.EARTH:
                        // Earth has metallic/crystal appearance
                        elementMaterial.emissiveColor = this.elementColor.scale(0.3);
                        elementMaterial.specularColor = new Color3(0.6, 0.5, 0.3);
                        elementMaterial.specularPower = 16;
                        break;
                        
                    default:
                        elementMaterial.emissiveColor = this.elementColor.scale(0.8);
                        elementMaterial.specularColor = new Color3(1, 1, 1);
                        break;
                }
                
                // Apply material
                elementMesh.material = elementMaterial;
                
                // Add pulsing animation to the element
                this.addPulsingAnimation(elementMesh, i);
                
                // Create particles emanating from the element
                const particleSystem = new ParticleSystem(`elementParticles${i}`, 30, this.scene);
                particleSystem.emitter = elementMesh;
                
                // Element-specific particle behaviors
                switch (this.elementType) {
                    case ElementType.FIRE:
                        // Fire particles: upward movement, faster, more energetic
                        particleSystem.minSize = 0.15;
                        particleSystem.maxSize = 0.35;
                        particleSystem.minLifeTime = 0.3;
                        particleSystem.maxLifeTime = 0.8;
                        particleSystem.emitRate = 35;
                        particleSystem.direction1 = new Vector3(-0.3, 0.5, -0.3);
                        particleSystem.direction2 = new Vector3(0.3, 0.8, 0.3);
                        particleSystem.minEmitPower = 0.3;
                        particleSystem.maxEmitPower = 0.7;
                        particleSystem.color1 = new Color4(1, 0.5, 0, 1.0);
                        particleSystem.color2 = new Color4(1, 0.3, 0, 1.0);
                        particleSystem.colorDead = new Color4(0.5, 0, 0, 0);
                        break;
                        
                    case ElementType.WATER:
                        // Water particles: flowing, falling, slower
                        particleSystem.minSize = 0.1;
                        particleSystem.maxSize = 0.25;
                        particleSystem.minLifeTime = 0.8;
                        particleSystem.maxLifeTime = 1.5;
                        particleSystem.emitRate = 30;
                        particleSystem.direction1 = new Vector3(-0.2, -0.1, -0.2);
                        particleSystem.direction2 = new Vector3(0.2, 0.3, 0.2);
                        particleSystem.minEmitPower = 0.15;
                        particleSystem.maxEmitPower = 0.4;
                        particleSystem.gravity = new Vector3(0, -0.5, 0); // Slight gravity
                        particleSystem.color1 = new Color4(0, 0.7, 1, 1.0);
                        particleSystem.color2 = new Color4(0, 0.5, 1, 1.0);
                        particleSystem.colorDead = new Color4(0, 0.2, 0.5, 0);
                        break;
                        
                    case ElementType.WIND:
                        // Wind particles: swirling, wide spread, fast
                        particleSystem.minSize = 0.1;
                        particleSystem.maxSize = 0.2;
                        particleSystem.minLifeTime = 0.7;
                        particleSystem.maxLifeTime = 1.2;
                        particleSystem.emitRate = 40;
                        particleSystem.direction1 = new Vector3(-0.8, 0.2, -0.8);
                        particleSystem.direction2 = new Vector3(0.8, 0.5, 0.8);
                        particleSystem.minEmitPower = 0.4;
                        particleSystem.maxEmitPower = 0.8;
                        particleSystem.minAngularSpeed = 0.5; // Add rotation
                        particleSystem.maxAngularSpeed = 2.0;
                        particleSystem.color1 = new Color4(0.7, 1, 0.7, 0.8);
                        particleSystem.color2 = new Color4(0.5, 0.9, 0.5, 0.8);
                        particleSystem.colorDead = new Color4(0.3, 0.7, 0.3, 0);
                        break;
                        
                    case ElementType.EARTH:
                        // Earth particles: heavier, slower, falling
                        particleSystem.minSize = 0.2;
                        particleSystem.maxSize = 0.4;
                        particleSystem.minLifeTime = 1.0;
                        particleSystem.maxLifeTime = 2.0;
                        particleSystem.emitRate = 15;
                        particleSystem.direction1 = new Vector3(-0.1, -0.1, -0.1);
                        particleSystem.direction2 = new Vector3(0.1, 0.2, 0.1);
                        particleSystem.minEmitPower = 0.1;
                        particleSystem.maxEmitPower = 0.3;
                        particleSystem.gravity = new Vector3(0, -0.8, 0); // Stronger gravity
                        particleSystem.color1 = new Color4(0.6, 0.4, 0.1, 1.0);
                        particleSystem.color2 = new Color4(0.5, 0.3, 0, 1.0);
                        particleSystem.colorDead = new Color4(0.3, 0.2, 0, 0);
                        break;
                        
                    default:
                        // Default particles
                        particleSystem.color1 = new Color4(1, 1, 1, 1.0);
                        particleSystem.color2 = new Color4(0.8, 0.8, 0.8, 1.0);
                        particleSystem.colorDead = new Color4(0.5, 0.5, 0.5, 0);
                }
                
                // Start the particles
                particleSystem.start();
            }
            
            // Create rotation animation for the emitter
            const rotationAnimation = new Animation(
                'circlingElementsRotation',
                'rotation.y',
                60,  // Animation speed
                Animation.ANIMATIONTYPE_FLOAT,
                Animation.ANIMATIONLOOPMODE_CYCLE
            );
            
            // Set rotation keyframes
            const keyframes = [];
            keyframes.push({ frame: 0, value: 0 });
            keyframes.push({ frame: 100, value: Math.PI * 2 });
            rotationAnimation.setKeys(keyframes);
            
            // Apply animation to the emitter
            this.circlingEmitter.animations = [];
            this.circlingEmitter.animations.push(rotationAnimation);
            this.scene.beginAnimation(this.circlingEmitter, 0, 100, true, 1.0);
        } catch (error) {
            console.error("Error creating circling elements:", error);
        }
    }

    /**
     * Create an elemental aura around the tower base
     */
    protected createElementalAura(): void {
        try {
            // Create a disc mesh for the base aura
            const aura = MeshBuilder.CreateDisc(
                'elementalAura',
                {
                    radius: 2.2,
                    tessellation: 48 // Higher tessellation for smoother edge
                },
                this.scene
            );
            
            // Position at the base of the tower
            aura.parent = this.mesh;
            aura.position.y = 0.05; // Slightly above ground
            aura.rotation.x = Math.PI / 2; // Horizontal orientation
            
            // Create a material for the aura
            const auraMaterial = new StandardMaterial('auraMaterial', this.scene);
            
            // Element-specific aura properties
            switch (this.elementType) {
                case ElementType.FIRE:
                    // Fire aura - orange/red with high emissive
                    auraMaterial.diffuseColor = new Color3(1.0, 0.3, 0.0);
                    auraMaterial.emissiveColor = new Color3(0.8, 0.2, 0.0);
                    auraMaterial.specularColor = new Color3(1.0, 0.5, 0.2);
                    auraMaterial.alpha = 0.4;
                    
                    // Create additional flame rings
                    this.createFlameRings(5);
                    this.addAuraPulseAnimation(aura, 0.9, 1.1, 0.7); // Rapid pulse
                    break;
                    
                case ElementType.WATER:
                    // Water aura - blue with ripple effect
                    auraMaterial.diffuseColor = new Color3(0.0, 0.5, 1.0);
                    auraMaterial.emissiveColor = new Color3(0.0, 0.2, 0.6);
                    auraMaterial.specularColor = new Color3(0.4, 0.7, 1.0);
                    auraMaterial.specularPower = 64; // More reflective
                    auraMaterial.alpha = 0.35;
                    
                    // Create additional water ripples
                    this.createWaterRipples(3);
                    this.addAuraWaveAnimation(aura, 0.9, 1.05, 2.0); // Gentle wave
                    break;
                    
                case ElementType.WIND:
                    // Wind aura - light green/white with spiral effect
                    auraMaterial.diffuseColor = new Color3(0.7, 1.0, 0.7);
                    auraMaterial.emissiveColor = new Color3(0.3, 0.5, 0.3);
                    auraMaterial.specularColor = new Color3(0.8, 1.0, 0.8);
                    auraMaterial.alpha = 0.3;
                    
                    // Create spiral wind streams
                    this.createWindSpirals(8);
                    this.addAuraRotationAnimation(aura, 1.0); // Fast rotation
                    break;
                    
                case ElementType.EARTH:
                    // Earth aura - brown/gold with crystal elements
                    auraMaterial.diffuseColor = new Color3(0.6, 0.4, 0.1);
                    auraMaterial.emissiveColor = new Color3(0.3, 0.2, 0.05);
                    auraMaterial.specularColor = new Color3(0.7, 0.5, 0.2);
                    auraMaterial.specularPower = 32;
                    auraMaterial.alpha = 0.5;
                    
                    // Create earth crystals jutting from ground
                    this.createEarthCrystals(6);
                    this.addAuraPulseAnimation(aura, 0.95, 1.0, 3.0); // Very slow, subtle pulse
                    break;
            }
            
            // Apply the material
            aura.material = auraMaterial;
        } catch (error) {
            console.error("Error creating elemental aura:", error);
        }
    }

    /**
     * Create flame rings for the fire aura
     */
    private createFlameRings(count: number): void {
        try {
            for (let i = 0; i < count; i++) {
                // Create a torus for each flame ring
                const radius = 0.8 + i * 0.3; // Increasing radius
                const flameRing = MeshBuilder.CreateTorus(
                    `flameRing${i}`,
                    {
                        diameter: radius * 2,
                        thickness: 0.15,
                        tessellation: 32
                    },
                    this.scene
                );
                
                // Position at the base of the tower
                flameRing.parent = this.mesh;
                flameRing.position.y = 0.1 + i * 0.05; // Slightly increasing height
                flameRing.rotation.x = Math.PI / 2; // Horizontal orientation
                
                // Create material with flame appearance
                const flameMaterial = new StandardMaterial(`flameRingMaterial${i}`, this.scene);
                flameMaterial.diffuseColor = new Color3(1.0, 0.3 + (i * 0.1), 0.0);
                flameMaterial.emissiveColor = new Color3(0.8, 0.2 + (i * 0.05), 0.0);
                flameMaterial.alpha = 0.5 - (i * 0.07); // Decreasing opacity for outer rings
                flameRing.material = flameMaterial;
                
                // Add a pulse animation with different timing
                const pulseAnimation = new Animation(
                    `flameRingPulse${i}`,
                    'scaling',
                    30,
                    Animation.ANIMATIONTYPE_VECTOR3,
                    Animation.ANIMATIONLOOPMODE_CYCLE
                );
                
                // Create keyframes with an offset
                const frames = 30;
                const offset = i * 3;
                const keys = [];
                keys.push({
                    frame: 0 + offset, 
                    value: new Vector3(1.0, 1.0, 1.0)
                });
                keys.push({
                    frame: frames/2 + offset, 
                    value: new Vector3(1.1 + (i * 0.05), 1.1 + (i * 0.05), 1.1 + (i * 0.05))
                });
                keys.push({
                    frame: frames + offset, 
                    value: new Vector3(1.0, 1.0, 1.0)
                });
                
                pulseAnimation.setKeys(keys);
                flameRing.animations = [pulseAnimation];
                this.scene.beginAnimation(flameRing, 0, frames, true);
                
                // Add rotation animation
                const rotateAnimation = new Animation(
                    `flameRingRotate${i}`,
                    'rotation.y',
                    30,
                    Animation.ANIMATIONTYPE_FLOAT,
                    Animation.ANIMATIONLOOPMODE_CYCLE
                );
                
                // Create rotation keyframes (alternating directions)
                const rotateKeys = [];
                const direction = i % 2 === 0 ? 1 : -1;
                rotateKeys.push({ frame: 0, value: 0 });
                rotateKeys.push({ frame: 120, value: direction * Math.PI * 2 });
                
                rotateAnimation.setKeys(rotateKeys);
                flameRing.animations.push(rotateAnimation);
                this.scene.beginAnimation(flameRing, 0, 120, true);
            }
        } catch (error) {
            console.error("Error creating flame rings:", error);
        }
    }

    /**
     * Create water ripples for the water aura
     */
    private createWaterRipples(count: number): void {
        try {
            for (let i = 0; i < count; i++) {
                // Create expanding ripple rings
                const innerRing = MeshBuilder.CreateTorus(
                    `waterRipple${i}`,
                    {
                        diameter: 1.0,
                        thickness: 0.1,
                        tessellation: 48
                    },
                    this.scene
                );
                
                // Position at the base of the tower
                innerRing.parent = this.mesh;
                innerRing.position.y = 0.05;
                innerRing.rotation.x = Math.PI / 2; // Horizontal
                
                // Create water material
                const rippleMaterial = new StandardMaterial(`rippleMaterial${i}`, this.scene);
                rippleMaterial.diffuseColor = new Color3(0.0, 0.5, 0.9);
                rippleMaterial.emissiveColor = new Color3(0.0, 0.2, 0.5);
                rippleMaterial.specularColor = new Color3(0.4, 0.7, 1.0);
                rippleMaterial.specularPower = 128; // High reflection
                rippleMaterial.alpha = 0.4;
                innerRing.material = rippleMaterial;
                
                // Create an expanding animation
                const expandAnimation = new Animation(
                    `rippleExpand${i}`,
                    'scaling',
                    30,
                    Animation.ANIMATIONTYPE_VECTOR3,
                    Animation.ANIMATIONLOOPMODE_CYCLE
                );
                
                // Animation parameters - timed offset between ripples
                const duration = 90;
                const delay = i * (duration / count);
                const keys = [];
                
                // Start small and expand outward, fading out
                keys.push({
                    frame: 0 + delay,
                    value: new Vector3(0.2, 0.2, 0.2)
                });
                keys.push({
                    frame: duration/2 + delay,
                    value: new Vector3(1.5, 1.5, 1.5)
                });
                keys.push({
                    frame: duration + delay,
                    value: new Vector3(2.5, 2.5, 2.5)
                });
                
                expandAnimation.setKeys(keys);
                
                // Alpha animation to fade out as it expands
                const alphaAnimation = new Animation(
                    `rippleAlpha${i}`,
                    'material.alpha',
                    30,
                    Animation.ANIMATIONTYPE_FLOAT,
                    Animation.ANIMATIONLOOPMODE_CYCLE
                );
                
                // Start opaque and fade out
                const alphaKeys = [];
                alphaKeys.push({ frame: 0 + delay, value: 0.7 });
                alphaKeys.push({ frame: duration/2 + delay, value: 0.3 });
                alphaKeys.push({ frame: duration + delay, value: 0.0 });
                
                alphaAnimation.setKeys(alphaKeys);
                
                innerRing.animations = [expandAnimation, alphaAnimation];
                this.scene.beginAnimation(innerRing, 0, duration, true);
            }
        } catch (error) {
            console.error("Error creating water ripples:", error);
        }
    }

    /**
     * Create wind spirals for the wind aura
     */
    private createWindSpirals(count: number): void {
        try {
            // Create a parent mesh to hold all spiral elements
            const spiralHolder = new Mesh("windSpiralHolder", this.scene);
            spiralHolder.parent = this.mesh;
            spiralHolder.position.y = 0.1;
            
            // Create spiral segments
            for (let i = 0; i < count; i++) {
                // Calculate angle
                const angle = (i / count) * Math.PI * 2;
                const radius = 1.2;
                
                // Create curved path for the spiral
                const points = [];
                const rotations = 1.5; // 1.5 full turns
                const pointCount = 20;
                
                for (let j = 0; j < pointCount; j++) {
                    const pointAngle = angle + (j / pointCount) * Math.PI * 2 * rotations;
                    const pointRadius = radius * (0.5 + j / pointCount);
                    
                    // Add a vertical component for a rising spiral
                    const x = Math.cos(pointAngle) * pointRadius;
                    const z = Math.sin(pointAngle) * pointRadius;
                    const y = j * 0.03; // Small vertical rise
                    
                    points.push(new Vector3(x, y, z));
                }
                
                // Create a spiral using a tube along the path
                const windSpiral = MeshBuilder.CreateTube(
                    `windSpiral${i}`,
                    {
                        path: points,
                        radius: 0.04,
                        tessellation: 8,
                        updatable: true
                    },
                    this.scene
                );
                
                // Make the spiral a child of the holder
                windSpiral.parent = spiralHolder;
                
                // Create wind spiral material
                const spiralMaterial = new StandardMaterial(`spiralMaterial${i}`, this.scene);
                spiralMaterial.diffuseColor = new Color3(0.7, 1.0, 0.7);
                spiralMaterial.emissiveColor = new Color3(0.3, 0.5, 0.3);
                spiralMaterial.alpha = 0.5;
                windSpiral.material = spiralMaterial;
            }
            
            // Animate the entire spiral holder
            const rotateAnimation = new Animation(
                'spiralRotation',
                'rotation.y',
                30,
                Animation.ANIMATIONTYPE_FLOAT,
                Animation.ANIMATIONLOOPMODE_CYCLE
            );
            
            // Create animation keys
            const keys = [];
            keys.push({ frame: 0, value: 0 });
            keys.push({ frame: 120, value: Math.PI * 2 });
            
            rotateAnimation.setKeys(keys);
            spiralHolder.animations = [rotateAnimation];
            this.scene.beginAnimation(spiralHolder, 0, 120, true);
        } catch (error) {
            console.error("Error creating wind spirals:", error);
        }
    }

    /**
     * Create earth crystals for the earth aura
     */
    private createEarthCrystals(count: number): void {
        try {
            // Create crystals jutting from the ground around the tower
            for (let i = 0; i < count; i++) {
                // Calculate position
                const angle = (i / count) * Math.PI * 2;
                const radius = 1.5 + Math.random() * 0.4; // Vary the distance a bit
                
                // Create a crystal with random size
                const crystalSize = 0.2 + Math.random() * 0.2;
                const crystalHeight = 0.3 + Math.random() * 0.3;
                
                const crystal = MeshBuilder.CreatePolyhedron(
                    `earthCrystal${i}`,
                    {
                        type: i % 2 == 0 ? 3 : 2, // Alternate between icosahedron and octahedron
                        size: crystalSize
                    },
                    this.scene
                );
                
                // Position the crystal
                crystal.parent = this.mesh;
                crystal.position.x = Math.cos(angle) * radius;
                crystal.position.z = Math.sin(angle) * radius;
                crystal.position.y = crystalHeight / 2; // Half height
                
                // Scale to make it taller than wide
                crystal.scaling.y = 1.5 + Math.random();
                
                // Rotate randomly
                crystal.rotation.y = Math.random() * Math.PI * 2;
                crystal.rotation.x = (Math.random() - 0.5) * 0.5; // Slight tilt
                
                // Create crystal material with element color
                const crystalMaterial = new StandardMaterial(`crystalMaterial${i}`, this.scene);
                
                // Color variations
                const colorVariation = Math.random() * 0.3;
                const safeElementColor = this.elementColor || new Color3(0.6, 0.4, 0.1);
                
                crystalMaterial.diffuseColor = safeElementColor.scale(0.8 + colorVariation);
                crystalMaterial.emissiveColor = safeElementColor.scale(0.1 + colorVariation * 0.2);
                crystalMaterial.specularColor = new Color3(1.0, 0.8, 0.4);
                crystalMaterial.specularPower = 64;
                
                crystal.material = crystalMaterial;
                
                // Add a subtle pulse animation
                const pulseAnimation = new Animation(
                    `crystalPulse${i}`,
                    'scaling',
                    30,
                    Animation.ANIMATIONTYPE_VECTOR3,
                    Animation.ANIMATIONLOOPMODE_CYCLE
                );
                
                // Random starting scale to desynchronize pulses
                const baseScale = crystal.scaling.clone();
                
                // Create pulse keyframes
                const pulseKeys = [];
                const pulseDuration = 60 + Math.random() * 60; // Random speed
                
                pulseKeys.push({
                    frame: 0,
                    value: baseScale.clone()
                });
                
                // Create a slightly larger scale at the peak
                const peakScale = baseScale.clone();
                peakScale.scaleInPlace(1.0 + Math.random() * 0.1); // 0-10% larger
                
                pulseKeys.push({
                    frame: pulseDuration / 2,
                    value: peakScale
                });
                
                pulseKeys.push({
                    frame: pulseDuration,
                    value: baseScale.clone()
                });
                
                pulseAnimation.setKeys(pulseKeys);
                crystal.animations = [pulseAnimation];
                
                // Start the animation with a random offset
                this.scene.beginAnimation(crystal, Math.random() * pulseDuration, pulseDuration, true);
            }
        } catch (error) {
            console.error("Error creating earth crystals:", error);
        }
    }

    /**
     * Add a pulsing animation to the aura
     */
    private addAuraPulseAnimation(aura: Mesh, minScale: number, maxScale: number, duration: number): void {
        // Create scale animation for x axis
        const scaleXAnimation = new Animation(
            'auraPulseX',
            'scaling.x',
            30,
            Animation.ANIMATIONTYPE_FLOAT,
            Animation.ANIMATIONLOOPMODE_CYCLE
        );
        
        // Create scale animation for z axis
        const scaleZAnimation = new Animation(
            'auraPulseZ',
            'scaling.z',
            30,
            Animation.ANIMATIONTYPE_FLOAT,
            Animation.ANIMATIONLOOPMODE_CYCLE
        );
        
        // Calculate frames based on duration
        const frames = duration * 30; // 30 fps
        
        // Set up keyframes
        const keys = [];
        keys.push({ frame: 0, value: minScale });
        keys.push({ frame: frames / 2, value: maxScale });
        keys.push({ frame: frames, value: minScale });
        
        // Apply keyframes to animations
        scaleXAnimation.setKeys(keys);
        scaleZAnimation.setKeys(keys);
        
        // Add animations to the aura
        aura.animations = [scaleXAnimation, scaleZAnimation];
        
        // Begin the animation
        this.scene.beginAnimation(aura, 0, frames, true);
    }

    /**
     * Add a wave animation to the aura (for water)
     */
    private addAuraWaveAnimation(aura: Mesh, minScale: number, maxScale: number, duration: number): void {
        // Create scale animations with offset timing for x and z
        const scaleXAnimation = new Animation(
            'auraWaveX',
            'scaling.x',
            30,
            Animation.ANIMATIONTYPE_FLOAT,
            Animation.ANIMATIONLOOPMODE_CYCLE
        );
        
        const scaleZAnimation = new Animation(
            'auraWaveZ',
            'scaling.z',
            30,
            Animation.ANIMATIONTYPE_FLOAT,
            Animation.ANIMATIONLOOPMODE_CYCLE
        );
        
        // Calculate frames based on duration
        const frames = duration * 30; // 30 fps
        
        // Set up keyframes for X (offset by quarter cycle)
        const keysX = [];
        keysX.push({ frame: 0, value: minScale });
        keysX.push({ frame: frames / 2, value: maxScale });
        keysX.push({ frame: frames, value: minScale });
        
        // Set up keyframes for Z (offset by quarter cycle)
        const keysZ = [];
        keysZ.push({ frame: 0, value: maxScale });
        keysZ.push({ frame: frames / 2, value: minScale });
        keysZ.push({ frame: frames, value: maxScale });
        
        // Apply keyframes to animations
        scaleXAnimation.setKeys(keysX);
        scaleZAnimation.setKeys(keysZ);
        
        // Add animations to the aura
        aura.animations = [scaleXAnimation, scaleZAnimation];
        
        // Begin the animation
        this.scene.beginAnimation(aura, 0, frames, true);
    }

    /**
     * Add a rotation animation to the aura (for wind)
     */
    private addAuraRotationAnimation(aura: Mesh, duration: number): void {
        // Create rotation animation
        const rotationAnimation = new Animation(
            'auraRotation',
            'rotation.y',
            30,
            Animation.ANIMATIONTYPE_FLOAT,
            Animation.ANIMATIONLOOPMODE_CYCLE
        );
        
        // Calculate frames based on duration
        const frames = duration * 30; // 30 fps
        
        // Set up keyframes
        const keys = [];
        keys.push({ frame: 0, value: 0 });
        keys.push({ frame: frames, value: Math.PI * 2 });
        
        // Apply keyframes to animation
        rotationAnimation.setKeys(keys);
        
        // Also add slight scale pulsing
        const scaleAnimation = new Animation(
            'auraScale',
            'scaling.x',
            30,
            Animation.ANIMATIONTYPE_FLOAT,
            Animation.ANIMATIONLOOPMODE_CYCLE
        );
        
        // Set up scale keyframes
        const scaleKeys = [];
        scaleKeys.push({ frame: 0, value: 0.9 });
        scaleKeys.push({ frame: frames / 2, value: 1.1 });
        scaleKeys.push({ frame: frames, value: 0.9 });
        
        // Apply keyframes
        scaleAnimation.setKeys(scaleKeys);
        
        // Set the Y scale to match X
        const scaleYAnimation = new Animation(
            'auraScaleY',
            'scaling.z',
            30,
            Animation.ANIMATIONTYPE_FLOAT,
            Animation.ANIMATIONLOOPMODE_CYCLE
        );
        scaleYAnimation.setKeys(scaleKeys);
        
        // Add animations to the aura
        aura.animations = [rotationAnimation, scaleAnimation, scaleYAnimation];
        
        // Begin the animation
        this.scene.beginAnimation(aura, 0, frames, true);
    }

    /**
     * Add a pulsing scale animation to an element mesh
     * @param mesh The mesh to animate
     * @param index The index of the element (for staggered timing)
     */
    private addPulsingAnimation(mesh: Mesh, index: number): void {
        try {
            // Create scale animation for x axis
            const scaleXAnimation = new Animation(
                `pulseScaleX${index}`,
                'scaling.x',
                30,
                Animation.ANIMATIONTYPE_FLOAT,
                Animation.ANIMATIONLOOPMODE_CYCLE
            );
            
            // Create scale animation for y axis
            const scaleYAnimation = new Animation(
                `pulseScaleY${index}`,
                'scaling.y',
                30,
                Animation.ANIMATIONTYPE_FLOAT,
                Animation.ANIMATIONLOOPMODE_CYCLE
            );
            
            // Create scale animation for z axis
            const scaleZAnimation = new Animation(
                `pulseScaleZ${index}`,
                'scaling.z',
                30,
                Animation.ANIMATIONTYPE_FLOAT,
                Animation.ANIMATIONLOOPMODE_CYCLE
            );
            
            // Set up keyframes with slight offset based on index for varied timing
            const startFrame = index * 5; // Stagger start times
            const keyframes = [];
            keyframes.push({ frame: startFrame, value: 1.0 });
            keyframes.push({ frame: startFrame + 15, value: 1.3 });
            keyframes.push({ frame: startFrame + 30, value: 1.0 });
            
            // Apply keyframes to all animations
            scaleXAnimation.setKeys(keyframes);
            scaleYAnimation.setKeys(keyframes);
            scaleZAnimation.setKeys(keyframes);
            
            // Add animations to the mesh
            mesh.animations = [scaleXAnimation, scaleYAnimation, scaleZAnimation];
            
            // Begin the animation
            this.scene.beginAnimation(mesh, 0, 30, true);
        } catch (error) {
            console.error("Error creating pulsing animation:", error);
        }
    }

    /**
     * Update tower visuals after creation or upgrade
     */
    protected updateVisuals(): void {
        super.updateVisuals();
        
        // Apply elemental color to the tower
        if (this.mesh && this.mesh.material) {
            try {
                const material = this.mesh.material as StandardMaterial;
                // Use safe color
                const safeColor = this.elementColor ? this.elementColor : new Color3(0.7, 0.7, 0.7);
                material.diffuseColor = safeColor;
                material.specularColor = new Color3(0.2, 0.2, 0.2);
            } catch (error) {
                console.error("Error updating tower material:", error);
            }
        }
        
        // Update banner colors if they exist
        if (this.banners && this.banners.length > 0) {
            this.banners.forEach(banner => {
                if (banner && banner.material) {
                    try {
                        const material = banner.material as StandardMaterial;
                        // Use safe color
                        const safeColor = this.elementColor ? this.elementColor : new Color3(0.7, 0.7, 0.7);
                        material.diffuseColor = safeColor;
                    } catch (error) {
                        console.error("Error updating banner material:", error);
                    }
                }
            });
        }
    }

    /**
     * Set projectile colors based on element type
     * @param particleSystem The particle system to set colors for
     */
    protected setProjectileColors(particleSystem: ParticleSystem): void {
        // Override the base method to use our custom colors
        try {
            let color1, color2, colorDead;
            
            switch (this.elementType) {
                case ElementType.FIRE:
                    color1 = new Color3(1, 0.5, 0);
                    color2 = new Color3(1, 0, 0);
                    colorDead = new Color3(0.3, 0, 0);
                    break;
                case ElementType.WATER:
                    color1 = new Color3(0, 0.5, 1);
                    color2 = new Color3(0, 0, 1);
                    colorDead = new Color3(0, 0, 0.3);
                    break;
                case ElementType.WIND:
                    color1 = new Color3(0.7, 1, 0.7);
                    color2 = new Color3(0.5, 0.8, 0.5);
                    colorDead = new Color3(0.2, 0.3, 0.2);
                    break;
                case ElementType.EARTH:
                    color1 = new Color3(0.6, 0.3, 0);
                    color2 = new Color3(0.4, 0.2, 0);
                    colorDead = new Color3(0.2, 0.1, 0);
                    break;
                default:
                    color1 = new Color3(1, 1, 1);
                    color2 = new Color3(0.5, 0.5, 0.5);
                    colorDead = new Color3(0, 0, 0);
                    break;
            }
            
            // Use our safe method to create Color4 objects
            particleSystem.color1 = this.safeColor4(color1, 1.0);
            particleSystem.color2 = this.safeColor4(color2, 1.0);
            particleSystem.colorDead = this.safeColor4(colorDead, 0.0);
        } catch (error) {
            console.error("Error setting projectile colors:", error);
            
            // Fallback to simple white colors if there's an error
            particleSystem.color1 = new Color4(1, 1, 1, 1);
            particleSystem.color2 = new Color4(0.8, 0.8, 0.8, 1);
            particleSystem.colorDead = new Color4(0.5, 0.5, 0.5, 0);
        }
    }

    /**
     * Get the element type of this tower
     */
    public getElementType(): ElementType {
        return this.elementType;
    }

    /**
     * Check if this tower can be combined with another tower
     */
    public canCombineWith(other: Tower): boolean {
        // Different element types can be combined
        return this.elementType !== ElementType.NONE && 
               other.getElementType() !== ElementType.NONE && 
               this.elementType !== other.getElementType();
    }
    
    /**
     * Dispose of all tower resources
     */
    public dispose(): void {
        // Dispose of circling elements
        if (this.circlingEmitter) {
            // Stop all animations
            this.scene.stopAnimation(this.circlingEmitter);
            
            // Find and dispose any aura elements
            if (this.mesh) {
                // Basic aura disc
                const aura = this.mesh.getChildMeshes().find(mesh => mesh.name === 'elementalAura');
                if (aura) {
                    this.scene.stopAnimation(aura);
                    if (aura.material) {
                        aura.material.dispose();
                    }
                    aura.dispose();
                }
                
                // Elemental specific aura elements
                // Fire rings
                const flameRings = this.mesh.getChildMeshes().filter(mesh => mesh.name.startsWith('flameRing'));
                flameRings.forEach(ring => {
                    this.scene.stopAnimation(ring);
                    if (ring.material) {
                        ring.material.dispose();
                    }
                    ring.dispose();
                });
                
                // Water ripples
                const waterRipples = this.mesh.getChildMeshes().filter(mesh => mesh.name.startsWith('waterRipple'));
                waterRipples.forEach(ripple => {
                    this.scene.stopAnimation(ripple);
                    if (ripple.material) {
                        ripple.material.dispose();
                    }
                    ripple.dispose();
                });
                
                // Wind spirals holder
                const spiralHolder = this.mesh.getChildMeshes().find(mesh => mesh.name === 'windSpiralHolder');
                if (spiralHolder) {
                    this.scene.stopAnimation(spiralHolder);
                    // Find all spirals parented to this holder
                    spiralHolder.getChildMeshes().forEach(spiral => {
                        if (spiral.material) {
                            spiral.material.dispose();
                        }
                        spiral.dispose();
                    });
                    spiralHolder.dispose();
                }
                
                // Earth crystals
                const earthCrystals = this.mesh.getChildMeshes().filter(mesh => mesh.name.startsWith('earthCrystal'));
                earthCrystals.forEach(crystal => {
                    this.scene.stopAnimation(crystal);
                    if (crystal.material) {
                        crystal.material.dispose();
                    }
                    crystal.dispose();
                });
            }
            
            // Dispose of all child meshes and their materials
            this.circlingEmitter.getChildMeshes().forEach(mesh => {
                if (mesh.material) {
                    mesh.material.dispose();
                }
                
                // Find and dispose any particle systems using this mesh as emitter
                this.scene.particleSystems.forEach(ps => {
                    if (ps.emitter === mesh) {
                        ps.dispose();
                    }
                });
                
                mesh.dispose();
            });
            
            this.circlingEmitter.dispose();
            this.circlingEmitter = null;
        }
        
        // Banner cleanup removed as we no longer create banners
        /* 
        if (this.banners) {
            this.banners.forEach(banner => {
                if (banner) {
                    if (banner.material) {
                        banner.material.dispose();
                    }
                    banner.dispose();
                }
            });
            this.banners = [];
        }
        
        if (this.flagpole) {
            if (this.flagpole.material) {
                this.flagpole.material.dispose();
            }
            this.flagpole.dispose();
            this.flagpole = null;
        }
        */
        
        if (this.towerTop) {
            if (this.towerTop.material) {
                this.towerTop.material.dispose();
            }
            this.towerTop.dispose();
            this.towerTop = null;
        }
        
        super.dispose();
    }
} 