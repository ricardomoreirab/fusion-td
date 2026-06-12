import {
    AbstractMesh, AnimationGroup, AssetContainer, LoadAssetContainerAsync,
    Matrix, Scene, Skeleton, TransformNode, Vector3, Viewport,
} from '@babylonjs/core';
import { pickBark, BarkCategory } from './GribbleBarks';

const CART_URL = 'assets/travelling_merchants_mobile_shop.glb';
const GOBLIN_URL = 'assets/goblin_a_traveling_merchant.glb';
/** World units the cart is normalised to. */
const CART_HEIGHT = 3.2;
/** Goblin stands hero-ish height. */
const GOBLIN_HEIGHT = 1.5;
/** Where the goblin stands relative to the stand root (beside the cart). */
const GOBLIN_OFFSET = new Vector3(1.6, 0, 0.6);
/** Seconds a bark bubble stays up (last 0.5s fade out). */
const BARK_SECONDS = 3.5;
/** Seconds of pack-up shrink before the stand despawns. */
const DEPART_SECONDS = 0.4;
/** Hero within this range opens the shop… */
export const SHOP_OPEN_RANGE = 4;
/** …and must leave this range before it can re-open (hysteresis). */
export const SHOP_REOPEN_RANGE = 6;
/** Seconds of "setting up" before the shop becomes interactive. */
export const SHOP_SETUP_SECONDS = 5;

// Module-level container cache (PropField/_glbAssets pattern): load once per
// session, instantiate per spawn. Containers are deliberately NEVER disposed
// by the stand — they own the shared geometry/materials/textures that every
// future spawn re-instantiates from.
const _containers: Record<string, AssetContainer> = {};
const _pending: Record<string, Promise<AssetContainer> | undefined> = {};

async function loadContainer(scene: Scene, url: string): Promise<AssetContainer> {
    if (_containers[url]) return _containers[url];
    if (!_pending[url]) {
        _pending[url] = LoadAssetContainerAsync(url, scene)
            .then(c => { _containers[url] = c; return c; })
            .catch(err => { delete _pending[url]; throw err; });
    }
    return _pending[url]!;
}

type StandState = 'none' | 'arriving' | 'open' | 'departing';

/** The traveling merchant: cart + goblin GLBs spawned near the hero after a
 *  wave clear. Owns its instantiated meshes/anim-groups/skeletons and a DOM
 *  speech bubble; everything per-spawn is released in despawn()/dispose()
 *  (cached AssetContainers persist for the next spawn). */
export class MerchantStand {
    private state: StandState = 'none';
    private root: TransformNode | null = null;
    private instancedMeshes: AbstractMesh[] = [];
    private animGroups: AnimationGroup[] = [];
    private skeletons: Skeleton[] = [];
    private bubble: HTMLDivElement | null = null;
    private bubbleTimer = 0;
    private departTimer = 0;
    private disposed = false;
    /** Bark requested before the GLBs finished building — replayed on build. */
    private pendingBark: BarkCategory | null = null;
    /** Generation counter: a despawn()/respawn() while a build() is awaiting
     *  its GLBs bumps this, so the stale build returns instead of
     *  instantiating orphaned meshes. */
    private buildSeq = 0;

    // Scratch objects reused by the per-frame bubble projection so it doesn't
    // allocate (same pattern as OffscreenEnemyIndicators).
    private _scratchProject: Vector3 = new Vector3();
    private _scratchHead: Vector3 = new Vector3();
    private _scratchViewport: Viewport = new Viewport(0, 0, 1, 1);
    private _identityMat: Matrix = Matrix.Identity();

    constructor(
        private scene: Scene,
        /** DOM layer for the speech bubble (gameUI fx layer). */
        private bubbleParent: HTMLElement,
    ) {}

    public getState(): StandState { return this.state; }
    public isInteractive(): boolean { return this.state === 'open'; }

    public position(): Vector3 | null {
        return this.root ? this.root.position : null;
    }

    /** Spawn cart+goblin at (x, z). Async (GLB load on first call); the stand
     *  is 'arriving' immediately so game logic can run its 5s setup timer. */
    public spawn(x: number, z: number): void {
        if (this.disposed || this.state !== 'none') return;
        this.state = 'arriving';
        void this.build(x, z, ++this.buildSeq);
    }

