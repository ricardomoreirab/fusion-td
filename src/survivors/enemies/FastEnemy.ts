import { Box3, Color, Mesh, MeshPhongMaterial, Vector3 } from 'three';
import { Game } from '../../engine/Game';
import { Enemy } from './Enemy';
import { getCachedMaterial } from '../../engine/rendering/MaterialCache';
import { createLowPolyMaterial, createEmissiveMaterial, makeFlatShaded } from '../../engine/rendering/LowPolyMaterial';
import { PALETTE } from '../../engine/rendering/StyleConstants';
import { AnimGroup } from '../../engine/three/AnimGroup';
import type { GlbContainer } from '../../engine/three/assets';
import { headingToYaw } from '../../engine/three/math';
import { createBox, createCylinder, createPlane, createPolyhedron, createSphere, disposeMesh, isMeshDisposed } from '../../engine/three/primitives';

export class FastEnemy extends Enemy {
    /** Static slot used by EnemyManager.spawnSurvivorsEnemy to stage a preloaded GLB
     *  asset before constructing a FastEnemy. createMesh() consumes + clears it. */
    public static pendingAsset: GlbContainer | null = null;

    private flyTime: number = 0;
    private leftWing: Mesh | null = null;
    private rightWing: Mesh | null = null;
    private head: Mesh | null = null;
    private cloakLeft: Mesh | null = null;
    private cloakRight: Mesh | null = null;
    private tailWisp: Mesh | null = null;

    // Motion-trail ghost meshes (3 trailing copies)
    private ghostTrails: Mesh[] = [];
    // Previous positions ring buffer for smooth trailing
    private trailPositions: Array<{ x: number; y: number; z: number }> = [];

    /** True when this instance renders via the artillery-carriage GLB. */
    private usingGLB: boolean = false;
    private glbWalkAnim: AnimGroup | null = null;
    private glbAttackAnim: AnimGroup | null = null;
    private glbIdleAnim: AnimGroup | null = null;
    private glbCurrentAnim: AnimGroup | null = null;
    private static readonly GLB_ATTACK_RANGE = 2.5;

    constructor(game: Game, position: Vector3, path: Vector3[]) {
        // Fast enemy has 2x speed, low health, low damage, and medium reward
        super(game, position, path, 6, 20, 5, 15);

        // Set as a flying enemy
        this.isFlying = true;
        this.contactDamagePerSecond = 5;

        // Wraith slash — quick darting strike, very short windup.
        this.meleeRange            = 1.4;
        this.meleeHitRange         = 1.7;
        this.meleeHitDamage        = 7;
        this.meleeWindupDuration   = 0.2;
        this.meleeStrikeDuration   = 0.08;
        this.meleeCooldownDuration = 0.35;

        // Build mesh + health bar AFTER field initializers have run (see Enemy
        // constructor note). new.target guard → fires only for the concrete leaf.
        if (new.target === FastEnemy) this._initEnemyVisuals();
    }

    /**
     * Create the enemy mesh. If a GLB asset was staged via FastEnemy.pendingAsset
     * (set by EnemyManager just before construction), instantiate it. Otherwise
     * fall back to the procedural spectral-wraith build below.
     */
    protected createMesh(): void {
        const asset = FastEnemy.pendingAsset;
        FastEnemy.pendingAsset = null;
        if (asset) {
            this.createMeshFromGLB(asset);
            return;
        }
        this.createMeshProcedural();
    }

