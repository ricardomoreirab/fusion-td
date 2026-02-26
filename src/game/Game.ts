import { Engine, Scene, Vector3, HemisphericLight, ArcRotateCamera, Color3, Color4, SceneLoader, Animation, AbstractMesh, GlowLayer } from '@babylonjs/core';
import { GameState } from './states/GameState';
import { MenuState } from './states/MenuState';
import { GameplayState } from './states/GameplayState';
import { GameOverState } from './states/GameOverState';
import { AssetManager } from './managers/AssetManager';
import { StateManager } from './managers/StateManager';
import { PauseScreen } from './ui/PauseScreen';
import { PALETTE } from './rendering/StyleConstants';

export class Game {
    private canvas: HTMLCanvasElement;
    private engine: Engine;
    private scene: Scene;
    private stateManager: StateManager;
    private assetManager: AssetManager;
    private _isPaused: boolean = false;
    private pauseScreen: PauseScreen;
    private _timeScale: number = 1;

    constructor(canvasId: string) {
        // Get the canvas element
        const element = document.getElementById(canvasId);
        if (!element) throw new Error(`Canvas element with id ${canvasId} not found`);
        if (!(element instanceof HTMLCanvasElement)) throw new Error(`Element with id ${canvasId} is not a canvas element`);
        
        this.canvas = element;

        // Initialize the Babylon engine
        this.engine = new Engine(this.canvas, true);
        
        // Create the main scene
        this.scene = new Scene(this.engine);
        this.scene.clearColor = PALETTE.SKY.clone();
        
        // Initialize managers
        this.assetManager = new AssetManager(this.scene);
        this.stateManager = new StateManager(this);
        
        // Register game states
        this.stateManager.registerState('menu', new MenuState(this));
        this.stateManager.registerState('gameplay', new GameplayState(this));
        this.stateManager.registerState('gameOver', new GameOverState(this));
        
        // Initialize pause screen
        this.pauseScreen = new PauseScreen(this);
    }

    public start(): void {
        // Setup the scene
        this.setupScene();
        
        // Start loading assets
        this.assetManager.loadAssets(() => {
            // Hide loading screen
            const loadingScreen = document.getElementById('loadingScreen');
            if (loadingScreen) {
                loadingScreen.style.display = 'none';
            }
            
            // Start with the menu state
            this.stateManager.changeState('menu');
            
            // Start the render loop
            this.engine.runRenderLoop(() => {
                // Update the current state
                this.stateManager.update(this.engine.getDeltaTime() / 1000);
                
                // Render the scene
                this.scene.render();
            });
        }, (progress: number) => {
            // Update loading progress
            const loadingBar = document.getElementById('loadingBar');
            if (loadingBar) {
                loadingBar.style.width = `${progress * 100}%`;
            }
        });
    }

    public resize(): void {
        this.engine.resize();
    }

    private setupScene(): void {
        // Warm hemisphere light for low-poly stylized look
        const light = new HemisphericLight('light', new Vector3(0, 1, 0), this.scene);
        light.diffuse = PALETTE.LIGHT_DIFFUSE.clone();
        light.groundColor = PALETTE.LIGHT_GROUND.clone();
        light.intensity = 0.65;

        // Linear fog matching sky color for atmospheric depth
        this.scene.fogMode = Scene.FOGMODE_LINEAR;
        this.scene.fogColor = PALETTE.FOG.clone();
        this.scene.fogStart = 40;
        this.scene.fogEnd = 80;

        // Glow layer for emissive elements (portals, tower effects)
        const glowLayer = new GlowLayer('glowLayer', this.scene);
        glowLayer.intensity = 0.4;

        // Isometric camera setup
        // True isometric: alpha=45° (PI/4), beta=35.264° (arctan(1/sqrt(2)) ≈ 0.6155 rad)
        const camera = new ArcRotateCamera(
            'camera',
            -Math.PI / 4,      // alpha: -45° for classic isometric angle
            0.62,              // beta: ~35.264° for true isometric elevation
            35,                // radius: tighter zoom for better detail
            new Vector3(19, 0, 19), // target: center of 20x20 grid (cells are 2 units)
            this.scene
        );

        // Camera limits tuned for isometric TD gameplay
        camera.lowerRadiusLimit = 20;  // Close enough to see detail
        camera.upperRadiusLimit = 55;  // Far enough to see whole map
        camera.lowerBetaLimit = 0.4;   // Prevent too-low angle (near horizontal)
        camera.upperBetaLimit = 1.2;   // Allow more top-down if player wants
        // No alpha limits - allow full rotation for strategy viewing

        // Attach controls
        camera.attachControl(this.canvas, true);

        // Control sensitivity tuned for TD gameplay
        camera.wheelPrecision = 35;
        camera.panningSensibility = 80;
        camera.angularSensibilityX = 500;
        camera.angularSensibilityY = 500;

        // Smooth camera with moderate inertia
        camera.inertia = 0.6;
        camera.checkCollisions = false;
        camera.useBouncingBehavior = true;

        // Disable auto-rotation (distracting during gameplay)
        camera.useAutoRotationBehavior = false;
    }

