import { Vector3, MeshBuilder, StandardMaterial, Color3, Mesh } from '@babylonjs/core';
import { Game } from '../../Game';
import { BossEnemy } from './BossEnemy';

/** Lunge/dash state machine. */
type LungeState = 'walking' | 'telegraph' | 'dashing' | 'recover';

/** Per-tier stat multipliers applied on top of BossEnemy base stats. */
const TIER_HP_MULT:    Record<number, number> = { 1: 1.8, 2: 2.6, 3: 3.4, 4: 4.4 };
const TIER_SPEED_MULT: Record<number, number> = { 1: 1.4, 2: 1.5, 3: 1.6, 4: 1.7 };
const TIER_DPS_MULT:   Record<number, number> = { 1: 1.0, 2: 1.1, 3: 1.2, 4: 1.3 };

/** Tier 5+ HP: 4.4 + 0.6 × (tier − 4). Speed and DPS clamp at tier-4 values. */
function tierHpMult(tier: number): number {
    return tier <= 4 ? TIER_HP_MULT[tier] : 4.4 + 0.6 * (tier - 4);
}
function tierSpeedMult(tier: number): number { return TIER_SPEED_MULT[tier] ?? 1.7; }
function tierDpsMult(tier: number): number   { return TIER_DPS_MULT[tier]   ?? 1.3; }

/** Lunge cadence per tier (seconds between lunges). Faster at higher tiers. */
const LUNGE_COOLDOWN_BY_TIER: Record<number, number> = { 1: 4.0, 2: 3.5, 3: 3.0, 4: 2.4 };
function lungeCooldown(tier: number): number {
    return LUNGE_COOLDOWN_BY_TIER[tier] ?? 2.4;
}

/** Tier 2+ leads the hero by predicting their movement. */
function hasSidestepPredict(tier: number): boolean { return tier >= 2; }
/** Tier 3+ enrages below 30% HP. */
function hasEnrage(tier: number): boolean { return tier >= 3; }

const TELEGRAPH_DURATION = 0.6;  // seconds rooted before the dash
const DASH_DURATION      = 0.5;  // seconds of dash motion (≈6 units at 12 u/s)
const DASH_DISTANCE      = 6.0;  // world units travelled per dash
const DASH_SPEED         = 12.0; // world units per second during dash
const RECOVER_DURATION   = 0.4;  // seconds rooted after the dash
const PREDICT_LEAD_TIME  = 0.4;  // seconds of hero velocity to lead by on tier 2+
const ENRAGE_HP_FRACTION = 0.30; // triggers enrage when HP drops below this
const ENRAGE_SPEED_BUMP  = 1.4;  // one-shot speed multiplier on enrage
const ENRAGE_LUNGE_FACTOR= 0.5;  // halves the lunge cooldown on enrage

export class MilestoneBoss extends BossEnemy {
    /** Public so EnemyManager can check it on death without instanceof. */
    public readonly isMilestone: boolean = true;
    /** Public so the item-drop handler can pick the right item for this kill. */
    public readonly waveTier: number;

    private lungeState: LungeState = 'walking';
    private stateTimer: number = 0;
    private lungeTimer: number;
    private dashDirX: number = 0;
    private dashDirZ: number = 0;
    private dashDistanceRemaining: number = 0;
    private enraged: boolean = false;

    // Hero velocity tracking for sidestep predict (tier 2+)
    private lastHeroPos: Vector3 | null = null;
    private heroVelX: number = 0;
    private heroVelZ: number = 0;

    // Telegraph visual — disposed when state leaves 'telegraph'
    private telegraphRing: Mesh | null = null;

    constructor(game: Game, position: Vector3, path: Vector3[], waveTier: number) {
        super(game, position, path);
        this.waveTier = waveTier;
        this.lungeTimer = lungeCooldown(waveTier);

        // Apply tier-scaled stat multipliers on top of the base BossEnemy stats.
        const hpMult    = tierHpMult(waveTier);
        const speedMult = tierSpeedMult(waveTier);
        const dpsMult   = tierDpsMult(waveTier);

        // BossEnemy constructor already set maxHealth=500 and contactDamagePerSecond=30.
        this.maxHealth = Math.floor(this.maxHealth * hpMult);
        this.health    = this.maxHealth;
        this.speed     = this.speed * speedMult;
        this.originalSpeed = this.originalSpeed * speedMult;
        this.contactDamagePerSecond = this.contactDamagePerSecond * dpsMult;

        this.updateHealthBar();
    }

