import { Vector3, MeshBuilder, Color3, Color4, ParticleSystem, Mesh, Animation } from '@babylonjs/core';
import { Game } from '../../../Game';
import { Tower, ElementType, StatusEffect, EnemyType } from '../Tower';
import { Enemy } from '../../enemies/Enemy';
import { createLowPolyMaterial, createEmissiveMaterial, makeFlatShaded } from '../../../rendering/LowPolyMaterial';
import { PALETTE } from '../../../rendering/StyleConstants';

/**
 * Tempest Tower — Ultimate fusion of Storm+Storm
 * Chain lightning to 6 targets + stun
 */
export class TempestTower extends Tower {
    private stormParticles: ParticleSystem | null = null;
    private orbMesh: Mesh | null = null;

    constructor(game: Game, position: Vector3) {
        super(game, position, 9, 120, 2.0, 0, true);

        this.fusionTier = 2;
        this.maxLevel = 1;
        this.elementType = ElementType.NONE;
        this.secondaryEffectChance = 0.35;
        this.statusEffectDuration = 1.5;
        this.statusEffectStrength = 1.0;

        this.createMesh();
    }

    protected createMesh(): void {
        try {
            this.mesh = new Mesh('tempestTowerRoot', this.scene);
            this.mesh.position = this.position.clone();

            // Dark storm base
            const base = MeshBuilder.CreateCylinder('tempestBase', {
                height: 0.7, diameterTop: 2.4, diameterBottom: 2.8, tessellation: 6
            }, this.scene);
            makeFlatShaded(base);
            base.parent = this.mesh;
            base.position.y = 0.35;
            base.material = createLowPolyMaterial('tempestBaseMat', PALETTE.TOWER_TEMPEST_CLOUD, this.scene);

            // Tall dark spire
            const body = MeshBuilder.CreateCylinder('tempestBody', {
                height: 3.2, diameterTop: 0.8, diameterBottom: 1.8, tessellation: 6
            }, this.scene);
            makeFlatShaded(body);
            body.parent = this.mesh;
            body.position.y = 2.3;
            body.material = createLowPolyMaterial('tempestBodyMat', PALETTE.TOWER_STORM_DARK, this.scene);

            // Lightning conductor rods
            for (let i = 0; i < 4; i++) {
                const angle = (i / 4) * Math.PI * 2;
                const rod = MeshBuilder.CreateCylinder(`tempestRod${i}`, {
                    height: 1.0, diameter: 0.1, tessellation: 4
                }, this.scene);
                makeFlatShaded(rod);
                rod.parent = this.mesh;
                rod.position.x = Math.sin(angle) * 0.6;
                rod.position.z = Math.cos(angle) * 0.6;
                rod.position.y = 4.0;
                rod.material = createEmissiveMaterial(`tempestRodMat${i}`, PALETTE.TOWER_TEMPEST_BOLT, 0.6, this.scene);
            }

            // Storm orb at top
            this.orbMesh = MeshBuilder.CreateIcoSphere('tempestOrb', {
                radius: 0.45, subdivisions: 1
            }, this.scene);
            makeFlatShaded(this.orbMesh);
            this.orbMesh.parent = this.mesh;
            this.orbMesh.position.y = 4.2;
            this.orbMesh.material = createEmissiveMaterial('tempestOrbMat', PALETTE.TOWER_STORM_ORB, 0.8, this.scene);

            // Orb pulse
            const pulseAnim = new Animation('tempestPulse', 'scaling', 30,
                Animation.ANIMATIONTYPE_VECTOR3, Animation.ANIMATIONLOOPMODE_CYCLE);
            pulseAnim.setKeys([
                { frame: 0, value: new Vector3(1, 1, 1) },
                { frame: 15, value: new Vector3(1.15, 1.15, 1.15) },
                { frame: 30, value: new Vector3(1, 1, 1) }
            ]);
            this.orbMesh.animations = [pulseAnim];
            this.scene.beginAnimation(this.orbMesh, 0, 30, true);

            // Storm particles
            this.stormParticles = new ParticleSystem('tempestStorm', 30, this.scene);
            this.stormParticles.emitter = new Vector3(this.position.x, this.position.y + 4.2, this.position.z);
            this.stormParticles.minEmitBox = new Vector3(-0.3, 0, -0.3);
            this.stormParticles.maxEmitBox = new Vector3(0.3, 0, 0.3);
            this.stormParticles.minSize = 0.1;
            this.stormParticles.maxSize = 0.25;
            this.stormParticles.minLifeTime = 0.3;
            this.stormParticles.maxLifeTime = 0.8;
            this.stormParticles.emitRate = 15;
            this.stormParticles.color1 = new Color4(0.7, 0.7, 1, 0.8);
            this.stormParticles.color2 = new Color4(0.5, 0.5, 1, 0.6);
            this.stormParticles.colorDead = new Color4(0.3, 0.3, 0.5, 0);
            this.stormParticles.direction1 = new Vector3(-1, 0.5, -1);
            this.stormParticles.direction2 = new Vector3(1, 1.5, 1);
            this.stormParticles.minEmitPower = 0.5;
            this.stormParticles.maxEmitPower = 1.5;
            this.stormParticles.updateSpeed = 0.01;
            this.stormParticles.start();
        } catch (error) {
            console.error('Error creating Tempest Tower mesh:', error);
        }
    }

    protected fire(): void {
        if (!this.targetEnemy) return;

        const targetPos = this.targetEnemy.getPosition().clone();
        const chainCount = 6;
        const decayRate = 0.85;
        let currentDamage = this.calculateDamage(this.targetEnemy);

        // Hit primary target
        this.targetEnemy.takeDamage(currentDamage);
        if (Math.random() < this.secondaryEffectChance) {
            this.applyStatusEffect(this.targetEnemy, StatusEffect.STUNNED, this.statusEffectDuration, this.statusEffectStrength);
        }

        this.createProjectileEffect(targetPos);
        this.game.getAssetManager().playSound('towerShoot');
    }

    public dispose(): void {
        if (this.stormParticles) {
            this.stormParticles.stop();
            this.stormParticles.dispose();
        }
        super.dispose();
    }
}
