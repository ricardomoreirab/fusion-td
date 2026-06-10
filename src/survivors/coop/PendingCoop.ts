// PendingCoop — the tiny handoff seam between the menu Co-op lobby and the
// survivors state. The lobby connects the transport while still in the menu
// (so CONNECTION ORDER — not champion-select speed — decides host/guest), then
// stashes the live session here and changes state. startRun() takes it before
// falling through to the dev URL-param flow (?host / ?join).
//
// PURE module state — no Babylon, no DOM — safe for the Vitest harness.

import type { NetTransport } from '../../net/NetTransport';
import type { RoomService } from '../../net/RoomService';
import type { NetRole } from '../../net/Protocol';

export interface PendingCoopConfig {
    /** Live, already-connected transport (role assigned by the relay's hello). */
    transport: NetTransport;
    /** Role the relay assigned at connect time (mirrors transport.role). */
    role: NetRole;
    /** 6-char room code — kept for resume reconnects (M6 D1). */
    code: string;
    /** The service that minted/connected the room — kept for resume reconnects. */
    roomService: RoomService;
}

let pending: PendingCoopConfig | null = null;

/** Stash a live co-op session for the next survivors run. Overwrites any prior. */
export function setPendingCoop(cfg: PendingCoopConfig): void {
    pending = cfg;
}

/** Take (and clear) the stashed session — single-consumer semantics so a later
 *  run can never accidentally reuse a dead transport. */
export function takePendingCoop(): PendingCoopConfig | null {
    const cfg = pending;
    pending = null;
    return cfg;
}

/** Drop any stashed-but-unconsumed session, closing its live transport. Cheap
 *  hardening against stale handoffs — called from SurvivorsGameplayState.exit()
 *  so a lobby stash that never reached startRun() can't leak a socket into a
 *  later run. */
export function clearPendingCoop(): void {
    if (!pending) return;
    try { pending.transport.close(); } catch { /* already closed — ignore */ }
    pending = null;
}