    public update(deltaTime: number): boolean {
        if (!this.alive || !this.mesh) return false;

        this.updateHeroVelocity(deltaTime);
        this.tickLungeStateMachine(deltaTime);
        this.maybeEnrage();

        // While dashing, we override the seek behavior to travel in the locked direction.
        // Otherwise BossEnemy.update handles the normal seek + status + animation.
        if (this.lungeState === 'dashing') {
            this.advanceDash(deltaTime);
            // Skip the parent's seek by clearing seekTarget for this frame — restore after.
            const savedSeek = this.seekTarget;
            this.seekTarget = null;
            const result = super.update(deltaTime);
            this.seekTarget = savedSeek;
            return result;
        }

        if (this.lungeState === 'telegraph' || this.lungeState === 'recover') {
            // Rooted: zero speed for this frame. Parent still ticks animation/status.
            const savedSpeed = this.speed;
            this.speed = 0;
            const result = super.update(deltaTime);
            this.speed = savedSpeed;
            return result;
        }

        return super.update(deltaTime);
    }

    private updateHeroVelocity(deltaTime: number): void {
        if (!this.seekTarget || deltaTime <= 0) {
            this.heroVelX = 0;
            this.heroVelZ = 0;
            return;
        }
        const heroPos = this.seekTarget.getPosition();
        if (this.lastHeroPos) {
            this.heroVelX = (heroPos.x - this.lastHeroPos.x) / deltaTime;
            this.heroVelZ = (heroPos.z - this.lastHeroPos.z) / deltaTime;
        }
        this.lastHeroPos = heroPos.clone();
    }

    private tickLungeStateMachine(deltaTime: number): void {
        switch (this.lungeState) {
            case 'walking':
                this.lungeTimer -= deltaTime;
                if (this.lungeTimer <= 0 && this.seekTarget) {
                    this.enterTelegraph();
                }
                return;

            case 'telegraph':
                this.stateTimer -= deltaTime;
                if (this.stateTimer <= 0) {
                    this.enterDash();
                }
                return;

            case 'dashing':
                this.stateTimer -= deltaTime;
                if (this.stateTimer <= 0 || this.dashDistanceRemaining <= 0) {
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

    private enterTelegraph(): void {
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
        this.lungeState = 'telegraph';
        this.stateTimer = TELEGRAPH_DURATION;

        this.spawnTelegraphRing();
    }

    private enterDash(): void {
        this.disposeTelegraphRing();
        this.lungeState = 'dashing';
        this.stateTimer = DASH_DURATION;
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
        if (this.mesh && !this.mesh.isDisposed()) {
            this.mesh.position.copyFrom(this.position);
            this.mesh.position.y = this.position.y + 1.2;
            this.mesh.rotation.y = -Math.atan2(this.dashDirZ, this.dashDirX) + Math.PI / 2;
        }
    }

    private maybeEnrage(): void {
        if (this.enraged || !hasEnrage(this.waveTier)) return;
        if (this.health / this.maxHealth > ENRAGE_HP_FRACTION) return;

        this.enraged = true;
        this.speed *= ENRAGE_SPEED_BUMP;
        this.originalSpeed *= ENRAGE_SPEED_BUMP;

        if (this.lungeState === 'walking') {
            this.lungeTimer *= ENRAGE_LUNGE_FACTOR;
        }
    }

    /** Draws a red ground rectangle pointing in the locked dash direction during the telegraph phase. */
    private spawnTelegraphRing(): void {
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

    private disposeTelegraphRing(): void {
        if (this.telegraphRing && !this.telegraphRing.isDisposed()) {
            this.telegraphRing.dispose();
        }
        this.telegraphRing = null;
    }

    /** Override to keep the 30% knockback reduction from BossEnemy (same behavior). */
    public applyKnockback(dirX: number, dirZ: number, magnitude: number): void {
        super.applyKnockback(dirX, dirZ, magnitude);
    }

    /** Dispose owned visuals not parented to mesh. */
    public dispose(): void {
        this.disposeTelegraphRing();
        super.dispose();
    }

    protected die(): void {
        this.disposeTelegraphRing();
        super.die();
    }
}
