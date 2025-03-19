import { Vector3, MeshBuilder, StandardMaterial, Color3, Mesh, Color4, Texture, ParticleSystem } from '@babylonjs/core';
import { Game } from '../../Game';
import { Enemy } from './Enemy';

export class BossEnemy extends Enemy {
    private animationTime: number = 0;
    private head: Mesh | null = null;
    private leftArm: Mesh | null = null;
    private rightArm: Mesh | null = null;
    private leftEye: Mesh | null = null;
    private rightEye: Mesh | null = null;
    private jaw: Mesh | null = null;
    private towerDestructionRangeIndicator: Mesh | null = null;
    private isDestroyingTower: boolean = false;
    private destructionTargetPosition: Vector3 | null = null;
    
    constructor(game: Game, position: Vector3, path: Vector3[]) {
        // Boss enemy has very low speed, extremely high health, high damage, and very high reward
        super(game, position, path, 0.7, 300, 30, 100);
        
        // Enable tower destruction ability for boss
        this.canDestroyTowers = true;
        this.towerDestructionRange = 3.0; // 3 units range for destroying towers
        this.towerDestructionCooldown = 5.0; // 5 seconds cooldown
        
        // Create visual range indicator for tower destruction
        this.createTowerDestructionRangeIndicator();
    }

