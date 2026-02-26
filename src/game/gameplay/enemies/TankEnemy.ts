import { Vector3, MeshBuilder, StandardMaterial, Color3, Mesh } from '@babylonjs/core';
import { Game } from '../../Game';
import { Enemy } from './Enemy';
import { createLowPolyMaterial, createEmissiveMaterial, makeFlatShaded } from '../../rendering/LowPolyMaterial';
import { PALETTE } from '../../rendering/StyleConstants';

export class TankEnemy extends Enemy {
    private stompTime: number = 0;
    private rocks: Mesh[] = [];

    constructor(game: Game, position: Vector3, path: Vector3[]) {
        // Tank enemy has low speed, 5x health, high damage, and high reward
        super(game, position, path, 1.5, 150, 20, 30);

        // Set as a heavy enemy type
        this.isHeavy = true;
    }

    /**
     * Create the enemy mesh - low-poly stylized rock golem
     * ~12 parts: large box body, 4-5 polyhedron rocks on surface, 2 emissive crack boxes, shoulder spike polyhedrons, eyes
     */
    protected createMesh(): void {
        // Ensure arrays are initialized
        this.rocks = [];

        // Main body - large box
        this.mesh = MeshBuilder.CreateBox('tankEnemyBody', {
            width: 1.2,
            height: 1.0,
            depth: 1.3
        }, this.scene);
        makeFlatShaded(this.mesh);

        // Position at starting position
        this.mesh.position = this.position.clone();

        const bodyMat = createLowPolyMaterial('tankBodyMat', PALETTE.ENEMY_TANK, this.scene);
        this.mesh.material = bodyMat;

        // Surface rocks (4-5 polyhedrons)
        const rockPositions = [
            new Vector3(-0.5, 0.45, 0.3),
            new Vector3(0.4, 0.5, -0.2),
            new Vector3(-0.3, 0.48, -0.5),
            new Vector3(0.5, 0.3, 0.4),
            new Vector3(0, 0.52, 0.5)
        ];

        for (let i = 0; i < rockPositions.length; i++) {
            const rock = MeshBuilder.CreatePolyhedron(`tankRock${i}`, {
                type: 1, // Octahedron - chunky look
                size: 0.12 + Math.random() * 0.08
            }, this.scene);
            makeFlatShaded(rock);
            rock.parent = this.mesh;
            rock.position = rockPositions[i];
            rock.rotation = new Vector3(
                Math.random() * Math.PI,
                Math.random() * Math.PI,
                Math.random() * Math.PI
            );
            rock.material = createLowPolyMaterial(`tankRockMat${i}`, PALETTE.ENEMY_TANK_ROCK, this.scene);
            this.rocks.push(rock);
        }

        // Glowing crack boxes (2 emissive)
        const crackPositions = [
            { pos: new Vector3(0.2, 0.1, 0.65), rot: new Vector3(0, 0.3, 0.1) },
            { pos: new Vector3(-0.4, -0.1, 0.6), rot: new Vector3(0.2, -0.1, 0.3) }
        ];

        for (let i = 0; i < crackPositions.length; i++) {
            const crack = MeshBuilder.CreateBox(`tankCrack${i}`, {
                width: 0.3 + Math.random() * 0.15,
                height: 0.04,
                depth: 0.06
            }, this.scene);
            makeFlatShaded(crack);
            crack.parent = this.mesh;
            crack.position = crackPositions[i].pos;
            crack.rotation = crackPositions[i].rot;
            crack.material = createEmissiveMaterial(`tankCrackMat${i}`, new Color3(0.9, 0.4, 0.05), 0.7, this.scene);
        }

        // Shoulder spike polyhedrons (left and right)
        const leftSpike = MeshBuilder.CreatePolyhedron('tankLeftSpike', {
            type: 2, // Icosahedron
            size: 0.15
        }, this.scene);
        makeFlatShaded(leftSpike);
        leftSpike.parent = this.mesh;
        leftSpike.position = new Vector3(-0.65, 0.35, 0);
        leftSpike.scaling = new Vector3(0.6, 1.4, 0.6); // Stretch vertically into spike shape
        leftSpike.material = createLowPolyMaterial('tankLeftSpikeMat', PALETTE.ENEMY_TANK_ROCK, this.scene);

        const rightSpike = MeshBuilder.CreatePolyhedron('tankRightSpike', {
            type: 2, // Icosahedron
            size: 0.15
        }, this.scene);
        makeFlatShaded(rightSpike);
        rightSpike.parent = this.mesh;
        rightSpike.position = new Vector3(0.65, 0.35, 0);
        rightSpike.scaling = new Vector3(0.6, 1.4, 0.6);
        rightSpike.material = createLowPolyMaterial('tankRightSpikeMat', PALETTE.ENEMY_TANK_ROCK, this.scene);

        // Eyes - emissive
        const leftEye = MeshBuilder.CreateBox('tankLeftEye', {
            width: 0.15,
            height: 0.10,
            depth: 0.06
        }, this.scene);
        makeFlatShaded(leftEye);
        leftEye.parent = this.mesh;
        leftEye.position = new Vector3(-0.3, 0.2, 0.66);
        leftEye.material = createEmissiveMaterial('tankLeftEyeMat', new Color3(1, 0.5, 0), 0.9, this.scene);

        const rightEye = MeshBuilder.CreateBox('tankRightEye', {
            width: 0.15,
            height: 0.10,
            depth: 0.06
        }, this.scene);
        makeFlatShaded(rightEye);
        rightEye.parent = this.mesh;
        rightEye.position = new Vector3(0.3, 0.2, 0.66);
        rightEye.material = createEmissiveMaterial('tankRightEyeMat', new Color3(1, 0.5, 0), 0.9, this.scene);

        // Store original scale
        this.originalScale = 1.0;
    }

