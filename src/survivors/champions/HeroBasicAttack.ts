import { Vector3, Mesh, Color, RingGeometry, DoubleSide, MeshBasicMaterial, MeshPhongMaterial, AdditiveBlending } from 'three';
import { Champion } from './Champion';
import { PowerSlotManager } from '../powers/PowerSlotManager';
import { EnchantmentHitContext, PowerElement } from '../powers/PowerDefinitions';
import { Enemy } from '../enemies/Enemy';
import { rollCrit } from '../enemies/critRoll';
import { PlayerStats } from '../PlayerStats';
import { getCachedMaterial } from '../../engine/rendering/MaterialCache';
import { acquireProjectile, releaseProjectile } from '../../engine/rendering/ProjectilePool';
import { setMeshOpacity } from '../../engine/rendering/LowPolyMaterial';
import { blendElements } from '../ElementColors';
import { emitCoopFx } from '../coop/CoopFx';
import { buildArrowMesh, ARROW_FLIGHT_HEIGHT } from '../powers/ArrowMesh';
import { createSphere, createTorus, disposeMesh, getCachedGeometry } from '../../engine/three/primitives';
import { headingToYaw } from '../../engine/three/math';
import type { SceneHost, UpdateToken } from '../../engine/three/SceneHost';

// Module-level scratch vectors — safe because update() is not reentrant (frames serialize)
const _scratchA = new Vector3();
const _scratchB = new Vector3();
/** Shared empty element list for the "no power slots" paths (read-only). */
const NO_ELEMENTS: PowerElement[] = [];

export interface BasicAttackTarget {
    position: Vector3;
    takeDamage: (amount: number, element?: PowerElement) => void;
    isAlive: () => boolean;
    /** The underlying Enemy instance, if available. Used by the co-op guest to
     *  route damage to the host even when the proximity re-resolve fails. */
    enemy?: Enemy;
}

export type BasicAttackMode = 'projectile' | 'melee';

export type ProjectileShape = 'sphere' | 'arrow' | 'mageBolt';

/** Delay between the main melee slash and each queued follow-up wave. */
const EXTRA_SPIN_DELAY = 0.15;

/** Baseline shove every wave hit applies (world units). Small on purpose —
 *  it staggers the front rank without scattering the horde; the knockback
 *  item's per-stack push (1.0) stacks on top inside applyHit. */
export const MELEE_BASE_KNOCKBACK = 0.5;

/** Half-width of the slash wave's damage corridor (world units, lateral). */
export const SLASH_WAVE_HALF_WIDTH = 1.5;

/** Default ceiling on arrows in one volley. The Thousand raises it. */
export const DEFAULT_ARROW_CAP = 12;

/**
 * Ascension's read-only influence over the RANGER volley. One object rather than
 * twenty setters, so the whole surface installs and clears atomically, and the
 * other two classes pay exactly one monomorphic call against a frozen null
 * object. Every method is a scalar read of already-resolved point counts.
 */
export interface ArrowPolicy {
    /** Extra arrows added to the volley before the cap. */
    bonusArrows(): number;
    /** Attack-speed per extra arrow (lower = more arrows). */
    arrowCountStep(): number;
    /** Hard ceiling on arrows in one volley. */
    arrowCap(): number;
    /** Half-angle of the surplus fan, radians. */
    fanHalfAngleRad(): number;
    /** Double surplus arrows onto real targets instead of fanning into empty ground. */
    stackSurplusOnTargets(): boolean;
    /** Multiplier on each arrow's damage. */
    arrowDamageScale(): number;
    /** Absolute range override, 0 = keep the authored value. */
    rangeOverride(): number;
    /** Absolute projectile-speed override, 0 = keep the authored value. */
    speedOverride(): number;
    /** Extra ricochet bounces on top of the run item. */
    bonusBounces(): number;
    /** Ricochet search radius override, 0 = keep the authored value. */
    ricochetRadius(): number;
}

const NULL_ARROW_POLICY: ArrowPolicy = Object.freeze({
    bonusArrows: () => 0,
    arrowCountStep: () => 0.15,
    arrowCap: () => DEFAULT_ARROW_CAP,
    fanHalfAngleRad: () => (10 * Math.PI) / 180,
    stackSurplusOnTargets: () => false,
    arrowDamageScale: () => 1,
    rangeOverride: () => 0,
    speedOverride: () => 0,
    bonusBounces: () => 0,
    ricochetRadius: () => 0,
});

/** Hard ceiling on an enchantment's effective level. Every barbarian onHit
 *  scales linearly in `level` against maxLevel 5, so Runeblooded + Twin Enchant
 *  maxed (+4) would badly overshoot without this. */
export const ENCHANT_LEVEL_CAP = 8;

/**
 * Ascension's read-only influence over the basic attack. ONE provider object
 * rather than nine setters, so the whole surface is installed and cleared
 * atomically. Every method is PULLED — none of this is assigned onto PlayerStats,
 * which applyLevelBonuses() re-assigns several times per wave.
 *
 * Composition rule for the two geometry methods: they take the current value and
 * return the replacement, and the implementation MAXes rather than sums, so two
 * nodes writing the same field cannot multiply into an arena-wide corridor.
 */
export interface BasicAttackMods {
    /** Added to melee reach (world units). */
    reachBonus(): number;
    /** Replacement slash-wave corridor half-width, given the authored base. */
    slashHalfWidth(base: number): number;
    /** Replacement slash-wave travel distance, given the authored base. */
    slashTravel(base: number): number;
    /** Multiplier on slash-wave corridor damage. */
    slashDamageMult(): number;
    /** True to suppress the per-hit knockback (keeps the horde inside a channel). */
    suppressKnockback(): boolean;
    /** Levels added to every weapon enchantment before its onHit fires. */
    enchantLevelBonus(): number;
    /** 0..1 chance an enchantment fires a second time. */
    enchantRepeatChance(): number;
    /** True when the repeat should pick a DIFFERENT enchantment. */
    enchantRepeatDistinct(): boolean;
}

/** Forward speed of the wave crest (world units / s). */
export const SLASH_WAVE_SPEED = 16;

/** The sweep starts this far BEHIND the hero so enemies overlapping the
 *  hero (already in contact range) are caught by the first step. */
export const SLASH_WAVE_BACK_GRACE = 0.5;

/** Radius of the crescent visual — sin(arc half-angle) × this ≈ the damage
 *  corridor half-width, so the drawn arc matches where hits land. */
const SLASH_WAVE_VISUAL_RADIUS = 1.9;
const SLASH_WAVE_ARC_HALF_RAD = (50 * Math.PI) / 180;

/** How far a ricochet bounce (ranger run-item) can reach for its next target. */
const RICOCHET_RADIUS = 6;

/** World-space Y each basic-attack projectile shape travels at (spawn height AND
 *  in-flight aim target both pin to this — see spawnProjectile / stepProjectile).
 *  Arrow shares ARROW_FLIGHT_HEIGHT with every other ranger arrow (powers,
 *  Multishot, Explosive Arrow) so they all visibly loose from the same point on
 *  the bow instead of drifting to independently-tuned heights. */
const PROJECTILE_FLIGHT_HEIGHT: Record<ProjectileShape, number> = {
    sphere: 1,
    arrow: ARROW_FLIGHT_HEIGHT,
    mageBolt: 1,
};

