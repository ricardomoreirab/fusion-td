import { Vector3, MeshBuilder, StandardMaterial, Color3, Mesh, Space, ParticleSystem, Texture, CylinderBuilder } from '@babylonjs/core';
import { Game } from '../../Game';
import { Tower } from './Tower';

export class BasicTower extends Tower {
    constructor(game: Game, position: Vector3) {
        // Basic tower has medium range, medium damage, medium fire rate, and low cost
        super(game, position, 10, 10, 1, 50);
    }

    /**
     * Create the tower mesh
     */
    protected createMesh(): void {
        // Create a root mesh to hold all tower parts
        this.mesh = new Mesh("basicTowerRoot", this.scene);
        this.mesh.position = this.position.clone();
        
        // Create a stone base for the medieval tower
        const base = MeshBuilder.CreateCylinder('towerBase', {
            height: 0.6,
            diameter: 2.2,
            tessellation: 12
        }, this.scene);
        base.position = new Vector3(0, 0.3, 0); // Position relative to root
        
        // Create a stone middle section
        const middle = MeshBuilder.CreateCylinder('towerMiddle', {
            height: 1.0,
            diameterTop: 1.8,
            diameterBottom: 2.0,
            tessellation: 12
        }, this.scene);
        middle.position = new Vector3(0, 1.1, 0); // Position relative to root
        
        // Create a wooden platform for the ballista
        const platform = MeshBuilder.CreateCylinder('towerPlatform', {
            height: 0.2,
            diameter: 2.0,
            tessellation: 12
        }, this.scene);
        platform.position = new Vector3(0, 1.7, 0);
        
        // Create the ballista base (rotatable part)
        const ballistaBase = MeshBuilder.CreateBox('ballistaBase', {
            width: 1.4,
            height: 0.3,
            depth: 1.4
        }, this.scene);
        ballistaBase.position = new Vector3(0, 1.95, 0);
        
        // Create the ballista arms (crossbow shape)
        const leftArm = MeshBuilder.CreateBox('leftArm', {
            width: 0.2,
            height: 0.15,
            depth: 1.2
        }, this.scene);
        leftArm.position = new Vector3(-0.6, 2.1, 0);
        leftArm.rotation.y = Math.PI / 4; // Angle outward
        
        const rightArm = MeshBuilder.CreateBox('rightArm', {
            width: 0.2,
            height: 0.15,
            depth: 1.2
        }, this.scene);
        rightArm.position = new Vector3(0.6, 2.1, 0);
        rightArm.rotation.y = -Math.PI / 4; // Angle outward
        
        // Create the string connecting the arms
        const leftString = MeshBuilder.CreateCylinder('leftString', {
            height: 1.0,
            diameter: 0.05,
            tessellation: 8
        }, this.scene);
        leftString.position = new Vector3(-0.5, 2.1, 0.4);
        leftString.rotation.x = Math.PI / 2;
        leftString.rotation.y = -Math.PI / 8;
        
        const rightString = MeshBuilder.CreateCylinder('rightString', {
            height: 1.0,
            diameter: 0.05,
            tessellation: 8
        }, this.scene);
        rightString.position = new Vector3(0.5, 2.1, 0.4);
        rightString.rotation.x = Math.PI / 2;
        rightString.rotation.y = Math.PI / 8;
        
        // Create the central rail for the bolt
        const rail = MeshBuilder.CreateBox('rail', {
            width: 0.3,
            height: 0.1,
            depth: 1.6
        }, this.scene);
        rail.position = new Vector3(0, 2.0, 0.2);
        
        // Create a bolt (arrow) for the ballista - will be the visible projectile
        const bolt = MeshBuilder.CreateCylinder('bolt', {
            height: 1.0,
            diameter: 0.1,
            tessellation: 8
        }, this.scene);
        bolt.rotation.x = Math.PI / 2; // Horizontal
        bolt.position = new Vector3(0, 2.1, 0.8); // At front of rail
        
        // Create bolt head (arrow tip) using cylinder with zero top diameter
        const boltHead = MeshBuilder.CreateCylinder('boltHead', {
            height: 0.3,
            diameterTop: 0,
            diameterBottom: 0.2,
            tessellation: 8
        }, this.scene);
        boltHead.rotation.x = Math.PI / 2; // Horizontal
        boltHead.position = new Vector3(0, 2.1, 1.25); // In front of bolt
        
        // Create bolt fletching (arrow feathers)
        const fletching = MeshBuilder.CreateCylinder('fletching', {
            height: 0.2,
            diameterTop: 0.05,
            diameterBottom: 0.25,
            tessellation: 8
        }, this.scene);
        fletching.rotation.x = Math.PI / 2; // Horizontal
        fletching.position = new Vector3(0, 2.1, 0.4); // At back of bolt
        
        // Create materials 
        const stoneMaterial = new StandardMaterial('stoneMaterial', this.scene);
        stoneMaterial.diffuseColor = new Color3(0.5, 0.5, 0.45); // Stone color
        stoneMaterial.specularColor = new Color3(0.2, 0.2, 0.2);
        stoneMaterial.specularPower = 64;
        base.material = stoneMaterial;
        middle.material = stoneMaterial;
        
        const woodMaterial = new StandardMaterial('woodMaterial', this.scene);
        woodMaterial.diffuseColor = new Color3(0.4, 0.3, 0.2); // Brown wood
        woodMaterial.specularColor = new Color3(0.1, 0.1, 0.1);
        platform.material = woodMaterial;
        ballistaBase.material = woodMaterial;
        leftArm.material = woodMaterial;
        rightArm.material = woodMaterial;
        rail.material = woodMaterial;
        
        const stringMaterial = new StandardMaterial('stringMaterial', this.scene);
        stringMaterial.diffuseColor = new Color3(0.85, 0.8, 0.7); // Rope color
        leftString.material = stringMaterial;
        rightString.material = stringMaterial;
        
        const boltMaterial = new StandardMaterial('boltMaterial', this.scene);
        boltMaterial.diffuseColor = new Color3(0.6, 0.5, 0.3); // Wood color
        bolt.material = boltMaterial;
        
        const boltHeadMaterial = new StandardMaterial('boltHeadMaterial', this.scene);
        boltHeadMaterial.diffuseColor = new Color3(0.5, 0.5, 0.5); // Metal color
        boltHeadMaterial.specularColor = new Color3(0.8, 0.8, 0.8);
        boltHeadMaterial.specularPower = 64;
        boltHead.material = boltHeadMaterial;
        
        const fletchingMaterial = new StandardMaterial('fletchingMaterial', this.scene);
        fletchingMaterial.diffuseColor = new Color3(0.4, 0.1, 0.1); // Red feather
        fletching.material = fletchingMaterial;
        
        // Parent all parts to the root mesh
        base.parent = this.mesh;
        middle.parent = this.mesh;
        platform.parent = this.mesh;
        
        // Create a turret group for rotation
        const turret = new Mesh("ballistaTurret", this.scene);
        turret.position = new Vector3(0, 0, 0);
        turret.parent = this.mesh;
        
        // Parent ballista parts to the turret for proper rotation
        ballistaBase.parent = turret;
        leftArm.parent = turret;
        rightArm.parent = turret;
        leftString.parent = turret;
        rightString.parent = turret;
        rail.parent = turret;
        bolt.parent = turret;
        boltHead.parent = turret;
        fletching.parent = turret;
        
        // Create arrow template for visual effect (not visible initially)
        const arrowTemplate = MeshBuilder.CreateCylinder('basicArrowTemplate', {
            height: 1.0,
            diameter: 0.1,
            tessellation: 8
        }, this.scene);
        
        // Create arrow head using cylinder with zero top diameter
        const arrowHead = MeshBuilder.CreateCylinder('arrowHead', {
            height: 0.3,
            diameterTop: 0,
            diameterBottom: 0.2,
            tessellation: 8
        }, this.scene);
        arrowHead.parent = arrowTemplate;
        arrowHead.position.z = 0.65; // Position at front of arrow
        
        // Create arrow fletching
        const arrowFletching = MeshBuilder.CreateCylinder('arrowFletching', {
            height: 0.2,
            diameterTop: 0.05,
            diameterBottom: 0.25,
            tessellation: 8
        }, this.scene);
        arrowFletching.parent = arrowTemplate;
        arrowFletching.position.z = -0.5; // Position at back of arrow
        
        // Create arrow materials
        const arrowShaftMaterial = new StandardMaterial('arrowShaftMaterial', this.scene);
        arrowShaftMaterial.diffuseColor = new Color3(0.6, 0.5, 0.3); // Wood color
        arrowTemplate.material = arrowShaftMaterial;
        
        const arrowHeadMaterial = new StandardMaterial('arrowHeadMaterial', this.scene);
        arrowHeadMaterial.diffuseColor = new Color3(0.5, 0.5, 0.5); // Metal color
        arrowHeadMaterial.specularColor = new Color3(0.8, 0.8, 0.8);
        arrowHeadMaterial.specularPower = 64;
        arrowHead.material = arrowHeadMaterial;
        
        const arrowFletchingMaterial = new StandardMaterial('arrowFletchingMaterial', this.scene);
        arrowFletchingMaterial.diffuseColor = new Color3(0.4, 0.1, 0.1); // Red feather
        arrowFletching.material = arrowFletchingMaterial;
        
        arrowTemplate.rotation.x = Math.PI / 2; // Orient horizontally
        arrowTemplate.isVisible = false; // Hide the template
        
        // Track active bullets for animation
        const activeBullets: { mesh: Mesh, distance: number, maxDistance: number, targetEnemy: any, targetPosition: Vector3 }[] = [];
        
        // Add firing effect
        let lastFireTime = 0;
        let isInitialized = false;
        
        // Add a small delay before the tower can fire to ensure proper initialization
        setTimeout(() => {
            isInitialized = true;
        }, 500);
        
        this.scene.registerBeforeRender(() => {
            if (this.targetEnemy && isInitialized) {
                // Check if it's time to fire based on fire rate
                const currentTime = performance.now();
                if (currentTime - lastFireTime > (1000 / this.fireRate)) {
                    lastFireTime = currentTime;
                    
                    // Create a new bullet instance
                    const newBullet = arrowTemplate.clone("basicBullet_" + currentTime);
                    newBullet.isVisible = true;
                    
                    // Get the world position of the bolt
                    const boltWorldMatrix = bolt.getWorldMatrix();
                    const boltWorldPosition = Vector3.TransformCoordinates(new Vector3(0, 0, 0), boltWorldMatrix);
                    newBullet.position = boltWorldPosition;
                    
                    // Get the direction to the target
                    if (this.targetEnemy) {
                        const targetPosition = this.targetEnemy.getPosition();
                        // Create a direction vector from bolt to target
                        const direction = targetPosition.subtract(boltWorldPosition).normalize();
                        
                        // Set the bullet's forward direction to point at the target
                        newBullet.lookAt(targetPosition);
                        
                        // Add to active bullets for animation
                        activeBullets.push({
                            mesh: newBullet,
                            distance: 0,
                            maxDistance: 20, // Maximum travel distance before disposal
                            targetEnemy: this.targetEnemy,
                            targetPosition: targetPosition.clone()
                        });
                    }
                }
            }
            
            // Update bullet positions
            for (let i = activeBullets.length - 1; i >= 0; i--) {
                const bulletInfo = activeBullets[i];
                
                // Move bullet forward along its local Z axis
                const moveDistance = 0.6; // Speed of bullet
                bulletInfo.mesh.translate(new Vector3(0, 0, 1), moveDistance, Space.LOCAL);
                bulletInfo.distance += moveDistance;
                
                // Check if the bullet has reached its target
                const targetPosition = bulletInfo.targetEnemy.getPosition(); // Get updated position
                const distanceToTarget = Vector3.Distance(bulletInfo.mesh.position, targetPosition);
                
                // Remove bullet if it's traveled too far or hit the target
                if (bulletInfo.distance >= bulletInfo.maxDistance || distanceToTarget < 0.5) {
                    // Create impact effect if hit target
                    if (distanceToTarget < 0.5) {
                        this.createBulletImpactEffect(bulletInfo.mesh.position);
                    }
                    
                    bulletInfo.mesh.dispose();
                    activeBullets.splice(i, 1);
                }
            }
        });
    }