    protected createMesh(): void {
        // Create a humanoid body for the boss enemy
        // Main body - tall and imposing
        this.mesh = MeshBuilder.CreateCylinder('bossBody', {
            height: 3.5,
            diameterTop: 1.5,
            diameterBottom: 1.8,
            tessellation: 12
        }, this.scene);
        
        // Position at starting position, but raise it to account for height
        this.mesh.position = this.position.clone();
        this.mesh.position.y += 1.0; // Raise to account for height
        
        // Create material for the boss body
        const bodyMaterial = new StandardMaterial('bossMaterial', this.scene);
        bodyMaterial.diffuseColor = new Color3(0.6, 0, 0); // Dark red
        bodyMaterial.specularColor = new Color3(1, 0.3, 0.3);
        this.mesh.material = bodyMaterial;
        
        // Create head
        this.head = MeshBuilder.CreateSphere('bossHead', {
            diameter: 1.8,
            segments: 16
        }, this.scene);
        this.head.parent = this.mesh;
        this.head.position = new Vector3(0, 2.0, 0); // Position on top of body
        
        // Create head material
        const headMaterial = new StandardMaterial('bossHeadMaterial', this.scene);
        headMaterial.diffuseColor = new Color3(0.7, 0.1, 0.1); // Slightly lighter red
        this.head.material = headMaterial;
        
        // Create glowing eyes
        const eyeMaterial = new StandardMaterial('bossEyeMaterial', this.scene);
        eyeMaterial.diffuseColor = new Color3(1, 0.7, 0);
        eyeMaterial.emissiveColor = new Color3(1, 0.7, 0); // Glowing
        
        // Left eye
        this.leftEye = MeshBuilder.CreateSphere('bossLeftEye', {
            diameter: 0.3,
            segments: 8
        }, this.scene);
        this.leftEye.parent = this.head;
        this.leftEye.position = new Vector3(-0.4, 0.2, 0.7);
        this.leftEye.material = eyeMaterial;
        
        // Right eye
        this.rightEye = MeshBuilder.CreateSphere('bossRightEye', {
            diameter: 0.3,
            segments: 8
        }, this.scene);
        this.rightEye.parent = this.head;
        this.rightEye.position = new Vector3(0.4, 0.2, 0.7);
        this.rightEye.material = eyeMaterial;
        
        // Create jaw
        this.jaw = MeshBuilder.CreateBox('bossJaw', {
            width: 1.2,
            height: 0.5,
            depth: 0.8
        }, this.scene);
        this.jaw.parent = this.head;
        this.jaw.position = new Vector3(0, -0.5, 0.4);
        
        // Create jaw material
        const jawMaterial = new StandardMaterial('bossJawMaterial', this.scene);
        jawMaterial.diffuseColor = new Color3(0.5, 0.1, 0.1);
        this.jaw.material = jawMaterial;
        
        // Add teeth
        const teethMaterial = new StandardMaterial('teethMaterial', this.scene);
        teethMaterial.diffuseColor = new Color3(0.9, 0.9, 0.7); // Off-white
        
        // Create several teeth on the jaw
        for (let i = -2; i <= 2; i++) {
            if (i === 0) continue; // Skip middle
            
            const tooth = MeshBuilder.CreateCylinder(`tooth${i}`, {
                height: 0.3,
                diameterTop: 0.05,
                diameterBottom: 0.15,
                tessellation: 6
            }, this.scene);
            tooth.material = teethMaterial;
            tooth.parent = this.jaw;
            tooth.position = new Vector3(i * 0.2, -0.15, 0.2);
            tooth.rotation.x = Math.PI / 2; // Point forward
        }
        
        // Create arms
        const armMaterial = new StandardMaterial('bossArmMaterial', this.scene);
        armMaterial.diffuseColor = new Color3(0.6, 0, 0); // Match body
        
        // Left arm
        this.leftArm = MeshBuilder.CreateCylinder('bossLeftArm', {
            height: 2.2,
            diameterTop: 0.4,
            diameterBottom: 0.6,
            tessellation: 8
        }, this.scene);
        this.leftArm.material = armMaterial;
        this.leftArm.parent = this.mesh;
        this.leftArm.position = new Vector3(-1.0, 0.5, 0);
        this.leftArm.rotation.z = Math.PI / 6; // Angle outward
        
        // Left hand/claw
        const leftHand = MeshBuilder.CreateSphere('bossLeftHand', {
            diameter: 0.8,
            segments: 8
        }, this.scene);
        leftHand.parent = this.leftArm;
        leftHand.position = new Vector3(0, -1.3, 0);
        leftHand.scaling = new Vector3(1, 0.7, 1.2); // Flatten slightly
        
        // Create claw material
        const clawMaterial = new StandardMaterial('bossClawMaterial', this.scene);
        clawMaterial.diffuseColor = new Color3(0.3, 0, 0); // Darker red
        leftHand.material = clawMaterial;
        
        // Add claws to left hand
        for (let i = 0; i < 3; i++) {
            const angle = (i / 3) * Math.PI * 0.5 - Math.PI / 6;
            const claw = MeshBuilder.CreateCylinder(`leftClaw${i}`, {
                height: 0.5,
                diameterTop: 0.05,
                diameterBottom: 0.15,
                tessellation: 4
            }, this.scene);
            claw.material = teethMaterial; // Reuse teeth material
            claw.parent = leftHand;
            claw.position = new Vector3(
                Math.cos(angle) * 0.4,
                -0.3,
                Math.sin(angle) * 0.4
            );
            claw.rotation.x = Math.PI / 3; // Angle downward
        }
        
        // Right arm
        this.rightArm = MeshBuilder.CreateCylinder('bossRightArm', {
            height: 2.2,
            diameterTop: 0.4,
            diameterBottom: 0.6,
            tessellation: 8
        }, this.scene);
        this.rightArm.material = armMaterial;
        this.rightArm.parent = this.mesh;
        this.rightArm.position = new Vector3(1.0, 0.5, 0);
        this.rightArm.rotation.z = -Math.PI / 6; // Angle outward
        
        // Right hand/claw
        const rightHand = MeshBuilder.CreateSphere('bossRightHand', {
            diameter: 0.8,
            segments: 8
        }, this.scene);
        rightHand.parent = this.rightArm;
        rightHand.position = new Vector3(0, -1.3, 0);
        rightHand.scaling = new Vector3(1, 0.7, 1.2); // Flatten slightly
        rightHand.material = clawMaterial;
        
        // Add claws to right hand
        for (let i = 0; i < 3; i++) {
            const angle = (i / 3) * Math.PI * 0.5 - Math.PI / 6;
            const claw = MeshBuilder.CreateCylinder(`rightClaw${i}`, {
                height: 0.5,
                diameterTop: 0.05,
                diameterBottom: 0.15,
                tessellation: 4
            }, this.scene);
            claw.material = teethMaterial; // Reuse teeth material
            claw.parent = rightHand;
            claw.position = new Vector3(
                -Math.cos(angle) * 0.4,
                -0.3,
                Math.sin(angle) * 0.4
            );
            claw.rotation.x = Math.PI / 3; // Angle downward
        }
        
        // Create legs
        const legMaterial = new StandardMaterial('bossLegMaterial', this.scene);
        legMaterial.diffuseColor = new Color3(0.5, 0, 0); // Slightly darker than body
        
        // Left leg
        const leftLeg = MeshBuilder.CreateCylinder('bossLeftLeg', {
            height: 2.0,
            diameterTop: 0.7,
            diameterBottom: 0.5,
            tessellation: 8
        }, this.scene);
        leftLeg.material = legMaterial;
        leftLeg.parent = this.mesh;
        leftLeg.position = new Vector3(-0.6, -1.7, 0);
        
        // Left foot
        const leftFoot = MeshBuilder.CreateBox('bossLeftFoot', {
            width: 0.8,
            height: 0.4,
            depth: 1.2
        }, this.scene);
        leftFoot.material = clawMaterial; // Reuse claw material
        leftFoot.parent = leftLeg;
        leftFoot.position = new Vector3(0, -1.1, 0.3);
        
        // Right leg
        const rightLeg = MeshBuilder.CreateCylinder('bossRightLeg', {
            height: 2.0,
            diameterTop: 0.7,
            diameterBottom: 0.5,
            tessellation: 8
        }, this.scene);
        rightLeg.material = legMaterial;
        rightLeg.parent = this.mesh;
        rightLeg.position = new Vector3(0.6, -1.7, 0);
        
        // Right foot
        const rightFoot = MeshBuilder.CreateBox('bossRightFoot', {
            width: 0.8,
            height: 0.4,
            depth: 1.2
        }, this.scene);
        rightFoot.material = clawMaterial; // Reuse claw material
        rightFoot.parent = rightLeg;
        rightFoot.position = new Vector3(0, -1.1, 0.3);
        
        // Add spikes on back
        const spikeMaterial = new StandardMaterial('bossSpikeMaterial', this.scene);
        spikeMaterial.diffuseColor = new Color3(0.3, 0, 0); // Dark red
        
        // Create several spikes along the back
        for (let i = 0; i < 5; i++) {
            const spike = MeshBuilder.CreateCylinder(`bossSpike${i}`, {
                height: 1.0 - i * 0.15,
                diameterTop: 0.05,
                diameterBottom: 0.3,
                tessellation: 6
            }, this.scene);
            spike.material = spikeMaterial;
            spike.parent = this.mesh;
            spike.position = new Vector3(0, 1.0 - i * 0.5, -0.6);
            spike.rotation.x = -Math.PI / 6; // Angle backward
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
        this.towerDestructionRangeIndicator.position.y = 0.05; // Slightly above ground
        
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
     * Animate boss parts
     * @param deltaTime Time elapsed since last update
     */
    private animateParts(deltaTime: number): void {
        if (!this.mesh) return;
        
        // Animate head - slight bobbing motion
        if (this.head) {
            this.head.position.y = 2.0 + Math.sin(this.animationTime * 2) * 0.1;
            
            // If destroying a tower, make head look at target
            if (this.isDestroyingTower && this.destructionTargetPosition) {
                const direction = this.destructionTargetPosition.subtract(this.position);
                direction.y = 0; // Keep level
                
                if (direction.length() > 0.1) {
                    // Calculate rotation to face target
                    const angle = Math.atan2(direction.z, direction.x);
                    // Rotate head to face target
                    this.head.rotation.y = -angle + Math.PI / 2;
                }
            } else {
                // Normal animation - slow rotation
                this.head.rotation.y = Math.sin(this.animationTime) * 0.2;
            }
        }
        
        // Animate jaw - opening and closing
        if (this.jaw) {
            this.jaw.rotation.x = Math.abs(Math.sin(this.animationTime * 3)) * 0.3;
            
            // Open wider when destroying a tower
            if (this.isDestroyingTower) {
                this.jaw.rotation.x = Math.PI / 4; // Open wide
            }
        }
        
        // Animate eyes - glowing effect
        if (this.leftEye && this.rightEye) {
            const eyeGlow = Math.abs(Math.sin(this.animationTime * 5)) * 0.3 + 0.7;
            
            const leftEyeMat = this.leftEye.material as StandardMaterial;
            const rightEyeMat = this.rightEye.material as StandardMaterial;
            
            if (leftEyeMat && rightEyeMat) {
                // Normal glow animation
                leftEyeMat.emissiveColor = new Color3(1 * eyeGlow, 0.7 * eyeGlow, 0);
                rightEyeMat.emissiveColor = new Color3(1 * eyeGlow, 0.7 * eyeGlow, 0);
                
                // Brighter when destroying
                if (this.isDestroyingTower) {
                    leftEyeMat.emissiveColor = new Color3(1, 0.2, 0.2); // Bright red
                    rightEyeMat.emissiveColor = new Color3(1, 0.2, 0.2);
                }
            }
        }
        
        // Animate arms - swaying motion
        if (this.leftArm && this.rightArm) {
            this.leftArm.rotation.x = Math.sin(this.animationTime * 2) * 0.1;
            this.rightArm.rotation.x = Math.sin(this.animationTime * 2 + Math.PI) * 0.1;
            
            // When destroying a tower, raise arms
            if (this.isDestroyingTower) {
                this.leftArm.rotation.x = -Math.PI / 4; // Raise arm
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
} 