import {
  Scene, Vector3, FreeCamera, AssetContainer, AnimationGroup, Mesh, TransformNode, Quaternion, Skeleton,
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

    this.active = true;
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

    this.instantiate(asset, spawnPos, heroPos);
    return new Promise<void>(resolve => { this.resolveFn = resolve; });
  }

  private instantiate(asset: AssetContainer, spawnPos: Vector3, heroPos: Vector3): void {
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

    // Feet-on-ground offset.
    holder.computeWorldMatrix(true);
    const bbox = holder.getHierarchyBoundingVectors(true);
    const feetOffset = -bbox.min.y;
    for (const root of inst.rootNodes) {
      (root as TransformNode).position.y += feetOffset;
    }

    // Play the dramatic "city_action" pose, looped for the cinematic's duration.
    for (const ag of inst.animationGroups) ag.stop();
    const action = inst.animationGroups.find(ag => ag.name.toLowerCase().includes('action'))
      ?? inst.animationGroups[0];
    if (action) action.start(true);
  }

  /** Advance the cinematic on the RAW (unscaled) frame delta. */
  update(deltaTime: number): void {
    if (!this.active) return;
    const camera = this.getCamera();
    if (!camera) { this.finish(); return; }

    this.elapsed += deltaTime;

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
    this.resolveFn = null;
  }
}
