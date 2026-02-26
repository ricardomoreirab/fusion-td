import { Vector3, MeshBuilder, Color3, ParticleSystem, LinesMesh, Color4, Mesh, Animation } from '@babylonjs/core';
import { Game } from '../../../Game';
import { Tower, ElementType, StatusEffect, EnemyType } from '../Tower';
import { Enemy } from '../../enemies/Enemy';
import { createLowPolyMaterial, createEmissiveMaterial, makeFlatShaded } from '../../../rendering/LowPolyMaterial';
import { PALETTE } from '../../../rendering/StyleConstants';

/**
 * Storm Tower - Combines Wind and Fire elements
 * Lightning conductor spire with storm orb and orbiting thunderclouds
 */
export class StormTower extends Tower {
    private stormParticles: ParticleSystem | null = null;
    private maxChainTargets: number = 3;
    private chainDistance: number = 4;
    private chainDamageReduction: number = 0.7;
    private lightningBolts: LinesMesh[] = [];
    private stormOrb: Mesh | null = null;
    private cloudRing: Mesh | null = null;

    constructor(game: Game, position: Vector3) {
        const damage = 12;
        const range = 7;
        const fireRate = 1.5;
        const cost = 275;

        super(game, position, range, damage, fireRate, cost);

        this.secondaryEffectChance = 0.4;
        this.statusEffectDuration = 1;
        this.statusEffectStrength = 1.0;
        this.targetPriorities = [EnemyType.WATER, EnemyType.FLYING, EnemyType.ELECTRIC];
        this.weakAgainst = [EnemyType.EARTH];

        this.createMesh();
    }

