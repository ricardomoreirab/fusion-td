import { Vector3, MeshBuilder, StandardMaterial, Color3, Mesh, AssetContainer, AnimationGroup, TransformNode, Quaternion } from '@babylonjs/core';
import { Game } from '../../engine/Game';
import { BossEnemy } from './BossEnemy';
import { DifficultyTuning } from '../DifficultyTuning';
import { emitCoopFx } from '../coop/CoopFx';

/**
 * Special-move state machine. The boss alternates between free movement
 * ('walking') and a telegraphed special: a slashing dash or a grab-and-pull.
 * Which special fires is chosen from the per-tier action rotation.
 */
type LungeState = 'walking' | 'telegraph' | 'dashing' | 'pulling' | 'recover';
type SpecialAction = 'dash' | 'pull';

/**
 * Per-tier identity (these spawn at waves 5/10/15/20):
 *   Tier 1 — Ravager : fastest mover, frequent slashing dashes (dash deals AoE).
 *   Tier 2 — Warden  : grabs the hero, pulls them in, and the slam slows them.
 *   Tier 3 — Gemini  : spawns a twin on the opposite side; enrages when it dies.
 *   Tier 4 — Apex    : all of the above combined.
 */
const TIER_ACTIONS: Record<number, SpecialAction[]> = {
    1: ['dash'],
    2: ['pull'],
    3: ['dash'],
    4: ['dash', 'pull'],
};
function tierActions(tier: number): SpecialAction[] { return TIER_ACTIONS[tier] ?? ['dash', 'pull']; }

/** Boss name label per tier (shown above the boss HP bar). */
const TIER_LABEL: Record<number, string> = {
    1: 'Ravager',
    2: 'Warden',
    3: 'Gemini',
    4: 'Apex Tyrant',
};
function tierLabel(tier: number): string { return TIER_LABEL[tier] ?? 'Apex Tyrant'; }

/** Per-tier stat multipliers applied on top of BossEnemy base stats. */
const TIER_HP_MULT:    Record<number, number> = { 1: 1.8, 2: 2.6, 3: 3.4, 4: 4.4 };
const TIER_DPS_MULT:   Record<number, number> = { 1: 1.0, 2: 1.1, 3: 1.2, 4: 1.3 };

/**
 * Per-tier ABSOLUTE base movement speed (world units/sec). Overrides BossEnemy's
 * path-walker speed of 0.7 — that was tuned for TD-mode path crawling. Hero base
 * speed is 7 u/s. Tier 1 (the Ravager) is the fastest mover so it can close and
 * dash-slash through a kiting hero; the others rely on their grab / twin to catch
 * the player and so sit a touch slower.
 */
const TIER_BASE_SPEED: Record<number, number> = { 1: 6.8, 2: 5.8, 3: 6.2, 4: 7.0 };

/** Tier 5+ HP: 4.4 + 0.6 × (tier − 4). DPS and base speed clamp at tier-4 values. */
function tierHpMult(tier: number): number {
    return tier <= 4 ? TIER_HP_MULT[tier] : 4.4 + 0.6 * (tier - 4);
}
function tierDpsMult(tier: number): number   { return TIER_DPS_MULT[tier]   ?? 1.3; }
function tierBaseSpeed(tier: number): number { return TIER_BASE_SPEED[tier] ?? 7.0; }

/** Special-move cadence per tier (seconds between specials). Faster at higher tiers. */
const LUNGE_COOLDOWN_BY_TIER: Record<number, number> = { 1: 2.6, 2: 3.2, 3: 3.0, 4: 2.4 };
function lungeCooldown(tier: number): number {
    return LUNGE_COOLDOWN_BY_TIER[tier] ?? 2.4;
}

/** Tier 2+ leads the hero by predicting their movement. */
function hasSidestepPredict(tier: number): boolean { return tier >= 2; }
/** Tier 3+ spawns a twin and enrages when it dies. */
function hasClone(tier: number): boolean { return tier >= 3; }

