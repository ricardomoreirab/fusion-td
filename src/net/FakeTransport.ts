import type { NetRole } from './Protocol';
import type { Channel, IncomingMessage, NetTransport } from './NetTransport';

/**
 * In-memory NetTransport pair for unit tests. Delivery is manual: send() queues
 * into the PEER's inbox; the peer's flush() delivers to its handler. Manual
 * flush lets tests advance an injected clock between send and delivery (so RTT
 * and interpolation are deterministic).
 */
export class FakeTransport implements NetTransport {
    readonly role: NetRole;
    peer: FakeTransport | null = null;
    private queue: IncomingMessage[] = [];
    private handler: ((m: IncomingMessage) => void) | null = null;

    constructor(role: NetRole) {
        this.role = role;
    }

    static pair(): [FakeTransport, FakeTransport] {
        const host = new FakeTransport('host');
        const guest = new FakeTransport('guest');
        host.peer = guest;
        guest.peer = host;
        return [host, guest];
    }

    send(channel: Channel, data: string): void {
        this.peer?.queue.push({ channel, data });
    }

    onMessage(cb: (m: IncomingMessage) => void): void {
        this.handler = cb;
    }

    /** Test-only: deliver all queued inbound messages to the handler. */
    flush(): void {
        const q = this.queue;
        this.queue = [];
        for (const m of q) this.handler?.(m);
    }

    close(): void {
        this.peer = null;
    }
}
