import { Vector3 } from 'three';
import { Game } from '../../engine/Game';
import { TankEnemy } from './TankEnemy';
import { emitLaneFx, spawnLaneTelegraph, LANE_FX } from './EnemyGroundFx';
import { isInLane } from './laneHit';

// ── Line smash (replaces the lizard's gore charge on the titan) ─────────────
const SMASH_KEY = 'smash';
/** How far down the lane the shockwave reaches. */
const SMASH_LENGTH = 12.0;
/** Half-width of the lane that gets hit. Derived from the marker rather than
 *  tuned separately — the painted lane IS the hitbox, and two numbers that are
 *  meant to agree will not stay agreeing. */
const SMASH_HALF_WIDTH = LANE_FX[SMASH_KEY].width / 2;
/** The whole point of the move: getting caught is a disaster, not a chip. About
 *  three times a gore charge, on an enemy that never leaves its lane. */
const SMASH_DAMAGE = 130;
/** Thrown ALONG the lane. It cannot save a hero who was already hit, but it
 *  carries them clear of the titan, which is what stops a smash landing straight
 *  into contact damage while they are still reeling. */
const SMASH_KNOCKBACK_SPEED = 20;
const SMASH_KNOCKBACK_S = 0.3;
/** Rooted after the smash — the punish window, same shape as the lizard's. */
const SMASH_RECOVER_S = 1.0;
const SMASH_COOLDOWN = 8.0;
/** Closer than this the titan just slams: a lane painted under the hero's feet
 *  is not a telegraph, it is a hit they were never able to read. */
const SMASH_MIN_RANGE = 3.0;
/** DERIVED: past the lane's reach the smash could not connect even if the hero
 *  stood still, so committing to one would be a free second of safety. */
const SMASH_MAX_RANGE = SMASH_LENGTH;

type SmashState = 'ready' | 'windup' | 'recover';

/** Reused impact position handed to takeDamage (read for direction only). */
const _smashAt = new Vector3();

/**
 * Wave-25+ replacement for the horned lizard (TankEnemy). The heaviest thing in
 * the game that is not a boss.
 *
 * The three heavy variants each answer a kiting hero differently, and the titan
 * is the one that does NOT move to do it: the golem lobs a boulder across the
 * arena, the turtle shoves the hero off it, the lizard closes by goring down a
 * lane it travels — and the titan stands still and smashes a line flat.
 *
 * That distinction is the design: because the titan never leaves its spot, the
 * lane is pure denial. Dodging it costs nothing but stepping aside, so the
 * damage can be enormous, and a player who eats one has genuinely misread a
 * near-second-long telegraph rather than been run down.
 *
 * Reuses TankEnemy's mesh/GLB/animation; EnemyManager stages the fortress-titan
 * GLB on TankEnemy.pendingAsset.
 */
export class FortressTitan extends TankEnemy {
    /** The biggest body that is not a boss, and measured against the field rather
     *  than guessed: at the golem's 1.6 this rig renders about hero-sized, which
     *  made the wave-25 heavy visually smaller than the caster standing next to
     *  it. Purely cosmetic — contact range and every melee reach are explicit
     *  numbers, none of which read the model. */
    protected glbScale: number = 3.2;

    private smashState: SmashState = 'ready';
    private smashTimer: number = 0;
    /** Locked when the lane is painted and never re-aimed — the smash is beaten
     *  by leaving the lane, not by out-running it. */
    private smashDirX: number = 0;
    private smashDirZ: number = 0;
    private smashTelegraph: { cancel(): void } | null = null;

    constructor(game: Game, position: Vector3, path: Vector3[]) {
        super(game, position, path);

        // Wave-25 wall (the lizard it replaces is 900 HP / 36 DPS).
        this.health = 1500;
        this.maxHealth = 1500;
        this.contactDamagePerSecond = 44;
        // Slower than the lizard: it holds ground rather than chasing, and its
        // threat is the lane, not the body.
        this.speed = 1.3;
        this.originalSpeed = 1.3;

        this.specialCooldown = SMASH_COOLDOWN;

        if (new.target === FortressTitan) this._initEnemyVisuals();
    }

    /** Rooted through the whole move. Unlike the lizard's charge there is no
     *  travelling phase — the titan plants itself, winds up and swings. */
    protected isSpecialRooting(): boolean {
        return this.smashState !== 'ready';
    }

    /** No slam mid-smash — letting the melee FSM fire here would land a second
     *  hit out of a single committed move. */
    protected canMeleeAttack(): boolean {
        return this.smashState === 'ready';
    }

