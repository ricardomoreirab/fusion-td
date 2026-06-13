import { Vector3, Mesh, MeshBuilder, StandardMaterial, Color3, Color4, Scene, ParticleSystem, Texture, DynamicTexture, Sound, Animation, AnimationGroup, Skeleton, ShadowGenerator, Observer } from '@babylonjs/core';
import { Game } from '../../engine/Game';
import { EnemyType, StatusEffect } from '../GameTypes';
import { PowerElement } from '../powers/PowerDefinitions';
import { StatusStacks, STATUS_TUNING, type RichStatusKind } from '../powers/StatusModel';
import { type TargetProvider, pickNearestAlive } from './nearestTarget';
import { isCachedMaterial, getCachedMaterial } from '../../engine/rendering/MaterialCache';
import type { SnapshotEnemy } from '../../net/Protocol';

// One-time per-enemy-class log when a GLB has no recognizable death clip, so the
// asset's real clip name can be added to the matcher in _findDeathClip().
const _deathClipWarned = new Set<string>();

// Cached health-bar colors — shared across all enemy instances to avoid per-frame
// allocations. Exported so enemy subclasses that override updateHealthBar() reuse
// the same constants instead of allocating `new Color3(...)` every frame.
// These are assigned (never mutated in place) onto health-bar materials, so
// sharing one instance across all enemies is safe.
export const HEALTH_COLOR_GREEN  = new Color3(0.2, 0.8, 0.2);
export const HEALTH_COLOR_YELLOW = new Color3(0.8, 0.8, 0.2);
export const HEALTH_COLOR_RED    = new Color3(0.8, 0.2, 0.2);

/** Dedicated rendering group for enemy health bars. SurvivorsGameplayState.enter()
 *  configures this group to CLEAR the depth buffer before it renders, so health
 *  bars always draw ON TOP of the enemy mesh — they stay visible no matter how
 *  large the model is (big bosses used to occlude their own bar). */
export const HEALTH_BAR_RENDER_GROUP = 1;

/** Health-fill color band. Bar color changes by SWAPPING between the three
 *  shared cached materials below — never by mutating a material's color, which
 *  would recolor every enemy at once (the materials are shared + frozen). */
export type HealthBarBand = 'green' | 'yellow' | 'red';

/** Shared cached fill material for a band. One frozen StandardMaterial per band
 *  for ALL enemies (was: 1 fresh material per enemy per spawn). */
export function healthBarFillMaterial(scene: Scene, band: HealthBarBand): StandardMaterial {
    const color = band === 'green' ? HEALTH_COLOR_GREEN
        : band === 'yellow' ? HEALTH_COLOR_YELLOW : HEALTH_COLOR_RED;
    return getCachedMaterial(scene, `healthBarFillMat_${band}`, m => {
        m.diffuseColor = color;
        m.specularColor = Color3.Black();
    });
}

// Per-hit emissive tint — module-level constant so flashHit doesn't allocate
// a fresh Color3 on every damage event (every chain-lightning sub-hit etc.).
const HIT_TINT = new Color3(0.85, 0.10, 0.05);
const HIT_FLASH_DURATION_S = 0.1;

// Lazy-loaded shared texture for status-effect particle systems. Particle
// systems that use it must dispose(false) so they don't take the shared texture
// down with them; the `scene.textures` membership check below is a self-healing
// backstop in case any caller forgets and disposes it anyway.
let _statusEffectTexture: Texture | null = null;
export function getStatusEffectTexture(scene: Scene): Texture {
    if (!_statusEffectTexture || scene.textures.indexOf(_statusEffectTexture) === -1) {
        _statusEffectTexture = new Texture('assets/textures/particle.png', scene);
    }
    return _statusEffectTexture;
}

// Hard cap on simultaneously-alive death-burst ParticleSystems. scene.particleSystems
// is walked + updated every frame, so a mass AoE wipe (Frost Nova / Meteor / Whirlwind)
// killing dozens of enemies in a single frame would otherwise spawn dozens of concurrent
// systems and spike the per-frame particle walk for ~1-2s. Past the cap, extra deaths
// skip ONLY the visual poof — the kill, gold reward, and death sound still happen.
let _activeDeathBursts = 0;
const MAX_ACTIVE_DEATH_BURSTS = 18;
/** Reserve a death-burst slot; returns false (caller skips the poof) when the cap is hit. */
export function tryAcquireDeathBurst(): boolean {
    if (_activeDeathBursts >= MAX_ACTIVE_DEATH_BURSTS) return false;
    _activeDeathBursts++;
    return true;
}
/** Release a slot reserved by tryAcquireDeathBurst — call once the system is disposed. */
export function releaseDeathBurst(): void {
    if (_activeDeathBursts > 0) _activeDeathBursts--;
}
/** Reset the budget to zero (EnemyManager teardown) so a missed release from a prior run
 *  can never permanently starve future poofs. */
export function resetDeathBurstBudget(): void {
    _activeDeathBursts = 0;
}

// ── Death-burst teardown reaper ───────────────────────────────────────────────
// Drives stop + dispose of death-burst ParticleSystems from the render loop
// instead of nested setTimeout chains: timers drift under load, pile up in the
// event queue on mass AoE kills, and can fire on already-disposed systems after
// run teardown. One lazily-created observer walks the (tiny, ≤18) live list.
interface BurstTeardown {
    ps: ParticleSystem;
    /** Seconds of emission left before stop() is called. */
    emitRemainingS: number;
    /** Forwarded to ps.dispose(disposeTexture) — false preserves the SHARED
     *  status-effect texture (getStatusEffectTexture singleton). */
    disposeTexture: boolean;
    stopped: boolean;
    /** Set when the system was disposed externally (run teardown). */
    dead: boolean;
}
const _liveBursts: BurstTeardown[] = [];
let _burstReaper: Observer<Scene> | null = null;

/** Emit for `emitS` seconds, then dispose once the last particle expires.
 *  Releases the death-burst budget slot exactly once, even if the run tears
 *  the system down first. Caller must have acquired the slot and started ps. */
export function scheduleDeathBurstTeardown(
    scene: Scene,
    ps: ParticleSystem,
    emitS: number,
    disposeTexture: boolean = true,
): void {
    const entry: BurstTeardown = { ps, emitRemainingS: emitS, disposeTexture, stopped: false, dead: false };
    // Fires on BOTH reaper disposal and external (teardown) disposal.
    ps.onDisposeObservable.addOnce(() => {
        entry.dead = true;
        releaseDeathBurst();
    });
    _liveBursts.push(entry);
    if (_burstReaper) return;
    _burstReaper = scene.onBeforeRenderObservable.add(() => {
        const dt = scene.getEngine().getDeltaTime() / 1000;
        for (let i = _liveBursts.length - 1; i >= 0; i--) {
            const b = _liveBursts[i];
            if (!b.dead) {
                if (!b.stopped) {
                    b.emitRemainingS -= dt;
                    if (b.emitRemainingS <= 0) { b.ps.stop(); b.stopped = true; }
                } else if (!b.ps.isAlive()) {
                    // Emission stopped and the last particle expired.
                    b.ps.dispose(b.disposeTexture); // → onDispose sets dead + releases budget
                }
            }
            if (b.dead) {
                _liveBursts[i] = _liveBursts[_liveBursts.length - 1];
                _liveBursts.pop();
            }
        }
        if (_liveBursts.length === 0 && _burstReaper) {
            scene.onBeforeRenderObservable.remove(_burstReaper);
            _burstReaper = null;
        }
    });
}

export class Enemy {
    /**
     * Global crit provider — set once at run start by SurvivorsGameplayState.
     * Every `takeDamage()` call rolls a crit using these values. Cleared on
     * state exit so menu / non-survivors flows never accidentally inherit
     * stale stats from a prior run.
     */
    public static critProvider: (() => { chance: number; damageMult: number }) | null = null;

    /**
     * Per-frame damage + reward callbacks — set once at run start by
     * SurvivorsGameplayState (replaces the previous document.dispatchEvent
     * CustomEvent flow). Avoids allocating a CustomEvent + detail object per
     * hit; with chain lightning / multishot / AOE on 100+ enemies this used to
     * be the dominant burst GC pressure. Position is passed by reference —
     * callbacks must NOT retain it (consumers read x/y/z only).
     */
    public static onDamageCallback: ((position: Vector3, damage: number, isCrit: boolean, element?: PowerElement) => void) | null = null;
    public static onRewardCallback: ((position: Vector3, reward: number) => void) | null = null;
    /** Render-only globe-curvature hook (infinite map). When set, mesh and
     *  health-bar Y positions sink by drop(x, z) — gameplay `this.position`
     *  stays flat (all distances/AI/network use flat space). Static so host
     *  enemies AND guest render copies share it; wired in startRun and cleared
     *  in SurvivorsGameplayState.exit() like the guest*Redirect statics. */
    public static curveDropFn: ((x: number, z: number) => number) | null = null;
    /** This frame's drop for this enemy — computed once per update/network tick. */
    protected _curveDropY = 0;
    /** Co-op guest only (M4-9): when set, takeDamage reports the hit to the host by id
     *  and applies nothing locally (host-authoritative). Null on host + single-player. */
    public static guestDamageRedirect: ((enemyId: number, amount: number, element?: PowerElement, isCrit?: boolean) => void) | null = null;
    /** Co-op guest only (M4-9 review fix): when set, applyStatusEffect reports the CC/DoT
     *  to the host by id and applies nothing locally. Null on host + single-player. */
    public static guestStatusRedirect: ((enemyId: number, effect: StatusEffect, durationS: number, strength: number) => void) | null = null;
    /** Co-op guest only (M6 A5): when set, applyKnockback reports the push to the host
     *  by id and applies nothing locally. Null on host + single-player. */
    public static guestKnockbackRedirect: ((enemyId: number, dirX: number, dirZ: number, magnitude: number) => void) | null = null;
    /** Fired exactly once per kill from base die() — independent of the visual
     *  death-effect path (which several subclasses override without calling super).
     *  Used for kill-driven gameplay like the cooldown refund. Position by reference. */
    public static onKillCallback: ((position: Vector3) => void) | null = null;
    /** Wired by the gameplay state (a later phase) to a shatter-AoE effect. Fired from
     *  die() when an enemy was shatter-primed. Position is passed by reference — the
     *  consumer must NOT retain the Vector3. */
    public static onShatterCallback:
        | ((position: Vector3, damage: number, radius: number, element: PowerElement,
            status?: { effect: StatusEffect; durationS: number; strength: number }) => void)
        | null = null;

    protected game: Game;
    protected scene: Scene;
    protected mesh: Mesh | null = null;
    protected healthBarMesh: Mesh | null = null;
    protected healthBarBackgroundMesh: Mesh | null = null;
    protected healthBarOutlineMesh: Mesh | null = null;
    /** Current fill-color band — the (shared) fill material is swapped only when
     *  this changes, instead of reassigning a color every frame. */
    protected _barBand: HealthBarBand | null = null;

    // HP-bar tier driven visual tweaks (set via applyHealthBarTier or subclass override).
    // Normal: thin bar. Elite: 1.5× wider, orange frame. Boss: 2.5× wider,
    // segmented into 4 chunks, red glowing frame, name label above.
    protected barTier: 'normal' | 'elite' | 'boss' = 'normal';
    protected barHeightOffset: number = 1.0;
    protected bossLabel: string | null = null;
    protected barSegmentMeshes: Mesh[] = [];
    protected barLabelMesh: Mesh | null = null;
    protected barLabelTexture: DynamicTexture | null = null;
    protected position: Vector3;
    protected speed: number;
    protected originalSpeed: number; // Store original speed for status effects
    protected health: number;
    protected maxHealth: number;
    protected damage: number; // Damage to player when reaching the end
    protected reward: number; // Money reward when killed
    protected alive: boolean = true;
    protected path: Vector3[] = [];
    protected currentPathIndex: number = 0;
    protected originalScale: number = 1.0; // Store original scale for health-based scaling

    // Survivors-mode seek-target fields
    public seekTarget: {
        getPosition: () => Vector3;
        takeDamage?: (amount: number, sourcePos?: Vector3) => void;
        isAlive?: () => boolean;
        /** Drag the hero toward a world point over durationS (boss grab). */
        applyPull?: (towardX: number, towardZ: number, speed: number, durationS: number) => void;
        /** Temporarily slow the hero's move speed (multiplier < 1). */
        applySlow?: (multiplier: number, durationS: number) => void;
    } | null = null;
    public contactDamagePerSecond: number = 10;
    public isElite: boolean = false;
    public eliteDropElement: string | null = null;
    /** Co-op multi-target list. When non-empty, `resolveSeekTarget()` uses
     *  `pickNearestAlive` to select the closest live provider each frame,
     *  enabling two-hero threat. Set by EnemyManager in co-op mode; left empty
     *  in single-player so the legacy `seekTarget` path is used unchanged. */
    public seekTargets: TargetProvider[] = [];
    /** Stable per-run ID assigned by EnemyManager at spawn time.
     *  Defaults to -1 until assigned. Used by the host-authoritative
     *  co-op snapshot so the guest can match a SnapshotEnemy to its
     *  local scene object by ID. Single-player never reads this field. */
    public id: number = -1;

