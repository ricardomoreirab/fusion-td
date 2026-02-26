import { Vector3, MeshBuilder, Color3, ParticleSystem, Color4, Mesh, Animation } from '@babylonjs/core';
import { Game } from '../../../Game';
import { Tower, ElementType, StatusEffect, EnemyType } from '../Tower';
import { Enemy } from '../../enemies/Enemy';
import { createLowPolyMaterial, createEmissiveMaterial, makeFlatShaded } from '../../../rendering/LowPolyMaterial';
import { PALETTE } from '../../../rendering/StyleConstants';

/**
 * Lava Tower - Combines Fire and Earth elements
 * Volcanic eruption tower with cracked lava veins and orbiting magma rocks
 */
export class LavaTower extends Tower {
    private areaOfEffect: number = 2.5;
    private lavaParticles: ParticleSystem | null = null;
    private lavaRing: Mesh | null = null;

    constructor(game: Game, position: Vector3) {
        const damage = 15;
        const range = 4.5;
        const fireRate = 0.8;
        const cost = 250;

        super(game, position, range, damage, fireRate, cost);

        this.secondaryEffectChance = 0.6;
        this.statusEffectDuration = 4;
        this.statusEffectStrength = 0.25;
        this.targetPriorities = [EnemyType.WIND, EnemyType.PLANT];
        this.weakAgainst = [EnemyType.WATER];
        this.canTargetFlying = false;

        this.createMesh();
    }

