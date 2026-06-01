import {
  Scene, Vector3, FreeCamera, AssetContainer, AnimationGroup, Mesh, TransformNode, Quaternion, Skeleton, Material,
} from '@babylonjs/core';
import { Game } from '../engine/Game';

// Phase durations (seconds) — total ~2.2s. See spec 2026-06-01-boss-entrance-cinematic.
const GLIDE_IN_S = 0.6;
const HOLD_S = 1.0;
const GLIDE_OUT_S = 0.6;
const TOTAL_S = GLIDE_IN_S + HOLD_S + GLIDE_OUT_S;

const BOSS_SCALE = 2.2;                            // match MilestoneBoss model scale
const FRAME_OFFSET = new Vector3(0, 11, -9);       // camera pose relative to the boss
const LOOK_HEIGHT = 2;                             // look at the boss/hero chest, not feet
// Clamp the per-frame clock step. The first render of the (un-prewarmed) 9 MB
// entrance GLB compiles shaders → a multi-hundred-ms frame stall, which inflates
// engine.getDeltaTime() on the next tick. Without this cap that single spike would
// burn the whole ~2.2s cinematic in one frame and dispose the model before its
// action pose is ever seen. 0.05 = floor of 20 fps; real frames (≤~0.017s) are
// untouched, so timing stays in sync with the scene-driven skeletal animation.
const MAX_FRAME_DELTA_S = 0.05;

/** Smoothstep ease (0..1), clamped. */
function smoothstep(t: number): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

/**
 * Plays a short cinematic when a milestone boss appears: a dramatic "entrance"
 * GLB strikes its action pose at the boss spawn point while the camera glides in,
 * holds, and glides back. Self-contained: owns the temp model + its own clock and
 * drives the scene camera. The gameplay loop freezes the battlefield (early-returns
 * from update) while this is active, so the hero follow-cam never fights us.
 *
 * Camera handoff: snapshot the live follow-cam position+rotation at play() start,
 * drive position+look-target each frame via setTarget(), then HARD-restore the exact
 * snapshot on completion so the top-down follow resumes with zero drift.
 */
export class BossEntranceCinematic {
  private scene: Scene;
  private getCamera: () => FreeCamera | null;
  private assets: Partial<Record<number, AssetContainer>> = {};

  private active = false;
  /** True between play() and materials-ready: frozen, but the pan is held. */
  private warmingUp = false;
  private elapsed = 0;
  private resolveFn: (() => void) | null = null;

  // Live model state (disposed each finish()).
  private holder: Mesh | null = null;
  private animGroups: AnimationGroup[] = [];
  private skeletons: Skeleton[] = [];
  private rootNodes: TransformNode[] = [];

  // Camera key poses.
  private savedPos = new Vector3();
  private savedRot = new Vector3();
  private startLook = new Vector3();
  private bossLook = new Vector3();
  private framePos = new Vector3();

  // Per-frame scratch (no allocation in update()).
  private _pos = new Vector3();
  private _look = new Vector3();

  constructor(game: Game, getCamera: () => FreeCamera | null) {
    this.scene = game.getScene();
    this.getCamera = getCamera;
  }

  /** tier (1..3) -> preloaded entrance container. */
  setEntranceAssets(map: Partial<Record<number, AssetContainer>>): void {
    this.assets = map;
  }

  hasEntrance(tier: number): boolean {
    return !!this.assets[tier];
  }

  isActive(): boolean {
    return this.active;
  }

  /**
   * Begin the cinematic. Sets up the model + camera snapshot synchronously (so
   * isActive() is true immediately), then resolves when update() reaches the end.
   * Resolves immediately (no-op) if the asset or camera is missing.
   */
  play(tier: number, spawnPos: Vector3, heroPos: Vector3): Promise<void> {
    const asset = this.assets[tier];
    const camera = this.getCamera();
    if (!asset || !camera) return Promise.resolve();

    // Build + verify the model FIRST. A failure here can never strand the camera
    // panning over an empty stage — we no-op cleanly and the boss spawns normally.
    if (!this.instantiate(asset, spawnPos, heroPos)) {
      this.disposeModel();
      return Promise.resolve();
    }

    // Freeze IMMEDIATELY (active=true) so the milestone wave can't be flagged clear
    // while the boss spawn is deferred, then HOLD the pan (warmingUp) until the cloned
    // PBR materials compile to readiness. Under scene.blockMaterialDirtyMechanism a
    // runtime-cloned material otherwise never reports isReady → the renderer SILENTLY
    // SKIPS the mesh → invisible (the "camera pans but nothing shows" cause). The
    // compile hides inside the freeze; the pan begins the moment the model can render.
    this.active = true;
    this.warmingUp = true;
    this.elapsed = 0;

    this.savedPos.copyFrom(camera.position);
    this.savedRot.copyFrom(camera.rotation);
    this.startLook.set(heroPos.x, heroPos.y + LOOK_HEIGHT, heroPos.z);
    this.bossLook.set(spawnPos.x, spawnPos.y + LOOK_HEIGHT, spawnPos.z);
    this.framePos.set(
      spawnPos.x + FRAME_OFFSET.x,
      spawnPos.y + FRAME_OFFSET.y,
      spawnPos.z + FRAME_OFFSET.z,
    );

    void this.compileModelMaterials().then(() => { this.warmingUp = false; });
    return new Promise<void>(resolve => { this.resolveFn = resolve; });
  }

