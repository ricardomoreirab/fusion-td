import { Vector3, MeshBuilder, Mesh, Color3, Color4, ParticleSystem, StandardMaterial } from '@babylonjs/core';
import { Game } from '../Game';
import { Enemy } from './enemies/Enemy';
import { EnemyManager } from './EnemyManager';
import { StatusEffect } from './towers/Tower';
import { PALETTE } from '../rendering/StyleConstants';
import { createLowPolyMaterial, createEmissiveMaterial, makeFlatShaded } from '../rendering/LowPolyMaterial';

/**
 * Champion — a friendly boss-like unit that walks the path in reverse,
 * attacks nearby enemies, and slows enemies near it.
 * Extends Enemy for path movement, health bar, and mesh lifecycle.
 */
export class Champion extends Enemy {
    private enemyManager: EnemyManager | null;

    // Player control
    public controlMode: 'ai' | 'player' = 'ai';
    private playerVelocity: Vector3 = new Vector3(0, 0, 0);

    // Combat
    private attackDamage: number = 40;
    private attackRange: number = 3.0;
    private attackCooldown: number = 1.0; // seconds between attacks
    private attackTimer: number = 0;
    private blockRadius: number = 1.5;

    // Blocking throttle
    private blockTimer: number = 0;
    private blockInterval: number = 0.4; // re-apply slow every 0.4s (overlaps 0.5s duration)

    // Animation (walkTime approach like BasicEnemy)
    private walkTime: number = 0;
    private swordArm: Mesh | null = null;
    private shieldArm: Mesh | null = null;
    private head: Mesh | null = null;
    private leftLeg: Mesh | null = null;
    private rightLeg: Mesh | null = null;
    private cape: Mesh | null = null;

    constructor(game: Game, reversedPath: Vector3[], enemyManager: EnemyManager | null = null) {
        // HP 800, Speed 1.5, Damage 0 (doesn't damage player), Reward 0
        const startPos = reversedPath.length > 0 ? reversedPath[0] : new Vector3(0, 0, 0);
        super(game, startPos, reversedPath, 1.5, 800, 0, 0);
        this.enemyManager = enemyManager;
    }

    /**
     * Set movement velocity when in player-controlled mode.
     * Call this from HeroController each frame.
     */
    public setPlayerVelocity(velocity: Vector3): void {
        this.playerVelocity.copyFrom(velocity);
    }

    /**
     * Get current world position of the champion.
     */
    public getPosition(): Vector3 {
        return this.position.clone();
    }

