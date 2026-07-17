import { Box3, Color, Mesh, Vector3 } from 'three';
import { Game } from '../../engine/Game';
import { Enemy, getStatusEffectTexture, tryAcquireDeathBurst, scheduleDeathBurstTeardown } from './Enemy';
import { getCachedMaterial } from '../../engine/rendering/MaterialCache';
import { createLowPolyMaterial, createEmissiveMaterial, makeFlatShaded } from '../../engine/rendering/LowPolyMaterial';
import { PALETTE } from '../../engine/rendering/StyleConstants';
import { AnimGroup } from '../../engine/three/AnimGroup';
import type { GlbContainer } from '../../engine/three/assets';
import { headingToYaw } from '../../engine/three/math';
import { fxRenderer, fxSize, ParticleEffect } from '../../engine/three/particles/ParticleEffect';
import { LifeTimeCurve, Shape } from '@newkrok/three-particles';
import { createBox, createCylinder, createPlane } from '../../engine/three/primitives';

export class BasicEnemy extends Enemy {
    /** Static slot used by EnemyManager.spawnSurvivorsEnemy to stage a preloaded GLB
     *  asset before constructing a BasicEnemy. createMesh() consumes + clears it. */
    public static pendingAsset: GlbContainer | null = null;

    private walkTime: number = 0;
    private head: Mesh | null = null;
    private leftLeg: Mesh | null = null;
    private rightLeg: Mesh | null = null;
    private leftArm: Mesh | null = null;
    private rightArm: Mesh | null = null;
    /** True when this instance is rendered via the blue-melee-minion GLB. */
    private usingGLB: boolean = false;
    private glbWalkAnim: AnimGroup | null = null;
    private glbAttackAnim: AnimGroup | null = null;
    private glbIdleAnim: AnimGroup | null = null;
    private glbCurrentAnim: AnimGroup | null = null;
    /** Seconds remaining of forced-attack anim. While > 0 we keep the attack clip
     *  looping even if the minion briefly leaves attack range (the hero kites, dies,
     *  whirlwinds them, etc.). Without this the attack switches off after a single
     *  frame and the player never sees the swing. */
    private glbAttackHoldTimer: number = 0;
    /** Distance at which the minion enters the attack state. */
    private static readonly GLB_ATTACK_RANGE = 4.0;
    /** Minimum seconds the attack anim runs once it's triggered. */
    private static readonly GLB_ATTACK_HOLD = 0.6;

    constructor(game: Game, position: Vector3, path: Vector3[]) {
        // Basic enemy has medium speed, medium health, medium damage, and low reward
        super(game, position, path, 3, 30, 10, 10);
        this.contactDamagePerSecond = 8;

        // Quick goblin jab — short reach, snappy windup, low damage per swing.
        this.meleeRange            = 1.4;
        this.meleeHitRange         = 1.7;
        this.meleeHitDamage        = 10;
        this.meleeWindupDuration   = 0.28;
        this.meleeStrikeDuration   = 0.1;
        this.meleeCooldownDuration = 0.5;

        // Build mesh + health bar AFTER field initializers have run (see Enemy
        // constructor note). new.target guard → fires only for the concrete leaf.
        if (new.target === BasicEnemy) this._initEnemyVisuals();
    }

    /**
     * Create the enemy mesh. If a GLB asset was staged via BasicEnemy.pendingAsset
     * (set by EnemyManager just before construction), instantiate it. Otherwise fall
     * back to the procedural goblin warrior build below.
     */
    protected createMesh(): void {
        const asset = BasicEnemy.pendingAsset;
        BasicEnemy.pendingAsset = null;
        if (asset) {
            this.createMeshFromGLB(asset);
            return;
        }
        this.createMeshProcedural();
    }

