import type { NetClient } from '../../net/NetClient';
import { PoseBuffer, type Pose } from '../../net/Interpolation';
import type { SnapshotMsg, SpawnMsg, DeathMsg } from '../../net/Protocol';

/**
 * CoopSession — the M2 game-side glue, kept Babylon-free. Sends the local hero
 * pose each tick and buffers the remote hero pose for interpolated rendering.
 * The scene layer reads getRemoteChamp()/getRemotePose() to drive a ghost mesh.
 */
export class CoopSession {
    private remoteBuffer = new PoseBuffer();
    private remoteChamp: string | null = null;
    private localSeq = 0;

    // M3: guest-side last-received snapshot (last-wins buffer)
    private latestSnapshot: SnapshotMsg | null = null;

    // M3: game-layer callbacks wired by SurvivorsGameplayState (guest only)
    onSpawn?: (msg: SpawnMsg) => void;
    onDeath?: (msg: DeathMsg) => void;

    constructor(
        private client: NetClient,
        private localChamp: string,
        private now: () => number = () => performance.now(),
    ) {
        this.client.onHeroState = (m) => {
            this.remoteChamp = m.champ;
            this.remoteBuffer.push(this.now(), { x: m.x, y: m.y, z: m.z, ry: m.ry });
        };

        // M3 guest-side wiring
        this.client.onSnapshot = (m) => { this.latestSnapshot = m; };
        this.client.onSpawn    = (m) => { this.onSpawn?.(m); };
        this.client.onDeath    = (m) => { this.onDeath?.(m); };
    }

    get role() {
        return this.client.role;
    }

    // ── M3: host-side senders ────────────────────────────────────────────────

    /** Host: broadcast an authoritative world snapshot to the guest. */
    sendEnemySnapshot(m: SnapshotMsg): void {
        this.client.sendSnapshot(m);
    }

    /** Host: notify the guest that a new enemy has spawned. */
    sendSpawn(m: SpawnMsg): void {
        this.client.sendSpawn(m);
    }

    /** Host: notify the guest that an enemy has died. */
    sendDeath(m: DeathMsg): void {
        this.client.sendDeath(m);
    }

    // ── M3: guest-side accessor ──────────────────────────────────────────────

    /** Guest: returns the most recently received snapshot, or null if none yet. */
    getLatestSnapshot(): SnapshotMsg | null {
        return this.latestSnapshot;
    }

    sendLocalPose(pose: Pose, anim: number): void {
        this.client.sendHeroState({
            seq: ++this.localSeq,
            x: pose.x, y: pose.y, z: pose.z, ry: pose.ry,
            champ: this.localChamp, anim,
        });
    }

    getRemoteChamp(): string | null {
        return this.remoteChamp;
    }

    /** Interpolated remote pose at the given render time, or null if none yet. */
    getRemotePose(renderTimeMs: number): Pose | null {
        return this.remoteBuffer.sample(renderTimeMs);
    }

    dispose(): void {
        this.client.close();
    }
}
