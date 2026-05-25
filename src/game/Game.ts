import { Engine, EngineFactory, AbstractEngine, Scene, Vector3, HemisphericLight, PointLight, Color3, ArcRotateCamera, Camera, Animation, AbstractMesh, GlowLayer, WebGPUEngine, DefaultRenderingPipeline } from '@babylonjs/core';
import { GameState } from './states/GameState';
import { MenuState } from './states/MenuState';
import { SurvivorsGameplayState } from './states/SurvivorsGameplayState';
import { GameOverState } from './states/GameOverState';
import { AssetManager } from './managers/AssetManager';
import { StateManager } from './managers/StateManager';
import { PauseScreen } from './ui/PauseScreen';
import { PALETTE } from './rendering/StyleConstants';

export class Game {
    private canvas: HTMLCanvasElement;
    // Engine + scene + everything that depends on them are created in start()
    // (async, because WebGPUEngine.initAsync is async). Marked with `!` since
    // they are guaranteed to be assigned before any consumer can call them.
    private engine!: AbstractEngine;
    private scene!: Scene;
    private stateManager!: StateManager;
    /** Set true by StateManager.changeState; consumed (cleared) by the next
     *  render loop tick. While true, scene.render is skipped — prevents the
     *  same rAF cycle that ran a state change (and disposed everything) from
     *  also trying to render against the half-torn-down scene. */
    public skipRenderThisFrame: boolean = false;
    private assetManager!: AssetManager;
    private _isPaused: boolean = false;
    private pauseScreen!: PauseScreen;
    private _timeScale: number = 1;
    /** Pre-created in setupScene at intensity 0 so every material compiles
     *  with knowledge of this slot. Champion.enableTorch parents it to the
     *  hero mesh and cranks the intensity up. Without pre-registration,
     *  scene.blockMaterialDirtyMechanism (true) means new lights added later
     *  never reach the already-compiled material shaders. */
    private heroTorch!: PointLight;

    constructor(canvasId: string) {
        // Lightweight constructor — only resolve the canvas. Everything else
        // (engine, scene, managers, state registration) happens in start()
        // because WebGPU engine initialization is async.
        const element = document.getElementById(canvasId);
        if (!element) throw new Error(`Canvas element with id ${canvasId} not found`);
        if (!(element instanceof HTMLCanvasElement)) throw new Error(`Element with id ${canvasId} is not a canvas element`);
        this.canvas = element;
    }

    /**
     * Try to create a WebGPU engine; fall back to WebGL on browsers that
     * don't support it (Safari at time of writing). EngineFactory.CreateAsync
     * handles both cases and returns the right thing — we just await it.
     */
    private async createEngine(): Promise<AbstractEngine> {
        try {
            const engine = await EngineFactory.CreateAsync(this.canvas, {
                antialias: true,
                stencil: true,
            });
            // Babylon picks WebGPU automatically when supported. Log which we got.
            const usingWebGPU = engine instanceof WebGPUEngine;
            console.info(`[engine] initialised: ${usingWebGPU ? 'WebGPU' : 'WebGL'}`);
            return engine;
        } catch (err) {
            // Fallback: any failure (e.g. WebGPU init crashed mid-load) → plain WebGL.
            console.warn('[engine] EngineFactory failed, falling back to WebGL:', err);
            return new Engine(this.canvas, true);
        }
    }

    public async start(): Promise<void> {
        // Async engine creation (WebGPU when available, WebGL otherwise).
        this.engine = await this.createEngine();

        // Create the main scene (mesh-map options are read-only after construction).
        this.scene = new Scene(this.engine, {
            useGeometryUniqueIdsMap: true,
            useMaterialMeshMap: true,
            useClonedMeshMap: true,
        });
        this.scene.clearColor = PALETTE.SKY.clone();

        // Initialize managers
        this.assetManager = new AssetManager(this.scene);
        this.stateManager = new StateManager(this);

        // Register game states (their constructors don't touch scene yet — only enter() does)
        this.stateManager.registerState('menu', new MenuState(this));
        this.stateManager.registerState('survivors', new SurvivorsGameplayState(this));
        this.stateManager.registerState('gameOver', new GameOverState(this));

        // Initialize pause screen
        this.pauseScreen = new PauseScreen(this);

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
                // Update the current state. update() can trigger a state
                // change (hero death → gameOver) which synchronously runs
                // exit()+enter() and tears the scene down.
                this.stateManager.update(this.engine.getDeltaTime() / 1000);

                // If a state transition happened this frame, skip the render.
                // Half-disposed asset references (skeleton bone-matrix texture,
                // material textures, etc.) would otherwise crash mid-render.
                // Render resumes cleanly on the next rAF.
                if (this.skipRenderThisFrame) {
                    this.skipRenderThisFrame = false;
                    return;
                }

                try {
                    this.scene.render();
                } catch (err) {
                    console.warn('[render] swallowed render error:', err);
                }
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
        // Guard against early resize events that fire before async engine init completes.
        if (!this.engine || !this.scene) return;
        this.engine.resize();
        this.updateOrthoBounds();
    }

