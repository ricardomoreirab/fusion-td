import type { NetRole } from './Protocol';

export type Channel = 'tick' | 'event';

/** Wire payload: JSON text for events, binary frames for snapshots/deltas (M6 E1). */
export type WireData = string | ArrayBuffer;

export interface IncomingMessage {
    channel: Channel;
    data: WireData;
}

/**
 * NetTransport — the seam the game layer talks to. WebSocketTransport implements
 * it for real; FakeTransport implements it for tests. A future WebRtcTransport
 * (spec §9.1) drops in here unchanged above this line.
 */
export interface NetTransport {
    readonly role: NetRole;
    send(channel: Channel, data: WireData): void;
    onMessage(cb: (msg: IncomingMessage) => void): void;
    /** Detach the current onMessage handler and return to backlog buffering.
     *  Used by the menu lobby when handing a live transport to the game: frames
     *  arriving between the handoff and NetClient's onMessage are buffered, not
     *  delivered to a dead lobby handler. Optional — only the lobby needs it. */
    offMessage?(): void;
    /** M5-5: fired once on an unexpected drop (not a deliberate close()). Optional —
     *  the FakeTransport test double doesn't model network loss. */
    onClose?(cb: () => void): void;
    close(): void;
}
