import { Vector3, AssetContainer } from '@babylonjs/core';
import { Game } from '../../engine/Game';
import { Enemy } from '../enemies/Enemy';
import { createEnemyOfType } from '../enemies/createEnemyOfType';
import { makeElite } from '../enemies/EliteSpawner';
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
        // Elites use a distinct `<type>_elite` GLB on the host (falling back to the
        // base model) — stage the same so the guest renders the matching model.
        const elite = !!msg.eliteElement;
        const asset = elite
            ? (this.assetFor(`${msg.type}_elite`) ?? this.assetFor(msg.type))
            : this.assetFor(msg.type);
        const e = createEnemyOfType(this.game, msg.type, new Vector3(msg.x, 0, msg.z), asset);
        if (!e) return;
        e.id = msg.id;
        // Apply the elite treatment (1.4× scale, aura, orange HP-bar tier) BEFORE
        // overriding HP — makeElite multiplies HP, which we then replace with the
        // host-authoritative msg.maxHealth so the bar ratio stays correct.
        if (elite && msg.eliteElement) makeElite(e, msg.eliteElement, this.game.getScene());
        // health/maxHealth are protected; cast to any to set host-authoritative values.
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
