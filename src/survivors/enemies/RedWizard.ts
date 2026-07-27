import { Vector3 } from 'three';
import { Game } from '../../engine/Game';
import { HealerEnemy } from './HealerEnemy';
import { ENEMY_BOLTS } from './EnemyBolt';

/**
 * Wave-10+ replacement for the blue wizard (HealerEnemy). It does NOT heal —
 * it is pure backline artillery: a heavier, faster version of the same dodgeable
 * bolt every mage now fires, with 3× the healer's HP. Everything else (GLB,
 * animation, movement, death, the projectile itself) is inherited.
 */
export class RedWizard extends HealerEnemy {
    constructor(game: Game, position: Vector3, path: Vector3[]) {
        super(game, position, path);

        // Red tier override (HealerEnemy base: 25 HP). Keep speed 3.5 + weak melee.
        // Low contact DPS — it's a backline ranged threat, not a brawler.
        this.health = 75;
        this.maxHealth = 75;
        this.contactDamagePerSecond = 2;

        // Artillery stat block over the shared mage bolt (also homing).
        this.boltSpec = ENEMY_BOLTS.redWizard;
        this.boltDamage = 12;
        this.boltCooldown = 2.0;
        this.boltRange = 12;

        if (new.target === RedWizard) this._initEnemyVisuals();
    }

    /** The red tier is a caster, not a shaman — no heal pulse. */
    protected performHealPulse(_deltaTime: number): void { /* does not heal */ }
}
