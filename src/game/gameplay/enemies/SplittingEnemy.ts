import { Vector3, MeshBuilder, StandardMaterial, Color3, Color4, ParticleSystem, Texture, Mesh, AssetContainer, AnimationGroup, TransformNode, Quaternion } from '@babylonjs/core';
import { Game } from '../../Game';
import { Enemy } from './Enemy';
import { createLowPolyMaterial, createEmissiveMaterial, makeFlatShaded } from '../../rendering/LowPolyMaterial';
import { PALETTE } from '../../rendering/StyleConstants';

export class SplittingEnemy extends Enemy {
    /** Static slot used by EnemyManager.spawnSurvivorsEnemy to stage a preloaded GLB
     *  asset before constructing a SplittingEnemy. createMesh() consumes + clears it. */
    public static pendingAsset: AssetContainer | null = null;

    private walkTime: number = 0;
    private headLeft: Mesh | null = null;
    private headCenter: Mesh | null = null;
    private headRight: Mesh | null = null;
    private leftLeg: Mesh | null = null;
    private rightLeg: Mesh | null = null;
    private backLeg: Mesh | null = null;

    /** True when this instance renders via the thunder-fenrir GLB. */
    private usingGLB: boolean = false;
    private glbWalkAnim: AnimationGroup | null = null;
    private glbAttackAnim: AnimationGroup | null = null;
    private glbIdleAnim: AnimationGroup | null = null;
    private glbCurrentAnim: AnimationGroup | null = null;
    private glbAttackHoldTimer: number = 0;
    private static readonly GLB_ATTACK_RANGE = 3.5;
    private static readonly GLB_ATTACK_HOLD = 0.6;
    private static readonly GLB_SCALE = 1.4;

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

