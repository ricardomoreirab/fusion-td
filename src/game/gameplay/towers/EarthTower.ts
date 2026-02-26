import { Vector3, MeshBuilder, Color3, Mesh, ParticleSystem, Color4, Animation } from '@babylonjs/core';
import { Game } from '../../Game';
import { ElementalTower } from './ElementalTower';
import { ElementType, StatusEffect, EnemyType } from './Tower';
import { Enemy } from '../enemies/Enemy';
import { createLowPolyMaterial, createEmissiveMaterial, makeFlatShaded } from '../../rendering/LowPolyMaterial';
import { PALETTE } from '../../rendering/StyleConstants';

/**
 * Earth Tower - Ancient Stone Dolmen with low-poly stylized visuals
 * - Primary Effect: High damage to ground units
 * - Secondary Effect: Chance to confuse
 * - Strong against: Wind, Electric, Heavy
 * - Weak against: Fire, Water
 */
export class EarthTower extends ElementalTower {
    private earthParticles: ParticleSystem | null = null;
    private rockFormation: Mesh | null = null;
    private floatingCrystal: Mesh | null = null;

    constructor(game: Game, position: Vector3) {
        const damage = 15;
        const range = 4;
        const fireRate = 0.8;
        const cost = 100;

        super(game, position, range, damage, fireRate, cost, ElementType.EARTH);

        this.secondaryEffectChance = 0.15;
        this.statusEffectDuration = 2.0;
        this.statusEffectStrength = 0.7;

        this.targetPriorities = [EnemyType.WIND, EnemyType.ELECTRIC, EnemyType.HEAVY];
        this.weakAgainst = [EnemyType.FIRE, EnemyType.WATER];
        this.canTargetFlying = false;

        this.updateVisuals();
    }

