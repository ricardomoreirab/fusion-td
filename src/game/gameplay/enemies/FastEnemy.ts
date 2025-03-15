import { Vector3, MeshBuilder, StandardMaterial, Color3, Mesh } from '@babylonjs/core';
import { Game } from '../../Game';
import { Enemy } from './Enemy';

export class FastEnemy extends Enemy {
    private flyTime: number = 0;
    private leftWing: Mesh | null = null;
    private rightWing: Mesh | null = null;
    private head: Mesh | null = null;
    private tail: Mesh | null = null;
    private leftArm: Mesh | null = null;
    private rightArm: Mesh | null = null;
    
    constructor(game: Game, position: Vector3, path: Vector3[]) {
        // Fast enemy has 2x speed, low health, low damage, and medium reward
        super(game, position, path, 6, 20, 5, 15);
        
        // Set as a flying enemy
        this.isFlying = true;
    }
    
    /**
     * Create the enemy mesh
     */
    protected createMesh(): void {
        // Create a demonic flying humanoid with wings
        // Main body - slender humanoid torso
        this.mesh = MeshBuilder.CreateBox('fastEnemyBody', {
            width: 0.7,
            height: 1.4,
            depth: 0.5
        }, this.scene);
        
        // Position at starting position, but raise it to account for height and flying
        this.mesh.position = this.position.clone();
        this.mesh.position.y += 1.2; // Raise to account for height and flying
        
        // Create material for body
        const bodyMaterial = new StandardMaterial('fastEnemyMaterial', this.scene);
        bodyMaterial.diffuseColor = new Color3(0.1, 0.3, 0.7); // Dark blue for dragon-like monster
        this.mesh.material = bodyMaterial;
        
        // Create head
        this.head = MeshBuilder.CreateSphere('fastEnemyHead', {
            diameter: 0.6,
            segments: 16
        }, this.scene);
        this.head.parent = this.mesh;
        this.head.position = new Vector3(0, 0.8, 0); // Position on top of body
        this.head.scaling = new Vector3(0.8, 1.0, 1.1); // Elongate slightly
        
        // Create head material
        const headMaterial = new StandardMaterial('fastEnemyHeadMaterial', this.scene);
        headMaterial.diffuseColor = new Color3(0.15, 0.35, 0.75); // Slightly lighter than body
        this.head.material = headMaterial;
        
        // Add eyes
        const eyeMaterial = new StandardMaterial('eyeMaterial', this.scene);
        eyeMaterial.diffuseColor = new Color3(1, 0, 0); // Red glowing eyes
        eyeMaterial.emissiveColor = new Color3(0.5, 0, 0); // Glow effect
        
        // Left eye
        const leftEye = MeshBuilder.CreateSphere('leftEye', {
            diameter: 0.12
        }, this.scene);
        leftEye.material = eyeMaterial;
        leftEye.parent = this.head;
        leftEye.position = new Vector3(-0.15, 0.05, 0.25);
        
        // Right eye
        const rightEye = MeshBuilder.CreateSphere('rightEye', {
            diameter: 0.12
        }, this.scene);
        rightEye.material = eyeMaterial;
        rightEye.parent = this.head;
        rightEye.position = new Vector3(0.15, 0.05, 0.25);
        
        // Add mouth
        const mouthMaterial = new StandardMaterial('mouthMaterial', this.scene);
        mouthMaterial.diffuseColor = new Color3(0.05, 0.15, 0.4); // Darker blue
        
        const mouth = MeshBuilder.CreateBox('mouth', {
            width: 0.3,
            height: 0.1,
            depth: 0.15
        }, this.scene);
        mouth.material = mouthMaterial;
        mouth.parent = this.head;
        mouth.position = new Vector3(0, -0.15, 0.25);
        
        // Add teeth
        const teethMaterial = new StandardMaterial('teethMaterial', this.scene);
        teethMaterial.diffuseColor = new Color3(0.9, 0.9, 0.9); // White
        
        // Create several teeth
        for (let i = -1; i <= 1; i += 2) {
            const tooth = MeshBuilder.CreateCylinder(`tooth${i}`, {
                height: 0.1,
                diameterTop: 0.01,
                diameterBottom: 0.04,
                tessellation: 4
            }, this.scene);
            tooth.material = teethMaterial;
            tooth.parent = mouth;
            tooth.position = new Vector3(i * 0.08, -0.05, 0.05);
            // Already pointing downward
        }
        
        // Create wing material
        const wingMaterial = new StandardMaterial('wingMaterial', this.scene);
        wingMaterial.diffuseColor = new Color3(0.2, 0.2, 0.5); // Darker blue for wings
        wingMaterial.alpha = 0.8; // Slightly transparent wings
        
        // Add wings (larger and more bat-like)
        this.leftWing = MeshBuilder.CreateBox('leftWing', {
            width: 0.05,
            height: 1.2, // Taller wings
            depth: 1.0  // Deeper wings
        }, this.scene);
        this.leftWing.material = wingMaterial;
        this.leftWing.parent = this.mesh; // Attach to main body first
        this.leftWing.position = new Vector3(-0.4, 0.2, 0); // Position relative to parent
        this.leftWing.rotation.z = Math.PI / 6; // Angle the wing outward
        this.leftWing.rotation.y = -0.2; // Slight forward angle
        
        this.rightWing = MeshBuilder.CreateBox('rightWing', {
            width: 0.05,
            height: 1.2, // Taller wings
            depth: 1.0  // Deeper wings
        }, this.scene);
        this.rightWing.material = wingMaterial;
        this.rightWing.parent = this.mesh; // Attach to main body first
        this.rightWing.position = new Vector3(0.4, 0.2, 0); // Position relative to parent
        this.rightWing.rotation.z = -Math.PI / 6; // Angle the wing outward
        this.rightWing.rotation.y = 0.2; // Slight forward angle
        
        // Add wing membranes
        const membraneMaterial = new StandardMaterial('membraneMaterial', this.scene);
        membraneMaterial.diffuseColor = new Color3(0.3, 0.1, 0.5); // Purple membrane
        membraneMaterial.alpha = 0.7; // Translucent
        
        // Left membrane
        const leftMembrane = MeshBuilder.CreateDisc('leftMembrane', {
            radius: 0.6,
            tessellation: 8,
            arc: 0.5
        }, this.scene);
        leftMembrane.material = membraneMaterial;
        leftMembrane.parent = this.leftWing;
        leftMembrane.position = new Vector3(0, 0, 0.2);
        leftMembrane.rotation.z = Math.PI / 2;
        
        // Right membrane
        const rightMembrane = MeshBuilder.CreateDisc('rightMembrane', {
            radius: 0.6,
            tessellation: 8,
            arc: 0.5
        }, this.scene);
        rightMembrane.material = membraneMaterial;
        rightMembrane.parent = this.rightWing;
        rightMembrane.position = new Vector3(0, 0, 0.2);
        rightMembrane.rotation.z = -Math.PI / 2;
        
        // Add arms
        const armMaterial = new StandardMaterial('armMaterial', this.scene);
        armMaterial.diffuseColor = new Color3(0.1, 0.3, 0.6); // Slightly lighter than body
        
        // Left arm
        this.leftArm = MeshBuilder.CreateCylinder('leftArm', {
            height: 0.8,
            diameterTop: 0.1,
            diameterBottom: 0.15,
            tessellation: 8
        }, this.scene);
        this.leftArm.material = armMaterial;
        this.leftArm.parent = this.mesh;
        this.leftArm.position = new Vector3(-0.35, 0.0, 0);
        this.leftArm.rotation.z = Math.PI / 8; // Angle slightly outward
        
        // Left hand/claw
        const leftHand = MeshBuilder.CreateSphere('leftHand', {
            diameter: 0.2,
            segments: 8
        }, this.scene);
        leftHand.material = armMaterial;
        leftHand.parent = this.leftArm;
        leftHand.position = new Vector3(0, -0.45, 0);
        leftHand.scaling = new Vector3(0.8, 0.6, 1.2); // Flatten slightly
        
        // Add claws to left hand
        for (let i = 0; i < 3; i++) {
            const angle = (i / 3) * Math.PI * 0.5 - Math.PI / 6;
            const claw = MeshBuilder.CreateCylinder(`leftClaw${i}`, {
                height: 0.15,
                diameterTop: 0.01,
                diameterBottom: 0.04,
                tessellation: 4
            }, this.scene);
            claw.material = teethMaterial; // Reuse teeth material
            claw.parent = leftHand;
            claw.position = new Vector3(
                Math.cos(angle) * 0.12,
                -0.12,
                Math.sin(angle) * 0.12
            );
            claw.rotation.x = Math.PI / 3; // Angle downward
        }
        
        // Right arm
        this.rightArm = MeshBuilder.CreateCylinder('rightArm', {
            height: 0.8,
            diameterTop: 0.1,
            diameterBottom: 0.15,
            tessellation: 8
        }, this.scene);
        this.rightArm.material = armMaterial;
        this.rightArm.parent = this.mesh;
        this.rightArm.position = new Vector3(0.35, 0.0, 0);
        this.rightArm.rotation.z = -Math.PI / 8; // Angle slightly outward
        
        // Right hand/claw
        const rightHand = MeshBuilder.CreateSphere('rightHand', {
            diameter: 0.2,
            segments: 8
        }, this.scene);
        rightHand.material = armMaterial;
        rightHand.parent = this.rightArm;
        rightHand.position = new Vector3(0, -0.45, 0);
        rightHand.scaling = new Vector3(0.8, 0.6, 1.2); // Flatten slightly
        
        // Add claws to right hand
        for (let i = 0; i < 3; i++) {
            const angle = (i / 3) * Math.PI * 0.5 - Math.PI / 6;
            const claw = MeshBuilder.CreateCylinder(`rightClaw${i}`, {
                height: 0.15,
                diameterTop: 0.01,
                diameterBottom: 0.04,
                tessellation: 4
            }, this.scene);
            claw.material = teethMaterial; // Reuse teeth material
            claw.parent = rightHand;
            claw.position = new Vector3(
                -Math.cos(angle) * 0.12,
                -0.12,
                Math.sin(angle) * 0.12
            );
            claw.rotation.x = Math.PI / 3; // Angle downward
        }
        
        // Add legs (shorter for flying creature)
        const legMaterial = new StandardMaterial('legMaterial', this.scene);
        legMaterial.diffuseColor = new Color3(0.1, 0.25, 0.6); // Match body
        
        // Left leg
        const leftLeg = MeshBuilder.CreateCylinder('leftLeg', {
            height: 0.7,
            diameterTop: 0.15,
            diameterBottom: 0.1,
            tessellation: 8
        }, this.scene);
        leftLeg.material = legMaterial;
        leftLeg.parent = this.mesh;
        leftLeg.position = new Vector3(-0.2, -0.8, 0);
        
        // Left foot/talon
        const leftFoot = MeshBuilder.CreateSphere('leftFoot', {
            diameter: 0.18,
            segments: 8
        }, this.scene);
        leftFoot.material = legMaterial;
        leftFoot.parent = leftLeg;
        leftFoot.position = new Vector3(0, -0.4, 0.05);
        leftFoot.scaling = new Vector3(0.8, 0.6, 1.2); // Flatten slightly
        
        // Add talons to left foot
        for (let i = 0; i < 3; i++) {
            const angle = (i / 3) * Math.PI * 0.5 - Math.PI / 6;
            const talon = MeshBuilder.CreateCylinder(`leftTalon${i}`, {
                height: 0.15,
                diameterTop: 0.01,
                diameterBottom: 0.04,
                tessellation: 4
            }, this.scene);
            talon.material = teethMaterial; // Reuse teeth material
            talon.parent = leftFoot;
            talon.position = new Vector3(
                Math.cos(angle) * 0.1,
                -0.1,
                Math.sin(angle) * 0.1 + 0.05
            );
            talon.rotation.x = Math.PI / 3; // Angle downward
        }
        
        // Right leg
        const rightLeg = MeshBuilder.CreateCylinder('rightLeg', {
            height: 0.7,
            diameterTop: 0.15,
            diameterBottom: 0.1,
            tessellation: 8
        }, this.scene);
        rightLeg.material = legMaterial;
        rightLeg.parent = this.mesh;
        rightLeg.position = new Vector3(0.2, -0.8, 0);
        
        // Right foot/talon
        const rightFoot = MeshBuilder.CreateSphere('rightFoot', {
            diameter: 0.18,
            segments: 8
        }, this.scene);
        rightFoot.material = legMaterial;
        rightFoot.parent = rightLeg;
        rightFoot.position = new Vector3(0, -0.4, 0.05);
        rightFoot.scaling = new Vector3(0.8, 0.6, 1.2); // Flatten slightly
        
        // Add talons to right foot
        for (let i = 0; i < 3; i++) {
            const angle = (i / 3) * Math.PI * 0.5 - Math.PI / 6;
            const talon = MeshBuilder.CreateCylinder(`rightTalon${i}`, {
                height: 0.15,
                diameterTop: 0.01,
                diameterBottom: 0.04,
                tessellation: 4
            }, this.scene);
            talon.material = teethMaterial; // Reuse teeth material
            talon.parent = rightFoot;
            talon.position = new Vector3(
                -Math.cos(angle) * 0.1,
                -0.1,
                Math.sin(angle) * 0.1 + 0.05
            );
            talon.rotation.x = Math.PI / 3; // Angle downward
        }
        
        // Add tail
        const tailMaterial = new StandardMaterial('tailMaterial', this.scene);
        tailMaterial.diffuseColor = new Color3(0.1, 0.3, 0.7); // Match body color
        
        this.tail = MeshBuilder.CreateCylinder('tail', {
            height: 1.0,
            diameterTop: 0.05,
            diameterBottom: 0.2,
            tessellation: 8
        }, this.scene);
        this.tail.material = tailMaterial;
        this.tail.parent = this.mesh;
        this.tail.position = new Vector3(0, -0.5, -0.3); // Behind body
        this.tail.rotation.x = -0.3; // Angle upward slightly
        
        // Add spikes along back
        const spikeMaterial = new StandardMaterial('spikeMaterial', this.scene);
        spikeMaterial.diffuseColor = new Color3(0.2, 0.1, 0.4); // Dark purple spikes
        
        // Create several spikes along the back
        for (let i = 0; i < 4; i++) {
            const spike = MeshBuilder.CreateCylinder(`spike${i}`, {
                height: 0.2 - i * 0.03,
                diameterTop: 0.01,
                diameterBottom: 0.05,
                tessellation: 4
            }, this.scene);
            spike.material = spikeMaterial;
            spike.parent = this.mesh;
            spike.position = new Vector3(0, 0.6 - i * 0.3, -0.2); // Along the back
            spike.rotation.x = -0.2; // Point backward slightly
        }
        
        // Store original scale
        this.originalScale = 1.0;
    }
    
