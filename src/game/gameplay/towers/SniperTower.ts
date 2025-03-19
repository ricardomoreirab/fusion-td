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
        
        // Create a stone base
        const base = MeshBuilder.CreateCylinder('sniperBase', {
            height: 1.0,
            diameter: 1.8,
            tessellation: 12
        }, this.scene);
        base.position = new Vector3(0, 0.5, 0);
        
        // Create a wooden platform
        const platform = MeshBuilder.CreateCylinder('sniperPlatform', {
            height: 0.4,
            diameterTop: 1.6,
            diameterBottom: 1.8,
            tessellation: 12
        }, this.scene);
        platform.position = new Vector3(0, 1.2, 0);
        
        // Create medieval tower structure
        const towerLower = MeshBuilder.CreateCylinder('sniperTowerLower', {
            height: 1.0,
            diameter: 1.0,
            tessellation: 8
        }, this.scene);
        towerLower.position = new Vector3(0, 1.9, 0);
        
        const towerUpper = MeshBuilder.CreateCylinder('sniperTowerUpper', {
            height: 1.2,
            diameter: 1.2,
            tessellation: 8
        }, this.scene);
        towerUpper.position = new Vector3(0, 3.0, 0);
        
        // Create a lookout platform at the top
        const lookout = MeshBuilder.CreateCylinder('sniperLookout', {
            height: 0.2,
            diameter: 1.5,
            tessellation: 12
        }, this.scene);
        lookout.position = new Vector3(0, 3.7, 0);
        
        // Create stone battlements around the top
        const crenellations = [];
        for(let i = 0; i < 8; i++) {
            const angle = (i / 8) * Math.PI * 2;
            const x = Math.cos(angle) * 0.7;
            const z = Math.sin(angle) * 0.7;
            
            const crenellation = MeshBuilder.CreateBox(`crenellation${i}`, {
                width: 0.2,
                height: 0.3,
                depth: 0.2
            }, this.scene);
            crenellation.position = new Vector3(x, 4.0, z);
            crenellations.push(crenellation);
        }
        
        // Create the archer figure (more detailed)
        const archerBody = new Mesh("archerBody", this.scene);
        archerBody.position = new Vector3(0, 3.9, 0);
        
        // Archer's torso
        const torso = MeshBuilder.CreateBox('archerTorso', {
            width: 0.25,
            height: 0.4,
            depth: 0.15
        }, this.scene);
        torso.position = new Vector3(0, 0, 0);
        torso.parent = archerBody;
        
        // Archer's head
        const head = MeshBuilder.CreateSphere('archerHead', {
            diameter: 0.18,
            segments: 10
        }, this.scene);
        head.position = new Vector3(0, 0.28, 0);
        head.parent = archerBody;
        
        // Archer's legs
        const leftLeg = MeshBuilder.CreateBox('leftLeg', {
            width: 0.08,
            height: 0.3,
            depth: 0.08
        }, this.scene);
        leftLeg.position = new Vector3(-0.08, -0.32, 0);
        leftLeg.parent = archerBody;
        
        const rightLeg = MeshBuilder.CreateBox('rightLeg', {
            width: 0.08,
            height: 0.3,
            depth: 0.08
        }, this.scene);
        rightLeg.position = new Vector3(0.08, -0.32, 0);
        rightLeg.parent = archerBody;
        
        // Archer's arms
        const leftArm = MeshBuilder.CreateBox('leftArm', {
            width: 0.25,
            height: 0.08,
            depth: 0.08
        }, this.scene);
        leftArm.position = new Vector3(-0.20, 0.05, 0);
        leftArm.parent = archerBody;
        
        const rightArm = MeshBuilder.CreateBox('rightArm', {
            width: 0.25,
            height: 0.08,
            depth: 0.08
        }, this.scene);
        rightArm.position = new Vector3(0.20, 0.05, 0);
        rightArm.parent = archerBody;
        
        // Medieval hood
        const hood = MeshBuilder.CreateCylinder('archerHood', {
            height: 0.15,
            diameter: 0.2,
            diameterTop: 0.12,
            tessellation: 8
        }, this.scene);
        hood.position = new Vector3(0, 0.33, 0);
        hood.parent = archerBody;
        
        // Create the longbow (larger and more detailed)
        const bow = new Mesh("longbow", this.scene);
        bow.position = new Vector3(0.3, 0.05, 0.3);
        bow.parent = archerBody;
        
        // Bow stave (main part) - longer and curved
        const bowStave = MeshBuilder.CreateCylinder('bowStave', {
            height: 1.5,
            diameter: 0.03,
            tessellation: 6,
            arc: 0.8
        }, this.scene);
        
        // Add curve to the bow
        const bowPoints = [];
        for(let i = 0; i < 20; i++) {
            const y = (i / 19) * 1.5 - 0.75;
            // Create a curved shape using sine function
            const x = Math.sin(y * Math.PI * 0.7) * 0.08;
            bowPoints.push(new Vector3(x, y, 0));
        }
        
        const bowCurve = MeshBuilder.CreateLines("bowCurve", {
            points: bowPoints,
            updatable: true
        }, this.scene);
        bowCurve.color = new Color3(0.4, 0.3, 0.2);
        bowCurve.parent = bow;
        
        // Thicker cylinder following the curve to give volume
        for(let i = 0; i < bowPoints.length-1; i++) {
            const segment = MeshBuilder.CreateCylinder(`bowSegment${i}`, {
                height: Vector3.Distance(bowPoints[i], bowPoints[i+1]),
                diameter: 0.04,
                tessellation: 6
            }, this.scene);
            
            // Position at midpoint
            const midPoint = bowPoints[i].add(bowPoints[i+1]).scale(0.5);
            segment.position = midPoint;
            
            // Rotate to align with curve
            const direction = bowPoints[i+1].subtract(bowPoints[i]);
            const upVector = new Vector3(0, 1, 0);
            const rotationAxis = Vector3.Cross(upVector, direction.normalize());
            let angle = Math.acos(Vector3.Dot(upVector, direction.normalize()));
            
            if(!isNaN(angle)) {
                segment.rotationQuaternion = null; // Remove any existing rotation
                segment.rotate(rotationAxis, angle, Space.WORLD);
            }
            
            segment.parent = bow;
        }
        
        // Bow string
        const string = MeshBuilder.CreateCylinder('bowString', {
            height: 1.4,
            diameter: 0.01,
            tessellation: 4
        }, this.scene);
        string.position = new Vector3(0.07, 0, 0);
        string.parent = bow;
        
        // Create a notched arrow
        const arrow = this.createArrowMesh("sniperArrow");
        arrow.rotation = new Vector3(0, -Math.PI / 2, 0);
        arrow.position = new Vector3(0.05, 0, 0);
        arrow.scaling = new Vector3(0.9, 0.9, 0.9);
        arrow.parent = bow;
        
        // Materials
        // Stone base material
        const stoneMaterial = new StandardMaterial('sniperBaseMaterial', this.scene);
        stoneMaterial.diffuseColor = new Color3(0.6, 0.6, 0.6); // Stone gray
        base.material = stoneMaterial;
        
        // Wooden platform and tower material
        const woodMaterial = new StandardMaterial('sniperWoodMaterial', this.scene);
        woodMaterial.diffuseColor = new Color3(0.5, 0.35, 0.2); // Brown wood
        platform.material = woodMaterial;
        towerLower.material = woodMaterial;
        towerUpper.material = woodMaterial;
        lookout.material = woodMaterial;
        
        // Crenellation material
        const crenellationMaterial = new StandardMaterial('sniperCrenellationMaterial', this.scene);
        crenellationMaterial.diffuseColor = new Color3(0.7, 0.7, 0.7); // Light gray stone
        for (const crenellation of crenellations) {
            crenellation.material = crenellationMaterial;
        }
        
        // Archer materials
        const archerBodyMaterial = new StandardMaterial('archerBodyMaterial', this.scene);
        archerBodyMaterial.diffuseColor = new Color3(0.3, 0.3, 0.4); // Dark blue/gray tunic
        torso.material = archerBodyMaterial;
        leftLeg.material = archerBodyMaterial;
        rightLeg.material = archerBodyMaterial;
        
        const archerArmsMaterial = new StandardMaterial('archerArmsMaterial', this.scene);
        archerArmsMaterial.diffuseColor = new Color3(0.6, 0.5, 0.4); // Lighter skin tone
        leftArm.material = archerArmsMaterial;
        rightArm.material = archerArmsMaterial;
        
        // Archer's head - Medieval look
        const headMaterial = new StandardMaterial('archerHeadMaterial', this.scene);
        headMaterial.diffuseColor = new Color3(0.8, 0.6, 0.5); // Skin tone
        head.material = headMaterial;
        
        // Hood material - Medieval archer
        const hoodMaterial = new StandardMaterial('archerHoodMaterial', this.scene);
        hoodMaterial.diffuseColor = new Color3(0.2, 0.2, 0.3); // Dark fabric
        hood.material = hoodMaterial;
        
        // Bow material - polished wood
        const bowMaterial = new StandardMaterial('sniperBowMaterial', this.scene);
        bowMaterial.diffuseColor = new Color3(0.6, 0.4, 0.2); // Polished wood
        bowMaterial.specularColor = new Color3(0.3, 0.3, 0.3);
        bowMaterial.specularPower = 32;
        for(let i = 0; i < bowPoints.length-1; i++) {
            const segment = this.scene.getMeshByName(`bowSegment${i}`);
            if(segment) {
                segment.material = bowMaterial;
            }
        }
        
        // String material
        const stringMaterial = new StandardMaterial('sniperStringMaterial', this.scene);
        stringMaterial.diffuseColor = new Color3(0.9, 0.9, 0.8); // Off-white
        string.material = stringMaterial;
        
        // Parent all parts to the root mesh
        base.parent = this.mesh;
        platform.parent = this.mesh;
        towerLower.parent = this.mesh;
        towerUpper.parent = this.mesh;
        lookout.parent = this.mesh;
        for (const crenellation of crenellations) {
            crenellation.parent = this.mesh;
        }
        
        // The archer body is already positioned, so parent it to the mesh
        archerBody.parent = this.mesh;
        
        // Store the bow reference for animation
        const bowPivot = new Mesh("bowPivot", this.scene);
        bowPivot.position = new Vector3(0, 3.9, 0);
        bowPivot.parent = this.mesh;
        
        // Create arrow template for projectiles
        const arrowTemplate = this.createArrowMesh("sniperArrowTemplate");
        arrowTemplate.isVisible = false;
        
        // Track active arrows and the bow position for animations
        const activeArrows: { 
            mesh: Mesh, 
            distance: number, 
            maxDistance: number, 
            targetEnemy: any, 
            targetPosition: Vector3,
            direction: Vector3,
            trail?: ParticleSystem,
            shouldContinue: boolean
        }[] = [];
        
        // Store reference to active arrows in the mesh's metadata for cleanup
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
            diameter: 0.02,
            tessellation: 8
        }, this.scene);
        shaft.rotation.x = Math.PI / 2; // Horizontal
        shaft.position = new Vector3(0, 0, 0);
        
        // Arrow head
        const head = MeshBuilder.CreateCylinder('head', {
            height: 0.15,
            diameterTop: 0.0,
            diameterBottom: 0.06,
            tessellation: 8
        }, this.scene);
        head.rotation.x = -Math.PI / 2; // Point forward
        head.position = new Vector3(0, 0, 0.6);
        
        // Arrow fletching (feathers)
        const createFletching = (angle: number) => {
            const fletching = MeshBuilder.CreateBox(`fletching${angle}`, {
                width: 0.01,
                height: 0.08,
                depth: 0.3
            }, this.scene);
            fletching.position = new Vector3(0, 0, -0.4);
            fletching.rotation.y = angle;
            return fletching;
        };
        
        const fletching1 = createFletching(0);
        const fletching2 = createFletching(Math.PI / 2);
        const fletching3 = createFletching(Math.PI);
        const fletching4 = createFletching(Math.PI * 3 / 2);
        
        // Materials
        const shaftMaterial = new StandardMaterial('shaftMaterial', this.scene);
        shaftMaterial.diffuseColor = new Color3(0.7, 0.5, 0.3); // Wood color
        shaft.material = shaftMaterial;
        
        const headMaterial = new StandardMaterial('headMaterial', this.scene);
        headMaterial.diffuseColor = new Color3(0.6, 0.6, 0.6); // Metal color
        headMaterial.specularColor = new Color3(0.8, 0.8, 0.8);
        head.material = headMaterial;
        
        const fletchingMaterial = new StandardMaterial('fletchingMaterial', this.scene);
        fletchingMaterial.diffuseColor = new Color3(0.8, 0.2, 0.2); // Red feathers for sniper
        fletching1.material = fletchingMaterial;
        fletching2.material = fletchingMaterial;
        fletching3.material = fletchingMaterial;
        fletching4.material = fletchingMaterial;
        
        // Parent all parts to the arrow mesh
        shaft.parent = arrow;
        head.parent = arrow;
        fletching1.parent = arrow;
        fletching2.parent = arrow;
        fletching3.parent = arrow;
        fletching4.parent = arrow;
        
        return arrow;
    }
    
    /**
     * Create a trail effect for arrows
     */
    private createArrowTrail(arrow: Mesh): ParticleSystem {
        // Create a particle system for the arrow trail
        const particleSystem = new ParticleSystem("arrowTrail", 60, this.scene);
        
        // Set particle texture
        particleSystem.particleTexture = new Texture("assets/textures/particle.png", this.scene);
        
        // Particles follow the arrow
        particleSystem.emitter = arrow;
        particleSystem.minEmitBox = new Vector3(-0.05, -0.05, -0.3); // Behind the arrow
        particleSystem.maxEmitBox = new Vector3(0.05, 0.05, -0.1);
        
        // Particle colors - red for sniper
        particleSystem.color1 = new Color3(0.8, 0.2, 0.2).toColor4(0.7);
        particleSystem.color2 = new Color3(0.5, 0.1, 0.1).toColor4(0.5);
        particleSystem.colorDead = new Color3(0.3, 0.0, 0.0).toColor4(0);
        
        particleSystem.minSize = 0.05;
        particleSystem.maxSize = 0.1;
        
        particleSystem.minLifeTime = 0.1;
        particleSystem.maxLifeTime = 0.2;
        
        particleSystem.emitRate = 100;
        
        particleSystem.blendMode = ParticleSystem.BLENDMODE_ONEONE;
        
        particleSystem.gravity = new Vector3(0, 0, 0);
        
        particleSystem.direction1 = new Vector3(0, 0, -1);
        particleSystem.direction2 = new Vector3(0, 0, -1);
        
        particleSystem.minEmitPower = 0.1;
        particleSystem.maxEmitPower = 0.3;
        
        particleSystem.updateSpeed = 0.01;
        
        // Start the particle system
        particleSystem.start();
        
        return particleSystem;
    }
    
    /**
     * Create impact effect for arrows
     */
    private createArrowImpactEffect(position: Vector3): void {
        // Create impact particles
        const particleSystem = new ParticleSystem("sniperImpact", 50, this.scene);
        
        // Set particle texture and properties
        particleSystem.particleTexture = new Texture("assets/textures/particle.png", this.scene);
        particleSystem.emitter = position;
        particleSystem.minEmitBox = new Vector3(-0.1, -0.1, -0.1);
        particleSystem.maxEmitBox = new Vector3(0.1, 0.1, 0.1);
        
        // Red particles for sniper arrow
        particleSystem.color1 = new Color3(0.8, 0.2, 0.2).toColor4(1.0);
        particleSystem.color2 = new Color3(0.5, 0.1, 0.1).toColor4(1.0);
        particleSystem.colorDead = new Color3(0.3, 0.0, 0.0).toColor4(0.0);
        
        particleSystem.minSize = 0.05;
        particleSystem.maxSize = 0.2;
        
        particleSystem.minLifeTime = 0.1;
        particleSystem.maxLifeTime = 0.3;
        
        particleSystem.emitRate = 200;
        
        particleSystem.blendMode = ParticleSystem.BLENDMODE_ONEONE;
        
        particleSystem.direction1 = new Vector3(-1, -1, -1);
        particleSystem.direction2 = new Vector3(1, 1, 1);
        
        particleSystem.minEmitPower = 1;
        particleSystem.maxEmitPower = 3;
        
        particleSystem.updateSpeed = 0.01;
        particleSystem.gravity = new Vector3(0, -5, 0);
        
        // Start and then clean up
        particleSystem.start();
        setTimeout(() => {
            particleSystem.stop();
            setTimeout(() => {
                particleSystem.dispose();
            }, 500);
        }, 100);
    }
    
    /**
     * Override the dispose method to clean up in-flight arrows when tower is sold
     */
    public dispose(): void {
        // Clean up any in-flight arrows
        if (this.mesh && this.mesh.metadata && this.mesh.metadata.activeArrows) {
            const activeArrows = this.mesh.metadata.activeArrows as Array<{ 
                mesh: Mesh, 
                trail?: ParticleSystem,
                shouldContinue: boolean
            }>;
            
            // First mark all arrows to stop their animation loops
            for (const arrowInfo of activeArrows) {
                arrowInfo.shouldContinue = false;
            }
            
            // Then dispose all active arrow meshes and their trails
            for (const arrowInfo of activeArrows) {
                if (arrowInfo.trail) {
                    arrowInfo.trail.stop();
                    arrowInfo.trail.dispose();
                }
                
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

    /**
     * Override fire method to create projectiles
     */
    protected fire(): void {
        if (!this.targetEnemy || !this.mesh) return;
        
        const targetPosition = this.targetEnemy.getPosition();
        this.createProjectileEffect(targetPosition);
    }
    
    /**
     * Create a projectile effect for the sniper tower
     * @param targetPosition The position of the target
     */
    protected createProjectileEffect(targetPosition: Vector3): void {
        if (!this.mesh || !this.targetEnemy) return;
        
        // Create a new arrow for firing
        const arrowMesh = this.createArrowMesh("sniperArrow_" + performance.now());
        
        // Position the arrow at the top of the tower
        const startPosition = new Vector3(
            this.mesh.position.x,
            this.mesh.position.y + 4,
            this.mesh.position.z
        );
        
        arrowMesh.position = startPosition;
        
        // Calculate direction to target
        const direction = targetPosition.subtract(startPosition).normalize();
        
        // Aim the arrow
        arrowMesh.lookAt(targetPosition);
        
        // Create the trail effect for the arrow
        const trailSystem = this.createArrowTrail(arrowMesh);
        
        // Animation parameters
        const speed = 40; // units per second (faster for sniper)
        const maxDistance = Vector3.Distance(startPosition, targetPosition) * 1.2; // Allow for slight overshoot
        
        // Create an arrow object to track in the animation
        const arrow = {
            mesh: arrowMesh,
            distance: 0,
            maxDistance: maxDistance,
            targetEnemy: this.targetEnemy,
            targetPosition: targetPosition.clone(),
            direction: direction,
            trail: trailSystem,
            shouldContinue: true
        };
        
        // Get the activeArrows array from the tower's metadata
        const activeArrows = this.mesh.metadata?.activeArrows || [];
        activeArrows.push(arrow);
        
        // Play sound
        this.game.getAssetManager().playSound('towerShoot');
        
        // Set up animation callback
        const animateArrow = () => {
            // If tower or arrow was disposed, stop animation
            if (!this.mesh || arrowMesh.isDisposed() || !arrow.shouldContinue) {
                // Arrow was disposed, stop animation
                return;
            }
            
            const deltaDistance = (speed * this.scene.getEngine().getDeltaTime()) / 1000;
            arrow.distance += deltaDistance;
            
            // Move arrow forward
            const newPos = startPosition.add(direction.scale(arrow.distance));
            arrowMesh.position = newPos;
            
            // Update the trail position
            if (trailSystem) {
                trailSystem.emitter = arrowMesh;
            }
            
            // If arrow reaches target or max distance
            if (arrow.distance >= maxDistance) {
                // Create impact effect at the final position
                this.createArrowImpactEffect(arrowMesh.position);
                
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
                
                // Stop and dispose the trail system
                if (trailSystem) {
                    trailSystem.stop();
                    trailSystem.dispose();
                }
                
                // Dispose arrow mesh
                arrowMesh.dispose();
                
                return;
            }
            
            // Continue animation
            requestAnimationFrame(animateArrow);
        };
        
        // Start animation
        animateArrow();
    }
} 