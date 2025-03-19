import { Vector3, MeshBuilder, StandardMaterial, Color3, Mesh, ParticleSystem, Texture } from '@babylonjs/core';
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
        
        // Create a stone base
        const base = MeshBuilder.CreateCylinder("heavyBase", {
            height: 0.2,
            diameter: 1.8,
            tessellation: 16
        }, this.scene);
        base.position = new Vector3(0, 0.1, 0);
        
        // Create a wooden platform for the cannon
        const platform = MeshBuilder.CreateBox("platform", {
            width: 1.2,
            height: 0.15,
            depth: 1.4
        }, this.scene);
        platform.position = new Vector3(0, 0.22, 0);
        
        // Create cannon barrel
        const barrel = MeshBuilder.CreateCylinder("barrel", {
            height: 1.4,
            diameter: 0.3,
            tessellation: 16
        }, this.scene);
        barrel.rotation.x = Math.PI / 2; // Rotate to horizontal position
        barrel.position = new Vector3(0, 0.35, 0.4);
        
        // Create cannon back
        const back = MeshBuilder.CreateCylinder("cannonBack", {
            height: 0.5,
            diameter: 0.5,
            tessellation: 16
        }, this.scene);
        back.rotation.x = Math.PI / 2;
        back.position = new Vector3(0, 0.35, -0.3);
        
        // Create wheels
        const wheelOptions = {
            height: 0.15,
            diameter: 0.7,
            tessellation: 16
        };
        
        const leftFrontWheel = MeshBuilder.CreateCylinder("leftFrontWheel", wheelOptions, this.scene);
        leftFrontWheel.rotation.z = Math.PI / 2; // Horizontal
        leftFrontWheel.position = new Vector3(-0.6, 0.35, -0.5);
        
        const rightFrontWheel = MeshBuilder.CreateCylinder("rightFrontWheel", wheelOptions, this.scene);
        rightFrontWheel.rotation.z = Math.PI / 2;
        rightFrontWheel.position = new Vector3(0.6, 0.35, -0.5);
        
        const leftBackWheel = MeshBuilder.CreateCylinder("leftBackWheel", wheelOptions, this.scene);
        leftBackWheel.rotation.z = Math.PI / 2;
        leftBackWheel.position = new Vector3(-0.6, 0.35, 0.5);
        
        const rightBackWheel = MeshBuilder.CreateCylinder("rightBackWheel", wheelOptions, this.scene);
        rightBackWheel.rotation.z = Math.PI / 2;
        rightBackWheel.position = new Vector3(0.6, 0.35, 0.5);
        
        // Create axles
        const frontAxle = MeshBuilder.CreateCylinder("frontAxle", {
            height: 1.4,
            diameter: 0.1,
            tessellation: 8
        }, this.scene);
        frontAxle.rotation.z = Math.PI / 2;
        frontAxle.position = new Vector3(0, 0.35, -0.5);
        
        const backAxle = MeshBuilder.CreateCylinder("backAxle", {
            height: 1.4,
            diameter: 0.1,
            tessellation: 8
        }, this.scene);
        backAxle.rotation.z = Math.PI / 2;
        backAxle.position = new Vector3(0, 0.35, 0.5);
        
        // Create supports
        const leftSupport = MeshBuilder.CreateBox("leftSupport", {
            width: 0.1,
            height: 0.2,
            depth: 0.8
        }, this.scene);
        leftSupport.position = new Vector3(-0.4, 0.45, 0);
        
        const rightSupport = MeshBuilder.CreateBox("rightSupport", {
            width: 0.1,
            height: 0.2,
            depth: 0.8
        }, this.scene);
        rightSupport.position = new Vector3(0.4, 0.45, 0);
        
        // Create barrel rim
        const rim = MeshBuilder.CreateTorus("rim", {
            diameter: 0.3,
            thickness: 0.07,
            tessellation: 16
        }, this.scene);
        rim.rotation.x = Math.PI / 2;
        rim.position = new Vector3(0, 0, 0.7);
        
        // Materials
        const stoneMaterial = new StandardMaterial("stoneMaterial", this.scene);
        stoneMaterial.diffuseColor = new Color3(0.5, 0.5, 0.5);
        base.material = stoneMaterial;
        
        const woodMaterial = new StandardMaterial("woodMaterial", this.scene);
        woodMaterial.diffuseColor = new Color3(0.35, 0.2, 0.1);
        platform.material = woodMaterial;
        leftSupport.material = woodMaterial;
        rightSupport.material = woodMaterial;
        leftFrontWheel.material = woodMaterial;
        rightFrontWheel.material = woodMaterial;
        leftBackWheel.material = woodMaterial;
        rightBackWheel.material = woodMaterial;
        
        const metalMaterial = new StandardMaterial("metalMaterial", this.scene);
        metalMaterial.diffuseColor = new Color3(0.2, 0.2, 0.23);
        metalMaterial.specularColor = new Color3(0.5, 0.5, 0.5);
        metalMaterial.specularPower = 32;
        barrel.material = metalMaterial;
        back.material = metalMaterial;
        rim.material = metalMaterial;
        
        const axleMaterial = new StandardMaterial("axleMaterial", this.scene);
        axleMaterial.diffuseColor = new Color3(0.3, 0.3, 0.3);
        frontAxle.material = axleMaterial;
        backAxle.material = axleMaterial;
        
        // Parent all to root
        base.parent = this.mesh;
        platform.parent = this.mesh;
        barrel.parent = this.mesh;
        back.parent = this.mesh;
        leftFrontWheel.parent = this.mesh;
        rightFrontWheel.parent = this.mesh;
        leftBackWheel.parent = this.mesh;
        rightBackWheel.parent = this.mesh;
        frontAxle.parent = this.mesh;
        backAxle.parent = this.mesh;
        leftSupport.parent = this.mesh;
        rightSupport.parent = this.mesh;
        rim.parent = barrel;
        
        // Create template for cannonballs
        const projectileTemplate = MeshBuilder.CreateSphere("cannonballTemplate", {
            diameter: 0.25,
            segments: 12
        }, this.scene);
        
        const projectileMaterial = new StandardMaterial("cannonballMaterial", this.scene);
        projectileMaterial.diffuseColor = new Color3(0.1, 0.1, 0.1);
        projectileMaterial.specularColor = new Color3(0.3, 0.3, 0.3);
        projectileTemplate.material = projectileMaterial;
        projectileTemplate.isVisible = false;
        
        // Track active projectiles
        const activeProjectiles: { mesh: Mesh, distance: number, maxDistance: number, targetEnemy: any, targetPosition: Vector3, shouldContinue: boolean }[] = [];
        
        // Store reference to active projectiles in the mesh's metadata for cleanup
        this.mesh.metadata = { activeProjectiles };
    }
    
    /**
     * Create the projectile effect
     */
    protected createProjectileEffect(targetPosition: Vector3): void {
        if (!this.mesh || !this.targetEnemy) return;
        
        // Create projectile
        this.createProjectile(targetPosition);
    }
    
    /**
     * Create the actual projectile
     */
    private createProjectile(targetPosition: Vector3): void {
        if (!this.mesh) return;
        
        // Get barrel for positioning
        const barrel = this.scene.getMeshByName("barrel");
        
        // Create cannonball
        const cannonball = MeshBuilder.CreateSphere("cannonball", {
            diameter: 0.25,
            segments: 8
        }, this.scene);
        
        // Apply material
        const cannonballMaterial = new StandardMaterial("cannonballMaterial", this.scene);
        cannonballMaterial.diffuseColor = new Color3(0.1, 0.1, 0.1);
        cannonballMaterial.specularColor = new Color3(0.3, 0.3, 0.3);
        cannonball.material = cannonballMaterial;
        
        // Default position if barrel not found
        let startPosition = new Vector3(
            this.mesh.position.x,
            this.mesh.position.y + 0.35,
            this.mesh.position.z + 0.5
        );
        
        // If barrel found, get accurate position
        if (barrel) {
            const barrelMatrix = barrel.getWorldMatrix();
            const endPoint = new Vector3(0, 0, 0.7);
            startPosition = Vector3.TransformCoordinates(endPoint, barrelMatrix);
        }
        
        cannonball.position = startPosition;
        
        // Animation parameters
        const direction = targetPosition.subtract(startPosition).normalize();
        const speed = 25;
        const maxDistance = Vector3.Distance(startPosition, targetPosition);
        
        // Create projectile object
        const projectile = {
            mesh: cannonball,
            distance: 0,
            maxDistance: maxDistance,
            targetEnemy: this.targetEnemy,
            targetPosition: targetPosition,
            shouldContinue: true
        };
        
        // Store in active projectiles
        const metadata = this.mesh.metadata;
        const activeProjectiles = metadata?.activeProjectiles || [];
        activeProjectiles.push(projectile);
        
        // Create firing effect
        this.createCannonFireEffect(startPosition, direction);
        
        // Play sound
        this.game.getAssetManager().playSound('towerShoot');
        
        // Animate projectile
        const animateProjectile = () => {
            if (!this.mesh || cannonball.isDisposed() || !projectile.shouldContinue) {
                return;
            }
            
            const deltaDistance = (speed * this.scene.getEngine().getDeltaTime()) / 1000;
            projectile.distance += deltaDistance;
            
            // Calculate arc
            const t = projectile.distance / maxDistance;
            const height = 0.5 * Math.sin(Math.PI * t);
            
            // Move projectile
            const newPos = new Vector3(
                startPosition.x + direction.x * projectile.distance,
                startPosition.y + height + direction.y * projectile.distance,
                startPosition.z + direction.z * projectile.distance
            );
            
            cannonball.position = newPos;
            
            // Add spinning
            cannonball.rotation.x += 0.05;
            cannonball.rotation.z += 0.07;
            
            // If reached target
            if (projectile.distance >= maxDistance) {
                // Create impact
                this.createImpactEffect(cannonball.position);
                
                // Remove from active
                const index = activeProjectiles.indexOf(projectile);
                if (index > -1) {
                    activeProjectiles.splice(index, 1);
                }
                
                // Apply damage
                if (projectile.targetEnemy && projectile.targetEnemy.isAlive()) {
                    const damage = this.calculateDamage(projectile.targetEnemy);
                    projectile.targetEnemy.takeDamage(damage);
                    
                    this.applyPrimaryEffect(projectile.targetEnemy);
                    this.applySecondaryEffect(projectile.targetEnemy);
                }
                
                // Dispose
                cannonball.dispose();
                return;
            }
            
            // Continue animation
            requestAnimationFrame(animateProjectile);
        };
        
        // Start animation
        animateProjectile();
    }
    
    /**
     * Create cannon fire effect
     */
    private createCannonFireEffect(position: Vector3, direction: Vector3): void {
        // Create flash
        const flash = MeshBuilder.CreateSphere("flash", {
            diameter: 0.5,
            segments: 8
        }, this.scene);
        flash.position = position.clone();
        
        // Flash material
        const flashMaterial = new StandardMaterial("flashMaterial", this.scene);
        flashMaterial.diffuseColor = new Color3(1.0, 0.7, 0.3);
        flashMaterial.emissiveColor = new Color3(1.0, 0.7, 0.3);
        flashMaterial.alpha = 0.8;
        flash.material = flashMaterial;
        
        // Animate flash
        let flashTime = 0;
        const animateFlash = () => {
            flashTime += this.scene.getEngine().getDeltaTime() / 1000;
            if (flashTime < 0.12) {
                const scale = 1.0 - (flashTime / 0.12);
                flash.scaling.setAll(scale);
                requestAnimationFrame(animateFlash);
            } else {
                flash.dispose();
            }
        };
        animateFlash();
        
        // Create cannon recoil
        const barrel = this.scene.getMeshByName("barrel");
        if (barrel) {
            const originalPos = barrel.position.clone();
            const recoilPos = originalPos.clone();
            recoilPos.z -= 0.1;
            
            barrel.position = recoilPos;
            
            // Return to original position
            setTimeout(() => {
                if (barrel) {
                    let returnTime = 0;
                    const returnDuration = 0.15;
                    
                    const animateReturn = () => {
                        if (!barrel) return;
                        
                        returnTime += this.scene.getEngine().getDeltaTime() / 1000;
                        const t = Math.min(returnTime / returnDuration, 1);
                        
                        barrel.position = Vector3.Lerp(recoilPos, originalPos, t);
                        
                        if (t < 1) {
                            requestAnimationFrame(animateReturn);
                        }
                    };
                    
                    requestAnimationFrame(animateReturn);
                }
            }, 40);
        }
        
        // Create smoke
        const smoke = new ParticleSystem("smoke", 40, this.scene);
        smoke.particleTexture = new Texture("assets/textures/particle.png", this.scene);
        smoke.emitter = position;
        
        // Smoke appearance
        smoke.color1 = new Color3(0.8, 0.8, 0.8).toColor4(0.9);
        smoke.color2 = new Color3(0.6, 0.6, 0.6).toColor4(0.8);
        smoke.colorDead = new Color3(0.5, 0.5, 0.5).toColor4(0);
        
        smoke.minSize = 0.15;
        smoke.maxSize = 0.4;
        
        smoke.minLifeTime = 0.7;
        smoke.maxLifeTime = 1.2;
        
        smoke.emitRate = 120;
        smoke.blendMode = ParticleSystem.BLENDMODE_STANDARD;
        smoke.gravity = new Vector3(0, 0.5, 0);
        
        smoke.minEmitPower = 0.4;
        smoke.maxEmitPower = 1.5;
        smoke.direction1 = direction.scale(-0.2).add(new Vector3(-0.4, 0.2, -0.4));
        smoke.direction2 = direction.scale(0.1).add(new Vector3(0.4, 0.8, 0.4));
        
        smoke.start();
        setTimeout(() => {
            smoke.stop();
            setTimeout(() => {
                smoke.dispose();
            }, 1200);
        }, 150);
    }
    
    /**
     * Create impact effect
     */
    protected createImpactEffect(position: Vector3): void {
        // Create explosion
        const explosion = new ParticleSystem("explosion", 200, this.scene);
        explosion.particleTexture = new Texture("assets/textures/particle.png", this.scene);
        explosion.emitter = position;
        
        // Explosion appearance
        explosion.color1 = new Color3(1.0, 0.7, 0.3).toColor4(1.0);
        explosion.color2 = new Color3(0.8, 0.3, 0.1).toColor4(1.0);
        explosion.colorDead = new Color3(0.4, 0.4, 0.4).toColor4(0.0);
        
        explosion.minSize = 0.2;
        explosion.maxSize = 0.8;
        
        explosion.minLifeTime = 0.1;
        explosion.maxLifeTime = 0.3;
        
        explosion.emitRate = 600;
        explosion.manualEmitCount = 200;
        
        explosion.blendMode = ParticleSystem.BLENDMODE_ONEONE;
        explosion.gravity = new Vector3(0, -1, 0);
        
        explosion.direction1 = new Vector3(-1, -1, -1);
        explosion.direction2 = new Vector3(1, 1, 1);
        
        explosion.minEmitPower = 2;
        explosion.maxEmitPower = 6;
        
        explosion.start();
        
        // Create debris
        const debris = new ParticleSystem("debris", 100, this.scene);
        debris.particleTexture = new Texture("assets/textures/particle.png", this.scene);
        debris.emitter = position;
        
        // Debris appearance
        debris.color1 = new Color3(0.5, 0.5, 0.5).toColor4(1.0);
        debris.color2 = new Color3(0.3, 0.3, 0.3).toColor4(1.0);
        debris.colorDead = new Color3(0.2, 0.2, 0.2).toColor4(0.0);
        
        debris.minSize = 0.1;
        debris.maxSize = 0.3;
        
        debris.minLifeTime = 0.5;
        debris.maxLifeTime = 1.5;
        
        debris.emitRate = 300;
        debris.manualEmitCount = 100;
        
        debris.blendMode = ParticleSystem.BLENDMODE_STANDARD;
        debris.gravity = new Vector3(0, -9.8, 0);
        
        debris.direction1 = new Vector3(-3, 1, -3);
        debris.direction2 = new Vector3(3, 5, 3);
        
        debris.minEmitPower = 3;
        debris.maxEmitPower = 10;
        
        debris.start();
        
        // Create flash
        const flash = MeshBuilder.CreateSphere("impactFlash", {
            diameter: 1.5,
            segments: 8
        }, this.scene);
        flash.position = position.clone();
        
        const flashMaterial = new StandardMaterial("flashMaterial", this.scene);
        flashMaterial.diffuseColor = new Color3(1.0, 0.8, 0.4);
        flashMaterial.emissiveColor = new Color3(1.0, 0.8, 0.4);
        flashMaterial.alpha = 0.8;
        flash.material = flashMaterial;
        
        let flashTime = 0;
        const animateFlash = () => {
            flashTime += this.scene.getEngine().getDeltaTime() / 1000;
            if (flashTime < 0.2) {
                const scale = 1.0 - (flashTime / 0.2);
                flash.scaling.setAll(scale);
                requestAnimationFrame(animateFlash);
            } else {
                flash.dispose();
            }
        };
        animateFlash();
        
        // Play sound
        this.game.getAssetManager().playSound('explosion');
        
        // Cleanup
        setTimeout(() => {
            explosion.stop();
            debris.stop();
            
            setTimeout(() => {
                explosion.dispose();
                debris.dispose();
            }, 1500);
        }, 300);
    }
    
    /**
     * Update visuals after upgrade
     */
    protected updateVisuals(): void {
        if (!this.mesh) return;
        
        // Find barrel
        const barrel = this.scene.getMeshByName("barrel");
        if (barrel) {
            // Make slightly larger
            const barrelScale = 1 + (this.level - 1) * 0.05;
            barrel.scaling.setAll(barrelScale);
            
            // Update material
            const material = barrel.material as StandardMaterial;
            if (material) {
                material.specularColor = new Color3(
                    0.5 + (this.level - 1) * 0.1,
                    0.5 + (this.level - 1) * 0.1,
                    0.5 + (this.level - 1) * 0.1
                );
                material.specularPower = 32 + (this.level - 1) * 8;
            }
        }
    }
    
    /**
     * Dispose tower and cleanup
     */
    public dispose(): void {
        // Clean up projectiles
        if (this.mesh && this.mesh.metadata && this.mesh.metadata.activeProjectiles) {
            const activeProjectiles = this.mesh.metadata.activeProjectiles as Array<{ 
                mesh: Mesh,
                shouldContinue: boolean
            }>;
            
            // Stop animations
            for (const projectile of activeProjectiles) {
                projectile.shouldContinue = false;
            }
            
            // Dispose meshes
            for (const projectile of activeProjectiles) {
                if (projectile.mesh) {
                    projectile.mesh.dispose();
                }
            }
            
            // Clear array
            activeProjectiles.length = 0;
        }
        
        // Call parent dispose
        super.dispose();
    }
} 