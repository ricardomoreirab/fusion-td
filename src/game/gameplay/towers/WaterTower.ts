import { Vector3, MeshBuilder, Color3, Mesh, ParticleSystem, Color4, Animation } from '@babylonjs/core';
import { Game } from '../../Game';
import { ElementalTower } from './ElementalTower';
import { ElementType, StatusEffect, EnemyType } from './Tower';
import { Enemy } from '../enemies/Enemy';
import { createLowPolyMaterial, createEmissiveMaterial, makeFlatShaded } from '../../rendering/LowPolyMaterial';
import { PALETTE } from '../../rendering/StyleConstants';

/**
 * Water Tower - Crystal Aqua Shrine with low-poly stylized visuals
 * - Primary Effect: Slowed movement
 * - Secondary Effect: Chance to freeze
 * - Strong against: Fire, Earth
 * - Weak against: Wind, Electric
 */
export class WaterTower extends ElementalTower {
    private waterFountain: Mesh | null = null;
    private waterParticles: ParticleSystem | null = null;
    private dripParticles: ParticleSystem | null = null;

    constructor(game: Game, position: Vector3) {
        const damage = 8;
        const range = 6;
        const fireRate = 1.5;
        const cost = 100;

        super(game, position, range, damage, fireRate, cost, ElementType.WATER);

        this.secondaryEffectChance = 0.25;
        this.statusEffectDuration = 2.5;
        this.statusEffectStrength = 0.4;

        this.targetPriorities = [EnemyType.FIRE, EnemyType.EARTH];
        this.weakAgainst = [EnemyType.WIND, EnemyType.ELECTRIC];

        this.updateVisuals();
    }

    protected createMesh(): void {
        this.mesh = new Mesh("waterTowerRoot", this.scene);
        this.mesh.position = this.position.clone();

        // --- 1. Smooth circular base ---
        const base = MeshBuilder.CreateCylinder('waterTowerBase', {
            height: 0.7, diameterTop: 2.0, diameterBottom: 2.3, tessellation: 8
        }, this.scene);
        makeFlatShaded(base);
        base.parent = this.mesh;
        base.position.y = 0.35;
        base.material = createLowPolyMaterial('waterBaseMat', PALETTE.ROCK, this.scene);

        // Decorative water-line ring
        const waterLine = MeshBuilder.CreateTorus('waterLine', {
            diameter: 2.1, thickness: 0.06, tessellation: 8
        }, this.scene);
        waterLine.position = new Vector3(0, 0.72, 0);
        waterLine.material = createEmissiveMaterial('waterLineMat', PALETTE.TOWER_WATER, 0.4, this.scene);
        makeFlatShaded(waterLine);
        waterLine.parent = this.mesh;

        // --- 2. Hexagonal prism column ---
        const column = MeshBuilder.CreateCylinder('waterTowerColumn', {
            height: 2.0, diameterTop: 1.1, diameterBottom: 1.5, tessellation: 6
        }, this.scene);
        makeFlatShaded(column);
        column.parent = this.mesh;
        column.position.y = 1.7;
        column.material = createLowPolyMaterial('waterColumnMat', new Color3(0.25, 0.35, 0.50), this.scene);

        // --- 3. Basin ring ---
        const basin = MeshBuilder.CreateTorus('waterTowerBasin', {
            diameter: 1.4, thickness: 0.32, tessellation: 8
        }, this.scene);
        makeFlatShaded(basin);
        basin.parent = this.mesh;
        basin.position.y = 2.95;
        basin.material = createLowPolyMaterial('waterBasinMat', PALETTE.ROCK_DARK, this.scene);

        // --- 4. Water surface (translucent disc) ---
        const waterDisc = MeshBuilder.CreateDisc('waterTowerDisc', {
            radius: 0.6, tessellation: 8
        }, this.scene);
        makeFlatShaded(waterDisc);
        waterDisc.parent = this.mesh;
        waterDisc.position.y = 3.0;
        waterDisc.rotation.x = -Math.PI / 2;
        const waterDiscMat = createEmissiveMaterial('waterDiscMat', PALETTE.TOWER_WATER, 0.5, this.scene);
        waterDiscMat.alpha = 0.7;
        waterDisc.material = waterDiscMat;

        // Water surface ripple (scale animation)
        const rippleAnim = new Animation("waterRipple", "scaling", 30,
            Animation.ANIMATIONTYPE_VECTOR3, Animation.ANIMATIONLOOPMODE_CYCLE);
        rippleAnim.setKeys([
            { frame: 0, value: new Vector3(1, 1, 1) },
            { frame: 40, value: new Vector3(1.06, 1.06, 1) },
            { frame: 80, value: new Vector3(1, 1, 1) }
        ]);
        waterDisc.animations = [rippleAnim];
        this.scene.beginAnimation(waterDisc, 0, 80, true);

        // --- 5. Central fountain spire ---
        this.waterFountain = MeshBuilder.CreateCylinder('waterFountain', {
            height: 0.9, diameterTop: 0.05, diameterBottom: 0.28, tessellation: 6
        }, this.scene);
        makeFlatShaded(this.waterFountain);
        this.waterFountain.parent = this.mesh;
        this.waterFountain.position.y = 3.5;
        this.waterFountain.material = createEmissiveMaterial('waterFountainMat', PALETTE.TOWER_WATER_CRYSTAL, 0.4, this.scene);

        // --- 6. Floating water crystal orbiting the spire ---
        const crystalRing = new Mesh("waterCrystalRing", this.scene);
        crystalRing.position = new Vector3(0, 3.6, 0);
        crystalRing.parent = this.mesh;

        for (let i = 0; i < 3; i++) {
            const angle = (i / 3) * Math.PI * 2;
            const crystal = MeshBuilder.CreatePolyhedron(`waterCrystal${i}`, {
                type: 2, size: 0.1
            }, this.scene);
            crystal.position = new Vector3(Math.cos(angle) * 0.4, 0, Math.sin(angle) * 0.4);
            crystal.material = createEmissiveMaterial(`waterCrystalMat${i}`, PALETTE.TOWER_WATER_CRYSTAL, 0.6, this.scene);
            makeFlatShaded(crystal);
            crystal.parent = crystalRing;
        }

        // Crystal orbit animation
        const crystalOrbit = new Animation("waterCrystalOrbit", "rotation.y", 30,
            Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CYCLE);
        crystalOrbit.setKeys([
            { frame: 0, value: 0 },
            { frame: 150, value: Math.PI * 2 }
        ]);
        crystalRing.animations = [crystalOrbit];
        this.scene.beginAnimation(crystalRing, 0, 150, true);

        // --- 7. Crystal cap at top ---
        const crystalCap = MeshBuilder.CreatePolyhedron('waterCrystalCap', {
            type: 2, size: 0.14
        }, this.scene);
        makeFlatShaded(crystalCap);
        crystalCap.parent = this.mesh;
        crystalCap.position.y = 4.2;
        crystalCap.material = createEmissiveMaterial('waterCrystalCapMat', PALETTE.TOWER_WATER_CRYSTAL, 0.7, this.scene);

        // Crystal cap float
        const capFloat = new Animation("waterCapFloat", "position.y", 30,
            Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CYCLE);
        capFloat.setKeys([
            { frame: 0, value: 4.2 },
            { frame: 50, value: 4.35 },
            { frame: 100, value: 4.2 }
        ]);
        crystalCap.animations = [capFloat];
        this.scene.beginAnimation(crystalCap, 0, 100, true);

        // --- 8. Water fountain particles ---
        this.createWaterEffect();

        // --- 9. Dripping water particles from basin ---
        this.dripParticles = new ParticleSystem("waterDrip", 8, this.scene);
        this.dripParticles.emitter = new Vector3(this.position.x, this.position.y + 2.9, this.position.z);
        this.dripParticles.minEmitBox = new Vector3(-0.5, 0, -0.5);
        this.dripParticles.maxEmitBox = new Vector3(0.5, 0, 0.5);
        this.dripParticles.color1 = new Color4(0.3, 0.5, 0.9, 0.6);
        this.dripParticles.color2 = new Color4(0.2, 0.4, 0.8, 0.4);
        this.dripParticles.colorDead = new Color4(0.1, 0.2, 0.5, 0);
        this.dripParticles.minSize = 0.04;
        this.dripParticles.maxSize = 0.1;
        this.dripParticles.minLifeTime = 0.5;
        this.dripParticles.maxLifeTime = 1.0;
        this.dripParticles.emitRate = 4;
        this.dripParticles.direction1 = new Vector3(0, -1, 0);
        this.dripParticles.direction2 = new Vector3(0, -1, 0);
        this.dripParticles.gravity = new Vector3(0, -9.8, 0);
        this.dripParticles.minEmitPower = 0.1;
        this.dripParticles.maxEmitPower = 0.2;
        this.dripParticles.updateSpeed = 0.01;
        this.dripParticles.start();
    }

