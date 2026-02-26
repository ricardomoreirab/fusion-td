import { Vector3, MeshBuilder, Color3, Mesh, ParticleSystem, Color4, Animation } from '@babylonjs/core';
import { Game } from '../../Game';
import { ElementalTower } from './ElementalTower';
import { ElementType, StatusEffect, EnemyType } from './Tower';
import { Enemy } from '../enemies/Enemy';
import { createLowPolyMaterial, createEmissiveMaterial, makeFlatShaded } from '../../rendering/LowPolyMaterial';
import { PALETTE } from '../../rendering/StyleConstants';

/**
 * Wind Tower - Enchanted Aerie with low-poly stylized visuals
 * - Primary Effect: Push enemies back
 * - Secondary Effect: Chance to stun
 * - Strong against: Water, Flying
 * - Weak against: Earth, Heavy
 */
export class WindTower extends ElementalTower {
    private windParticles: ParticleSystem | null = null;
    private windmill: Mesh | null = null;
    private upperBlades: Mesh | null = null;

    constructor(game: Game, position: Vector3) {
        const damage = 6;
        const range = 7;
        const fireRate = 2.0;
        const cost = 100;

        super(game, position, range, damage, fireRate, cost, ElementType.WIND);

        this.secondaryEffectChance = 0.2;
        this.statusEffectDuration = 1.0;
        this.statusEffectStrength = 0.5;

        this.targetPriorities = [EnemyType.WATER, EnemyType.FLYING, EnemyType.LIGHT];
        this.weakAgainst = [EnemyType.EARTH, EnemyType.HEAVY];

        this.updateVisuals();
    }

    protected createMesh(): void {
        this.mesh = new Mesh("windTowerRoot", this.scene);
        this.mesh.position = this.position.clone();

        // --- 1. Pentagonal base ---
        const base = MeshBuilder.CreateCylinder('windTowerBase', {
            height: 0.55, diameterTop: 1.6, diameterBottom: 1.9, tessellation: 5
        }, this.scene);
        makeFlatShaded(base);
        base.parent = this.mesh;
        base.position.y = 0.275;
        base.material = createLowPolyMaterial('windBaseMat', PALETTE.ROCK, this.scene);

        // Base cap
        const baseCap = MeshBuilder.CreateCylinder('windTowerBaseCap', {
            height: 0.12, diameterTop: 1.3, diameterBottom: 1.5, tessellation: 5
        }, this.scene);
        makeFlatShaded(baseCap);
        baseCap.parent = this.mesh;
        baseCap.position.y = 0.62;
        baseCap.material = createLowPolyMaterial('windBaseCapMat', PALETTE.ROCK_DARK, this.scene);

        // --- 2. Elegant tapered column ---
        const column = MeshBuilder.CreateCylinder('windTowerColumn', {
            height: 3.0, diameterTop: 0.5, diameterBottom: 1.0, tessellation: 5
        }, this.scene);
        makeFlatShaded(column);
        column.parent = this.mesh;
        column.position.y = 2.2;
        column.material = createLowPolyMaterial('windColumnMat', PALETTE.TOWER_WIND, this.scene);

        // Spiral accent strips along column
        for (let i = 0; i < 3; i++) {
            const stripAngle = (i / 3) * Math.PI * 2;
            const strip = MeshBuilder.CreateBox(`windStrip${i}`, {
                width: 0.04, height: 2.6, depth: 0.04
            }, this.scene);
            strip.position = new Vector3(
                Math.sin(stripAngle) * 0.3,
                2.2,
                Math.cos(stripAngle) * 0.3
            );
            strip.material = createEmissiveMaterial(`windStripMat${i}`, PALETTE.TOWER_WIND_BLADE, 0.3, this.scene);
            strip.parent = this.mesh;
        }

        // --- 3. Platform ring at top ---
        const platform = MeshBuilder.CreateCylinder('windTowerPlatform', {
            height: 0.12, diameterTop: 0.8, diameterBottom: 0.65, tessellation: 5
        }, this.scene);
        makeFlatShaded(platform);
        platform.parent = this.mesh;
        platform.position.y = 3.8;
        platform.material = createLowPolyMaterial('windPlatformMat', new Color3(0.50, 0.72, 0.52), this.scene);

        // --- 4. Lower blade set (3 large blades) ---
        this.windmill = new Mesh("windmillLower", this.scene);
        this.windmill.position = new Vector3(0, 4.1, 0);
        this.windmill.parent = this.mesh;

        // Hub sphere
        const hub = MeshBuilder.CreateSphere('windmillHub', {
            diameter: 0.3, segments: 4
        }, this.scene);
        makeFlatShaded(hub);
        hub.material = createLowPolyMaterial('windHubMat', PALETTE.TOWER_WIND_BLADE, this.scene);
        hub.parent = this.windmill;

        // 3 large blades
        for (let i = 0; i < 3; i++) {
            const angle = (i / 3) * Math.PI * 2;
            const blade = MeshBuilder.CreateBox(`windBlade${i}`, {
                width: 0.08, height: 1.1, depth: 0.3
            }, this.scene);
            makeFlatShaded(blade);
            blade.parent = this.windmill;
            blade.position.x = Math.sin(angle) * 0.55;
            blade.position.z = Math.cos(angle) * 0.55;
            blade.rotation.y = angle + Math.PI / 2;
            blade.material = createLowPolyMaterial(`windBladeMat${i}`, PALETTE.TOWER_WIND_BLADE, this.scene);
        }

        // Lower blade rotation
        const lowerSpin = new Animation("windmillLowerSpin", "rotation.y", 30,
            Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CYCLE);
        lowerSpin.setKeys([
            { frame: 0, value: 0 },
            { frame: 60, value: Math.PI * 2 }
        ]);
        this.windmill.animations = [lowerSpin];
        this.scene.beginAnimation(this.windmill, 0, 60, true);

        // --- 5. Upper blade set (4 smaller blades, counter-rotating) ---
        this.upperBlades = new Mesh("windmillUpper", this.scene);
        this.upperBlades.position = new Vector3(0, 4.5, 0);
        this.upperBlades.parent = this.mesh;

        const upperHub = MeshBuilder.CreateSphere('upperHub', {
            diameter: 0.2, segments: 4
        }, this.scene);
        makeFlatShaded(upperHub);
        upperHub.material = createEmissiveMaterial('upperHubMat', PALETTE.TOWER_WIND, 0.4, this.scene);
        upperHub.parent = this.upperBlades;

        for (let i = 0; i < 4; i++) {
            const angle = (i / 4) * Math.PI * 2;
            const smallBlade = MeshBuilder.CreateBox(`smallBlade${i}`, {
                width: 0.06, height: 0.7, depth: 0.2
            }, this.scene);
            makeFlatShaded(smallBlade);
            smallBlade.parent = this.upperBlades;
            smallBlade.position.x = Math.sin(angle) * 0.35;
            smallBlade.position.z = Math.cos(angle) * 0.35;
            smallBlade.rotation.y = angle + Math.PI / 2;
            smallBlade.material = createEmissiveMaterial(`smallBladeMat${i}`, PALETTE.TOWER_WIND_BLADE, 0.2, this.scene);
        }

        // Upper blade counter-rotation (faster)
        const upperSpin = new Animation("windmillUpperSpin", "rotation.y", 30,
            Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CYCLE);
        upperSpin.setKeys([
            { frame: 0, value: 0 },
            { frame: 40, value: -Math.PI * 2 }
        ]);
        this.upperBlades.animations = [upperSpin];
        this.scene.beginAnimation(this.upperBlades, 0, 40, true);

        // --- 6. Wind particle effect ---
        this.createWindEffect();
    }

