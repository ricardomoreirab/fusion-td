import { Vector3 } from '@babylonjs/core';
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

/**
 * Construct a concrete Enemy of the given type at a position, for GUEST
 * render-only use. Mirrors the type switch in EnemyManager.spawnSurvivorsEnemy
 * but does NOT register shadows, assign seek targets, apply per-wave scaling,
 * or set pendingAsset (GLB) — the guest drives the instance purely from
 * network state via applyNetworkState().
 *
 * For 'boss'-typed enemies the host always sends the concrete type after
 * the wave-tier branch ('boss' → BossEnemy for non-milestone waves; the
 * milestone path uses the same 'boss' string but we default to tier 1 so
 * the guest still gets a valid mesh). Use the SpawnMsg.type field, which
 * EnemyManager fills with the resolved type string after redSwapType.
 *
 * Returns null for an unknown type string; the caller should discard that
 * spawn event.
 */
export function createEnemyOfType(game: Game, type: string, pos: Vector3): Enemy | null {
    switch (type) {
        case 'basic':
            return new BasicEnemy(game, pos, []);

        case 'fast':
            return new FastEnemy(game, pos, []);

        case 'tank':
            return new TankEnemy(game, pos, []);

        case 'boss':
            // Non-milestone waves produce a BossEnemy. Milestone waves are sent
            // with the same 'boss' type by the host; we use tier=1 (Ravager) as a
            // guest-side default so a valid mesh always exists. The host's snapshot
            // drives position/HP; the tier-specific specials never fire on the guest.
            return new BossEnemy(game, pos, []);

        case 'boss_milestone': {
            // Explicit milestone type — host may send this to distinguish the tier.
            // Default to tier 1 for the guest (visual-only, no AI).
            return new MilestoneBoss(game, pos, [], 1);
        }

        case 'splitting':
            return new SplittingEnemy(game, pos, []);

        case 'healer':
            return new HealerEnemy(game, pos, []);

        case 'shield':
            return new ShieldEnemy(game, pos, []);

        case 'mini':
            return new MiniEnemy(game, pos, []);

        // Wave-10+ red-tier variants
        case 'basic_red':
            return new RedMeleeMinion(game, pos, []);

        case 'fast_red':
            return new RedArtilleryCarriage(game, pos, []);

        case 'healer_red':
            return new RedWizard(game, pos, []);

        case 'tank_red':
            return new DragonTurtle(game, pos, []);

        default:
            console.warn(`[createEnemyOfType] unknown type: "${type}" — guest spawn ignored`);
            return null;
    }
}
