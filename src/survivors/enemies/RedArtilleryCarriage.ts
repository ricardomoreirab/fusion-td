import { Vector3 } from '@babylonjs/core';
import { Game } from '../../engine/Game';
import { FastEnemy } from './FastEnemy';

/**
 * Wave-10+ replacement for the blue gold artillery carriage (FastEnemy).
 * 10× HP only — speed (6) and attack rate (0.35s) are unchanged; it is already
 * the fast/flying enemy. Reuses FastEnemy's mesh/GLB/animation code; EnemyManager
 * stages the red-gold-artillery-carriage GLB on FastEnemy.pendingAsset.
 */
export class RedArtilleryCarriage extends FastEnemy {
    constructor(game: Game, position: Vector3, path: Vector3[]) {
        super(game, position, path);

        // Red tier override (FastEnemy base: 20 HP). isFlying / speed / melee unchanged.
        this.health = 200;
        this.maxHealth = 200;

        if (new.target === RedArtilleryCarriage) this._initEnemyVisuals();
    }
}
