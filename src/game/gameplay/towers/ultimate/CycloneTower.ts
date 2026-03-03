import { Vector3, MeshBuilder, Color3, Color4, ParticleSystem, Mesh, Animation } from '@babylonjs/core';
import { Game } from '../../../Game';
import { Tower, ElementType, StatusEffect, EnemyType } from '../Tower';
import { Enemy } from '../../enemies/Enemy';
import { createLowPolyMaterial, createEmissiveMaterial, makeFlatShaded } from '../../../rendering/LowPolyMaterial';
import { PALETTE } from '../../../rendering/StyleConstants';

/**
 * Cyclone Tower — Ultimate fusion of Dust+Dust
 * Map-wide confusion + sandstorm DOT, AOE 6
 */
export class CycloneTower extends Tower {
    private areaOfEffect: number = 6;
    private sandParticles: ParticleSystem | null = null;
    private vortexMesh: Mesh | null = null;

    constructor(game: Game, position: Vector3) {
        super(game, position, 10, 66, 1.5, 0, true);

        this.fusionTier = 2;
        this.maxLevel = 1;
        this.elementType = ElementType.NONE;
        this.secondaryEffectChance = 0.5;
        this.statusEffectDuration = 3;
        this.statusEffectStrength = 0.8;

        this.createMesh();
    }

    protected createMesh(): void {
        try {
            this.mesh = new Mesh('cycloneTowerRoot', this.scene);
            this.mesh.position = this.position.clone();

            // Sandy base
            const base = MeshBuilder.CreateCylinder('cycloneBase', {
                height: 0.6, diameterTop: 2.4, diameterBottom: 2.8, tessellation: 8
            }, this.scene);
            makeFlatShaded(base);
            base.parent = this.mesh;
            base.position.y = 0.3;
            base.material = createLowPolyMaterial('cycloneBaseMat', PALETTE.TOWER_DUST_ROCK, this.scene);

            // Sandstone pillar body
            const body = MeshBuilder.CreateCylinder('cycloneBody', {
                height: 2.5, diameterTop: 1.2, diameterBottom: 2.0, tessellation: 6
            }, this.scene);
            makeFlatShaded(body);
            body.parent = this.mesh;
            body.position.y = 1.85;
            body.material = createLowPolyMaterial('cycloneBodyMat', PALETTE.TOWER_CYCLONE_SAND, this.scene);

            // Wind bands
            for (let i = 0; i < 3; i++) {
                const ring = MeshBuilder.CreateTorus(`cycloneRing${i}`, {
                    diameter: 1.6 - i * 0.2, thickness: 0.06, tessellation: 12
                }, this.scene);
                makeFlatShaded(ring);
                ring.parent = this.mesh;
                ring.position.y = 1.2 + i * 0.7;
                ring.material = createEmissiveMaterial(`cycloneRingMat${i}`, PALETTE.TOWER_CYCLONE_STORM, 0.3, this.scene);

                // Spin animation
                const spinAnim = new Animation(`cycloneSpin${i}`, 'rotation.y', 30,
                    Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CYCLE);
                const speed = 120 + i * 40;
                spinAnim.setKeys([
                    { frame: 0, value: 0 },
                    { frame: speed, value: Math.PI * 2 * (i % 2 === 0 ? 1 : -1) }
                ]);
                ring.animations = [spinAnim];
                this.scene.beginAnimation(ring, 0, speed, true);
            }

            // Vortex funnel at top
            this.vortexMesh = MeshBuilder.CreateCylinder('cycloneVortex', {
                height: 1.5, diameterTop: 0.3, diameterBottom: 1.4, tessellation: 8
            }, this.scene);
            makeFlatShaded(this.vortexMesh);
            this.vortexMesh.parent = this.mesh;
            this.vortexMesh.position.y = 3.85;
            const vortexMat = createEmissiveMaterial('cycloneVortexMat', PALETTE.TOWER_CYCLONE_STORM, 0.4, this.scene);
            vortexMat.alpha = 0.6;
            this.vortexMesh.material = vortexMat;

            // Vortex spin
            const vortexSpin = new Animation('cycloneVortexSpin', 'rotation.y', 30,
                Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CYCLE);
            vortexSpin.setKeys([
                { frame: 0, value: 0 },
                { frame: 60, value: Math.PI * 2 }
            ]);
            this.vortexMesh.animations = [vortexSpin];
            this.scene.beginAnimation(this.vortexMesh, 0, 60, true);

            // Sand particles
            this.sandParticles = new ParticleSystem('cycloneSand', 40, this.scene);
            this.sandParticles.emitter = new Vector3(this.position.x, this.position.y + 3, this.position.z);
            this.sandParticles.minEmitBox = new Vector3(-1, 0, -1);
            this.sandParticles.maxEmitBox = new Vector3(1, 0, 1);
            this.sandParticles.minSize = 0.1;
            this.sandParticles.maxSize = 0.3;
            this.sandParticles.minLifeTime = 0.5;
            this.sandParticles.maxLifeTime = 2.0;
            this.sandParticles.emitRate = 20;
            this.sandParticles.color1 = new Color4(0.85, 0.75, 0.55, 0.7);
            this.sandParticles.color2 = new Color4(0.65, 0.58, 0.42, 0.5);
            this.sandParticles.colorDead = new Color4(0.5, 0.45, 0.35, 0);
            this.sandParticles.direction1 = new Vector3(-1.5, 0.5, -1.5);
            this.sandParticles.direction2 = new Vector3(1.5, 2, 1.5);
            this.sandParticles.minEmitPower = 0.5;
            this.sandParticles.maxEmitPower = 2;
            this.sandParticles.updateSpeed = 0.01;
            this.sandParticles.start();
        } catch (error) {
            console.error('Error creating Cyclone Tower mesh:', error);
        }
    }

