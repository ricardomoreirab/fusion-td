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

export interface SnapshotHero {
    id: 0 | 1;
    x: number; y: number; z: number;
    ry: number;
    hp: number;
    anim: number;
    /** Normalised movement axes from the last input frame ([-1..1]). */
    dx: number;
    dz: number;
    /** Whether the hero is still alive (false = dead/spectating). */
    alive: boolean;
    /** Hero level from LevelSystem (1-based). */
    level: number;
    /** XP progress within the current level as a 0..1 fraction. */
    xp: number;
}
export interface SnapshotEnemy {
    id: number; x: number; z: number; y?: number; ry: number; hp: number; flags: number; anim: number;
    /** Shield fraction 0..1 (shield/maxShield). Present only for ShieldEnemy;
     *  omitted for all other enemy types to keep the snapshot lean. */
    shield?: number;
}
export interface SnapshotMsg {
    t: 'snapshot'; tick: number; ackSeq: number; timeScale: number;
    heroes: SnapshotHero[]; enemies: SnapshotEnemy[];
    wave: { n: number; alive: number; inProgress: 0 | 1; breather: number };
}

export interface SpawnMsg { t: 'spawn'; id: number; type: string; x: number; z: number; maxHealth: number; eliteElement?: string; isClone?: boolean; enrageOriginId?: number; bossTier?: number }
export interface DeathMsg { t: 'death'; id: number; x: number; z: number; isElite: boolean; isClone: boolean; reward: number; eliteElement?: string }
export interface DamageReportMsg {
    t: 'damageReport';
    enemyId: number;
    amount: number;
    element: string;
    sourceHeroId: number;
    /** Optional CC/status effect to apply on the host when the hit lands. */
    status?: { kind: string; duration: number; magnitude: number };
}
export interface DamageResultMsg { t: 'damageResult'; enemyId: number; amount: number; isCrit: boolean; element: string; x: number; z: number }
export interface WaveStartMsg { t: 'wave-start'; wave: number }
export interface WaveClearMsg { t: 'wave-clear'; wave: number }

/** Guest → host: per-frame player input. seq monotonically increases so the host
 *  can detect drops. dx/dz are normalised movement axes [-1..1]. buttons is the
 *  packed InputButtons bitfield (see src/net/InputButtons.ts). */
export interface InputMsg { t: 'input'; seq: number; dx: number; dz: number; buttons: number }

// M5-7: delta-compressed snapshot. Defined in SnapshotDelta.ts (with its codec);
// imported type-only here so it joins the NetMessage union + decode tag set.
import type { SnapshotDelta } from './SnapshotDelta';

/** Guest → host: "I'm connected and ready — re-send the current world." The host
 *  replies with a spawn event per live enemy (catch-up). Needed because the host
 *  connects FIRST (into an empty room), so any catch-up it emits on its own
 *  connect is broadcast to nobody; the guest must pull state once it has joined. */
export interface RequestStateMsg { t: 'requestState' }

// ── M4-12: co-op game-over summaries ──────────────────────────────────────────
/** One hero's end-of-run stats. Shared by the wire + GameOverState UI. */
export interface CoopHeroSummary {
    id: number;
    championType: string;
    kills: number;
    level: number;
    /** Total XP earned over the run (gold income folds into XP). */
    xp: number;
    wave: number;
    loadout: { name: string; level: number; icon: string; tier?: string }[];
}
/** Guest → host: the guest's own hero summary, sent periodically so the host always
 *  holds a recent copy (avoids a death-timing race when aggregating run-over). */
export interface RunSummaryMsg { t: 'runSummary'; hero: CoopHeroSummary }
/** Host → guest: the authoritative final result with BOTH heroes — the host is the
 *  single source of run-over, so both clients render the identical 2-column screen. */
export interface RunOverMsg { t: 'runOver'; timeSurvivedSec: number; waveReached: number; heroes: CoopHeroSummary[] }

/** Cosmetic-FX replication: a client broadcasts the transient combat visuals its OWN
 *  hero produces (projectiles, swing arcs, power/ult casts) so the teammate sees them.
 *  Purely cosmetic — damage/CC are already authoritative via damageReport/snapshot, so
 *  the receiver plays the visual with NO gameplay effect.
 *  kind: what to play ('proj' | 'swing' | 'power' | 'ult'). hint: shape/element/id.
 *  (x,z) origin; (tx,tz) optional target/aim point. */
export interface FxMsg { t: 'fx'; kind: string; x: number; z: number; tx?: number; tz?: number; hint?: string }

export type NetMessage =
    | HelloMsg | PeerLeftMsg | PingMsg | PongMsg | HeroStateMsg
    | SnapshotMsg | SpawnMsg | DeathMsg | DamageReportMsg | DamageResultMsg
    | WaveStartMsg | WaveClearMsg | InputMsg | RequestStateMsg
    | RunSummaryMsg | RunOverMsg | SnapshotDelta | FxMsg;

const KNOWN_TAGS = new Set([
    'hello', 'peer-left', 'ping', 'pong', 'heroState',
    'snapshot', 'spawn', 'death', 'damageReport', 'damageResult',
    'wave-start', 'wave-clear', 'input', 'requestState',
    'runSummary', 'runOver', 'snapshotDelta', 'fx',
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
