import { Vector3 } from 'three';
import { Game } from '../../engine/Game';
import { TankEnemy } from './TankEnemy';
import { emitGroundFx, spawnGroundShockwave, spawnGroundTelegraph } from './EnemyGroundFx';
import { applyBodyCoil, easeInCoil, leapHeightAt, resolveLeapFlight, type LeapSpec } from './leapMotion';
import { isMeshDisposed } from '../../engine/three/primitives';

// ── Quake stomp (replaces the golem's boulder on the turtle) ────────────────
/** Ground-FX kind, which doubles as the material-cache key and the wire tag. */
const QUAKE_KEY = 'quake';
/** Radius of the shockwave. Generous, because the point is displacement, not
 *  damage: it should be hard to simply stand outside. */
const QUAKE_RADIUS = 6.0;
/** Wind-up. The turtle rears up, the ground marks, and only then does it land —
 *  long enough that a hero who reacts gets clear, short enough to punish a hero
 *  standing still whittling it down. */
const QUAKE_WINDUP_S = 0.75;
const QUAKE_DAMAGE = 22;
/** Shove speed in units/sec. The hero's base move speed is 7, so this overpowers
 *  walking back in for its duration without teleporting anyone. */
const QUAKE_KNOCKBACK_SPEED = 20;
const QUAKE_KNOCKBACK_S = 0.42;

// ── Shell slam ──────────────────────────────────────────────────────────────
// A 1.5 u/s wall can be ignored, so every SLAM_INTERVAL it coils and hurls
// itself at the hero, landing shell-first. This is BOTH the turtle's approach
// and its heaviest attack: the landing quake covers twice the ground its
// standing stomp does, so the answer is to be somewhere else when it lands
// rather than to walk out afterwards.
const SLAM_INTERVAL = 10.0;
/** Gather before the jump — a heavier, slower coil than the boss's 0.38s. */
const SLAM_CHARGE_S = 0.5;
const SLAM_COIL = 0.3;
/** Twice the standing stomp's radius. The leap is what earns the extra reach:
 *  it is committed, arced and telegraphed on the ground the whole way down. */
const SLAM_QUAKE_RADIUS = QUAKE_RADIUS * 2;

const TURTLE_SLAM: LeapSpec = {
    maxDistance: 13.0,
    topSpeed: 20.0,
    minAirTime: 0.35,
    /** Lands ON the hero rather than in front — the shell is the weapon, and the
     *  quake is centred where it comes down. */
    stopShort: 0,
    arcHeight: 4.5,
    arcMinFraction: 0.5,
};

/** Reused impact position handed to takeDamage (read for direction only). */
const _quakeCenter = new Vector3();

/**
 * Wave-10+ replacement for the lava-golem tank (TankEnemy). A slow, enormous
 * wall that controls ground rather than chasing: instead of the golem's boulder
 * it stomps, and the quake throws the hero clear of it.
 *
 * Reuses TankEnemy's mesh/GLB/animation code; EnemyManager stages the
 * dragon-turtle GLB on TankEnemy.pendingAsset before constructing this class.
 */
export class DragonTurtle extends TankEnemy {
    // Smaller than the base TankEnemy/lava-golem (1.6) — a tough wall, not a giant.
    protected glbScale: number = 1.2;

    /** Counts down through the wind-up once a stomp is committed; 0 = not
     *  stomping. Separate from `specialTimer` (the cooldown) so the quake is a
     *  two-phase move: commit, telegraph, land. */
    private quakeWindup: number = 0;
    private quakeTelegraph: { cancel(): void } | null = null;

    /** Counts up to SLAM_INTERVAL between slams. */
    private slamTimer: number = 0;
    /** 'ready' → 'charge' (coiling, rooted) → 'air' (committed, arcing). */
    private slamPhase: 'ready' | 'charge' | 'air' = 'ready';
    private slamStateTimer: number = 0;
    private slamDirX: number = 0;
    private slamDirZ: number = 0;
    private slamRemaining: number = 0;
    private slamSpeed: number = 0;
    private slamAirTime: number = TURTLE_SLAM.minAirTime;
    private slamArcHeight: number = TURTLE_SLAM.arcHeight;
    /** Landing zone, marked on the ground for the whole descent. */
    private slamTelegraph: { cancel(): void } | null = null;

    constructor(game: Game, position: Vector3, path: Vector3[]) {
        super(game, position, path);

        // Red tier override (TankEnemy base: 150 HP). speed / damage / cooldown unchanged.
        // Hard but reasonable: ~4.7× the base tank rather than 10×.
        this.health = 700;
        this.maxHealth = 700;

        // Quakes more often than the golem throws — it is the turtle's only way
        // to affect a hero it can never catch.
        this.specialCooldown = 6.0;

        if (new.target === DragonTurtle) this._initEnemyVisuals();
    }

