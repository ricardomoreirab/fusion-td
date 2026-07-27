import { Vector3 } from 'three';
import { Game } from '../../engine/Game';
import { RedWizard } from './RedWizard';
import type { HeroProvider } from './nearestTarget';

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
    protected onBoltHit(_target: HeroProvider, at: Vector3): void {
        const r2 = RedSuperWizard.SPLASH_RADIUS * RedSuperWizard.SPLASH_RADIUS;
        this.forEachLiveHero(hero => {
            const p = hero.getPosition();
            const dx = p.x - at.x, dz = p.z - at.z;
            if (dx * dx + dz * dz <= r2) {
                hero.takeDamage?.(RedSuperWizard.SPLASH_DAMAGE, this.position);
            }
        });
    }
}