const TELEGRAPH_DURATION = 0.6;  // seconds rooted before the special fires
const DASH_DURATION      = 0.5;  // seconds of dash motion (≈6 units at 12 u/s)
const DASH_DISTANCE      = 6.0;  // world units travelled per dash
const DASH_SPEED         = 12.0; // world units per second during dash
const RECOVER_DURATION   = 0.4;  // seconds rooted after the special
const PREDICT_LEAD_TIME  = 0.4;  // seconds of hero velocity to lead by on tier 2+

// Slashing dash (tiers 1/3/4): the dash deals AoE damage to anything it passes
// through, once per dash.
const DASH_SLASH_RADIUS        = 3.0;  // hero within this of the dash line gets slashed
const DASH_SLASH_DAMAGE_FACTOR = 1.2;  // × the boss's melee hit damage

// Grab-and-pull (tiers 2/4): the boss roots, drags the hero in, then slams.
const PULL_DURATION         = 0.6;  // seconds the hero is dragged inward
const PULL_SPEED            = 15.0; // u/s drag toward the boss (hero base speed is 7)
const PULL_SLAM_RADIUS      = 4.5;  // hero within this when the pull ends takes the slam
const PULL_SLAM_DAMAGE_FACTOR = 1.1; // × the boss's melee hit damage
const PULL_SLOW_MULT        = 0.45; // hero moves at 45% speed after a slam connects
const PULL_SLOW_DURATION    = 2.0;  // seconds of slow
const PULL_TELEGRAPH_RADIUS = 3.0;  // visual grab-zone radius

const ENRAGE_LUNGE_FACTOR = 0.5; // halves the special cooldown while enraged (2× rate)

export class MilestoneBoss extends BossEnemy {
    /** Static slot used by EnemyManager.spawnSurvivorsEnemy to stage a preloaded GLB
     *  asset (per-tier boss model) before constructing. createMesh consumes + clears. */
    public static pendingAsset: AssetContainer | null = null;

    /** Public so EnemyManager can check it on death without instanceof. */
    public readonly isMilestone: boolean = true;
    /** Public so the item-drop handler can pick the right item for this kill. */
    public readonly waveTier: number;
    /** True for a twin spawned by a Gemini/Apex boss. Clones never spawn further
     *  clones, never drop milestone items, and notify their origin on death. */
    public readonly isClone: boolean;

    private lungeState: LungeState = 'walking';
    private stateTimer: number = 0;
    private lungeTimer: number;
    private pendingAction: SpecialAction = 'dash';
    private actionIndex: number = 0;
    private dashDirX: number = 0;
    private dashDirZ: number = 0;
    private dashDistanceRemaining: number = 0;
    private dashHasHit: boolean = false;
    private enraged: boolean = false;

    /** Damage dealt by a dash slash / pull slam — derived from melee hit damage. */
    private readonly dashSlashDamage: number;
    private readonly pullSlamDamage: number;

    // Twin/enrage linkage (tier 3/4).
    private cloneSpawned: boolean = false;
    private enrageOrigin: MilestoneBoss | null = null;

    // Hero velocity tracking for sidestep predict (tier 2+)
    // Last hero position stored as scalars (only x/z matter for 2D velocity) so
    // the per-frame velocity tracking doesn't clone a Vector3 every frame.
    private lastHeroX: number = 0;
    private lastHeroZ: number = 0;
    private hasLastHeroPos: boolean = false;
    private heroVelX: number = 0;
    private heroVelZ: number = 0;

    // Telegraph visual — disposed when state leaves 'telegraph'
    private telegraphRing: Mesh | null = null;

    // GLB animation state (mirrors the minion pattern).
    private usingGLB: boolean = false;
    private glbWalkAnim: AnimationGroup | null = null;
    private glbAttackAnim: AnimationGroup | null = null;
    private glbIdleAnim: AnimationGroup | null = null;
    private glbCurrentAnim: AnimationGroup | null = null;
    /** Slightly larger than the inherited melee swing range so the GLB attack
     *  animation eases in just before the windup begins. */
    private static readonly GLB_ATTACK_RANGE = 3.2;

