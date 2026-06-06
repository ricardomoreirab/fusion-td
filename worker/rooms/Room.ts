/// <reference types="@cloudflare/workers-types" />

const MAX_PEERS = 2;

/**
 * Room — a transient 2-seat byte relay over hibernatable WebSockets.
 * It NEVER parses game messages: whatever one peer sends, the other receives.
 * Role (host/guest) is assigned by join order and persisted via
 * serializeAttachment so it survives DO hibernation.
 */
export class Room {
    constructor(private state: DurableObjectState) {}

    async fetch(request: Request): Promise<Response> {
        if (request.headers.get('Upgrade') !== 'websocket') {
            return new Response('expected websocket', { status: 426 });
        }

        const peers = this.state.getWebSockets();
        if (peers.length >= MAX_PEERS) {
            return new Response('room full', { status: 423 });
        }

        const pair = new WebSocketPair();
        const client = pair[0];
        const server = pair[1];

        // Hibernation: accept so the runtime can evict the DO between messages
        // and still resume our webSocket* handlers.
        this.state.acceptWebSocket(server);

        const role = peers.length === 0 ? 'host' : 'guest';
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

    webSocketClose(ws: WebSocket): void {
        for (const peer of this.state.getWebSockets()) {
            if (peer !== ws) peer.send(JSON.stringify({ t: 'peer-left' }));
        }
    }

    webSocketError(ws: WebSocket): void {
        for (const peer of this.state.getWebSockets()) {
            if (peer !== ws) peer.send(JSON.stringify({ t: 'peer-left' }));
        }
    }
}
