import { Vector3, MeshBuilder, StandardMaterial, Color3, Mesh, Color4 } from '@babylonjs/core';
import { Game } from '../../engine/Game';
import { Enemy } from './Enemy';
import { createLowPolyMaterial, createEmissiveMaterial, makeFlatShaded } from '../../engine/rendering/LowPolyMaterial';
import { PALETTE } from '../../engine/rendering/StyleConstants';

export class BossEnemy extends Enemy {
    private animationTime: number = 0;
    private head: Mesh | null = null;
    protected leftArm: Mesh | null = null;
    protected rightArm: Mesh | null = null;
    private jaw: Mesh | null = null;
    private crystals: Mesh[] = [];
    private leftLeg: Mesh | null = null;
    private rightLeg: Mesh | null = null;

    // Boss special visuals
    private orbitingWisps: Mesh[] = [];

    constructor(game: Game, position: Vector3, path: Vector3[]) {
        // Boss enemy has very low speed, extremely high health, high damage, and very high reward
        super(game, position, path, 0.7, 500, 50, 150);

        // Add innate damage resistance for bosses (15%, reduced from 20%)
        this.damageResistance = 0.15;
        this.contactDamagePerSecond = 30;

        // Melee-swing tuning — reach is ~2.8u so the strike lands when the hero is
        // just outside body contact. Arm-raise + slam animation acts as the
        // telegraph (see onMeleeAttackPhase below); no ground disc needed.
        this.meleeRange            = 2.8;
        this.meleeHitRange         = 3.2;
        this.meleeHitDamage        = 35;
        this.meleeWindupDuration   = 0.5;
        this.meleeStrikeDuration   = 0.18;
        this.meleeCooldownDuration = 0.85;

        // Boss-tier HP bar: 2.5× wide, segmented, red glowing frame, name label
        // anchored above the horns.
        this.applyHealthBarTier('boss', { heightOffset: 3.6, label: 'Abyssal Titan' });

        // Build mesh + health bar AFTER field initializers have run (see Enemy
        // constructor note). new.target guard → only when BossEnemy is the leaf;
        // for `new MilestoneBoss()` the guard is false here and MilestoneBoss's
        // own constructor performs the build (after ITS fields have initialized).
        if (new.target === BossEnemy) this._initEnemyVisuals();
    }

