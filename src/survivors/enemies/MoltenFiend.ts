import { Vector3 } from 'three';
import { Game } from '../../engine/Game';
import { HealerEnemy } from './HealerEnemy';
import { ENEMY_BOLTS } from './EnemyBolt';
import type { HeroProvider } from './nearestTarget';

/** Seconds the hero keeps burning after a fireball connects, and how hard. The
 *  fire beetle's contact burn is 8 dps for 3s and is applied by walking into it;
 *  the fiend's is stronger and lands from across the arena, which is the whole
 *  reason it has to be dodgeable (see ENEMY_BOLTS.fireball). */
const BURN_DURATION_S = 4.0;
const BURN_DPS = 14;

/**
 * Wave-25+ replacement for the red wizard (HealerEnemy). Backline artillery that
 * does not merely chip: it lobs a fat, slow, DODGEABLE fireball that sets the
 * hero alight.
 *
 * The two ranged tiers below it both fire a HOMING bolt — guaranteed contact, out-
 * healed rather than avoided. The fiend inverts that: the projectile can be
 * stepped out of, and the price of not doing so is a burn that keeps ticking
 * after the hit. A player who has learned to ignore mage bolts and keep circling
 * has to start reading the backline again, which is what a new enemy tier is for.
 *
 * Reuses HealerEnemy's mesh/GLB/animation and its one projectile implementation;
 * EnemyManager stages the molten-fiend GLB on HealerEnemy.pendingAsset.
 */
export class MoltenFiend extends HealerEnemy {
    constructor(game: Game, position: Vector3, path: Vector3[]) {
        super(game, position, path);

        // Wave-25 caster (the red wizard it replaces is 75 HP / 12 per bolt).
        // Tougher than a wizard but still a backline body, not a brawler.
        this.health = 300;
        this.maxHealth = 300;
        this.contactDamagePerSecond = 6;

        // Slower cadence than the wizard's plink: each shot is a real threat, so
        // the gaps between them are where the hero gets to close.
        this.boltSpec = ENEMY_BOLTS.fireball;
        this.boltDamage = 26;
        this.boltCooldown = 2.6;
        this.boltRange = 14;

        if (new.target === MoltenFiend) this._initEnemyVisuals();
    }

    /** A fiend is no shaman — it burns its allies as readily as anything else. */
    protected performHealPulse(_deltaTime: number): void { /* does not heal */ }

    /**
     * Impact: the direct hit, then the fire it leaves behind.
     *
     * `applyBurn` is optional-chained like every other HeroProvider channel — it
     * is absent against a co-op TEAMMATE's ghost provider, which carries position
     * and liveness only. The direct damage still lands there; the host owns the
     * teammate's HP and the burn is applied on the peer that owns that hero.
     */
    protected onBoltHit(target: HeroProvider, at: Vector3): void {
        void at;
        target.takeDamage?.(this.boltDamage, this.position);
        target.applyBurn?.(BURN_DURATION_S, BURN_DPS);
    }
}