    protected createMesh(): void {
        try {
            this.mesh = new Mesh("stormTowerRoot", this.scene);
            this.mesh.position = this.position.clone();

            // --- 1. Dark stone base (wind heritage) ---
            const base = MeshBuilder.CreateCylinder('stormBase', {
                height: 0.6, diameterTop: 1.6, diameterBottom: 1.9, tessellation: 8
            }, this.scene);
            makeFlatShaded(base);
            base.parent = this.mesh;
            base.position.y = 0.3;
            base.material = createLowPolyMaterial('stormBaseMat', PALETTE.TOWER_STORM_DARK, this.scene);

            // Electric trim ring
            const elecTrim = MeshBuilder.CreateTorus('elecTrim', {
                diameter: 1.7, thickness: 0.05, tessellation: 8
            }, this.scene);
            makeFlatShaded(elecTrim);
            elecTrim.parent = this.mesh;
            elecTrim.position.y = 0.62;
            elecTrim.material = createEmissiveMaterial('elecTrimMat', PALETTE.TOWER_STORM_LIGHTNING, 0.5, this.scene);

            // --- 2. Tower body with angular segments ---
            const body = MeshBuilder.CreateCylinder('stormBody', {
                height: 2.2, diameterTop: 0.8, diameterBottom: 1.2, tessellation: 8
            }, this.scene);
            makeFlatShaded(body);
            body.parent = this.mesh;
            body.position.y = 1.7;
            body.material = createLowPolyMaterial('stormBodyMat', PALETTE.TOWER_STORM_DARK, this.scene);

            // Lightning rod channels (fire heritage glow)
            for (let i = 0; i < 4; i++) {
                const angle = (i / 4) * Math.PI * 2;
                const channel = MeshBuilder.CreateBox(`stormChannel${i}`, {
                    width: 0.04, height: 1.8, depth: 0.04
                }, this.scene);
                channel.position = new Vector3(Math.sin(angle) * 0.45, 1.7, Math.cos(angle) * 0.45);
                channel.material = createEmissiveMaterial(`stormChannelMat${i}`, PALETTE.TOWER_STORM_LIGHTNING, 0.4, this.scene);
                channel.parent = this.mesh;
            }

            // --- 3. Lightning rods at top ---
            for (let i = 0; i < 4; i++) {
                const angle = (i / 4) * Math.PI * 2;
                const rod = MeshBuilder.CreateCylinder(`lightningRod${i}`, {
                    height: 0.7, diameter: 0.05, tessellation: 4
                }, this.scene);
                makeFlatShaded(rod);
                rod.parent = this.mesh;
                rod.position.x = Math.sin(angle) * 0.5;
                rod.position.z = Math.cos(angle) * 0.5;
                rod.position.y = 3.15;
                rod.material = createLowPolyMaterial(`rodMat${i}`, PALETTE.TOWER_STORM_DARK, this.scene);

                // Spark tip
                const tip = MeshBuilder.CreateIcoSphere(`rodTip${i}`, {
                    radius: 0.04, subdivisions: 0
                }, this.scene);
                tip.parent = this.mesh;
                tip.position.x = Math.sin(angle) * 0.5;
                tip.position.z = Math.cos(angle) * 0.5;
                tip.position.y = 3.5;
                tip.material = createEmissiveMaterial(`rodTipMat${i}`, PALETTE.TOWER_STORM_LIGHTNING, 0.8, this.scene);
            }

            // --- 4. Storm orb (central glowing sphere) ---
            this.stormOrb = MeshBuilder.CreateIcoSphere('stormOrb', {
                radius: 0.3, subdivisions: 1
            }, this.scene);
            makeFlatShaded(this.stormOrb);
            this.stormOrb.parent = this.mesh;
            this.stormOrb.position.y = 3.0;
            const orbMat = createEmissiveMaterial('stormOrbMat', PALETTE.TOWER_STORM_ORB, 0.8, this.scene);
            orbMat.alpha = 0.8;
            this.stormOrb.material = orbMat;

            // Orb pulse
            const orbPulse = new Animation("stormOrbPulse", "scaling", 20,
                Animation.ANIMATIONTYPE_VECTOR3, Animation.ANIMATIONLOOPMODE_CYCLE);
            orbPulse.setKeys([
                { frame: 0, value: new Vector3(1, 1, 1) },
                { frame: 10, value: new Vector3(1.2, 1.2, 1.2) },
                { frame: 20, value: new Vector3(1, 1, 1) }
            ]);
            this.stormOrb.animations = [orbPulse];
            this.scene.beginAnimation(this.stormOrb, 0, 20, true);

            // --- 5. Tall conductor spire ---
            const spire = MeshBuilder.CreateCylinder('stormSpire', {
                height: 1.8, diameterTop: 0.03, diameterBottom: 0.3, tessellation: 6
            }, this.scene);
            makeFlatShaded(spire);
            spire.parent = this.mesh;
            spire.position.y = 3.7;
            spire.material = createLowPolyMaterial('stormSpireMat', PALETTE.TOWER_STORM_DARK, this.scene);

            // --- 6. Orbiting storm clouds ---
            this.cloudRing = new Mesh("cloudRingParent", this.scene);
            this.cloudRing.parent = this.mesh;
            this.cloudRing.position.y = 3.0;

            for (let i = 0; i < 5; i++) {
                const angle = (i / 5) * Math.PI * 2;
                const cloud = MeshBuilder.CreateSphere(`cloudPuff${i}`, {
                    diameter: 0.4 + Math.random() * 0.2, segments: 4
                }, this.scene);
                makeFlatShaded(cloud);
                cloud.scaling.y = 0.4;
                cloud.parent = this.cloudRing;
                cloud.position.x = Math.sin(angle) * 1.1;
                cloud.position.z = Math.cos(angle) * 1.1;
                cloud.position.y = (i % 2) * 0.12;
                const cloudMat = createLowPolyMaterial(`stormCloudMat${i}`, PALETTE.TOWER_STORM_DARK, this.scene);
                cloudMat.alpha = 0.7;
                cloud.material = cloudMat;
            }

            // Cloud ring rotation
            const cloudRotate = new Animation("cloudRingRotation", "rotation.y", 20,
                Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CYCLE);
            cloudRotate.setKeys([
                { frame: 0, value: 0 },
                { frame: 240, value: Math.PI * 2 }
            ]);
            this.cloudRing.animations = [cloudRotate];
            this.scene.beginAnimation(this.cloudRing, 0, 240, true);

            // --- 7. Storm spark particles ---
            this.createStormEffect();

        } catch (error) {
            console.error("Error creating Storm Tower mesh:", error);
        }
    }

    private createStormEffect(): void {
        if (!this.mesh || !this.stormOrb) return;
        try {
            this.stormParticles = new ParticleSystem('stormParticles', 20, this.scene);
            this.stormParticles.emitter = new Vector3(this.position.x, this.position.y + 3.0, this.position.z);
            this.stormParticles.minSize = 0.05;
            this.stormParticles.maxSize = 0.15;
            this.stormParticles.minLifeTime = 0.1;
            this.stormParticles.maxLifeTime = 0.4;
            this.stormParticles.emitRate = 12;
            this.stormParticles.color1 = new Color4(0.7, 0.7, 1.0, 0.8);
            this.stormParticles.color2 = new Color4(0.5, 0.5, 0.9, 0.8);
            this.stormParticles.colorDead = new Color4(0.2, 0.2, 0.5, 0);
            this.stormParticles.direction1 = new Vector3(-0.8, -0.5, -0.8);
            this.stormParticles.direction2 = new Vector3(0.8, 0.5, 0.8);
            this.stormParticles.minEmitPower = 1.0;
            this.stormParticles.maxEmitPower = 2.0;
            this.stormParticles.blendMode = ParticleSystem.BLENDMODE_ONEONE;
            this.stormParticles.updateSpeed = 0.01;
            this.stormParticles.start();
        } catch (error) {
            console.error("Error creating storm effect:", error);
        }
    }