    private createMeshFromGLB(asset: GlbContainer): void {
        this.usingGLB = true;
        // Empty root mesh — invisible transform host. Enemy.update sets its position
        // each frame from this.position via mesh.position.copy.
        this.mesh = new Mesh();
        this.mesh.name = 'basicEnemyGlbRoot';
        this.scene.scene.add(this.mesh);
        this.mesh.position.copy(this.position);

        const inst = asset.instantiate(this.scene, 'basic_');
        this.glbInstance = inst;
        const root = inst.root;
        this.mesh.add(root);
        const MINION_SCALE = 1.0;
        root.scale.multiplyScalar(MINION_SCALE);
        // Pre-rotate the GLB 180 degrees around Y so it aligns with Enemy.update's
        // seek-rotation formula (which faces +z away from the hero, expecting the
        // model to be authored facing -z). Kept from the Babylon build so facing
        // math stays aligned (the Phase D handedness audit may remove it).
        root.rotation.y += Math.PI;

        // Shift the GLB so its feet sit at y=0 (most rigged humanoids center on torso).
        this.mesh.updateMatrixWorld(true);
        const bbox = new Box3().setFromObject(this.mesh);
        const feetOffset = -bbox.min.y;
        root.position.y += feetOffset;

        // Register groups for base-class dispose cleanup (prevents animatable leak).
        this.glbAnimationGroups = inst.animationGroups;

        // Categorize all anim clips by name so we can switch between walk/attack/idle.
        for (const ag of inst.animationGroups) ag.stop();
        for (const ag of inst.animationGroups) {
            const n = ag.name.toLowerCase();
            // Hard-prefer "run3" for walk — this specific minion asset has multiple
            // run clips and run3 is the one we want. Falls back to walk/run aliases
            // for other assets.
            if (n.includes('run3')) {
                this.glbWalkAnim = ag;
            } else if (!this.glbWalkAnim && (n.includes('walk') || n.includes('run'))) {
                this.glbWalkAnim = ag;
            } else if (!this.glbAttackAnim && (n.includes('attack') || n.includes('hit') || n.includes('punch') || n.includes('strike') || n.includes('swing'))) {
                this.glbAttackAnim = ag;
            } else if (!this.glbIdleAnim && (n.includes('idle') || n === 'stand')) {
                this.glbIdleAnim = ag;
            }
        }
        // Fallbacks — make sure something plays.
        if (!this.glbWalkAnim && inst.animationGroups.length > 0) this.glbWalkAnim = inst.animationGroups[0];
        if (!this.glbIdleAnim) this.glbIdleAnim = this.glbWalkAnim;
        if (!this.glbAttackAnim) this.glbAttackAnim = this.glbWalkAnim;
        if (this.glbWalkAnim) {
            this.glbWalkAnim.start(true);
            this.glbCurrentAnim = this.glbWalkAnim;
        }
    }

    /** Switch to the named animation slot, no-op if already playing it. */
    private playGlbAnim(slot: AnimGroup | null, loop: boolean): void {
        if (!slot) return;
        if (this.glbCurrentAnim === slot) return;
        if (this.glbCurrentAnim) this.glbCurrentAnim.stop();
        slot.start(loop);
        this.glbCurrentAnim = slot;
    }

