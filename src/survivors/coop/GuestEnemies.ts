import { Vector3, AssetContainer } from '@babylonjs/core';
import { Game } from '../../engine/Game';
import { Enemy } from '../enemies/Enemy';
import { buildEnemy } from '../enemies/buildEnemy';
import type { SnapshotEnemy, SpawnMsg } from '../../net/Protocol';

/** Resolve the preloaded GLB AssetContainer for an enemy type, or null. */
export type EnemyAssetResolver = (type: string) => AssetContainer | null;

/**
 * Guest-side registry of render-only enemies keyed by stable network id.
 * Never ticks AI — driven entirely by host snapshots + spawn/death events.
 *
 * Lifecycle:
 *   spawn()         — called on a host SpawnMsg; constructs the concrete enemy
 *                     mesh and registers it by id.
 *   applySnapshot() — called each tick; drives position/rotation/HP for every
 *                     known enemy and defensively removes stale ones.
 *   death()         — called on a host DeathMsg; triggers the death cleanup.
 *   clear()         — called on run exit; disposes all remaining instances.
 */
export class GuestEnemies {
    private byId = new Map<number, Enemy>();

    constructor(private game: Game, private assetFor: EnemyAssetResolver = () => null) {}

    spawn(msg: SpawnMsg): void {
        if (this.byId.has(msg.id)) return;
        // THE shared construction — identical model + elite treatment to the host
        // (buildEnemy stages the GLB / `_elite` GLB, sets netType, applies makeElite).
        const e = buildEnemy(this.game, msg.type, new Vector3(msg.x, 0, msg.z), {
            eliteElement: msg.eliteElement,
            resolveAsset: this.assetFor,
        });
        if (!e) return;
        e.id = msg.id;
        // Override HP with the host-authoritative value — also overrides makeElite's
        // HP multiplier so the health-bar ratio stays correct.
        // health/maxHealth are protected; cast to set them.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ea = e as any;
        ea.maxHealth = msg.maxHealth;
        ea.health    = msg.maxHealth;
        this.byId.set(msg.id, e);
    }

    applySnapshot(entries: SnapshotEnemy[]): void {
        const live = new Set<number>();
        for (const s of entries) {
            live.add(s.id);
            const enemy = this.byId.get(s.id);
            if (enemy) enemy.applyNetworkState(s);
            // Unknown id (spawn event not yet applied / lost) → ignore.
            // A spawn event must create the instance; we never auto-create from
            // snapshot alone because we would have no type or maxHealth.
        }
        // Defensive cleanup: remove enemies the host no longer reports that did
        // not get an explicit death event (e.g. connection gap at kill moment).
        for (const id of [...this.byId.keys()]) {
            if (!live.has(id)) this.remove(id);
        }
    }

    death(id: number): void {
        this.remove(id);
    }

    private remove(id: number): void {
        const e = this.byId.get(id);
        if (!e) return;
        // CRITICAL leak-safety: disposeCorpse frees GLB skeleton bone-matrix
        // texture, anim groups, per-instance materials, shadow renderlist, and
        // health-bar textures. NEVER call plain mesh.dispose() — that leaks
        // the skeleton RawTexture, cloned AnimationGroups, and per-instance
        // materials (see gotcha: GLB skeleton + lifecycle leaks).
        e.disposeCorpse();
        this.byId.delete(id);
    }

    clear(): void {
        for (const id of [...this.byId.keys()]) this.remove(id);
    }

    count(): number {
        return this.byId.size;
    }

    public getEnemies(): Enemy[] {
        return [...this.byId.values()];
    }

    public getById(id: number): Enemy | undefined {
        return this.byId.get(id);
    }
}