  /**
   * Compile every unique cloned material to readiness (awaited forceCompilationAsync,
   * the project's proven prewarm pattern), racing a 3s cap so a stuck compile can
   * never soft-lock the run.
   */
  private async compileModelMaterials(): Promise<void> {
    if (!this.holder) return;
    const meshes = this.holder.getChildMeshes(false) as Mesh[];
    const seen = new Set<Material>();
    const jobs: Promise<unknown>[] = [];
    for (const m of meshes) {
      const mat = m.material;
      if (!mat || seen.has(mat)) continue;
      seen.add(mat);
      jobs.push(mat.forceCompilationAsync(m).catch(e => console.warn('[entrance] compile failed', mat.name, e)));
    }
    await Promise.race([
      Promise.all(jobs),
      new Promise<void>(res => setTimeout(res, 3000)),
    ]);
    // post-compile readiness (remove once confirmed)
    for (const m of meshes) {
      if (m.material) console.log('[entrance-diag] post-compile', m.name, 'matReady=', m.material.isReady(m));
    }
  }

  /**
   * Instantiate + place + start the entrance model. Returns true iff a
   * renderable model was produced. NEVER throws: any failure is logged and
   * reported via the return value so play() can no-op cleanly.
   */
  private instantiate(asset: AssetContainer, spawnPos: Vector3, heroPos: Vector3): boolean {
    // Temporarily unblock the dirty mechanism so the freshly-cloned materials get
    // their submesh effects PREPARED on assignment. The scene runs with
    // blockMaterialDirtyMechanism=true (perf), under which a runtime-cloned material's
    // markAsDirty is a no-op → its submesh never flags for an effect → isReady stays
    // false → invisible. Restored in finally so no other material is affected.
    const prevBlock = this.scene.blockMaterialDirtyMechanism;
    this.scene.blockMaterialDirtyMechanism = false;
    try {
      const holder = new Mesh('bossEntranceRoot', this.scene);
      holder.position.copyFrom(spawnPos);
      // Yaw the model to face the hero.
      holder.rotation.y = Math.atan2(heroPos.x - spawnPos.x, heroPos.z - spawnPos.z);
      this.holder = holder;

      // cloneMaterials=true so dispose(false, true) below frees per-instance materials
      // AND their cloned textures (the GLB texture-leak rule in CLAUDE.md).
      const inst = asset.instantiateModelsToScene(name => `entrance_${name}`, true, { doNotInstantiate: true });
      this.animGroups = inst.animationGroups;
      this.skeletons = inst.skeletons;
      this.rootNodes = inst.rootNodes as TransformNode[];

      if (this.rootNodes.length === 0) {
        console.error('[entrance] instantiateModelsToScene returned no rootNodes');
        return false;
      }

      const flip = Quaternion.RotationYawPitchRoll(Math.PI, 0, 0);
      for (const root of inst.rootNodes) {
        const tn = root as TransformNode;
        tn.parent = holder;
        tn.scaling.scaleInPlace(BOSS_SCALE);
        if (tn.rotationQuaternion) {
          tn.rotationQuaternion = flip.multiply(tn.rotationQuaternion);
        } else {
          tn.rotation.y += Math.PI;
        }
      }

      // The entrance rig is a fresh, STATIC, un-prewarmed skinned model that is
      // never registered as a shadow caster (unlike in-game bosses) and never
      // moves. Its frustum-cull box is the un-posed BIND pose, so the active-mesh
      // pass can skip it entirely → invisible. Force-include + force-visible every
      // cloned mesh (the EnemyManager prewarm's own anti-cull idiom) and compile
      // the cloned PBR shader up front so it doesn't pop in.
      const meshes = holder.getChildMeshes(false) as Mesh[];
      for (const m of meshes) {
        m.setEnabled(true);
        m.isVisible = true;
        m.alwaysSelectAsActiveMesh = true; // defeat frustum culling on the static skinned rig
      }
      holder.alwaysSelectAsActiveMesh = true;

      // Feet-on-ground offset — in its OWN guard so a degenerate/throwing skinned
      // bind box (151-joint rig, mesh nodes with T=None) can never abort the build
      // or teleport the model out of frame. Worst case: feet sit at y=0.
      let feetOffset = 0;
      try {
        holder.computeWorldMatrix(true);
        const rawOffset = -holder.getHierarchyBoundingVectors(true).min.y;
        if (Number.isFinite(rawOffset) && Math.abs(rawOffset) < 50) feetOffset = rawOffset;
      } catch (e) {
        console.warn('[entrance] feet-offset bounding failed; using 0', e);
      }
      for (const root of inst.rootNodes) {
        (root as TransformNode).position.y += feetOffset;
      }

      // Play the IN-PLACE "city_idle" pose, looped for the cinematic's duration.
      // NOT "city_action": that clip is a full fly-in entrance (root motion of
      // ~37 units, authored for its own baked camera) — under our static spotlight
      // camera it flings the rig off-screen. city_idle holds the boss at the spawn
      // point (≤0.17u motion), which is what a camera-pan reveal wants.
      for (const ag of inst.animationGroups) ag.stop();
      const pose = inst.animationGroups.find(ag => ag.name.toLowerCase().includes('idle'))
        ?? inst.animationGroups.find(ag => ag.name.toLowerCase().includes('action'))
        ?? inst.animationGroups[0];
      if (pose) pose.start(true);

      // --- ENTRANCE-DIAG (remove once confirmed) ---
      const cam = this.getCamera();
      const planes = cam ? this.scene.frustumPlanes : null;
      console.log('[entrance-diag] rootNodes=', inst.rootNodes.length,
        'meshes=', meshes.length,
        'skeletons=', inst.skeletons.length, 'bones=', inst.skeletons[0]?.bones.length,
        'animGroups=', inst.animationGroups.map(a => a.name),
        'holderPos=', holder.position.asArray(),
        'feetOffset=', feetOffset);
      for (const m of meshes) {
        console.log('[entrance-diag]', m.name,
          'verts=', m.getTotalVertices(),
          'enabled=', m.isEnabled(), 'isVisible=', m.isVisible, 'visibility=', m.visibility,
          'layerMask=0x' + m.layerMask.toString(16),
          'mat=', m.material?.name, 'matReady=', m.material?.isReady(m),
          'skeleton=', m.skeleton?.name,
          'centerWorld=', m.getBoundingInfo().boundingBox.centerWorld.toString(),
          'inFrustum=', planes ? m.isInFrustum(planes) : 'n/a');
      }
      // --- END ENTRANCE-DIAG ---

      return meshes.length > 0;
    } catch (e) {
      console.error('[entrance] instantiate threw', e);
      return false;
    } finally {
      this.scene.blockMaterialDirtyMechanism = prevBlock;
    }
  }