    /**
     * Create the enemy mesh - low-poly Goblin Warrior (procedural fallback)
     * Stocky proportions, pointy ears, crude shield on left arm, jagged sword on right,
     * big nose, underbite jaw, leather chest armor
     */
    private createMeshProcedural(): void {
        // --- Torso: wide, squat box (goblins are stocky) ---
        this.mesh = createBox('basicEnemyBody', {
            width: 0.75,
            height: 0.65,
            depth: 0.5
        }, this.scene);
        makeFlatShaded(this.mesh);
        this.mesh.position.copy(this.position);
        this.mesh.position.y += 0.65;
        this.mesh.material = createLowPolyMaterial('basicBodyMat', PALETTE.ENEMY_BASIC);

        // --- Belly patch: lighter green box on the front ---
        const belly = createBox('basicBelly', {
            width: 0.45,
            height: 0.40,
            depth: 0.08
        }, this.scene);
        makeFlatShaded(belly);
        this.mesh.add(belly);
        belly.position.set(0, -0.05, 0.26);
        belly.material = createLowPolyMaterial('basicBellyMat', PALETTE.ENEMY_BASIC_BELLY);

        // --- Leather armor: thin box over torso front ---
        const armor = createBox('basicArmor', {
            width: 0.65,
            height: 0.30,
            depth: 0.06
        }, this.scene);
        makeFlatShaded(armor);
        this.mesh.add(armor);
        armor.position.set(0, 0.15, 0.28);
        armor.material = createLowPolyMaterial('basicArmorMat', PALETTE.ENEMY_BASIC_ARMOR);

        // --- Belt: thin horizontal box ---
        const belt = createBox('basicBelt', {
            width: 0.78,
            height: 0.08,
            depth: 0.52
        }, this.scene);
        makeFlatShaded(belt);
        this.mesh.add(belt);
        belt.position.set(0, -0.28, 0);
        belt.material = createLowPolyMaterial('basicBeltMat', PALETTE.ENEMY_BASIC_ARMOR);

        // --- Head: slightly oversized sphere-like box (goblins have big heads) ---
        this.head = createBox('basicHead', {
            width: 0.58,
            height: 0.50,
            depth: 0.52
        }, this.scene);
        makeFlatShaded(this.head);
        this.mesh.add(this.head);
        this.head.position.set(0, 0.58, 0.04);
        this.head.material = createLowPolyMaterial('basicHeadMat', PALETTE.ENEMY_BASIC);

        // --- Big Nose: cone pointing forward ---
        const nose = createCylinder('basicNose', {
            height: 0.22,
            diameterTop: 0.0,
            diameterBottom: 0.14,
            tessellation: 4
        }, this.scene);
        makeFlatShaded(nose);
        this.head.add(nose);
        nose.position.set(0, -0.04, 0.30);
        nose.rotation.x = Math.PI / 2;
        nose.material = createLowPolyMaterial('basicNoseMat', PALETTE.ENEMY_BASIC_BELLY);

        // --- Underbite Jaw: small box jutting forward ---
        const jaw = createBox('basicJaw', {
            width: 0.38,
            height: 0.12,
            depth: 0.20
        }, this.scene);
        makeFlatShaded(jaw);
        this.head.add(jaw);
        jaw.position.set(0, -0.22, 0.18);
        jaw.material = createLowPolyMaterial('basicJawMat', PALETTE.ENEMY_BASIC);

        // --- Teeth: two small white boxes (snaggle teeth) ---
        const leftTooth = createBox('basicLeftTooth', {
            width: 0.06,
            height: 0.08,
            depth: 0.05
        }, this.scene);
        makeFlatShaded(leftTooth);
        jaw.add(leftTooth);
        leftTooth.position.set(-0.08, 0.08, 0.08);
        leftTooth.material = createLowPolyMaterial('basicToothMat1', new Color(0.92, 0.88, 0.72));

        const rightTooth = createBox('basicRightTooth', {
            width: 0.06,
            height: 0.10,
            depth: 0.05
        }, this.scene);
        makeFlatShaded(rightTooth);
        jaw.add(rightTooth);
        rightTooth.position.set(0.10, 0.10, 0.08);
        rightTooth.material = createLowPolyMaterial('basicToothMat2', new Color(0.92, 0.88, 0.72));

        // --- Left Eye: emissive yellow ---
        const leftEye = createBox('basicLeftEye', {
            width: 0.13,
            height: 0.09,
            depth: 0.06
        }, this.scene);
        makeFlatShaded(leftEye);
        this.head.add(leftEye);
        leftEye.position.set(-0.15, 0.08, 0.27);
        leftEye.material = createEmissiveMaterial('basicLeftEyeMat', PALETTE.ENEMY_BASIC_EYE, 0.8);

        // --- Right Eye: emissive yellow ---
        const rightEye = createBox('basicRightEye', {
            width: 0.13,
            height: 0.09,
            depth: 0.06
        }, this.scene);
        makeFlatShaded(rightEye);
        this.head.add(rightEye);
        rightEye.position.set(0.15, 0.08, 0.27);
        rightEye.material = createEmissiveMaterial('basicRightEyeMat', PALETTE.ENEMY_BASIC_EYE, 0.8);

        // --- Left Ear: pointy cone ---
        const leftEar = createCylinder('basicLeftEar', {
            height: 0.30,
            diameterTop: 0.0,
            diameterBottom: 0.10,
            tessellation: 3
        }, this.scene);
        makeFlatShaded(leftEar);
        this.head.add(leftEar);
        leftEar.position.set(-0.32, 0.08, 0);
        leftEar.rotation.z = Math.PI / 2.5;
        leftEar.material = createLowPolyMaterial('basicLeftEarMat', PALETTE.ENEMY_BASIC_BELLY);

        // --- Right Ear: pointy cone ---
        const rightEar = createCylinder('basicRightEar', {
            height: 0.30,
            diameterTop: 0.0,
            diameterBottom: 0.10,
            tessellation: 3
        }, this.scene);
        makeFlatShaded(rightEar);
        this.head.add(rightEar);
        rightEar.position.set(0.32, 0.08, 0);
        rightEar.rotation.z = -Math.PI / 2.5;
        rightEar.material = createLowPolyMaterial('basicRightEarMat', PALETTE.ENEMY_BASIC_BELLY);

        // --- Left Arm (shield arm): short box arm ---
        this.leftArm = createBox('basicLeftArm', {
            width: 0.16,
            height: 0.55,
            depth: 0.16
        }, this.scene);
        makeFlatShaded(this.leftArm);
        this.mesh.add(this.leftArm);
        this.leftArm.position.set(-0.48, 0.05, 0);
        this.leftArm.material = createLowPolyMaterial('basicLeftArmMat', PALETTE.ENEMY_BASIC);

        // --- Shield on left arm: flat wide box ---
        const shield = createBox('basicShield', {
            width: 0.06,
            height: 0.40,
            depth: 0.30
        }, this.scene);
        makeFlatShaded(shield);
        this.leftArm.add(shield);
        shield.position.set(-0.10, -0.10, 0.08);
        shield.material = createLowPolyMaterial('basicShieldMat', PALETTE.ENEMY_BASIC_METAL);

        // --- Shield boss (center knob): small box ---
        const shieldBoss = createBox('basicShieldBoss', {
            width: 0.04,
            height: 0.10,
            depth: 0.10
        }, this.scene);
        makeFlatShaded(shieldBoss);
        shield.add(shieldBoss);
        shieldBoss.position.set(-0.04, 0, 0);
        shieldBoss.material = createLowPolyMaterial('basicShieldBossMat', PALETTE.ENEMY_BASIC_ARMOR);

        // --- Right Arm (sword arm): short box arm ---
        this.rightArm = createBox('basicRightArm', {
            width: 0.16,
            height: 0.55,
            depth: 0.16
        }, this.scene);
        makeFlatShaded(this.rightArm);
        this.mesh.add(this.rightArm);
        this.rightArm.position.set(0.48, 0.05, 0);
        this.rightArm.material = createLowPolyMaterial('basicRightArmMat', PALETTE.ENEMY_BASIC);

        // --- Sword blade: tall thin box ---
        const sword = createBox('basicSword', {
            width: 0.05,
            height: 0.55,
            depth: 0.12
        }, this.scene);
        makeFlatShaded(sword);
        this.rightArm.add(sword);
        sword.position.set(0.08, -0.45, 0);
        sword.material = createLowPolyMaterial('basicSwordMat', PALETTE.ENEMY_BASIC_METAL);

        // --- Sword point: small cone on top of blade ---
        const swordTip = createCylinder('basicSwordTip', {
            height: 0.15,
            diameterTop: 0.0,
            diameterBottom: 0.12,
            tessellation: 3
        }, this.scene);
        makeFlatShaded(swordTip);
        sword.add(swordTip);
        swordTip.position.set(0, -0.35, 0);
        swordTip.material = createLowPolyMaterial('basicSwordTipMat', PALETTE.ENEMY_BASIC_METAL);

        // --- Left Leg ---
        this.leftLeg = createBox('basicLeftLeg', {
            width: 0.20,
            height: 0.50,
            depth: 0.20
        }, this.scene);
        makeFlatShaded(this.leftLeg);
        this.mesh.add(this.leftLeg);
        this.leftLeg.position.set(-0.20, -0.55, 0);
        this.leftLeg.material = createLowPolyMaterial('basicLeftLegMat', PALETTE.ENEMY_BASIC_ARMOR);

        // --- Left Foot ---
        const leftFoot = createBox('basicLeftFoot', {
            width: 0.22,
            height: 0.08,
            depth: 0.28
        }, this.scene);
        makeFlatShaded(leftFoot);
        this.leftLeg.add(leftFoot);
        leftFoot.position.set(0, -0.28, 0.06);
        leftFoot.material = createLowPolyMaterial('basicLeftFootMat', PALETTE.ENEMY_BASIC_ARMOR);

        // --- Right Leg ---
        this.rightLeg = createBox('basicRightLeg', {
            width: 0.20,
            height: 0.50,
            depth: 0.20
        }, this.scene);
        makeFlatShaded(this.rightLeg);
        this.mesh.add(this.rightLeg);
        this.rightLeg.position.set(0.20, -0.55, 0);
        this.rightLeg.material = createLowPolyMaterial('basicRightLegMat', PALETTE.ENEMY_BASIC_ARMOR);

        // --- Right Foot ---
        const rightFoot = createBox('basicRightFoot', {
            width: 0.22,
            height: 0.08,
            depth: 0.28
        }, this.scene);
        makeFlatShaded(rightFoot);
        this.rightLeg.add(rightFoot);
        rightFoot.position.set(0, -0.28, 0.06);
        rightFoot.material = createLowPolyMaterial('basicRightFootMat', PALETTE.ENEMY_BASIC_ARMOR);

        // Store original scale
        this.originalScale = 1.0;
    }

