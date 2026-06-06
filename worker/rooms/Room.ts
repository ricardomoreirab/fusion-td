/// <reference types="@cloudflare/workers-types" />

const MAX_PEERS = 2;

interface Attachment { role: 'host' | 'guest' }

/**
 * A vacated slot: the role that dropped and when (Date.now() ms).
 * In-memory only — survives for the duration a live DO instance lives in memory.
 * Under hibernation the DO may be evicted and this is lost, which means a
 * reconnecting peer would re-enter as a fresh join (gets assigned the empty role).
 * A durable version backed by state.storage is a future refinement (M6+).
 */
interface VacatedSlot { role: 'host' | 'guest'; atMs: number }

/**
 * Room — a transient 2-seat byte relay over hibernatable WebSockets.
 * It NEVER parses game messages: whatever one peer sends, the other receives.
 * Role (host/guest) is assigned by join order and persisted via
 * serializeAttachment so it survives DO hibernation.
 *
 * M5 addition: a dropped peer can reclaim its role within the grace window by
 * reconnecting with ?resume=1&role=host|guest. The existing peer is notified
 * via `peer-rejoined`. A genuine 3rd connection (no resume, room full) still
 * gets 423.
 */
export class Room {
    /** In-memory record of the most-recently vacated slot (host or guest). */
    private vacated: VacatedSlot | null = null;

    constructor(private state: DurableObjectState) {}

    async fetch(request: Request): Promise<Response> {
        if (request.headers.get('Upgrade') !== 'websocket') {
            return new Response('expected websocket', { status: 426 });
        }

        const url = new URL(request.url);
        const isResume = url.searchParams.get('resume') === '1';
        const resumeRole = url.searchParams.get('role') as 'host' | 'guest' | null;

        const peers = this.state.getWebSockets();

        // A resume request for a currently-vacated role is allowed even if the
        // live peer count would otherwise reach MAX_PEERS.
        const isValidResume =
            isResume &&
            (resumeRole === 'host' || resumeRole === 'guest') &&
            this.vacated?.role === resumeRole;

        if (peers.length >= MAX_PEERS && !isValidResume) {
            return new Response('room full', { status: 423 });
        }

        const pair = new WebSocketPair();
        const client = pair[0];
        const server = pair[1];

        this.state.acceptWebSocket(server);

        let role: 'host' | 'guest';
        if (isValidResume && resumeRole) {
            // Reclaim the vacated role.
            role = resumeRole;
            this.vacated = null;
            // Notify the surviving peer that their partner is back.
            for (const peer of peers) {
                peer.send(JSON.stringify({ t: 'peer-rejoined', role }));
            }
        } else {
            // Normal first-join path.
            role = peers.length === 0 ? 'host' : 'guest';
        }

        server.serializeAttachment({ role });
        server.send(JSON.stringify({ t: 'hello', role }));

        return new Response(null, { status: 101, webSocket: client });
    }

    // Pure relay — forward bytes to the OTHER peer, never to the sender.
    webSocketMessage(ws: WebSocket, message: ArrayBuffer | string): void {
        for (const peer of this.state.getWebSockets()) {
            if (peer !== ws) peer.send(message);
        }
    }

    private _onPeerGone(ws: WebSocket): void {
        // Record which role just vacated so a reconnect can reclaim it.
        const attachment = ws.deserializeAttachment() as Attachment | null;
        if (attachment?.role) {
            this.vacated = { role: attachment.role, atMs: Date.now() };
        }
        // Notify the surviving peer.
        for (const peer of this.state.getWebSockets()) {
            if (peer !== ws) peer.send(JSON.stringify({ t: 'peer-left' }));
        }
    }

    webSocketClose(ws: WebSocket): void {
        this._onPeerGone(ws);
    }

    webSocketError(ws: WebSocket): void {
        this._onPeerGone(ws);
    }
}
