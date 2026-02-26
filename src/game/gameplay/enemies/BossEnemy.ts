import { Vector3, MeshBuilder, StandardMaterial, Color3, Mesh, Color4, Texture, ParticleSystem } from '@babylonjs/core';
import { Game } from '../../Game';
import { Enemy } from './Enemy';
import { createLowPolyMaterial, createEmissiveMaterial, makeFlatShaded } from '../../rendering/LowPolyMaterial';
import { PALETTE } from '../../rendering/StyleConstants';

export class BossEnemy extends Enemy {
    private animationTime: number = 0;
    private head: Mesh | null = null;
    private leftArm: Mesh | null = null;
    private rightArm: Mesh | null = null;
    private towerDestructionRangeIndicator: Mesh | null = null;
    private isDestroyingTower: boolean = false;
    private destructionTargetPosition: Vector3 | null = null;
    private jaw: Mesh | null = null;
    private crystals: Mesh[] = [];
    private leftLeg: Mesh | null = null;
    private rightLeg: Mesh | null = null;

    constructor(game: Game, position: Vector3, path: Vector3[]) {
        // Boss enemy has very low speed, extremely high health, high damage, and very high reward
        super(game, position, path, 0.7, 500, 50, 150);

        // Enable tower destruction ability for boss
        this.canDestroyTowers = true;
        this.towerDestructionRange = 4.0;
        this.towerDestructionCooldown = 4.0;

        // Create visual range indicator for tower destruction
        this.createTowerDestructionRangeIndicator();

        // Add innate damage resistance for bosses (15%, reduced from 20%)
        this.damageResistance = 0.15;
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

        // Store original scale
        this.originalScale = 1.0;
    }

    /**
     * Create a visual indicator for the tower destruction range
     */
    private createTowerDestructionRangeIndicator(): void {
        // Create a semi-transparent disk to show the destruction range
        this.towerDestructionRangeIndicator = MeshBuilder.CreateDisc(
            'destructionRange',
            {
                radius: this.towerDestructionRange,
                tessellation: 32,
                sideOrientation: Mesh.DOUBLESIDE
            },
            this.scene
        );

        // Position at ground level
        this.towerDestructionRangeIndicator.rotation.x = Math.PI / 2;
        this.towerDestructionRangeIndicator.position.y = 0.05;

        // Create material
        const material = new StandardMaterial('destructionRangeMaterial', this.scene);
        material.diffuseColor = new Color3(0.8, 0.2, 0.2);
        material.alpha = 0.2;
        material.emissiveColor = new Color3(0.5, 0.1, 0.1);
        this.towerDestructionRangeIndicator.material = material;

        // Initially invisible
        this.towerDestructionRangeIndicator.setEnabled(false);
    }

    /**
     * Update the boss enemy
     * @param deltaTime Time elapsed since last update in seconds
     * @returns True if the enemy reached the end of the path
     */
    public update(deltaTime: number): boolean {
        if (!this.alive || !this.mesh) return false;

        // Update animation time
        this.animationTime += deltaTime;

        // Animate parts
        this.animateParts(deltaTime);

        // Check for tower destruction with visual effects
        const destroyed = this.checkTowerDestruction(deltaTime);

        // If we just targeted a tower to destroy, play the destruction animation
        if (destroyed && this.towerDestructionRangeIndicator) {
            this.isDestroyingTower = true;

            // Flash the range indicator
            this.towerDestructionRangeIndicator.setEnabled(true);
            this.towerDestructionRangeIndicator.position = new Vector3(
                this.position.x,
                0.05,
                this.position.z
            );

            // Hide after a short time
            setTimeout(() => {
                if (this.towerDestructionRangeIndicator) {
                    this.towerDestructionRangeIndicator.setEnabled(false);
                }
                this.isDestroyingTower = false;
            }, 500);
        }

        // Call parent update method (handles movement and status effects)
        return super.update(deltaTime);
    }

    /**
     * Override the tower destruction effect for boss
     */
    protected createTowerDestructionEffect(position: Vector3): void {
        // Store the target position for animation
        this.destructionTargetPosition = position.clone();

        // Create a larger, more impressive explosion for boss
        const explosion = new ParticleSystem("bossDestructionExplosion", 200, this.scene);
        explosion.particleTexture = new Texture("assets/particles/flare.png", this.scene);
        explosion.emitter = position;
        explosion.minEmitBox = new Vector3(-1, 0, -1);
        explosion.maxEmitBox = new Vector3(1, 2, 1);

        // Set particle properties for a more dramatic effect
        explosion.color1 = new Color4(1, 0.5, 0.1, 1);
        explosion.color2 = new Color4(1, 0.2, 0.1, 1);
        explosion.colorDead = new Color4(0.1, 0, 0, 0);

        explosion.minSize = 0.8;
        explosion.maxSize = 2.5;

        explosion.minLifeTime = 0.5;
        explosion.maxLifeTime = 2.0;

        explosion.emitRate = 200;
        explosion.blendMode = ParticleSystem.BLENDMODE_ONEONE;
        explosion.gravity = new Vector3(0, 10, 0);
        explosion.direction1 = new Vector3(-3, 8, -3);
        explosion.direction2 = new Vector3(3, 10, 3);

        explosion.minAngularSpeed = 0;
        explosion.maxAngularSpeed = Math.PI * 2;

        explosion.minEmitPower = 2;
        explosion.maxEmitPower = 5;

        explosion.targetStopDuration = 0.5;

        // Add secondary smoke effect
        const smoke = new ParticleSystem("destructionSmoke", 50, this.scene);
        smoke.particleTexture = new Texture("assets/particles/smoke.png", this.scene);
        smoke.emitter = position;
        smoke.minEmitBox = new Vector3(-1, 0, -1);
        smoke.maxEmitBox = new Vector3(1, 0.5, 1);

        // Set smoke properties
        smoke.color1 = new Color4(0.2, 0.2, 0.2, 0.7);
        smoke.color2 = new Color4(0.1, 0.1, 0.1, 0.7);
        smoke.colorDead = new Color4(0, 0, 0, 0);

        smoke.minSize = 2;
        smoke.maxSize = 4;

        smoke.minLifeTime = 2.0;
        smoke.maxLifeTime = 5.0;

        smoke.emitRate = 30;
        smoke.gravity = new Vector3(0, 2, 0);
        smoke.direction1 = new Vector3(-0.5, 1, -0.5);
        smoke.direction2 = new Vector3(0.5, 1, 0.5);

        smoke.minAngularSpeed = 0;
        smoke.maxAngularSpeed = Math.PI / 4;

        smoke.minEmitPower = 0.5;
        smoke.maxEmitPower = 1;

        // Start the effects
        explosion.start();
        smoke.start();

        // Play a louder destruction sound
        const sound = new Audio(`assets/audio/explosion_large.mp3`);
        sound.volume = 0.8;
        sound.play();

        // Clean up after effects complete
        setTimeout(() => {
            explosion.dispose();
            smoke.dispose();
        }, 5000);

        // Show an on-screen message
        this.showTowerDestructionMessage();
    }