    /** Network type string matching the keys in createEnemyOfType / SpawnMsg.type.
     *  Set by EnemyManager.spawnSurvivorsEnemy (and the split/clone handlers) right
     *  after construction, before the host fires onEnemySpawnedCb.
     *  Defaults to 'basic' as a safe fallback; single-player never reads this. */
    public netType: string = 'basic';

    // Melee-swing tuning (survivors mode). Each subclass overrides these in its
    // constructor; defaults below are tuned for a basic-enemy quick jab.
    // The swing gives the enemy *reach* — without it, passive contactDamagePerSecond
    // never connects against a kiting hero because it requires literal overlap.
    protected meleeRange: number = 1.3;
    protected meleeHitRange: number = 1.6;
    protected meleeHitDamage: number = 12;
    protected meleeWindupDuration: number = 0.3;
    protected meleeStrikeDuration: number = 0.1;
    protected meleeCooldownDuration: number = 0.5;
    protected meleeRootDuringSwing: boolean = true;

    // Melee-swing state machine
    private meleeState: 'idle' | 'windup' | 'strike' | 'cooldown' = 'idle';
    private meleeTimer: number = 0;
    private meleeStrikeHasHit: boolean = false;

    /** AnimationGroups cloned by GLB instantiation. Subclasses register them
     *  here (typically `this.glbAnimationGroups = inst.animationGroups`) so
     *  dispose() can stop+release them. Without this every dead enemy left
     *  ~hundreds of animatables ticking in the scene every frame — the leak
     *  that made each subsequent wave's freeze longer than the last. */
    protected glbAnimationGroups: AnimationGroup[] = [];

    // ── Guest-side network visuals (co-op) ──────────────────────────────────
    // These drive a render-only enemy from host snapshots. They are SEPARATE from
    // each subclass's host-side anim fields (glbWalkAnim/glbCurrentAnim/…) because
    // the subclass update() — which owns those — is NEVER ticked on the guest.
    // Categorised lazily from glbAnimationGroups (which the base already holds).
    private _netWalkAnim: AnimationGroup | null = null;
    private _netAttackAnim: AnimationGroup | null = null;
    private _netCurrentAnim: AnimationGroup | null = null;
    private _netAnimCategorized = false;
    /** Lazy lookup of named GLB skill clips (`<prefix>_skillN`) ↔ snapshot anim
     *  codes 10+N (see SnapshotEnemy.anim). Used by BOTH sides: the host maps
     *  the currently playing clip → code (getNetAnimCode), the guest maps a
     *  received code → clip (_applyNetworkAnim). Cleared with the groups in
     *  _releaseMeshAndAnimations. */
    private _netSkillClips: { ag: AnimationGroup; code: number }[] | null = null;
    /** Guest-only corpse tick (playDeathAnimThenDispose). There is no EnemyManager
     *  corpse list on the guest, so the lingering corpse self-ticks via this
     *  observer; disposeCorpse() removes it so an early teardown can't leave a
     *  per-frame callback firing against a released mesh. */
    private _netCorpseObserver: Observer<Scene> | null = null;
    private _netCorpseOnDisposed: (() => void) | null = null;
    /** Host-authoritative HP the displayed bar eases toward (-1 = uninitialised). */
    private _netHpTarget = -1;

    /** Skeletons cloned by GLB instantiation (`instantiateModelsToScene` with
     *  doNotInstantiate:true does a full Skeleton.clone() per instance). Each
     *  cloned skeleton allocates its OWN bone-matrix RawTexture on first render
     *  (Skeleton.useTextureToStoreBoneMatrices defaults true), freed only by
     *  Skeleton.dispose(). mesh.dispose() does NOT cascade to the skeleton, so
     *  without this every spawn leaked one texture (the steady scene.textures
     *  climb across waves). Subclasses register them via
     *  `this.glbSkeletons = inst.skeletons`. */
    protected glbSkeletons: Skeleton[] = [];

    /** ShadowGenerators this enemy's mesh was registered into (set by EnemyManager
     *  at spawn via setShadowGenerators). _releaseMeshAndAnimations removes the mesh
     *  from each renderList right before disposing it — Babylon never prunes a
     *  disposed mesh from a ShadowGenerator renderList, so without this every
     *  spawned enemy permanently bloats both per-frame shadow passes (the primary
     *  in-run freeze). */
    private _shadowGenerators: ShadowGenerator[] = [];

    /** Death-sequence ("corpse") state. On death the enemy plays its GLB death clip
     *  (or shrinks away if the asset has none), lingers `corpseLingerS`, then frees
     *  its mesh. EnemyManager owns the corpse list + per-frame tick + final release. */
    protected glbDeathAnim: AnimationGroup | null = null;
    /** Seconds a corpse lingers AFTER its death clip finishes before being cleared. */
    protected corpseLingerS: number = 1.0;
    private corpseTimeRemaining: number = 0;
    private corpseHasDeathClip: boolean = false;
    private corpseBaseScale: number = 1;

    // Elemental properties
    protected enemyType: EnemyType = EnemyType.NORMAL;
    protected isFlying: boolean = false;
    protected isHeavy: boolean = false;
    
    // Status effect properties
    protected activeStatusEffects: Map<StatusEffect, { endTime: number, strength: number }> = new Map();
    protected statusEffectParticles: Map<StatusEffect, ParticleSystem> = new Map();
    /** Rich-status stack model (burn/chill/curse/fragile). Legacy CC (slow/
     *  freeze/stun) still lives in activeStatusEffects above. */
    protected statuses: StatusStacks = new StatusStacks();
    private _shatterPrimed: boolean = false;
    private _shatterDamage: number = 0;
    private _shatterRadius: number = 0;
    private _shatterElement: PowerElement = 'ice';
    private _shatterStatus: { effect: StatusEffect; durationS: number; strength: number } | undefined = undefined;
    protected isFrozen: boolean = false;
    protected isStunned: boolean = false;
    protected isConfused: boolean = false;
    protected confusedDirection: Vector3 | null = null;
    protected damageResistance: number = 0;

    // CC immunity windows (prevent perma-CC)
    protected freezeImmunityUntil: number = 0; // timestamp when freeze immunity expires
    protected stunImmunityUntil: number = 0;   // timestamp when stun immunity expires

    // Reused per-frame array to avoid allocating a new array every update
    private _expiredStatusEffects: StatusEffect[] = [];

    // Scratch Vector3 fields — reused every frame to avoid per-frame allocations
    private _scratchDir: Vector3 = new Vector3();
    private _scratchMovement: Vector3 = new Vector3();

    // Hit-flash state: per-instance restore cache + countdown timer. We store the
    // material's ORIGINAL emissiveColor object by reference (not r/g/b numbers and
    // not a clone) — restore reassigns it, so there's zero per-hit allocation AND
    // we never mutate the shared HIT_TINT constant (the old `.set()` path mutated
    // it in place, which corrupted the tint for the whole run). Driven by
    // Enemy.update() — no setTimeout pile-up.
    private _flashRestore: { mat: StandardMaterial; original: Color3 }[] = [];
    private _flashTimeRemaining: number = 0;

    constructor(game: Game, position: Vector3, path: Vector3[], speed: number, health: number, damage: number, reward: number) {
        this.game = game;
        this.scene = game.getScene();
        this.position = position.clone();
        this.path = path;
        this.speed = speed;
        this.originalSpeed = speed;
        this.health = health;
        this.maxHealth = health;
        this.damage = damage;
        this.reward = reward;

        // NOTE: createMesh()/createHealthBar() are intentionally NOT called here.
        // A derived class's field initializers (e.g. `private usingGLB = false`,
        // `private glbWalkAnim = null`, the procedural part refs) run AFTER super()
        // returns — which would CLOBBER every field createMesh() assigns if we built
        // the mesh during super(). That's exactly what silently disabled GLB attack
        // animations: createMesh set usingGLB=true, then the subclass initializer
        // reset it to false, so update()'s attack-switching branch never ran.
        // Each leaf subclass instead calls this._initEnemyVisuals() at the END of its
        // own constructor, guarded by `new.target` so it fires exactly once (only for
        // the concrete leaf — never the intermediate BossEnemy when building a
        // MilestoneBoss), after all field initializers have settled.
    }

    /**
     * Build the mesh + health bar. MUST be called from the END of the concrete
     * (leaf) subclass constructor — see the note in the constructor for why it
     * cannot run during super().
     */
    protected _initEnemyVisuals(): void {
        try {
            this.createMesh();
            if (!this.mesh) {
                console.error('Enemy mesh creation failed');
            }
            this.createHealthBar();
            this._makeHealthBarAlwaysVisible();
        } catch (error) {
            console.error('Error creating enemy:', error);
        }
    }

    /**
     * Create the enemy mesh
     */
    protected createMesh(): void {
        // Create a simple sphere for the enemy
        this.mesh = MeshBuilder.CreateSphere('enemy', {
            diameter: 0.8
        }, this.scene);
        
        // Position at starting position
        this.mesh.position = this.position.clone();
        
        // Create material
        const material = new StandardMaterial('enemyMaterial', this.scene);
        material.diffuseColor = new Color3(0.8, 0.2, 0.2);
        this.mesh.material = material;
    }

    /**
     * Promote this enemy's health bar to a higher visual tier (elite or boss),
     * or adjust its head-height anchor / boss name label. Re-creates the bar
     * meshes so it can be called any time after construction (e.g. by
     * EliteSpawner once the enemy has already been built).
     */
    public applyHealthBarTier(
        tier: 'normal' | 'elite' | 'boss',
        opts?: { heightOffset?: number; label?: string | null },
    ): void {
        this.barTier = tier;
        if (opts?.heightOffset !== undefined) this.barHeightOffset = opts.heightOffset;
        if (opts?.label !== undefined) this.bossLabel = opts.label;
        this._disposeHealthBarMeshes();
        this.createHealthBar();
        this._makeHealthBarAlwaysVisible();
    }

    /**
     * Scale both current and max HP by `mult`. Used by elite promotion and by
     * the orb-pickup global HP buff. Safe to call any time after construction.
     */
    public applyHealthMultiplier(mult: number): void {
        this.health *= mult;
        this.maxHealth *= mult;
    }

    /** Scale this enemy's outgoing damage. Mirror of applyHealthMultiplier; used
     *  by the global difficulty multiplier at spawn. Scales contact DPS + melee
     *  swing (both live in survivors mode) and `damage` (the TD-era path-end
     *  value — inert in survivors since enemies never reach an end, kept only so
     *  the mirror stays complete if TD mode ever returns). */
    public applyDamageMultiplier(mult: number): void {
        this.contactDamagePerSecond *= mult;
        this.meleeHitDamage = Math.round(this.meleeHitDamage * mult);
        this.damage = Math.round(this.damage * mult);
    }

    /**
     * Multiply the enemy's gold reward by `mult` (floored). Used by survivors-mode
     * per-wave scaling so the shop economy keeps pace with rising enemy HP.
     */
    public applyRewardMultiplier(mult: number): void {
        this.reward = Math.floor(this.reward * mult);
    }

    /** Return the (width, height) of the bar based on the current tier. */
    private _barDims(): { width: number; height: number } {
        if (this.barTier === 'boss')  return { width: 2.5, height: 0.18 };
        if (this.barTier === 'elite') return { width: 1.5, height: 0.12 };
        return { width: 1.0, height: 0.08 };
    }

