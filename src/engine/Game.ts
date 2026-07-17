import { Camera, Color, HemisphereLight, OrthographicCamera, PointLight, Vector3 } from 'three';
import { GameState } from './GameState';
import { MenuState } from '../menu/MenuState';
import { SurvivorsGameplayState } from '../survivors/SurvivorsGameplayState';
import { GameOverState } from '../game-over/GameOverState';
import { AssetManager } from './AssetManager';
import { StateManager } from './StateManager';
import { PauseScreen } from '../shared/ui/PauseScreen';
import { PALETTE } from './rendering/StyleConstants';
import { SceneHost } from './three/SceneHost';
import { RendererHost } from './three/RendererHost';
import { disposeMesh } from './three/primitives';
import type { RGBA } from './three/math';
import { evaluateRenderHealth, isFiniteVec3, isFiniteMatrix, type RenderHealthSnapshot } from './renderHealth';

// Rate-limited logger for per-frame update/render exceptions. The render loop
// keeps running (a thrown frame must not permanently black/freeze the canvas),
// but the error is surfaced with its stack - a silent black screen is otherwise
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
    // Renderer + scene host + everything that depends on them are created in
    // start(). Marked with `!` since they are guaranteed to be assigned before
    // any consumer can call them.
    private rendererHost!: RendererHost;
    private sceneHost!: SceneHost;
    /** Timestamp of the previous frameTick, for delta computation. */
    private _lastFrameAt = 0;
    private stateManager!: StateManager;
    /** Set true by StateManager.changeState; consumed (cleared) by the next
     *  render loop tick. While true, the composer render is skipped - prevents
     *  the same rAF cycle that ran a state change (and disposed everything)
     *  from also trying to render against the half-torn-down scene. */
    public skipRenderThisFrame: boolean = false;
    private assetManager!: AssetManager;
    private _isPaused: boolean = false;
    private pauseScreen!: PauseScreen;
    private _timeScale: number = 1;
    /** Created once in setupScene at intensity 0 and owned by Game for its
     *  whole lifetime. Champion.enableTorch parents it to the hero mesh and
     *  cranks the intensity up. (The Babylon-era shader-slot pre-registration
     *  rationale is gone - Three materials pick up lights dynamically - but
     *  single ownership of the torch stays.) */
    private heroTorch!: PointLight;

    /** The camera the composer renders with. Menu/boot: the fixed ortho
     *  camera below; gameplay swaps in the hero-follow perspective camera
     *  via setActiveCamera. */
    private activeCamera!: Camera;
    private orthoCamera!: OrthographicCamera;
    /** Fixed ortho zoom override; null = auto-fit (Babylon camera.metadata.orthoZoom). */
    public orthoZoomOverride: number | null = null;

    // -- Render-health watchdog state ----------------------------------------
    // Guarantees a pure-black canvas can never persist silently. See renderHealth.ts
    // for the two failure classes (GPU context loss; NaN camera matrix) this guards.
    private _contextLost = false;
    private _contextLostAt = 0;
    private _lastRenderOkAt = 0;
    private _lastWatchdogTickAt = 0;
    private _renderLoopStarted = false;
    private _reloadScheduled = false;
    private _blackoutBanner: HTMLDivElement | null = null;
    /** Last finite active-camera position; restored if the camera transform goes NaN. */
    private _lastGoodCamPos = new Vector3(0, 20, -20);

    private gpuUnavailable = false;

    constructor(canvasId: string) {
        // Lightweight constructor - only resolve the canvas. Everything else
        // (renderer, scene, managers, state registration) happens in start().
        const element = document.getElementById(canvasId);
        if (!element) throw new Error(`Canvas element with id ${canvasId} not found`);
        if (!(element instanceof HTMLCanvasElement)) throw new Error(`Element with id ${canvasId} is not a canvas element`);
        this.canvas = element;
    }

    public async start(): Promise<void> {
        this.sceneHost = new SceneHost();
        if (new URLSearchParams(window.location.search).has('debug')) {
            (window as unknown as Record<string, unknown>).__ktgScene = this.sceneHost.scene;
        }

        // Lights + cameras must exist before the composer (RenderPass binds
        // scene + camera at construction).
        this.setupScene();

        // WebGL renderer + post-processing. Context creation can fail outright
        // (no GPU, blocked driver) - surface it instead of a silent black canvas.
        try {
            this.rendererHost = new RendererHost(this.canvas, this.sceneHost.scene, this.activeCamera);
            console.info('[engine] initialised: WebGL (three)');
        } catch (err) {
            this.gpuUnavailable = true;
            console.error('[engine] No GPU rendering available - WebGL is unsupported in this browser. The game cannot render.', err);
            this.showGpuUnavailableBanner();
            return;
        }
        this.setClearColor(PALETTE.SKY);
        this.rendererHost.resize(this.canvas.clientWidth || window.innerWidth, this.canvas.clientHeight || window.innerHeight);
        this.updateOrthoBounds();

        // Wire GPU context-loss recovery BEFORE anything renders. Without this, a
        // lost context stops the frame while input/HUD keep working - the reported
        // "black screen, game still running".
        this.installContextLossRecovery();

        // Initialize managers
        this.assetManager = new AssetManager();
        this.stateManager = new StateManager(this);

        // Register game states (their constructors don't touch the scene yet - only enter() does)
        this.stateManager.registerState('menu', new MenuState(this));
        this.stateManager.registerState('survivors', new SurvivorsGameplayState(this));
        this.stateManager.registerState('gameOver', new GameOverState(this));

        // Initialize pause screen
        this.pauseScreen = new PauseScreen(this);

        // Start loading assets
        this.assetManager.loadAssets(() => {
            // Hide loading screen
            const loadingScreen = document.getElementById('loadingScreen');
            if (loadingScreen) {
                loadingScreen.style.display = 'none';
            }

            // Start with the menu state
            this.stateManager.changeState('menu');

            // Render-health watchdog is now meaningful: mark the loop started and seed
            // the last-good-render timestamp so the watchdog has a fresh baseline.
            this._renderLoopStarted = true;
            this._lastRenderOkAt = performance.now();
            this.installRenderWatchdog();

            // Start the single, permanent render loop. It is installed ONCE here
            // and never replaced - pause()/resume() only toggle _isPaused. This
            // keeps the update/render try/catch guards and the skipRenderThisFrame
            // state-transition guard active for the ENTIRE session.
            this._lastFrameAt = performance.now(); // so frame 1 isn't a huge dt
            this.rendererHost.renderer.setAnimationLoop(() => this.frameTick());
        }, (progress: number) => {
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
     *    UI). A throw is logged via logLoopError, never escaping the loop.
     *  - update() can synchronously change state (hero death -> gameOver), which
     *    runs exit()+enter() and tears the scene down. skipRenderThisFrame then
     *    suppresses this frame's render so we don't draw a half-disposed scene.
     *  - sceneHost.tick runs the per-frame buses + particles even while paused
     *    (Babylon fired onBeforeRenderObservable while paused too); tweens and
     *    mixers are gated inside by animationsEnabled.
     *  - a render-phase throw is surfaced (not swallowed) so a recurring black
     *    frame is diagnosable with a stack trace, and the loop survives it.
     */
    private frameTick(): void {
        // [freeze:frame] instrument - measures the time ACTUALLY SPENT in our
        // per-frame work (logic + render), immune to a browser-paused rAF.
        const t0 = performance.now();
        const dt = Math.min((t0 - this._lastFrameAt) / 1000, 0.25);
        this._lastFrameAt = t0;
        if (!this._isPaused) {
            try {
                this.stateManager.update(dt);
            } catch (err) {
                logLoopError('update', err);
            }
        }
        try {
            this.sceneHost.tick(dt);
        } catch (err) {
            logLoopError('tick', err);
        }
        const tAfterUpdate = performance.now();

        let rendered = false;
        if (this.skipRenderThisFrame) {
            this.skipRenderThisFrame = false;
        } else if (this.guardActiveCamera()) {
            rendered = true;
            try {
                this.rendererHost.render(dt);
                // Stamp a successful present so the render-health watchdog knows the
                // canvas is alive. A NaN camera that renders "successfully" into black
                // is caught by guardActiveCamera above, not here.
                this._lastRenderOkAt = performance.now();
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

    /**
     * Cross-cutting guard against a NaN/Infinity camera transform. The
     * hero-follow camera lerps its position every frame; a single non-finite
     * value makes the view matrix NaN, which clips EVERY mesh and leaves the
     * near-black clear color = a permanent, sticky black canvas that does NOT
     * throw. Detect it before it reaches the GPU: restore the last finite
     * camera position and skip this frame so the canvas keeps its last good
     * image. Returns false when it had to recover.
     */
    private guardActiveCamera(): boolean {
        const cam = this.activeCamera;
        if (!cam) return false;
        const p = cam.position;
        if (!isFiniteVec3(p.x, p.y, p.z)) {
            logLoopError('camera', new Error('non-finite activeCamera.position - recovered'));
            p.copy(this._lastGoodCamPos);
            return false;
        }

        // A finite POSITION is not sufficient: the world/projection matrices can
        // still go non-finite while position stays clean - most often a NaN aspect
        // ratio when the render canvas is momentarily 0-height, which poisons the
        // projection, clips every mesh, and renders "successfully" into the
        // near-black clear colour. Validate the transforms directly.
        let transformsFinite: boolean;
        try {
            cam.updateMatrixWorld();
            const proj = (cam as OrthographicCamera).projectionMatrix;
            transformsFinite = isFiniteMatrix(cam.matrixWorld.elements) && isFiniteMatrix(proj.elements);
        } catch (_) {
            transformsFinite = false;
        }
        if (!transformsFinite) {
            logLoopError('camera', new Error('non-finite camera view/projection - recovered'));
            p.copy(this._lastGoodCamPos);
            // The usual culprit is a degenerate render size feeding a NaN aspect
            // ratio. Recompute from valid dimensions; meanwhile skip THIS frame so
            // the canvas keeps its last good image instead of flashing black.
            try { this.resize(); } catch (_) { /* mid-teardown - ignore */ }
            return false;
        }

        this._lastGoodCamPos.copy(p);
        return true;
    }

    /**
     * Wire GPU context-loss recovery. We can't prevent a lost WebGL context
     * (driver reset, GPU-process crash, OOM), but we make it never silently
     * permanent: surface a banner, let the browser attempt its restore, and let
     * the watchdog hard-reload if it can't recover within the grace window.
     */
    private installContextLossRecovery(): void {
        this.rendererHost.onContextLost = () => {
            console.error('[engine] GPU context LOST - attempting recovery');
            this._contextLost = true;
            this._contextLostAt = performance.now();
            this.showBlackoutBanner('Rendering lost - attempting to recover…');
        };
        this.rendererHost.onContextRestored = () => {
            console.info('[engine] GPU context restored');
            this._contextLost = false;
            this._contextLostAt = 0;
            this._lastRenderOkAt = performance.now();
            this.hideBlackoutBanner();
            this.updateOrthoBounds();
        };
    }

    /**
     * Render-health watchdog. Runs on a SEPARATE setInterval, NOT inside the
     * render loop, because the leading black-screen cause (context loss) freezes
     * the rAF callback itself - an in-loop check would never run. The recovery
     * decision is the pure evaluateRenderHealth(); its conservative gates make a
     * backgrounded or main-thread-throttled tab impossible to mistake for a
     * render stall.
     */
    private installRenderWatchdog(): void {
        const INTERVAL_MS = 1_000;
        this._lastWatchdogTickAt = performance.now();
        setInterval(() => {
            const now = performance.now();
            const tickGap = now - this._lastWatchdogTickAt;
            this._lastWatchdogTickAt = now;

            const snapshot: RenderHealthSnapshot = {
                running: this._renderLoopStarted,
                contextLost: this._contextLost,
                contextLostForMs: this._contextLost ? now - this._contextLostAt : 0,
                msSinceLastRenderOk: now - this._lastRenderOkAt,
                visible: typeof document === 'undefined' || document.visibilityState === 'visible',
                paused: this._isPaused,
                // If our own timer fired late, the main thread was blocked/throttled, so
                // msSinceLastRenderOk is inflated by the same block - don't trust it.
                jsClockHealthy: tickGap < INTERVAL_MS * 3,
            };

            const action = evaluateRenderHealth(snapshot);
            if (action === 'reload') {
                if (this._reloadScheduled) return;
                this._reloadScheduled = true;
                console.error('[render-watchdog] no successful frame - reloading to recover');
                this.showBlackoutBanner('Rendering could not recover - reloading…');
                setTimeout(() => { try { location.reload(); } catch { /* non-browser env */ } }, 700);
            } else if (action === 'warn') {
                this.showBlackoutBanner(this._contextLost
                    ? 'Rendering lost - attempting to recover…'
                    : 'Rendering stalled - recovering…');
            } else if (!this._reloadScheduled) {
                this.hideBlackoutBanner();
            }
        }, INTERVAL_MS);
    }

    private showBlackoutBanner(message: string): void {
        if (!this._blackoutBanner) {
            const div = document.createElement('div');
            div.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;' +
                'background:#7a1f1f;color:#fff;font:14px sans-serif;padding:10px 16px;text-align:center;';
            document.body.appendChild(div);
            this._blackoutBanner = div;
        }
        this._blackoutBanner.textContent = message;
        this._blackoutBanner.style.display = 'block';
    }

    private hideBlackoutBanner(): void {
        if (this._blackoutBanner) this._blackoutBanner.style.display = 'none';
    }

    public resize(): void {
        // Guard against early resize events that fire before async init completes.
        if (!this.rendererHost) return;
        this.rendererHost.resize(this.canvas.clientWidth || window.innerWidth, this.canvas.clientHeight || window.innerHeight);
        this.updateOrthoBounds();
        const cam = this.activeCamera as { aspect?: number; updateProjectionMatrix?: () => void };
        if (cam.aspect !== undefined && cam.updateProjectionMatrix) {
            cam.aspect = (this.canvas.clientWidth || window.innerWidth) / Math.max(1, this.canvas.clientHeight || window.innerHeight);
            cam.updateProjectionMatrix();
        }
    }

    /**
     * Recalculate orthographic bounds to fit the map in the viewport.
     * If orthoZoomOverride is set, uses that fixed value. Otherwise
     * auto-computes optimal zoom to fill the screen with the isometric map.
     */
    public updateOrthoBounds(): void {
        const camera = this.orthoCamera;
        if (!camera || this.activeCamera !== camera) return;

        const w = this.canvas.clientWidth || window.innerWidth;
        const h = Math.max(1, this.canvas.clientHeight || window.innerHeight);
        const aspect = w / h;
        let zoom: number;

        if (this.orthoZoomOverride != null) {
            zoom = this.orthoZoomOverride;
        } else {
            // Auto-fit: compute zoom so the 40x40 isometric diamond fills the screen.
            const mapSize = 40;
            const sinBeta = Math.sin(camera.userData.beta as number);
            const screenHalfW = mapSize / Math.SQRT2 + 3;
            const screenHalfH = (mapSize / Math.SQRT2) * sinBeta * 0.55 + 6;
            zoom = Math.max(screenHalfH, screenHalfW / aspect);
        }

        camera.top = zoom;
        camera.bottom = -zoom;
        camera.left = -zoom * aspect;
        camera.right = zoom * aspect;
        camera.updateProjectionMatrix();
    }

    private setupScene(): void {
        const scene = this.sceneHost.scene;

        // Warm hemisphere light for the low-poly stylized look. Single global fill.
        // 0.55 pre-ACES; raised to compensate for filmic tone mapping's midtone
        // compression (RendererHost pipes the frame through ACES).
        const light = new HemisphereLight(PALETTE.LIGHT_DIFFUSE.clone(), PALETTE.LIGHT_GROUND.clone(), 0.75);
        light.name = 'light';
        light.userData.persistent = true; // survives cleanupScene
        scene.add(light);

        // The hero torch - created once here, owned by Game. Dormant until
        // Champion.enableTorch parents it to the hero and raises intensity.
        this.heroTorch = new PointLight(new Color(1.0, 0.62, 0.28), 0, 9, 1);
        this.heroTorch.name = 'heroTorch';
        this.heroTorch.position.set(0, 1.4, 0);
        this.heroTorch.userData.persistent = true;
        scene.add(this.heroTorch);

        // Fixed isometric camera with orthographic projection (menu/boot).
        // Babylon ArcRotateCamera(alpha=-45deg, beta=1.05, radius=50, target=(20,0,20)).
        const alpha = -Math.PI / 4;
        const beta = 1.05;
        const radius = 50;
        const target = new Vector3(20, 0, 20);
        const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 1000);
        camera.name = 'camera';
        camera.userData.persistent = true;
        camera.userData.beta = beta;
        const sinBeta = Math.sin(beta);
        camera.position.set(
            target.x + radius * sinBeta * Math.cos(alpha),
            target.y + radius * Math.cos(beta),
            target.z + radius * sinBeta * Math.sin(alpha),
        );
        camera.lookAt(target);
        scene.add(camera);
        this.orthoCamera = camera;
        this.activeCamera = camera;
    }

    /** Swap the camera the composer renders with (gameplay hero-follow camera). */
    public setActiveCamera(camera: Camera): void {
        this.activeCamera = camera;
        this.rendererHost?.setCamera(camera);
        if (camera === this.orthoCamera) this.updateOrthoBounds();
    }

    public getActiveCamera(): Camera {
        return this.activeCamera;
    }

    /** Restore the fixed menu/boot ortho camera (used on state teardown). */
    public restoreDefaultCamera(): void {
        this.setActiveCamera(this.orthoCamera);
    }

    /** Background clear color (Babylon scene.clearColor). */
    public setClearColor(c: RGBA): void {
        this.rendererHost?.renderer.setClearColor(new Color(c.r, c.g, c.b), c.a);
    }

    /**
     * Late-wave performance trim: swap the post-fx between the configured
     * baseline and a reduced set. Render-quality only - gameplay untouched.
     */
    public setPostFxReduced(reduced: boolean): void {
        this.rendererHost?.setPostFxReduced(reduced);
    }

    /**
     * Clean up the scene by disposing all meshes and resources.
     * Called when transitioning between states to ensure a clean slate.
     * Objects flagged userData.persistent (global lights, ortho camera)
     * survive; cached GLB source assets are container-owned and never in
     * the scene graph between runs.
     */
    public cleanupScene(): void {
        const scene = this.sceneHost.scene;

        // Dispose all live particle systems first (always state-owned).
        for (const ps of this.sceneHost.particleSystems.slice()) {
            try { (ps as { dispose?: () => void }).dispose?.(); } catch (_) { /* already disposed */ }
        }

        // Dispose every non-persistent top-level object and its subtree.
        // Geometry is freed unless cache-owned; materials only when a node is
        // flagged ownedMaterial (state exit() is responsible for state-owned
        // per-instance materials - same contract as the Babylon version).
        for (const child of scene.children.slice()) {
            if (child.userData.persistent) continue;
            try {
                disposeMesh(child);
            } catch (_) { /* already disposed */ }
        }

        // Clear all per-frame hooks. States must not rely on hooks surviving a
        // state change (Babylon cleared onBeforeRenderObservable here too).
        this.sceneHost.onBeforeRender.clear();
        this.sceneHost.onAnimUpdate.clear();
        this.sceneHost.animationsEnabled = true;

        // Reset the camera to the boot ortho camera in case the exiting state
        // owned the active one (its object just got disposed with the scene).
        this.restoreDefaultCamera();

        console.log('Scene thoroughly cleaned for state transition');
    }

    public pause(): void {
        if (this._isPaused) {
            console.log('Game already paused, ignoring pause request');
            return;
        }

        console.log('Pausing game');
        this._isPaused = true;

        // Freeze ALL animation evaluation in one flag. This pauses GLB skeletal
        // animation mixers + every tween without removing them, so resume() can
        // simply re-enable evaluation.
        this.sceneHost.animationsEnabled = false;

        for (const ps of this.sceneHost.particleSystems) {
            (ps as { stop?: () => void }).stop?.();
        }

        // No render-loop swap: the single permanent loop installed in start()
        // keeps rendering every frame, and _isPaused makes frameTick() skip the
        // game update while still drawing the scene + pause UI.
        try {
            if (this.pauseScreen) {
                console.log('Showing pause screen');
                this.pauseScreen.show();
            }
        } catch (error) {
            console.error('Error showing pause screen:', error);
        }

        document.dispatchEvent(new CustomEvent('gamePaused'));
    }

    public resume(): void {
        if (!this._isPaused) {
            console.log('Game not paused, ignoring resume request');
            return;
        }

        console.log('Resuming game');

        try {
            if (this.pauseScreen) {
                console.log('Hiding pause screen');
                this.pauseScreen.hide();
            }
        } catch (error) {
            console.error('Error hiding pause screen:', error);
        }

        this._isPaused = false;

        // Re-enable animation evaluation (see pause()). Mixers/tweens resume
        // from where they were - nothing is recreated.
        this.sceneHost.animationsEnabled = true;

        for (const ps of this.sceneHost.particleSystems) {
            (ps as { start?: () => void }).start?.();
        }

        document.dispatchEvent(new CustomEvent('gameResumed'));
    }

    public getIsPaused(): boolean {
        return this._isPaused;
    }

    /** The torch light owned by Game (parented to origin until activated).
     *  Champion.enableTorch reparents it to the hero mesh and sets intensity. */
    public getHeroTorch(): PointLight {
        return this.heroTorch;
    }

    /** True when WebGL context creation failed (no GPU rendering at all). */
    public isGpuUnavailable(): boolean {
        return this.gpuUnavailable;
    }

    /** Visible explanation for the black canvas when no GPU API exists. */
    private showGpuUnavailableBanner(): void {
        const div = document.createElement('div');
        div.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;' +
            'background:#7a1f1f;color:#fff;font:14px sans-serif;padding:10px 16px;text-align:center;';
        div.textContent = 'This browser has no GPU rendering support (WebGL unavailable) - the game cannot be displayed.';
        document.body.appendChild(div);
    }

    /** The scene host: THREE scene + update buses + particle registry. */
    public getScene(): SceneHost {
        return this.sceneHost;
    }

    public getRendererHost(): RendererHost {
        return this.rendererHost;
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
        el.style.display = ''; // revert the inline 'none' -> CSS default (flex)
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

    /** Register a state implementation (used to swap the survivors stub for
     *  the real state as the migration lands). */
    public registerState(name: string, state: GameState): void {
        this.stateManager.registerState(name, state);
    }
}
