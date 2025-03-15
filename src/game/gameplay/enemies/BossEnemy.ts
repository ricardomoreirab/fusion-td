import { Vector3, MeshBuilder, StandardMaterial, Color3, Mesh } from '@babylonjs/core';
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
    
    constructor(game: Game, position: Vector3, path: Vector3[]) {
        // Boss enemy has very low speed, extremely high health, high damage, and very high reward
        super(game, position, path, 0.7, 300, 30, 100);
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
     * Update the boss enemy with animation
     * @param deltaTime Time elapsed since last update in seconds
     * @returns True if the enemy reached the end of the path
     */
    public update(deltaTime: number): boolean {
        if (!this.alive || !this.mesh) return false;
        
        // Get the result from the parent update method
        const result = super.update(deltaTime);
        
        // Update animation
        if (!this.isFrozen && !this.isStunned && this.currentPathIndex < this.path.length) {
            this.animationTime += deltaTime * 2; // Control animation speed
            
            // Animate body - slight bobbing
            if (this.mesh) {
                this.mesh.position.y = this.position.y + 1.0 + Math.sin(this.animationTime * 0.5) * 0.1;
            }
            
            // Animate arms - swinging
            if (this.leftArm && this.rightArm) {
                this.leftArm.rotation.x = Math.sin(this.animationTime) * 0.2;
                this.rightArm.rotation.x = Math.sin(this.animationTime + Math.PI) * 0.2;
            }
            
            // Animate jaw - opening and closing
            if (this.jaw) {
                this.jaw.position.y = -0.5 - Math.abs(Math.sin(this.animationTime * 0.7)) * 0.2;
            }
            
            // Animate eyes - pulsing glow
            if (this.leftEye && this.rightEye) {
                const eyeMaterial = this.leftEye.material as StandardMaterial;
                const rightEyeMaterial = this.rightEye.material as StandardMaterial;
                
                const pulseIntensity = 0.7 + Math.abs(Math.sin(this.animationTime)) * 0.5;
                eyeMaterial.emissiveColor = new Color3(pulseIntensity, pulseIntensity * 0.7, 0);
                rightEyeMaterial.emissiveColor = new Color3(pulseIntensity, pulseIntensity * 0.7, 0);
                
                // Occasional blink
                const blinkFactor = Math.sin(this.animationTime * 0.3) > 0.95 ? 0.1 : 1.0;
                this.leftEye.scaling.y = blinkFactor;
                this.rightEye.scaling.y = blinkFactor;
            }
            
            // If we're moving, rotate the mesh to face the direction of movement
            if (this.currentPathIndex < this.path.length) {
                // Get the next point in the path
                const targetPoint = this.path[this.currentPathIndex];
                
                // Calculate direction to the target
                const direction = targetPoint.subtract(this.position);
                
                // Only rotate if we're moving
                if (direction.length() > 0.01) {
                    // Calculate the rotation to face the direction of movement
                    const angle = Math.atan2(direction.z, direction.x);
                    this.mesh.rotation.y = -angle + Math.PI / 2;
                }
            }
        }
        
        return result;
    }
    
    /**
     * Override the health bar creation to make it larger for boss enemies
     */
    protected createHealthBar(): void {
        if (!this.mesh) return;
        
        // Create background bar (gray)
        this.healthBarBackgroundMesh = MeshBuilder.CreateBox('healthBarBg', {
            width: 2.5, // Wider for boss enemies
            height: 0.3, // Taller for boss enemies
            depth: 0.05
        }, this.scene);
        
        // Position above the enemy
        this.healthBarBackgroundMesh.position = new Vector3(
            this.position.x,
            this.position.y + 3.5, // Higher for taller enemy
            this.position.z
        );
        
        // Create material for background
        const bgMaterial = new StandardMaterial('healthBarBgMaterial', this.scene);
        bgMaterial.diffuseColor = new Color3(0.3, 0.3, 0.3);
        this.healthBarBackgroundMesh.material = bgMaterial;
        
        // Create health bar (green)
        this.healthBarMesh = MeshBuilder.CreateBox('healthBar', {
            width: 2.5, // Wider for boss enemies
            height: 0.3, // Taller for boss enemies
            depth: 0.06 // Slightly in front of background
        }, this.scene);
        
        // Position at the same place as background
        this.healthBarMesh.position = new Vector3(
            this.position.x,
            this.position.y + 3.5, // Higher for taller enemy
            this.position.z
        );
        
        // Create material for health bar
        const healthMaterial = new StandardMaterial('healthBarMaterial', this.scene);
        healthMaterial.diffuseColor = new Color3(0.2, 0.8, 0.2); // Green
        this.healthBarMesh.material = healthMaterial;
        
        // Update health bar to match initial health
        this.updateHealthBar();
    }
    
    /**
     * Override the updateHealthBar method to position the health bar higher
     */
    protected updateHealthBar(): void {
        if (!this.mesh || !this.healthBarMesh || !this.healthBarBackgroundMesh) return;
        
        // Calculate health percentage
        const healthPercent = Math.max(0, this.health / this.maxHealth);
        
        // Update health bar width based on health percentage
        this.healthBarMesh.scaling.x = healthPercent;
        
        // Adjust position to align left side
        const offset = (1 - healthPercent) * 1.25; // Adjusted for wider bar (2.5 width)
        this.healthBarMesh.position.x = this.position.x - offset;
        
        // Update health bar color based on health percentage
        const material = this.healthBarMesh.material as StandardMaterial;
        if (healthPercent > 0.6) {
            material.diffuseColor = new Color3(0.2, 0.8, 0.2); // Green
        } else if (healthPercent > 0.3) {
            material.diffuseColor = new Color3(0.8, 0.8, 0.2); // Yellow
        } else {
            material.diffuseColor = new Color3(0.8, 0.2, 0.2); // Red
        }
        
        // Position health bars above the enemy
        this.healthBarBackgroundMesh.position.x = this.position.x;
        this.healthBarBackgroundMesh.position.y = this.position.y + 3.5; // Higher for taller enemy
        this.healthBarBackgroundMesh.position.z = this.position.z;
        
        this.healthBarMesh.position.y = this.position.y + 3.5; // Higher for taller enemy
        this.healthBarMesh.position.z = this.position.z;
    }
} 