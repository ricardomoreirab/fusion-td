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
            height: 0.4,
            diameter: 2.0,
            tessellation: 20
        }, this.scene);
        base.position = new Vector3(0, 0.2, 0);
        
        // Add decorative stone ring
        const baseRing = MeshBuilder.CreateTorus('fastBaseRing', {
            diameter: 1.8,
            thickness: 0.08,
            tessellation: 20
        }, this.scene);
        baseRing.position = new Vector3(0, 0.35, 0);
        baseRing.rotation.x = Math.PI / 2;
        
        // Create a wooden platform
        const platform = MeshBuilder.CreateCylinder('fastPlatform', {
            height: 0.25,
            diameter: 1.6,
            tessellation: 20
        }, this.scene);
        platform.position = new Vector3(0, 0.45, 0);
        
        // Create central post
        const post = MeshBuilder.CreateCylinder('fastPost', {
            height: 0.4,
            diameter: 0.5,
            tessellation: 10
        }, this.scene);
        post.position = new Vector3(0, 0.65, 0);
        
        // Create top rotating platform
        const topPlatform = MeshBuilder.CreateCylinder('fastTopPlatform', {
            height: 0.15,
            diameter: 0.8,
            tessellation: 16
        }, this.scene);
        topPlatform.position = new Vector3(0, 0.85, 0);
        
        // Create the crossbow body
        const crossbowBody = MeshBuilder.CreateBox('fastCrossbowBody', {
            width: 0.3,
            height: 0.25,
            depth: 1.2
        }, this.scene);
        crossbowBody.position = new Vector3(0, 0.95, 0.2);
        
        // Create crossbow stock
        const stock = MeshBuilder.CreateBox('fastStock', {
            width: 0.15,
            height: 0.1,
            depth: 0.5
        }, this.scene);
        stock.position = new Vector3(0, 0.9, -0.3);
        
        // Create decorative grooves on crossbow body
        const grooveTop = MeshBuilder.CreateBox('grooveTop', {
            width: 0.32,
            height: 0.03,
            depth: 1.0
        }, this.scene);
        grooveTop.position = new Vector3(0, 1.08, 0.1);
        
        const grooveBottom = MeshBuilder.CreateBox('grooveBottom', {
            width: 0.32,
            height: 0.03,
            depth: 1.0
        }, this.scene);
        grooveBottom.position = new Vector3(0, 0.82, 0.1);
        
        // Create the crossbow arms
        const leftArm = MeshBuilder.CreateCylinder('fastLeftArm', {
            height: 1.0,
            diameter: 0.12,
            tessellation: 10
        }, this.scene);
        leftArm.rotation.z = Math.PI / 2;
        leftArm.rotation.y = -Math.PI / 10;
        leftArm.position = new Vector3(-0.4, 0.95, 0.1);
        
        const rightArm = MeshBuilder.CreateCylinder('fastRightArm', {
            height: 1.0,
            diameter: 0.12,
            tessellation: 10
        }, this.scene);
        rightArm.rotation.z = Math.PI / 2;
        rightArm.rotation.y = Math.PI / 10;
        rightArm.position = new Vector3(0.4, 0.95, 0.1);
        
        // Create the bowstring
        const stringLeft = MeshBuilder.CreateCylinder('fastStringLeft', {
            height: 0.55,
            diameter: 0.035,
            tessellation: 8
        }, this.scene);
        stringLeft.position = new Vector3(-0.35, 0.95, 0.5);
        stringLeft.rotation.z = Math.PI / 2;
        stringLeft.rotation.y = -Math.PI / 6;
        
        const stringRight = MeshBuilder.CreateCylinder('fastStringRight', {
            height: 0.55,
            diameter: 0.035,
            tessellation: 8
        }, this.scene);
        stringRight.position = new Vector3(0.35, 0.95, 0.5);
        stringRight.rotation.z = Math.PI / 2;
        stringRight.rotation.y = Math.PI / 6;
        
        // Create firing mechanism
        const triggerHousing = MeshBuilder.CreateBox('triggerHousing', {
            width: 0.22,
            height: 0.18,
            depth: 0.35
        }, this.scene);
        triggerHousing.position = new Vector3(0, 0.85, -0.15);
        
        const trigger = MeshBuilder.CreateBox('trigger', {
            width: 0.08,
            height: 0.15,
            depth: 0.08
        }, this.scene);
        trigger.position = new Vector3(0, 0.75, -0.15);
        
        // Create arrow guide
        const arrowGuide = MeshBuilder.CreateBox('fastArrowGuide', {
            width: 0.12,
            height: 0.05,
            depth: 1.0
        }, this.scene);
        arrowGuide.position = new Vector3(0, 0.98, 0.2);
        
        // Create decorative notches on the crossbow arms
        const createNotches = (arm: Mesh, side: number) => {
            const notchPositions = [0.25, 0.4, 0.45];
            for (let i = 0; i < notchPositions.length; i++) {
                const notch = MeshBuilder.CreateTorus(`notch_${side}_${i}`, {
                    diameter: 0.12,
                    thickness: 0.03,
                    tessellation: 10
                }, this.scene);
                const angle = side === -1 ? -Math.PI / 10 : Math.PI / 10;
                notch.rotation.x = Math.PI / 2;
                notch.rotation.y = angle;
                notch.position = new Vector3(side * notchPositions[i], 0.95, 0.1);
                notch.parent = this.mesh;
            }
        };
        
        createNotches(leftArm, -1);
        createNotches(rightArm, 1);
        
        // Create winch mechanism
        const winch = MeshBuilder.CreateCylinder('winch', {
            height: 0.15,
            diameter: 0.22,
            tessellation: 16
        }, this.scene);
        winch.position = new Vector3(0, 0.85, -0.45);
        winch.rotation.x = Math.PI / 2;
        
        const winchHandle = MeshBuilder.CreateCylinder('winchHandle', {
            height: 0.18,
            diameter: 0.05,
            tessellation: 8
        }, this.scene);
        winchHandle.position = new Vector3(0.12, 0.85, -0.45);
        winchHandle.rotation.z = Math.PI / 2;
        
        const winchKnob = MeshBuilder.CreateSphere('winchKnob', {
            diameter: 0.08,
            segments: 10
        }, this.scene);
        winchKnob.position = new Vector3(0.22, 0.85, -0.45);
        
        // Create a loaded bolt/arrow
        const bolt = MeshBuilder.CreateCylinder('bolt', {
            height: 1.2,
            diameter: 0.05,
            tessellation: 8
        }, this.scene);
        bolt.rotation.x = Math.PI / 2;
        bolt.position = new Vector3(0, 0.98, 0.3);
        
        const boltHead = MeshBuilder.CreateCylinder('boltHead', {
            height: 0.2,
            diameterTop: 0,
            diameterBottom: 0.12,
            tessellation: 8
        }, this.scene);
        boltHead.rotation.x = Math.PI / 2;
        boltHead.position = new Vector3(0, 0.98, 0.9);
        
        const boltFletching = MeshBuilder.CreateCylinder('boltFletching', {
            height: 0.12,
            diameterTop: 0.03,
            diameterBottom: 0.12,
            tessellation: 8
        }, this.scene);
        boltFletching.rotation.x = Math.PI / 2;
        boltFletching.position = new Vector3(0, 0.98, -0.3);
        
        // Create materials
        const stoneMaterial = new StandardMaterial('fastStoneMaterial', this.scene);
        stoneMaterial.diffuseColor = new Color3(0.7, 0.7, 0.7); // Lighter gray stone
        stoneMaterial.specularColor = new Color3(0.3, 0.3, 0.3);
        base.material = stoneMaterial;
        baseRing.material = stoneMaterial;
        
        const woodMaterial = new StandardMaterial('fastWoodMaterial', this.scene);
        woodMaterial.diffuseColor = new Color3(0.5, 0.35, 0.2);
        platform.material = woodMaterial;
        post.material = woodMaterial;
        topPlatform.material = woodMaterial;
        
        const darkWoodMaterial = new StandardMaterial('fastDarkWoodMaterial', this.scene);
        darkWoodMaterial.diffuseColor = new Color3(0.35, 0.25, 0.15);
        crossbowBody.material = darkWoodMaterial;
        stock.material = darkWoodMaterial;
        leftArm.material = darkWoodMaterial;
        rightArm.material = darkWoodMaterial;
        
        const accentWoodMaterial = new StandardMaterial('accentWoodMaterial', this.scene);
        accentWoodMaterial.diffuseColor = new Color3(0.4, 0.3, 0.15);
        grooveTop.material = accentWoodMaterial;
        grooveBottom.material = accentWoodMaterial;
        triggerHousing.material = accentWoodMaterial;
        
        const stringMaterial = new StandardMaterial('fastStringMaterial', this.scene);
        stringMaterial.diffuseColor = new Color3(0.9, 0.9, 0.8);
        stringLeft.material = stringMaterial;
        stringRight.material = stringMaterial;
        
        const metalMaterial = new StandardMaterial('fastMetalMaterial', this.scene);
        metalMaterial.diffuseColor = new Color3(0.4, 0.4, 0.45);
        metalMaterial.specularColor = new Color3(0.7, 0.7, 0.7);
        metalMaterial.specularPower = 32;
        arrowGuide.material = metalMaterial;
        trigger.material = metalMaterial;
        winch.material = metalMaterial;
        winchHandle.material = metalMaterial;
        winchKnob.material = metalMaterial;
        
        // Create bolt materials
        const boltShaftMaterial = new StandardMaterial('boltShaftMaterial', this.scene);
        boltShaftMaterial.diffuseColor = new Color3(0.6, 0.5, 0.3);
        bolt.material = boltShaftMaterial;
        
        const boltHeadMaterial = new StandardMaterial('boltHeadMaterial', this.scene);
        boltHeadMaterial.diffuseColor = new Color3(0.5, 0.5, 0.5);
        boltHeadMaterial.specularColor = new Color3(0.8, 0.8, 0.8);
        boltHeadMaterial.specularPower = 64;
        boltHead.material = boltHeadMaterial;
        
        const fletchingMaterial = new StandardMaterial('fletchingMaterial', this.scene);
        fletchingMaterial.diffuseColor = new Color3(0.2, 0.8, 0.2); // Green feathers for Fast Tower
        boltFletching.material = fletchingMaterial;
        
        // Parent all parts to the root mesh
        base.parent = this.mesh;
        baseRing.parent = this.mesh;
        platform.parent = this.mesh;
        post.parent = this.mesh;
        
        // Create a holder for the rotating parts
        const turretHead = new Mesh("fastTurretHead", this.scene);
        turretHead.position = new Vector3(0, 0.6, 0);
        turretHead.parent = this.mesh;
        
        // Parent all rotating parts to the turret head
        topPlatform.parent = turretHead;
        crossbowBody.parent = turretHead;
        stock.parent = turretHead;
        grooveTop.parent = turretHead;
        grooveBottom.parent = turretHead;
        leftArm.parent = turretHead;
        rightArm.parent = turretHead;
        stringLeft.parent = turretHead;
        stringRight.parent = turretHead;
        arrowGuide.parent = turretHead;
        triggerHousing.parent = turretHead;
        trigger.parent = turretHead;
        winch.parent = turretHead;
        winchHandle.parent = turretHead;
        winchKnob.parent = turretHead;
        bolt.parent = turretHead;
        boltHead.parent = turretHead;
        boltFletching.parent = turretHead;
        
        // Create arrow template for projectiles
        const arrowTemplate = this.createArrowMesh("fastArrowTemplate");
        arrowTemplate.isVisible = false;
        
        // Track active arrows
        const activeArrows: { mesh: Mesh, distance: number, maxDistance: number, targetEnemy: any, targetPosition: Vector3, direction: Vector3, shouldContinue: boolean }[] = [];
        
        // Store reference to active arrows in the mesh's metadata for disposal when tower is sold
        this.mesh.metadata = { activeArrows };
    }
    
    /**
     * Create an arrow mesh
     */
    private createArrowMesh(name: string): Mesh {
        const arrow = new Mesh(name, this.scene);
        
        // Arrow shaft
        const shaft = MeshBuilder.CreateCylinder('shaft', {
            height: 1.2,
            diameter: 0.07,
            tessellation: 8
        }, this.scene);
        shaft.rotation.x = Math.PI / 2; // Horizontal
        shaft.position = new Vector3(0, 0, 0);
        
        // Arrow head - use cylinder with 0 top diameter instead of cone
        const head = MeshBuilder.CreateCylinder('head', {
            height: 0.25,
            diameterTop: 0.0,
            diameterBottom: 0.12,
            tessellation: 8
        }, this.scene);
        head.rotation.x = -Math.PI / 2; // Point forward
        head.position = new Vector3(0, 0, 0.7);
        
        // Arrow fletching (feathers)
        const fletching1 = MeshBuilder.CreatePlane('fletching1', {
            width: 0.3,
            height: 0.3
        }, this.scene);
        fletching1.position = new Vector3(0, 0, -0.5);
        fletching1.rotation.z = Math.PI / 2;
        
        const fletching2 = MeshBuilder.CreatePlane('fletching2', {
            width: 0.3,
            height: 0.3
        }, this.scene);
        fletching2.position = new Vector3(0, 0, -0.5);
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
        
        // Find the turret head in this tower's hierarchy
        const turretHead = this.mesh.getChildMeshes().find(mesh => mesh.name.includes('fastTurretHead'));
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
            const towerChildren = this.mesh.getChildMeshes();
            for (let i = 0; i < 8; i++) {
                const fin = towerChildren.find(mesh => mesh.name.includes(`fastFin${i}`));
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