    /** Rooted through both wind-ups, and through the slam's flight (it travels on
     *  its own committed arc, not toward the hero). The stomp's telegraph is drawn
     *  where the turtle stands when it commits and the quake detonates where it
     *  stands when it lands — if it kept walking, the ring and the blast would be
     *  in two different places and the marker would be a lie. */
    protected isSpecialRooting(): boolean {
        return this.quakeWindup > 0 || this.slamPhase !== 'ready';
    }

    /**
     * Stomp instead of throwing. The quake is centred on the TURTLE, not on the
     * hero, so unlike the golem's boulder there is nowhere to walk to except
     * away — which is the point: it buys the turtle space rather than damage.
     */
    protected performSpecialAttack(deltaTime: number): void {
        this.tickSlam(deltaTime);

        if (this.isFrozen || this.isStunned) return;

        // Wind-up already committed: run it down and land the quake wherever the
        // turtle has got to by then.
        if (this.quakeWindup > 0) {
            this.quakeWindup -= deltaTime;
            if (this.quakeWindup <= 0) this.landQuake();
            return;
        }

        const target = this.resolveSeekTarget();
        if (!target) return;

        this.specialTimer += deltaTime;
        if (this.specialTimer < this.specialCooldown) return;
        // Never interrupt a slam with a stomp — the slam already ends in a bigger
        // quake, and committing one mid-flight would root the turtle in mid-air.
        // The cooldown stays ready and the stomp lands once it is back on its feet.
        if (this.slamPhase !== 'ready') return;

        // Only stomp with someone to throw. The radius is the reach; a quake into
        // an empty arena would just burn the cooldown.
        const heroPos = target.getPosition();
        const dx = heroPos.x - this.position.x;
        const dz = heroPos.z - this.position.z;
        if (dx * dx + dz * dz > QUAKE_RADIUS * QUAKE_RADIUS) return;

        this.specialTimer = 0;
        this.quakeWindup = QUAKE_WINDUP_S;
        this.glbAttackHoldTimer = QUAKE_WINDUP_S;
        this.quakeTelegraph = spawnGroundTelegraph(
            this.scene, this.position.x, this.position.z,
            QUAKE_RADIUS, QUAKE_WINDUP_S, QUAKE_KEY,
        );
        // Co-op: the guest never ticks enemy AI, so without this the turtle would
        // rear up over undisturbed ground on its screen.
        emitGroundFx('enemyTelegraph', this.position.x, this.position.z,
            QUAKE_RADIUS, QUAKE_WINDUP_S, QUAKE_KEY);
    }

    /**
     * Drive the slam: count to SLAM_INTERVAL, coil, then fly.
     *
     * Runs on its own timer alongside the stomp's, but the two can never overlap
     * — `performSpecialAttack` refuses to start a stomp unless this is 'ready',
     * and this refuses to start unless no stomp is winding up.
     */
    private tickSlam(deltaTime: number): void {
        switch (this.slamPhase) {
            case 'charge':
                this.slamStateTimer -= deltaTime;
                // Coil deepens across the charge — the anticipation that makes the
                // launch read as a launch rather than the turtle suddenly sliding.
                this.poseSlamBody(-easeInCoil(1 - Math.max(0, this.slamStateTimer) / SLAM_CHARGE_S));
                if (this.slamStateTimer <= 0) this.launchSlam();
                return;
            case 'air':
                this.advanceSlam(deltaTime);
                return;
        }

        this.slamTimer += deltaTime;
        if (this.slamTimer < SLAM_INTERVAL) return;
        if (this.quakeWindup > 0 || this.isFrozen || this.isStunned) return;
        const target = this.resolveSeekTarget();
        if (!target) return;

        this.slamTimer = 0;
        this.slamPhase = 'charge';
        this.slamStateTimer = SLAM_CHARGE_S;
        this.glbAttackHoldTimer = SLAM_CHARGE_S;
    }

    /**
     * Commit and leave the ground. Direction AND distance are both fixed here, at
     * the end of the coil — so a hero who moves now is landed BESIDE rather than
     * tracked, and the ground marker below is the truth for the whole descent.
     */
    private launchSlam(): void {
        this.slamPhase = 'air';
        this.poseSlamBody(0);

        const target = this.resolveSeekTarget();
        const heroPos = target?.getPosition();
        const gap = heroPos
            ? Math.hypot(heroPos.x - this.position.x, heroPos.z - this.position.z)
            : 0;
        if (heroPos && gap > 0.001) {
            this.slamDirX = (heroPos.x - this.position.x) / gap;
            this.slamDirZ = (heroPos.z - this.position.z) / gap;
            this.faceHeading(this.slamDirX, this.slamDirZ);
        }

        const flight = resolveLeapFlight(gap, TURTLE_SLAM);
        this.slamRemaining = flight.distance;
        this.slamSpeed = flight.speed;
        this.slamAirTime = flight.airTime;
        this.slamArcHeight = flight.arcHeight;
        this.slamStateTimer = flight.airTime;

        // Mark the landing zone for the whole descent. A quake this wide would be
        // unreadable otherwise — the arc says a slam is coming, this says where.
        const landX = this.position.x + this.slamDirX * flight.distance;
        const landZ = this.position.z + this.slamDirZ * flight.distance;
        this.slamTelegraph = spawnGroundTelegraph(
            this.scene, landX, landZ, SLAM_QUAKE_RADIUS, flight.airTime, QUAKE_KEY,
        );
        emitGroundFx('enemyTelegraph', landX, landZ, SLAM_QUAKE_RADIUS, flight.airTime, QUAKE_KEY);
    }

