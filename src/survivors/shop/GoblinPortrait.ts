import {
    AnimationGroup, ArcRotateCamera, AssetContainer, Color3, Color4, DirectionalLight,
    Engine, HemisphericLight, LoadAssetContainerAsync, Scene, Vector3,
} from '@babylonjs/core';

const GOBLIN_URL = 'assets/goblin_a_traveling_merchant.glb';

/**
 * Gribble's live portrait for the on-screen shop.
 *
 * Owns its OWN `<canvas>` + WebGL Engine + Scene + camera + light — completely
 * isolated from the main game scene. This is deliberate: the main scene's
 * post-processing pipeline is bound to the main camera, and Game.guardActiveCamera,
 * the render-health watchdog, and the camera-zoom feature ALL act on the single
 * `scene.activeCamera`. Rendering the goblin via a second viewport camera on the
 * main scene would entangle all three (the exact systems the project guards
 * hardest — see CLAUDE.md black-screen invariants). A separate engine touches none
 * of them.
 *
 * Session-scoped singleton (see getGoblinPortrait): created once, re-mounted into
 * each shop, its render loop runs ONLY while the shop is open. Never disposed per
 * run — same "load once, keep for the session" discipline as the cached GLB
 * AssetContainers — so there's no WebGL-context churn or GLB reloads between runs.
 */
export class GoblinPortrait {
    private wrapper: HTMLDivElement;
    private canvas: HTMLCanvasElement;
    private engine: Engine | null = null;
    private scene: Scene | null = null;
    private container: AssetContainer | null = null;
    /** The goblin's idle clip — stored so stop() can halt its animatable and
     *  start() can resume it (Babylon animatables tick independent of the render
     *  loop; an un-stopped group is exactly the animatable-leak class CLAUDE.md warns of). */
    private idleAnim: AnimationGroup | null = null;
    private loadStarted = false;
    private running = false;
    private resizeObserver: ResizeObserver | null = null;
    private resizeScheduled = false;
    // Stable bound render fn so stopRenderLoop targets the same reference. The
    // portrait is cosmetic — a throw here must never bubble into the page.
    private readonly renderFn = () => { try { this.scene?.render(); } catch { /* cosmetic */ } };

    constructor() {
        this.wrapper = document.createElement('div');
        this.wrapper.className = 'goblin-portrait';
        this.canvas = document.createElement('canvas');
        this.canvas.className = 'goblin-portrait__canvas';
        // touch-action none so dragging on the canvas doesn't scroll the shop.
        this.canvas.style.touchAction = 'none';
        this.wrapper.appendChild(this.canvas);
    }

    /** The element to drop into the shop UI (the state hands this to ShopOverlay). */
    public get element(): HTMLElement { return this.wrapper; }

    /** Lazily build the isolated engine/scene/camera/light on first show. */
    private ensureEngine(): void {
        if (this.engine) return;
        // adaptToDeviceRatio → crisp on retina. alpha context (Babylon default) +
        // clearColor alpha 0 → the canvas composites over the shop panel behind it.
        this.engine = new Engine(this.canvas, true, { stencil: false, preserveDrawingBuffer: false }, true);
        const scene = new Scene(this.engine);
        scene.clearColor = new Color4(0, 0, 0, 0);
        this.scene = scene;

        // Fixed framing — no user inputs. Re-aimed at the goblin in frame().
        // alpha = +π/2 puts the camera on the goblin's FRONT (the GLB faces +X).
        const cam = new ArcRotateCamera('goblinCam', Math.PI / 2, 1.25, 4, Vector3.Zero(), scene);
        cam.minZ = 0.05;

        const hemi = new HemisphericLight('goblinHemi', new Vector3(0.2, 1, 0.15), scene);
        hemi.intensity = 0.95;
        hemi.diffuse = new Color3(1.0, 0.95, 0.85);
        hemi.groundColor = new Color3(0.35, 0.30, 0.25);
        const key = new DirectionalLight('goblinKey', new Vector3(-0.4, -0.8, 0.55), scene);
        key.intensity = 1.15;
        key.diffuse = new Color3(1.0, 0.86, 0.62);
    }

