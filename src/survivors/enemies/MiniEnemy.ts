import { Box3, Color, Mesh, Vector3 } from 'three';
import { Game } from '../../engine/Game';
import { Enemy, tryAcquireDeathBurst, scheduleDeathBurstTeardown } from './Enemy';
import { getCachedMaterial } from '../../engine/rendering/MaterialCache';
import { createLowPolyMaterial, createEmissiveMaterial, makeFlatShaded } from '../../engine/rendering/LowPolyMaterial';
import { PALETTE } from '../../engine/rendering/StyleConstants';
import { AnimGroup } from '../../engine/three/AnimGroup';
import type { GlbContainer } from '../../engine/three/assets';
import { headingToYaw, rgba } from '../../engine/three/math';
import { ParticleSystem } from '../../engine/three/particles/ParticleSystem';
import { createBox, createCylinder, createPlane } from '../../engine/three/primitives';

/**
 * MiniEnemy — spawned when a SplittingEnemy dies.
 * Small, fast, low HP/damage/reward.
 */
export class MiniEnemy extends Enemy {
    /** Static slot used by EnemyManager (split handler) to stage a preloaded GLB
     *  asset before constructing a MiniEnemy. createMesh() consumes + clears it. */
    public static pendingAsset: GlbContainer | null = null;

    private walkTime: number = 0;

    /** True when this instance renders via the thunder-fenrir-cab GLB. */
    private usingGLB: boolean = false;
    private glbWalkAnim: AnimGroup | null = null;
    private glbAttackAnim: AnimGroup | null = null;
    private glbIdleAnim: AnimGroup | null = null;
    private glbCurrentAnim: AnimGroup | null = null;
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

    private createMeshFromGLB(asset: GlbContainer): void {
        this.usingGLB = true;
        this.mesh = new Mesh();
        this.mesh.name = 'miniEnemyGlbRoot';
        this.scene.scene.add(this.mesh);
        this.mesh.position.copy(this.position);

        const inst = asset.instantiate(this.scene, 'mini_');
        this.glbInstance = inst;
        const root = inst.root;
        this.mesh.add(root);
        root.scale.multiplyScalar(MiniEnemy.GLB_SCALE);
        // 180° Y flip — same pattern as BasicEnemy GLB. Kept from the Babylon
        // build so facing math stays aligned (the Phase D handedness audit may
        // remove it).
        root.rotation.y += Math.PI;

        this.mesh.updateMatrixWorld(true);
        const bbox = new Box3().setFromObject(this.mesh);
        const feetOffset = -bbox.min.y;
        root.position.y += feetOffset;

        // Register groups for base-class dispose cleanup (prevents animatable leak).
        this.glbAnimationGroups = inst.animationGroups;

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

    private playGlbAnim(slot: AnimGroup | null, loop: boolean): void {
        if (!slot) return;
        if (this.glbCurrentAnim === slot) return;
        if (this.glbCurrentAnim) this.glbCurrentAnim.stop();
        slot.start(loop);
        this.glbCurrentAnim = slot;
    }

    private createMeshProcedural(): void {
        // Small blob body — bumped 1.1× from original 0.40/0.30/0.35 for readability
        this.mesh = createBox('miniEnemyBody', {
            width: 0.44,
            height: 0.33,
            depth: 0.39
        }, this.scene);
        makeFlatShaded(this.mesh);
        this.mesh.position.copy(this.position);
        this.mesh.position.y += 0.28;
        // Slightly brighter tint (splitter parentage cue) — lighter cyan-green
        const miniBodyColor = PALETTE.ENEMY_SPLITTING_BELLY;
        this.mesh.material = createLowPolyMaterial('miniBodyMat', miniBodyColor);

        // Belly
        const belly = createBox('miniBelly', {
            width: 0.28, height: 0.18, depth: 0.06
        }, this.scene);
        makeFlatShaded(belly);
        this.mesh.add(belly);
        belly.position.set(0, -0.02, 0.18);
        belly.material = createLowPolyMaterial('miniBellyMat', PALETTE.ENEMY_SPLITTING_BELLY);

        // Single head nub
        const head = createCylinder('miniHead', {
            height: 0.20, diameterTop: 0.05, diameterBottom: 0.15, tessellation: 4
        }, this.scene);
        makeFlatShaded(head);
        this.mesh.add(head);
        head.position.set(0, 0.22, 0.08);
        head.material = createLowPolyMaterial('miniHeadMat', PALETTE.ENEMY_SPLITTING);

        // Eyes
        for (let i = 0; i < 2; i++) {
            const eye = createBox(`miniEye${i}`, {
                width: 0.06, height: 0.04, depth: 0.03
            }, this.scene);
            makeFlatShaded(eye);
            head.add(eye);
            eye.position.set(i === 0 ? -0.04 : 0.04, 0.02, 0.07);
            eye.material = createEmissiveMaterial(`miniEyeMat${i}`, PALETTE.ENEMY_SPLITTING_EYE, 0.8);
        }

        this.originalScale = 1.0;
    }

    protected createHealthBar(): void {
        if (!this.mesh) return;
        this._barBand = null; // force the fill-material assignment in updateHealthBar

        // Two meshes, shared cached materials (see Enemy.createHealthBar): the
        // frame-sized near-black background doubles as the outline.
        this.healthBarBackgroundMesh = createPlane('healthBarBg', {
            width: 0.65, height: 0.10
        }, this.scene);
        this.healthBarBackgroundMesh.position.set(this.position.x, this.position.y + 1.0, this.position.z);
        this.healthBarBackgroundMesh.material = getCachedMaterial('healthBarBgFrameMat', m => {
            m.color    = new Color(0.05, 0.05, 0.05);
            m.specular = new Color(0, 0, 0);
            m.depthTest = false;
            m.depthWrite = false;
        });

        // Health fill — material assigned by updateHealthBar's band swap.
        this.healthBarMesh = createPlane('healthBar', {
            width: 0.6, height: 0.06
        }, this.scene);
        this.healthBarMesh.position.set(this.position.x, this.position.y + 1.0, this.position.z);

        this.updateHealthBar();
    }

    protected updateHealthBar(): void {
        if (!this.mesh || !this.healthBarMesh || !this.healthBarBackgroundMesh) return;
        const healthPercent = Math.max(0, this.health / this.maxHealth);
        this.healthBarMesh.scale.x = healthPercent;
        const offset = (1 - healthPercent) * 0.3;
        this.healthBarMesh.position.x = this.position.x - offset;

        this.applyHealthBarBand(healthPercent);

        this.healthBarBackgroundMesh.position.x = this.position.x;
        this.healthBarBackgroundMesh.position.y = this.position.y + 1.0;
        this.healthBarBackgroundMesh.position.z = this.position.z;
        this.healthBarMesh.position.y = this.position.y + 1.0;
        this.healthBarMesh.position.z = this.position.z;

        this._billboardHealthBar();
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
            this.animateProceduralParts(deltaTime);

            if (this.currentPathIndex < this.path.length) {
                const targetPoint = this.path[this.currentPathIndex];
                const dx = targetPoint.x - this.position.x;
                const dz = targetPoint.z - this.position.z;
                if (dx * dx + dz * dz > 0.0001) {
                    this.mesh.rotation.y = headingToYaw(dx, dz);
                }
            }
        }

        return result;
    }

