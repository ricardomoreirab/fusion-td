import { Vector3, MeshBuilder, StandardMaterial, Color3, Color4, ParticleSystem, Texture, Mesh, AssetContainer, AnimationGroup, TransformNode, Quaternion } from '@babylonjs/core';
import { Game } from '../../engine/Game';
import { Enemy, HEALTH_COLOR_GREEN, HEALTH_COLOR_YELLOW, HEALTH_COLOR_RED, tryAcquireDeathBurst, releaseDeathBurst } from './Enemy';
import { createLowPolyMaterial, createEmissiveMaterial, makeFlatShaded } from '../../engine/rendering/LowPolyMaterial';
import { PALETTE } from '../../engine/rendering/StyleConstants';

/**
 * MiniEnemy — spawned when a SplittingEnemy dies.
 * Small, fast, low HP/damage/reward.
 */
export class MiniEnemy extends Enemy {
    /** Static slot used by EnemyManager (split handler) to stage a preloaded GLB
     *  asset before constructing a MiniEnemy. createMesh() consumes + clears it. */
    public static pendingAsset: AssetContainer | null = null;

    private walkTime: number = 0;

    /** True when this instance renders via the thunder-fenrir-cab GLB. */
    private usingGLB: boolean = false;
    private glbWalkAnim: AnimationGroup | null = null;
    private glbAttackAnim: AnimationGroup | null = null;
    private glbIdleAnim: AnimationGroup | null = null;
    private glbCurrentAnim: AnimationGroup | null = null;
    private glbAttackHoldTimer: number = 0;
    private static readonly GLB_ATTACK_RANGE = 2.8;
    private static readonly GLB_ATTACK_HOLD = 0.5;
    private static readonly GLB_SCALE = 0.6;

    constructor(game: Game, position: Vector3, path: Vector3[]) {
        // Mini enemy: fast, low HP, low damage, small reward
        super(game, position, path, 5, 10, 3, 5);
        this.contactDamagePerSecond = 3;

        // Tiny snap — quick, low-damage melee.
        this.meleeRange            = 1.1;
        this.meleeHitRange         = 1.4;
        this.meleeHitDamage        = 4;
        this.meleeWindupDuration   = 0.2;
        this.meleeStrikeDuration   = 0.08;
        this.meleeCooldownDuration = 0.3;

        // Build mesh + health bar AFTER field initializers have run (see Enemy
        // constructor note). new.target guard → fires only for the concrete leaf.
        if (new.target === MiniEnemy) this._initEnemyVisuals();
    }

    protected createMesh(): void {
        const asset = MiniEnemy.pendingAsset;
        MiniEnemy.pendingAsset = null;
        if (asset) {
            this.createMeshFromGLB(asset);
            return;
        }
        this.createMeshProcedural();
    }

    private createMeshFromGLB(asset: AssetContainer): void {
        this.usingGLB = true;
        this.mesh = new Mesh('miniEnemyGlbRoot', this.scene);
        this.mesh.position.copyFrom(this.position);

        const inst = asset.instantiateModelsToScene(
            name => `mini_${name}`,
            true,
            { doNotInstantiate: true },
        );
        for (const root of inst.rootNodes) {
            root.parent = this.mesh;
            if ('scaling' in root && root.scaling) {
                (root as TransformNode).scaling.scaleInPlace(MiniEnemy.GLB_SCALE);
            }
            const tn = root as TransformNode;
            const flip = Quaternion.RotationYawPitchRoll(Math.PI, 0, 0);
            if (tn.rotationQuaternion) {
                tn.rotationQuaternion = flip.multiply(tn.rotationQuaternion);
            } else if (tn.rotation) {
                tn.rotation.y += Math.PI;
            }
        }

        this.mesh.computeWorldMatrix(true);
        const bbox = this.mesh.getHierarchyBoundingVectors(true);
        const feetOffset = -bbox.min.y;
        for (const root of inst.rootNodes) {
            if ('position' in root && root.position) {
                (root as TransformNode).position.y += feetOffset;
            }
        }

        // Register groups for base-class dispose cleanup (prevents animatable leak).
        this.glbAnimationGroups = inst.animationGroups;
        this.glbSkeletons = inst.skeletons;

        for (const ag of inst.animationGroups) ag.stop();
        for (const ag of inst.animationGroups) {
            const n = ag.name.toLowerCase();
            if (!this.glbWalkAnim && (n.includes('walk') || n.includes('run') || n.includes('move'))) {
                this.glbWalkAnim = ag;
            } else if (!this.glbAttackAnim && (n.includes('attack') || n.includes('bite') || n.includes('hit') || n.includes('strike') || n.includes('swing') || n.includes('lunge'))) {
                this.glbAttackAnim = ag;
            } else if (!this.glbIdleAnim && (n.includes('idle') || n === 'stand')) {
                this.glbIdleAnim = ag;
            }
        }
        if (!this.glbWalkAnim && inst.animationGroups.length > 0) this.glbWalkAnim = inst.animationGroups[0];
        if (!this.glbIdleAnim) this.glbIdleAnim = this.glbWalkAnim;
        if (!this.glbAttackAnim) this.glbAttackAnim = this.glbWalkAnim;
        if (this.glbWalkAnim) {
            this.glbWalkAnim.start(true);
            this.glbCurrentAnim = this.glbWalkAnim;
        }
    }

    private playGlbAnim(slot: AnimationGroup | null, loop: boolean): void {
        if (!slot) return;
        if (this.glbCurrentAnim === slot) return;
        if (this.glbCurrentAnim) this.glbCurrentAnim.stop();
        slot.start(loop);
        this.glbCurrentAnim = slot;
    }

