import { Box3, Color, Mesh, Vector3 } from 'three';
import { Game } from '../../engine/Game';
import { Enemy } from './Enemy';
import { createLowPolyMaterial, createEmissiveMaterial, makeFlatShaded, setMeshOpacity } from '../../engine/rendering/LowPolyMaterial';
import { getCachedMaterial } from '../../engine/rendering/MaterialCache';
import { PALETTE } from '../../engine/rendering/StyleConstants';
import { AnimGroup } from '../../engine/three/AnimGroup';
import type { GlbContainer } from '../../engine/three/assets';
import { headingToYaw } from '../../engine/three/math';
import { createBox, createCylinder, createDisc, disposeMesh, isMeshDisposed } from '../../engine/three/primitives';

export class SplittingEnemy extends Enemy {
    /** Static slot used by EnemyManager.spawnSurvivorsEnemy to stage a preloaded GLB
     *  asset before constructing a SplittingEnemy. createMesh() consumes + clears it. */
    public static pendingAsset: GlbContainer | null = null;

    private walkTime: number = 0;
    private headLeft: Mesh | null = null;
    private headCenter: Mesh | null = null;
    private headRight: Mesh | null = null;
    private leftLeg: Mesh | null = null;
    private rightLeg: Mesh | null = null;
    private backLeg: Mesh | null = null;

    /** True when this instance renders via the thunder-fenrir GLB. */
    private usingGLB: boolean = false;
    private glbWalkAnim: AnimGroup | null = null;
    private glbAttackAnim: AnimGroup | null = null;
    private glbIdleAnim: AnimGroup | null = null;
    private glbCurrentAnim: AnimGroup | null = null;
    private glbAttackHoldTimer: number = 0;
    private static readonly GLB_ATTACK_RANGE = 3.5;
    private static readonly GLB_ATTACK_HOLD = 0.6;
    private static readonly GLB_SCALE = 1.1;

    constructor(game: Game, position: Vector3, path: Vector3[]) {
        // Splitting enemy: moderate speed, medium HP, medium damage, decent reward
        super(game, position, path, 2.5, 40, 8, 20);
        this.contactDamagePerSecond = 10;

        // Hydra bite — slightly longer reach (multiple heads), moderate damage.
        this.meleeRange            = 1.6;
        this.meleeHitRange         = 1.9;
        this.meleeHitDamage        = 12;
        this.meleeWindupDuration   = 0.3;
        this.meleeStrikeDuration   = 0.1;
        this.meleeCooldownDuration = 0.55;

        // Anchor HP bar above the hydra heads (taller than base enemy).
        this.applyHealthBarTier('normal', { heightOffset: 1.8 });

        // Build mesh + health bar AFTER field initializers have run (see Enemy
        // constructor note). new.target guard → fires only for the concrete leaf.
        if (new.target === SplittingEnemy) this._initEnemyVisuals();
    }

    /**
     * Create the enemy mesh. If a GLB asset was staged via SplittingEnemy.pendingAsset
     * (set by EnemyManager just before construction), instantiate it. Otherwise fall
     * back to the procedural multi-headed hydra build below.
     */
    protected createMesh(): void {
        const asset = SplittingEnemy.pendingAsset;
        SplittingEnemy.pendingAsset = null;
        if (asset) {
            this.createMeshFromGLB(asset);
            return;
        }
        this.createMeshProcedural();
    }

