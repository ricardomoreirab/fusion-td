import { Box3, Color, Mesh, MeshBasicMaterial, Vector3 } from 'three';
import { Game } from '../../engine/Game';
import { Enemy, getStatusEffectTexture, tryAcquireDeathBurst, scheduleDeathBurstTeardown } from './Enemy';
import { createLowPolyMaterial, createEmissiveMaterial, makeFlatShaded, setMeshOpacity } from '../../engine/rendering/LowPolyMaterial';
import { getCachedMaterial } from '../../engine/rendering/MaterialCache';
import { PALETTE } from '../../engine/rendering/StyleConstants';
import { AnimGroup } from '../../engine/three/AnimGroup';
import type { GlbContainer } from '../../engine/three/assets';
import { headingToYaw, rgba } from '../../engine/three/math';
import { ParticleSystem } from '../../engine/three/particles/ParticleSystem';
import { createBox, createCylinder, createDisc, createSphere, createTorus, disposeMesh, isMeshDisposed } from '../../engine/three/primitives';

export class HealerEnemy extends Enemy {
    /** Static slot used by EnemyManager.spawnSurvivorsEnemy to stage a preloaded GLB
     *  asset before constructing a HealerEnemy. createMesh() consumes + clears it. */
    public static pendingAsset: GlbContainer | null = null;

    private walkTime: number = 0;
    private healTimer: number = 0;
    private staff: Mesh | null = null;
    private staffOrb: Mesh | null = null;
    private auraRing: Mesh | null = null;
    private head: Mesh | null = null;
    private leftArm: Mesh | null = null;
    private rightArm: Mesh | null = null;

    // Ground glow disc under healer (constant soft indicator)
    private groundGlow: Mesh | null = null;

    /** True when this instance renders via the blue-wizard GLB. */
    private usingGLB: boolean = false;
    private glbWalkAnim: AnimGroup | null = null;
    private glbAttackAnim: AnimGroup | null = null;
    private glbIdleAnim: AnimGroup | null = null;
    private glbCurrentAnim: AnimGroup | null = null;
    protected glbAttackHoldTimer: number = 0;
    private static readonly GLB_ATTACK_RANGE = 4.0;
    private static readonly GLB_ATTACK_HOLD = 0.6;
    private static readonly GLB_SCALE = 1.4;

    constructor(game: Game, position: Vector3, path: Vector3[]) {
        // Healer enemy: moderate speed, low HP, low damage, decent reward
        super(game, position, path, 3.5, 25, 5, 30);
        this.contactDamagePerSecond = 4;

        // Shaman staff-poke — weak melee; the healer's role is to heal allies, not brawl.
        this.meleeRange            = 1.3;
        this.meleeHitRange         = 1.6;
        this.meleeHitDamage        = 6;
        this.meleeWindupDuration   = 0.35;
        this.meleeStrikeDuration   = 0.1;
        this.meleeCooldownDuration = 0.7;

        // Anchor HP bar above shaman's head (taller than base enemy).
        this.applyHealthBarTier('normal', { heightOffset: 1.9 });

        // Build mesh + health bar AFTER field initializers have run (see Enemy
        // constructor note). new.target guard → fires only for the concrete leaf.
        if (new.target === HealerEnemy) this._initEnemyVisuals();
    }

    /**
     * Create the enemy mesh. If a GLB asset was staged via HealerEnemy.pendingAsset
     * (set by EnemyManager just before construction), instantiate it. Otherwise fall
     * back to the procedural mystic-shaman build below.
     */
    protected createMesh(): void {
        const asset = HealerEnemy.pendingAsset;
        HealerEnemy.pendingAsset = null;
        if (asset) {
            this.createMeshFromGLB(asset);
            return;
        }
        this.createMeshProcedural();
    }