    protected fire(): void {
        if (!this.targetEnemy) return;

        const targetPos = this.targetEnemy.getPosition().clone();
        const finalDamage = this.calculateDamage(this.targetEnemy);
        this.targetEnemy.takeDamage(finalDamage);

        // Confusion effect
        this.applyStatusEffect(this.targetEnemy, StatusEffect.CONFUSED, this.statusEffectDuration, this.statusEffectStrength);

        // Sandstorm DOT via burning (reusing status effect)
        if (Math.random() < this.secondaryEffectChance) {
            this.applyStatusEffect(this.targetEnemy, StatusEffect.BURNING, 2, 0.15);
        }

        // Sandstorm impact visual
        const ps = new ParticleSystem('sandImpact', 30, this.scene);
        ps.emitter = targetPos.clone();
        ps.minEmitBox = new Vector3(-0.8, 0, -0.8);
        ps.maxEmitBox = new Vector3(0.8, 0.3, 0.8);
        ps.minSize = 0.2;
        ps.maxSize = 0.5;
        ps.minLifeTime = 0.4;
        ps.maxLifeTime = 1.0;
        ps.emitRate = 50;
        ps.color1 = new Color4(0.85, 0.75, 0.55, 0.8);
        ps.color2 = new Color4(0.65, 0.58, 0.42, 0.6);
        ps.colorDead = new Color4(0.5, 0.45, 0.35, 0);
        ps.direction1 = new Vector3(-1, 0.5, -1);
        ps.direction2 = new Vector3(1, 1.5, 1);
        ps.minEmitPower = 0.5;
        ps.maxEmitPower = 2;
        ps.updateSpeed = 0.01;
        ps.start();
        setTimeout(() => { ps.stop(); setTimeout(() => ps.dispose(), 1000); }, 300);

        this.createProjectileEffect(targetPos);
        this.game.getAssetManager().playSound('towerShoot');
    }

    public dispose(): void {
        if (this.sandParticles) {
            this.sandParticles.stop();
            this.sandParticles.dispose();
        }
        super.dispose();
    }
}
