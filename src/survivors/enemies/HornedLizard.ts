import { Vector3 } from '@babylonjs/core';
import { Game } from '../../engine/Game';
import { TankEnemy } from './TankEnemy';

/**
 * Wave-15+ replacement for the tank (TankEnemy). The heaviest non-boss hitter:
 * very high HP and contact damage, slow. Reuses TankEnemy's mesh/GLB/animation;
 * EnemyManager stages the horned-lizard GLB on TankEnemy.pendingAsset.
 */
export class HornedLizard extends TankEnemy {
    protected glbScale: number = 1.4;

    constructor(game: Game, position: Vector3, path: Vector3[]) {
        super(game, position, path);

        // Heavy hitter (TankEnemy base: 150 HP / 20 DPS). speed / cooldown unchanged.
        this.health = 900;
        this.maxHealth = 900;
        this.contactDamagePerSecond = 36;

        if (new.target === HornedLizard) this._initEnemyVisuals();
    }
}
