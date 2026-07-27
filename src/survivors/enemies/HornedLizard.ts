import { Vector3 } from 'three';
import { Game } from '../../engine/Game';
import { TankEnemy } from './TankEnemy';
import { emitLaneFx, spawnLaneTelegraph, LANE_FX } from './EnemyGroundFx';
import { isMeshDisposed } from '../../engine/three/primitives';

// ── Gore charge (replaces the golem's boulder on the lizard) ────────────────
const CHARGE_KEY = 'charge';
/** How far the charge carries and how fast, i.e. ~0.73s of travel. */
const CHARGE_DISTANCE = 11.0;
const CHARGE_SPEED = 15.0;
/** Distance from the lizard's centre-line that counts as being gored. */
const CHARGE_HIT_RADIUS = 1.9;
const CHARGE_DAMAGE = 42;
/** Launched by the horns. Faster than the turtle's quake shove and shorter — a
 *  gore throws you, it does not push you around. */
const CHARGE_KNOCKBACK_SPEED = 24;
const CHARGE_KNOCKBACK_S = 0.35;
/** Rooted after the charge ends. This is the counterplay: bait it, sidestep the
 *  lane, then punish a 900-HP wall that cannot answer for most of a second. */
const CHARGE_RECOVER_S = 0.9;
const CHARGE_COOLDOWN = 7.0;
/** Closer than this the lizard just uses its slam — a charge that starts on top
 *  of the hero is an undodgeable shove, not a telegraphed threat. */
const CHARGE_MIN_RANGE = 4.0;
/** DERIVED, not a second hand-tuned number: past this the charge would end with
 *  the hero still outside the gore radius, i.e. the lizard would commit a run it
 *  cannot finish. Same rule as the fenrir's pounce reach (see meleeLunge.ts). */
const CHARGE_MAX_RANGE = CHARGE_DISTANCE + CHARGE_HIT_RADIUS;

type ChargeState = 'ready' | 'windup' | 'charging' | 'recover';

/** Reused impact position handed to takeDamage (read for direction only). */
const _goreAt = new Vector3();

/**
 * Wave-15+ replacement for the tank (TankEnemy). The heaviest non-boss hitter:
 * very high HP and contact damage, slow.
 *
 * Where the golem answers a kiting hero by reaching across the arena and the
 * turtle by shoving them off it, the lizard answers by CLOSING — it drops its
 * head and gores down a telegraphed lane. That is the one thing its 1.5 u/s walk
 * could never do, and it keeps the three heavy variants mechanically distinct.
 *
 * Reuses TankEnemy's mesh/GLB/animation; EnemyManager stages the horned-lizard
 * GLB on TankEnemy.pendingAsset.
 */
export class HornedLizard extends TankEnemy {
    protected glbScale: number = 1.4;

    private chargeState: ChargeState = 'ready';
    private chargeTimer: number = 0;
    /** Locked at commit time and never re-aimed, so the charge is beaten by
     *  stepping out of the lane rather than by out-running it. */
    private chargeDirX: number = 0;
    private chargeDirZ: number = 0;
    private chargeRemaining: number = 0;
    private chargeHasHit: boolean = false;
    private chargeTelegraph: { cancel(): void } | null = null;

    constructor(game: Game, position: Vector3, path: Vector3[]) {
        super(game, position, path);

        // Heavy hitter (TankEnemy base: 150 HP / 20 DPS). speed / cooldown unchanged.
        this.health = 900;
        this.maxHealth = 900;
        this.contactDamagePerSecond = 36;

        this.specialCooldown = CHARGE_COOLDOWN;

        if (new.target === HornedLizard) this._initEnemyVisuals();
    }

    /** Rooted while winding up (the lane is drawn from where it stands) and while
     *  charging (it travels along the locked lane, not toward the hero). */
    protected isSpecialRooting(): boolean {
        return this.chargeState !== 'ready';
    }

    /** No slam mid-charge — the horns are busy, and letting the melee FSM fire
     *  here would land a second hit out of a single committed move. */
    protected canMeleeAttack(): boolean {
        return this.chargeState === 'ready';
    }

