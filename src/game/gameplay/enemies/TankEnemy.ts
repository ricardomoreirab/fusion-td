import { Vector3, MeshBuilder, StandardMaterial, Color3, Mesh } from '@babylonjs/core';
import { Game } from '../../Game';
import { Enemy } from './Enemy';

export class TankEnemy extends Enemy {
    private stompTime: number = 0;
    private leftEye: Mesh | null = null;
    private rightEye: Mesh | null = null;
    private jaw: Mesh | null = null;
    private rocks: Mesh[] = [];
    private cracks: Mesh[] = [];
    
    constructor(game: Game, position: Vector3, path: Vector3[]) {
        // Tank enemy has low speed, 5x health, high damage, and high reward
        super(game, position, path, 1.5, 150, 20, 30);
        
        // Set as a heavy enemy type
        this.isHeavy = true;
    }
    
    /**
     * Create the enemy mesh
     */
    protected createMesh(): void {
        // Ensure arrays are initialized
        this.rocks = [];
        this.cracks = [];
        
        // Create a heavily armored rock golem monster
        // Main body - bulky and rocky
        this.mesh = MeshBuilder.CreateBox('tankEnemy', {
            width: 1.3,
            height: 1.0,
            depth: 1.5
        }, this.scene);
        
        // Position at starting position
        this.mesh.position = this.position.clone();
        
        // Create material for the rocky body
        const material = new StandardMaterial('tankEnemyMaterial', this.scene);
        material.diffuseColor = new Color3(0.4, 0.4, 0.4); // Stone gray color
        this.mesh.material = material;
        
        // Add rocky texture by adding smaller rocks to the surface
        const rockMaterial = new StandardMaterial('rockMaterial', this.scene);
        rockMaterial.diffuseColor = new Color3(0.3, 0.3, 0.3); // Darker gray
        
        // Add random rocks to the surface
        for (let i = 0; i < 15; i++) {
            const rockSize = 0.1 + Math.random() * 0.2;
            const rock = MeshBuilder.CreateBox('rock', {
                width: rockSize,
                height: rockSize,
                depth: rockSize
            }, this.scene);
            rock.material = rockMaterial;
            rock.parent = this.mesh;
            
            // Random position on the surface
            const side = Math.floor(Math.random() * 6); // 6 sides of the cube
            let x = (Math.random() - 0.5) * 1.0;
            let y = (Math.random() - 0.5) * 0.8;
            let z = (Math.random() - 0.5) * 1.2;
            
            // Push to the surface
            if (side === 0) x = -0.65;
            else if (side === 1) x = 0.65;
            else if (side === 2) y = -0.5;
            else if (side === 3) y = 0.5;
            else if (side === 4) z = -0.75;
            else z = 0.75;
            
            rock.position = new Vector3(x, y, z);
            
            // Random rotation
            rock.rotation = new Vector3(
                Math.random() * Math.PI,
                Math.random() * Math.PI,
                Math.random() * Math.PI
            );
            
            // Store rock for animation
            this.rocks.push(rock);
        }
        
        // Add glowing cracks
        const crackMaterial = new StandardMaterial('crackMaterial', this.scene);
        crackMaterial.diffuseColor = new Color3(0.8, 0.3, 0); // Orange-red
        crackMaterial.emissiveColor = new Color3(0.8, 0.3, 0); // Glowing
        
        // Add several cracks
        for (let i = 0; i < 5; i++) {
            const crack = MeshBuilder.CreateBox('crack', {
                width: 0.05 + Math.random() * 0.1,
                height: 0.05,
                depth: 0.3 + Math.random() * 0.4
            }, this.scene);
            crack.material = crackMaterial;
            crack.parent = this.mesh;
            
            // Random position on the body
            crack.position = new Vector3(
                (Math.random() - 0.5) * 1.0,
                (Math.random() - 0.5) * 0.8,
                (Math.random() - 0.5) * 1.2
            );
            
            // Random rotation
            crack.rotation = new Vector3(
                Math.random() * Math.PI,
                Math.random() * Math.PI,
                Math.random() * Math.PI
            );
            
            // Store crack for animation
            this.cracks.push(crack);
        }
        
        // Add spikes
        const spikeMaterial = new StandardMaterial('spikeMaterial', this.scene);
        spikeMaterial.diffuseColor = new Color3(0.2, 0.2, 0.2); // Dark gray
        
        // Add several spikes
        for (let i = 0; i < 8; i++) {
            const spike = MeshBuilder.CreateCylinder('spike', {
                height: 0.4,
                diameterTop: 0.01,
                diameterBottom: 0.15,
                tessellation: 5
            }, this.scene);
            spike.material = spikeMaterial;
            spike.parent = this.mesh;
            
            // Position on top and sides
            let x = (Math.random() - 0.5) * 1.0;
            let y = 0.5; // Top
            let z = (Math.random() - 0.5) * 1.2;
            
            // Some spikes on the sides
            if (i > 4) {
                y = (Math.random() - 0.5) * 0.8;
                if (Math.random() > 0.5) {
                    x = 0.65 * (Math.random() > 0.5 ? 1 : -1);
                } else {
                    z = 0.75 * (Math.random() > 0.5 ? 1 : -1);
                }
            }
            
            spike.position = new Vector3(x, y, z);
            
            // Point outward
            if (i > 4) {
                if (Math.abs(x) > Math.abs(z)) {
                    spike.rotation.z = x > 0 ? -Math.PI/2 : Math.PI/2;
                } else {
                    spike.rotation.x = z > 0 ? Math.PI/2 : -Math.PI/2;
                }
            }
        }
        
        // Add glowing eyes
        const eyeMaterial = new StandardMaterial('eyeMaterial', this.scene);
        eyeMaterial.diffuseColor = new Color3(1, 0.5, 0); // Orange
        eyeMaterial.emissiveColor = new Color3(1, 0.5, 0); // Glowing
        
        // Left eye
        this.leftEye = MeshBuilder.CreateSphere('leftEye', {
            diameter: 0.2
        }, this.scene);
        this.leftEye.material = eyeMaterial;
        this.leftEye.parent = this.mesh;
        this.leftEye.position = new Vector3(-0.3, 0.2, 0.75);
        
        // Right eye
        this.rightEye = MeshBuilder.CreateSphere('rightEye', {
            diameter: 0.2
        }, this.scene);
        this.rightEye.material = eyeMaterial;
        this.rightEye.parent = this.mesh;
        this.rightEye.position = new Vector3(0.3, 0.2, 0.75);
        
        // Add a jaw
        const jawMaterial = new StandardMaterial('jawMaterial', this.scene);
        jawMaterial.diffuseColor = new Color3(0.35, 0.35, 0.35); // Slightly lighter than body
        
        this.jaw = MeshBuilder.CreateBox('jaw', {
            width: 0.8,
            height: 0.3,
            depth: 0.4
        }, this.scene);
        this.jaw.material = jawMaterial;
        this.jaw.parent = this.mesh;
        this.jaw.position = new Vector3(0, -0.3, 0.6);
        
        // Add legs/feet
        const legMaterial = new StandardMaterial('legMaterial', this.scene);
        legMaterial.diffuseColor = new Color3(0.3, 0.3, 0.3); // Dark gray
        
        // Left front foot
        const leftFrontFoot = MeshBuilder.CreateCylinder('leftFrontFoot', {
            height: 0.3,
            diameter: 0.3,
            tessellation: 6
        }, this.scene);
        leftFrontFoot.material = legMaterial;
        leftFrontFoot.parent = this.mesh;
        leftFrontFoot.position = new Vector3(-0.5, -0.65, 0.5);
        
        // Right front foot
        const rightFrontFoot = MeshBuilder.CreateCylinder('rightFrontFoot', {
            height: 0.3,
            diameter: 0.3,
            tessellation: 6
        }, this.scene);
        rightFrontFoot.material = legMaterial;
        rightFrontFoot.parent = this.mesh;
        rightFrontFoot.position = new Vector3(0.5, -0.65, 0.5);
        
        // Left back foot
        const leftBackFoot = MeshBuilder.CreateCylinder('leftBackFoot', {
            height: 0.3,
            diameter: 0.3,
            tessellation: 6
        }, this.scene);
        leftBackFoot.material = legMaterial;
        leftBackFoot.parent = this.mesh;
        leftBackFoot.position = new Vector3(-0.5, -0.65, -0.5);
        
        // Right back foot
        const rightBackFoot = MeshBuilder.CreateCylinder('rightBackFoot', {
            height: 0.3,
            diameter: 0.3,
            tessellation: 6
        }, this.scene);
        rightBackFoot.material = legMaterial;
        rightBackFoot.parent = this.mesh;
        rightBackFoot.position = new Vector3(0.5, -0.65, -0.5);
        
        // Store original scale
        this.originalScale = 1.0;
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
                // Each rock shakes differently
                rock.position.y += Math.sin(this.stompTime * 2 + i) * 0.002;
                rock.rotation.y += Math.sin(this.stompTime + i) * 0.01;
            }
            
