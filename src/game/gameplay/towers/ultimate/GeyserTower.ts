import { Vector3, MeshBuilder, Color3, Color4, ParticleSystem, Mesh, Animation } from '@babylonjs/core';
import { Game } from '../../../Game';
import { Tower, ElementType, StatusEffect, EnemyType } from '../Tower';
import { Enemy } from '../../enemies/Enemy';
import { createLowPolyMaterial, createEmissiveMaterial, makeFlatShaded } from '../../../rendering/LowPolyMaterial';
import { PALETTE } from '../../../rendering/StyleConstants';

/**
 * Geyser Tower — Ultimate fusion of Steam+Steam
 * Massive AOE steam eruptions with strong slow
 */
export class GeyserTower extends Tower {
    private areaOfEffect: number = 5;
    private steamParticles: ParticleSystem | null = null;

    constructor(game: Game, position: Vector3) {
        super(game, position, 8, 90, 1.5, 0, true);

        this.fusionTier = 2;
        this.maxLevel = 1;
        this.elementType = ElementType.NONE;
        this.secondaryEffectChance = 0.6;
        this.statusEffectDuration = 4;
        this.statusEffectStrength = 0.5;

        this.createMesh();
    }

    protected createMesh(): void {
        try {
            this.mesh = new Mesh('geyserTowerRoot', this.scene);
            this.mesh.position = this.position.clone();

            // Wide hex base
            const base = MeshBuilder.CreateCylinder('geyserBase', {
                height: 0.8, diameterTop: 2.6, diameterBottom: 3.0, tessellation: 6
            }, this.scene);
            makeFlatShaded(base);
            base.parent = this.mesh;
            base.position.y = 0.4;
            base.material = createLowPolyMaterial('geyserBaseMat', PALETTE.ROCK_DARK, this.scene);

            // Tall copper body
            const body = MeshBuilder.CreateCylinder('geyserBody', {
                height: 2.5, diameterTop: 1.6, diameterBottom: 2.2, tessellation: 8
            }, this.scene);
            makeFlatShaded(body);
            body.parent = this.mesh;
            body.position.y = 2.05;
            body.material = createLowPolyMaterial('geyserBodyMat', PALETTE.TOWER_GEYSER_COPPER, this.scene);

            // Giant cauldron
            const cauldron = MeshBuilder.CreateCylinder('geyserCauldron', {
                height: 1.0, diameterTop: 2.2, diameterBottom: 1.8, tessellation: 8
            }, this.scene);
            makeFlatShaded(cauldron);
            cauldron.parent = this.mesh;
            cauldron.position.y = 3.8;
            cauldron.material = createLowPolyMaterial('geyserCauldronMat', PALETTE.TOWER_GEYSER_COPPER, this.scene);

            // Glowing water surface
            const water = MeshBuilder.CreateDisc('geyserWater', { radius: 0.9, tessellation: 8 }, this.scene);
            makeFlatShaded(water);
            water.parent = this.mesh;
            water.position.y = 3.95;
            water.rotation.x = -Math.PI / 2;
            const waterMat = createEmissiveMaterial('geyserWaterMat', PALETTE.TOWER_WATER, 0.6, this.scene);
            waterMat.alpha = 0.8;
            water.material = waterMat;

            // Steam vent pipes (6 around)
            for (let i = 0; i < 6; i++) {
                const angle = (i / 6) * Math.PI * 2;
                const vent = MeshBuilder.CreateCylinder(`geyserVent${i}`, {
                    height: 0.6, diameter: 0.2, tessellation: 6
                }, this.scene);
                makeFlatShaded(vent);
                vent.parent = this.mesh;
                vent.position.x = Math.sin(angle) * 0.85;
                vent.position.z = Math.cos(angle) * 0.85;
                vent.position.y = 4.35;
                vent.material = createLowPolyMaterial(`geyserVentMat${i}`, PALETTE.TOWER_STEAM_PIPE, this.scene);
            }

            // Crown glow
            const crown = MeshBuilder.CreateTorus('geyserCrown', {
                diameter: 2.4, thickness: 0.15, tessellation: 16
            }, this.scene);
            makeFlatShaded(crown);
            crown.parent = this.mesh;
            crown.position.y = 4.3;
            crown.material = createEmissiveMaterial('geyserCrownMat', PALETTE.TOWER_GEYSER_STEAM, 0.5, this.scene);

            // Steam particles
            this.steamParticles = new ParticleSystem('geyserSteam', 60, this.scene);
            this.steamParticles.emitter = new Vector3(this.position.x, this.position.y + 4.2, this.position.z);
            this.steamParticles.minSize = 0.5;
            this.steamParticles.maxSize = 1.2;
            this.steamParticles.minLifeTime = 2.0;
            this.steamParticles.maxLifeTime = 4.0;
            this.steamParticles.emitRate = 25;
            this.steamParticles.color1 = new Color4(0.85, 0.85, 0.95, 0.7);
            this.steamParticles.color2 = new Color4(0.75, 0.85, 1.0, 0.5);
            this.steamParticles.colorDead = new Color4(0.6, 0.7, 0.8, 0);
            this.steamParticles.direction1 = new Vector3(-0.6, 3, -0.6);
            this.steamParticles.direction2 = new Vector3(0.6, 5, 0.6);
            this.steamParticles.minEmitPower = 0.5;
            this.steamParticles.maxEmitPower = 1.5;
            this.steamParticles.updateSpeed = 0.01;
            this.steamParticles.start();
        } catch (error) {
            console.error('Error creating Geyser Tower mesh:', error);
        }
    }

