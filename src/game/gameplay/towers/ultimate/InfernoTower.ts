import { Vector3, MeshBuilder, Color3, Color4, ParticleSystem, Mesh, Animation } from '@babylonjs/core';
import { Game } from '../../../Game';
import { Tower, ElementType, StatusEffect, EnemyType } from '../Tower';
import { Enemy } from '../../enemies/Enemy';
import { createLowPolyMaterial, createEmissiveMaterial, makeFlatShaded } from '../../../rendering/LowPolyMaterial';
import { PALETTE } from '../../../rendering/StyleConstants';

/**
 * Inferno Tower — Ultimate fusion of Lava+Lava
 * Devastating single-target damage + lava DOT
 */
export class InfernoTower extends Tower {
    private lavaParticles: ParticleSystem | null = null;

    constructor(game: Game, position: Vector3) {
        super(game, position, 6, 165, 1.0, 0, true);

        this.fusionTier = 2;
        this.maxLevel = 1;
        this.elementType = ElementType.NONE;
        this.secondaryEffectChance = 0.8;
        this.statusEffectDuration = 5;
        this.statusEffectStrength = 3.0;

        this.createMesh();
    }

    protected createMesh(): void {
        try {
            this.mesh = new Mesh('infernoTowerRoot', this.scene);
            this.mesh.position = this.position.clone();

            // Obsidian base
            const base = MeshBuilder.CreateCylinder('infernoBase', {
                height: 0.8, diameterTop: 2.4, diameterBottom: 2.8, tessellation: 6
            }, this.scene);
            makeFlatShaded(base);
            base.parent = this.mesh;
            base.position.y = 0.4;
            base.material = createLowPolyMaterial('infernoBaseMat', PALETTE.TOWER_INFERNO_OBSIDIAN, this.scene);

            // Craggy volcanic body
            const body = MeshBuilder.CreateCylinder('infernoBody', {
                height: 2.8, diameterTop: 1.0, diameterBottom: 2.0, tessellation: 6
            }, this.scene);
            makeFlatShaded(body);
            body.parent = this.mesh;
            body.position.y = 2.2;
            body.material = createLowPolyMaterial('infernoBodyMat', PALETTE.TOWER_LAVA_ROCK, this.scene);

            // Magma veins (glowing rings)
            for (let i = 0; i < 3; i++) {
                const ring = MeshBuilder.CreateTorus(`infernoVein${i}`, {
                    diameter: 1.6 - i * 0.25, thickness: 0.08, tessellation: 8
                }, this.scene);
                makeFlatShaded(ring);
                ring.parent = this.mesh;
                ring.position.y = 1.2 + i * 0.8;
                ring.material = createEmissiveMaterial(`infernoVeinMat${i}`, PALETTE.TOWER_INFERNO_MAGMA, 0.7, this.scene);
            }

            // Volcanic crater top
            const crater = MeshBuilder.CreateCylinder('infernoCrater', {
                height: 0.6, diameterTop: 1.4, diameterBottom: 1.0, tessellation: 6
            }, this.scene);
            makeFlatShaded(crater);
            crater.parent = this.mesh;
            crater.position.y = 3.9;
            crater.material = createLowPolyMaterial('infernoCraterMat', PALETTE.TOWER_INFERNO_OBSIDIAN, this.scene);

            // Lava pool at top
            const lavaPool = MeshBuilder.CreateDisc('infernoLava', { radius: 0.55, tessellation: 6 }, this.scene);
            makeFlatShaded(lavaPool);
            lavaPool.parent = this.mesh;
            lavaPool.position.y = 4.0;
            lavaPool.rotation.x = -Math.PI / 2;
            lavaPool.material = createEmissiveMaterial('infernoLavaMat', PALETTE.TOWER_INFERNO_MAGMA, 0.9, this.scene);

            // Pulsing lava animation
            const pulseAnim = new Animation('infernoPulse', 'scaling', 30,
                Animation.ANIMATIONTYPE_VECTOR3, Animation.ANIMATIONLOOPMODE_CYCLE);
            pulseAnim.setKeys([
                { frame: 0, value: new Vector3(1, 1, 1) },
                { frame: 30, value: new Vector3(1.1, 1.1, 1) },
                { frame: 60, value: new Vector3(1, 1, 1) }
            ]);
            lavaPool.animations = [pulseAnim];
            this.scene.beginAnimation(lavaPool, 0, 60, true);

            // Fire particles
            this.lavaParticles = new ParticleSystem('infernoFire', 40, this.scene);
            this.lavaParticles.emitter = new Vector3(this.position.x, this.position.y + 4.0, this.position.z);
            this.lavaParticles.minSize = 0.2;
            this.lavaParticles.maxSize = 0.6;
            this.lavaParticles.minLifeTime = 0.5;
            this.lavaParticles.maxLifeTime = 1.5;
            this.lavaParticles.emitRate = 20;
            this.lavaParticles.color1 = new Color4(1, 0.5, 0, 0.9);
            this.lavaParticles.color2 = new Color4(1, 0.2, 0, 0.8);
            this.lavaParticles.colorDead = new Color4(0.3, 0, 0, 0);
            this.lavaParticles.direction1 = new Vector3(-0.3, 1.5, -0.3);
            this.lavaParticles.direction2 = new Vector3(0.3, 3, 0.3);
            this.lavaParticles.minEmitPower = 0.3;
            this.lavaParticles.maxEmitPower = 1.0;
            this.lavaParticles.updateSpeed = 0.01;
            this.lavaParticles.start();
        } catch (error) {
            console.error('Error creating Inferno Tower mesh:', error);
        }
    }

    protected fire(): void {
        if (!this.targetEnemy) return;

        const targetPos = this.targetEnemy.getPosition().clone();
        const finalDamage = this.calculateDamage(this.targetEnemy);
        this.targetEnemy.takeDamage(finalDamage);

        // Always apply heavy burn DOT
        this.applyStatusEffect(this.targetEnemy, StatusEffect.BURNING, this.statusEffectDuration, this.statusEffectStrength);

        this.createProjectileEffect(targetPos);
        this.game.getAssetManager().playSound('towerShoot');
    }

    public dispose(): void {
        if (this.lavaParticles) {
            this.lavaParticles.stop();
            this.lavaParticles.dispose();
        }
        super.dispose();
    }
}
