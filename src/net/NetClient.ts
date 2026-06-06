import { decode, encode, type HeroStateMsg, type NetRole } from './Protocol';
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
            case 'hello':
                break;
        }
    }
}