    /**
     * Create health bar for the enemy. Subclasses set `barHeightOffset` (in the
     * constructor, after super()) to anchor it at the top of their head.
     */
    protected createHealthBar(): void {
        if (!this.mesh) return;

        const { width, height } = this._barDims();
        const y = this.position.y + this.barHeightOffset;
        this._barBand = null; // force the fill-material assignment in updateHealthBar

        // All bar materials are shared cached instances (healthBarFillMaterial +
        // the frame/bg variants below) — was 3 fresh StandardMaterials per spawn.

        // Frame: elite/boss get a dedicated glowing outline mesh behind the bar.
        // The basic tier (the bulk of the horde) skips it — its background IS the
        // frame-sized near-black slab, same framed look with one less mesh each.
        if (this.barTier === 'boss' || this.barTier === 'elite') {
            this.healthBarOutlineMesh = MeshBuilder.CreateBox('healthBarOutline', {
                width:  width  + 0.08,
                height: height + 0.06,
                depth:  0.04,
            }, this.scene);
            this.healthBarOutlineMesh.position = new Vector3(this.position.x, y, this.position.z);
            this.healthBarOutlineMesh.material = getCachedMaterial(
                this.scene, `healthBarFrameMat_${this.barTier}`, m => {
                    if (this.barTier === 'boss') {
                        m.diffuseColor  = new Color3(1.0, 0.20, 0.15);
                        m.emissiveColor = new Color3(0.55, 0.10, 0.05);
                    } else {
                        m.diffuseColor  = new Color3(1.0, 0.55, 0.15);
                        m.emissiveColor = new Color3(0.35, 0.18, 0.04);
                    }
                    m.specularColor = Color3.Black();
                });
            this.healthBarOutlineMesh.billboardMode = Mesh.BILLBOARDMODE_ALL;
        }

        // Background. Basic tier: frame-sized near-black slab (doubles as the
        // frame). Elite/boss: classic gray inset behind the fill.
        const basicTier = this.barTier !== 'boss' && this.barTier !== 'elite';
        this.healthBarBackgroundMesh = MeshBuilder.CreateBox('healthBarBg', {
            width:  basicTier ? width  + 0.08 : width,
            height: basicTier ? height + 0.06 : height,
            depth: 0.05,
        }, this.scene);
        this.healthBarBackgroundMesh.position = new Vector3(this.position.x, y, this.position.z);
        this.healthBarBackgroundMesh.material = basicTier
            ? getCachedMaterial(this.scene, 'healthBarBgFrameMat', m => {
                m.diffuseColor  = new Color3(0.05, 0.05, 0.05);
                m.specularColor = Color3.Black();
            })
            : getCachedMaterial(this.scene, 'healthBarBgMat', m => {
                m.diffuseColor  = new Color3(0.3, 0.3, 0.3);
                m.specularColor = Color3.Black();
            });

        // Foreground (health fill) — material assigned by updateHealthBar's band swap.
        this.healthBarMesh = MeshBuilder.CreateBox('healthBar', { width, height, depth: 0.06 }, this.scene);
        this.healthBarMesh.position = new Vector3(this.position.x, y, this.position.z);

        this.healthBarBackgroundMesh.billboardMode = Mesh.BILLBOARDMODE_ALL;
        this.healthBarMesh.billboardMode           = Mesh.BILLBOARDMODE_ALL;

        // Boss-only: 3 thin black dividers carving the bar into 4 chunks
        this.barSegmentMeshes = [];
        if (this.barTier === 'boss') {
            for (let i = 1; i <= 3; i++) {
                const seg = MeshBuilder.CreateBox(`healthBarSeg_${i}`, {
                    width:  0.04,
                    height: height + 0.02,
                    depth:  0.07,
                }, this.scene);
                seg.material = getCachedMaterial(this.scene, 'healthBarSegMat', m => {
                    m.diffuseColor  = Color3.Black();
                    m.specularColor = Color3.Black();
                });
                seg.billboardMode   = Mesh.BILLBOARDMODE_ALL;
                seg.position        = new Vector3(this.position.x, y, this.position.z);
                this.barSegmentMeshes.push(seg);
            }
        }

        // Boss-only: name label above the bar
        if (this.barTier === 'boss' && this.bossLabel) {
            const tex = new DynamicTexture('bossLabelTex', { width: 256, height: 64 }, this.scene, false);
            tex.hasAlpha = true;
            const ctx = tex.getContext() as CanvasRenderingContext2D;
            ctx.clearRect(0, 0, 256, 64);
            ctx.font = 'bold 36px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.strokeStyle = 'black';
            ctx.lineWidth = 6;
            ctx.strokeText(this.bossLabel, 128, 32);
            ctx.fillStyle = '#ff5040';
            ctx.fillText(this.bossLabel, 128, 32);
            tex.update();

            const labelMat = new StandardMaterial('bossLabelMat', this.scene);
            labelMat.diffuseTexture            = tex;
            labelMat.useAlphaFromDiffuseTexture = true;
            labelMat.disableLighting           = true;
            labelMat.emissiveColor             = new Color3(1, 1, 1);
            labelMat.backFaceCulling           = false;
            labelMat.specularColor             = Color3.Black();

            this.barLabelMesh = MeshBuilder.CreatePlane('bossLabel', { width: 2.6, height: 0.65 }, this.scene);
            this.barLabelMesh.material      = labelMat;
            this.barLabelMesh.position      = new Vector3(this.position.x, y + 0.45, this.position.z);
            this.barLabelMesh.billboardMode = Mesh.BILLBOARDMODE_ALL;
            this.barLabelTexture            = tex;
        }

        this.updateHealthBar();
    }

    /**
     * Update the health bar based on current health
     */
    protected updateHealthBar(): void {
        if (!this.mesh || !this.healthBarMesh || !this.healthBarBackgroundMesh) return;

        const { width } = this._barDims();
        const y = this.position.y + this.barHeightOffset - this._curveDropY; // follow the globe drop

        // Calculate health percentage
        const healthPercent = Math.max(0, this.health / this.maxHealth);

        // Update health bar width based on health percentage
        this.healthBarMesh.scaling.x = healthPercent;

        // Adjust position to align left side (offset scales with bar width)
        const offset = (1 - healthPercent) * (width * 0.5);
        this.healthBarMesh.position.x = this.position.x - offset;

        // Update health bar color band (swaps the shared cached material — only
        // when the band actually changes, never a per-frame material write).
        this.applyHealthBarBand(healthPercent);

        // Position outline behind everything
        if (this.healthBarOutlineMesh && !this.healthBarOutlineMesh.isDisposed()) {
            this.healthBarOutlineMesh.position.x = this.position.x;
            this.healthBarOutlineMesh.position.y = y;
            this.healthBarOutlineMesh.position.z = this.position.z;
        }

        // Position health bars above the enemy
        this.healthBarBackgroundMesh.position.x = this.position.x;
        this.healthBarBackgroundMesh.position.y = y;
        this.healthBarBackgroundMesh.position.z = this.position.z;

        this.healthBarMesh.position.y = y;
        this.healthBarMesh.position.z = this.position.z;

        // Boss segments: track frame position, evenly spaced at -0.25/0/+0.25 of width
        if (this.barSegmentMeshes.length > 0) {
            for (let i = 0; i < this.barSegmentMeshes.length; i++) {
                const seg = this.barSegmentMeshes[i];
                if (!seg || seg.isDisposed()) continue;
                const segOffset = ((i + 1) * 0.25 - 0.5) * width; // -0.25w, 0, +0.25w
                seg.position.x = this.position.x + segOffset;
                seg.position.y = y;
                seg.position.z = this.position.z;
            }
        }

        if (this.barLabelMesh && !this.barLabelMesh.isDisposed()) {
            this.barLabelMesh.position.x = this.position.x;
            this.barLabelMesh.position.y = y + 0.45;
            this.barLabelMesh.position.z = this.position.z;
        }
    }

    /** Swap the fill mesh's shared cached material when the health band changes.
     *  Shared by the base and subclass updateHealthBar overrides. */
    protected applyHealthBarBand(healthPercent: number): void {
        const band: HealthBarBand = healthPercent > 0.6 ? 'green'
            : healthPercent > 0.3 ? 'yellow' : 'red';
        if (band !== this._barBand && this.healthBarMesh) {
            this._barBand = band;
            this.healthBarMesh.material = healthBarFillMaterial(this.scene, band);
        }
    }

    /** Dispose only the health-bar meshes (keeps the enemy alive). Bar materials
     *  are SHARED cached instances — never dispose them here (that would break
     *  every other live bar referencing them; clearMaterialCache() frees them on
     *  run teardown). Only the per-instance boss label material/texture is freed. */
    private _disposeHealthBarMeshes(): void {
        if (this.healthBarMesh) {
            this.healthBarMesh.dispose();
            this.healthBarMesh = null;
        }
        if (this.healthBarBackgroundMesh) {
            this.healthBarBackgroundMesh.dispose();
            this.healthBarBackgroundMesh = null;
        }
        if (this.healthBarOutlineMesh) {
            this.healthBarOutlineMesh.dispose();
            this.healthBarOutlineMesh = null;
        }
        for (const seg of this.barSegmentMeshes) {
            if (seg && !seg.isDisposed()) seg.dispose();
        }
        this.barSegmentMeshes = [];
        if (this.barLabelMesh) {
            const m = this.barLabelMesh.material;
            this.barLabelMesh.dispose();
            if (m) m.dispose();
            this.barLabelMesh = null;
        }
        if (this.barLabelTexture) {
            this.barLabelTexture.dispose();
            this.barLabelTexture = null;
        }
    }

    /**
     * Put every health-bar mesh into HEALTH_BAR_RENDER_GROUP. That group's depth
     * buffer is cleared before it renders (configured once in
     * SurvivorsGameplayState.enter), so the bar always draws on top of the enemy
     * mesh and stays visible regardless of the model's size — large bosses used to
     * occlude their own bar. Called after every createHealthBar() (init + re-tier),
     * and safe to call when some bar meshes are absent (null-guarded).
     */
    private _makeHealthBarAlwaysVisible(): void {
        const set = (m: Mesh | null): void => {
            if (m && !m.isDisposed()) m.renderingGroupId = HEALTH_BAR_RENDER_GROUP;
        };
        set(this.healthBarOutlineMesh);
        set(this.healthBarBackgroundMesh);
        set(this.healthBarMesh);
        for (const seg of this.barSegmentMeshes) set(seg);
        set(this.barLabelMesh);
    }

    /**
     * Update the enemy's scale based on current health
     * This method is replaced by updateHealthBar
     */
    protected updateHealthScale(): void {
        // This method is now deprecated - using health bars instead
        // Keeping it for compatibility with child classes that might override it
    }