    protected createMesh(): void {
        try {
            this.mesh = new Mesh("lavaTowerRoot", this.scene);
            this.mesh.position = this.position.clone();

            // --- 1. Cracked volcanic base (earth heritage) ---
            const base = MeshBuilder.CreateCylinder('lavaBase', {
                height: 0.7, diameterTop: 2.2, diameterBottom: 2.5, tessellation: 6
            }, this.scene);
            makeFlatShaded(base);
            base.parent = this.mesh;
            base.position.y = 0.35;
            base.material = createLowPolyMaterial('lavaBaseMat', PALETTE.TOWER_LAVA_ROCK, this.scene);

            // Lava glow veins in base
            for (let i = 0; i < 4; i++) {
                const angle = (i / 4) * Math.PI * 2;
                const vein = MeshBuilder.CreateBox(`lavaBaseVein${i}`, {
                    width: 0.05, height: 0.5, depth: 0.8
                }, this.scene);
                vein.position = new Vector3(Math.sin(angle) * 0.9, 0.35, Math.cos(angle) * 0.9);
                vein.rotation.y = angle;
                vein.material = createEmissiveMaterial(`lavaBaseVeinMat${i}`, PALETTE.TOWER_LAVA_GLOW, 0.7, this.scene);
                vein.parent = this.mesh;
            }

            // --- 2. Volcanic body (fire + earth blend) ---
            const body = MeshBuilder.CreateCylinder('lavaBody', {
                height: 1.8, diameterTop: 1.4, diameterBottom: 1.8, tessellation: 8
            }, this.scene);
            makeFlatShaded(body);
            body.parent = this.mesh;
            body.position.y = 1.6;
            body.material = createLowPolyMaterial('lavaBodyMat', PALETTE.TOWER_LAVA_CRUST, this.scene);

            // Lava streams flowing down body
            for (let i = 0; i < 3; i++) {
                const angle = (i / 3) * Math.PI * 2;
                const stream = MeshBuilder.CreateBox(`lavaStream${i}`, {
                    width: 0.12, height: 1.5, depth: 0.06
                }, this.scene);
                stream.position = new Vector3(Math.sin(angle) * 0.65, 1.6, Math.cos(angle) * 0.65);
                stream.rotation.y = angle;
                stream.material = createEmissiveMaterial(`lavaStreamMat${i}`, PALETTE.TOWER_LAVA_GLOW, 0.6, this.scene);
                stream.parent = this.mesh;
            }

            // --- 3. Volcanic crater rim ---
            const crater = MeshBuilder.CreateTorus('lavaCrater', {
                diameter: 1.5, thickness: 0.35, tessellation: 8
            }, this.scene);
            makeFlatShaded(crater);
            crater.parent = this.mesh;
            crater.position.y = 2.8;
            crater.material = createLowPolyMaterial('lavaCraterMat', PALETTE.TOWER_LAVA_ROCK, this.scene);

            // Lava pool inside crater
            const lavaPool = MeshBuilder.CreateDisc('lavaPool', {
                radius: 0.65, tessellation: 8
            }, this.scene);
            makeFlatShaded(lavaPool);
            lavaPool.parent = this.mesh;
            lavaPool.position.y = 2.85;
            lavaPool.rotation.x = -Math.PI / 2;
            lavaPool.material = createEmissiveMaterial('lavaPoolMat', PALETTE.TOWER_LAVA_GLOW, 0.9, this.scene);

            // Lava pool pulse
            const lavaPulse = new Animation("lavaPulse", "scaling", 30,
                Animation.ANIMATIONTYPE_VECTOR3, Animation.ANIMATIONLOOPMODE_CYCLE);
            lavaPulse.setKeys([
                { frame: 0, value: new Vector3(1, 1, 1) },
                { frame: 25, value: new Vector3(1.08, 1.08, 1) },
                { frame: 50, value: new Vector3(1, 1, 1) }
            ]);
            lavaPool.animations = [lavaPulse];
            this.scene.beginAnimation(lavaPool, 0, 50, true);

            // --- 4. Rocky spikes around crater (earth heritage) ---
            for (let i = 0; i < 5; i++) {
                const angle = (i / 5) * Math.PI * 2;
                const spike = MeshBuilder.CreateCylinder(`lavaSpike${i}`, {
                    height: 0.5 + Math.random() * 0.3, diameterTop: 0, diameterBottom: 0.2, tessellation: 4
                }, this.scene);
                makeFlatShaded(spike);
                spike.parent = this.mesh;
                spike.position.x = Math.sin(angle) * 0.8;
                spike.position.z = Math.cos(angle) * 0.8;
                spike.position.y = 3.1;
                spike.rotation.x = Math.sin(angle) * 0.2;
                spike.rotation.z = Math.cos(angle) * 0.2;
                spike.material = createLowPolyMaterial(`lavaSpikeMat${i}`, PALETTE.ROCK_DARK, this.scene);
            }

            // --- 5. Orbiting magma rocks ---
            this.lavaRing = new Mesh("lavaRingParent", this.scene);
            this.lavaRing.parent = this.mesh;
            this.lavaRing.position.y = 2.5;

            for (let i = 0; i < 4; i++) {
                const angle = (i / 4) * Math.PI * 2;
                const rock = MeshBuilder.CreatePolyhedron(`lavaRock${i}`, {
                    type: i % 2, size: 0.18 + Math.random() * 0.08
                }, this.scene);
                makeFlatShaded(rock);
                rock.parent = this.lavaRing;
                rock.position.x = Math.sin(angle) * 1.2;
                rock.position.z = Math.cos(angle) * 1.2;
                rock.position.y = (i % 2) * 0.15;
                rock.rotation.set(Math.random(), Math.random(), Math.random());
                rock.material = createEmissiveMaterial(`lavaRockMat${i}`, PALETTE.TOWER_LAVA_GLOW, 0.5, this.scene);
            }

            // Ring orbit
            const ringOrbit = new Animation("lavaRingRotation", "rotation.y", 30,
                Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CYCLE);
            ringOrbit.setKeys([
                { frame: 0, value: 0 },
                { frame: 240, value: Math.PI * 2 }
            ]);
            this.lavaRing.animations = [ringOrbit];
            this.scene.beginAnimation(this.lavaRing, 0, 240, true);

            // --- 6. Lava eruption particles ---
            this.createLavaEffect();

        } catch (error) {
            console.error("Error creating Lava Tower mesh:", error);
        }
    }