    private createMeshFromGLB(asset: GlbContainer): void {
        this.usingGLB = true;
        this.mesh = new Mesh(); // empty transform host (renders nothing)
        this.mesh.name = 'healerEnemyGlbRoot';
        this.scene.scene.add(this.mesh);
        this.mesh.position.copy(this.position);

        const inst = asset.instantiate(this.scene, 'healer_');
        // Base Enemy field; its dispose() frees cloned materials + skeletons + mixer hook.
        this.glbInstance = inst;
        const root = inst.root;
        this.mesh.add(root);
        root.scale.multiplyScalar(HealerEnemy.GLB_SCALE);
        // Keep the Babylon-era 180-degree Y pre-rotation so facing math stays aligned
        // (Phase D handedness audit may remove it) — same pattern as BasicEnemy GLB.
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
            } else if (!this.glbAttackAnim && (n.includes('attack') || n.includes('cast') || n.includes('spell') || n.includes('shoot') || n.includes('fire') || n.includes('hit') || n.includes('strike'))) {
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
     * Create the enemy mesh - low-poly Mystic Shaman (procedural fallback)
     * Robed figure with hood, carrying a staff with glowing orb,
     * glowing aura ring at feet, emissive cyan-green eyes
     */
    private createMeshProcedural(): void {
        // --- Robed Body: tapered cylinder (wide at bottom, narrow at top) ---
        this.mesh = createCylinder('healerEnemyBody', {
            height: 1.0,
            diameterTop: 0.45,
            diameterBottom: 0.65,
            tessellation: 6
        }, this.scene);
        makeFlatShaded(this.mesh);
        this.mesh.position.copy(this.position);
        this.mesh.position.y += 0.7;
        this.mesh.material = createLowPolyMaterial('healerBodyMat', PALETTE.ENEMY_HEALER);

        // --- Robe trim: thin ring at bottom of robe ---
        const robeTrim = createTorus('healerRobeTrim', {
            diameter: 0.65,
            thickness: 0.06,
            tessellation: 8
        }, this.scene);
        makeFlatShaded(robeTrim);
        this.mesh.add(robeTrim);
        robeTrim.position.set(0, -0.48, 0);
        robeTrim.material = createEmissiveMaterial('healerRobeTrimMat', PALETTE.ENEMY_HEALER_GLOW, 0.4);

        // --- Hood / Head: sphere-like polyhedron with hood drape ---
        this.head = createBox('healerHead', {
            width: 0.40,
            height: 0.38,
            depth: 0.40
        }, this.scene);
        makeFlatShaded(this.head);
        this.mesh.add(this.head);
        this.head.position.set(0, 0.65, 0.02);
        this.head.material = createLowPolyMaterial('healerHeadMat', PALETTE.ENEMY_HEALER);

        // --- Hood cowl: slightly larger cylinder behind head ---
        const cowl = createCylinder('healerCowl', {
            height: 0.35,
            diameterTop: 0.42,
            diameterBottom: 0.50,
            tessellation: 5
        }, this.scene);
        makeFlatShaded(cowl);
        this.head.add(cowl);
        cowl.position.set(0, 0.05, -0.08);
        cowl.material = createLowPolyMaterial('healerCowlMat', PALETTE.ENEMY_HEALER);

        // --- Left Eye: emissive cyan-green ---
        const leftEye = createBox('healerLeftEye', {
            width: 0.10,
            height: 0.06,
            depth: 0.05
        }, this.scene);
        makeFlatShaded(leftEye);
        this.head.add(leftEye);
        leftEye.position.set(-0.10, 0.02, 0.20);
        leftEye.material = createEmissiveMaterial('healerLeftEyeMat', PALETTE.ENEMY_HEALER_EYE, 1.0);

        // --- Right Eye: emissive cyan-green ---
        const rightEye = createBox('healerRightEye', {
            width: 0.10,
            height: 0.06,
            depth: 0.05
        }, this.scene);
        makeFlatShaded(rightEye);
        this.head.add(rightEye);
        rightEye.position.set(0.10, 0.02, 0.20);
        rightEye.material = createEmissiveMaterial('healerRightEyeMat', PALETTE.ENEMY_HEALER_EYE, 1.0);

        // --- Left Arm: short robed arm ---
        this.leftArm = createBox('healerLeftArm', {
            width: 0.14,
            height: 0.45,
            depth: 0.14
        }, this.scene);
        makeFlatShaded(this.leftArm);
        this.mesh.add(this.leftArm);
        this.leftArm.position.set(-0.32, 0.15, 0);
        this.leftArm.material = createLowPolyMaterial('healerLeftArmMat', PALETTE.ENEMY_HEALER);

        // --- Right Arm: short robed arm (holds staff) ---
        this.rightArm = createBox('healerRightArm', {
            width: 0.14,
            height: 0.45,
            depth: 0.14
        }, this.scene);
        makeFlatShaded(this.rightArm);
        this.mesh.add(this.rightArm);
        this.rightArm.position.set(0.32, 0.15, 0);
        this.rightArm.material = createLowPolyMaterial('healerRightArmMat', PALETTE.ENEMY_HEALER);

        // --- Staff: tall thin cylinder held by right arm ---
        this.staff = createCylinder('healerStaff', {
            height: 1.6,
            diameterTop: 0.05,
            diameterBottom: 0.07,
            tessellation: 5
        }, this.scene);
        makeFlatShaded(this.staff);
        this.rightArm.add(this.staff);
        this.staff.position.set(0.10, 0.35, 0.05);
        this.staff.material = createLowPolyMaterial('healerStaffMat', PALETTE.ENEMY_HEALER_STAFF);

        // --- Staff Orb: glowing emissive sphere on top of staff ---
        this.staffOrb = createSphere('healerStaffOrb', {
            diameter: 0.22,
            segments: 4
        }, this.scene);
        makeFlatShaded(this.staffOrb);
        this.staff.add(this.staffOrb);
        this.staffOrb.position.set(0, 0.85, 0);
        this.staffOrb.material = createEmissiveMaterial('healerStaffOrbMat', PALETTE.ENEMY_HEALER_GLOW, 1.5);

        // --- Staff Orb ring: small torus around the orb ---
        const orbRing = createTorus('healerOrbRing', {
            diameter: 0.28,
            thickness: 0.03,
            tessellation: 8
        }, this.scene);
        makeFlatShaded(orbRing);
        this.staffOrb.add(orbRing);
        orbRing.position.set(0, 0, 0);
        orbRing.material = createEmissiveMaterial('healerOrbRingMat', PALETTE.ENEMY_HEALER_GLOW, 0.8);

        // --- Aura Ring at feet: thin emissive torus on the ground ---
        this.auraRing = createTorus('healerAuraRing', {
            diameter: 1.2,
            thickness: 0.06,
            tessellation: 16
        }, this.scene);
        makeFlatShaded(this.auraRing);
        this.mesh.add(this.auraRing);
        this.auraRing.position.set(0, -0.50, 0);
        this.auraRing.material = createEmissiveMaterial('healerAuraRingMat', PALETTE.ENEMY_HEALER_GLOW, 1.2);

        // --- Ground glow: soft constant disc at feet so players spot healers at a glance ---
        this.groundGlow = createDisc('healerGroundGlow', { radius: 0.70, tessellation: 16 }, this.scene);
        this.mesh.add(this.groundGlow);
        this.groundGlow.rotation.x = -Math.PI / 2; // lie flat, facing up (+Y normal in Three)
        this.groundGlow.position.set(0, -0.52, 0);
        // Babylon disableLighting rendered emissive only → unlit basic material,
        // uniquely owned by this mesh (freed with the tree via ownedMaterial).
        const groundGlowMat = new MeshBasicMaterial({
            color: PALETTE.ENEMY_HEALER_GLOW.clone(),
            transparent: true,
            opacity: 0.35,
            depthWrite: false,
        });
        groundGlowMat.name = 'healerGroundGlowMat';
        this.groundGlow.material = groundGlowMat;
        this.groundGlow.userData.ownedMaterial = true;

        // Store original scale
        this.originalScale = 1.0;
    }

    // HP bar creation/update is inherited from Enemy.ts and anchored by
    // `barHeightOffset` set in the constructor via applyHealthBarTier.

    /**
     * Update the enemy with shaman floating/bobbing animation and healing aura
     * @param deltaTime Time elapsed since last update in seconds
     * @returns True if the enemy reached the end of the path
     */
    public update(deltaTime: number): boolean {
        if (!this.alive || !this.mesh) return false;

        // Get the result from the parent update method
        const result = super.update(deltaTime);

        // Support behavior (heal pulse). Overridable: RedWizard replaces this with
        // a ranged bolt attack instead of healing.
        this.performSupportBehavior(deltaTime);

        // GLB wizard skips the procedural staff/orb anim — the asset's clips drive it.
        // Facing is handled by Enemy.update's seek-rotation; the GLB root is pre-rotated
        // 180° in createMeshFromGLB so the model ends up facing the hero.
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
                const inRange = distSq <= HealerEnemy.GLB_ATTACK_RANGE * HealerEnemy.GLB_ATTACK_RANGE;
                if (inRange) {
                    this.glbAttackHoldTimer = HealerEnemy.GLB_ATTACK_HOLD;
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

    /** Shaman float/bob pose — advances the walk phase and animates the body,
     *  head, arms, staff orb, and aura ring. Called by update() while moving
     *  and by tickNetworkProceduralAnim on the guest. */
    protected animateProceduralParts(deltaTime: number): void {
        if (!this.mesh) return;
        this.walkTime += deltaTime * 4; // Gentle pace for a mystic

        // Gentle float/bob: shaman hovers slightly as it walks
        const bobAmount = Math.sin(this.walkTime * 0.8) * 0.08;
        this.mesh.position.y = this.position.y + 0.7 + bobAmount;

        // Subtle body sway
        this.mesh.rotation.z = Math.sin(this.walkTime * 0.5) * 0.05;

        // Head: slow mystical scanning
        if (this.head) {
            this.head.rotation.y = Math.sin(this.walkTime * 0.6) * 0.12;
            this.head.rotation.x = Math.sin(this.walkTime * 0.4) * 0.04;
        }

        // Left arm: gentle sway
        if (this.leftArm) {
            this.leftArm.rotation.x = Math.sin(this.walkTime * 0.7 + Math.PI) * 0.20;
        }

        // Right arm + staff: sway with staff motion
        if (this.rightArm) {
            this.rightArm.rotation.x = Math.sin(this.walkTime * 0.7) * 0.15;
            this.rightArm.rotation.z = 0.1 + Math.sin(this.walkTime * 0.5) * 0.05;
        }

        // Staff orb: pulsing glow scale
        if (this.staffOrb) {
            const orbPulse = 0.9 + Math.sin(this.walkTime * 2.0) * 0.2;
            this.staffOrb.scale.set(orbPulse, orbPulse, orbPulse);
        }

        // Aura ring: pulsing scale and gentle rotation
        if (this.auraRing) {
            const auraPulse = 0.85 + Math.sin(this.walkTime * 1.5) * 0.2;
            this.auraRing.scale.set(auraPulse, 1.0, auraPulse);
            this.auraRing.rotation.y += deltaTime * 1.2;
        }
    }

    /**
     * Per-frame support behavior. Base healer: every 1s, dispatch a heal pulse to
     * nearby allies + spawn the telegraph ring. Subclasses (RedWizard) override this
     * to do something else entirely (e.g. fire a projectile) without touching the
     * shared GLB/animation/movement code in update().
     */
    protected performSupportBehavior(deltaTime: number): void {
        this.healTimer += deltaTime;
        if (this.healTimer >= 1.0) {
            this.healTimer -= 1.0;
            const healEvent = new CustomEvent('enemyHeal', {
                detail: {
                    position: this.position,
                    radius: 3,
                    healAmount: 5
                }
            });
            document.dispatchEvent(healEvent);

            // Expanding pulse ring visual at healer's feet
            this.spawnHealPulseRing();
        }
    }

    /**
     * Create a death effect
     */
    protected createDeathEffect(): void {
        if (!this.mesh) return;

        // Cap concurrent death-burst particle systems (mass-AoE-kill spike guard).
        // Past the cap, skip only the poof — the death sound still plays.
        if (!tryAcquireDeathBurst()) {
            this.game.getAssetManager().playSound('enemyDeath');
            return;
        }

        // Create a healing-themed explosion effect
        const particleSystem = new ParticleSystem('deathParticles', 50, this.scene);

        // Set particle texture
        particleSystem.particleTexture = getStatusEffectTexture();

        // Set emission properties
        particleSystem.emitter = this.position.clone();
        (particleSystem.emitter as Vector3).y += 0.7;
        particleSystem.minEmitBox.set(-0.2, 0, -0.2);
        particleSystem.maxEmitBox.set(0.2, 0, 0.2);

        // Set particle properties - green/purple mystic poof
        particleSystem.color1 = rgba(0.30, 0.95, 0.50, 1.0);
        particleSystem.color2 = rgba(0.40, 0.25, 0.65, 1.0);
        particleSystem.colorDead = rgba(0.15, 0.30, 0.20, 0.0);

        particleSystem.minSize = 0.1;
        particleSystem.maxSize = 0.5;

        particleSystem.minLifeTime = 0.3;
        particleSystem.maxLifeTime = 1.0;

        particleSystem.emitRate = 100;

        particleSystem.blendMode = ParticleSystem.BLENDMODE_ONEONE;

        particleSystem.gravity.set(0, 8, 0);

        particleSystem.direction1.set(-1, 8, -1);
        particleSystem.direction2.set(1, 8, 1);

        particleSystem.minAngularSpeed = 0;
        particleSystem.maxAngularSpeed = Math.PI;

        particleSystem.minEmitPower = 1;
        particleSystem.maxEmitPower = 3;
        particleSystem.updateSpeed = 0.01;

        // Start the particle system
        particleSystem.start();

        // Play sound effect
        this.game.getAssetManager().playSound('enemyDeath');

        // Emit 1s, dispose when the last particle expires (render-loop driven —
        // see scheduleDeathBurstTeardown). The engine ParticleSystem never
        // disposes its texture, so the SHARED status-effect singleton
        // (getStatusEffectTexture) stays alive for other enemies' live status
        // particles.
        scheduleDeathBurstTeardown(this.scene, particleSystem, 1.0);
    }

    /**
     * Spawn an expanding green ring at the healer's feet to telegraph a heal pulse.
     * Ring animates from radius 0.5 → 3.0 over 0.5 s then disposes.
     */
    private spawnHealPulseRing(): void {
        const ring = createDisc('healPulseRing', { radius: 0.5, tessellation: 24 }, this.scene);
        ring.rotation.x = -Math.PI / 2; // lie flat, facing up (+Y normal in Three)
        ring.position.copy(this.position);
        ring.position.y += 0.05;

        // Cache by stable key — one shared material for all heal rings.
        // Math.random() name forced a fresh material per heal pulse. Fade via
        // setMeshOpacity (clone-on-write), never the shared mat's .opacity.
        // Black diffuse + emissive ≈ Babylon's disableLighting emissive-only look.
        ring.material = getCachedMaterial('healPulseRingMat', m => {
            m.emissive = PALETTE.ENEMY_HEALER_GLOW.clone();
            m.color = new Color(0, 0, 0);
            m.transparent = true;
            m.opacity = 0.60;
            m.depthWrite = false;
        });
        setMeshOpacity(ring, 0.60);

        const startTime = performance.now();
        const duration = 500; // ms
        const startRadius = 0.5;
        const endRadius = 3.0;

        const observer = this.scene.onBeforeRender.add(() => {
            if (isMeshDisposed(ring)) {
                this.scene.onBeforeRender.remove(observer);
                return;
            }
            const elapsed = performance.now() - startTime;
            const t = Math.min(elapsed / duration, 1.0);
            const radius = startRadius + (endRadius - startRadius) * t;
            const scale = radius / startRadius;
            ring.scale.set(scale, scale, scale);
            setMeshOpacity(ring, 0.60 * (1 - t));

            if (t >= 1.0) {
                this.scene.onBeforeRender.remove(observer);
                disposeMesh(ring); // frees the mesh-owned fade clone; the cached mat survives
            }
        });
    }
}
