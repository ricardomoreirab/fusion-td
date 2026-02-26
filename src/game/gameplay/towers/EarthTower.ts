import { Vector3, MeshBuilder, Color3, Mesh, ParticleSystem, Color4, Animation } from '@babylonjs/core';
import { Game } from '../../Game';
import { ElementalTower } from './ElementalTower';
import { ElementType, StatusEffect, EnemyType } from './Tower';
import { Enemy } from '../enemies/Enemy';
import { createLowPolyMaterial, createEmissiveMaterial, makeFlatShaded } from '../../rendering/LowPolyMaterial';
import { PALETTE } from '../../rendering/StyleConstants';

/**
 * Earth Tower - Stone dolmen with low-poly stylized visuals
 * - Primary Effect: High damage to ground units
 * - Secondary Effect: Chance to confuse
 * - Strong against: Wind, Electric, Heavy
 * - Weak against: Fire, Water
 */
export class EarthTower extends ElementalTower {
    private earthParticles: ParticleSystem | null = null;
    private rockFormation: Mesh | null = null;
    private floatingCrystal: Mesh | null = null;

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
     * Create the tower mesh - Stone dolmen
     * Rough base -> 2-3 standing stone slabs -> capstone -> floating crystal
     */
    protected createMesh(): void {
        try {
            // Create root mesh for the earth tower
            this.mesh = new Mesh("earthTowerRoot", this.scene);
            this.mesh.position = this.position.clone();

            // --- 1. Rough hexagonal base ---
            const base = MeshBuilder.CreateCylinder(
                'earthTowerBase',
                {
                    height: 0.8,
                    diameterTop: 2.2,
                    diameterBottom: 2.5,
                    tessellation: 6
                },
                this.scene
            );
            makeFlatShaded(base);
            base.parent = this.mesh;
            base.position.y = 0.4;
            base.material = createLowPolyMaterial('earthBaseMat', PALETTE.TOWER_EARTH, this.scene);

            // --- 2. Standing stone slab LEFT ---
            const slabLeft = MeshBuilder.CreateBox(
                'earthSlabLeft',
                {
                    width: 0.4,
                    height: 2.8,
                    depth: 0.8
                },
                this.scene
            );
            makeFlatShaded(slabLeft);
            slabLeft.parent = this.mesh;
            slabLeft.position.set(-0.5, 2.2, 0);
            slabLeft.rotation.y = 0.15; // slight twist
            slabLeft.material = createLowPolyMaterial('earthSlabLeftMat', PALETTE.ROCK_DARK, this.scene);

            // --- 3. Standing stone slab RIGHT ---
            const slabRight = MeshBuilder.CreateBox(
                'earthSlabRight',
                {
                    width: 0.4,
                    height: 2.6,
                    depth: 0.7
                },
                this.scene
            );
            makeFlatShaded(slabRight);
            slabRight.parent = this.mesh;
            slabRight.position.set(0.5, 2.1, 0);
            slabRight.rotation.y = -0.12;
            slabRight.material = createLowPolyMaterial('earthSlabRightMat', PALETTE.ROCK, this.scene);

            // --- 4. Standing stone slab BACK (shorter) ---
            const slabBack = MeshBuilder.CreateBox(
                'earthSlabBack',
                {
                    width: 0.35,
                    height: 2.2,
                    depth: 0.6
                },
                this.scene
            );
            makeFlatShaded(slabBack);
            slabBack.parent = this.mesh;
            slabBack.position.set(0, 1.9, -0.45);
            slabBack.rotation.y = 0.3;
            slabBack.material = createLowPolyMaterial('earthSlabBackMat', new Color3(0.50, 0.46, 0.42), this.scene);

            // --- 5. Capstone (horizontal slab on top) ---
            const capstone = MeshBuilder.CreateBox(
                'earthCapstone',
                {
                    width: 1.6,
                    height: 0.3,
                    depth: 1.2
                },
                this.scene
            );
            makeFlatShaded(capstone);
            capstone.parent = this.mesh;
            capstone.position.y = 3.7;
            capstone.rotation.y = 0.1; // slight rotation for organic feel
            capstone.material = createLowPolyMaterial('earthCapstoneMat', PALETTE.ROCK_DARK, this.scene);

            // --- 6. Rock formation (central tapered pillar under capstone) ---
            this.rockFormation = MeshBuilder.CreateCylinder(
                'earthRockFormation',
                {
                    height: 0.6,
                    diameterTop: 0.3,
                    diameterBottom: 0.7,
                    tessellation: 5
                },
                this.scene
            );
            makeFlatShaded(this.rockFormation);
            this.rockFormation.parent = this.mesh;
            this.rockFormation.position.y = 3.5;
            this.rockFormation.material = createLowPolyMaterial('earthRockFormMat', PALETTE.TOWER_EARTH, this.scene);

            // --- 7. Small accent rock on base ---
            const accentRock = MeshBuilder.CreatePolyhedron(
                'earthAccentRock',
                {
                    type: 1, // octahedron
                    size: 0.25
                },
                this.scene
            );
            makeFlatShaded(accentRock);
            accentRock.parent = this.mesh;
            accentRock.position.set(0.8, 0.7, 0.6);
            accentRock.rotation.y = 0.7;
            accentRock.material = createLowPolyMaterial('earthAccentMat', PALETTE.ROCK, this.scene);

            // --- 8. Floating crystal (polyhedron at top) ---
            this.floatingCrystal = MeshBuilder.CreatePolyhedron(
                'earthFloatingCrystal',
                {
                    type: 3, // diamond
                    size: 0.22
                },
                this.scene
            );
            makeFlatShaded(this.floatingCrystal);
            this.floatingCrystal.parent = this.mesh;
            this.floatingCrystal.position.y = 4.3;
            this.floatingCrystal.rotation.x = Math.PI / 6;
            this.floatingCrystal.material = createEmissiveMaterial('earthCrystalMat', PALETTE.TOWER_EARTH_CRYSTAL, 0.5, this.scene);

            // Add floating animation to the crystal
            const frameRate = 30;
            const floatAnim = new Animation(
                "earthCrystalFloat",
                "position.y",
                frameRate,
                Animation.ANIMATIONTYPE_FLOAT,
                Animation.ANIMATIONLOOPMODE_CYCLE
            );
            const floatKeys = [
                { frame: 0, value: 4.3 },
                { frame: 45, value: 4.5 },
                { frame: 90, value: 4.3 },
                { frame: 135, value: 4.1 },
                { frame: 180, value: 4.3 }
            ];
            floatAnim.setKeys(floatKeys);

            const spinAnim = new Animation(
                "earthCrystalSpin",
                "rotation.y",
                frameRate,
                Animation.ANIMATIONTYPE_FLOAT,
                Animation.ANIMATIONLOOPMODE_CYCLE
            );
            const spinKeys = [
                { frame: 0, value: 0 },
                { frame: 180, value: Math.PI * 2 }
            ];
            spinAnim.setKeys(spinKeys);

            this.floatingCrystal.animations = [floatAnim, spinAnim];
            this.scene.beginAnimation(this.floatingCrystal, 0, 180, true);

            // Add earth particle effect
            this.createEarthEffect();
        } catch (error) {
            console.error("Error creating Earth Tower mesh:", error);
        }
    }