    private createLavaEffect(): void {
        if (!this.mesh) return;
        try {
            this.lavaParticles = new ParticleSystem('lavaParticles', 30, this.scene);
            this.lavaParticles.emitter = new Vector3(this.position.x, this.position.y + 3.0, this.position.z);
            this.lavaParticles.minSize = 0.15;
            this.lavaParticles.maxSize = 0.4;
            this.lavaParticles.minLifeTime = 0.8;
            this.lavaParticles.maxLifeTime = 1.5;
            this.lavaParticles.emitRate = 12;
            this.lavaParticles.color1 = new Color4(1, 0.5, 0, 1.0);
            this.lavaParticles.color2 = new Color4(1, 0.2, 0, 1.0);
            this.lavaParticles.colorDead = new Color4(0.5, 0, 0, 0.0);
            this.lavaParticles.direction1 = new Vector3(-0.3, 1, -0.3);
            this.lavaParticles.direction2 = new Vector3(0.3, 2, 0.3);
            this.lavaParticles.minEmitPower = 0.3;
            this.lavaParticles.maxEmitPower = 1.0;
            this.lavaParticles.gravity = new Vector3(0, -2, 0);
            this.lavaParticles.updateSpeed = 0.01;
            this.lavaParticles.start();
        } catch (error) {
            console.error("Error creating lava effect:", error);
        }
    }

    protected fire(): void {
        if (!this.targetEnemy) return;
        this.createLavaPoolEffect(this.targetEnemy.getPosition());
        const enemiesInRange = this.getEnemiesInRange(this.targetEnemy.getPosition(), this.areaOfEffect);
        for (const enemy of enemiesInRange) {
            if (enemy.getEnemyType() === EnemyType.FLYING && !this.canTargetFlying) continue;
            let finalDamage = this.calculateDamage(enemy);
            enemy.takeDamage(finalDamage);
            this.applyStatusEffect(enemy, StatusEffect.BURNING, this.statusEffectDuration, this.statusEffectStrength);
            if (Math.random() < this.secondaryEffectChance) {
                this.applyStatusEffect(enemy, StatusEffect.SLOWED, 2.0, 0.3);
            }
        }
        this.game.getAssetManager().playSound('towerShoot');
    }

    private createLavaPoolEffect(position: Vector3): void {
        try {
            const poolPS = new ParticleSystem('lavaPoolEffect', 30, this.scene);
            poolPS.emitter = new Vector3(position.x, 0.1, position.z);
            poolPS.minEmitBox = new Vector3(-0.5, 0, -0.5);
            poolPS.maxEmitBox = new Vector3(0.5, 0, 0.5);
            poolPS.minSize = 0.2;
            poolPS.maxSize = 0.5;
            poolPS.minLifeTime = 0.5;
            poolPS.maxLifeTime = 1.0;
            poolPS.emitRate = 25;
            poolPS.color1 = new Color4(1, 0.5, 0, 0.7);
            poolPS.color2 = new Color4(1, 0.2, 0, 0.7);
            poolPS.colorDead = new Color4(0.5, 0, 0, 0);
            poolPS.direction1 = new Vector3(-0.1, 0.5, -0.1);
            poolPS.direction2 = new Vector3(0.1, 1, 0.1);
            poolPS.minEmitPower = 0.1;
            poolPS.maxEmitPower = 0.3;
            poolPS.updateSpeed = 0.01;
            poolPS.start();
            setTimeout(() => { poolPS.stop(); setTimeout(() => poolPS.dispose(), 1000); }, 600);
        } catch (error) {
            console.error("Error creating lava pool effect:", error);
        }
    }

    protected calculateDamage(enemy: Enemy): number {
        let damage = this.damage;
        if (enemy.getEnemyType() === EnemyType.EARTH) damage *= 1.5;
        else if (enemy.getEnemyType() === EnemyType.WATER) damage *= 0.5;
        return damage;
    }

    private getEnemiesInRange(position: Vector3, radius: number): Enemy[] {
        if (this.targetEnemy) return [this.targetEnemy];
        return [];
    }

    public dispose(): void {
        if (this.lavaParticles) { this.lavaParticles.stop(); this.lavaParticles.dispose(); this.lavaParticles = null; }
        if (this.lavaRing) { this.scene.stopAnimation(this.lavaRing); }
        if (this.mesh) {
            this.scene.particleSystems.forEach(ps => {
                if (ps.name.startsWith('lavaPoolPS') || ps.name.startsWith('lavaRockPS')) ps.dispose();
            });
        }
        super.dispose();
    }
}