    /**
     * Recalculate orthographic bounds to fit the map in the viewport.
     * If camera.metadata.orthoZoom is set, uses that fixed value.
     * Otherwise, auto-computes optimal zoom to fill the screen with the isometric map.
     */
    public updateOrthoBounds(): void {
        const camera = this.scene.activeCamera as ArcRotateCamera;
        if (!camera || camera.mode !== Camera.ORTHOGRAPHIC_CAMERA) return;

        const aspect = this.engine.getAspectRatio(camera);
        let zoom: number;

        if (camera.metadata?.orthoZoom != null) {
            zoom = camera.metadata.orthoZoom;
        } else {
            // Auto-fit: compute zoom so the 40x40 isometric diamond fills the screen.
            // With tilted isometric (alpha=-45°, beta=1.15):
            //   horizontal extent = mapSize / √2 (diamond left/right, unchanged)
            //   vertical extent uses sin(beta) for the tilt compression
            const mapSize = 40;
            const sinBeta = Math.sin(camera.beta);
            const screenHalfW = mapSize / Math.SQRT2 + 3;
            const screenHalfH = (mapSize / Math.SQRT2) * sinBeta * 0.55 + 6;
            zoom = Math.max(screenHalfH, screenHalfW / aspect);
        }

        camera.orthoTop = zoom;
        camera.orthoBottom = -zoom;
        camera.orthoLeft = -zoom * aspect;
        camera.orthoRight = zoom * aspect;
    }

