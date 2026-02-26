import { Vector3, MeshBuilder, Color3, ParticleSystem, Color4, Mesh, Animation } from '@babylonjs/core';
import { Game } from '../../../Game';
import { Tower, ElementType, StatusEffect, EnemyType } from '../Tower';
import { Enemy } from '../../enemies/Enemy';
import { createLowPolyMaterial, createEmissiveMaterial, makeFlatShaded } from '../../../rendering/LowPolyMaterial';
import { PALETTE } from '../../../rendering/StyleConstants';

/**
 * Steam Tower - Combines Fire and Water elements
 * Copper boiler cauldron with steam vents and pressure valves
 */
export class SteamTower extends Tower {
    private areaOfEffect: number = 3;
    private steamParticles: ParticleSystem | null = null;
    private cauldron: Mesh | null = null;
    private steamVents: Mesh[] = [];
    private steamRing: Mesh | null = null;

    constructor(game: Game, position: Vector3) {
        const damage = 8;
        const range = 6;
        const fireRate = 1.0;
        const cost = 200;

        super(game, position, range, damage, fireRate, cost);

        this.secondaryEffectChance = 0.5;
        this.statusEffectDuration = 3;
        this.statusEffectStrength = 0.3;
        this.targetPriorities = [EnemyType.FIRE, EnemyType.EARTH];
        this.weakAgainst = [EnemyType.WIND];

        this.createMesh();
    }

