import { Vector3 } from 'three';
import { Game } from '../../engine/Game';
import { RedWizard } from './RedWizard';

/**
 * Wave-15+ wizard ELITE: a RedWizard whose bolt detonates in a small AOE on impact
 * instead of a single-target hit. Spawned by EnemyManager when a wave-15+ wizard
 * rolls elite. Reuses RedWizard's ranged bolt loop wholesale (only onBoltHit differs).
 */
export class RedSuperWizard extends RedWizard {
    private static readonly SPLASH_RADIUS = 3.0;
    private static readonly SPLASH_DAMAGE = 18;

    constructor(game: Game, position: Vector3, path: Vector3[]) {
        super(game, position, path);
        if (new.target === RedSuperWizard) this._initEnemyVisuals();
    }

    /** Damage every live hero within SPLASH_RADIUS of the impact point. */
    protected onBoltHit(_target: NonNullable<typeof this.seekTarget>, at: Vector3): void {
        // seekTargets is the co-op multi-hero list (TargetProvider — position/isAlive
        // only); fall back to the single seekTarget in solo. takeDamage exists on the
        // real provider objects but not the TargetProvider type, so cast at the call.
        const heroes: Array<{
            getPosition(): { x: number; z: number };
            isAlive?(): boolean;
            takeDamage?(amount: number, sourcePos?: Vector3): void;
        }> = this.seekTargets.length > 0
            ? this.seekTargets
            : (this.seekTarget ? [this.seekTarget] : []);
        const r2 = RedSuperWizard.SPLASH_RADIUS * RedSuperWizard.SPLASH_RADIUS;
        for (const h of heroes) {
            if (h.isAlive?.() === false) continue;
            const p = h.getPosition();
            const dx = p.x - at.x, dz = p.z - at.z;
            if (dx * dx + dz * dz <= r2) {
                h.takeDamage?.(RedSuperWizard.SPLASH_DAMAGE, this.position);
            }
        }
    }
}