    /** Scurry bob pose — advances the walk phase and bobs/leans the tiny body.
     *  Called by update() while scurrying and by tickNetworkProceduralAnim on
     *  the guest. */
    protected animateProceduralParts(deltaTime: number): void {
        if (!this.mesh) return;
        this.walkTime += deltaTime * 8;
        const bobAmount = Math.abs(Math.sin(this.walkTime)) * 0.04;
        this.mesh.position.y = this.position.y + 0.28 + bobAmount;
        this.mesh.rotation.z = Math.sin(this.walkTime) * 0.1;
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
        ps.minEmitBox.set(-0.1, 0, -0.1);
        ps.maxEmitBox.set(0.1, 0, 0.1);
        ps.color1 = rgba(0.3, 0.7, 0.5, 1.0);
        ps.color2 = rgba(0.5, 0.8, 0.4, 1.0);
        ps.colorDead = rgba(0.2, 0.3, 0.1, 0.0);
        ps.minSize = 0.05;
        ps.maxSize = 0.2;
        ps.minLifeTime = 0.2;
        ps.maxLifeTime = 0.6;
        ps.emitRate = 60;
        ps.blendMode = ParticleSystem.BLENDMODE_ONEONE;
        ps.gravity.set(0, 5, 0);
        ps.direction1.set(-1, 5, -1);
        ps.direction2.set(1, 5, 1);
        ps.minEmitPower = 0.5;
        ps.maxEmitPower = 2;
        ps.start();
        this.game.getAssetManager().playSound('enemyDeath');
        scheduleDeathBurstTeardown(this.scene, ps, 0.5);

        // Gold reward float
        this.showGoldRewardText(this.position.clone());
    }
}