    /**
     * Create a particle effect when a bullet hits an enemy
     */
    private createBulletImpactEffect(position: Vector3): void {
        // Create a particle system for the impact
        const particleSystem = new ParticleSystem("bulletImpact", 50, this.scene);
        
        // Set particle texture
        particleSystem.particleTexture = new Texture("assets/textures/particle.png", this.scene);
        
        // Set emission properties
        particleSystem.emitter = position;
        particleSystem.minEmitBox = new Vector3(-0.1, -0.1, -0.1);
        particleSystem.maxEmitBox = new Vector3(0.1, 0.1, 0.1);
        
        // Set particle properties - blue for basic tower
        particleSystem.color1 = new Color3(0.2, 0.4, 1.0).toColor4(1.0);
        particleSystem.color2 = new Color3(0.1, 0.3, 0.8).toColor4(1.0);
        particleSystem.colorDead = new Color3(0.0, 0.1, 0.5).toColor4(0.0);
        
        particleSystem.minSize = 0.1;
        particleSystem.maxSize = 0.3;
        
        particleSystem.minLifeTime = 0.1;
        particleSystem.maxLifeTime = 0.3;
        
        particleSystem.emitRate = 300;
        
        particleSystem.blendMode = ParticleSystem.BLENDMODE_ONEONE;
        
        particleSystem.gravity = new Vector3(0, -9.8, 0);
        
        particleSystem.minEmitPower = 1;
        particleSystem.maxEmitPower = 3;
        
        particleSystem.updateSpeed = 0.01;
        
        // Start the particle system
        particleSystem.start();
        
        // Stop after a short time
        setTimeout(() => {
            particleSystem.stop();
            // Dispose after particles have died out
            setTimeout(() => {
                particleSystem.dispose();
            }, 500);
        }, 100);
    }