/** Pure corridor test for one step of the slash wave's sweep: does the
 *  (dx, dz) offset from the wave origin fall inside the band the crest crossed
 *  this frame — forward projection in (prevFront, newFront] along the unit
 *  direction (dirX, dirZ), within halfWidth laterally? Band semantics make the
 *  sweep tunnel-proof (any step size covers every point between the old and
 *  new front) and hit-once (half-open interval). Exported for Vitest. */
export function isInSlashBand(
    dx: number, dz: number,
    dirX: number, dirZ: number,
    prevFront: number, newFront: number,
    halfWidth: number,
): boolean {
    const forward = dx * dirX + dz * dirZ;
    if (forward <= prevFront || forward > newFront) return false;
    return Math.abs(dx * dirZ - dz * dirX) <= halfWidth;
}

/** In-flight projectile state, advanced by the ONE shared per-frame observer
 *  (was: one observer registered per projectile — dozens of live observers
 *  with attack-speed builds). */
interface ProjectileFlight {
    proj: Mesh;
    poolKey: string;
    target: BasicAttackTarget;
    shape: ProjectileShape;
    trailColor: Color;
    trailTimer: number;
    capturedDamage: number;
    heroPos: Vector3;
    allEnemies: Enemy[];
    /** Seconds in flight — released at 3s as a safety net. */
    age: number;
    /** Ricochet run-item: bounces this arrow still has after a hit. */
    bouncesLeft: number;
    /** Enemies already hit by this arrow (bounces never re-hit them). Null
     *  when the flight has no bounces — avoids a Set per plain arrow. */
    struck: Set<Enemy> | null;
}

/** In-flight slash wave (barbarian basic attack), advanced by the shared
 *  per-frame observer. Damage comes from sweeping the corridor band the crest
 *  crossed each frame — frame-rate-proof and hit-once per enemy. */
interface SlashWaveFlight {
    /** Hero position at cast (cloned — the hero keeps moving). */
    origin: Vector3;
    dirX: number;
    dirZ: number;
    /** Distance the crest has travelled from the origin (starts at
     *  −SLASH_WAVE_BACK_GRACE so contact-range enemies are swept). */
    front: number;
    maxDist: number;
    crest: Mesh;
    trail: Mesh;
    hit: Set<Enemy>;
    /** Impact flashes spawned so far — capped per wave. */
    flashes: number;
}

/** Fading trail puff driven by the shared observer (meshes pooled). */
interface StreakPuff { mesh: Mesh; elapsed: number; }
const STREAK_LIFETIME_S = 0.22;
const STREAK_POOL_MAX = 48;
/** Base alpha of a streak puff (the fade multiplies this, matching the old
 *  material.alpha(0.7) × mesh.visibility(1 - t) product). */
const STREAK_BASE_ALPHA = 0.7;

export class HeroBasicAttack {
    private scene: SceneHost;
    private hero: Champion;
    private cooldown: number = 0;
    private baseFireInterval: number;
    private attackSpeedMultiplier: number = 1.0;
    private rangeMultiplier: number = 1.0;
    private damage: number;
    private baseRange: number;
    private mode: BasicAttackMode;
    /** When true, every 15% above 1.0× attack speed grants +1 projectile in the fan.
     *  Wired on for the ranger so AS investment scales target count, not just rate. */
    private multiTargetFromAttackSpeed: boolean = false;
    /** Owner hook fired once per attack; see constructor opts. */
    private onAttack: (() => void) | null = null;
    private targetProvider: () => BasicAttackTarget | null;
    private powerSlots: PowerSlotManager | null = null;
    private playerStats: PlayerStats | null = null;
    /** Wired by HeroController.setPlayerStats — routes lifesteal heals to the hero's REAL HP
     *  (PlayerStats.health is a separate phantom value that the HUD doesn't read). */
    private healCallback: ((amount: number) => void) | null = null;
    /** Item-effect hook: fired once per enemy actually hit by a basic attack
     *  (melee swing AND projectile), with the pre-crit damage dealt. */
    private onHitCallback: ((target: Enemy, damage: number) => void) | null = null;
    /** Ascension hook fired once per SWING — one melee slash wave, one projectile
     *  volley, or one Whirlwind tick. NOT per enemy hit (that is onHitCallback).
     *  Distinct from the ctor's `onAttack`, which HeroController owns for the
     *  swing sound; hook slots here are single-owner. */
    private onSwingCallback: ((x: number, z: number) => void) | null = null;
    private projectileShape: ProjectileShape;
    private queuedSwings: number = 0;
    private queuedSpinTimer: number = 0;

    // For melee: reference to full enemy list for AOE
    private enemyProvider: (() => Enemy[]) | null = null;

    // Shared flight machinery: ONE observer advances every projectile + wave + streak.
    private liveProjectiles: ProjectileFlight[] = [];
    private liveWaves: SlashWaveFlight[] = [];
    private liveStreaks: StreakPuff[] = [];
    private streakPool: Mesh[] = [];
    private flightToken: UpdateToken | null = null;
    /** Reused enchantment-hit context — see applyEnchantments. Not reentrant. */
    private readonly _hitCtx: EnchantmentHitContext = {
        scene: null as unknown as SceneHost,
        heroPosition: null as unknown as Vector3,
        enemies: [],
        baseDamage: 0,
        element: 'physical',
    };

    /**
     * When set (co-op guest), a hit reports to the host instead of mutating enemy HP.
     * Return value ignored; the caller still plays local hit VFX (swing ring / arc).
     */
    public damageRouter: ((enemy: Enemy, amount: number, element: PowerElement, isCrit: boolean) => void) | null = null;

    constructor(
        scene: SceneHost,
        hero: Champion,
        opts: {
            mode: BasicAttackMode;
            fireRate: number;
            damage: number;
            range: number;
            targetProvider: () => BasicAttackTarget | null;
            enemyProvider?: () => Enemy[];
            projectileShape?: ProjectileShape;
            multiTargetFromAttackSpeed?: boolean;
            /** Fired once per attack (one swing / one volley, not per projectile)
             *  so the owner can play a sound. Kept as a callback rather than a
             *  Game reference so this stays free of engine dependencies. */
            onAttack?: () => void;
        },
    ) {
        this.scene = scene;
        this.hero = hero;
        this.baseFireInterval = 1 / opts.fireRate;
        this.damage = opts.damage;
        this.baseRange = opts.range;
        this.mode = opts.mode;
        this.targetProvider = opts.targetProvider;
        this.enemyProvider = opts.enemyProvider ?? null;
        this.projectileShape = opts.projectileShape ?? 'sphere';
        this.multiTargetFromAttackSpeed = opts.multiTargetFromAttackSpeed ?? false;
        this.onAttack = opts.onAttack ?? null;
    }

    /** Wire up the power slot manager so enchantments apply on each hit. */
    public setPowerSlots(slots: PowerSlotManager): void {
        this.powerSlots = slots;
    }

    /** Global damage-multiplier provider (shop upgrades + run perks). Multiplies
     *  every basic-attack hit and is passed to enchantment onHit hooks so passive
     *  bonus-damage effects scale with global power too. */
    private damageMultiplierProvider: () => number = () => 1.0;
    public setDamageMultiplierProvider(fn: () => number): void {
        this.damageMultiplierProvider = fn;
    }

    private get effectiveDamage(): number {
        return this.damage * this.damageMultiplierProvider();
    }

