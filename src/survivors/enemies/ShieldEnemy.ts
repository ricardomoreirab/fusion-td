import { Vector3, MeshBuilder, StandardMaterial, Color3, Color4, ParticleSystem, Mesh, AssetContainer, AnimationGroup, TransformNode, Quaternion } from '@babylonjs/core';
import { Game } from '../../engine/Game';
import { Enemy, getStatusEffectTexture, tryAcquireDeathBurst, releaseDeathBurst } from './Enemy';
import { createLowPolyMaterial, createEmissiveMaterial, makeFlatShaded } from '../../engine/rendering/LowPolyMaterial';
import { PALETTE } from '../../engine/rendering/StyleConstants';

export class ShieldEnemy extends Enemy {
    /** Static slot used by EnemyManager.spawnSurvivorsEnemy to stage a preloaded GLB
     *  asset before constructing a ShieldEnemy. createMesh() consumes + clears it. */
    public static pendingAsset: AssetContainer | null = null;

    private walkTime: number = 0;
    private head: Mesh | null = null;
    private leftLeg: Mesh | null = null;
    private rightLeg: Mesh | null = null;
    private leftArm: Mesh | null = null;
    private rightArm: Mesh | null = null;

    /** True when this instance renders via the red-super-melee-minion GLB. */
    private usingGLB: boolean = false;
    private glbWalkAnim: AnimationGroup | null = null;
    private glbAttackAnim: AnimationGroup | null = null;
    private glbIdleAnim: AnimationGroup | null = null;
    private glbCurrentAnim: AnimationGroup | null = null;
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