  /** Advance the cinematic on the RAW (unscaled) frame delta. */
  update(deltaTime: number): void {
    if (!this.active) return;
    const camera = this.getCamera();
    if (!camera) { this.finish(); return; }

    // Hold the frozen frame (no camera move, no clock advance) until the model's
    // materials have compiled — so the pan never reveals an un-rendered (invisible)
    // model. A brief dramatic "everything stops" beat, then the camera glides.
    if (this.warmingUp) return;

    this.elapsed += Math.min(deltaTime, MAX_FRAME_DELTA_S);

    if (this.elapsed < GLIDE_IN_S) {
      const s = smoothstep(this.elapsed / GLIDE_IN_S);
      Vector3.LerpToRef(this.savedPos, this.framePos, s, this._pos);
      Vector3.LerpToRef(this.startLook, this.bossLook, s, this._look);
    } else if (this.elapsed < GLIDE_IN_S + HOLD_S) {
      this._pos.copyFrom(this.framePos);
      this._look.copyFrom(this.bossLook);
    } else if (this.elapsed < TOTAL_S) {
      const s = smoothstep((this.elapsed - GLIDE_IN_S - HOLD_S) / GLIDE_OUT_S);
      Vector3.LerpToRef(this.framePos, this.savedPos, s, this._pos);
      Vector3.LerpToRef(this.bossLook, this.startLook, s, this._look);
    } else {
      this.finish();
      return;
    }

    camera.position.copyFrom(this._pos);
    camera.setTarget(this._look);
  }

  private finish(): void {
    const camera = this.getCamera();
    if (camera) {
      camera.position.copyFrom(this.savedPos);
      camera.rotation.copyFrom(this.savedRot);
    }
    this.disposeModel();
    this.active = false;
    this.warmingUp = false;
    this.elapsed = 0;
    const r = this.resolveFn;
    this.resolveFn = null;
    if (r) r();
  }

  private disposeModel(): void {
    for (const ag of this.animGroups) ag.dispose();
    for (const sk of this.skeletons) sk.dispose();
    for (const root of this.rootNodes) root.dispose(false, true); // free cloned mats + textures
    this.holder?.dispose(false, true);
    this.animGroups = [];
    this.skeletons = [];
    this.rootNodes = [];
    this.holder = null;
  }

  /**
   * Run abandoned mid-cinematic (exit()): restore the camera and free the model.
   * Does NOT resolve the pending promise — the deferred boss spawn is guarded and
   * must not fire into a torn-down run.
   */
  dispose(): void {
    if (this.active) {
      const camera = this.getCamera();
      if (camera) {
        camera.position.copyFrom(this.savedPos);
        camera.rotation.copyFrom(this.savedRot);
      }
    }
    this.disposeModel();
    this.active = false;
    this.warmingUp = false;
    this.resolveFn = null;
  }
}