    private createWaterEffect(): void {
        if (!this.waterFountain) return;

        this.waterParticles = new ParticleSystem("waterParticles", 60, this.scene);
        this.waterParticles.emitter = new Vector3(
            this.position.x,
            this.position.y + 3.8,
            this.position.z
        );

        this.waterParticles.minSize = 0.1;
        this.waterParticles.maxSize = 0.3;
        this.waterParticles.minLifeTime = 1.0;
        this.waterParticles.maxLifeTime = 2.0;
        this.waterParticles.emitRate = 30;

        this.waterParticles.color1 = new Color4(0.4, 0.6, 1.0, 0.8);
        this.waterParticles.color2 = new Color4(0.2, 0.4, 0.8, 0.8);
        this.waterParticles.colorDead = new Color4(0.1, 0.2, 0.5, 0.0);

        this.waterParticles.direction1 = new Vector3(-0.5, 3, -0.5);
        this.waterParticles.direction2 = new Vector3(0.5, 3, 0.5);
        this.waterParticles.minEmitPower = 0.5;
        this.waterParticles.maxEmitPower = 1.0;
        this.waterParticles.updateSpeed = 0.01;
        this.waterParticles.gravity = new Vector3(0, -9.8, 0);

        this.waterParticles.start();
    }

    protected applyPrimaryEffect(enemy: Enemy): void {
        this.applyStatusEffect(enemy, StatusEffect.SLOWED, this.statusEffectDuration, this.statusEffectStrength);
    }

    protected applySecondaryEffect(enemy: Enemy): void {
        this.applyStatusEffect(enemy, StatusEffect.FROZEN, 1.0, 1.0);
    }

    public dispose(): void {
        if (this.waterParticles) {
            this.waterParticles.dispose();
        }
        if (this.dripParticles) {
            this.dripParticles.dispose();
        }
        super.dispose();
    }
}
