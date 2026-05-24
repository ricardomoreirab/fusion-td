import { Vector3, MeshBuilder, StandardMaterial, Color3, Color4, ParticleSystem, Texture, Mesh } from '@babylonjs/core';
import { Game } from '../../Game';
import { Enemy } from './Enemy';
import { createLowPolyMaterial, createEmissiveMaterial, makeFlatShaded } from '../../rendering/LowPolyMaterial';
import { PALETTE } from '../../rendering/StyleConstants';

export class SplittingEnemy extends Enemy {
    private walkTime: number = 0;
    private headLeft: Mesh | null = null;
    private headCenter: Mesh | null = null;
    private headRight: Mesh | null = null;
    private leftLeg: Mesh | null = null;
    private rightLeg: Mesh | null = null;
    private backLeg: Mesh | null = null;

    constructor(game: Game, position: Vector3, path: Vector3[]) {
        // Splitting enemy: moderate speed, medium HP, medium damage, decent reward
        super(game, position, path, 2.5, 40, 8, 20);
        this.contactDamagePerSecond = 10;
    }

    /**
     * Create the enemy mesh - low-poly Multi-Headed Hydra/Slime
     * Squat wide body, 3 serpentine heads with emissive eyes, short stubby legs
     */
    protected createMesh(): void {
        // --- Main body: squat wide box (blobby torso) ---
        this.mesh = MeshBuilder.CreateBox('splittingEnemyBody', {
            width: 0.90,
            height: 0.50,
            depth: 0.70
        }, this.scene);
        makeFlatShaded(this.mesh);
        this.mesh.position = this.position.clone();
        this.mesh.position.y += 0.40;
        this.mesh.material = createLowPolyMaterial('splittingBodyMat', PALETTE.ENEMY_SPLITTING, this.scene);

        // --- Belly patch: lighter underside ---
        const belly = MeshBuilder.CreateBox('splittingBelly', {
            width: 0.65,
            height: 0.30,
            depth: 0.50
        }, this.scene);
        makeFlatShaded(belly);
        belly.parent = this.mesh;
        belly.position = new Vector3(0, -0.12, 0);
        belly.material = createLowPolyMaterial('splittingBellyMat', PALETTE.ENEMY_SPLITTING_BELLY, this.scene);

        // --- Back ridge: bumpy ridge along the spine ---
        const ridge = MeshBuilder.CreateBox('splittingRidge', {
            width: 0.20,
            height: 0.12,
            depth: 0.55
        }, this.scene);
        makeFlatShaded(ridge);
        ridge.parent = this.mesh;
        ridge.position = new Vector3(0, 0.28, -0.05);
        ridge.material = createLowPolyMaterial('splittingRidgeMat', PALETTE.ENEMY_SPLITTING, this.scene);

        // --- Center Head (tallest): neck + head ---
        const centerNeck = MeshBuilder.CreateCylinder('splittingCenterNeck', {
            height: 0.40,
            diameterTop: 0.16,
            diameterBottom: 0.22,
            tessellation: 5
        }, this.scene);
        makeFlatShaded(centerNeck);
        centerNeck.parent = this.mesh;
        centerNeck.position = new Vector3(0, 0.42, 0.15);
        centerNeck.material = createLowPolyMaterial('splittingCenterNeckMat', PALETTE.ENEMY_SPLITTING, this.scene);

        this.headCenter = MeshBuilder.CreateBox('splittingCenterHead', {
            width: 0.28,
            height: 0.22,
            depth: 0.26
        }, this.scene);
        makeFlatShaded(this.headCenter);
        this.headCenter.parent = centerNeck;
        this.headCenter.position = new Vector3(0, 0.28, 0.04);
        this.headCenter.material = createLowPolyMaterial('splittingCenterHeadMat', PALETTE.ENEMY_SPLITTING, this.scene);

        // Center head snout
        const centerSnout = MeshBuilder.CreateCylinder('splittingCenterSnout', {
            height: 0.16,
            diameterTop: 0.0,
            diameterBottom: 0.12,
            tessellation: 4
        }, this.scene);
        makeFlatShaded(centerSnout);
        centerSnout.parent = this.headCenter;
        centerSnout.position = new Vector3(0, -0.02, 0.18);
        centerSnout.rotation.x = Math.PI / 2;
        centerSnout.material = createLowPolyMaterial('splittingCenterSnoutMat', PALETTE.ENEMY_SPLITTING_BELLY, this.scene);

        // Center head eyes
        const centerLeftEye = MeshBuilder.CreateBox('splittingCEyeL', {
            width: 0.08,
            height: 0.06,
            depth: 0.05
        }, this.scene);
        makeFlatShaded(centerLeftEye);
        centerLeftEye.parent = this.headCenter;
        centerLeftEye.position = new Vector3(-0.08, 0.05, 0.13);
        centerLeftEye.material = createEmissiveMaterial('splittingCEyeLMat', PALETTE.ENEMY_SPLITTING_EYE, 0.9, this.scene);

        const centerRightEye = MeshBuilder.CreateBox('splittingCEyeR', {
            width: 0.08,
            height: 0.06,
            depth: 0.05
        }, this.scene);
        makeFlatShaded(centerRightEye);
        centerRightEye.parent = this.headCenter;
        centerRightEye.position = new Vector3(0.08, 0.05, 0.13);
        centerRightEye.material = createEmissiveMaterial('splittingCEyeRMat', PALETTE.ENEMY_SPLITTING_EYE, 0.9, this.scene);

        // --- Left Head (shorter, angled left): neck + head ---
        const leftNeck = MeshBuilder.CreateCylinder('splittingLeftNeck', {
            height: 0.32,
            diameterTop: 0.14,
            diameterBottom: 0.20,
            tessellation: 5
        }, this.scene);
        makeFlatShaded(leftNeck);
        leftNeck.parent = this.mesh;
        leftNeck.position = new Vector3(-0.28, 0.36, 0.10);
        leftNeck.rotation.z = 0.35;
        leftNeck.material = createLowPolyMaterial('splittingLeftNeckMat', PALETTE.ENEMY_SPLITTING, this.scene);

        this.headLeft = MeshBuilder.CreateBox('splittingLeftHead', {
            width: 0.24,
            height: 0.18,
            depth: 0.22
        }, this.scene);
        makeFlatShaded(this.headLeft);
        this.headLeft.parent = leftNeck;
        this.headLeft.position = new Vector3(0, 0.22, 0.04);
        this.headLeft.material = createLowPolyMaterial('splittingLeftHeadMat', PALETTE.ENEMY_SPLITTING, this.scene);

        // Left head snout
        const leftSnout = MeshBuilder.CreateCylinder('splittingLeftSnout', {
            height: 0.12,
            diameterTop: 0.0,
            diameterBottom: 0.10,
            tessellation: 4
        }, this.scene);
        makeFlatShaded(leftSnout);
        leftSnout.parent = this.headLeft;
        leftSnout.position = new Vector3(0, -0.02, 0.14);
        leftSnout.rotation.x = Math.PI / 2;
        leftSnout.material = createLowPolyMaterial('splittingLeftSnoutMat', PALETTE.ENEMY_SPLITTING_BELLY, this.scene);

        // Left head eyes
        const leftEyeL = MeshBuilder.CreateBox('splittingLEyeL', {
            width: 0.06,
            height: 0.05,
            depth: 0.04
        }, this.scene);
        makeFlatShaded(leftEyeL);
        leftEyeL.parent = this.headLeft;
        leftEyeL.position = new Vector3(-0.06, 0.04, 0.11);
        leftEyeL.material = createEmissiveMaterial('splittingLEyeLMat', PALETTE.ENEMY_SPLITTING_EYE, 0.9, this.scene);

        const leftEyeR = MeshBuilder.CreateBox('splittingLEyeR', {
            width: 0.06,
            height: 0.05,
            depth: 0.04
        }, this.scene);
        makeFlatShaded(leftEyeR);
        leftEyeR.parent = this.headLeft;
        leftEyeR.position = new Vector3(0.06, 0.04, 0.11);
        leftEyeR.material = createEmissiveMaterial('splittingLEyeRMat', PALETTE.ENEMY_SPLITTING_EYE, 0.9, this.scene);

        // --- Right Head (shorter, angled right): neck + head ---
        const rightNeck = MeshBuilder.CreateCylinder('splittingRightNeck', {
            height: 0.32,
            diameterTop: 0.14,
            diameterBottom: 0.20,
            tessellation: 5
        }, this.scene);
        makeFlatShaded(rightNeck);
        rightNeck.parent = this.mesh;
        rightNeck.position = new Vector3(0.28, 0.36, 0.10);
        rightNeck.rotation.z = -0.35;
        rightNeck.material = createLowPolyMaterial('splittingRightNeckMat', PALETTE.ENEMY_SPLITTING, this.scene);

        this.headRight = MeshBuilder.CreateBox('splittingRightHead', {
            width: 0.24,
            height: 0.18,
            depth: 0.22
        }, this.scene);
        makeFlatShaded(this.headRight);
        this.headRight.parent = rightNeck;
        this.headRight.position = new Vector3(0, 0.22, 0.04);
        this.headRight.material = createLowPolyMaterial('splittingRightHeadMat', PALETTE.ENEMY_SPLITTING, this.scene);

        // Right head snout
        const rightSnout = MeshBuilder.CreateCylinder('splittingRightSnout', {
            height: 0.12,
            diameterTop: 0.0,
            diameterBottom: 0.10,
            tessellation: 4
        }, this.scene);
        makeFlatShaded(rightSnout);
        rightSnout.parent = this.headRight;
        rightSnout.position = new Vector3(0, -0.02, 0.14);
        rightSnout.rotation.x = Math.PI / 2;
        rightSnout.material = createLowPolyMaterial('splittingRightSnoutMat', PALETTE.ENEMY_SPLITTING_BELLY, this.scene);

        // Right head eyes
        const rightEyeL = MeshBuilder.CreateBox('splittingREyeL', {
            width: 0.06,
            height: 0.05,
            depth: 0.04
        }, this.scene);
        makeFlatShaded(rightEyeL);
        rightEyeL.parent = this.headRight;
        rightEyeL.position = new Vector3(-0.06, 0.04, 0.11);
        rightEyeL.material = createEmissiveMaterial('splittingREyeLMat', PALETTE.ENEMY_SPLITTING_EYE, 0.9, this.scene);

        const rightEyeR = MeshBuilder.CreateBox('splittingREyeR', {
            width: 0.06,
            height: 0.05,
            depth: 0.04
        }, this.scene);
        makeFlatShaded(rightEyeR);
        rightEyeR.parent = this.headRight;
        rightEyeR.position = new Vector3(0.06, 0.04, 0.11);
        rightEyeR.material = createEmissiveMaterial('splittingREyeRMat', PALETTE.ENEMY_SPLITTING_EYE, 0.9, this.scene);

        // --- Left Leg: stubby box ---
        this.leftLeg = MeshBuilder.CreateBox('splittingLeftLeg', {
            width: 0.22,
            height: 0.30,
            depth: 0.22
        }, this.scene);
        makeFlatShaded(this.leftLeg);
        this.leftLeg.parent = this.mesh;
        this.leftLeg.position = new Vector3(-0.28, -0.38, 0.10);
        this.leftLeg.material = createLowPolyMaterial('splittingLeftLegMat', PALETTE.ENEMY_SPLITTING_BELLY, this.scene);

        // Left foot
        const leftFoot = MeshBuilder.CreateBox('splittingLeftFoot', {
            width: 0.26,
            height: 0.06,
            depth: 0.28
        }, this.scene);
        makeFlatShaded(leftFoot);
        leftFoot.parent = this.leftLeg;
        leftFoot.position = new Vector3(0, -0.16, 0.04);
        leftFoot.material = createLowPolyMaterial('splittingLeftFootMat', PALETTE.ENEMY_SPLITTING, this.scene);

        // --- Right Leg: stubby box ---
        this.rightLeg = MeshBuilder.CreateBox('splittingRightLeg', {
            width: 0.22,
            height: 0.30,
            depth: 0.22
        }, this.scene);
        makeFlatShaded(this.rightLeg);
        this.rightLeg.parent = this.mesh;
        this.rightLeg.position = new Vector3(0.28, -0.38, 0.10);
        this.rightLeg.material = createLowPolyMaterial('splittingRightLegMat', PALETTE.ENEMY_SPLITTING_BELLY, this.scene);

        // Right foot
        const rightFoot = MeshBuilder.CreateBox('splittingRightFoot', {
            width: 0.26,
            height: 0.06,
            depth: 0.28
        }, this.scene);
        makeFlatShaded(rightFoot);
        rightFoot.parent = this.rightLeg;
        rightFoot.position = new Vector3(0, -0.16, 0.04);
        rightFoot.material = createLowPolyMaterial('splittingRightFootMat', PALETTE.ENEMY_SPLITTING, this.scene);

        // --- Back Leg: centered stubby support ---
        this.backLeg = MeshBuilder.CreateBox('splittingBackLeg', {
            width: 0.22,
            height: 0.28,
            depth: 0.22
        }, this.scene);
        makeFlatShaded(this.backLeg);
        this.backLeg.parent = this.mesh;
        this.backLeg.position = new Vector3(0, -0.38, -0.22);
        this.backLeg.material = createLowPolyMaterial('splittingBackLegMat', PALETTE.ENEMY_SPLITTING_BELLY, this.scene);

        // Back foot
        const backFoot = MeshBuilder.CreateBox('splittingBackFoot', {
            width: 0.26,
            height: 0.06,
            depth: 0.26
        }, this.scene);
        makeFlatShaded(backFoot);
        backFoot.parent = this.backLeg;
        backFoot.position = new Vector3(0, -0.15, -0.02);
        backFoot.material = createLowPolyMaterial('splittingBackFootMat', PALETTE.ENEMY_SPLITTING, this.scene);

        // --- Tail nub: short tapered box at the rear ---
        const tail = MeshBuilder.CreateCylinder('splittingTail', {
            height: 0.25,
            diameterTop: 0.06,
            diameterBottom: 0.16,
            tessellation: 5
        }, this.scene);
        makeFlatShaded(tail);
        tail.parent = this.mesh;
        tail.position = new Vector3(0, 0.05, -0.42);
        tail.rotation.x = -Math.PI / 3;
        tail.material = createLowPolyMaterial('splittingTailMat', PALETTE.ENEMY_SPLITTING, this.scene);

        // Store original scale
        this.originalScale = 1.0;
    }