    protected fire(): void {
        if (!this.targetEnemy) return;

        const targetPos = this.targetEnemy.getPosition();

        // Create steam eruption visual
        const ps = new ParticleSystem('geyserEruption', 60, this.scene);
        ps.emitter = targetPos.clone();
        ps.minEmitBox = new Vector3(-1, 0, -1);
        ps.maxEmitBox = new Vector3(1, 0.3, 1);
        ps.minSize = 0.5;
        ps.maxSize = 1.2;
        ps.minLifeTime = 0.8;
        ps.maxLifeTime = 2.0;
        ps.emitRate = 50;
        ps.color1 = new Color4(0.85, 0.85, 0.95, 0.8);
        ps.color2 = new Color4(0.7, 0.8, 1.0, 0.6);
        ps.colorDead = new Color4(0.6, 0.7, 0.8, 0);
        ps.direction1 = new Vector3(-0.5, 2, -0.5);
        ps.direction2 = new Vector3(0.5, 4, 0.5);
        ps.minEmitPower = 1;
        ps.maxEmitPower = 3;
        ps.updateSpeed = 0.01;
        ps.start();
        setTimeout(() => { ps.stop(); setTimeout(() => ps.dispose(), 2000); }, 500);

        // Damage and slow all enemies in AOE
        const enemies = this.getEnemiesInAOE(targetPos);
        for (const enemy of enemies) {
            enemy.takeDamage(this.calculateDamage(enemy));
            this.applyStatusEffect(enemy, StatusEffect.SLOWED, this.statusEffectDuration, this.statusEffectStrength);
            if (Math.random() < this.secondaryEffectChance) {
                this.applyStatusEffect(enemy, StatusEffect.BURNING, 2, 0.2);
            }
        }

        this.createProjectileEffect(targetPos);
        this.game.getAssetManager().playSound('towerShoot');
    }

    private getEnemiesInAOE(position: Vector3): Enemy[] {
        if (!this.targetEnemy) return [];
        return [this.targetEnemy];
    }

    public dispose(): void {
        if (this.steamParticles) {
            this.steamParticles.stop();
            this.steamParticles.dispose();
        }
        super.dispose();
    }
}
