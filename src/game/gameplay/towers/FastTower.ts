import { Vector3, MeshBuilder, StandardMaterial, Color3, Mesh, Space, ParticleSystem, Texture } from '@babylonjs/core';
import { Game } from '../../Game';
import { Tower } from './Tower';

export class FastTower extends Tower {
    constructor(game: Game, position: Vector3) {
        // Fast tower has low range, low damage, very high fire rate, and medium cost
        super(game, position, 8, 5, 4, 75);
    }

    protected createMesh(): void {
        // Create a root mesh to hold all tower parts
        this.mesh = new Mesh("fastTowerRoot", this.scene);
        this.mesh.position = this.position.clone();
        
        // Create a cylinder for the tower base
        const base = MeshBuilder.CreateCylinder('fastBase', {
            height: 0.8,
            diameter: 1.8,
            tessellation: 16
        }, this.scene);
        base.position = new Vector3(0, 0.4, 0); // Position relative to root
        
        // Create a middle section
        const middle = MeshBuilder.CreateCylinder('fastMiddle', {
            height: 1.0,
            diameterTop: 1.2,
            diameterBottom: 1.6,
            tessellation: 16
        }, this.scene);
        middle.position = new Vector3(0, 1.3, 0); // Position relative to root
        
        // Create a sphere for the turret head
        const turretHead = MeshBuilder.CreateSphere('fastTurretHead', {
            diameter: 1.2,
            segments: 16
        }, this.scene);
        turretHead.position = new Vector3(0, 2.2, 0); // Position relative to root
        
        // Create a housing for the barrels - position relative to turret head
        const housing = MeshBuilder.CreateCylinder('fastHousing', {
            height: 0.6,
            diameter: 1.0,
            tessellation: 16
        }, this.scene);
        housing.rotation.x = Math.PI / 2; // Rotate to be horizontal
        housing.position = new Vector3(0, 0, 0.3); // Position relative to turret head
        
        // Create a single barrel for rapid fire
        const barrel = MeshBuilder.CreateCylinder('fastBarrel', {
            height: 2.0,
            diameter: 0.25,
            tessellation: 12
        }, this.scene);
        barrel.rotation.x = Math.PI / 2; // Rotate to be horizontal
        barrel.position = new Vector3(0, 0, 1.2); // Position relative to turret head
        
        // Create a muzzle brake at the end of the barrel
        const muzzleBrake = MeshBuilder.CreateCylinder('fastMuzzleBrake', {
            height: 0.3,
            diameter: 0.4,
            tessellation: 12
        }, this.scene);
        muzzleBrake.rotation.x = Math.PI / 2; // Rotate to be horizontal
        muzzleBrake.position = new Vector3(0, 0, 2.3); // Position relative to turret head
        
        // Add cooling fins to the barrel
        const fins: Mesh[] = [];
        for (let i = 0; i < 8; i++) {
            const angle = (i / 8) * Math.PI * 2;
            const fin = MeshBuilder.CreateBox(`fastFin${i}`, {
                width: 0.05,
                height: 0.4,
                depth: 0.8
            }, this.scene);
            
            // Position the fin around the barrel
            const finRadius = 0.3;
            const x = Math.cos(angle) * finRadius;
            const y = Math.sin(angle) * finRadius;
            
            fin.position = new Vector3(x, y, 1.0); // Position relative to turret head
            
            // Rotate the fin to point outward
            fin.rotation.z = angle;
            
            fins.push(fin);
        }
        
        // Create materials with different shades
        const baseMaterial = new StandardMaterial('fastBaseMaterial', this.scene);
        baseMaterial.diffuseColor = new Color3(0.2, 0.3, 0.2); // Dark green-gray
        base.material = baseMaterial;
        
        const middleMaterial = new StandardMaterial('fastMiddleMaterial', this.scene);
        middleMaterial.diffuseColor = new Color3(0.3, 0.5, 0.3); // Medium green
        middle.material = middleMaterial;
        
        const turretMaterial = new StandardMaterial('fastTurretMaterial', this.scene);
        turretMaterial.diffuseColor = new Color3(0.2, 0.8, 0.2); // Bright green
        turretMaterial.specularColor = new Color3(0.6, 0.8, 0.6);
        turretMaterial.specularPower = 32;
        turretHead.material = turretMaterial;
        
        const housingMaterial = new StandardMaterial('fastHousingMaterial', this.scene);
        housingMaterial.diffuseColor = new Color3(0.15, 0.15, 0.15); // Dark gray
        housing.material = housingMaterial;
        
        const barrelMaterial = new StandardMaterial('fastBarrelMaterial', this.scene);
        barrelMaterial.diffuseColor = new Color3(0.1, 0.1, 0.1); // Almost black
        barrel.material = barrelMaterial;
        
        const muzzleMaterial = new StandardMaterial('fastMuzzleMaterial', this.scene);
        muzzleMaterial.diffuseColor = new Color3(0.2, 0.2, 0.2); // Dark gray
        muzzleBrake.material = muzzleMaterial;
        
        // Create fin material
        const finMaterial = new StandardMaterial('fastFinMaterial', this.scene);
        finMaterial.diffuseColor = new Color3(0.4, 0.6, 0.4); // Light green
        
        // Apply fin material to all fins
        for (const fin of fins) {
            fin.material = finMaterial;
        }
        
        // Parent all parts to the root mesh
        base.parent = this.mesh;
        middle.parent = this.mesh;
        turretHead.parent = this.mesh;
        
        // Parent all turret components to the turret head
        housing.parent = turretHead;
        barrel.parent = turretHead;
        muzzleBrake.parent = turretHead;
        
        // Parent fins to the turret head
        for (const fin of fins) {
            fin.parent = turretHead;
        }
        
        // Add muzzle flash effect when firing
        let lastFireTime = 0;
        let muzzleFlashVisible = false;
        let isInitialized = false;
        
        // Add a small delay before the tower can fire to ensure proper initialization
        setTimeout(() => {
            isInitialized = true;
        }, 500);
        
        // Create muzzle flash
        const muzzleFlash = MeshBuilder.CreateCylinder('fastMuzzleFlash', {
            height: 0.1,
            diameterTop: 0.6,
            diameterBottom: 0.3,
            tessellation: 12
        }, this.scene);
        muzzleFlash.rotation.x = Math.PI / 2; // Rotate to be horizontal
        muzzleFlash.position = new Vector3(0, 0, 2.5); // Position at the end of the muzzle brake
        
        // Create muzzle flash material
        const muzzleFlashMaterial = new StandardMaterial('fastMuzzleFlashMaterial', this.scene);
        muzzleFlashMaterial.diffuseColor = new Color3(1, 0.7, 0);
        muzzleFlashMaterial.emissiveColor = new Color3(1, 0.5, 0);
        muzzleFlashMaterial.alpha = 0.8;
        muzzleFlash.material = muzzleFlashMaterial;
        muzzleFlash.isVisible = false;
        muzzleFlash.parent = turretHead;
        
        // Create bullet template for visual effect (not visible initially)
        const bulletTemplate = MeshBuilder.CreateCylinder('fastBulletTemplate', {
            height: 0.3,
            diameter: 0.15,
            tessellation: 8
        }, this.scene);
        
        // Create bullet material with green glow to match tower theme
        const bulletMaterial = new StandardMaterial('fastBulletMaterial', this.scene);
        bulletMaterial.diffuseColor = new Color3(0.2, 0.9, 0.2); // Bright green
        bulletMaterial.emissiveColor = new Color3(0, 0.5, 0); // Green glow
        bulletMaterial.specularColor = new Color3(0.8, 1, 0.8);
        bulletMaterial.specularPower = 64; // Shiny
        bulletTemplate.material = bulletMaterial;
        bulletTemplate.isVisible = false; // Hide the template
        
        // Track active bullets for animation
        const activeBullets: { mesh: Mesh, distance: number, maxDistance: number, targetEnemy: any, targetPosition: Vector3 }[] = [];
        
        this.scene.registerBeforeRender(() => {
            if (this.targetEnemy && isInitialized) {
                // Show muzzle flash briefly when firing
                const currentTime = performance.now();
                if (currentTime - lastFireTime > 250) { // Fire every 250ms (4 shots per second)
                    lastFireTime = currentTime;
                    muzzleFlash.isVisible = true;
                    
                    // Hide muzzle flash after a short delay
                    setTimeout(() => {
                        muzzleFlash.isVisible = false;
                    }, 50);
                    
                    // Create a new bullet instance
                    const newBullet = bulletTemplate.clone("fastBullet_" + currentTime);
                    newBullet.rotation.x = Math.PI / 2; // Rotate to be horizontal
                    newBullet.isVisible = true;
                    
                    // Get the world position of the muzzle brake
                    const muzzleWorldMatrix = muzzleBrake.getWorldMatrix();
                    const muzzleWorldPosition = Vector3.TransformCoordinates(new Vector3(0, 0, 0.2), muzzleWorldMatrix);
                    newBullet.position = muzzleWorldPosition;
                    
                    // Get the direction to the target
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
            
            // Update bullet positions
            for (let i = activeBullets.length - 1; i >= 0; i--) {
                const bulletInfo = activeBullets[i];
                
                // Move bullet forward along its local Z axis
                const moveDistance = 0.5; // Speed of bullet
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
        
        // Set particle properties - green for fast tower
        particleSystem.color1 = new Color3(0.2, 1.0, 0.2).toColor4(1.0);
        particleSystem.color2 = new Color3(0.1, 0.8, 0.1).toColor4(1.0);
        particleSystem.colorDead = new Color3(0.0, 0.5, 0.0).toColor4(0.0);
        
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
     * Update tower visuals after upgrade
     */
    protected updateVisuals(): void {
        if (!this.mesh) return;
        
        // Find the turret head
        const turretHead = this.scene.getMeshByName('fastTurretHead');
        if (turretHead) {
            // Scale up the turret based on level
            const scale = 1 + (this.level - 1) * 0.15;
            turretHead.scaling.setAll(scale);
            
            // Update color based on level
            const material = turretHead.material as StandardMaterial;
            if (material) {
                // Make it more intense green as it levels up
                const greenValue = Math.min(1.0, 0.8 + (this.level - 1) * 0.05);
                material.diffuseColor = new Color3(0.2, greenValue, 0.2);
                material.emissiveColor = new Color3(0, 0.1 * this.level, 0); // Add glow effect at higher levels
            }
            
            // Update fin colors
            for (let i = 0; i < 8; i++) {
                const fin = this.scene.getMeshByName(`fastFin${i}`);
                if (fin && fin.material) {
                    const finMat = fin.material as StandardMaterial;
                    finMat.diffuseColor = new Color3(0.4, 0.6 + (this.level - 1) * 0.1, 0.4);
                }
            }
        }
    }
    
    /**
     * Override the createProjectileEffect method to prevent the default projectile
     * since we have our own custom bullet effect
     */
    protected createProjectileEffect(targetPosition: Vector3): void {
        // Do nothing - we're using our custom bullet effect instead
        // This prevents the default white projectile from being created
    }
} 