    protected createMesh(): void {
        try {
            this.mesh = new Mesh("steamTowerRoot", this.scene);
            this.mesh.position = this.position.clone();

            // --- 1. Hex base (fire element: warm stone) ---
            const base = MeshBuilder.CreateCylinder('steamBase', {
                height: 0.6, diameterTop: 2.0, diameterBottom: 2.3, tessellation: 6
            }, this.scene);
            makeFlatShaded(base);
            base.parent = this.mesh;
            base.position.y = 0.3;
            base.material = createLowPolyMaterial('steamBaseMat', PALETTE.ROCK_DARK, this.scene);

            // --- 2. Copper-toned body (fire heritage) ---
            const body = MeshBuilder.CreateCylinder('steamBody', {
                height: 1.8, diameterTop: 1.2, diameterBottom: 1.6, tessellation: 8
            }, this.scene);
            makeFlatShaded(body);
            body.parent = this.mesh;
            body.position.y = 1.5;
            body.material = createLowPolyMaterial('steamBodyMat', PALETTE.TOWER_STEAM_COPPER, this.scene);

            // Riveted bands
            for (let i = 0; i < 3; i++) {
                const band = MeshBuilder.CreateTorus(`steamBand${i}`, {
                    diameter: 1.35 - i * 0.1, thickness: 0.06, tessellation: 8
                }, this.scene);
                makeFlatShaded(band);
                band.parent = this.mesh;
                band.position.y = 0.9 + i * 0.6;
                band.material = createLowPolyMaterial(`steamBandMat${i}`, PALETTE.TOWER_STEAM_PIPE, this.scene);
            }

            // --- 3. Cauldron basin at top ---
            this.cauldron = MeshBuilder.CreateCylinder('steamCauldron', {
                height: 0.7, diameterTop: 1.5, diameterBottom: 1.3, tessellation: 8
            }, this.scene);
            makeFlatShaded(this.cauldron);
            this.cauldron.parent = this.mesh;
            this.cauldron.position.y = 2.75;
            this.cauldron.material = createLowPolyMaterial('steamCauldronMat', PALETTE.TOWER_STEAM_COPPER, this.scene);

            // Water surface (water heritage)
            const waterSurface = MeshBuilder.CreateDisc('steamWater', {
                radius: 0.6, tessellation: 8
            }, this.scene);
            makeFlatShaded(waterSurface);
            waterSurface.parent = this.mesh;
            waterSurface.position.y = 2.85;
            waterSurface.rotation.x = -Math.PI / 2;
            const waterMat = createEmissiveMaterial('steamWaterMat', PALETTE.TOWER_WATER, 0.4, this.scene);
            waterMat.alpha = 0.7;
            waterSurface.material = waterMat;

            // Water bubble animation
            const bubbleAnim = new Animation("steamBubble", "scaling", 30,
                Animation.ANIMATIONTYPE_VECTOR3, Animation.ANIMATIONLOOPMODE_CYCLE);
            bubbleAnim.setKeys([
                { frame: 0, value: new Vector3(1, 1, 1) },
                { frame: 20, value: new Vector3(1.05, 1.05, 1) },
                { frame: 40, value: new Vector3(1, 1, 1) }
            ]);
            waterSurface.animations = [bubbleAnim];
            this.scene.beginAnimation(waterSurface, 0, 40, true);

            // --- 4. Steam vent pipes around rim ---
            const ventCount = 4;
            for (let i = 0; i < ventCount; i++) {
                const angle = (i / ventCount) * Math.PI * 2;
                const vent = MeshBuilder.CreateCylinder(`steamVent${i}`, {
                    height: 0.5, diameter: 0.18, tessellation: 6
                }, this.scene);
                makeFlatShaded(vent);
                vent.parent = this.mesh;
                vent.position.x = Math.sin(angle) * 0.65;
                vent.position.z = Math.cos(angle) * 0.65;
                vent.position.y = 3.15;
                vent.material = createLowPolyMaterial(`steamVentMat${i}`, PALETTE.TOWER_STEAM_PIPE, this.scene);
                this.steamVents.push(vent);

                // Vent cap
                const cap = MeshBuilder.CreateCylinder(`ventCap${i}`, {
                    height: 0.08, diameterTop: 0.25, diameterBottom: 0.2, tessellation: 6
                }, this.scene);
                makeFlatShaded(cap);
                cap.parent = this.mesh;
                cap.position.x = Math.sin(angle) * 0.65;
                cap.position.z = Math.cos(angle) * 0.65;
                cap.position.y = 3.4;
                cap.material = createLowPolyMaterial(`ventCapMat${i}`, PALETTE.TOWER_STEAM_COPPER, this.scene);
            }

            // --- 5. Orbiting steam cloud ring ---
            this.steamRing = new Mesh("steamRingParent", this.scene);
            this.steamRing.parent = this.mesh;
            this.steamRing.position.y = 2.5;

            for (let i = 0; i < 4; i++) {
                const angle = (i / 4) * Math.PI * 2;
                const cloud = MeshBuilder.CreateSphere(`steamCloud${i}`, {
                    diameter: 0.35, segments: 4
                }, this.scene);
                makeFlatShaded(cloud);
                cloud.scaling.y = 0.5;
                cloud.parent = this.steamRing;
                cloud.position.x = Math.sin(angle) * 1.1;
                cloud.position.z = Math.cos(angle) * 1.1;
                cloud.position.y = (i % 2) * 0.15;
                const cloudMat = createLowPolyMaterial(`steamCloudMat${i}`, PALETTE.TOWER_STEAM_CLOUD, this.scene);
                cloudMat.alpha = 0.5;
                cloud.material = cloudMat;
            }

            // Ring rotation
            const ringRotate = new Animation("steamRingRotation", "rotation.y", 30,
                Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CYCLE);
            ringRotate.setKeys([
                { frame: 0, value: 0 },
                { frame: 210, value: Math.PI * 2 }
            ]);
            this.steamRing.animations = [ringRotate];
            this.scene.beginAnimation(this.steamRing, 0, 210, true);

            // --- 6. Ember glow under the cauldron (fire element hint) ---
            const emberGlow = MeshBuilder.CreateDisc('steamEmber', {
                radius: 0.5, tessellation: 6
            }, this.scene);
            makeFlatShaded(emberGlow);
            emberGlow.parent = this.mesh;
            emberGlow.position.y = 2.35;
            emberGlow.rotation.x = -Math.PI / 2;
            emberGlow.material = createEmissiveMaterial('steamEmberMat', PALETTE.TOWER_FIRE_LAVA, 0.5, this.scene);

            // --- 7. Steam particles ---
            this.createSteamEffect();

        } catch (error) {
            console.error("Error creating Steam Tower mesh:", error);
        }
    }

