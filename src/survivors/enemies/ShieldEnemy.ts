import { Box3, Color, Mesh, MeshPhongMaterial, Vector3 } from 'three';
import { Game } from '../../engine/Game';
import { Enemy, getStatusEffectTexture, tryAcquireDeathBurst, scheduleDeathBurstTeardown } from './Enemy';
import { createLowPolyMaterial, createEmissiveMaterial, makeFlatShaded } from '../../engine/rendering/LowPolyMaterial';
import { PALETTE } from '../../engine/rendering/StyleConstants';
import { AnimGroup } from '../../engine/three/AnimGroup';
import type { GlbContainer } from '../../engine/three/assets';
import { headingToYaw } from '../../engine/three/math';
import { fxRenderer, fxSize, ParticleEffect } from '../../engine/three/particles/ParticleEffect';
import { LifeTimeCurve, Shape } from '@newkrok/three-particles';
import { createBox, createCylinder, createSphere, disposeMesh } from '../../engine/three/primitives';

export class ShieldEnemy extends Enemy {
    /** Static slot used by EnemyManager.spawnSurvivorsEnemy to stage a preloaded GLB
     *  asset before constructing a ShieldEnemy. createMesh() consumes + clears it. */
    public static pendingAsset: GlbContainer | null = null;

    private walkTime: number = 0;
    private head: Mesh | null = null;
    private leftLeg: Mesh | null = null;
    private rightLeg: Mesh | null = null;
    private leftArm: Mesh | null = null;
    private rightArm: Mesh | null = null;

    /** True when this instance renders via the red-super-melee-minion GLB. */
    private usingGLB: boolean = false;
    private glbWalkAnim: AnimGroup | null = null;
    private glbAttackAnim: AnimGroup | null = null;
    private glbIdleAnim: AnimGroup | null = null;
    private glbCurrentAnim: AnimGroup | null = null;
    private glbAttackHoldTimer: number = 0;
    private static readonly GLB_ATTACK_RANGE = 3.5;
    private static readonly GLB_ATTACK_HOLD  = 0.6;
    private static readonly GLB_SCALE        = 1.25;

    // Shield mechanic
    private shield: number = 30;
    private maxShield: number = 30;
    private shieldRegenTimer: number = 0;
    private lastHitTime: number = 0;
    private shieldMesh: Mesh | null = null;

    // Shield dome — translucent sphere around the enemy, visible when shield > 0
    private shieldDome: Mesh | null = null;

    constructor(game: Game, position: Vector3, path: Vector3[]) {
        // Shield enemy: HP 50, Speed 2.0, Damage 15, Reward $35
        super(game, position, path, 2.0, 50, 15, 35);

        // Set as a heavy enemy type (armored paladin)
        this.isHeavy = true;
        this.contactDamagePerSecond = 12;

        // Paladin shield-bash — moderate reach, solid damage, telegraphed.
        this.meleeRange            = 1.6;
        this.meleeHitRange         = 1.9;
        this.meleeHitDamage        = 14;
        this.meleeWindupDuration   = 0.4;
        this.meleeStrikeDuration   = 0.12;
        this.meleeCooldownDuration = 0.7;

        // Anchor HP bar above the helmet (taller than base enemy).
        this.applyHealthBarTier('normal', { heightOffset: 1.9 });

        // Build mesh + health bar AFTER field initializers have run (see Enemy
        // constructor note). new.target guard → fires only for the concrete leaf.
        if (new.target === ShieldEnemy) this._initEnemyVisuals();

        // Attach the shield dome AFTER the body mesh exists (either GLB or
        // procedural — _buildShieldDome parents the dome to this.mesh).
        this._buildShieldDome();
    }

    /**
     * Create the enemy mesh. If a GLB asset was staged via ShieldEnemy.pendingAsset
     * (set by EnemyManager just before construction), instantiate it. Otherwise fall
     * back to the procedural armored-paladin build below.
     */
    protected createMesh(): void {
        const asset = ShieldEnemy.pendingAsset;
        ShieldEnemy.pendingAsset = null;
        if (asset) {
            this.createMeshFromGLB(asset);
            return;
        }
        this.createMeshProcedural();
    }