    private createMeshFromGLB(asset: AssetContainer): void {
        this.usingGLB = true;
        this.mesh = new Mesh('shieldEnemyGlbRoot', this.scene);
        this.mesh.position.copyFrom(this.position);

        const inst = asset.instantiateModelsToScene(
            name => `shield_${name}`,
            true,
            { doNotInstantiate: true },
        );
        for (const root of inst.rootNodes) {
            root.parent = this.mesh;
            if ('scaling' in root && root.scaling) {
                (root as TransformNode).scaling.scaleInPlace(ShieldEnemy.GLB_SCALE);
            }
            // 180° Y flip — same pattern as BasicEnemy GLB so the model faces the hero.
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

        this.glbAnimationGroups = inst.animationGroups;
        this.glbSkeletons = inst.skeletons;
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

    private playGlbAnim(slot: AnimationGroup | null, loop: boolean): void {
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
        this.mesh = MeshBuilder.CreateBox('shieldEnemyBody', {
            width: 0.85,
            height: 0.70,
            depth: 0.55
        }, this.scene);
        makeFlatShaded(this.mesh);
        this.mesh.position = this.position.clone();
        this.mesh.position.y += 0.70;
        this.mesh.material = createLowPolyMaterial('shieldBodyMat', PALETTE.ENEMY_SHIELD, this.scene);

        // --- Chest plate: front armor plate ---
        const chestPlate = MeshBuilder.CreateBox('shieldChestPlate', {
            width: 0.72,
            height: 0.55,
            depth: 0.08
        }, this.scene);
        makeFlatShaded(chestPlate);
        chestPlate.parent = this.mesh;
        chestPlate.position = new Vector3(0, 0.0, 0.30);
        chestPlate.material = createLowPolyMaterial('shieldChestPlateMat', PALETTE.ENEMY_SHIELD_PLATE, this.scene);

        // --- Gold chest emblem: small box on chest plate ---
        const emblem = MeshBuilder.CreateBox('shieldEmblem', {
            width: 0.15,
            height: 0.15,
            depth: 0.04
        }, this.scene);
        makeFlatShaded(emblem);
        emblem.parent = chestPlate;
        emblem.position = new Vector3(0, 0.10, 0.05);
        emblem.rotation.z = Math.PI / 4; // Diamond shape
        emblem.material = createLowPolyMaterial('shieldEmblemMat', PALETTE.ENEMY_SHIELD_GOLD, this.scene);

        // --- Back plate: rear armor ---
        const backPlate = MeshBuilder.CreateBox('shieldBackPlate', {
            width: 0.68,
            height: 0.50,
            depth: 0.06
        }, this.scene);
        makeFlatShaded(backPlate);
        backPlate.parent = this.mesh;
        backPlate.position = new Vector3(0, 0.0, -0.30);
        backPlate.material = createLowPolyMaterial('shieldBackPlateMat', PALETTE.ENEMY_SHIELD_PLATE, this.scene);

        // --- Pauldrons (shoulder guards): two boxes ---
        const leftPauldron = MeshBuilder.CreateBox('shieldLeftPauldron', {
            width: 0.28,
            height: 0.15,
            depth: 0.30
        }, this.scene);
        makeFlatShaded(leftPauldron);
        leftPauldron.parent = this.mesh;
        leftPauldron.position = new Vector3(-0.48, 0.30, 0);
        leftPauldron.rotation.z = -0.2;
        leftPauldron.material = createLowPolyMaterial('shieldLeftPauldronMat', PALETTE.ENEMY_SHIELD_PLATE, this.scene);

        const rightPauldron = MeshBuilder.CreateBox('shieldRightPauldron', {
            width: 0.28,
            height: 0.15,
            depth: 0.30
        }, this.scene);
        makeFlatShaded(rightPauldron);
        rightPauldron.parent = this.mesh;
        rightPauldron.position = new Vector3(0.48, 0.30, 0);
        rightPauldron.rotation.z = 0.2;
        rightPauldron.material = createLowPolyMaterial('shieldRightPauldronMat', PALETTE.ENEMY_SHIELD_PLATE, this.scene);

        // --- Belt: horizontal armored strip ---
        const belt = MeshBuilder.CreateBox('shieldBelt', {
            width: 0.88,
            height: 0.10,
            depth: 0.58
        }, this.scene);
        makeFlatShaded(belt);
        belt.parent = this.mesh;
        belt.position = new Vector3(0, -0.32, 0);
        belt.material = createLowPolyMaterial('shieldBeltMat', PALETTE.ENEMY_SHIELD_GOLD, this.scene);

        // --- Head / Helmet: box-shaped great helm ---
        this.head = MeshBuilder.CreateBox('shieldHead', {
            width: 0.50,
            height: 0.52,
            depth: 0.48
        }, this.scene);
        makeFlatShaded(this.head);
        this.head.parent = this.mesh;
        this.head.position = new Vector3(0, 0.60, 0.02);
        this.head.material = createLowPolyMaterial('shieldHeadMat', PALETTE.ENEMY_SHIELD, this.scene);

        // --- Helmet crest: small ridge on top ---
        const crest = MeshBuilder.CreateBox('shieldCrest', {
            width: 0.08,
            height: 0.12,
            depth: 0.38
        }, this.scene);
        makeFlatShaded(crest);
        crest.parent = this.head;
        crest.position = new Vector3(0, 0.30, -0.02);
        crest.material = createLowPolyMaterial('shieldCrestMat', PALETTE.ENEMY_SHIELD_GOLD, this.scene);

        // --- Visor slit: emissive golden eyes ---
        const visor = MeshBuilder.CreateBox('shieldVisor', {
            width: 0.36,
            height: 0.06,
            depth: 0.06
        }, this.scene);
        makeFlatShaded(visor);
        visor.parent = this.head;
        visor.position = new Vector3(0, 0.04, 0.24);
        visor.material = createEmissiveMaterial('shieldVisorMat', PALETTE.ENEMY_SHIELD_EYE, 0.9, this.scene);

        // --- Left Arm (shield arm): armored box arm ---
        this.leftArm = MeshBuilder.CreateBox('shieldLeftArm', {
            width: 0.20,
            height: 0.58,
            depth: 0.20
        }, this.scene);
        makeFlatShaded(this.leftArm);
        this.leftArm.parent = this.mesh;
        this.leftArm.position = new Vector3(-0.55, -0.02, 0);
        this.leftArm.material = createLowPolyMaterial('shieldLeftArmMat', PALETTE.ENEMY_SHIELD, this.scene);

        // --- Tower Shield on left arm: large flat box ---
        this.shieldMesh = MeshBuilder.CreateBox('shieldTowerShield', {
            width: 0.08,
            height: 0.70,
            depth: 0.45
        }, this.scene);
        makeFlatShaded(this.shieldMesh);
        this.shieldMesh.parent = this.leftArm;
        this.shieldMesh.position = new Vector3(-0.14, -0.05, 0.10);
        this.shieldMesh.material = this.createShieldMaterial();

        // --- Shield boss (center knob): small box ---
        const shieldBoss = MeshBuilder.CreateBox('shieldBoss', {
            width: 0.06,
            height: 0.14,
            depth: 0.14
        }, this.scene);
        makeFlatShaded(shieldBoss);
        shieldBoss.parent = this.shieldMesh;
        shieldBoss.position = new Vector3(-0.05, 0, 0);
        shieldBoss.material = createLowPolyMaterial('shieldBossMat', PALETTE.ENEMY_SHIELD_GOLD, this.scene);

        // --- Shield gold trim: top and bottom strips ---
        const shieldTrimTop = MeshBuilder.CreateBox('shieldTrimTop', {
            width: 0.09,
            height: 0.05,
            depth: 0.42
        }, this.scene);
        makeFlatShaded(shieldTrimTop);
        shieldTrimTop.parent = this.shieldMesh;
        shieldTrimTop.position = new Vector3(-0.01, 0.32, 0);
        shieldTrimTop.material = createLowPolyMaterial('shieldTrimTopMat', PALETTE.ENEMY_SHIELD_GOLD, this.scene);

        const shieldTrimBottom = MeshBuilder.CreateBox('shieldTrimBottom', {
            width: 0.09,
            height: 0.05,
            depth: 0.42
        }, this.scene);
        makeFlatShaded(shieldTrimBottom);
        shieldTrimBottom.parent = this.shieldMesh;
        shieldTrimBottom.position = new Vector3(-0.01, -0.32, 0);
        shieldTrimBottom.material = createLowPolyMaterial('shieldTrimBottomMat', PALETTE.ENEMY_SHIELD_GOLD, this.scene);

        // --- Right Arm (sword arm): armored box arm ---
        this.rightArm = MeshBuilder.CreateBox('shieldRightArm', {
            width: 0.20,
            height: 0.58,
            depth: 0.20
        }, this.scene);
        makeFlatShaded(this.rightArm);
        this.rightArm.parent = this.mesh;
        this.rightArm.position = new Vector3(0.55, -0.02, 0);
        this.rightArm.material = createLowPolyMaterial('shieldRightArmMat', PALETTE.ENEMY_SHIELD, this.scene);

        // --- Gauntlet on right arm: slightly wider box at hand ---
        const gauntlet = MeshBuilder.CreateBox('shieldGauntlet', {
            width: 0.22,
            height: 0.14,
            depth: 0.22
        }, this.scene);
        makeFlatShaded(gauntlet);
        gauntlet.parent = this.rightArm;
        gauntlet.position = new Vector3(0, -0.28, 0);
        gauntlet.material = createLowPolyMaterial('shieldGauntletMat', PALETTE.ENEMY_SHIELD_PLATE, this.scene);

        // --- Short Sword: blade + handle ---
        const swordBlade = MeshBuilder.CreateBox('shieldSwordBlade', {
            width: 0.06,
            height: 0.45,
            depth: 0.10
        }, this.scene);
        makeFlatShaded(swordBlade);
        swordBlade.parent = this.rightArm;
        swordBlade.position = new Vector3(0.08, -0.45, 0);
        swordBlade.material = createLowPolyMaterial('shieldSwordBladeMat', PALETTE.ENEMY_SHIELD, this.scene);

        // --- Sword crossguard: small horizontal box ---
        const crossguard = MeshBuilder.CreateBox('shieldCrossguard', {
            width: 0.04,
            height: 0.04,
            depth: 0.18
        }, this.scene);
        makeFlatShaded(crossguard);
        crossguard.parent = swordBlade;
        crossguard.position = new Vector3(0, 0.22, 0);
        crossguard.material = createLowPolyMaterial('shieldCrossguardMat', PALETTE.ENEMY_SHIELD_GOLD, this.scene);

        // --- Sword tip: small cone ---
        const swordTip = MeshBuilder.CreateCylinder('shieldSwordTip', {
            height: 0.12,
            diameterTop: 0.0,
            diameterBottom: 0.10,
            tessellation: 3
        }, this.scene);
        makeFlatShaded(swordTip);
        swordTip.parent = swordBlade;
        swordTip.position = new Vector3(0, -0.28, 0);
        swordTip.material = createLowPolyMaterial('shieldSwordTipMat', PALETTE.ENEMY_SHIELD, this.scene);

        // --- Left Leg: armored ---
        this.leftLeg = MeshBuilder.CreateBox('shieldLeftLeg', {
            width: 0.22,
            height: 0.55,
            depth: 0.22
        }, this.scene);
        makeFlatShaded(this.leftLeg);
        this.leftLeg.parent = this.mesh;
        this.leftLeg.position = new Vector3(-0.22, -0.60, 0);
        this.leftLeg.material = createLowPolyMaterial('shieldLeftLegMat', PALETTE.ENEMY_SHIELD_PLATE, this.scene);

        // --- Left Greave (shin guard): box on front of leg ---
        const leftGreave = MeshBuilder.CreateBox('shieldLeftGreave', {
            width: 0.18,
            height: 0.30,
            depth: 0.06
        }, this.scene);
        makeFlatShaded(leftGreave);
        leftGreave.parent = this.leftLeg;
        leftGreave.position = new Vector3(0, -0.05, 0.13);
        leftGreave.material = createLowPolyMaterial('shieldLeftGreaveMat', PALETTE.ENEMY_SHIELD, this.scene);

        // --- Left Boot: wider box at bottom of leg ---
        const leftBoot = MeshBuilder.CreateBox('shieldLeftBoot', {
            width: 0.24,
            height: 0.10,
            depth: 0.30
        }, this.scene);
        makeFlatShaded(leftBoot);
        leftBoot.parent = this.leftLeg;
        leftBoot.position = new Vector3(0, -0.30, 0.04);
        leftBoot.material = createLowPolyMaterial('shieldLeftBootMat', PALETTE.ENEMY_SHIELD_PLATE, this.scene);

        // --- Right Leg: armored ---
        this.rightLeg = MeshBuilder.CreateBox('shieldRightLeg', {
            width: 0.22,
            height: 0.55,
            depth: 0.22
        }, this.scene);
        makeFlatShaded(this.rightLeg);
        this.rightLeg.parent = this.mesh;
        this.rightLeg.position = new Vector3(0.22, -0.60, 0);
        this.rightLeg.material = createLowPolyMaterial('shieldRightLegMat', PALETTE.ENEMY_SHIELD_PLATE, this.scene);

        // --- Right Greave ---
        const rightGreave = MeshBuilder.CreateBox('shieldRightGreave', {
            width: 0.18,
            height: 0.30,
            depth: 0.06
        }, this.scene);
        makeFlatShaded(rightGreave);
        rightGreave.parent = this.rightLeg;
        rightGreave.position = new Vector3(0, -0.05, 0.13);
        rightGreave.material = createLowPolyMaterial('shieldRightGreaveMat', PALETTE.ENEMY_SHIELD, this.scene);

        // --- Right Boot ---
        const rightBoot = MeshBuilder.CreateBox('shieldRightBoot', {
            width: 0.24,
            height: 0.10,
            depth: 0.30
        }, this.scene);
        makeFlatShaded(rightBoot);
        rightBoot.parent = this.rightLeg;
        rightBoot.position = new Vector3(0, -0.30, 0.04);
        rightBoot.material = createLowPolyMaterial('shieldRightBootMat', PALETTE.ENEMY_SHIELD_PLATE, this.scene);

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
        this.shieldDome = MeshBuilder.CreateSphere('shieldDome', { diameter: 1.80, segments: 6 }, this.scene);
        this.shieldDome.parent = this.mesh;
        this.shieldDome.position = new Vector3(0, 0.95, 0);
        const domeMat = new StandardMaterial('shieldDomeMat', this.scene);
        domeMat.diffuseColor  = new Color3(0.40, 0.60, 1.0);
        domeMat.emissiveColor = new Color3(0.15, 0.30, 0.60);
        domeMat.specularColor = Color3.Black();
        domeMat.alpha = 0.35; // full shield = 0.35
        this.shieldDome.material = domeMat;
    }

    /**
     * Create the shield material - semi-transparent blue-tinted when shield is active,
     * darker plate color when depleted
     */
    private createShieldMaterial(): StandardMaterial {
        const mat = new StandardMaterial('shieldActiveMat', this.scene);
        mat.diffuseColor = new Color3(0.35, 0.50, 0.80);
        mat.emissiveColor = new Color3(0.10, 0.18, 0.35);
        mat.specularColor = Color3.Black();
        mat.alpha = 0.85;
        return mat;
    }

    /**
     * Update the shield mesh visual based on shield state
     */
    private updateShieldVisual(): void {
        if (!this.shieldMesh) return;

        const shieldFraction = this.maxShield > 0 ? this.shield / this.maxShield : 0;

        if (this.shield > 0) {
            // Shield active: semi-transparent blue tint with emissive glow
            this.shieldMesh.setEnabled(true);
            const mat = this.shieldMesh.material as StandardMaterial;
            if (mat) {
                mat.diffuseColor = new Color3(0.35, 0.50, 0.80);
                mat.emissiveColor = new Color3(0.10, 0.18, 0.35);
                mat.alpha = 0.85;
            }
        } else {
            // Shield depleted: show as darker, non-emissive plate
            this.shieldMesh.setEnabled(true);
            const mat = this.shieldMesh.material as StandardMaterial;
            if (mat) {
                mat.diffuseColor = PALETTE.ENEMY_SHIELD_PLATE;
                mat.emissiveColor = Color3.Black();
                mat.alpha = 1.0;
            }
        }

        // Update dome visibility: alpha = shieldFraction × 0.35
        if (this.shieldDome) {
            const domeMat = this.shieldDome.material as StandardMaterial;
            if (domeMat) {
                domeMat.alpha = shieldFraction * 0.35;
            }
            this.shieldDome.setEnabled(shieldFraction > 0);
        }
    }

    /**
     * Flash the shield dome brightly then fade when shield regen kicks in.
     */
    private flashShieldRegen(): void {
        if (!this.shieldDome) return;
        const domeMat = this.shieldDome.material as StandardMaterial;
        if (!domeMat) return;

        domeMat.alpha = 0.55;
        const startTime = performance.now();
        const observer = this.scene.onBeforeRenderObservable.add(() => {
            const elapsed = performance.now() - startTime;
            const t = Math.min(elapsed / 300, 1.0);
            domeMat.alpha = 0.55 - (0.55 - 0.35) * t;
            if (t >= 1.0) {
                this.scene.onBeforeRenderObservable.remove(observer);
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
     * Create a death effect - silver/gold burst for the paladin
     */
    protected createDeathEffect(): void {
        if (!this.mesh) return;

        // Cap concurrent death-burst particle systems (mass-AoE-kill spike guard).
        // Past the cap, skip only the poof — the death sound still plays.
        if (!tryAcquireDeathBurst()) {
            this.game.getAssetManager().playSound('enemyDeath');
            return;
        }

        // Create a simple explosion effect
        const particleSystem = new ParticleSystem('deathParticles', 50, this.scene);

        // Set particle texture
        particleSystem.particleTexture = getStatusEffectTexture(this.scene);

        // Set emission properties
        particleSystem.emitter = this.position.clone();
        (particleSystem.emitter as Vector3).y += 0.7;
        particleSystem.minEmitBox = new Vector3(-0.2, 0, -0.2);
        particleSystem.maxEmitBox = new Vector3(0.2, 0, 0.2);

        // Set particle properties - silver/gold metallic burst
        particleSystem.color1 = new Color4(0.75, 0.72, 0.80, 1.0);
        particleSystem.color2 = new Color4(0.85, 0.70, 0.25, 1.0);
        particleSystem.colorDead = new Color4(0.3, 0.3, 0.2, 0.0);

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

        // Stop and dispose after 1 second. dispose(false) preserves the SHARED
        // status-effect texture (getStatusEffectTexture) — default dispose()
        // passes disposeTexture=true and would destroy the singleton out from
        // under other enemies' live status particles, forcing a sync re-create.
        setTimeout(() => {
            particleSystem.stop();
            setTimeout(() => {
                particleSystem.dispose(false);
                releaseDeathBurst();
            }, 1000);
        }, 1000);
    }

    /**
     * Clean up resources
     */
    public dispose(): void {
        if (this.shieldMesh) {
            this.shieldMesh.dispose();
            this.shieldMesh = null;
        }

        super.dispose();
    }
}