    constructor(
        game: Game,
        position: Vector3,
        path: Vector3[],
        waveTier: number,
        strengthMultiplier: number = 1,
        isClone: boolean = false,
    ) {
        super(game, position, path);
        this.waveTier = waveTier;
        this.isClone = isClone;
        this.lungeTimer = lungeCooldown(waveTier);

        // Apply tier-scaled stat multipliers on top of the base BossEnemy stats.
        // strengthMultiplier comes from WaveManager when a wave config asked for
        // multiple bosses (collapsed into 1 stronger boss), or from EnemyManager
        // when spawning a weaker twin (0.6).
        const hpMult    = tierHpMult(waveTier) * strengthMultiplier * DifficultyTuning.bossHpMult;
        const dpsMult   = tierDpsMult(waveTier) * strengthMultiplier * DifficultyTuning.bossDamageMult;
        const baseSpeed = tierBaseSpeed(waveTier);

        // BossEnemy constructor already set maxHealth=500, meleeHitDamage=35, contactDamagePerSecond=30.
        this.maxHealth = Math.floor(this.maxHealth * hpMult);
        this.health    = this.maxHealth;
        // Speed is OVERRIDDEN (not multiplied) — BossEnemy.speed = 0.7 is for path-walker TD mode.
        this.speed     = baseSpeed;
        this.originalSpeed = baseSpeed;
        this.contactDamagePerSecond = this.contactDamagePerSecond * dpsMult;

        // Difficulty rebalance: boss melee (and the dash/pull derived from it)
        // hits harder. Applied before the dash/pull derivation below.
        this.meleeHitDamage = Math.round(this.meleeHitDamage * DifficultyTuning.bossDamageMult);

        // Special-move damage scales with the boss's melee hit damage.
        this.dashSlashDamage = Math.round(this.meleeHitDamage * DASH_SLASH_DAMAGE_FACTOR);
        this.pullSlamDamage  = Math.round(this.meleeHitDamage * PULL_SLAM_DAMAGE_FACTOR);

        // Build mesh + health bar AFTER field initializers have run (see Enemy
        // constructor note). Guarded so it fires once for MilestoneBoss (the
        // BossEnemy super-constructor's own guarded build is skipped). Runs the
        // most-derived createMesh() (the tier GLB) with this.position already set
        // and pendingAsset still staged.
        if (new.target === MilestoneBoss) this._initEnemyVisuals();

        // Re-label the boss HP bar for this tier (clones read as "Echo").
        const label = isClone ? `${tierLabel(waveTier)} Echo` : tierLabel(waveTier);
        this.applyHealthBarTier('boss', { heightOffset: 3.6, label });

        this.updateHealthBar();
    }

    /** Override BossEnemy's Abyssal Titan mesh with the staged tier GLB, if any. */
    protected createMesh(): void {
        const asset = MilestoneBoss.pendingAsset;
        MilestoneBoss.pendingAsset = null;
        if (asset) {
            this.createMeshFromGLB(asset);
            return;
        }
        super.createMesh();
    }

