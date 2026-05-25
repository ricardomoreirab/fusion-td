import { Vector3, MeshBuilder, StandardMaterial, Color3, Color4, ParticleSystem, Mesh, AssetContainer, AnimationGroup, TransformNode, Quaternion } from '@babylonjs/core';
import { Game } from '../../Game';
import { Enemy, getStatusEffectTexture } from './Enemy';
import { createLowPolyMaterial, createEmissiveMaterial, makeFlatShaded } from '../../rendering/LowPolyMaterial';
import { PALETTE } from '../../rendering/StyleConstants';

export class HealerEnemy extends Enemy {
    /** Static slot used by EnemyManager.spawnSurvivorsEnemy to stage a preloaded GLB
     *  asset before constructing a HealerEnemy. createMesh() consumes + clears it. */
    public static pendingAsset: AssetContainer | null = null;

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
    private glbWalkAnim: AnimationGroup | null = null;
    private glbAttackAnim: AnimationGroup | null = null;
    private glbIdleAnim: AnimationGroup | null = null;
    private glbCurrentAnim: AnimationGroup | null = null;
    private glbAttackHoldTimer: number = 0;
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

    private createMeshFromGLB(asset: AssetContainer): void {
        this.usingGLB = true;
        this.mesh = new Mesh('healerEnemyGlbRoot', this.scene);
        this.mesh.position.copyFrom(this.position);

        const inst = asset.instantiateModelsToScene(
            name => `healer_${name}`,
            true,
            { doNotInstantiate: true },
        );
        for (const root of inst.rootNodes) {
            root.parent = this.mesh;
            if ('scaling' in root && root.scaling) {
                (root as TransformNode).scaling.scaleInPlace(HealerEnemy.GLB_SCALE);
            }
            // 180° Y flip — same pattern as BasicEnemy GLB.
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

    private playGlbAnim(slot: AnimationGroup | null, loop: boolean): void {
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
        this.mesh = MeshBuilder.CreateCylinder('healerEnemyBody', {
            height: 1.0,
            diameterTop: 0.45,
            diameterBottom: 0.65,
            tessellation: 6
        }, this.scene);
        makeFlatShaded(this.mesh);
        this.mesh.position = this.position.clone();
        this.mesh.position.y += 0.7;
        this.mesh.material = createLowPolyMaterial('healerBodyMat', PALETTE.ENEMY_HEALER, this.scene);

        // --- Robe trim: thin ring at bottom of robe ---
        const robeTrim = MeshBuilder.CreateTorus('healerRobeTrim', {
            diameter: 0.65,
            thickness: 0.06,
            tessellation: 8
        }, this.scene);
        makeFlatShaded(robeTrim);
        robeTrim.parent = this.mesh;
        robeTrim.position = new Vector3(0, -0.48, 0);
        robeTrim.material = createEmissiveMaterial('healerRobeTrimMat', PALETTE.ENEMY_HEALER_GLOW, 0.4, this.scene);

        // --- Hood / Head: sphere-like polyhedron with hood drape ---
        this.head = MeshBuilder.CreateBox('healerHead', {
            width: 0.40,
            height: 0.38,
            depth: 0.40
        }, this.scene);
        makeFlatShaded(this.head);
        this.head.parent = this.mesh;
        this.head.position = new Vector3(0, 0.65, 0.02);
        this.head.material = createLowPolyMaterial('healerHeadMat', PALETTE.ENEMY_HEALER, this.scene);

        // --- Hood cowl: slightly larger cylinder behind head ---
        const cowl = MeshBuilder.CreateCylinder('healerCowl', {
            height: 0.35,
            diameterTop: 0.42,
            diameterBottom: 0.50,
            tessellation: 5
        }, this.scene);
        makeFlatShaded(cowl);
        cowl.parent = this.head;
        cowl.position = new Vector3(0, 0.05, -0.08);
        cowl.material = createLowPolyMaterial('healerCowlMat', PALETTE.ENEMY_HEALER, this.scene);

        // --- Left Eye: emissive cyan-green ---
        const leftEye = MeshBuilder.CreateBox('healerLeftEye', {
            width: 0.10,
            height: 0.06,
            depth: 0.05
        }, this.scene);
        makeFlatShaded(leftEye);
        leftEye.parent = this.head;
        leftEye.position = new Vector3(-0.10, 0.02, 0.20);
        leftEye.material = createEmissiveMaterial('healerLeftEyeMat', PALETTE.ENEMY_HEALER_EYE, 1.0, this.scene);

        // --- Right Eye: emissive cyan-green ---
        const rightEye = MeshBuilder.CreateBox('healerRightEye', {
            width: 0.10,
            height: 0.06,
            depth: 0.05
        }, this.scene);
        makeFlatShaded(rightEye);
        rightEye.parent = this.head;
        rightEye.position = new Vector3(0.10, 0.02, 0.20);
        rightEye.material = createEmissiveMaterial('healerRightEyeMat', PALETTE.ENEMY_HEALER_EYE, 1.0, this.scene);

        // --- Left Arm: short robed arm ---
        this.leftArm = MeshBuilder.CreateBox('healerLeftArm', {
            width: 0.14,
            height: 0.45,
            depth: 0.14
        }, this.scene);
        makeFlatShaded(this.leftArm);
        this.leftArm.parent = this.mesh;
        this.leftArm.position = new Vector3(-0.32, 0.15, 0);
        this.leftArm.material = createLowPolyMaterial('healerLeftArmMat', PALETTE.ENEMY_HEALER, this.scene);

        // --- Right Arm: short robed arm (holds staff) ---
        this.rightArm = MeshBuilder.CreateBox('healerRightArm', {
            width: 0.14,
            height: 0.45,
            depth: 0.14
        }, this.scene);
        makeFlatShaded(this.rightArm);
        this.rightArm.parent = this.mesh;
        this.rightArm.position = new Vector3(0.32, 0.15, 0);
        this.rightArm.material = createLowPolyMaterial('healerRightArmMat', PALETTE.ENEMY_HEALER, this.scene);

        // --- Staff: tall thin cylinder held by right arm ---
        this.staff = MeshBuilder.CreateCylinder('healerStaff', {
            height: 1.6,
            diameterTop: 0.05,
            diameterBottom: 0.07,
            tessellation: 5
        }, this.scene);
        makeFlatShaded(this.staff);
        this.staff.parent = this.rightArm;
        this.staff.position = new Vector3(0.10, 0.35, 0.05);
        this.staff.material = createLowPolyMaterial('healerStaffMat', PALETTE.ENEMY_HEALER_STAFF, this.scene);

        // --- Staff Orb: glowing emissive sphere on top of staff ---
        this.staffOrb = MeshBuilder.CreateSphere('healerStaffOrb', {
            diameter: 0.22,
            segments: 4
        }, this.scene);
        makeFlatShaded(this.staffOrb);
        this.staffOrb.parent = this.staff;
        this.staffOrb.position = new Vector3(0, 0.85, 0);
        this.staffOrb.material = createEmissiveMaterial('healerStaffOrbMat', PALETTE.ENEMY_HEALER_GLOW, 1.5, this.scene);

        // --- Staff Orb ring: small torus around the orb ---
        const orbRing = MeshBuilder.CreateTorus('healerOrbRing', {
            diameter: 0.28,
            thickness: 0.03,
            tessellation: 8
        }, this.scene);
        makeFlatShaded(orbRing);
        orbRing.parent = this.staffOrb;
        orbRing.position = new Vector3(0, 0, 0);
        orbRing.material = createEmissiveMaterial('healerOrbRingMat', PALETTE.ENEMY_HEALER_GLOW, 0.8, this.scene);

        // --- Aura Ring at feet: thin emissive torus on the ground ---
        this.auraRing = MeshBuilder.CreateTorus('healerAuraRing', {
            diameter: 1.2,
            thickness: 0.06,
            tessellation: 16
        }, this.scene);
        makeFlatShaded(this.auraRing);
        this.auraRing.parent = this.mesh;
        this.auraRing.position = new Vector3(0, -0.50, 0);
        this.auraRing.material = createEmissiveMaterial('healerAuraRingMat', PALETTE.ENEMY_HEALER_GLOW, 1.2, this.scene);

        // --- Ground glow: soft constant disc at feet so players spot healers at a glance ---
        this.groundGlow = MeshBuilder.CreateDisc('healerGroundGlow', { radius: 0.70, tessellation: 16 }, this.scene);
        this.groundGlow.parent = this.mesh;
        this.groundGlow.rotation.x = Math.PI / 2;
        this.groundGlow.position = new Vector3(0, -0.52, 0);
        const groundGlowMat = new StandardMaterial('healerGroundGlowMat', this.scene);
        groundGlowMat.emissiveColor = PALETTE.ENEMY_HEALER_GLOW;
        groundGlowMat.alpha = 0.35;
        groundGlowMat.disableLighting = true;
        this.groundGlow.material = groundGlowMat;

        // Store original scale
        this.originalScale = 1.0;
    }

    /**
     * Override the health bar creation for healer enemies (positioned higher)
     */
    protected createHealthBar(): void {
        if (!this.mesh) return;

        // Outline
        this.healthBarOutlineMesh = MeshBuilder.CreateBox('healthBarOutline', {
            width: 1.08,
            height: 0.14,
            depth: 0.04
        }, this.scene);
        this.healthBarOutlineMesh.position = new Vector3(this.position.x, this.position.y + 1.9, this.position.z);
        const outlineMat = new StandardMaterial('healthBarOutlineMat', this.scene);
        outlineMat.diffuseColor = new Color3(0, 0, 0);
        outlineMat.specularColor = Color3.Black();
        this.healthBarOutlineMesh.material = outlineMat;

        // Background bar
        this.healthBarBackgroundMesh = MeshBuilder.CreateBox('healthBarBg', {
            width: 1.0,
            height: 0.08,
            depth: 0.05
        }, this.scene);
        this.healthBarBackgroundMesh.position = new Vector3(this.position.x, this.position.y + 1.9, this.position.z);
        const bgMat = new StandardMaterial('healthBarBgMat', this.scene);
        bgMat.diffuseColor = new Color3(0.3, 0.3, 0.3);
        bgMat.specularColor = Color3.Black();
        this.healthBarBackgroundMesh.material = bgMat;

        // Health bar
        this.healthBarMesh = MeshBuilder.CreateBox('healthBar', {
            width: 1.0,
            height: 0.08,
            depth: 0.06
        }, this.scene);
        this.healthBarMesh.position = new Vector3(this.position.x, this.position.y + 1.9, this.position.z);
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
     * Override the updateHealthBar method for healer enemies
     */
    protected updateHealthBar(): void {
        if (!this.mesh || !this.healthBarMesh || !this.healthBarBackgroundMesh) return;

        const healthPercent = Math.max(0, this.health / this.maxHealth);

        this.healthBarMesh.scaling.x = healthPercent;

        const offset = (1 - healthPercent) * 0.5;
        this.healthBarMesh.position.x = this.position.x - offset;

        const material = this.healthBarMesh.material as StandardMaterial;
        if (healthPercent > 0.6) {
            material.diffuseColor = new Color3(0.2, 0.8, 0.2);
        } else if (healthPercent > 0.3) {
            material.diffuseColor = new Color3(0.8, 0.8, 0.2);
        } else {
            material.diffuseColor = new Color3(0.8, 0.2, 0.2);
        }

        if (this.healthBarOutlineMesh && !this.healthBarOutlineMesh.isDisposed()) {
            this.healthBarOutlineMesh.position.x = this.position.x;
            this.healthBarOutlineMesh.position.y = this.position.y + 1.9;
            this.healthBarOutlineMesh.position.z = this.position.z;
        }

        this.healthBarBackgroundMesh.position.x = this.position.x;
        this.healthBarBackgroundMesh.position.y = this.position.y + 1.9;
        this.healthBarBackgroundMesh.position.z = this.position.z;

        this.healthBarMesh.position.y = this.position.y + 1.9;
        this.healthBarMesh.position.z = this.position.z;
    }

    /**
     * Update the enemy with shaman floating/bobbing animation and healing aura
     * @param deltaTime Time elapsed since last update in seconds
     * @returns True if the enemy reached the end of the path
     */
    public update(deltaTime: number): boolean {
        if (!this.alive || !this.mesh) return false;

        // Get the result from the parent update method
        const result = super.update(deltaTime);

        // Update heal timer and dispatch heal event
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

        // GLB wizard skips the procedural staff/orb anim — the asset's clips drive it.
        // Facing is handled by Enemy.update's seek-rotation; the GLB roots are pre-rotated
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
                this.staffOrb.scaling = new Vector3(orbPulse, orbPulse, orbPulse);
            }

            // Aura ring: pulsing scale and gentle rotation
            if (this.auraRing) {
                const auraPulse = 0.85 + Math.sin(this.walkTime * 1.5) * 0.2;
                this.auraRing.scaling = new Vector3(auraPulse, 1.0, auraPulse);
                this.auraRing.rotation.y += deltaTime * 1.2;
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
     * Create a death effect
     */
    protected createDeathEffect(): void {
        if (!this.mesh) return;

        // Create a healing-themed explosion effect
        const particleSystem = new ParticleSystem('deathParticles', 50, this.scene);

        // Set particle texture
        particleSystem.particleTexture = getStatusEffectTexture(this.scene);

        // Set emission properties
        particleSystem.emitter = this.position.clone();
        (particleSystem.emitter as Vector3).y += 0.7;
        particleSystem.minEmitBox = new Vector3(-0.2, 0, -0.2);
        particleSystem.maxEmitBox = new Vector3(0.2, 0, 0.2);

        // Set particle properties - green/purple mystic poof
        particleSystem.color1 = new Color4(0.30, 0.95, 0.50, 1.0);
        particleSystem.color2 = new Color4(0.40, 0.25, 0.65, 1.0);
        particleSystem.colorDead = new Color4(0.15, 0.30, 0.20, 0.0);

        particleSystem.minSize = 0.1;
        particleSystem.maxSize = 0.5;

        particleSystem.minLifeTime = 0.3;
        particleSystem.maxLifeTime = 1.0;

        particleSystem.emitRate = 100;

        particleSystem.blendMode = ParticleSystem.BLENDMODE_ONEONE;

        particleSystem.gravity = new Vector3(0, 8, 0);

        particleSystem.direction1 = new Vector3(-1, 8, -1);
        particleSystem.direction2 = new Vector3(1, 8, 1);

        particleSystem.minAngularSpeed = 0;
        particleSystem.maxAngularSpeed = Math.PI;

        particleSystem.minEmitPower = 1;
        particleSystem.maxEmitPower = 3;
        particleSystem.updateSpeed = 0.01;

        // Start the particle system
        particleSystem.start();

        // Play sound effect
        this.game.getAssetManager().playSound('enemyDeath');

        // Stop and dispose after 1 second
        setTimeout(() => {
            particleSystem.stop();
            setTimeout(() => {
                particleSystem.dispose();
            }, 1000);
        }, 1000);
    }

    /**
     * Spawn an expanding green ring at the healer's feet to telegraph a heal pulse.
     * Ring animates from radius 0.5 → 3.0 over 0.5 s then disposes.
     */
    private spawnHealPulseRing(): void {
        const ring = MeshBuilder.CreateDisc('healPulseRing', { radius: 0.5, tessellation: 24 }, this.scene);
        ring.rotation.x = Math.PI / 2;
        ring.position = this.position.clone();
        ring.position.y += 0.05;

        const ringMat = new StandardMaterial('healPulseRingMat_' + Math.random(), this.scene);
        ringMat.emissiveColor = PALETTE.ENEMY_HEALER_GLOW;
        ringMat.alpha = 0.60;
        ringMat.disableLighting = true;
        ring.material = ringMat;

        const startTime = performance.now();
        const duration = 500; // ms
        const startRadius = 0.5;
        const endRadius = 3.0;

        const observer = this.scene.onBeforeRenderObservable.add(() => {
            if (ring.isDisposed()) {
                this.scene.onBeforeRenderObservable.remove(observer);
                return;
            }
            const elapsed = performance.now() - startTime;
            const t = Math.min(elapsed / duration, 1.0);
            const radius = startRadius + (endRadius - startRadius) * t;
            const scale = radius / startRadius;
            ring.scaling.set(scale, scale, scale);
            ringMat.alpha = 0.60 * (1 - t);

            if (t >= 1.0) {
                this.scene.onBeforeRenderObservable.remove(observer);
                ring.dispose();
            }
        });
    }
}
