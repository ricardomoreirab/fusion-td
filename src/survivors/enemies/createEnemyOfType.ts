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
import { RedSuperWizard } from './RedSuperWizard';
import { DragonTurtle } from './DragonTurtle';
import { FireBeetle } from './FireBeetle';
import { HornedLizard } from './HornedLizard';

/**
 * Construct a concrete Enemy of the given type at a position, for GUEST
 * render-only use. Mirrors the type switch in EnemyManager.spawnSurvivorsEnemy.
 *
 * `asset` is the preloaded GLB AssetContainer for this type (from the module
 * cache, supplied by the caller). It is staged on the SAME static `pendingAsset`
 * slot the host uses before construction, so `createMesh()` builds the proper
 * GLB model instead of the procedural fallback. The red-tier variants extend a
 * base class and read the base's static, so we stage on the base class exactly
 * like the host does. Pass null to force the procedural mesh.
 *
 * Does NOT register shadows, assign seek targets, or apply per-wave scaling —
 * the guest drives the instance purely from network state via applyNetworkState().
 *
 * Returns null for an unknown type string; the caller should discard that spawn.
 */
export function createEnemyOfType(
    game: Game,
    type: string,
    pos: Vector3,
    asset: AssetContainer | null = null,
    bossTier: number = 1,
): Enemy | null {
    switch (type) {
        case 'basic':
            BasicEnemy.pendingAsset = asset;
            return new BasicEnemy(game, pos, []);

        case 'fast':
            FastEnemy.pendingAsset = asset;
            return new FastEnemy(game, pos, []);

        case 'tank':
            TankEnemy.pendingAsset = asset;
            return new TankEnemy(game, pos, []);

        case 'boss':
            // Non-milestone boss. Tier-specific GLBs aren't carried in SpawnMsg,
            // so the guest uses the procedural mesh (bosses are rare, wave 5+).
            return new BossEnemy(game, pos, []);

        case 'boss_milestone':
            // Stage the tier-specific GLB (asset resolved for boss_tier<tier> by the
            // caller) so the guest boss matches the host model instead of procedural.
            MilestoneBoss.pendingAsset = asset;
            return new MilestoneBoss(game, pos, [], bossTier);

        case 'splitting':
            SplittingEnemy.pendingAsset = asset;
            return new SplittingEnemy(game, pos, []);

        case 'healer':
            HealerEnemy.pendingAsset = asset;
            return new HealerEnemy(game, pos, []);

        case 'shield':
            ShieldEnemy.pendingAsset = asset;
            return new ShieldEnemy(game, pos, []);

        case 'mini':
            MiniEnemy.pendingAsset = asset;
            return new MiniEnemy(game, pos, []);

        // Wave-10+ red-tier variants: stage on the base class the leaf extends
        // (matches EnemyManager.spawnSurvivorsEnemy's asset staging).
        case 'basic_red':
            BasicEnemy.pendingAsset = asset;
            return new RedMeleeMinion(game, pos, []);

        case 'fast_red':
            FastEnemy.pendingAsset = asset;
            return new RedArtilleryCarriage(game, pos, []);

        case 'healer_red':
            HealerEnemy.pendingAsset = asset;
            return new RedWizard(game, pos, []);

        case 'tank_red':
            TankEnemy.pendingAsset = asset;
            return new DragonTurtle(game, pos, []);

        // Wave-15+ tier (mirrors EnemyManager.spawnSurvivorsEnemy).
        case 'fire_beetle':
            FastEnemy.pendingAsset = asset;
            return new FireBeetle(game, pos, []);

        case 'horned_lizard':
            TankEnemy.pendingAsset = asset;
            return new HornedLizard(game, pos, []);

        case 'healer_red_super':
            HealerEnemy.pendingAsset = asset;
            return new RedSuperWizard(game, pos, []);

        default:
            console.warn(`[createEnemyOfType] unknown type: "${type}" — guest spawn ignored`);
            return null;
    }
}
