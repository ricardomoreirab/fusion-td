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
     * Create the enemy mesh - low-poly stylized boss
     * ~14 parts: hexagonal pillar body (tessellation: 6), faceted polyhedron head,
     * thick box limbs (2 arms, 2 legs), back spike polyhedrons, eyes, shoulder plates
     */
    protected createMesh(): void {
        // Main body - hexagonal pillar (cylinder with tessellation: 6)
        this.mesh = MeshBuilder.CreateCylinder('bossBody', {
            height: 2.8,
            diameterTop: 1.3,
            diameterBottom: 1.6,
            tessellation: 6
        }, this.scene);
        makeFlatShaded(this.mesh);

        // Position at starting position, raised for height
        this.mesh.position = this.position.clone();
        this.mesh.position.y += 1.0;

        const bodyMat = createLowPolyMaterial('bossBodyMat', PALETTE.ENEMY_BOSS, this.scene);
        this.mesh.material = bodyMat;

        // Head - faceted polyhedron (icosahedron for faceted look)
        this.head = MeshBuilder.CreatePolyhedron('bossHead', {
            type: 2, // Icosahedron
            size: 0.55
        }, this.scene);
        makeFlatShaded(this.head);
        this.head.parent = this.mesh;
        this.head.position = new Vector3(0, 1.7, 0);
        this.head.material = createLowPolyMaterial('bossHeadMat', PALETTE.ENEMY_BOSS, this.scene);

        // Left eye - emissive box
        const leftEye = MeshBuilder.CreateBox('bossLeftEye', {
            width: 0.18,
            height: 0.10,
            depth: 0.06
        }, this.scene);
        makeFlatShaded(leftEye);
        leftEye.parent = this.head;
        leftEye.position = new Vector3(-0.22, 0.08, 0.45);
        leftEye.material = createEmissiveMaterial('bossLeftEyeMat', new Color3(1, 0.7, 0), 1.0, this.scene);

        // Right eye - emissive box
        const rightEye = MeshBuilder.CreateBox('bossRightEye', {
            width: 0.18,
            height: 0.10,
            depth: 0.06
        }, this.scene);
        makeFlatShaded(rightEye);
        rightEye.parent = this.head;
        rightEye.position = new Vector3(0.22, 0.08, 0.45);
        rightEye.material = createEmissiveMaterial('bossRightEyeMat', new Color3(1, 0.7, 0), 1.0, this.scene);

        // Left arm - thick box limb
        this.leftArm = MeshBuilder.CreateBox('bossLeftArm', {
            width: 0.4,
            height: 1.8,
            depth: 0.4
        }, this.scene);
        makeFlatShaded(this.leftArm);
        this.leftArm.parent = this.mesh;
        this.leftArm.position = new Vector3(-0.95, 0.3, 0);
        this.leftArm.rotation.z = Math.PI / 8;
        this.leftArm.material = createLowPolyMaterial('bossLeftArmMat', PALETTE.ENEMY_BOSS, this.scene);

        // Left fist - box
        const leftFist = MeshBuilder.CreateBox('bossLeftFist', {
            width: 0.5,
            height: 0.4,
            depth: 0.5
        }, this.scene);
        makeFlatShaded(leftFist);
        leftFist.parent = this.leftArm;
        leftFist.position = new Vector3(0, -1.0, 0);
        leftFist.material = createLowPolyMaterial('bossLeftFistMat', PALETTE.ENEMY_BOSS_SPIKE, this.scene);

        // Right arm - thick box limb
        this.rightArm = MeshBuilder.CreateBox('bossRightArm', {
            width: 0.4,
            height: 1.8,
            depth: 0.4
        }, this.scene);
        makeFlatShaded(this.rightArm);
        this.rightArm.parent = this.mesh;
        this.rightArm.position = new Vector3(0.95, 0.3, 0);
        this.rightArm.rotation.z = -Math.PI / 8;
        this.rightArm.material = createLowPolyMaterial('bossRightArmMat', PALETTE.ENEMY_BOSS, this.scene);

        // Right fist - box
        const rightFist = MeshBuilder.CreateBox('bossRightFist', {
            width: 0.5,
            height: 0.4,
            depth: 0.5
        }, this.scene);
        makeFlatShaded(rightFist);
        rightFist.parent = this.rightArm;
        rightFist.position = new Vector3(0, -1.0, 0);
        rightFist.material = createLowPolyMaterial('bossRightFistMat', PALETTE.ENEMY_BOSS_SPIKE, this.scene);

        // Left leg - thick box
        const leftLeg = MeshBuilder.CreateBox('bossLeftLeg', {
            width: 0.45,
            height: 1.6,
            depth: 0.45
        }, this.scene);
        makeFlatShaded(leftLeg);
        leftLeg.parent = this.mesh;
        leftLeg.position = new Vector3(-0.45, -1.6, 0);
        leftLeg.material = createLowPolyMaterial('bossLeftLegMat', PALETTE.ENEMY_BOSS, this.scene);

        // Right leg - thick box
        const rightLeg = MeshBuilder.CreateBox('bossRightLeg', {
            width: 0.45,
            height: 1.6,
            depth: 0.45
        }, this.scene);
        makeFlatShaded(rightLeg);
        rightLeg.parent = this.mesh;
        rightLeg.position = new Vector3(0.45, -1.6, 0);
        rightLeg.material = createLowPolyMaterial('bossRightLegMat', PALETTE.ENEMY_BOSS, this.scene);

        // Back spike polyhedrons (4 spikes along the back, decreasing size)
        for (let i = 0; i < 4; i++) {
            const spike = MeshBuilder.CreatePolyhedron(`bossSpike${i}`, {
                type: 1, // Octahedron
                size: 0.18 - i * 0.03
            }, this.scene);
            makeFlatShaded(spike);
            spike.parent = this.mesh;
            spike.position = new Vector3(0, 0.9 - i * 0.5, -0.55);
            spike.scaling = new Vector3(0.5, 1.5, 0.5); // Stretch into spike shape
            spike.rotation.x = -0.3;
            spike.material = createLowPolyMaterial(`bossSpikeMat${i}`, PALETTE.ENEMY_BOSS_SPIKE, this.scene);
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
     * Animate boss parts (breathing, swaying)
     * @param deltaTime Time elapsed since last update
     */
    private animateParts(deltaTime: number): void {
        if (!this.mesh) return;

        // Animate head - slight bobbing / breathing motion
        if (this.head) {
            this.head.position.y = 1.7 + Math.sin(this.animationTime * 2) * 0.1;

            // If destroying a tower, make head look at target
            if (this.isDestroyingTower && this.destructionTargetPosition) {
                const direction = this.destructionTargetPosition.subtract(this.position);
                direction.y = 0;

                if (direction.length() > 0.1) {
                    const angle = Math.atan2(direction.z, direction.x);
                    this.head.rotation.y = -angle + Math.PI / 2;
                }
            } else {
                // Normal animation - slow sway
                this.head.rotation.y = Math.sin(this.animationTime) * 0.2;
            }
        }

        // Animate arms - swaying motion
        if (this.leftArm && this.rightArm) {
            this.leftArm.rotation.x = Math.sin(this.animationTime * 2) * 0.1;
            this.rightArm.rotation.x = Math.sin(this.animationTime * 2 + Math.PI) * 0.1;

            // When destroying a tower, raise arms
            if (this.isDestroyingTower) {
                this.leftArm.rotation.x = -Math.PI / 4;
                this.rightArm.rotation.x = -Math.PI / 4;
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
