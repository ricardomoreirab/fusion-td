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

    constructor(game: Game, position: Vector3, path: Vector3[]) {
        // Fast enemy has 2x speed, low health, low damage, and medium reward
        super(game, position, path, 6, 20, 5, 15);

        // Set as a flying enemy
        this.isFlying = true;
    }

    /**
     * Create the enemy mesh - low-poly stylized flying creature
     * ~8 parts: thin box body, 2 flat box wings, small box head, 2 emissive eye dots, tail box, back fin
     */
    protected createMesh(): void {
        // Main body - thin box
        this.mesh = MeshBuilder.CreateBox('fastEnemyBody', {
            width: 0.4,
            height: 0.9,
            depth: 0.35
        }, this.scene);
        makeFlatShaded(this.mesh);

        // Position at starting position, raised for flying
        this.mesh.position = this.position.clone();
        this.mesh.position.y += 1.2;

        const bodyMat = createLowPolyMaterial('fastBodyMat', PALETTE.ENEMY_FAST, this.scene);
        this.mesh.material = bodyMat;

        // Head - small box
        this.head = MeshBuilder.CreateBox('fastHead', {
            width: 0.3,
            height: 0.3,
            depth: 0.35
        }, this.scene);
        makeFlatShaded(this.head);
        this.head.parent = this.mesh;
        this.head.position = new Vector3(0, 0.55, 0.05);
        this.head.material = createLowPolyMaterial('fastHeadMat', PALETTE.ENEMY_FAST, this.scene);

        // Left eye - small emissive box
        const leftEye = MeshBuilder.CreateBox('fastLeftEye', {
            width: 0.08,
            height: 0.06,
            depth: 0.04
        }, this.scene);
        makeFlatShaded(leftEye);
        leftEye.parent = this.head;
        leftEye.position = new Vector3(-0.1, 0.04, 0.18);
        leftEye.material = createEmissiveMaterial('fastLeftEyeMat', new Color3(1, 0.2, 0.2), 0.9, this.scene);

        // Right eye - small emissive box
        const rightEye = MeshBuilder.CreateBox('fastRightEye', {
            width: 0.08,
            height: 0.06,
            depth: 0.04
        }, this.scene);
        makeFlatShaded(rightEye);
        rightEye.parent = this.head;
        rightEye.position = new Vector3(0.1, 0.04, 0.18);
        rightEye.material = createEmissiveMaterial('fastRightEyeMat', new Color3(1, 0.2, 0.2), 0.9, this.scene);

        // Left wing - flat box
        this.leftWing = MeshBuilder.CreateBox('fastLeftWing', {
            width: 0.8,
            height: 0.06,
            depth: 0.5
        }, this.scene);
        makeFlatShaded(this.leftWing);
        this.leftWing.parent = this.mesh;
        this.leftWing.position = new Vector3(-0.55, 0.15, 0);
        this.leftWing.rotation.z = Math.PI / 8;
        this.leftWing.material = createLowPolyMaterial('fastLeftWingMat', PALETTE.ENEMY_FAST_WING, this.scene);

        // Right wing - flat box
        this.rightWing = MeshBuilder.CreateBox('fastRightWing', {
            width: 0.8,
            height: 0.06,
            depth: 0.5
        }, this.scene);
        makeFlatShaded(this.rightWing);
        this.rightWing.parent = this.mesh;
        this.rightWing.position = new Vector3(0.55, 0.15, 0);
        this.rightWing.rotation.z = -Math.PI / 8;
        this.rightWing.material = createLowPolyMaterial('fastRightWingMat', PALETTE.ENEMY_FAST_WING, this.scene);

        // Tail fin - small angled box
        const tail = MeshBuilder.CreateBox('fastTail', {
            width: 0.15,
            height: 0.3,
            depth: 0.25
        }, this.scene);
        makeFlatShaded(tail);
        tail.parent = this.mesh;
        tail.position = new Vector3(0, -0.35, -0.22);
        tail.rotation.x = -0.3;
        tail.material = createLowPolyMaterial('fastTailMat', PALETTE.ENEMY_FAST_WING, this.scene);

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
     * Update the enemy with flying animation
     * @param deltaTime Time elapsed since last update in seconds
     * @returns True if the enemy reached the end of the path
     */
    public update(deltaTime: number): boolean {
        if (!this.alive || !this.mesh) return false;

        // Get the result from the parent update method
        const result = super.update(deltaTime);

        // Update flying animation
        if (!this.isFrozen && !this.isStunned && this.currentPathIndex < this.path.length) {
            this.flyTime += deltaTime * 8; // Control animation speed

            // Floating movement - make it hover up and down
            if (this.mesh) {
                this.mesh.position.y = this.position.y + 1.2 + Math.sin(this.flyTime * 0.5) * 0.2;
            }

            // Flap wings
            if (this.leftWing && this.rightWing) {
                this.leftWing.rotation.z = Math.PI / 8 + Math.sin(this.flyTime) * 0.5;
                this.rightWing.rotation.z = -Math.PI / 8 - Math.sin(this.flyTime) * 0.5;
            }

            // Move head slightly
            if (this.head) {
                this.head.rotation.x = Math.sin(this.flyTime * 0.3) * 0.1;
                this.head.rotation.y = Math.sin(this.flyTime * 0.5) * 0.1;
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

        // Call the parent method to create the base death effect
        super.createDeathEffect();

        // Play a special sound for fast enemy death
        this.game.getAssetManager().playSound('enemyDeath');
    }
}