    /**
     * Override the createProjectileEffect method to prevent the default projectile
     * since we have our own custom bullet effect
     */
    protected createProjectileEffect(targetPosition: Vector3): void {
        // Do nothing - we're using our custom bullet effect instead
        // This prevents the default white projectile from being created
    }

    /**
     * Update tower visuals after upgrade
     */
    protected updateVisuals(): void {
        if (!this.mesh) return;
        
        // Find the turret
        const turret = this.scene.getMeshByName('ballistaTurret');
        if (turret) {
            // Scale up the turret based on level (reduced scaling)
            const scale = 1 + (this.level - 1) * 0.1; // Reduced from 0.2 to 0.1
            turret.scaling.setAll(scale);
            
            // Update color based on level (more subtle color changes)
            const material = turret.material as StandardMaterial;
            if (material) {
                // Make it more red as it levels up (more subtle)
                const greenValue = Math.max(0.2, 0.4 - (this.level - 1) * 0.05); // Reduced from 0.1 to 0.05
                const blueValue = Math.max(0.2, 0.8 - (this.level - 1) * 0.1); // Reduced from 0.2 to 0.1
                material.diffuseColor = new Color3(0.2 + (this.level - 1) * 0.1, greenValue, blueValue); // Reduced from 0.2 to 0.1
                material.specularColor = new Color3(0.6, 0.6, blueValue);
            }
            
            // Find and update the sensor color to show power level (more subtle)
            const sensor = this.scene.getMeshByName('fletching');
            if (sensor && sensor.material) {
                const sensorMat = sensor.material as StandardMaterial;
                sensorMat.emissiveColor = new Color3(0.5 + (this.level - 1) * 0.05, 0.1, 0.1); // Reduced from 0.1 to 0.05
                sensorMat.diffuseColor = new Color3(0.7 + (this.level - 1) * 0.05, 0.2, 0.2); // Reduced from 0.1 to 0.05
            }
        }
    }
} 