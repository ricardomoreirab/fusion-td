# Online Co-op M1 + M2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the Cloudflare Durable Object co-op relay + a transport-abstracted client net layer (M1), then render a live interpolated "ghost teammate" in the arena under a shared/tethered camera (M2) — with zero behavior change to single-player.

**Architecture:** A `Room` Durable Object is a pure byte relay between two WebSockets (no game logic). The client talks to it only through a `NetTransport` interface, implemented by `WebSocketTransport` (prod) and `FakeTransport` (tests). `NetClient` adds role/ping-pong/dispatch on top. In M2 each client keeps running its own single-player sim and broadcasts its hero pose; each renders the other's hero as an interpolated ghost `Champion`, and the camera frames both via a pure `computeCameraFocus` helper wired through a new focus-provider hook in `HeroController`.

**Tech Stack:** TypeScript, Cloudflare Workers + Durable Objects (hibernatable WebSockets), Babylon.js, Vitest (pure-logic tests), webpack (client), wrangler (worker/deploy).

**Spec:** `docs/superpowers/specs/2026-06-06-online-coop-design.md` (this plan implements milestones M1 + M2 of §13).

---

## Conventions (read once)

- **Run unit tests:** `npm test` (Vitest, `tests/**/*.spec.ts`, node env — NO Babylon imports allowed in tested modules).
- **Type-check client:** `npx tsc --noEmit` (covers `src/**`; the `worker/**` tree is built by wrangler, not tsc).
- **Run the worker locally (DO + assets + leaderboard):** `npm run build` then `npx wrangler dev` → serves at the printed localhost port. The `Room` DO works in `wrangler dev` local mode.
- **Pure-logic rule:** everything under `src/net/**` that is unit-tested MUST NOT import `@babylonjs/core` (keeps it inside the Vitest harness). Babylon-touching code (`CameraManager` scene apply, `CoopSession` ghost spawn, `SurvivorsGameplayState` edits) is verified manually, not in Vitest — its pure helpers are extracted and tested separately.
- **Commit after every task** (frequent commits). Branch is `feat/online-coop` (already checked out).

## File structure (locked before tasks)

**M1 — relay + transport (mostly new, isolated):**
- `wrangler.jsonc` *(modify)* — add `durable_objects` binding + `migrations`.
- `worker/rooms/Room.ts` *(create)* — the relay Durable Object.
- `worker/index.ts` *(modify)* — `Env.ROOMS`, `POST /room`, `GET /ws/:code`, `makeRoomCode`, re-export `Room`.
- `src/net/Protocol.ts` *(create)* — message types + JSON encode/decode (PURE).
- `src/net/NetTransport.ts` *(create)* — `NetTransport` interface + `Channel`/`NetRole`/`IncomingMessage` types (PURE).
- `src/net/FakeTransport.ts` *(create)* — in-memory paired transport for tests (PURE).
- `src/net/NetClient.ts` *(create)* — role + ping/pong RTT + dispatch on a `NetTransport` (PURE).
- `src/net/WebSocketTransport.ts` *(create)* — browser WebSocket `NetTransport` (Babylon-free, but browser-only → manual verify).
- `src/net/coopDebug.ts` *(create)* — URL-param-gated two-tab echo panel (manual demo harness).
- `src/index.ts` *(modify)* — mount the debug panel when `?coopdebug` is present.
- Tests: `tests/netProtocol.spec.ts`, `tests/netFakeTransport.spec.ts`, `tests/netClient.spec.ts`.

**M2 — ghost teammate (additive):**
- `src/net/Protocol.ts` *(modify)* — add `HeroStateMsg`.
- `src/net/Interpolation.ts` *(create)* — pure pose interpolation buffer.
- `src/survivors/coop/cameraFocus.ts` *(create)* — pure `computeCameraFocus(a, b, opts)`.
- `src/survivors/coop/CoopSession.ts` *(create)* — owns `NetClient`; sends local pose; exposes interpolated remote pose + champ (Babylon-free).
- `src/survivors/HeroController.ts` *(modify)* — add a camera focus-provider hook (one field + a few lines).
- `src/survivors/SurvivorsGameplayState.ts` *(modify)* — read co-op URL params, build `CoopSession` in `startRun`, spawn + drive the ghost `Champion`, wire the camera focus.
- Tests: `tests/netHeroState.spec.ts`, `tests/netInterpolation.spec.ts`, `tests/cameraFocus.spec.ts`.

---

# Milestone 1 — Echo connection (infra + transport)

### Task 1: wrangler config — Durable Object binding + migration

**Files:**
- Modify: `wrangler.jsonc`

- [ ] **Step 1: Add the DO binding and migration**

