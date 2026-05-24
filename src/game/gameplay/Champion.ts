import { Vector3, MeshBuilder, Mesh, Color3, Color4, ParticleSystem, StandardMaterial } from '@babylonjs/core';
import { Game } from '../Game';
import { Enemy } from './enemies/Enemy';
import { EnemyManager } from './EnemyManager';
import { StatusEffect } from './GameTypes';
import { PALETTE } from '../rendering/StyleConstants';
import { createLowPolyMaterial, createEmissiveMaterial, makeFlatShaded } from '../rendering/LowPolyMaterial';
import { buildBarbarianMesh } from './champions/BarbarianBuilder';

/**
 * Champion — a friendly boss-like unit that walks the path in reverse,
 * attacks nearby enemies, and slows enemies near it.
 * Extends Enemy for path movement, health bar, and mesh lifecycle.
 */
export class Champion extends Enemy {
    private enemyManager: EnemyManager | null;

    /** Visual class type — determines which mesh is built */
    public readonly championType: 'barbarian' | 'ranger' | 'mage';

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
    private lastDeltaTime: number = 0;
    // Spin-attack state (player-controlled knight): runs a 360° body spin on melee swing
    private spinAttackTimer: number = 0;
    private static readonly SPIN_ATTACK_DURATION = 0.4;
    private swordArm: Mesh | null = null;
    private shieldArm: Mesh | null = null;
    private head: Mesh | null = null;
    private leftLeg: Mesh | null = null;
    private rightLeg: Mesh | null = null;
    private cape: Mesh | null = null;

    // Ranger-specific animated parts
    private rangerBow: Mesh | null = null;
    private rangerQuiver: Mesh | null = null;
    private rangerLeftLeg: Mesh | null = null;
    private rangerRightLeg: Mesh | null = null;

    // Mage-specific animated parts
    private mageStaffOrb: Mesh | null = null;
    private mageOrbMat: StandardMaterial | null = null;

    // Barbarian axe head — weapon anchor for element decorations
    private barbAxeHead: Mesh | null = null;

    // Barbarian berserker animated parts
    private barbKiltFlaps: Mesh[] = [];
    private barbBeltTrophy: Mesh | null = null;
    private barbSnarlJaw: Mesh | null = null;
    private barbChestPulseGroup: Mesh | null = null;

    // Barbarian snarl-twitch timing
    private barbSnarlTimer: number = 2;
    private barbSnarlActive: number = 0;

    // Footstep dust throttle — last sign of sin(walkTime) when dust was emitted
    private barbLastStepSign: number = 0;

    // Spin-attack arc ring (temporary mesh + lifetime)
    private barbSpinArcMesh: Mesh | null = null;
    private barbSpinArcTimer: number = 0;
    // Spin-attack blood trail particles
    private barbSpinBloodPs: ParticleSystem | null = null;

    // Per-element weapon decoration meshes, created lazily on first activation
    private elementDecorations: Map<string, Mesh[]> = new Map();

    constructor(
        game: Game,
        reversedPath: Vector3[],
        enemyManager: EnemyManager | null = null,
        championType: 'barbarian' | 'ranger' | 'mage' = 'barbarian',
    ) {
        // HP 800, Speed 1.5, Damage 0 (doesn't damage player), Reward 0
        const startPos = reversedPath.length > 0 ? reversedPath[0] : new Vector3(0, 0, 0);
        super(game, startPos, reversedPath, 1.5, 800, 0, 0);
        this.enemyManager = enemyManager;
        // super() already called createMesh() before championType could be set,
        // so it always built the default knight. If we need a different class,
        // dispose the placeholder mesh and rebuild correctly.
        this.championType = championType;
        if (championType !== 'barbarian') {
            this.rebuildForType();
        }
    }