    private createMeshFromGLB(asset: GlbContainer): void {
        this.usingGLB = true;
        this.mesh = new Mesh(); // empty transform host (renders nothing)
        this.mesh.name = 'splittingEnemyGlbRoot';
        this.scene.scene.add(this.mesh);
        this.mesh.position.copy(this.position);

        const inst = asset.instantiate(this.scene, 'splitting_');
        // Base Enemy field; its dispose() frees cloned materials + skeletons + mixer hook.
        this.glbInstance = inst;
        const root = inst.root;
        this.mesh.add(root);
        root.scale.multiplyScalar(SplittingEnemy.GLB_SCALE);
        // Keep the Babylon-era 180-degree Y pre-rotation so facing math stays
        // aligned (Phase D handedness audit may remove it).
        root.rotation.y += Math.PI;

        // Feet-on-ground offset.
        this.mesh.updateMatrixWorld(true);
        const bbox = new Box3().setFromObject(this.mesh);
        const feetOffset = -bbox.min.y;
        root.position.y += feetOffset;

        // Register groups on the base class so the release path can stop them
        // (glbInstance.dispose() owns their actual disposal).
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

    /**
     * Create the enemy mesh - low-poly Multi-Headed Hydra/Slime (procedural fallback)
     * Squat wide body, 3 serpentine heads with emissive eyes, short stubby legs
     */
    private createMeshProcedural(): void {
        // --- Main body: squat wide box (blobby torso) ---
        this.mesh = createBox('splittingEnemyBody', {
            width: 0.90,
            height: 0.50,
            depth: 0.70
        }, this.scene);
        makeFlatShaded(this.mesh);
        this.mesh.position.copy(this.position);
        this.mesh.position.y += 0.40;
        this.mesh.material = createLowPolyMaterial('splittingBodyMat', PALETTE.ENEMY_SPLITTING);

        // --- Belly patch: lighter underside ---
        const belly = createBox('splittingBelly', {
            width: 0.65,
            height: 0.30,
            depth: 0.50
        }, this.scene);
        makeFlatShaded(belly);
        this.mesh.add(belly);
        belly.position.set(0, -0.12, 0);
        belly.material = createLowPolyMaterial('splittingBellyMat', PALETTE.ENEMY_SPLITTING_BELLY);

        // --- Back ridge: bumpy ridge along the spine ---
        const ridge = createBox('splittingRidge', {
            width: 0.20,
            height: 0.12,
            depth: 0.55
        }, this.scene);
        makeFlatShaded(ridge);
        this.mesh.add(ridge);
        ridge.position.set(0, 0.28, -0.05);
        ridge.material = createLowPolyMaterial('splittingRidgeMat', PALETTE.ENEMY_SPLITTING);

        // --- Center Head (tallest): neck + head ---
        const centerNeck = createCylinder('splittingCenterNeck', {
            height: 0.40,
            diameterTop: 0.16,
            diameterBottom: 0.22,
            tessellation: 5
        }, this.scene);
        makeFlatShaded(centerNeck);
        this.mesh.add(centerNeck);
        centerNeck.position.set(0, 0.42, 0.15);
        centerNeck.material = createLowPolyMaterial('splittingCenterNeckMat', PALETTE.ENEMY_SPLITTING);

        this.headCenter = createBox('splittingCenterHead', {
            width: 0.28,
            height: 0.22,
            depth: 0.26
        }, this.scene);
        makeFlatShaded(this.headCenter);
        centerNeck.add(this.headCenter);
        this.headCenter.position.set(0, 0.28, 0.04);
        this.headCenter.material = createLowPolyMaterial('splittingCenterHeadMat', PALETTE.ENEMY_SPLITTING);

        // Center head snout
        const centerSnout = createCylinder('splittingCenterSnout', {
            height: 0.16,
            diameterTop: 0.0,
            diameterBottom: 0.12,
            tessellation: 4
        }, this.scene);
        makeFlatShaded(centerSnout);
        this.headCenter.add(centerSnout);
        centerSnout.position.set(0, -0.02, 0.18);
        centerSnout.rotation.x = Math.PI / 2;
        centerSnout.material = createLowPolyMaterial('splittingCenterSnoutMat', PALETTE.ENEMY_SPLITTING_BELLY);

        // Center head eyes
        const centerLeftEye = createBox('splittingCEyeL', {
            width: 0.08,
            height: 0.06,
            depth: 0.05
        }, this.scene);
        makeFlatShaded(centerLeftEye);
        this.headCenter.add(centerLeftEye);
        centerLeftEye.position.set(-0.08, 0.05, 0.13);
        centerLeftEye.material = createEmissiveMaterial('splittingCEyeLMat', PALETTE.ENEMY_SPLITTING_EYE, 0.9);

        const centerRightEye = createBox('splittingCEyeR', {
            width: 0.08,
            height: 0.06,
            depth: 0.05
        }, this.scene);
        makeFlatShaded(centerRightEye);
        this.headCenter.add(centerRightEye);
        centerRightEye.position.set(0.08, 0.05, 0.13);
        centerRightEye.material = createEmissiveMaterial('splittingCEyeRMat', PALETTE.ENEMY_SPLITTING_EYE, 0.9);

        // --- Left Head (shorter, angled left): neck + head ---
        const leftNeck = createCylinder('splittingLeftNeck', {
            height: 0.32,
            diameterTop: 0.14,
            diameterBottom: 0.20,
            tessellation: 5
        }, this.scene);
        makeFlatShaded(leftNeck);
        this.mesh.add(leftNeck);
        leftNeck.position.set(-0.28, 0.36, 0.10);
        leftNeck.rotation.z = 0.35;
        leftNeck.material = createLowPolyMaterial('splittingLeftNeckMat', PALETTE.ENEMY_SPLITTING);

        this.headLeft = createBox('splittingLeftHead', {
            width: 0.24,
            height: 0.18,
            depth: 0.22
        }, this.scene);
        makeFlatShaded(this.headLeft);
        leftNeck.add(this.headLeft);
        this.headLeft.position.set(0, 0.22, 0.04);
        this.headLeft.material = createLowPolyMaterial('splittingLeftHeadMat', PALETTE.ENEMY_SPLITTING);

        // Left head snout
        const leftSnout = createCylinder('splittingLeftSnout', {
            height: 0.12,
            diameterTop: 0.0,
            diameterBottom: 0.10,
            tessellation: 4
        }, this.scene);
        makeFlatShaded(leftSnout);
        this.headLeft.add(leftSnout);
        leftSnout.position.set(0, -0.02, 0.14);
        leftSnout.rotation.x = Math.PI / 2;
        leftSnout.material = createLowPolyMaterial('splittingLeftSnoutMat', PALETTE.ENEMY_SPLITTING_BELLY);

        // Left head eyes
        const leftEyeL = createBox('splittingLEyeL', {
            width: 0.06,
            height: 0.05,
            depth: 0.04
        }, this.scene);
        makeFlatShaded(leftEyeL);
        this.headLeft.add(leftEyeL);
        leftEyeL.position.set(-0.06, 0.04, 0.11);
        leftEyeL.material = createEmissiveMaterial('splittingLEyeLMat', PALETTE.ENEMY_SPLITTING_EYE, 0.9);

        const leftEyeR = createBox('splittingLEyeR', {
            width: 0.06,
            height: 0.05,
            depth: 0.04
        }, this.scene);
        makeFlatShaded(leftEyeR);
        this.headLeft.add(leftEyeR);
        leftEyeR.position.set(0.06, 0.04, 0.11);
        leftEyeR.material = createEmissiveMaterial('splittingLEyeRMat', PALETTE.ENEMY_SPLITTING_EYE, 0.9);

        // --- Right Head (shorter, angled right): neck + head ---
        const rightNeck = createCylinder('splittingRightNeck', {
            height: 0.32,
            diameterTop: 0.14,
            diameterBottom: 0.20,
            tessellation: 5
        }, this.scene);
        makeFlatShaded(rightNeck);
        this.mesh.add(rightNeck);
        rightNeck.position.set(0.28, 0.36, 0.10);
        rightNeck.rotation.z = -0.35;
        rightNeck.material = createLowPolyMaterial('splittingRightNeckMat', PALETTE.ENEMY_SPLITTING);

        this.headRight = createBox('splittingRightHead', {
            width: 0.24,
            height: 0.18,
            depth: 0.22
        }, this.scene);
        makeFlatShaded(this.headRight);
        rightNeck.add(this.headRight);
        this.headRight.position.set(0, 0.22, 0.04);
        this.headRight.material = createLowPolyMaterial('splittingRightHeadMat', PALETTE.ENEMY_SPLITTING);

        // Right head snout
        const rightSnout = createCylinder('splittingRightSnout', {
            height: 0.12,
            diameterTop: 0.0,
            diameterBottom: 0.10,
            tessellation: 4
        }, this.scene);
        makeFlatShaded(rightSnout);
        this.headRight.add(rightSnout);
        rightSnout.position.set(0, -0.02, 0.14);
        rightSnout.rotation.x = Math.PI / 2;
        rightSnout.material = createLowPolyMaterial('splittingRightSnoutMat', PALETTE.ENEMY_SPLITTING_BELLY);

        // Right head eyes
        const rightEyeL = createBox('splittingREyeL', {
            width: 0.06,
            height: 0.05,
            depth: 0.04
        }, this.scene);
        makeFlatShaded(rightEyeL);
        this.headRight.add(rightEyeL);
        rightEyeL.position.set(-0.06, 0.04, 0.11);
        rightEyeL.material = createEmissiveMaterial('splittingREyeLMat', PALETTE.ENEMY_SPLITTING_EYE, 0.9);

        const rightEyeR = createBox('splittingREyeR', {
            width: 0.06,
            height: 0.05,
            depth: 0.04
        }, this.scene);
        makeFlatShaded(rightEyeR);
        this.headRight.add(rightEyeR);
        rightEyeR.position.set(0.06, 0.04, 0.11);
        rightEyeR.material = createEmissiveMaterial('splittingREyeRMat', PALETTE.ENEMY_SPLITTING_EYE, 0.9);

        // --- Left Leg: stubby box ---
        this.leftLeg = createBox('splittingLeftLeg', {
            width: 0.22,
            height: 0.30,
            depth: 0.22
        }, this.scene);
        makeFlatShaded(this.leftLeg);
        this.mesh.add(this.leftLeg);
        this.leftLeg.position.set(-0.28, -0.38, 0.10);
        this.leftLeg.material = createLowPolyMaterial('splittingLeftLegMat', PALETTE.ENEMY_SPLITTING_BELLY);

        // Left foot
        const leftFoot = createBox('splittingLeftFoot', {
            width: 0.26,
            height: 0.06,
            depth: 0.28
        }, this.scene);
        makeFlatShaded(leftFoot);
        this.leftLeg.add(leftFoot);
        leftFoot.position.set(0, -0.16, 0.04);
        leftFoot.material = createLowPolyMaterial('splittingLeftFootMat', PALETTE.ENEMY_SPLITTING);

        // --- Right Leg: stubby box ---
        this.rightLeg = createBox('splittingRightLeg', {
            width: 0.22,
            height: 0.30,
            depth: 0.22
        }, this.scene);
        makeFlatShaded(this.rightLeg);
        this.mesh.add(this.rightLeg);
        this.rightLeg.position.set(0.28, -0.38, 0.10);
        this.rightLeg.material = createLowPolyMaterial('splittingRightLegMat', PALETTE.ENEMY_SPLITTING_BELLY);

        // Right foot
        const rightFoot = createBox('splittingRightFoot', {
            width: 0.26,
            height: 0.06,
            depth: 0.28
        }, this.scene);
        makeFlatShaded(rightFoot);
        this.rightLeg.add(rightFoot);
        rightFoot.position.set(0, -0.16, 0.04);
        rightFoot.material = createLowPolyMaterial('splittingRightFootMat', PALETTE.ENEMY_SPLITTING);

        // --- Back Leg: centered stubby support ---
        this.backLeg = createBox('splittingBackLeg', {
            width: 0.22,
            height: 0.28,
            depth: 0.22
        }, this.scene);
        makeFlatShaded(this.backLeg);
        this.mesh.add(this.backLeg);
        this.backLeg.position.set(0, -0.38, -0.22);
        this.backLeg.material = createLowPolyMaterial('splittingBackLegMat', PALETTE.ENEMY_SPLITTING_BELLY);

        // Back foot
        const backFoot = createBox('splittingBackFoot', {
            width: 0.26,
            height: 0.06,
            depth: 0.26
        }, this.scene);
        makeFlatShaded(backFoot);
        this.backLeg.add(backFoot);
        backFoot.position.set(0, -0.15, -0.02);
        backFoot.material = createLowPolyMaterial('splittingBackFootMat', PALETTE.ENEMY_SPLITTING);

        // --- Tail nub: short tapered box at the rear ---
        const tail = createCylinder('splittingTail', {
            height: 0.25,
            diameterTop: 0.06,
            diameterBottom: 0.16,
            tessellation: 5
        }, this.scene);
        makeFlatShaded(tail);
        this.mesh.add(tail);
        tail.position.set(0, 0.05, -0.42);
        tail.rotation.x = -Math.PI / 3;
        tail.material = createLowPolyMaterial('splittingTailMat', PALETTE.ENEMY_SPLITTING);

        // Store original scale
        this.originalScale = 1.0;
    }

    // HP bar creation/update is inherited from Enemy.ts and anchored by
    // `barHeightOffset` set in the constructor via applyHealthBarTier.

    /**
     * Update the enemy with multi-headed swaying animation
     * @param deltaTime Time elapsed since last update in seconds
     * @returns True if the enemy reached the end of the path
     */
    public update(deltaTime: number): boolean {
        if (!this.alive || !this.mesh) return false;

        // Get the result from the parent update method
        const result = super.update(deltaTime);

        // GLB fenrir skips the procedural multi-head sway — the asset's clips drive it.
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
                const inRange = distSq <= SplittingEnemy.GLB_ATTACK_RANGE * SplittingEnemy.GLB_ATTACK_RANGE;
                if (inRange) {
                    this.glbAttackHoldTimer = SplittingEnemy.GLB_ATTACK_HOLD;
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

        // Update walking animation
        if (!this.isFrozen && !this.isStunned && this.currentPathIndex < this.path.length && this.mesh) {
            this.animateProceduralParts(deltaTime);

            // Face direction of movement
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

    /** Multi-headed sway pose — advances the walk phase and poses the body,
     *  legs, and three heads. Called by update() while waddling and by
     *  tickNetworkProceduralAnim on the guest. */
    protected animateProceduralParts(deltaTime: number): void {
        if (!this.mesh) return;
        this.walkTime += deltaTime * 5;

        // Body sway: side-to-side rock and vertical bob
        const bobAmount = Math.abs(Math.sin(this.walkTime)) * 0.05;
        const swayAmount = Math.sin(this.walkTime * 0.6) * 0.06;
        this.mesh.position.y = this.position.y + 0.40 + bobAmount;
        this.mesh.rotation.z = swayAmount;

        // Legs: alternating waddle stride
        if (this.leftLeg) {
            this.leftLeg.rotation.x = Math.sin(this.walkTime) * 0.4;
        }
        if (this.rightLeg) {
            this.rightLeg.rotation.x = Math.sin(this.walkTime + Math.PI) * 0.4;
        }
        if (this.backLeg) {
            this.backLeg.rotation.x = Math.sin(this.walkTime + Math.PI / 2) * 0.3;
        }

        // Heads bob independently at different frequencies
        if (this.headCenter) {
            this.headCenter.rotation.x = Math.sin(this.walkTime * 1.2) * 0.10;
            this.headCenter.rotation.y = Math.sin(this.walkTime * 0.7) * 0.08;
        }
        if (this.headLeft) {
            this.headLeft.rotation.x = Math.sin(this.walkTime * 1.0 + 1.0) * 0.12;
            this.headLeft.rotation.y = Math.sin(this.walkTime * 0.9 + 0.5) * 0.10;
        }
        if (this.headRight) {
            this.headRight.rotation.x = Math.sin(this.walkTime * 1.1 + 2.0) * 0.12;
            this.headRight.rotation.y = Math.sin(this.walkTime * 0.8 + 1.5) * 0.10;
        }
    }

    /**
     * Create a death effect - dispatch split event AND particle burst + expanding ring
     */
    protected createDeathEffect(): void {
        // Dispatch the split event so EnemyManager can spawn mini enemies
        const remainingPath = this.path.slice(this.currentPathIndex);
        const splitEvent = new CustomEvent('enemySplit', {
            detail: {
                position: this.position.clone(),
                path: remainingPath,
                count: 3
            }
        });
        document.dispatchEvent(splitEvent);

        // Expanding split burst ring at death position
        this.spawnSplitBurstRing();

        // Call parent for the standard particle burst + gold text
        super.createDeathEffect();

        // Play sound effect
        this.game.getAssetManager().playSound('enemyDeath');
    }

    /**
     * Expanding ring visual at split death — green/yellow disc that grows 0.5 → 4.0 over 0.6 s
     */
    private spawnSplitBurstRing(): void {
        const ring = createDisc('splitBurstRing', { radius: 0.5, tessellation: 24 }, this.scene);
        ring.rotation.x = -Math.PI / 2; // lie flat, facing up (+Y normal in Three)
        ring.position.copy(this.position);
        ring.position.y += 0.05;

        // Cache by stable key — one shared material for all split rings.
        // Math.random() name forced a fresh material per SplittingEnemy death.
        // Fade via setMeshOpacity (clone-on-write), never the shared mat's
        // .opacity. Black diffuse + emissive ≈ Babylon's disableLighting look.
        ring.material = getCachedMaterial('splitBurstRingMat', m => {
            m.emissive = PALETTE.ENEMY_SPLITTING_EYE.clone(); // Orange-yellow burst
            m.color = new Color(0, 0, 0);
            m.transparent = true;
            m.opacity = 0.75;
            m.depthWrite = false;
        });
        setMeshOpacity(ring, 0.75);

        const startTime = performance.now();
        const duration = 600; // ms
        const startRadius = 0.5;
        const endRadius = 4.0;

        const observer = this.scene.onBeforeRender.add(() => {
            if (isMeshDisposed(ring)) {
                this.scene.onBeforeRender.remove(observer);
                return;
            }
            const elapsed = performance.now() - startTime;
            const t = Math.min(elapsed / duration, 1.0);
            const scale = (startRadius + (endRadius - startRadius) * t) / startRadius;
            ring.scale.set(scale, scale, scale);
            setMeshOpacity(ring, 0.75 * (1 - t));

            if (t >= 1.0) {
                this.scene.onBeforeRender.remove(observer);
                disposeMesh(ring); // frees the mesh-owned fade clone; the cached mat survives
            }
        });
    }
}