    /**
     * Override the health bar creation for basic enemies (positioned higher)
     */
    protected createHealthBar(): void {
        if (!this.mesh) return;
        this._barBand = null; // force the fill-material assignment in updateHealthBar

        // Two meshes, shared cached materials (see Enemy.createHealthBar): the
        // frame-sized near-black background doubles as the outline.
        this.healthBarBackgroundMesh = createPlane('healthBarBg', {
            width: 1.08,
            height: 0.14
        }, this.scene);
        this.healthBarBackgroundMesh.position.set(this.position.x, this.position.y + 1.9, this.position.z);
        this.healthBarBackgroundMesh.material = getCachedMaterial('healthBarBgFrameMat', m => {
            m.color    = new Color(0.05, 0.05, 0.05);
            m.specular = new Color(0, 0, 0);
            m.depthTest = false;
            m.depthWrite = false;
        });

        // Health fill — material assigned by updateHealthBar's band swap.
        this.healthBarMesh = createPlane('healthBar', {
            width: 1.0,
            height: 0.08
        }, this.scene);
        this.healthBarMesh.position.set(this.position.x, this.position.y + 1.9, this.position.z);

        this.updateHealthBar();
    }

    /**
     * Override the updateHealthBar method for basic enemies
     */
    protected updateHealthBar(): void {
        if (!this.mesh || !this.healthBarMesh || !this.healthBarBackgroundMesh) return;

        const healthPercent = Math.max(0, this.health / this.maxHealth);

        this.healthBarMesh.scale.x = healthPercent;

        const offset = (1 - healthPercent) * 0.5;
        this.healthBarMesh.position.x = this.position.x - offset;

        this.applyHealthBarBand(healthPercent);

        this.healthBarBackgroundMesh.position.x = this.position.x;
        this.healthBarBackgroundMesh.position.y = this.position.y + 1.9;
        this.healthBarBackgroundMesh.position.z = this.position.z;

        this.healthBarMesh.position.y = this.position.y + 1.9;
        this.healthBarMesh.position.z = this.position.z;

        this._billboardHealthBar();
    }

