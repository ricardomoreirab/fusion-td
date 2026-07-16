import {
    Box3, Clock, Color, DirectionalLight, HemisphereLight, PerspectiveCamera,
    Vector3, WebGLRenderer,
} from 'three';
import { SceneHost } from '../../engine/three/SceneHost';
import { setArcPosition } from '../../engine/three/math';
import { AnimGroup } from '../../engine/three/AnimGroup';
import { ContainerInstance, loadContainer } from '../../engine/three/assets';

const GOBLIN_URL = 'assets/goblin_a_traveling_merchant.glb';

// Fixed framing — no user inputs. Same ArcRotateCamera contract as before:
// alpha = +π/2 puts the camera on the goblin's FRONT (the GLB faces +X).
const CAM_ALPHA = Math.PI / 2;
const CAM_BETA = 1.25;
// Babylon ArcRotateCamera default vertical fov = 0.8 rad.
const CAM_FOV_DEG = 0.8 * 180 / Math.PI;

/**
 * Gribble's live portrait for the on-screen shop.
 *
 * Owns its OWN `<canvas>` + small WebGLRenderer + Scene + camera + lights —
 * completely isolated from the main game scene. This is deliberate: the main
 * renderer's post-processing composer is bound to the main camera, and
 * Game.guardActiveCamera, the render-health watchdog, and the camera-zoom feature
 * ALL act on the single active camera. Rendering the goblin via the main renderer
 * would entangle all three (the exact systems the project guards hardest — see
 * CLAUDE.md black-screen invariants). A separate renderer touches none of them.
 *
 * Session-scoped singleton (see getGoblinPortrait): created once, re-mounted into
 * each shop, its render loop runs ONLY while the shop is open. Never disposed per
 * run — same "load once, keep for the session" discipline as the cached GLB
 * containers — so there's no WebGL-context churn or GLB reloads between runs.
 */
export class GoblinPortrait {
    private wrapper: HTMLDivElement;
    private canvas: HTMLCanvasElement;
    private renderer: WebGLRenderer | null = null;
    /** Private SceneHost — provides the scene plus the animation bus the GLB
     *  instance's mixer hooks into; ticked only by this portrait's render loop. */
    private host: SceneHost | null = null;
    private camera: PerspectiveCamera | null = null;
    private instance: ContainerInstance | null = null;
    /** The goblin's idle clip — stored so stop() can halt its action and
     *  start() can resume it (a forever-playing action is dead weight while the
     *  shop is closed; same discipline as the old Babylon animatable handling). */
    private idleAnim: AnimGroup | null = null;
    private camTarget = new Vector3(0, 0, 0);
    private camRadius = 4;
    private readonly clock = new Clock();
    private loadStarted = false;
    private running = false;
    private resizeObserver: ResizeObserver | null = null;
    private resizeScheduled = false;
    // Stable bound render fn so setAnimationLoop(null) in stop() halts exactly this
    // loop. The portrait is cosmetic — a throw here must never bubble into the page.
    private readonly renderFn = () => {
        try {
            if (!this.renderer || !this.host || !this.camera) return;
            this.host.tick(this.clock.getDelta());
            this.renderer.render(this.host.scene, this.camera);
        } catch { /* cosmetic */ }
    };

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

    /** Lazily build the isolated renderer/scene/camera/lights on first show. */
    private ensureEngine(): void {
        if (this.renderer) return;
        // alpha: true + clear alpha 0 → the canvas composites over the shop panel.
        this.renderer = new WebGLRenderer({
            canvas: this.canvas, alpha: true, antialias: true,
            stencil: false, preserveDrawingBuffer: false,
        });
        this.renderer.setClearColor(0x000000, 0);
        this.host = new SceneHost();

        this.camera = new PerspectiveCamera(CAM_FOV_DEG, 1, 0.05, 100);
        this.aimCamera(); // re-aimed at the goblin in frame()

        const hemi = new HemisphereLight(
            new Color(1.0, 0.95, 0.85),
            new Color(0.35, 0.30, 0.25),
            0.95,
        );
        hemi.position.set(0.2, 1, 0.15); // Babylon hemi "direction"
        this.host.scene.add(hemi);
        const key = new DirectionalLight(new Color(1.0, 0.86, 0.62), 1.15);
        key.position.set(0.4, 0.8, -0.55); // shines along Babylon's (-0.4,-0.8,0.55)
        this.host.scene.add(key);
        this.host.scene.add(key.target); // target stays at the origin
    }

