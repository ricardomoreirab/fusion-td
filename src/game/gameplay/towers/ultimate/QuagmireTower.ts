import { Vector3, MeshBuilder, Color3, Color4, ParticleSystem, Mesh, Animation } from '@babylonjs/core';
import { Game } from '../../../Game';
import { Tower, ElementType, StatusEffect, EnemyType } from '../Tower';
import { Enemy } from '../../enemies/Enemy';
import { createLowPolyMaterial, createEmissiveMaterial, makeFlatShaded } from '../../../rendering/LowPolyMaterial';
import { PALETTE } from '../../../rendering/StyleConstants';

/**
 * Quagmire Tower — Ultimate fusion of Mud+Mud
 * Area denial + armor shred, AOE 5
 */
export class QuagmireTower extends Tower {
    private areaOfEffect: number = 5;
    private mudParticles: ParticleSystem | null = null;

    constructor(game: Game, position: Vector3) {
        super(game, position, 7, 75, 1.2, 0, true);

        this.fusionTier = 2;
        this.maxLevel = 1;
        this.elementType = ElementType.NONE;
        this.secondaryEffectChance = 0.6;
        this.statusEffectDuration = 4;
        this.statusEffectStrength = 0.7;

        this.createMesh();
    }

    protected createMesh(): void {
        try {
            this.mesh = new Mesh('quagmireTowerRoot', this.scene);
            this.mesh.position = this.position.clone();

            // Muddy base with wide spread
            const base = MeshBuilder.CreateCylinder('quagmireBase', {
                height: 0.5, diameterTop: 3.0, diameterBottom: 3.4, tessellation: 8
            }, this.scene);
            makeFlatShaded(base);
            base.parent = this.mesh;
            base.position.y = 0.25;
            base.material = createLowPolyMaterial('quagmireBaseMat', PALETTE.TOWER_QUAGMIRE_MUD, this.scene);

            // Muddy mound body
            const body = MeshBuilder.CreateCylinder('quagmireBody', {
                height: 2.0, diameterTop: 1.4, diameterBottom: 2.2, tessellation: 7
            }, this.scene);
            makeFlatShaded(body);
            body.parent = this.mesh;
            body.position.y = 1.5;
            body.material = createLowPolyMaterial('quagmireBodyMat', PALETTE.TOWER_MUD_DARK, this.scene);

            // Slime veins
            for (let i = 0; i < 3; i++) {
                const ring = MeshBuilder.CreateTorus(`quagmireVein${i}`, {
                    diameter: 1.8 - i * 0.3, thickness: 0.1, tessellation: 8
                }, this.scene);
                makeFlatShaded(ring);
                ring.parent = this.mesh;
                ring.position.y = 0.8 + i * 0.6;
                ring.material = createEmissiveMaterial(`quagmireVeinMat${i}`, PALETTE.TOWER_QUAGMIRE_SLIME, 0.4, this.scene);
            }

            // Toxic pool at top
            const pool = MeshBuilder.CreateDisc('quagmirePool', { radius: 0.6, tessellation: 8 }, this.scene);
            makeFlatShaded(pool);
            pool.parent = this.mesh;
            pool.position.y = 2.55;
            pool.rotation.x = -Math.PI / 2;
            const poolMat = createEmissiveMaterial('quagmirePoolMat', PALETTE.TOWER_QUAGMIRE_SLIME, 0.5, this.scene);
            poolMat.alpha = 0.8;
            pool.material = poolMat;

            // Bubbling animation
            const bubbleAnim = new Animation('quagmireBubble', 'scaling', 30,
                Animation.ANIMATIONTYPE_VECTOR3, Animation.ANIMATIONLOOPMODE_CYCLE);
            bubbleAnim.setKeys([
                { frame: 0, value: new Vector3(1, 1, 1) },
                { frame: 25, value: new Vector3(1.08, 1.08, 1) },
                { frame: 50, value: new Vector3(1, 1, 1) }
            ]);
            pool.animations = [bubbleAnim];
            this.scene.beginAnimation(pool, 0, 50, true);

            // Mushroom/vine growths around
            for (let i = 0; i < 5; i++) {
                const angle = (i / 5) * Math.PI * 2;
                const vine = MeshBuilder.CreateCylinder(`quagmireVine${i}`, {
                    height: 0.8 + Math.random() * 0.4, diameter: 0.12, tessellation: 4
                }, this.scene);
                makeFlatShaded(vine);
                vine.parent = this.mesh;
                vine.position.x = Math.sin(angle) * 1.3;
                vine.position.z = Math.cos(angle) * 1.3;
                vine.position.y = 0.6;
                vine.rotation.z = (Math.random() - 0.5) * 0.3;
                vine.material = createLowPolyMaterial(`quagmireVineMat${i}`, PALETTE.TOWER_QUAGMIRE_SLIME, this.scene);
            }

            // Mud particles
            this.mudParticles = new ParticleSystem('quagmireMud', 20, this.scene);
            this.mudParticles.emitter = new Vector3(this.position.x, this.position.y + 2.5, this.position.z);
            this.mudParticles.minEmitBox = new Vector3(-0.5, 0, -0.5);
            this.mudParticles.maxEmitBox = new Vector3(0.5, 0, 0.5);
            this.mudParticles.minSize = 0.15;
            this.mudParticles.maxSize = 0.35;
            this.mudParticles.minLifeTime = 1.0;
            this.mudParticles.maxLifeTime = 2.5;
            this.mudParticles.emitRate = 8;
            this.mudParticles.color1 = new Color4(0.35, 0.45, 0.15, 0.7);
            this.mudParticles.color2 = new Color4(0.28, 0.18, 0.08, 0.5);
            this.mudParticles.colorDead = new Color4(0.2, 0.15, 0.05, 0);
            this.mudParticles.direction1 = new Vector3(-0.2, 0.5, -0.2);
            this.mudParticles.direction2 = new Vector3(0.2, 1.5, 0.2);
            this.mudParticles.minEmitPower = 0.2;
            this.mudParticles.maxEmitPower = 0.7;
            this.mudParticles.updateSpeed = 0.01;
            this.mudParticles.start();
        } catch (error) {
            console.error('Error creating Quagmire Tower mesh:', error);
        }
    }