Open `wrangler.jsonc`. After the `d1_databases` array (keep everything else unchanged), add two top-level keys so the file reads:

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "fusion-td",
  "main": "worker/index.ts",
  "compatibility_date": "2025-09-27",
  "observability": {
    "enabled": true
  },
  "assets": {
    "directory": "dist",
    "binding": "ASSETS"
  },
  "compatibility_flags": [
    "nodejs_compat"
  ],
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "fusion-td-leaderboard",
      "database_id": "7a3d8834-18bb-467b-abb8-295e2707558d"
    }
  ],
  "durable_objects": {
    "bindings": [
      { "name": "ROOMS", "class_name": "Room" }
    ]
  },
  "migrations": [
    { "tag": "v1", "new_sqlite_classes": ["Room"] }
  ]
}
```

(`new_sqlite_classes` is the free-tier-eligible DO flavor; we don't use storage, but this is the correct migration form.)

- [ ] **Step 2: Verify config parses (the class doesn't exist yet, so a dry-run will complain about the missing export — that's expected until Task 2).**

Run: `npx wrangler deploy --dry-run --outdir /tmp/wrangler-dryrun 2>&1 | head -20`
Expected: an error mentioning that `Room` is referenced but not exported (or a bundling error pointing at `worker/index.ts`). This confirms wrangler *parsed* the new config. We fix the export in Task 2.

- [ ] **Step 3: Commit**

```bash
git add wrangler.jsonc
git commit -m "chore(coop): wire ROOMS durable object binding + migration"
```

---

### Task 2: The `Room` relay Durable Object

**Files:**
- Create: `worker/rooms/Room.ts`
- Modify: `worker/index.ts` (re-export `Room`, extend `Env`)

> Not unit-testable in our Vitest harness (needs the Workers runtime). Verified by `wrangler dev` in Task 3/8.

- [ ] **Step 1: Create the Durable Object**

Create `worker/rooms/Room.ts`:

```ts
/// <reference types="@cloudflare/workers-types" />

export interface RoomEnv {
    // Room needs no bindings of its own today; kept for future use.
}

const MAX_PEERS = 2;

/**
 * Room — a transient 2-seat byte relay over hibernatable WebSockets.
 * It NEVER parses game messages: whatever one peer sends, the other receives.
 * Role (host/guest) is assigned by join order and persisted via
 * serializeAttachment so it survives DO hibernation.
 */