    /**
     * Override the health bar creation to make it smaller and positioned better for fast enemies
     */
    protected createHealthBar(): void {
        if (!this.mesh) return;
        
        // Create background bar (gray)
        this.healthBarBackgroundMesh = MeshBuilder.CreateBox('healthBarBg', {
            width: 0.8, // Narrower for fast enemies
            height: 0.1, // Thinner for fast enemies
            depth: 0.05
        }, this.scene);
        
        // Position above the enemy
        this.healthBarBackgroundMesh.position = new Vector3(
            this.position.x,
            this.position.y + 2.3, // Higher for taller flying enemy
            this.position.z
        );
        
        // Create material for background
        const bgMaterial = new StandardMaterial('healthBarBgMaterial', this.scene);
        bgMaterial.diffuseColor = new Color3(0.3, 0.3, 0.3);
        this.healthBarBackgroundMesh.material = bgMaterial;
        
        // Create health bar (green)
        this.healthBarMesh = MeshBuilder.CreateBox('healthBar', {
            width: 0.8, // Narrower for fast enemies
            height: 0.1, // Thinner for fast enemies
            depth: 0.06 // Slightly in front of background
        }, this.scene);
        
        // Position at the same place as background
        this.healthBarMesh.position = new Vector3(
            this.position.x,
            this.position.y + 2.3, // Higher for taller flying enemy
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
     * Override the updateHealthBar method to position the health bar appropriately
     */
    protected updateHealthBar(): void {
        if (!this.mesh || !this.healthBarMesh || !this.healthBarBackgroundMesh) return;
        
        // Calculate health percentage
        const healthPercent = Math.max(0, this.health / this.maxHealth);
        
        // Update health bar width based on health percentage
        this.healthBarMesh.scaling.x = healthPercent;
        
        // Adjust position to align left side
        const offset = (1 - healthPercent) * 0.4; // Adjusted for narrower bar (0.8 width)
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
        this.healthBarBackgroundMesh.position.y = this.position.y + 2.3; // Higher for taller flying enemy
        this.healthBarBackgroundMesh.position.z = this.position.z;
        
        this.healthBarMesh.position.y = this.position.y + 2.3; // Higher for taller flying enemy
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
                // Wing flapping animation
                this.leftWing.rotation.z = Math.PI / 6 + Math.sin(this.flyTime) * 0.5;
                this.rightWing.rotation.z = -Math.PI / 6 - Math.sin(this.flyTime) * 0.5;
            }
            
            // Move head slightly
            if (this.head) {
                this.head.rotation.x = Math.sin(this.flyTime * 0.3) * 0.1;
                this.head.rotation.y = Math.sin(this.flyTime * 0.5) * 0.1;
            }
            
            // Animate arms
            if (this.leftArm && this.rightArm) {
                this.leftArm.rotation.x = Math.sin(this.flyTime * 0.7) * 0.2;
                this.rightArm.rotation.x = Math.sin(this.flyTime * 0.7 + Math.PI) * 0.2;
            }
            
            // Wag tail
            if (this.tail) {
                this.tail.rotation.y = Math.sin(this.flyTime * 0.7) * 0.3;
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