    protected performSpecialAttack(deltaTime: number): void {
        if (this.isFrozen || this.isStunned) {
            // Hard CC cancels a committed smash outright rather than pausing it;
            // a lane marker left hanging over a frozen titan is a lie.
            if (this.smashState !== 'ready') this.abortSmash();
            return;
        }

        switch (this.smashState) {
            case 'windup':
                this.smashTimer -= deltaTime;
                if (this.smashTimer <= 0) this.releaseSmash();
                return;
            case 'recover':
                this.smashTimer -= deltaTime;
                if (this.smashTimer <= 0) this.smashState = 'ready';
                return;
        }

        const target = this.resolveSeekTarget();
        if (!target) return;

        this.specialTimer += deltaTime;
        if (this.specialTimer < this.specialCooldown) return;

        const heroPos = target.getPosition();
        const dx = heroPos.x - this.position.x;
        const dz = heroPos.z - this.position.z;
        const distSq = dx * dx + dz * dz;
        if (distSq < SMASH_MIN_RANGE * SMASH_MIN_RANGE) return;
        if (distSq > SMASH_MAX_RANGE * SMASH_MAX_RANGE) return;

        this.specialTimer = 0;
        this.commitSmash(dx, dz, Math.sqrt(distSq));
    }

    /** Lock the lane and paint it. Nothing has happened yet — the wind-up IS the
     *  warning, and it is the longest one any enemy gives. */
    private commitSmash(dx: number, dz: number, dist: number): void {
        this.smashDirX = dx / dist;
        this.smashDirZ = dz / dist;
        this.smashState = 'windup';
        this.smashTimer = LANE_FX[SMASH_KEY].windupS;
        this.glbAttackHoldTimer = LANE_FX[SMASH_KEY].windupS;
        // Face the lane now, so the model is aimed where the marker points for the
        // whole wind-up instead of snapping to it as the blow lands.
        this.faceHeading(this.smashDirX, this.smashDirZ);

        const toX = this.position.x + this.smashDirX * SMASH_LENGTH;
        const toZ = this.position.z + this.smashDirZ * SMASH_LENGTH;
        this.smashTelegraph = spawnLaneTelegraph(
            this.scene, this.position.x, this.position.z, toX, toZ, SMASH_KEY,
        );
        // Co-op: the guest ticks no enemy AI, so without this it would take 130
        // damage from a titan that appeared to be standing still.
        emitLaneFx(this.position.x, this.position.z, toX, toZ, SMASH_KEY);
    }

    /**
     * The blow lands. Everything inside the painted lane is hit at once — this is
     * a line, not a travelling body, so there is no per-frame sweep and no
     * once-per-attack latch to keep: the move happens on exactly one frame.
     *
     * The test is distance ALONG the lane (must be within its length, and in
     * front) plus distance ACROSS it (within the half-width), which is the
     * rectangle the marker drew rather than a circle approximating it.
     */
    private releaseSmash(): void {
        this.smashTelegraph?.cancel();
        this.smashTelegraph = null;
        this.smashState = 'recover';
        this.smashTimer = SMASH_RECOVER_S;
        this.glbAttackHoldTimer = SMASH_RECOVER_S;

        const at = _smashAt.set(this.position.x, 0, this.position.z);
        this.forEachLiveHero(hero => {
            const p = hero.getPosition();
            const inLane = isInLane(
                p.x - this.position.x, p.z - this.position.z,
                this.smashDirX, this.smashDirZ,
                SMASH_LENGTH, SMASH_HALF_WIDTH,
            );
            if (!inLane) return;

            hero.takeDamage?.(SMASH_DAMAGE, at);
            hero.applyKnockback?.(
                this.smashDirX, this.smashDirZ, SMASH_KNOCKBACK_SPEED, SMASH_KNOCKBACK_S,
            );
        });
    }

    /** Drop a committed smash and its marker. Shared by the CC cancel and every
     *  release path — a lane telegraph must never outlive the titan that drew it
     *  (see the aux-visual ownership rule in CLAUDE.md). */
    private abortSmash(): void {
        this.smashState = 'ready';
        this.smashTimer = 0;
        this.smashTelegraph?.cancel();
        this.smashTelegraph = null;
    }

    protected die(): void {
        this.abortSmash();
        super.die();
    }

    public dispose(): void {
        this.abortSmash();
        super.dispose();
    }

    public disposeCorpse(): void {
        this.abortSmash();
        super.disposeCorpse();
    }
}
