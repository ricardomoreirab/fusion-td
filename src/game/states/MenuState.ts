import { Vector3, MeshBuilder, StandardMaterial, Color3, Color4, ArcRotateCamera, ParticleSystem, Texture, Mesh, HemisphericLight, Scene } from '@babylonjs/core';
import { AdvancedDynamicTexture, Button, Control, TextBlock, Rectangle } from '@babylonjs/gui';
import { Game } from '../Game';
import { GameState } from './GameState';
import { PALETTE } from '../rendering/StyleConstants';
import { createLowPolyMaterial, makeFlatShaded } from '../rendering/LowPolyMaterial';

export class MenuState implements GameState {
    private game: Game;
    private ui: AdvancedDynamicTexture | null = null;
    private sceneObjects: Mesh[] = [];
    private particleSystems: ParticleSystem[] = [];
    private animationCallback: (() => void) | null = null;

    constructor(game: Game) {
        this.game = game;
    }

    public enter(): void {
        console.log('Entering menu state');

        // Create animated 3D background
        this.createBackground();

        // Create UI
        this.createUI();

        // Play background music
        this.game.getAssetManager().playSound('bgMusic');
    }

    public exit(): void {
        console.log('Exiting menu state');

        // Remove animation callback
        if (this.animationCallback) {
            this.game.getScene().unregisterBeforeRender(this.animationCallback);
            this.animationCallback = null;
        }

        // Dispose particle systems
        for (const ps of this.particleSystems) {
            ps.stop();
            ps.dispose();
        }
        this.particleSystems = [];

        // Dispose scene objects
        for (const mesh of this.sceneObjects) {
            mesh.dispose();
        }
        this.sceneObjects = [];

        // Dispose UI
        if (this.ui) {
            this.ui.dispose();
            this.ui = null;
        }
    }

    public update(deltaTime: number): void {
        // Background animation is handled via registerBeforeRender
    }