    /**
     * Show a message on screen when a tower is destroyed
     */
    private showTowerDestructionMessage(): void {
        // Create a div element for the message
        const messageElement = document.createElement('div');
        messageElement.style.position = 'absolute';
        messageElement.style.top = '30%';
        messageElement.style.left = '50%';
        messageElement.style.transform = 'translate(-50%, -50%)';
        messageElement.style.color = '#ff3030';
        messageElement.style.fontSize = '32px';
        messageElement.style.fontWeight = 'bold';
        messageElement.style.textShadow = '2px 2px 4px #000';
        messageElement.style.fontFamily = 'Arial, sans-serif';
        messageElement.style.zIndex = '1000';
        messageElement.style.pointerEvents = 'none';
        messageElement.style.opacity = '1';
        messageElement.style.transition = 'opacity 0.5s';
        messageElement.innerHTML = 'BOSS DESTROYED A TOWER!';

        // Add to document
        document.body.appendChild(messageElement);

        // Fade and remove after 2 seconds
        setTimeout(() => {
            messageElement.style.opacity = '0';
            setTimeout(() => {
                document.body.removeChild(messageElement);
            }, 500);
        }, 2000);
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
            // If destroying a tower, lock gaze on target
            if (this.isDestroyingTower && this.destructionTargetPosition) {
                const direction = this.destructionTargetPosition.subtract(this.position);
                direction.y = 0;

                if (direction.length() > 0.1) {
                    const angle = Math.atan2(direction.z, direction.x);
                    this.head.rotation.y = -angle + Math.PI / 2;
                }
                // Head rears back during attack
                this.head.position.y = 1.45 + 0.15;
            } else {
                // Normal: slow ominous head movement
                this.head.position.y = 1.45 + Math.sin(t * 1.8) * 0.06;
                this.head.rotation.y = Math.sin(t * 0.6) * 0.18;
                this.head.rotation.x = Math.sin(t * 0.4) * 0.05;
            }
        }

        // --- Jaw: slow breathing open/close, faster during attack ---
        if (this.jaw) {
            if (this.isDestroyingTower) {
                // Wide open roar during attack
                this.jaw.rotation.x = 0.35;
            } else {
                // Slow breathing
                this.jaw.rotation.x = Math.max(0, Math.sin(t * 1.2)) * 0.12;
            }
        }

        // --- Arms: heavy swaying, raised during attack ---
        if (this.leftArm && this.rightArm) {
            if (this.isDestroyingTower) {
                // Both arms raised for attack
                this.leftArm.rotation.x = -Math.PI / 3;
                this.rightArm.rotation.x = -Math.PI / 3;
                this.leftArm.rotation.z = Math.PI / 6;
                this.rightArm.rotation.z = -Math.PI / 6;
            } else {
                // Heavy pendulum swing, slightly out of phase
                this.leftArm.rotation.x = Math.sin(t * 1.5 + Math.PI) * 0.20;
                this.rightArm.rotation.x = Math.sin(t * 1.5) * 0.20;
                this.leftArm.rotation.z = Math.PI / 10 + Math.sin(t * 0.8) * 0.05;
                this.rightArm.rotation.z = -Math.PI / 10 - Math.sin(t * 0.8) * 0.05;
            }
        }

        // --- Crystals: slow pulsing glow (via scale) ---
        for (let i = 0; i < this.crystals.length; i++) {
            const crystal = this.crystals[i];
            const pulse = 1.0 + Math.sin(t * 2.0 + i * 1.2) * 0.08;
            crystal.scaling = new Vector3(pulse, pulse, pulse);
        }

        // --- Face direction of movement ---
        if (this.currentPathIndex < this.path.length) {
            const targetPoint = this.path[this.currentPathIndex];
            const direction = targetPoint.subtract(this.position);

            if (direction.length() > 0.01) {
                const angle = Math.atan2(direction.z, direction.x);
                this.mesh.rotation.y = -angle + Math.PI / 2;
            }
        }
    }

    /**
     * Clean up resources
     */
    public dispose(): void {
        // Dispose of tower destruction range indicator
        if (this.towerDestructionRangeIndicator) {
            this.towerDestructionRangeIndicator.dispose();
            this.towerDestructionRangeIndicator = null;
        }

        // Call parent dispose
        super.dispose();
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
}
