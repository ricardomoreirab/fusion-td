import { Vector3, MeshBuilder, StandardMaterial, Color3, Mesh, AssetContainer, AnimationGroup, TransformNode, Quaternion } from '@babylonjs/core';
import { Game } from '../../Game';
import { BossEnemy } from './BossEnemy';

/** Lunge/dash state machine. */
type LungeState = 'walking' | 'telegraph' | 'dashing' | 'recover';

/** Per-tier stat multipliers applied on top of BossEnemy base stats. */
const TIER_HP_MULT:    Record<number, number> = { 1: 1.8, 2: 2.6, 3: 3.4, 4: 4.4 };
const TIER_DPS_MULT:   Record<number, number> = { 1: 1.0, 2: 1.1, 3: 1.2, 4: 1.3 };

/**
 * Per-tier ABSOLUTE base movement speed (world units/sec). Overrides BossEnemy's
 * path-walker speed of 0.7 — that was tuned for TD-mode path crawling. Hero
 * base speed is 7 u/s. Boss should be just slightly slower so straight-line
 * kiting at full sprint barely works, and any strafing/turning loses the gap
 * almost immediately. The lunge then closes any remaining distance fast.
 */
const TIER_BASE_SPEED: Record<number, number> = { 1: 5.5, 2: 6.0, 3: 6.5, 4: 7.0 };

/** Tier 5+ HP: 4.4 + 0.6 × (tier − 4). DPS and base speed clamp at tier-4 values. */
function tierHpMult(tier: number): number {
    return tier <= 4 ? TIER_HP_MULT[tier] : 4.4 + 0.6 * (tier - 4);
}
function tierDpsMult(tier: number): number   { return TIER_DPS_MULT[tier]   ?? 1.3; }
function tierBaseSpeed(tier: number): number { return TIER_BASE_SPEED[tier] ?? 4.5; }

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
    /** Static slot used by EnemyManager.spawnSurvivorsEnemy to stage a preloaded GLB
     *  asset (per-tier boss model) before constructing. createMesh consumes + clears. */
    public static pendingAsset: AssetContainer | null = null;

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

    // GLB animation state (mirrors the minion pattern).
    private usingGLB: boolean = false;
    private glbWalkAnim: AnimationGroup | null = null;
    private glbAttackAnim: AnimationGroup | null = null;
    private glbIdleAnim: AnimationGroup | null = null;
    private glbCurrentAnim: AnimationGroup | null = null;
    /** Generous — bosses are large and we want the attack swing playing whenever
     *  they're in striking range, not only when literally touching. */
    private static readonly GLB_ATTACK_RANGE = 5.0;

    constructor(
        game: Game,
        position: Vector3,
        path: Vector3[],
        waveTier: number,
        strengthMultiplier: number = 1,
    ) {
        super(game, position, path);
        this.waveTier = waveTier;
        this.lungeTimer = lungeCooldown(waveTier);

        // Apply tier-scaled stat multipliers on top of the base BossEnemy stats.
        // strengthMultiplier comes from WaveManager when a wave config asked for
        // multiple bosses — we collapse those into 1 boss with stronger stats.
        const hpMult    = tierHpMult(waveTier) * strengthMultiplier;
        const dpsMult   = tierDpsMult(waveTier) * strengthMultiplier;
        const baseSpeed = tierBaseSpeed(waveTier);

        // BossEnemy constructor already set maxHealth=500 and contactDamagePerSecond=30.
        this.maxHealth = Math.floor(this.maxHealth * hpMult);
        this.health    = this.maxHealth;
        // Speed is OVERRIDDEN (not multiplied) — BossEnemy.speed = 0.7 is for path-walker TD mode.
        this.speed     = baseSpeed;
        this.originalSpeed = baseSpeed;
        this.contactDamagePerSecond = this.contactDamagePerSecond * dpsMult;

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

        for (const ag of inst.animationGroups) ag.stop();
        // Note: this.waveTier is undefined at this point (super() runs createMesh
        // before MilestoneBoss field initializers assign waveTier), so the log
        // just uses "milestone-boss".
        console.log(`[milestone-boss] available animations (${inst.animationGroups.length}):`);
        for (const ag of inst.animationGroups) {
            console.log(`  - "${ag.name}"`);
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
        console.log(
            `[milestone-boss] mapped: walk="${this.glbWalkAnim?.name ?? '(none)'}", ` +
            `attack="${this.glbAttackAnim?.name ?? '(none)'}", idle="${this.glbIdleAnim?.name ?? '(none)'}"`,
        );
    }

    private playGlbAnim(slot: AnimationGroup | null, loop: boolean): void {
        if (!slot) return;
        if (this.glbCurrentAnim === slot) return;
        if (this.glbCurrentAnim) this.glbCurrentAnim.stop();
        slot.start(loop);
        this.glbCurrentAnim = slot;
    }

    public update(deltaTime: number): boolean {
        if (!this.alive || !this.mesh) return false;

        this.updateHeroVelocity(deltaTime);
        this.tickLungeStateMachine(deltaTime);
        this.maybeEnrage();

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
        } else if (this.lungeState === 'telegraph' || this.lungeState === 'recover') {
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
            // Pass disposeMaterialAndTextures=true so the per-lunge StandardMaterial doesn't leak.
            this.telegraphRing.dispose(false, true);
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
