// Wire protocol for co-op. JSON for M1–M2 (binary comes at M3, behind the same
// encode/decode boundary). PURE — no Babylon, no DOM, safe for the Vitest harness.

export type NetRole = 'host' | 'guest';

export interface HelloMsg { t: 'hello'; role: NetRole }
export interface PeerLeftMsg { t: 'peer-left' }
export interface PingMsg { t: 'ping'; seq: number; sent: number }
export interface PongMsg { t: 'pong'; seq: number; sent: number }

export interface HeroStateMsg {
    t: 'heroState';
    seq: number;
    x: number; y: number; z: number;
    ry: number;
    champ: string;   // 'barbarian' | 'ranger' | 'mage'
    anim: number;    // 0 idle, 1 run (M2 keeps it minimal)
}

// ── M3: host-authoritative shared enemies ────────────────────────────────────

export interface SnapshotHero { id: 0 | 1; x: number; y: number; z: number; ry: number; hp: number; anim: number }
export interface SnapshotEnemy { id: number; x: number; z: number; y?: number; ry: number; hp: number; flags: number; anim: number }
export interface SnapshotMsg {
    t: 'snapshot'; tick: number; ackSeq: number; timeScale: number;
    heroes: SnapshotHero[]; enemies: SnapshotEnemy[];
    wave: { n: number; alive: number; inProgress: 0 | 1; breather: number };
}

export interface SpawnMsg { t: 'spawn'; id: number; type: string; x: number; z: number; maxHealth: number; eliteElement?: string; isClone?: boolean; enrageOriginId?: number }
export interface DeathMsg { t: 'death'; id: number; x: number; z: number; isElite: boolean; isClone: boolean; reward: number; eliteElement?: string }
export interface DamageReportMsg { t: 'damageReport'; enemyId: number; amount: number; element: string; sourceHeroId: number }
export interface DamageResultMsg { t: 'damageResult'; enemyId: number; amount: number; isCrit: boolean; element: string; x: number; z: number }
export interface WaveStartMsg { t: 'wave-start'; wave: number }
export interface WaveClearMsg { t: 'wave-clear'; wave: number }

export type NetMessage =
    | HelloMsg | PeerLeftMsg | PingMsg | PongMsg | HeroStateMsg
    | SnapshotMsg | SpawnMsg | DeathMsg | DamageReportMsg | DamageResultMsg
    | WaveStartMsg | WaveClearMsg;

const KNOWN_TAGS = new Set([
    'hello', 'peer-left', 'ping', 'pong', 'heroState',
    'snapshot', 'spawn', 'death', 'damageReport', 'damageResult',
    'wave-start', 'wave-clear',
]);

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
