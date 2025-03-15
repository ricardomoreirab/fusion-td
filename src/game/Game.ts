import { Engine, Scene, Vector3, HemisphericLight, ArcRotateCamera, Color4, SceneLoader } from '@babylonjs/core';
import { GameState } from './states/GameState';
import { MenuState } from './states/MenuState';
import { GameplayState } from './states/GameplayState';
import { GameOverState } from './states/GameOverState';
import { AssetManager } from './managers/AssetManager';
import { StateManager } from './managers/StateManager';

export class Game {
    private canvas: HTMLCanvasElement;
    private engine: Engine;
    private scene: Scene;
    private stateManager: StateManager;
    private assetManager: AssetManager;

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
        
        // Create a fixed camera with an isometric-like view
        const camera = new ArcRotateCamera('camera', -Math.PI / 4, Math.PI / 3, 40, Vector3.Zero(), this.scene);
        camera.lowerRadiusLimit = 40;
        camera.upperRadiusLimit = 40;
        camera.lowerBetaLimit = Math.PI / 3;
        camera.upperBetaLimit = Math.PI / 3;
        camera.lowerAlphaLimit = -Math.PI / 4;
        camera.upperAlphaLimit = -Math.PI / 4;
        
        // Disable camera controls to keep the fixed view
        camera.inputs.clear();
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
        
        // Clear any remaining transformNodes
        const transformNodes = this.scene.transformNodes.slice();
        for (const node of transformNodes) {
            node.dispose();
        }
        
        console.log('Scene cleaned up');
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
} 