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
