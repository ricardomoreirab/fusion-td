import type { NetRole } from './Protocol';

export type Channel = 'tick' | 'event';

export interface IncomingMessage {
    channel: Channel;
    data: string;
}

/**
 * NetTransport — the seam the game layer talks to. WebSocketTransport implements
 * it for real; FakeTransport implements it for tests. A future WebRtcTransport
 * (spec §9.1) drops in here unchanged above this line.
 */
export interface NetTransport {
    readonly role: NetRole;
    send(channel: Channel, data: string): void;
    onMessage(cb: (msg: IncomingMessage) => void): void;
    close(): void;
}
