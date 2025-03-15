import { Vector3, MeshBuilder, StandardMaterial, Color3, Mesh, Space, ParticleSystem, Texture, TrailMesh } from '@babylonjs/core';
import { Game } from '../../Game';
import { Tower } from './Tower';

export class SniperTower extends Tower {
    constructor(game: Game, position: Vector3) {
        // Sniper tower has high range, high damage, low fire rate, and medium cost
        super(game, position, 20, 30, 0.5, 100);
    }

    protected createMesh(): void {
        // Create a root mesh to hold all tower parts
        this.mesh = new Mesh("sniperTowerRoot", this.scene);
        this.mesh.position = this.position.clone();
        
        // Create a cylinder for the tower base
        const base = MeshBuilder.CreateCylinder('sniperBase', {
            height: 1.5,
            diameter: 1.8,
            tessellation: 16
        }, this.scene);
        base.position = new Vector3(0, 0.75, 0); // Position relative to root
        
        // Create a box for the tower body
        const body = MeshBuilder.CreateBox('sniperBody', {
            width: 1,
            height: 1,
            depth: 1
        }, this.scene);
        body.position = new Vector3(0, 2, 0); // Position relative to root
        
        // Create a cylinder for the barrel
        const barrel = MeshBuilder.CreateCylinder('sniperBarrel', {
            height: 3,
            diameter: 0.3,
            tessellation: 12
        }, this.scene);
        barrel.rotation.x = Math.PI / 2; // Rotate to be horizontal
        barrel.position = new Vector3(0, 0, 1.5); // Position relative to body
        
        // Create a scope on top of the body
        const scope = MeshBuilder.CreateCylinder('sniperScope', {
            height: 0.8,
            diameter: 0.4,
            tessellation: 12
        }, this.scene);
        scope.rotation.x = Math.PI / 2; // Rotate to be horizontal
        scope.position = new Vector3(0, 0.5, 0); // Position relative to body
        
        // Create a bipod for the sniper
        const leftLeg = MeshBuilder.CreateCylinder('sniperLeftLeg', {
            height: 1.2,
            diameter: 0.1,
            tessellation: 8
        }, this.scene);
        leftLeg.rotation.z = Math.PI / 4; // Rotate outward
        leftLeg.position = new Vector3(-0.4, -0.4, 1.0); // Position relative to body
        
        const rightLeg = MeshBuilder.CreateCylinder('sniperRightLeg', {
            height: 1.2,
            diameter: 0.1,
            tessellation: 8
        }, this.scene);
        rightLeg.rotation.z = -Math.PI / 4; // Rotate outward
        rightLeg.position = new Vector3(0.4, -0.4, 1.0); // Position relative to body
        
        // Create materials with different shades
        const baseMaterial = new StandardMaterial('sniperBaseMaterial', this.scene);
        baseMaterial.diffuseColor = new Color3(0.3, 0.3, 0.3); // Dark gray
        base.material = baseMaterial;
        
        const bodyMaterial = new StandardMaterial('sniperBodyMaterial', this.scene);
        bodyMaterial.diffuseColor = new Color3(0.6, 0.2, 0.2); // Red
        bodyMaterial.specularColor = new Color3(0.8, 0.4, 0.4);
        bodyMaterial.specularPower = 32;
        body.material = bodyMaterial;
        
        const barrelMaterial = new StandardMaterial('sniperBarrelMaterial', this.scene);
        barrelMaterial.diffuseColor = new Color3(0.1, 0.1, 0.1); // Almost black
        barrel.material = barrelMaterial;
        
        const scopeMaterial = new StandardMaterial('sniperScopeMaterial', this.scene);
        scopeMaterial.diffuseColor = new Color3(0.2, 0.2, 0.2); // Dark gray
        scopeMaterial.specularColor = new Color3(0.5, 0.5, 0.5);
        scopeMaterial.specularPower = 64;
        scope.material = scopeMaterial;
        
        const legMaterial = new StandardMaterial('sniperLegMaterial', this.scene);
        legMaterial.diffuseColor = new Color3(0.2, 0.2, 0.2); // Dark gray
        leftLeg.material = legMaterial;
        rightLeg.material = legMaterial;
        
        // Parent all parts to the root mesh in the correct hierarchy
        base.parent = this.mesh;
        body.parent = this.mesh;
        
        // Parent components to the body for proper rotation
        barrel.parent = body;
        scope.parent = body;
        leftLeg.parent = body;
        rightLeg.parent = body;
        
        // Create bullet template for visual effect (not visible initially)
        const bulletTemplate = MeshBuilder.CreateSphere('sniperBulletTemplate', {
            diameter: 0.3,
            segments: 8
        }, this.scene);
        
        // Create bullet material with red glow to match tower theme
        const bulletMaterial = new StandardMaterial('sniperBulletMaterial', this.scene);
        bulletMaterial.diffuseColor = new Color3(1.0, 0.2, 0.2); // Brighter red
        bulletMaterial.emissiveColor = new Color3(1.0, 0.2, 0.2); // Strong red glow
        bulletMaterial.specularColor = new Color3(1.0, 0.5, 0.5);
        bulletMaterial.specularPower = 32; // More shine
        bulletTemplate.material = bulletMaterial;
        bulletTemplate.isVisible = false; // Hide the template
        
        // Create muzzle flash effect
        const muzzleFlash = MeshBuilder.CreateCylinder('sniperMuzzleFlash', {
            height: 0.2,
            diameterTop: 0.6,
            diameterBottom: 0.3,
            tessellation: 12
        }, this.scene);
        muzzleFlash.rotation.x = Math.PI / 2; // Rotate to be horizontal
        muzzleFlash.position = new Vector3(0, 0, 1.5); // Position at the end of the barrel
        
        // Create muzzle flash material
        const muzzleFlashMaterial = new StandardMaterial('sniperMuzzleFlashMaterial', this.scene);
        muzzleFlashMaterial.diffuseColor = new Color3(1, 0.5, 0.3);
        muzzleFlashMaterial.emissiveColor = new Color3(1, 0.3, 0.2);
        muzzleFlashMaterial.alpha = 0.9;
        muzzleFlash.material = muzzleFlashMaterial;
        muzzleFlash.isVisible = false;
        muzzleFlash.parent = barrel;
        
        // Create a muzzle flash particle system
        const muzzleParticles = new ParticleSystem("muzzleParticles", 50, this.scene);
        muzzleParticles.particleTexture = new Texture("assets/textures/particle.png", this.scene);
        muzzleParticles.emitter = new Vector3(0, 0, 0); // Will be positioned at firing time
        muzzleParticles.minEmitBox = new Vector3(-0.1, -0.1, -0.1);
        muzzleParticles.maxEmitBox = new Vector3(0.1, 0.1, 0.1);
        
        // Set muzzle particle properties
        muzzleParticles.color1 = new Color3(1.0, 0.5, 0.3).toColor4(1.0);
        muzzleParticles.color2 = new Color3(1.0, 0.3, 0.1).toColor4(1.0);
        muzzleParticles.colorDead = new Color3(0.7, 0.0, 0.0).toColor4(0.0);
        
        muzzleParticles.minSize = 0.2;
        muzzleParticles.maxSize = 0.4;
        muzzleParticles.minLifeTime = 0.05;
        muzzleParticles.maxLifeTime = 0.15;
        muzzleParticles.emitRate = 300;
        muzzleParticles.blendMode = ParticleSystem.BLENDMODE_ONEONE;
        muzzleParticles.gravity = new Vector3(0, 0, 0);
        muzzleParticles.direction1 = new Vector3(-0.2, -0.2, 1);
        muzzleParticles.direction2 = new Vector3(0.2, 0.2, 1);
        muzzleParticles.minEmitPower = 2;
        muzzleParticles.maxEmitPower = 4;
        muzzleParticles.updateSpeed = 0.01;
        
        // Don't start the particles yet
        muzzleParticles.stop();
        
        // Track active bullets for animation
        const activeBullets: { 
            mesh: Mesh, 
            distance: number, 
            maxDistance: number, 
            targetEnemy: any, 
            targetPosition: Vector3,
            direction: Vector3,
            trail?: ParticleSystem
        }[] = [];
        
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
                    
                    // Get the world position of the barrel end
                    const barrelWorldMatrix = barrel.getWorldMatrix();
                    const barrelEndPosition = Vector3.TransformCoordinates(new Vector3(0, 0, 1.5), barrelWorldMatrix);
                    
                    // Show muzzle flash and particles
                    this.createMuzzleEffect(muzzleFlash, muzzleParticles, barrelEndPosition);
                    
                    // Create bullet and get target information
                    if (this.targetEnemy) {
                        const targetPosition = this.targetEnemy.getPosition();
                        this.createBullet(bulletTemplate, barrelEndPosition, targetPosition, this.targetEnemy, activeBullets);
                    }
                }
            }
            
            // Update bullet positions
            for (let i = activeBullets.length - 1; i >= 0; i--) {
                const bulletInfo = activeBullets[i];
                
                // Move bullet directly along the stored direction
                const moveDistance = 1.2; // Faster speed for sniper projectile
                bulletInfo.mesh.position.addInPlace(bulletInfo.direction.scale(moveDistance));
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
                    
                    // Stop and dispose the trail
                    if (bulletInfo.trail) {
                        bulletInfo.trail.stop();
                        setTimeout(() => {
                            bulletInfo.trail?.dispose();
                        }, 300);
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
        // Create a simple impact flash
        const flash = MeshBuilder.CreateSphere("sniperImpactFlash", {
            diameter: 0.6,
            segments: 8
        }, this.scene);
        flash.position = position.clone();
        
        const flashMaterial = new StandardMaterial("flashMaterial", this.scene);
        flashMaterial.emissiveColor = new Color3(1.0, 0.2, 0.2);
        flashMaterial.diffuseColor = new Color3(1.0, 0.2, 0.2);
        flashMaterial.alpha = 0.8;
        flash.material = flashMaterial;
        
        // Animate the flash to grow and fade out
        let alpha = 0.8;
        let scale = 1.0;
        const flashAnimation = this.scene.onBeforeRenderObservable.add(() => {
            alpha -= 0.05;
            scale += 0.1;
            if (alpha <= 0) {
                flash.dispose();
                this.scene.onBeforeRenderObservable.remove(flashAnimation);
            } else {
                (flash.material as StandardMaterial).alpha = alpha;
                flash.scaling.setAll(scale);
            }
        });
        
        // Create a simple particle system for the impact
        const particleSystem = new ParticleSystem("sniperImpact", 30, this.scene);
        
        // Set particle texture
        particleSystem.particleTexture = new Texture("assets/textures/particle.png", this.scene);
        
        // Set emission properties
        particleSystem.emitter = position;
        particleSystem.minEmitBox = new Vector3(-0.1, -0.1, -0.1);
        particleSystem.maxEmitBox = new Vector3(0.1, 0.1, 0.1);
        
        // Set particle properties - red for sniper tower
        particleSystem.color1 = new Color3(1.0, 0.3, 0.3).toColor4(1.0);
        particleSystem.color2 = new Color3(1.0, 0.1, 0.1).toColor4(1.0);
        particleSystem.colorDead = new Color3(0.7, 0.0, 0.0).toColor4(0.0);
        
        particleSystem.minSize = 0.05;
        particleSystem.maxSize = 0.15;
        
        particleSystem.minLifeTime = 0.1;
        particleSystem.maxLifeTime = 0.3;
        
        particleSystem.emitRate = 200;
        
        particleSystem.blendMode = ParticleSystem.BLENDMODE_ONEONE;
        
        particleSystem.gravity = new Vector3(0, 0, 0);
        
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
            }, 300);
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
        
        // Find the body
        const body = this.scene.getMeshByName('sniperBody');
        if (body) {
            // Scale up the body based on level
            const scale = 1 + (this.level - 1) * 0.15;
            body.scaling.setAll(scale);
            
            // Update color based on level
            const material = body.material as StandardMaterial;
            if (material) {
                // Make it more intense as it levels up
                const redValue = Math.min(1.0, 0.6 + (this.level - 1) * 0.1);
                material.diffuseColor = new Color3(redValue, 0.2, 0.2);
                material.emissiveColor = new Color3(0.1 * this.level, 0, 0); // Add glow effect at higher levels
            }
            
            // Update barrel length
            const barrel = this.scene.getMeshByName('sniperBarrel');
            if (barrel) {
                barrel.scaling.y = 1 + (this.level - 1) * 0.2; // Make barrel longer with upgrades
            }
        }
    }

    /**
     * Create muzzle flash effect
     */
    private createMuzzleEffect(muzzleFlash: Mesh, muzzleParticles: ParticleSystem, position: Vector3): void {
        // Show muzzle flash
        muzzleFlash.isVisible = true;
        muzzleFlash.scaling.setAll(1.0); // Reset scaling
        
        // Position and start muzzle particles
        muzzleParticles.emitter = position.clone();
        muzzleParticles.start();
        
        // Animate muzzle flash to grow and fade
        let muzzleScale = 1.0;
        const muzzleAnimation = this.scene.onBeforeRenderObservable.add(() => {
            muzzleScale += 0.1;
            muzzleFlash.scaling.setAll(muzzleScale);
        });
        
        // Hide muzzle flash after a short delay
        setTimeout(() => {
            muzzleFlash.isVisible = false;
            this.scene.onBeforeRenderObservable.remove(muzzleAnimation);
            muzzleParticles.stop();
        }, 100);
    }
    
    /**
     * Create a bullet and add it to active bullets
     */
    private createBullet(
        bulletTemplate: Mesh, 
        startPosition: Vector3, 
        targetPosition: Vector3, 
        targetEnemy: any,
        activeBullets: { 
            mesh: Mesh, 
            distance: number, 
            maxDistance: number, 
            targetEnemy: any, 
            targetPosition: Vector3,
            direction: Vector3,
            trail?: ParticleSystem
        }[]
    ): void {
        // Create a new bullet instance
        const currentTime = performance.now();
        const newBullet = bulletTemplate.clone("sniperBullet_" + currentTime);
        newBullet.isVisible = true;
        newBullet.position = startPosition.clone();
        
        // Create a direction vector from barrel to target
        const direction = targetPosition.subtract(startPosition).normalize();
        
        // Create a particle system for the bullet trail
        const bulletTrail = new ParticleSystem("bulletTrail_" + currentTime, 20, this.scene);
        bulletTrail.particleTexture = new Texture("assets/textures/particle.png", this.scene);
        bulletTrail.emitter = newBullet; // The bullet is the emitter
        bulletTrail.minEmitBox = new Vector3(0, 0, 0);
        bulletTrail.maxEmitBox = new Vector3(0, 0, 0);
        
        // Set trail particle properties
        bulletTrail.color1 = new Color3(1.0, 0.3, 0.3).toColor4(1.0);
        bulletTrail.color2 = new Color3(1.0, 0.1, 0.1).toColor4(1.0);
        bulletTrail.colorDead = new Color3(0.7, 0.0, 0.0).toColor4(0.0);
        
        bulletTrail.minSize = 0.1;
        bulletTrail.maxSize = 0.2;
        bulletTrail.minLifeTime = 0.1;
        bulletTrail.maxLifeTime = 0.2;
        bulletTrail.emitRate = 100;
        bulletTrail.blendMode = ParticleSystem.BLENDMODE_ONEONE;
        bulletTrail.gravity = new Vector3(0, 0, 0);
        bulletTrail.direction1 = new Vector3(-0.05, -0.05, -0.05);
        bulletTrail.direction2 = new Vector3(0.05, 0.05, 0.05);
        bulletTrail.minEmitPower = 0.1;
        bulletTrail.maxEmitPower = 0.3;
        bulletTrail.updateSpeed = 0.01;
        
        // Start the particle system
        bulletTrail.start();
        
        // Add to active bullets for animation
        activeBullets.push({
            mesh: newBullet,
            distance: 0,
            maxDistance: 30, // Longer maximum distance for sniper
            targetEnemy: targetEnemy,
            targetPosition: targetPosition.clone(),
            direction: direction,
            trail: bulletTrail
        });
    }
} 