export class Room {
    constructor(private state: DurableObjectState, private env: RoomEnv) {}

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
```

- [ ] **Step 2: Re-export `Room` and extend `Env` in the worker entry**

In `worker/index.ts`, add the re-export right after the existing top imports (line 2 area) and extend the `Env` interface:

```ts
/// <reference types="@cloudflare/workers-types" />
import { validateScore, type LeaderboardEntry } from '../src/survivors/leaderboardValidation';

export { Room } from './rooms/Room';

interface Env {
    ASSETS: Fetcher;
    DB: D1Database;
    ROOMS: DurableObjectNamespace;
}
```

- [ ] **Step 3: Verify it bundles**

Run: `npx wrangler deploy --dry-run --outdir /tmp/wrangler-dryrun 2>&1 | tail -20`
Expected: a successful dry-run (no "Room not exported" error). It prints the bundled output summary. (No real deploy happens with `--dry-run`.)

- [ ] **Step 4: Commit**

```bash
git add worker/rooms/Room.ts worker/index.ts
git commit -m "feat(coop): add Room durable object byte relay"
```

---

### Task 3: Worker routes — create room + WebSocket upgrade

**Files:**
- Modify: `worker/index.ts`

- [ ] **Step 1: Add `makeRoomCode` helper**

In `worker/index.ts`, add this helper next to the existing `json()` helper (after line 23):

```ts
function makeRoomCode(): string {
    // Unambiguous alphabet: no I/O/0/1.
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const bytes = new Uint8Array(6);
    crypto.getRandomValues(bytes);
    let code = '';
    for (let i = 0; i < 6; i++) code += alphabet[bytes[i] % alphabet.length];
    return code;
}
```

- [ ] **Step 2: Add the two routes BEFORE the `/api/scores` block**

In the `fetch` handler, insert these immediately after `const url = new URL(request.url);` (currently line 79), so they take precedence over the `ASSETS` fallthrough:

```ts
        // --- Co-op room routes (must run before ASSETS fallthrough) ---
        if (url.pathname === '/room' && request.method === 'POST') {
            return json({ code: makeRoomCode() }, 200);
        }
        const wsMatch = url.pathname.match(/^\/ws\/([A-Z2-9]{6})$/);
        if (wsMatch) {
            if (request.headers.get('Upgrade') !== 'websocket') {
                return new Response('expected websocket', { status: 426 });
            }
            const id = env.ROOMS.idFromName(wsMatch[1]);
            return env.ROOMS.get(id).fetch(request);
        }
```

- [ ] **Step 3: Smoke-test the create-room route locally**

Run (in one terminal): `npm run build && npx wrangler dev`
Then (in another): `curl -s -X POST http://localhost:8787/room`
Expected: `{"code":"XXXXXX"}` with a 6-char A–Z/2–9 code. (Port may differ — use the one `wrangler dev` prints.)

- [ ] **Step 4: Confirm the leaderboard still works (no regression)**

Run: `curl -s http://localhost:8787/api/scores`
Expected: `{"scores":[...]}` (same as before — routes are additive). Stop `wrangler dev` (Ctrl-C).

- [ ] **Step 5: Commit**

```bash
git add worker/index.ts
git commit -m "feat(coop): /room create + /ws/:code upgrade routes"
```

---

### Task 4: Protocol — message types + JSON codec (PURE, TDD)

**Files:**
- Create: `src/net/Protocol.ts`
- Test: `tests/netProtocol.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/netProtocol.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { encode, decode, type NetMessage } from '../src/net/Protocol';

describe('Protocol codec', () => {
    it('round-trips a ping message', () => {
        const msg: NetMessage = { t: 'ping', seq: 7, sent: 1234.5 };
        expect(decode(encode(msg))).toEqual(msg);
    });

    it('round-trips a hello message', () => {
        const msg: NetMessage = { t: 'hello', role: 'guest' };
        expect(decode(encode(msg))).toEqual(msg);
    });

    it('throws on malformed json', () => {
        expect(() => decode('not json')).toThrow();
    });

    it('throws on an unknown message tag', () => {
        expect(() => decode(JSON.stringify({ t: 'bogus' }))).toThrow(/unknown/i);
    });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- netProtocol`
Expected: FAIL — `Cannot find module '../src/net/Protocol'`.

- [ ] **Step 3: Write the minimal implementation**

Create `src/net/Protocol.ts`:

```ts
// Wire protocol for co-op. JSON for M1–M2 (binary comes at M3, behind the same
// encode/decode boundary). PURE — no Babylon, no DOM, safe for the Vitest harness.

export type NetRole = 'host' | 'guest';

export interface HelloMsg { t: 'hello'; role: NetRole }
export interface PeerLeftMsg { t: 'peer-left' }
export interface PingMsg { t: 'ping'; seq: number; sent: number }
export interface PongMsg { t: 'pong'; seq: number; sent: number }

export type NetMessage = HelloMsg | PeerLeftMsg | PingMsg | PongMsg;

const KNOWN_TAGS = new Set(['hello', 'peer-left', 'ping', 'pong']);

export function encode(msg: NetMessage): string {
    return JSON.stringify(msg);
}

export function decode(raw: string): NetMessage {
    const obj = JSON.parse(raw) as { t?: unknown };
    if (typeof obj.t !== 'string' || !KNOWN_TAGS.has(obj.t)) {
        throw new Error(`unknown message tag: ${String(obj.t)}`);
    }
    return obj as NetMessage;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- netProtocol`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/net/Protocol.ts tests/netProtocol.spec.ts
git commit -m "feat(coop): net Protocol message codec"
```

---

### Task 5: NetTransport interface + FakeTransport (PURE, TDD)

**Files:**
- Create: `src/net/NetTransport.ts`
- Create: `src/net/FakeTransport.ts`
- Test: `tests/netFakeTransport.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/netFakeTransport.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { FakeTransport } from '../src/net/FakeTransport';
import type { IncomingMessage } from '../src/net/NetTransport';

describe('FakeTransport', () => {
    it('assigns host/guest roles to the pair', () => {
        const [host, guest] = FakeTransport.pair();
        expect(host.role).toBe('host');
        expect(guest.role).toBe('guest');
    });

    it('delivers a sent message to the peer only after flush', () => {
        const [host, guest] = FakeTransport.pair();
        const received: IncomingMessage[] = [];
        guest.onMessage((m) => received.push(m));

        host.send('tick', 'hi');
        expect(received).toEqual([]);      // queued, not yet delivered
        guest.flush();
        expect(received).toEqual([{ channel: 'tick', data: 'hi' }]);
    });

    it('does not echo a message back to the sender', () => {
        const [host, guest] = FakeTransport.pair();
        const hostRx: IncomingMessage[] = [];
        host.onMessage((m) => hostRx.push(m));
        host.send('event', 'x');
        host.flush();
        expect(hostRx).toEqual([]);
    });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- netFakeTransport`
Expected: FAIL — cannot find `../src/net/FakeTransport`.

- [ ] **Step 3: Write the interface**

Create `src/net/NetTransport.ts`:

```ts
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
```

- [ ] **Step 4: Write FakeTransport**

Create `src/net/FakeTransport.ts`:

```ts
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
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- netFakeTransport`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/net/NetTransport.ts src/net/FakeTransport.ts tests/netFakeTransport.spec.ts
git commit -m "feat(coop): NetTransport interface + FakeTransport"
```

---

### Task 6: NetClient — role + ping/pong RTT + dispatch (PURE, TDD)

**Files:**
- Create: `src/net/NetClient.ts`
- Test: `tests/netClient.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/netClient.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { FakeTransport } from '../src/net/FakeTransport';
import { NetClient } from '../src/net/NetClient';

describe('NetClient', () => {
    it('exposes the transport role', () => {
        const [host, guest] = FakeTransport.pair();
        expect(new NetClient(host).role).toBe('host');
        expect(new NetClient(guest).role).toBe('guest');
    });

    it('auto-replies pong to a ping and measures RTT against an injected clock', () => {
        const [host, guest] = FakeTransport.pair();
        let tHost = 1000;
        const ca = new NetClient(host, () => tHost);
        const cb = new NetClient(guest); // peer just needs to answer

        ca.sendPing();        // records sent=1000, queues ping into guest inbox
        guest.flush();        // guest handles ping → queues pong into host inbox
        tHost = 1050;         // 50ms elapse before the pong is processed
        host.flush();         // host handles pong → rtt = 1050 - 1000

        expect(ca.lastRttMs).toBe(50);
    });

    it('notifies peer-left', () => {
        const [host, guest] = FakeTransport.pair();
        let left = false;
        const ca = new NetClient(host);
        ca.onPeerLeft = () => { left = true; };
        // guest "leaves": simulate the relay's peer-left notice arriving at host
        guest.send('event', JSON.stringify({ t: 'peer-left' }));
        host.flush();
        expect(left).toBe(true);
    });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- netClient`
Expected: FAIL — cannot find `../src/net/NetClient`.

- [ ] **Step 3: Write the implementation**

Create `src/net/NetClient.ts`:

```ts
import { decode, encode, type NetRole } from './Protocol';
import type { IncomingMessage, NetTransport } from './NetTransport';

/**
 * NetClient — protocol layer on top of any NetTransport. Owns ping/pong RTT and
 * message dispatch. PURE: the injected `now` clock keeps RTT deterministic in
 * tests; in the browser it defaults to performance.now().
 */
export class NetClient {
    private pingSeq = 0;
    private pendingPings = new Map<number, number>(); // seq -> local send time
    private rttMs = 0;

    onPeerLeft?: () => void;

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
            return; // ignore malformed/unknown frames
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
            case 'hello':
                break;
        }
    }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- netClient`
Expected: PASS (3 tests).

- [ ] **Step 5: Type-check the whole client**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/net/NetClient.ts tests/netClient.spec.ts
git commit -m "feat(coop): NetClient ping/pong RTT + dispatch"
```

---

### Task 7: WebSocketTransport (browser, manual verify)

**Files:**
- Create: `src/net/WebSocketTransport.ts`

> Browser-only (uses `WebSocket`), so it can't run in the Vitest node harness. Verified via the two-tab demo in Task 8.

- [ ] **Step 1: Write the implementation**

Create `src/net/WebSocketTransport.ts`:

```ts
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
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/net/WebSocketTransport.ts
git commit -m "feat(coop): WebSocketTransport over the Room relay"
```

---

### Task 8: Two-tab echo debug panel + M1 demo

**Files:**
- Create: `src/net/coopDebug.ts`
- Modify: `src/index.ts`

> This is the M1 acceptance demo (manual). The panel: tab A clicks "Host" (POSTs /room, connects, shows code); tab B pastes the code, clicks "Join", connects; either side clicks "Ping" and sees the round-trip ms.

- [ ] **Step 1: Write the debug panel**

Create `src/net/coopDebug.ts`:

```ts
import { NetClient } from './NetClient';
import { WebSocketTransport } from './WebSocketTransport';

/**
 * Minimal DOM panel to exercise the relay with two browser tabs. Mounted only
 * when `?coopdebug` is in the URL (see src/index.ts). Not part of the game.
 */
export function mountCoopDebug(): void {
    const panel = document.createElement('div');
    panel.style.cssText =
        'position:fixed;top:12px;left:12px;z-index:99999;background:#101018ee;color:#e8e8f0;' +
        'font:13px monospace;padding:12px;border:1px solid #444;border-radius:8px;width:260px';
    panel.innerHTML = `
        <div style="font-weight:bold;margin-bottom:8px">co-op relay debug</div>
        <button id="cd-host">Host</button>
        <input id="cd-code" placeholder="CODE" size="7" style="text-transform:uppercase"/>
        <button id="cd-join">Join</button>
        <button id="cd-ping" disabled>Ping</button>
        <pre id="cd-log" style="white-space:pre-wrap;margin:8px 0 0;max-height:160px;overflow:auto"></pre>`;
    document.body.appendChild(panel);

    const log = (s: string) => {
        const el = panel.querySelector('#cd-log') as HTMLPreElement;
        el.textContent = `${s}\n${el.textContent ?? ''}`;
    };
    let client: NetClient | null = null;

    const wire = (c: NetClient) => {
        client = c;
        (panel.querySelector('#cd-ping') as HTMLButtonElement).disabled = false;
        c.onPeerLeft = () => log('peer-left');
        log(`connected as ${c.role}`);
    };

    (panel.querySelector('#cd-host') as HTMLButtonElement).onclick = async () => {
        const res = await fetch('/room', { method: 'POST' });
        const { code } = await res.json();
        log(`room ${code} — share it`);
        (panel.querySelector('#cd-code') as HTMLInputElement).value = code;
        wire(new NetClient(await WebSocketTransport.connect(location.origin, code)));
    };

    (panel.querySelector('#cd-join') as HTMLButtonElement).onclick = async () => {
        const code = (panel.querySelector('#cd-code') as HTMLInputElement).value.trim().toUpperCase();
        if (code.length !== 6) return log('enter a 6-char code');
        wire(new NetClient(await WebSocketTransport.connect(location.origin, code)));
    };

    (panel.querySelector('#cd-ping') as HTMLButtonElement).onclick = () => {
        if (!client) return;
        client.sendPing();
        // RTT updates when the pong arrives; show it shortly after.
        setTimeout(() => log(`rtt ${client!.lastRttMs.toFixed(1)} ms`), 120);
    };
}
```

- [ ] **Step 2: Mount it from the bootstrap when `?coopdebug` is present**

In `src/index.ts`, inside the `DOMContentLoaded` handler, after `game.start()...`, add:

```ts
    if (new URLSearchParams(window.location.search).has('coopdebug')) {
        import('./net/coopDebug').then((m) => m.mountCoopDebug());
    }
```

- [ ] **Step 3: Type-check + unit tests still green**

Run: `npx tsc --noEmit && npm test`
Expected: tsc clean; all tests pass.

- [ ] **Step 4: M1 DEMO — two-tab echo through the DO**

Run: `npm run build && npx wrangler dev`
- Open two browser tabs at `http://localhost:8787/?coopdebug` (use the printed port).
- Tab A: click **Host** → a code appears, log shows `connected as host`.
- Tab B: type the code, click **Join** → log shows `connected as guest`.
- Either tab: click **Ping** → log shows `rtt <n> ms`.
- Close one tab → the other logs `peer-left`.
- Confirm a 3rd tab joining the same code fails to connect (DO returns 423).

Expected: all of the above hold. This is the M1 acceptance criterion.

- [ ] **Step 5: Commit**

```bash
git add src/net/coopDebug.ts src/index.ts
git commit -m "feat(coop): two-tab relay echo debug panel (M1 demo)"
```

---

# Milestone 2 — Ghost teammate

Both clients keep running their own single-player sim. Each broadcasts its hero pose ~20 Hz; each renders the other's hero as an interpolated ghost `Champion`, framed by a shared camera. No shared enemies yet (that's M3).

### Task 9: HeroState message + codec (PURE, TDD)

**Files:**
- Modify: `src/net/Protocol.ts`
- Test: `tests/netHeroState.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/netHeroState.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { encode, decode, type NetMessage } from '../src/net/Protocol';

describe('HeroState message', () => {
    it('round-trips a heroState message', () => {
        const msg: NetMessage = {
            t: 'heroState', seq: 3, x: 1.5, y: 2, z: -4.25, ry: 0.7,
            champ: 'ranger', anim: 1,
        };
        expect(decode(encode(msg))).toEqual(msg);
    });

    it('is accepted as a known tag', () => {
        expect(() => decode(JSON.stringify({ t: 'heroState', seq: 0, x: 0, y: 0, z: 0, ry: 0, champ: 'mage', anim: 0 }))).not.toThrow();
    });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- netHeroState`
Expected: FAIL — `heroState` is an unknown tag (decode throws).

- [ ] **Step 3: Extend the protocol**

In `src/net/Protocol.ts`, add the interface, extend the union, and add the tag:

```ts
export interface HeroStateMsg {
    t: 'heroState';
    seq: number;
    x: number; y: number; z: number;
    ry: number;
    champ: string;   // 'barbarian' | 'ranger' | 'mage'
    anim: number;    // 0 idle, 1 run (M2 keeps it minimal)
}
```

Update the union and tag set:

```ts
export type NetMessage = HelloMsg | PeerLeftMsg | PingMsg | PongMsg | HeroStateMsg;

const KNOWN_TAGS = new Set(['hello', 'peer-left', 'ping', 'pong', 'heroState']);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- netHeroState netProtocol`
Expected: PASS (both files).

- [ ] **Step 5: Commit**

```bash
git add src/net/Protocol.ts tests/netHeroState.spec.ts
git commit -m "feat(coop): HeroState wire message"
```

---

### Task 10: Pose interpolation buffer (PURE, TDD)

**Files:**
- Create: `src/net/Interpolation.ts`
- Test: `tests/netInterpolation.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/netInterpolation.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { PoseBuffer, type Pose } from '../src/net/Interpolation';

const pose = (x: number, z: number, ry = 0): Pose => ({ x, y: 0, z, ry });

describe('PoseBuffer', () => {
    it('returns null before any sample', () => {
        expect(new PoseBuffer().sample(0)).toBeNull();
    });

    it('returns the only sample when just one exists', () => {
        const b = new PoseBuffer();
        b.push(100, pose(2, 4));
        expect(b.sample(100)).toEqual(pose(2, 4));
    });

    it('linearly interpolates between two samples at the render time', () => {
        const b = new PoseBuffer();
        b.push(100, pose(0, 0));
        b.push(200, pose(10, -20));
        // halfway in time → halfway in space
        expect(b.sample(150)).toEqual(pose(5, -10));
    });

    it('clamps to the latest sample when render time is past it', () => {
        const b = new PoseBuffer();
        b.push(100, pose(0, 0));
        b.push(200, pose(10, 0));
        expect(b.sample(999)).toEqual(pose(10, 0));
    });

    it('interpolates rotation along the shortest arc across the PI wrap', () => {
        const b = new PoseBuffer();
        b.push(0, pose(0, 0, 3.0));        // ~3.0 rad
        b.push(100, pose(0, 0, -3.0));     // ~-3.0 rad; shortest path wraps through PI
        const out = b.sample(50)!;
        // midpoint of the shortest arc sits near +PI (or -PI), NOT near 0.
        expect(Math.abs(Math.abs(out.ry) - Math.PI)).toBeLessThan(0.15);
    });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- netInterpolation`
Expected: FAIL — cannot find `../src/net/Interpolation`.

- [ ] **Step 3: Write the implementation**

Create `src/net/Interpolation.ts`:

```ts
// Pure pose interpolation buffer for the ghost teammate. No Babylon — operates
// on plain {x,y,z,ry}. The render side reads sample(renderTimeMs) each frame.

export interface Pose { x: number; y: number; z: number; ry: number }

interface Stamped { t: number; p: Pose }

function lerp(a: number, b: number, k: number): number {
    return a + (b - a) * k;
}

/** Interpolate an angle along the shortest arc. */
function lerpAngle(a: number, b: number, k: number): number {
    let d = b - a;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return a + d * k;
}

export class PoseBuffer {
    private samples: Stamped[] = [];
    private maxSamples = 32;

    push(t: number, p: Pose): void {
        this.samples.push({ t, p });
        if (this.samples.length > this.maxSamples) this.samples.shift();
    }

    /** Interpolated pose at render time `t` (ms), or null if no samples yet. */
    sample(t: number): Pose | null {
        const s = this.samples;
        if (s.length === 0) return null;
        if (s.length === 1) return { ...s[0].p };
        if (t <= s[0].t) return { ...s[0].p };
        const last = s[s.length - 1];
        if (t >= last.t) return { ...last.p };

        // find the bracketing pair
        for (let i = 0; i < s.length - 1; i++) {
            const a = s[i], b = s[i + 1];
            if (t >= a.t && t <= b.t) {
                const k = (t - a.t) / (b.t - a.t);
                return {
                    x: lerp(a.p.x, b.p.x, k),
                    y: lerp(a.p.y, b.p.y, k),
                    z: lerp(a.p.z, b.p.z, k),
                    ry: lerpAngle(a.p.ry, b.p.ry, k),
                };
            }
        }
        return { ...last.p };
    }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- netInterpolation`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/net/Interpolation.ts tests/netInterpolation.spec.ts
git commit -m "feat(coop): pure pose interpolation buffer"
```

---

### Task 11: Shared camera focus math (PURE, TDD)

**Files:**
- Create: `src/survivors/coop/cameraFocus.ts`
- Test: `tests/cameraFocus.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/cameraFocus.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { computeCameraFocus } from '../src/survivors/coop/cameraFocus';

const OPTS = { baseHeight: 20, maxHeight: 30, zoomPerUnit: 0.5 };

describe('computeCameraFocus', () => {
    it('falls back to the single hero when there is no teammate', () => {
        const f = computeCameraFocus({ x: 3, z: 7 }, null, OPTS);
        expect(f.x).toBe(3);
        expect(f.z).toBe(7);
        expect(f.height).toBe(20);
    });

    it('centers on the midpoint of two heroes', () => {
        const f = computeCameraFocus({ x: 0, z: 0 }, { x: 10, z: -4 }, OPTS);
        expect(f.x).toBe(5);
        expect(f.z).toBe(-2);
    });

    it('zooms out (raises height) as the heroes separate, capped at maxHeight', () => {
        const near = computeCameraFocus({ x: 0, z: 0 }, { x: 2, z: 0 }, OPTS);
        const far = computeCameraFocus({ x: 0, z: 0 }, { x: 100, z: 0 }, OPTS);
        expect(near.height).toBeGreaterThan(20);     // 20 + 2*0.5 = 21
        expect(near.height).toBeCloseTo(21, 5);
        expect(far.height).toBe(30);                 // capped
    });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- cameraFocus`
Expected: FAIL — cannot find `../src/survivors/coop/cameraFocus`.

- [ ] **Step 3: Write the implementation**

Create `src/survivors/coop/cameraFocus.ts`:

```ts
// Pure camera-framing math for the shared/tethered co-op camera. No Babylon —
// returns a plain focus point + height the scene layer applies to the camera.

export interface Point2 { x: number; z: number }
export interface FocusOpts { baseHeight: number; maxHeight: number; zoomPerUnit: number }
export interface Focus { x: number; z: number; height: number }

/**
 * Frame one or two heroes. With a teammate, focus on the midpoint and raise the
 * camera height proportional to their separation (zoom-to-fit), capped.
 */
export function computeCameraFocus(self: Point2, mate: Point2 | null, opts: FocusOpts): Focus {
    if (!mate) {
        return { x: self.x, z: self.z, height: opts.baseHeight };
    }
    const midX = (self.x + mate.x) / 2;
    const midZ = (self.z + mate.z) / 2;
    const sep = Math.hypot(self.x - mate.x, self.z - mate.z);
    const height = Math.min(opts.maxHeight, opts.baseHeight + sep * opts.zoomPerUnit);
    return { x: midX, z: midZ, height };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- cameraFocus`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/survivors/coop/cameraFocus.ts tests/cameraFocus.spec.ts
git commit -m "feat(coop): pure shared-camera focus math"
```

---

### Task 12: CoopSession — broadcast local pose, track interpolated remote (TDD via FakeTransport)

**Files:**
- Create: `src/survivors/coop/CoopSession.ts`
- Test: `tests/coopSession.spec.ts`

> Babylon-free on purpose: `CoopSession` deals only in plain poses + champ strings, so the scene layer (Task 13) reads from it. That keeps it inside the Vitest harness.

- [ ] **Step 1: Write the failing test**

Create `tests/coopSession.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { FakeTransport } from '../src/net/FakeTransport';
import { NetClient } from '../src/net/NetClient';
import { CoopSession } from '../src/survivors/coop/CoopSession';

describe('CoopSession', () => {
    it('sends the local hero pose to the peer', () => {
        const [a, b] = FakeTransport.pair();
        const host = new CoopSession(new NetClient(a), 'barbarian', () => 0);
        const guestClient = new NetClient(b);
        let got: any = null;
        // tap raw heroState arriving at the guest
        guestClient.onHeroState = (m) => { got = m; };

        host.sendLocalPose({ x: 1, y: 2, z: 3, ry: 0.5 }, 1 /* anim */);
        b.flush();

        expect(got).toMatchObject({ t: 'heroState', x: 1, z: 3, champ: 'barbarian' });
    });

    it('exposes the remote champ + interpolated remote pose from received messages', () => {
        const [a, b] = FakeTransport.pair();
        let tGuest = 0;
        const guest = new CoopSession(new NetClient(b), 'mage', () => tGuest);
        const hostClient = new NetClient(a);

        // host sends two poses 100ms apart
        tGuest = 1000;
        hostClient.sendHeroState({ seq: 1, x: 0, y: 0, z: 0, ry: 0, champ: 'ranger', anim: 1 });
        b.flush();
        tGuest = 1100;
        hostClient.sendHeroState({ seq: 2, x: 10, y: 0, z: 0, ry: 0, champ: 'ranger', anim: 1 });
        b.flush();

        expect(guest.getRemoteChamp()).toBe('ranger');
        // render slightly in the past (interpolation delay) → between the two
        const pose = guest.getRemotePose(1050);
        expect(pose).not.toBeNull();
        expect(pose!.x).toBeGreaterThan(0);
        expect(pose!.x).toBeLessThan(10);
    });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- coopSession`
Expected: FAIL — cannot find `CoopSession`, and `NetClient.onHeroState`/`sendHeroState` don't exist yet (added in Step 3 + 4).

- [ ] **Step 3: Add HeroState send/receive to NetClient**

In `src/net/NetClient.ts`, import the type and add a handler hook + sender. Change the import line:

```ts
import { decode, encode, type HeroStateMsg, type NetRole } from './Protocol';
```

Add a public hook next to `onPeerLeft`:

```ts
    onHeroState?: (msg: HeroStateMsg) => void;
```

Add a sender method (next to `sendPing`):

```ts
    sendHeroState(s: Omit<HeroStateMsg, 't'>): void {
        this.transport.send('tick', encode({ t: 'heroState', ...s }));
    }
```

Add the dispatch case inside `handle()`'s switch (before `case 'hello':`):

```ts
            case 'heroState':
                this.onHeroState?.(msg);
                break;
```

- [ ] **Step 4: Write CoopSession**

Create `src/survivors/coop/CoopSession.ts`:

```ts
import type { NetClient } from '../../net/NetClient';
import { PoseBuffer, type Pose } from '../../net/Interpolation';

/**
 * CoopSession — the M2 game-side glue, kept Babylon-free. Sends the local hero
 * pose each tick and buffers the remote hero pose for interpolated rendering.
 * The scene layer reads getRemoteChamp()/getRemotePose() to drive a ghost mesh.
 */
export class CoopSession {
    private remoteBuffer = new PoseBuffer();
    private remoteChamp: string | null = null;
    private localSeq = 0;

    constructor(
        private client: NetClient,
        private localChamp: string,
        private now: () => number = () => performance.now(),
    ) {
        this.client.onHeroState = (m) => {
            this.remoteChamp = m.champ;
            this.remoteBuffer.push(this.now(), { x: m.x, y: m.y, z: m.z, ry: m.ry });
        };
    }

    get role() {
        return this.client.role;
    }

    sendLocalPose(pose: Pose, anim: number): void {
        this.client.sendHeroState({
            seq: ++this.localSeq,
            x: pose.x, y: pose.y, z: pose.z, ry: pose.ry,
            champ: this.localChamp, anim,
        });
    }

    getRemoteChamp(): string | null {
        return this.remoteChamp;
    }

    /** Interpolated remote pose at the given render time, or null if none yet. */
    getRemotePose(renderTimeMs: number): Pose | null {
        return this.remoteBuffer.sample(renderTimeMs);
    }

    dispose(): void {
        this.client.close();
    }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- coopSession netClient`
Expected: PASS (coopSession 2 tests; netClient still green).

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/net/NetClient.ts src/survivors/coop/CoopSession.ts tests/coopSession.spec.ts
git commit -m "feat(coop): CoopSession local-pose broadcast + remote interpolation"
```

---

### Task 13: Scene integration — spawn the ghost + shared camera (manual demo)

**Files:**
- Modify: `src/survivors/HeroController.ts` (camera focus hook)
- Modify: `src/survivors/SurvivorsGameplayState.ts` (co-op params, ghost, camera, per-frame sync)

> Babylon scene code → verified by the M2 two-tab demo, not Vitest. The pure pieces it relies on (interpolation, focus math, session) are already tested.

- [ ] **Step 1: Add a camera focus-provider hook to HeroController**

In `src/survivors/HeroController.ts`, add a field next to the other scratch fields (near line 104):

```ts
    // Co-op: when set, the camera frames this point (+ height) instead of just
    // the local hero. Lets a shared/tethered camera reuse the existing lerp/shake.
    private cameraFocusProvider: (() => { x: number; z: number; height: number }) | null = null;
```

Add a setter right after `setExternalInput` (near line 174):

```ts
    public setCameraFocusProvider(fn: (() => { x: number; z: number; height: number }) | null): void {
        this.cameraFocusProvider = fn;
    }
```

Replace the camera-follow block (currently lines 577–584) with a focus-aware version:

```ts
        // Camera follow — position only, rotation is locked at construction.
        // In co-op a focus provider supplies a midpoint + zoomed height; solo
        // play falls back to the local hero at the constructed height.
        const focus = this.cameraFocusProvider
            ? this.cameraFocusProvider()
            : { x: pos.x, z: pos.z, height: this.cameraHeight };
        this._scratchCamTarget.set(focus.x, focus.height, focus.z + this.cameraOffsetZ);
        Vector3.LerpToRef(
            this.camera.position,
            this._scratchCamTarget,
            Math.min(1, deltaTime * 6),
            this.camera.position,
        );
```

- [ ] **Step 2: Verify solo play is unchanged**

Run: `npx tsc --noEmit && npm test`
Expected: tsc clean; all tests pass. (The provider defaults to null → identical camera math as before.)

Run: `npm start` and play a few seconds of a normal run.
Expected: camera follows the hero exactly as before (no co-op params → no provider set).

- [ ] **Step 3: Commit the hook**

```bash
git add src/survivors/HeroController.ts
git commit -m "feat(coop): HeroController camera focus-provider hook (solo unchanged)"
```

- [ ] **Step 4: Add co-op fields + imports to SurvivorsGameplayState**

In `src/survivors/SurvivorsGameplayState.ts`, add imports at the top (near the other `../net`-free imports):

```ts
import { CoopSession } from './coop/CoopSession';
import { computeCameraFocus } from './coop/cameraFocus';
import { NetClient } from '../net/NetClient';
import { WebSocketTransport } from '../net/WebSocketTransport';
```

Add fields next to the other private fields (near the hero/heroController declarations):

```ts
    private coopSession: CoopSession | null = null;
    /** Ghost mesh for the remote teammate (M2: cosmetic, not simulated). */
    private coopGhost: Champion | null = null;
    private coopGhostChamp: string | null = null;
```

- [ ] **Step 5: Connect to the room in `startRun` when co-op params are present**

In `startRun()`, after `this.heroController` is fully constructed (after the `setOnRevive(...)` block ending near line 478), add:

```ts
        // --- Co-op (M2 ghost teammate) ---
        // ?host  → create a room and host; ?join=CODE → join an existing room.
        // The ghost is cosmetic in M2: both clients still run their own sim.
        const coopParams = typeof window !== 'undefined'
            ? new URLSearchParams(window.location.search) : null;
        if (coopParams?.has('host') || coopParams?.has('join')) {
            const localChamp = championType;
            void (async () => {
                try {
                    let code = coopParams.get('join') ?? '';
                    if (coopParams.has('host')) {
                        const res = await fetch('/room', { method: 'POST' });
                        code = (await res.json()).code;
                        console.log(`[coop] hosting room ${code} — join with ?join=${code}`);
                    }
                    if (code.length !== 6) return;
                    const transport = await WebSocketTransport.connect(location.origin, code);
                    this.coopSession = new CoopSession(new NetClient(transport), localChamp);
                    console.log(`[coop] connected as ${this.coopSession.role}`);
                } catch (err) {
                    console.error('[coop] connection failed:', err);
                }
            })();
        }
```

- [ ] **Step 6: Drive the ghost + camera each frame in `update`**

In `update()`, right after `if (this.hero) this.hero.update(dt);` (line 1220), add the co-op sync block:

```ts
        // --- Co-op M2 sync: broadcast our pose, render the remote ghost ---
        if (this.coopSession && this.hero) {
            const hp = this.hero.getPosition();
            const ry = (this.hero as unknown as { mesh: Mesh | null }).mesh?.rotation.y ?? 0;
            this.coopSession.sendLocalPose({ x: hp.x, y: hp.y, z: hp.z, ry }, 1);

            // Render ~100ms in the past for smooth interpolation.
            const renderT = performance.now() - 100;
            const champ = this.coopSession.getRemoteChamp();
            const pose = champ ? this.coopSession.getRemotePose(renderT) : null;

            // Lazily spawn the ghost once we know the teammate's champion.
            if (champ && !this.coopGhost) {
                this.coopGhost = new Champion(this.game, [], null, champ as 'barbarian' | 'ranger' | 'mage');
                this.coopGhost.controlMode = 'player'; // no AI; we place it manually
                this.coopGhostChamp = champ;
            }
            if (this.coopGhost && pose) {
                const g = this.coopGhost as unknown as { position: Vector3; mesh: Mesh | null };
                g.position.x = pose.x; g.position.y = pose.y; g.position.z = pose.z;
                if (g.mesh) {
                    g.mesh.position.copyFromFloats(pose.x, pose.y, pose.z);
                    g.mesh.rotation.y = pose.ry;
                }
                this.coopGhost.update(dt); // animate limbs/idle without moving it
            }

            // Shared camera: frame both heroes when the ghost exists.
            if (this.coopGhost && pose) {
                this.heroController!.setCameraFocusProvider(() => {
                    const self = this.hero!.getPosition();
                    return computeCameraFocus(
                        { x: self.x, z: self.z },
                        { x: pose.x, z: pose.z },
                        { baseHeight: 20, maxHeight: 30, zoomPerUnit: 0.4 },
                    );
                });
            }
        }
```

- [ ] **Step 7: Dispose co-op state on `exit`**

In `exit()`, alongside the other system disposals, add:

```ts
        this.coopSession?.dispose();
        this.coopSession = null;
        (this.coopGhost as unknown as { dispose?: () => void })?.dispose?.();
        this.coopGhost = null;
        this.coopGhostChamp = null;
```

- [ ] **Step 8: Type-check + unit tests**

Run: `npx tsc --noEmit && npm test`
Expected: tsc clean; all tests pass.

- [ ] **Step 9: M2 DEMO — ghost teammate in two tabs**

Run: `npm run build && npx wrangler dev`
- Tab A: open `http://localhost:8787/?test&champ=barbarian&host` → it auto-starts a run and logs `[coop] hosting room XXXXXX`.
- Tab B: open `http://localhost:8787/?test&champ=ranger&join=XXXXXX` (paste the code) → auto-starts and logs `[coop] connected as guest`.
- In each tab, move your hero (WASD). 

Expected:
- Tab A sees a **ranger ghost** mirroring tab B's movements (smoothly interpolated).
- Tab B sees a **barbarian ghost** mirroring tab A's movements.
- The camera in each tab **frames both heroes** and zooms out as they separate.
- Enemies are still independent per-tab (shared enemies are M3 — expected).
- Closing one tab leaves the other running (the ghost simply stops updating).

- [ ] **Step 10: Commit**

```bash
git add src/survivors/SurvivorsGameplayState.ts
git commit -m "feat(coop): M2 ghost teammate + shared camera (two-tab demo)"
```

---

## Self-review notes (gaps deliberately deferred)

- **Shared enemies/waves, contact damage, per-player progression, input authority** → M3/M4 (not in this plan; M2 ghost is cosmetic, both run independent sims).
- **Join UI** → M2 uses `?host`/`?join=CODE` URL params (mirrors the existing `?test` dev hook). A proper menu join-flow lands later.
- **Ghost leak hygiene:** the ghost `Champion` is disposed in `exit()`. If `Champion.dispose()` doesn't free cloned GLB skeletons/anim groups, reuse the project's established disposal path — see the memory note on GLB skeleton/lifecycle leaks before shipping M3 (which spawns/despawns many networked entities).
- **`anim` field** is sent as a constant `1` in M2 (idle/run distinction is cosmetic polish for M3); the wire field exists so M3 doesn't reshape the message.
- **Binary encoding** stays JSON through M2 per spec §3; the `encode`/`decode` boundary is the single swap point at M3.
```