    /** Fly the committed arc; land into a quake at twice the standing radius. */
    private advanceSlam(deltaTime: number): void {
        this.slamStateTimer -= deltaTime;
        const step = Math.min(this.slamRemaining, this.slamSpeed * deltaTime);
        this.slamRemaining -= step;
        this.position.x += this.slamDirX * step;
        this.position.z += this.slamDirZ * step;

        // Progress from the TIMER, not distance, so a slam onto an adjacent hero
        // still arcs instead of skipping straight to the landing.
        const t = this.slamAirTime > 0
            ? 1 - Math.max(0, this.slamStateTimer) / this.slamAirTime
            : 1;
        this.specialLiftHeight = leapHeightAt(t, this.slamArcHeight);
        if (this.mesh && !isMeshDisposed(this.mesh)) this.mesh.position.copy(this.position);

        if (this.slamStateTimer > 0 || this.slamRemaining > 0) return;

        this.slamPhase = 'ready';
        this.specialLiftHeight = 0;
        this.slamTelegraph?.cancel();
        this.slamTelegraph = null;
        this.detonateQuake(SLAM_QUAKE_RADIUS);
    }

    /** Coil/stretch the shell. Poses the GLB root, never the mesh — the mesh is
     *  what elite treatment scales, and writing there would fight it. */
    private poseSlamBody(amount: number): void {
        const root = this.glbInstance?.root;
        if (!root) return;
        applyBodyCoil(root, this.glbBaseScale, this.glbBaseRootY, amount, SLAM_COIL);
    }

    /** Detonate: shockwave, damage, and a shove radially outward from the shell. */
    private landQuake(): void {
        this.quakeWindup = 0;
        this.quakeTelegraph?.cancel();
        this.quakeTelegraph = null;
        this.detonateQuake(QUAKE_RADIUS);
    }

    /** The quake itself, at whichever radius fired it: the standing stomp's, or
     *  double that when it comes off the end of a slam. */
    private detonateQuake(radius: number): void {
        const cx = this.position.x, cz = this.position.z;
        spawnGroundShockwave(this.scene, cx, cz, radius, QUAKE_KEY);
        emitGroundFx('enemyImpact', cx, cz, radius, 0, QUAKE_KEY);

        const r2 = radius * radius;
        const center = _quakeCenter.set(cx, 0, cz);
        this.forEachLiveHero(hero => {
            const p = hero.getPosition();
            const dx = p.x - cx, dz = p.z - cz;
            const d2 = dx * dx + dz * dz;
            if (d2 > r2) return;
            hero.takeDamage?.(QUAKE_DAMAGE, center);
            // A hero standing exactly on the turtle has no direction to be thrown
            // in; give them the way the turtle is facing rather than NaN.
            const len = Math.sqrt(d2);
            const yaw = this.mesh?.rotation.y ?? 0;
            const dirX = len > 0.001 ? dx / len : Math.sin(yaw);
            const dirZ = len > 0.001 ? dz / len : Math.cos(yaw);
            // Optional channel: the co-op ghost provider carries position and
            // liveness only, so a teammate is damaged but not thrown.
            hero.applyKnockback?.(dirX, dirZ, QUAKE_KNOCKBACK_SPEED, QUAKE_KNOCKBACK_S);
        });
    }

    /**
     * Killing the turtle mid-wind-up cancels the quake — that is the reward for
     * bursting it through the telegraph. Neither `landQuake` nor `advanceSlam`
     * can run afterwards (a dead enemy's update() returns immediately), so this
     * clears what they would have cleaned up: the ground markers, the coil, and
     * the airborne lift that would otherwise leave the corpse hanging in the air.
     *
     * All three release paths override it: die() is the in-wave kill,
     * disposeCorpse() releases the corpse, dispose() is run teardown — and none
     * of them calls the others (see the disposal-leak notes in CLAUDE.md).
     */
    protected die(): void {
        this.cancelPendingSpecials();
        super.die();
    }

    public dispose(): void {
        this.cancelPendingSpecials();
        super.dispose();
    }

    public disposeCorpse(): void {
        this.cancelPendingSpecials();
        super.disposeCorpse();
    }

    private cancelPendingSpecials(): void {
        this.quakeWindup = 0;
        this.quakeTelegraph?.cancel();
        this.quakeTelegraph = null;

        this.slamPhase = 'ready';
        this.slamRemaining = 0;
        this.specialLiftHeight = 0;
        this.slamTelegraph?.cancel();
        this.slamTelegraph = null;
        this.poseSlamBody(0);
    }
}