    /**
     * Override the health bar creation for splitting enemies (positioned above heads)
     */
    protected createHealthBar(): void {
        if (!this.mesh) return;

        // Outline
        this.healthBarOutlineMesh = MeshBuilder.CreateBox('healthBarOutline', {
            width: 1.08,
            height: 0.14,
            depth: 0.04
        }, this.scene);
        this.healthBarOutlineMesh.position = new Vector3(this.position.x, this.position.y + 1.8, this.position.z);
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
        this.healthBarBackgroundMesh.position = new Vector3(this.position.x, this.position.y + 1.8, this.position.z);
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
        this.healthBarMesh.position = new Vector3(this.position.x, this.position.y + 1.8, this.position.z);
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
     * Override the updateHealthBar method for splitting enemies
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
            this.healthBarOutlineMesh.position.y = this.position.y + 1.8;
            this.healthBarOutlineMesh.position.z = this.position.z;
        }

        this.healthBarBackgroundMesh.position.x = this.position.x;
        this.healthBarBackgroundMesh.position.y = this.position.y + 1.8;
        this.healthBarBackgroundMesh.position.z = this.position.z;

        this.healthBarMesh.position.y = this.position.y + 1.8;
        this.healthBarMesh.position.z = this.position.z;
    }

    /**
     * Update the enemy with multi-headed swaying animation
     * @param deltaTime Time elapsed since last update in seconds
     * @returns True if the enemy reached the end of the path
     */
    public update(deltaTime: number): boolean {
        if (!this.alive || !this.mesh) return false;

        // Get the result from the parent update method
        const result = super.update(deltaTime);

        // Update walking animation
        if (!this.isFrozen && !this.isStunned && this.currentPathIndex < this.path.length && this.mesh) {
            this.walkTime += deltaTime * 5;

            // Body sway: side-to-side rock and vertical bob
            const bobAmount = Math.abs(Math.sin(this.walkTime)) * 0.05;
            const swayAmount = Math.sin(this.walkTime * 0.6) * 0.06;
            this.mesh.position.y = this.position.y + 0.40 + bobAmount;
            this.mesh.rotation.z = swayAmount;

            // Legs: alternating waddle stride
            if (this.leftLeg) {
                this.leftLeg.rotation.x = Math.sin(this.walkTime) * 0.4;
            }
            if (this.rightLeg) {
                this.rightLeg.rotation.x = Math.sin(this.walkTime + Math.PI) * 0.4;
            }
            if (this.backLeg) {
                this.backLeg.rotation.x = Math.sin(this.walkTime + Math.PI / 2) * 0.3;
            }

            // Heads bob independently at different frequencies
            if (this.headCenter) {
                this.headCenter.rotation.x = Math.sin(this.walkTime * 1.2) * 0.10;
                this.headCenter.rotation.y = Math.sin(this.walkTime * 0.7) * 0.08;
            }
            if (this.headLeft) {
                this.headLeft.rotation.x = Math.sin(this.walkTime * 1.0 + 1.0) * 0.12;
                this.headLeft.rotation.y = Math.sin(this.walkTime * 0.9 + 0.5) * 0.10;
            }
            if (this.headRight) {
                this.headRight.rotation.x = Math.sin(this.walkTime * 1.1 + 2.0) * 0.12;
                this.headRight.rotation.y = Math.sin(this.walkTime * 0.8 + 1.5) * 0.10;
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
     * Create a death effect - dispatch split event AND particle burst
     */
    protected createDeathEffect(): void {
        // Dispatch the split event so EnemyManager can spawn mini enemies
        const remainingPath = this.path.slice(this.currentPathIndex);
        const splitEvent = new CustomEvent('enemySplit', {
            detail: {
                position: this.position.clone(),
                path: remainingPath,
                count: 3
            }
        });
        document.dispatchEvent(splitEvent);

        // Call parent for the standard particle burst + gold text
        super.createDeathEffect();

        // Play sound effect
        this.game.getAssetManager().playSound('enemyDeath');
    }
}
