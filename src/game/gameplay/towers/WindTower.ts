import { Vector3, MeshBuilder, Color3, Mesh, ParticleSystem, Color4, Animation } from '@babylonjs/core';
import { Game } from '../../Game';
import { ElementalTower } from './ElementalTower';
import { ElementType, StatusEffect, EnemyType } from './Tower';
import { Enemy } from '../enemies/Enemy';
import { createLowPolyMaterial, createEmissiveMaterial, makeFlatShaded } from '../../rendering/LowPolyMaterial';
import { PALETTE } from '../../rendering/StyleConstants';

/**
 * Wind Tower - Spinning windmill with low-poly stylized visuals
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
     * Create the tower mesh - Spinning windmill
     * Small base -> tall thin pentagon column -> hub + 3 triangle blades
     */
    protected createMesh(): void {
        // Create root mesh for the wind tower
        this.mesh = new Mesh("windTowerRoot", this.scene);
        this.mesh.position = this.position.clone();

        // --- 1. Small pentagonal base ---
        const base = MeshBuilder.CreateCylinder(
            'windTowerBase',
            {
                height: 0.6,
                diameterTop: 1.6,
                diameterBottom: 1.9,
                tessellation: 5
            },
            this.scene
        );
        makeFlatShaded(base);
        base.parent = this.mesh;
        base.position.y = 0.3;
        base.material = createLowPolyMaterial('windBaseMat', PALETTE.ROCK, this.scene);

        // --- 2. Base cap (thin disc on top of base for visual transition) ---
        const baseCap = MeshBuilder.CreateCylinder(
            'windTowerBaseCap',
            {
                height: 0.15,
                diameterTop: 1.3,
                diameterBottom: 1.5,
                tessellation: 5
            },
            this.scene
        );
        makeFlatShaded(baseCap);
        baseCap.parent = this.mesh;
        baseCap.position.y = 0.7;
        baseCap.material = createLowPolyMaterial('windBaseCapMat', PALETTE.ROCK_DARK, this.scene);

        // --- 3. Tall thin pentagon column ---
        const column = MeshBuilder.CreateCylinder(
            'windTowerColumn',
            {
                height: 3.2,
                diameterTop: 0.6,
                diameterBottom: 1.1,
                tessellation: 5
            },
            this.scene
        );
        makeFlatShaded(column);
        column.parent = this.mesh;
        column.position.y = 2.3;
        column.material = createLowPolyMaterial('windColumnMat', PALETTE.TOWER_WIND, this.scene);

        // --- 4. Platform ring at top ---
        const platform = MeshBuilder.CreateCylinder(
            'windTowerPlatform',
            {
                height: 0.15,
                diameterTop: 0.9,
                diameterBottom: 0.7,
                tessellation: 5
            },
            this.scene
        );
        makeFlatShaded(platform);
        platform.parent = this.mesh;
        platform.position.y = 3.95;
        platform.material = createLowPolyMaterial('windPlatformMat', new Color3(0.50, 0.72, 0.52), this.scene);

        // --- 5. Hub (small sphere) ---
        const hub = MeshBuilder.CreateSphere(
            'windmillHub',
            {
                diameter: 0.35,
                segments: 4
            },
            this.scene
        );
        makeFlatShaded(hub);
        hub.parent = this.mesh;
        hub.position.y = 4.3;
        hub.material = createLowPolyMaterial('windHubMat', PALETTE.TOWER_WIND_BLADE, this.scene);

        // Store reference for rotation
        this.windmill = hub;

        // --- 6, 7, 8. Three triangle blades ---
        for (let i = 0; i < 3; i++) {
            const angle = (i / 3) * Math.PI * 2;

            // Create a triangular blade using a thin box
            const blade = MeshBuilder.CreateBox(
                `windBlade${i}`,
                {
                    width: 0.08,
                    height: 1.2,
                    depth: 0.35
                },
                this.scene
            );
            makeFlatShaded(blade);

            // Position blade extending outward from hub
            blade.parent = hub;
            blade.position.x = Math.sin(angle) * 0.6;
            blade.position.z = Math.cos(angle) * 0.6;
            blade.rotation.y = angle + Math.PI / 2;
            blade.material = createLowPolyMaterial(`windBladeMat${i}`, PALETTE.TOWER_WIND_BLADE, this.scene);
        }

        // Create blade rotation animation
        const frameRate = 30;
        const rotateAnimation = new Animation(
            "windmillRotation",
            "rotation.y",
            frameRate,
            Animation.ANIMATIONTYPE_FLOAT,
            Animation.ANIMATIONLOOPMODE_CYCLE
        );
        const keys = [
            { frame: 0, value: 0 },
            { frame: 60, value: Math.PI * 2 }
        ];
        rotateAnimation.setKeys(keys);
        hub.animations = [rotateAnimation];
        this.scene.beginAnimation(hub, 0, 60, true);

        // Add wind particle effect
        this.createWindEffect();
    }

    /**
     * Create wind particle effect for the tower
     * Reduced from 200 to 50 particles, size increased 2x
     */
    private createWindEffect(): void {
        this.windParticles = new ParticleSystem("windParticles", 50, this.scene);
        this.windParticles.emitter = new Vector3(
            this.position.x,
            this.position.y + 4.0,
            this.position.z
        );

        // Particles configuration - larger, fewer
        this.windParticles.minSize = 0.16;
        this.windParticles.maxSize = 0.50;
        this.windParticles.minLifeTime = 0.5;
        this.windParticles.maxLifeTime = 2.0;
        this.windParticles.emitRate = 30;

        // Define direct colors
        this.windParticles.color1 = new Color4(0.7, 1.0, 0.7, 0.7);
        this.windParticles.color2 = new Color4(0.8, 1.0, 0.8, 0.7);
        this.windParticles.colorDead = new Color4(1.0, 1.0, 1.0, 0.0);

        // Direction and behavior - swirling wind
        this.windParticles.direction1 = new Vector3(-1.5, 0.1, -1.5);
        this.windParticles.direction2 = new Vector3(1.5, 0.5, 1.5);
        this.windParticles.minEmitPower = 1.5;
        this.windParticles.maxEmitPower = 3.5;
        this.windParticles.updateSpeed = 0.015;

        // Swirling effect
        this.windParticles.minAngularSpeed = 2.0;
        this.windParticles.maxAngularSpeed = 4.0;

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
            this.windmill.rotation.y += deltaTime * 1.5;
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