    /**
     * Override the health bar creation for tank enemies (wider bar)
     */
    protected createHealthBar(): void {
        if (!this.mesh) return;

        // Outline
        this.healthBarOutlineMesh = MeshBuilder.CreateBox('healthBarOutline', {
            width: 1.58,
            height: 0.14,
            depth: 0.04
        }, this.scene);
        this.healthBarOutlineMesh.position = new Vector3(this.position.x, this.position.y + 1.2, this.position.z);
        const outlineMat = new StandardMaterial('healthBarOutlineMat', this.scene);
        outlineMat.diffuseColor = new Color3(0, 0, 0);
        outlineMat.specularColor = Color3.Black();
        this.healthBarOutlineMesh.material = outlineMat;

        // Background bar
        this.healthBarBackgroundMesh = MeshBuilder.CreateBox('healthBarBg', {
            width: 1.5,
            height: 0.08,
            depth: 0.05
        }, this.scene);
        this.healthBarBackgroundMesh.position = new Vector3(this.position.x, this.position.y + 1.2, this.position.z);
        const bgMat = new StandardMaterial('healthBarBgMat', this.scene);
        bgMat.diffuseColor = new Color3(0.3, 0.3, 0.3);
        bgMat.specularColor = Color3.Black();
        this.healthBarBackgroundMesh.material = bgMat;

        // Health bar
        this.healthBarMesh = MeshBuilder.CreateBox('healthBar', {
            width: 1.5,
            height: 0.08,
            depth: 0.06
        }, this.scene);
        this.healthBarMesh.position = new Vector3(this.position.x, this.position.y + 1.2, this.position.z);
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
     * Override the updateHealthBar method for tank enemies
     */
    protected updateHealthBar(): void {
        if (!this.mesh || !this.healthBarMesh || !this.healthBarBackgroundMesh) return;

        const healthPercent = Math.max(0, this.health / this.maxHealth);

        this.healthBarMesh.scaling.x = healthPercent;

        const offset = (1 - healthPercent) * 0.75; // Adjusted for wider bar (1.5 width)
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
            this.healthBarOutlineMesh.position.y = this.position.y + 1.2;
            this.healthBarOutlineMesh.position.z = this.position.z;
        }

        this.healthBarBackgroundMesh.position.x = this.position.x;
        this.healthBarBackgroundMesh.position.y = this.position.y + 1.2;
        this.healthBarBackgroundMesh.position.z = this.position.z;

        this.healthBarMesh.position.y = this.position.y + 1.2;
        this.healthBarMesh.position.z = this.position.z;
    }

    /**
     * Update the enemy with stomping animation
     * @param deltaTime Time elapsed since last update in seconds
     * @returns True if the enemy reached the end of the path
     */
    public update(deltaTime: number): boolean {
        if (!this.alive || !this.mesh) return false;

        // Get the result from the parent update method
        const result = super.update(deltaTime);

        // Update stomping animation
        if (!this.isFrozen && !this.isStunned && this.currentPathIndex < this.path.length) {
            this.stompTime += deltaTime * 3; // Control animation speed - slower for tank

            // Heavy stomping movement
            if (this.mesh) {
                // Vertical movement - heavy up and down
                const verticalOffset = Math.abs(Math.sin(this.stompTime)) * 0.15;
                this.mesh.position.y = this.position.y + verticalOffset;

                // Slight tilt as it walks
                this.mesh.rotation.z = Math.sin(this.stompTime * 0.5) * 0.05;

                // Slight rotation as it walks
                this.mesh.rotation.x = Math.sin(this.stompTime) * 0.03;
            }

            // Animate rocks - make them shake slightly
            for (let i = 0; i < this.rocks.length; i++) {
                const rock = this.rocks[i];
                rock.position.y += Math.sin(this.stompTime * 2 + i) * 0.002;
                rock.rotation.y += Math.sin(this.stompTime + i) * 0.01;
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
     * Apply damage to the enemy with innate tank damage reduction
     * @param amount The amount of damage to apply
     * @returns True if the enemy died from this damage
     */
    public takeDamage(amount: number): boolean {
        // Tank enemies have innate 20% damage reduction (reduced from 30% for fairness)
        const tankReduction = amount * 0.2; // 20% damage reduction
        const reducedAmount = amount - tankReduction;

        // Let the parent class handle additional resistance from difficulty
        return super.takeDamage(reducedAmount);
    }

    /**
     * Create a death effect
     */
    protected createDeathEffect(): void {
        if (!this.mesh) return;

        // Call the parent method to create the base death effect
        super.createDeathEffect();

        // Play a special sound for tank enemy death
        this.game.getAssetManager().playSound('enemyDeath');
    }
}