    protected fire(): void {
        if (!this.targetEnemy) return;

        const targetPos = this.targetEnemy.getPosition().clone();
        const finalDamage = this.calculateDamage(this.targetEnemy);
        this.targetEnemy.takeDamage(finalDamage);

        // Heavy slow (armor shred concept = strong slow)
        this.applyStatusEffect(this.targetEnemy, StatusEffect.SLOWED, this.statusEffectDuration, this.statusEffectStrength);

        // Mud splash visual
        const ps = new ParticleSystem('mudSplash', 25, this.scene);
        ps.emitter = targetPos.clone();
        ps.minEmitBox = new Vector3(-0.5, 0, -0.5);
        ps.maxEmitBox = new Vector3(0.5, 0.2, 0.5);
        ps.minSize = 0.2;
        ps.maxSize = 0.5;
        ps.minLifeTime = 0.3;
        ps.maxLifeTime = 0.8;
        ps.emitRate = 40;
        ps.color1 = new Color4(0.35, 0.25, 0.12, 0.9);
        ps.color2 = new Color4(0.28, 0.18, 0.08, 0.7);
        ps.colorDead = new Color4(0.2, 0.15, 0.05, 0);
        ps.direction1 = new Vector3(-1, 1, -1);
        ps.direction2 = new Vector3(1, 2, 1);
        ps.minEmitPower = 0.5;
        ps.maxEmitPower = 2;
        ps.updateSpeed = 0.01;
        ps.start();
        setTimeout(() => { ps.stop(); setTimeout(() => ps.dispose(), 800); }, 200);

        this.createProjectileEffect(targetPos);
        this.game.getAssetManager().playSound('towerShoot');
    }

    public dispose(): void {
        if (this.mudParticles) {
            this.mudParticles.stop();
            this.mudParticles.dispose();
        }
        super.dispose();
    }
}