    private createBackground(): void {
        const scene = this.game.getScene();

        // Set up camera for menu view (orthographic)
        const camera = scene.activeCamera as ArcRotateCamera;
        if (camera) {
            camera.target = new Vector3(10, 0, 10);
            camera.alpha = Math.PI / 4;
            // Beta is locked by limits, no need to set it
            camera.metadata = { ...camera.metadata, orthoZoom: 15 };
            this.game.updateOrthoBounds();
        }

        // Create a ground plane with PALETTE.GROUND color
        const ground = MeshBuilder.CreateGround('menuGround', { width: 30, height: 30 }, scene);
        const groundMat = createLowPolyMaterial('menuGroundMat', PALETTE.GROUND, scene);
        ground.material = groundMat;
        ground.position = new Vector3(10, -0.1, 10);
        this.sceneObjects.push(ground);

        // Create sample tower (center piece) with flat shading
        const towerBase = MeshBuilder.CreateCylinder('menuTower', { height: 2.5, diameterTop: 0.8, diameterBottom: 1.2, tessellation: 8 }, scene);
        towerBase.position = new Vector3(10, 1.25, 10);
        const towerMat = createLowPolyMaterial('menuTowerMat', new Color3(0.5, 0.5, 0.5), scene);
        towerMat.emissiveColor = new Color3(0.1, 0.1, 0.1);
        towerBase.material = towerMat;
        makeFlatShaded(towerBase);
        this.sceneObjects.push(towerBase);

        // Tower top with flat shading
        const towerTop = MeshBuilder.CreateCylinder('menuTowerTop', { height: 0.5, diameterTop: 1.0, diameterBottom: 0.8, tessellation: 8 }, scene);
        towerTop.position = new Vector3(10, 2.75, 10);
        const topMat = createLowPolyMaterial('menuTowerTopMat', new Color3(0.7, 0.3, 0.1), scene);
        topMat.emissiveColor = new Color3(0.2, 0.05, 0);
        towerTop.material = topMat;
        makeFlatShaded(towerTop);
        this.sceneObjects.push(towerTop);

        // Create sample enemies walking in a circle using IcoSpheres
        const enemyColors = [
            new Color3(0.8, 0.2, 0.2), // Red (basic)
            new Color3(0.2, 0.5, 0.8), // Blue (fast)
            new Color3(0.6, 0.6, 0.6), // Gray (tank)
        ];

        const enemies: { mesh: Mesh, angle: number, speed: number, radius: number }[] = [];

        for (let i = 0; i < 6; i++) {
            const colorIdx = i % enemyColors.length;
            const size = colorIdx === 2 ? 0.7 : (colorIdx === 1 ? 0.4 : 0.5);
            const enemy = MeshBuilder.CreateIcoSphere(`menuEnemy${i}`, { radius: size / 2, subdivisions: 1 }, scene);
            const enemyMat = createLowPolyMaterial(`menuEnemyMat${i}`, enemyColors[colorIdx], scene);
            enemyMat.emissiveColor = enemyColors[colorIdx].scale(0.2);
            enemy.material = enemyMat;
            makeFlatShaded(enemy);

            const radius = 6 + Math.random() * 3;
            const startAngle = (i / 6) * Math.PI * 2;
            enemy.position = new Vector3(
                10 + Math.cos(startAngle) * radius,
                size / 2 + 0.1,
                10 + Math.sin(startAngle) * radius
            );

            this.sceneObjects.push(enemy);
            enemies.push({
                mesh: enemy,
                angle: startAngle,
                speed: 0.15 + Math.random() * 0.15,
                radius: radius
            });
        }

        // Create particle effects around the tower
        const towerParticles = new ParticleSystem('menuTowerParticles', 30, scene);
        towerParticles.particleTexture = new Texture('assets/textures/particle.png', scene);
        towerParticles.emitter = new Vector3(10, 3.0, 10);
        towerParticles.minEmitBox = new Vector3(-0.3, 0, -0.3);
        towerParticles.maxEmitBox = new Vector3(0.3, 0.5, 0.3);
        towerParticles.color1 = new Color4(1, 0.8, 0.2, 1);
        towerParticles.color2 = new Color4(1, 0.4, 0, 1);
        towerParticles.colorDead = new Color4(0.5, 0.1, 0, 0);
        towerParticles.minSize = 0.05;
        towerParticles.maxSize = 0.15;
        towerParticles.minLifeTime = 0.5;
        towerParticles.maxLifeTime = 1.5;
        towerParticles.emitRate = 15;
        towerParticles.direction1 = new Vector3(-0.2, 1, -0.2);
        towerParticles.direction2 = new Vector3(0.2, 2, 0.2);
        towerParticles.minEmitPower = 0.3;
        towerParticles.maxEmitPower = 0.8;
        towerParticles.blendMode = ParticleSystem.BLENDMODE_ONEONE;
        towerParticles.start();
        this.particleSystems.push(towerParticles);

        // Ambient ground particles
        const ambientParticles = new ParticleSystem('menuAmbient', 20, scene);
        ambientParticles.particleTexture = new Texture('assets/textures/particle.png', scene);
        ambientParticles.emitter = new Vector3(10, 0.5, 10);
        ambientParticles.minEmitBox = new Vector3(-12, 0, -12);
        ambientParticles.maxEmitBox = new Vector3(12, 0, 12);
        ambientParticles.color1 = new Color4(0.3, 0.8, 0.3, 0.5);
        ambientParticles.color2 = new Color4(0.2, 0.6, 0.2, 0.3);
        ambientParticles.colorDead = new Color4(0, 0.3, 0, 0);
        ambientParticles.minSize = 0.05;
        ambientParticles.maxSize = 0.1;
        ambientParticles.minLifeTime = 2;
        ambientParticles.maxLifeTime = 4;
        ambientParticles.emitRate = 5;
        ambientParticles.direction1 = new Vector3(0, 1, 0);
        ambientParticles.direction2 = new Vector3(0, 1.5, 0);
        ambientParticles.minEmitPower = 0.1;
        ambientParticles.maxEmitPower = 0.3;
        ambientParticles.blendMode = ParticleSystem.BLENDMODE_ONEONE;
        ambientParticles.start();
        this.particleSystems.push(ambientParticles);

        // Animate: rotate camera slowly and move enemies
        this.animationCallback = () => {
            // Slow camera rotation
            if (camera) {
                camera.alpha += 0.001;
            }

            // Move enemies in circle
            for (const enemy of enemies) {
                enemy.angle += enemy.speed * 0.016;
                enemy.mesh.position.x = 10 + Math.cos(enemy.angle) * enemy.radius;
                enemy.mesh.position.z = 10 + Math.sin(enemy.angle) * enemy.radius;

                // Bob up and down slightly
                enemy.mesh.position.y = (enemy.mesh.getBoundingInfo().boundingBox.extendSize.y) + 0.1 + Math.sin(enemy.angle * 3) * 0.1;
            }
        };
        scene.registerBeforeRender(this.animationCallback);
    }

