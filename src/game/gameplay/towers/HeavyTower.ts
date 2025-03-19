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
            height: 0.4,
            diameter: 2.0,
            tessellation: 20
        }, this.scene);
        base.position = new Vector3(0, 0.2, 0);
        
        // Add decorative stone ring
        const baseRing = MeshBuilder.CreateTorus('heavyBaseRing', {
            diameter: 1.8,
            thickness: 0.08,
            tessellation: 20
        }, this.scene);
        baseRing.position = new Vector3(0, 0.35, 0);
        baseRing.rotation.x = Math.PI / 2;
        
        // Create a wooden platform for the cannon
        const platform = MeshBuilder.CreateBox("platform", {
            width: 1.4,
            height: 0.2,
            depth: 1.6
        }, this.scene);
        platform.position = new Vector3(0, 0.4, 0);
        
        // Create decorative platform beams
        const createPlatformBeam = (index: number, total: number) => {
            const angle = (index / total) * Math.PI * 2;
            const beam = MeshBuilder.CreateBox(`beam${index}`, {
                width: 0.1,
                height: 0.05,
                depth: 2.0
            }, this.scene);
            beam.rotation.y = angle;
            beam.position = new Vector3(0, 0.32, 0);
            beam.parent = this.mesh;
        };
        
        for (let i = 0; i < 4; i++) {
            createPlatformBeam(i, 4);
        }
        
        // Create cannon barrel - longer and more ornate
        const barrel = MeshBuilder.CreateCylinder("barrel", {
            height: 1.6,
            diameter: 0.35,
            tessellation: 20
        }, this.scene);
        barrel.rotation.x = Math.PI / 2; // Rotate to horizontal position
        barrel.position = new Vector3(0, 0.6, 0.4);
        
        // Create decorative rings on barrel
        const createBarrelRing = (offset: number) => {
            const ring = MeshBuilder.CreateTorus(`barrelRing${offset}`, {
                diameter: 0.35,
                thickness: 0.05,
                tessellation: 16
            }, this.scene);
            ring.rotation.y = Math.PI / 2;
            ring.position = new Vector3(0, 0.6, offset);
            ring.parent = barrel;
        };
        
        createBarrelRing(0.0);
        createBarrelRing(0.5);
        createBarrelRing(-0.6);
        
        // Create muzzle reinforcement
        const muzzle = MeshBuilder.CreateCylinder("muzzle", {
            height: 0.25,
            diameter: 0.45,
            tessellation: 20
        }, this.scene);
        muzzle.rotation.x = Math.PI / 2;
        muzzle.position = new Vector3(0, 0.6, 0.9);
        
        // Create cannon back
        const back = MeshBuilder.CreateCylinder("cannonBack", {
            height: 0.6,
            diameter: 0.55,
            tessellation: 20
        }, this.scene);
        back.rotation.x = Math.PI / 2;
        back.position = new Vector3(0, 0.6, -0.3);
        
        // Create loading port with hinge
        const loadingPort = MeshBuilder.CreateCylinder("loadingPort", {
            height: 0.15,
            diameter: 0.25,
            tessellation: 12
        }, this.scene);
        loadingPort.rotation.z = Math.PI / 2;
        loadingPort.position = new Vector3(0, 0.75, -0.3);
        
        const hinge = MeshBuilder.CreateBox("hinge", {
            width: 0.2,
            height: 0.05,
            depth: 0.05
        }, this.scene);
        hinge.position = new Vector3(0, 0.75, -0.4);
        
        // Create wheels - more detailed wooden wheels
        const wheelOptions = {
            height: 0.2,
            diameter: 0.75,
            tessellation: 20
        };
        
        const leftFrontWheel = MeshBuilder.CreateCylinder("leftFrontWheel", wheelOptions, this.scene);
        leftFrontWheel.rotation.z = Math.PI / 2; // Horizontal
        leftFrontWheel.position = new Vector3(-0.7, 0.37, -0.5);
        
        const rightFrontWheel = MeshBuilder.CreateCylinder("rightFrontWheel", wheelOptions, this.scene);
        rightFrontWheel.rotation.z = Math.PI / 2;
        rightFrontWheel.position = new Vector3(0.7, 0.37, -0.5);
        
        const leftBackWheel = MeshBuilder.CreateCylinder("leftBackWheel", wheelOptions, this.scene);
        leftBackWheel.rotation.z = Math.PI / 2;
        leftBackWheel.position = new Vector3(-0.7, 0.37, 0.5);
        
        const rightBackWheel = MeshBuilder.CreateCylinder("rightBackWheel", wheelOptions, this.scene);
        rightBackWheel.rotation.z = Math.PI / 2;
        rightBackWheel.position = new Vector3(0.7, 0.37, 0.5);
        
        // Create wheel spokes
        const createWheelSpokes = (wheel: Mesh) => {
            for (let i = 0; i < 6; i++) {
                const angle = (i / 6) * Math.PI * 2;
                const spoke = MeshBuilder.CreateBox(`spoke${i}`, {
                    width: 0.06,
                    height: 0.06,
                    depth: 0.6
                }, this.scene);
                spoke.rotation.x = angle;
                spoke.position = new Vector3(0, 0, 0);
                spoke.parent = wheel;
            }
        };
        
        createWheelSpokes(leftFrontWheel);
        createWheelSpokes(rightFrontWheel);
        createWheelSpokes(leftBackWheel);
        createWheelSpokes(rightBackWheel);
        
        // Create axles
        const frontAxle = MeshBuilder.CreateCylinder("frontAxle", {
            height: 1.6,
            diameter: 0.12,
            tessellation: 10
        }, this.scene);
        frontAxle.rotation.z = Math.PI / 2;
        frontAxle.position = new Vector3(0, 0.37, -0.5);
        
        const backAxle = MeshBuilder.CreateCylinder("backAxle", {
            height: 1.6,
            diameter: 0.12,
            tessellation: 10
        }, this.scene);
        backAxle.rotation.z = Math.PI / 2;
        backAxle.position = new Vector3(0, 0.37, 0.5);
        
        // Create supports
        const leftSupport = MeshBuilder.CreateBox("leftSupport", {
            width: 0.15,
            height: 0.25,
            depth: 1.0
        }, this.scene);
        leftSupport.position = new Vector3(-0.5, 0.5, 0);
        
        const rightSupport = MeshBuilder.CreateBox("rightSupport", {
            width: 0.15,
            height: 0.25,
            depth: 1.0
        }, this.scene);
        rightSupport.position = new Vector3(0.5, 0.5, 0);
        
        // Create barrel rim
        const rim = MeshBuilder.CreateTorus("rim", {
            diameter: 0.35,
            thickness: 0.07,
            tessellation: 20
        }, this.scene);
        rim.rotation.x = Math.PI / 2;
        rim.position = new Vector3(0, 0.6, 1.1);
        
        // Create a cannonball ready to fire
        const cannonball = MeshBuilder.CreateSphere("readyCannonball", {
            diameter: 0.25,
            segments: 16
        }, this.scene);
        cannonball.position = new Vector3(0, 0.6, 0.9);
        
        // Create cannonball pile
        const createCannonballPile = () => {
            const positions = [
                new Vector3(-0.4, 0.4, -0.8),
                new Vector3(-0.25, 0.4, -0.6),
                new Vector3(-0.1, 0.4, -0.8),
                new Vector3(0.1, 0.4, -0.7),
                new Vector3(0.3, 0.4, -0.8),
                new Vector3(-0.2, 0.65, -0.7),
                new Vector3(0.0, 0.65, -0.75)
            ];
            
            const cannonballs = [];
            for (let i = 0; i < positions.length; i++) {
                const ball = MeshBuilder.CreateSphere(`pileCannonball${i}`, {
                    diameter: 0.25,
                    segments: 10
                }, this.scene);
                ball.position = positions[i];
                ball.parent = this.mesh;
                cannonballs.push(ball);
            }
            return cannonballs;
        };
        
        const cannonballPile = createCannonballPile();
        
        // Materials
        const stoneMaterial = new StandardMaterial('heavyStoneMaterial', this.scene);
        stoneMaterial.diffuseColor = new Color3(0.7, 0.7, 0.7); // Lighter gray stone
        stoneMaterial.specularColor = new Color3(0.3, 0.3, 0.3);
        base.material = stoneMaterial;
        baseRing.material = stoneMaterial;
        
        const woodMaterial = new StandardMaterial('heavyWoodMaterial', this.scene);
        woodMaterial.diffuseColor = new Color3(0.5, 0.35, 0.2);
        platform.material = woodMaterial;
        leftSupport.material = woodMaterial;
        rightSupport.material = woodMaterial;
        
        const darkWoodMaterial = new StandardMaterial('heavyDarkWoodMaterial', this.scene);
        darkWoodMaterial.diffuseColor = new Color3(0.35, 0.25, 0.15);
        
        // Apply wood material to wheels and spokes
        const wheelMaterial = new StandardMaterial("wheelMaterial", this.scene);
        wheelMaterial.diffuseColor = new Color3(0.4, 0.3, 0.15);
        
        leftFrontWheel.material = wheelMaterial;
        rightFrontWheel.material = wheelMaterial;
        leftBackWheel.material = wheelMaterial;
        rightBackWheel.material = wheelMaterial;
        
        leftFrontWheel.getChildMeshes().forEach(mesh => mesh.material = wheelMaterial);
        rightFrontWheel.getChildMeshes().forEach(mesh => mesh.material = wheelMaterial);
        leftBackWheel.getChildMeshes().forEach(mesh => mesh.material = wheelMaterial);
        rightBackWheel.getChildMeshes().forEach(mesh => mesh.material = wheelMaterial);
        
        const metalMaterial = new StandardMaterial("metalMaterial", this.scene);
        metalMaterial.diffuseColor = new Color3(0.2, 0.2, 0.23);
        metalMaterial.specularColor = new Color3(0.5, 0.5, 0.5);
        metalMaterial.specularPower = 32;
        barrel.material = metalMaterial;
        back.material = metalMaterial;
        rim.material = metalMaterial;
        muzzle.material = metalMaterial;
        loadingPort.material = metalMaterial;
        hinge.material = metalMaterial;
        
        // Apply material to barrel rings
        barrel.getChildMeshes().forEach(mesh => mesh.material = metalMaterial);
        
        const axleMaterial = new StandardMaterial("axleMaterial", this.scene);
        axleMaterial.diffuseColor = new Color3(0.3, 0.3, 0.3);
        frontAxle.material = axleMaterial;
        backAxle.material = axleMaterial;
        
        const cannonballMaterial = new StandardMaterial("cannonballMaterial", this.scene);
        cannonballMaterial.diffuseColor = new Color3(0.1, 0.1, 0.1);
        cannonballMaterial.specularColor = new Color3(0.3, 0.3, 0.3);
        cannonballMaterial.specularPower = 64;
        cannonball.material = cannonballMaterial;
        
        cannonballPile.forEach(ball => ball.material = cannonballMaterial);
        
        // Parent all to root
        base.parent = this.mesh;
        baseRing.parent = this.mesh;
        platform.parent = this.mesh;
        
        // Create a turret for the rotating parts
        const turret = new Mesh("heavyTurret", this.scene);
        turret.position = new Vector3(0, 0, 0);
        turret.parent = this.mesh;
        
        // Parent cannon to turret for rotation
        barrel.parent = turret;
        back.parent = turret;
        muzzle.parent = turret;
        loadingPort.parent = turret;
        hinge.parent = turret;
        rim.parent = turret;
        cannonball.parent = turret;
        leftSupport.parent = turret;
        rightSupport.parent = turret;
        
        // Parent fixed parts to mesh
        leftFrontWheel.parent = this.mesh;
        rightFrontWheel.parent = this.mesh;
        leftBackWheel.parent = this.mesh;
        rightBackWheel.parent = this.mesh;
        frontAxle.parent = this.mesh;
        backAxle.parent = this.mesh;
        
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