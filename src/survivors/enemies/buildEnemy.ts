import { Vector3, AssetContainer } from '@babylonjs/core';
import { Game } from '../../engine/Game';
import { Enemy } from './Enemy';
import { BasicEnemy } from './BasicEnemy';
import { FastEnemy } from './FastEnemy';
import { TankEnemy } from './TankEnemy';
import { BossEnemy } from './BossEnemy';
import { MilestoneBoss } from './MilestoneBoss';
import { SplittingEnemy } from './SplittingEnemy';
import { HealerEnemy } from './HealerEnemy';
import { ShieldEnemy } from './ShieldEnemy';
import { MiniEnemy } from './MiniEnemy';
import { RedMeleeMinion } from './RedMeleeMinion';
import { RedArtilleryCarriage } from './RedArtilleryCarriage';
import { RedWizard } from './RedWizard';
import { DragonTurtle } from './DragonTurtle';
import { makeElite } from './EliteSpawner';

/** Resolve a preloaded GLB AssetContainer for an asset key (e.g. 'basic',
 *  'basic_elite', 'boss_tier2'), or null if not cached / no GLB. The host passes
 *  its own enemyAssets map; the guest passes the module GLB cache. */
export type AssetResolver = (key: string) => AssetContainer | null;

export interface BuildEnemyParams {
    /** Elite element (fire/ice/…) — stages the `<type>_elite` GLB and applies
     *  makeElite (1.4× scale, aura, orange HP-bar). Omit for a normal enemy. */
    eliteElement?: string;
    /** Asset lookup, decoupled from which cache is used (host vs guest). */
    resolveAsset: AssetResolver;
    /** Milestone-boss tier for type 'boss'/'boss_milestone'. >0 → MilestoneBoss;
     *  0/undefined for 'boss' → plain BossEnemy. */
    bossTier?: number;
    /** Boss strength multiplier (milestone bosses only). */
    bossStrengthMultiplier?: number;
}

/**
 * THE single source of truth for constructing + visually configuring a concrete
 * Enemy of `type` at `position`. Shared by the host spawn path
 * (EnemyManager.spawnSurvivorsEnemy) and the guest render path
 * (GuestEnemies.spawn) so the two NEVER drift in appearance.
 *
 * It stages the correct GLB (base or `_elite`, including the base-class slot the
 * red-tier variants inherit), builds the leaf subclass, sets `netType`, and
 * applies elite treatment. It does NOT do host-only work — RNG spawn position,
 * HP scaling, shadow registration, seek-target assignment, id, the onSpawn hook
 * — the caller layers those on top.
 *
 * Returns null for an unknown type string.
 */
export function buildEnemy(
    game: Game,
    type: string,
    position: Vector3,
    p: BuildEnemyParams,
): Enemy | null {
    const elite = p.eliteElement;
    // Elites prefer the `<type>_elite` GLB, falling back to the base model.
    const assetFor = (baseType: string): AssetContainer | null =>
        elite ? (p.resolveAsset(`${baseType}_elite`) ?? p.resolveAsset(baseType)) : p.resolveAsset(baseType);

    let enemy: Enemy;
    switch (type) {
        case 'basic':    BasicEnemy.pendingAsset = assetFor('basic');
                         enemy = new BasicEnemy(game, position, []); break;
        case 'fast':     FastEnemy.pendingAsset = assetFor('fast');
                         enemy = new FastEnemy(game, position, []); break;
        case 'tank':     TankEnemy.pendingAsset = assetFor('tank');
                         enemy = new TankEnemy(game, position, []); break;
        case 'boss':
        case 'boss_milestone': {
            const tier = p.bossTier ?? (type === 'boss_milestone' ? 1 : 0);
            if (tier > 0) {
                const assetTier = Math.min(4, Math.max(1, tier));
                MilestoneBoss.pendingAsset = p.resolveAsset(`boss_tier${assetTier}`);
                enemy = new MilestoneBoss(game, position, [], tier, p.bossStrengthMultiplier ?? 1);
            } else {
                enemy = new BossEnemy(game, position, []);
            }
            break;
        }
        case 'splitting':SplittingEnemy.pendingAsset = assetFor('splitting');
                         enemy = new SplittingEnemy(game, position, []); break;
        case 'healer':   HealerEnemy.pendingAsset = assetFor('healer');
                         enemy = new HealerEnemy(game, position, []); break;
        case 'shield':   ShieldEnemy.pendingAsset = assetFor('shield');
                         enemy = new ShieldEnemy(game, position, []); break;
        case 'mini':     MiniEnemy.pendingAsset = assetFor('mini');
                         enemy = new MiniEnemy(game, position, []); break;
        // Wave-10+ red-tier variants stage on the base class they extend.
        case 'basic_red':  BasicEnemy.pendingAsset = assetFor('basic_red');
                           enemy = new RedMeleeMinion(game, position, []); break;
        case 'fast_red':   FastEnemy.pendingAsset = assetFor('fast_red');
                           enemy = new RedArtilleryCarriage(game, position, []); break;
        case 'healer_red': HealerEnemy.pendingAsset = assetFor('healer_red');
                           enemy = new RedWizard(game, position, []); break;
        case 'tank_red':   TankEnemy.pendingAsset = assetFor('tank_red');
                           enemy = new DragonTurtle(game, position, []); break;
        default:
            console.warn(`[buildEnemy] unknown type: "${type}"`);
            return null;
    }

    // Record the resolved type for the network layer. A milestone boss reports
    // 'boss_milestone' so the guest reconstructs the same class.
    enemy.netType = (enemy instanceof MilestoneBoss) ? 'boss_milestone' : type;

    // Elite treatment (visual + HP mult). On the host this is followed by orb/wave/
    // difficulty scaling; on the guest the authoritative maxHealth is set afterward,
    // overriding makeElite's HP multiplier (the bar ratio stays correct).
    if (elite) makeElite(enemy, elite, game.getScene());

    return enemy;
}