    private createMeshFromGLB(asset: AssetContainer): void {
        this.usingGLB = true;
        this.mesh = new Mesh('milestoneBossGlbRoot', this.scene);
        this.mesh.position.copyFrom(this.position);

        const inst = asset.instantiateModelsToScene(
            name => `boss_${name}`,
            true,
            { doNotInstantiate: true },
        );
        const BOSS_SCALE = 2.2; // visibly larger than minions / hero
        for (const root of inst.rootNodes) {
            root.parent = this.mesh;
            if ('scaling' in root && root.scaling) {
                (root as TransformNode).scaling.scaleInPlace(BOSS_SCALE);
            }
            const tn = root as TransformNode;
            const flip = Quaternion.RotationYawPitchRoll(Math.PI, 0, 0);
            if (tn.rotationQuaternion) {
                tn.rotationQuaternion = flip.multiply(tn.rotationQuaternion);
            } else if (tn.rotation) {
                tn.rotation.y += Math.PI;
            }
        }

        // Feet-on-ground offset.
        this.mesh.computeWorldMatrix(true);
        const bbox = this.mesh.getHierarchyBoundingVectors(true);
        const feetOffset = -bbox.min.y;
        for (const root of inst.rootNodes) {
            if ('position' in root && root.position) {
                (root as TransformNode).position.y += feetOffset;
            }
        }

        // Register groups for base-class dispose cleanup (prevents animatable leak).
        this.glbAnimationGroups = inst.animationGroups;
        this.glbSkeletons = inst.skeletons;

        for (const ag of inst.animationGroups) ag.stop();
        for (const ag of inst.animationGroups) {
            const n = ag.name.toLowerCase();
            if (n.includes('run3')) {
                this.glbWalkAnim = ag;
            } else if (!this.glbWalkAnim && (n.includes('walk') || n.includes('run') || n.includes('move'))) {
                this.glbWalkAnim = ag;
            } else if (!this.glbAttackAnim && (n.includes('attack') || n.includes('hit') || n.includes('strike') || n.includes('swing') || n.includes('skill'))) {
                this.glbAttackAnim = ag;
            } else if (!this.glbIdleAnim && (n.includes('idle') || n === 'stand')) {
                this.glbIdleAnim = ag;
            }
        }
        if (!this.glbWalkAnim && inst.animationGroups.length > 0) this.glbWalkAnim = inst.animationGroups[0];
        if (!this.glbIdleAnim) this.glbIdleAnim = this.glbWalkAnim;
        if (!this.glbAttackAnim) this.glbAttackAnim = this.glbWalkAnim;
        if (this.glbWalkAnim) {
            this.glbWalkAnim.start(true);
            this.glbCurrentAnim = this.glbWalkAnim;
        }
    }

    private playGlbAnim(slot: AnimationGroup | null, loop: boolean): void {
        if (!slot) return;
        if (this.glbCurrentAnim === slot) return;
        if (this.glbCurrentAnim) this.glbCurrentAnim.stop();
        slot.start(loop);
        this.glbCurrentAnim = slot;
    }

    /** Only swing during the 'walking' phase — the special owns telegraph/dashing/pulling/recover. */
    protected canMeleeAttack(): boolean { return this.lungeState === 'walking'; }

    public update(deltaTime: number): boolean {
        if (!this.alive || !this.mesh) return false;

        // Spawn the twin exactly once (tier 3/4 origin only — never a clone, and
        // only once the hero target is wired). The clone is pushed into the enemy
        // list by EnemyManager's 'bossClone' listener.
        if (!this.isClone && !this.cloneSpawned && hasClone(this.waveTier) && this.seekTarget) {
            this.cloneSpawned = true;
            document.dispatchEvent(new CustomEvent('bossClone', {
                detail: { origin: this, tier: this.waveTier },
            }));
        }

        this.updateHeroVelocity(deltaTime);
        this.tickLungeStateMachine(deltaTime);

        let result: boolean;
        // While dashing, the boss travels in the locked direction (not toward the hero).
        // We zero out `speed` so the parent's seek branch doesn't add hero-ward motion,
        // then apply the dash velocity in advanceDash after the parent has run animation
        // and copied this.position into the mesh. (DON'T null seekTarget — that drops the
        // parent into its path-walker branch, which with an empty path returns true and
        // makes EnemyManager treat the boss as "reached goal" → 50 HP loss + boss removed.)
        if (this.lungeState === 'dashing') {
            const savedSpeed = this.speed;
            this.speed = 0;
            result = super.update(deltaTime);
            this.speed = savedSpeed;
            this.advanceDash(deltaTime);
        } else if (this.lungeState === 'telegraph' || this.lungeState === 'recover' || this.lungeState === 'pulling') {
            // Rooted: zero speed for this frame. Parent still ticks animation/status.
            const savedSpeed = this.speed;
            this.speed = 0;
            result = super.update(deltaTime);
            this.speed = savedSpeed;
        } else {
            result = super.update(deltaTime);
        }

        // When using a GLB model, undo BossEnemy.animateParts's mesh transforms (it
        // animates this.head/leftArm/etc. which are null for GLB — but it also adds
        // +1.2 to mesh.position.y and pitches/rolls the body, which floats and tilts
        // the GLB. Reset to keep the model upright and grounded.) Then drive the GLB
        // animation slot based on distance to the hero.
        if (this.usingGLB && this.mesh) {
            this.mesh.position.y = this.position.y;
            this.mesh.rotation.x = 0;
            this.mesh.rotation.z = 0;
            if (this.isFrozen || this.isStunned) {
                this.playGlbAnim(this.glbIdleAnim, true);
            } else if (this.seekTarget) {
                const heroPos = this.seekTarget.getPosition();
                const dx = heroPos.x - this.position.x;
                const dz = heroPos.z - this.position.z;
                const distSq = dx * dx + dz * dz;
                if (distSq <= MilestoneBoss.GLB_ATTACK_RANGE * MilestoneBoss.GLB_ATTACK_RANGE) {
                    this.playGlbAnim(this.glbAttackAnim, true);
                } else {
                    this.playGlbAnim(this.glbWalkAnim, true);
                }
            } else {
                this.playGlbAnim(this.glbWalkAnim, true);
            }
        }

        return result;
    }

