import { Vector3, MeshBuilder, StandardMaterial, Color3, Color4, ParticleSystem, Texture, Mesh } from '@babylonjs/core';
import { Game } from '../../Game';
import { Enemy } from './Enemy';
import { createLowPolyMaterial, createEmissiveMaterial, makeFlatShaded } from '../../rendering/LowPolyMaterial';
import { PALETTE } from '../../rendering/StyleConstants';

export class BasicEnemy extends Enemy {
    private walkTime: number = 0;
    private head: Mesh | null = null;
    private leftLeg: Mesh | null = null;
    private rightLeg: Mesh | null = null;
    private leftArm: Mesh | null = null;
    private rightArm: Mesh | null = null;

    constructor(game: Game, position: Vector3, path: Vector3[]) {
        // Basic enemy has medium speed, medium health, medium damage, and low reward
        super(game, position, path, 3, 30, 10, 10);
    }

    /**
     * Create the enemy mesh - low-poly Goblin Warrior
     * Stocky proportions, pointy ears, crude shield on left arm, jagged sword on right,
     * big nose, underbite jaw, leather chest armor
     */
    protected createMesh(): void {
        // --- Torso: wide, squat box (goblins are stocky) ---
        this.mesh = MeshBuilder.CreateBox('basicEnemyBody', {
            width: 0.75,
            height: 0.65,
            depth: 0.5
        }, this.scene);
        makeFlatShaded(this.mesh);
        this.mesh.position = this.position.clone();
        this.mesh.position.y += 0.65;
        this.mesh.material = createLowPolyMaterial('basicBodyMat', PALETTE.ENEMY_BASIC, this.scene);

        // --- Belly patch: lighter green box on the front ---
        const belly = MeshBuilder.CreateBox('basicBelly', {
            width: 0.45,
            height: 0.40,
            depth: 0.08
        }, this.scene);
        makeFlatShaded(belly);
        belly.parent = this.mesh;
        belly.position = new Vector3(0, -0.05, 0.26);
        belly.material = createLowPolyMaterial('basicBellyMat', PALETTE.ENEMY_BASIC_BELLY, this.scene);

        // --- Leather armor: thin box over torso front ---
        const armor = MeshBuilder.CreateBox('basicArmor', {
            width: 0.65,
            height: 0.30,
            depth: 0.06
        }, this.scene);
        makeFlatShaded(armor);
        armor.parent = this.mesh;
        armor.position = new Vector3(0, 0.15, 0.28);
        armor.material = createLowPolyMaterial('basicArmorMat', PALETTE.ENEMY_BASIC_ARMOR, this.scene);

        // --- Belt: thin horizontal box ---
        const belt = MeshBuilder.CreateBox('basicBelt', {
            width: 0.78,
            height: 0.08,
            depth: 0.52
        }, this.scene);
        makeFlatShaded(belt);
        belt.parent = this.mesh;
        belt.position = new Vector3(0, -0.28, 0);
        belt.material = createLowPolyMaterial('basicBeltMat', PALETTE.ENEMY_BASIC_ARMOR, this.scene);

        // --- Head: slightly oversized sphere-like box (goblins have big heads) ---
        this.head = MeshBuilder.CreateBox('basicHead', {
            width: 0.58,
            height: 0.50,
            depth: 0.52
        }, this.scene);
        makeFlatShaded(this.head);
        this.head.parent = this.mesh;
        this.head.position = new Vector3(0, 0.58, 0.04);
        this.head.material = createLowPolyMaterial('basicHeadMat', PALETTE.ENEMY_BASIC, this.scene);

        // --- Big Nose: cone pointing forward ---
        const nose = MeshBuilder.CreateCylinder('basicNose', {
            height: 0.22,
            diameterTop: 0.0,
            diameterBottom: 0.14,
            tessellation: 4
        }, this.scene);
        makeFlatShaded(nose);
        nose.parent = this.head;
        nose.position = new Vector3(0, -0.04, 0.30);
        nose.rotation.x = Math.PI / 2;
        nose.material = createLowPolyMaterial('basicNoseMat', PALETTE.ENEMY_BASIC_BELLY, this.scene);

        // --- Underbite Jaw: small box jutting forward ---
        const jaw = MeshBuilder.CreateBox('basicJaw', {
            width: 0.38,
            height: 0.12,
            depth: 0.20
        }, this.scene);
        makeFlatShaded(jaw);
        jaw.parent = this.head;
        jaw.position = new Vector3(0, -0.22, 0.18);
        jaw.material = createLowPolyMaterial('basicJawMat', PALETTE.ENEMY_BASIC, this.scene);

        // --- Teeth: two small white boxes (snaggle teeth) ---
        const leftTooth = MeshBuilder.CreateBox('basicLeftTooth', {
            width: 0.06,
            height: 0.08,
            depth: 0.05
        }, this.scene);
        makeFlatShaded(leftTooth);
        leftTooth.parent = jaw;
        leftTooth.position = new Vector3(-0.08, 0.08, 0.08);
        leftTooth.material = createLowPolyMaterial('basicToothMat1', new Color3(0.92, 0.88, 0.72), this.scene);

        const rightTooth = MeshBuilder.CreateBox('basicRightTooth', {
            width: 0.06,
            height: 0.10,
            depth: 0.05
        }, this.scene);
        makeFlatShaded(rightTooth);
        rightTooth.parent = jaw;
        rightTooth.position = new Vector3(0.10, 0.10, 0.08);
        rightTooth.material = createLowPolyMaterial('basicToothMat2', new Color3(0.92, 0.88, 0.72), this.scene);

        // --- Left Eye: emissive yellow ---
        const leftEye = MeshBuilder.CreateBox('basicLeftEye', {
            width: 0.13,
            height: 0.09,
            depth: 0.06
        }, this.scene);
        makeFlatShaded(leftEye);
        leftEye.parent = this.head;
        leftEye.position = new Vector3(-0.15, 0.08, 0.27);
        leftEye.material = createEmissiveMaterial('basicLeftEyeMat', PALETTE.ENEMY_BASIC_EYE, 0.8, this.scene);

        // --- Right Eye: emissive yellow ---
        const rightEye = MeshBuilder.CreateBox('basicRightEye', {
            width: 0.13,
            height: 0.09,
            depth: 0.06
        }, this.scene);
        makeFlatShaded(rightEye);
        rightEye.parent = this.head;
        rightEye.position = new Vector3(0.15, 0.08, 0.27);
        rightEye.material = createEmissiveMaterial('basicRightEyeMat', PALETTE.ENEMY_BASIC_EYE, 0.8, this.scene);

        // --- Left Ear: pointy cone ---
        const leftEar = MeshBuilder.CreateCylinder('basicLeftEar', {
            height: 0.30,
            diameterTop: 0.0,
            diameterBottom: 0.10,
            tessellation: 3
        }, this.scene);
        makeFlatShaded(leftEar);
        leftEar.parent = this.head;
        leftEar.position = new Vector3(-0.32, 0.08, 0);
        leftEar.rotation.z = Math.PI / 2.5;
        leftEar.material = createLowPolyMaterial('basicLeftEarMat', PALETTE.ENEMY_BASIC_BELLY, this.scene);

        // --- Right Ear: pointy cone ---
        const rightEar = MeshBuilder.CreateCylinder('basicRightEar', {
            height: 0.30,
            diameterTop: 0.0,
            diameterBottom: 0.10,
            tessellation: 3
        }, this.scene);
        makeFlatShaded(rightEar);
        rightEar.parent = this.head;
        rightEar.position = new Vector3(0.32, 0.08, 0);
        rightEar.rotation.z = -Math.PI / 2.5;
        rightEar.material = createLowPolyMaterial('basicRightEarMat', PALETTE.ENEMY_BASIC_BELLY, this.scene);

        // --- Left Arm (shield arm): short box arm ---
        this.leftArm = MeshBuilder.CreateBox('basicLeftArm', {
            width: 0.16,
            height: 0.55,
            depth: 0.16
        }, this.scene);
        makeFlatShaded(this.leftArm);
        this.leftArm.parent = this.mesh;
        this.leftArm.position = new Vector3(-0.48, 0.05, 0);
        this.leftArm.material = createLowPolyMaterial('basicLeftArmMat', PALETTE.ENEMY_BASIC, this.scene);

        // --- Shield on left arm: flat wide box ---
        const shield = MeshBuilder.CreateBox('basicShield', {
            width: 0.06,
            height: 0.40,
            depth: 0.30
        }, this.scene);
        makeFlatShaded(shield);
        shield.parent = this.leftArm;
        shield.position = new Vector3(-0.10, -0.10, 0.08);
        shield.material = createLowPolyMaterial('basicShieldMat', PALETTE.ENEMY_BASIC_METAL, this.scene);

        // --- Shield boss (center knob): small box ---
        const shieldBoss = MeshBuilder.CreateBox('basicShieldBoss', {
            width: 0.04,
            height: 0.10,
            depth: 0.10
        }, this.scene);
        makeFlatShaded(shieldBoss);
        shieldBoss.parent = shield;
        shieldBoss.position = new Vector3(-0.04, 0, 0);
        shieldBoss.material = createLowPolyMaterial('basicShieldBossMat', PALETTE.ENEMY_BASIC_ARMOR, this.scene);

        // --- Right Arm (sword arm): short box arm ---
        this.rightArm = MeshBuilder.CreateBox('basicRightArm', {
            width: 0.16,
            height: 0.55,
            depth: 0.16
        }, this.scene);
        makeFlatShaded(this.rightArm);
        this.rightArm.parent = this.mesh;
        this.rightArm.position = new Vector3(0.48, 0.05, 0);
        this.rightArm.material = createLowPolyMaterial('basicRightArmMat', PALETTE.ENEMY_BASIC, this.scene);

        // --- Sword blade: tall thin box ---
        const sword = MeshBuilder.CreateBox('basicSword', {
            width: 0.05,
            height: 0.55,
            depth: 0.12
        }, this.scene);
        makeFlatShaded(sword);
        sword.parent = this.rightArm;
        sword.position = new Vector3(0.08, -0.45, 0);
        sword.material = createLowPolyMaterial('basicSwordMat', PALETTE.ENEMY_BASIC_METAL, this.scene);

        // --- Sword point: small cone on top of blade ---
        const swordTip = MeshBuilder.CreateCylinder('basicSwordTip', {
            height: 0.15,
            diameterTop: 0.0,
            diameterBottom: 0.12,
            tessellation: 3
        }, this.scene);
        makeFlatShaded(swordTip);
        swordTip.parent = sword;
        swordTip.position = new Vector3(0, -0.35, 0);
        swordTip.material = createLowPolyMaterial('basicSwordTipMat', PALETTE.ENEMY_BASIC_METAL, this.scene);

        // --- Left Leg ---
        this.leftLeg = MeshBuilder.CreateBox('basicLeftLeg', {
            width: 0.20,
            height: 0.50,
            depth: 0.20
        }, this.scene);
        makeFlatShaded(this.leftLeg);
        this.leftLeg.parent = this.mesh;
        this.leftLeg.position = new Vector3(-0.20, -0.55, 0);
        this.leftLeg.material = createLowPolyMaterial('basicLeftLegMat', PALETTE.ENEMY_BASIC_ARMOR, this.scene);

        // --- Left Foot ---
        const leftFoot = MeshBuilder.CreateBox('basicLeftFoot', {
            width: 0.22,
            height: 0.08,
            depth: 0.28
        }, this.scene);
        makeFlatShaded(leftFoot);
        leftFoot.parent = this.leftLeg;
        leftFoot.position = new Vector3(0, -0.28, 0.06);
        leftFoot.material = createLowPolyMaterial('basicLeftFootMat', PALETTE.ENEMY_BASIC_ARMOR, this.scene);

        // --- Right Leg ---
        this.rightLeg = MeshBuilder.CreateBox('basicRightLeg', {
            width: 0.20,
            height: 0.50,
            depth: 0.20
        }, this.scene);
        makeFlatShaded(this.rightLeg);
        this.rightLeg.parent = this.mesh;
        this.rightLeg.position = new Vector3(0.20, -0.55, 0);
        this.rightLeg.material = createLowPolyMaterial('basicRightLegMat', PALETTE.ENEMY_BASIC_ARMOR, this.scene);

        // --- Right Foot ---
        const rightFoot = MeshBuilder.CreateBox('basicRightFoot', {
            width: 0.22,
            height: 0.08,
            depth: 0.28
        }, this.scene);
        makeFlatShaded(rightFoot);
        rightFoot.parent = this.rightLeg;
        rightFoot.position = new Vector3(0, -0.28, 0.06);
        rightFoot.material = createLowPolyMaterial('basicRightFootMat', PALETTE.ENEMY_BASIC_ARMOR, this.scene);

        // Store original scale
        this.originalScale = 1.0;
    }