    /**
     * Update the enemy
     * @param deltaTime Time elapsed since last update in seconds
     * @returns True if the enemy reached the end of the path
     */
    public update(deltaTime: number): boolean {
        if (!this.alive || !this.mesh) return false;

        // Tick the hit-flash restore timer once per frame (was per-hit setTimeout).
        this._tickFlashHit(deltaTime);

        // --- Survivors seek-target branch ---
        // Enter when seekTarget is set (single-player) OR seekTargets is populated
        // (co-op). The resolveSeekTarget() call below handles both paths.
        if (this.seekTarget || this.seekTargets.length > 0) {
            // Always tick status effects so slow/freeze/stun/burn still work
            this.updateStatusEffects(deltaTime);

            // Don't move if frozen or stunned (also cancel any in-progress swing)
            if (this.isFrozen || this.isStunned) {
                if (this.meleeState !== 'idle') this.cancelMeleeAttack();
                return false;
            }

            // Resolve the live target for this frame. Single-player: always
            // this.seekTarget. Co-op: nearest-alive from seekTargets.
            // If the resolved target is null (all providers dead), bail out to
            // avoid a null-dereference; single-player can never reach this because
            // the branch entry above already requires seekTarget != null.
            const resolvedTarget = this.resolveSeekTarget();
            if (!resolvedTarget) {
                // All targets dead (co-op both-down / downed lone hero) — abandon any
                // in-progress swing so we don't strike empty space and idle in place.
                if (this.meleeState !== 'idle') this.cancelMeleeAttack();
                return false;
            }

            // Fetch the target position ONCE per frame — Champion.getPosition()
            // clones a fresh Vector3 on each call, so calling it twice per enemy
            // per frame doubles GC pressure and can trigger a stop-the-world pause.
            const targetPos = resolvedTarget.getPosition() as Vector3;

            // Tick the melee-swing state machine BEFORE movement so we can root
            // the enemy (skip movement) during windup + strike frames.
            this.updateMeleeAttack(deltaTime, targetPos, resolvedTarget);
            const rooted = this.meleeRootDuringSwing &&
                (this.meleeState === 'windup' || this.meleeState === 'strike');

            targetPos.subtractToRef(this.position, this._scratchDir);
            this._scratchDir.y = 0;
            const dist = this._scratchDir.length();

            if (dist > 0.001 && !rooted) {
                this._scratchDir.normalize();
                // Respect slow/freeze speed modifications already applied to this.speed
                this._scratchDir.scaleToRef(this.speed * deltaTime, this._scratchMovement);
                this.position.addInPlace(this._scratchMovement);
            } else if (dist > 0.001) {
                // Rooted: still normalize the direction so the mesh faces the hero
                this._scratchDir.normalize();
            }

            this._curveDropY = Enemy.curveDropFn
                ? Enemy.curveDropFn(this.position.x, this.position.z) : 0;
            if (this.mesh && !this.mesh.isDisposed()) {
                this.mesh.position.copyFrom(this.position);
                this.mesh.position.y -= this._curveDropY; // render-only globe drop
                if (dist > 0.01) {
                    this.mesh.rotation.y = Math.atan2(-this._scratchDir.x, -this._scratchDir.z);
                }
            }

            // Update health bar
            if (this.healthBarMesh && !this.healthBarMesh.isDisposed() &&
                this.healthBarBackgroundMesh && !this.healthBarBackgroundMesh.isDisposed()) {
                this.updateHealthBar();
            }

            return false; // Never "reach end of path" in survivors mode
        }
        // --- End survivors branch ---

        // Update status effects
        this.updateStatusEffects(deltaTime);

        // Don't move if frozen or stunned
        if (this.isFrozen || this.isStunned) {
            return false;
        }

        // If we've reached the end of the path, return true
        if (this.currentPathIndex >= this.path.length) {
            return true;
        }
        
        // Get the next point in the path
        const targetPoint = this.path[this.currentPathIndex];
        
        // Calculate direction to the target
        targetPoint.subtractToRef(this.position, this._scratchDir);

        // Find the closest point on the path if we're too far from our target
        const distanceToPath = this._scratchDir.length();
        if (distanceToPath > 2) { // If we're more than 2 units away from our target
            // Reset to the last known good position
            this.position = this.path[Math.max(0, this.currentPathIndex - 1)].clone();
            targetPoint.subtractToRef(this.position, this._scratchDir);
        }
        
        // If confused, modify the direction but maintain general path following
        if (this.isConfused) {
            // Update confused direction more frequently for more erratic movement
            if (!this.confusedDirection || Math.random() < 0.1) {
                // Create a random offset perpendicular to the path direction
                const pathDirection = this._scratchDir.normalizeToNew();
                const perpX = pathDirection.z;
                const perpZ = -pathDirection.x;
                const perpLength = Math.sqrt(perpX * perpX + perpZ * perpZ);

                if (perpLength > 0.001) {
                    const normalizedPerpX = perpX / perpLength;
                    const normalizedPerpZ = perpZ / perpLength;

                    const randomOffset = new Vector3(
                        normalizedPerpX * (Math.random() - 0.5) * 0.3,
                        0,
                        normalizedPerpZ * (Math.random() - 0.5) * 0.3
                    );

                    // Mix the path direction with the random offset
                    this.confusedDirection = pathDirection.add(randomOffset).normalize();
                }
            }

            // Use a stronger mix of confused direction to make movement more erratic
            if (this.confusedDirection) {
                this._scratchDir.scaleInPlace(0.5);
                this.confusedDirection.scaleToRef(0.5, this._scratchMovement);
                this._scratchDir.addInPlace(this._scratchMovement);
            }
        } else {
            // Reset confused direction when not confused
            this.confusedDirection = null;
        }

        // Normalize the direction
        const distance = this._scratchDir.length();

        // If we're close enough to the target, move to the next point
        if (distance < 0.1) {
            this.currentPathIndex++;

            // If we've reached the end of the path, return true
            if (this.currentPathIndex >= this.path.length) {
                return true;
            }

            // Ensure we're exactly on the path point when reaching it
            this.position.copyFrom(targetPoint);
            return false;
        }

        this._scratchDir.normalize();

        // Move towards the target with reduced speed when confused
        const currentSpeed = this.isConfused ? this.speed * 0.7 : this.speed;
        this._scratchDir.scaleToRef(currentSpeed * deltaTime, this._scratchMovement);
        this.position.addInPlace(this._scratchMovement);

        // Ensure we don't overshoot the target
        this.position.subtractToRef(targetPoint, this._scratchMovement);
        const newDistanceToTarget = this._scratchMovement.length();
        if (newDistanceToTarget > distance) {
            this.position.copyFrom(targetPoint);
        }

        // Update mesh position if it still exists
        if (this.mesh && !this.mesh.isDisposed()) {
            this.mesh.position.copyFrom(this.position);
            this.mesh.position.y -= this._curveDropY; // render-only globe drop
        }
        
        // Update health bar position if it still exists
        if (this.healthBarMesh && !this.healthBarMesh.isDisposed() && 
            this.healthBarBackgroundMesh && !this.healthBarBackgroundMesh.isDisposed()) {
            this.updateHealthBar();
        }
        
        return false;
    }
    
    /**
     * Update active status effects.
     *
     * Iterates with for...of (instead of Map.forEach + arrow function) so the
     * hot path doesn't allocate a closure per call per enemy.
     */
    protected updateStatusEffects(deltaTime: number): void {
        // ── Rich statuses (model-owned: burn/chill/curse/fragile) ──
        const rich = this.statuses.tick(deltaTime, this.maxHealth);
        if (rich.burnDamage > 0 && this.alive) this.takeDamage(rich.burnDamage, 'fire');
        if (rich.curseDamage > 0 && this.alive) this.takeDamage(rich.curseDamage, 'arcane');
        if (this.alive && !this.isFrozen && !this.isStunned && rich.chillSlowMultiplier < 1) {
            this.speed = this.originalSpeed * rich.chillSlowMultiplier;
        }
        for (let i = 0; i < rich.expired.length; i++) {
            if (rich.expired[i] === 'burn') {
                this.stopStatusEffectParticles(StatusEffect.BURNING);
            } else if (rich.expired[i] === 'chill') {
                // Restore base speed; an active legacy SLOWED re-asserts on its next apply.
                if (!this.isFrozen && !this.isStunned) this.speed = this.originalSpeed;
                this.stopStatusEffectParticles(StatusEffect.SLOWED);
            }
            // CURSE/FRAGILE start no particles → nothing to stop on expiry.
        }

        // ── Legacy CC (slow/freeze/stun/push/confused) — unchanged ──
        if (this.activeStatusEffects.size === 0) return;
        const currentTime = performance.now();
        this._expiredStatusEffects.length = 0;
        for (const [effect, effectData] of this.activeStatusEffects) {
            if (currentTime > effectData.endTime) {
                this._expiredStatusEffects.push(effect);
            }
            // Burn is no longer ticked here — the model owns it.
        }
        for (let i = 0; i < this._expiredStatusEffects.length; i++) {
            this.removeStatusEffect(this._expiredStatusEffects[i]);
        }
    }

    /**
     * Resolve the active seek target for this frame.
     *
     * 0/1 providers (single-player or single-provider co-op):
     *   Returns `this.seekTarget` directly — byte-identical to the pre-M3 behavior
     *   (no per-frame distance loop).
     *
     * 2+ providers (co-op host with multiple players):
     *   Delegates to `pickNearestAlive` which walks the array and returns the
     *   closest live provider. The returned object is structurally compatible with
     *   `seekTarget` (both have `getPosition()` returning {x,z,...} and optional
     *   `takeDamage` / `isAlive`). Falls back to null if all providers are dead.
     */
    protected resolveSeekTarget(): typeof this.seekTarget {
        // 2+ providers (co-op host) → nearest alive. 0/1 providers (single-player or
        // single-provider co-op) → the plain seekTarget field, byte-identical to the
        // pre-M3 behavior (no per-frame distance loop).
        if (this.seekTargets.length > 1) {
            // Co-op: pick nearest alive — cast is safe because TargetProvider is a
            // structural subset of seekTarget's type (both have getPosition()/{x,z}).
            return pickNearestAlive(this.position.x, this.position.z, this.seekTargets) as typeof this.seekTarget;
        }
        // Single provider (single-player or single-provider co-op): return it directly.
        // MUST NOT null out a dead lone target — that idles the enemy in place, and on a
        // co-op host (always seekTargets[0]) a downed host with effectively one provider
        // would freeze every enemy (they stop moving AND the host streams static
        // positions → guest sees a frozen, unkillable board). A dead host being targetable
        // here only happens when there is no live second provider; the run-end logic
        // (onLocalHeroDeath / both-down) handles that case instead. Dead-host exclusion
        // for the real 2-player case is done above via pickNearestAlive (skips isAlive===false).
        return this.seekTarget;
    }

    /** True while a swing is winding up, striking, or recovering. Subclasses
     *  with their own attack timing (e.g., MilestoneBoss lunge) can check this. */
    public isMeleeAttacking(): boolean { return this.meleeState !== 'idle'; }

    /** Subclasses override to disable the swing under specific conditions
     *  (e.g., MilestoneBoss only swings while in its 'walking' lunge state). */
    protected canMeleeAttack(): boolean { return true; }

    /** Hook for subclass-specific swing visuals (e.g., the boss's overhead claw
     *  smash). `progress` is 0..1 within the current phase. */
    protected onMeleeAttackPhase(
        _state: 'windup' | 'strike' | 'cooldown',
        _progress: number,
    ): void {}

    /** Drive the melee-swing state machine. Called from the seek-target branch
     *  every frame. Damage applies on the FIRST frame of 'strike' if the hero is
     *  still inside meleeHitRange — a clean dodge if you backstep on telegraph.
     *  `heroPos` is passed in (not fetched) to avoid an extra Champion.getPosition
     *  clone per enemy per frame. `target` is the already-resolved seek target for
     *  this frame so we don't call resolveSeekTarget() a second time. */
    private updateMeleeAttack(deltaTime: number, heroPos: Vector3, target: typeof this.seekTarget): void {
        if (!this.canMeleeAttack() || !target) {
            if (this.meleeState !== 'idle') this.cancelMeleeAttack();
            return;
        }

        this.meleeTimer -= deltaTime;
        const dx = heroPos.x - this.position.x;
        const dz = heroPos.z - this.position.z;
        const distSq = dx * dx + dz * dz;

        switch (this.meleeState) {
            case 'idle': {
                if (distSq <= this.meleeRange * this.meleeRange) {
                    this.meleeState = 'windup';
                    this.meleeTimer = this.meleeWindupDuration;
                    this.meleeStrikeHasHit = false;
                }
                break;
            }
            case 'windup': {
                this.onMeleeAttackPhase('windup', 1 - this.meleeTimer / this.meleeWindupDuration);
                if (this.meleeTimer <= 0) {
                    this.meleeState = 'strike';
                    this.meleeTimer = this.meleeStrikeDuration;
                }
                break;
            }
            case 'strike': {
                if (!this.meleeStrikeHasHit) {
                    if (distSq <= this.meleeHitRange * this.meleeHitRange) {
                        // Pass this.position by reference — triggerHitReaction only
                        // reads it for direction, never stores or mutates it.
                        target.takeDamage?.(this.meleeHitDamage, this.position);
                    }
                    this.meleeStrikeHasHit = true;
                }
                this.onMeleeAttackPhase('strike', 1 - this.meleeTimer / this.meleeStrikeDuration);
                if (this.meleeTimer <= 0) {
                    this.meleeState = 'cooldown';
                    this.meleeTimer = this.meleeCooldownDuration;
                }
                break;
            }
            case 'cooldown': {
                this.onMeleeAttackPhase('cooldown', 1 - this.meleeTimer / this.meleeCooldownDuration);
                if (this.meleeTimer <= 0) this.meleeState = 'idle';
                break;
            }
        }
    }

    private cancelMeleeAttack(): void {
        this.meleeState = 'idle';
        this.meleeTimer = 0;
        this.meleeStrikeHasHit = false;
    }

    /** @deprecated Burn is now ticked by the StatusStacks model in
     *  updateStatusEffects. Kept as a no-op so subclass overrides don't break. */
    protected processBurningEffect(_deltaTime: number): void { /* model-owned */ }