    private updateHeroVelocity(deltaTime: number): void {
        if (!this.seekTarget || deltaTime <= 0) {
            this.heroVelX = 0;
            this.heroVelZ = 0;
            return;
        }
        const heroPos = this.seekTarget.getPosition();
        if (this.hasLastHeroPos) {
            this.heroVelX = (heroPos.x - this.lastHeroX) / deltaTime;
            this.heroVelZ = (heroPos.z - this.lastHeroZ) / deltaTime;
        }
        this.lastHeroX = heroPos.x;
        this.lastHeroZ = heroPos.z;
        this.hasLastHeroPos = true;
    }

    /** Pick the next special from this tier's rotation (tier 4 alternates dash/pull). */
    private nextAction(): SpecialAction {
        const actions = tierActions(this.waveTier);
        const action = actions[this.actionIndex % actions.length];
        this.actionIndex++;
        return action;
    }

    private tickLungeStateMachine(deltaTime: number): void {
        switch (this.lungeState) {
            case 'walking':
                // Pause the special timer while a melee swing is in progress so the
                // boss commits to one attack at a time (no swing-cancelled-by-special).
                if (this.isMeleeAttacking()) return;
                this.lungeTimer -= deltaTime;
                if (this.lungeTimer <= 0 && this.seekTarget) {
                    this.enterTelegraph(this.nextAction());
                }
                return;

            case 'telegraph':
                this.stateTimer -= deltaTime;
                if (this.stateTimer <= 0) {
                    if (this.pendingAction === 'pull') this.enterPull();
                    else this.enterDash();
                }
                return;

            case 'dashing':
                this.stateTimer -= deltaTime;
                if (this.stateTimer <= 0 || this.dashDistanceRemaining <= 0) {
                    this.enterRecover();
                }
                return;

            case 'pulling':
                this.stateTimer -= deltaTime;
                if (this.stateTimer <= 0) {
                    this.applyPullSlam();
                    this.enterRecover();
                }
                return;

            case 'recover':
                this.stateTimer -= deltaTime;
                if (this.stateTimer <= 0) {
                    this.enterWalking();
                }
                return;
        }
    }