    private createMeshFromGLB(asset: AssetContainer): void {
        this.usingGLB = true;
        this.mesh = new Mesh('splittingEnemyGlbRoot', this.scene);
        this.mesh.position.copyFrom(this.position);

        const inst = asset.instantiateModelsToScene(
            name => `splitting_${name}`,
            true,
            { doNotInstantiate: true },
        );
        for (const root of inst.rootNodes) {
            root.parent = this.mesh;
            if ('scaling' in root && root.scaling) {
                (root as TransformNode).scaling.scaleInPlace(SplittingEnemy.GLB_SCALE);
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

    /**
     * Create the enemy mesh - low-poly Multi-Headed Hydra/Slime (procedural fallback)
     * Squat wide body, 3 serpentine heads with emissive eyes, short stubby legs
     */
    private createMeshProcedural(): void {
        // --- Main body: squat wide box (blobby torso) ---
        this.mesh = MeshBuilder.CreateBox('splittingEnemyBody', {
            width: 0.90,
            height: 0.50,
            depth: 0.70
        }, this.scene);
        makeFlatShaded(this.mesh);
        this.mesh.position = this.position.clone();
        this.mesh.position.y += 0.40;
        this.mesh.material = createLowPolyMaterial('splittingBodyMat', PALETTE.ENEMY_SPLITTING, this.scene);

        // --- Belly patch: lighter underside ---
        const belly = MeshBuilder.CreateBox('splittingBelly', {
            width: 0.65,
            height: 0.30,
            depth: 0.50
        }, this.scene);
        makeFlatShaded(belly);
        belly.parent = this.mesh;
        belly.position = new Vector3(0, -0.12, 0);
        belly.material = createLowPolyMaterial('splittingBellyMat', PALETTE.ENEMY_SPLITTING_BELLY, this.scene);

        // --- Back ridge: bumpy ridge along the spine ---
        const ridge = MeshBuilder.CreateBox('splittingRidge', {
            width: 0.20,
            height: 0.12,
            depth: 0.55
        }, this.scene);
        makeFlatShaded(ridge);
        ridge.parent = this.mesh;
        ridge.position = new Vector3(0, 0.28, -0.05);
        ridge.material = createLowPolyMaterial('splittingRidgeMat', PALETTE.ENEMY_SPLITTING, this.scene);

        // --- Center Head (tallest): neck + head ---
        const centerNeck = MeshBuilder.CreateCylinder('splittingCenterNeck', {
            height: 0.40,
            diameterTop: 0.16,
            diameterBottom: 0.22,
            tessellation: 5
        }, this.scene);
        makeFlatShaded(centerNeck);
        centerNeck.parent = this.mesh;
        centerNeck.position = new Vector3(0, 0.42, 0.15);
        centerNeck.material = createLowPolyMaterial('splittingCenterNeckMat', PALETTE.ENEMY_SPLITTING, this.scene);

        this.headCenter = MeshBuilder.CreateBox('splittingCenterHead', {
            width: 0.28,
            height: 0.22,
            depth: 0.26
        }, this.scene);
        makeFlatShaded(this.headCenter);
        this.headCenter.parent = centerNeck;
        this.headCenter.position = new Vector3(0, 0.28, 0.04);
        this.headCenter.material = createLowPolyMaterial('splittingCenterHeadMat', PALETTE.ENEMY_SPLITTING, this.scene);

        // Center head snout
        const centerSnout = MeshBuilder.CreateCylinder('splittingCenterSnout', {
            height: 0.16,
            diameterTop: 0.0,
            diameterBottom: 0.12,
            tessellation: 4
        }, this.scene);
        makeFlatShaded(centerSnout);
        centerSnout.parent = this.headCenter;
        centerSnout.position = new Vector3(0, -0.02, 0.18);
        centerSnout.rotation.x = Math.PI / 2;
        centerSnout.material = createLowPolyMaterial('splittingCenterSnoutMat', PALETTE.ENEMY_SPLITTING_BELLY, this.scene);

        // Center head eyes
        const centerLeftEye = MeshBuilder.CreateBox('splittingCEyeL', {
            width: 0.08,
            height: 0.06,
            depth: 0.05
        }, this.scene);
        makeFlatShaded(centerLeftEye);
        centerLeftEye.parent = this.headCenter;
        centerLeftEye.position = new Vector3(-0.08, 0.05, 0.13);
        centerLeftEye.material = createEmissiveMaterial('splittingCEyeLMat', PALETTE.ENEMY_SPLITTING_EYE, 0.9, this.scene);

        const centerRightEye = MeshBuilder.CreateBox('splittingCEyeR', {
            width: 0.08,
            height: 0.06,
            depth: 0.05
        }, this.scene);
        makeFlatShaded(centerRightEye);
        centerRightEye.parent = this.headCenter;
        centerRightEye.position = new Vector3(0.08, 0.05, 0.13);
        centerRightEye.material = createEmissiveMaterial('splittingCEyeRMat', PALETTE.ENEMY_SPLITTING_EYE, 0.9, this.scene);

        // --- Left Head (shorter, angled left): neck + head ---
        const leftNeck = MeshBuilder.CreateCylinder('splittingLeftNeck', {
            height: 0.32,
            diameterTop: 0.14,
            diameterBottom: 0.20,
            tessellation: 5
        }, this.scene);
        makeFlatShaded(leftNeck);
        leftNeck.parent = this.mesh;
        leftNeck.position = new Vector3(-0.28, 0.36, 0.10);
        leftNeck.rotation.z = 0.35;
        leftNeck.material = createLowPolyMaterial('splittingLeftNeckMat', PALETTE.ENEMY_SPLITTING, this.scene);

        this.headLeft = MeshBuilder.CreateBox('splittingLeftHead', {
            width: 0.24,
            height: 0.18,
            depth: 0.22
        }, this.scene);
        makeFlatShaded(this.headLeft);
        this.headLeft.parent = leftNeck;
        this.headLeft.position = new Vector3(0, 0.22, 0.04);
        this.headLeft.material = createLowPolyMaterial('splittingLeftHeadMat', PALETTE.ENEMY_SPLITTING, this.scene);

        // Left head snout
        const leftSnout = MeshBuilder.CreateCylinder('splittingLeftSnout', {
            height: 0.12,
            diameterTop: 0.0,
            diameterBottom: 0.10,
            tessellation: 4
        }, this.scene);
        makeFlatShaded(leftSnout);
        leftSnout.parent = this.headLeft;
        leftSnout.position = new Vector3(0, -0.02, 0.14);
        leftSnout.rotation.x = Math.PI / 2;
        leftSnout.material = createLowPolyMaterial('splittingLeftSnoutMat', PALETTE.ENEMY_SPLITTING_BELLY, this.scene);

        // Left head eyes
        const leftEyeL = MeshBuilder.CreateBox('splittingLEyeL', {
            width: 0.06,
            height: 0.05,
            depth: 0.04
        }, this.scene);
        makeFlatShaded(leftEyeL);
        leftEyeL.parent = this.headLeft;
        leftEyeL.position = new Vector3(-0.06, 0.04, 0.11);
        leftEyeL.material = createEmissiveMaterial('splittingLEyeLMat', PALETTE.ENEMY_SPLITTING_EYE, 0.9, this.scene);

        const leftEyeR = MeshBuilder.CreateBox('splittingLEyeR', {
            width: 0.06,
            height: 0.05,
            depth: 0.04
        }, this.scene);
        makeFlatShaded(leftEyeR);
        leftEyeR.parent = this.headLeft;
        leftEyeR.position = new Vector3(0.06, 0.04, 0.11);
        leftEyeR.material = createEmissiveMaterial('splittingLEyeRMat', PALETTE.ENEMY_SPLITTING_EYE, 0.9, this.scene);

        // --- Right Head (shorter, angled right): neck + head ---
        const rightNeck = MeshBuilder.CreateCylinder('splittingRightNeck', {
            height: 0.32,
            diameterTop: 0.14,
            diameterBottom: 0.20,
            tessellation: 5
        }, this.scene);
        makeFlatShaded(rightNeck);
        rightNeck.parent = this.mesh;
        rightNeck.position = new Vector3(0.28, 0.36, 0.10);
        rightNeck.rotation.z = -0.35;
        rightNeck.material = createLowPolyMaterial('splittingRightNeckMat', PALETTE.ENEMY_SPLITTING, this.scene);

        this.headRight = MeshBuilder.CreateBox('splittingRightHead', {
            width: 0.24,
            height: 0.18,
            depth: 0.22
        }, this.scene);
        makeFlatShaded(this.headRight);
        this.headRight.parent = rightNeck;
        this.headRight.position = new Vector3(0, 0.22, 0.04);
        this.headRight.material = createLowPolyMaterial('splittingRightHeadMat', PALETTE.ENEMY_SPLITTING, this.scene);

        // Right head snout
        const rightSnout = MeshBuilder.CreateCylinder('splittingRightSnout', {
            height: 0.12,
            diameterTop: 0.0,
            diameterBottom: 0.10,
            tessellation: 4
        }, this.scene);
        makeFlatShaded(rightSnout);
        rightSnout.parent = this.headRight;
        rightSnout.position = new Vector3(0, -0.02, 0.14);
        rightSnout.rotation.x = Math.PI / 2;
        rightSnout.material = createLowPolyMaterial('splittingRightSnoutMat', PALETTE.ENEMY_SPLITTING_BELLY, this.scene);

        // Right head eyes
        const rightEyeL = MeshBuilder.CreateBox('splittingREyeL', {
            width: 0.06,
            height: 0.05,
            depth: 0.04
        }, this.scene);
        makeFlatShaded(rightEyeL);
        rightEyeL.parent = this.headRight;
        rightEyeL.position = new Vector3(-0.06, 0.04, 0.11);
        rightEyeL.material = createEmissiveMaterial('splittingREyeLMat', PALETTE.ENEMY_SPLITTING_EYE, 0.9, this.scene);

        const rightEyeR = MeshBuilder.CreateBox('splittingREyeR', {
            width: 0.06,
            height: 0.05,
            depth: 0.04
        }, this.scene);
        makeFlatShaded(rightEyeR);
        rightEyeR.parent = this.headRight;
        rightEyeR.position = new Vector3(0.06, 0.04, 0.11);
        rightEyeR.material = createEmissiveMaterial('splittingREyeRMat', PALETTE.ENEMY_SPLITTING_EYE, 0.9, this.scene);

        // --- Left Leg: stubby box ---
        this.leftLeg = MeshBuilder.CreateBox('splittingLeftLeg', {
            width: 0.22,
            height: 0.30,
            depth: 0.22
        }, this.scene);
        makeFlatShaded(this.leftLeg);
        this.leftLeg.parent = this.mesh;
        this.leftLeg.position = new Vector3(-0.28, -0.38, 0.10);
        this.leftLeg.material = createLowPolyMaterial('splittingLeftLegMat', PALETTE.ENEMY_SPLITTING_BELLY, this.scene);

        // Left foot
        const leftFoot = MeshBuilder.CreateBox('splittingLeftFoot', {
            width: 0.26,
            height: 0.06,
            depth: 0.28
        }, this.scene);
        makeFlatShaded(leftFoot);
        leftFoot.parent = this.leftLeg;
        leftFoot.position = new Vector3(0, -0.16, 0.04);
        leftFoot.material = createLowPolyMaterial('splittingLeftFootMat', PALETTE.ENEMY_SPLITTING, this.scene);

        // --- Right Leg: stubby box ---
        this.rightLeg = MeshBuilder.CreateBox('splittingRightLeg', {
            width: 0.22,
            height: 0.30,
            depth: 0.22
        }, this.scene);
        makeFlatShaded(this.rightLeg);
        this.rightLeg.parent = this.mesh;
        this.rightLeg.position = new Vector3(0.28, -0.38, 0.10);
        this.rightLeg.material = createLowPolyMaterial('splittingRightLegMat', PALETTE.ENEMY_SPLITTING_BELLY, this.scene);

        // Right foot
        const rightFoot = MeshBuilder.CreateBox('splittingRightFoot', {
            width: 0.26,
            height: 0.06,
            depth: 0.28
        }, this.scene);
        makeFlatShaded(rightFoot);
        rightFoot.parent = this.rightLeg;
        rightFoot.position = new Vector3(0, -0.16, 0.04);
        rightFoot.material = createLowPolyMaterial('splittingRightFootMat', PALETTE.ENEMY_SPLITTING, this.scene);

        // --- Back Leg: centered stubby support ---
        this.backLeg = MeshBuilder.CreateBox('splittingBackLeg', {
            width: 0.22,
            height: 0.28,
            depth: 0.22
        }, this.scene);
        makeFlatShaded(this.backLeg);
        this.backLeg.parent = this.mesh;
        this.backLeg.position = new Vector3(0, -0.38, -0.22);
        this.backLeg.material = createLowPolyMaterial('splittingBackLegMat', PALETTE.ENEMY_SPLITTING_BELLY, this.scene);

        // Back foot
        const backFoot = MeshBuilder.CreateBox('splittingBackFoot', {
            width: 0.26,
            height: 0.06,
            depth: 0.26
        }, this.scene);
        makeFlatShaded(backFoot);
        backFoot.parent = this.backLeg;
        backFoot.position = new Vector3(0, -0.15, -0.02);
        backFoot.material = createLowPolyMaterial('splittingBackFootMat', PALETTE.ENEMY_SPLITTING, this.scene);

        // --- Tail nub: short tapered box at the rear ---
        const tail = MeshBuilder.CreateCylinder('splittingTail', {
            height: 0.25,
            diameterTop: 0.06,
            diameterBottom: 0.16,
            tessellation: 5
        }, this.scene);
        makeFlatShaded(tail);
        tail.parent = this.mesh;
        tail.position = new Vector3(0, 0.05, -0.42);
        tail.rotation.x = -Math.PI / 3;
        tail.material = createLowPolyMaterial('splittingTailMat', PALETTE.ENEMY_SPLITTING, this.scene);

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

            // Face direction of movement
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
        const ring = MeshBuilder.CreateDisc('splitBurstRing', { radius: 0.5, tessellation: 24 }, this.scene);
        ring.rotation.x = Math.PI / 2;
        ring.position = this.position.clone();
        ring.position.y += 0.05;

        const ringMat = new StandardMaterial('splitBurstRingMat_' + Math.random(), this.scene);
        ringMat.emissiveColor = PALETTE.ENEMY_SPLITTING_EYE; // Orange-yellow burst
        ringMat.alpha = 0.75;
        ringMat.disableLighting = true;
        ring.material = ringMat;

        const startTime = performance.now();
        const duration = 600; // ms
        const startRadius = 0.5;
        const endRadius = 4.0;

        const observer = this.scene.onBeforeRenderObservable.add(() => {
            if (ring.isDisposed()) {
                this.scene.onBeforeRenderObservable.remove(observer);
                return;
            }
            const elapsed = performance.now() - startTime;
            const t = Math.min(elapsed / duration, 1.0);
            const scale = (startRadius + (endRadius - startRadius) * t) / startRadius;
            ring.scaling.set(scale, scale, scale);
            ringMat.alpha = 0.75 * (1 - t);

            if (t >= 1.0) {
                this.scene.onBeforeRenderObservable.remove(observer);
                ring.dispose();
            }
        });
    }
}
