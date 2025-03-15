import { Vector3, MeshBuilder, StandardMaterial, Color3, Mesh, Space, ParticleSystem, Texture } from '@babylonjs/core';
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
        
        // Create a cylinder for the tower base
        const base = MeshBuilder.CreateCylinder('towerBase', {
            height: 0.8,
            diameter: 2,
            tessellation: 16
        }, this.scene);
        base.position = new Vector3(0, 0.4, 0); // Position relative to root
        
        // Create a narrower cylinder for the middle section
        const middle = MeshBuilder.CreateCylinder('towerMiddle', {
            height: 1.2,
            diameterTop: 1.4,
            diameterBottom: 1.8,
            tessellation: 16
        }, this.scene);
        middle.position = new Vector3(0, 1.4, 0); // Position relative to root
        
        // Create a box for the tower turret
        const turret = MeshBuilder.CreateBox('towerTurret', {
            width: 1.2,
            height: 0.6,
            depth: 1.6
        }, this.scene);
        turret.position = new Vector3(0, 2.3, 0); // Position relative to root
        
        // Create a cylinder for the gun barrel - position relative to turret
        const barrel = MeshBuilder.CreateCylinder('towerBarrel', {
            height: 1.2,
            diameter: 0.3,
            tessellation: 12
        }, this.scene);
        barrel.rotation.x = Math.PI / 2; // Rotate to be horizontal
        barrel.position = new Vector3(0, 0, 0.9); // Position relative to turret
        
        // Add a muzzle brake at the end of the barrel - position relative to barrel
        const muzzleBrake = MeshBuilder.CreateCylinder('towerMuzzleBrake', {
            height: 0.2,
            diameter: 0.5,
            tessellation: 12
        }, this.scene);
        muzzleBrake.rotation.x = Math.PI / 2; // Rotate to be horizontal
        muzzleBrake.position = new Vector3(0, 0, 0.7); // Position relative to barrel end
        
        // Add details to the turret - a small radar or sensor - position relative to turret
        const sensor = MeshBuilder.CreateCylinder('towerSensor', {
            height: 0.4,
            diameter: 0.3,
            tessellation: 8
        }, this.scene);
        sensor.position = new Vector3(0, 0.3, -0.5); // Position relative to turret
        
        // Create materials with different shades for visual interest
        const baseMaterial = new StandardMaterial('towerBaseMaterial', this.scene);
        baseMaterial.diffuseColor = new Color3(0.2, 0.2, 0.3); // Dark gray
        base.material = baseMaterial;
        
        const middleMaterial = new StandardMaterial('towerMiddleMaterial', this.scene);
        middleMaterial.diffuseColor = new Color3(0.3, 0.3, 0.5); // Medium gray-blue
        middle.material = middleMaterial;
        
        const turretMaterial = new StandardMaterial('towerTurretMaterial', this.scene);
        turretMaterial.diffuseColor = new Color3(0.2, 0.4, 0.8); // Blue
        turretMaterial.specularColor = new Color3(0.6, 0.6, 0.8);
        turretMaterial.specularPower = 32;
        turret.material = turretMaterial;
        
        const barrelMaterial = new StandardMaterial('towerBarrelMaterial', this.scene);
        barrelMaterial.diffuseColor = new Color3(0.1, 0.1, 0.1); // Almost black
        barrel.material = barrelMaterial;
        
        const muzzleMaterial = new StandardMaterial('towerMuzzleMaterial', this.scene);
        muzzleMaterial.diffuseColor = new Color3(0.15, 0.15, 0.15); // Dark gray
        muzzleBrake.material = muzzleMaterial;
        
        const sensorMaterial = new StandardMaterial('towerSensorMaterial', this.scene);
        sensorMaterial.diffuseColor = new Color3(0.7, 0.2, 0.2); // Red
        sensorMaterial.emissiveColor = new Color3(0.5, 0.1, 0.1); // Glowing red
        sensor.material = sensorMaterial;
        
        // Parent all parts to the root mesh
        base.parent = this.mesh;
        middle.parent = this.mesh;
        turret.parent = this.mesh;
        
        // Parent components to the turret for proper rotation
        barrel.parent = turret;
        sensor.parent = turret;
        
        // Parent muzzle brake to barrel
        muzzleBrake.parent = barrel;
        
        // Create bullet template for visual effect (not visible initially)
        const bulletTemplate = MeshBuilder.CreateSphere('basicBulletTemplate', {
            diameter: 0.3,
            segments: 8
        }, this.scene);
        
        // Create bullet material with blue glow to match tower theme
        const bulletMaterial = new StandardMaterial('basicBulletMaterial', this.scene);
        bulletMaterial.diffuseColor = new Color3(0.2, 0.4, 0.8); // Blue
        bulletMaterial.emissiveColor = new Color3(0.1, 0.2, 0.6); // Blue glow
        bulletMaterial.specularColor = new Color3(0.6, 0.8, 1.0);
        bulletMaterial.specularPower = 64; // Shiny
        bulletTemplate.material = bulletMaterial;
        bulletTemplate.isVisible = false; // Hide the template
        
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
                    const newBullet = bulletTemplate.clone("basicBullet_" + currentTime);
                    newBullet.isVisible = true;
                    
                    // Get the world position of the muzzle brake
                    const muzzleWorldMatrix = muzzleBrake.getWorldMatrix();
                    const muzzleWorldPosition = Vector3.TransformCoordinates(new Vector3(0, 0, 0), muzzleWorldMatrix);
                    newBullet.position = muzzleWorldPosition;
                    
                    // Get the direction to the target
                    if (this.targetEnemy) {
                        const targetPosition = this.targetEnemy.getPosition();
                        // Create a direction vector from muzzle to target
                        const direction = targetPosition.subtract(muzzleWorldPosition).normalize();
                        
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
        const turret = this.scene.getMeshByName('towerTurret');
        if (turret) {
            // Scale up the turret based on level
            const scale = 1 + (this.level - 1) * 0.2;
            turret.scaling.setAll(scale);
            
            // Update color based on level
            const material = turret.material as StandardMaterial;
            if (material) {
                // Make it more red as it levels up
                const greenValue = Math.max(0.1, 0.4 - (this.level - 1) * 0.1);
                const blueValue = Math.max(0.1, 0.8 - (this.level - 1) * 0.2);
                material.diffuseColor = new Color3(0.2 + (this.level - 1) * 0.2, greenValue, blueValue);
                material.specularColor = new Color3(0.6, 0.6, blueValue);
            }
            
            // Find and update the sensor color to show power level
            const sensor = this.scene.getMeshByName('towerSensor');
            if (sensor && sensor.material) {
                const sensorMat = sensor.material as StandardMaterial;
                sensorMat.emissiveColor = new Color3(0.5 + (this.level - 1) * 0.1, 0.1, 0.1);
                sensorMat.diffuseColor = new Color3(0.7 + (this.level - 1) * 0.1, 0.2, 0.2);
            }
        }
    }
} 