    private enterTelegraph(action: SpecialAction): void {
        if (!this.seekTarget) return;
        const heroPos = this.seekTarget.getPosition();

        // Tier 2+ leads the hero by their current velocity over PREDICT_LEAD_TIME.
        let aimX = heroPos.x;
        let aimZ = heroPos.z;
        if (hasSidestepPredict(this.waveTier)) {
            aimX += this.heroVelX * PREDICT_LEAD_TIME;
            aimZ += this.heroVelZ * PREDICT_LEAD_TIME;
        }

        const dx = aimX - this.position.x;
        const dz = aimZ - this.position.z;
        const len = Math.hypot(dx, dz);
        if (len < 0.001) {
            this.enterWalking();
            return;
        }
        this.dashDirX = dx / len;
        this.dashDirZ = dz / len;
        this.dashDistanceRemaining = DASH_DISTANCE;
        this.pendingAction = action;
        this.lungeState = 'telegraph';
        this.stateTimer = TELEGRAPH_DURATION;

        if (action === 'pull') {
            this.spawnPullTelegraph();
            // Broadcast to guest: pull telegraph is a disc at boss origin (no direction).
            emitCoopFx('telegraph', this.position.x, this.position.z, this.position.x, this.position.z, 'pull');
        } else {
            this.spawnDashTelegraph();
            // Broadcast to guest: dash telegraph from boss origin to dash endpoint.
            const endX = this.position.x + this.dashDirX * DASH_DISTANCE;
            const endZ = this.position.z + this.dashDirZ * DASH_DISTANCE;
            emitCoopFx('telegraph', this.position.x, this.position.z, endX, endZ, 'dash');
        }
    }

    private enterDash(): void {
        this.disposeTelegraphRing();
        this.lungeState = 'dashing';
        this.stateTimer = DASH_DURATION;
        this.dashHasHit = false;
    }

    private enterPull(): void {
        this.disposeTelegraphRing();
        this.lungeState = 'pulling';
        this.stateTimer = PULL_DURATION;
        // Yank the hero toward the (now rooted) boss for the pull duration.
        this.seekTarget?.applyPull?.(this.position.x, this.position.z, PULL_SPEED, PULL_DURATION);
    }

    private enterRecover(): void {
        this.disposeTelegraphRing();
        this.lungeState = 'recover';
        this.stateTimer = RECOVER_DURATION;
    }

    private enterWalking(): void {
        this.disposeTelegraphRing();
        this.lungeState = 'walking';
        const baseCd = lungeCooldown(this.waveTier);
        this.lungeTimer = this.enraged ? baseCd * ENRAGE_LUNGE_FACTOR : baseCd;
    }

    private advanceDash(deltaTime: number): void {
        const step = Math.min(this.dashDistanceRemaining, DASH_SPEED * deltaTime);
        this.position.x += this.dashDirX * step;
        this.position.z += this.dashDirZ * step;
        this.dashDistanceRemaining -= step;

        // Slash AoE: the dash deals damage to the hero it passes through (once per
        // dash). The slash carries knockback via the source position.
        if (!this.dashHasHit && this.seekTarget) {
            const heroPos = this.seekTarget.getPosition();
            const dx = heroPos.x - this.position.x;
            const dz = heroPos.z - this.position.z;
            if (dx * dx + dz * dz <= DASH_SLASH_RADIUS * DASH_SLASH_RADIUS) {
                this.seekTarget.takeDamage?.(this.dashSlashDamage, this.position);
                this.dashHasHit = true;
            }
        }

        if (this.mesh && !this.mesh.isDisposed()) {
            this.mesh.position.copyFrom(this.position);
            this.mesh.position.y = this.position.y + 1.2;
            this.mesh.rotation.y = -Math.atan2(this.dashDirZ, this.dashDirX) + Math.PI / 2;
        }
    }

    /** Resolve the grab: if the hero is within slam range when the pull ends, hit
     *  them and slow them. A clean dodge (dashing out of range) avoids both. */
    private applyPullSlam(): void {
        if (!this.seekTarget) return;
        const heroPos = this.seekTarget.getPosition();
        const dx = heroPos.x - this.position.x;
        const dz = heroPos.z - this.position.z;
        if (dx * dx + dz * dz <= PULL_SLAM_RADIUS * PULL_SLAM_RADIUS) {
            this.seekTarget.takeDamage?.(this.pullSlamDamage, this.position);
            this.seekTarget.applySlow?.(PULL_SLOW_MULT, PULL_SLOW_DURATION);
        }
    }