    /**
     * Apply a status effect to this enemy
     * @param effect The status effect to apply
     * @param duration Duration of the effect in seconds
     * @param strength Strength of the effect (e.g., slow percentage, damage per tick)
     */
    public applyStatusEffect(effect: StatusEffect, duration: number, strength: number): void {
        // Co-op guest: render-only enemies are host-authoritative. Report the CC/DoT to
        // the host (which applies + ticks it) and do nothing locally — mirrors the
        // takeDamage redirect. The chill→freeze recursion below also redirects (correct).
        const sr = Enemy.guestStatusRedirect;
        if (sr) { sr(this.id, effect, duration, strength); return; }

        const currentTime = performance.now();
        const endTime = currentTime + (duration * 1000);

        // Apply effect-specific changes
        switch (effect) {
            case StatusEffect.BURNING: {
                // strength = damage per stack per 0.5s tick (preserves legacy feel).
                const burnResult = this.statuses.apply('burn', duration, strength, 1);
                if (burnResult.overflowDetonate > 0) this.takeDamage(burnResult.overflowDetonate, 'fire');
                this.createStatusEffectParticles(effect);
                break;
            }

            case StatusEffect.CHILL: {
                const chillStacks = Math.max(1, Math.round(strength) || 1);
                const chillResult = this.statuses.apply('chill', duration, 0, chillStacks);
                if (chillResult.reachedFreeze) {
                    // Convert to a real Freeze through the normal (immunity-gated) path.
                    this.applyStatusEffect(StatusEffect.FROZEN, STATUS_TUNING.chill.freezeDurationS, 1);
                } else {
                    this.createStatusEffectParticles(StatusEffect.SLOWED); // reuse slow visual
                }
                break;
            }

            case StatusEffect.CURSE: {
                // strength = fraction of MAX HP drained per second.
                this.statuses.apply('curse', duration, strength, 1);
                // No createStatusEffectParticles call: the switch has no CURSE branch
                // (would create uncoloured default particles). Amplifier felt via damage numbers.
                break;
            }

            case StatusEffect.FRAGILE: {
                this.statuses.apply('fragile', duration, 0, 1);
                // No dedicated particle; amplifier is felt via bigger damage numbers.
                break;
            }

            case StatusEffect.SLOWED:
                // Cap slow at 80% (prevent 100% slow = freeze)
                this.activeStatusEffects.set(effect, { endTime, strength });
                this.speed = this.originalSpeed * Math.max(0.2, 1 - strength);
                this.createStatusEffectParticles(effect);
                break;

            case StatusEffect.FROZEN:
                // Check freeze immunity window (3s after last freeze ends)
                if (currentTime < this.freezeImmunityUntil) return;
                this.activeStatusEffects.set(effect, { endTime, strength });
                this.isFrozen = true;
                this.speed = 0;
                this.createStatusEffectParticles(effect);
                break;

            case StatusEffect.STUNNED:
                // Check stun immunity window (5s after last stun ends)
                if (currentTime < this.stunImmunityUntil) return;
                this.activeStatusEffects.set(effect, { endTime, strength });
                this.isStunned = true;
                this.createStatusEffectParticles(effect);
                break;

            case StatusEffect.PUSHED:
                this.activeStatusEffects.set(effect, { endTime, strength });
                // Push logic is handled in the tower's effect application
                break;

            case StatusEffect.CONFUSED:
                this.activeStatusEffects.set(effect, { endTime, strength });
                this.isConfused = true;
                this.confusedDirection = null; // Will be set on next update
                this.createStatusEffectParticles(effect);
                break;
        }
    }

    /** Mark this enemy so that on death it emits a shatter AoE (fired via
     *  Enemy.onShatterCallback). Re-priming keeps the larger of the two bursts. */
    public primeShatter(
        damage: number,
        radius: number,
        element: PowerElement = 'ice',
        status?: { effect: StatusEffect; durationS: number; strength: number },
    ): void {
        if (damage <= 0 || radius <= 0) return;
        this._shatterPrimed = true;
        this._shatterDamage = Math.max(this._shatterDamage, damage);
        this._shatterRadius = Math.max(this._shatterRadius, radius);
        this._shatterElement = element;
        this._shatterStatus = status;
    }

    /** True if this enemy currently has the given rich status (burn/chill/curse/fragile). */
    public hasRichStatus(kind: RichStatusKind): boolean {
        return this.statuses.has(kind);
    }

    /** Consume a rich status and return its reaction burst damage (0 if none). */
    public detonateRichStatus(kind: RichStatusKind): number {
        return this.statuses.detonate(kind);
    }

    /**
     * Remove a status effect
     * @param effect The status effect to remove
     */
    protected removeStatusEffect(effect: StatusEffect): void {
        this.activeStatusEffects.delete(effect);
        
        // Remove effect-specific changes
        switch (effect) {
            case StatusEffect.BURNING:
                // Stop burning particles
                this.stopStatusEffectParticles(effect);
                break;
                
            case StatusEffect.SLOWED:
                // Restore original speed
                this.speed = this.originalSpeed;
                this.stopStatusEffectParticles(effect);
                break;
                
            case StatusEffect.FROZEN:
                this.isFrozen = false;
                this.speed = this.originalSpeed;
                // 3 second immunity window after freeze ends
                this.freezeImmunityUntil = performance.now() + 3000;
                this.stopStatusEffectParticles(effect);
                break;

            case StatusEffect.STUNNED:
                this.isStunned = false;
                // 5 second immunity window after stun ends
                this.stunImmunityUntil = performance.now() + 5000;
                this.stopStatusEffectParticles(effect);
                break;
                
            case StatusEffect.CONFUSED:
                this.isConfused = false;
                this.confusedDirection = null;
                this.stopStatusEffectParticles(effect);
                break;
        }
    }
    
    /**
     * Create particles for a status effect
     * @param effect The status effect to create particles for
     */
    protected createStatusEffectParticles(effect: StatusEffect): void {
        if (!this.mesh) return;
        
        // Idempotent: keep a running ParticleSystem instead of dispose+recreate on every
        // status re-apply (Frostfire etc. refresh BURNING/CHILL each cast). Recreating the
        // system per apply churns GPU buffers across many enemies = a per-frame hitch. It
        // persists until the status expires (stopStatusEffectParticles is called on expiry).
        if (this.statusEffectParticles.has(effect)) return;
        
        // Create a new particle system
        const particleSystem = new ParticleSystem(`${effect}Particles`, 20, this.scene);
        
        // Set particle texture (shared singleton — avoids N parallel texture loads on AoE bursts)
        particleSystem.particleTexture = getStatusEffectTexture(this.scene);
        
        // Set emission properties
        particleSystem.emitter = this.mesh;
        particleSystem.minEmitBox = new Vector3(-0.4, 0, -0.4);
        particleSystem.maxEmitBox = new Vector3(0.4, 0.8, 0.4);
        
        // Set particle properties based on effect
        switch (effect) {
            case StatusEffect.BURNING:
                particleSystem.color1 = new Color4(1, 0.5, 0, 1.0);
                particleSystem.color2 = new Color4(1, 0, 0, 1.0);
                particleSystem.colorDead = new Color4(0.3, 0, 0, 0.0);
                particleSystem.minSize = 0.1;
                particleSystem.maxSize = 0.3;
                particleSystem.minLifeTime = 0.2;
                particleSystem.maxLifeTime = 0.4;
                particleSystem.emitRate = 30;
                particleSystem.direction1 = new Vector3(0, 1, 0);
                particleSystem.direction2 = new Vector3(0, 1, 0);
                particleSystem.minEmitPower = 1;
                particleSystem.maxEmitPower = 2;
                break;
                
            case StatusEffect.SLOWED:
                particleSystem.color1 = new Color4(0, 0.5, 1, 1.0);
                particleSystem.color2 = new Color4(0, 0, 1, 1.0);
                particleSystem.colorDead = new Color4(0, 0, 0.3, 0.0);
                particleSystem.minSize = 0.1;
                particleSystem.maxSize = 0.2;
                particleSystem.minLifeTime = 0.5;
                particleSystem.maxLifeTime = 1.0;
                particleSystem.emitRate = 10;
                particleSystem.direction1 = new Vector3(-0.5, -1, -0.5);
                particleSystem.direction2 = new Vector3(0.5, -1, 0.5);
                particleSystem.minEmitPower = 0.5;
                particleSystem.maxEmitPower = 1;
                break;
                
            case StatusEffect.FROZEN:
                particleSystem.color1 = new Color4(0.8, 0.8, 1, 1.0);
                particleSystem.color2 = new Color4(0.5, 0.5, 1, 1.0);
                particleSystem.colorDead = new Color4(0, 0, 0.5, 0.0);
                particleSystem.minSize = 0.05;
                particleSystem.maxSize = 0.15;
                particleSystem.minLifeTime = 1.0;
                particleSystem.maxLifeTime = 2.0;
                particleSystem.emitRate = 20;
                particleSystem.direction1 = new Vector3(-0.1, 0.1, -0.1);
                particleSystem.direction2 = new Vector3(0.1, 0.1, 0.1);
                particleSystem.minEmitPower = 0.1;
                particleSystem.maxEmitPower = 0.3;
                break;
                
            case StatusEffect.STUNNED:
                particleSystem.color1 = new Color4(1, 1, 0, 1.0);
                particleSystem.color2 = new Color4(1, 0.5, 0, 1.0);
                particleSystem.colorDead = new Color4(0.5, 0.5, 0, 0.0);
                particleSystem.minSize = 0.1;
                particleSystem.maxSize = 0.2;
                particleSystem.minLifeTime = 0.3;
                particleSystem.maxLifeTime = 0.6;
                particleSystem.emitRate = 15;
                particleSystem.direction1 = new Vector3(-0.5, 1, -0.5);
                particleSystem.direction2 = new Vector3(0.5, 1, 0.5);
                particleSystem.minEmitPower = 1;
                particleSystem.maxEmitPower = 2;
                break;
                
            case StatusEffect.CONFUSED:
                particleSystem.color1 = new Color4(1, 0, 1, 1.0);
                particleSystem.color2 = new Color4(0.5, 0, 0.5, 1.0);
                particleSystem.colorDead = new Color4(0.3, 0, 0.3, 0.0);
                particleSystem.minSize = 0.1;
                particleSystem.maxSize = 0.3;
                particleSystem.minLifeTime = 0.5;
                particleSystem.maxLifeTime = 1.0;
                particleSystem.emitRate = 10;
                particleSystem.direction1 = new Vector3(-1, 1, -1);
                particleSystem.direction2 = new Vector3(1, 1, 1);
                particleSystem.minEmitPower = 0.5;
                particleSystem.maxEmitPower = 1;
                break;
        }
        
        // Start the particle system
        particleSystem.start();
        
        // Store the particle system
        this.statusEffectParticles.set(effect, particleSystem);
    }
    
    /**
     * Stop particles for a status effect
     * @param effect The status effect to stop particles for
     */
    protected stopStatusEffectParticles(effect: StatusEffect): void {
        const particleSystem = this.statusEffectParticles.get(effect);
        if (particleSystem) {
            particleSystem.stop();
            // dispose(false): the particleTexture is the shared status-effect
            // singleton (getStatusEffectTexture). dispose() defaults to
            // disposeTexture=true, which would destroy the shared texture for
            // every other enemy. Keep the texture; only free this system.
            particleSystem.dispose(false);
            this.statusEffectParticles.delete(effect);
        }
    }

    /**
     * Apply a difficulty multiplier to the enemy's stats
     * @param multiplier The multiplier to apply
     */
    public applyDifficultyMultiplier(multiplier: number): void {
        // Health scales linearly with multiplier (was multiplier^1.5 which made late game impossible)
        const healthMultiplier = multiplier;
        this.maxHealth = Math.floor(this.maxHealth * healthMultiplier);
        this.health = this.maxHealth;

        // Damage scales slightly less than linearly
        this.damage = Math.floor(this.damage * Math.pow(multiplier, 0.8));

        // Reward scales meaningfully with difficulty so economy keeps up
        this.reward = Math.floor(this.reward * Math.pow(multiplier, 0.9));

        // Damage resistance caps at 40% (was 70% which made enemies nearly invincible)
        // Ramps slowly: at 5x multiplier = 24%, at 10x = 36%, approaches 40% asymptotically
        this.damageResistance = Math.min(0.4, (multiplier - 1) * 0.08);

        // Update health bar
        this.updateHealthBar();

        console.log(`Enemy stats multiplied by ${multiplier.toFixed(2)}, health: ${this.maxHealth} (×${healthMultiplier.toFixed(2)}), resistance: ${(this.damageResistance * 100).toFixed(0)}%`);
    }
    
    /**
     * Apply damage to the enemy with damage resistance
     * @param amount The amount of damage to apply
     * @returns True if the enemy died from this damage
     */
    public takeDamage(amount: number, element?: PowerElement): boolean {
        if (!this.alive) return false;

        // Co-op guest (M4-9): render-only enemies are host-authoritative. Route the
        // hit to the host by id and apply NOTHING locally — the host rolls crit /
        // resistance, mutates HP, and echoes a damageResult (the number). This
        // catches powers / abilities / DoT uniformly; basic attacks route earlier via
        // HeroBasicAttack.damageRouter (they never reach takeDamage on the guest).
        const redirect = Enemy.guestDamageRedirect;
        if (redirect) {
            redirect(this.id, amount, element);
            return false;
        }

        // Roll for crit using the global provider (player run stats). DoT ticks
        // and chained sub-hits all flow through here, so every damage source —
        // basic attack, power, enchantment — gets one crit roll per call.
        let isCrit = false;
        let actualDamage = amount;
        const cp = Enemy.critProvider?.();
        if (cp && cp.chance > 0 && Math.random() < cp.chance) {
            isCrit = true;
            actualDamage *= cp.damageMult;
        }

        // Apply damage resistance if it exists
        if (this.damageResistance && this.damageResistance > 0) {
            actualDamage = actualDamage * (1 - this.damageResistance);
        }

        // Fragile: stacking amplifier raises incoming direct damage.
        actualDamage *= this.statuses.damageAmplifier();

        this.health -= actualDamage;

        // Update health bar instead of scaling
        this.updateHealthBar();

        // Hit flash: briefly turn mesh white for 80ms
        this.flashHit();

        // Fire the static damage callback (replaces a CustomEvent dispatch +
        // detail object allocation per hit). Position is passed by reference —
        // consumer must NOT retain the Vector3.
        const dmgCb = Enemy.onDamageCallback;
        if (dmgCb) dmgCb(this.position, actualDamage, isCrit, element);

        if (this.health <= 0) {
            this.health = 0;
            this.die();
            return true;
        }

        return false;
    }