    /**
     * Create the enemy mesh - low-poly Abyssal Titan
     * Towering demonic figure: massive horned skull head, hunched broad shoulders,
     * crystal growths erupting from back/shoulders, huge clawed arms, thick pillar legs,
     * glowing magenta core visible through chest cavity, dark energy trailing
     */
    protected createMesh(): void {
        this.crystals = [];

        // --- Main body: tall broad torso (hunched) ---
        this.mesh = MeshBuilder.CreateBox('bossBody', {
            width: 1.60,
            height: 2.20,
            depth: 1.10
        }, this.scene);
        makeFlatShaded(this.mesh);
        this.mesh.position = this.position.clone();
        this.mesh.position.y += 1.2;
        this.mesh.material = createLowPolyMaterial('bossBodyMat', PALETTE.ENEMY_BOSS, this.scene);

        // --- Chest cavity glow: emissive box visible in the front ---
        const chestCore = MeshBuilder.CreateBox('bossChestCore', {
            width: 0.40,
            height: 0.50,
            depth: 0.08
        }, this.scene);
        makeFlatShaded(chestCore);
        chestCore.parent = this.mesh;
        chestCore.position = new Vector3(0, 0.10, 0.56);
        chestCore.material = createEmissiveMaterial('bossChestCoreMat', PALETTE.ENEMY_BOSS_FIRE, 1.5, this.scene);

        // --- Ribcage lines: 3 thin horizontal boxes across chest ---
        for (let i = 0; i < 3; i++) {
            const rib = MeshBuilder.CreateBox(`bossRib${i}`, {
                width: 0.55,
                height: 0.04,
                depth: 0.06
            }, this.scene);
            makeFlatShaded(rib);
            rib.parent = this.mesh;
            rib.position = new Vector3(0, 0.30 - i * 0.20, 0.56);
            rib.material = createLowPolyMaterial(`bossRibMat${i}`, PALETTE.ENEMY_BOSS_BONE, this.scene);
        }

        // --- Shoulder pauldrons: large polyhedra on each shoulder ---
        const leftPauldron = MeshBuilder.CreatePolyhedron('bossLeftPauldron', {
            type: 2, // Icosahedron
            size: 0.35
        }, this.scene);
        makeFlatShaded(leftPauldron);
        leftPauldron.parent = this.mesh;
        leftPauldron.position = new Vector3(-0.90, 0.85, 0);
        leftPauldron.scaling = new Vector3(0.8, 0.6, 0.8);
        leftPauldron.material = createLowPolyMaterial('bossLeftPauldronMat', PALETTE.ENEMY_BOSS_DARK, this.scene);

        const rightPauldron = MeshBuilder.CreatePolyhedron('bossRightPauldron', {
            type: 2,
            size: 0.35
        }, this.scene);
        makeFlatShaded(rightPauldron);
        rightPauldron.parent = this.mesh;
        rightPauldron.position = new Vector3(0.90, 0.85, 0);
        rightPauldron.scaling = new Vector3(0.8, 0.6, 0.8);
        rightPauldron.material = createLowPolyMaterial('bossRightPauldronMat', PALETTE.ENEMY_BOSS_DARK, this.scene);

        // --- Crystal growths: erupting from shoulders and back ---
        const crystalConfigs = [
            { pos: new Vector3(-0.85, 1.10, -0.10), rot: new Vector3(-0.2, 0, -0.4), size: 0.18 },
            { pos: new Vector3(-0.70, 1.25, 0.10), rot: new Vector3(0.1, 0.3, -0.6), size: 0.14 },
            { pos: new Vector3(0.85, 1.10, -0.10), rot: new Vector3(-0.2, 0, 0.4), size: 0.18 },
            { pos: new Vector3(0.70, 1.25, 0.10), rot: new Vector3(0.1, -0.3, 0.6), size: 0.14 },
            { pos: new Vector3(0, 0.90, -0.50), rot: new Vector3(-0.5, 0, 0), size: 0.22 },
            { pos: new Vector3(-0.30, 0.80, -0.48), rot: new Vector3(-0.3, 0.2, -0.2), size: 0.15 },
            { pos: new Vector3(0.30, 0.80, -0.48), rot: new Vector3(-0.3, -0.2, 0.2), size: 0.15 },
        ];

        for (let i = 0; i < crystalConfigs.length; i++) {
            const cfg = crystalConfigs[i];
            const crystal = MeshBuilder.CreateCylinder(`bossCrystal${i}`, {
                height: cfg.size * 3.5,
                diameterTop: 0.0,
                diameterBottom: cfg.size * 0.8,
                tessellation: 4
            }, this.scene);
            makeFlatShaded(crystal);
            crystal.parent = this.mesh;
            crystal.position = cfg.pos;
            crystal.rotation = cfg.rot;
            crystal.material = createEmissiveMaterial(`bossCrystalMat${i}`, PALETTE.ENEMY_BOSS_CRYSTAL, 0.7, this.scene);
            this.crystals.push(crystal);
        }

        // --- Head (Skull): composed of a faceted dome + jaw ---
        this.head = MeshBuilder.CreatePolyhedron('bossSkull', {
            type: 2, // Icosahedron for faceted skull
            size: 0.42
        }, this.scene);
        makeFlatShaded(this.head);
        this.head.parent = this.mesh;
        this.head.position = new Vector3(0, 1.45, 0.20);
        this.head.scaling = new Vector3(1.0, 0.80, 1.10);
        this.head.material = createLowPolyMaterial('bossSkullMat', PALETTE.ENEMY_BOSS_BONE, this.scene);

        // --- Jaw: separate hinged box beneath skull ---
        this.jaw = MeshBuilder.CreateBox('bossJaw', {
            width: 0.45,
            height: 0.15,
            depth: 0.40
        }, this.scene);
        makeFlatShaded(this.jaw);
        this.jaw.parent = this.head;
        this.jaw.position = new Vector3(0, -0.30, 0.08);
        this.jaw.material = createLowPolyMaterial('bossJawMat', PALETTE.ENEMY_BOSS_BONE, this.scene);

        // --- Teeth: row of small cones hanging from jaw ---
        for (let i = 0; i < 4; i++) {
            const tooth = MeshBuilder.CreateCylinder(`bossTooth${i}`, {
                height: 0.10,
                diameterTop: 0.04,
                diameterBottom: 0.0,
                tessellation: 3
            }, this.scene);
            makeFlatShaded(tooth);
            tooth.parent = this.jaw;
            tooth.position = new Vector3(-0.12 + i * 0.08, 0.08, 0.18);
            tooth.material = createLowPolyMaterial(`bossToothMat${i}`, PALETTE.ENEMY_BOSS_BONE, this.scene);
        }

        // --- Eyes: large emissive slits ---
        const leftEye = MeshBuilder.CreateBox('bossLeftEye', {
            width: 0.16,
            height: 0.06,
            depth: 0.06
        }, this.scene);
        makeFlatShaded(leftEye);
        leftEye.parent = this.head;
        leftEye.position = new Vector3(-0.18, 0.05, 0.38);
        leftEye.material = createEmissiveMaterial('bossLeftEyeMat', PALETTE.ENEMY_BOSS_FIRE, 1.5, this.scene);

        const rightEye = MeshBuilder.CreateBox('bossRightEye', {
            width: 0.16,
            height: 0.06,
            depth: 0.06
        }, this.scene);
        makeFlatShaded(rightEye);
        rightEye.parent = this.head;
        rightEye.position = new Vector3(0.18, 0.05, 0.38);
        rightEye.material = createEmissiveMaterial('bossRightEyeMat', PALETTE.ENEMY_BOSS_FIRE, 1.5, this.scene);

        // --- Horns: two massive swept-back cones ---
        const leftHorn = MeshBuilder.CreateCylinder('bossLeftHorn', {
            height: 0.80,
            diameterTop: 0.0,
            diameterBottom: 0.18,
            tessellation: 5
        }, this.scene);
        makeFlatShaded(leftHorn);
        leftHorn.parent = this.head;
        leftHorn.position = new Vector3(-0.30, 0.25, -0.10);
        leftHorn.rotation.z = -0.5;
        leftHorn.rotation.x = -0.3;
        leftHorn.material = createLowPolyMaterial('bossLeftHornMat', PALETTE.ENEMY_BOSS_DARK, this.scene);

        const rightHorn = MeshBuilder.CreateCylinder('bossRightHorn', {
            height: 0.80,
            diameterTop: 0.0,
            diameterBottom: 0.18,
            tessellation: 5
        }, this.scene);
        makeFlatShaded(rightHorn);
        rightHorn.parent = this.head;
        rightHorn.position = new Vector3(0.30, 0.25, -0.10);
        rightHorn.rotation.z = 0.5;
        rightHorn.rotation.x = -0.3;
        rightHorn.material = createLowPolyMaterial('bossRightHornMat', PALETTE.ENEMY_BOSS_DARK, this.scene);

        // --- Left Arm: thick, long, with large claw ---
        this.leftArm = MeshBuilder.CreateBox('bossLeftArm', {
            width: 0.35,
            height: 1.80,
            depth: 0.35
        }, this.scene);
        makeFlatShaded(this.leftArm);
        this.leftArm.parent = this.mesh;
        this.leftArm.position = new Vector3(-1.00, 0.15, 0.10);
        this.leftArm.rotation.z = Math.PI / 10;
        this.leftArm.material = createLowPolyMaterial('bossLeftArmMat', PALETTE.ENEMY_BOSS, this.scene);

        // Left Claw: 3 small cones fanning out
        for (let c = 0; c < 3; c++) {
            const claw = MeshBuilder.CreateCylinder(`bossLeftClaw${c}`, {
                height: 0.25,
                diameterTop: 0.0,
                diameterBottom: 0.07,
                tessellation: 3
            }, this.scene);
            makeFlatShaded(claw);
            claw.parent = this.leftArm;
            claw.position = new Vector3(-0.08 + c * 0.08, -1.0, 0.10);
            claw.rotation.x = 0.3;
            claw.rotation.z = (-1 + c) * 0.2;
            claw.material = createLowPolyMaterial(`bossLeftClawMat${c}`, PALETTE.ENEMY_BOSS_BONE, this.scene);
        }

        // --- Right Arm: thick, long, with large claw ---
        this.rightArm = MeshBuilder.CreateBox('bossRightArm', {
            width: 0.35,
            height: 1.80,
            depth: 0.35
        }, this.scene);
        makeFlatShaded(this.rightArm);
        this.rightArm.parent = this.mesh;
        this.rightArm.position = new Vector3(1.00, 0.15, 0.10);
        this.rightArm.rotation.z = -Math.PI / 10;
        this.rightArm.material = createLowPolyMaterial('bossRightArmMat', PALETTE.ENEMY_BOSS, this.scene);

        // Right Claw: 3 small cones fanning out
        for (let c = 0; c < 3; c++) {
            const claw = MeshBuilder.CreateCylinder(`bossRightClaw${c}`, {
                height: 0.25,
                diameterTop: 0.0,
                diameterBottom: 0.07,
                tessellation: 3
            }, this.scene);
            makeFlatShaded(claw);
            claw.parent = this.rightArm;
            claw.position = new Vector3(-0.08 + c * 0.08, -1.0, 0.10);
            claw.rotation.x = 0.3;
            claw.rotation.z = (-1 + c) * 0.2;
            claw.material = createLowPolyMaterial(`bossRightClawMat${c}`, PALETTE.ENEMY_BOSS_BONE, this.scene);
        }

        // --- Left Leg: thick pillar ---
        this.leftLeg = MeshBuilder.CreateBox('bossLeftLeg', {
            width: 0.50,
            height: 1.60,
            depth: 0.50
        }, this.scene);
        makeFlatShaded(this.leftLeg);
        this.leftLeg.parent = this.mesh;
        this.leftLeg.position = new Vector3(-0.48, -1.50, 0);
        this.leftLeg.material = createLowPolyMaterial('bossLeftLegMat', PALETTE.ENEMY_BOSS_DARK, this.scene);

        // Left foot
        const leftFoot = MeshBuilder.CreateBox('bossLeftFoot', {
            width: 0.60,
            height: 0.15,
            depth: 0.65
        }, this.scene);
        makeFlatShaded(leftFoot);
        leftFoot.parent = this.leftLeg;
        leftFoot.position = new Vector3(0, -0.82, 0.10);
        leftFoot.material = createLowPolyMaterial('bossLeftFootMat', PALETTE.ENEMY_BOSS_DARK, this.scene);

        // --- Right Leg: thick pillar ---
        this.rightLeg = MeshBuilder.CreateBox('bossRightLeg', {
            width: 0.50,
            height: 1.60,
            depth: 0.50
        }, this.scene);
        makeFlatShaded(this.rightLeg);
        this.rightLeg.parent = this.mesh;
        this.rightLeg.position = new Vector3(0.48, -1.50, 0);
        this.rightLeg.material = createLowPolyMaterial('bossRightLegMat', PALETTE.ENEMY_BOSS_DARK, this.scene);

        // Right foot
        const rightFoot = MeshBuilder.CreateBox('bossRightFoot', {
            width: 0.60,
            height: 0.15,
            depth: 0.65
        }, this.scene);
        makeFlatShaded(rightFoot);
        rightFoot.parent = this.rightLeg;
        rightFoot.position = new Vector3(0, -0.82, 0.10);
        rightFoot.material = createLowPolyMaterial('bossRightFootMat', PALETTE.ENEMY_BOSS_DARK, this.scene);

        // --- Dark energy trailing wisps: small emissive shapes at the back ---
        for (let w = 0; w < 3; w++) {
            const wisp = MeshBuilder.CreatePolyhedron(`bossWisp${w}`, {
                type: 1, // Octahedron
                size: 0.08 + w * 0.03
            }, this.scene);
            makeFlatShaded(wisp);
            wisp.parent = this.mesh;
            wisp.position = new Vector3(
                (w - 1) * 0.25,
                -0.30 - w * 0.25,
                -0.60
            );
            wisp.material = createEmissiveMaterial(`bossWispMat${w}`, PALETTE.ENEMY_BOSS_CRYSTAL, 0.5, this.scene);
        }

        // --- Ground glow: large red/purple disc at the boss's feet ──────────
        const groundGlow = MeshBuilder.CreateDisc('bossGroundGlow', { radius: 2.0, tessellation: 20 }, this.scene);
        groundGlow.parent = this.mesh;
        groundGlow.rotation.x = Math.PI / 2;
        groundGlow.position = new Vector3(0, -1.22, 0); // near feet
        const groundGlowMat = new StandardMaterial('bossGroundGlowMat', this.scene);
        groundGlowMat.emissiveColor = new Color3(0.55, 0.05, 0.40); // deep magenta
        groundGlowMat.alpha = 0.45;
        groundGlowMat.disableLighting = true;
        groundGlow.material = groundGlowMat;

        // --- Orbiting wisps: 3 small spheres slowly circling the boss ────────
        this.orbitingWisps = [];
        const wispOrbitRadius = 1.1;
        for (let o = 0; o < 3; o++) {
            const orb = MeshBuilder.CreateSphere(`bossOrbit${o}`, { diameter: 0.20, segments: 4 }, this.scene);
            makeFlatShaded(orb);
            // Not parented to mesh — positioned in animateParts via world coords
            const orbMat = new StandardMaterial(`bossOrbitMat${o}`, this.scene);
            orbMat.emissiveColor = PALETTE.ENEMY_BOSS_CRYSTAL;
            orbMat.diffuseColor = PALETTE.ENEMY_BOSS_CRYSTAL;
            orbMat.specularColor = Color3.Black();
            orbMat.alpha = 0.85;
            orb.material = orbMat;
            this.orbitingWisps.push(orb);
        }

        // Store original scale
        this.originalScale = 1.0;
    }