    protected performSpecialAttack(deltaTime: number): void {
        if (this.isFrozen || this.isStunned) {
            // Hard CC cancels a committed charge outright rather than pausing it;
            // a lane marker left hanging over a frozen lizard is a lie.
            if (this.chargeState !== 'ready') this.abortCharge();
            return;
        }

        switch (this.chargeState) {
            case 'windup':
                this.chargeTimer -= deltaTime;
                if (this.chargeTimer <= 0) this.beginCharge();
                return;
            case 'charging':
                this.advanceCharge(deltaTime);
                return;
            case 'recover':
                this.chargeTimer -= deltaTime;
                if (this.chargeTimer <= 0) this.chargeState = 'ready';
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
        if (distSq < CHARGE_MIN_RANGE * CHARGE_MIN_RANGE) return;
        if (distSq > CHARGE_MAX_RANGE * CHARGE_MAX_RANGE) return;

        this.specialTimer = 0;
        this.commitCharge(dx, dz, Math.sqrt(distSq));
    }

    /** Lock the lane and draw it. Nothing moves yet — the wind-up is the warning. */
    private commitCharge(dx: number, dz: number, dist: number): void {
        this.chargeDirX = dx / dist;
        this.chargeDirZ = dz / dist;
        this.chargeState = 'windup';
        this.chargeTimer = LANE_FX[CHARGE_KEY].windupS;
        this.chargeHasHit = false;
        this.glbAttackHoldTimer = LANE_FX[CHARGE_KEY].windupS;
        // Face the lane now, so the model is aimed where the marker points for the
        // whole wind-up instead of snapping to it when the charge starts.
        this.faceHeading(this.chargeDirX, this.chargeDirZ);

        const toX = this.position.x + this.chargeDirX * CHARGE_DISTANCE;
        const toZ = this.position.z + this.chargeDirZ * CHARGE_DISTANCE;
        this.chargeTelegraph = spawnLaneTelegraph(
            this.scene, this.position.x, this.position.z, toX, toZ, CHARGE_KEY,
        );
        // Co-op: the guest ticks no enemy AI, so without this it would see a
        // lizard sprint out of nowhere with no marker to read.
        emitLaneFx(this.position.x, this.position.z, toX, toZ, CHARGE_KEY);
    }

    private beginCharge(): void {
        this.chargeTelegraph?.cancel();
        this.chargeTelegraph = null;
        this.chargeState = 'charging';
        this.chargeRemaining = CHARGE_DISTANCE;
        this.glbAttackHoldTimer = CHARGE_DISTANCE / CHARGE_SPEED;
    }

    /**
     * Travel down the locked lane, goring the first hero it runs through. One hit
     * per charge — it bulldozes on rather than stopping, which is what makes the
     * recovery (and not the impact) the punish window.
     */
    private advanceCharge(deltaTime: number): void {
        const step = Math.min(this.chargeRemaining, CHARGE_SPEED * deltaTime);
        this.chargeRemaining -= step;
        this.position.x += this.chargeDirX * step;
        this.position.z += this.chargeDirZ * step;
        // super.update() already copied position → mesh this frame, so re-sync or
        // the model trails the hitbox by a frame for the whole charge.
        if (this.mesh && !isMeshDisposed(this.mesh)) this.mesh.position.copy(this.position);

        if (!this.chargeHasHit) {
            const r2 = CHARGE_HIT_RADIUS * CHARGE_HIT_RADIUS;
            const at = _goreAt.set(this.position.x, 0, this.position.z);
            this.forEachLiveHero(hero => {
                if (this.chargeHasHit) return;
                const p = hero.getPosition();
                const dx = p.x - this.position.x, dz = p.z - this.position.z;
                if (dx * dx + dz * dz > r2) return;
                this.chargeHasHit = true;
                hero.takeDamage?.(CHARGE_DAMAGE, at);
                // Thrown along the charge, not away from the lizard — being gored
                // by something moving at 15 u/s carries you with it.
                hero.applyKnockback?.(
                    this.chargeDirX, this.chargeDirZ, CHARGE_KNOCKBACK_SPEED, CHARGE_KNOCKBACK_S,
                );
            });
        }

        if (this.chargeRemaining <= 0) {
            this.chargeState = 'recover';
            this.chargeTimer = CHARGE_RECOVER_S;
        }
    }

    /** Drop a committed charge and its marker. Shared by the CC cancel and both
     *  release paths — a lane telegraph must never outlive the lizard that drew
     *  it (see the aux-visual ownership rule in CLAUDE.md). */
    private abortCharge(): void {
        this.chargeState = 'ready';
        this.chargeTimer = 0;
        this.chargeRemaining = 0;
        this.chargeTelegraph?.cancel();
        this.chargeTelegraph = null;
    }

    protected die(): void {
        this.abortCharge();
        super.die();
    }

    public dispose(): void {
        this.abortCharge();
        super.dispose();
    }

    public disposeCorpse(): void {
        this.abortCharge();
        super.disposeCorpse();
    }
}
