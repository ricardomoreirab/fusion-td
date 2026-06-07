import { Vector3, AssetContainer } from '@babylonjs/core';
import { Game } from '../../engine/Game';
import { Enemy } from '../enemies/Enemy';
import { createEnemyOfType } from '../enemies/createEnemyOfType';
import { makeElite } from '../enemies/EliteSpawner';
import { PoseBuffer } from '../../net/Interpolation';
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
    /** Per-enemy position interpolation buffer — same smoothing the champion ghost
     *  uses. pushSnapshot() feeds it on each NEW snapshot; interpolate() lerps the
     *  mesh toward a render time ~100ms in the past every frame. */
    private buffers = new Map<number, PoseBuffer>();

    constructor(private game: Game, private assetFor: EnemyAssetResolver = () => null) {}

    spawn(msg: SpawnMsg): void {
        if (this.byId.has(msg.id)) return;
        // Resolve the GLB the host used: milestone bosses → boss_tier<tier>;
        // elites → <type>_elite (base fallback); else the base model.
        const elite = !!msg.eliteElement;
        const tier = msg.bossTier ?? 1;
        const asset = msg.type === 'boss_milestone'
            ? this.assetFor(`boss_tier${tier}`)
            : elite
                ? (this.assetFor(`${msg.type}_elite`) ?? this.assetFor(msg.type))
                : this.assetFor(msg.type);
        const e = createEnemyOfType(this.game, msg.type, new Vector3(msg.x, 0, msg.z), asset, tier);
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
        // Seed the interpolation buffer with the spawn pose so the enemy renders
        // at its spawn point immediately (before the first snapshot arrives).
        const buf = new PoseBuffer();
        buf.push(performance.now(), { x: msg.x, y: 0, z: msg.z, ry: 0 });
        this.buffers.set(msg.id, buf);
    }

    /** Called once per NEW host snapshot. Applies HP/flags immediately and pushes
     *  each enemy's position into its interpolation buffer (timestamped) — NOT every
     *  frame, mirroring how the champion ghost buffers heroState messages. */
    pushSnapshot(entries: SnapshotEnemy[], nowMs: number): void {
        for (const s of entries) {
            const enemy = this.byId.get(s.id);
            if (!enemy) continue; // unknown id → its spawn event creates it; never auto-create.
            enemy.applyNetworkState(s); // HP / status flags / health bar (instant)
            const buf = this.buffers.get(s.id);
            if (buf) buf.push(nowMs, { x: s.x, y: s.y ?? 0, z: s.z, ry: s.ry });
        }
        // Removal is driven ONLY by reliable `death` events (+ clear() on exit) —
        // never by snapshot absence (that deleted freshly-spawned enemies before
        // their first inclusive snapshot).
    }

    /** Called EVERY frame with a render time slightly in the past (~100ms). Lerps
     *  each enemy toward its buffered position for smooth movement, exactly like
     *  the champion ghost. Drives this.position too, so targeting sees it. */
    interpolate(renderTimeMs: number): void {
        for (const [id, enemy] of this.byId) {
            const p = this.buffers.get(id)?.sample(renderTimeMs);
            if (p) enemy.applyNetworkPosition(p.x, p.y, p.z, p.ry);
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
        this.buffers.delete(id);
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