    /** Public read of the same value, for systems that scale off a swing's worth
     *  of damage (ascension nodes like Bodycheck deal "N% of basic damage"). */
    public getEffectiveDamage(): number { return this.effectiveDamage; }

    /** Wire up player stats so run-item effects (lifesteal, knockback, multishot, multi-spin) apply. */
    public setPlayerStats(stats: PlayerStats): void {
        this.playerStats = stats;
    }

    /** Wire the callback that applies lifesteal heals to the hero. */
    public setHealCallback(fn: (amount: number) => void): void {
        this.healCallback = fn;
    }

    /** Item-effect hook: fired once per enemy actually hit by a basic attack
     *  (melee swing AND projectile), with the pre-crit damage dealt. */
    public setOnHit(fn: ((target: Enemy, damage: number) => void) | null): void {
        this.onHitCallback = fn;
    }

    public setOnSwing(fn: ((x: number, z: number) => void) | null): void {
        this.onSwingCallback = fn;
    }

    /** Ascension's pulled influence over reach, the slash wave and enchantments.
     *  Null in co-op and before any ascension point is spent. */
    private mods: BasicAttackMods | null = null;
    public setBasicAttackMods(m: BasicAttackMods | null): void { this.mods = m; }

    /** Ranger-only volley policy. Frozen null object for the other classes. */
    private pol: ArrowPolicy = NULL_ARROW_POLICY;
    public setArrowPolicy(p: ArrowPolicy | null): void { this.pol = p ?? NULL_ARROW_POLICY; }

    /** Update the effective attack speed. multiplier > 1 = faster. */
    public updateAttackSpeed(multiplier: number): void {
        this.attackSpeedMultiplier = multiplier;
    }

    /** Update the effective attack range. multiplier > 1 = farther reach. */
    public updateRange(multiplier: number): void {
        this.rangeMultiplier = multiplier;
    }

    /** Transient attack-speed term (Skirmisher's Grace after a dash, Rage
     *  Ascendant r3 below 30% HP). PULLED, never assigned — the pushed
     *  attackSpeedMultiplier is re-assigned by applyLevelBonuses() every
     *  recompute and would clobber a transient written onto it. */
    private dynamicSpeedProvider: (() => number) | null = null;
    public setDynamicSpeedProvider(fn: (() => number) | null): void {
        this.dynamicSpeedProvider = fn;
    }

    /** Pushed multiplier × the transient term. */
    private get effectiveAttackSpeed(): number {
        return this.attackSpeedMultiplier * (this.dynamicSpeedProvider?.() ?? 1);
    }

    private get effectiveInterval(): number {
        return this.baseFireInterval / this.effectiveAttackSpeed;
    }

    private get effectiveRange(): number {
        const enchantBonus = this.mode === 'melee' && this.powerSlots
            ? this.powerSlots.getMeleeRangeBonus()
            : 0;
        const ascReach = this.mods?.reachBonus() ?? 0;
        const override = this.pol.rangeOverride();
        if (override > 0) return override * this.rangeMultiplier;
        return (this.baseRange + enchantBonus + ascReach) * this.rangeMultiplier;
    }

    /** Debug snapshot of every gate the fire path checks — so the co-op overlay can
     *  show exactly why the attack isn't firing (busy / no-target / out-of-range /
     *  on-cooldown) without the dev console. */
    public debugState(): { busy: boolean; hasTarget: boolean; dist: number; range: number; cooldown: number } {
        const hero = this.hero as { isSpecialActive?: () => boolean; isAttackActive?: () => boolean };
        const busy =
            (typeof hero.isSpecialActive === 'function' && hero.isSpecialActive()) ||
            (typeof hero.isAttackActive  === 'function' && hero.isAttackActive());
        const t = this.targetProvider();
        const dist = t ? this.getHeroPosition().distanceTo(t.position) : -1;
        return {
            busy,
            hasTarget: !!t && (t.isAlive?.() ?? true),
            dist,
            range: this.effectiveRange,
            cooldown: this.cooldown,
        };
    }

