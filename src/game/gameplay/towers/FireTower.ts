import { Vector3, MeshBuilder, Color3, Mesh, ParticleSystem, Color4, Animation } from '@babylonjs/core';
import { Game } from '../../Game';
import { ElementalTower } from './ElementalTower';
import { ElementType, StatusEffect, EnemyType } from './Tower';
import { Enemy } from '../enemies/Enemy';
import { createLowPolyMaterial, createEmissiveMaterial, makeFlatShaded } from '../../rendering/LowPolyMaterial';
import { PALETTE } from '../../rendering/StyleConstants';

/**
 * Fire Tower - Infernal Brazier with low-poly stylized visuals
 * - Primary Effect: Burning (DoT)
 * - Strong against: Wind, Earth, Plant
 * - Weak against: Water, Ice
 */
export class FireTower extends ElementalTower {
    private flameTorch: Mesh | null = null;
    private flameParticles: ParticleSystem | null = null;
    private emberParticles: ParticleSystem | null = null;

    constructor(game: Game, position: Vector3) {
        const damage = 12;
        const range = 5;
        const fireRate = 1.2;
        const cost = 100;

        super(game, position, range, damage, fireRate, cost, ElementType.FIRE);

        this.secondaryEffectChance = 0.4;
        this.statusEffectDuration = 3;
        this.statusEffectStrength = 0.2;

        this.targetPriorities = [EnemyType.WIND, EnemyType.EARTH, EnemyType.PLANT];
        this.weakAgainst = [EnemyType.WATER, EnemyType.ICE];

        this.updateVisuals();
    }

    protected createMesh(): void {
        this.mesh = new Mesh("fireTowerRoot", this.scene);
        this.mesh.position = this.position.clone();

        // --- 1. Craggy hexagonal base with lava veins ---
        const base = MeshBuilder.CreateCylinder('fireTowerBase', {
            height: 0.7, diameterTop: 2.0, diameterBottom: 2.3, tessellation: 6
        }, this.scene);
        makeFlatShaded(base);
        base.parent = this.mesh;
        base.position.y = 0.35;
        base.material = createLowPolyMaterial('fireBaseMat', PALETTE.ROCK_DARK, this.scene);

        // Lava vein accents on base
        for (let i = 0; i < 3; i++) {
            const angle = (i / 3) * Math.PI * 2;
            const vein = MeshBuilder.CreateBox(`lavaVein${i}`, {
                width: 0.06, height: 0.5, depth: 0.6
            }, this.scene);
            vein.position = new Vector3(Math.sin(angle) * 0.85, 0.35, Math.cos(angle) * 0.85);
            vein.rotation.y = angle;
            vein.material = createEmissiveMaterial(`lavaVeinMat${i}`, PALETTE.TOWER_FIRE_LAVA, 0.6, this.scene);
            vein.parent = this.mesh;
        }

        // --- 2. Tapered volcanic column ---
        const column = MeshBuilder.CreateCylinder('fireTowerColumn', {
            height: 1.8, diameterTop: 1.0, diameterBottom: 1.5, tessellation: 6
        }, this.scene);
        makeFlatShaded(column);
        column.parent = this.mesh;
        column.position.y = 1.6;
        column.material = createLowPolyMaterial('fireColumnMat', new Color3(0.38, 0.20, 0.10), this.scene);

        // --- 3. Bowl rim (torus) ---
        const bowl = MeshBuilder.CreateTorus('fireTowerBowl', {
            diameter: 1.3, thickness: 0.32, tessellation: 8
        }, this.scene);
        makeFlatShaded(bowl);
        bowl.parent = this.mesh;
        bowl.position.y = 2.8;
        bowl.material = createLowPolyMaterial('fireBowlMat', PALETTE.ROCK, this.scene);

        // --- 4. Lava disc (glowing pool inside the bowl) ---
        const lavaDisc = MeshBuilder.CreateDisc('fireTowerLava', {
            radius: 0.55, tessellation: 6
        }, this.scene);
        makeFlatShaded(lavaDisc);
        lavaDisc.parent = this.mesh;
        lavaDisc.position.y = 2.85;
        lavaDisc.rotation.x = -Math.PI / 2;
        lavaDisc.material = createEmissiveMaterial('fireLavaMat', PALETTE.TOWER_FIRE_LAVA, 0.85, this.scene);

        // Lava disc pulse animation
        const lavaPulse = new Animation("lavaPulse", "scaling", 30,
            Animation.ANIMATIONTYPE_VECTOR3, Animation.ANIMATIONLOOPMODE_CYCLE);
        lavaPulse.setKeys([
            { frame: 0, value: new Vector3(1, 1, 1) },
            { frame: 30, value: new Vector3(1.08, 1.08, 1) },
            { frame: 60, value: new Vector3(1, 1, 1) }
        ]);
        lavaDisc.animations = [lavaPulse];
        this.scene.beginAnimation(lavaDisc, 0, 60, true);

        // --- 5. Flame torch (central fire spire) ---
        this.flameTorch = MeshBuilder.CreateCylinder('fireTorch', {
            height: 0.7, diameterTop: 0.12, diameterBottom: 0.35, tessellation: 5
        }, this.scene);
        makeFlatShaded(this.flameTorch);
        this.flameTorch.parent = this.mesh;
        this.flameTorch.position.y = 3.35;
        this.flameTorch.material = createEmissiveMaterial('fireTorchMat', PALETTE.TOWER_FIRE, 0.7, this.scene);

        // --- 6. Orbiting ember fragments ---
        const emberRing = new Mesh("emberRing", this.scene);
        emberRing.position = new Vector3(0, 3.2, 0);
        emberRing.parent = this.mesh;

        for (let i = 0; i < 4; i++) {
            const angle = (i / 4) * Math.PI * 2;
            const ember = MeshBuilder.CreatePolyhedron(`ember${i}`, {
                type: 1, size: 0.08
            }, this.scene);
            ember.position = new Vector3(Math.cos(angle) * 0.5, (i % 2) * 0.15, Math.sin(angle) * 0.5);
            ember.material = createEmissiveMaterial(`emberMat${i}`, new Color3(1, 0.4, 0.05), 0.9, this.scene);
            makeFlatShaded(ember);
            ember.parent = emberRing;
        }

        // Ember orbit animation
        const emberOrbit = new Animation("emberOrbit", "rotation.y", 30,
            Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CYCLE);
        emberOrbit.setKeys([
            { frame: 0, value: 0 },
            { frame: 90, value: Math.PI * 2 }
        ]);
        emberRing.animations = [emberOrbit];
        this.scene.beginAnimation(emberRing, 0, 90, true);

        // --- 7. Top ember cap ---
        const emberCap = MeshBuilder.CreatePolyhedron('fireEmberCap', {
            type: 1, size: 0.15
        }, this.scene);
        makeFlatShaded(emberCap);
        emberCap.parent = this.mesh;
        emberCap.position.y = 3.9;
        emberCap.rotation.y = Math.PI / 4;
        emberCap.material = createEmissiveMaterial('fireEmberMat', new Color3(1, 0.4, 0.05), 0.9, this.scene);

        // Ember cap float animation
        const capFloat = new Animation("capFloat", "position.y", 30,
            Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CYCLE);
        capFloat.setKeys([
            { frame: 0, value: 3.9 },
            { frame: 40, value: 4.05 },
            { frame: 80, value: 3.9 }
        ]);
        emberCap.animations = [capFloat];
        this.scene.beginAnimation(emberCap, 0, 80, true);

        // --- 8. Flame particles ---
        this.createFlameEffect();

        // --- 9. Ambient ember sparkle particles ---
        this.emberParticles = new ParticleSystem("emberSparkle", 10, this.scene);
        this.emberParticles.emitter = new Vector3(this.position.x, this.position.y + 3.2, this.position.z);
        this.emberParticles.minEmitBox = new Vector3(-0.3, 0, -0.3);
        this.emberParticles.maxEmitBox = new Vector3(0.3, 0.3, 0.3);
        this.emberParticles.color1 = new Color4(1, 0.5, 0.1, 0.9);
        this.emberParticles.color2 = new Color4(1, 0.3, 0, 0.7);
        this.emberParticles.colorDead = new Color4(0.5, 0.1, 0, 0);
        this.emberParticles.minSize = 0.03;
        this.emberParticles.maxSize = 0.08;
        this.emberParticles.minLifeTime = 0.5;
        this.emberParticles.maxLifeTime = 1.2;
        this.emberParticles.emitRate = 6;
        this.emberParticles.direction1 = new Vector3(-0.3, 0.5, -0.3);
        this.emberParticles.direction2 = new Vector3(0.3, 1.0, 0.3);
        this.emberParticles.minEmitPower = 0.2;
        this.emberParticles.maxEmitPower = 0.5;
        this.emberParticles.blendMode = ParticleSystem.BLENDMODE_ONEONE;
        this.emberParticles.updateSpeed = 0.01;
        this.emberParticles.start();
    }