    /**
     * Update the boss enemy
     * @param deltaTime Time elapsed since last update in seconds
     * @returns True if the enemy reached the end of the path
     */
    public update(deltaTime: number): boolean {
        if (!this.alive || !this.mesh) return false;

        // Advance animation time + animate parts
        this.animateProceduralParts(deltaTime);

        // Call parent update method (handles movement, status effects, and the
        // melee-swing state machine — which calls onMeleeAttackPhase below for
        // the boss's overhead claw animation).
        return super.update(deltaTime);
    }

    /** Titan walk pose — advances the animation phase and animates the body,
     *  legs, head, jaw, arms, crystals, and orbiting wisps. Called by update()
     *  every frame and by tickNetworkProceduralAnim on the guest (the guest's
     *  non-milestone boss is always the procedural mesh). */
    protected animateProceduralParts(deltaTime: number): void {
        this.animationTime += deltaTime;
        this.animateParts(deltaTime);
    }

    /** Overrides animateParts' idle arm sway with the swing pose while attacking. */
    protected onMeleeAttackPhase(state: 'windup' | 'strike' | 'cooldown', progress: number): void {
        if (!this.leftArm || !this.rightArm) return;
        const t = Math.max(0, Math.min(1, progress));
        let armX: number;
        switch (state) {
            case 'windup':    armX = -1.6 * t;                break; // 0 → -1.6 rad (overhead)
            case 'strike':    armX = -1.6 + 2.3 * t;          break; // -1.6 → +0.7 rad (slam down)
            case 'cooldown':  armX = 0.7 * (1 - t);           break; // 0.7 → 0 (return)
        }
        this.leftArm.rotation.x = armX!;
        this.rightArm.rotation.x = armX!;
    }


