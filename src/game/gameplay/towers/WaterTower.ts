import { Vector3, MeshBuilder, Color3, Mesh, ParticleSystem, Color4 } from '@babylonjs/core';
import { Game } from '../../Game';
import { ElementalTower } from './ElementalTower';
import { ElementType, StatusEffect, EnemyType } from './Tower';
import { Enemy } from '../enemies/Enemy';
import { createLowPolyMaterial, createEmissiveMaterial, makeFlatShaded } from '../../rendering/LowPolyMaterial';
import { PALETTE } from '../../rendering/StyleConstants';

/**
 * Water Tower - Crystal fountain with low-poly stylized visuals
 * - Primary Effect: Slowed movement
 * - Secondary Effect: Chance to freeze
 * - Strong against: Fire, Earth
 * - Weak against: Wind, Electric
 */
export class WaterTower extends ElementalTower {
    private waterFountain: Mesh | null = null;
    private waterParticles: ParticleSystem | null = null;

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
     * Create the tower mesh - Crystal fountain
     * Circular base -> hexagonal prism -> basin ring (torus) -> water disc
     */
    protected createMesh(): void {
        // Create root mesh for the water tower
        this.mesh = new Mesh("waterTowerRoot", this.scene);
        this.mesh.position = this.position.clone();

        // --- 1. Circular base ---
        const base = MeshBuilder.CreateCylinder(
            'waterTowerBase',
            {
                height: 0.8,
                diameterTop: 2.0,
                diameterBottom: 2.3,
                tessellation: 8
            },
            this.scene
        );
        makeFlatShaded(base);
        base.parent = this.mesh;
        base.position.y = 0.4;
        base.material = createLowPolyMaterial('waterBaseMat', PALETTE.ROCK, this.scene);

        // --- 2. Hexagonal prism column ---
        const column = MeshBuilder.CreateCylinder(
            'waterTowerColumn',
            {
                height: 2.2,
                diameterTop: 1.2,
                diameterBottom: 1.6,
                tessellation: 6
            },
            this.scene
        );
        makeFlatShaded(column);
        column.parent = this.mesh;
        column.position.y = 1.9;
        column.material = createLowPolyMaterial('waterColumnMat', new Color3(0.25, 0.35, 0.50), this.scene);

        // --- 3. Basin ring (torus) ---
        const basin = MeshBuilder.CreateTorus(
            'waterTowerBasin',
            {
                diameter: 1.5,
                thickness: 0.35,
                tessellation: 8
            },
            this.scene
        );
        makeFlatShaded(basin);
        basin.parent = this.mesh;
        basin.position.y = 3.2;
        basin.material = createLowPolyMaterial('waterBasinMat', PALETTE.ROCK_DARK, this.scene);

        // --- 4. Water disc ---
        const waterDisc = MeshBuilder.CreateDisc(
            'waterTowerDisc',
            {
                radius: 0.65,
                tessellation: 8
            },
            this.scene
        );
        makeFlatShaded(waterDisc);
        waterDisc.parent = this.mesh;
        waterDisc.position.y = 3.25;
        waterDisc.rotation.x = -Math.PI / 2; // lay flat
        const waterDiscMat = createEmissiveMaterial('waterDiscMat', PALETTE.TOWER_WATER, 0.5, this.scene);
        waterDiscMat.alpha = 0.75;
        waterDisc.material = waterDiscMat;

        // --- 5. Fountain spout (central spire) ---
        this.waterFountain = MeshBuilder.CreateCylinder(
            'waterFountain',
            {
                height: 1.0,
                diameterTop: 0.05,
                diameterBottom: 0.3,
                tessellation: 6
            },
            this.scene
        );
        makeFlatShaded(this.waterFountain);
        this.waterFountain.parent = this.mesh;
        this.waterFountain.position.y = 3.8;
        this.waterFountain.material = createEmissiveMaterial('waterFountainMat', PALETTE.TOWER_WATER_CRYSTAL, 0.4, this.scene);

        // --- 6. Crystal cap (polyhedron at top) ---
        const crystalCap = MeshBuilder.CreatePolyhedron(
            'waterCrystalCap',
            {
                type: 2, // icosahedron
                size: 0.15
            },
            this.scene
        );
        makeFlatShaded(crystalCap);
        crystalCap.parent = this.mesh;
        crystalCap.position.y = 4.5;
        crystalCap.material = createEmissiveMaterial('waterCrystalCapMat', PALETTE.TOWER_WATER_CRYSTAL, 0.6, this.scene);

        // Add water particle effect
        this.createWaterEffect();
    }

    /**
     * Create water particle effect for the tower
     * Reduced from 200 to 60 particles, size increased 2x
     */
    private createWaterEffect(): void {
        if (!this.waterFountain) return;

        // Create particle system for water fountain
        this.waterParticles = new ParticleSystem("waterParticles", 60, this.scene);
        this.waterParticles.emitter = new Vector3(
            this.position.x,
            this.position.y + 4.1,
            this.position.z
        );

        // Particles configuration - larger, fewer
        this.waterParticles.minSize = 0.1;
        this.waterParticles.maxSize = 0.3;
        this.waterParticles.minLifeTime = 1.0;
        this.waterParticles.maxLifeTime = 2.0;
        this.waterParticles.emitRate = 30;

        // Define direct colors
        this.waterParticles.color1 = new Color4(0.4, 0.6, 1.0, 0.8);
        this.waterParticles.color2 = new Color4(0.2, 0.4, 0.8, 0.8);
        this.waterParticles.colorDead = new Color4(0.1, 0.2, 0.5, 0.0);

        // Direction and behavior - fountain-like
        this.waterParticles.direction1 = new Vector3(-0.5, 3, -0.5);
        this.waterParticles.direction2 = new Vector3(0.5, 3, 0.5);
        this.waterParticles.minEmitPower = 0.5;
        this.waterParticles.maxEmitPower = 1.0;
        this.waterParticles.updateSpeed = 0.01;
        this.waterParticles.gravity = new Vector3(0, -9.8, 0);

        // Start the water effect
        this.waterParticles.start();
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

        super.dispose();
    }
}
