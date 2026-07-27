import { Vector3 } from 'three';
import { Game } from '../../engine/Game';
import { FastEnemy } from './FastEnemy';

/**
 * Wave-15+ replacement for the fast carriage (FastEnemy). A fast skirmisher whose
 * contact ignites a fire DoT on the hero (burnOnContactDps), ticking ~3s after it
 * peels off. Reuses FastEnemy's mesh/GLB/animation; EnemyManager stages the
 * fire-beetle GLB on FastEnemy.pendingAsset before constructing this leaf.
 */
export class FireBeetle extends FastEnemy {
    constructor(game: Game, position: Vector3, path: Vector3[]) {
        super(game, position, path);
        // Fast tier: tanky-for-a-fast, quick, modest direct contact + a fire DoT.
        this.health = 220;
        this.maxHealth = 220;
        this.contactDamagePerSecond = 10;
        this.burnOnContactDps = 8; // ticks for ~3s in applyContactDamage

        if (new.target === FireBeetle) this._initEnemyVisuals();
    }

    /**
     * No lance. FastEnemy's ranged attack belongs to the artillery CARRIAGES it
     * normally renders as — a beetle has no gun to fire one from, and its threat
     * is already distinct: it closes and sets you alight. Keeping the inherited
     * volley would have made the two wave-15 skirmishers the same fight.
     */
    protected performRangedAttack(_deltaTime: number): void { /* no gun to fire */ }
}