    /** Apply the fixed arc framing (alpha/beta constant; radius/target from frame()). */
    private aimCamera(): void {
        if (!this.camera) return;
        setArcPosition(this.camera, CAM_ALPHA, CAM_BETA, this.camRadius, this.camTarget);
    }

    private async load(): Promise<void> {
        if (this.loadStarted || !this.host) return;
        this.loadStarted = true;
        try {
            const container = await loadContainer(GOBLIN_URL);
            const instance = container.instantiate(this.host);
            this.instance = instance;
            this.host.scene.add(instance.root);
            // Idle clip if the rig has one (goblin idle e.g. "_fight_idle"); else
            // the first group so he's never a frozen T-pose. Stored so stop()/start()
            // can halt + resume it instead of leaving a forever-playing action.
            this.idleAnim = instance.animationGroups.find(g => /idle/i.test(g.name))
                ?? instance.animationGroups[0] ?? null;
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
        if (!this.camera || !this.instance) return;
        this.instance.root.updateMatrixWorld(true);
        const bounds = new Box3().setFromObject(this.instance.root);
        if (bounds.isEmpty()) return;
        const center = bounds.getCenter(new Vector3());
        const size = bounds.getSize(new Vector3());
        const maxDim = Math.max(size.x, size.y, size.z) || 1;
        // Frame the upper body a touch higher so the face sits centred.
        this.camTarget.set(center.x, center.y + size.y * 0.08, center.z);
        this.camRadius = maxDim * 1.55;
        this.aimCamera();
    }

    /** Mount the wrapper into a parent (the shop's portrait column). */
    public mount(parent: HTMLElement): void { parent.appendChild(this.wrapper); }

    /** Remove the wrapper from the DOM (kept in memory for the next shop). */
    public detach(): void { this.wrapper.remove(); }

    /** Begin rendering (lazily builds the renderer + loads the GLB on first call). */
    public start(): void {
        this.ensureEngine();
        void this.load();
        if (!this.running) {
            this.running = true;
            this.clock.getDelta(); // discard the time accumulated while stopped
            this.renderer!.setAnimationLoop(this.renderFn);
            if (!this.resizeObserver && typeof ResizeObserver !== 'undefined') {
                this.resizeObserver = new ResizeObserver(() => this.scheduleResize());
                this.resizeObserver.observe(this.wrapper);
            }
        }
        // Resume the idle clip on re-open (null on the very first open until the
        // GLB finishes loading, which starts it itself). Guard on isPlaying so a
        // repeat start() never restarts a running clip.
        if (this.idleAnim && !this.idleAnim.isPlaying) this.idleAnim.start(true);
        // The canvas only gets its layout size once mounted — resize on the next
        // frame so the renderer picks up the real client dimensions.
        this.scheduleResize();
    }

    /** Resize the renderer OUT of the current layout/observer pass. Resizing
     *  synchronously inside the ResizeObserver callback mutates the canvas
     *  backing store, re-triggers layout, and throws the benign
     *  "ResizeObserver loop completed with undelivered notifications" — which the
     *  dev-server overlay escalates to a scary error. Deferring via rAF (coalesced
     *  by a flag) breaks the synchronous loop. */
    private scheduleResize(): void {
        if (this.resizeScheduled) return;
        this.resizeScheduled = true;
        requestAnimationFrame(() => {
            this.resizeScheduled = false;
            if (this.running) this.resizeNow();
        });
    }

    private resizeNow(): void {
        if (!this.renderer || !this.camera) return;
        const w = this.canvas.clientWidth || 1;
        const h = this.canvas.clientHeight || 1;
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // crisp on retina
        this.renderer.setSize(w, h, false);
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
    }

    /** Halt the render loop (idle, near-zero cost). The renderer/scene persist, but
     *  the idle action is stopped and the resize observer disconnected so nothing
     *  keeps ticking/listening while the shop is closed. */
    public stop(): void {
        if (!this.running) return;
        this.running = false;
        this.idleAnim?.stop();
        this.renderer?.setAnimationLoop(null);
        this.resizeObserver?.disconnect();
        this.resizeObserver = null;
    }

    /** Full teardown — frees the GLB instance (cloned materials, skeletons, mixer)
     *  and the WebGL context. Not called in the normal session-singleton flow. */
    public dispose(): void {
        this.stop();
        this.idleAnim = null;
        this.instance?.dispose();
        this.instance = null;
        this.renderer?.dispose();
        this.renderer = null;
        this.host = null;
        this.camera = null;
        this.loadStarted = false;
        this.wrapper.remove();
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
