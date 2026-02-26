import { Vector3, MeshBuilder, StandardMaterial, Color3, Mesh } from '@babylonjs/core';
import { Game } from '../../Game';
import { Enemy } from './Enemy';
import { createLowPolyMaterial, createEmissiveMaterial, makeFlatShaded } from '../../rendering/LowPolyMaterial';
import { PALETTE } from '../../rendering/StyleConstants';

export class TankEnemy extends Enemy {
    private stompTime: number = 0;
    private rocks: Mesh[] = [];
    private legs: Mesh[] = [];
    private mandibleLeft: Mesh | null = null;
    private mandibleRight: Mesh | null = null;
    private shellTop: Mesh | null = null;

    constructor(game: Game, position: Vector3, path: Vector3[]) {
        // Tank enemy has low speed, 5x health, high damage, and high reward
        super(game, position, path, 1.5, 150, 20, 30);

        // Set as a heavy enemy type
        this.isHeavy = true;
    }

    /**
     * Create the enemy mesh - low-poly Ironclad Beetle
     * Massive armored insect: domed shell on top, segmented body underneath,
     * 6 short legs, two large mandibles, glowing amber thorax vents, armored plates
     */
    protected createMesh(): void {
        // Ensure arrays are initialized
        this.rocks = [];
        this.legs = [];

        // --- Main body: wide squat box (beetle thorax) ---
        this.mesh = MeshBuilder.CreateBox('tankEnemyBody', {
            width: 1.30,
            height: 0.55,
            depth: 1.10
        }, this.scene);
        makeFlatShaded(this.mesh);
        this.mesh.position = this.position.clone();
        this.mesh.position.y += 0.35;
        this.mesh.material = createLowPolyMaterial('tankBodyMat', PALETTE.ENEMY_TANK, this.scene);

        // --- Domed shell: large flattened polyhedron on top ---
        this.shellTop = MeshBuilder.CreatePolyhedron('tankShell', {
            type: 2, // Icosahedron
            size: 0.55
        }, this.scene);
        makeFlatShaded(this.shellTop);
        this.shellTop.parent = this.mesh;
        this.shellTop.position = new Vector3(0, 0.35, -0.05);
        this.shellTop.scaling = new Vector3(1.20, 0.50, 1.05); // Wide and flat dome
        this.shellTop.material = createLowPolyMaterial('tankShellMat', PALETTE.ENEMY_TANK_SHELL, this.scene);

        // --- Shell ridge plates: 3 boxes along the top of the shell ---
        for (let i = 0; i < 3; i++) {
            const ridge = MeshBuilder.CreateBox(`tankRidge${i}`, {
                width: 0.12,
                height: 0.10,
                depth: 0.28
            }, this.scene);
            makeFlatShaded(ridge);
            ridge.parent = this.shellTop;
            ridge.position = new Vector3(0, 0.28, -0.25 + i * 0.25);
            ridge.material = createLowPolyMaterial(`tankRidgeMat${i}`, PALETTE.ENEMY_TANK, this.scene);
            this.rocks.push(ridge);
        }

        // --- Head: smaller box protruding forward ---
        const head = MeshBuilder.CreateBox('tankHead', {
            width: 0.60,
            height: 0.35,
            depth: 0.40
        }, this.scene);
        makeFlatShaded(head);
        head.parent = this.mesh;
        head.position = new Vector3(0, 0.05, 0.65);
        head.material = createLowPolyMaterial('tankHeadMat', PALETTE.ENEMY_TANK, this.scene);

        // --- Eyes: two emissive amber orbs ---
        const leftEye = MeshBuilder.CreateSphere('tankLeftEye', {
            diameter: 0.12,
            segments: 4
        }, this.scene);
        makeFlatShaded(leftEye);
        leftEye.parent = head;
        leftEye.position = new Vector3(-0.20, 0.08, 0.18);
        leftEye.material = createEmissiveMaterial('tankLeftEyeMat', PALETTE.ENEMY_TANK_AMBER, 1.0, this.scene);

        const rightEye = MeshBuilder.CreateSphere('tankRightEye', {
            diameter: 0.12,
            segments: 4
        }, this.scene);
        makeFlatShaded(rightEye);
        rightEye.parent = head;
        rightEye.position = new Vector3(0.20, 0.08, 0.18);
        rightEye.material = createEmissiveMaterial('tankRightEyeMat', PALETTE.ENEMY_TANK_AMBER, 1.0, this.scene);

        // --- Mandibles: two curved cone shapes flanking the head ---
        this.mandibleLeft = MeshBuilder.CreateCylinder('tankMandibleL', {
            height: 0.40,
            diameterTop: 0.0,
            diameterBottom: 0.12,
            tessellation: 4
        }, this.scene);
        makeFlatShaded(this.mandibleLeft);
        this.mandibleLeft.parent = head;
        this.mandibleLeft.position = new Vector3(-0.28, -0.08, 0.25);
        this.mandibleLeft.rotation.x = Math.PI / 2.2;
        this.mandibleLeft.rotation.z = 0.4;
        this.mandibleLeft.material = createLowPolyMaterial('tankMandibleLMat', PALETTE.ENEMY_TANK_MANDIBLE, this.scene);

        this.mandibleRight = MeshBuilder.CreateCylinder('tankMandibleR', {
            height: 0.40,
            diameterTop: 0.0,
            diameterBottom: 0.12,
            tessellation: 4
        }, this.scene);
        makeFlatShaded(this.mandibleRight);
        this.mandibleRight.parent = head;
        this.mandibleRight.position = new Vector3(0.28, -0.08, 0.25);
        this.mandibleRight.rotation.x = Math.PI / 2.2;
        this.mandibleRight.rotation.z = -0.4;
        this.mandibleRight.material = createLowPolyMaterial('tankMandibleRMat', PALETTE.ENEMY_TANK_MANDIBLE, this.scene);

        // --- Antennae: two thin cones on top of head ---
        const leftAntenna = MeshBuilder.CreateCylinder('tankAntennaL', {
            height: 0.35,
            diameterTop: 0.0,
            diameterBottom: 0.04,
            tessellation: 3
        }, this.scene);
        makeFlatShaded(leftAntenna);
        leftAntenna.parent = head;
        leftAntenna.position = new Vector3(-0.15, 0.18, 0.10);
        leftAntenna.rotation.x = -0.4;
        leftAntenna.rotation.z = -0.3;
        leftAntenna.material = createLowPolyMaterial('tankAntennaLMat', PALETTE.ENEMY_TANK_LEG, this.scene);

        const rightAntenna = MeshBuilder.CreateCylinder('tankAntennaR', {
            height: 0.35,
            diameterTop: 0.0,
            diameterBottom: 0.04,
            tessellation: 3
        }, this.scene);
        makeFlatShaded(rightAntenna);
        rightAntenna.parent = head;
        rightAntenna.position = new Vector3(0.15, 0.18, 0.10);
        rightAntenna.rotation.x = -0.4;
        rightAntenna.rotation.z = 0.3;
        rightAntenna.material = createLowPolyMaterial('tankAntennaRMat', PALETTE.ENEMY_TANK_LEG, this.scene);

        // --- 6 Legs: 3 per side, box segments ---
        const legSide = [-1, 1]; // Left (-1) and Right (1)
        const legZOffsets = [0.30, 0.0, -0.30]; // Front, Mid, Back

        for (const side of legSide) {
            for (let i = 0; i < legZOffsets.length; i++) {
                // Upper leg segment
                const upperLeg = MeshBuilder.CreateBox(`tankLeg_${side}_${i}`, {
                    width: 0.35,
                    height: 0.10,
                    depth: 0.10
                }, this.scene);
                makeFlatShaded(upperLeg);
                upperLeg.parent = this.mesh;
                upperLeg.position = new Vector3(
                    side * 0.65,
                    -0.15,
                    legZOffsets[i]
                );
                upperLeg.rotation.z = side * 0.3; // Angle outward
                upperLeg.material = createLowPolyMaterial(`tankLegMat_${side}_${i}`, PALETTE.ENEMY_TANK_LEG, this.scene);

                // Lower leg segment (foot)
                const foot = MeshBuilder.CreateBox(`tankFoot_${side}_${i}`, {
                    width: 0.08,
                    height: 0.20,
                    depth: 0.08
                }, this.scene);
                makeFlatShaded(foot);
                foot.parent = upperLeg;
                foot.position = new Vector3(side * 0.18, -0.12, 0);
                foot.material = createLowPolyMaterial(`tankFootMat_${side}_${i}`, PALETTE.ENEMY_TANK_LEG, this.scene);

                this.legs.push(upperLeg);
            }
        }

        // --- Thorax glow vents: 2 emissive amber slits on the sides ---
        const leftVent = MeshBuilder.CreateBox('tankVentL', {
            width: 0.06,
            height: 0.06,
            depth: 0.35
        }, this.scene);
        makeFlatShaded(leftVent);
        leftVent.parent = this.mesh;
        leftVent.position = new Vector3(-0.66, 0.10, 0);
        leftVent.material = createEmissiveMaterial('tankVentLMat', PALETTE.ENEMY_TANK_AMBER, 0.8, this.scene);

        const rightVent = MeshBuilder.CreateBox('tankVentR', {
            width: 0.06,
            height: 0.06,
            depth: 0.35
        }, this.scene);
        makeFlatShaded(rightVent);
        rightVent.parent = this.mesh;
        rightVent.position = new Vector3(0.66, 0.10, 0);
        rightVent.material = createEmissiveMaterial('tankVentRMat', PALETTE.ENEMY_TANK_AMBER, 0.8, this.scene);

        // --- Rear plate: angled box at the back ---
        const rearPlate = MeshBuilder.CreateBox('tankRear', {
            width: 0.80,
            height: 0.25,
            depth: 0.10
        }, this.scene);
        makeFlatShaded(rearPlate);
        rearPlate.parent = this.mesh;
        rearPlate.position = new Vector3(0, 0.10, -0.58);
        rearPlate.rotation.x = -0.3;
        rearPlate.material = createLowPolyMaterial('tankRearMat', PALETTE.ENEMY_TANK_SHELL, this.scene);

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
     * Update the enemy with beetle scuttling animation
     * @param deltaTime Time elapsed since last update in seconds
     * @returns True if the enemy reached the end of the path
     */
    public update(deltaTime: number): boolean {
        if (!this.alive || !this.mesh) return false;

        // Get the result from the parent update method
        const result = super.update(deltaTime);

        // Update scuttling animation
        if (!this.isFrozen && !this.isStunned && this.currentPathIndex < this.path.length) {
            this.stompTime += deltaTime * 4; // Moderate speed for heavy scuttling

            if (this.mesh) {
                // Heavy body: slow vertical stomp with slight forward pitch
                const verticalStomp = Math.abs(Math.sin(this.stompTime * 2)) * 0.08;
                this.mesh.position.y = this.position.y + 0.35 + verticalStomp;

                // Slight body pitch forward and back (like a charging beetle)
                this.mesh.rotation.x = Math.sin(this.stompTime) * 0.04;

                // Minimal side-to-side rock
                this.mesh.rotation.z = Math.sin(this.stompTime * 0.5) * 0.03;
            }

            // Animate 6 legs: alternating tripod gait (left-front, right-mid, left-back move together)
            for (let i = 0; i < this.legs.length; i++) {
                const leg = this.legs[i];
                // Even-indexed legs (left-front, right-mid, left-back) vs odd-indexed
                const phase = (i % 2 === 0) ? 0 : Math.PI;
                // Legs pump up and down and rotate slightly
                leg.rotation.z = leg.position.x > 0
                    ? -0.3 + Math.sin(this.stompTime * 3 + phase) * 0.20
                    : 0.3 + Math.sin(this.stompTime * 3 + phase) * 0.20;
            }

            // Mandibles: open-close clacking
            if (this.mandibleLeft && this.mandibleRight) {
                const clack = Math.sin(this.stompTime * 2.5) * 0.15;
                this.mandibleLeft.rotation.z = 0.4 + clack;
                this.mandibleRight.rotation.z = -0.4 - clack;
            }

            // Shell ridge plates: subtle vibration
            for (let i = 0; i < this.rocks.length; i++) {
                const ridge = this.rocks[i];
                ridge.position.y = 0.28 + Math.sin(this.stompTime * 3 + i * 1.5) * 0.008;
            }

            // Shell: very subtle breathing
            if (this.shellTop) {
                this.shellTop.scaling.y = 0.50 + Math.sin(this.stompTime * 1.5) * 0.02;
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