    protected fire(): void {
        if (!this.targetEnemy) return;
        this.clearLightningBolts();
        const chainTargets = this.findChainTargets(this.targetEnemy);
        let currentDamage = this.calculateDamage(this.targetEnemy);
        this.targetEnemy.takeDamage(currentDamage);
        this.applyStatusEffect(this.targetEnemy, StatusEffect.STUNNED, this.statusEffectDuration, this.statusEffectStrength);
        this.createLightningBolt(this.position, this.targetEnemy.getPosition());
        let previousTarget = this.targetEnemy;
        for (let i = 0; i < chainTargets.length; i++) {
            const target = chainTargets[i];
            currentDamage *= this.chainDamageReduction;
            const finalDamage = this.calculateDamageForChain(target, currentDamage);
            target.takeDamage(finalDamage);
            if (Math.random() < this.secondaryEffectChance) {
                this.applyStatusEffect(target, StatusEffect.STUNNED, this.statusEffectDuration / 2, this.statusEffectStrength);
            }
            this.createLightningBolt(previousTarget.getPosition(), target.getPosition());
            previousTarget = target;
        }
        this.game.getAssetManager().playSound('towerShoot');
    }

    private findChainTargets(primaryTarget: Enemy): Enemy[] {
        return [];
    }

    private calculateDamageForChain(enemy: Enemy, baseDamage: number): number {
        let multiplier = 1.0;
        if (this.weakAgainst.includes(enemy.getEnemyType())) multiplier *= 0.5;
        if (this.targetPriorities.includes(enemy.getEnemyType())) multiplier *= 1.5;
        return baseDamage * multiplier;
    }

    private createLightningBolt(start: Vector3, end: Vector3): void {
        const direction = end.subtract(start);
        const distance = direction.length();
        const numSegments = Math.ceil(distance * 2);
        const points: Vector3[] = [start];

        for (let i = 1; i < numSegments; i++) {
            const fraction = i / numSegments;
            const point = start.add(direction.scale(fraction));
            const perpX = direction.z;
            const perpZ = -direction.x;
            const perpLength = Math.sqrt(perpX * perpX + perpZ * perpZ);
            if (perpLength > 0.001) {
                const nx = perpX / perpLength;
                const nz = perpZ / perpLength;
                const offset = (Math.random() - 0.5) * distance * 0.2;
                point.x += nx * offset;
                point.z += nz * offset;
                point.y += (Math.random() - 0.5) * distance * 0.1;
            }
            points.push(point);
        }
        points.push(end);

        const lightning = MeshBuilder.CreateLines('lightningBolt', { points, updatable: false }, this.scene);
        lightning.color = new Color3(0.7, 0.7, 1.0);
        this.lightningBolts.push(lightning);

        // Impact burst
        const impact = new ParticleSystem('impactPS', 20, this.scene);
        impact.emitter = end;
        impact.minEmitBox = new Vector3(-0.1, -0.1, -0.1);
        impact.maxEmitBox = new Vector3(0.1, 0.1, 0.1);
        impact.minSize = 0.1;
        impact.maxSize = 0.25;
        impact.minLifeTime = 0.1;
        impact.maxLifeTime = 0.25;
        impact.emitRate = 80;
        impact.manualEmitCount = 15;
        impact.color1 = new Color4(0.8, 0.8, 1.0, 0.8);
        impact.color2 = new Color4(0.6, 0.6, 1.0, 0.8);
        impact.colorDead = new Color4(0.3, 0.3, 0.6, 0);
        impact.direction1 = new Vector3(-1, -1, -1);
        impact.direction2 = new Vector3(1, 1, 1);
        impact.minEmitPower = 1.0;
        impact.maxEmitPower = 2.0;
        impact.blendMode = ParticleSystem.BLENDMODE_ONEONE;
        impact.updateSpeed = 0.01;
        impact.start();
        impact.manualEmitCount = 0;
        setTimeout(() => impact.dispose(), 400);

        setTimeout(() => {
            const idx = this.lightningBolts.indexOf(lightning);
            if (idx !== -1) { this.lightningBolts.splice(idx, 1); lightning.dispose(); }
        }, 200);
    }

    private clearLightningBolts(): void {
        for (const bolt of this.lightningBolts) bolt.dispose();
        this.lightningBolts = [];
    }

    public dispose(): void {
        if (this.stormParticles) { this.stormParticles.stop(); this.stormParticles.dispose(); this.stormParticles = null; }
        if (this.stormOrb) this.scene.stopAnimation(this.stormOrb);
        if (this.cloudRing) this.scene.stopAnimation(this.cloudRing);
        this.clearLightningBolts();
        if (this.mesh) {
            this.scene.particleSystems.forEach(ps => {
                if (ps.name.startsWith('rodSparkPS') || ps.name.startsWith('cloudLightningPS') || ps.name.startsWith('lightningParticles')) ps.dispose();
            });
        }
        super.dispose();
    }
}
