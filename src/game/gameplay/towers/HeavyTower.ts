import { Vector3, MeshBuilder, StandardMaterial, Color3, Mesh, Space, ParticleSystem, Texture } from '@babylonjs/core';
import { Game } from '../../Game';
import { Tower } from './Tower';

export class HeavyTower extends Tower {
    constructor(game: Game, position: Vector3) {
        // Heavy tower has medium range, very high damage, very low fire rate, and high cost
        super(game, position, 12, 40, 0.3, 125);
    }

    protected createMesh(): void {
        // Create a root mesh to hold all tower parts
        this.mesh = new Mesh("heavyTowerRoot", this.scene);
        this.mesh.position = this.position.clone();
        
        // Create a cylinder for the tower base
        const base = MeshBuilder.CreateCylinder('heavyBase', {
            height: 1.0,
            diameter: 2.4,
            tessellation: 20
        }, this.scene);
        base.position = new Vector3(0, 0.5, 0); // Position relative to root
        
        // Create a middle section
        const middle = MeshBuilder.CreateCylinder('heavyMiddle', {
            height: 1.2,
            diameterTop: 1.8,
            diameterBottom: 2.2,
            tessellation: 20
        }, this.scene);
        middle.position = new Vector3(0, 1.6, 0); // Position relative to root
        
        // Create a box for the tower turret
        const turret = MeshBuilder.CreateBox('heavyTurret', {
            width: 1.8,
            height: 1.0,
            depth: 2.0
        }, this.scene);
        turret.position = new Vector3(0, 2.7, 0); // Position relative to root
        
        // Create armor plates for the turret - position relative to turret
        const frontPlate = MeshBuilder.CreateBox('heavyFrontPlate', {
            width: 2.0,
            height: 1.2,
            depth: 0.2
        }, this.scene);
        frontPlate.position = new Vector3(0, 0, 1.0); // Position relative to turret
        
        // Create side armor plates - position relative to turret
        const leftPlate = MeshBuilder.CreateBox('heavyLeftPlate', {
            width: 0.2,
            height: 1.2,
            depth: 2.0
        }, this.scene);
        leftPlate.position = new Vector3(-0.9, 0, 0); // Position relative to turret
        
        const rightPlate = MeshBuilder.CreateBox('heavyRightPlate', {
            width: 0.2,
            height: 1.2,
            depth: 2.0
        }, this.scene);
        rightPlate.position = new Vector3(0.9, 0, 0); // Position relative to turret
        
        // Create a large barrel - position relative to turret
        const barrel = MeshBuilder.CreateCylinder('heavyBarrel', {
            height: 3.0,
            diameterTop: 0.5,
            diameterBottom: 0.8,
            tessellation: 16
        }, this.scene);
        barrel.rotation.x = Math.PI / 2; // Rotate to be horizontal
        barrel.position = new Vector3(0, 0, 1.5); // Position relative to turret
        
        // Create a muzzle brake at the end of the barrel - position relative to barrel
        const muzzleBrake = MeshBuilder.CreateCylinder('heavyMuzzleBrake', {
            height: 0.5,
            diameter: 1.0,
            tessellation: 16
        }, this.scene);
        muzzleBrake.position = new Vector3(0, 0, 1.5); // Position relative to barrel
        
        // Create materials with different shades
        const baseMaterial = new StandardMaterial('heavyBaseMaterial', this.scene);
        baseMaterial.diffuseColor = new Color3(0.4, 0.3, 0.2); // Brown
        base.material = baseMaterial;
        
        const middleMaterial = new StandardMaterial('heavyMiddleMaterial', this.scene);
        middleMaterial.diffuseColor = new Color3(0.5, 0.4, 0.3); // Lighter brown
        middle.material = middleMaterial;
        
        const turretMaterial = new StandardMaterial('heavyTurretMaterial', this.scene);
        turretMaterial.diffuseColor = new Color3(0.6, 0.4, 0.2); // Orange-brown
        turretMaterial.specularColor = new Color3(0.4, 0.4, 0.4);
        turretMaterial.specularPower = 32;
        turret.material = turretMaterial;
        
        // Armor plate material
        const armorMaterial = new StandardMaterial('heavyArmorMaterial', this.scene);
        armorMaterial.diffuseColor = new Color3(0.3, 0.3, 0.3); // Dark gray
        armorMaterial.specularColor = new Color3(0.5, 0.5, 0.5);
        frontPlate.material = armorMaterial;
        leftPlate.material = armorMaterial;
        rightPlate.material = armorMaterial;
        
        const barrelMaterial = new StandardMaterial('heavyBarrelMaterial', this.scene);
        barrelMaterial.diffuseColor = new Color3(0.2, 0.2, 0.2); // Darker gray
        barrel.material = barrelMaterial;
        
        const muzzleMaterial = new StandardMaterial('heavyMuzzleMaterial', this.scene);
        muzzleMaterial.diffuseColor = new Color3(0.1, 0.1, 0.1); // Almost black
        muzzleBrake.material = muzzleMaterial;
        
        // Parent all parts to the root mesh in the correct hierarchy
        base.parent = this.mesh;
        middle.parent = this.mesh;
        turret.parent = this.mesh;
        
        // Parent armor plates to the turret
        frontPlate.parent = turret;
        leftPlate.parent = turret;
        rightPlate.parent = turret;
        
        // Parent barrel to turret for rotation
        barrel.parent = turret;
        
        // Parent muzzle brake to barrel
        muzzleBrake.parent = barrel;
        
        // Create bullet template for visual effect (not visible initially)
        const bulletTemplate = MeshBuilder.CreateSphere('heavyBulletTemplate', {
            diameter: 0.8, // Larger bullet for heavy tower
            segments: 12
        }, this.scene);
        
        // Create bullet material with orange-brown glow to match tower theme
        const bulletMaterial = new StandardMaterial('heavyBulletMaterial', this.scene);
        bulletMaterial.diffuseColor = new Color3(0.8, 0.4, 0.2); // Orange-brown
        bulletMaterial.emissiveColor = new Color3(0.4, 0.2, 0.1); // Orange-brown glow
        bulletMaterial.specularColor = new Color3(1.0, 0.6, 0.3);
        bulletMaterial.specularPower = 32; // Shiny
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
                    const newBullet = bulletTemplate.clone("heavyBullet_" + currentTime);
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
                const moveDistance = 0.3; // Slower speed for heavy projectile
                bulletInfo.mesh.translate(new Vector3(0, 0, 1), moveDistance, Space.LOCAL);
                bulletInfo.distance += moveDistance;
                
                // Check if the bullet has reached its target
                const targetPosition = bulletInfo.targetEnemy.getPosition(); // Get updated position
                const distanceToTarget = Vector3.Distance(bulletInfo.mesh.position, targetPosition);
                
                // Remove bullet if it's traveled too far or hit the target
                if (bulletInfo.distance >= bulletInfo.maxDistance || distanceToTarget < 0.8) { // Larger hit radius for heavy projectile
                    // Create impact effect if hit target
                    if (distanceToTarget < 0.8) {
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
        const particleSystem = new ParticleSystem("heavyImpact", 100, this.scene);
        
        // Set particle texture
        particleSystem.particleTexture = new Texture("assets/textures/particle.png", this.scene);
        
        // Set emission properties
        particleSystem.emitter = position;
        particleSystem.minEmitBox = new Vector3(-0.2, -0.2, -0.2);
        particleSystem.maxEmitBox = new Vector3(0.2, 0.2, 0.2);
        
        // Set particle properties - orange-red for heavy tower
        particleSystem.color1 = new Color3(1.0, 0.5, 0.1).toColor4(1.0);
        particleSystem.color2 = new Color3(0.8, 0.3, 0.0).toColor4(1.0);
        particleSystem.colorDead = new Color3(0.5, 0.1, 0.0).toColor4(0.0);
        
        particleSystem.minSize = 0.2;
        particleSystem.maxSize = 0.5;
        
        particleSystem.minLifeTime = 0.2;
        particleSystem.maxLifeTime = 0.5;
        
        particleSystem.emitRate = 500;
        
        particleSystem.blendMode = ParticleSystem.BLENDMODE_ONEONE;
        
        particleSystem.gravity = new Vector3(0, -5, 0);
        
        particleSystem.minEmitPower = 2;
        particleSystem.maxEmitPower = 5;
        
        particleSystem.updateSpeed = 0.01;
        
        // Add a small explosion force
        particleSystem.direction1 = new Vector3(-1, 1, -1);
        particleSystem.direction2 = new Vector3(1, 1, 1);
        
        // Start the particle system
        particleSystem.start();
        
        // Stop after a short time
        setTimeout(() => {
            particleSystem.stop();
            // Dispose after particles have died out
            setTimeout(() => {
                particleSystem.dispose();
            }, 800);
        }, 200);
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
        const turret = this.scene.getMeshByName('heavyTurret');
        if (turret) {
            // Scale up the turret based on level (reduced scaling)
            const scale = 1 + (this.level - 1) * 0.08; // Reduced from 0.15 to 0.08
            turret.scaling.setAll(scale);
            
            // Update color based on level (more subtle)
            const material = turret.material as StandardMaterial;
            if (material) {
                // Make it more intense as it levels up (more subtle)
                const redValue = Math.min(1.0, 0.6 + (this.level - 1) * 0.05); // Reduced from 0.1 to 0.05
                material.diffuseColor = new Color3(redValue, 0.4, 0.2);
                material.emissiveColor = new Color3(0.05 * this.level, 0, 0); // Reduced from 0.1 to 0.05
            }
            
            // Update barrel color (more subtle)
            const barrel = this.scene.getMeshByName('heavyBarrel');
            if (barrel && barrel.material) {
                const barrelMat = barrel.material as StandardMaterial;
                barrelMat.diffuseColor = new Color3(0.2, 0.2 - (this.level - 1) * 0.02, 0.2 - (this.level - 1) * 0.02); // Reduced from 0.05 to 0.02
            }
        }
    }
} 