    /**
     * Create the champion mesh — a large, detailed golden knight
     * with full plate armor, kite shield, broadsword, and flowing cape
     */
    protected createMesh(): void {
        const scene = this.scene;

        // --- Body: broad armored torso (scaled up ~1.5x from original) ---
        this.mesh = MeshBuilder.CreateBox('championBody', {
            width: 1.30,
            height: 1.80,
            depth: 0.85
        }, scene);
        makeFlatShaded(this.mesh);
        this.mesh.position = this.position.clone();
        this.mesh.position.y += 2.0;
        this.mesh.material = createLowPolyMaterial('championBodyMat', PALETTE.CHAMPION_BODY, scene);

        // --- Chest plate: raised center plate with beveled look ---
        const chestPlate = MeshBuilder.CreateBox('championChest', {
            width: 0.70,
            height: 0.55,
            depth: 0.08
        }, scene);
        makeFlatShaded(chestPlate);
        chestPlate.parent = this.mesh;
        chestPlate.position = new Vector3(0, 0.20, 0.46);
        chestPlate.material = createEmissiveMaterial('championChestMat', PALETTE.CHAMPION_HELM, 0.3, scene);

        // Chest emblem: heraldic diamond
        const chestEmblem = MeshBuilder.CreatePolyhedron('championChestEmblem', {
            type: 1, // Octahedron
            size: 0.08
        }, scene);
        makeFlatShaded(chestEmblem);
        chestEmblem.parent = chestPlate;
        chestEmblem.position = new Vector3(0, 0, 0.06);
        chestEmblem.scaling = new Vector3(1, 1.4, 0.5);
        chestEmblem.material = createEmissiveMaterial('championEmblemMat', PALETTE.CHAMPION_CAPE, 0.6, scene);

        // --- Belt / waist armor ---
        const belt = MeshBuilder.CreateBox('championBelt', {
            width: 1.10,
            height: 0.15,
            depth: 0.90
        }, scene);
        makeFlatShaded(belt);
        belt.parent = this.mesh;
        belt.position = new Vector3(0, -0.50, 0);
        belt.material = createLowPolyMaterial('championBeltMat', new Color3(0.50, 0.38, 0.18), scene);

        // Belt buckle
        const buckle = MeshBuilder.CreateBox('championBuckle', {
            width: 0.18,
            height: 0.12,
            depth: 0.06
        }, scene);
        makeFlatShaded(buckle);
        buckle.parent = belt;
        buckle.position = new Vector3(0, 0, 0.48);
        buckle.material = createEmissiveMaterial('championBuckleMat', PALETTE.CHAMPION_HELM, 0.4, scene);

        // --- Tassets (hip armor plates) ---
        for (let side = -1; side <= 1; side += 2) {
            const tasset = MeshBuilder.CreateBox(`championTasset${side}`, {
                width: 0.40,
                height: 0.35,
                depth: 0.12
            }, scene);
            makeFlatShaded(tasset);
            tasset.parent = this.mesh;
            tasset.position = new Vector3(side * 0.32, -0.72, 0.15);
            tasset.material = createLowPolyMaterial(`championTassetMat${side}`, PALETTE.CHAMPION_BODY, scene);
        }

        // --- Shoulder pauldrons: large faceted armor pieces ---
        for (let side = -1; side <= 1; side += 2) {
            const pauldron = MeshBuilder.CreatePolyhedron(`championPauldron${side}`, {
                type: 2, // Icosahedron
                size: 0.30
            }, scene);
            makeFlatShaded(pauldron);
            pauldron.parent = this.mesh;
            pauldron.position = new Vector3(side * 0.80, 0.70, 0);
            pauldron.scaling = new Vector3(0.9, 0.6, 0.9);
            pauldron.material = createLowPolyMaterial(`championPauldronMat${side}`, PALETTE.CHAMPION_BODY, scene);

            // Pauldron edge trim
            const trim = MeshBuilder.CreateTorus(`championPauldronTrim${side}`, {
                diameter: 0.42,
                thickness: 0.04,
                tessellation: 8
            }, scene);
            makeFlatShaded(trim);
            trim.parent = pauldron;
            trim.position = new Vector3(0, -0.08, 0);
            trim.material = createEmissiveMaterial(`championPauldronTrimMat${side}`, PALETTE.CHAMPION_HELM, 0.3, scene);

            // Spike on top of pauldron
            const spike = MeshBuilder.CreateCylinder(`championPauldronSpike${side}`, {
                height: 0.20,
                diameterTop: 0.0,
                diameterBottom: 0.08,
                tessellation: 4
            }, scene);
            makeFlatShaded(spike);
            spike.parent = pauldron;
            spike.position = new Vector3(0, 0.18, 0);
            spike.material = createLowPolyMaterial(`championSpikeMat${side}`, PALETTE.CHAMPION_WEAPON, scene);
        }

        // --- Head with great helm ---
        this.head = MeshBuilder.CreatePolyhedron('championHelm', {
            type: 2, // Icosahedron
            size: 0.38
        }, scene);
        makeFlatShaded(this.head);
        this.head.parent = this.mesh;
        this.head.position = new Vector3(0, 1.20, 0.05);
        this.head.scaling = new Vector3(0.85, 0.80, 1.0);
        this.head.material = createLowPolyMaterial('championHelmMat', PALETTE.CHAMPION_HELM, scene);

        // Visor: T-shaped slit (horizontal + vertical)
        const visorH = MeshBuilder.CreateBox('championVisorH', {
            width: 0.36,
            height: 0.05,
            depth: 0.06
        }, scene);
        makeFlatShaded(visorH);
        visorH.parent = this.head;
        visorH.position = new Vector3(0, -0.02, 0.36);
        visorH.material = createEmissiveMaterial('championVisorHMat', new Color3(0.3, 0.6, 1.0), 0.8, scene);

        const visorV = MeshBuilder.CreateBox('championVisorV', {
            width: 0.04,
            height: 0.14,
            depth: 0.06
        }, scene);
        makeFlatShaded(visorV);
        visorV.parent = this.head;
        visorV.position = new Vector3(0, -0.04, 0.36);
        visorV.material = createEmissiveMaterial('championVisorVMat', new Color3(0.3, 0.6, 1.0), 0.8, scene);

        // Helm crest ridge: runs top to back
        const crest = MeshBuilder.CreateBox('championCrest', {
            width: 0.06,
            height: 0.08,
            depth: 0.50
        }, scene);
        makeFlatShaded(crest);
        crest.parent = this.head;
        crest.position = new Vector3(0, 0.25, -0.05);
        crest.material = createLowPolyMaterial('championCrestMat', PALETTE.CHAMPION_BODY, scene);

        // Plume: tall flowing feather crest
        const plume = MeshBuilder.CreateCylinder('championPlume', {
            height: 0.55,
            diameterTop: 0.0,
            diameterBottom: 0.14,
            tessellation: 4
        }, scene);
        makeFlatShaded(plume);
        plume.parent = this.head;
        plume.position = new Vector3(0, 0.45, -0.12);
        plume.material = createLowPolyMaterial('championPlumeMat', PALETTE.CHAMPION_CAPE, scene);

        // Secondary plume feathers
        for (let i = 0; i < 2; i++) {
            const feather = MeshBuilder.CreateCylinder(`championFeather${i}`, {
                height: 0.35,
                diameterTop: 0.0,
                diameterBottom: 0.08,
                tessellation: 3
            }, scene);
            makeFlatShaded(feather);
            feather.parent = this.head;
            feather.position = new Vector3((i === 0 ? -1 : 1) * 0.06, 0.38, -0.14);
            feather.rotation.z = (i === 0 ? -1 : 1) * 0.2;
            feather.material = createLowPolyMaterial(`championFeatherMat${i}`, PALETTE.CHAMPION_CAPE, scene);
        }

        // --- Cape: layered flowing fabric ---
        this.cape = MeshBuilder.CreateBox('championCape', {
            width: 1.0,
            height: 1.60,
            depth: 0.06
        }, scene);
        makeFlatShaded(this.cape);
        this.cape.parent = this.mesh;
        this.cape.position = new Vector3(0, -0.20, -0.46);
        this.cape.material = createLowPolyMaterial('championCapeMat', PALETTE.CHAMPION_CAPE, scene);

        // Cape hem detail (bottom trim)
        const capeHem = MeshBuilder.CreateBox('championCapeHem', {
            width: 1.0,
            height: 0.06,
            depth: 0.08
        }, scene);
        makeFlatShaded(capeHem);
        capeHem.parent = this.cape;
        capeHem.position = new Vector3(0, -0.80, 0.01);
        capeHem.material = createEmissiveMaterial('championCapeHemMat', PALETTE.CHAMPION_HELM, 0.25, scene);

        // --- Right arm (Sword arm) with gauntlet ---
        this.swordArm = MeshBuilder.CreateBox('championSwordArm', {
            width: 0.32,
            height: 1.30,
            depth: 0.32
        }, scene);
        makeFlatShaded(this.swordArm);
        this.swordArm.parent = this.mesh;
        this.swordArm.position = new Vector3(0.82, 0.0, 0.05);
        this.swordArm.material = createLowPolyMaterial('championSwordArmMat', PALETTE.CHAMPION_BODY, scene);

        // Gauntlet cuff
        const rightGauntlet = MeshBuilder.CreateBox('championRightGauntlet', {
            width: 0.38,
            height: 0.12,
            depth: 0.38
        }, scene);
        makeFlatShaded(rightGauntlet);
        rightGauntlet.parent = this.swordArm;
        rightGauntlet.position = new Vector3(0, -0.40, 0);
        rightGauntlet.material = createLowPolyMaterial('championRGauntletMat', PALETTE.CHAMPION_HELM, scene);

        // --- Sword: detailed broadsword ---
        // Grip (wrapped handle)
        const swordGrip = MeshBuilder.CreateCylinder('championSwordGrip', {
            height: 0.30,
            diameterTop: 0.06,
            diameterBottom: 0.06,
            tessellation: 6
        }, scene);
        makeFlatShaded(swordGrip);
        swordGrip.parent = this.swordArm;
        swordGrip.position = new Vector3(0, -0.58, 0.12);
        swordGrip.material = createLowPolyMaterial('championGripMat', new Color3(0.40, 0.28, 0.14), scene);

        // Crossguard
        const crossguard = MeshBuilder.CreateBox('championCrossguard', {
            width: 0.35,
            height: 0.06,
            depth: 0.08
        }, scene);
        makeFlatShaded(crossguard);
        crossguard.parent = this.swordArm;
        crossguard.position = new Vector3(0, -0.45, 0.12);
        crossguard.material = createEmissiveMaterial('championCrossguardMat', PALETTE.CHAMPION_HELM, 0.3, scene);

        // Crossguard curved tips
        for (let side = -1; side <= 1; side += 2) {
            const tip = MeshBuilder.CreateCylinder(`championGuardTip${side}`, {
                height: 0.08,
                diameterTop: 0.04,
                diameterBottom: 0.02,
                tessellation: 4
            }, scene);
            makeFlatShaded(tip);
            tip.parent = crossguard;
            tip.position = new Vector3(side * 0.18, 0, 0);
            tip.rotation.z = side * 0.4;
            tip.material = createEmissiveMaterial(`championGuardTipMat${side}`, PALETTE.CHAMPION_HELM, 0.3, scene);
        }

        // Blade: long tapered box
        const blade = MeshBuilder.CreateBox('championBlade', {
            width: 0.10,
            height: 1.20,
            depth: 0.04
        }, scene);
        makeFlatShaded(blade);
        blade.parent = this.swordArm;
        blade.position = new Vector3(0, -1.10, 0.12);
        blade.material = createLowPolyMaterial('championBladeMat', PALETTE.CHAMPION_WEAPON, scene);

        // Blade fuller (center groove detail)
        const fuller = MeshBuilder.CreateBox('championFuller', {
            width: 0.03,
            height: 0.90,
            depth: 0.06
        }, scene);
        makeFlatShaded(fuller);
        fuller.parent = blade;
        fuller.position = new Vector3(0, 0.10, 0);
        fuller.material = createLowPolyMaterial('championFullerMat', new Color3(0.60, 0.58, 0.55), scene);

        // Blade tip (tapered point)
        const bladeTip = MeshBuilder.CreateCylinder('championBladeTip', {
            height: 0.20,
            diameterTop: 0.0,
            diameterBottom: 0.10,
            tessellation: 4
        }, scene);
        makeFlatShaded(bladeTip);
        bladeTip.parent = blade;
        bladeTip.position = new Vector3(0, -0.70, 0);
        bladeTip.material = createLowPolyMaterial('championBladeTipMat', PALETTE.CHAMPION_WEAPON, scene);

        // Pommel
        const pommel = MeshBuilder.CreatePolyhedron('championPommel', {
            type: 1, // Octahedron
            size: 0.04
        }, scene);
        makeFlatShaded(pommel);
        pommel.parent = this.swordArm;
        pommel.position = new Vector3(0, -0.72, 0.12);
        pommel.material = createEmissiveMaterial('championPommelMat', PALETTE.CHAMPION_HELM, 0.4, scene);

        // --- Left arm (Shield arm) with gauntlet ---
        this.shieldArm = MeshBuilder.CreateBox('championShieldArm', {
            width: 0.32,
            height: 1.20,
            depth: 0.32
        }, scene);
        makeFlatShaded(this.shieldArm);
        this.shieldArm.parent = this.mesh;
        this.shieldArm.position = new Vector3(-0.82, 0.0, 0.05);
        this.shieldArm.material = createLowPolyMaterial('championShieldArmMat', PALETTE.CHAMPION_BODY, scene);

        // Gauntlet cuff
        const leftGauntlet = MeshBuilder.CreateBox('championLeftGauntlet', {
            width: 0.38,
            height: 0.12,
            depth: 0.38
        }, scene);
        makeFlatShaded(leftGauntlet);
        leftGauntlet.parent = this.shieldArm;
        leftGauntlet.position = new Vector3(0, -0.35, 0);
        leftGauntlet.material = createLowPolyMaterial('championLGauntletMat', PALETTE.CHAMPION_HELM, scene);

        // --- Shield: large kite shield ---
        // Main shield body (tall tapered shape via box)
        const shield = MeshBuilder.CreateBox('championShield', {
            width: 0.60,
            height: 0.85,
            depth: 0.10
        }, scene);
        makeFlatShaded(shield);
        shield.parent = this.shieldArm;
        shield.position = new Vector3(-0.15, -0.15, 0.22);
        shield.material = createLowPolyMaterial('championShieldMat', PALETTE.CHAMPION_CAPE, scene);

        // Shield rim (border trim)
        const shieldRim = MeshBuilder.CreateBox('championShieldRim', {
            width: 0.66,
            height: 0.91,
            depth: 0.04
        }, scene);
        makeFlatShaded(shieldRim);
        shieldRim.parent = shield;
        shieldRim.position = new Vector3(0, 0, 0.04);
        shieldRim.material = createEmissiveMaterial('championShieldRimMat', PALETTE.CHAMPION_HELM, 0.25, scene);

        // Shield inner face (lighter center)
        const shieldFace = MeshBuilder.CreateBox('championShieldFace', {
            width: 0.46,
            height: 0.70,
            depth: 0.04
        }, scene);
        makeFlatShaded(shieldFace);
        shieldFace.parent = shield;
        shieldFace.position = new Vector3(0, 0, 0.06);
        shieldFace.material = createLowPolyMaterial('championShieldFaceMat', new Color3(0.20, 0.38, 0.75), scene);

        // Shield boss (central emblem — larger faceted gem)
        const shieldBoss = MeshBuilder.CreatePolyhedron('championShieldBoss', {
            type: 2, // Icosahedron
            size: 0.10
        }, scene);
        makeFlatShaded(shieldBoss);
        shieldBoss.parent = shield;
        shieldBoss.position = new Vector3(0, 0.05, 0.10);
        shieldBoss.scaling = new Vector3(1, 1, 0.5);
        shieldBoss.material = createEmissiveMaterial('championShieldBossMat', PALETTE.CHAMPION_HELM, 0.6, scene);

        // Shield cross (heraldic cross in gold)
        const crossV = MeshBuilder.CreateBox('championShieldCrossV', {
            width: 0.06,
            height: 0.50,
            depth: 0.04
        }, scene);
        makeFlatShaded(crossV);
        crossV.parent = shield;
        crossV.position = new Vector3(0, 0.0, 0.08);
        crossV.material = createEmissiveMaterial('championCrossVMat', PALETTE.CHAMPION_HELM, 0.3, scene);

        const crossH = MeshBuilder.CreateBox('championShieldCrossH', {
            width: 0.32,
            height: 0.06,
            depth: 0.04
        }, scene);
        makeFlatShaded(crossH);
        crossH.parent = shield;
        crossH.position = new Vector3(0, 0.10, 0.08);
        crossH.material = createEmissiveMaterial('championCrossHMat', PALETTE.CHAMPION_HELM, 0.3, scene);

        // Shield rivets (4 corners)
        const rivetPositions = [
            new Vector3(-0.22, 0.32, 0.08),
            new Vector3(0.22, 0.32, 0.08),
            new Vector3(-0.22, -0.22, 0.08),
            new Vector3(0.22, -0.22, 0.08),
        ];
        for (let i = 0; i < rivetPositions.length; i++) {
            const rivet = MeshBuilder.CreatePolyhedron(`championRivet${i}`, {
                type: 1,
                size: 0.025
            }, scene);
            makeFlatShaded(rivet);
            rivet.parent = shield;
            rivet.position = rivetPositions[i];
            rivet.material = createLowPolyMaterial(`championRivetMat${i}`, PALETTE.CHAMPION_WEAPON, scene);
        }

        // Shield bottom point (kite shape extension)
        const shieldPoint = MeshBuilder.CreateCylinder('championShieldPoint', {
            height: 0.25,
            diameterTop: 0.30,
            diameterBottom: 0.0,
            tessellation: 4
        }, scene);
        makeFlatShaded(shieldPoint);
        shieldPoint.parent = shield;
        shieldPoint.position = new Vector3(0, -0.55, 0);
        shieldPoint.material = createLowPolyMaterial('championShieldPointMat', PALETTE.CHAMPION_CAPE, scene);

        // --- Legs with knee guards ---
        this.leftLeg = MeshBuilder.CreateBox('championLeftLeg', {
            width: 0.38,
            height: 1.10,
            depth: 0.38
        }, scene);
        makeFlatShaded(this.leftLeg);
        this.leftLeg.parent = this.mesh;
        this.leftLeg.position = new Vector3(-0.28, -1.20, 0);
        this.leftLeg.material = createLowPolyMaterial('championLeftLegMat', PALETTE.CHAMPION_BODY, scene);

        this.rightLeg = MeshBuilder.CreateBox('championRightLeg', {
            width: 0.38,
            height: 1.10,
            depth: 0.38
        }, scene);
        makeFlatShaded(this.rightLeg);
        this.rightLeg.parent = this.mesh;
        this.rightLeg.position = new Vector3(0.28, -1.20, 0);
        this.rightLeg.material = createLowPolyMaterial('championRightLegMat', PALETTE.CHAMPION_BODY, scene);

        // Knee guards
        for (const leg of [this.leftLeg, this.rightLeg]) {
            const knee = MeshBuilder.CreatePolyhedron(`championKnee_${leg.name}`, {
                type: 1,
                size: 0.08
            }, scene);
            makeFlatShaded(knee);
            knee.parent = leg;
            knee.position = new Vector3(0, 0.15, 0.22);
            knee.scaling = new Vector3(1.2, 0.8, 0.6);
            knee.material = createLowPolyMaterial(`championKneeMat_${leg.name}`, PALETTE.CHAMPION_HELM, scene);
        }

        // --- Feet: armored sabatons ---
        const leftFoot = MeshBuilder.CreateBox('championLeftFoot', {
            width: 0.42,
            height: 0.14,
            depth: 0.55
        }, scene);
        makeFlatShaded(leftFoot);
        leftFoot.parent = this.leftLeg;
        leftFoot.position = new Vector3(0, -0.56, 0.08);
        leftFoot.material = createLowPolyMaterial('championLeftFootMat', PALETTE.CHAMPION_BODY, scene);

        const rightFoot = MeshBuilder.CreateBox('championRightFoot', {
            width: 0.42,
            height: 0.14,
            depth: 0.55
        }, scene);
        makeFlatShaded(rightFoot);
        rightFoot.parent = this.rightLeg;
        rightFoot.position = new Vector3(0, -0.56, 0.08);
        rightFoot.material = createLowPolyMaterial('championRightFootMat', PALETTE.CHAMPION_BODY, scene);

        this.originalScale = 1.0;
    }

