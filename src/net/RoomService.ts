import type { NetTransport } from './NetTransport';
import { WebSocketTransport } from './WebSocketTransport';

/**
 * RoomService (M5-4) — the boundary between game code and HOW a session is
 * established. Game code depends ONLY on this interface, so a future
 * matchmaking service (a `/queue` DO that pairs strangers) can be dropped in as
 * another implementation without touching the gameplay layer.
 *
 *   - createRoom() mints a private room and returns its join code.
 *   - connect(code) opens a transport to that room (resolves once the relay's
 *     hello assigns this peer a host/guest role).
 *   - connect(code, { resume }) attempts a reconnect into a vacated slot within
 *     the DO's grace window (M5-5); the relay restores the prior role.
 */
export interface ConnectOpts {
    /** Reconnect into a slot vacated within the grace window, reclaiming `role`. */
    resume?: { role: 'host' | 'guest' };
}

export interface RoomService {
    createRoom(): Promise<{ code: string }>;
    connect(code: string, opts?: ConnectOpts): Promise<NetTransport>;
}

/** Today's private-room path: POST /room to mint a code, then WS to /ws/:code. */
export class PrivateRoomService implements RoomService {
    constructor(private readonly origin: string = typeof location !== 'undefined' ? location.origin : '') {}

    async createRoom(): Promise<{ code: string }> {
        const res = await fetch('/room', { method: 'POST' });
        return (await res.json()) as { code: string };
    }

    connect(code: string, opts?: ConnectOpts): Promise<NetTransport> {
        return WebSocketTransport.connect(this.origin, code, opts);
    }
}
