import { Vector3, MeshBuilder, StandardMaterial, Color3, Color4, ParticleSystem, Mesh } from '@babylonjs/core';
import { Game } from '../../Game';
import { Enemy, getStatusEffectTexture } from './Enemy';
import { createLowPolyMaterial, createEmissiveMaterial, makeFlatShaded } from '../../rendering/LowPolyMaterial';
import { PALETTE } from '../../rendering/StyleConstants';

export class ShieldEnemy extends Enemy {
    private walkTime: number = 0;
    private head: Mesh | null = null;
    private leftLeg: Mesh | null = null;
    private rightLeg: Mesh | null = null;
    private leftArm: Mesh | null = null;
    private rightArm: Mesh | null = null;

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
    }

    /**
     * Create the enemy mesh - low-poly Armored Paladin
     * Bulky armored body, helmet with gold visor, tower shield on left arm,
     * short sword on right, armored legs with boots
     */
    protected createMesh(): void {
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

        // --- Shield dome: translucent blue sphere surrounding the enemy ---
        // Alpha is proportional to shield fraction; invisible when shield is depleted.
        this.shieldDome = MeshBuilder.CreateSphere('shieldDome', { diameter: 1.80, segments: 6 }, this.scene);
        this.shieldDome.parent = this.mesh;
        this.shieldDome.position = new Vector3(0, 0.15, 0);
        const domeMat = new StandardMaterial('shieldDomeMat', this.scene);
        domeMat.diffuseColor = new Color3(0.40, 0.60, 1.0);
        domeMat.emissiveColor = new Color3(0.15, 0.30, 0.60);
        domeMat.specularColor = Color3.Black();
        domeMat.alpha = 0.35; // full shield = 0.35
        this.shieldDome.material = domeMat;

        // Store original scale
        this.originalScale = 1.0;
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

    /**
     * Override the health bar creation for shield enemies (positioned higher due to tall model)
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
     * Override the updateHealthBar method for shield enemies
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
     * Create a death effect - silver/gold burst for the paladin
     */
    protected createDeathEffect(): void {
        if (!this.mesh) return;

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

        // Stop and dispose after 1 second
        setTimeout(() => {
            particleSystem.stop();
            setTimeout(() => {
                particleSystem.dispose();
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
