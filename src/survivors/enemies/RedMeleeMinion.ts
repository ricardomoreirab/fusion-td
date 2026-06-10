import { Vector3 } from '@babylonjs/core';
import { Game } from '../../engine/Game';
import { BasicEnemy } from './BasicEnemy';

/**
 * Wave-10+ replacement for the blue melee minion (BasicEnemy).
 * 10× HP, 2× move speed, 2× attack rate (and doubled contact DPS to match the
 * doubled swing cadence). Reuses BasicEnemy's mesh/GLB/animation code wholesale;
 * EnemyManager stages the red-melee-minion GLB on BasicEnemy.pendingAsset before
 * constructing this class, which the inherited createMesh() consumes.
 */
export class RedMeleeMinion extends BasicEnemy {
    constructor(game: Game, position: Vector3, path: Vector3[]) {
        super(game, position, path);

        // Red tier overrides (BasicEnemy base: 30 HP / speed 3 / 0.5s cooldown / 8 DPS).
        this.health = 300;
        this.maxHealth = 300;
        this.speed = 6;
        this.originalSpeed = 6;
        this.meleeCooldownDuration = 0.25;
        this.contactDamagePerSecond = 16;

        // Build mesh + health bar AFTER the stat overrides so the bar reflects 300 HP.
        // new.target guard mirrors BasicEnemy: fires exactly once for the concrete leaf.
        if (new.target === RedMeleeMinion) this._initEnemyVisuals();
    }
}
