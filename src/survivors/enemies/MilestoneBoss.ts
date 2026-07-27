import { Color, Mesh, MeshPhongMaterial, Vector3 } from 'three';
import { Game } from '../../engine/Game';
import { BossEnemy } from './BossEnemy';
import { DifficultyTuning } from '../DifficultyTuning';
import { bossDifficultyAt } from '../DifficultyCurve';
import { emitCoopFx, isCoopFxActive, spawnCosmeticSlashWave } from '../coop/CoopFx';
import { AnimGroup } from '../../engine/three/AnimGroup';
import type { GlbContainer } from '../../engine/three/assets';
import { headingToYaw } from '../../engine/three/math';
import { createDisc, createPlane, createTransformHost, disposeMesh, isMeshDisposed } from '../../engine/three/primitives';
import { StatusEffect } from '../GameTypes';
import {
    hasClone, hasSidestepPredict, hasLeapDash, hasRunningPull, hasFrenziedEnrage,
    FRENZY_SPEED_FACTOR,
} from './bossTiers';
import { emitGroundFx, spawnGroundShockwave } from './EnemyGroundFx';
import { applyBodyCoil, easeInCoil, leapHeightAt, resolveLeapFlight, type LeapSpec } from './leapMotion';
import {
    ENRAGE_HEALTH_FRACTION, ENRAGE_TANK_FACTOR, ENRAGE_SPEED_FACTOR, ENRAGE_DAMAGE_FACTOR,
    ENRAGE_COOLDOWN_FACTOR, isMovementImpairing, specialCooldownScale,
} from './enrageProfile';

// Re-exported so the HUD/gameplay-state import site and the tuning stay one name.
export { ENRAGE_HEALTH_FRACTION };

/**
 * Special-move state machine. The boss alternates between free movement
 * ('walking') and a telegraphed special: a slashing dash or a grab-and-pull.
 * Which special fires is chosen from the per-tier action rotation.
 */
type LungeState = 'walking' | 'telegraph' | 'leaping' | 'dashing' | 'pulling' | 'recover';
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
    5: ['dash', 'pull'], // Elemental Lord — plus a periodic elemental nova (see tickElementalNova)
};
function tierActions(tier: number): SpecialAction[] { return TIER_ACTIONS[tier] ?? ['dash', 'pull']; }