    /**
     * Clean up the scene by disposing all meshes and resources
     * This should be called when transitioning between states to ensure a clean slate
     */
    public cleanupScene(): void {
        // Dispose all meshes in the scene
        const meshes = this.scene.meshes.slice(); // Create a copy to avoid modification during iteration
        for (const mesh of meshes) {
            if (!mesh.name.includes('camera')) { // Don't dispose camera
                mesh.dispose(false, true); // dispose mesh and its children
            }
        }
        
        // Dispose all materials
        const materials = this.scene.materials.slice();
        for (const material of materials) {
            material.dispose();
        }
        
        // Dispose all textures
        const textures = this.scene.textures.slice();
        for (const texture of textures) {
            texture.dispose();
        }
        
        // Dispose all particle systems
        const particleSystems = this.scene.particleSystems.slice();
        for (const particleSystem of particleSystems) {
            particleSystem.dispose();
        }
        
        // Clear all animations
        this.scene.stopAllAnimations();
        
        // Clear all render observers
        this.scene.onBeforeRenderObservable.clear();
        this.scene.onAfterRenderObservable.clear();
        
        // Remove any scene metadata that might contain previous game state
        this.scene.metadata = {};
        
        // Clear all event listeners to prevent memory leaks
        this.scene.onPointerObservable.clear();
        this.scene.onKeyboardObservable.clear();
        
        // Find and dispose any AdvancedDynamicTexture manually
        // (They are not tracked by the scene automatically)
        const guiTextures = this.scene.textures.filter(texture => 
            texture.name && texture.name.indexOf("AdvancedDynamicTexture") !== -1);
        for (const texture of guiTextures) {
            texture.dispose();
        }
        
        // Stop any active sounds
        if (this.scene.audioEnabled) {
            this.scene.audioEnabled = false;
            this.scene.audioEnabled = true; // Reset audio
        }
        
        console.log("Scene thoroughly cleaned for state transition");
    }

    public pause(): void {
        if (this._isPaused) {
            console.log('Game already paused, ignoring pause request');
            return;
        }
        
        console.log('Pausing game');
        this._isPaused = true;
        
        // Freeze game objects first
        this.scene.freezeActiveMeshes();
        
        // Pause all animations and particles
        this.scene.meshes.forEach((mesh: AbstractMesh) => {
            if (mesh.animations) {
                mesh.animations.forEach((animation: Animation) => {
                    this.scene.stopAnimation(mesh);
                });
            }
        });
        
        this.scene.particleSystems.forEach(system => {
            system.stop();
        });
        
        // Keep rendering the scene for UI, but stop game updates
        console.log('Setting up UI-only render loop');
        this.engine.stopRenderLoop();
        
        // Create a new render loop that ONLY renders the scene without updates
        this.engine.runRenderLoop(() => {
            // Only render the scene, no game state updates
            this.scene.render();
        });
        
        // Show the pause screen last, after the render loop is set up
        try {
            if (this.pauseScreen) {
                console.log('Showing pause screen');
                this.pauseScreen.show();
                
                // Force a render to ensure the pause screen appears immediately
                this.scene.render();
            }
        } catch (error) {
            console.error("Error showing pause screen:", error);
        }
        
        // Dispatch a custom event that the game was paused
        const pauseEvent = new CustomEvent('gamePaused');
        document.dispatchEvent(pauseEvent);
    }

    public resume(): void {
        if (!this._isPaused) {
            console.log('Game not paused, ignoring resume request');
            return;
        }
        
        console.log('Resuming game');
        
        // Hide the pause screen first
        try {
            if (this.pauseScreen) {
                console.log('Hiding pause screen');
                this.pauseScreen.hide();
            }
        } catch (error) {
            console.error("Error hiding pause screen:", error);
        }
        
        this._isPaused = false;
        this.scene.unfreezeActiveMeshes();
        
        // Resume all animations and particles
        this.scene.meshes.forEach((mesh: AbstractMesh) => {
            if (mesh.animations) {
                mesh.animations.forEach((animation: Animation) => {
                    this.scene.beginAnimation(mesh, 0, Number.MAX_VALUE, true);
                });
            }
        });
        
        this.scene.particleSystems.forEach(system => {
            system.start();
        });
        
        // Restart the render loop with game updates
        console.log('Restarting full game render loop');
        this.engine.stopRenderLoop();
        
        // Create a new render loop that updates game state and renders
        this.engine.runRenderLoop(() => {
            if (!this._isPaused) {
                // Only update the state if not paused (double-check)
                this.stateManager.update(this.engine.getDeltaTime() / 1000);
            }
            
            // Always render the scene
            this.scene.render();
        });
        
        // Dispatch a custom event that the game was resumed
        const resumeEvent = new CustomEvent('gameResumed');
        document.dispatchEvent(resumeEvent);
    }

    public getIsPaused(): boolean {
        return this._isPaused;
    }

    // Getters for accessing game components
    public getScene(): Scene {
        return this.scene;
    }

    public getEngine(): Engine {
        return this.engine;
    }

    public getCanvas(): HTMLCanvasElement {
        return this.canvas;
    }

    public getStateManager(): StateManager {
        return this.stateManager;
    }

    public getAssetManager(): AssetManager {
        return this.assetManager;
    }

    public togglePause(): void {
        if (this._isPaused) {
            this.resume();
        } else {
            this.pause();
        }
    }

    public getTimeScale(): number {
        return this._timeScale;
    }

    public setTimeScale(scale: number): void {
        this._timeScale = Math.max(0.5, Math.min(3, scale));
    }
} 