    /**
     * Enrage triggered when this boss's twin dies (tier 3/4). Doubles health,
     * movement speed, and attack speed (faster swings + faster specials). One-shot.
     */
    public enrageFromCloneDeath(): void {
        if (this.enraged || !this.alive) return;
        this.enraged = true;

        this.maxHealth *= 2;
        this.health = Math.min(this.maxHealth, this.health * 2);

        this.speed *= 2;
        this.originalSpeed *= 2;

        // Attack speed: faster melee swings + faster special cadence.
        this.meleeWindupDuration *= 0.5;
        this.meleeCooldownDuration *= 0.5;
        if (this.lungeState === 'walking') {
            this.lungeTimer = Math.min(this.lungeTimer, lungeCooldown(this.waveTier) * ENRAGE_LUNGE_FACTOR);
        }

        // Visual tell: the boss visibly swells.
        if (this.mesh && !this.mesh.isDisposed()) {
            this.mesh.scaling.scaleInPlace(1.2);
        }
        this.updateHealthBar();
    }

    /** EnemyManager links a freshly-spawned twin back to its origin boss so the
     *  origin can be enraged when the twin dies. */
    public setEnrageOrigin(origin: MilestoneBoss): void { this.enrageOrigin = origin; }
    public getEnrageOrigin(): MilestoneBoss | null { return this.enrageOrigin; }

    /** Red ground rectangle pointing in the locked dash direction (slash telegraph). */
    private spawnDashTelegraph(): void {
        this.disposeTelegraphRing();

        const length = DASH_DISTANCE;
        const ring = MeshBuilder.CreatePlane('mbossTelegraph', { width: 1.4, height: length }, this.scene);
        ring.rotation.x = Math.PI / 2;
        ring.rotation.y = -Math.atan2(this.dashDirZ, this.dashDirX) + Math.PI / 2;
        ring.position.x = this.position.x + this.dashDirX * (length / 2);
        ring.position.z = this.position.z + this.dashDirZ * (length / 2);
        ring.position.y = 0.05;

        const mat = new StandardMaterial('mbossTelegraphMat', this.scene);
        mat.emissiveColor = new Color3(1, 0.1, 0.1);
        mat.diffuseColor  = new Color3(0, 0, 0);
        mat.specularColor = Color3.Black();
        mat.alpha = 0.55;
        ring.material = mat;

        this.telegraphRing = ring;
    }

    /** Purple grab-zone disc centered on the boss (pull telegraph). */
    private spawnPullTelegraph(): void {
        this.disposeTelegraphRing();

        const ring = MeshBuilder.CreateDisc('mbossPullTele', { radius: PULL_TELEGRAPH_RADIUS, tessellation: 24 }, this.scene);
        ring.rotation.x = Math.PI / 2;
        ring.position.set(this.position.x, 0.05, this.position.z);

        const mat = new StandardMaterial('mbossPullTeleMat', this.scene);
        mat.emissiveColor = new Color3(0.55, 0.1, 0.9);
        mat.diffuseColor  = new Color3(0, 0, 0);
        mat.specularColor = Color3.Black();
        mat.alpha = 0.45;
        ring.material = mat;

        this.telegraphRing = ring;
    }

    private disposeTelegraphRing(): void {
        if (this.telegraphRing && !this.telegraphRing.isDisposed()) {
            // Pass disposeMaterialAndTextures=true so the per-special StandardMaterial doesn't leak.
            this.telegraphRing.dispose(false, true);
        }
        this.telegraphRing = null;
    }

    /** Override to keep the 30% knockback reduction from BossEnemy (same behavior). */
    public applyKnockback(dirX: number, dirZ: number, magnitude: number): void {
        super.applyKnockback(dirX, dirZ, magnitude);
    }

    /** Free the telegraph ring — NOT parented to this.mesh, so the base mesh-tree
     *  release never reaches it. Runs on every disposal path (die/disposeCorpse/
     *  dispose — the corpse path is the ONLY one guest enemies take). Idempotent
     *  (disposeTelegraphRing nulls the ref); BossEnemy's override frees the wisps. */
    protected disposeAuxVisuals(): void {
        super.disposeAuxVisuals();
        this.disposeTelegraphRing();
    }
}