    /**
     * Override the health bar creation for basic enemies (positioned higher)
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
     * Override the updateHealthBar method for basic enemies
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
     * Update the enemy with goblin waddle-march animation
     * @param deltaTime Time elapsed since last update in seconds
     * @returns True if the enemy reached the end of the path
     */
    public update(deltaTime: number): boolean {
        if (!this.alive || !this.mesh) return false;

        // Get the result from the parent update method
        const result = super.update(deltaTime);

        // Update walking animation
        if (!this.isFrozen && !this.isStunned && this.currentPathIndex < this.path.length && this.mesh) {
            this.walkTime += deltaTime * 6; // Slightly faster for a frantic goblin waddle

            // Goblin waddle: body sways side-to-side AND bobs up/down
            const bobAmount = Math.abs(Math.sin(this.walkTime)) * 0.06;
            const swayAmount = Math.sin(this.walkTime * 0.5) * 0.04;
            this.mesh.position.y = this.position.y + 0.65 + bobAmount;
            this.mesh.rotation.z = Math.sin(this.walkTime) * 0.08; // Torso lean

            // Legs: alternating stride with bent-knee feel
            if (this.leftLeg && this.rightLeg) {
                this.leftLeg.rotation.x = Math.sin(this.walkTime) * 0.5;
                this.rightLeg.rotation.x = Math.sin(this.walkTime + Math.PI) * 0.5;
            }

            // Shield arm: held out to the side, slight sway
            if (this.leftArm) {
                this.leftArm.rotation.x = Math.sin(this.walkTime + Math.PI) * 0.15;
                this.leftArm.rotation.z = -0.2 + Math.sin(this.walkTime * 0.7) * 0.05;
            }

            // Sword arm: swings more aggressively
            if (this.rightArm) {
                this.rightArm.rotation.x = Math.sin(this.walkTime) * 0.55;
                this.rightArm.rotation.z = 0.1;
            }

            // Head: looks around nervously, quick twitches
            if (this.head) {
                this.head.rotation.y = Math.sin(this.walkTime * 1.3) * 0.15;
                this.head.rotation.x = Math.sin(this.walkTime * 0.8) * 0.05;
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

        // Create a simple explosion effect
        const particleSystem = new ParticleSystem('deathParticles', 50, this.scene);

        // Set particle texture
        particleSystem.particleTexture = new Texture('assets/textures/particle.png', this.scene);

        // Set emission properties
        particleSystem.emitter = this.position.clone();
        (particleSystem.emitter as Vector3).y += 0.7;
        particleSystem.minEmitBox = new Vector3(-0.2, 0, -0.2);
        particleSystem.maxEmitBox = new Vector3(0.2, 0, 0.2);

        // Set particle properties - greenish-yellow goblin poof
        particleSystem.color1 = new Color4(0.6, 0.8, 0.2, 1.0);
        particleSystem.color2 = new Color4(0.9, 0.7, 0.1, 1.0);
        particleSystem.colorDead = new Color4(0.3, 0.2, 0.0, 0.0);

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
}