    private createSteamEffect(): void {
        if (!this.mesh) return;

        try {
            this.steamParticles = new ParticleSystem('steamParticles', 40, this.scene);
            this.steamParticles.emitter = new Vector3(this.position.x, this.position.y + 3.2, this.position.z);
            this.steamParticles.minSize = 0.3;
            this.steamParticles.maxSize = 0.7;
            this.steamParticles.minLifeTime = 1.5;
            this.steamParticles.maxLifeTime = 3.0;
            this.steamParticles.emitRate = 15;
            this.steamParticles.color1 = new Color4(0.8, 0.8, 0.9, 0.6);
            this.steamParticles.color2 = new Color4(0.7, 0.8, 1.0, 0.5);
            this.steamParticles.colorDead = new Color4(0.6, 0.7, 0.8, 0);
            this.steamParticles.direction1 = new Vector3(-0.4, 2, -0.4);
            this.steamParticles.direction2 = new Vector3(0.4, 3, 0.4);
            this.steamParticles.minEmitPower = 0.3;
            this.steamParticles.maxEmitPower = 1.0;
            this.steamParticles.updateSpeed = 0.01;
            this.steamParticles.start();
        } catch (error) {
            console.error("Error creating Steam Tower effect:", error);
        }
    }

    protected fire(): void {
        if (!this.targetEnemy) return;

        this.createSteamCloud(this.targetEnemy.getPosition());

        const enemiesInRange = this.getEnemiesInRange(this.targetEnemy.getPosition(), this.areaOfEffect);
        for (const enemy of enemiesInRange) {
            let finalDamage = this.calculateDamage(enemy);
            enemy.takeDamage(finalDamage);
            this.applyStatusEffect(enemy, StatusEffect.SLOWED, this.statusEffectDuration, this.statusEffectStrength);
            if (Math.random() < this.secondaryEffectChance) {
                this.applyStatusEffect(enemy, StatusEffect.BURNING, 1.5, 0.15);
            }
        }
        this.game.getAssetManager().playSound('towerShoot');
    }

    private createSteamCloud(position: Vector3): void {
        try {
            const steamCloud = new ParticleSystem('steamCloud', 40, this.scene);
            steamCloud.emitter = position.clone();
            steamCloud.minEmitBox = new Vector3(-0.8, 0, -0.8);
            steamCloud.maxEmitBox = new Vector3(0.8, 0.3, 0.8);
            steamCloud.minSize = 0.4;
            steamCloud.maxSize = 1.0;
            steamCloud.minLifeTime = 0.8;
            steamCloud.maxLifeTime = 1.5;
            steamCloud.emitRate = 30;
            steamCloud.color1 = new Color4(0.8, 0.8, 0.9, 0.7);
            steamCloud.color2 = new Color4(0.7, 0.8, 1.0, 0.6);
            steamCloud.colorDead = new Color4(0.6, 0.7, 0.8, 0);
            steamCloud.direction1 = new Vector3(-0.2, 0.5, -0.2);
            steamCloud.direction2 = new Vector3(0.2, 1, 0.2);
            steamCloud.minEmitPower = 0.3;
            steamCloud.maxEmitPower = 1.0;
            steamCloud.updateSpeed = 0.01;
            steamCloud.start();
            setTimeout(() => { steamCloud.stop(); setTimeout(() => steamCloud.dispose(), 1500); }, 800);
        } catch (error) {
            console.error("Error creating steam cloud:", error);
        }
    }

    private getEnemiesInRange(position: Vector3, radius: number): Enemy[] {
        if (this.targetEnemy) return [this.targetEnemy];
        return [];
    }

    public dispose(): void {
        if (this.steamParticles) {
            this.steamParticles.stop();
            this.steamParticles.dispose();
            this.steamParticles = null;
        }
        if (this.steamRing) {
            this.scene.stopAnimation(this.steamRing);
        }
        if (this.mesh) {
            this.scene.particleSystems.forEach(ps => {
                if (ps.name.startsWith('ventSteam') || ps.name.startsWith('steamCloudPS')) {
                    ps.dispose();
                }
            });
        }
        super.dispose();
    }
}
