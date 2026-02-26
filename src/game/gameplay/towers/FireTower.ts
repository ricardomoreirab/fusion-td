import { Vector3, MeshBuilder, Color3, Mesh, ParticleSystem, Color4 } from '@babylonjs/core';
import { Game } from '../../Game';
import { ElementalTower } from './ElementalTower';
import { ElementType, StatusEffect, EnemyType } from './Tower';
import { Enemy } from '../enemies/Enemy';
import { createLowPolyMaterial, createEmissiveMaterial, makeFlatShaded } from '../../rendering/LowPolyMaterial';
import { PALETTE } from '../../rendering/StyleConstants';

/**
 * Fire Tower - Volcanic brazier with low-poly stylized visuals
 * - Primary Effect: Burning (DoT)
 * - Strong against: Wind, Earth, Plant
 * - Weak against: Water, Ice
 */
export class FireTower extends ElementalTower {
    private flameTorch: Mesh | null = null;
    private flameParticles: ParticleSystem | null = null;

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
     * Create the tower mesh - Volcanic brazier
     * Rocky hex base -> stubby column -> bowl (torus) -> lava disc
     */
    protected createMesh(): void {
        // Create root mesh for the fire tower
        this.mesh = new Mesh("fireTowerRoot", this.scene);
        this.mesh.position = this.position.clone();

        // --- 1. Rocky hexagonal base ---
        const base = MeshBuilder.CreateCylinder(
            'fireTowerBase',
            {
                height: 0.8,
                diameterTop: 2.0,
                diameterBottom: 2.3,
                tessellation: 6
            },
            this.scene
        );
        makeFlatShaded(base);
        base.parent = this.mesh;
        base.position.y = 0.4;
        base.material = createLowPolyMaterial('fireBaseMat', PALETTE.ROCK_DARK, this.scene);

        // --- 2. Stubby column ---
        const column = MeshBuilder.CreateCylinder(
            'fireTowerColumn',
            {
                height: 2.0,
                diameterTop: 1.1,
                diameterBottom: 1.6,
                tessellation: 6
            },
            this.scene
        );
        makeFlatShaded(column);
        column.parent = this.mesh;
        column.position.y = 1.8;
        column.material = createLowPolyMaterial('fireColumnMat', new Color3(0.4, 0.22, 0.12), this.scene);

        // --- 3. Bowl rim (torus) ---
        const bowl = MeshBuilder.CreateTorus(
            'fireTowerBowl',
            {
                diameter: 1.4,
                thickness: 0.35,
                tessellation: 8
            },
            this.scene
        );
        makeFlatShaded(bowl);
        bowl.parent = this.mesh;
        bowl.position.y = 3.1;
        bowl.material = createLowPolyMaterial('fireBowlMat', PALETTE.ROCK, this.scene);

        // --- 4. Lava disc ---
        const lavaDisc = MeshBuilder.CreateDisc(
            'fireTowerLava',
            {
                radius: 0.6,
                tessellation: 6
            },
            this.scene
        );
        makeFlatShaded(lavaDisc);
        lavaDisc.parent = this.mesh;
        lavaDisc.position.y = 3.15;
        lavaDisc.rotation.x = -Math.PI / 2; // lay flat
        lavaDisc.material = createEmissiveMaterial('fireLavaMat', PALETTE.TOWER_FIRE_LAVA, 0.8, this.scene);

        // --- 5. Flame torch (central pillar) ---
        this.flameTorch = MeshBuilder.CreateCylinder(
            'fireTorch',
            {
                height: 0.8,
                diameterTop: 0.15,
                diameterBottom: 0.4,
                tessellation: 5
            },
            this.scene
        );
        makeFlatShaded(this.flameTorch);
        this.flameTorch.parent = this.mesh;
        this.flameTorch.position.y = 3.7;
        this.flameTorch.material = createEmissiveMaterial('fireTorchMat', PALETTE.TOWER_FIRE, 0.6, this.scene);

        // --- 6. Ember cap (small polyhedron at top for visual interest) ---
        const emberCap = MeshBuilder.CreatePolyhedron(
            'fireEmberCap',
            {
                type: 1, // octahedron
                size: 0.18
            },
            this.scene
        );
        makeFlatShaded(emberCap);
        emberCap.parent = this.mesh;
        emberCap.position.y = 4.3;
        emberCap.rotation.y = Math.PI / 4;
        emberCap.material = createEmissiveMaterial('fireEmberMat', new Color3(1, 0.4, 0.05), 0.9, this.scene);

        // Add flame particle effect
        this.createFlameEffect();
    }

    /**
     * Create flame particle effect for the tower
     * Reduced from 100 to 40 particles, size increased 2x
     */
    private createFlameEffect(): void {
        if (!this.flameTorch) return;

        // Create particle system for flames
        this.flameParticles = new ParticleSystem("flameParticles", 40, this.scene);
        this.flameParticles.emitter = new Vector3(
            this.position.x,
            this.position.y + 3.5,
            this.position.z
        );

        // Particles configuration - larger particles, fewer count
        this.flameParticles.minSize = 0.4;
        this.flameParticles.maxSize = 1.0;
        this.flameParticles.minLifeTime = 0.3;
        this.flameParticles.maxLifeTime = 1.0;
        this.flameParticles.emitRate = 25;

        // Define direct colors
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

        super.dispose();
    }
}
