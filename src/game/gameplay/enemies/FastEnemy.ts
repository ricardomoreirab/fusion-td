import { Vector3, MeshBuilder, StandardMaterial, Color3, Mesh } from '@babylonjs/core';
import { Game } from '../../Game';
import { Enemy } from './Enemy';
import { createLowPolyMaterial, createEmissiveMaterial, makeFlatShaded } from '../../rendering/LowPolyMaterial';
import { PALETTE } from '../../rendering/StyleConstants';

export class FastEnemy extends Enemy {
    private flyTime: number = 0;
    private leftWing: Mesh | null = null;
    private rightWing: Mesh | null = null;
    private head: Mesh | null = null;
    private cloakLeft: Mesh | null = null;
    private cloakRight: Mesh | null = null;
    private tailWisp: Mesh | null = null;

    constructor(game: Game, position: Vector3, path: Vector3[]) {
        // Fast enemy has 2x speed, low health, low damage, and medium reward
        super(game, position, path, 6, 20, 5, 15);

        // Set as a flying enemy
        this.isFlying = true;
    }

    /**
     * Create the enemy mesh - low-poly Spectral Wraith
     * Ethereal floating figure: hooded head, no legs (cloak trails away),
     * bony arms reaching forward, ghostly wisp trails, eerie glowing eyes
     */
    protected createMesh(): void {
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
            material.diffuseColor = new Color3(0.2, 0.8, 0.2);
        } else if (healthPercent > 0.3) {
            material.diffuseColor = new Color3(0.8, 0.8, 0.2);
        } else {
            material.diffuseColor = new Color3(0.8, 0.2, 0.2);
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

        // Update spectral floating animation
        if (!this.isFrozen && !this.isStunned && this.currentPathIndex < this.path.length) {
            this.flyTime += deltaTime * 6;

            if (this.mesh) {
                // Ethereal floating: slow sinusoidal hover with slight figure-8
                const hoverY = Math.sin(this.flyTime * 0.6) * 0.25;
                const hoverX = Math.sin(this.flyTime * 0.3) * 0.08;
                this.mesh.position.y = this.position.y + 1.3 + hoverY;

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

        // Call the parent method to create the base death effect
        super.createDeathEffect();

        // Play a special sound for fast enemy death
        this.game.getAssetManager().playSound('enemyDeath');
    }
}