    /**
     * Animate boss parts - menacing, ground-shaking titan walk
     * @param deltaTime Time elapsed since last update
     */
    private animateParts(deltaTime: number): void {
        if (!this.mesh) return;

        const t = this.animationTime;

        // --- Body: slow heavy lumbering motion ---
        // Massive vertical stomp that feels weighty
        const stompCycle = Math.abs(Math.sin(t * 1.5));
        this.mesh.position.y = this.position.y + 1.2 + stompCycle * 0.12;
        // Slight forward hunch that sways
        this.mesh.rotation.x = 0.05 + Math.sin(t * 1.5) * 0.03;
        // Side-to-side weight shift
        this.mesh.rotation.z = Math.sin(t * 0.75) * 0.04;

        // --- Legs: alternating heavy stride ---
        if (this.leftLeg && this.rightLeg) {
            this.leftLeg.rotation.x = Math.sin(t * 1.5) * 0.25;
            this.rightLeg.rotation.x = Math.sin(t * 1.5 + Math.PI) * 0.25;
        }

        // --- Head: menacing scanning and jaw movement ---
        if (this.head) {
            // Normal: slow ominous head movement
            this.head.position.y = 1.45 + Math.sin(t * 1.8) * 0.06;
            this.head.rotation.y = Math.sin(t * 0.6) * 0.18;
            this.head.rotation.x = Math.sin(t * 0.4) * 0.05;
        }

        // --- Jaw: slow breathing open/close ---
        if (this.jaw) {
            this.jaw.rotation.x = Math.max(0, Math.sin(t * 1.2)) * 0.12;
        }

        // --- Arms: heavy swaying ---
        if (this.leftArm && this.rightArm) {
            // Heavy pendulum swing, slightly out of phase
            this.leftArm.rotation.x = Math.sin(t * 1.5 + Math.PI) * 0.20;
            this.rightArm.rotation.x = Math.sin(t * 1.5) * 0.20;
            this.leftArm.rotation.z = Math.PI / 10 + Math.sin(t * 0.8) * 0.05;
            this.rightArm.rotation.z = -Math.PI / 10 - Math.sin(t * 0.8) * 0.05;
        }

        // --- Crystals: slow pulsing glow (via scale) ---
        for (let i = 0; i < this.crystals.length; i++) {
            const crystal = this.crystals[i];
            const pulse = 1.0 + Math.sin(t * 2.0 + i * 1.2) * 0.08;
            crystal.scaling.setAll(pulse); // mutate in place — no per-frame Vector3 alloc
        }

        // --- Face direction of movement ---
        if (this.currentPathIndex < this.path.length) {
            const targetPoint = this.path[this.currentPathIndex];
            const dx = targetPoint.x - this.position.x;
            const dz = targetPoint.z - this.position.z;

            if (dx * dx + dz * dz > 0.0001) {
                const angle = Math.atan2(dz, dx);
                this.mesh.rotation.y = -angle + Math.PI / 2;
            }
        }

        // --- Orbiting wisps: slowly rotate around the boss at varying heights ---
        const orbitR = 1.2;
        for (let o = 0; o < this.orbitingWisps.length; o++) {
            const orb = this.orbitingWisps[o];
            if (orb.isDisposed()) continue;
            const baseAngle = (o / this.orbitingWisps.length) * Math.PI * 2;
            const angle = baseAngle + t * 0.8; // slow orbit speed
            const heightOffset = 0.5 + Math.sin(t * 0.9 + baseAngle) * 0.8;
            orb.position.set(
                this.position.x + Math.cos(angle) * orbitR,
                this.position.y + 1.2 + heightOffset,
                this.position.z + Math.sin(angle) * orbitR
            );
            // Pulse scale
            const pulse = 0.9 + Math.sin(t * 2.5 + o * 2.1) * 0.25;
            orb.scaling.setAll(pulse);
        }
    }