    /**
     * Update the enemy with goblin waddle-march animation
     * @param deltaTime Time elapsed since last update in seconds
     * @returns True if the enemy reached the end of the path
     */
    public update(deltaTime: number): boolean {
        if (!this.alive || !this.mesh) return false;

        // Get the result from the parent update method
        const result = super.update(deltaTime);

        // GLB minions skip the procedural limb animation — the asset's clips drive it.
        // Facing is handled by Enemy.update's seek-rotation; the GLB roots are
        // pre-rotated 180° in createMeshFromGLB so the model ends up facing the hero.
        if (this.usingGLB) {
            // Tick the attack hold timer regardless of state.
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
                const inRange = distSq <= BasicEnemy.GLB_ATTACK_RANGE * BasicEnemy.GLB_ATTACK_RANGE;
                if (inRange) {
                    // Refresh / start the hold timer so the attack anim runs for at
                    // least GLB_ATTACK_HOLD seconds even if the hero kites away.
                    this.glbAttackHoldTimer = BasicEnemy.GLB_ATTACK_HOLD;
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

    /** Goblin waddle-march pose — advances the walk phase and poses the limbs.
     *  Called by update() while marching and by tickNetworkProceduralAnim on
     *  the guest (which never ticks update()). */
    protected animateProceduralParts(deltaTime: number): void {
        if (!this.mesh) return;
        this.walkTime += deltaTime * 6; // Slightly faster for a frantic goblin waddle

        // Goblin waddle: body sways side-to-side AND bobs up/down
        const bobAmount = Math.abs(Math.sin(this.walkTime)) * 0.06;
        const swayAmount = Math.sin(this.walkTime * 0.5) * 0.04;
        this.mesh.position.y = this.position.y + 0.65 + bobAmount;
        this.mesh.rotation.z = Math.sin(this.walkTime) * 0.08; // Torso lean

        // Legs: alternating stride with bent-knee feel
        if (this.leftLeg && this.rightLeg) {
            this.leftLeg.rotation.x = Math.sin(this.walkTime) * 0.5;
            this.rightLeg.rotation.x = Math.sin(this.walkTime + Math.PI) * 0.5;
        }

        // Shield arm: held out to the side, slight sway
        if (this.leftArm) {
            this.leftArm.rotation.x = Math.sin(this.walkTime + Math.PI) * 0.15;
            this.leftArm.rotation.z = -0.2 + Math.sin(this.walkTime * 0.7) * 0.05;
        }

        // Sword arm: swings more aggressively
        if (this.rightArm) {
            this.rightArm.rotation.x = Math.sin(this.walkTime) * 0.55;
            this.rightArm.rotation.z = 0.1;
        }

        // Head: looks around nervously, quick twitches
        if (this.head) {
            this.head.rotation.y = Math.sin(this.walkTime * 1.3) * 0.15;
            this.head.rotation.x = Math.sin(this.walkTime * 0.8) * 0.05;
        }
    }

    /**
     * Create a death effect
     */
    protected createDeathEffect(): void {
        if (!this.mesh) return;

        // Cap concurrent death-burst particle effects (mass-AoE-kill spike guard).
        // Past the cap, skip only the poof — the death sound still plays.
        if (!tryAcquireDeathBurst()) {
            this.game.getAssetManager().playSound('enemyDeath');
            return;
        }

        const emitPos = this.position.clone();
        emitPos.y += 0.7;

        // Greenish-yellow goblin poof, floating upward (gravity is negative = anti-gravity).
        const particleSystem = new ParticleEffect(
            'deathParticles',
            this.scene,
            {
                looping: false,
                duration: 1.9,
                maxParticles: 50,
                emission: { rateOverTime: 0, bursts: [{ time: 0, count: 60 }] },
                startLifetime: { min: 0.5, max: 1.667 },
                startSize: { min: fxSize(0.1), max: fxSize(0.5) },
                startSpeed: { min: 4.874, max: 14.623 },
                startColor: { min: { r: 0.6, g: 0.8, b: 0.2 }, max: { r: 0.9, g: 0.7, b: 0.1 } },
                startOpacity: 1,
                rotationOverLifetime: { isActive: true, min: 0, max: 108 },
                opacityOverLifetime: { isActive: true, lifetimeCurve: { type: LifeTimeCurve.EASING, curveFunction: t => 1 - t } },
                gravity: -2.88,
                shape: { shape: Shape.CONE, cone: { angle: 10, radius: 0.2, radiusThickness: 1, arc: 360 } },
                transform: { position: emitPos, rotation: new Vector3(-Math.PI / 2, 0, 0) },
                map: getStatusEffectTexture(),
                renderer: fxRenderer('additive'),
            },
            { autoDispose: true }
        );

        // Play sound effect
        this.game.getAssetManager().playSound('enemyDeath');

        // Disposes once the burst's particles finish (autoDispose above);
        // this only wires the death-burst budget release into that disposal.
        scheduleDeathBurstTeardown(this.scene, particleSystem);
    }
}