    /**
     * Brief red emissive tint on hit (~100ms). Read as damage but keeps the
     * underlying texture visible — a full-white emissive blew out detail.
     *
     * Avoids per-hit allocations: HIT_TINT is module-level, the restore cache
     * is a per-instance field, original colors are stored as r/g/b numbers (no
     * Color3.clone), and the timeout is driven by the update() loop (no
     * setTimeout pile-up). Re-flashes on an already-flashing enemy just refresh
     * the countdown — the cache stays valid.
     */
    protected flashHit(): void {
        if (!this.mesh || this.mesh.isDisposed()) return;

        // Already flashing — just refresh the timer; emissive is already HIT_TINT.
        if (this._flashTimeRemaining > 0) {
            this._flashTimeRemaining = HIT_FLASH_DURATION_S;
            return;
        }

        // Snapshot emissive colors for restore, then overwrite. Walk children once.
        this._flashRestore.length = 0;
        this._collectFlashEmissive(this.mesh);
        for (const child of this.mesh.getChildMeshes(false)) {
            this._collectFlashEmissive(child);
        }
        this._flashTimeRemaining = HIT_FLASH_DURATION_S;
    }

    /** Push one mesh's emissive into the flash restore cache and tint it. */
    private _collectFlashEmissive(mesh: { material: unknown }): void {
        const mat = mesh.material as StandardMaterial | null;
        if (!mat || mat.emissiveColor === undefined) return;
        // Material already shows the shared HIT_TINT (another enemy sharing a
        // cached material is mid-flash) — don't capture/re-tint it. Capturing
        // HIT_TINT as the "original" would leave it stuck red once we restore,
        // and the other enemy already owns the restore.
        if (mat.emissiveColor === HIT_TINT) return;
        this._flashRestore.push({ mat, original: mat.emissiveColor });
        mat.emissiveColor = HIT_TINT;
    }

    /** Tick the hit-flash timer. Called from update() — restores original
     *  emissive colors once the window expires. */
    private _tickFlashHit(deltaTime: number): void {
        if (this._flashTimeRemaining <= 0) return;
        this._flashTimeRemaining -= deltaTime;
        if (this._flashTimeRemaining > 0) return;
        this._restoreFlash();
    }

    /** Restore every flashed material to its original emissive and clear the
     *  cache. Reassigns the original Color3 reference (never mutates HIT_TINT).
     *  Called when the flash window expires, and on death/dispose so a flash
     *  that's interrupted by death doesn't leave a shared material stuck red. */
    private _restoreFlash(): void {
        for (let i = 0; i < this._flashRestore.length; i++) {
            const e = this._flashRestore[i];
            try { e.mat.emissiveColor = e.original; } catch (_) { /* mat disposed */ }
        }
        this._flashRestore.length = 0;
        this._flashTimeRemaining = 0;
    }

    /**
     * Release this enemy's GPU/scene resources: stop + dispose the GLB-cloned
     * AnimationGroups, dispose the per-instance (cloned) materials, then dispose
     * the mesh. Shared by die() (normal in-wave death) and dispose() (teardown)
     * so a death frees exactly what a teardown does.
     *
     * mesh.dispose() alone does NOT stop the cloned AnimationGroups and does NOT
     * dispose cloned materials. Disposing only the mesh on death therefore leaked
     * tens of bone animatables (ticked forever) plus materials per kill —
     * scene._activeAnimatables climbed into the thousands with only a few enemies
     * alive, producing multi-second stop-the-world freezes by wave 4+.
     */
    /**
     * Free subclass-owned aux visuals that are NOT parented to this.mesh (boss
     * orbiting wisps, fast-enemy ghost trails, milestone-boss telegraphs, …), so
     * the mesh-tree release below can't reach them. Overrides MUST be idempotent:
     * this hook runs on EVERY disposal path — die() (host kill), disposeCorpse()
     * (corpse release; the ONLY path guest enemies take), and dispose() (teardown).
     * Base implementation is a no-op.
     */
    protected disposeAuxVisuals(): void { /* subclass hook */ }

    protected _releaseMeshAndAnimations(): void {
        // Stop + dispose every AnimationGroup that GLB instantiation cloned for
        // this enemy, or the animatables keep running every frame after the mesh
        // is gone.
        for (const ag of this.glbAnimationGroups) {
            try { ag.stop(); } catch (_) { /* already stopped */ }
            try { ag.dispose(); } catch (_) { /* already disposed */ }
        }
        this.glbAnimationGroups.length = 0;
        this.glbDeathAnim = null;
        // Net-anim caches all point into the groups disposed above — null the lot
        // so the teardown contract is self-evident (and lazy re-categorization
        // would start clean if a mesh were ever rebuilt).
        this._netSkillClips = null;
        this._netAnimCategorized = false;
        this._netWalkAnim = null;
        this._netAttackAnim = null;
        this._netCurrentAnim = null;

        if (this.mesh) {
            // Remove the mesh (+ descendants) from every shadow renderList it was
            // registered into BEFORE disposing it. Babylon's ObjectRenderer only
            // SKIPS disposed meshes in a renderList — it never splices them out — so
            // without this each spawned enemy permanently grows both per-frame shadow
            // passes (refreshRate=1) for the whole run: the steady, worsens-over-time
            // freeze. Bounds each renderList to live enemies + lingering corpses.
            for (const g of this._shadowGenerators) {
                try { g.removeShadowCaster(this.mesh, true); } catch (_) { /* not registered */ }
            }

            // Dispose the per-instance materials AND their textures. These materials
            // are cloned per-instance by instantiateModelsToScene(cloneMaterials=true),
            // and Babylon's Material.clone() also clones the material's TEXTURES — so
            // every GLB spawn adds a fresh '<asset> (Base Color)' texture to
            // scene.textures. forceDisposeTextures=true frees that per-instance clone;
            // it does NOT touch the source AssetContainer's textures (different objects,
            // so a later re-instantiate still renders). The cloned skeleton's
            // bone-matrix RawTexture is freed separately below (glbSkeletons.dispose).
            // Procedural enemy materials are colour-only (no textures), so the `true`
            // is a no-op for them. Leaving this `false` leaked ~one texture per spawn
            // (the steady cross-run scene.textures climb).
            //
            // SHARED cached materials (isCachedMaterial) must be skipped: elite
            // aura/glow/spike meshes parented under this.mesh use getCachedMaterial
            // — disposing one on the first elite death would blank every other live
            // elite of that element AND leave the cache handing out a dead material.
            // Only clearMaterialCache() (run teardown) may dispose those.
            const allMeshes = [this.mesh, ...this.mesh.getChildMeshes(false)];
            for (const m of allMeshes) {
                const mat = m.material;
                if (mat) {
                    m.material = null;
                    if (!isCachedMaterial(mat)) {
                        try { mat.dispose(false, true); } catch (_) { /* already disposed */ }
                    }
                }
            }
            this.mesh.dispose();
            this.mesh = null;
        }

        // Dispose the per-instance cloned skeleton AFTER the mesh — frees its
        // bone-matrix RawTexture (mesh.dispose() does not cascade to skeletons).
        // These are the CLONED skeletons (inst.skeletons), never the source
        // skeleton owned by the cached AssetContainer, so this is safe.
        for (const sk of this.glbSkeletons) {
            try { sk.dispose(); } catch (_) { /* already disposed */ }
        }
        this.glbSkeletons.length = 0;
    }

    /**
     * Handle enemy death.
     *
     * The mesh is NOT freed here. Instead the enemy enters a short "corpse" phase:
     * its GLB death clip plays (or it shrinks away if the asset has no death clip),
     * it lingers `corpseLingerS`, then EnemyManager calls disposeCorpse() to release
     * the mesh/skeleton/animation-groups/shadow-casters. EnemyManager owns the corpse
     * list (so wave-clear, which keys off live enemy count, is not stalled) and caps
     * the number of simultaneous corpses so a mass kill can't pile up skinned meshes.
     */
    protected die(): void {
        if (!this.alive) return;

        this.alive = false;

        // Kill hook — fires once per death from the authoritative kill path, NOT from
        // createDeathEffect (which BasicEnemy/ShieldEnemy/HealerEnemy override without
        // calling super, so a reward-float-coupled hook would miss most kills).
        if (Enemy.onKillCallback) Enemy.onKillCallback(this.position);

        // Tear down any in-progress melee swing.
        this.cancelMeleeAttack();

        // Unparented aux visuals (wisps/ghost trails/telegraphs) die with the
        // enemy, not with the lingering corpse.
        this.disposeAuxVisuals();

        // Create death effect (particle burst + reward float text + sound). Runs
        // while the mesh is still present so subclass effects that read it work.
        this.createDeathEffect();

        // Shatter-on-death (e.g. frozen enemies erupting). Fires the static hook
        // wired by the gameplay state; a no-op until a later phase wires it.
        if (this._shatterPrimed && Enemy.onShatterCallback) {
            Enemy.onShatterCallback(this.position, this._shatterDamage, this._shatterRadius, this._shatterElement, this._shatterStatus);
        }
        this._shatterPrimed = false;

        // Restore any mid-flash emissive now so a SHARED (cached) material isn't left
        // stuck on HIT_TINT for other enemies (the corpse's own update no longer runs).
        this._restoreFlash();

        // A corpse shows no HP bar and no status particles — free them immediately.
        this._disposeHealthBarMeshes();
        this.statusEffectParticles.forEach(particleSystem => {
            particleSystem.stop();
            particleSystem.dispose(false);
        });
        this.statusEffectParticles.clear();

        // Begin the death animation + linger. Keeps mesh/skeleton/anim alive.
        this._beginDeathSequence();

        // Note: Money reward is handled by the EnemyManager which has access to PlayerStats
        // We don't need to award money here as it's done in EnemyManager.update()
    }

    /**
     * Start the corpse phase: stop walk/attack and play the GLB death clip once
     * (non-looping). When the asset has no death clip the corpse holds its last
     * frame and shrinks away over the final part of the linger (see tickCorpse).
     * Sets the total corpse time = death-clip duration + corpseLingerS.
     */
    protected _beginDeathSequence(): void {
        this.corpseBaseScale = this.mesh ? this.mesh.scaling.x : 1;

        if (this.glbAnimationGroups.length > 0) {
            for (const ag of this.glbAnimationGroups) {
                try { ag.stop(); } catch (_) { /* already stopped */ }
            }
            const death = this._findDeathClip();
            if (death) {
                this.glbDeathAnim = death;
                let dur = 1.0;
                try {
                    const ta = death.targetedAnimations[0];
                    const fps = ta?.animation?.framePerSecond || 60;
                    const frames = Math.abs(death.to - death.from);
                    const sr = Math.abs(death.speedRatio || 1);
                    const est = frames / fps / sr;
                    if (est > 0.1 && est < 6) dur = est;
                } catch (_) { /* keep the 1.0s fallback */ }
                try { death.start(false); } catch (_) { /* ignore */ }
                this.corpseHasDeathClip = true;
                this.corpseTimeRemaining = dur + this.corpseLingerS;
                return;
            }
        }

        // No GLB death clip (procedural enemy or asset without one): just linger,
        // then shrink away over the final part of the window (tickCorpse).
        this.corpseHasDeathClip = false;
        this.corpseTimeRemaining = this.corpseLingerS;
    }

    /** Locate a death/defeat animation clip among the GLB groups by name. Matches
     *  unambiguous death terms first (all enemy assets use `<prefix>_dead`), then
     *  weaker fallbacks, so a clip like "fall"/"knock" can't steal the match from a
     *  real death clip that sorts later. Returns null (with a one-time per-class log
     *  of the available names) if none match. */
    private _findDeathClip(): AnimationGroup | null {
        const strong = (n: string): boolean =>
            n.includes('dead') || n.includes('death') || n.includes('die') || n.includes('defeat');
        const weak = (n: string): boolean =>
            n.includes('collapse') || n.includes('faint') || n.includes('knock') || n.includes('fall');

        for (const ag of this.glbAnimationGroups) {
            if (strong(ag.name.toLowerCase())) return ag;
        }
        for (const ag of this.glbAnimationGroups) {
            if (weak(ag.name.toLowerCase())) return ag;
        }

        const cls = this.constructor.name;
        if (!_deathClipWarned.has(cls)) {
            _deathClipWarned.add(cls);
            const avail = this.glbAnimationGroups.map(ag => ag.name).join(', ');
            console.info(`[death] ${cls}: no death clip found — using shrink fallback (avail: ${avail})`);
        }
        return null;
    }