    /**
     * Free the orbiting wisps — NOT parented to this.mesh (positioned in world
     * coords by animateParts), so the base mesh-tree release never reaches them.
     * Runs on every disposal path (die/disposeCorpse/dispose — the corpse path is
     * the ONLY one guest enemies take). Idempotent: the array is emptied.
     * dispose(false, true) also frees each wisp's uniquely-owned 'bossOrbitMatN'
     * StandardMaterial, which a default dispose() would strand in scene.materials.
     */
    protected disposeAuxVisuals(): void {
        super.disposeAuxVisuals();
        for (const orb of this.orbitingWisps) {
            if (!orb.isDisposed()) orb.dispose(false, true);
        }
        this.orbitingWisps = [];
    }

    /**
     * Override applyDifficultyMultiplier to make bosses extra challenging
     * @param multiplier The difficulty multiplier
     */
    public applyDifficultyMultiplier(multiplier: number): void {
        // Apply the standard difficulty scaling first
        super.applyDifficultyMultiplier(multiplier);

        // Boss-specific additional scaling (reduced from 1.2 to 1.1)
        const bossMultiplier = 1.1;

        // Moderate health/damage increase for bosses
        this.maxHealth = Math.floor(this.maxHealth * bossMultiplier);
        this.health = this.maxHealth;
        this.damage = Math.floor(this.damage * bossMultiplier);

        // Cap boss resistance at 50% (was 80%) to keep them killable
        this.damageResistance = Math.min(0.5, this.damageResistance + 0.03);

        // Update health bar
        this.updateHealthBar();

        console.log(`Boss upgraded with additional multiplier: ${bossMultiplier}. Final stats - Health: ${this.maxHealth}, Resistance: ${(this.damageResistance * 100).toFixed(0)}%`);
    }

    /**
     * Bosses receive only 30% of incoming knockback so they remain threatening
     * even when the hero has multiple knockback stacks.
     */
    public applyKnockback(dirX: number, dirZ: number, magnitude: number): void {
        super.applyKnockback(dirX, dirZ, magnitude * 0.3);
    }
}
