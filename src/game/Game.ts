import { Engine, Scene, Vector3, HemisphericLight, ArcRotateCamera, Color4, SceneLoader, Animation, AbstractMesh } from '@babylonjs/core';
import { GameState } from './states/GameState';
import { MenuState } from './states/MenuState';
import { GameplayState } from './states/GameplayState';
import { GameOverState } from './states/GameOverState';
import { AssetManager } from './managers/AssetManager';
import { StateManager } from './managers/StateManager';
import { PauseScreen } from './ui/PauseScreen';

export class Game {
    private canvas: HTMLCanvasElement;
    private engine: Engine;
    private scene: Scene;
    private stateManager: StateManager;
    private assetManager: AssetManager;
    private _isPaused: boolean = false;
    private pauseScreen: PauseScreen;

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
        this.scene.clearColor = new Color4(0.1, 0.1, 0.1, 1);
        
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
        // Create a basic light
        const light = new HemisphericLight('light', new Vector3(0, 1, 0), this.scene);
        light.intensity = 0.7;
        
        // Create an arc rotate camera with more top-down view
        const camera = new ArcRotateCamera(
            'camera',          // name
            Math.PI / 4,       // alpha (horizontal rotation) - 45 degrees
            Math.PI / 4,       // beta (vertical rotation) - 45 degrees (slightly less top-down)
            38,                // radius (distance) - slightly closer for better view
            new Vector3(20, 0, 20), // target position (center of the 20x20 grid map)
            this.scene
        );
        
        // Set camera limits to favor a top-down perspective
        camera.lowerRadiusLimit = 25; // Minimum zoom distance
        camera.upperRadiusLimit = 60; // Maximum zoom distance
        camera.lowerBetaLimit = 0.3; // Higher minimum beta angle (less from above)
        camera.upperBetaLimit = 0.9; // Higher maximum beta angle (allow slightly lower views)
        camera.lowerAlphaLimit = 0; // Allow full 360-degree rotation
        camera.upperAlphaLimit = 2 * Math.PI; // Full circle rotation
        
        // Setup camera control - we'll enable controls in GameplayState
        camera.attachControl(this.canvas, true);
        
        // Configure control speeds
        camera.wheelPrecision = 40; // Smoother zoom speed
        camera.panningSensibility = 100; // Panning sensitivity
        camera.angularSensibilityX = 400; // Horizontal rotation sensitivity
        camera.angularSensibilityY = 400; // Vertical rotation sensitivity
        
        // Set inertia for smoother camera movement
        camera.inertia = 0.5; // Lower inertia for more responsive controls
        
        // Additional camera improvements
        camera.checkCollisions = false; // No collision detection needed
        camera.useBouncingBehavior = true; // Bounce when reaching limits
        camera.useAutoRotationBehavior = true; // Enable auto-rotation when idle
        camera.autoRotationBehavior!.idleRotationSpeed = 0.05; // Slow idle rotation
        camera.autoRotationBehavior!.idleRotationWaitTime = 10000; // Wait 10 seconds before auto-rotation
        camera.autoRotationBehavior!.idleRotationSpinupTime = 2000; // Take 2 seconds to reach full speed
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

    // Add this new method
    public togglePause(): void {
        if (this._isPaused) {
            this.resume();
        } else {
            this.pause();
        }
    }
} 