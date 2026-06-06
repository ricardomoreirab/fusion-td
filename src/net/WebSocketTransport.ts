import type { NetRole } from './Protocol';
import type { Channel, IncomingMessage, NetTransport } from './NetTransport';

/**
 * WebSocketTransport — NetTransport over a single WebSocket through the Room DO.
 * Both logical channels share the one stream (the DO is a blind byte relay), so
 * `channel` is carried for parity with a future WebRtcTransport but not split here.
 * Connect via the static factory, which resolves once the DO's hello assigns a role.
 */
export class WebSocketTransport implements NetTransport {
    readonly role: NetRole;
    private ws: WebSocket;
    private handler: ((m: IncomingMessage) => void) | null = null;
    private backlog: IncomingMessage[] = [];

    private constructor(ws: WebSocket, role: NetRole) {
        this.ws = ws;
        this.role = role;
        ws.addEventListener('message', (ev) => {
            const data = typeof ev.data === 'string' ? ev.data : '';
            // Swallow the hello frame here (role already resolved); everything
            // else is delivered upward. Channel can't be recovered from a blind
            // relay, so default to 'tick' (events still self-identify by tag).
            const msg: IncomingMessage = { channel: 'tick', data };
            if (this.handler) this.handler(msg);
            else this.backlog.push(msg);
        });
    }

    /**
     * Open a socket to /ws/:code and resolve after the DO's {t:'hello',role}.
     * @param baseUrl e.g. location.origin; ws/wss is derived automatically.
     */
    static connect(baseUrl: string, code: string): Promise<WebSocketTransport> {
        const wsUrl = baseUrl.replace(/^http/, 'ws') + `/ws/${code}`;
        return new Promise((resolve, reject) => {
            const ws = new WebSocket(wsUrl);
            ws.addEventListener('error', () => reject(new Error('ws error')), { once: true });
            ws.addEventListener('message', function onHello(ev) {
                try {
                    const obj = JSON.parse(typeof ev.data === 'string' ? ev.data : '{}');
                    if (obj && obj.t === 'hello' && (obj.role === 'host' || obj.role === 'guest')) {
                        ws.removeEventListener('message', onHello);
                        resolve(new WebSocketTransport(ws, obj.role));
                    }
                } catch { /* wait for a valid hello */ }
            });
        });
    }

    send(_channel: Channel, data: string): void {
        if (this.ws.readyState === WebSocket.OPEN) this.ws.send(data);
    }

    onMessage(cb: (m: IncomingMessage) => void): void {
        this.handler = cb;
        const q = this.backlog;
        this.backlog = [];
        for (const m of q) cb(m);
    }

    close(): void {
        this.ws.close();
    }
}