    private createMeshFromGLB(asset: GlbContainer): void {
        this.usingGLB = true;
        this.mesh = new Mesh();
        this.mesh.name = 'fastEnemyGlbRoot';
        this.scene.scene.add(this.mesh);
        this.mesh.position.copy(this.position);

        const inst = asset.instantiate(this.scene, 'fast_');
        this.glbInstance = inst;
        const root = inst.root;
        this.mesh.add(root);
        const FAST_SCALE = 1.0;
        root.scale.multiplyScalar(FAST_SCALE);
        // 180° Y flip — same pattern as BasicEnemy GLB. Kept from the Babylon
        // build so facing math stays aligned (the Phase D handedness audit may
        // remove it).
        root.rotation.y += Math.PI;

        // Feet-on-ground offset.
        this.mesh.updateMatrixWorld(true);
        const bbox = new Box3().setFromObject(this.mesh);
        const feetOffset = -bbox.min.y;
        root.position.y += feetOffset;

        // Register groups for base-class dispose cleanup (prevents animatable leak).
        this.glbAnimationGroups = inst.animationGroups;

        for (const ag of inst.animationGroups) ag.stop();
        for (const ag of inst.animationGroups) {
            const n = ag.name.toLowerCase();
            if (n.includes('run3')) {
                this.glbWalkAnim = ag;
            } else if (!this.glbWalkAnim && (n.includes('walk') || n.includes('run') || n.includes('roll') || n.includes('move'))) {
                this.glbWalkAnim = ag;
            } else if (!this.glbAttackAnim && (n.includes('attack') || n.includes('shoot') || n.includes('fire') || n.includes('hit') || n.includes('cannon'))) {
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
     * Create the enemy mesh - low-poly Spectral Wraith (procedural fallback)
     * Ethereal floating figure: hooded head, no legs (cloak trails away),
     * bony arms reaching forward, ghostly wisp trails, eerie glowing eyes
     */
    private createMeshProcedural(): void {
        // --- Core body: tall narrow cone tapering downward (spectral cloak shape) ---
        this.mesh = createCylinder('fastEnemyBody', {
            height: 1.1,
            diameterTop: 0.50,
            diameterBottom: 0.08,
            tessellation: 5
        }, this.scene);
        makeFlatShaded(this.mesh);

        // Position at starting position, raised for flying
        this.mesh.position.copy(this.position);
        this.mesh.position.y += 1.3;

        const bodyMat = createLowPolyMaterial('fastBodyMat', PALETTE.ENEMY_FAST);
        bodyMat.transparent = true;
        bodyMat.opacity = 0.85; // Slightly translucent for ghostly feel
        this.mesh.material = bodyMat;

        // --- Hood / Head: slightly squashed sphere-like shape ---
        this.head = createPolyhedron('fastHead', {
            type: 2, // Icosahedron for faceted look
            size: 0.22
        }, this.scene);
        makeFlatShaded(this.head);
        this.mesh.add(this.head);
        this.head.position.set(0, 0.55, 0.05);
        this.head.scale.set(1.0, 0.85, 1.1); // Slightly flattened, elongated
        this.head.material = createLowPolyMaterial('fastHeadMat', PALETTE.ENEMY_FAST_CLOAK);

        // --- Hood cowl: half-cylinder draping behind the head ---
        const cowl = createCylinder('fastCowl', {
            height: 0.35,
            diameterTop: 0.48,
            diameterBottom: 0.55,
            tessellation: 5
        }, this.scene);
        makeFlatShaded(cowl);
        this.head.add(cowl);
        cowl.position.set(0, 0.10, -0.08);
        cowl.material = createLowPolyMaterial('fastCowlMat', PALETTE.ENEMY_FAST_CLOAK);

        // --- Left Eye: eerie pale glow ---
        const leftEye = createBox('fastLeftEye', {
            width: 0.12,
            height: 0.04,
            depth: 0.04
        }, this.scene);
        makeFlatShaded(leftEye);
        this.head.add(leftEye);
        leftEye.position.set(-0.10, 0.0, 0.20);
        leftEye.material = createEmissiveMaterial('fastLeftEyeMat', PALETTE.ENEMY_FAST_EYE, 1.2);

        // --- Right Eye: eerie pale glow ---
        const rightEye = createBox('fastRightEye', {
            width: 0.12,
            height: 0.04,
            depth: 0.04
        }, this.scene);
        makeFlatShaded(rightEye);
        this.head.add(rightEye);
        rightEye.position.set(0.10, 0.0, 0.20);
        rightEye.material = createEmissiveMaterial('fastRightEyeMat', PALETTE.ENEMY_FAST_EYE, 1.2);

        // --- Left Arm: thin bony reaching limb ---
        this.leftWing = createBox('fastLeftArm', {
            width: 0.55,
            height: 0.06,
            depth: 0.08
        }, this.scene);
        makeFlatShaded(this.leftWing);
        this.mesh.add(this.leftWing);
        this.leftWing.position.set(-0.38, 0.25, 0.12);
        this.leftWing.rotation.z = Math.PI / 6;
        this.leftWing.rotation.y = -0.3;
        this.leftWing.material = createLowPolyMaterial('fastLeftArmMat', PALETTE.ENEMY_FAST_CLOAK);

        // Left claw: small cone
        const leftClaw = createCylinder('fastLeftClaw', {
            height: 0.12,
            diameterTop: 0.0,
            diameterBottom: 0.06,
            tessellation: 3
        }, this.scene);
        makeFlatShaded(leftClaw);
        this.leftWing.add(leftClaw);
        leftClaw.position.set(-0.28, 0, 0.02);
        leftClaw.rotation.z = Math.PI / 2;
        leftClaw.material = createLowPolyMaterial('fastLeftClawMat', PALETTE.ENEMY_FAST_WISP);

        // --- Right Arm: thin bony reaching limb ---
        this.rightWing = createBox('fastRightArm', {
            width: 0.55,
            height: 0.06,
            depth: 0.08
        }, this.scene);
        makeFlatShaded(this.rightWing);
        this.mesh.add(this.rightWing);
        this.rightWing.position.set(0.38, 0.25, 0.12);
        this.rightWing.rotation.z = -Math.PI / 6;
        this.rightWing.rotation.y = 0.3;
        this.rightWing.material = createLowPolyMaterial('fastRightArmMat', PALETTE.ENEMY_FAST_CLOAK);

        // Right claw: small cone
        const rightClaw = createCylinder('fastRightClaw', {
            height: 0.12,
            diameterTop: 0.0,
            diameterBottom: 0.06,
            tessellation: 3
        }, this.scene);
        makeFlatShaded(rightClaw);
        this.rightWing.add(rightClaw);
        rightClaw.position.set(0.28, 0, 0.02);
        rightClaw.rotation.z = -Math.PI / 2;
        rightClaw.material = createLowPolyMaterial('fastRightClawMat', PALETTE.ENEMY_FAST_WISP);

        // --- Cloak flare left: flat triangle trailing behind ---
        this.cloakLeft = createCylinder('fastCloakLeft', {
            height: 0.5,
            diameterTop: 0.30,
            diameterBottom: 0.0,
            tessellation: 3
        }, this.scene);
        makeFlatShaded(this.cloakLeft);
        this.mesh.add(this.cloakLeft);
        this.cloakLeft.position.set(-0.18, -0.45, -0.15);
        this.cloakLeft.rotation.x = 0.3;
        const cloakMatL = createLowPolyMaterial('fastCloakLeftMat', PALETTE.ENEMY_FAST);
        cloakMatL.transparent = true;
        cloakMatL.opacity = 0.7;
        this.cloakLeft.material = cloakMatL;

        // --- Cloak flare right ---
        this.cloakRight = createCylinder('fastCloakRight', {
            height: 0.5,
            diameterTop: 0.30,
            diameterBottom: 0.0,
            tessellation: 3
        }, this.scene);
        makeFlatShaded(this.cloakRight);
        this.mesh.add(this.cloakRight);
        this.cloakRight.position.set(0.18, -0.45, -0.15);
        this.cloakRight.rotation.x = 0.3;
        const cloakMatR = createLowPolyMaterial('fastCloakRightMat', PALETTE.ENEMY_FAST);
        cloakMatR.transparent = true;
        cloakMatR.opacity = 0.7;
        this.cloakRight.material = cloakMatR;

        // --- Tail Wisp: glowing small emissive shape trailing below ---
        this.tailWisp = createPolyhedron('fastTailWisp', {
            type: 1, // Octahedron
            size: 0.08
        }, this.scene);
        makeFlatShaded(this.tailWisp);
        this.mesh.add(this.tailWisp);
        this.tailWisp.position.set(0, -0.65, -0.08);
        this.tailWisp.material = createEmissiveMaterial('fastTailWispMat', PALETTE.ENEMY_FAST_WISP, 1.0);

        // --- Core glow: small emissive sphere in chest area ---
        const coreGlow = createSphere('fastCoreGlow', {
            diameter: 0.14,
            segments: 4
        }, this.scene);
        makeFlatShaded(coreGlow);
        this.mesh.add(coreGlow);
        coreGlow.position.set(0, 0.20, 0.12);
        coreGlow.material = createEmissiveMaterial('fastCoreGlowMat', PALETTE.ENEMY_FAST_EYE, 1.5);

        // --- Motion trail: 1 ghost clone of the body trailing behind the wraith ---
        // Reduced from 3 → 1 to cut FastEnemy mesh count and draw calls.
        this.ghostTrails = [];
        {
            const ghost = createCylinder('fastGhost0', {
                height: 1.1,
                diameterTop: 0.50,
                diameterBottom: 0.08,
                tessellation: 5
            }, this.scene);
            makeFlatShaded(ghost);
            ghost.position.copy(this.position);
            ghost.position.y += 1.3;
            const ghostMat = new MeshPhongMaterial();
            ghostMat.name = 'fastGhostMat';
            ghostMat.color = PALETTE.ENEMY_FAST.clone();
            ghostMat.emissive = PALETTE.ENEMY_FAST_WISP.clone().multiplyScalar(0.5);
            ghostMat.specular = new Color(0, 0, 0);
            ghostMat.transparent = true;
            ghostMat.opacity = 0.22;
            ghost.material = ghostMat;
            // Uniquely-owned animated material — flagged so any disposal path
            // frees it (disposeAuxVisuals also passes { materials: true }).
            ghost.userData.ownedMaterial = true;
            this.ghostTrails.push(ghost);
        }

        // Store original scale
        this.originalScale = 1.0;
    }

    /**
     * Override the health bar creation for fast enemies (positioned higher for flying)
     */
    protected createHealthBar(): void {
        if (!this.mesh) return;

        this._barBand = null; // force the fill-material assignment in updateHealthBar

        // Two meshes, shared cached materials (see Enemy.createHealthBar): the
        // frame-sized near-black background doubles as the outline.
        this.healthBarBackgroundMesh = createPlane('healthBarBg', {
            width: 0.88,
            height: 0.14
        }, this.scene);
        this.healthBarBackgroundMesh.position.set(this.position.x, this.position.y + 2.3, this.position.z);
        this.healthBarBackgroundMesh.material = getCachedMaterial('healthBarBgFrameMat', m => {
            m.color    = new Color(0.05, 0.05, 0.05);
            m.specular = new Color(0, 0, 0);
            m.depthTest = false;
            m.depthWrite = false;
        });

        // Health fill — material assigned by updateHealthBar's band swap.
        this.healthBarMesh = createPlane('healthBar', {
            width: 0.8,
            height: 0.08
        }, this.scene);
        this.healthBarMesh.position.set(this.position.x, this.position.y + 2.3, this.position.z);

        this.updateHealthBar();
    }

    /**
     * Override the updateHealthBar method for fast enemies
     */
    protected updateHealthBar(): void {
        if (!this.mesh || !this.healthBarMesh || !this.healthBarBackgroundMesh) return;

        const healthPercent = Math.max(0, this.health / this.maxHealth);

        this.healthBarMesh.scale.x = healthPercent;

        const offset = (1 - healthPercent) * 0.4; // Adjusted for narrower bar (0.8 width)
        this.healthBarMesh.position.x = this.position.x - offset;

        this.applyHealthBarBand(healthPercent);

        this.healthBarBackgroundMesh.position.x = this.position.x;
        this.healthBarBackgroundMesh.position.y = this.position.y + 2.3;
        this.healthBarBackgroundMesh.position.z = this.position.z;

        this.healthBarMesh.position.y = this.position.y + 2.3;
        this.healthBarMesh.position.z = this.position.z;

        this._billboardHealthBar();
    }

    /**
     * Update the enemy with ghostly swooping flight animation
     * @param deltaTime Time elapsed since last update in seconds
     * @returns True if the enemy reached the end of the path
     */
    public update(deltaTime: number): boolean {
        if (!this.alive || !this.mesh) return false;

        // Get the result from the parent update method
        const result = super.update(deltaTime);

        // GLB carriage skips the procedural ghost-trail anim — its own clips drive it.
        if (this.usingGLB) {
            if (this.isFrozen || this.isStunned) {
                this.playGlbAnim(this.glbIdleAnim, true);
            } else if (this.seekTarget) {
                const heroPos = this.seekTarget.getPosition();
                const dx = heroPos.x - this.position.x;
                const dz = heroPos.z - this.position.z;
                const distSq = dx * dx + dz * dz;
                if (distSq <= FastEnemy.GLB_ATTACK_RANGE * FastEnemy.GLB_ATTACK_RANGE) {
                    this.playGlbAnim(this.glbAttackAnim, true);
                } else {
                    this.playGlbAnim(this.glbWalkAnim, true);
                }
            } else {
                this.playGlbAnim(this.glbWalkAnim, true);
            }
            return result;
        }

        // Update spectral floating animation
        if (!this.isFrozen && !this.isStunned && this.currentPathIndex < this.path.length) {
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

    /** Spectral floating pose — advances the fly phase and animates hover,
     *  ghost trail, arms, cloak, and tail wisp. Called by update() while
     *  moving and by tickNetworkProceduralAnim on the guest. */
    protected animateProceduralParts(deltaTime: number): void {
        this.flyTime += deltaTime * 6;

        // Record position history for trail (store last 9 positions in a ring buffer)
        this.trailPositions.unshift({
            x: this.position.x,
            y: this.position.y + 1.3 + Math.sin(this.flyTime * 0.6) * 0.25,
            z: this.position.z
        });
        if (this.trailPositions.length > 9) this.trailPositions.length = 9;

        // Update ghost trail positions (sample every 3 frames back)
        for (let g = 0; g < this.ghostTrails.length; g++) {
            const ghost = this.ghostTrails[g];
            if (isMeshDisposed(ghost)) continue;
            const histIdx = Math.min((g + 1) * 3, this.trailPositions.length - 1);
            if (histIdx < this.trailPositions.length) {
                const hp = this.trailPositions[histIdx];
                ghost.position.set(hp.x, hp.y, hp.z);
                ghost.rotation.y = this.mesh ? this.mesh.rotation.y : 0;
                ghost.scale.copy(this.mesh ? this.mesh.scale : ghost.scale);
            }
        }

        if (this.mesh) {
            // Ethereal floating: slow sinusoidal hover with slight figure-8
            const hoverY = Math.sin(this.flyTime * 0.6) * 0.25;
            this.mesh.position.y = this.position.y + 1.3 + hoverY;

            // Subtle emissive pulse on body (per-instance material — never a
            // shared cached one; assign a fresh Color, don't mutate in place)
            const bodyMat = this.mesh.material as MeshPhongMaterial;
            if (bodyMat) {
                const pulse = 0.5 + 0.3 * Math.sin(this.flyTime * 2.5);
                bodyMat.emissive = PALETTE.ENEMY_FAST_WISP.clone().multiplyScalar(pulse);
            }

            // Gentle body tilt as it sways
            this.mesh.rotation.z = Math.sin(this.flyTime * 0.4) * 0.12;
            this.mesh.rotation.x = Math.sin(this.flyTime * 0.3) * 0.06;
        }

        // Arms: slow eerie reaching motion, slightly out of phase
        if (this.leftWing && this.rightWing) {
            // Arms drift up and down like they're beckoning
            this.leftWing.rotation.z = Math.PI / 6 + Math.sin(this.flyTime * 0.8) * 0.25;
            this.leftWing.rotation.x = Math.sin(this.flyTime * 0.6 + 0.5) * 0.15;
            this.rightWing.rotation.z = -Math.PI / 6 - Math.sin(this.flyTime * 0.8 + Math.PI * 0.3) * 0.25;
            this.rightWing.rotation.x = Math.sin(this.flyTime * 0.6 + 2.0) * 0.15;
        }

        // Head: slow ominous scanning
        if (this.head) {
            this.head.rotation.y = Math.sin(this.flyTime * 0.4) * 0.20;
            this.head.rotation.x = Math.sin(this.flyTime * 0.25) * 0.08;
        }

        // Cloak tails: wave like cloth in wind
        if (this.cloakLeft && this.cloakRight) {
            this.cloakLeft.rotation.x = 0.3 + Math.sin(this.flyTime * 1.2) * 0.20;
            this.cloakLeft.rotation.z = Math.sin(this.flyTime * 0.9) * 0.10;
            this.cloakRight.rotation.x = 0.3 + Math.sin(this.flyTime * 1.2 + Math.PI * 0.5) * 0.20;
            this.cloakRight.rotation.z = Math.sin(this.flyTime * 0.9 + 1.0) * 0.10;
        }

        // Tail wisp: orbit and pulse
        if (this.tailWisp) {
            this.tailWisp.position.x = Math.sin(this.flyTime * 1.5) * 0.10;
            this.tailWisp.position.z = Math.cos(this.flyTime * 1.5) * 0.10 - 0.08;
            this.tailWisp.position.y = -0.65 + Math.sin(this.flyTime * 2.0) * 0.05;
            // Pulsing scale
            const pulse = 0.9 + Math.sin(this.flyTime * 3.0) * 0.3;
            this.tailWisp.scale.set(pulse, pulse, pulse);
        }
    }

    /**
     * Create a death effect
     */
    protected createDeathEffect(): void {
        if (!this.mesh) return;

        // Call the parent method to create the base death effect
        super.createDeathEffect();

        // Play a special sound for fast enemy death
        this.game.getAssetManager().playSound('enemyDeath');
    }

    /** Free the procedural ghost-trail meshes AND their per-instance materials.
     *  Ghosts are NOT parented to this.mesh, so the base mesh dispose never
     *  reaches them; disposeMesh(ghost, { materials: true }) also frees the
     *  uniquely-named 'fastGhostMat' that a bare disposeMesh would otherwise
     *  strand (belt-and-braces: the ghost is also flagged ownedMaterial).
     *  Runs on every disposal path (die/disposeCorpse/dispose — the corpse path
     *  is the ONLY one guest enemies take). Idempotent: the array is emptied.
     *  No-op on the GLB path (ghostTrails is empty there). */
    protected disposeAuxVisuals(): void {
        super.disposeAuxVisuals();
        for (const ghost of this.ghostTrails) {
            if (!isMeshDisposed(ghost)) disposeMesh(ghost, { materials: true });
        }
        this.ghostTrails = [];
    }
}