    protected createMesh(): void {
        try {
            this.mesh = new Mesh("earthTowerRoot", this.scene);
            this.mesh.position = this.position.clone();

            // --- 1. Rough hexagonal base with embedded rocks ---
            const base = MeshBuilder.CreateCylinder('earthTowerBase', {
                height: 0.7, diameterTop: 2.2, diameterBottom: 2.5, tessellation: 6
            }, this.scene);
            makeFlatShaded(base);
            base.parent = this.mesh;
            base.position.y = 0.35;
            base.material = createLowPolyMaterial('earthBaseMat', PALETTE.TOWER_EARTH, this.scene);

            // Embedded accent rocks on base
            const accentPositions = [
                new Vector3(0.8, 0.5, 0.5),
                new Vector3(-0.7, 0.45, 0.6),
                new Vector3(0.3, 0.48, -0.8),
                new Vector3(-0.6, 0.42, -0.5)
            ];
            for (let i = 0; i < accentPositions.length; i++) {
                const rock = MeshBuilder.CreatePolyhedron(`earthAccent${i}`, {
                    type: 1, size: 0.15 + Math.random() * 0.08
                }, this.scene);
                makeFlatShaded(rock);
                rock.parent = this.mesh;
                rock.position = accentPositions[i];
                rock.rotation.y = i * 1.3;
                rock.material = createLowPolyMaterial(`earthAccentMat${i}`, PALETTE.ROCK, this.scene);
            }

            // --- 2. Left standing stone ---
            const slabLeft = MeshBuilder.CreateBox('earthSlabLeft', {
                width: 0.38, height: 2.6, depth: 0.7
            }, this.scene);
            makeFlatShaded(slabLeft);
            slabLeft.parent = this.mesh;
            slabLeft.position.set(-0.5, 2.0, 0);
            slabLeft.rotation.y = 0.15;
            slabLeft.material = createLowPolyMaterial('earthSlabLeftMat', PALETTE.ROCK_DARK, this.scene);

            // --- 3. Right standing stone ---
            const slabRight = MeshBuilder.CreateBox('earthSlabRight', {
                width: 0.38, height: 2.4, depth: 0.65
            }, this.scene);
            makeFlatShaded(slabRight);
            slabRight.parent = this.mesh;
            slabRight.position.set(0.5, 1.9, 0);
            slabRight.rotation.y = -0.12;
            slabRight.material = createLowPolyMaterial('earthSlabRightMat', PALETTE.ROCK, this.scene);

            // --- 4. Back standing stone (shorter) ---
            const slabBack = MeshBuilder.CreateBox('earthSlabBack', {
                width: 0.32, height: 2.0, depth: 0.55
            }, this.scene);
            makeFlatShaded(slabBack);
            slabBack.parent = this.mesh;
            slabBack.position.set(0, 1.7, -0.45);
            slabBack.rotation.y = 0.3;
            slabBack.material = createLowPolyMaterial('earthSlabBackMat', new Color3(0.50, 0.46, 0.42), this.scene);

            // --- 5. Emissive rune carvings on the slabs ---
            const runePositions = [
                { pos: new Vector3(-0.31, 2.3, 0.05), ry: 0.15 },
                { pos: new Vector3(0.69, 2.1, 0.05), ry: -0.12 },
                { pos: new Vector3(0.0, 2.0, -0.25), ry: 0.3 }
            ];
            for (let i = 0; i < runePositions.length; i++) {
                const rune = MeshBuilder.CreateBox(`rune${i}`, {
                    width: 0.15, height: 0.8, depth: 0.02
                }, this.scene);
                rune.position = runePositions[i].pos;
                rune.rotation.y = runePositions[i].ry;
                rune.material = createEmissiveMaterial(`runeMat${i}`, PALETTE.TOWER_EARTH_CRYSTAL, 0.5, this.scene);
                rune.parent = this.mesh;
            }

            // --- 6. Capstone (horizontal slab on top) ---
            const capstone = MeshBuilder.CreateBox('earthCapstone', {
                width: 1.5, height: 0.28, depth: 1.1
            }, this.scene);
            makeFlatShaded(capstone);
            capstone.parent = this.mesh;
            capstone.position.y = 3.5;
            capstone.rotation.y = 0.1;
            capstone.material = createLowPolyMaterial('earthCapstoneMat', PALETTE.ROCK_DARK, this.scene);

            // --- 7. Orbiting rock debris ring ---
            const debrisRing = new Mesh("debrisRing", this.scene);
            debrisRing.position = new Vector3(0, 3.3, 0);
            debrisRing.parent = this.mesh;

            for (let i = 0; i < 5; i++) {
                const angle = (i / 5) * Math.PI * 2;
                const debris = MeshBuilder.CreatePolyhedron(`debris${i}`, {
                    type: i % 2 === 0 ? 1 : 0, size: 0.06 + Math.random() * 0.04
                }, this.scene);
                debris.position = new Vector3(Math.cos(angle) * 0.7, (i % 3) * 0.08, Math.sin(angle) * 0.7);
                debris.rotation.set(Math.random(), Math.random(), Math.random());
                debris.material = createLowPolyMaterial(`debrisMat${i}`, PALETTE.ROCK, this.scene);
                makeFlatShaded(debris);
                debris.parent = debrisRing;
            }

            // Debris orbit animation
            const debrisOrbit = new Animation("debrisOrbit", "rotation.y", 30,
                Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CYCLE);
            debrisOrbit.setKeys([
                { frame: 0, value: 0 },
                { frame: 180, value: Math.PI * 2 }
            ]);
            debrisRing.animations = [debrisOrbit];
            this.scene.beginAnimation(debrisRing, 0, 180, true);

            // --- 8. Central rock formation under capstone ---
            this.rockFormation = MeshBuilder.CreateCylinder('earthRockFormation', {
                height: 0.5, diameterTop: 0.25, diameterBottom: 0.6, tessellation: 5
            }, this.scene);
            makeFlatShaded(this.rockFormation);
            this.rockFormation.parent = this.mesh;
            this.rockFormation.position.y = 3.3;
            this.rockFormation.material = createLowPolyMaterial('earthRockFormMat', PALETTE.TOWER_EARTH, this.scene);

            // --- 9. Floating rune crystal ---
            this.floatingCrystal = MeshBuilder.CreatePolyhedron('earthFloatingCrystal', {
                type: 3, size: 0.2
            }, this.scene);
            makeFlatShaded(this.floatingCrystal);
            this.floatingCrystal.parent = this.mesh;
            this.floatingCrystal.position.y = 4.1;
            this.floatingCrystal.rotation.x = Math.PI / 6;
            this.floatingCrystal.material = createEmissiveMaterial('earthCrystalMat', PALETTE.TOWER_EARTH_CRYSTAL, 0.6, this.scene);

            // Float animation
            const floatAnim = new Animation("earthCrystalFloat", "position.y", 30,
                Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CYCLE);
            floatAnim.setKeys([
                { frame: 0, value: 4.1 },
                { frame: 45, value: 4.3 },
                { frame: 90, value: 4.1 },
                { frame: 135, value: 3.9 },
                { frame: 180, value: 4.1 }
            ]);

            // Spin animation
            const spinAnim = new Animation("earthCrystalSpin", "rotation.y", 30,
                Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CYCLE);
            spinAnim.setKeys([
                { frame: 0, value: 0 },
                { frame: 180, value: Math.PI * 2 }
            ]);

            this.floatingCrystal.animations = [floatAnim, spinAnim];
            this.scene.beginAnimation(this.floatingCrystal, 0, 180, true);

            // --- 10. Earth particle effect ---
            this.createEarthEffect();
        } catch (error) {
            console.error("Error creating Earth Tower mesh:", error);
        }
    }