/** Boss name label per tier (shown above the boss HP bar). */
const TIER_LABEL: Record<number, string> = {
    1: 'Ravager',
    2: 'Warden',
    3: 'Gemini',
    4: 'Apex Tyrant',
    5: 'Elemental Lord',
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
// ── Leap dash (tier 1 / 4) ──────────────────────────────────────────────────
/** Furthest the opening leap carries. The dash then continues from where it
 *  lands, so the pair closes up to LEAP_DISTANCE + DASH_DISTANCE. */
const LEAP_DISTANCE = 14.0;
/** Lands this far short of the committed point so the boss arrives in front of
 *  the hero and slashes through, rather than landing on top of them. */
const LEAP_STOP_SHORT = 1.4;
/** The boss's leap, resolved per jump by `resolveLeapFlight`. */
const BOSS_LEAP: LeapSpec = {
    maxDistance: LEAP_DISTANCE,
    topSpeed: 24.0,
    minAirTime: 0.30,
    stopShort: LEAP_STOP_SHORT,
    arcHeight: 4.0,
    arcMinFraction: 0.55,
};
/** The gather before the jump. Rooted, and the body visibly coils — this is the
 *  anticipation that makes the launch read as a launch rather than as the boss
 *  suddenly sliding. Replaces the flat rooted pause the painted lane used to
 *  fill. */
const LEAP_CHARGE_S = 0.38;
/** How hard the body coils on the charge and stretches out of the launch. */
const LEAP_COIL = 0.26;
/** Radius of the ring thrown out where the boss lands. */
const LEAP_SLAM_RADIUS = 4.5;

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

// Elemental nova (tier 5 only): a periodic telegraphed AOE pulse around the boss,
// independent of the dash/pull state machine. Reuses TELEGRAPH_DURATION for the wind-up.
const NOVA_INTERVAL = 7.0;   // seconds between novas
const NOVA_RADIUS   = 7.0;   // AOE radius (hero must be inside on detonation)
const NOVA_DAMAGE_FACTOR = 1.3; // × the boss's melee hit damage

export class MilestoneBoss extends BossEnemy {
    /** Static slot used by EnemyManager.spawnSurvivorsEnemy to stage a preloaded GLB
     *  asset (per-tier boss model) before constructing. createMesh consumes + clears. */
    public static pendingAsset: GlbContainer | null = null;

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
    /** Distance left in the opening leap (tier 1/4). 0 = not leaping. */
    private leapRemaining: number = 0;
    /** This leap's flight, resolved at launch by resolveLeapFlight — the speed is
     *  at most BOSS_LEAP.topSpeed and the arc scales with the ground covered. */
    private leapSpeed: number = BOSS_LEAP.topSpeed;
    private leapAirTime: number = BOSS_LEAP.minAirTime;
    private leapArcHeight: number = BOSS_LEAP.arcHeight;
    /** Height above the ground plane this frame; added to the mesh at the end of
     *  update(), after the GLB block has reset it to the ground. */
    private leapHeight: number = 0;
    /** True while the charge is coiling for a leap (as opposed to a plain
     *  rooted telegraph, which the non-leap tiers still use). */
    private leapPending: boolean = false;
    /** GLB root scale + ground offset as built, so the coil can be applied as a
     *  multiplier and released back to exactly these. */
    private glbBaseScale: number = 1;
    private glbBaseRootY: number = 0;
    private enraged: boolean = false;
    /** Last-stand enrage — a SEPARATE one-shot from the twin-death `enraged`
     *  above, so a tier-3/4 boss that already enraged from losing its twin can
     *  still enrage again on dropping below the HP threshold. */
    private lowHealthEnraged: boolean = false;

    /** Damage dealt by a dash slash / pull slam / elemental nova — derived from
     *  melee hit damage. Mutable: the last-stand enrage scales them alongside the
     *  melee hit they were derived from. */
    private dashSlashDamage: number;
    private pullSlamDamage: number;
    private novaDamage: number;

    // Elemental nova (tier 5): own timer/telegraph, independent of the lunge machine.
    private novaCooldown: number = NOVA_INTERVAL;
    private novaTelegraphTimer: number = 0;
    private novaRing: Mesh | null = null;

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
    private glbWalkAnim: AnimGroup | null = null;
    private glbAttackAnim: AnimGroup | null = null;
    private glbIdleAnim: AnimGroup | null = null;
    private glbCurrentAnim: AnimGroup | null = null;
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
        // Milestone bosses only appear on 5th waves, so the tier IS the wave/5.
        const curve     = bossDifficultyAt(waveTier * 5);
        const hpMult    = tierHpMult(waveTier) * strengthMultiplier * DifficultyTuning.bossHpMult * curve.hp;
        const dpsMult   = tierDpsMult(waveTier) * strengthMultiplier * DifficultyTuning.bossDamageMult * curve.damage;
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
        this.novaDamage      = Math.round(this.meleeHitDamage * NOVA_DAMAGE_FACTOR);

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

    private createMeshFromGLB(asset: GlbContainer): void {
        this.usingGLB = true;
        this.mesh = createTransformHost('milestoneBossGlbRoot', this.scene);
        this.mesh.position.copy(this.position);

        const inst = asset.instantiate(this.scene, 'boss_');
        this.glbInstance = inst; // base field - dispose() frees cloned materials + skeletons + mixer hook
        const root = inst.root;
        this.mesh.add(root);
        // Tier 5 (Elemental Lord) dwarfs every other boss.
        const BOSS_SCALE = 2.2 * (this.waveTier >= 5 ? 1.4 : 1);
        root.scale.multiplyScalar(BOSS_SCALE);
        // Keep the Babylon-era 180-degree Y pre-rotation so facing math stays aligned
        // (Phase D handedness audit may remove it):
        root.rotation.y += Math.PI;

        // Feet on the ground. Measured once per container from a posed clip,
        // not per spawn from the rest transform - see ContainerInstance.groundToFeet.
        inst.groundToFeet();
        // Captured AFTER groundToFeet so the leap coil has the real resting pose
        // to scale from and return to.
        this.glbBaseScale = BOSS_SCALE;
        this.glbBaseRootY = root.position.y;

        // Register groups for base-class dispose cleanup (prevents animatable leak).
        this.glbAnimationGroups = inst.animationGroups;

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

    private playGlbAnim(slot: AnimGroup | null, loop: boolean): void {
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

        this.maybeEnterLastStand();
        this.updateHeroVelocity(deltaTime);
        this.tickLungeStateMachine(deltaTime);
        if (this.waveTier >= 5) this.tickElementalNova(deltaTime);

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
        } else if (this.lungeState === 'leaping') {
            // Airborne: the boss owns its own motion for the arc, same as a dash.
            const savedSpeed = this.speed;
            this.speed = 0;
            result = super.update(deltaTime);
            this.speed = savedSpeed;
            this.advanceLeap(deltaTime);
        } else if (this.lungeState === 'pulling' && hasRunningPull(this.waveTier)) {
            // Reeling the hero in WHILE closing. The parent's seek branch supplies
            // the movement unchanged — the pull is what has to track the boss, so
            // tickLungeStateMachine re-issues it at the new position each frame.
            result = super.update(deltaTime);
        } else if (this.lungeState === 'telegraph' || this.lungeState === 'recover'
            || this.lungeState === 'pulling') {
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
            const animTarget = this.resolveSeekTarget();
            if (this.isFrozen || this.isStunned) {
                this.playGlbAnim(this.glbIdleAnim, true);
            } else if (animTarget) {
                const heroPos = animTarget.getPosition();
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

        // Airborne height goes on LAST. Both the parent's seek branch and the GLB
        // block above rewrite mesh.y from the ground-plane position every frame,
        // so anywhere earlier this would simply be overwritten.
        if (this.leapHeight > 0 && this.mesh && !isMeshDisposed(this.mesh)) {
            this.mesh.position.y = this.position.y + this.leapHeight;
        }

        return result;
    }

    private updateHeroVelocity(deltaTime: number): void {
        const target = this.resolveSeekTarget();
        if (!target || deltaTime <= 0) {
            this.heroVelX = 0;
            this.heroVelZ = 0;
            return;
        }
        const heroPos = target.getPosition();
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
                if (this.lungeTimer <= 0 && this.resolveSeekTarget()) {
                    this.enterTelegraph(this.nextAction());
                }
                return;

            case 'telegraph':
                this.stateTimer -= deltaTime;
                // The coil deepens across the charge, so the wind-up is readable
                // as "about to launch" rather than as a pause.
                if (this.leapPending) {
                    this.poseLeapBody(-easeInCoil(1 - Math.max(0, this.stateTimer) / LEAP_CHARGE_S));
                }
                if (this.stateTimer <= 0) {
                    if (this.pendingAction === 'pull') this.enterPull();
                    else if (this.leapPending) this.enterLeap();
                    else this.enterDash();
                }
                return;

            case 'leaping':
                this.stateTimer -= deltaTime;
                // The dash may not begin while the boss is still in the air. Air
                // time is sized to the leap so the two normally end together, but
                // frame quantisation can leave a sliver of travel when the timer
                // expires — dashing then would start the slash mid-flight.
                if (this.leapRemaining > 0) return;
                if (this.stateTimer <= 0) this.enterDash();
                return;

            case 'dashing':
                this.stateTimer -= deltaTime;
                if (this.stateTimer <= 0 || this.dashDistanceRemaining <= 0) {
                    this.enterRecover();
                }
                return;

            case 'pulling':
                this.stateTimer -= deltaTime;
                // A running pull has to be re-issued at the boss's CURRENT position
                // or the hero keeps being dragged toward the spot it grabbed from.
                // The remaining duration is passed so re-issuing never extends it
                // (HeroController.applyPull keeps the longer of the two).
                if (this.stateTimer > 0 && hasRunningPull(this.waveTier)) {
                    this.resolveSeekTarget()?.applyPull?.(
                        this.position.x, this.position.z, PULL_SPEED, this.stateTimer,
                    );
                }
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
        // Aim at the nearest LIVE hero, not the raw seekTarget (always provider[0] —
        // a dead co-op host). resolveSeekTarget returns null when no hero is alive.
        const target = this.resolveSeekTarget();
        if (!target) { this.enterWalking(); return; }
        const heroPos = target.getPosition();

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
        // Cleared up front: a leap-capable boss alternating dash/pull (Apex) must
        // not carry a pending coil into its grab.
        this.leapRemaining = 0;
        this.leapPending = false;

        if (action === 'pull') {
            this.spawnPullTelegraph();
            // Broadcast to guest: pull telegraph is a disc at boss origin (no direction).
            emitCoopFx('telegraph', this.position.x, this.position.z, this.position.x, this.position.z, 'pull');
        } else if (hasLeapDash(this.waveTier)) {
            // The LEAP is the telegraph. A boss that jumps at you reads its own
            // intent — where it is going is where it is already flying — so the
            // painted lane is not just redundant, it flattens the move into
            // "stand still, then move". Nothing is drawn and nothing is
            // broadcast; the guest sees the jump itself in the position stream.
            // Charge first; enterLeap commits the distance when it actually
            // launches, so a hero who closes during the coil is not leapt over.
            this.leapPending = true;
            this.stateTimer = LEAP_CHARGE_S;
        } else {
            this.spawnDashTelegraph();
            // Broadcast to guest: dash telegraph from boss origin to dash endpoint.
            const endX = this.position.x + this.dashDirX * DASH_DISTANCE;
            const endZ = this.position.z + this.dashDirZ * DASH_DISTANCE;
            emitCoopFx('telegraph', this.position.x, this.position.z, endX, endZ, 'dash');
        }
    }

    /**
     * Launch. The direction was locked when the charge began but the DISTANCE is
     * committed here, at the end of the coil — a hero who ran in during the
     * wind-up is landed on rather than sailed over.
     *
     * From this instant the leap is fixed: a hero who moves now is leapt PAST
     * rather than tracked. The arc replaces the painted lane as the read.
     */
    private enterLeap(): void {
        this.leapPending = false;
        this.lungeState = 'leaping';

        const target = this.resolveSeekTarget();
        const heroPos = target?.getPosition();
        const gap = heroPos
            ? Math.hypot(heroPos.x - this.position.x, heroPos.z - this.position.z)
            : LEAP_DISTANCE;
        if (heroPos && gap > 0.001) {
            // Re-aim at the launch instant. Only the direction — the distance is
            // fixed below — so this sharpens the jump without making it homing.
            this.dashDirX = (heroPos.x - this.position.x) / gap;
            this.dashDirZ = (heroPos.z - this.position.z) / gap;
        }

        const flight = resolveLeapFlight(gap, BOSS_LEAP);
        this.leapRemaining = flight.distance;
        this.leapAirTime = flight.airTime;
        this.leapSpeed = flight.speed;
        this.leapArcHeight = flight.arcHeight;
        this.stateTimer = flight.airTime;
        this.faceHeading(this.dashDirX, this.dashDirZ);
    }

    /**
     * Fly the committed leap: forward along the locked heading, and UP through a
     * parabola. The height is what makes it a leap rather than a slide, so it is
     * applied to the mesh at the end of update() — after the GLB block, which
     * resets mesh.y to the ground plane every frame.
     */
    private advanceLeap(deltaTime: number): void {
        if (this.leapRemaining <= 0) { this.leapHeight = 0; return; }
        const step = Math.min(this.leapRemaining, this.leapSpeed * deltaTime);
        this.leapRemaining -= step;
        this.position.x += this.dashDirX * step;
        this.position.z += this.dashDirZ * step;

        // Progress comes from the TIMER, not from distance, so a near-zero
        // distance leap still arcs.
        const t = this.leapAirTime > 0
            ? 1 - Math.max(0, this.stateTimer) / this.leapAirTime
            : 1;
        this.leapHeight = leapHeightAt(t, this.leapArcHeight);
        // Stretch out of the launch, easing back to neutral by the apex.
        this.poseLeapBody(Math.max(0, 1 - t * 2));

        if (this.mesh && !isMeshDisposed(this.mesh)) this.mesh.position.copy(this.position);
    }

    /**
     * Coil (negative) / stretch (positive) the body, 0 = neutral.
     *
     * Poses the GLB ROOT, not `this.mesh` — the mesh is what both enrages scale,
     * and writing to it here would either be clobbered by them or permanently
     * bake this pose into their multiplier. The root's ground offset scales with
     * its height, so it is re-derived too or the model sinks when squashed.
     */
    private poseLeapBody(amount: number): void {
        const root = this.glbInstance?.root;
        if (!root) return;
        applyBodyCoil(root, this.glbBaseScale, this.glbBaseRootY, amount, LEAP_COIL);
    }

    /** Land: put the body back to neutral and throw a ring out from the impact.
     *  Visual only — the payoff is the dash's slash, which starts this same frame,
     *  so damaging the landing too would hit once for one committed move. */
    private landLeap(): void {
        this.leapRemaining = 0;
        this.leapHeight = 0;
        this.poseLeapBody(0);
        spawnGroundShockwave(this.scene, this.position.x, this.position.z, LEAP_SLAM_RADIUS, 'slam');
        emitGroundFx('enemyImpact', this.position.x, this.position.z, LEAP_SLAM_RADIUS, 0, 'slam');
    }

    private enterDash(): void {
        this.disposeTelegraphRing();
        if (hasLeapDash(this.waveTier)) this.landLeap();
        this.lungeState = 'dashing';
        this.stateTimer = DASH_DURATION;
        this.dashHasHit = false;

        // A leap-dash lands with a slash: the same travelling crescent the
        // barbarian's own wave draws, so the boss's signature move reads as an
        // attack rather than as the boss walking through you. The visual is
        // damage-free by construction — advanceDash owns the hit — and it goes
        // out on the cosmetic channel so the guest sees it too.
        if (hasLeapDash(this.waveTier)) {
            const angle = Math.atan2(this.dashDirZ, this.dashDirX);
            spawnCosmeticSlashWave(this.scene, this.position.x, this.position.z, DASH_DISTANCE, angle);
            // Reuses the barbarian's existing 'slash' channel and its
            // "range:facingAngle" hint — the crescent is the same primitive, so it
            // needs no second wire kind. Gated so single-player never builds the string.
            if (isCoopFxActive()) {
                emitCoopFx('slash', this.position.x, this.position.z,
                    undefined, undefined, `${DASH_DISTANCE}:${angle}`);
            }
        }
    }

    private enterPull(): void {
        this.disposeTelegraphRing();
        this.lungeState = 'pulling';
        this.stateTimer = PULL_DURATION;
        // Yank the nearest LIVE hero toward the (now rooted) boss for the pull duration.
        this.resolveSeekTarget()?.applyPull?.(this.position.x, this.position.z, PULL_SPEED, PULL_DURATION);
    }

    private enterRecover(): void {
        this.disposeTelegraphRing();
        this.lungeState = 'recover';
        this.stateTimer = RECOVER_DURATION;
    }

    private enterWalking(): void {
        this.disposeTelegraphRing();
        // Everything returns here, so it is the one place guaranteed to undo a
        // leap that was abandoned rather than landed (no live target at commit,
        // a hero who died mid-charge). Without it the boss walks on coiled.
        this.leapPending = false;
        this.leapRemaining = 0;
        this.leapHeight = 0;
        this.poseLeapBody(0);
        this.lungeState = 'walking';
        // The two enrages COMPOSE — a tier-4 boss that lost its twin and then
        // dropped below the health threshold cycles specials at both discounts.
        this.lungeTimer = lungeCooldown(this.waveTier)
            * specialCooldownScale(this.enraged, this.lowHealthEnraged);
    }

    private advanceDash(deltaTime: number): void {
        const step = Math.min(this.dashDistanceRemaining, DASH_SPEED * deltaTime);
        this.position.x += this.dashDirX * step;
        this.position.z += this.dashDirZ * step;
        this.dashDistanceRemaining -= step;

        // Slash AoE: the dash deals damage to the hero it passes through (once per
        // dash). The slash carries knockback via the source position. Nearest-live hero
        // only — a dead co-op host (raw seekTarget) must not soak the slash.
        const dashTarget = this.resolveSeekTarget();
        if (!this.dashHasHit && dashTarget) {
            const heroPos = dashTarget.getPosition();
            const dx = heroPos.x - this.position.x;
            const dz = heroPos.z - this.position.z;
            if (dx * dx + dz * dz <= DASH_SLASH_RADIUS * DASH_SLASH_RADIUS) {
                dashTarget.takeDamage?.(this.dashSlashDamage, this.position);
                this.dashHasHit = true;
            }
        }

        if (this.mesh && !isMeshDisposed(this.mesh)) {
            this.mesh.position.copy(this.position);
            this.mesh.position.y = this.position.y + 1.2;
            // Through the same helper the walk cycle uses — a raw headingToYaw here
            // skipped the models' 180-degree root pre-rotation, so the boss spun
            // about-face the instant the dash began and lunged backwards.
            this.faceHeading(this.dashDirX, this.dashDirZ);
        }
    }

    /** Resolve the grab: if the hero is within slam range when the pull ends, hit
     *  them and slow them. A clean dodge (dashing out of range) avoids both. */
    private applyPullSlam(): void {
        const target = this.resolveSeekTarget();
        if (!target) return;
        const heroPos = target.getPosition();
        const dx = heroPos.x - this.position.x;
        const dz = heroPos.z - this.position.z;
        if (dx * dx + dz * dz <= PULL_SLAM_RADIUS * PULL_SLAM_RADIUS) {
            target.takeDamage?.(this.pullSlamDamage, this.position);
            target.applySlow?.(PULL_SLOW_MULT, PULL_SLOW_DURATION);
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

        // Tier 3 (Gemini) and Apex go into a frenzy rather than merely speeding
        // up: half again on top of the doubling every twin-death enrage grants.
        const speedUp = 2 * (hasFrenziedEnrage(this.waveTier) ? FRENZY_SPEED_FACTOR : 1);
        this.speed *= speedUp;
        this.originalSpeed *= speedUp;

        // Attack speed: faster melee swings + faster special cadence.
        this.meleeWindupDuration *= 0.5;
        this.meleeCooldownDuration *= 0.5;
        if (this.lungeState === 'walking') {
            this.lungeTimer = Math.min(
                this.lungeTimer,
                lungeCooldown(this.waveTier) * specialCooldownScale(true, this.lowHealthEnraged),
            );
        }

        // Visual tell: the boss visibly swells.
        if (this.mesh && !isMeshDisposed(this.mesh)) {
            this.mesh.scale.multiplyScalar(1.2);
        }
        this.updateHealthBar();
    }

    /**
     * Last-stand enrage: below ENRAGE_HEALTH_FRACTION the boss sheds every
     * movement-impairing effect and becomes tankier, much faster, quicker off
     * cooldown and harder-hitting. One-shot and idempotent — checked once per
     * frame from update().
     *
     * NOT called on the co-op guest, whose bosses never tick AI. That is fine:
     * every mutation here is host-authoritative (the guest routes damage to the
     * host and interpolates position from snapshots), and `isEnraged()` derives
     * the HUD's enraged state from the health fraction so the bar still flips on
     * both peers at the same threshold.
     */
    private maybeEnterLastStand(): void {
        if (this.lowHealthEnraged || !this.alive) return;
        if (this.health > this.maxHealth * ENRAGE_HEALTH_FRACTION) return;
        this.lowHealthEnraged = true;

        // Tankier — composed with any existing resistance so this is always
        // exactly "takes 1/1.5 of the damage it would otherwise have taken".
        this.damageResistance = 1 - (1 - this.damageResistance) / ENRAGE_TANK_FACTOR;

        // Unstoppable. Breaking free is part of the transition, not just an
        // immunity going forward — a boss already frozen when it crosses the
        // threshold would otherwise stand there through its own enrage.
        this.shedMovementImpairment();

        // Faster: on its feet and between melee swings.
        this.speed *= ENRAGE_SPEED_FACTOR;
        this.originalSpeed *= ENRAGE_SPEED_FACTOR;
        this.meleeWindupDuration /= ENRAGE_SPEED_FACTOR;
        this.meleeCooldownDuration /= ENRAGE_SPEED_FACTOR;
        // Specials come off cooldown faster too. Scale the pending timer by the
        // same factor enterWalking() will now use, so the first enraged special
        // does not wait out a cooldown that was set at the old cadence.
        this.lungeTimer *= specialCooldownScale(this.enraged, true)
            / specialCooldownScale(this.enraged, false);
        this.novaCooldown *= ENRAGE_COOLDOWN_FACTOR;

        // Stronger: contact + melee via the shared helper, then the specials that
        // were derived from melee damage at construction.
        this.applyDamageMultiplier(ENRAGE_DAMAGE_FACTOR);
        this.dashSlashDamage = Math.round(this.dashSlashDamage * ENRAGE_DAMAGE_FACTOR);
        this.pullSlamDamage  = Math.round(this.pullSlamDamage * ENRAGE_DAMAGE_FACTOR);
        this.novaDamage      = Math.round(this.novaDamage * ENRAGE_DAMAGE_FACTOR);

        // Visual tell, paired with the HUD bar going enraged. The callout itself
        // is raised by SurvivorsGameplayState off `isEnraged()` — no event
        // plumbing, and it fires on the co-op guest too (which never ticks here).
        if (this.mesh && !isMeshDisposed(this.mesh)) {
            this.mesh.scale.multiplyScalar(1.12);
        }
    }

    /** Clear every movement-impairing effect currently on the boss, including the
     *  stacking chill in the rich-status model (which would otherwise keep
     *  ticking its slow and eventually convert into a freeze). */
    private shedMovementImpairment(): void {
        for (const effect of [...this.activeStatusEffects.keys()]) {
            if (isMovementImpairing(effect)) this.removeStatusEffect(effect);
        }
        this.statuses.clear('chill');
        this.speed = this.originalSpeed;
    }

    /**
     * An enraged boss is immune to movement impairment. Damage-over-time and the
     * damage amplifiers still land — the last stand is a race the player has to
     * win on DPS, not an invulnerability phase.
     *
     * Gated on the host-only `lowHealthEnraged` flag rather than `isEnraged()`:
     * on the co-op guest the base implementation redirects the effect to the host
     * for authoritative handling, and dropping it here would silently swallow it.
     */
    public override applyStatusEffect(effect: StatusEffect, duration: number, strength: number): void {
        if (this.lowHealthEnraged && isMovementImpairing(effect)) return;
        super.applyStatusEffect(effect, duration, strength);
    }

    /** Knockback is movement impairment by another name — an enraged boss does
     *  not get shoved off its charge. (BossEnemy already damps it to 0.3×.) */
    public override applyKnockback(dirX: number, dirZ: number, magnitude: number): void {
        if (this.lowHealthEnraged) return;
        super.applyKnockback(dirX, dirZ, magnitude);
    }

    /** True once the boss is in its final phase. On the co-op guest the flag is
     *  never set (no AI tick), so fall back to the health fraction — both peers
     *  then agree on the threshold without replicating a bit over the wire. */
    public override isEnraged(): boolean {
        return this.lowHealthEnraged
            || (this.alive && this.maxHealth > 0
                && this.health <= this.maxHealth * ENRAGE_HEALTH_FRACTION);
    }

    /** EnemyManager links a freshly-spawned twin back to its origin boss so the
     *  origin can be enraged when the twin dies. */
    public setEnrageOrigin(origin: MilestoneBoss): void { this.enrageOrigin = origin; }
    public getEnrageOrigin(): MilestoneBoss | null { return this.enrageOrigin; }

    /** Red ground rectangle pointing in the locked dash direction (slash telegraph). */
    private spawnDashTelegraph(): void {
        this.disposeTelegraphRing();

        const length = DASH_DISTANCE;
        const ring = createPlane('mbossTelegraph', { width: 1.4, height: length }, this.scene);
        // Babylon laid the plane flat with rotation.x = +PI/2 under its default YXZ
        // rotation order; Three planes face +Z, so -PI/2 faces up. Keep YXZ order so
        // the yaw still applies in the ground plane like Babylon.
        ring.rotation.order = 'YXZ';
        ring.rotation.x = -Math.PI / 2;
        ring.rotation.y = headingToYaw(this.dashDirX, this.dashDirZ);
        ring.position.x = this.position.x + this.dashDirX * (length / 2);
        ring.position.z = this.position.z + this.dashDirZ * (length / 2);
        ring.position.y = 0.05;

        const mat = new MeshPhongMaterial();
        mat.name = 'mbossTelegraphMat';
        mat.emissive = new Color(1, 0.1, 0.1);
        mat.color    = new Color(0, 0, 0);
        mat.specular = new Color(0, 0, 0);
        mat.opacity = 0.55;
        mat.transparent = true;
        ring.material = mat;
        ring.userData.ownedMaterial = true;

        this.telegraphRing = ring;
    }

    /** Purple grab-zone disc centered on the boss (pull telegraph). */
    private spawnPullTelegraph(): void {
        this.disposeTelegraphRing();

        const ring = createDisc('mbossPullTele', { radius: PULL_TELEGRAPH_RADIUS, tessellation: 24 }, this.scene);
        // Three discs face +Z, so -PI/2 (not Babylon's +PI/2) lays it flat facing up.
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(this.position.x, 0.05, this.position.z);

        const mat = new MeshPhongMaterial();
        mat.name = 'mbossPullTeleMat';
        mat.emissive = new Color(0.55, 0.1, 0.9);
        mat.color    = new Color(0, 0, 0);
        mat.specular = new Color(0, 0, 0);
        mat.opacity = 0.45;
        mat.transparent = true;
        ring.material = mat;
        ring.userData.ownedMaterial = true;

        this.telegraphRing = ring;
    }

    private disposeTelegraphRing(): void {
        if (this.telegraphRing && !isMeshDisposed(this.telegraphRing)) {
            // Pass materials: true so the per-special material doesn't leak.
            disposeMesh(this.telegraphRing, { materials: true });
        }
        this.telegraphRing = null;
    }

    /**
     * Elemental nova (tier 5): a periodic telegraphed AOE pulse. Runs alongside the
     * lunge machine but only CHARGES while walking (so its wind-up never overlaps a
     * dash/pull telegraph). Frozen/stunned pauses it. Detonates after TELEGRAPH_DURATION.
     */
    private tickElementalNova(deltaTime: number): void {
        if (this.isFrozen || this.isStunned) return;
        if (this.novaTelegraphTimer > 0) {
            this.novaTelegraphTimer -= deltaTime;
            if (this.novaTelegraphTimer <= 0) this.detonateNova();
            return;
        }
        if (this.lungeState !== 'walking') return;
        this.novaCooldown -= deltaTime;
        if (this.novaCooldown <= 0) this.beginNova();
    }

    private beginNova(): void {
        this.novaTelegraphTimer = TELEGRAPH_DURATION;
        this.spawnNovaTelegraph();
        // Broadcast a disc telegraph at the boss origin (reuses the 'pull' fx kind).
        emitCoopFx('telegraph', this.position.x, this.position.z, this.position.x, this.position.z, 'pull');
    }

    private detonateNova(): void {
        this.disposeNovaRing();
        this.novaCooldown = NOVA_INTERVAL;
        // AOE: damage every live hero within NOVA_RADIUS. takeDamage exists on the real
        // provider objects but not the TargetProvider type, so cast at the call.
        const heroes: Array<{
            getPosition(): { x: number; z: number };
            isAlive?(): boolean;
            takeDamage?(amount: number, sourcePos?: Vector3): void;
        }> = this.seekTargets.length > 0
            ? this.seekTargets
            : (this.seekTarget ? [this.seekTarget] : []);
        const r2 = NOVA_RADIUS * NOVA_RADIUS;
        for (const h of heroes) {
            if (h.isAlive?.() === false) continue;
            const p = h.getPosition();
            const dx = p.x - this.position.x;
            const dz = p.z - this.position.z;
            if (dx * dx + dz * dz <= r2) h.takeDamage?.(this.novaDamage, this.position);
        }
    }

    /** Orange ground disc telegraphing the nova radius. Same leak-safe pattern as the
     *  pull telegraph: fresh owned material, freed with disposeMesh(materials: true). */
    private spawnNovaTelegraph(): void {
        this.disposeNovaRing();
        const ring = createDisc('mbossNovaTele', { radius: NOVA_RADIUS, tessellation: 32 }, this.scene);
        // Three discs face +Z, so -PI/2 (not Babylon's +PI/2) lays it flat facing up.
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(this.position.x, 0.05, this.position.z);
        const mat = new MeshPhongMaterial();
        mat.name = 'mbossNovaTeleMat';
        mat.emissive = new Color(1.0, 0.35, 0.08);
        mat.color    = new Color(0, 0, 0);
        mat.specular = new Color(0, 0, 0);
        mat.opacity = 0.4;
        mat.transparent = true;
        ring.material = mat;
        ring.userData.ownedMaterial = true;
        this.novaRing = ring;
    }

    private disposeNovaRing(): void {
        if (this.novaRing && !isMeshDisposed(this.novaRing)) {
            disposeMesh(this.novaRing, { materials: true }); // free the per-nova material too
        }
        this.novaRing = null;
    }

    /** Free the telegraph ring — NOT parented to this.mesh, so the base mesh-tree
     *  release never reaches it. Runs on every disposal path (die/disposeCorpse/
     *  dispose — the corpse path is the ONLY one guest enemies take). Idempotent
     *  (disposeTelegraphRing nulls the ref); BossEnemy's override frees the wisps. */
    protected disposeAuxVisuals(): void {
        super.disposeAuxVisuals();
        this.disposeTelegraphRing();
        this.disposeNovaRing();
    }
}
