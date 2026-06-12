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
    // Smaller than the base TankEnemy/lava-golem (1.6) — a tough wall, not a giant.
    protected glbScale: number = 1.2;

    constructor(game: Game, position: Vector3, path: Vector3[]) {
        super(game, position, path);

        // Red tier override (TankEnemy base: 150 HP). speed / damage / cooldown unchanged.
        // Hard but reasonable: ~4.7× the base tank rather than 10×.
        this.health = 700;
        this.maxHealth = 700;

        if (new.target === DragonTurtle) this._initEnemyVisuals();
    }
}
