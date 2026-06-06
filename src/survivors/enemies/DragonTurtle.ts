import { Vector3 } from '@babylonjs/core';
import { Game } from '../../engine/Game';
import { TankEnemy } from './TankEnemy';

/**
 * Wave-10+ replacement for the lava-golem tank (TankEnemy).
 * 10× HP only — speed (1.5), damage, attack rate, and the heavy flag are unchanged;
 * it's a slow, enormous wall. Reuses TankEnemy's mesh/GLB/animation code; EnemyManager
 * stages the dragon-turtle GLB on TankEnemy.pendingAsset before constructing this class.
 */
export class DragonTurtle extends TankEnemy {
    constructor(game: Game, position: Vector3, path: Vector3[]) {
        super(game, position, path);

        // Red tier override (TankEnemy base: 150 HP). speed / damage / cooldown unchanged.
        this.health = 1500;
        this.maxHealth = 1500;

        if (new.target === DragonTurtle) this._initEnemyVisuals();
    }
}
