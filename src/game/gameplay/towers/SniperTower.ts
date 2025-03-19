import { Vector3, MeshBuilder, StandardMaterial, Color3, Mesh, Space, ParticleSystem, Texture, TrailMesh, PointLight } from '@babylonjs/core';
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
            height: 0.4,
            diameter: 2.0,
            tessellation: 24
        }, this.scene);
        base.position = new Vector3(0, 0.2, 0);
        
        // Add decorative patterns to the stone base
        const basePattern = MeshBuilder.CreateTorus('basePattern', {
            diameter: 1.9,
            thickness: 0.05,
            tessellation: 48
        }, this.scene);
        basePattern.position = new Vector3(0, 0.1, 0);
        basePattern.rotation.x = Math.PI / 2;
        
        // Create a second decorative pattern
        const basePattern2 = MeshBuilder.CreateTorus('basePattern2', {
            diameter: 1.9,
            thickness: 0.05,
            tessellation: 48
        }, this.scene);
        basePattern2.position = new Vector3(0, 0.3, 0);
        basePattern2.rotation.x = Math.PI / 2;
        
        // Create corner stones at the base for added detail
        const createCornerStone = (angle: number) => {
            const stone = MeshBuilder.CreateBox(`cornerStone${angle}`, {
                width: 0.25,
                height: 0.5,
                depth: 0.25
            }, this.scene);
            const x = Math.cos(angle) * 0.9;
            const z = Math.sin(angle) * 0.9;
            stone.position = new Vector3(x, 0.23, z);
            stone.rotation.y = angle;
            stone.parent = this.mesh;
            return stone;
        };
        
        const cornerStones = [];
        for (let i = 0; i < 4; i++) {
            const angle = (i / 4) * Math.PI * 2;
            cornerStones.push(createCornerStone(angle));
        }
        
        // Create a wooden platform
        const platform = MeshBuilder.CreateCylinder('sniperPlatform', {
            height: 0.25,
            diameter: 1.8,
            tessellation: 16
        }, this.scene);
        platform.position = new Vector3(0, 0.425, 0);
        
        // Create archer's platform
        const archerStand = MeshBuilder.CreateCylinder('archerStand', {
            height: 0.5,
            diameter: 0.9,
            tessellation: 12
        }, this.scene);
        archerStand.position = new Vector3(0, 0.7, 0);
        
        // Create decorative supports
        const supports = [];
        for (let i = 0; i < 4; i++) {
            const angle = (i / 4) * Math.PI * 2;
            const x = Math.cos(angle) * 0.8;
            const z = Math.sin(angle) * 0.8;
            
            const support = MeshBuilder.CreateBox(`support${i}`, {
                width: 0.12,
                height: 0.5,
                depth: 0.12
            }, this.scene);
            support.position = new Vector3(x, 0.6, z);
            support.rotation.y = angle;
            supports.push(support);
        }
        
        // Create the archer figure
        const archerBody = new Mesh("archerBody", this.scene);
        archerBody.position = new Vector3(0, 1.1, 0);
        
        // Archer's torso
        const torso = MeshBuilder.CreateBox('archerTorso', {
            width: 0.18,
            height: 0.25,
            depth: 0.12
        }, this.scene);
        torso.position = new Vector3(0, 0, 0);
        torso.parent = archerBody;
        
        // Archer's legs - add stance to show archer is ready to fire
        const leftLeg = MeshBuilder.CreateBox('leftLeg', {
            width: 0.06,
            height: 0.18,
            depth: 0.06
        }, this.scene);
        leftLeg.position = new Vector3(-0.06, -0.21, 0);
        leftLeg.parent = archerBody;
        
        const rightLeg = MeshBuilder.CreateBox('rightLeg', {
            width: 0.06,
            height: 0.18,
            depth: 0.06
        }, this.scene);
        rightLeg.position = new Vector3(0.06, -0.21, 0);
        rightLeg.rotation.x = -Math.PI / 8; // Slight stance
        rightLeg.parent = archerBody;
        
        // Archer's head
        const head = MeshBuilder.CreateSphere('archerHead', {
            diameter: 0.12,
            segments: 8
        }, this.scene);
        head.position = new Vector3(0, 0.19, 0);
        head.parent = archerBody;
        
        // Medieval hood
        const hood = MeshBuilder.CreateCylinder('archerHood', {
            height: 0.1,
            diameter: 0.13,
            diameterTop: 0.08,
            tessellation: 8
        }, this.scene);
        hood.position = new Vector3(0, 0.22, 0);
        hood.parent = archerBody;
        
        // Archer's arms positioned for drawing a bow
        const leftArm = MeshBuilder.CreateBox('leftArm', {
            width: 0.22,
            height: 0.06,
            depth: 0.06
        }, this.scene);
        leftArm.position = new Vector3(-0.15, 0.06, 0.12);
        leftArm.rotation.y = Math.PI / 6; // Angle forward
        leftArm.parent = archerBody;
        
        const rightArm = MeshBuilder.CreateBox('rightArm', {
            width: 0.22,
            height: 0.06,
            depth: 0.06
        }, this.scene);
        rightArm.position = new Vector3(0.15, 0.06, 0.12);
        rightArm.rotation.y = -Math.PI / 6; // Angle forward
        rightArm.parent = archerBody;
        
        // Create the longbow - SIGNIFICANTLY LARGER
        const longbow = new Mesh("longbow", this.scene);
        longbow.position = new Vector3(0, 0.06, 0.25);
        longbow.parent = archerBody;
        
        // Create a much larger curved bow
        const bowCurvePoints = [];
        for (let i = 0; i < 20; i++) {
            const y = (i / 19) * 0.8 - 0.4; // Larger height
            const x = Math.sin(y * Math.PI * 1.2) * 0.15; // More curve
            bowCurvePoints.push(new Vector3(x, y, 0));
        }
        
        // Bow stave (main part) - thicker and more prominent
        for (let i = 0; i < bowCurvePoints.length - 1; i++) {
            const segment = MeshBuilder.CreateCylinder(`bowSegment${i}`, {
                height: Vector3.Distance(bowCurvePoints[i], bowCurvePoints[i+1]),
                diameter: 0.03, // Thicker
                tessellation: 8
            }, this.scene);
            
            const midPoint = bowCurvePoints[i].add(bowCurvePoints[i+1]).scale(0.5);
            segment.position = midPoint;
            
            const direction = bowCurvePoints[i+1].subtract(bowCurvePoints[i]);
            const upVector = new Vector3(0, 1, 0);
            const rotationAxis = Vector3.Cross(upVector, direction.normalize());
            let angle = Math.acos(Vector3.Dot(upVector, direction.normalize()));
            
            if (!isNaN(angle)) {
                segment.rotationQuaternion = null;
                segment.rotate(rotationAxis, angle, Space.WORLD);
            }
            
            segment.parent = longbow;
        }
        
        // Bow string - taut, showing it's ready to fire
        const string = MeshBuilder.CreateCylinder('bowString', {
            height: 0.75, // Longer
            diameter: 0.01,
            tessellation: 6
        }, this.scene);
        string.position = new Vector3(0.12, 0, 0); // Further back to show tension
        string.parent = longbow;
        
        // Add decorative wrappings at grip and tips of bow
        const grip = MeshBuilder.CreateCylinder('bowGrip', {
            height: 0.1,
            diameter: 0.035,
            tessellation: 8
        }, this.scene);
        grip.position = new Vector3(0, 0, 0);
        grip.parent = longbow;
        
        const topTip = MeshBuilder.CreateCylinder('bowTopTip', {
            height: 0.06,
            diameter: 0.03,
            tessellation: 8
        }, this.scene);
        topTip.position = new Vector3(0.14, 0.36, 0);
        topTip.rotation.z = Math.PI/6;
        topTip.parent = longbow;
        
        const bottomTip = MeshBuilder.CreateCylinder('bowBottomTip', {
            height: 0.06,
            diameter: 0.03,
            tessellation: 8
        }, this.scene);
        bottomTip.position = new Vector3(0.14, -0.36, 0);
        bottomTip.rotation.z = -Math.PI/6;
        bottomTip.parent = longbow;
        
        // Create a nocked arrow ready to fire
        const readyArrow = this.createArrowMesh("readyArrow");
        readyArrow.scaling = new Vector3(1.0, 1.0, 1.0);
        readyArrow.rotation = new Vector3(0, -Math.PI / 2, 0);
        readyArrow.position = new Vector3(0.12, 0, 0);
        readyArrow.parent = longbow;
        
        // Create quiver with arrows
        const quiver = MeshBuilder.CreateCylinder('quiver', {
            height: 0.3,
            diameter: 0.1,
            tessellation: 10
        }, this.scene);
        quiver.position = new Vector3(-0.1, -0.06, -0.12);
        quiver.rotation.x = Math.PI / 3;
        quiver.rotation.z = Math.PI / 6;
        quiver.parent = archerBody;
        
        // Add arrows in quiver
        for (let i = 0; i < 5; i++) {
            const quiverArrow = MeshBuilder.CreateCylinder(`quiverArrow${i}`, {
                height: 0.25,
                diameter: 0.012,
                tessellation: 6
            }, this.scene);
            
            const angle = (i / 5) * Math.PI * 0.5 - Math.PI * 0.25;
            const radius = 0.025 + Math.random() * 0.012;
            const x = Math.sin(angle) * radius;
            const z = Math.cos(angle) * radius;
            
            quiverArrow.position = new Vector3(x, 0.1, z - 0.18);
            quiverArrow.rotation.x = Math.PI / 3;
            quiverArrow.rotation.z = Math.PI / 6 + (Math.random() - 0.5) * 0.1;
            quiverArrow.parent = archerBody;
            
            // Create arrowhead
            const arrowHead = MeshBuilder.CreateCylinder(`quiverArrowHead${i}`, {
                height: 0.06,
                diameterTop: 0,
                diameterBottom: 0.025,
                tessellation: 8
            }, this.scene);
            arrowHead.position = new Vector3(0, 0.15, 0);
            arrowHead.parent = quiverArrow;
        }
        
        // Materials
        const stoneMaterial = new StandardMaterial('sniperStoneMaterial', this.scene);
        stoneMaterial.diffuseColor = new Color3(0.7, 0.7, 0.7); // Lighter gray stone
        stoneMaterial.specularColor = new Color3(0.3, 0.3, 0.3);
        base.material = stoneMaterial;
        
        const stonePatternMaterial = new StandardMaterial('stonePatternMaterial', this.scene);
        stonePatternMaterial.diffuseColor = new Color3(0.8, 0.8, 0.8); // Even lighter for pattern
        stonePatternMaterial.specularColor = new Color3(0.4, 0.4, 0.4);
        basePattern.material = stonePatternMaterial;
        basePattern2.material = stonePatternMaterial;
        
        for (const stone of cornerStones) {
            stone.material = stoneMaterial;
        }
        
        const woodMaterial = new StandardMaterial('sniperWoodMaterial', this.scene);
        woodMaterial.diffuseColor = new Color3(0.5, 0.35, 0.2);
        platform.material = woodMaterial;
        archerStand.material = woodMaterial;
        
        for (const support of supports) {
            support.material = woodMaterial;
        }
        
        const archerBodyMaterial = new StandardMaterial('archerBodyMaterial', this.scene);
        archerBodyMaterial.diffuseColor = new Color3(0.3, 0.3, 0.4); // Dark uniform
        torso.material = archerBodyMaterial;
        leftLeg.material = archerBodyMaterial;
        rightLeg.material = archerBodyMaterial;
        
        const skinMaterial = new StandardMaterial('archerSkinMaterial', this.scene);
        skinMaterial.diffuseColor = new Color3(0.8, 0.6, 0.5);
        head.material = skinMaterial;
        
        const clothMaterial = new StandardMaterial('archerClothMaterial', this.scene);
        clothMaterial.diffuseColor = new Color3(0.3, 0.25, 0.2);
        leftArm.material = clothMaterial;
        rightArm.material = clothMaterial;
        
        const hoodMaterial = new StandardMaterial('hoodMaterial', this.scene);
        hoodMaterial.diffuseColor = new Color3(0.25, 0.15, 0.1); // Darker leather hood
        hood.material = hoodMaterial;
        
        const bowMaterial = new StandardMaterial('bowMaterial', this.scene);
        bowMaterial.diffuseColor = new Color3(0.35, 0.2, 0.1);
        bowMaterial.specularColor = new Color3(0.2, 0.2, 0.2);
        
        longbow.getChildMeshes().forEach(mesh => {
            if (mesh.name.startsWith('bowSegment')) {
                mesh.material = bowMaterial;
            }
        });
        
        const stringMaterial = new StandardMaterial('stringMaterial', this.scene);
        stringMaterial.diffuseColor = new Color3(0.9, 0.9, 0.8);
        string.material = stringMaterial;
        
        const tipMaterial = new StandardMaterial('tipMaterial', this.scene);
        tipMaterial.diffuseColor = new Color3(0.8, 0.7, 0.5); // Lighter wood or bone
        topTip.material = tipMaterial;
        bottomTip.material = tipMaterial;
        
        const gripMaterial = new StandardMaterial('gripMaterial', this.scene);
        gripMaterial.diffuseColor = new Color3(0.6, 0.3, 0.2); // Red leather
        grip.material = gripMaterial;
        
        const quiverMaterial = new StandardMaterial('quiverMaterial', this.scene);
        quiverMaterial.diffuseColor = new Color3(0.4, 0.15, 0.1);
        quiver.material = quiverMaterial;
        
        // Parent all parts
        base.parent = this.mesh;
        basePattern.parent = this.mesh;
        basePattern2.parent = this.mesh;
        platform.parent = this.mesh;
        archerStand.parent = this.mesh;
        
        for (const support of supports) {
            support.parent = this.mesh;
        }
        
        // Create a turret group for rotation
        const turret = new Mesh("sniperTurret", this.scene);
        turret.position = new Vector3(0, 0, 0);
        turret.parent = this.mesh;
        
        // Parent archer to the turret for rotation
        archerBody.parent = turret;
        
        // Track active arrows for animation and disposal
        const activeArrows: { mesh: Mesh, trail: ParticleSystem | null, distance: number, maxDistance: number, targetEnemy: any, targetPosition: Vector3, direction: Vector3, shouldContinue: boolean }[] = [];
        
        // Store reference in mesh metadata for cleanup
        this.mesh.metadata = { activeArrows };
    }
    
    /**
     * Create an arrow mesh
     */
    private createArrowMesh(name: string): Mesh {
        const arrow = new Mesh(name, this.scene);
        
        // Arrow shaft - longer, suitable for a longbow
        const shaft = MeshBuilder.CreateCylinder('shaft', {
            height: 1.8,
            diameter: 0.025,
            tessellation: 10
        }, this.scene);
        shaft.rotation.x = Math.PI / 2; // Horizontal
        shaft.position = new Vector3(0, 0, 0);
        
        // Arrow head - more defined, armor-piercing style
        const head = MeshBuilder.CreateCylinder('head', {
            height: 0.35,
            diameterTop: 0.0,
            diameterBottom: 0.08,
            tessellation: 10
        }, this.scene);
        head.rotation.x = -Math.PI / 2; // Point forward
        head.position = new Vector3(0, 0, 0.9);
        
        // Middle collar at the head connection
        const collar = MeshBuilder.CreateCylinder('collar', {
            height: 0.05,
            diameter: 0.04,
            tessellation: 10
        }, this.scene);
        collar.position = new Vector3(0, 0, 0.7);
        collar.rotation.x = Math.PI / 2;
        
        // Create detailed arrow fletching
        // Base piece to attach fletching to
        const fletchingBase = MeshBuilder.CreateCylinder('fletchingBase', {
            height: 0.1,
            diameter: 0.03,
            tessellation: 10
        }, this.scene);
        fletchingBase.rotation.x = Math.PI / 2;
        fletchingBase.position = new Vector3(0, 0, -0.7);
        
        // Create angled fletching pieces (more 3D than simple planes)
        for (let i = 0; i < 3; i++) {
            const angle = (i / 3) * Math.PI * 2;
            
            // Create a more detailed curved feather shape
            const points = [];
            for (let j = 0; j < 10; j++) {
                const z = (j / 9) * 0.5;
                const height = 0.02 + Math.sin(j / 9 * Math.PI) * 0.12;
                points.push(new Vector3(0, height, -z - 0.5));
            }
            
            // Create a custom shape for the fletching
            const feather = MeshBuilder.CreateRibbon('feather' + i, {
                pathArray: [
                    points, 
                    points.map(p => new Vector3(0.01, p.y * 0.9, p.z))
                ],
                closeArray: false,
                closePath: false
            }, this.scene);
            
            feather.rotation.x = Math.PI / 2;
            feather.rotation.y = angle;
            feather.parent = arrow;
        }
        
        // Nock at the end of the arrow
        const nock = MeshBuilder.CreateCylinder('nock', {
            height: 0.07,
            diameterTop: 0.035,
            diameterBottom: 0.03,
            tessellation: 10
        }, this.scene);
        nock.rotation.x = Math.PI / 2;
        nock.position = new Vector3(0, 0, -0.85);
        
        // Create a small slit in the nock for the bowstring
        const nockSlit = MeshBuilder.CreateBox('nockSlit', {
            width: 0.01,
            height: 0.04,
            depth: 0.03
        }, this.scene);
        nockSlit.position = new Vector3(0, 0, -0.9);
        
        // Materials
        const shaftMaterial = new StandardMaterial('shaftMaterial', this.scene);
        shaftMaterial.diffuseColor = new Color3(0.7, 0.5, 0.3); // Wood color
        shaft.material = shaftMaterial;
        
        const headMaterial = new StandardMaterial('headMaterial', this.scene);
        headMaterial.diffuseColor = new Color3(0.6, 0.6, 0.6); // Metal color
        headMaterial.specularColor = new Color3(0.8, 0.8, 0.8);
        headMaterial.specularPower = 64;
        head.material = headMaterial;
        
        const collarMaterial = new StandardMaterial('collarMaterial', this.scene);
        collarMaterial.diffuseColor = new Color3(0.4, 0.4, 0.4); // Darker metal
        collar.material = collarMaterial;
        
        const fletchingMaterial = new StandardMaterial('fletchingMaterial', this.scene);
        fletchingMaterial.diffuseColor = new Color3(0.8, 0.2, 0.2); // Bright red feathers
        fletchingBase.material = fletchingMaterial;
        
        arrow.getChildMeshes().forEach(mesh => {
            if (mesh.name.startsWith('feather')) {
                mesh.material = fletchingMaterial;
            }
        });
        
        const nockMaterial = new StandardMaterial('nockMaterial', this.scene);
        nockMaterial.diffuseColor = new Color3(0.1, 0.1, 0.1); // Dark wood/bone
        nock.material = nockMaterial;
        
        const nockSlitMaterial = new StandardMaterial('nockSlitMaterial', this.scene);
        nockSlitMaterial.diffuseColor = new Color3(0.05, 0.05, 0.05); // Almost black
        nockSlit.material = nockSlitMaterial;
        
        // Parent all parts
        shaft.parent = arrow;
        head.parent = arrow;
        collar.parent = arrow;
        fletchingBase.parent = arrow;
        nock.parent = arrow;
        nockSlit.parent = arrow;
        
        return arrow;
    }
    
    /**
     * Create a trail effect for arrows
     */
    private createArrowTrail(arrow: Mesh): ParticleSystem {
        // Create a particle system for the arrow trail
        const particleSystem = new ParticleSystem("arrowTrail", 120, this.scene);
        
        // Set particle texture
        particleSystem.particleTexture = new Texture("assets/textures/particle.png", this.scene);
        
        // Particles follow the arrow
        particleSystem.emitter = arrow;
        particleSystem.minEmitBox = new Vector3(-0.02, -0.02, -0.7); // Behind the arrow
        particleSystem.maxEmitBox = new Vector3(0.02, 0.02, -0.3);
        
        // Particle colors - vibrant red for sniper with slight smoke
        particleSystem.color1 = new Color3(0.9, 0.2, 0.2).toColor4(0.8);
        particleSystem.color2 = new Color3(0.7, 0.1, 0.1).toColor4(0.6);
        particleSystem.colorDead = new Color3(0.3, 0.3, 0.3).toColor4(0);
        
        particleSystem.minSize = 0.05;
        particleSystem.maxSize = 0.12;
        
        particleSystem.minLifeTime = 0.1;
        particleSystem.maxLifeTime = 0.3;
        
        particleSystem.emitRate = 150;
        
        particleSystem.blendMode = ParticleSystem.BLENDMODE_ONEONE;
        
        particleSystem.gravity = new Vector3(0, 0, 0);
        
        particleSystem.direction1 = new Vector3(0, 0, -1);
        particleSystem.direction2 = new Vector3(0, 0, -1);
        
        particleSystem.minEmitPower = 0.2;
        particleSystem.maxEmitPower = 0.5;
        
        particleSystem.updateSpeed = 0.01;
        
        // Start the particle system
        particleSystem.start();
        
        return particleSystem;
    }
    
    /**
     * Create impact effect for arrows
     */
    private createArrowImpactEffect(position: Vector3): void {
        // Create impact particles - a more dramatic effect
        const particleSystem = new ParticleSystem("sniperImpact", 100, this.scene);
        
        // Set particle texture and properties
        particleSystem.particleTexture = new Texture("assets/textures/particle.png", this.scene);
        particleSystem.emitter = position;
        particleSystem.minEmitBox = new Vector3(-0.1, -0.1, -0.1);
        particleSystem.maxEmitBox = new Vector3(0.1, 0.1, 0.1);
        
        // Vibrant red particles with smoke
        particleSystem.color1 = new Color3(1.0, 0.2, 0.2).toColor4(1.0);
        particleSystem.color2 = new Color3(0.7, 0.1, 0.1).toColor4(0.8);
        particleSystem.colorDead = new Color3(0.5, 0.0, 0.0).toColor4(0.0);
        
        particleSystem.minSize = 0.05;
        particleSystem.maxSize = 0.2;
        
        particleSystem.minLifeTime = 0.15;
        particleSystem.maxLifeTime = 0.4;
        
        particleSystem.emitRate = 300;
        
        particleSystem.blendMode = ParticleSystem.BLENDMODE_ONEONE;
        
        particleSystem.direction1 = new Vector3(-2, -2, -2);
        particleSystem.direction2 = new Vector3(2, 2, 2);
        
        particleSystem.minEmitPower = 1.5;
        particleSystem.maxEmitPower = 3.5;
        
        particleSystem.updateSpeed = 0.01;
        particleSystem.gravity = new Vector3(0, -4, 0);
        
        // Start and then clean up
        particleSystem.start();
        setTimeout(() => {
            particleSystem.stop();
            setTimeout(() => {
                particleSystem.dispose();
            }, 600);
        }, 150);
        
        // Create a brief flash at impact point
        const flash = MeshBuilder.CreateSphere("impactFlash", {
            diameter: 0.5,
            segments: 8
        }, this.scene);
        
        flash.position = position.clone();
        
        const flashMaterial = new StandardMaterial("flashMaterial", this.scene);
        flashMaterial.diffuseColor = new Color3(1.0, 0.4, 0.2);
        flashMaterial.emissiveColor = new Color3(1.0, 0.2, 0.1);
        flashMaterial.alpha = 0.7;
        flash.material = flashMaterial;
        
        // Animate flash
        let flashTime = 0;
        const animateFlash = () => {
            flashTime += this.scene.getEngine().getDeltaTime() / 1000;
            if (flashTime < 0.15) {
                const scale = 1.0 - (flashTime / 0.15);
                flash.scaling.setAll(scale);
                requestAnimationFrame(animateFlash);
            } else {
                flash.dispose();
            }
        };
        animateFlash();
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
        
        // Position the arrow at the archer's bow
        const bowPosition = this.mesh.position.clone();
        bowPosition.y += 1.1; // Archer's height (adjusted for larger size)
        
        // Add slight offset for the bow's position
        const startPosition = new Vector3(
            bowPosition.x,
            bowPosition.y + 0.06,
            bowPosition.z + 0.25
        );
        
        arrowMesh.position = startPosition;
        
        // Calculate direction to target with slight arc
        const direction = targetPosition.subtract(startPosition).normalize();
        
        // Add a slight upward component to create an arc
        const arcDirection = new Vector3(
            direction.x,
            direction.y + 0.1, // Add upward component
            direction.z
        ).normalize();
        
        // Aim the arrow
        arrowMesh.lookAt(startPosition.add(arcDirection.scale(5)));
        
        // Create the trail effect for the arrow
        const trailSystem = this.createArrowTrail(arrowMesh);
        
        // Animation parameters
        const speed = 45; // units per second (faster for sniper)
        const maxDistance = Vector3.Distance(startPosition, targetPosition) * 1.3; // Allow for arc
        
        // Add light to arrow for visual effect
        const arrowLight = new PointLight("arrowLight", startPosition, this.scene);
        arrowLight.diffuse = new Color3(1, 0.2, 0.2);
        arrowLight.intensity = 0.5;
        arrowLight.range = 5;
        
        // Create an arrow object to track in the animation
        const arrow = {
            mesh: arrowMesh,
            distance: 0,
            maxDistance: maxDistance,
            targetEnemy: this.targetEnemy,
            targetPosition: targetPosition.clone(),
            direction: arcDirection,
            trail: trailSystem,
            light: arrowLight,
            shouldContinue: true,
            hasHit: false,
            timeElapsed: 0
        };
        
        // Get the activeArrows array from the tower's metadata
        const activeArrows = this.mesh.metadata?.activeArrows || [];
        activeArrows.push(arrow);
        
        // Play sound
        this.game.getAssetManager().playSound('towerShoot');
        
        // Animate the archer drawing and releasing the bow
        // Get all child meshes of this tower
        const towerParts = this.mesh.getChildMeshes();
        
        // Find archer body in this tower's hierarchy
        const archerBody = towerParts.find(mesh => mesh.name.includes("archerBody"));
        if (archerBody) {
            // Find the longbow among the archer's children
            let longbow = null;
            archerBody.getChildMeshes().forEach(mesh => {
                if (mesh.name === "longbow") {
                    longbow = mesh;
                }
            });
            
            if (longbow) {
                // Make archer face the target
                const targetDirection = new Vector3(
                    targetPosition.x - this.mesh.position.x,
                    0, // Keep on horizontal plane
                    targetPosition.z - this.mesh.position.z
                ).normalize();
                
                // Calculate angle to target
                const forward = new Vector3(0, 0, 1);
                let targetAngle = Math.atan2(targetDirection.x, targetDirection.z);
                
                // Rotate the archer turret to face target
                const turret = towerParts.find(mesh => mesh.name.includes("sniperTurret"));
                if (turret) {
                    turret.rotation.y = targetAngle;
                }
            }
        }
        
        // Set up animation callback
        const animateArrow = () => {
            // If tower or arrow was disposed, stop animation
            if (!this.mesh || arrowMesh.isDisposed() || !arrow.shouldContinue) {
                // Arrow was disposed, stop animation
                if (arrowLight) {
                    arrowLight.dispose();
                }
                return;
            }
            
            const deltaTime = this.scene.getEngine().getDeltaTime() / 1000;
            arrow.timeElapsed += deltaTime;
            
            // Calculate current arc height - peak at middle of flight, then descend
            const arcHeight = Math.sin(Math.min(arrow.timeElapsed * 1.5, Math.PI)) * 1.5;
            
            // Calculate movement with arc
            const deltaDistance = (45 * deltaTime); // Use a fixed speed value instead of arrow.speed
            arrow.distance += deltaDistance;
            
            // Calculate position along arc
            const straightPos = this.position.add(arcDirection.scale(arrow.distance));
            const arcVector = new Vector3(0, arcHeight, 0);
            const flightProgress = Math.min(arrow.distance / arrow.maxDistance, 1);
            const arcScale = Math.sin(flightProgress * Math.PI);
            
            // Apply arc to position
            const newPos = straightPos.add(arcVector.scale(arcScale));
            arrowMesh.position = newPos;
            
            // Update arrow rotation to follow arc
            if (flightProgress < 0.9) {
                // Calculate new direction based on current position and next position
                const nextPos = straightPos.add(arcDirection.scale(arrow.distance + deltaDistance))
                    .add(arcVector.scale(Math.sin((flightProgress + deltaDistance/arrow.maxDistance) * Math.PI)));
                const currentDirection = nextPos.subtract(newPos).normalize();
                arrowMesh.lookAt(newPos.add(currentDirection.scale(1)));
            } else {
                // In final approach, aim directly at target
                arrowMesh.lookAt(targetPosition);
            }
            
            // Update the light position
            if (arrowLight) {
                arrowLight.position = newPos;
            }
            
            // If arrow reaches target or max distance
            if (arrow.distance >= arrow.maxDistance || 
                (arrow.targetEnemy && Vector3.Distance(arrowMesh.position, arrow.targetEnemy.getPosition()) < 0.5)) {
                
                // Get final position - either the target position or where the arrow ended
                const finalPosition = arrow.targetEnemy && arrow.targetEnemy.isAlive() ? 
                    arrow.targetEnemy.getPosition() : arrowMesh.position;
                
                // Create impact effect at the final position
                this.createArrowImpactEffect(finalPosition);
                
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
                if (arrow.trail) {
                    arrow.trail.stop();
                    setTimeout(() => {
                        arrow.trail.dispose();
                    }, 300);
                }
                
                // Dispose the light
                if (arrowLight) {
                    arrowLight.dispose();
                }
                
                // Embed arrow in target if it hit
                if (arrow.targetEnemy && arrow.targetEnemy.isAlive()) {
                    // Keep arrow in enemy for a moment before disposing
                    const enemyPosition = arrow.targetEnemy.getPosition();
                    arrowMesh.position = enemyPosition;
                    
                    // Make it stick out of the enemy at an angle
                    const randomAngle = Math.random() * Math.PI * 0.2 - Math.PI * 0.1;
                    arrowMesh.rotation.y += randomAngle;
                    arrowMesh.rotation.x = -Math.PI * 0.3 + (Math.random() * 0.2 - 0.1);
                    
                    // Leave arrow in for half a second then dispose
                    setTimeout(() => {
                        arrowMesh.dispose();
                    }, 500);
                } else {
                    // Dispose arrow mesh immediately if no hit
                    arrowMesh.dispose();
                }
                
                return;
            }
            
            // Continue animation
            requestAnimationFrame(animateArrow);
        };
        
        // Start animation
        animateArrow();
    }

    /**
     * Update tower visuals after upgrade
     */
    protected updateVisuals(): void {
        if (!this.mesh) return;
        
        // Get all child meshes of this tower
        const towerParts = this.mesh.getChildMeshes();
        
        // Find and update the archer body
        const archerBody = towerParts.find(mesh => mesh.name.includes("archerBody"));
        if (archerBody) {
            // Scale up slightly based on level
            const scale = 1 + (this.level - 1) * 0.08;
            archerBody.scaling.setAll(scale);
            
            // Make it more detailed with higher levels by updating materials
            archerBody.getChildMeshes().forEach(part => {
                if (part.material) {
                    const material = part.material as StandardMaterial;
                    // Enhance colors based on level
                    if (material.diffuseColor) {
                        // Make colors more vibrant at higher levels
                        material.specularColor = new Color3(
                            Math.min(0.8, 0.3 + (this.level - 1) * 0.1),
                            Math.min(0.8, 0.3 + (this.level - 1) * 0.1),
                            Math.min(0.8, 0.3 + (this.level - 1) * 0.1)
                        );
                    }
                }
            });
        }
        
        // Find and update the turret
        const turret = towerParts.find(mesh => mesh.name.includes("sniperTurret"));
        if (turret) {
            // Update turret colors based on level
            turret.getChildMeshes().forEach(part => {
                if (part.material) {
                    const material = part.material as StandardMaterial;
                    if (material.diffuseColor) {
                        // Make it look more powerful with each level
                        material.emissiveColor = new Color3(
                            0.05 * this.level,
                            0.01 * this.level,
                            0
                        );
                    }
                }
            });
        }
        
        // Update range indicator if showing
        if (this.showingRange && this.rangeIndicator) {
            this.hideRangeIndicator();
            this.showRangeIndicator();
        }
    }
} 