    private async build(x: number, z: number, seq: number): Promise<void> {
        let cart: AssetContainer, goblin: AssetContainer;
        try {
            [cart, goblin] = await Promise.all([
                loadContainer(this.scene, CART_URL),
                loadContainer(this.scene, GOBLIN_URL),
            ]);
        } catch (err) {
            console.error('[merchant] GLB load failed — merchant stays away:', err);
            if (seq === this.buildSeq && (this.state === 'arriving' || this.state === 'open')) this.state = 'none';
            return;
        }
        // A despawn()/dispose() (or a later respawn) while the load was in
        // flight bumped buildSeq — this build is stale, instantiate nothing.
        if (this.disposed || seq !== this.buildSeq) return;
        // 'open' is reachable mid-load when the 5s setup timer beats a slow
        // network; both states still want the meshes.
        if (this.state !== 'arriving' && this.state !== 'open') return;

        this.root = new TransformNode('merchant_root', this.scene);
        this.root.position.set(x, 0, z);

        this.instantiate(cart, 'merchant_cart', CART_HEIGHT, Vector3.Zero());
        this.instantiate(goblin, 'merchant_goblin', GOBLIN_HEIGHT, GOBLIN_OFFSET);

        // Play the goblin's idle animation if it has one. No name-blind
        // fallback: the cart GLB ships a stray Camera turntable action that
        // must never autoplay.
        const idle = this.animGroups.find(g => /idle/i.test(g.name));
        idle?.start(true);

        // Replay a bark that fired while the GLBs were still loading.
        if (this.pendingBark) {
            const category = this.pendingBark;
            this.pendingBark = null;
            this.bark(category);
        }
    }

    /** Instantiate a container under root, normalised to `targetHeight` with
     *  its bounding-box bottom-center re-seated on the ground at `offset`
     *  (Sketchfab/FBX pack pivots are off-origin — never trust the pivot).
     *  cloneMaterials=false: the merchant never flash-hits, so the clones
     *  share the container-owned materials (leak-free by construction);
     *  doNotInstantiate clones meshes so the rigged goblin gets its own
     *  skeleton (same rationale as Champion's GLB path). */
    private instantiate(container: AssetContainer, prefix: string, targetHeight: number, offset: Vector3): void {
        const inst = container.instantiateModelsToScene(
            name => `${prefix}_${name}`,
            false,
            { doNotInstantiate: true },
        );
        for (const g of inst.animationGroups) g.stop();
        this.animGroups.push(...inst.animationGroups);
        this.skeletons.push(...inst.skeletons);

        const rootPos = this.root!.position;
        for (const node of inst.rootNodes) {
            node.parent = this.root;
            if (node instanceof AbstractMesh) {
                node.isPickable = false;
                this.instancedMeshes.push(node);
            }
            for (const m of node.getChildMeshes()) {
                m.isPickable = false;
                this.instancedMeshes.push(m);
            }

            // Refresh world matrices BEFORE measuring — bounding-box
            // minimumWorld/maximumWorld are stale until then.
            const tn = node as TransformNode;
            tn.computeWorldMatrix(true);
            for (const m of tn.getChildMeshes()) m.computeWorldMatrix(true);
            const { min, max } = tn.getHierarchyBoundingVectors(true);

            const height = Math.max(0.001, max.y - min.y);
            const k = targetHeight / height;

            // Bounds in root-local space (root carries translation only).
            const centerX = (min.x + max.x) / 2 - rootPos.x;
            const centerZ = (min.z + max.z) / 2 - rootPos.z;
            const bottomY = min.y - rootPos.y;

            // node.scaling acts inside the node's own translation, so a point
            // p moves to p0 + k·(p − p0) around the node position p0. Solve
            // for the position that puts the box's bottom-center at `offset`.
            const p0x = tn.position.x, p0y = tn.position.y, p0z = tn.position.z;
            tn.scaling.scaleInPlace(k);
            tn.position.set(
                offset.x - k * (centerX - p0x),
                offset.y - k * (bottomY - p0y),
                offset.z - k * (centerZ - p0z),
            );
        }
    }

    /** The 5s setup finished — shop is open for business. */
    public setOpen(): void {
        if (this.state !== 'arriving') return;
        this.state = 'open';
        this.bark('arrive');
    }