            // Animate cracks - pulse the glow
            for (let i = 0; i < this.cracks.length; i++) {
                const crack = this.cracks[i];
                const material = crack.material as StandardMaterial;
                // Pulse the emissive color
                const pulseIntensity = 0.5 + Math.abs(Math.sin(this.stompTime * 2 + i)) * 0.5;
                material.emissiveColor = new Color3(pulseIntensity, pulseIntensity * 0.3, 0);
                
                // Slightly change the size
                crack.scaling.y = 1.0 + Math.sin(this.stompTime * 3 + i) * 0.1;
            }
            
            // Animate eyes - make them blink occasionally
            if (this.leftEye && this.rightEye) {
                // Blink every few seconds
                const blinkFactor = Math.sin(this.stompTime * 0.5) > 0.95 ? 0.1 : 1.0;
                this.leftEye.scaling.y = blinkFactor;
                this.rightEye.scaling.y = blinkFactor;
                
                // Pulse the glow
                const eyeMaterial = this.leftEye.material as StandardMaterial;
                const pulseIntensity = 0.8 + Math.abs(Math.sin(this.stompTime)) * 0.4;
                eyeMaterial.emissiveColor = new Color3(pulseIntensity, pulseIntensity * 0.5, 0);
                
                const rightEyeMaterial = this.rightEye.material as StandardMaterial;
                rightEyeMaterial.emissiveColor = new Color3(pulseIntensity, pulseIntensity * 0.5, 0);
            }
            