    /** True once die() has started the corpse phase. */
    public isCorpse(): boolean {
        return !this.alive && this.corpseTimeRemaining > 0;
    }

    /**
     * Advance the corpse timer one frame. Returns true when the corpse is finished
     * and should be released (EnemyManager then calls disposeCorpse). For corpses
     * without a death clip, shrinks the mesh over the last 0.4s so it doesn't pop out.
     */
    public tickCorpse(deltaTime: number): boolean {
        this.corpseTimeRemaining -= deltaTime;
        if (!this.corpseHasDeathClip && this.mesh && !this.mesh.isDisposed()) {
            const SHRINK = 0.4;
            if (this.corpseTimeRemaining < SHRINK) {
                const k = Math.max(0, this.corpseTimeRemaining / SHRINK);
                this.mesh.scaling.setAll(this.corpseBaseScale * k);
            }
        }
        return this.corpseTimeRemaining <= 0;
    }

    /** Release a finished corpse's mesh/skeleton/animation-groups/shadow-casters.
     *  Idempotent. Also the early-out for a guest corpse mid-linger: cancels the
     *  self-tick observer so teardown can't leave it firing on a released mesh. */
    public disposeCorpse(): void {
        if (this._netCorpseObserver) {
            this.scene.onBeforeRenderObservable.remove(this._netCorpseObserver);
            this._netCorpseObserver = null;
        }
        this.corpseTimeRemaining = 0;
        // Guest enemies are freed via disposeCorpse() ONLY (never die()/dispose()),
        // so unparented aux visuals must be released here too (idempotent).
        this.disposeAuxVisuals();
        this._releaseMeshAndAnimations();
        this._disposeHealthBarMeshes();   // also free the health bar (idempotent; safe after die())
        const done = this._netCorpseOnDisposed;
        this._netCorpseOnDisposed = null;
        if (done) done();
    }

    /** Record the shadow generators this enemy's mesh was registered into, so the
     *  mesh can be removed from their renderLists when it is disposed. Called by
     *  EnemyManager when it registers the enemy as a shadow caster. */
    public setShadowGenerators(generators: ShadowGenerator[]): void {
        this._shadowGenerators = generators;
    }

    /**
     * Create a death effect — particle burst + gold reward float text
     */
    protected createDeathEffect(): void {
        const deathPos = this.position.clone();
        deathPos.y += 0.5;

        // --- Particle burst (capped to bound concurrent systems under mass kills) ---
        if (tryAcquireDeathBurst()) {
            const ps = new ParticleSystem('deathBurst', 30, this.scene);
            ps.emitter = deathPos;
            ps.minEmitBox = new Vector3(-0.2, 0, -0.2);
            ps.maxEmitBox = new Vector3(0.2, 0, 0.2);
            ps.color1 = new Color4(1, 0.8, 0.3, 1);
            ps.color2 = new Color4(0.8, 0.3, 0.1, 1);
            ps.colorDead = new Color4(0.3, 0.1, 0, 0);
            ps.minSize = 0.1;
            ps.maxSize = 0.35;
            ps.minLifeTime = 0.2;
            ps.maxLifeTime = 0.5;
            ps.emitRate = 100;
            ps.blendMode = ParticleSystem.BLENDMODE_ONEONE;
            ps.direction1 = new Vector3(-1, 1, -1);
            ps.direction2 = new Vector3(1, 2, 1);
            ps.minEmitPower = 1;
            ps.maxEmitPower = 3;
            ps.gravity = new Vector3(0, -5, 0);
            ps.start();
            scheduleDeathBurstTeardown(this.scene, ps, 0.15);
        }

        // --- Gold reward float-up text ---
        this.showGoldRewardText(deathPos);
    }

    /**
     * Show floating gold reward text at the death position.
     *
     * Position is passed by reference to the static callback — consumer must
     * NOT retain it (DamageNumberManager copies x/y/z into its slot mesh).
     */
    protected showGoldRewardText(position: Vector3): void {
        const cb = Enemy.onRewardCallback;
        if (cb) cb(position, this.reward);
    }

    /**
     * Check if the enemy is alive
     * @returns True if the enemy is alive
     */
    public isAlive(): boolean {
        return this.alive;
    }

    /**
     * Get the enemy's position
     * @returns The enemy's position
     */
    public getPosition(): Vector3 {
        return this.position;
    }

    /**
     * Get the damage this enemy deals to the player
     * @returns The damage amount
     */
    public getDamage(): number {
        return this.damage;
    }

    /**
     * Get the reward for killing this enemy
     * @returns The reward amount
     */
    public getReward(): number {
        return this.reward;
    }

    /**
     * Get the current health
     */
    public getHealth(): number {
        return this.health;
    }

    /**
     * Get the max health
     */
    public getMaxHealth(): number {
        return this.maxHealth;
    }

    /**
     * Returns the shield fraction (shield/maxShield) as a 0..1 number, or
     * undefined for enemy types that have no shield. Overridden by ShieldEnemy.
     * Used by the host snapshot to populate SnapshotEnemy.shield.
     */
    public getShieldFraction(): number | undefined {
        return undefined;
    }

    /**
     * Get the current path index (how far along the path this enemy is)
     */
    public getPathIndex(): number {
        return this.currentPathIndex;
    }

    /**
     * Heal this enemy by the specified amount (capped at maxHealth)
     */
    public heal(amount: number): void {
        if (!this.alive) return;
        this.health = Math.min(this.maxHealth, this.health + amount);
        this.updateHealthBar();
    }

    /**
     * Clean up resources
     */
    public dispose(): void {
        this.cancelMeleeAttack();

        // Guest corpse self-tick (playDeathAnimThenDispose) — cancel it so it
        // can't fire against the mesh released below.
        if (this._netCorpseObserver) {
            this.scene.onBeforeRenderObservable.remove(this._netCorpseObserver);
            this._netCorpseObserver = null;
        }

        // Restore any in-progress hit-flash before tearing materials down, so a
        // shared cached material isn't left stuck on HIT_TINT.
        this._restoreFlash();

        // Unparented aux visuals (idempotent — a die()d enemy already freed them).
        this.disposeAuxVisuals();

        // Release the mesh together with its cloned AnimationGroups + per-instance
        // materials (shared with die() so a kill frees the same resources).
        this._releaseMeshAndAnimations();

        // Health bar materials are per-enemy `new StandardMaterial(...)` allocations
        // (see createHealthBar). Dispose them explicitly along with their meshes.
        this._disposeHealthBarMeshes();

        // Dispose all status-effect particle systems. dispose(false): keep the
        // shared status-effect texture (see stopStatusEffectParticles).
        this.statusEffectParticles.forEach(particleSystem => {
            particleSystem.dispose(false);
        });
        this.statusEffectParticles.clear();
    }

    /**
     * Get the enemy type
     * @returns The enemy type
     */
    public getEnemyType(): EnemyType {
        return this.enemyType;
    }
    
    /**
     * Check if the enemy is flying
     * @returns True if the enemy is flying
     */
    public isEnemyFlying(): boolean {
        return this.isFlying;
    }
    
    /**
     * Check if the enemy is heavy
     * @returns True if the enemy is heavy
     */
    public isEnemyHeavy(): boolean {
        return this.isHeavy;
    }
    
    /**
     * Set the enemy type
     * @param type The enemy type
     */
    public setEnemyType(type: EnemyType): void {
        this.enemyType = type;
        
        // Update flying and heavy flags based on type
        this.isFlying = type === EnemyType.FLYING;
        this.isHeavy = type === EnemyType.HEAVY;
        
        // Update visuals based on type
        this.updateTypeVisuals();
    }
    
    /**
     * Update visuals based on enemy type
     */
    protected updateTypeVisuals(): void {
        if (!this.mesh) return;
        
        const material = this.mesh.material as StandardMaterial;
        
        switch (this.enemyType) {
            case EnemyType.FIRE:
                material.diffuseColor = new Color3(1, 0.3, 0);
                break;
                
            case EnemyType.WATER:
                material.diffuseColor = new Color3(0, 0.5, 1);
                break;
                
            case EnemyType.WIND:
                material.diffuseColor = new Color3(0.7, 1, 0.7);
                break;
                
            case EnemyType.EARTH:
                material.diffuseColor = new Color3(0.6, 0.3, 0);
                break;
                
            case EnemyType.ICE:
                material.diffuseColor = new Color3(0.8, 0.9, 1);
                break;
                
            case EnemyType.PLANT:
                material.diffuseColor = new Color3(0, 0.8, 0);
                break;
                
            case EnemyType.FLYING:
                material.diffuseColor = new Color3(0.8, 0.8, 1);
                // Make flying enemies hover higher
                this.mesh.position.y = 1.5;
                break;
                
            case EnemyType.HEAVY:
                material.diffuseColor = new Color3(0.5, 0.5, 0.5);
                // Make heavy enemies larger
                this.mesh.scaling = new Vector3(1.5, 1.5, 1.5);
                break;
                
            case EnemyType.LIGHT:
                material.diffuseColor = new Color3(1, 1, 0.8);
                // Make light enemies smaller
                this.mesh.scaling = new Vector3(0.7, 0.7, 0.7);
                break;
                
            case EnemyType.ELECTRIC:
                material.diffuseColor = new Color3(0.9, 0.9, 0);
                break;
                
            default:
                material.diffuseColor = new Color3(0.8, 0.2, 0.2);
                break;
        }
    }

    /**
     * Extend this enemy's path with additional waypoints.
     * Used when a new map segment is appended so in-flight enemies continue into it.
     */
    public extendPath(additionalPoints: Vector3[]): void {
        this.path.push(...additionalPoints);
    }

    /**
     * Push this enemy radially by `magnitude` world units in the given normalized
     * direction. No-op if the enemy is frozen or stunned (CC-immune window).
     * Boss subclasses may override to apply a fraction of the requested magnitude.
     *
     * Note: this only mutates `this.position` — the next seek-target frame will
     * pull the enemy back toward the hero, so the push is naturally bounded and
     * the enemy does not need to clamp itself to the arena radius.
     */
    public applyKnockback(dirX: number, dirZ: number, magnitude: number): void {
        if (!this.alive) return;
        // Co-op guest: render-only enemies are host-authoritative. Report the push
        // (already subclass-scaled — e.g. BossEnemy ×0.3 — by the time it reaches
        // this base body) and apply nothing locally; the host re-applies it through
        // the base implementation with its authoritative alive/CC gating.
        const kr = Enemy.guestKnockbackRedirect;
        if (kr) { kr(this.id, dirX, dirZ, magnitude); return; }
        if (this.isFrozen || this.isStunned) return;
        this.position.x += dirX * magnitude;
        this.position.z += dirZ * magnitude;
        if (this.mesh && !this.mesh.isDisposed()) {
            this.mesh.position.copyFrom(this.position);
            this.mesh.position.y -= this._curveDropY; // render-only globe drop
        }
    }

    // ── Co-op guest adapter methods ──────────────────────────────────────────
    // These are ADDITIVE: they are never called in single-player. The host
    // builds snapshots, the guest calls applyNetworkState() to drive its
    // locally-instantiated enemy meshes from the host's authoritative state.

    /**
     * Returns the current melee FSM state as an integer phase (0..3) and a
     * 0..1 progress through that phase. Used by the host to pack `flags.meleePhase`
     * into the snapshot so the guest can mirror the swing telegraph visually.
     *
     * Phase mapping: idle=0, windup=1, strike=2, cooldown=3
     */
    public getMeleeDisplay(): { phase: number; progress: number } {
        const phaseMap: Record<typeof this.meleeState, number> = {
            idle: 0, windup: 1, strike: 2, cooldown: 3,
        };
        const phase = phaseMap[this.meleeState];
        let progress = 0;
        switch (this.meleeState) {
            case 'windup':   progress = this.meleeWindupDuration   > 0 ? 1 - this.meleeTimer / this.meleeWindupDuration   : 1; break;
            case 'strike':   progress = this.meleeStrikeDuration   > 0 ? 1 - this.meleeTimer / this.meleeStrikeDuration   : 1; break;
            case 'cooldown': progress = this.meleeCooldownDuration > 0 ? 1 - this.meleeTimer / this.meleeCooldownDuration : 1; break;
        }
        return { phase, progress: Math.max(0, Math.min(1, progress)) };
    }