    /**
     * Create earth particle effect for the tower
     * Reduced from 50 to 20 particles, size increased 2x
     */
    private createEarthEffect(): void {
        if (!this.rockFormation) return;

        try {
            // Create particle system for earth debris
            this.earthParticles = new ParticleSystem("earthParticles", 20, this.scene);
            this.earthParticles.emitter = new Vector3(
                this.position.x,
                this.position.y + 3.5,
                this.position.z
            );

            // Particles configuration - larger, fewer
            this.earthParticles.minSize = 0.1;
            this.earthParticles.maxSize = 0.3;
            this.earthParticles.minLifeTime = 1.0;
            this.earthParticles.maxLifeTime = 2.0;
            this.earthParticles.emitRate = 8;

            // Define direct colors
            this.earthParticles.color1 = new Color4(0.6, 0.4, 0.2, 1.0);
            this.earthParticles.color2 = new Color4(0.5, 0.3, 0.1, 1.0);
            this.earthParticles.colorDead = new Color4(0.3, 0.2, 0.1, 0.0);

            // Direction and behavior - falling debris and dust
            this.earthParticles.direction1 = new Vector3(-0.5, -1, -0.5);
            this.earthParticles.direction2 = new Vector3(0.5, -0.2, 0.5);
            this.earthParticles.minEmitPower = 0.2;
            this.earthParticles.maxEmitPower = 0.5;
            this.earthParticles.updateSpeed = 0.01;
            this.earthParticles.gravity = new Vector3(0, -9.8, 0);

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

        // Clean up floating crystal animation
        if (this.floatingCrystal) {
            this.scene.stopAnimation(this.floatingCrystal);
            this.floatingCrystal = null;
        }

        super.dispose();
    }
}
