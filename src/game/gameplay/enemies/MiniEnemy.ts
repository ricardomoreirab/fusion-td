import { Vector3, MeshBuilder, StandardMaterial, Color3, Color4, ParticleSystem, Texture, Mesh } from '@babylonjs/core';
import { Game } from '../../Game';
import { Enemy } from './Enemy';
import { createLowPolyMaterial, createEmissiveMaterial, makeFlatShaded } from '../../rendering/LowPolyMaterial';
import { PALETTE } from '../../rendering/StyleConstants';

/**
 * MiniEnemy — spawned when a SplittingEnemy dies.
 * Small, fast, low HP/damage/reward.
 */
export class MiniEnemy extends Enemy {
    private walkTime: number = 0;

    constructor(game: Game, position: Vector3, path: Vector3[]) {
        // Mini enemy: fast, low HP, low damage, small reward
        super(game, position, path, 5, 10, 3, 5);
        this.contactDamagePerSecond = 3;
    }

    protected createMesh(): void {
        // Small blob body
        this.mesh = MeshBuilder.CreateBox('miniEnemyBody', {
            width: 0.40,
            height: 0.30,
            depth: 0.35
        }, this.scene);
        makeFlatShaded(this.mesh);
        this.mesh.position = this.position.clone();
        this.mesh.position.y += 0.25;
        this.mesh.material = createLowPolyMaterial('miniBodyMat', PALETTE.ENEMY_SPLITTING, this.scene);

        // Belly
        const belly = MeshBuilder.CreateBox('miniBelly', {
            width: 0.28, height: 0.18, depth: 0.06
        }, this.scene);
        makeFlatShaded(belly);
        belly.parent = this.mesh;
        belly.position = new Vector3(0, -0.02, 0.18);
        belly.material = createLowPolyMaterial('miniBellyMat', PALETTE.ENEMY_SPLITTING_BELLY, this.scene);

        // Single head nub
        const head = MeshBuilder.CreateCylinder('miniHead', {
            height: 0.20, diameterTop: 0.05, diameterBottom: 0.15, tessellation: 4
        }, this.scene);
        makeFlatShaded(head);
        head.parent = this.mesh;
        head.position = new Vector3(0, 0.22, 0.08);
        head.material = createLowPolyMaterial('miniHeadMat', PALETTE.ENEMY_SPLITTING, this.scene);

        // Eyes
        for (let i = 0; i < 2; i++) {
            const eye = MeshBuilder.CreateBox(`miniEye${i}`, {
                width: 0.06, height: 0.04, depth: 0.03
            }, this.scene);
            makeFlatShaded(eye);
            eye.parent = head;
            eye.position = new Vector3(i === 0 ? -0.04 : 0.04, 0.02, 0.07);
            eye.material = createEmissiveMaterial(`miniEyeMat${i}`, PALETTE.ENEMY_SPLITTING_EYE, 0.8, this.scene);
        }

        this.originalScale = 1.0;
    }

    protected createHealthBar(): void {
        if (!this.mesh) return;

        this.healthBarOutlineMesh = MeshBuilder.CreateBox('healthBarOutline', {
            width: 0.65, height: 0.10, depth: 0.03
        }, this.scene);
        this.healthBarOutlineMesh.position = new Vector3(this.position.x, this.position.y + 0.9, this.position.z);
        const outlineMat = new StandardMaterial('healthBarOutlineMat', this.scene);
        outlineMat.diffuseColor = new Color3(0, 0, 0);
        outlineMat.specularColor = Color3.Black();
        this.healthBarOutlineMesh.material = outlineMat;

        this.healthBarBackgroundMesh = MeshBuilder.CreateBox('healthBarBg', {
            width: 0.6, height: 0.06, depth: 0.04
        }, this.scene);
        this.healthBarBackgroundMesh.position = new Vector3(this.position.x, this.position.y + 0.9, this.position.z);
        const bgMat = new StandardMaterial('healthBarBgMat', this.scene);
        bgMat.diffuseColor = new Color3(0.3, 0.3, 0.3);
        bgMat.specularColor = Color3.Black();
        this.healthBarBackgroundMesh.material = bgMat;

        this.healthBarMesh = MeshBuilder.CreateBox('healthBar', {
            width: 0.6, height: 0.06, depth: 0.05
        }, this.scene);
        this.healthBarMesh.position = new Vector3(this.position.x, this.position.y + 0.9, this.position.z);
        const healthMat = new StandardMaterial('healthBarMat', this.scene);
        healthMat.diffuseColor = new Color3(0.2, 0.8, 0.2);
        healthMat.specularColor = Color3.Black();
        this.healthBarMesh.material = healthMat;

        this.healthBarOutlineMesh.billboardMode = Mesh.BILLBOARDMODE_ALL;
        this.healthBarBackgroundMesh.billboardMode = Mesh.BILLBOARDMODE_ALL;
        this.healthBarMesh.billboardMode = Mesh.BILLBOARDMODE_ALL;
        this.updateHealthBar();
    }