    private createMeshFromGLB(asset: GlbContainer): void {
        this.usingGLB = true;
        this.mesh = new Mesh(); // empty transform host (renders nothing)
        this.mesh.name = 'shieldEnemyGlbRoot';
        this.scene.scene.add(this.mesh);
        this.mesh.position.copy(this.position);

        const inst = asset.instantiate(this.scene, 'shield_');
        // Base Enemy field; its dispose() frees cloned materials + skeletons + mixer hook.
        this.glbInstance = inst;
        const root = inst.root;
        this.mesh.add(root);
        root.scale.multiplyScalar(ShieldEnemy.GLB_SCALE);
        // Keep the Babylon-era 180-degree Y pre-rotation so facing math stays
        // aligned (Phase D handedness audit may remove it) — same pattern as
        // BasicEnemy GLB so the model faces the hero.
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
            if (!this.glbWalkAnim && (n.includes('walk') || n.includes('run'))) {
                this.glbWalkAnim = ag;
            } else if (!this.glbAttackAnim && (n.includes('attack') || n.includes('hit') || n.includes('punch') || n.includes('strike') || n.includes('swing'))) {
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
     * Create the enemy mesh - low-poly Armored Paladin (procedural fallback)
     * Bulky armored body, helmet with gold visor, tower shield on left arm,
     * short sword on right, armored legs with boots
     */
    private createMeshProcedural(): void {
        // --- Torso: wide bulky box (heavy armor) ---
        this.mesh = createBox('shieldEnemyBody', {
            width: 0.85,
            height: 0.70,
            depth: 0.55
        }, this.scene);
        makeFlatShaded(this.mesh);
        this.mesh.position.copy(this.position);
        this.mesh.position.y += 0.70;
        this.mesh.material = createLowPolyMaterial('shieldBodyMat', PALETTE.ENEMY_SHIELD);

        // --- Chest plate: front armor plate ---
        const chestPlate = createBox('shieldChestPlate', {
            width: 0.72,
            height: 0.55,
            depth: 0.08
        }, this.scene);
        makeFlatShaded(chestPlate);
        this.mesh.add(chestPlate);
        chestPlate.position.set(0, 0.0, 0.30);
        chestPlate.material = createLowPolyMaterial('shieldChestPlateMat', PALETTE.ENEMY_SHIELD_PLATE);

        // --- Gold chest emblem: small box on chest plate ---
        const emblem = createBox('shieldEmblem', {
            width: 0.15,
            height: 0.15,
            depth: 0.04
        }, this.scene);
        makeFlatShaded(emblem);
        chestPlate.add(emblem);
        emblem.position.set(0, 0.10, 0.05);
        emblem.rotation.z = Math.PI / 4; // Diamond shape
        emblem.material = createLowPolyMaterial('shieldEmblemMat', PALETTE.ENEMY_SHIELD_GOLD);

        // --- Back plate: rear armor ---
        const backPlate = createBox('shieldBackPlate', {
            width: 0.68,
            height: 0.50,
            depth: 0.06
        }, this.scene);
        makeFlatShaded(backPlate);
        this.mesh.add(backPlate);
        backPlate.position.set(0, 0.0, -0.30);
        backPlate.material = createLowPolyMaterial('shieldBackPlateMat', PALETTE.ENEMY_SHIELD_PLATE);

        // --- Pauldrons (shoulder guards): two boxes ---
        const leftPauldron = createBox('shieldLeftPauldron', {
            width: 0.28,
            height: 0.15,
            depth: 0.30
        }, this.scene);
        makeFlatShaded(leftPauldron);
        this.mesh.add(leftPauldron);
        leftPauldron.position.set(-0.48, 0.30, 0);
        leftPauldron.rotation.z = -0.2;
        leftPauldron.material = createLowPolyMaterial('shieldLeftPauldronMat', PALETTE.ENEMY_SHIELD_PLATE);

        const rightPauldron = createBox('shieldRightPauldron', {
            width: 0.28,
            height: 0.15,
            depth: 0.30
        }, this.scene);
        makeFlatShaded(rightPauldron);
        this.mesh.add(rightPauldron);
        rightPauldron.position.set(0.48, 0.30, 0);
        rightPauldron.rotation.z = 0.2;
        rightPauldron.material = createLowPolyMaterial('shieldRightPauldronMat', PALETTE.ENEMY_SHIELD_PLATE);

        // --- Belt: horizontal armored strip ---
        const belt = createBox('shieldBelt', {
            width: 0.88,
            height: 0.10,
            depth: 0.58
        }, this.scene);
        makeFlatShaded(belt);
        this.mesh.add(belt);
        belt.position.set(0, -0.32, 0);
        belt.material = createLowPolyMaterial('shieldBeltMat', PALETTE.ENEMY_SHIELD_GOLD);

        // --- Head / Helmet: box-shaped great helm ---
        this.head = createBox('shieldHead', {
            width: 0.50,
            height: 0.52,
            depth: 0.48
        }, this.scene);
        makeFlatShaded(this.head);
        this.mesh.add(this.head);
        this.head.position.set(0, 0.60, 0.02);
        this.head.material = createLowPolyMaterial('shieldHeadMat', PALETTE.ENEMY_SHIELD);

        // --- Helmet crest: small ridge on top ---
        const crest = createBox('shieldCrest', {
            width: 0.08,
            height: 0.12,
            depth: 0.38
        }, this.scene);
        makeFlatShaded(crest);
        this.head.add(crest);
        crest.position.set(0, 0.30, -0.02);
        crest.material = createLowPolyMaterial('shieldCrestMat', PALETTE.ENEMY_SHIELD_GOLD);

        // --- Visor slit: emissive golden eyes ---
        const visor = createBox('shieldVisor', {
            width: 0.36,
            height: 0.06,
            depth: 0.06
        }, this.scene);
        makeFlatShaded(visor);
        this.head.add(visor);
        visor.position.set(0, 0.04, 0.24);
        visor.material = createEmissiveMaterial('shieldVisorMat', PALETTE.ENEMY_SHIELD_EYE, 0.9);

        // --- Left Arm (shield arm): armored box arm ---
        this.leftArm = createBox('shieldLeftArm', {
            width: 0.20,
            height: 0.58,
            depth: 0.20
        }, this.scene);
        makeFlatShaded(this.leftArm);
        this.mesh.add(this.leftArm);
        this.leftArm.position.set(-0.55, -0.02, 0);
        this.leftArm.material = createLowPolyMaterial('shieldLeftArmMat', PALETTE.ENEMY_SHIELD);

        // --- Tower Shield on left arm: large flat box ---
        this.shieldMesh = createBox('shieldTowerShield', {
            width: 0.08,
            height: 0.70,
            depth: 0.45
        }, this.scene);
        makeFlatShaded(this.shieldMesh);
        this.leftArm.add(this.shieldMesh);
        this.shieldMesh.position.set(-0.14, -0.05, 0.10);
        this.shieldMesh.material = this.createShieldMaterial();
        // Uniquely-owned animated material — disposeMesh frees it with the mesh.
        this.shieldMesh.userData.ownedMaterial = true;

        // --- Shield boss (center knob): small box ---
        const shieldBoss = createBox('shieldBoss', {
            width: 0.06,
            height: 0.14,
            depth: 0.14
        }, this.scene);
        makeFlatShaded(shieldBoss);
        this.shieldMesh.add(shieldBoss);
        shieldBoss.position.set(-0.05, 0, 0);
        shieldBoss.material = createLowPolyMaterial('shieldBossMat', PALETTE.ENEMY_SHIELD_GOLD);

        // --- Shield gold trim: top and bottom strips ---
        const shieldTrimTop = createBox('shieldTrimTop', {
            width: 0.09,
            height: 0.05,
            depth: 0.42
        }, this.scene);
        makeFlatShaded(shieldTrimTop);
        this.shieldMesh.add(shieldTrimTop);
        shieldTrimTop.position.set(-0.01, 0.32, 0);
        shieldTrimTop.material = createLowPolyMaterial('shieldTrimTopMat', PALETTE.ENEMY_SHIELD_GOLD);

        const shieldTrimBottom = createBox('shieldTrimBottom', {
            width: 0.09,
            height: 0.05,
            depth: 0.42
        }, this.scene);
        makeFlatShaded(shieldTrimBottom);
        this.shieldMesh.add(shieldTrimBottom);
        shieldTrimBottom.position.set(-0.01, -0.32, 0);
        shieldTrimBottom.material = createLowPolyMaterial('shieldTrimBottomMat', PALETTE.ENEMY_SHIELD_GOLD);

        // --- Right Arm (sword arm): armored box arm ---
        this.rightArm = createBox('shieldRightArm', {
            width: 0.20,
            height: 0.58,
            depth: 0.20
        }, this.scene);
        makeFlatShaded(this.rightArm);
        this.mesh.add(this.rightArm);
        this.rightArm.position.set(0.55, -0.02, 0);
        this.rightArm.material = createLowPolyMaterial('shieldRightArmMat', PALETTE.ENEMY_SHIELD);

        // --- Gauntlet on right arm: slightly wider box at hand ---
        const gauntlet = createBox('shieldGauntlet', {
            width: 0.22,
            height: 0.14,
            depth: 0.22
        }, this.scene);
        makeFlatShaded(gauntlet);
        this.rightArm.add(gauntlet);
        gauntlet.position.set(0, -0.28, 0);
        gauntlet.material = createLowPolyMaterial('shieldGauntletMat', PALETTE.ENEMY_SHIELD_PLATE);

        // --- Short Sword: blade + handle ---
        const swordBlade = createBox('shieldSwordBlade', {
            width: 0.06,
            height: 0.45,
            depth: 0.10
        }, this.scene);
        makeFlatShaded(swordBlade);
        this.rightArm.add(swordBlade);
        swordBlade.position.set(0.08, -0.45, 0);
        swordBlade.material = createLowPolyMaterial('shieldSwordBladeMat', PALETTE.ENEMY_SHIELD);

        // --- Sword crossguard: small horizontal box ---
        const crossguard = createBox('shieldCrossguard', {
            width: 0.04,
            height: 0.04,
            depth: 0.18
        }, this.scene);
        makeFlatShaded(crossguard);
        swordBlade.add(crossguard);
        crossguard.position.set(0, 0.22, 0);
        crossguard.material = createLowPolyMaterial('shieldCrossguardMat', PALETTE.ENEMY_SHIELD_GOLD);

        // --- Sword tip: small cone ---
        const swordTip = createCylinder('shieldSwordTip', {
            height: 0.12,
            diameterTop: 0.0,
            diameterBottom: 0.10,
            tessellation: 3
        }, this.scene);
        makeFlatShaded(swordTip);
        swordBlade.add(swordTip);
        swordTip.position.set(0, -0.28, 0);
        swordTip.material = createLowPolyMaterial('shieldSwordTipMat', PALETTE.ENEMY_SHIELD);

        // --- Left Leg: armored ---
        this.leftLeg = createBox('shieldLeftLeg', {
            width: 0.22,
            height: 0.55,
            depth: 0.22
        }, this.scene);
        makeFlatShaded(this.leftLeg);
        this.mesh.add(this.leftLeg);
        this.leftLeg.position.set(-0.22, -0.60, 0);
        this.leftLeg.material = createLowPolyMaterial('shieldLeftLegMat', PALETTE.ENEMY_SHIELD_PLATE);

        // --- Left Greave (shin guard): box on front of leg ---
        const leftGreave = createBox('shieldLeftGreave', {
            width: 0.18,
            height: 0.30,
            depth: 0.06
        }, this.scene);
        makeFlatShaded(leftGreave);
        this.leftLeg.add(leftGreave);
        leftGreave.position.set(0, -0.05, 0.13);
        leftGreave.material = createLowPolyMaterial('shieldLeftGreaveMat', PALETTE.ENEMY_SHIELD);

        // --- Left Boot: wider box at bottom of leg ---
        const leftBoot = createBox('shieldLeftBoot', {
            width: 0.24,
            height: 0.10,
            depth: 0.30
        }, this.scene);
        makeFlatShaded(leftBoot);
        this.leftLeg.add(leftBoot);
        leftBoot.position.set(0, -0.30, 0.04);
        leftBoot.material = createLowPolyMaterial('shieldLeftBootMat', PALETTE.ENEMY_SHIELD_PLATE);

        // --- Right Leg: armored ---
        this.rightLeg = createBox('shieldRightLeg', {
            width: 0.22,
            height: 0.55,
            depth: 0.22
        }, this.scene);
        makeFlatShaded(this.rightLeg);
        this.mesh.add(this.rightLeg);
        this.rightLeg.position.set(0.22, -0.60, 0);
        this.rightLeg.material = createLowPolyMaterial('shieldRightLegMat', PALETTE.ENEMY_SHIELD_PLATE);

        // --- Right Greave ---
        const rightGreave = createBox('shieldRightGreave', {
            width: 0.18,
            height: 0.30,
            depth: 0.06
        }, this.scene);
        makeFlatShaded(rightGreave);
        this.rightLeg.add(rightGreave);
        rightGreave.position.set(0, -0.05, 0.13);
        rightGreave.material = createLowPolyMaterial('shieldRightGreaveMat', PALETTE.ENEMY_SHIELD);

        // --- Right Boot ---
        const rightBoot = createBox('shieldRightBoot', {
            width: 0.24,
            height: 0.10,
            depth: 0.30
        }, this.scene);
        makeFlatShaded(rightBoot);
        this.rightLeg.add(rightBoot);
        rightBoot.position.set(0, -0.30, 0.04);
        rightBoot.material = createLowPolyMaterial('shieldRightBootMat', PALETTE.ENEMY_SHIELD_PLATE);

        // Store original scale (dome is built once in the constructor for both
        // GLB and procedural pipelines via _buildShieldDome).
        this.originalScale = 1.0;
    }

    /**
     * Build the translucent blue shield dome and parent it to the body mesh.
     * Called once from the constructor (after createMesh), so it works whether
     * the GLB or the procedural mesh provides the root.
     */
    private _buildShieldDome(): void {
        if (!this.mesh || this.shieldDome) return;
        this.shieldDome = createSphere('shieldDome', { diameter: 1.80, segments: 6 }, this.scene);
        this.mesh.add(this.shieldDome);
        this.shieldDome.position.set(0, 0.95, 0);
        // Per-instance material: its opacity is animated (updateShieldVisual /
        // flashShieldRegen), so it must never be shared or cached.
        const domeMat = new MeshPhongMaterial();
        domeMat.name = 'shieldDomeMat';
        domeMat.color    = new Color(0.40, 0.60, 1.0);
        domeMat.emissive = new Color(0.15, 0.30, 0.60);
        domeMat.specular = new Color(0, 0, 0);
        domeMat.transparent = true;
        // 0.22 (was 0.35): several shield-bearers clustered on one target
        // stacked their shells into a white blob that hid the fight — a single
        // dome still reads clearly at 0.22, and overlaps stay see-through.
        domeMat.opacity = 0.22;
        this.shieldDome.material = domeMat;
        this.shieldDome.userData.ownedMaterial = true;
    }

    /**
     * Create the shield material - semi-transparent blue-tinted when shield is active,
     * darker plate color when depleted
     */
    private createShieldMaterial(): MeshPhongMaterial {
        const mat = new MeshPhongMaterial();
        mat.name = 'shieldActiveMat';
        mat.color    = new Color(0.35, 0.50, 0.80);
        mat.emissive = new Color(0.10, 0.18, 0.35);
        mat.specular = new Color(0, 0, 0);
        mat.transparent = true;
        mat.opacity = 0.85;
        return mat;
    }

    /**
     * Update the shield mesh visual based on shield state
     */
    protected updateShieldVisual(): void {
        if (!this.shieldMesh) return;

        const shieldFraction = this.maxShield > 0 ? this.shield / this.maxShield : 0;

        if (this.shield > 0) {
            // Shield active: semi-transparent blue tint with emissive glow
            this.shieldMesh.visible = true;
            const mat = this.shieldMesh.material as MeshPhongMaterial;
            if (mat) {
                mat.color = new Color(0.35, 0.50, 0.80);
                mat.emissive = new Color(0.10, 0.18, 0.35);
                mat.opacity = 0.85;
            }
        } else {
            // Shield depleted: show as darker, non-emissive plate
            this.shieldMesh.visible = true;
            const mat = this.shieldMesh.material as MeshPhongMaterial;
            if (mat) {
                mat.color = PALETTE.ENEMY_SHIELD_PLATE;
                mat.emissive = new Color(0, 0, 0);
                mat.opacity = 1.0;
            }
        }

        // Update dome visibility: opacity = shieldFraction × 0.22 (matches the
        // reduced full-shield opacity — see _buildShieldDome).
        if (this.shieldDome) {
            const domeMat = this.shieldDome.material as MeshPhongMaterial;
            if (domeMat) {
                domeMat.opacity = shieldFraction * 0.22;
            }
            this.shieldDome.visible = shieldFraction > 0;
        }
    }

    /**
     * Flash the shield dome brightly then fade when shield regen kicks in.
     */
    private flashShieldRegen(): void {
        if (!this.shieldDome) return;
        const domeMat = this.shieldDome.material as MeshPhongMaterial;
        if (!domeMat) return;

        domeMat.opacity = 0.55;
        const startTime = performance.now();
        const observer = this.scene.onBeforeRender.add(() => {
            const elapsed = performance.now() - startTime;
            const t = Math.min(elapsed / 300, 1.0);
            domeMat.opacity = 0.55 - (0.55 - 0.35) * t;
            if (t >= 1.0) {
                this.scene.onBeforeRender.remove(observer);
            }
        });
    }

    // HP bar creation/update is inherited from Enemy.ts and anchored by
    // `barHeightOffset` set in the constructor via applyHealthBarTier.

    /**
     * Override takeDamage to implement shield absorption
     * Shield absorbs damage first, then remainder passes to HP
     * @param amount The amount of damage to apply
     * @returns True if the enemy died from this damage
     */
    public takeDamage(amount: number): boolean {
        if (!this.alive) return false;

        // Record hit time for shield regen tracking
        this.lastHitTime = performance.now();

        if (this.shield > 0) {
            if (amount <= this.shield) {
                // Shield absorbs all damage
                this.shield -= amount;
                this.updateShieldVisual();

                // Still flash on hit even if shield absorbs
                this.flashHit();
                return false;
            } else {
                // Shield absorbs partial, remainder goes to HP
                const remainder = amount - this.shield;
                this.shield = 0;
                this.updateShieldVisual();

                // Pass remainder to parent takeDamage (which handles resistance, health bar, death)
                return super.takeDamage(remainder);
            }
        }

        // No shield, pass full damage to parent
        return super.takeDamage(amount);
    }

    /**
     * Update the enemy with heavy march animation and shield regen logic
     * @param deltaTime Time elapsed since last update in seconds
     * @returns True if the enemy reached the end of the path
     */
    public update(deltaTime: number): boolean {
        if (!this.alive || !this.mesh) return false;

        // Shield regeneration: fully restore after 5 seconds of not being hit
        if (this.shield < this.maxShield && this.lastHitTime > 0) {
            if (performance.now() - this.lastHitTime > 5000) {
                this.shield = this.maxShield;
                this.updateShieldVisual();
                // Brief bright flash to signal regen
                this.flashShieldRegen();
                // Reset lastHitTime so we don't flash every frame
                this.lastHitTime = -1;
            }
        }

        // Get the result from the parent update method
        const result = super.update(deltaTime);

        // GLB-driven instances: skip procedural limb animation and use clip switching.
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
                const inRange = distSq <= ShieldEnemy.GLB_ATTACK_RANGE * ShieldEnemy.GLB_ATTACK_RANGE;
                if (inRange) this.glbAttackHoldTimer = ShieldEnemy.GLB_ATTACK_HOLD;
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

        // Update walking animation: heavy stomp/march
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

    /** Paladin march pose — advances the walk phase and poses the body, legs,
     *  shield arm, sword arm, and head. Called by update() while marching and
     *  by tickNetworkProceduralAnim on the guest. */
    protected animateProceduralParts(deltaTime: number): void {
        if (!this.mesh) return;
        this.walkTime += deltaTime * 4; // Slower cadence for heavy paladin march

        // Heavy stomp: pronounced vertical bob with impact
        const stompPhase = Math.abs(Math.sin(this.walkTime));
        const bobAmount = stompPhase * 0.08;
        this.mesh.position.y = this.position.y + 0.70 + bobAmount;

        // Slight forward lean during march
        this.mesh.rotation.x = Math.sin(this.walkTime) * 0.03;

        // Minimal side-to-side sway (armored = stiff)
        this.mesh.rotation.z = Math.sin(this.walkTime * 0.5) * 0.03;

        // Legs: alternating heavy stride
        if (this.leftLeg && this.rightLeg) {
            this.leftLeg.rotation.x = Math.sin(this.walkTime) * 0.40;
            this.rightLeg.rotation.x = Math.sin(this.walkTime + Math.PI) * 0.40;
        }

        // Shield arm: held out to the side, shield bobs with steps
        if (this.leftArm) {
            this.leftArm.rotation.x = Math.sin(this.walkTime + Math.PI) * 0.12;
            this.leftArm.rotation.z = -0.25 + Math.sin(this.walkTime * 0.8) * 0.06;
        }

        // Sword arm: swings with march cadence
        if (this.rightArm) {
            this.rightArm.rotation.x = Math.sin(this.walkTime) * 0.35;
            this.rightArm.rotation.z = 0.08;
        }

        // Head: slight nod with march rhythm, minimal side look
        if (this.head) {
            this.head.rotation.y = Math.sin(this.walkTime * 0.7) * 0.06;
            this.head.rotation.x = Math.sin(this.walkTime * 1.2) * 0.04;
        }
    }

    /**
     * Create a death effect - silver/gold burst for the paladin
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

        // Silver/gold metallic burst, floating upward (gravity is negative = anti-gravity).
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
                startColor: { min: { r: 0.75, g: 0.72, b: 0.80 }, max: { r: 0.85, g: 0.70, b: 0.25 } },
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

    /**
     * Returns the shield fraction (shield/maxShield) for snapshot authoring
     * (host only). Guest ShieldEnemy instances use applyNetworkState to drive
     * the dome visual from this value.
     */
    public getShieldFraction(): number | undefined {
        return this.maxShield > 0 ? this.shield / this.maxShield : 0;
    }

    /**
     * Guest-side override: drive the dome visual from the host-authoritative
     * shield fraction carried in the snapshot. The guest's ShieldEnemy never
     * runs AI or takeDamage, so we set the internal shield state and call
     * updateShieldVisual directly.
     */
    public applyNetworkState(s: import('../../net/Protocol').SnapshotEnemy): void {
        super.applyNetworkState(s);
        if (s.shield !== undefined) {
            this.shield = s.shield * this.maxShield;
            this.updateShieldVisual();
        }
    }

    /**
     * Clean up resources
     */
    public dispose(): void {
        if (this.shieldMesh) {
            // Free the shield subtree WITH its per-instance materials — once it
            // detaches here, the base tree release can no longer reach them.
            disposeMesh(this.shieldMesh, { materials: true });
            this.shieldMesh = null;
        }

        super.dispose();
    }
}
