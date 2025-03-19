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
        
        // Create a stone base - lighter gray stone
        const base = MeshBuilder.CreateCylinder('towerBase', {
            height: 0.4,
            diameter: 2.0,
            tessellation: 20
        }, this.scene);
        base.position = new Vector3(0, 0.2, 0);
        
        // Create stone detail rings on the base
        const baseRing = MeshBuilder.CreateTorus('baseRing', {
            diameter: 1.8,
            thickness: 0.08,
            tessellation: 20
        }, this.scene);
        baseRing.position = new Vector3(0, 0.35, 0);
        baseRing.rotation.x = Math.PI / 2;
        
        // Create a wooden platform
        const platform = MeshBuilder.CreateCylinder('towerPlatform', {
            height: 0.25,
            diameter: 1.6,
            tessellation: 20
        }, this.scene);
        platform.position = new Vector3(0, 0.45, 0);
        
        // Create support structure
        const supportBase = MeshBuilder.CreateBox('supportBase', {
            width: 1.3,
            height: 0.18,
            depth: 1.3
        }, this.scene);
        supportBase.position = new Vector3(0, 0.6, 0);
        
        // Create the ballista base
        const ballistaBase = MeshBuilder.CreateBox('ballistaBase', {
            width: 1.0,
            height: 0.22,
            depth: 1.0
        }, this.scene);
        ballistaBase.position = new Vector3(0, 0.7, 0);
        
        // Create wooden support pillars
        const pillars = [];
        for (let i = 0; i < 4; i++) {
            const angle = (i / 4) * Math.PI * 2;
            const pillar = MeshBuilder.CreateCylinder(`pillar${i}`, {
                height: 0.45,
                diameter: 0.15,
                tessellation: 8
            }, this.scene);
            
            const x = Math.cos(angle) * 0.7;
            const z = Math.sin(angle) * 0.7;
            
            pillar.position = new Vector3(x, 0.6, z);
            pillars.push(pillar);
        }
        
        // Create horizontal crossbeams
        const crossbeamFront = MeshBuilder.CreateBox('crossbeamFront', {
            width: 1.2,
            height: 0.15,
            depth: 0.15
        }, this.scene);
        crossbeamFront.position = new Vector3(0, 0.7, 0.5);
        
        const crossbeamBack = MeshBuilder.CreateBox('crossbeamBack', {
            width: 1.2,
            height: 0.15,
            depth: 0.15
        }, this.scene);
        crossbeamBack.position = new Vector3(0, 0.7, -0.5);
        
        // Create the ballista arms (larger)
        const leftArm = MeshBuilder.CreateBox('leftArm', {
            width: 0.15,
            height: 0.15,
            depth: 1.0
        }, this.scene);
        leftArm.position = new Vector3(-0.5, 0.8, 0);
        leftArm.rotation.y = Math.PI / 4;
        
        const rightArm = MeshBuilder.CreateBox('rightArm', {
            width: 0.15,
            height: 0.15,
            depth: 1.0
        }, this.scene);
        rightArm.position = new Vector3(0.5, 0.8, 0);
        rightArm.rotation.y = -Math.PI / 4;
        
        // Create decorative reinforcements on arms
        const createArmReinforcements = (arm: Mesh, side: number) => {
            for (let i = 0; i < 3; i++) {
                const offset = 0.2 + i * 0.3;
                const reinforcement = MeshBuilder.CreateBox(`reinforcement_${side}_${i}`, {
                    width: 0.05,
                    height: 0.18,
                    depth: 0.18
                }, this.scene);
                
                reinforcement.position = new Vector3(0, 0, offset);
                reinforcement.parent = arm;
            }
        };
        
        createArmReinforcements(leftArm, -1);
        createArmReinforcements(rightArm, 1);
        
        // Create strings (thicker)
        const leftString = MeshBuilder.CreateCylinder('leftString', {
            height: 0.6,
            diameter: 0.04,
            tessellation: 6
        }, this.scene);
        leftString.position = new Vector3(-0.45, 0.8, 0.4);
        leftString.rotation.z = Math.PI / 2;
        leftString.rotation.y = -Math.PI / 5;
        
        const rightString = MeshBuilder.CreateCylinder('rightString', {
            height: 0.6,
            diameter: 0.04,
            tessellation: 6
        }, this.scene);
        rightString.position = new Vector3(0.45, 0.8, 0.4);
        rightString.rotation.z = Math.PI / 2;
        rightString.rotation.y = Math.PI / 5;
        
        // Create arrow guide (larger)
        const arrowGuide = MeshBuilder.CreateBox('arrowGuide', {
            width: 0.1,
            height: 0.06,
            depth: 1.2
        }, this.scene);
        arrowGuide.position = new Vector3(0, 0.85, 0);
        
        // Create metal fittings at arm joints (larger)
        const leftFitting = MeshBuilder.CreateSphere('leftFitting', {
            diameter: 0.16,
            segments: 12
        }, this.scene);
        leftFitting.position = new Vector3(-0.5, 0.8, 0);
        
        const rightFitting = MeshBuilder.CreateSphere('rightFitting', {
            diameter: 0.16,
            segments: 12
        }, this.scene);
        rightFitting.position = new Vector3(0.5, 0.8, 0);
        
        // Create ratchet and cranking mechanism
        const crankWheel = MeshBuilder.CreateCylinder('crankWheel', {
            height: 0.08,
            diameter: 0.25,
            tessellation: 16
        }, this.scene);
        crankWheel.rotation.x = Math.PI / 2;
        crankWheel.position = new Vector3(0, 0.8, -0.6);
        
        // Add ratchet teeth to wheel
        for (let i = 0; i < 8; i++) {
            const angle = (i / 8) * Math.PI * 2;
            const tooth = MeshBuilder.CreateBox(`ratchetTooth${i}`, {
                width: 0.04,
                height: 0.06,
                depth: 0.04
            }, this.scene);
            
            const radius = 0.125;
            const x = Math.sin(angle) * radius;
            const y = Math.cos(angle) * radius;
            
            tooth.position = new Vector3(x, y + 0.8, -0.6);
            tooth.parent = crankWheel;
        }
        
        const crankArm = MeshBuilder.CreateCylinder('crankArm', {
            height: 0.22,
            diameter: 0.04,
            tessellation: 8
        }, this.scene);
        crankArm.position = new Vector3(0.13, 0.8, -0.6);
        crankArm.rotation.z = Math.PI / 2;
        
        const crankHandle = MeshBuilder.CreateSphere('crankHandle', {
            diameter: 0.08,
            segments: 10
        }, this.scene);
        crankHandle.position = new Vector3(0.25, 0.8, -0.6);
        
        // Create loaded bolt/arrow for visual effect
        const boltShaft = MeshBuilder.CreateCylinder('boltShaft', {
            height: 1.3,
            diameter: 0.05,
            tessellation: 8
        }, this.scene);
        boltShaft.rotation.x = Math.PI / 2;
        boltShaft.position = new Vector3(0, 0.85, 0.1);
        
        const boltHead = MeshBuilder.CreateCylinder('boltHead', {
            height: 0.2,
            diameterTop: 0,
            diameterBottom: 0.12,
            tessellation: 8
        }, this.scene);
        boltHead.rotation.x = Math.PI / 2;
        boltHead.position = new Vector3(0, 0.85, 0.8);
        
        const boltFletching = MeshBuilder.CreateCylinder('boltFletching', {
            height: 0.15,
            diameterTop: 0.03,
            diameterBottom: 0.15,
            tessellation: 8
        }, this.scene);
        boltFletching.rotation.x = Math.PI / 2;
        boltFletching.position = new Vector3(0, 0.85, -0.5);
        
        // Materials
        const stoneMaterial = new StandardMaterial('basicStoneMaterial', this.scene);
        stoneMaterial.diffuseColor = new Color3(0.7, 0.7, 0.7); // Lighter stone color
        stoneMaterial.specularColor = new Color3(0.3, 0.3, 0.3);
        base.material = stoneMaterial;
        baseRing.material = stoneMaterial;
        
        const woodMaterial = new StandardMaterial('basicWoodMaterial', this.scene);
        woodMaterial.diffuseColor = new Color3(0.5, 0.35, 0.2);
        platform.material = woodMaterial;
        supportBase.material = woodMaterial;
        ballistaBase.material = woodMaterial;
        arrowGuide.material = woodMaterial;
        
        const darkWoodMaterial = new StandardMaterial('darkWoodMaterial', this.scene);
        darkWoodMaterial.diffuseColor = new Color3(0.35, 0.25, 0.15);
        leftArm.material = darkWoodMaterial;
        rightArm.material = darkWoodMaterial;
        crossbeamFront.material = darkWoodMaterial;
        crossbeamBack.material = darkWoodMaterial;
        
        for (const pillar of pillars) {
            pillar.material = darkWoodMaterial;
        }
        
        // Apply materials to arm reinforcements
        leftArm.getChildMeshes().forEach(mesh => {
            mesh.material = darkWoodMaterial;
        });
        
        rightArm.getChildMeshes().forEach(mesh => {
            mesh.material = darkWoodMaterial;
        });
        
        const stringMaterial = new StandardMaterial('stringMaterial', this.scene);
        stringMaterial.diffuseColor = new Color3(0.85, 0.8, 0.7);
        leftString.material = stringMaterial;
        rightString.material = stringMaterial;
        
        const metalMaterial = new StandardMaterial('metalMaterial', this.scene);
        metalMaterial.diffuseColor = new Color3(0.6, 0.6, 0.6);
        metalMaterial.specularColor = new Color3(0.8, 0.8, 0.8);
        metalMaterial.specularPower = 32;
        leftFitting.material = metalMaterial;
        rightFitting.material = metalMaterial;
        crankWheel.material = metalMaterial;
        crankArm.material = metalMaterial;
        crankHandle.material = metalMaterial;
        
        // Materials for bolt
        const boltShaftMaterial = new StandardMaterial('boltShaftMaterial', this.scene);
        boltShaftMaterial.diffuseColor = new Color3(0.6, 0.5, 0.3);
        boltShaft.material = boltShaftMaterial;
        
        const boltHeadMaterial = new StandardMaterial('boltHeadMaterial', this.scene);
        boltHeadMaterial.diffuseColor = new Color3(0.5, 0.5, 0.5);
        boltHeadMaterial.specularColor = new Color3(0.8, 0.8, 0.8);
        boltHeadMaterial.specularPower = 64;
        boltHead.material = boltHeadMaterial;
        
        const boltFletchingMaterial = new StandardMaterial('boltFletchingMaterial', this.scene);
        boltFletchingMaterial.diffuseColor = new Color3(0.3, 0.0, 0.0); // Dark red fletching
        boltFletching.material = boltFletchingMaterial;
        
        // Parent all parts to the mesh
        base.parent = this.mesh;
        baseRing.parent = this.mesh;
        platform.parent = this.mesh;
        
        // Create a turret group for rotation
        const turret = new Mesh("ballistaTurret", this.scene);
        turret.position = new Vector3(0, 0, 0);
        turret.parent = this.mesh;
        
        // Parent all rotating parts to the turret
        supportBase.parent = turret;
        ballistaBase.parent = turret;
        leftArm.parent = turret;
        rightArm.parent = turret;
        leftString.parent = turret;
        rightString.parent = turret;
        arrowGuide.parent = turret;
        leftFitting.parent = turret;
        rightFitting.parent = turret;
        crankWheel.parent = turret;
        crankArm.parent = turret;
        crankHandle.parent = turret;
        crossbeamFront.parent = turret;
        crossbeamBack.parent = turret;
        boltShaft.parent = turret;
        boltHead.parent = turret;
        boltFletching.parent = turret;
        
        for (const pillar of pillars) {
            pillar.parent = turret;
        }
        
        // Create arrow template for visual effect (not visible initially)
        const arrowTemplate = MeshBuilder.CreateCylinder('basicArrowTemplate', {
            height: 1.0,
            diameter: 0.05,
            tessellation: 8
        }, this.scene);
        
        // Create arrow head using cylinder with zero top diameter
        const arrowHead = MeshBuilder.CreateCylinder('arrowHead', {
            height: 0.2,
            diameterTop: 0,
            diameterBottom: 0.1,
            tessellation: 8
        }, this.scene);
        arrowHead.parent = arrowTemplate;
        arrowHead.position.z = 0.6;
        
        // Create arrow fletching
        const arrowFletching = MeshBuilder.CreateCylinder('arrowFletching', {
            height: 0.15,
            diameterTop: 0.03,
            diameterBottom: 0.15,
            tessellation: 8
        }, this.scene);
        arrowFletching.parent = arrowTemplate;
        arrowFletching.position.z = -0.5;
        
        // Create arrow materials
        const arrowShaftMaterial = new StandardMaterial('arrowShaftMaterial', this.scene);
        arrowShaftMaterial.diffuseColor = new Color3(0.6, 0.5, 0.3);
        arrowTemplate.material = arrowShaftMaterial;
        
        const arrowHeadMaterial = new StandardMaterial('arrowHeadMaterial', this.scene);
        arrowHeadMaterial.diffuseColor = new Color3(0.5, 0.5, 0.5);
        arrowHeadMaterial.specularColor = new Color3(0.8, 0.8, 0.8);
        arrowHeadMaterial.specularPower = 64;
        arrowHead.material = arrowHeadMaterial;
        
        const arrowFletchingMaterial = new StandardMaterial('arrowFletchingMaterial', this.scene);
        arrowFletchingMaterial.diffuseColor = new Color3(0.4, 0.1, 0.1);
        arrowFletching.material = arrowFletchingMaterial;
        
        arrowTemplate.rotation.x = Math.PI / 2;
        arrowTemplate.isVisible = false;
        
        // Track active bullets for animation
        const activeBullets: { mesh: Mesh, distance: number, maxDistance: number, targetEnemy: any, targetPosition: Vector3 }[] = [];
        
        // Add firing effect
        let lastFireTime = 0;
        let isInitialized = false;
        
        // Add a small delay before the tower can fire to ensure proper initialization
        setTimeout(() => {
            isInitialized = true;
        }, 500);
        
        // Create the animation callback
        const animationCallback = () => {
            if (this.targetEnemy && isInitialized) {
                // Check if it's time to fire based on fire rate
                const currentTime = performance.now();
                if (currentTime - lastFireTime > (1000 / this.fireRate)) {
                    lastFireTime = currentTime;
                    
                    // Create a new bullet instance
                    const newBullet = arrowTemplate.clone("basicBullet_" + currentTime);
                    newBullet.isVisible = true;
                    
                    // Get the world position of the bolt
                    const boltWorldMatrix = arrowGuide.getWorldMatrix();
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
        };
        
        // Register the callback and store both the callback and bullet tracking in metadata
        this.scene.registerBeforeRender(animationCallback);
        this.mesh!.metadata = { activeBullets, animationCallback };
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
        
        // Get all child meshes of this tower
        const towerParts = this.mesh.getChildMeshes();
        
        // Find the turret within this tower's hierarchy
        const turret = towerParts.find(mesh => mesh.name.includes('ballistaTurret'));
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
            const sensor = towerParts.find(mesh => mesh.name.includes('stringRight'));
            if (sensor && sensor.material) {
                const sensorMat = sensor.material as StandardMaterial;
                sensorMat.emissiveColor = new Color3(0.5 + (this.level - 1) * 0.05, 0.1, 0.1); // Reduced from 0.1 to 0.05
                sensorMat.diffuseColor = new Color3(0.7 + (this.level - 1) * 0.05, 0.2, 0.2); // Reduced from 0.1 to 0.05
            }
        }
    }

    /**
     * Override dispose method to clean up active projectiles
     */
    public override dispose(): void {
        // Clean up animation callback to prevent continued execution after disposal
        if (this.mesh && this.mesh.metadata) {
            // Unregister the beforeRender callback
            if (this.mesh.metadata.animationCallback) {
                this.scene.unregisterBeforeRender(this.mesh.metadata.animationCallback);
            }
            
            // Dispose all active bullets
            const activeBullets = this.mesh.metadata.activeBullets;
            if (activeBullets) {
                for (let i = activeBullets.length - 1; i >= 0; i--) {
                    if (activeBullets[i].mesh && !activeBullets[i].mesh.isDisposed()) {
                        activeBullets[i].mesh.dispose();
                    }
                }
                // Clear the array
                activeBullets.length = 0;
            }
        }
        
        // Call the parent class dispose method
        super.dispose();
    }
} 