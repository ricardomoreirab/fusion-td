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
     * Create the enemy mesh - low-poly stylized humanoid monster
     * ~10 parts: box body, box head, 2 emissive eye boxes, 2 cone horns, 2 arm boxes, 2 leg boxes
     */
    protected createMesh(): void {
        // Main body - box torso
        this.mesh = MeshBuilder.CreateBox('basicEnemyBody', {
            width: 0.7,
            height: 1.0,
            depth: 0.5
        }, this.scene);
        makeFlatShaded(this.mesh);

        // Position at starting position, raised for height
        this.mesh.position = this.position.clone();
        this.mesh.position.y += 0.7;

        const bodyMat = createLowPolyMaterial('basicBodyMat', PALETTE.ENEMY_BASIC, this.scene);
        this.mesh.material = bodyMat;

        // Head - box
        this.head = MeshBuilder.CreateBox('basicHead', {
            width: 0.55,
            height: 0.55,
            depth: 0.55
        }, this.scene);
        makeFlatShaded(this.head);
        this.head.parent = this.mesh;
        this.head.position = new Vector3(0, 0.75, 0);
        this.head.material = createLowPolyMaterial('basicHeadMat', PALETTE.ENEMY_BASIC, this.scene);

        // Left eye - emissive box
        const leftEye = MeshBuilder.CreateBox('basicLeftEye', {
            width: 0.12,
            height: 0.10,
            depth: 0.06
        }, this.scene);
        makeFlatShaded(leftEye);
        leftEye.parent = this.head;
        leftEye.position = new Vector3(-0.15, 0.08, 0.28);
        leftEye.material = createEmissiveMaterial('basicLeftEyeMat', new Color3(1, 0.9, 0.2), 0.8, this.scene);

        // Right eye - emissive box
        const rightEye = MeshBuilder.CreateBox('basicRightEye', {
            width: 0.12,
            height: 0.10,
            depth: 0.06
        }, this.scene);
        makeFlatShaded(rightEye);
        rightEye.parent = this.head;
        rightEye.position = new Vector3(0.15, 0.08, 0.28);
        rightEye.material = createEmissiveMaterial('basicRightEyeMat', new Color3(1, 0.9, 0.2), 0.8, this.scene);

        // Left horn - cone (triangle shape)
        const leftHorn = MeshBuilder.CreateCylinder('basicLeftHorn', {
            height: 0.35,
            diameterTop: 0.0,
            diameterBottom: 0.12,
            tessellation: 4
        }, this.scene);
        makeFlatShaded(leftHorn);
        leftHorn.parent = this.head;
        leftHorn.position = new Vector3(-0.22, 0.32, 0);
        leftHorn.rotation.z = -0.3;
        leftHorn.material = createLowPolyMaterial('basicLeftHornMat', PALETTE.ENEMY_BASIC_HORN, this.scene);

        // Right horn - cone (triangle shape)
        const rightHorn = MeshBuilder.CreateCylinder('basicRightHorn', {
            height: 0.35,
            diameterTop: 0.0,
            diameterBottom: 0.12,
            tessellation: 4
        }, this.scene);
        makeFlatShaded(rightHorn);
        rightHorn.parent = this.head;
        rightHorn.position = new Vector3(0.22, 0.32, 0);
        rightHorn.rotation.z = 0.3;
        rightHorn.material = createLowPolyMaterial('basicRightHornMat', PALETTE.ENEMY_BASIC_HORN, this.scene);

        // Left arm - box limb
        this.leftArm = MeshBuilder.CreateBox('basicLeftArm', {
            width: 0.18,
            height: 0.7,
            depth: 0.18
        }, this.scene);
        makeFlatShaded(this.leftArm);
        this.leftArm.parent = this.mesh;
        this.leftArm.position = new Vector3(-0.45, 0.1, 0);
        this.leftArm.material = createLowPolyMaterial('basicLeftArmMat', PALETTE.ENEMY_BASIC_HORN, this.scene);

        // Right arm - box limb
        this.rightArm = MeshBuilder.CreateBox('basicRightArm', {
            width: 0.18,
            height: 0.7,
            depth: 0.18
        }, this.scene);
        makeFlatShaded(this.rightArm);
        this.rightArm.parent = this.mesh;
        this.rightArm.position = new Vector3(0.45, 0.1, 0);
        this.rightArm.material = createLowPolyMaterial('basicRightArmMat', PALETTE.ENEMY_BASIC_HORN, this.scene);

        // Left leg - box limb
        this.leftLeg = MeshBuilder.CreateBox('basicLeftLeg', {
            width: 0.2,
            height: 0.7,
            depth: 0.2
        }, this.scene);
        makeFlatShaded(this.leftLeg);
        this.leftLeg.parent = this.mesh;
        this.leftLeg.position = new Vector3(-0.2, -0.8, 0);
        this.leftLeg.material = createLowPolyMaterial('basicLeftLegMat', PALETTE.ENEMY_BASIC_HORN, this.scene);

        // Right leg - box limb
        this.rightLeg = MeshBuilder.CreateBox('basicRightLeg', {
            width: 0.2,
            height: 0.7,
            depth: 0.2
        }, this.scene);
        makeFlatShaded(this.rightLeg);
        this.rightLeg.parent = this.mesh;
        this.rightLeg.position = new Vector3(0.2, -0.8, 0);
        this.rightLeg.material = createLowPolyMaterial('basicRightLegMat', PALETTE.ENEMY_BASIC_HORN, this.scene);

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
     * Update the enemy with walking animation
     * @param deltaTime Time elapsed since last update in seconds
     * @returns True if the enemy reached the end of the path
     */
    public update(deltaTime: number): boolean {
        if (!this.alive || !this.mesh) return false;

        // Get the result from the parent update method
        const result = super.update(deltaTime);

        // Update walking animation
        if (!this.isFrozen && !this.isStunned && this.currentPathIndex < this.path.length && this.mesh) {
            this.walkTime += deltaTime * 5; // Control animation speed

            // Bob up and down slightly
            this.mesh.position.y = this.position.y + 0.7 + Math.abs(Math.sin(this.walkTime)) * 0.05;

            // Move legs
            if (this.leftLeg && this.rightLeg) {
                this.leftLeg.rotation.x = Math.sin(this.walkTime) * 0.4;
                this.rightLeg.rotation.x = Math.sin(this.walkTime + Math.PI) * 0.4;
            }

            // Swing arms
            if (this.leftArm && this.rightArm) {
                this.leftArm.rotation.x = Math.sin(this.walkTime + Math.PI) * 0.4;
                this.rightArm.rotation.x = Math.sin(this.walkTime) * 0.4;
            }

            // Slight head movement
            if (this.head) {
                this.head.rotation.y = Math.sin(this.walkTime * 0.5) * 0.1;
            }

            // If we're moving, rotate the mesh to face the direction of movement
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

        // Set particle properties
        particleSystem.color1 = new Color4(1, 0.5, 0, 1.0);
        particleSystem.color2 = new Color4(1, 0, 0, 1.0);
        particleSystem.colorDead = new Color4(0, 0, 0, 0.0);

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
