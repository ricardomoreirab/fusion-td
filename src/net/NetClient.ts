import { decode, encode, type HeroStateMsg, type NetRole, type SnapshotMsg, type SpawnMsg, type DeathMsg, type DamageReportMsg, type DamageResultMsg, type InputMsg } from './Protocol';
import type { IncomingMessage, NetTransport } from './NetTransport';

/**
 * NetClient — protocol layer on top of any NetTransport. Owns ping/pong RTT and
 * message dispatch. PURE: the injected `now` clock keeps RTT deterministic in
 * tests; in the browser it defaults to performance.now().
 */
export class NetClient {
    private pingSeq = 0;
    private pendingPings = new Map<number, number>();
    private rttMs = 0;

    onPeerLeft?: () => void;
    onHeroState?: (msg: HeroStateMsg) => void;

    // M3: host-authoritative enemy sync hooks
    onSnapshot?:      (msg: SnapshotMsg)      => void;
    onSpawn?:         (msg: SpawnMsg)         => void;
    onDeath?:         (msg: DeathMsg)         => void;
    onDamageReport?:  (msg: DamageReportMsg)  => void;
    onDamageResult?:  (msg: DamageResultMsg)  => void;
    onRequestState?:  () => void;
    // M4: guest→host per-frame input (replaces pose-copy hero sync).
    onInput?:         (msg: InputMsg)         => void;

    constructor(
        private transport: NetTransport,
        private now: () => number = () => performance.now(),
    ) {
        transport.onMessage((m) => this.handle(m));
    }

    get role(): NetRole {
        return this.transport.role;
    }

    get lastRttMs(): number {
        return this.rttMs;
    }

    sendHeroState(s: Omit<HeroStateMsg, 't'>): void {
        this.transport.send('tick', encode({ t: 'heroState', ...s }));
    }

    // M4: guest sends its input each frame on the 'tick' channel (latest-wins).
    sendInput(m: Omit<InputMsg, 't'>): void {
        this.transport.send('tick', encode({ t: 'input', ...m }));
    }

    // M3 senders
    sendSnapshot(m: SnapshotMsg): void {
        this.transport.send('tick', encode(m));
    }

    sendSpawn(m: SpawnMsg): void {
        this.transport.send('event', encode(m));
    }

    sendRequestState(): void {
        this.transport.send('event', encode({ t: 'requestState' }));
    }

    sendDeath(m: DeathMsg): void {
        this.transport.send('event', encode(m));
    }

    sendDamageReport(m: DamageReportMsg): void {
        this.transport.send('event', encode(m));
    }

    sendDamageResult(m: DamageResultMsg): void {
        this.transport.send('event', encode(m));
    }

    sendPing(): void {
        const seq = ++this.pingSeq;
        const sent = this.now();
        this.pendingPings.set(seq, sent);
        this.transport.send('tick', encode({ t: 'ping', seq, sent }));
    }

    close(): void {
        this.transport.close();
    }

    private handle(m: IncomingMessage): void {
        let msg;
        try {
            msg = decode(m.data);
        } catch {
            return;
        }
        switch (msg.t) {
            case 'ping':
                this.transport.send('tick', encode({ t: 'pong', seq: msg.seq, sent: msg.sent }));
                break;
            case 'pong': {
                const sentLocal = this.pendingPings.get(msg.seq);
                if (sentLocal !== undefined) {
                    this.rttMs = this.now() - sentLocal;
                    this.pendingPings.delete(msg.seq);
                }
                break;
            }
            case 'peer-left':
                this.onPeerLeft?.();
                break;
            case 'heroState':
                this.onHeroState?.(msg);
                break;
            case 'snapshot':
                this.onSnapshot?.(msg);
                break;
            case 'spawn':
                this.onSpawn?.(msg);
                break;
            case 'death':
                this.onDeath?.(msg);
                break;
            case 'damageReport':
                this.onDamageReport?.(msg);
                break;
            case 'damageResult':
                this.onDamageResult?.(msg);
                break;
            case 'requestState':
                this.onRequestState?.();
                break;
            case 'input':
                this.onInput?.(msg);
                break;
            case 'hello':
                break;
        }
    }
}
