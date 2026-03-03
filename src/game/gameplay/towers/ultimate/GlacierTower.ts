import { Vector3, MeshBuilder, Color3, Color4, ParticleSystem, Mesh, Animation } from '@babylonjs/core';
import { Game } from '../../../Game';
import { Tower, ElementType, StatusEffect, EnemyType } from '../Tower';
import { Enemy } from '../../enemies/Enemy';
import { createLowPolyMaterial, createEmissiveMaterial, makeFlatShaded } from '../../../rendering/LowPolyMaterial';
import { PALETTE } from '../../../rendering/StyleConstants';

/**
 * Glacier Tower — Ultimate fusion of Ice+Ice
 * Permanent slow aura + periodic freeze, AOE 4
 */
export class GlacierTower extends Tower {
    private areaOfEffect: number = 4;
    private frostParticles: ParticleSystem | null = null;
    private freezeTimer: number = 0;
    private freezeInterval: number = 8; // seconds between freezes

    constructor(game: Game, position: Vector3) {
        super(game, position, 9, 105, 1.5, 0, true);

        this.fusionTier = 2;
        this.maxLevel = 1;
        this.elementType = ElementType.NONE;
        this.secondaryEffectChance = 0.4;
        this.statusEffectDuration = 3;
        this.statusEffectStrength = 0.7;

        this.createMesh();
    }

    protected createMesh(): void {
        try {
            this.mesh = new Mesh('glacierTowerRoot', this.scene);
            this.mesh.position = this.position.clone();

            // Icy base
            const base = MeshBuilder.CreateCylinder('glacierBase', {
                height: 0.6, diameterTop: 2.4, diameterBottom: 2.8, tessellation: 6
            }, this.scene);
            makeFlatShaded(base);
            base.parent = this.mesh;
            base.position.y = 0.3;
            base.material = createLowPolyMaterial('glacierBaseMat', PALETTE.TOWER_GLACIER_DEEP, this.scene);

            // Crystal spire body
            const body = MeshBuilder.CreateCylinder('glacierBody', {
                height: 3.0, diameterTop: 0.6, diameterBottom: 1.8, tessellation: 5
            }, this.scene);
            makeFlatShaded(body);
            body.parent = this.mesh;
            body.position.y = 2.1;
            body.material = createLowPolyMaterial('glacierBodyMat', PALETTE.TOWER_GLACIER_ICE, this.scene);

            // Floating ice crystals orbiting
            for (let i = 0; i < 4; i++) {
                const angle = (i / 4) * Math.PI * 2;
                const crystal = MeshBuilder.CreateIcoSphere(`glacierCrystal${i}`, {
                    radius: 0.25, subdivisions: 0
                }, this.scene);
                makeFlatShaded(crystal);
                crystal.parent = this.mesh;
                crystal.position.x = Math.sin(angle) * 1.2;
                crystal.position.z = Math.cos(angle) * 1.2;
                crystal.position.y = 2.5 + (i % 2) * 0.4;
                crystal.material = createEmissiveMaterial(`glacierCrystalMat${i}`, PALETTE.TOWER_GLACIER_ICE, 0.5, this.scene);
            }

            // Ice crown at top
            const crown = MeshBuilder.CreateIcoSphere('glacierCrown', {
                radius: 0.4, subdivisions: 1
            }, this.scene);
            makeFlatShaded(crown);
            crown.parent = this.mesh;
            crown.position.y = 3.8;
            crown.material = createEmissiveMaterial('glacierCrownMat', PALETTE.TOWER_GLACIER_ICE, 0.7, this.scene);

            // Slow rotation
            const rotAnim = new Animation('glacierRot', 'rotation.y', 30,
                Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CYCLE);
            rotAnim.setKeys([
                { frame: 0, value: 0 },
                { frame: 300, value: Math.PI * 2 }
            ]);
            crown.animations = [rotAnim];
            this.scene.beginAnimation(crown, 0, 300, true);

            // Frost particles
            this.frostParticles = new ParticleSystem('glacierFrost', 30, this.scene);
            this.frostParticles.emitter = new Vector3(this.position.x, this.position.y + 2, this.position.z);
            this.frostParticles.minEmitBox = new Vector3(-1.5, 0, -1.5);
            this.frostParticles.maxEmitBox = new Vector3(1.5, 0.5, 1.5);
            this.frostParticles.minSize = 0.08;
            this.frostParticles.maxSize = 0.2;
            this.frostParticles.minLifeTime = 1.0;
            this.frostParticles.maxLifeTime = 3.0;
            this.frostParticles.emitRate = 10;
            this.frostParticles.color1 = new Color4(0.7, 0.9, 1, 0.5);
            this.frostParticles.color2 = new Color4(0.5, 0.7, 1, 0.3);
            this.frostParticles.colorDead = new Color4(0.3, 0.5, 0.7, 0);
            this.frostParticles.direction1 = new Vector3(-0.2, 0.5, -0.2);
            this.frostParticles.direction2 = new Vector3(0.2, 1.5, 0.2);
            this.frostParticles.minEmitPower = 0.1;
            this.frostParticles.maxEmitPower = 0.5;
            this.frostParticles.updateSpeed = 0.01;
            this.frostParticles.start();
        } catch (error) {
            console.error('Error creating Glacier Tower mesh:', error);
        }
    }

    public update(deltaTime: number): void {
        super.update(deltaTime);

        // Periodic freeze pulse
        this.freezeTimer += deltaTime;
        if (this.freezeTimer >= this.freezeInterval) {
            this.freezeTimer = 0;
            // Freeze will be applied on next fire
        }
    }

    protected fire(): void {
        if (!this.targetEnemy) return;

        const targetPos = this.targetEnemy.getPosition().clone();
        const finalDamage = this.calculateDamage(this.targetEnemy);
        this.targetEnemy.takeDamage(finalDamage);

        // Always slow
        this.applyStatusEffect(this.targetEnemy, StatusEffect.SLOWED, this.statusEffectDuration, this.statusEffectStrength);

        // Chance to freeze
        if (Math.random() < this.secondaryEffectChance) {
            this.applyStatusEffect(this.targetEnemy, StatusEffect.FROZEN, 1.5, 1.0);
        }

        this.createProjectileEffect(targetPos);
        this.game.getAssetManager().playSound('towerShoot');
    }

    public dispose(): void {
        if (this.frostParticles) {
            this.frostParticles.stop();
            this.frostParticles.dispose();
        }
        super.dispose();
    }
}
