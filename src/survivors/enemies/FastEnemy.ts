import { Vector3, MeshBuilder, StandardMaterial, Color3, Mesh, AssetContainer, AnimationGroup, TransformNode, Quaternion } from '@babylonjs/core';
import { Game } from '../../engine/Game';
import { Enemy, HEALTH_COLOR_GREEN, HEALTH_COLOR_YELLOW, HEALTH_COLOR_RED } from './Enemy';
import { createLowPolyMaterial, createEmissiveMaterial, makeFlatShaded } from '../../engine/rendering/LowPolyMaterial';
import { PALETTE } from '../../engine/rendering/StyleConstants';

export class FastEnemy extends Enemy {
    /** Static slot used by EnemyManager.spawnSurvivorsEnemy to stage a preloaded GLB
     *  asset before constructing a FastEnemy. createMesh() consumes + clears it. */
    public static pendingAsset: AssetContainer | null = null;

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
    private glbWalkAnim: AnimationGroup | null = null;
    private glbAttackAnim: AnimationGroup | null = null;
    private glbIdleAnim: AnimationGroup | null = null;
    private glbCurrentAnim: AnimationGroup | null = null;
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

    private createMeshFromGLB(asset: AssetContainer): void {
        this.usingGLB = true;
        this.mesh = new Mesh('fastEnemyGlbRoot', this.scene);
        this.mesh.position.copyFrom(this.position);

        const inst = asset.instantiateModelsToScene(
            name => `fast_${name}`,
            true,
            { doNotInstantiate: true },
        );
        const FAST_SCALE = 1.0;
        for (const root of inst.rootNodes) {
            root.parent = this.mesh;
            if ('scaling' in root && root.scaling) {
                (root as TransformNode).scaling.scaleInPlace(FAST_SCALE);
            }
            // 180° Y flip — same pattern as BasicEnemy GLB. Quaternion-aware.
            const tn = root as TransformNode;
            const flip = Quaternion.RotationYawPitchRoll(Math.PI, 0, 0);
            if (tn.rotationQuaternion) {
                tn.rotationQuaternion = flip.multiply(tn.rotationQuaternion);
            } else if (tn.rotation) {
                tn.rotation.y += Math.PI;
            }
        }

        // Feet-on-ground offset.
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

    private playGlbAnim(slot: AnimationGroup | null, loop: boolean): void {
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
        this.mesh = MeshBuilder.CreateCylinder('fastEnemyBody', {
            height: 1.1,
            diameterTop: 0.50,
            diameterBottom: 0.08,
            tessellation: 5
        }, this.scene);
        makeFlatShaded(this.mesh);

        // Position at starting position, raised for flying
        this.mesh.position = this.position.clone();
        this.mesh.position.y += 1.3;

        const bodyMat = createLowPolyMaterial('fastBodyMat', PALETTE.ENEMY_FAST, this.scene);
        bodyMat.alpha = 0.85; // Slightly translucent for ghostly feel
        this.mesh.material = bodyMat;

        // --- Hood / Head: slightly squashed sphere-like shape ---
        this.head = MeshBuilder.CreatePolyhedron('fastHead', {
            type: 2, // Icosahedron for faceted look
            size: 0.22
        }, this.scene);
        makeFlatShaded(this.head);
        this.head.parent = this.mesh;
        this.head.position = new Vector3(0, 0.55, 0.05);
        this.head.scaling = new Vector3(1.0, 0.85, 1.1); // Slightly flattened, elongated
        this.head.material = createLowPolyMaterial('fastHeadMat', PALETTE.ENEMY_FAST_CLOAK, this.scene);

        // --- Hood cowl: half-cylinder draping behind the head ---
        const cowl = MeshBuilder.CreateCylinder('fastCowl', {
            height: 0.35,
            diameterTop: 0.48,
            diameterBottom: 0.55,
            tessellation: 5
        }, this.scene);
        makeFlatShaded(cowl);
        cowl.parent = this.head;
        cowl.position = new Vector3(0, 0.10, -0.08);
        cowl.material = createLowPolyMaterial('fastCowlMat', PALETTE.ENEMY_FAST_CLOAK, this.scene);

        // --- Left Eye: eerie pale glow ---
        const leftEye = MeshBuilder.CreateBox('fastLeftEye', {
            width: 0.12,
            height: 0.04,
            depth: 0.04
        }, this.scene);
        makeFlatShaded(leftEye);
        leftEye.parent = this.head;
        leftEye.position = new Vector3(-0.10, 0.0, 0.20);
        leftEye.material = createEmissiveMaterial('fastLeftEyeMat', PALETTE.ENEMY_FAST_EYE, 1.2, this.scene);

        // --- Right Eye: eerie pale glow ---
        const rightEye = MeshBuilder.CreateBox('fastRightEye', {
            width: 0.12,
            height: 0.04,
            depth: 0.04
        }, this.scene);
        makeFlatShaded(rightEye);
        rightEye.parent = this.head;
        rightEye.position = new Vector3(0.10, 0.0, 0.20);
        rightEye.material = createEmissiveMaterial('fastRightEyeMat', PALETTE.ENEMY_FAST_EYE, 1.2, this.scene);

        // --- Left Arm: thin bony reaching limb ---
        this.leftWing = MeshBuilder.CreateBox('fastLeftArm', {
            width: 0.55,
            height: 0.06,
            depth: 0.08
        }, this.scene);
        makeFlatShaded(this.leftWing);
        this.leftWing.parent = this.mesh;
        this.leftWing.position = new Vector3(-0.38, 0.25, 0.12);
        this.leftWing.rotation.z = Math.PI / 6;
        this.leftWing.rotation.y = -0.3;
        this.leftWing.material = createLowPolyMaterial('fastLeftArmMat', PALETTE.ENEMY_FAST_CLOAK, this.scene);

        // Left claw: small cone
        const leftClaw = MeshBuilder.CreateCylinder('fastLeftClaw', {
            height: 0.12,
            diameterTop: 0.0,
            diameterBottom: 0.06,
            tessellation: 3
        }, this.scene);
        makeFlatShaded(leftClaw);
        leftClaw.parent = this.leftWing;
        leftClaw.position = new Vector3(-0.28, 0, 0.02);
        leftClaw.rotation.z = Math.PI / 2;
        leftClaw.material = createLowPolyMaterial('fastLeftClawMat', PALETTE.ENEMY_FAST_WISP, this.scene);

        // --- Right Arm: thin bony reaching limb ---
        this.rightWing = MeshBuilder.CreateBox('fastRightArm', {
            width: 0.55,
            height: 0.06,
            depth: 0.08
        }, this.scene);
        makeFlatShaded(this.rightWing);
        this.rightWing.parent = this.mesh;
        this.rightWing.position = new Vector3(0.38, 0.25, 0.12);
        this.rightWing.rotation.z = -Math.PI / 6;
        this.rightWing.rotation.y = 0.3;
        this.rightWing.material = createLowPolyMaterial('fastRightArmMat', PALETTE.ENEMY_FAST_CLOAK, this.scene);

        // Right claw: small cone
        const rightClaw = MeshBuilder.CreateCylinder('fastRightClaw', {
            height: 0.12,
            diameterTop: 0.0,
            diameterBottom: 0.06,
            tessellation: 3
        }, this.scene);
        makeFlatShaded(rightClaw);
        rightClaw.parent = this.rightWing;
        rightClaw.position = new Vector3(0.28, 0, 0.02);
        rightClaw.rotation.z = -Math.PI / 2;
        rightClaw.material = createLowPolyMaterial('fastRightClawMat', PALETTE.ENEMY_FAST_WISP, this.scene);

        // --- Cloak flare left: flat triangle trailing behind ---
        this.cloakLeft = MeshBuilder.CreateCylinder('fastCloakLeft', {
            height: 0.5,
            diameterTop: 0.30,
            diameterBottom: 0.0,
            tessellation: 3
        }, this.scene);
        makeFlatShaded(this.cloakLeft);
        this.cloakLeft.parent = this.mesh;
        this.cloakLeft.position = new Vector3(-0.18, -0.45, -0.15);
        this.cloakLeft.rotation.x = 0.3;
        const cloakMatL = createLowPolyMaterial('fastCloakLeftMat', PALETTE.ENEMY_FAST, this.scene);
        cloakMatL.alpha = 0.7;
        this.cloakLeft.material = cloakMatL;

        // --- Cloak flare right ---
        this.cloakRight = MeshBuilder.CreateCylinder('fastCloakRight', {
            height: 0.5,
            diameterTop: 0.30,
            diameterBottom: 0.0,
            tessellation: 3
        }, this.scene);
        makeFlatShaded(this.cloakRight);
        this.cloakRight.parent = this.mesh;
        this.cloakRight.position = new Vector3(0.18, -0.45, -0.15);
        this.cloakRight.rotation.x = 0.3;
        const cloakMatR = createLowPolyMaterial('fastCloakRightMat', PALETTE.ENEMY_FAST, this.scene);
        cloakMatR.alpha = 0.7;
        this.cloakRight.material = cloakMatR;

        // --- Tail Wisp: glowing small emissive shape trailing below ---
        this.tailWisp = MeshBuilder.CreatePolyhedron('fastTailWisp', {
            type: 1, // Octahedron
            size: 0.08
        }, this.scene);
        makeFlatShaded(this.tailWisp);
        this.tailWisp.parent = this.mesh;
        this.tailWisp.position = new Vector3(0, -0.65, -0.08);
        this.tailWisp.material = createEmissiveMaterial('fastTailWispMat', PALETTE.ENEMY_FAST_WISP, 1.0, this.scene);

        // --- Core glow: small emissive sphere in chest area ---
        const coreGlow = MeshBuilder.CreateSphere('fastCoreGlow', {
            diameter: 0.14,
            segments: 4
        }, this.scene);
        makeFlatShaded(coreGlow);
        coreGlow.parent = this.mesh;
        coreGlow.position = new Vector3(0, 0.20, 0.12);
        coreGlow.material = createEmissiveMaterial('fastCoreGlowMat', PALETTE.ENEMY_FAST_EYE, 1.5, this.scene);

        // --- Motion trail: 1 ghost clone of the body trailing behind the wraith ---
        // Reduced from 3 → 1 to cut FastEnemy mesh count and draw calls.
        this.ghostTrails = [];
        {
            const ghost = MeshBuilder.CreateCylinder('fastGhost0', {
                height: 1.1,
                diameterTop: 0.50,
                diameterBottom: 0.08,
                tessellation: 5
            }, this.scene);
            makeFlatShaded(ghost);
            ghost.position = this.position.clone();
            ghost.position.y += 1.3;
            const ghostMat = new StandardMaterial('fastGhostMat', this.scene);
            ghostMat.diffuseColor = PALETTE.ENEMY_FAST;
            ghostMat.emissiveColor = PALETTE.ENEMY_FAST_WISP.scale(0.5);
            ghostMat.specularColor = Color3.Black();
            ghostMat.alpha = 0.22;
            ghost.material = ghostMat;
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

        // Outline
        this.healthBarOutlineMesh = MeshBuilder.CreateBox('healthBarOutline', {
            width: 0.88,
            height: 0.14,
            depth: 0.04
        }, this.scene);
        this.healthBarOutlineMesh.position = new Vector3(this.position.x, this.position.y + 2.3, this.position.z);
        const outlineMat = new StandardMaterial('healthBarOutlineMat', this.scene);
        outlineMat.diffuseColor = new Color3(0, 0, 0);
        outlineMat.specularColor = Color3.Black();
        this.healthBarOutlineMesh.material = outlineMat;

        // Background bar
        this.healthBarBackgroundMesh = MeshBuilder.CreateBox('healthBarBg', {
            width: 0.8,
            height: 0.08,
            depth: 0.05
        }, this.scene);
        this.healthBarBackgroundMesh.position = new Vector3(this.position.x, this.position.y + 2.3, this.position.z);
        const bgMat = new StandardMaterial('healthBarBgMat', this.scene);
        bgMat.diffuseColor = new Color3(0.3, 0.3, 0.3);
        bgMat.specularColor = Color3.Black();
        this.healthBarBackgroundMesh.material = bgMat;

        // Health bar
        this.healthBarMesh = MeshBuilder.CreateBox('healthBar', {
            width: 0.8,
            height: 0.08,
            depth: 0.06
        }, this.scene);
        this.healthBarMesh.position = new Vector3(this.position.x, this.position.y + 2.3, this.position.z);
        const healthMat = new StandardMaterial('healthBarMat', this.scene);
        healthMat.diffuseColor = new Color3(0.2, 0.8, 0.2);
        healthMat.specularColor = Color3.Black();
        this.healthBarMesh.material = healthMat;

        // Billboard mode
        this.healthBarOutlineMesh.billboardMode = Mesh.BILLBOARDMODE_ALL;
        this.healthBarBackgroundMesh.billboardMode = Mesh.BILLBOARDMODE_ALL;
        this.healthBarMesh.billboardMode = Mesh.BILLBOARDMODE_ALL;

        this.updateHealthBar();
    }

    /**
     * Override the updateHealthBar method for fast enemies
     */
    protected updateHealthBar(): void {
        if (!this.mesh || !this.healthBarMesh || !this.healthBarBackgroundMesh) return;

        const healthPercent = Math.max(0, this.health / this.maxHealth);

        this.healthBarMesh.scaling.x = healthPercent;

        const offset = (1 - healthPercent) * 0.4; // Adjusted for narrower bar (0.8 width)
        this.healthBarMesh.position.x = this.position.x - offset;

        const material = this.healthBarMesh.material as StandardMaterial;
        if (healthPercent > 0.6) {
            material.diffuseColor = HEALTH_COLOR_GREEN;
        } else if (healthPercent > 0.3) {
            material.diffuseColor = HEALTH_COLOR_YELLOW;
        } else {
            material.diffuseColor = HEALTH_COLOR_RED;
        }

        if (this.healthBarOutlineMesh && !this.healthBarOutlineMesh.isDisposed()) {
            this.healthBarOutlineMesh.position.x = this.position.x;
            this.healthBarOutlineMesh.position.y = this.position.y + 2.3;
            this.healthBarOutlineMesh.position.z = this.position.z;
        }

        this.healthBarBackgroundMesh.position.x = this.position.x;
        this.healthBarBackgroundMesh.position.y = this.position.y + 2.3;
        this.healthBarBackgroundMesh.position.z = this.position.z;

        this.healthBarMesh.position.y = this.position.y + 2.3;
        this.healthBarMesh.position.z = this.position.z;
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
                if (ghost.isDisposed()) continue;
                const histIdx = Math.min((g + 1) * 3, this.trailPositions.length - 1);
                if (histIdx < this.trailPositions.length) {
                    const hp = this.trailPositions[histIdx];
                    ghost.position.set(hp.x, hp.y, hp.z);
                    ghost.rotation.y = this.mesh ? this.mesh.rotation.y : 0;
                    ghost.scaling.copyFrom(this.mesh ? this.mesh.scaling : ghost.scaling);
                }
            }

            if (this.mesh) {
                // Ethereal floating: slow sinusoidal hover with slight figure-8
                const hoverY = Math.sin(this.flyTime * 0.6) * 0.25;
                this.mesh.position.y = this.position.y + 1.3 + hoverY;

                // Subtle emissive pulse on body
                const bodyMat = this.mesh.material as StandardMaterial;
                if (bodyMat) {
                    const pulse = 0.5 + 0.3 * Math.sin(this.flyTime * 2.5);
                    bodyMat.emissiveColor = PALETTE.ENEMY_FAST_WISP.scale(pulse);
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
                this.tailWisp.scaling = new Vector3(pulse, pulse, pulse);
            }

            // Face direction of movement
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

    /**
     * Clean up ghost trail meshes in addition to base cleanup
     */
    public dispose(): void {
        for (const ghost of this.ghostTrails) {
            if (!ghost.isDisposed()) ghost.dispose();
        }
        this.ghostTrails = [];
        super.dispose();
    }
}