    private async load(): Promise<void> {
        if (this.loadStarted || !this.scene) return;
        this.loadStarted = true;
        try {
            const container = await LoadAssetContainerAsync(GOBLIN_URL, this.scene);
            this.container = container;
            container.addAllToScene();
            // Idle clip if the rig has one (goblin idle e.g. "_fight_idle"); else
            // the first group so he's never a frozen T-pose. Stored so stop()/start()
            // can halt + resume it instead of leaking a forever-ticking animatable.
            this.idleAnim = container.animationGroups.find(g => /idle/i.test(g.name))
                ?? container.animationGroups[0] ?? null;
            if (this.running) this.idleAnim?.start(true);
            this.frame();
        } catch (err) {
            console.error('[goblin-portrait] GLB load failed:', err);
            // Allow a later shop open to retry rather than wedging the flag true forever.
            this.loadStarted = false;
        }
    }

    /** Aim the camera at the goblin's bounding-box centre, radius to fit. Robust
     *  to the off-origin GLB pivot — we frame the bounds, not the origin. */
    private frame(): void {
        if (!this.scene || !this.container) return;
        const meshes = this.container.meshes.filter(m => m.getTotalVertices?.() > 0);
        if (meshes.length === 0) return;
        let min = new Vector3(Infinity, Infinity, Infinity);
        let max = new Vector3(-Infinity, -Infinity, -Infinity);
        for (const m of meshes) {
            m.computeWorldMatrix(true);
            const bb = m.getBoundingInfo().boundingBox;
            min = Vector3.Minimize(min, bb.minimumWorld);
            max = Vector3.Maximize(max, bb.maximumWorld);
        }
        const center = min.add(max).scale(0.5);
        const size = max.subtract(min);
        const maxDim = Math.max(size.x, size.y, size.z) || 1;
        const cam = this.scene.activeCamera as ArcRotateCamera;
        // Frame the upper body a touch higher so the face sits centred.
        cam.setTarget(new Vector3(center.x, center.y + size.y * 0.08, center.z));
        cam.radius = maxDim * 1.55;
    }

    /** Mount the wrapper into a parent (the shop's portrait column). */
    public mount(parent: HTMLElement): void { parent.appendChild(this.wrapper); }

    /** Remove the wrapper from the DOM (kept in memory for the next shop). */
    public detach(): void { this.wrapper.remove(); }

    /** Begin rendering (lazily builds the engine + loads the GLB on first call). */
    public start(): void {
        this.ensureEngine();
        void this.load();
        if (!this.running) {
            this.running = true;
            this.engine!.runRenderLoop(this.renderFn);
            if (!this.resizeObserver && typeof ResizeObserver !== 'undefined') {
                this.resizeObserver = new ResizeObserver(() => this.scheduleResize());
                this.resizeObserver.observe(this.wrapper);
            }
        }
        // Resume the idle clip on re-open (null on the very first open until the
        // GLB finishes loading, which starts it itself). Guard on isPlaying so a
        // repeat start() never stacks a second animatable.
        if (this.idleAnim && !this.idleAnim.isPlaying) this.idleAnim.start(true);
        // The canvas only gets its layout size once mounted — resize on the next
        // frame so Babylon picks up the real client dimensions.
        this.scheduleResize();
    }

    /** Resize the engine OUT of the current layout/observer pass. Calling
     *  engine.resize() synchronously inside the ResizeObserver callback mutates
     *  the canvas backing store, re-triggers layout, and throws the benign
     *  "ResizeObserver loop completed with undelivered notifications" — which the
     *  dev-server overlay escalates to a scary error. Deferring via rAF (coalesced
     *  by a flag) breaks the synchronous loop. */
    private scheduleResize(): void {
        if (this.resizeScheduled) return;
        this.resizeScheduled = true;
        requestAnimationFrame(() => {
            this.resizeScheduled = false;
            if (this.running) this.engine?.resize();
        });
    }

    /** Halt the render loop (idle, near-zero cost). The engine/scene persist, but
     *  the idle animatable is stopped and the resize observer disconnected so
     *  nothing keeps ticking/listening while the shop is closed. */
    public stop(): void {
        if (!this.running) return;
        this.running = false;
        this.idleAnim?.stop();
        this.engine?.stopRenderLoop(this.renderFn);
        this.resizeObserver?.disconnect();
        this.resizeObserver = null;
    }
}

// ── Session-scoped singleton ────────────────────────────────────────────────
// One portrait for the whole session; the state borrows it each run. Mirrors the
// module-level GLB container caches elsewhere — created once, never torn down.
let _instance: GoblinPortrait | null = null;
export function getGoblinPortrait(): GoblinPortrait {
    if (!_instance) _instance = new GoblinPortrait();
    return _instance;
}