    private createMeshProcedural(): void {
        // Small blob body — bumped 1.1× from original 0.40/0.30/0.35 for readability
        this.mesh = MeshBuilder.CreateBox('miniEnemyBody', {
            width: 0.44,
            height: 0.33,
            depth: 0.39
        }, this.scene);
        makeFlatShaded(this.mesh);
        this.mesh.position = this.position.clone();
        this.mesh.position.y += 0.28;
        // Slightly brighter tint (splitter parentage cue) — lighter cyan-green
        const miniBodyColor = PALETTE.ENEMY_SPLITTING_BELLY;
        this.mesh.material = createLowPolyMaterial('miniBodyMat', miniBodyColor, this.scene);

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
        this.healthBarOutlineMesh.position = new Vector3(this.position.x, this.position.y + 1.0, this.position.z);
        const outlineMat = new StandardMaterial('healthBarOutlineMat', this.scene);
        outlineMat.diffuseColor = new Color3(0, 0, 0);
        outlineMat.specularColor = Color3.Black();
        this.healthBarOutlineMesh.material = outlineMat;

        this.healthBarBackgroundMesh = MeshBuilder.CreateBox('healthBarBg', {
            width: 0.6, height: 0.06, depth: 0.04
        }, this.scene);
        this.healthBarBackgroundMesh.position = new Vector3(this.position.x, this.position.y + 1.0, this.position.z);
        const bgMat = new StandardMaterial('healthBarBgMat', this.scene);
        bgMat.diffuseColor = new Color3(0.3, 0.3, 0.3);
        bgMat.specularColor = Color3.Black();
        this.healthBarBackgroundMesh.material = bgMat;

        this.healthBarMesh = MeshBuilder.CreateBox('healthBar', {
            width: 0.6, height: 0.06, depth: 0.05
        }, this.scene);
        this.healthBarMesh.position = new Vector3(this.position.x, this.position.y + 1.0, this.position.z);
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
        if (healthPercent > 0.6) material.diffuseColor = HEALTH_COLOR_GREEN;
        else if (healthPercent > 0.3) material.diffuseColor = HEALTH_COLOR_YELLOW;
        else material.diffuseColor = HEALTH_COLOR_RED;

        if (this.healthBarOutlineMesh && !this.healthBarOutlineMesh.isDisposed()) {
            this.healthBarOutlineMesh.position.x = this.position.x;
            this.healthBarOutlineMesh.position.y = this.position.y + 1.0;
            this.healthBarOutlineMesh.position.z = this.position.z;
        }
        this.healthBarBackgroundMesh.position.x = this.position.x;
        this.healthBarBackgroundMesh.position.y = this.position.y + 1.0;
        this.healthBarBackgroundMesh.position.z = this.position.z;
        this.healthBarMesh.position.y = this.position.y + 1.0;
        this.healthBarMesh.position.z = this.position.z;
    }

    public update(deltaTime: number): boolean {
        if (!this.alive || !this.mesh) return false;
        const result = super.update(deltaTime);

        if (this.usingGLB) {
            if (this.glbAttackHoldTimer > 0) {
                this.glbAttackHoldTimer = Math.max(0, this.glbAttackHoldTimer - deltaTime);
            }
            if (this.isFrozen || this.isStunned) {
                this.playGlbAnim(this.glbIdleAnim, true);
            } else if (this.seekTarget) {
                const heroPos = this.seekTarget.getPosition();
                const dx = heroPos.x - this.position.x;
                const dz = heroPos.z - this.position.z;
                const distSq = dx * dx + dz * dz;
                const inRange = distSq <= MiniEnemy.GLB_ATTACK_RANGE * MiniEnemy.GLB_ATTACK_RANGE;
                if (inRange) {
                    this.glbAttackHoldTimer = MiniEnemy.GLB_ATTACK_HOLD;
                }
                if (this.glbAttackHoldTimer > 0) {
                    this.playGlbAnim(this.glbAttackAnim, true);
                } else {
                    this.playGlbAnim(this.glbWalkAnim, true);
                }
            } else {
                this.playGlbAnim(this.glbWalkAnim, true);
            }
            return result;
        }

        if (!this.isFrozen && !this.isStunned && this.currentPathIndex < this.path.length && this.mesh) {
            this.walkTime += deltaTime * 8;
            const bobAmount = Math.abs(Math.sin(this.walkTime)) * 0.04;
            this.mesh.position.y = this.position.y + 0.28 + bobAmount;
            this.mesh.rotation.z = Math.sin(this.walkTime) * 0.1;

            if (this.currentPathIndex < this.path.length) {
                const targetPoint = this.path[this.currentPathIndex];
                const dx = targetPoint.x - this.position.x;
                const dz = targetPoint.z - this.position.z;
                if (dx * dx + dz * dz > 0.0001) {
                    const angle = Math.atan2(dz, dx);
                    this.mesh.rotation.y = -angle + Math.PI / 2;
                }
            }
        }

        return result;
    }

    protected createDeathEffect(): void {
        if (!this.mesh) return;

        // Cap concurrent death-burst particle systems (mass-AoE-kill spike guard).
        // Past the cap, skip only the poof — sound + gold reward still happen.
        if (!tryAcquireDeathBurst()) {
            this.game.getAssetManager().playSound('enemyDeath');
            this.showGoldRewardText(this.position.clone());
            return;
        }

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
        setTimeout(() => { ps.stop(); setTimeout(() => { ps.dispose(); releaseDeathBurst(); }, 500); }, 500);

        // Gold reward float
        this.showGoldRewardText(this.position.clone());
    }
}
