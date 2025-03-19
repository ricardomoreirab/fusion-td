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
        
        // Create a stone base
        const base = MeshBuilder.CreateCylinder('fastBase', {
            height: 0.8,
            diameter: 1.8,
            tessellation: 12
        }, this.scene);
        base.position = new Vector3(0, 0.4, 0);
        
        // Create wooden middle platform
        const middle = MeshBuilder.CreateCylinder('fastMiddle', {
            height: 0.6,
            diameterTop: 1.5,
            diameterBottom: 1.8,
            tessellation: 12
        }, this.scene);
        middle.position = new Vector3(0, 1.1, 0);
        
        // Create central turret post
        const post = MeshBuilder.CreateCylinder('fastPost', {
            height: 0.8,
            diameter: 0.6,
            tessellation: 8
        }, this.scene);
        post.position = new Vector3(0, 1.8, 0);
        
        // Create the crossbow body (horizontal piece)
        const crossbowBody = MeshBuilder.CreateBox('fastCrossbowBody', {
            width: 0.4,
            height: 0.2,
            depth: 1.0
        }, this.scene);
        crossbowBody.position = new Vector3(0, 2.2, 0.2);
        
        // Create the crossbow arms (the bow part)
        const leftArm = MeshBuilder.CreateCylinder('fastLeftArm', {
            height: 1.2,
            diameter: 0.15,
            tessellation: 8
        }, this.scene);
        leftArm.rotation.z = Math.PI / 2; // Horizontal
        leftArm.rotation.y = -Math.PI / 8; // Angled slightly
        leftArm.position = new Vector3(-0.4, 2.2, 0.2);
        
        const rightArm = MeshBuilder.CreateCylinder('fastRightArm', {
            height: 1.2,
            diameter: 0.15,
            tessellation: 8
        }, this.scene);
        rightArm.rotation.z = Math.PI / 2; // Horizontal
        rightArm.rotation.y = Math.PI / 8; // Angled slightly
        rightArm.position = new Vector3(0.4, 2.2, 0.2);
        
        // Create the string connecting the arms
        const stringLeft = MeshBuilder.CreateCylinder('fastStringLeft', {
            height: 0.7,
            diameter: 0.05,
            tessellation: 6
        }, this.scene);
        stringLeft.position = new Vector3(-0.35, 2.2, 0.6);
        stringLeft.rotation.z = Math.PI / 2;
        stringLeft.rotation.y = -Math.PI / 5;
        
        const stringRight = MeshBuilder.CreateCylinder('fastStringRight', {
            height: 0.7,
            diameter: 0.05,
            tessellation: 6
        }, this.scene);
        stringRight.position = new Vector3(0.35, 2.2, 0.6);
        stringRight.rotation.z = Math.PI / 2;
        stringRight.rotation.y = Math.PI / 5;
        
        // Create the arrow guide
        const arrowGuide = MeshBuilder.CreateBox('fastArrowGuide', {
            width: 0.1,
            height: 0.05,
            depth: 1.0
        }, this.scene);
        arrowGuide.position = new Vector3(0, 2.25, 0.2);
        
        // Create wooden support beams
        const beams = [];
        for (let i = 0; i < 4; i++) {
            const angle = (i / 4) * Math.PI * 2;
            const beam = MeshBuilder.CreateBox(`fastBeam${i}`, {
                width: 0.15,
                height: 0.8,
                depth: 0.15
            }, this.scene);
            
            const x = Math.cos(angle) * 0.8;
            const z = Math.sin(angle) * 0.8;
            
            beam.position = new Vector3(x, 1.5, z);
            beam.rotation.y = angle;
            
            beams.push(beam);
        }
        
        // Create materials
        // Stone base material
        const baseMaterial = new StandardMaterial('fastBaseMaterial', this.scene);
        baseMaterial.diffuseColor = new Color3(0.6, 0.6, 0.6); // Stone gray
        base.material = baseMaterial;
        
        // Wooden platform material
        const woodMaterial = new StandardMaterial('fastWoodMaterial', this.scene);
        woodMaterial.diffuseColor = new Color3(0.5, 0.35, 0.2); // Brown wood
        middle.material = woodMaterial;
        post.material = woodMaterial;
        
        // Crossbow body material - darker wood
        const crossbowMaterial = new StandardMaterial('fastCrossbowMaterial', this.scene);
        crossbowMaterial.diffuseColor = new Color3(0.4, 0.25, 0.15); // Darker brown
        crossbowBody.material = crossbowMaterial;
        
        // Crossbow arms material - flexible wood
        const armsMaterial = new StandardMaterial('fastArmsMaterial', this.scene);
        armsMaterial.diffuseColor = new Color3(0.35, 0.2, 0.1); // Very dark brown
        leftArm.material = armsMaterial;
        rightArm.material = armsMaterial;
        
        // String material
        const stringMaterial = new StandardMaterial('fastStringMaterial', this.scene);
        stringMaterial.diffuseColor = new Color3(0.9, 0.9, 0.8); // Light tan
        stringLeft.material = stringMaterial;
        stringRight.material = stringMaterial;
        
        // Arrow guide material - metal
        const guideMaterial = new StandardMaterial('fastGuideMaterial', this.scene);
        guideMaterial.diffuseColor = new Color3(0.4, 0.4, 0.45); // Metal gray
        guideMaterial.specularColor = new Color3(0.7, 0.7, 0.7);
        guideMaterial.specularPower = 32;
        arrowGuide.material = guideMaterial;
        
        // Apply wood material to beams
        for (const beam of beams) {
            beam.material = woodMaterial;
        }
        
        // Parent all parts to the root mesh
        base.parent = this.mesh;
        middle.parent = this.mesh;
        post.parent = this.mesh;
        
        // Create a holder for the rotating parts
        const turretHead = new Mesh("fastTurretHead", this.scene);
        turretHead.position = new Vector3(0, 2.2, 0);
        turretHead.parent = this.mesh;
        
        // Parent crossbow parts to the turret head for rotation
        crossbowBody.parent = turretHead;
        crossbowBody.position = new Vector3(0, 0, 0.2); // Position relative to turret head
        
        leftArm.parent = turretHead;
        leftArm.position = new Vector3(-0.4, 0, 0.2); // Position relative to turret head
        
        rightArm.parent = turretHead;
        rightArm.position = new Vector3(0.4, 0, 0.2); // Position relative to turret head
        
        stringLeft.parent = turretHead;
        stringLeft.position = new Vector3(-0.35, 0, 0.6); // Position relative to turret head
        
        stringRight.parent = turretHead;
        stringRight.position = new Vector3(0.35, 0, 0.6); // Position relative to turret head
        
        arrowGuide.parent = turretHead;
        arrowGuide.position = new Vector3(0, 0.05, 0.2); // Position relative to turret head
        
        // Parent support beams to the root
        for (const beam of beams) {
            beam.parent = this.mesh;
        }
        
        // Create arrow template for projectiles
        const arrowTemplate = this.createArrowMesh("fastArrowTemplate");
        arrowTemplate.isVisible = false;
        
        // Track active arrows
        const activeArrows: { mesh: Mesh, distance: number, maxDistance: number, targetEnemy: any, targetPosition: Vector3, direction: Vector3, shouldContinue: boolean }[] = [];
        
        // Store reference to active arrows in the mesh's metadata for disposal when tower is sold
        this.mesh.metadata = { activeArrows };
        
        // No need for scene.registerBeforeRender as we're using createProjectileEffect
    }
    
    /**
     * Create an arrow mesh
     */
    private createArrowMesh(name: string): Mesh {
        const arrow = new Mesh(name, this.scene);
        
        // Arrow shaft
        const shaft = MeshBuilder.CreateCylinder('shaft', {
            height: 1.0,
            diameter: 0.05,
            tessellation: 8
        }, this.scene);
        shaft.rotation.x = Math.PI / 2; // Horizontal
        shaft.position = new Vector3(0, 0, 0);
        
        // Arrow head - use cylinder with 0 top diameter instead of cone
        const head = MeshBuilder.CreateCylinder('head', {
            height: 0.2,
            diameterTop: 0.0,
            diameterBottom: 0.1,
            tessellation: 8
        }, this.scene);
        head.rotation.x = -Math.PI / 2; // Point forward
        head.position = new Vector3(0, 0, 0.6);
        
        // Arrow fletching (feathers)
        const fletching1 = MeshBuilder.CreatePlane('fletching1', {
            width: 0.2,
            height: 0.2
        }, this.scene);
        fletching1.position = new Vector3(0, 0, -0.4);
        fletching1.rotation.z = Math.PI / 2;
        
        const fletching2 = MeshBuilder.CreatePlane('fletching2', {
            width: 0.2,
            height: 0.2
        }, this.scene);
        fletching2.position = new Vector3(0, 0, -0.4);
        fletching2.rotation.z = 0;
        
        // Materials
        const shaftMaterial = new StandardMaterial('shaftMaterial', this.scene);
        shaftMaterial.diffuseColor = new Color3(0.7, 0.5, 0.3); // Wood color
        shaft.material = shaftMaterial;
        
        const headMaterial = new StandardMaterial('headMaterial', this.scene);
        headMaterial.diffuseColor = new Color3(0.6, 0.6, 0.6); // Metal color
        headMaterial.specularColor = new Color3(0.8, 0.8, 0.8);
        head.material = headMaterial;
        
        const fletchingMaterial = new StandardMaterial('fletchingMaterial', this.scene);
        fletchingMaterial.diffuseColor = new Color3(0.2, 0.8, 0.2); // Green feathers
        fletching1.material = fletchingMaterial;
        fletching2.material = fletchingMaterial;
        
        // Parent all parts to the arrow mesh
        shaft.parent = arrow;
        head.parent = arrow;
        fletching1.parent = arrow;
        fletching2.parent = arrow;
        
        return arrow;
    }
    
    /**
     * Create impact effect for arrows
     */
    private createArrowImpactEffect(position: Vector3): void {
        // Simple particles for arrow impact
        const particleSystem = new ParticleSystem("arrowImpact", 30, this.scene);
        
        // Set texture and properties
        particleSystem.particleTexture = new Texture("assets/textures/particle.png", this.scene);
        particleSystem.emitter = position;
        particleSystem.minEmitBox = new Vector3(-0.1, -0.1, -0.1);
        particleSystem.maxEmitBox = new Vector3(0.1, 0.1, 0.1);
        
        // Particle colors - green to match Fletcher theme
        particleSystem.color1 = new Color3(0.2, 0.8, 0.2).toColor4(1.0);
        particleSystem.color2 = new Color3(0.1, 0.6, 0.1).toColor4(1.0);
        particleSystem.colorDead = new Color3(0.1, 0.3, 0.1).toColor4(0.0);
        
        particleSystem.minSize = 0.1;
        particleSystem.maxSize = 0.3;
        
        particleSystem.minLifeTime = 0.1;
        particleSystem.maxLifeTime = 0.3;
        
        particleSystem.emitRate = 100;
        particleSystem.blendMode = ParticleSystem.BLENDMODE_ONEONE;
        particleSystem.gravity = new Vector3(0, -5, 0);
        
        particleSystem.direction1 = new Vector3(-1, -1, -1);
        particleSystem.direction2 = new Vector3(1, 1, 1);
        
        particleSystem.minEmitPower = 1;
        particleSystem.maxEmitPower = 3;
        
        particleSystem.updateSpeed = 0.01;
        
        // Start particles
        particleSystem.start();
        
        // Stop and dispose after a short time
        setTimeout(() => {
            particleSystem.stop();
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
     * Create the missile attack effect (an arrow projectile)
     * @param targetPosition The position of the target
     */
    protected createProjectileEffect(targetPosition: Vector3): void {
        if (!this.mesh || !this.targetEnemy) return;
        
        const arrowSize = 0.2;
        const arrowHead = MeshBuilder.CreateCylinder("arrow", {
            height: 0.6,
            diameter: 0.1,
            tessellation: 8
        }, this.scene);
        
        const arrowShaft = MeshBuilder.CreateCylinder("arrowShaft", {
            height: 1.0,
            diameter: 0.05,
            tessellation: 8
        }, this.scene);
        
        arrowShaft.parent = arrowHead;
        arrowShaft.position.y = -0.8;
        
        // Position the arrow at the top of the tower
        const startPosition = new Vector3(
            this.mesh.position.x,
            this.mesh.position.y + 2,
            this.mesh.position.z
        );
        
        arrowHead.position = startPosition;
        
        // Calculate direction and rotation
        const direction = targetPosition.subtract(startPosition).normalize();
        
        // Set arrow rotation based on direction
        const upVector = new Vector3(0, 1, 0);
        const rotationAxis = Vector3.Cross(upVector, direction).normalize();
        const angle = Math.acos(Vector3.Dot(upVector, direction));
        
        // Check if angle calculation is valid (not NaN)
        if (!isNaN(angle)) {
            arrowHead.rotate(rotationAxis, angle);
        }
        
        // Set material
        const arrowMaterial = new StandardMaterial("arrowMaterial", this.scene);
        arrowMaterial.diffuseColor = new Color3(0.6, 0.3, 0.1);
        arrowHead.material = arrowMaterial;
        
        const shaftMaterial = new StandardMaterial("shaftMaterial", this.scene);
        shaftMaterial.diffuseColor = new Color3(0.8, 0.6, 0.2);
        arrowShaft.material = shaftMaterial;
        
        // Animation parameters
        const speed = 30; // units per second
        const maxDistance = Vector3.Distance(startPosition, targetPosition);
        
        // Create an arrow object to track in the animation
        const arrow = {
            mesh: arrowHead,
            distance: 0,
            maxDistance: maxDistance,
            targetEnemy: this.targetEnemy,
            targetPosition: targetPosition,
            direction: direction,
            shouldContinue: true
        };
        
        // Get the activeArrows array from the tower's metadata
        const activeArrows = this.mesh.metadata?.activeArrows || [];
        activeArrows.push(arrow);
        
        // Set up animation callback
        const animateArrow = () => {
            // If tower or arrow was disposed, stop animation
            if (!this.mesh || arrowHead.isDisposed() || !arrow.shouldContinue) {
                // Arrow was disposed, stop animation
                return;
            }
            
            const deltaDistance = (speed * this.scene.getEngine().getDeltaTime()) / 1000;
            arrow.distance += deltaDistance;
            
            // Move arrow forward
            const newPos = startPosition.add(direction.scale(arrow.distance));
            arrowHead.position = newPos;
            
            // If arrow reaches target or max distance
            if (arrow.distance >= maxDistance) {
                // Create impact effect at the final position
                this.createImpactEffect(arrowHead.position);
                
                // Remove from active arrows
                const index = activeArrows.indexOf(arrow);
                if (index > -1) {
                    activeArrows.splice(index, 1);
                }
                
                // Apply damage if enemy still exists and is alive
                if (arrow.targetEnemy && arrow.targetEnemy.isAlive()) {
                    const damage = this.calculateDamage(arrow.targetEnemy);
                    arrow.targetEnemy.takeDamage(damage);
                    
                    // Attempt to apply primary and secondary effects
                    this.applyPrimaryEffect(arrow.targetEnemy);
                    this.applySecondaryEffect(arrow.targetEnemy);
                }
                
                // Dispose arrow mesh
                arrowHead.dispose();
                
                return;
            }
            
            // Continue animation
            requestAnimationFrame(animateArrow);
        };
        
        // Start animation
        animateArrow();
    }

    /**
     * Override the dispose method to clean up in-flight arrows when tower is sold
     */
    public dispose(): void {
        // Clean up any in-flight arrows
        if (this.mesh && this.mesh.metadata && this.mesh.metadata.activeArrows) {
            const activeArrows = this.mesh.metadata.activeArrows as Array<{ 
                mesh: Mesh, 
                shouldContinue: boolean 
            }>;
            
            // First mark all arrows to stop their animation loops
            for (const arrowInfo of activeArrows) {
                arrowInfo.shouldContinue = false;
            }
            
            // Then dispose all active arrow meshes
            for (const arrowInfo of activeArrows) {
                if (arrowInfo.mesh) {
                    arrowInfo.mesh.dispose();
                }
            }
            
            // Clear the array
            activeArrows.length = 0;
        }
        
        // Call the parent dispose method
        super.dispose();
    }
} 