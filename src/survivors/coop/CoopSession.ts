import type { NetClient } from '../../net/NetClient';
import { PoseBuffer, type Pose } from '../../net/Interpolation';
import type { SnapshotMsg, SpawnMsg, DeathMsg, DamageReportMsg, DamageResultMsg, InputMsg, RunSummaryMsg, RunOverMsg } from '../../net/Protocol';

/**
 * CoopSession — the M2 game-side glue, kept Babylon-free. Sends the local hero
 * pose each tick and buffers the remote hero pose for interpolated rendering.
 * The scene layer reads getRemoteChamp()/getRemotePose() to drive a ghost mesh.
 */
export class CoopSession {
    private remoteBuffer = new PoseBuffer();
    private remoteChamp: string | null = null;
    private remoteAnim = 0; // last anim code from the remote hero (0 idle/1 run/2 attack)
    private localSeq = 0;

    // M3: guest-side last-received snapshot (last-wins buffer)
    private latestSnapshot: SnapshotMsg | null = null;

    // M4: host-side last-received guest input (latest-wins). Drives the host's
    // authoritative simulation of the guest hero. `inputSeq` is the highest seq
    // applied — echoed back as the snapshot ackSeq for guest reconciliation.
    private latestInput: InputMsg | null = null;
    private inputSeq = 0;

    // M3: game-layer callbacks wired by SurvivorsGameplayState (guest only)
    onSpawn?:         (msg: SpawnMsg)         => void;
    onDeath?:         (msg: DeathMsg)         => void;
    // M3 combat: host receives damageReport from guest; guest receives damageResult from host
    onDamageReport?:  (msg: DamageReportMsg)  => void;
    onDamageResult?:  (msg: DamageResultMsg)  => void;
    /** Host: the guest connected and asked for the current world (catch-up). */
    onRequestState?:  () => void;
    // M4-12: host receives the guest's periodic hero summary; guest receives the
    // host's authoritative run-over (both heroes) to render the 2-column game-over.
    onRunSummary?:    (msg: RunSummaryMsg)    => void;
    onRunOver?:       (msg: RunOverMsg)       => void;

    constructor(
        private client: NetClient,
        private localChamp: string,
        private now: () => number = () => performance.now(),
    ) {
        this.client.onHeroState = (m) => {
            this.remoteChamp = m.champ;
            this.remoteAnim = m.anim;
            this.remoteBuffer.push(this.now(), { x: m.x, y: m.y, z: m.z, ry: m.ry });
        };

        // M3 guest-side wiring
        this.client.onSnapshot      = (m) => { this.latestSnapshot = m; };
        this.client.onSpawn         = (m) => { this.onSpawn?.(m); };
        this.client.onDeath         = (m) => { this.onDeath?.(m); };
        this.client.onDamageReport  = (m) => { this.onDamageReport?.(m); };
        this.client.onDamageResult  = (m) => { this.onDamageResult?.(m); };
        this.client.onRequestState  = () => { this.onRequestState?.(); };
        this.client.onRunSummary    = (m) => { this.onRunSummary?.(m); };
        this.client.onRunOver       = (m) => { this.onRunOver?.(m); };
        // M4 host-side: keep only the newest guest input (drop out-of-order/stale).
        this.client.onInput = (m) => {
            if (m.seq < this.inputSeq) return; // ignore reordered older frames
            this.inputSeq = m.seq;
            this.latestInput = m;
        };
    }

    /** Guest: send this frame's movement axes + button bitfield (M4 input authority). */
    sendLocalInput(dx: number, dz: number, buttons: number): void {
        this.client.sendInput({ seq: ++this.localSeq, dx, dz, buttons });
    }

    /** Host: the newest guest input, or null if none yet. */
    getLatestInput(): InputMsg | null {
        return this.latestInput;
    }

    /** Host: highest guest input seq applied — snapshot ackSeq for reconciliation. */
    getInputAckSeq(): number {
        return this.inputSeq;
    }

    /** Guest: periodically send my hero summary so the host can aggregate run-over. */
    sendRunSummary(m: RunSummaryMsg): void {
        this.client.sendRunSummary(m);
    }

    /** Host: broadcast the authoritative final result (both heroes) to the guest. */
    sendRunOver(m: RunOverMsg): void {
        this.client.sendRunOver(m);
    }

    /** Guest: ask the host to re-send the current world (live enemies). */
    sendRequestState(): void {
        this.client.sendRequestState();
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

    /** Guest: report damage dealt to an enemy (host validates + applies). */
    sendDamageReport(m: DamageReportMsg): void {
        this.client.sendDamageReport(m);
    }

    /** Host: send the authoritative damage result back to the guest (for damage numbers). */
    sendDamageResult(m: DamageResultMsg): void {
        this.client.sendDamageResult(m);
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

    /** Last anim code received from the remote hero (0 idle/1 run/2 attack). The
     *  scene triggers the ghost's attack clip on the rising edge to 2. */
    getRemoteAnim(): number {
        return this.remoteAnim;
    }

    /** Interpolated remote pose at the given render time, or null if none yet. */
    getRemotePose(renderTimeMs: number): Pose | null {
        return this.remoteBuffer.sample(renderTimeMs);
    }

    dispose(): void {
        this.client.close();
    }
}
