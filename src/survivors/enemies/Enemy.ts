import { Vector3, Mesh, MeshBuilder, StandardMaterial, Color3, Color4, Scene, ParticleSystem, Texture, DynamicTexture, Sound, Animation, AnimationGroup, Skeleton } from '@babylonjs/core';
import { Game } from '../../engine/Game';
import { EnemyType, StatusEffect } from '../GameTypes';

// Cached health-bar colors — shared across all enemy instances to avoid per-frame
// allocations. Exported so enemy subclasses that override updateHealthBar() reuse
// the same constants instead of allocating `new Color3(...)` every frame.
// These are assigned (never mutated in place) onto health-bar materials, so
// sharing one instance across all enemies is safe.
export const HEALTH_COLOR_GREEN  = new Color3(0.2, 0.8, 0.2);
export const HEALTH_COLOR_YELLOW = new Color3(0.8, 0.8, 0.2);
export const HEALTH_COLOR_RED    = new Color3(0.8, 0.2, 0.2);

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
    public static onDamageCallback: ((position: Vector3, damage: number, isCrit: boolean) => void) | null = null;
    public static onRewardCallback: ((position: Vector3, reward: number) => void) | null = null;

    protected game: Game;
    protected scene: Scene;
    protected mesh: Mesh | null = null;
    protected healthBarMesh: Mesh | null = null;
    protected healthBarBackgroundMesh: Mesh | null = null;
    protected healthBarOutlineMesh: Mesh | null = null;

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
    } | null = null;
    public contactDamagePerSecond: number = 10;
    public isElite: boolean = false;
    public eliteDropElement: string | null = null;

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

    /** Skeletons cloned by GLB instantiation (`instantiateModelsToScene` with
     *  doNotInstantiate:true does a full Skeleton.clone() per instance). Each
     *  cloned skeleton allocates its OWN bone-matrix RawTexture on first render
     *  (Skeleton.useTextureToStoreBoneMatrices defaults true), freed only by
     *  Skeleton.dispose(). mesh.dispose() does NOT cascade to the skeleton, so
     *  without this every spawn leaked one texture (the steady scene.textures
     *  climb across waves). Subclasses register them via
     *  `this.glbSkeletons = inst.skeletons`. */
    protected glbSkeletons: Skeleton[] = [];

    // Elemental properties
    protected enemyType: EnemyType = EnemyType.NORMAL;
    protected isFlying: boolean = false;
    protected isHeavy: boolean = false;
    
    // Status effect properties
    protected activeStatusEffects: Map<StatusEffect, { endTime: number, strength: number }> = new Map();
    protected statusEffectParticles: Map<StatusEffect, ParticleSystem> = new Map();
    protected isFrozen: boolean = false;
    protected isStunned: boolean = false;
    protected isConfused: boolean = false;
    protected confusedDirection: Vector3 | null = null;
    protected burnDamageInterval: number = 0.5; // Seconds between burn damage ticks
    protected lastBurnDamageTime: number = 0;
    protected burnDamagePerTick: number = 0;
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
    }

    /**
     * Scale both current and max HP by `mult`. Used by elite promotion and by
     * the orb-pickup global HP buff. Safe to call any time after construction.
     */
    public applyHealthMultiplier(mult: number): void {
        this.health *= mult;
        this.maxHealth *= mult;
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

        // Frame color + glow per tier
        let frameColor: Color3;
        let frameEmissive: Color3;
        if (this.barTier === 'boss') {
            frameColor    = new Color3(1.0, 0.20, 0.15);
            frameEmissive = new Color3(0.55, 0.10, 0.05);
        } else if (this.barTier === 'elite') {
            frameColor    = new Color3(1.0, 0.55, 0.15);
            frameEmissive = new Color3(0.35, 0.18, 0.04);
        } else {
            frameColor    = new Color3(0, 0, 0);
            frameEmissive = Color3.Black();
        }

        // Outline / frame (slightly larger than background)
        this.healthBarOutlineMesh = MeshBuilder.CreateBox('healthBarOutline', {
            width:  width  + 0.08,
            height: height + 0.06,
            depth:  0.04,
        }, this.scene);
        this.healthBarOutlineMesh.position = new Vector3(this.position.x, y, this.position.z);
        const outlineMaterial = new StandardMaterial('healthBarOutlineMaterial', this.scene);
        outlineMaterial.diffuseColor  = frameColor;
        outlineMaterial.emissiveColor = frameEmissive;
        outlineMaterial.specularColor = Color3.Black();
        this.healthBarOutlineMesh.material = outlineMaterial;

        // Background (gray)
        this.healthBarBackgroundMesh = MeshBuilder.CreateBox('healthBarBg', { width, height, depth: 0.05 }, this.scene);
        this.healthBarBackgroundMesh.position = new Vector3(this.position.x, y, this.position.z);
        const bgMaterial = new StandardMaterial('healthBarBgMaterial', this.scene);
        bgMaterial.diffuseColor  = new Color3(0.3, 0.3, 0.3);
        bgMaterial.specularColor = Color3.Black();
        this.healthBarBackgroundMesh.material = bgMaterial;

        // Foreground (green health fill)
        this.healthBarMesh = MeshBuilder.CreateBox('healthBar', { width, height, depth: 0.06 }, this.scene);
        this.healthBarMesh.position = new Vector3(this.position.x, y, this.position.z);
        const healthMaterial = new StandardMaterial('healthBarMaterial', this.scene);
        healthMaterial.diffuseColor  = HEALTH_COLOR_GREEN;
        healthMaterial.specularColor = Color3.Black();
        this.healthBarMesh.material = healthMaterial;

        this.healthBarOutlineMesh.billboardMode    = Mesh.BILLBOARDMODE_ALL;
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
                const segMat = new StandardMaterial(`segMat_${i}`, this.scene);
                segMat.diffuseColor  = Color3.Black();
                segMat.specularColor = Color3.Black();
                seg.material        = segMat;
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
        const y = this.position.y + this.barHeightOffset;

        // Calculate health percentage
        const healthPercent = Math.max(0, this.health / this.maxHealth);

        // Update health bar width based on health percentage
        this.healthBarMesh.scaling.x = healthPercent;

        // Adjust position to align left side (offset scales with bar width)
        const offset = (1 - healthPercent) * (width * 0.5);
        this.healthBarMesh.position.x = this.position.x - offset;

        // Update health bar color based on health percentage (use cached Color3 to avoid per-frame allocs)
        const material = this.healthBarMesh.material as StandardMaterial;
        if (healthPercent > 0.6) {
            material.diffuseColor = HEALTH_COLOR_GREEN;
        } else if (healthPercent > 0.3) {
            material.diffuseColor = HEALTH_COLOR_YELLOW;
        } else {
            material.diffuseColor = HEALTH_COLOR_RED;
        }

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

    /** Dispose only the health-bar meshes/materials (keeps the enemy alive). */
    private _disposeHealthBarMeshes(): void {
        if (this.healthBarMesh) {
            const m = this.healthBarMesh.material;
            this.healthBarMesh.dispose();
            if (m) m.dispose();
            this.healthBarMesh = null;
        }
        if (this.healthBarBackgroundMesh) {
            const m = this.healthBarBackgroundMesh.material;
            this.healthBarBackgroundMesh.dispose();
            if (m) m.dispose();
            this.healthBarBackgroundMesh = null;
        }
        if (this.healthBarOutlineMesh) {
            const m = this.healthBarOutlineMesh.material;
            this.healthBarOutlineMesh.dispose();
            if (m) m.dispose();
            this.healthBarOutlineMesh = null;
        }
        for (const seg of this.barSegmentMeshes) {
            if (seg && !seg.isDisposed()) {
                const m = seg.material;
                seg.dispose();
                if (m) m.dispose();
            }
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
        if (this.seekTarget) {
            // Always tick status effects so slow/freeze/stun/burn still work
            this.updateStatusEffects(deltaTime);

            // Don't move if frozen or stunned (also cancel any in-progress swing)
            if (this.isFrozen || this.isStunned) {
                if (this.meleeState !== 'idle') this.cancelMeleeAttack();
                return false;
            }

            // Fetch the hero position ONCE per frame — Champion.getPosition() clones
            // a fresh Vector3 on each call, so calling it twice per enemy per frame
            // (once for the swing tick, once for movement) doubles GC pressure and
            // eventually triggers a stop-the-world pause that looks like a freeze.
            const targetPos = this.seekTarget.getPosition();

            // Tick the melee-swing state machine BEFORE movement so we can root
            // the enemy (skip movement) during windup + strike frames.
            this.updateMeleeAttack(deltaTime, targetPos);
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

            if (this.mesh && !this.mesh.isDisposed()) {
                this.mesh.position.copyFrom(this.position);
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
        // Early-out: most enemies have no active status effects.
        if (this.activeStatusEffects.size === 0) return;

        const currentTime = performance.now();
        this._expiredStatusEffects.length = 0;

        for (const [effect, effectData] of this.activeStatusEffects) {
            if (currentTime > effectData.endTime) {
                this._expiredStatusEffects.push(effect);
            } else if (effect === StatusEffect.BURNING) {
                this.processBurningEffect(deltaTime);
            }
            // Other effects are gated by state flags (isFrozen, isSlowed, …).
        }

        for (let i = 0; i < this._expiredStatusEffects.length; i++) {
            this.removeStatusEffect(this._expiredStatusEffects[i]);
        }
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
     *  clone per enemy per frame. */
    private updateMeleeAttack(deltaTime: number, heroPos: Vector3): void {
        if (!this.canMeleeAttack() || !this.seekTarget) {
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
                        this.seekTarget.takeDamage?.(this.meleeHitDamage, this.position);
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

    /**
     * Process burning damage over time
     * @param deltaTime Time elapsed since last update in seconds
     */
    protected processBurningEffect(deltaTime: number): void {
        const currentTime = performance.now();
        const burnData = this.activeStatusEffects.get(StatusEffect.BURNING);
        
        if (!burnData) return;
        
        // Check if it's time for another burn damage tick
        if (currentTime - this.lastBurnDamageTime > this.burnDamageInterval * 1000) {
            // Apply burn damage
            this.takeDamage(this.burnDamagePerTick);
            this.lastBurnDamageTime = currentTime;
        }
    }

    /**
     * Apply a status effect to this enemy
     * @param effect The status effect to apply
     * @param duration Duration of the effect in seconds
     * @param strength Strength of the effect (e.g., slow percentage, damage per tick)
     */
    public applyStatusEffect(effect: StatusEffect, duration: number, strength: number): void {
        const currentTime = performance.now();
        const endTime = currentTime + (duration * 1000);

        // Apply effect-specific changes
        switch (effect) {
            case StatusEffect.BURNING:
                this.activeStatusEffects.set(effect, { endTime, strength });
                this.burnDamagePerTick = strength;
                this.lastBurnDamageTime = currentTime;
                this.createStatusEffectParticles(effect);
                break;

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
        
        // Stop any existing particles for this effect
        this.stopStatusEffectParticles(effect);
        
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
    public takeDamage(amount: number): boolean {
        if (!this.alive) return false;

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

        this.health -= actualDamage;

        // Update health bar instead of scaling
        this.updateHealthBar();

        // Hit flash: briefly turn mesh white for 80ms
        this.flashHit();

        // Fire the static damage callback (replaces a CustomEvent dispatch +
        // detail object allocation per hit). Position is passed by reference —
        // consumer must NOT retain the Vector3.
        const dmgCb = Enemy.onDamageCallback;
        if (dmgCb) dmgCb(this.position, actualDamage, isCrit);

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
    protected _releaseMeshAndAnimations(): void {
        // Stop + dispose every AnimationGroup that GLB instantiation cloned for
        // this enemy, or the animatables keep running every frame after the mesh
        // is gone.
        for (const ag of this.glbAnimationGroups) {
            try { ag.stop(); } catch (_) { /* already stopped */ }
            try { ag.dispose(); } catch (_) { /* already disposed */ }
        }
        this.glbAnimationGroups.length = 0;

        if (this.mesh) {
            // Dispose per-instance materials (cloned via instantiateModelsToScene
            // with cloneMaterials=true) but NOT their textures. The textures are
            // shared with the source AssetContainer — disposing them was nulling
            // bone-matrix RawTextures on the source skeleton, crashing the next
            // instantiateModelsToScene (e.g. after death → re-pick champion)
            // inside Mesh.clone → Skeleton.prepare.
            const allMeshes = [this.mesh, ...this.mesh.getChildMeshes(false)];
            for (const m of allMeshes) {
                const mat = m.material;
                if (mat) {
                    m.material = null;
                    try { mat.dispose(false, false); } catch (_) { /* already disposed */ }
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
     * Handle enemy death
     */
    protected die(): void {
        if (!this.alive) return;

        this.alive = false;

        // Tear down any in-progress melee swing.
        this.cancelMeleeAttack();

        // Create death effect
        this.createDeathEffect();

        // If a hit-flash is mid-window, restore original emissives now — once the
        // mesh is gone update() stops ticking and the restore would never fire,
        // leaving any SHARED (cached) material stuck on HIT_TINT for other enemies.
        this._restoreFlash();

        // Release the mesh together with its cloned AnimationGroups + per-instance
        // materials. Disposing the mesh alone leaks both (the wave-N freeze).
        this._releaseMeshAndAnimations();

        // Remove health bar (handles segments + boss label too)
        this._disposeHealthBarMeshes();

        // Remove status effect particles. dispose(false): keep the shared
        // status-effect texture (see stopStatusEffectParticles).
        this.statusEffectParticles.forEach(particleSystem => {
            particleSystem.stop();
            particleSystem.dispose(false);
        });
        this.statusEffectParticles.clear();

        // Note: Money reward is handled by the EnemyManager which has access to PlayerStats
        // We don't need to award money here as it's done in EnemyManager.update()
    }

    /**
     * Create a death effect — particle burst + gold reward float text
     */
    protected createDeathEffect(): void {
        const deathPos = this.position.clone();
        deathPos.y += 0.5;

        // --- Particle burst ---
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
        setTimeout(() => { ps.stop(); setTimeout(() => ps.dispose(), 600); }, 150);

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

        // Restore any in-progress hit-flash before tearing materials down, so a
        // shared cached material isn't left stuck on HIT_TINT.
        this._restoreFlash();

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
        if (this.isFrozen || this.isStunned) return;
        this.position.x += dirX * magnitude;
        this.position.z += dirZ * magnitude;
        if (this.mesh && !this.mesh.isDisposed()) {
            this.mesh.position.copyFrom(this.position);
        }
    }

}