    /** Build (once) the list of named GLB skill clips and their snapshot anim
     *  codes. Clip names follow `<prefix>_skillN` (variants like `_skill2_3`
     *  map to their base skill, here 12). Empty for procedural enemies and for
     *  GLBs without skill-named clips. */
    private _getNetSkillClips(): { ag: AnimationGroup; code: number }[] {
        if (!this._netSkillClips) {
            this._netSkillClips = [];
            for (const ag of this.glbAnimationGroups) {
                const m = /_skill(\d+)/.exec(ag.name.toLowerCase());
                if (!m) continue;
                const n = parseInt(m[1], 10);
                if (n >= 1 && n <= 3) this._netSkillClips.push({ ag, code: 10 + n });
            }
        }
        return this._netSkillClips;
    }

    /**
     * Host-side: the animation code packed into SnapshotEnemy.anim — 1 walk /
     * 2 attack from the melee FSM, upgraded to 10+N when the GLB clip currently
     * playing is a named skill (`<prefix>_skillN`), so the guest mirrors the
     * exact boss/elite skill clip instead of its generic attack fallback.
     * Only called by the host's buildSnapshot (co-op); never in single-player.
     */
    public getNetAnimCode(): number {
        for (const { ag, code } of this._getNetSkillClips()) {
            if (ag.isPlaying) return code;
        }
        return this.meleeState !== 'idle' ? 2 : 1;
    }

    /**
     * Drive this enemy from a host-authoritative snapshot entry (guest side only).
     * Never called in single-player. Applies the NON-positional state: HP (eased
     * toward the host value by tickNetworkVisuals), status flags, and GLB clip
     * selection (walk vs attack) from the snapshot anim code. Position is driven
     * separately + smoothly via applyNetworkPosition() from an interpolation buffer.
     */
    public applyNetworkState(s: SnapshotEnemy): void {
        if (!this.mesh) return;

        const flags = _unpackEnemyFlagsInline(s.flags);

        // --- Health bar: ease, don't snap ---
        // Record the host-authoritative HP as the target; tickNetworkVisuals()
        // lerps the displayed value toward it every frame so the bar drains
        // smoothly instead of stepping on each (low-rate) snapshot. First
        // snapshot seeds the display value so there is no initial jump.
        const hp = Math.max(0, s.hp);
        // Guest-side hit flash: the host-authoritative HP dropped → this enemy was hit
        // this snapshot, so flash it (mirrors the host's per-hit flash; the guest never
        // runs takeDamage on render-only enemies).
        if (this._netHpTarget >= 0 && hp < this._netHpTarget - 0.5) this.flashHit();
        if (this._netHpTarget < 0) this.health = hp;
        this._netHpTarget = hp;

        // --- Status flags ---
        // Drive the persistent status particles on the guest from flag transitions, so
        // shared enemies visibly show frozen/stunned/confused (the guest never ticks the
        // status system that would otherwise spawn these). start on false→true, stop on
        // true→false. (burn/slow aren't in the flag set yet — see the share-coverage audit.)
        this._syncNetStatusParticles(this.isFrozen,   flags.frozen,   StatusEffect.FROZEN);
        this._syncNetStatusParticles(this.isStunned,  flags.stunned,  StatusEffect.STUNNED);
        this._syncNetStatusParticles(this.isConfused, flags.confused, StatusEffect.CONFUSED);
        this.isFrozen   = flags.frozen;
        this.isStunned  = flags.stunned;
        this.isConfused = flags.confused;

        // --- Animation: drive the GLB clip from the host's anim code ---
        // 2 = attacking (host melee FSM is past idle), 10+N = named _skillN
        // clip, anything else = walk. See SnapshotEnemy.anim.
        this._applyNetworkAnim(s.anim);
    }

    /** Guest-side per-frame visuals tick: eases the displayed HP bar toward the
     *  host-authoritative target. Called every frame by GuestEnemies (NOT on the
     *  host — there the bar is driven directly by takeDamage). */
    public tickNetworkVisuals(deltaTime: number): void {
        if (this._netHpTarget < 0 || this.health === this._netHpTarget) return;
        // Exponential ease (~80ms time constant) — frame-rate independent.
        const k = 1 - Math.exp(-12 * deltaTime);
        this.health += (this._netHpTarget - this.health) * k;
        if (Math.abs(this.health - this._netHpTarget) < 0.5) this.health = this._netHpTarget;
        if (this.healthBarMesh && !this.healthBarMesh.isDisposed() &&
            this.healthBarBackgroundMesh && !this.healthBarBackgroundMesh.isDisposed()) {
            this.updateHealthBar();
        }
    }

    /** Guest-side: start/stop the persistent status-particle FX from a flag transition. */
    private _syncNetStatusParticles(was: boolean, now: boolean, effect: StatusEffect): void {
        if (now && !was) this.createStatusEffectParticles(effect);
        else if (!now && was) this.stopStatusEffectParticles(effect);
    }

    /** Guest-side: switch the GLB clip to attack (anim===2), the named skill
     *  clip (anim>=10 → _skillN, falling back to attack when this instance has
     *  no matching clip), or walk. No-op for procedural enemies (no anim
     *  groups). Categorises the groups lazily from glbAnimationGroups the first
     *  time it runs.
     *
     *  Clips loop (the host loops its current clip too — every playGlbAnim call
     *  passes loop=true); the `_netCurrentAnim === slot` guard means repeated
     *  20 Hz snapshots with the same code never restart the clip, and when the
     *  snapshot code drops back to 1 the walk slot takes over. */
    private _applyNetworkAnim(anim: number): void {
        if (this.glbAnimationGroups.length === 0) return;
        if (!this._netAnimCategorized) {
            this._netAnimCategorized = true;
            for (const ag of this.glbAnimationGroups) {
                const n = ag.name.toLowerCase();
                if (n.includes('run3')) this._netWalkAnim = ag;
                else if (!this._netWalkAnim && (n.includes('walk') || n.includes('run'))) this._netWalkAnim = ag;
                else if (!this._netAttackAnim && (n.includes('attack') || n.includes('hit') ||
                         n.includes('punch') || n.includes('strike') || n.includes('swing') ||
                         n.includes('skill'))) this._netAttackAnim = ag;
            }
            if (!this._netWalkAnim && this.glbAnimationGroups.length > 0) this._netWalkAnim = this.glbAnimationGroups[0];
            if (!this._netAttackAnim) this._netAttackAnim = this._netWalkAnim;
        }
        let slot: AnimationGroup | null;
        if (anim >= 10) {
            slot = this._getNetSkillClips().find(s => s.code === anim)?.ag ?? this._netAttackAnim;
        } else {
            slot = anim === 2 ? this._netAttackAnim : this._netWalkAnim;
        }
        if (!slot || this._netCurrentAnim === slot) return;
        if (this._netCurrentAnim) this._netCurrentAnim.stop();
        slot.start(true);
        this._netCurrentAnim = slot;
    }

    /** Set the (interpolated) network position — drives both this.position (so
     *  getPosition()/targeting see it) and the mesh. Called every frame by the
     *  guest with a buffered, time-interpolated pose for smooth movement. */
    public applyNetworkPosition(x: number, y: number, z: number, ry: number): void {
        if (!this.mesh) return;
        this.position.x = x;
        this.position.y = y;
        this.position.z = z;
        // Guest render copy: same render-only globe drop as the host's update().
        this._curveDropY = Enemy.curveDropFn ? Enemy.curveDropFn(x, z) : 0;
        if (!this.mesh.isDisposed()) {
            this.mesh.position.copyFrom(this.position);
            this.mesh.position.y -= this._curveDropY;
            this.mesh.rotation.y = ry;
        }
    }

    /** Below this interpolated speed (units/s) the guest's procedural walk
     *  cycle pauses — mirrors the host freezing the walk pose when an enemy
     *  isn't actually moving (rooted mid-swing, snapshot stall, knock pause). */
    private static readonly NET_ANIM_MIN_SPEED = 0.05;

    /**
     * Guest-only: advance the procedural limb animation from the interpolated
     * network motion. The guest never ticks enemy AI (update()), which is what
     * animates procedural parts on the host — without this, non-GLB enemies
     * (procedural Boss / fallback meshes) slide around as frozen statues.
     *
     * No-op for GLB enemies (their net-driven clips via _applyNetworkAnim
     * already animate them) and while frozen/stunned or (near) stationary.
     * `speed` is the horizontal speed estimate from the interpolation buffer.
     * NEVER called on the host — its update() drives the same pose helper
     * directly, so single-player behaviour is untouched.
     */
    public tickNetworkProceduralAnim(deltaTime: number, speed: number): void {
        if (this.glbAnimationGroups.length > 0) return; // GLB: clips drive it
        if (!this.alive || !this.mesh || this.mesh.isDisposed()) return;
        // While frozen/stunned or (near) stationary, HOLD the pose rather than
        // skip it: applyNetworkPosition rewrites mesh.position from the
        // ground-level network y every frame, so the pose pass must still run
        // to re-apply the body-height offset. dt=0 leaves the walk phase (and
        // thus the stance) unchanged — mirroring the host, which freezes the
        // pose by returning before its mesh-position copy.
        const hold = this.isFrozen || this.isStunned || speed < Enemy.NET_ANIM_MIN_SPEED;
        this.animateProceduralParts(hold ? 0 : deltaTime);
    }

    /** One frame of procedural part animation: advance the subclass's walk
     *  phase and pose its limbs. Shared entry point — the host's update()
     *  calls it inside its own movement/CC gates, and the guest calls it via
     *  tickNetworkProceduralAnim. Base class has no procedural parts. */
    protected animateProceduralParts(_deltaTime: number): void {
        // Subclasses with procedural part animation override this.
    }

    /**
     * Guest-only death (driven by a host DeathMsg): play the GLB `<prefix>_dead`
     * clip, linger, then release through the same leak-safe path as a host kill
     * (disposeCorpse → skeleton RawTexture + anim groups + per-instance materials
     * + shadow renderLists). Runs NONE of the host-side death logic — no reward,
     * no kill/shatter callbacks, no drops; those already happened on the host.
     *
     * The caller (GuestEnemies.death) must have removed this enemy from its
     * registry FIRST, so snapshots/interpolation can no longer drive it, and
     * keeps it in a lingering set so teardown can disposeCorpse() it early —
     * `onDisposed` fires exactly once when the corpse is finally released.
     */
    public playDeathAnimThenDispose(onDisposed?: () => void): void {
        if (!this.alive) {
            // Already a corpse / disposed — honour the contract: caller's lingering
            // entry must still be pruned so it doesn't pin the Set indefinitely.
            onDisposed?.();
            return;
        }
        this.alive = false;
        this._netCorpseOnDisposed = onDisposed ?? null;

        // Mirror what die() stops during the corpse phase: melee swing, hit-flash
        // tint (shared cached material!), HP bar, persistent status particles.
        this.cancelMeleeAttack();
        this._restoreFlash();
        this._disposeHealthBarMeshes();
        this.statusEffectParticles.forEach(particleSystem => {
            particleSystem.stop();
            particleSystem.dispose(false);
        });
        this.statusEffectParticles.clear();

        // No GLB animation (procedural enemy) or no mesh left: nothing to play.
        if (this.glbAnimationGroups.length === 0 || !this.mesh || this.mesh.isDisposed()) {
            this.disposeCorpse();
            return;
        }

        // Reuses the host's clip lookup + duration estimate; stops the looping
        // net walk/attack clip and sets corpseTimeRemaining.
        this._netCurrentAnim = null;
        this._beginDeathSequence();

        this._netCorpseObserver = this.scene.onBeforeRenderObservable.add(() => {
            const dt = this.scene.getEngine().getDeltaTime() / 1000;
            if (this.tickCorpse(dt)) this.disposeCorpse();
        });
    }

}

// Inline flag unpacker used by Enemy.applyNetworkState(). Mirrors
// unpackEnemyFlags in EnemyFlags.ts to avoid pulling the co-op net module
// into the base Enemy class (which is imported by every enemy subclass and
// thus every enemy chunk). EnemyFlags.ts is tiny, so inlining is acceptable.
function _unpackEnemyFlagsInline(bits: number): {
    frozen: boolean; stunned: boolean; confused: boolean;
    flying: boolean; elite: boolean; meleePhase: number;
} {
    return {
        frozen:     (bits & 1) !== 0,
        stunned:    (bits & (1 << 1)) !== 0,
        confused:   (bits & (1 << 2)) !== 0,
        flying:     (bits & (1 << 3)) !== 0,
        elite:      (bits & (1 << 4)) !== 0,
        meleePhase: (bits >> 5) & 0b11,
    };
}