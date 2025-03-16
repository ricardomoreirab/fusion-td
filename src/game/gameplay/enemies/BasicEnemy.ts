import { Vector3, MeshBuilder, StandardMaterial, Color3, Color4, ParticleSystem, Texture, Mesh } from '@babylonjs/core';
import { Game } from '../../Game';
import { Enemy } from './Enemy';

export class BasicEnemy extends Enemy {
    private walkTime: number = 0;
    private mouthMesh: Mesh | null = null;
    private leftLeg: Mesh | null = null;
    private rightLeg: Mesh | null = null;
    private leftArm: Mesh | null = null;
    private rightArm: Mesh | null = null;
    private head: Mesh | null = null;
    
    constructor(game: Game, position: Vector3, path: Vector3[]) {
        // Basic enemy has medium speed, medium health, medium damage, and low reward
        super(game, position, path, 3, 30, 10, 10);
    }

    /**
     * Create the enemy mesh
     */
    protected createMesh(): void {
        // Create a taller, humanoid monster with monstrous features
        
        // Main body - torso
        this.mesh = MeshBuilder.CreateBox('basicEnemyBody', {
            width: 0.8,
            height: 1.2,
            depth: 0.6
        }, this.scene);
        
        // Position at starting position, but raise it to account for height
        this.mesh.position = this.position.clone();
        this.mesh.position.y += 0.7; // Raise to account for height
        
        // Create material for body
        const bodyMaterial = new StandardMaterial('basicEnemyMaterial', this.scene);
        bodyMaterial.diffuseColor = new Color3(0.8, 0.2, 0.2); // Red color for monster
        this.mesh.material = bodyMaterial;
        
        // Create head
        this.head = MeshBuilder.CreateBox('head', {
            width: 0.7,
            height: 0.7,
            depth: 0.7
        }, this.scene);
        this.head.parent = this.mesh;
        this.head.position = new Vector3(0, 0.8, 0); // Position on top of body
        
        // Create head material
        const headMaterial = new StandardMaterial('headMaterial', this.scene);
        headMaterial.diffuseColor = new Color3(0.7, 0.15, 0.15); // Slightly darker red
        this.head.material = headMaterial;
        
        // Create eye material (reused for both eyes)
        const eyeMaterial = new StandardMaterial('eyeMaterial', this.scene);
        eyeMaterial.diffuseColor = new Color3(1, 0.9, 0); // Yellow eyes for monster
        eyeMaterial.emissiveColor = new Color3(0.5, 0.4, 0); // Glowing effect
        
        // Create pupil material (reused for both pupils)
        const pupilMaterial = new StandardMaterial('pupilMaterial', this.scene);
        pupilMaterial.diffuseColor = new Color3(0, 0, 0); // Black
        
        // Add left eye - make it angry looking (slanted)
        const leftEye = MeshBuilder.CreateSphere('leftEye', {
            diameter: 0.2,
            slice: 0.7 // Make it look like an angry eye
        }, this.scene);
        leftEye.material = eyeMaterial;
        leftEye.parent = this.head; // Attach to head
        leftEye.position = new Vector3(-0.2, 0.1, 0.36); // Position relative to parent
        leftEye.rotation.z = -0.3; // Slant for angry look
        
        // Add right eye - make it angry looking (slanted)
        const rightEye = MeshBuilder.CreateSphere('rightEye', {
            diameter: 0.2,
            slice: 0.7 // Make it look like an angry eye
        }, this.scene);
        rightEye.material = eyeMaterial;
        rightEye.parent = this.head; // Attach to head
        rightEye.position = new Vector3(0.2, 0.1, 0.36); // Position relative to parent
        rightEye.rotation.z = 0.3; // Slant for angry look
        
        // Add left pupil - make it slit-like for monster look
        const leftPupil = MeshBuilder.CreateBox('leftPupil', {
            width: 0.05,
            height: 0.12,
            depth: 0.05
        }, this.scene);
        leftPupil.material = pupilMaterial;
        leftPupil.parent = leftEye; // Attach to left eye
        leftPupil.position = new Vector3(0, 0, 0.1); // Position relative to eye
        leftPupil.rotation.z = 0.3; // Vertical slit pupil
        
        // Add right pupil - make it slit-like for monster look
        const rightPupil = MeshBuilder.CreateBox('rightPupil', {
            width: 0.05,
            height: 0.12,
            depth: 0.05
        }, this.scene);
        rightPupil.material = pupilMaterial;
        rightPupil.parent = rightEye; // Attach to right eye
        rightPupil.position = new Vector3(0, 0, 0.1); // Position relative to eye
        rightPupil.rotation.z = -0.3; // Vertical slit pupil
        
        // Add horns on top of head
        const hornMaterial = new StandardMaterial('hornMaterial', this.scene);
        hornMaterial.diffuseColor = new Color3(0.6, 0.1, 0.1); // Darker red
        
        // Left horn
        const leftHorn = MeshBuilder.CreateCylinder('leftHorn', {
            height: 0.4,
            diameterTop: 0.01,
            diameterBottom: 0.1,
            tessellation: 8
        }, this.scene);
        leftHorn.material = hornMaterial;
        leftHorn.parent = this.head;
        leftHorn.position = new Vector3(-0.25, 0.35, 0);
        leftHorn.rotation.x = -0.3;
        leftHorn.rotation.z = -0.3;
        
        // Right horn
        const rightHorn = MeshBuilder.CreateCylinder('rightHorn', {
            height: 0.4,
            diameterTop: 0.01,
            diameterBottom: 0.1,
            tessellation: 8
        }, this.scene);
        rightHorn.material = hornMaterial;
        rightHorn.parent = this.head;
        rightHorn.position = new Vector3(0.25, 0.35, 0);
        rightHorn.rotation.x = -0.3;
        rightHorn.rotation.z = 0.3;
        
        // Add mouth with teeth
        const mouthMaterial = new StandardMaterial('mouthMaterial', this.scene);
        mouthMaterial.diffuseColor = new Color3(0.3, 0.1, 0.1); // Dark red
        
        this.mouthMesh = MeshBuilder.CreateBox('mouth', {
            width: 0.5,
            height: 0.15,
            depth: 0.1
        }, this.scene);
        this.mouthMesh.material = mouthMaterial;
        this.mouthMesh.parent = this.head;
        this.mouthMesh.position = new Vector3(0, -0.2, 0.36);
        
        // Add teeth
        const teethMaterial = new StandardMaterial('teethMaterial', this.scene);
        teethMaterial.diffuseColor = new Color3(0.9, 0.9, 0.9); // White
        
        // Create several teeth
        for (let i = -2; i <= 2; i++) {
            if (i === 0) continue; // Skip middle
            
            // Top teeth
            const topTooth = MeshBuilder.CreateCylinder('topTooth', {
                height: 0.12,
                diameterTop: 0.01,
                diameterBottom: 0.06,
                tessellation: 4
            }, this.scene);
            topTooth.material = teethMaterial;
            topTooth.parent = this.head;
            topTooth.position = new Vector3(i * 0.1, -0.13, 0.4);
            topTooth.rotation.x = Math.PI; // Point downward
            
            // Bottom teeth (smaller)
            if (Math.abs(i) > 1) { // Only on the sides
                const bottomTooth = MeshBuilder.CreateCylinder('bottomTooth', {
                    height: 0.08,
                    diameterTop: 0.01,
                    diameterBottom: 0.04,
                    tessellation: 4
                }, this.scene);
                bottomTooth.material = teethMaterial;
                bottomTooth.parent = this.mouthMesh; // Attach to mouth so they move with it
                bottomTooth.position = new Vector3(i * 0.1, -0.07, 0.04);
                // Already pointing upward
            }
        }
        
        // Add arms
        const armMaterial = new StandardMaterial('armMaterial', this.scene);
        armMaterial.diffuseColor = new Color3(0.7, 0.15, 0.15); // Slightly lighter than body
        
        // Left arm
        this.leftArm = MeshBuilder.CreateCylinder('leftArm', {
            height: 1.0,
            diameterTop: 0.15,
            diameterBottom: 0.2,
            tessellation: 8
        }, this.scene);
        this.leftArm.material = armMaterial;
        this.leftArm.parent = this.mesh;
        this.leftArm.position = new Vector3(-0.5, 0.3, 0);
        this.leftArm.rotation.z = Math.PI / 8; // Angle slightly outward
        
        // Left hand
        const leftHand = MeshBuilder.CreateSphere('leftHand', {
            diameter: 0.25,
            segments: 8
        }, this.scene);
        leftHand.material = armMaterial;
        leftHand.parent = this.leftArm;
        leftHand.position = new Vector3(0, -0.55, 0);
        leftHand.scaling = new Vector3(1, 0.7, 1.2); // Flatten slightly
        
        // Add claws to left hand
        for (let i = 0; i < 3; i++) {
            const angle = (i / 3) * Math.PI * 0.5 - Math.PI / 6;
            const claw = MeshBuilder.CreateCylinder(`leftClaw${i}`, {
                height: 0.2,
                diameterTop: 0.02,
                diameterBottom: 0.05,
                tessellation: 4
            }, this.scene);
            claw.material = teethMaterial; // Reuse teeth material
            claw.parent = leftHand;
            claw.position = new Vector3(
                Math.cos(angle) * 0.15,
                -0.15,
                Math.sin(angle) * 0.15
            );
            claw.rotation.x = Math.PI / 3; // Angle downward
        }
        
        // Right arm
        this.rightArm = MeshBuilder.CreateCylinder('rightArm', {
            height: 1.0,
            diameterTop: 0.15,
            diameterBottom: 0.2,
            tessellation: 8
        }, this.scene);
        this.rightArm.material = armMaterial;
        this.rightArm.parent = this.mesh;
        this.rightArm.position = new Vector3(0.5, 0.3, 0);
        this.rightArm.rotation.z = -Math.PI / 8; // Angle slightly outward
        
        // Right hand
        const rightHand = MeshBuilder.CreateSphere('rightHand', {
            diameter: 0.25,
            segments: 8
        }, this.scene);
        rightHand.material = armMaterial;
        rightHand.parent = this.rightArm;
        rightHand.position = new Vector3(0, -0.55, 0);
        rightHand.scaling = new Vector3(1, 0.7, 1.2); // Flatten slightly
        
        // Add claws to right hand
        for (let i = 0; i < 3; i++) {
            const angle = (i / 3) * Math.PI * 0.5 - Math.PI / 6;
            const claw = MeshBuilder.CreateCylinder(`rightClaw${i}`, {
                height: 0.2,
                diameterTop: 0.02,
                diameterBottom: 0.05,
                tessellation: 4
            }, this.scene);
            claw.material = teethMaterial; // Reuse teeth material
            claw.parent = rightHand;
            claw.position = new Vector3(
                -Math.cos(angle) * 0.15,
                -0.15,
                Math.sin(angle) * 0.15
            );
            claw.rotation.x = Math.PI / 3; // Angle downward
        }
        
        // Add legs
        const legMaterial = new StandardMaterial('legMaterial', this.scene);
        legMaterial.diffuseColor = new Color3(0.7, 0.15, 0.15); // Slightly lighter than body
        
        // Left leg
        this.leftLeg = MeshBuilder.CreateCylinder('leftLeg', {
            height: 1.0,
            diameter: 0.2,
            tessellation: 8
        }, this.scene);
        this.leftLeg.material = legMaterial;
        this.leftLeg.parent = this.mesh;
        this.leftLeg.position = new Vector3(-0.25, -0.9, 0);
        
        // Right leg
        this.rightLeg = MeshBuilder.CreateCylinder('rightLeg', {
            height: 1.0,
            diameter: 0.2,
            tessellation: 8
        }, this.scene);
        this.rightLeg.material = legMaterial;
        this.rightLeg.parent = this.mesh;
        this.rightLeg.position = new Vector3(0.25, -0.9, 0);
        
        // Add feet
        const footMaterial = new StandardMaterial('footMaterial', this.scene);
        footMaterial.diffuseColor = new Color3(0.6, 0.1, 0.1); // Darker red
        
        // Left foot
        const leftFoot = MeshBuilder.CreateBox('leftFoot', {
            width: 0.25,
            height: 0.15,
            depth: 0.4
        }, this.scene);
        leftFoot.material = footMaterial;
        leftFoot.parent = this.leftLeg;
        leftFoot.position = new Vector3(0, -0.55, 0.1);
        
        // Right foot
        const rightFoot = MeshBuilder.CreateBox('rightFoot', {
            width: 0.25,
            height: 0.15,
            depth: 0.4
        }, this.scene);
        rightFoot.material = footMaterial;
        rightFoot.parent = this.rightLeg;
        rightFoot.position = new Vector3(0, -0.55, 0.1);
        
        // Store original scale
        this.originalScale = 1.0;
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
            
            // Open and close mouth
            if (this.mouthMesh) {
                // Make mouth open and close
                this.mouthMesh.scaling.y = 1.0 + Math.abs(Math.sin(this.walkTime * 2)) * 0.5;
                this.mouthMesh.position.y = -0.2 - Math.abs(Math.sin(this.walkTime * 2)) * 0.05;
            }
            
            // Slight head movement
            if (this.head) {
                this.head.rotation.y = Math.sin(this.walkTime * 0.5) * 0.1;
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
     * Override the health bar creation for basic enemies
     */
    protected createHealthBar(): void {
        if (!this.mesh) return;
        
        // Create background bar (gray)
        this.healthBarBackgroundMesh = MeshBuilder.CreateBox('healthBarBg', {
            width: 1.0,
            height: 0.15,
            depth: 0.05
        }, this.scene);
        
        // Position above the enemy
        this.healthBarBackgroundMesh.position = new Vector3(
            this.position.x,
            this.position.y + 1.9, // Higher for taller enemy
            this.position.z
        );
        
        // Create material for background
        const bgMaterial = new StandardMaterial('healthBarBgMaterial', this.scene);
        bgMaterial.diffuseColor = new Color3(0.3, 0.3, 0.3);
        this.healthBarBackgroundMesh.material = bgMaterial;
        
        // Create health bar (green)
        this.healthBarMesh = MeshBuilder.CreateBox('healthBar', {
            width: 1.0,
            height: 0.15,
            depth: 0.06 // Slightly in front of background
        }, this.scene);
        
        // Position at the same place as background
        this.healthBarMesh.position = new Vector3(
            this.position.x,
            this.position.y + 1.9, // Higher for taller enemy
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
     * Override the updateHealthBar method for basic enemies
     */
    protected updateHealthBar(): void {
        if (!this.mesh || !this.healthBarMesh || !this.healthBarBackgroundMesh) return;
        
        // Calculate health percentage
        const healthPercent = Math.max(0, this.health / this.maxHealth);
        
        // Update health bar width based on health percentage
        this.healthBarMesh.scaling.x = healthPercent;
        
        // Adjust position to align left side
        const offset = (1 - healthPercent) * 0.5;
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
        this.healthBarBackgroundMesh.position.y = this.position.y + 1.9; // Higher for taller enemy
        this.healthBarBackgroundMesh.position.z = this.position.z;
        
        this.healthBarMesh.position.y = this.position.y + 1.9; // Higher for taller enemy
        this.healthBarMesh.position.z = this.position.z;
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
        particleSystem.emitter.y += 0.7; // Adjust for taller enemy
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