    protected updateHealthBar(): void {
        if (!this.mesh || !this.healthBarMesh || !this.healthBarBackgroundMesh) return;
        const healthPercent = Math.max(0, this.health / this.maxHealth);
        this.healthBarMesh.scaling.x = healthPercent;
        const offset = (1 - healthPercent) * 0.3;
        this.healthBarMesh.position.x = this.position.x - offset;

        const material = this.healthBarMesh.material as StandardMaterial;
        if (healthPercent > 0.6) material.diffuseColor = new Color3(0.2, 0.8, 0.2);
        else if (healthPercent > 0.3) material.diffuseColor = new Color3(0.8, 0.8, 0.2);
        else material.diffuseColor = new Color3(0.8, 0.2, 0.2);

        if (this.healthBarOutlineMesh && !this.healthBarOutlineMesh.isDisposed()) {
            this.healthBarOutlineMesh.position.x = this.position.x;
            this.healthBarOutlineMesh.position.y = this.position.y + 0.9;
            this.healthBarOutlineMesh.position.z = this.position.z;
        }
        this.healthBarBackgroundMesh.position.x = this.position.x;
        this.healthBarBackgroundMesh.position.y = this.position.y + 0.9;
        this.healthBarBackgroundMesh.position.z = this.position.z;
        this.healthBarMesh.position.y = this.position.y + 0.9;
        this.healthBarMesh.position.z = this.position.z;
    }

    public update(deltaTime: number): boolean {
        if (!this.alive || !this.mesh) return false;
        const result = super.update(deltaTime);

        if (!this.isFrozen && !this.isStunned && this.currentPathIndex < this.path.length && this.mesh) {
            this.walkTime += deltaTime * 8;
            const bobAmount = Math.abs(Math.sin(this.walkTime)) * 0.04;
            this.mesh.position.y = this.position.y + 0.25 + bobAmount;
            this.mesh.rotation.z = Math.sin(this.walkTime) * 0.1;

            if (this.currentPathIndex < this.path.length) {
                const targetPoint = this.path[this.currentPathIndex];
                const direction = targetPoint.subtract(this.position);
                if (direction.length() > 0.01) {
                    const angle = Math.atan2(direction.z, direction.x);
                    this.mesh.rotation.y = -angle + Math.PI / 2;
                }
            }
        }

        return result;
    }

    protected createDeathEffect(): void {
        if (!this.mesh) return;
        const ps = new ParticleSystem('miniDeathParticles', 20, this.scene);
        ps.emitter = this.position.clone();
        (ps.emitter as Vector3).y += 0.3;
        ps.minEmitBox = new Vector3(-0.1, 0, -0.1);
        ps.maxEmitBox = new Vector3(0.1, 0, 0.1);
        ps.color1 = new Color4(0.3, 0.7, 0.5, 1.0);
        ps.color2 = new Color4(0.5, 0.8, 0.4, 1.0);
        ps.colorDead = new Color4(0.2, 0.3, 0.1, 0.0);
        ps.minSize = 0.05;
        ps.maxSize = 0.2;
        ps.minLifeTime = 0.2;
        ps.maxLifeTime = 0.6;
        ps.emitRate = 60;
        ps.blendMode = ParticleSystem.BLENDMODE_ONEONE;
        ps.gravity = new Vector3(0, 5, 0);
        ps.direction1 = new Vector3(-1, 5, -1);
        ps.direction2 = new Vector3(1, 5, 1);
        ps.minEmitPower = 0.5;
        ps.maxEmitPower = 2;
        ps.start();
        this.game.getAssetManager().playSound('enemyDeath');
        setTimeout(() => { ps.stop(); setTimeout(() => ps.dispose(), 500); }, 500);

        // Gold reward float
        this.showGoldRewardText(this.position.clone());
    }
}
