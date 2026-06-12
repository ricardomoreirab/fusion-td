import { Engine, EngineFactory, AbstractEngine, NullEngine, Scene, Vector3, HemisphericLight, PointLight, Color3, ArcRotateCamera, Camera, GlowLayer, WebGPUEngine, DefaultRenderingPipeline } from '@babylonjs/core';
import { GameState } from './GameState';
import { MenuState } from '../menu/MenuState';
import { SurvivorsGameplayState } from '../survivors/SurvivorsGameplayState';
import { GameOverState } from '../game-over/GameOverState';
import { AssetManager } from './AssetManager';
import { StateManager } from './StateManager';
import { PauseScreen } from '../shared/ui/PauseScreen';
import { PALETTE } from './rendering/StyleConstants';

// Rate-limited logger for per-frame update/render exceptions. The render loop
// keeps running (a thrown frame must not permanently black/freeze the canvas),
// but the error is surfaced with its stack — a silent black screen is otherwise
// undiagnosable. Logs the first 8 occurrences, then every 120th, so a per-frame
// throw doesn't flood the console.
let _loopErrorCount = 0;
function logLoopError(phase: string, err: unknown): void {
    _loopErrorCount++;
    if (_loopErrorCount <= 8 || _loopErrorCount % 120 === 0) {
        console.error(`[loop:${phase}] frame error #${_loopErrorCount}:`, err);
    }
}

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
    // Post-fx handles for the late-wave performance trim (setPostFxReduced).
    private renderPipeline: DefaultRenderingPipeline | null = null;
    private glowLayer: GlowLayer | null = null;
    private postFxDefaults = { bloomWeight: 0.4, bloomKernel: 64, glowIntensity: 0.4 };

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
    private gpuUnavailable = false;

    private async createEngine(): Promise<AbstractEngine> {
        try {
            const engine = await EngineFactory.CreateAsync(this.canvas, {
                antialias: true,
                stencil: true,
            });
            // EngineFactory's last-resort fallback is a NullEngine (no WebGPU
            // AND no WebGL — e.g. headless browsers without a GPU flag, or
            // broken driver blacklists). A NullEngine "runs" but renders
            // nothing, leaving a black canvas, and cube-texture loads crash
            // in the WebGL upload path (no GL context). Surface a clear
            // message and let callers skip GPU-only extras.
            if (engine instanceof NullEngine) {
                this.gpuUnavailable = true;
                console.error('[engine] No GPU rendering available — WebGPU and WebGL are both unsupported in this browser. The game cannot render.');
                this.showGpuUnavailableBanner();
                return engine;
            }
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
            
            // Start the single, permanent render loop. It is installed ONCE here
            // and never replaced — pause()/resume() only toggle _isPaused. This
            // keeps the update/render try/catch guards and the skipRenderThisFrame
            // state-transition guard active for the ENTIRE session. (Previously
            // pause/resume swapped in bare loops that dropped both guards, so a
            // hero-death frame after any pause rendered a half-disposed scene and
            // the throw escaped the rAF callback → permanent black canvas.)
            this.engine.runRenderLoop(() => this.frameTick());
        }, (progress: number) => {
            // Update loading progress
            const loadingBar = document.getElementById('loadingBar');
            if (loadingBar) {
                loadingBar.style.width = `${progress * 100}%`;
            }
        });
    }

    /**
     * The one and only render-loop body, installed once in start() and never
     * replaced. pause()/resume() merely flip _isPaused; the guards below stay
     * live for the whole session.
     *
     *  - update() is skipped while paused (the scene keeps drawing for the pause
     *    UI). A throw is logged via logLoopError, never escaping the rAF.
     *  - update() can synchronously change state (hero death → gameOver), which
     *    runs exit()+enter() and tears the scene down. skipRenderThisFrame then
     *    suppresses this frame's render so we don't draw a half-disposed scene
     *    (skeleton bone-matrix texture, material textures, etc.). Render resumes
     *    cleanly on the next rAF.
     *  - a render-phase throw is surfaced (not swallowed) so a recurring black
     *    frame is diagnosable with a stack trace, and the loop survives it.
     */
    private frameTick(): void {
        // [freeze:frame] instrument — measures the time ACTUALLY SPENT in our
        // per-frame work (logic + render). Unlike the rAF-gap detector, this is
        // immune to a browser-paused rAF (backgrounding/unfocus): if our code is
        // the stall it fires and names update-vs-render; if it never fires while
        // rAF-gaps still log, the "freeze" is paused rAF, not our compute.
        const t0 = performance.now();
        if (!this._isPaused) {
            try {
                this.stateManager.update(this.engine.getDeltaTime() / 1000);
            } catch (err) {
                logLoopError('update', err);
            }
        }
        const tAfterUpdate = performance.now();

        let rendered = false;
        if (this.skipRenderThisFrame) {
            this.skipRenderThisFrame = false;
        } else {
            rendered = true;
            try {
                this.scene.render();
            } catch (err) {
                logLoopError('render', err);
            }
        }

        const total = performance.now() - t0;
        if (total > 80) {
            const updateMs = Math.round(tAfterUpdate - t0);
            const renderMs = rendered ? Math.round(performance.now() - tAfterUpdate) : 0;
            console.error(`[freeze:frame] ${Math.round(total)}ms (update=${updateMs}ms render=${renderMs}ms)`);
        }
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
        this.glowLayer = glowLayer;

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
        this.renderPipeline = pipeline;
        // Snapshot the configured values so setPostFxReduced(false) restores
        // exactly this (isLowEnd-dependent) baseline.
        this.postFxDefaults = {
            bloomWeight: pipeline.bloomWeight,
            bloomKernel: pipeline.bloomKernel,
            glowIntensity: glowLayer.intensity,
        };

        // ImageProcessing left disabled. Re-enable per-feature later if we
        // want a specific look — but blanket enabling it stacks tone-mapping
        // + vignette on top of an already low-dynamic-range scene.
        pipeline.imageProcessingEnabled = false;
    }

    /**
     * Late-wave performance trim: swap the post-fx between the configured
     * baseline and a reduced set (half bloom kernel, lighter bloom weight,
     * dimmer glow). Render-quality only — gameplay untouched. bloomScale is
     * deliberately NOT touched (its setter rebuilds the whole bloom chain).
     * SurvivorsGameplayState escalates into this when the FPS EMA sags in
     * late waves and resets it (false) on run teardown.
     */
    public setPostFxReduced(reduced: boolean): void {
        const d = this.postFxDefaults;
        if (this.renderPipeline) {
            this.renderPipeline.bloomKernel = reduced ? Math.min(32, d.bloomKernel) : d.bloomKernel;
            this.renderPipeline.bloomWeight = reduced ? d.bloomWeight * 0.75 : d.bloomWeight;
        }
        if (this.glowLayer) {
            this.glowLayer.intensity = reduced ? d.glowIntensity * 0.5 : d.glowIntensity;
        }
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

        // Freeze ALL animation evaluation in one flag. This pauses GLB skeletal
        // animation groups + every animatable without removing them from the
        // active list, so resume() can simply re-enable evaluation. (The old
        // code stopped per-mesh animations on pause and re-`beginAnimation`'d
        // them with loop=true on resume — that LEAKED a looping animatable per
        // mesh.animation on every pause/resume cycle.)
        this.scene.animationsEnabled = false;

        this.scene.particleSystems.forEach(system => {
            system.stop();
        });
        
        // No render-loop swap: the single permanent loop installed in start()
        // keeps rendering every frame, and _isPaused (set above) makes frameTick()
        // skip the game update while still drawing the scene + pause UI.

        // Show the pause screen.
        try {
            if (this.pauseScreen) {
                console.log('Showing pause screen');
                this.pauseScreen.show();

                // Force one render so the pause screen appears on this same tick.
                try { this.scene.render(); } catch (err) { logLoopError('render', err); }
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

        // Re-enable animation evaluation (see pause()). Animatables/groups resume
        // from where they were — no new animatables are created.
        this.scene.animationsEnabled = true;

        this.scene.particleSystems.forEach(system => {
            system.start();
        });
        
        // No render-loop swap: the single permanent loop keeps running; clearing
        // _isPaused (above) re-enables the game update inside frameTick().
        console.log('Resumed full game update in the permanent render loop');

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

    /** True when EngineFactory fell back to a NullEngine (no WebGPU, no WebGL).
     *  GPU-only extras (env cube textures, etc.) should be skipped — they crash
     *  on the GL-less engine. */
    public isGpuUnavailable(): boolean {
        return this.gpuUnavailable;
    }

    /** Visible explanation for the black canvas when no GPU API exists. */
    private showGpuUnavailableBanner(): void {
        const div = document.createElement('div');
        div.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;' +
            'background:#7a1f1f;color:#fff;font:14px sans-serif;padding:10px 16px;text-align:center;';
        div.textContent = 'This browser has no GPU rendering support (WebGPU and WebGL unavailable) — the game cannot be displayed.';
        document.body.appendChild(div);
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

    /** Show the full-screen loading overlay (reused for per-run prewarm). */
    public showLoadingScreen(label?: string): void {
        const el = document.getElementById('loadingScreen');
        if (!el) return;
        el.style.display = ''; // revert the inline 'none' → CSS default (flex)
        if (label) {
            const lbl = el.querySelector('.ktg-loading-label');
            if (lbl) lbl.textContent = label;
        }
    }

    /** Hide the loading overlay. */
    public hideLoadingScreen(): void {
        const el = document.getElementById('loadingScreen');
        if (el) el.style.display = 'none';
    }
} 