    private createWindEffect(): void {
        this.windParticles = new ParticleSystem("windParticles", 50, this.scene);
        this.windParticles.emitter = new Vector3(
            this.position.x,
            this.position.y + 4.0,
            this.position.z
        );

        this.windParticles.minSize = 0.16;
        this.windParticles.maxSize = 0.50;
        this.windParticles.minLifeTime = 0.5;
        this.windParticles.maxLifeTime = 2.0;
        this.windParticles.emitRate = 30;

        this.windParticles.color1 = new Color4(0.7, 1.0, 0.7, 0.7);
        this.windParticles.color2 = new Color4(0.8, 1.0, 0.8, 0.7);
        this.windParticles.colorDead = new Color4(1.0, 1.0, 1.0, 0.0);

        this.windParticles.direction1 = new Vector3(-1.5, 0.1, -1.5);
        this.windParticles.direction2 = new Vector3(1.5, 0.5, 1.5);
        this.windParticles.minEmitPower = 1.5;
        this.windParticles.maxEmitPower = 3.5;
        this.windParticles.updateSpeed = 0.015;

        this.windParticles.minAngularSpeed = 2.0;
        this.windParticles.maxAngularSpeed = 4.0;

        this.windParticles.addVelocityGradient(0, 0.5);
        this.windParticles.addVelocityGradient(0.1, 1.0);
        this.windParticles.addVelocityGradient(0.7, 1.0);
        this.windParticles.addVelocityGradient(1.0, 0.5);

        this.windParticles.start();
    }

    public update(deltaTime: number): void {
        super.update(deltaTime);

        // Manual rotation backup for windmill (in case animation system lags)
        if (this.windmill) {
            this.windmill.rotation.y += deltaTime * 1.5;
        }
        if (this.upperBlades) {
            this.upperBlades.rotation.y -= deltaTime * 2.5;
        }
    }

    protected applyPrimaryEffect(enemy: Enemy): void {
        this.applyStatusEffect(enemy, StatusEffect.PUSHED, this.statusEffectDuration, this.statusEffectStrength);
    }

    protected applySecondaryEffect(enemy: Enemy): void {
        this.applyStatusEffect(enemy, StatusEffect.STUNNED, 0.5, 1.0);
    }

    public dispose(): void {
        if (this.windParticles) {
            this.windParticles.dispose();
        }
        super.dispose();
    }
}