    private createFlameEffect(): void {
        if (!this.flameTorch) return;

        this.flameParticles = new ParticleSystem("flameParticles", 40, this.scene);
        this.flameParticles.emitter = new Vector3(
            this.position.x,
            this.position.y + 3.3,
            this.position.z
        );

        this.flameParticles.minSize = 0.4;
        this.flameParticles.maxSize = 1.0;
        this.flameParticles.minLifeTime = 0.3;
        this.flameParticles.maxLifeTime = 1.0;
        this.flameParticles.emitRate = 25;

        this.flameParticles.color1 = new Color4(1, 0.5, 0, 1.0);
        this.flameParticles.color2 = new Color4(1, 0.2, 0, 1.0);
        this.flameParticles.colorDead = new Color4(0.5, 0, 0, 0.0);

        this.flameParticles.direction1 = new Vector3(-0.2, 1, -0.2);
        this.flameParticles.direction2 = new Vector3(0.2, 1, 0.2);
        this.flameParticles.minEmitPower = 0.5;
        this.flameParticles.maxEmitPower = 2;
        this.flameParticles.updateSpeed = 0.01;

        this.flameParticles.start();
    }

    protected applyPrimaryEffect(enemy: Enemy): void {
        this.applyStatusEffect(enemy, StatusEffect.BURNING, this.statusEffectDuration, this.statusEffectStrength);
    }

    protected applySecondaryEffect(enemy: Enemy): void {
        this.applyStatusEffect(enemy, StatusEffect.BURNING, 1.5, this.statusEffectStrength * 2);
    }

    public dispose(): void {
        if (this.flameParticles) {
            this.flameParticles.dispose();
        }
        if (this.emberParticles) {
            this.emberParticles.dispose();
        }
        super.dispose();
    }
}