    /**
     * Override health bar to use blue color (friendly unit)
     */
    protected createHealthBar(): void {
        super.createHealthBar();
        // Change health bar to blue for friendly units
        if (this.healthBarMesh) {
            const mat = this.healthBarMesh.material as StandardMaterial;
            mat.diffuseColor = new Color3(0.2, 0.5, 1.0);
        }
    }

    /**
     * Override to always show blue health bar regardless of HP %
     */
    protected updateHealthBar(): void {
        super.updateHealthBar();
        if (this.healthBarMesh) {
            const mat = this.healthBarMesh.material as StandardMaterial;
            mat.diffuseColor = new Color3(0.2, 0.5, 1.0);
        }
    }

    /**
     * Update the champion — attack, block, and move along reversed path
     */
    public update(deltaTime: number): boolean {
        if (!this.alive || !this.mesh) return false;

        // Player-controlled mode: bypass all AI, apply velocity directly
        if (this.controlMode === 'player') {
            this.position.addInPlace(this.playerVelocity.scale(deltaTime));
            this.mesh.position.x = this.position.x;
            this.mesh.position.z = this.position.z;
            this.mesh.position.y = this.position.y + 2.0;
            // Face movement direction
            if (this.playerVelocity.lengthSquared() > 0.001) {
                this.mesh.rotation.y = Math.atan2(this.playerVelocity.x, this.playerVelocity.z);
            }
            // Update health bar position
            this.updateHealthBar();
            return false; // never "reached end of path"
        }

        // Attack nearby enemies

        // Block nearby enemies (throttled to avoid particle spam)
        this.blockTimer -= deltaTime;
        if (this.blockTimer <= 0) {
            this.blockNearbyEnemies();
            this.blockTimer = this.blockInterval;
        }

        // Move along the reversed path first (super.update sets mesh.position)
        const reachedEnd = super.update(deltaTime);

        // Animate AFTER super.update (same pattern as BasicEnemy goblin)
        if (!this.isFrozen && !this.isStunned && this.currentPathIndex < this.path.length && this.mesh) {
            this.walkTime += deltaTime * 4; // Heavy knight: slower than goblin's 6

            // Body: bob up/down + slight side-to-side weight shift
            const bobAmount = Math.abs(Math.sin(this.walkTime)) * 0.05;
            this.mesh.position.y = this.position.y + 2.0 + bobAmount;
            this.mesh.rotation.z = Math.sin(this.walkTime) * 0.04; // Torso lean

            // Legs: alternating stride (similar amplitude to goblin)
            if (this.leftLeg && this.rightLeg) {
                this.leftLeg.rotation.x = Math.sin(this.walkTime) * 0.45;
                this.rightLeg.rotation.x = Math.sin(this.walkTime + Math.PI) * 0.45;
            }

            // Sword arm: swings opposite to legs, bigger during attack
            if (this.swordArm) {
                if (this.attackTimer > this.attackCooldown - 0.3) {
                    // Slash — big downward swing
                    this.swordArm.rotation.x = -Math.PI / 2.5;
                    this.swordArm.rotation.z = -Math.PI / 8;
                } else {
                    this.swordArm.rotation.x = Math.sin(this.walkTime) * 0.40;
                    this.swordArm.rotation.z = -0.08;
                }
            }

            // Shield arm: held forward, slight counter-sway
            if (this.shieldArm) {
                if (this.attackTimer > this.attackCooldown - 0.3) {
                    this.shieldArm.rotation.x = -0.2;
                } else {
                    this.shieldArm.rotation.x = Math.sin(this.walkTime + Math.PI) * 0.20;
                    this.shieldArm.rotation.z = 0.15 + Math.sin(this.walkTime * 0.7) * 0.04;
                }
            }

            // Head: slow look-around
            if (this.head) {
                this.head.rotation.y = Math.sin(this.walkTime * 0.6) * 0.12;
                this.head.rotation.x = Math.sin(this.walkTime * 0.4) * 0.04;
            }

            // Cape: billows with walk rhythm
            if (this.cape) {
                this.cape.rotation.x = Math.sin(this.walkTime * 0.8) * 0.08 + 0.04;
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

        return reachedEnd;
    }

    /**
     * Find the closest enemy and deal damage on cooldown
     */
    private attackNearbyEnemies(deltaTime: number): void {
        this.attackTimer -= deltaTime;
        if (this.attackTimer > 0) return;

        if (!this.enemyManager) return;
        const target = this.enemyManager.getClosestEnemy(this.position, this.attackRange);
        if (!target || !target.isAlive()) return;

        target.takeDamage(this.attackDamage);
        this.attackTimer = this.attackCooldown;

        // Visual: sword swing flash
        this.createAttackEffect(target.getPosition());
    }

    /**
     * Apply a brief slow to all enemies within block radius
     */
    private blockNearbyEnemies(): void {
        if (!this.enemyManager) return;
        const nearbyEnemies = this.enemyManager.getEnemiesInRange(this.position, this.blockRadius);
        for (const enemy of nearbyEnemies) {
            if (enemy.isAlive()) {
                enemy.applyStatusEffect(StatusEffect.SLOWED, 0.5, 0.8);
            }
        }
    }

    /**
     * Create a visual slash effect when attacking
     */
    private createAttackEffect(targetPos: Vector3): void {
        const ps = new ParticleSystem('championSlash', 15, this.scene);
        const midpoint = Vector3.Lerp(this.position, targetPos, 0.5);
        midpoint.y += 1.0;
        ps.emitter = midpoint;
        ps.minEmitBox = new Vector3(-0.3, 0, -0.3);
        ps.maxEmitBox = new Vector3(0.3, 0, 0.3);
        ps.color1 = new Color4(1, 0.85, 0.3, 1);
        ps.color2 = new Color4(1, 0.7, 0.1, 1);
        ps.colorDead = new Color4(0.5, 0.3, 0, 0);
        ps.minSize = 0.15;
        ps.maxSize = 0.4;
        ps.minLifeTime = 0.1;
        ps.maxLifeTime = 0.3;
        ps.emitRate = 80;
        ps.blendMode = ParticleSystem.BLENDMODE_ONEONE;
        ps.direction1 = new Vector3(-1, 0.5, -1);
        ps.direction2 = new Vector3(1, 1.5, 1);
        ps.minEmitPower = 1;
        ps.maxEmitPower = 3;
        ps.start();
        setTimeout(() => { ps.stop(); setTimeout(() => ps.dispose(), 400); }, 100);
    }

    /**
     * Override die to skip gold reward and player damage events.
     * Only creates death particle burst and disposes.
     */
    protected die(): void {
        if (!this.alive) return;
        this.alive = false;

        // Death particle burst (gold/blue themed)
        this.createChampionDeathEffect();

        // Dispose mesh and health bars
        if (this.mesh) {
            this.mesh.dispose();
            this.mesh = null;
        }
        if (this.healthBarMesh) {
            this.healthBarMesh.dispose();
            this.healthBarMesh = null;
        }
        if (this.healthBarBackgroundMesh) {
            this.healthBarBackgroundMesh.dispose();
            this.healthBarBackgroundMesh = null;
        }
        if (this.healthBarOutlineMesh) {
            this.healthBarOutlineMesh.dispose();
            this.healthBarOutlineMesh = null;
        }
        this.statusEffectParticles.forEach(ps => {
            ps.stop();
            ps.dispose();
        });
        this.statusEffectParticles.clear();
    }

    /**
     * Champion-specific death effect — golden burst
     */
    private createChampionDeathEffect(): void {
        const deathPos = this.position.clone();
        deathPos.y += 0.5;

        const ps = new ParticleSystem('championDeath', 40, this.scene);
        ps.emitter = deathPos;
        ps.minEmitBox = new Vector3(-0.3, 0, -0.3);
        ps.maxEmitBox = new Vector3(0.3, 0, 0.3);
        ps.color1 = new Color4(1, 0.85, 0.3, 1);
        ps.color2 = new Color4(0.2, 0.5, 1.0, 1);
        ps.colorDead = new Color4(0.1, 0.2, 0.5, 0);
        ps.minSize = 0.15;
        ps.maxSize = 0.45;
        ps.minLifeTime = 0.3;
        ps.maxLifeTime = 0.8;
        ps.emitRate = 120;
        ps.blendMode = ParticleSystem.BLENDMODE_ONEONE;
        ps.direction1 = new Vector3(-1.5, 1, -1.5);
        ps.direction2 = new Vector3(1.5, 3, 1.5);
        ps.minEmitPower = 1;
        ps.maxEmitPower = 4;
        ps.gravity = new Vector3(0, -5, 0);
        ps.start();
        setTimeout(() => { ps.stop(); setTimeout(() => ps.dispose(), 800); }, 200);
    }
}
