import { Vector3 } from 'three';
import { Game } from '../../engine/Game';
import { TankEnemy } from './TankEnemy';
import { emitGroundFx, spawnGroundShockwave, spawnGroundTelegraph } from './EnemyGroundFx';

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

// ── Shell sprint ────────────────────────────────────────────────────────────
// A 1.5 u/s wall can be ignored, so every SPRINT_INTERVAL it tucks in and bolts:
// ×10 speed for SPRINT_DURATION, which at 15 u/s outruns even a levelled hero.
// It is the turtle's approach, not its attack — the damage still comes from the
// quake it can now actually reach you with.
const SPRINT_INTERVAL = 10.0;
const SPRINT_DURATION = 2.0;
const SPRINT_SPEED_MULT = 10;

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

    /** Counts up to SPRINT_INTERVAL, then down through SPRINT_DURATION. */
    private sprintTimer: number = 0;
    private sprinting: boolean = false;

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

    /** Rooted through the wind-up: the telegraph is drawn where the turtle stands
     *  when it commits, and the quake detonates at wherever it stands when it
     *  lands — so if it kept walking, the ring and the blast would be in two
     *  different places and the marker would be a lie. */
    protected isSpecialRooting(): boolean { return this.quakeWindup > 0; }

    /**
     * Stomp instead of throwing. The quake is centred on the TURTLE, not on the
     * hero, so unlike the golem's boulder there is nowhere to walk to except
     * away — which is the point: it buys the turtle space rather than damage.
     */
    protected performSpecialAttack(deltaTime: number): void {
        this.tickSprint(deltaTime);

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
        // Never interrupt a sprint with a quake — the quake roots, so committing
        // one mid-sprint spends the charge standing still. The cooldown stays
        // ready and the stomp lands the moment the turtle skids to a halt.
        if (this.sprinting) return;

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
     * Drive the sprint window.
     *
     * The multiplier is applied to `speed` AND `originalSpeed` and later DIVIDED
     * back out, rather than saving and restoring a snapshot. That is what makes
     * it compose with the status system: a slow landing mid-sprint recomputes
     * `speed = originalSpeed × (1 − strength)` off the boosted base, and dividing
     * both by the same factor at the end leaves exactly the slowed speed the
     * turtle would have had without the sprint. Snapshot-and-restore would
     * silently cancel that slow.
     *
     * Held off while a quake is winding up: the wind-up roots the turtle, so a
     * sprint spent there would be a sprint spent standing still.
     */
    private tickSprint(deltaTime: number): void {
        if (this.sprinting) {
            this.sprintTimer -= deltaTime;
            if (this.sprintTimer <= 0) this.endSprint();
            return;
        }
        this.sprintTimer += deltaTime;
        if (this.sprintTimer < SPRINT_INTERVAL) return;
        if (this.quakeWindup > 0 || this.isFrozen || this.isStunned) return;

        this.sprinting = true;
        this.sprintTimer = SPRINT_DURATION;
        this.speed *= SPRINT_SPEED_MULT;
        this.originalSpeed *= SPRINT_SPEED_MULT;
    }

    private endSprint(): void {
        if (!this.sprinting) return;
        this.sprinting = false;
        this.sprintTimer = 0;
        this.speed /= SPRINT_SPEED_MULT;
        this.originalSpeed /= SPRINT_SPEED_MULT;
    }

    /** Detonate: shockwave, damage, and a shove radially outward from the shell. */
    private landQuake(): void {
        this.quakeWindup = 0;
        this.quakeTelegraph?.cancel();
        this.quakeTelegraph = null;

        const cx = this.position.x, cz = this.position.z;
        spawnGroundShockwave(this.scene, cx, cz, QUAKE_RADIUS, QUAKE_KEY);
        emitGroundFx('enemyImpact', cx, cz, QUAKE_RADIUS, 0, QUAKE_KEY);

        const r2 = QUAKE_RADIUS * QUAKE_RADIUS;
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
     * bursting it through the telegraph. `landQuake` can no longer run (a dead
     * enemy's update() returns immediately), so this only clears the marker it
     * left on the ground.
     *
     * Both death paths override it: die() is the in-wave kill, dispose() the run
     * teardown, and neither calls the other (see the disposal-leak notes in
     * CLAUDE.md).
     */
    protected die(): void {
        this.cancelQuakeTelegraph();
        super.die();
    }

    public dispose(): void {
        this.cancelQuakeTelegraph();
        super.dispose();
    }

    public disposeCorpse(): void {
        this.cancelQuakeTelegraph();
        super.disposeCorpse();
    }

    private cancelQuakeTelegraph(): void {
        this.quakeWindup = 0;
        this.quakeTelegraph?.cancel();
        this.quakeTelegraph = null;
    }
}
