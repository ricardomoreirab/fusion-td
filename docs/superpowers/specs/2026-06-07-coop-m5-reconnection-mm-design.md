# Co-op M5 — Reconnection & Matchmaking-Ready (Design + Plan)

- **Date:** 2026-06-07
- **Status:** Design approved (autonomous, on recommendation). **Pure cores + DO rejoin implemented + tested; client wiring planned.**
- **Branch:** `feat/online-coop` (continues M1–M4)
- **Builds on:** M1 relay (`worker/rooms/Room.ts`, `src/net/**`), M2–M4 sync.

## 1. Goal (parent spec §13 M5)
- **Reconnection:** a dropped peer reclaims its role (`serializeAttachment`) within a grace window; "peer-left → pause + rejoin window" UX.
- **Bandwidth:** snapshot **delta-compression** (send only changed entities) + jitter-buffer tuning.
- **Matchmaking-ready:** the room-join path behind an interface so a `/queue` matchmaking DO can replace `/room` without touching game code.

## 2. Locked decisions (taken on recommendation)

| Topic | Decision |
|---|---|
| Delta compression | `SnapshotDelta` codec: diff vs the last acked snapshot → only changed/added/removed entity ids; guest applies the delta to its base. Pure + unit-tested. Pairs with (deferred) binary to hit the spec's bandwidth budget. Keyframe every N ticks (e.g. 1/sec) so a guest that joined mid-stream / dropped a delta can resync. |
| Reconnection state machine | Pure `ConnectionState` FSM: `connected → peer-left → reconnecting (grace window T=30s) → (rejoined|closed)`. Drives a pause overlay + countdown. Host keeps simulating but with the absent guest's hero frozen/spectating; if the window expires → run-over or host-solo (choose host-solo continue). |
| DO rejoin | `Room` keeps a freed slot's **role** reclaimable for the grace window. On a peer close, the DO marks the slot vacated-at-tick and notifies `peer-left`; a new WS within the window reclaiming the same role (passed as a query/subprotocol) gets `serializeAttachment({role})` restored instead of being rejected 423. After the window, the slot is fully free. |
| Matchmaking interface | Client `RoomService` interface (`createRoom(): {code}`, `connect(code): NetTransport`) with a `PrivateRoomService` (today's `/room`+`/ws`) impl. A future `MatchmakingService` (`/queue`) satisfies the same interface; game code depends only on `RoomService`. No game-code change to add MM later. |
| Jitter buffer | Generalize the M2 `PoseBuffer` concept into a snapshot interpolation buffer with a tunable delay (default ~100ms); render `now - delay`. (Enemy lerp — the deferred M3 polish — reuses this.) |

## 3. Wire additions
- `SnapshotDeltaMsg{ baseTick, tick, changedHeroes[], changedEnemies[], removedEnemyIds[] }` + periodic full `SnapshotMsg` keyframes.
- Reconnect handshake: `/ws/:code?role=host|guest&resume=1` (DO validates against the vacated slot + grace window).
- `peer-left`/`peer-rejoined` control frames (peer-left already exists from M1).

## 4. Task breakdown

### Pure (Vitest — IMPLEMENTED here)
1. **`SnapshotDelta` codec** — `diffSnapshot(base, next) → SnapshotDeltaMsg`; `applyDelta(base, delta) → SnapshotMsg`; round-trip `applyDelta(base, diff(base, next)) === next`; keyframe fallback. Pure.
2. **Reconnection FSM** — `ConnectionMachine` with `onPeerLeft()`, `tick(dt)`, `onPeerRejoined()`, `onWindowExpired()`; exposes `state` + `graceRemaining`. Pure.

### Worker (IMPLEMENTED here — additive to Room DO)
3. **`Room` rejoin** — track vacated slot role + timestamp; allow a `?resume=1&role=…` reconnect within the grace window to reclaim the role (re-`serializeAttachment`); 423 only after the window or when genuinely full. Keep the M1 pure-relay behavior otherwise.

### Client wiring (PLANNED — needs two-tab validation)
4. `RoomService` interface + `PrivateRoomService` refactor of the existing connect path (mechanical; game code depends on the interface).
5. Reconnect transport: on WS close, attempt `?resume=1` reconnect within the window, restore role, resync via the next keyframe.
6. Pause-overlay + countdown UX driven by the FSM; host-solo continue on expiry.
7. Wire `SnapshotDelta` into the host author / guest apply path (host sends deltas + periodic keyframes; guest applies).

**Honesty:** tasks 1–3 are headless-verifiable and implemented here. Tasks 4–7 are scene/transport-coupled (reconnect timing, overlay UX, delta-in-the-loop) and need the two-tab manual loop with induced disconnects — specified above for execution with live validation.
