import type { NetRole } from './Protocol';
import type { Channel, IncomingMessage, NetTransport, WireData } from './NetTransport';

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
    /** Backlog cap for the handler-detached window (lobby→game handoff). A peer
     *  streaming ~20 msg/s while we sit in champion select would otherwise grow
     *  this unboundedly; drop the OLDEST on overflow — streams are last-wins. */
    private static readonly BACKLOG_MAX = 512;
    private closeHandler: (() => void) | null = null;
    private closedByUs = false;
    /** The socket dropped unexpectedly BEFORE onClose was registered (possible in
     *  the lobby→game handoff gap, e.g. the peer's host quits while we sit in
     *  champion select). Remembered so a late onClose(cb) still fires. */
    private droppedBeforeHandler = false;

    private constructor(ws: WebSocket, role: NetRole) {
        this.ws = ws;
        this.role = role;
        // M6 E1: snapshots/deltas arrive as binary frames — surface ArrayBuffer
        // (not Blob) so NetClient can DataView-decode synchronously.
        ws.binaryType = 'arraybuffer';
        ws.addEventListener('message', (ev) => {
            const data: WireData = typeof ev.data === 'string' ? ev.data : (ev.data as ArrayBuffer);
            // Swallow the hello frame here (role already resolved); everything
            // else is delivered upward. Channel can't be recovered from a blind
            // relay, so default to 'tick' (events still self-identify by tag).
            const msg: IncomingMessage = { channel: 'tick', data };
            if (this.handler) {
                this.handler(msg);
            } else {
                if (this.backlog.length >= WebSocketTransport.BACKLOG_MAX) this.backlog.shift();
                this.backlog.push(msg);
            }
        });
        // M5-5: surface an unexpected drop (not our own close()) so the game can try
        // to resume the slot within the Room DO's grace window.
        ws.addEventListener('close', () => {
            if (this.closedByUs) return;
            if (this.closeHandler) this.closeHandler();
            else this.droppedBeforeHandler = true;
        });
    }

    /** M5-5: called once when the socket drops unexpectedly (network / server).
     *  If the drop already happened (lobby→game handoff gap), fires immediately. */
    onClose(cb: () => void): void {
        this.closeHandler = cb;
        if (this.droppedBeforeHandler) {
            this.droppedBeforeHandler = false;
            cb();
        }
    }

    /**
     * Open a socket to /ws/:code and resolve after the DO's {t:'hello',role}.
     * @param baseUrl e.g. location.origin; ws/wss is derived automatically.
     */
    static connect(
        baseUrl: string,
        code: string,
        opts?: { resume?: { role: 'host' | 'guest' } },
    ): Promise<WebSocketTransport> {
        // M5-5 reconnect: ?resume=1&role=… asks the Room DO to restore a slot vacated
        // within its grace window (serializeAttachment) instead of reassigning a role.
        const q = opts?.resume ? `?resume=1&role=${opts.resume.role}` : '';
        const wsUrl = baseUrl.replace(/^http/, 'ws') + `/ws/${code}${q}`;
        return new Promise((resolve, reject) => {
            const ws = new WebSocket(wsUrl);
            ws.binaryType = 'arraybuffer'; // before any frame can be delivered
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

    send(_channel: Channel, data: WireData): void {
        if (this.ws.readyState === WebSocket.OPEN) this.ws.send(data);
    }

    onMessage(cb: (m: IncomingMessage) => void): void {
        this.handler = cb;
        const q = this.backlog;
        this.backlog = [];
        for (const m of q) cb(m);
    }

    /** Lobby → game handoff: detach BOTH lobby handlers. Incoming frames buffer
     *  in the backlog again until the game's NetClient installs its onMessage,
     *  and an unexpected drop in the gap is remembered (droppedBeforeHandler)
     *  so the game's later onClose(cb) still fires — instead of the drop being
     *  swallowed by the lobby's stale, gen-gated handler. */
    offMessage(): void {
        this.handler = null;
        this.closeHandler = null;
    }

    close(): void {
        this.closedByUs = true; // a deliberate teardown must not trigger reconnect
        this.ws.close();
    }
}