            // Animate jaw - open and close slightly
            if (this.jaw) {
                this.jaw.position.y = -0.3 - Math.abs(Math.sin(this.stompTime * 0.7)) * 0.1;
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
     * Override the health bar creation to make it larger for tank enemies
     */
    protected createHealthBar(): void {
        if (!this.mesh) return;
        
        // Create background bar (gray)
        this.healthBarBackgroundMesh = MeshBuilder.CreateBox('healthBarBg', {
            width: 1.5, // Wider for tank enemies
            height: 0.2, // Taller for tank enemies
            depth: 0.05
        }, this.scene);
        
        // Position above the enemy
        this.healthBarBackgroundMesh.position = new Vector3(
            this.position.x,
            this.position.y + 1.2, // Higher for larger enemy
            this.position.z
        );
        
        // Create material for background
        const bgMaterial = new StandardMaterial('healthBarBgMaterial', this.scene);
        bgMaterial.diffuseColor = new Color3(0.3, 0.3, 0.3);
        this.healthBarBackgroundMesh.material = bgMaterial;
        
        // Create health bar (green)
        this.healthBarMesh = MeshBuilder.CreateBox('healthBar', {
            width: 1.5, // Wider for tank enemies
            height: 0.2, // Taller for tank enemies
            depth: 0.06 // Slightly in front of background
        }, this.scene);
        
        // Position at the same place as background
        this.healthBarMesh.position = new Vector3(
            this.position.x,
            this.position.y + 1.2, // Higher for larger enemy
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
        const offset = (1 - healthPercent) * 0.75; // Adjusted for wider bar (1.5 width)
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
        this.healthBarBackgroundMesh.position.y = this.position.y + 1.2; // Higher for larger enemy
        this.healthBarBackgroundMesh.position.z = this.position.z;
        
        this.healthBarMesh.position.y = this.position.y + 1.2; // Higher for larger enemy
        this.healthBarMesh.position.z = this.position.z;
    }
    
    /**
     * Apply damage to the enemy with innate tank damage reduction
     * @param amount The amount of damage to apply
     * @returns True if the enemy died from this damage
     */
    public takeDamage(amount: number): boolean {
        // Tank enemies now have innate 30% damage reduction (increased from 20%)
        const tankReduction = amount * 0.3; // 30% damage reduction
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