    private createUI(): void {
        // Create fullscreen UI
        this.ui = AdvancedDynamicTexture.CreateFullscreenUI('menuUI', true, this.game.getScene());

        // Title "FUSION TD" at 80px, gold color, no subtitle
        const titleText = new TextBlock('titleText');
        titleText.text = 'FUSION TD';
        titleText.color = '#F5A623';
        titleText.fontSize = 80;
        titleText.top = '-200px';
        titleText.fontFamily = 'Arial';
        titleText.fontWeight = 'bold';
        titleText.shadowColor = 'rgba(0,0,0,0.8)';
        titleText.shadowBlur = 10;
        titleText.shadowOffsetX = 4;
        titleText.shadowOffsetY = 4;
        titleText.outlineWidth = 2;
        titleText.outlineColor = '#B8860B';
        this.ui.addControl(titleText);

        // START GAME button - pill shape, 280px wide, 60px tall
        const startButton = Button.CreateSimpleButton('startButton', 'START GAME');
        startButton.width = '280px';
        startButton.height = '60px';
        startButton.color = '#FFFFFF';
        startButton.background = '#4CAF50';
        startButton.cornerRadius = 32;
        startButton.thickness = 0;
        startButton.fontFamily = 'Arial';
        startButton.fontSize = 24;
        startButton.fontWeight = 'bold';
        startButton.top = '-20px';
        startButton.shadowColor = 'rgba(0, 0, 0, 0.5)';
        startButton.shadowBlur = 8;
        startButton.shadowOffsetY = 3;
        startButton.onPointerEnterObservable.add(() => {
            startButton.background = '#66BB6A';
            startButton.scaleX = 1.05;
            startButton.scaleY = 1.05;
        });
        startButton.onPointerOutObservable.add(() => {
            startButton.background = '#4CAF50';
            startButton.scaleX = 1.0;
            startButton.scaleY = 1.0;
        });
        startButton.onPointerUpObservable.add(() => {
            this.game.getStateManager().changeState('gameplay');
        });
        this.ui.addControl(startButton);

        // INSTRUCTIONS button - pill shape, 280px wide, 60px tall
        const instructionsButton = Button.CreateSimpleButton('instructionsButton', 'INSTRUCTIONS');
        instructionsButton.width = '280px';
        instructionsButton.height = '60px';
        instructionsButton.color = '#FFFFFF';
        instructionsButton.background = '#2196F3';
        instructionsButton.cornerRadius = 32;
        instructionsButton.thickness = 0;
        instructionsButton.fontFamily = 'Arial';
        instructionsButton.fontSize = 24;
        instructionsButton.fontWeight = 'bold';
        instructionsButton.top = '60px';
        instructionsButton.shadowColor = 'rgba(0, 0, 0, 0.5)';
        instructionsButton.shadowBlur = 8;
        instructionsButton.shadowOffsetY = 3;
        instructionsButton.onPointerEnterObservable.add(() => {
            instructionsButton.background = '#42A5F5';
            instructionsButton.scaleX = 1.05;
            instructionsButton.scaleY = 1.05;
        });
        instructionsButton.onPointerOutObservable.add(() => {
            instructionsButton.background = '#2196F3';
            instructionsButton.scaleX = 1.0;
            instructionsButton.scaleY = 1.0;
        });
        instructionsButton.onPointerUpObservable.add(() => {
            this.showInstructions();
        });
        this.ui.addControl(instructionsButton);
    }

    private showInstructions(): void {
        // Dark panel background
        const panel = new Rectangle();
        panel.width = '600px';
        panel.height = '400px';
        panel.cornerRadius = 12;
        panel.background = 'rgba(28, 32, 40, 0.95)';
        panel.thickness = 1;
        panel.color = '#3A3F4B';
        this.ui?.addControl(panel);

        // Title
        const titleText = new TextBlock('instructionsTitle');
        titleText.text = 'HOW TO PLAY';
        titleText.color = '#F5A623';
        titleText.fontSize = 28;
        titleText.fontWeight = 'bold';
        titleText.top = '-160px';
        titleText.fontFamily = 'Arial';
        panel.addControl(titleText);

        // Instructions text
        const instructionsText = new TextBlock('instructionsText');
        instructionsText.text =
            '1. Place towers on the map to defend against enemies\n\n' +
            '2. Enemies follow the path from the start to your base\n\n' +
            '3. Each enemy that reaches your base reduces your health\n\n' +
            '4. Destroy enemies to earn money for more towers\n\n' +
            '5. Upgrade towers to increase their power\n\n' +
            '6. Survive as many waves as you can!';
        instructionsText.color = '#B0B8C8';
        instructionsText.fontSize = 18;
        instructionsText.top = '0px';
        instructionsText.fontFamily = 'Arial';
        instructionsText.textWrapping = true;
        instructionsText.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        instructionsText.paddingLeft = '30px';
        instructionsText.paddingRight = '30px';
        panel.addControl(instructionsText);

        // Close button - pill shape
        const closeButton = Button.CreateSimpleButton('closeButton', 'CLOSE');
        closeButton.width = '200px';
        closeButton.height = '50px';
        closeButton.color = '#FFFFFF';
        closeButton.background = '#E53935';
        closeButton.cornerRadius = 32;
        closeButton.thickness = 0;
        closeButton.fontFamily = 'Arial';
        closeButton.fontSize = 20;
        closeButton.fontWeight = 'bold';
        closeButton.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
        closeButton.top = '-20px';
        closeButton.shadowColor = 'rgba(0, 0, 0, 0.4)';
        closeButton.shadowBlur = 5;
        closeButton.shadowOffsetY = 2;
        closeButton.onPointerEnterObservable.add(() => {
            closeButton.background = '#EF5350';
        });
        closeButton.onPointerOutObservable.add(() => {
            closeButton.background = '#E53935';
        });
        closeButton.onPointerUpObservable.add(() => {
            this.ui?.removeControl(panel);
        });
        panel.addControl(closeButton);
    }
}