    /** Show a speech-bubble line above the goblin's head. Barks fired before
     *  the GLBs finish loading are deferred and replayed once built. */
    public bark(category: BarkCategory): void {
        if (this.disposed) return;
        if (!this.root) {
            this.pendingBark = category;
            return;
        }
        if (!this.bubble) {
            this.bubble = document.createElement('div');
            this.bubble.className = 'merchant-bubble';
            this.bubbleParent.appendChild(this.bubble);
        }
        this.bubble.textContent = pickBark(category);
        this.bubble.style.opacity = '1';
        this.bubbleTimer = BARK_SECONDS;
        this.positionBubble();
    }

    public heroInRange(heroPos: Vector3, range: number): boolean {
        if (!this.root) return false;
        const dx = heroPos.x - this.root.position.x;
        const dz = heroPos.z - this.root.position.z;
        return dx * dx + dz * dz <= range * range;
    }

    /** Pack up and leave: brief shrink, then despawn. */
    public depart(): void {
        if (this.state === 'none' || this.state === 'departing') return;
        if (!this.root) {
            // Build still in flight — cancel it outright (no meshes to shrink).
            this.despawn();
            return;
        }
        this.state = 'departing';
        this.departTimer = DEPART_SECONDS;
        this.bark('leave');
    }

    /** Per-frame: bubble projection + fade, depart shrink. */
    public update(dt: number): void {
        if (this.bubble && this.bubbleTimer > 0) {
            this.bubbleTimer -= dt;
            if (this.bubbleTimer <= 0.5) {
                this.bubble.style.opacity = `${Math.max(0, this.bubbleTimer * 2)}`;
            }
            this.positionBubble();
        }
        if (this.state === 'departing' && this.root) {
            this.departTimer -= dt;
            const f = Math.max(0.001, this.departTimer / DEPART_SECONDS);
            this.root.scaling.set(f, f, f);
            if (this.departTimer <= 0) this.despawn();
        }
    }

    /** Project the goblin's head to CSS pixels and anchor the bubble there.
     *  Projection mirrors OffscreenEnemyIndicators (identity world matrix +
     *  scene transform + camera viewport in render-buffer space), then maps
     *  render px → CSS px via the canvas client size so hardware scaling /
     *  DPR can't drift the bubble. */
    private positionBubble(): void {
        if (!this.bubble || !this.root) return;
        const cam = this.scene.activeCamera;
        if (!cam) return;
        const engine = this.scene.getEngine();
        const sw = engine.getRenderWidth();
        const sh = engine.getRenderHeight();
        cam.viewport.toGlobalToRef(sw, sh, this._scratchViewport);
        this._scratchHead.set(
            this.root.position.x + GOBLIN_OFFSET.x,
            this.root.position.y + GOBLIN_HEIGHT + 0.6,
            this.root.position.z + GOBLIN_OFFSET.z,
        );
        Vector3.ProjectToRef(
            this._scratchHead,
            this._identityMat,
            this.scene.getTransformMatrix(),
            this._scratchViewport,
            this._scratchProject,
        );
        const sp = this._scratchProject;
        if (sp.z <= 0) {
            // Behind the camera — hide rather than mirror across the screen.
            this.bubble.style.display = 'none';
            return;
        }
        this.bubble.style.display = '';
        const canvas = engine.getRenderingCanvas();
        const kx = canvas && sw > 0 ? canvas.clientWidth / sw : 1;
        const ky = canvas && sh > 0 ? canvas.clientHeight / sh : 1;
        this.bubble.style.left = `${sp.x * kx}px`;
        this.bubble.style.top = `${sp.y * ky}px`;
    }

    /** Release everything created by spawn(); cached containers stay for
     *  reuse. Cloned anim groups + skeletons MUST be disposed (each leaks an
     *  animatable / a bone-matrix RawTexture otherwise); meshes dispose with
     *  (false, false) because their materials are container-owned. */
    public despawn(): void {
        this.buildSeq++; // cancel any build still awaiting its GLBs
        for (const g of this.animGroups) { g.stop(); g.dispose(); }
        this.animGroups = [];
        for (const s of this.skeletons) s.dispose();
        this.skeletons = [];
        for (const m of this.instancedMeshes) m.dispose(false, false);
        this.instancedMeshes = [];
        this.root?.dispose();
        this.root = null;
        this.bubble?.remove();
        this.bubble = null;
        this.bubbleTimer = 0;
        this.departTimer = 0;
        this.pendingBark = null;
        this.state = 'none';
    }

    public dispose(): void {
        this.disposed = true;
        this.despawn();
    }
}