    public update(deltaTime: number): void {
        // While a GLB special or basic-attack animation is still playing, suspend
        // basic attacks — no swing, no projectile, no damage, no swing-arc visual.
        // For barbarian this lets the long whirlwind clip (skill3) finish before
        // the next attack restarts it. Cooldown still ticks so attacks resume
        // promptly when the previous animation ends.
        const hero = this.hero as { isSpecialActive?: () => boolean; isAttackActive?: () => boolean };
        const busy =
            (typeof hero.isSpecialActive === 'function' && hero.isSpecialActive()) ||
            (typeof hero.isAttackActive  === 'function' && hero.isAttackActive());
        if (busy) {
            this.cooldown -= deltaTime;
            return;
        }

        // Queued follow-up waves (barbarian extraAttacks) bypass the normal cooldown gate
        // so they fire at the chosen cadence regardless of the base attack interval. Skip
        // the wave if no enemy is in range (still drain the queue counter so we don't
        // pile up a backlog).
        if (this.queuedSwings > 0) {
            this.queuedSpinTimer -= deltaTime;
            if (this.queuedSpinTimer <= 0) {
                if (this.hasMeleeTarget()) this.performSlashWave();
                this.queuedSwings--;
                this.queuedSpinTimer = EXTRA_SPIN_DELAY;
            }
        }

        this.cooldown -= deltaTime;
        if (this.cooldown > 0) return;

        if (this.mode === 'melee') {
            // Only slash if at least one enemy is within range — otherwise the
            // cooldown holds and the next wave fires as soon as a mob walks in.
            if (!this.hasMeleeTarget()) return;
            this.performSlashWave();
            // After the main wave, queue any extra follow-ups from RunItems.
            const extras = this.playerStats?.extraAttacks ?? 0;
            if (extras > 0) {
                this.queuedSwings = extras;
                this.queuedSpinTimer = EXTRA_SPIN_DELAY;
            }
            this.cooldown = this.effectiveInterval;
        } else {
            const target = this.targetProvider();
            if (!target || !target.isAlive()) return;

            const heroPos = this.getHeroPosition();
            const range = this.effectiveRange;
            if (heroPos.distanceToSquared(target.position) > range * range) return;

            // Once per VOLLEY, after the range check — firing per projectile
            // would stack a multishot fan into one clipping blast.
            this.onAttack?.();
            this.onSwingCallback?.(heroPos.x, heroPos.z);

            const extras = this.playerStats?.extraAttacks ?? 0;
            // Ranger: every 15% above 1.0× AS grants an extra projectile. The
            // Multishot ult also rides on this — it boosts AS temporarily so the
            // multi-target effect chains naturally instead of duplicating logic.
            // effectiveAttackSpeed (not the pushed multiplier) so a transient
            // Skirmisher's Grace burst feeds arrow count — that node's rider.
            const step = Math.max(0.08, this.pol.arrowCountStep());
            const asBonus = this.multiTargetFromAttackSpeed
                ? Math.max(0, Math.floor((this.effectiveAttackSpeed - 1) / step))
                : 0;
            const total = Math.min(this.pol.arrowCap(),
                1 + extras + asBonus + this.pol.bonusArrows());
            if (total === 1) {
                this.spawnProjectile(heroPos.clone(), target);
            } else if (this.multiTargetFromAttackSpeed) {
                // Ranger multishot: each extra arrow tracks a distinct nearest enemy.
                // Falls back to the angle-fan for any arrows beyond the available
                // target count so the volley still reads as "many arrows."
                const tgts = this.pickDistinctNearestTargets(heroPos, target, total);
                for (const t of tgts) this.spawnProjectile(heroPos.clone(), t);
                const fanned = total - tgts.length;
                if (fanned > 0 && this.pol.stackSurplusOnTargets() && tgts.length > 0) {
                    // Splinter Salvo: doubled-up arrows on real bodies rather than
                    // fanning into empty ground.
                    for (let i = 0; i < fanned; i++) {
                        this.spawnProjectile(heroPos.clone(), tgts[i % tgts.length]);
                    }
                } else if (fanned > 0) {
                    const totalSpreadRad = this.pol.fanHalfAngleRad() * 2;
                    const fanStep = fanned > 1 ? totalSpreadRad / (fanned - 1) : 0;
                    const start = -totalSpreadRad / 2;
                    for (let i = 0; i < fanned; i++) {
                        this.spawnProjectileAtAngle(heroPos.clone(), target, start + fanStep * i);
                    }
                }
            } else {
                const totalSpreadRad = this.pol.fanHalfAngleRad() * 2;
                const step = total > 1 ? totalSpreadRad / (total - 1) : 0;
                const start = -totalSpreadRad / 2;
                for (let i = 0; i < total; i++) {
                    const angle = start + step * i;
                    this.spawnProjectileAtAngle(heroPos.clone(), target, angle);
                }
            }
            // Trigger the ranger GLB's Shoot animation + face the target (no-op for
            // non-ranger champions). The clip compresses to the attack interval so
            // attack-speed builds fire visibly faster instead of clipping the draw.
            const hero = this.hero as { triggerAttack?: (targetPos?: Vector3, maxDurationS?: number) => void };
            if (typeof hero.triggerAttack === 'function') {
                hero.triggerAttack(target.position, this.effectiveInterval);
            }
            this.cooldown = this.effectiveInterval;
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Melee — slash wave: a crescent that launches toward the nearest enemy and
    // damages everything in its corridor as it travels out to max range
    // ─────────────────────────────────────────────────────────────────────────

    /** True when at least one alive enemy is within the effective melee range. */
    private hasMeleeTarget(): boolean {
        if (!this.enemyProvider) return false;
        const heroPos = this.getHeroPosition();
        const range = this.effectiveRange;
        const rangeSq = range * range;
        for (const e of this.enemyProvider()) {
            if (!e.isAlive()) continue;
            const dx = e.getPosition().x - heroPos.x;
            const dz = e.getPosition().z - heroPos.z;
            if (dx * dx + dz * dz <= rangeSq) return true;
        }
        return false;
    }

    private performSlashWave(): void {
        this.onAttack?.();
        const heroPos = this.getHeroPosition();
        this.onSwingCallback?.(heroPos.x, heroPos.z);
        const range = this.effectiveRange;
        const enemies = this.enemyProvider ? this.enemyProvider() : [];
        const rangeSq = range * range;

        // Aim the wave at the nearest enemy in range — it only fires when one
        // exists (hasMeleeTarget), so the crest always has a lane to travel.
        let aim: Enemy | null = null;
        let aimDistSq = Infinity;
        for (const e of enemies) {
            if (!e.isAlive()) continue;
            const dx = e.getPosition().x - heroPos.x;
            const dz = e.getPosition().z - heroPos.z;
            const dSq = dx * dx + dz * dz;
            if (dSq <= rangeSq && dSq < aimDistSq) { aim = e; aimDistSq = dSq; }
        }
        if (!aim) return;
        let fx = aim.getPosition().x - heroPos.x;
        let fz = aim.getPosition().z - heroPos.z;
        const fLen = Math.hypot(fx, fz);
        if (fLen > 1e-3) { fx /= fLen; fz /= fLen; } else { fx = 1; fz = 0; }

        const facingAngle = Math.atan2(fz, fx);
        const { crest, trail } = this.spawnSlashWaveMeshes(facingAngle);
        const wave: SlashWaveFlight = {
            origin: heroPos.clone(),
            dirX: fx,
            dirZ: fz,
            front: -SLASH_WAVE_BACK_GRACE,
            maxDist: this.mods?.slashTravel(range) ?? range,
            crest,
            trail,
            hit: new Set(),
            flashes: 0,
        };
        this.liveWaves.push(wave);
        this.ensureFlightObserver();
        // Zero-dt step places the crescent at the hero before the first render.
        this.stepSlashWave(wave, 0);

        // Co-op: broadcast the wave (range + facing) so the teammate sees the
        // same crescent travel. "range:angle", mirroring the old swing payload.
        emitCoopFx('slash', heroPos.x, heroPos.z, undefined, undefined,
            `${range}:${facingAngle.toFixed(3)}`);

        // Weapon-trail FX (axe ribbon follows the weapon bone through the slash;
        // also drives the procedural fallback's attack timer).
        const hero = this.hero as any;
        if (typeof hero.triggerSpinAttack === 'function') {
            hero.triggerSpinAttack();
        }
        // GLB attack animation — face where the wave flies; the clip compresses
        // to the attack interval so fast builds swing visibly faster.
        if (typeof hero.triggerAttack === 'function') {
            hero.triggerAttack(aim.getPosition(), this.effectiveInterval);
        }
    }

    /** Advance one slash wave by dt: sweep the corridor band the crest crossed
     *  (hitting each enemy at most once), then move/fade the crescent. Returns
     *  false when the wave reached max range (meshes disposed). */
    private stepSlashWave(w: SlashWaveFlight, dt: number): boolean {
        const prev = w.front;
        w.front = Math.min(w.front + SLASH_WAVE_SPEED * dt, w.maxDist);
        // Pulled once per wave-step, not per enemy — the loop below is O(horde).
        const halfWidth = this.mods?.slashHalfWidth(SLASH_WAVE_HALF_WIDTH) ?? SLASH_WAVE_HALF_WIDTH;

        // Live enemy list each step — enemies that walk into the lane mid-flight
        // are still hit (the old instant cone only saw its cast-time snapshot).
        const enemies = this.enemyProvider ? this.enemyProvider() : [];
        for (const e of enemies) {
            if (!e.isAlive() || w.hit.has(e)) continue;
            const dx = e.getPosition().x - w.origin.x;
            const dz = e.getPosition().z - w.origin.z;
            if (!isInSlashBand(dx, dz, w.dirX, w.dirZ, prev, w.front, halfWidth)) continue;
            w.hit.add(e);
            this.applyHit(e, w.origin, enemies);
            // Baseline shove along the travel direction — the crest carries the
            // front rank with it. Item knockback (applyHit) stacks on top.
            e.applyKnockback(w.dirX, w.dirZ, MELEE_BASE_KNOCKBACK);
            // Per-enemy impact flash — capped so a packed lane doesn't spike
            // draw calls; the crescent + damage numbers carry the rest.
            if (w.flashes < 4) { w.flashes++; this.spawnImpactFlash(e.getPosition()); }
        }

        // The mesh origin (the arc's center of curvature) trails the crest by
        // the arc radius so the leading edge sits exactly at `front`.
        const t = Math.max(w.front, 0) / w.maxDist;
        const scale = SLASH_WAVE_VISUAL_RADIUS * (0.85 + 0.3 * t);
        const backset = w.front - scale;
        w.crest.position.set(w.origin.x + w.dirX * backset, 0.35, w.origin.z + w.dirZ * backset);
        w.trail.position.set(w.origin.x + w.dirX * backset, 0.3, w.origin.z + w.dirZ * backset);
        // Local X is the travel depth, local Y the lateral spread (the x=π/2
        // pitch maps it onto world XZ) — the wave widens as it travels.
        w.crest.scale.set(scale, scale * (0.9 + 0.35 * t), 1);
        w.trail.scale.set(scale * 0.92, scale * (0.85 + 0.3 * t), 1);
        setMeshOpacity(w.crest, 0.85 * (1 - t * t));
        setMeshOpacity(w.trail, 0.5 * (1 - t));

        if (w.front >= w.maxDist) {
            // disposeMesh frees the meshes + their setMeshOpacity clones (flagged
            // ownedMaterial); cached shared materials/geometry are skipped —
            // clearMaterialCache() frees them on run teardown.
            disposeMesh(w.crest);
            disposeMesh(w.trail);
            return false;
        }
        return true;
    }

    /** Apply one full basic-attack hit to a single enemy: effective damage
     *  (crit is rolled inside Enemy.takeDamage), lifesteal, knockback radiating
     *  from `fromPos`, and element enchantments. Shared by the slash wave and
     *  Whirlwind ticks so both carry the exact same hit modifiers. */
    private applyHit(e: Enemy, fromPos: Vector3, enemies: Enemy[]): void {
        const dmg = this.effectiveDamage;
        if (this.damageRouter) {
            // Co-op guest: roll crit client-side (using the global provider, same
            // as the solo path's Enemy.takeDamage would) and send the post-crit
            // number + flag to the host, which applies it verbatim.
            const cp = Enemy.critProvider?.();
            const rolled = rollCrit(dmg, cp ?? undefined, Math.random);
            this.damageRouter(e, rolled.amount, 'physical', rolled.isCrit);
        } else {
            e.takeDamage(dmg, 'physical');
        }

        const lifestealPct = this.playerStats?.lifestealPct ?? 0;
        if (lifestealPct > 0 && this.healCallback) {
            this.healCallback(dmg * lifestealPct);
        }

        const knockback = this.mods?.suppressKnockback() ? 0 : (this.playerStats?.knockbackOnHit ?? 0);
        if (knockback > 0) {
            const dx = e.getPosition().x - fromPos.x;
            const dz = e.getPosition().z - fromPos.z;
            const horizDist = Math.hypot(dx, dz);
            if (horizDist > 0.001) {
                e.applyKnockback(dx / horizDist, dz / horizDist, knockback);
            }
        }

        this.applyEnchantments(e, fromPos, enemies);
        // Item-effect hit hook — fires on host/solo AND the co-op guest (each client
        // runs its OWN item effects; the primary hit already routed via damageRouter
        // above). Pre-crit `dmg`, identical to the solo path, for parity.
        this.onHitCallback?.(e, dmg);
    }

    /** Apply full basic-attack hits to every enemy within `radius` of `center`.
     *  Whirlwind uses this so each tick hits exactly like the basic attack
     *  (crit / lifesteal / knockback / enchantments) — just far more often. */
    public applyAttackHitsInRadius(center: Vector3, radius: number): void {
        // ONE swing per call — this is how a Whirlwind tick counts as a swing for
        // per-swing nodes (Aftershock). Fired here, not per enemy in the loop.
        this.onSwingCallback?.(center.x, center.z);
        const enemies = this.enemyProvider ? this.enemyProvider() : [];
        const rSq = radius * radius;
        for (const e of enemies) {
            if (!e.isAlive()) continue;
            const dx = e.getPosition().x - center.x;
            const dz = e.getPosition().z - center.z;
            if (dx * dx + dz * dz <= rSq) {
                this.applyHit(e, center, enemies);
            }
        }
    }

    /** Build the two crescent arcs of one slash wave: a bright leading crest
     *  and a fainter, narrower trailing arc. Geometry is a cached unit ring
     *  sector scaled per spawn (bounded key — disposeMesh skips it); materials
     *  are cached by element tint (finitely many blends), and fades go through
     *  setMeshOpacity (clone-on-write) so the shared material is never mutated.
     *
     *  Yaw math: geometry theta θ maps to world angle θ − rotation.y after the
     *  x=π/2 pitch (order 'YXZ'), so aiming geometry-center θ=0 at the facing
     *  means rotation.y = −facingAngle. */
    private spawnSlashWaveMeshes(facingAngle: number): { crest: Mesh; trail: Mesh } {
        // Barbarian-only elemental tint: blend the colors of every active power
        // element. No elements (or non-barbarian) → the classic ember arc.
        const active = (this.powerSlots && (this.hero as any).championType === 'barbarian')
            ? this.powerSlots.getActiveElementList()
            : NO_ELEMENTS;
        const tint = active.length > 0 ? blendElements(active) : null;
        const half = SLASH_WAVE_ARC_HALF_RAD;

        const crest = new Mesh(getCachedGeometry(
            'slashWaveCrest', () => new RingGeometry(0.82, 1.0, 20, 1, -half, half * 2)));
        crest.name = 'slashWaveCrest';
        const trail = new Mesh(getCachedGeometry(
            'slashWaveTrail', () => new RingGeometry(0.52, 0.78, 20, 1, -half * 0.8, half * 1.6)));
        trail.name = 'slashWaveTrail';

        crest.material = tint
            ? getCachedMaterial('slashWaveCrestMatElem_' + tint.getHexString(), m => {
                m.emissive.copy(tint).multiplyScalar(1.5);
                m.color.set(0, 0, 0); // emissive-only look
                m.transparent = true;
                m.opacity = 0.85;
                m.depthWrite = false;
                m.blending = AdditiveBlending;
                m.side = DoubleSide; // flat arc must read from above regardless of winding
            })
            : getCachedMaterial('slashWaveCrestMat', m => {
                m.emissive.set(1, 0.75, 0.45); // white-hot ember edge — barbarian default
                m.color.set(0, 0, 0);
                m.transparent = true;
                m.opacity = 0.85;
                m.depthWrite = false;
                m.blending = AdditiveBlending;
                m.side = DoubleSide;
            });
        trail.material = tint
            ? getCachedMaterial('slashWaveTrailMatElem_' + tint.getHexString(), m => {
                m.emissive.copy(tint).multiplyScalar(1.2);
                m.color.set(0, 0, 0);
                m.transparent = true;
                m.opacity = 0.5;
                m.depthWrite = false;
                m.blending = AdditiveBlending;
                m.side = DoubleSide;
            })
            : getCachedMaterial('slashWaveTrailMat', m => {
                m.emissive.set(1, 0.42, 0.12); // ember orange-red
                m.color.set(0, 0, 0);
                m.transparent = true;
                m.opacity = 0.5;
                m.depthWrite = false;
                m.blending = AdditiveBlending;
                m.side = DoubleSide;
            });

        for (const mesh of [crest, trail]) {
            this.scene.scene.add(mesh);
            mesh.rotation.order = 'YXZ';
            mesh.rotation.x = Math.PI / 2;
            mesh.rotation.y = -facingAngle;
        }
        return { crest, trail };
    }

    /** Small expanding shockwave ring at a struck enemy — the same cached-
     *  material + setMeshOpacity(clone-on-write) + disposeMesh lifecycle as the
     *  swing ring, so nothing is orphaned. ~0.22 s, one draw call while live. */
    private spawnImpactFlash(pos: Vector3): void {
        const ring = createTorus('impactFlash', { diameter: 0.7, thickness: 0.14, tessellation: 16 }, this.scene);
        ring.position.set(pos.x, 0.45, pos.z);
        ring.material = getCachedMaterial('impactFlashMat', m => {
            m.emissive.set(1, 0.9, 0.6);
            m.color.set(0, 0, 0);
            m.transparent = true;
            m.opacity = 0.85;
            m.depthWrite = false;
        });

        const duration = 0.22;
        let elapsed = 0;
        let token: UpdateToken | null = null;
        token = this.scene.onBeforeRender.add(() => {
            elapsed += this.scene.deltaSeconds;
            const t = Math.min(elapsed / duration, 1);
            const s = 0.6 + 1.5 * t;
            ring.scale.set(s, s, s);
            setMeshOpacity(ring, 0.85 * (1 - t));
            if (t >= 1) {
                disposeMesh(ring);
                this.scene.onBeforeRender.remove(token);
            }
        });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Projectile
    // ─────────────────────────────────────────────────────────────────────────

    /** Build the projectile mesh for this attack's configured shape.
     *
     *  IMPORTANT: the projectile pool resets the ROOT transform on reuse
     *  (acquireProjectile), so any baked orientation (the arrow's +Z pitch) is
     *  re-applied per spawn in spawnProjectile — never rely on rotation set here
     *  surviving a pool round-trip. Sub-parts (arrow tip/fletch, bolt halo) live
     *  as children whose LOCAL transforms the pool never touches. Materials are
     *  applied per spawn to the whole subtree (applyProjectileMaterial). */
    private createProjectileMesh(): Mesh {
        const scene = this.scene;
        switch (this.projectileShape) {
            case 'arrow':
                // Shaft + cone tip + fletching, forward = +Z (rotation.order 'YXZ' +
                // pitch, re-asserted per spawn). Shared with the power arrows.
                return buildArrowMesh(scene, 'basicArrow', new Color(0.7, 0.5, 0.3));
            case 'mageBolt': {
                // Glowing orb with a halo ring perpendicular to the flight axis
                const orb = createSphere('mageBolt',
                    { diameter: 0.4, segments: 4 }, scene);
                const halo = createTorus('mageBoltHalo',
                    { diameter: 0.55, thickness: 0.05, tessellation: 12 });
                halo.rotation.x = Math.PI / 2;
                orb.add(halo);
                return orb;
            }
            case 'sphere':
            default:
                return createSphere('basicProj', { diameter: 0.3, segments: 4 }, scene);
        }
    }

    /** Assign one material to the projectile root and every sub-part. */
    private applyProjectileMaterial(proj: Mesh, mat: MeshPhongMaterial): void {
        proj.traverse(node => {
            const m = node as Mesh;
            if (m.isMesh) m.material = mat;
        });
    }

    /**
     * Fan-variant of spawnProjectile: rotates the launch direction by `angleRad`
     * around the vertical axis. Center projectile (angle = 0) is identical to
     * a normal spawnProjectile call. Off-center projectiles fly straight in the
     * rotated direction at the same speed; if they hit the original target
     * along the way (the target's tracking is preserved by spawnProjectile),
     * they still apply damage. Off-center projectiles miss the target most of
     * the time — they exist primarily to make the fan readable and to clear
     * out adjacent enemies.
     */
    private spawnProjectileAtAngle(from: Vector3, target: BasicAttackTarget, angleRad: number): void {
        if (angleRad === 0) {
            this.spawnProjectile(from, target);
            return;
        }
        // Build a virtual target offset by rotating the (target - from) vector by angleRad.
        const dx = target.position.x - from.x;
        const dz = target.position.z - from.z;
        const cos = Math.cos(angleRad);
        const sin = Math.sin(angleRad);
        const rotX = dx * cos - dz * sin;
        const rotZ = dx * sin + dz * cos;
        // Extend the rotated direction out to the same length so the projectile travels.
        const virtualTargetPos = new Vector3(from.x + rotX, target.position.y, from.z + rotZ);
        const virtualTarget: BasicAttackTarget = {
            position: virtualTargetPos,
            takeDamage: (amount, element) => target.takeDamage(amount, element),
            isAlive: () => target.isAlive(),
            enemy: target.enemy,
        };
        this.spawnProjectile(from, virtualTarget);
    }

    /**
     * For the ranger multishot mechanic: return up to `total` distinct targets,
     * starting with the primary auto-target and filling the rest with the next
     * nearest alive enemies inside `effectiveRange`. Returned BasicAttackTargets
     * wrap the live Enemy.getPosition() reference so projectiles keep tracking.
     */
    private pickDistinctNearestTargets(
        heroPos: Vector3,
        primary: BasicAttackTarget,
        total: number,
    ): BasicAttackTarget[] {
        const out: BasicAttackTarget[] = [primary];
        if (!this.enemyProvider || total <= 1) return out;
        const range = this.effectiveRange;
        const rangeSq = range * range;

        // Top-k selection (k = extra projectiles, ≤ ~6): keep a small sorted
        // array of the nearest candidates instead of collecting + full-sorting
        // every enemy in range — this runs once per volley at ranger fire rates.
        const need = total - 1;
        const bestE: Enemy[] = [];
        const bestD2: number[] = [];
        for (const e of this.enemyProvider()) {
            if (!e.isAlive()) continue;
            const ep = e.getPosition();
            // Skip the primary target — compare positions (BasicAttackTarget hides identity).
            const dxp = ep.x - primary.position.x;
            const dzp = ep.z - primary.position.z;
            if (dxp * dxp + dzp * dzp < 0.04) continue; // ~0.2u tolerance
            const dx = ep.x - heroPos.x;
            const dz = ep.z - heroPos.z;
            const d2 = dx * dx + dz * dz;
            if (d2 > rangeSq) continue;
            if (bestD2.length === need && d2 >= bestD2[need - 1]) continue;
            // Insert sorted (k is tiny — linear shift beats any cleverness).
            let at = bestD2.length;
            while (at > 0 && bestD2[at - 1] > d2) at--;
            bestD2.splice(at, 0, d2);
            bestE.splice(at, 0, e);
            if (bestD2.length > need) { bestD2.pop(); bestE.pop(); }
        }

        for (const e of bestE) {
            out.push({
                position: e.getPosition(),
                takeDamage: (amount, element) => e.takeDamage(amount, element),
                isAlive: () => e.isAlive(),
                enemy: e,
            });
        }
        return out;
    }

    private spawnProjectile(from: Vector3, target: BasicAttackTarget): void {
        // Co-op: broadcast this projectile so the teammate sees the shot (cosmetic only —
        // damage is already routed authoritatively). No-op in single-player.
        emitCoopFx('proj', from.x, from.z, target.position.x, target.position.z, this.projectileShape);
        const poolKey = `basic_attack_proj_${this.projectileShape}`;
        const proj = acquireProjectile(poolKey, () => this.createProjectileMesh());
        proj.position.copy(from);
        proj.position.y = PROJECTILE_FLIGHT_HEIGHT[this.projectileShape];

        // Element-matched tint: blend the colors of every equipped power element
        // (same rule as the barbarian's swing arc). The material is cached by the
        // blend's hex — element subsets are finite, so the cache stays bounded.
        const activeElements = this.powerSlots
            ? this.powerSlots.getActiveElementList()
            : NO_ELEMENTS;
        const tint = activeElements.length > 0 ? blendElements(activeElements) : null;
        const matKey = tint
            ? `basic_attack_proj_mat_${this.projectileShape}_${tint.getHexString()}`
            : `basic_attack_proj_mat_${this.projectileShape}`;
        const mat = getCachedMaterial(matKey, m => {
            if (tint) {
                m.emissive.copy(tint).multiplyScalar(1.1);
                m.color.set(0, 0, 0); // was disableLighting — emissive-only look
                return;
            }
            switch (this.projectileShape) {
                case 'arrow':
                    m.emissive.set(0.7, 0.5, 0.3);
                    m.color.set(0.7, 0.5, 0.3);
                    break;
                case 'mageBolt':
                    m.emissive.set(0.6, 0.4, 1.0);
                    m.color.set(0.2, 0.1, 0.4);
                    break;
                case 'sphere':
                default:
                    m.emissive.set(1, 0.9, 0.4);
                    break;
            }
        });
        this.applyProjectileMaterial(proj, mat);

        // Re-assert the arrow's baked forward orientation (the pool reset zeroes the
        // root rotation) and face the target immediately — the per-frame orient below
        // only runs from the next render, which left one frame of stale facing.
        if (this.projectileShape === 'arrow') {
            proj.rotation.order = 'YXZ'; // yaw applied around world Y, then the +Z pitch
            proj.rotation.x = Math.PI / 2;
            proj.rotation.y = headingToYaw(target.position.x - from.x, target.position.z - from.z);
        }

        // Hand the flight to the single shared observer (see ensureFlightObserver).
        const bounces = (this.playerStats?.ricochetBounces ?? 0) + this.pol.bonusBounces();
        this.liveProjectiles.push({
            proj,
            poolKey,
            target,
            shape: this.projectileShape,
            // Element-colored streak behind the arrow while it flies (gold when
            // no elements are equipped yet).
            trailColor: tint ?? new Color(1, 0.85, 0.5),
            trailTimer: 0,
            // Snapshot damage at fire time — projectile carries that value;
            // upgrades mid-flight don't retroactively buff already-fired arrows.
            capturedDamage: this.effectiveDamage * this.pol.arrowDamageScale(),
            heroPos: from,
            allEnemies: this.enemyProvider ? this.enemyProvider() : [],
            age: 0,
            bouncesLeft: bounces,
            struck: bounces > 0 ? new Set<Enemy>() : null,
        });
        this.ensureFlightObserver();
    }

    /** Lazily register the ONE observer that advances every live projectile,
     *  slash wave, and trail puff. Replaces the old observer-per-projectile/
     *  per-puff pattern, whose observer count scaled with attack speed. */
    private ensureFlightObserver(): void {
        if (this.flightToken) return;
        this.flightToken = this.scene.onBeforeRender.add(() => {
            const dt = this.scene.deltaSeconds;

            // Backwards with swap-remove so releases don't shift the array.
            for (let i = this.liveProjectiles.length - 1; i >= 0; i--) {
                if (!this.stepProjectile(this.liveProjectiles[i], dt)) {
                    this.liveProjectiles[i] = this.liveProjectiles[this.liveProjectiles.length - 1];
                    this.liveProjectiles.pop();
                }
            }

            for (let i = this.liveWaves.length - 1; i >= 0; i--) {
                if (!this.stepSlashWave(this.liveWaves[i], dt)) {
                    this.liveWaves[i] = this.liveWaves[this.liveWaves.length - 1];
                    this.liveWaves.pop();
                }
            }

            for (let i = this.liveStreaks.length - 1; i >= 0; i--) {
                const s = this.liveStreaks[i];
                s.elapsed += dt;
                const t = Math.min(s.elapsed / STREAK_LIFETIME_S, 1);
                s.mesh.scale.setScalar(1 - t);
                // Puff materials are per-mesh owned (see spawnFlightStreak) — safe
                // to mutate. Matches the old material.alpha × visibility product.
                (s.mesh.material as MeshBasicMaterial).opacity = STREAK_BASE_ALPHA * (1 - t);
                if (t >= 1) {
                    this.releaseStreak(s.mesh);
                    this.liveStreaks[i] = this.liveStreaks[this.liveStreaks.length - 1];
                    this.liveStreaks.pop();
                }
            }
        });
    }

    /** Advance one projectile by dt. Returns false when the flight ended (the
     *  projectile has been released back to the pool). */
    private stepProjectile(f: ProjectileFlight, dt: number): boolean {
        const { proj, target } = f;
        if (!target.isAlive()) {
            releaseProjectile(f.poolKey, proj);
            return false;
        }
        _scratchA.copy(target.position);
        _scratchA.y = PROJECTILE_FLIGHT_HEIGHT[f.shape];
        _scratchB.subVectors(_scratchA, proj.position);
        const dist = _scratchB.length();

        // Orient arrow to face travel direction
        if (f.shape === 'arrow' && dist > 0.01) {
            proj.rotation.y = headingToYaw(_scratchB.x, _scratchB.z);
        }

        if (dist < 0.4) {
            // Resolve the actual Enemy instance behind the BasicAttackTarget so we
            // have applyKnockback AND can route damage to the host in co-op. The
            // target usually carries its Enemy; the O(n) proximity find is only the
            // fallback for providers that don't set it.
            const hitEnemy = target.enemy ?? f.allEnemies.find(e => {
                const ep = e.getPosition();
                const dx = ep.x - target.position.x;
                const dz = ep.z - target.position.z;
                return dx * dx + dz * dz < 0.25 && e.isAlive();
            });
            // Co-op guest: always route to host, never mutate local HP.
            if (this.damageRouter) {
                // Roll crit client-side; send the post-crit number + flag to the host.
                if (hitEnemy) {
                    const cp = Enemy.critProvider?.();
                    const rolled = rollCrit(f.capturedDamage, cp ?? undefined, Math.random);
                    this.damageRouter(hitEnemy, rolled.amount, 'physical', rolled.isCrit);
                }
                // guest: never local takeDamage on a shared enemy
            } else {
                target.takeDamage(f.capturedDamage, 'physical');
            }
            if (this.healCallback && this.playerStats && this.playerStats.lifestealPct > 0) {
                this.healCallback(f.capturedDamage * this.playerStats.lifestealPct);
            }
            // Apply enchantments AND knockback on projectile hit.
            if (hitEnemy) {
                const knockback = this.playerStats?.knockbackOnHit ?? 0;
                if (knockback > 0) {
                    // Direction: hero → impact point (matches projectile travel direction).
                    const tx = target.position.x - f.heroPos.x;
                    const tz = target.position.z - f.heroPos.z;
                    const tlen = Math.hypot(tx, tz);
                    if (tlen > 0.001) {
                        hitEnemy.applyKnockback(tx / tlen, tz / tlen, knockback);
                    }
                }
                if (this.powerSlots) {
                    this.applyEnchantments(hitEnemy, f.heroPos, f.allEnemies);
                }
                // Item-effect hit hook — host/solo AND co-op guest (pre-crit, parity).
                this.onHitCallback?.(hitEnemy, f.capturedDamage);
            }

            // Ricochet (ranger wave-15 item): instead of expiring, the arrow
            // banks toward the nearest fresh enemy and lands a full hit there —
            // this same block runs again on each landing, so bounces carry
            // damage, crit, lifesteal, enchantments, and the item hit hook.
            if (f.bouncesLeft > 0 && f.struck) {
                if (hitEnemy) f.struck.add(hitEnemy);
                const next = this.pickRicochetTarget(target.position, f.struck);
                if (next) {
                    f.bouncesLeft--;
                    f.target = {
                        position: next.getPosition(),
                        takeDamage: (amount, element) => next.takeDamage(amount, element),
                        isAlive: () => next.isAlive(),
                        enemy: next,
                    };
                    // Bounce flash at the impact + teammate-visible hop leg.
                    this.spawnImpactFlash(target.position);
                    emitCoopFx('proj', target.position.x, target.position.z,
                        next.getPosition().x, next.getPosition().z, this.projectileShape);
                    return true;
                }
            }
            releaseProjectile(f.poolKey, proj);
            return false;
        }

        const speed = this.pol.speedOverride() || 22;
        const step = Math.min(dist, speed * dt);
        _scratchB.normalize();
        _scratchB.multiplyScalar(step);
        proj.position.add(_scratchB);

        if (f.shape === 'arrow' || f.shape === 'mageBolt') {
            f.trailTimer += dt;
            if (f.trailTimer >= 0.06) {
                f.trailTimer = 0;
                this.spawnFlightStreak(proj.position, f.trailColor);
            }
        }

        // Safety: release after 3s of flight
        f.age += dt;
        if (f.age > 3) {
            releaseProjectile(f.poolKey, proj);
            return false;
        }
        return true;
    }

    /** Nearest alive enemy to `from` within RICOCHET_RADIUS that this arrow
     *  hasn't struck yet, or null (the arrow expires). */
    private pickRicochetTarget(from: Vector3, struck: Set<Enemy>): Enemy | null {
        if (!this.enemyProvider) return null;
        let best: Enemy | null = null;
        const rr = this.pol.ricochetRadius() || RICOCHET_RADIUS;
        let bestD2 = rr * rr;
        for (const e of this.enemyProvider()) {
            if (!e.isAlive() || struck.has(e)) continue;
            const ep = e.getPosition();
            const dx = ep.x - from.x;
            const dz = ep.z - from.z;
            const d2 = dx * dx + dz * dz;
            if (d2 < bestD2) { best = e; bestD2 = d2; }
        }
        return best;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Enchantment application
    // ─────────────────────────────────────────────────────────────────────────
    /** Fire the equipped weapon enchantments on one enemy from OUTSIDE a normal
     *  hit (Aftershock's shockwave, Runeblooded r3's Smash/dash proc). Resolves
     *  hero position and the enemy list itself so callers need neither. */
    public fireEnchantmentsOn(enemy: Enemy): void {
        if (!enemy.isAlive()) return;
        this.applyEnchantments(enemy, this.getHeroPosition(), this.enemyProvider ? this.enemyProvider() : []);
    }

    private applyEnchantments(enemy: Enemy, heroPos: Vector3, allEnemies: Enemy[]): void {
        if (!this.powerSlots) return;
        const enchantments = this.powerSlots.getActiveEnchantments();
        if (enchantments.length === 0) return;

        // Reused hit context — this runs once per enemy per hit, i.e. per enemy
        // per frame while Whirlwind is up. onHit hooks read it synchronously and
        // never retain it (unlike a power's cast(), whose observers do).
        const ctx = this._hitCtx;
        ctx.scene = this.scene;
        ctx.heroPosition = heroPos;
        ctx.enemies = allEnemies;
        // Pass the multiplied damage so passive on-hit bonuses (Arcane Bite,
        // Flaming Edge DoT, Heavy Strike, Shock Chain) also scale with shop
        // upgrades and the per-card global power bump.
        ctx.baseDamage = this.effectiveDamage;
        ctx.element = 'physical';

        const lvlBonus = this.mods?.enchantLevelBonus() ?? 0;
        const repeatChance = this.mods?.enchantRepeatChance() ?? 0;
        const distinct = this.mods?.enchantRepeatDistinct() ?? false;
        for (let i = 0; i < enchantments.length; i++) {
            const enc = enchantments[i];
            if (!enc.slot.def.onHit) continue;
            ctx.element = enc.slot.def.element;
            // ENCHANT_LEVEL_CAP: every barbarian onHit scales linearly in `level`
            // against maxLevel 5, so an uncapped +4 would badly overshoot.
            enc.slot.def.onHit(enemy, Math.min(ENCHANT_LEVEL_CAP, enc.level + lvlBonus), ctx);
            // Twin Enchant: re-fire this or a DIFFERENT enchantment. ctx is a
            // reused singleton, so the repeat MUST re-assign ctx.element or a
            // distinct repeat inherits the previous element and mis-colours (and
            // mis-types) its damage.
            if (repeatChance > 0 && enemy.isAlive() && Math.random() < repeatChance) {
                const rep = distinct && enchantments.length > 1
                    ? enchantments[(i + 1) % enchantments.length]
                    : enc;
                if (rep.slot.def.onHit) {
                    ctx.element = rep.slot.def.element;
                    rep.slot.def.onHit(enemy, Math.min(ENCHANT_LEVEL_CAP, rep.level + lvlBonus), ctx);
                }
            }
        }
    }

    /** Small fading puff behind an in-flight projectile. Meshes come from a
     *  pool (was: a fresh sphere + observer every 0.06s per arrow); the fade is
     *  driven by the shared flight observer. Each pooled puff owns ONE mutable
     *  unlit material (pool-capped, so bounded) that is recolored per spawn —
     *  never a shared cached material, since the fade mutates opacity per frame. */
    private spawnFlightStreak(position: Vector3, color: Color): void {
        const scene = this.scene;
        let puff = this.streakPool.pop();
        if (!puff) {
            puff = createSphere('basicAttackStreak', { diameter: 0.14, segments: 3 }, scene);
            puff.material = new MeshBasicMaterial({ transparent: true, depthWrite: false });
            puff.userData.ownedMaterial = true; // disposeMesh frees it with the puff
        }
        puff.visible = true;
        puff.scale.setScalar(1);
        const mat = puff.material as MeshBasicMaterial;
        mat.color.copy(color);
        mat.opacity = STREAK_BASE_ALPHA;
        puff.position.copy(position);
        this.liveStreaks.push({ mesh: puff, elapsed: 0 });
    }

    /** Return a faded puff to the pool (or dispose past the cap). */
    private releaseStreak(mesh: Mesh): void {
        if (this.streakPool.length < STREAK_POOL_MAX) {
            mesh.visible = false;
            this.streakPool.push(mesh);
        } else {
            disposeMesh(mesh); // ownedMaterial flag frees its material too
        }
    }

    /** Tear down the shared flight observer, live projectiles/waves, and the
     *  streak pool. Called from HeroController.dispose() on run exit. */
    public dispose(): void {
        if (this.flightToken) {
            this.scene.onBeforeRender.remove(this.flightToken);
            this.flightToken = null;
        }
        for (const f of this.liveProjectiles) releaseProjectile(f.poolKey, f.proj);
        this.liveProjectiles.length = 0;
        for (const w of this.liveWaves) { disposeMesh(w.crest); disposeMesh(w.trail); }
        this.liveWaves.length = 0;
        for (const s of this.liveStreaks) disposeMesh(s.mesh);
        this.liveStreaks.length = 0;
        for (const m of this.streakPool) disposeMesh(m);
        this.streakPool.length = 0;
    }

    private getHeroPosition(): Vector3 {
        return (this.hero as any).position as Vector3;
    }
}