    private createEarthEffect(): void {
        if (!this.rockFormation) return;

        try {
            this.earthParticles = new ParticleSystem("earthParticles", 20, this.scene);
            this.earthParticles.emitter = new Vector3(
                this.position.x,
                this.position.y + 3.5,
                this.position.z
            );

            this.earthParticles.minSize = 0.1;
            this.earthParticles.maxSize = 0.3;
            this.earthParticles.minLifeTime = 1.0;
            this.earthParticles.maxLifeTime = 2.0;
            this.earthParticles.emitRate = 8;

            this.earthParticles.color1 = new Color4(0.6, 0.4, 0.2, 1.0);
            this.earthParticles.color2 = new Color4(0.5, 0.3, 0.1, 1.0);
            this.earthParticles.colorDead = new Color4(0.3, 0.2, 0.1, 0.0);

            this.earthParticles.direction1 = new Vector3(-0.5, -1, -0.5);
            this.earthParticles.direction2 = new Vector3(0.5, -0.2, 0.5);
            this.earthParticles.minEmitPower = 0.2;
            this.earthParticles.maxEmitPower = 0.5;
            this.earthParticles.updateSpeed = 0.01;
            this.earthParticles.gravity = new Vector3(0, -9.8, 0);

            this.earthParticles.start();
        } catch (error) {
            console.error("Error creating earth effect:", error);
        }
    }

    protected applyPrimaryEffect(enemy: Enemy): void {
        if (enemy.getEnemyType() !== EnemyType.FLYING) {
            this.applyStatusEffect(enemy, StatusEffect.STUNNED, 0.3, 1.0);
        }
    }

    protected applySecondaryEffect(enemy: Enemy): void {
        this.applyStatusEffect(enemy, StatusEffect.CONFUSED, this.statusEffectDuration, this.statusEffectStrength);
    }

    protected calculateDamage(enemy: Enemy): number {
        let damage = super.calculateDamage(enemy);
        if (enemy.getEnemyType() !== EnemyType.FLYING) {
            damage *= 1.5;
        }
        return damage;
    }

    public dispose(): void {
        if (this.earthParticles) {
            this.earthParticles.dispose();
        }
        if (this.floatingCrystal) {
            this.scene.stopAnimation(this.floatingCrystal);
            this.floatingCrystal = null;
        }
        super.dispose();
    }
}