    private setupScene(): void {
        // ─── Scene-level perf flags ───────────────────────────────────────────
        this.scene.blockMaterialDirtyMechanism = true; // we never restructure materials at runtime
        this.scene.fogEnabled = false;
        this.scene.shadowsEnabled = false;
        this.scene.skipPointerMovePicking = true;       // top-down game has no hover-pick UX
        // useGeometryUniqueIdsMap / useMaterialMeshMap / useClonedMeshMap are
        // constructor-only (SceneOptions) — passed above in new Scene(...).

        // Warm hemisphere light for low-poly stylized look. Single global
        // fill — survivors mode no longer stacks another hemi on top
        // (was making the scene read as flat / "full bright").
        const light = new HemisphericLight('light', new Vector3(0, 1, 0), this.scene);
        light.diffuse = PALETTE.LIGHT_DIFFUSE.clone();
        light.groundColor = PALETTE.LIGHT_GROUND.clone();
        light.intensity = 0.55;

        // ── Pre-register the hero torch ───────────────────────────────────────
        // Created here at intensity 0 so every material that compiles after
        // this point picks up the slot in its shader. Champion.enableTorch()
        // later parents this light to the hero mesh and cranks the intensity.
        // Without pre-registration the dirty-block (set above) prevents the
        // torch from ever reaching already-compiled materials.
        this.heroTorch = new PointLight('heroTorch', new Vector3(0, 1.4, 0), this.scene);
        this.heroTorch.diffuse  = new Color3(1.00, 0.62, 0.28);
        this.heroTorch.specular = new Color3(0, 0, 0);
        this.heroTorch.intensity = 0; // dormant until enabled
        this.heroTorch.range = 9;

        // Fog disabled -- doesn't work properly with orthographic projection
        this.scene.fogMode = Scene.FOGMODE_NONE;

        // Glow layer for emissive elements (portals, tower effects).
        // mainTextureRatio 0.5 halves fill rate on retina/4K; blurKernelSize 16 halves blur work.
        // Glow handles tight emissive highlights; bloom (set up below) adds the
        // broader halo over the post-tone-mapped framebuffer.
        const glowLayer = new GlowLayer('glowLayer', this.scene, { mainTextureRatio: 0.5 });
        glowLayer.intensity = 0.4;
        glowLayer.blurKernelSize = 16; // default 32 — half the blur work per frame

        // Tilted isometric beta angle: ~60° from pole (30° above horizon)
        // gives a dramatic 3/4 view that shows tower sides clearly
        const isoBeta = 1.05;

        // Fixed isometric camera with orthographic projection
        const camera = new ArcRotateCamera(
            'camera',
            -Math.PI / 4,      // alpha: -45° for classic isometric angle
            isoBeta,            // beta: tilted isometric elevation
            50,                 // radius: camera distance (doesn't affect ortho zoom)
            new Vector3(20, 0, 20), // target: center of 20x20 grid (cells are 2 units)
            this.scene
        );

        // Switch to orthographic projection
        camera.mode = Camera.ORTHOGRAPHIC_CAMERA;

        // Auto-compute ortho zoom to fit the map (null = auto)
        camera.metadata = { orthoZoom: null };

        // Set initial ortho bounds
        this.updateOrthoBounds();

        // No user controls -- camera is fully fixed, no rotation allowed
        camera.inputs.clear();
        camera.detachControl();

        // Lock rotation angles so they can never change
        camera.lowerAlphaLimit = camera.alpha;
        camera.upperAlphaLimit = camera.alpha;
        camera.lowerBetaLimit = camera.beta;
        camera.upperBetaLimit = camera.beta;
        camera.lowerRadiusLimit = camera.radius;
        camera.upperRadiusLimit = camera.radius;

        // ── Post-processing pipeline ──────────────────────────────────────────
        // FXAA + bloom only. The previous experiment with ACES tone-mapping
        // and a vignette darkened the 3D scene noticeably while doing nothing
        // useful — most materials here are frozen-StandardMaterial with no
        // dynamic-range content for ACES to flatter. Bloom alone gives the
        // emissive elements (orbs, crit pops, boss eyes, UI titles) the halo
        // the user actually liked.
        const renderW = this.engine.getRenderWidth();
        const isLowEnd = renderW < 800;
        const pipeline = new DefaultRenderingPipeline('mainPipeline', true, this.scene, [camera]);

        // FXAA — cheap edge smoothing, big readability win on low-poly geometry.
        pipeline.fxaaEnabled = true;
        pipeline.samples = 1; // we MSAA via FXAA, not HW multisample

        // Bloom — soft halo over bright pixels only. Threshold keeps midtones
        // out so the 3D scene isn't blurred; mostly catches emissive content
        // and bright GUI text (which we like — gives titles a glow).
        pipeline.bloomEnabled  = true;
        pipeline.bloomThreshold = 0.85;
        pipeline.bloomWeight    = isLowEnd ? 0.25 : 0.40;
        pipeline.bloomScale     = isLowEnd ? 0.25 : 0.50; // RT size factor
        pipeline.bloomKernel    = isLowEnd ? 32   : 64;

        // ImageProcessing left disabled. Re-enable per-feature later if we
        // want a specific look — but blanket enabling it stacks tone-mapping
        // + vignette on top of an already low-dynamic-range scene.
        pipeline.imageProcessingEnabled = false;
    }

    /**
     * Clean up the scene by disposing all meshes and resources
     * This should be called when transitioning between states to ensure a clean slate
     */
    public cleanupScene(): void {
        // Dispose all meshes in the scene (cleanup what state.exit() may have
        // missed). Use the default (false, false) — disposeMaterialAndTextures
        // would nuke textures owned by cached GLB AssetContainers (loadAssetContainerAsync
        // adds source textures to scene.textures), crashing the next
        // instantiateModelsToScene call after a state change.
        const meshes = this.scene.meshes.slice();
        for (const mesh of meshes) {
            if (!mesh.name.includes('camera')) {
                try { mesh.dispose(); } catch (_) { /* already disposed */ }
            }
        }

        // Dispose only ParticleSystems — those are always state-owned and
        // never managed by cached AssetContainers. Materials, textures, and
        // skeletons are intentionally NOT bulk-disposed here: they may be
        // owned by cached GLB AssetContainers that the next state will
        // re-instantiate from. State.exit() is responsible for disposing
        // state-owned per-instance materials.
        const particleSystems = this.scene.particleSystems.slice();
        for (const particleSystem of particleSystems) {
            try { particleSystem.dispose(); } catch (_) { /* already disposed */ }
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
    /** The pre-registered torch light (parented to origin until activated).
     *  Champion.enableTorch reparents it to the hero mesh and sets intensity. */
    public getHeroTorch(): PointLight {
        return this.heroTorch;
    }

    public getScene(): Scene {
        return this.scene;
    }

    public getEngine(): AbstractEngine {
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