    private rebuildForType(): void {
        // Dispose limb references the knight builder set, so per-class
        // animation doesn't try to drive disposed meshes.
        this.swordArm = null;
        this.shieldArm = null;
        this.head = null;
        this.leftLeg = null;
        this.rightLeg = null;
        this.cape = null;
        // Dispose the knight body and all parented sub-meshes.
        if (this.mesh) {
            this.mesh.dispose(false, true);
            this.mesh = null;
        }
        // Build the correct class mesh.
        this.createMesh();
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

    /** Triggered by HeroBasicAttack when the melee swing fires. */
    public triggerSpinAttack(): void {
        this.spinAttackTimer = Champion.SPIN_ATTACK_DURATION;
        if (this.championType === 'barbarian') {
            this.startBarbSpinFx();
        }
    }

    /** Barbarian-only: create the red blood trail PS + arc-ring mesh for the spin attack. */
    private startBarbSpinFx(): void {
        // ===== Red blood-trail particle system attached to the axe head =====
        if (this.barbAxeHead && !this.barbSpinBloodPs) {
            const ps = new ParticleSystem('barbSpinBlood', 60, this.scene);
            ps.emitter = this.barbAxeHead;
            ps.minEmitBox = new Vector3(-0.2, -0.2, -0.2);
            ps.maxEmitBox = new Vector3(0.2, 0.2, 0.2);
            ps.color1 = new Color4(0.7, 0.10, 0.05, 1);
            ps.color2 = new Color4(0.45, 0.05, 0.02, 1);
            ps.colorDead = new Color4(0.10, 0.0, 0.0, 0);
            ps.minSize = 0.10;
            ps.maxSize = 0.30;
            ps.minLifeTime = 0.1;
            ps.maxLifeTime = 0.2;
            ps.emitRate = 240;
            ps.blendMode = ParticleSystem.BLENDMODE_ONEONE;
            ps.direction1 = new Vector3(-1, 0.2, -1);
            ps.direction2 = new Vector3(1, 1.2, 1);
            ps.minEmitPower = 1;
            ps.maxEmitPower = 3;
            ps.gravity = new Vector3(0, -3, 0);
            ps.start();
            this.barbSpinBloodPs = ps;
        }

        // ===== Red arc ring at hero feet =====
        if (!this.barbSpinArcMesh && this.mesh) {
            const ring = MeshBuilder.CreateTorus('barbSpinArcRing', {
                diameter: 2.5,
                thickness: 0.15,
                tessellation: 12,
            }, this.scene);
            makeFlatShaded(ring);
            ring.material = createEmissiveMaterial('barbSpinArcRingMat',
                new Color3(0.8, 0.10, 0.05), 0.9, this.scene);
            ring.position = this.position.clone();
            ring.position.y = 0.1;
            ring.scaling = new Vector3(0.3, 1.0, 0.3);
            this.barbSpinArcMesh = ring;
            this.barbSpinArcTimer = Champion.SPIN_ATTACK_DURATION;
        }
    }

    public isSpinning(): boolean {
        return this.spinAttackTimer > 0;
    }

    /**
     * Create the champion mesh — dispatches to per-class builder.
     */
    protected createMesh(): void {
        switch (this.championType) {
            case 'ranger': this.createRangerMesh();    break;
            case 'mage':   this.createMageMesh();      break;
            case 'barbarian':
            default:       this.createBarbarianMesh(); break;
        }
    }

    // =========================================================================
    // BARBARIAN — axe-wielding rugged warrior
    // =========================================================================
    private createBarbarianMesh(): void {
        const parts = buildBarbarianMesh(this.scene, this.position);
        this.mesh = parts.rootMesh;
        this.head = parts.head;
        this.swordArm = parts.swordArm;
        this.shieldArm = parts.shieldArm;
        this.leftLeg = parts.leftLeg;
        this.rightLeg = parts.rightLeg;
        this.barbAxeHead = parts.axeHead;
        this.barbKiltFlaps = parts.kiltFlaps;
        this.barbBeltTrophy = parts.beltTrophy;
        this.barbSnarlJaw = parts.snarlJaw;
        this.barbChestPulseGroup = parts.chestPulseGroup;
        this.cape = null;
        this.originalScale = 1.0;
    }

    // =========================================================================
    // RANGER — lean, agile archer with bow, quiver, hooded cowl
    // =========================================================================
    private createRangerMesh(): void {
        const scene = this.scene;

        // Earthy palette
        const leather      = new Color3(0.55, 0.38, 0.20); // warm leather brown
        const darkLeather  = new Color3(0.35, 0.24, 0.12); // dark leather
        const forestGreen  = new Color3(0.22, 0.42, 0.18); // deep forest green
        const midGreen     = new Color3(0.30, 0.55, 0.22); // mid green
        const bowWood      = new Color3(0.48, 0.32, 0.14); // bow wood
        const arrowShaft   = new Color3(0.60, 0.45, 0.22); // arrow shaft
        const arrowHead    = new Color3(0.68, 0.65, 0.58); // metal arrow tip

        // --- Body: slimmer torso than knight ---
        this.mesh = MeshBuilder.CreateBox('rangerBody', {
            width: 0.85,
            height: 1.55,
            depth: 0.60
        }, scene);
        makeFlatShaded(this.mesh);
        this.mesh.position = this.position.clone();
        this.mesh.position.y += 2.0;
        this.mesh.material = createLowPolyMaterial('rangerBodyMat', forestGreen, scene);

        // Leather chest vest overlay
        const vest = MeshBuilder.CreateBox('rangerVest', {
            width: 0.60,
            height: 0.80,
            depth: 0.08
        }, scene);
        makeFlatShaded(vest);
        vest.parent = this.mesh;
        vest.position = new Vector3(0, 0.15, 0.32);
        vest.material = createLowPolyMaterial('rangerVestMat', leather, scene);

        // Vest buckle strap
        const strap = MeshBuilder.CreateBox('rangerStrap', {
            width: 0.52,
            height: 0.06,
            depth: 0.05
        }, scene);
        makeFlatShaded(strap);
        strap.parent = vest;
        strap.position = new Vector3(0, -0.10, 0.05);
        strap.material = createLowPolyMaterial('rangerStrapMat', darkLeather, scene);

        // Small shoulder pads (light leather, not full pauldrons)
        for (let side = -1; side <= 1; side += 2) {
            const pad = MeshBuilder.CreateBox(`rangerShoulder${side}`, {
                width: 0.22,
                height: 0.18,
                depth: 0.55
            }, scene);
            makeFlatShaded(pad);
            pad.parent = this.mesh;
            pad.position = new Vector3(side * 0.54, 0.65, 0);
            pad.material = createLowPolyMaterial(`rangerShoulderMat${side}`, leather, scene);
        }

        // --- Hooded cowl: cone + sphere base ---
        this.head = MeshBuilder.CreateSphere('rangerHoodBase', {
            diameter: 0.55,
            segments: 5
        }, scene);
        makeFlatShaded(this.head);
        this.head.parent = this.mesh;
        this.head.position = new Vector3(0, 1.05, 0.02);
        this.head.material = createLowPolyMaterial('rangerHoodBaseMat', forestGreen, scene);

        // Hood cone (pointed tip angling back)
        const hoodCone = MeshBuilder.CreateCylinder('rangerHoodCone', {
            height: 0.45,
            diameterTop: 0.0,
            diameterBottom: 0.40,
            tessellation: 5
        }, scene);
        makeFlatShaded(hoodCone);
        hoodCone.parent = this.head;
        hoodCone.position = new Vector3(0, 0.25, -0.05);
        hoodCone.rotation.x = 0.18; // slight backward lean
        hoodCone.material = createLowPolyMaterial('rangerHoodConeMat', darkLeather, scene);

        // Hood brim / shadow strip across face
        const hoodBrim = MeshBuilder.CreateBox('rangerHoodBrim', {
            width: 0.48,
            height: 0.10,
            depth: 0.28
        }, scene);
        makeFlatShaded(hoodBrim);
        hoodBrim.parent = this.head;
        hoodBrim.position = new Vector3(0, 0.05, 0.20);
        hoodBrim.material = createLowPolyMaterial('rangerHoodBrimMat', darkLeather, scene);

        // Eyes (small glowing amber slits beneath the hood)
        for (let side = -1; side <= 1; side += 2) {
            const eye = MeshBuilder.CreateBox(`rangerEye${side}`, {
                width: 0.06,
                height: 0.03,
                depth: 0.04
            }, scene);
            makeFlatShaded(eye);
            eye.parent = this.head;
            eye.position = new Vector3(side * 0.08, 0.0, 0.28);
            eye.material = createEmissiveMaterial(`rangerEyeMat${side}`, new Color3(0.95, 0.75, 0.15), 0.9, scene);
        }

        // --- Arms (no gauntlets, leather bracers instead) ---
        // Right arm (bow arm — extends slightly forward)
        this.swordArm = MeshBuilder.CreateBox('rangerRightArm', {
            width: 0.22,
            height: 1.0,
            depth: 0.22
        }, scene);
        makeFlatShaded(this.swordArm);
        this.swordArm.parent = this.mesh;
        this.swordArm.position = new Vector3(0.55, -0.05, 0.04);
        this.swordArm.material = createLowPolyMaterial('rangerRArmMat', forestGreen, scene);

        // Right bracer (leather cuff)
        const rBracer = MeshBuilder.CreateBox('rangerRBracer', {
            width: 0.26,
            height: 0.16,
            depth: 0.26
        }, scene);
        makeFlatShaded(rBracer);
        rBracer.parent = this.swordArm;
        rBracer.position = new Vector3(0, -0.38, 0);
        rBracer.material = createLowPolyMaterial('rangerRBracerMat', leather, scene);

        // Left arm (draw arm — angled back slightly)
        this.shieldArm = MeshBuilder.CreateBox('rangerLeftArm', {
            width: 0.22,
            height: 1.0,
            depth: 0.22
        }, scene);
        makeFlatShaded(this.shieldArm);
        this.shieldArm.parent = this.mesh;
        this.shieldArm.position = new Vector3(-0.55, -0.05, 0.04);
        this.shieldArm.material = createLowPolyMaterial('rangerLArmMat', forestGreen, scene);

        // Left bracer
        const lBracer = MeshBuilder.CreateBox('rangerLBracer', {
            width: 0.26,
            height: 0.16,
            depth: 0.26
        }, scene);
        makeFlatShaded(lBracer);
        lBracer.parent = this.shieldArm;
        lBracer.position = new Vector3(0, -0.38, 0);
        lBracer.material = createLowPolyMaterial('rangerLBracerMat', leather, scene);

        // --- Bow: diagonal staff across the body ---
        this.rangerBow = MeshBuilder.CreateCylinder('rangerBowStave', {
            height: 1.40,
            diameterTop: 0.04,
            diameterBottom: 0.04,
            tessellation: 5
        }, scene);
        makeFlatShaded(this.rangerBow);
        this.rangerBow.parent = this.mesh;
        // Position bow on the right side, angled diagonally
        this.rangerBow.position = new Vector3(0.30, 0.05, 0.30);
        this.rangerBow.rotation.z = 0.35;  // slight tilt
        this.rangerBow.rotation.x = -0.15;
        this.rangerBow.material = createLowPolyMaterial('rangerBowMat', bowWood, scene);

        // Bow tips (curved ends — small tapered pieces)
        for (let side = -1; side <= 1; side += 2) {
            const bowTip = MeshBuilder.CreateCylinder(`rangerBowTip${side}`, {
                height: 0.14,
                diameterTop: 0.01,
                diameterBottom: 0.04,
                tessellation: 4
            }, scene);
            makeFlatShaded(bowTip);
            bowTip.parent = this.rangerBow;
            bowTip.position = new Vector3(0, side * 0.75, 0);
            bowTip.rotation.z = side * 0.3;
            bowTip.material = createLowPolyMaterial(`rangerBowTipMat${side}`, darkLeather, scene);
        }

        // Bowstring (thin line — very thin cylinder)
        const bowstring = MeshBuilder.CreateCylinder('rangerBowstring', {
            height: 1.30,
            diameterTop: 0.012,
            diameterBottom: 0.012,
            tessellation: 3
        }, scene);
        makeFlatShaded(bowstring);
        bowstring.parent = this.rangerBow;
        bowstring.position = new Vector3(0, 0, 0.06);
        bowstring.material = createLowPolyMaterial('rangerBowstringMat', new Color3(0.80, 0.78, 0.68), scene);

        // --- Quiver on the back ---
        this.rangerQuiver = MeshBuilder.CreateBox('rangerQuiver', {
            width: 0.20,
            height: 0.45,
            depth: 0.20
        }, scene);
        makeFlatShaded(this.rangerQuiver);
        this.rangerQuiver.parent = this.mesh;
        this.rangerQuiver.position = new Vector3(-0.28, 0.20, -0.38);
        this.rangerQuiver.rotation.z = 0.15;
        this.rangerQuiver.material = createLowPolyMaterial('rangerQuiverMat', leather, scene);

        // Arrow stubs poking out of the quiver (3 arrows)
        const arrowOffsets = [-0.05, 0.0, 0.05];
        for (let i = 0; i < arrowOffsets.length; i++) {
            const arrow = MeshBuilder.CreateCylinder(`rangerArrow${i}`, {
                height: 0.38,
                diameterTop: 0.015,
                diameterBottom: 0.015,
                tessellation: 4
            }, scene);
            makeFlatShaded(arrow);
            arrow.parent = this.rangerQuiver;
            arrow.position = new Vector3(arrowOffsets[i], 0.38, 0);
            arrow.material = createLowPolyMaterial(`rangerArrowMat${i}`, arrowShaft, scene);

            // Arrow tip
            const tip = MeshBuilder.CreateCylinder(`rangerArrowTip${i}`, {
                height: 0.06,
                diameterTop: 0.0,
                diameterBottom: 0.04,
                tessellation: 3
            }, scene);
            makeFlatShaded(tip);
            tip.parent = arrow;
            tip.position = new Vector3(0, 0.22, 0);
            tip.material = createLowPolyMaterial(`rangerArrowTipMat${i}`, arrowHead, scene);
        }

        // --- Legs: slender, leather-booted ---
        this.rangerLeftLeg = MeshBuilder.CreateBox('rangerLeftLeg', {
            width: 0.26,
            height: 0.95,
            depth: 0.26
        }, scene);
        makeFlatShaded(this.rangerLeftLeg);
        this.rangerLeftLeg.parent = this.mesh;
        this.rangerLeftLeg.position = new Vector3(-0.20, -1.10, 0);
        this.rangerLeftLeg.material = createLowPolyMaterial('rangerLeftLegMat', midGreen, scene);

        this.rangerRightLeg = MeshBuilder.CreateBox('rangerRightLeg', {
            width: 0.26,
            height: 0.95,
            depth: 0.26
        }, scene);
        makeFlatShaded(this.rangerRightLeg);
        this.rangerRightLeg.parent = this.mesh;
        this.rangerRightLeg.position = new Vector3(0.20, -1.10, 0);
        this.rangerRightLeg.material = createLowPolyMaterial('rangerRightLegMat', midGreen, scene);

        // Boots (sleek leather, not armored sabatons)
        const bootL = MeshBuilder.CreateBox('rangerBootL', {
            width: 0.28,
            height: 0.18,
            depth: 0.42
        }, scene);
        makeFlatShaded(bootL);
        bootL.parent = this.rangerLeftLeg;
        bootL.position = new Vector3(0, -0.52, 0.06);
        bootL.material = createLowPolyMaterial('rangerBootLMat', darkLeather, scene);

        const bootR = MeshBuilder.CreateBox('rangerBootR', {
            width: 0.28,
            height: 0.18,
            depth: 0.42
        }, scene);
        makeFlatShaded(bootR);
        bootR.parent = this.rangerRightLeg;
        bootR.position = new Vector3(0, -0.52, 0.06);
        bootR.material = createLowPolyMaterial('rangerBootRMat', darkLeather, scene);

        // Alias the leg refs so the generic update() method can animate them
        this.leftLeg  = this.rangerLeftLeg;
        this.rightLeg = this.rangerRightLeg;

        this.originalScale = 1.0;
    }

    // =========================================================================
    // MAGE — robed caster with staff, pointed hat, glowing orb
    // =========================================================================
    private createMageMesh(): void {
        const scene = this.scene;

        // Mage palette
        const robeDark   = new Color3(0.12, 0.10, 0.30); // deep indigo robe
        const robeMid    = new Color3(0.18, 0.15, 0.45); // mid indigo
        const robeTrim   = new Color3(0.70, 0.58, 0.20); // gold trim
        const staffBrown = new Color3(0.40, 0.28, 0.12); // dark oak staff
        const orbColor   = new Color3(0.35, 0.80, 1.0);  // bright cyan orb
        const hatColor   = new Color3(0.10, 0.08, 0.28); // very dark hat
        const skinTone   = new Color3(0.85, 0.72, 0.58); // mage face

        // --- Robe body: tall cone tapering downward (covers legs fully) ---
        // We use a wide box for the upper robe + cone skirt for the lower
        this.mesh = MeshBuilder.CreateBox('mageBody', {
            width: 1.0,
            height: 1.70,
            depth: 0.75
        }, scene);
        makeFlatShaded(this.mesh);
        this.mesh.position = this.position.clone();
        this.mesh.position.y += 2.0;
        this.mesh.material = createLowPolyMaterial('mageBodyMat', robeMid, scene);

        // Robe lower skirt (cone narrows to ground)
        const robeSkirt = MeshBuilder.CreateCylinder('mageRobeSkirt', {
            height: 1.0,
            diameterTop: 0.90,
            diameterBottom: 0.30,
            tessellation: 6
        }, scene);
        makeFlatShaded(robeSkirt);
        robeSkirt.parent = this.mesh;
        robeSkirt.position = new Vector3(0, -1.28, 0);
        robeSkirt.material = createLowPolyMaterial('mageSkirtMat', robeDark, scene);

        // Gold trim at robe collar
        const collar = MeshBuilder.CreateTorus('mageCollar', {
            diameter: 0.70,
            thickness: 0.06,
            tessellation: 8
        }, scene);
        makeFlatShaded(collar);
        collar.parent = this.mesh;
        collar.position = new Vector3(0, 0.78, 0);
        collar.material = createEmissiveMaterial('mageCollarMat', robeTrim, 0.4, scene);

        // Gold trim at robe hem (bottom of upper robe)
        const hemTrim = MeshBuilder.CreateBox('mageHemTrim', {
            width: 1.05,
            height: 0.07,
            depth: 0.80
        }, scene);
        makeFlatShaded(hemTrim);
        hemTrim.parent = this.mesh;
        hemTrim.position = new Vector3(0, -0.88, 0);
        hemTrim.material = createEmissiveMaterial('mageHemTrimMat', robeTrim, 0.35, scene);

        // Rune symbols on robe front (3 small glowing boxes)
        const runeYPositions = [0.35, 0.0, -0.35];
        for (let i = 0; i < runeYPositions.length; i++) {
            const rune = MeshBuilder.CreateBox(`mageRune${i}`, {
                width: 0.08,
                height: 0.06,
                depth: 0.04
            }, scene);
            makeFlatShaded(rune);
            rune.parent = this.mesh;
            rune.position = new Vector3(0, runeYPositions[i], 0.40);
            rune.material = createEmissiveMaterial(`mageRuneMat${i}`, orbColor, 0.7, scene);
        }

        // --- Head: face sphere + pointed wizard hat ---
        this.head = MeshBuilder.CreateSphere('mageHead', {
            diameter: 0.52,
            segments: 5
        }, scene);
        makeFlatShaded(this.head);
        this.head.parent = this.mesh;
        this.head.position = new Vector3(0, 1.05, 0.04);
        this.head.material = createLowPolyMaterial('mageHeadMat', skinTone, scene);

        // Glowing eyes
        for (let side = -1; side <= 1; side += 2) {
            const eye = MeshBuilder.CreateBox(`mageEye${side}`, {
                width: 0.07,
                height: 0.05,
                depth: 0.04
            }, scene);
            makeFlatShaded(eye);
            eye.parent = this.head;
            eye.position = new Vector3(side * 0.10, 0.05, 0.26);
            eye.material = createEmissiveMaterial(`mageEyeMat${side}`, orbColor, 1.0, scene);
        }

        // Wizard hat brim (flat torus/disc)
        const hatBrim = MeshBuilder.CreateCylinder('mageHatBrim', {
            height: 0.06,
            diameterTop: 0.80,
            diameterBottom: 0.80,
            tessellation: 8
        }, scene);
        makeFlatShaded(hatBrim);
        hatBrim.parent = this.head;
        hatBrim.position = new Vector3(0, 0.16, 0);
        hatBrim.material = createLowPolyMaterial('mageHatBrimMat', hatColor, scene);

        // Brim gold trim
        const brimTrim = MeshBuilder.CreateTorus('mageHatBrimTrim', {
            diameter: 0.68,
            thickness: 0.04,
            tessellation: 8
        }, scene);
        makeFlatShaded(brimTrim);
        brimTrim.parent = hatBrim;
        brimTrim.position = new Vector3(0, 0, 0);
        brimTrim.material = createEmissiveMaterial('mageHatBrimTrimMat', robeTrim, 0.5, scene);

        // Wizard hat cone (tall pointed top)
        const hatCone = MeshBuilder.CreateCylinder('mageHatCone', {
            height: 0.75,
            diameterTop: 0.02,
            diameterBottom: 0.48,
            tessellation: 6
        }, scene);
        makeFlatShaded(hatCone);
        hatCone.parent = this.head;
        hatCone.position = new Vector3(0, 0.55, -0.03);
        hatCone.rotation.x = 0.12; // slight backward tilt
        hatCone.material = createLowPolyMaterial('mageHatConeMat', hatColor, scene);

        // Hat star ornament near tip
        const hatStar = MeshBuilder.CreatePolyhedron('mageHatStar', {
            type: 1, // octahedron
            size: 0.055
        }, scene);
        makeFlatShaded(hatStar);
        hatStar.parent = hatCone;
        hatStar.position = new Vector3(0, 0.30, 0);
        hatStar.material = createEmissiveMaterial('mageHatStarMat', orbColor, 0.8, scene);

        // --- Arms / sleeves (wide robe sleeves) ---
        this.swordArm = MeshBuilder.CreateBox('mageRightSleeve', {
            width: 0.28,
            height: 1.10,
            depth: 0.28
        }, scene);
        makeFlatShaded(this.swordArm);
        this.swordArm.parent = this.mesh;
        this.swordArm.position = new Vector3(0.65, 0.0, 0.0);
        this.swordArm.material = createLowPolyMaterial('mageRSleevedMat', robeMid, scene);

        // Sleeve trim (gold cuff)
        const rCuff = MeshBuilder.CreateBox('mageRCuff', {
            width: 0.34,
            height: 0.10,
            depth: 0.34
        }, scene);
        makeFlatShaded(rCuff);
        rCuff.parent = this.swordArm;
        rCuff.position = new Vector3(0, -0.52, 0);
        rCuff.material = createEmissiveMaterial('mageRCuffMat', robeTrim, 0.4, scene);

        this.shieldArm = MeshBuilder.CreateBox('mageLeftSleeve', {
            width: 0.28,
            height: 1.10,
            depth: 0.28
        }, scene);
        makeFlatShaded(this.shieldArm);
        this.shieldArm.parent = this.mesh;
        this.shieldArm.position = new Vector3(-0.65, 0.0, 0.0);
        this.shieldArm.material = createLowPolyMaterial('mageLSleevedMat', robeMid, scene);

        // Left sleeve trim
        const lCuff = MeshBuilder.CreateBox('mageLCuff', {
            width: 0.34,
            height: 0.10,
            depth: 0.34
        }, scene);
        makeFlatShaded(lCuff);
        lCuff.parent = this.shieldArm;
        lCuff.position = new Vector3(0, -0.52, 0);
        lCuff.material = createEmissiveMaterial('mageLCuffMat', robeTrim, 0.4, scene);

        // --- Staff held in right hand ---
        const staff = MeshBuilder.CreateCylinder('mageStaff', {
            height: 2.20,
            diameterTop: 0.055,
            diameterBottom: 0.07,
            tessellation: 6
        }, scene);
        makeFlatShaded(staff);
        staff.parent = this.swordArm;
        staff.position = new Vector3(0.12, -0.45, 0.18);
        staff.rotation.z = 0.08;
        staff.material = createLowPolyMaterial('mageStaffMat', staffBrown, scene);

        // Staff binding rings (decorative)
        const ringYPositions = [0.3, -0.3];
        for (let i = 0; i < ringYPositions.length; i++) {
            const ring = MeshBuilder.CreateTorus(`mageStaffRing${i}`, {
                diameter: 0.11,
                thickness: 0.025,
                tessellation: 6
            }, scene);
            makeFlatShaded(ring);
            ring.parent = staff;
            ring.position = new Vector3(0, ringYPositions[i], 0);
            ring.material = createEmissiveMaterial(`mageStaffRingMat${i}`, robeTrim, 0.5, scene);
        }

        // Staff orb cradle (4 curved prongs holding the orb)
        for (let i = 0; i < 4; i++) {
            const angle = (i / 4) * Math.PI * 2;
            const prong = MeshBuilder.CreateCylinder(`mageStaffProng${i}`, {
                height: 0.20,
                diameterTop: 0.02,
                diameterBottom: 0.04,
                tessellation: 3
            }, scene);
            makeFlatShaded(prong);
            prong.parent = staff;
            prong.position = new Vector3(
                Math.cos(angle) * 0.065,
                1.05,
                Math.sin(angle) * 0.065
            );
            prong.rotation.z = Math.cos(angle) * 0.5;
            prong.rotation.x = Math.sin(angle) * 0.5;
            prong.material = createEmissiveMaterial(`mageStaffProngMat${i}`, robeTrim, 0.5, scene);
        }

        // Glowing orb at staff tip (emissive — this is the animated piece)
        this.mageStaffOrb = MeshBuilder.CreateSphere('mageStaffOrb', {
            diameter: 0.22,
            segments: 5
        }, scene);
        makeFlatShaded(this.mageStaffOrb);
        this.mageStaffOrb.parent = staff;
        this.mageStaffOrb.position = new Vector3(0, 1.14, 0);

        // Create a mutable material we can animate
        this.mageOrbMat = new StandardMaterial('mageOrbMat', scene);
        this.mageOrbMat.emissiveColor = orbColor.clone();
        this.mageOrbMat.diffuseColor = orbColor.scale(0.3);
        this.mageOrbMat.specularColor = new Color3(1, 1, 1);
        this.mageStaffOrb.material = this.mageOrbMat;

        // Outer orb glow ring
        const orbGlowRing = MeshBuilder.CreateTorus('mageOrbGlow', {
            diameter: 0.32,
            thickness: 0.04,
            tessellation: 8
        }, scene);
        makeFlatShaded(orbGlowRing);
        orbGlowRing.parent = this.mageStaffOrb;
        orbGlowRing.position = new Vector3(0, 0, 0);
        orbGlowRing.material = createEmissiveMaterial('mageOrbGlowMat', orbColor, 0.6, scene);

        // No visible legs (covered by robe skirt)
        // leftLeg / rightLeg stay null — the update() will skip them
        this.leftLeg  = null;
        this.rightLeg = null;

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
        this.lastDeltaTime = deltaTime;
        if (!this.alive || !this.mesh) return false;

        // Player-controlled mode: bypass all AI, apply velocity directly
        if (this.controlMode === 'player') {
            this.position.addInPlace(this.playerVelocity.scale(deltaTime));
            this.mesh.position.x = this.position.x;
            this.mesh.position.z = this.position.z;
            this.mesh.position.y = this.position.y + 2.0;

            // Decrement spin-attack timer
            if (this.spinAttackTimer > 0) {
                this.spinAttackTimer = Math.max(0, this.spinAttackTimer - deltaTime);
            }

            // Walking animation — advance walkTime while moving, animate limbs
            const isMoving = this.playerVelocity.lengthSquared() > 0.001;
            if (isMoving) {
                this.walkTime += deltaTime * 5; // stride pace for player-controlled
            }
            if (this.championType === 'mage') {
                this.animateMage(deltaTime);
            } else if (this.championType === 'ranger' || isMoving || this.spinAttackTimer > 0) {
                this.animateHumanoid();
            }

            // Facing: spin override > movement direction > idle
            if (this.spinAttackTimer > 0) {
                // Spin fast: full 360° rotation over SPIN_ATTACK_DURATION
                const progress = 1 - this.spinAttackTimer / Champion.SPIN_ATTACK_DURATION;
                this.mesh.rotation.y = progress * Math.PI * 2;
            } else if (isMoving) {
                this.mesh.rotation.y = Math.atan2(this.playerVelocity.x, this.playerVelocity.z);
            }

            // Mage orb pulse regardless of movement state
            if (this.championType === 'mage') {
                this.pulseMageOrb(deltaTime);
            }

            // Tick + cleanup barbarian spin FX
            if (this.championType === 'barbarian') {
                this.tickBarbSpinFx(deltaTime);
            }

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

            if (this.championType === 'mage') {
                this.animateMage(deltaTime);
            } else {
                this.animateHumanoid();
            }

            // Face direction of movement (shared by all types)
            if (this.currentPathIndex < this.path.length) {
                const targetPoint = this.path[this.currentPathIndex];
                const direction = targetPoint.subtract(this.position);
                if (direction.length() > 0.01) {
                    const angle = Math.atan2(direction.z, direction.x);
                    this.mesh.rotation.y = -angle + Math.PI / 2;
                }
            }
        }

        // Mage orb pulse regardless of movement state
        if (this.championType === 'mage') {
            this.pulseMageOrb(deltaTime);
        }

        // Tick + cleanup barbarian spin FX
        if (this.championType === 'barbarian') {
            this.tickBarbSpinFx(deltaTime);
        }

        return reachedEnd;
    }

    /** Knight / Ranger shared humanoid walk animation */
    private animateHumanoid(): void {
        const spinning = this.spinAttackTimer > 0;

        // Body: bob up/down + slight side-to-side weight shift (more pronounced for heavy knight)
        const bobAmount = Math.abs(Math.sin(this.walkTime)) * 0.09;
        this.mesh!.position.y = this.position.y + 2.0 + bobAmount;
        const rollAmp = this.championType === 'barbarian' ? 0.12 : 0.08;
        this.mesh!.rotation.z = Math.sin(this.walkTime) * rollAmp; // Torso lean side-to-side

        // Legs: alternating stride (bigger swing for confident knight gait)
        if (this.leftLeg && this.rightLeg) {
            const stride = spinning ? 0.15 : 0.6;
            this.leftLeg.rotation.x  = Math.sin(this.walkTime) * stride;
            this.rightLeg.rotation.x = Math.sin(this.walkTime + Math.PI) * stride;
        }

        // Sword arm: hold straight out during spin attack, normal swing otherwise
        if (this.swordArm) {
            if (spinning) {
                // Extended out to the side, blade horizontal — wide arc
                this.swordArm.rotation.x = 0;
                this.swordArm.rotation.z = -Math.PI / 2;
            } else if (this.attackTimer > this.attackCooldown - 0.3) {
                this.swordArm.rotation.x = -Math.PI / 2.5;
                this.swordArm.rotation.z = -Math.PI / 8;
            } else {
                const swingAmp = this.championType === 'barbarian' ? 0.65 : 0.50;
                this.swordArm.rotation.x = Math.sin(this.walkTime) * swingAmp;
                this.swordArm.rotation.z = -0.08;
            }
        }

        // Shield arm: braced inward during spin, normal counter-sway otherwise
        if (this.shieldArm) {
            if (spinning) {
                this.shieldArm.rotation.x = -0.3;
                this.shieldArm.rotation.z = Math.PI / 6;
            } else if (this.attackTimer > this.attackCooldown - 0.3) {
                this.shieldArm.rotation.x = -0.2;
            } else {
                this.shieldArm.rotation.x = Math.sin(this.walkTime + Math.PI) * 0.25;
                this.shieldArm.rotation.z = (this.championType === 'barbarian' ? 0.15 : -0.15)
                    + Math.sin(this.walkTime * 0.7) * 0.04;
            }
        }

        // Head: slow look-around
        if (this.head) {
            this.head.rotation.y = Math.sin(this.walkTime * 0.6) * 0.12;
            this.head.rotation.x = Math.sin(this.walkTime * 0.4) * 0.04;
        }

        // Cape (knight only)
        if (this.cape) {
            this.cape.rotation.x = Math.sin(this.walkTime * 0.8) * 0.08 + 0.04;
        }

        // Ranger bow / quiver sway
        if (this.rangerBow) {
            this.rangerBow.rotation.z = 0.35 + Math.sin(this.walkTime * 0.8) * 0.04;
        }
        if (this.rangerQuiver) {
            this.rangerQuiver.rotation.z = 0.15 + Math.sin(this.walkTime * 0.8) * 0.03;
        }

        // Barbarian-specific extras layered on top of the shared humanoid pose
        if (this.championType === 'barbarian') {
            this.animateBarbarianExtras(this.lastDeltaTime);
        }
    }

    /** Mage-specific: bob the whole body, no visible legs, orb pulsing handled separately */
    private animateMage(_deltaTime: number): void {
        // Bob the robe body (gliding motion, no leg stride)
        const bobAmount = Math.abs(Math.sin(this.walkTime * 0.8)) * 0.06;
        this.mesh!.position.y = this.position.y + 2.0 + bobAmount;
        this.mesh!.rotation.z = Math.sin(this.walkTime * 0.5) * 0.02;

        // Staff arm sways slightly
        if (this.swordArm) {
            this.swordArm.rotation.x = Math.sin(this.walkTime * 0.6) * 0.12;
        }

        // Non-staff arm gentle drift
        if (this.shieldArm) {
            this.shieldArm.rotation.x = Math.sin(this.walkTime * 0.6 + Math.PI) * 0.10;
        }

        // Head turns slowly
        if (this.head) {
            this.head.rotation.y = Math.sin(this.walkTime * 0.4) * 0.15;
        }
    }

    /** Barbarian-only: breath pulse, hunched stride, kilt sway, trophy wobble, snarl twitch. */
    private animateBarbarianExtras(deltaTime: number): void {
        const spinning = this.spinAttackTimer > 0;
        const attacking = this.attackTimer > this.attackCooldown - 0.3;

        // 1. Breath pulse — always on, even during spin/attack
        if (this.barbChestPulseGroup) {
            this.barbChestPulseGroup.scaling.y = 1 + Math.sin(this.walkTime * 0.4) * 0.04;
        }

        // 2. Hunched stride lean — don't fight existing pose during spin/attack
        if (!spinning && !attacking && this.mesh) {
            this.mesh.rotation.x = 0.05 + Math.sin(this.walkTime * 0.5) * 0.02;
        } else if (this.mesh) {
            this.mesh.rotation.x = 0;
        }

        // 3. Kilt flap sloshing — phase offset creates a wave around the waist
        for (let i = 0; i < this.barbKiltFlaps.length; i++) {
            this.barbKiltFlaps[i].rotation.x = Math.sin(this.walkTime + i * 0.3) * 0.15;
        }

        // 4. Belt trophy wobble — impacts with each step
        if (this.barbBeltTrophy) {
            this.barbBeltTrophy.rotation.x = Math.sin(this.walkTime * 2) * 0.20;
            this.barbBeltTrophy.rotation.z = Math.sin(this.walkTime * 1.5) * 0.10;
        }

        // 5. Snarl twitch — random fast jaw flick every 2-5s
        this.barbSnarlTimer -= deltaTime;
        if (this.barbSnarlTimer <= 0) {
            this.barbSnarlActive = 0.15;
            this.barbSnarlTimer = 2 + Math.random() * 3;
        }
        if (this.barbSnarlJaw) {
            if (this.barbSnarlActive > 0) {
                this.barbSnarlActive -= deltaTime;
                const t = Math.max(0, this.barbSnarlActive) / 0.15;
                this.barbSnarlJaw.rotation.x = -0.3 * Math.sin(t * Math.PI);
            } else {
                this.barbSnarlJaw.rotation.x = 0;
            }
        }

        // 6. Heavy footstep dust — emit when the stride phase crosses zero,
        //    using which foot is "planted" (sign of sin(walkTime)).
        const stepSign = Math.sign(Math.sin(this.walkTime));
        if (stepSign !== 0 && stepSign !== this.barbLastStepSign) {
            // Use the leg whose phase matches the new sign as the foot position.
            const foot = stepSign > 0 ? this.rightLeg : this.leftLeg;
            if (foot && this.mesh) {
                const footWorld = foot.getAbsolutePosition().clone();
                footWorld.y = 0.05;
                this.spawnFootstepDust(footWorld);
            }
            this.barbLastStepSign = stepSign;
        }
    }

    /** Barbarian-only: small brown dust burst at a foot's world position. */
    private spawnFootstepDust(worldPos: Vector3): void {
        const ps = new ParticleSystem('barbFootDust', 8, this.scene);
        ps.emitter = worldPos;
        ps.minEmitBox = new Vector3(-0.10, 0, -0.10);
        ps.maxEmitBox = new Vector3(0.10, 0, 0.10);
        ps.color1 = new Color4(0.50, 0.35, 0.20, 1);
        ps.color2 = new Color4(0.35, 0.25, 0.15, 1);
        ps.colorDead = new Color4(0.25, 0.20, 0.15, 0);
        ps.minSize = 0.08;
        ps.maxSize = 0.18;
        ps.minLifeTime = 0.2;
        ps.maxLifeTime = 0.4;
        ps.emitRate = 80;
        ps.manualEmitCount = 8; // one-shot
        ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
        ps.direction1 = new Vector3(-0.5, 0.4, -0.5);
        ps.direction2 = new Vector3(0.5, 0.8, 0.5);
        ps.minEmitPower = 0.4;
        ps.maxEmitPower = 1.2;
        ps.gravity = new Vector3(0, -0.5, 0);
        ps.start();
        setTimeout(() => { ps.stop(); setTimeout(() => ps.dispose(), 500); }, 100);
    }

    /** Barbarian-only: small red splatter at a target position on basic-attack hit. */
    private spawnBloodSplatter(targetPos: Vector3): void {
        const splatPos = targetPos.clone();
        splatPos.y += 0.8;
        const ps = new ParticleSystem('barbBloodSplatter', 10, this.scene);
        ps.emitter = splatPos;
        ps.minEmitBox = new Vector3(-0.10, 0, -0.10);
        ps.maxEmitBox = new Vector3(0.10, 0, 0.10);
        ps.color1 = new Color4(0.70, 0.10, 0.05, 1);
        ps.color2 = new Color4(0.45, 0.05, 0.02, 1);
        ps.colorDead = new Color4(0.10, 0, 0, 0);
        ps.minSize = 0.08;
        ps.maxSize = 0.16;
        ps.minLifeTime = 0.25;
        ps.maxLifeTime = 0.5;
        ps.emitRate = 40;
        ps.manualEmitCount = 10; // one-shot
        ps.blendMode = ParticleSystem.BLENDMODE_ONEONE;
        ps.direction1 = new Vector3(-1, 0.3, -1);
        ps.direction2 = new Vector3(1, 1, 1);
        ps.minEmitPower = 1;
        ps.maxEmitPower = 2.5;
        ps.gravity = new Vector3(0, -4, 0);
        ps.start();
        setTimeout(() => { ps.stop(); setTimeout(() => ps.dispose(), 500); }, 100);
    }

    /** Barbarian-only: animate the spin arc ring (scale out + fade) and tear down FX when done. */
    private tickBarbSpinFx(deltaTime: number): void {
        // Ring scale-out + fade
        if (this.barbSpinArcMesh) {
            this.barbSpinArcTimer -= deltaTime;
            const t = 1 - Math.max(0, this.barbSpinArcTimer) / Champion.SPIN_ATTACK_DURATION;
            const scaleXZ = 0.3 + t * 1.2; // 0.3 -> 1.5
            this.barbSpinArcMesh.scaling.x = scaleXZ;
            this.barbSpinArcMesh.scaling.z = scaleXZ;
            // Keep the ring under the hero's current world position
            this.barbSpinArcMesh.position.x = this.position.x;
            this.barbSpinArcMesh.position.z = this.position.z;
            // Fade by lowering emissive intensity over time
            const mat = this.barbSpinArcMesh.material as StandardMaterial | null;
            if (mat) {
                const intensity = 0.9 * (1 - t);
                mat.emissiveColor = new Color3(0.8 * (1 - t * 0.5), 0.10, 0.05).scale(intensity);
                mat.alpha = 1 - t;
            }
            if (this.barbSpinArcTimer <= 0) {
                this.barbSpinArcMesh.dispose();
                this.barbSpinArcMesh = null;
            }
        }

        // Stop the blood trail when the spin ends
        if (this.barbSpinBloodPs && this.spinAttackTimer <= 0) {
            this.barbSpinBloodPs.stop();
            const ps = this.barbSpinBloodPs;
            this.barbSpinBloodPs = null;
            setTimeout(() => ps.dispose(), 400);
        }
    }

    /** Pulse the mage staff orb emissive intensity over time */
    private pulseMageOrb(_deltaTime: number): void {
        if (!this.mageOrbMat) return;
        const pulse = 0.7 + Math.sin(this.walkTime * 2.5) * 0.3;
        this.mageOrbMat.emissiveColor = new Color3(
            0.35 * pulse,
            0.80 * pulse,
            1.0  * pulse,
        );
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

        // Visual: sword swing flash (shared)
        this.createAttackEffect(target.getPosition());

        // Barbarian-only blood splatter on the target
        if (this.championType === 'barbarian') {
            this.spawnBloodSplatter(target.getPosition());
        }
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

        // Barbarian spin FX cleanup
        if (this.barbSpinBloodPs) {
            this.barbSpinBloodPs.stop();
            this.barbSpinBloodPs.dispose();
            this.barbSpinBloodPs = null;
        }
        if (this.barbSpinArcMesh) {
            this.barbSpinArcMesh.dispose();
            this.barbSpinArcMesh = null;
        }
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

    // =========================================================================
    // ELEMENT VISUAL DECORATIONS
    // =========================================================================

    /**
     * Show/hide per-element decoration meshes on the weapon anchor.
     * Call once per frame with the set of active power elements.
     */
    public updateElementVisuals(activeElements: Set<string>): void {
        if (!this.mesh) return;
        const anchor = this.getWeaponAnchor();
        if (!anchor) return;

        const allElements = ['fire', 'ice', 'arcane', 'physical', 'storm'];
        for (const element of allElements) {
            const shouldShow = activeElements.has(element);
            let meshes = this.elementDecorations.get(element);
            if (shouldShow && !meshes) {
                meshes = this.createElementDecoration(element, anchor);
                this.elementDecorations.set(element, meshes);
            }
            if (meshes) {
                for (const m of meshes) m.setEnabled(shouldShow);
            }
        }
    }

    private getWeaponAnchor(): Mesh | null {
        switch (this.championType) {
            case 'barbarian': return this.barbAxeHead ?? this.swordArm;
            case 'ranger':    return this.rangerBow ?? this.swordArm;
            case 'mage':      return this.mageStaffOrb ?? this.swordArm;
        }
        return null;
    }

    private createElementDecoration(element: string, anchor: Mesh): Mesh[] {
        const meshes: Mesh[] = [];
        const scene = this.scene;
        switch (element) {
            case 'fire': {
                // 3 small flame cones arranged around the weapon
                for (let i = 0; i < 3; i++) {
                    const flame = MeshBuilder.CreateCylinder(`heroFire_${i}_${this.championType}`, {
                        height: 0.35, diameterTop: 0, diameterBottom: 0.18, tessellation: 6,
                    }, scene);
                    flame.material = createEmissiveMaterial(`heroFireMat_${i}_${this.championType}`,
                        new Color3(1.0, 0.45, 0.05), 0.9, scene);
                    flame.parent = anchor;
                    const angle = (i / 3) * Math.PI * 2;
                    flame.position = new Vector3(Math.cos(angle) * 0.25, 0.3, Math.sin(angle) * 0.25);
                    makeFlatShaded(flame);
                    meshes.push(flame);
                }
                break;
            }
            case 'ice': {
                // 3 cyan crystal shards
                for (let i = 0; i < 3; i++) {
                    const crystal = MeshBuilder.CreatePolyhedron(`heroIce_${i}_${this.championType}`,
                        { type: 1, size: 0.10 }, scene);
                    crystal.material = createEmissiveMaterial(`heroIceMat_${i}_${this.championType}`,
                        new Color3(0.4, 0.85, 1.0), 0.6, scene);
                    crystal.parent = anchor;
                    const angle = (i / 3) * Math.PI * 2 + 0.5;
                    crystal.position = new Vector3(Math.cos(angle) * 0.30, 0.1, Math.sin(angle) * 0.30);
                    crystal.scaling.y = 1.5;
                    makeFlatShaded(crystal);
                    meshes.push(crystal);
                }
                break;
            }
            case 'arcane': {
                // 2 purple orbs hovering near the weapon
                for (let i = 0; i < 2; i++) {
                    const orb = MeshBuilder.CreateSphere(`heroArcane_${i}_${this.championType}`,
                        { diameter: 0.14, segments: 4 }, scene);
                    orb.material = createEmissiveMaterial(`heroArcaneMat_${i}_${this.championType}`,
                        new Color3(0.7, 0.3, 1.0), 0.8, scene);
                    orb.parent = anchor;
                    orb.position = new Vector3(i === 0 ? 0.35 : -0.35, 0.45, 0);
                    meshes.push(orb);
                }
                break;
            }
            case 'physical': {
                // 4 small white sparkle polyhedra
                for (let i = 0; i < 4; i++) {
                    const sparkle = MeshBuilder.CreatePolyhedron(`heroPhys_${i}_${this.championType}`,
                        { type: 0, size: 0.06 }, scene);
                    sparkle.material = createEmissiveMaterial(`heroPhysMat_${i}_${this.championType}`,
                        new Color3(0.95, 0.95, 1.0), 0.7, scene);
                    sparkle.parent = anchor;
                    const angle = (i / 4) * Math.PI * 2;
                    sparkle.position = new Vector3(Math.cos(angle) * 0.40, 0.25, Math.sin(angle) * 0.40);
                    makeFlatShaded(sparkle);
                    meshes.push(sparkle);
                }
                break;
            }
            case 'storm': {
                // 3 yellow zigzag bolt boxes
                for (let i = 0; i < 3; i++) {
                    const bolt = MeshBuilder.CreateBox(`heroStorm_${i}_${this.championType}`,
                        { width: 0.03, height: 0.4, depth: 0.03 }, scene);
                    bolt.material = createEmissiveMaterial(`heroStormMat_${i}_${this.championType}`,
                        new Color3(1.0, 0.95, 0.4), 0.9, scene);
                    bolt.parent = anchor;
                    const angle = (i / 3) * Math.PI * 2;
                    bolt.position = new Vector3(Math.cos(angle) * 0.30, 0.35, Math.sin(angle) * 0.30);
                    bolt.rotation.z = 0.4;
                    meshes.push(bolt);
                }
                break;
            }
        }
        return meshes;
    }
}
