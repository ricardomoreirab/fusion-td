import { Vector3, MeshBuilder, Color3 } from '@babylonjs/core';
import { Game } from '../../engine/Game';
import { HealerEnemy } from './HealerEnemy';
import { acquireProjectile, releaseProjectile } from '../../engine/rendering/ProjectilePool';
import { getCachedMaterial } from '../../engine/rendering/MaterialCache';
import { emitCoopFx } from '../coop/CoopFx';

/**
 * Wave-10+ replacement for the blue wizard (HealerEnemy). It does NOT heal —
 * instead it fires a dodgeable magic bolt at the hero from range, and has 3× the
 * healer's HP. Reuses HealerEnemy's GLB / animation / movement / death code; only
 * the support behavior (performSupportBehavior) is replaced.
 */
export class RedWizard extends HealerEnemy {
    private static readonly ATTACK_COOLDOWN = 2.0; // seconds between bolts
    private static readonly ATTACK_RANGE = 12;     // world units; only fires within this
    private static readonly BOLT_SPEED = 14;       // units/sec — slow enough to sidestep
    protected static readonly BOLT_DAMAGE = 12;    // protected: RedSuperWizard reads it
    private static readonly BOLT_HIT_RADIUS = 0.6; // distance to hero counted as a hit
    private static readonly BOLT_TIMEOUT_MS = 3000;
    private static readonly POOL_KEY = 'red-wizard-bolt';

    /** Counts down to the next shot. Starts at full cooldown so the first bolt is delayed. */
    private attackTimer: number = RedWizard.ATTACK_COOLDOWN;

    constructor(game: Game, position: Vector3, path: Vector3[]) {
        super(game, position, path);

        // Red tier override (HealerEnemy base: 25 HP). Keep speed 3.5 + weak melee.
        // Low contact DPS — it's a backline ranged threat, not a brawler.
        this.health = 75;
        this.maxHealth = 75;
        this.contactDamagePerSecond = 2;

        if (new.target === RedWizard) this._initEnemyVisuals();
    }

    /**
     * Replaces the healer's heal pulse: tick an attack timer and, when ready AND the
     * hero is within range, fire a bolt. Out of range → timer stays ready so the bolt
     * launches the instant the hero steps into range.
     */
    protected performSupportBehavior(deltaTime: number): void {
        // Nearest LIVE hero — a dead co-op host (raw seekTarget) is no longer a target.
        const target = this.resolveSeekTarget();
        if (!target || this.isFrozen || this.isStunned) return;

        this.attackTimer -= deltaTime;
        if (this.attackTimer > 0) return;

        const heroPos = target.getPosition();
        const dx = heroPos.x - this.position.x;
        const dz = heroPos.z - this.position.z;
        if (dx * dx + dz * dz > RedWizard.ATTACK_RANGE * RedWizard.ATTACK_RANGE) return;

        this.attackTimer = RedWizard.ATTACK_COOLDOWN;
        // Trigger the GLB cast/attack animation (inherited GLB block plays it while > 0).
        this.glbAttackHoldTimer = 0.6;
        // Broadcast the bolt to the guest so it's visible on their screen.
        emitCoopFx('enemyProj', this.position.x, this.position.z, heroPos.x, heroPos.z);
        this.fireBolt(heroPos);
    }

    /**
     * Spawn a straight-flying bolt aimed at the hero's position AT LAUNCH (non-homing,
     * so the player can dodge). Moved each frame via an onBeforeRenderObservable closure;
     * the observer is removed on hit, timeout, or if the wizard/hero is gone.
     */
    private fireBolt(heroPos: Vector3): void {
        const origin = this.position.clone();
        origin.y += 1.4; // roughly staff-orb height

        const dirX = heroPos.x - origin.x;
        const dirZ = heroPos.z - origin.z;
        const len = Math.hypot(dirX, dirZ) || 1;
        const vx = (dirX / len) * RedWizard.BOLT_SPEED;
        const vz = (dirZ / len) * RedWizard.BOLT_SPEED;

        const bolt = acquireProjectile(this.scene, RedWizard.POOL_KEY, () => {
            const m = MeshBuilder.CreateSphere('redWizardBolt', { diameter: 0.4, segments: 6 }, this.scene);
            // Bounded cache key (one material total) — never per-instance/random (CLAUDE.md).
            m.material = getCachedMaterial(this.scene, RedWizard.POOL_KEY, mat => {
                mat.emissiveColor = new Color3(0.95, 0.18, 0.12);
                mat.diffuseColor = new Color3(0.95, 0.18, 0.12);
                mat.disableLighting = true;
            });
            return m;
        });
        bolt.position.copyFrom(origin);
        bolt.setEnabled(true);

        // Track the same live hero the bolt was aimed at; the in-flight isAlive guard
        // below still cancels it if that hero goes down before impact.
        const seekTarget = this.resolveSeekTarget();
        const startTime = performance.now();

        const observer = this.scene.onBeforeRenderObservable.add(() => {
            const cleanup = () => {
                this.scene.onBeforeRenderObservable.remove(observer);
                releaseProjectile(RedWizard.POOL_KEY, bolt);
            };

            // Bail if the bolt/wizard/hero is gone, or the bolt has flown too long.
            if (bolt.isDisposed() || !this.alive || !seekTarget
                || seekTarget.isAlive?.() === false
                || performance.now() - startTime > RedWizard.BOLT_TIMEOUT_MS) {
                cleanup();
                return;
            }

            const dt = this.scene.getEngine().getDeltaTime() / 1000;
            bolt.position.x += vx * dt;
            bolt.position.z += vz * dt;

            // Hit test against the hero's CURRENT position.
            const hp = seekTarget.getPosition();
            const hx = hp.x - bolt.position.x;
            const hz = hp.z - bolt.position.z;
            if (hx * hx + hz * hz < RedWizard.BOLT_HIT_RADIUS * RedWizard.BOLT_HIT_RADIUS) {
                this.onBoltHit(seekTarget, bolt.position);
                cleanup();
            }
        });
    }

    /**
     * Apply the bolt's damage on impact. Base = single target. Subclasses (the super
     * wizard) override to add AOE splash. `at` is the bolt's world position at impact.
     */
    protected onBoltHit(target: NonNullable<typeof this.seekTarget>, at: Vector3): void {
        void at;
        target.takeDamage?.(RedWizard.BOLT_DAMAGE, this.position);
    }
}
