import type { NetClient } from '../../net/NetClient';
import { PoseBuffer, type Pose } from '../../net/Interpolation';
import type { SnapshotMsg, SpawnMsg, DeathMsg, DamageReportMsg, DamageResultMsg, InputMsg, RunSummaryMsg, RunOverMsg, FxMsg } from '../../net/Protocol';
import { applyDelta, type SnapshotDelta } from '../../net/SnapshotDelta';

/** One ring entry: a sent input plus the LOCAL frame dt it was simulated with.
 *  dt never travels over the wire (the host integrates with its own frame dt);
 *  it exists purely so the guest can replay unacked inputs (M6 E2). */
export interface RecordedInput { seq: number; dx: number; dz: number; dt: number }

/** Ring capacity — at 60 input frames/s this is >4s of history, far beyond any
 *  snapshot RTT; older (long-since-acked) entries are simply overwritten. */
export const INPUT_HISTORY_SIZE = 256;

/** Cap on the dt recorded per input so a tab-switch frame spike (one giant dt)
 *  can't be replayed as a teleport-length step. */
export const MAX_INPUT_DT_S = 0.1;

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
    // M5-7: last FULL snapshot the guest holds, used as the base to apply deltas onto.
    private baseSnapshot: SnapshotMsg | null = null;

    // M4: host-side last-received guest input (latest-wins). Drives the host's
    // authoritative simulation of the guest hero. `inputSeq` is the highest seq
    // applied — echoed back as the snapshot ackSeq for guest reconciliation.
    private latestInput: InputMsg | null = null;
    private inputSeq = 0;

    // M6 E2: guest-side bounded input-history ring for replay reconciliation.
    // Pre-allocated records mutated in place — zero per-frame allocation.
    private inputHistory: RecordedInput[] =
        Array.from({ length: INPUT_HISTORY_SIZE }, () => ({ seq: 0, dx: 0, dz: 0, dt: 0 }));
    private inputHistoryStart = 0; // index of the oldest entry
    private inputHistoryCount = 0;

    // M3: game-layer callbacks wired by SurvivorsGameplayState (guest only)
    onSpawn?:         (msg: SpawnMsg)         => void;
    onDeath?:         (msg: DeathMsg)         => void;
    // M3 combat: host receives damageReport from guest; guest receives damageResult from host
    onDamageReport?:  (msg: DamageReportMsg)  => void;
    onDamageResult?:  (msg: DamageResultMsg)  => void;
    /** Host: the guest connected and asked for the current world (catch-up). */
    onRequestState?:  () => void;
    /** M5-6: the relay reported the other peer left (drives the reconnect grace UX). */
    onPeerLeft?:      () => void;
    /** M6 D1: the relay reported the dropped peer resumed its slot. */
    onPeerRejoined?:  () => void;
    /** M6 D1: any gameplay message arrived from the peer (heroState/snapshot/delta/
     *  input/fx/requestState). Fallback rejoin signal: traffic proves the peer is
     *  back even if the relay's peer-rejoined was missed (DO eviction edge). */
    onPeerTraffic?:   () => void;
    /** Cosmetic FX produced by the remote hero (projectiles/casts/ults) to replay. */
    onFx?:            (msg: FxMsg)            => void;
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
            this.onPeerTraffic?.();
            this.remoteChamp = m.champ;
            this.remoteAnim = m.anim;
            this.remoteBuffer.push(this.now(), { x: m.x, y: m.y, z: m.z, ry: m.ry });
        };

        // M3 guest-side wiring. A full snapshot (keyframe) refreshes the delta base.
        this.client.onSnapshot      = (m) => { this.onPeerTraffic?.(); this.latestSnapshot = m; this.baseSnapshot = m; };
        // M5-7: apply a delta onto the held base IFF it builds on the tick we have;
        // otherwise drop it (we missed the keyframe) and wait for the next keyframe.
        this.client.onSnapshotDelta = (d) => {
            this.onPeerTraffic?.();
            if (this.baseSnapshot && d.baseTick === this.baseSnapshot.tick) {
                const full = applyDelta(this.baseSnapshot, d);
                this.latestSnapshot = full;
                this.baseSnapshot = full;
            }
        };
        this.client.onSpawn         = (m) => { this.onSpawn?.(m); };
        this.client.onDeath         = (m) => { this.onDeath?.(m); };
        this.client.onDamageReport  = (m) => { this.onDamageReport?.(m); };
        this.client.onDamageResult  = (m) => { this.onDamageResult?.(m); };
        this.client.onRequestState  = () => { this.onPeerTraffic?.(); this.onRequestState?.(); };
        this.client.onRunSummary    = (m) => { this.onRunSummary?.(m); };
        this.client.onRunOver       = (m) => { this.onRunOver?.(m); };
        this.client.onPeerLeft      = () => { this.onPeerLeft?.(); };
        this.client.onPeerRejoined  = () => { this.onPeerRejoined?.(); };
        this.client.onFx            = (m) => { this.onPeerTraffic?.(); this.onFx?.(m); };
        // M4 host-side: keep only the newest guest input (drop out-of-order/stale).
        this.client.onInput = (m) => {
            this.onPeerTraffic?.();
            if (m.seq < this.inputSeq) return; // ignore reordered older frames
            this.inputSeq = m.seq;
            this.latestInput = m;
        };
    }

    /** Guest: send this frame's movement axes + button bitfield (M4 input authority).
     *  `dtS` is the LOCAL simulation dt this input was integrated with — recorded
     *  in the history ring for replay reconciliation (M6 E2), never sent. */
    sendLocalInput(dx: number, dz: number, buttons: number, dtS: number): void {
        const seq = ++this.localSeq;
        this.client.sendInput({ seq, dx, dz, buttons });

        // Record into the bounded ring: overwrite the oldest entry when full.
        if (this.inputHistoryCount === INPUT_HISTORY_SIZE) {
            this.inputHistoryStart = (this.inputHistoryStart + 1) % INPUT_HISTORY_SIZE;
            this.inputHistoryCount--;
        }
        const slot = this.inputHistory[(this.inputHistoryStart + this.inputHistoryCount) % INPUT_HISTORY_SIZE];
        slot.seq = seq;
        slot.dx = dx;
        slot.dz = dz;
        slot.dt = Math.min(Math.max(dtS, 0), MAX_INPUT_DT_S);
        this.inputHistoryCount++;
    }

    /** Guest: drop every recorded input the host has acknowledged (seq ≤ ackSeq). */
    pruneInputHistory(ackSeq: number): void {
        while (this.inputHistoryCount > 0 && this.inputHistory[this.inputHistoryStart].seq <= ackSeq) {
            this.inputHistoryStart = (this.inputHistoryStart + 1) % INPUT_HISTORY_SIZE;
            this.inputHistoryCount--;
        }
    }

    /** Guest: recorded inputs the host has NOT yet applied (seq > ackSeq), oldest
     *  first. Allocates the result array (called once per snapshot, ~20 Hz — not
     *  per frame); the entries are live ring records, consume synchronously. */
    getUnackedInputs(ackSeq: number): RecordedInput[] {
        const out: RecordedInput[] = [];
        for (let i = 0; i < this.inputHistoryCount; i++) {
            const rec = this.inputHistory[(this.inputHistoryStart + i) % INPUT_HISTORY_SIZE];
            if (rec.seq > ackSeq) out.push(rec);
        }
        return out;
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

    /** Host: send a delta between keyframes (M5-7). */
    sendEnemySnapshotDelta(m: SnapshotDelta): void {
        this.client.sendSnapshotDelta(m);
    }

    /** Broadcast a cosmetic FX the local hero just produced (both roles). */
    sendFx(m: FxMsg): void {
        this.client.sendFx(m);
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
