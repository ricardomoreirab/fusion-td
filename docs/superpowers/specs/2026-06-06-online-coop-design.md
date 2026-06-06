# Online Co-op — Host-Authoritative 2-Player (Private Rooms, Matchmaking-Ready)

- **Date:** 2026-06-06
- **Status:** Approved-to-implement (design approved by user; per-milestone implementation plans to follow)
- **Branch:** `feat/online-coop` (off `main`)
- **Scope:** new networking layer (`src/net/**`), new Durable Object (`worker/rooms/Room.ts`), `wrangler.jsonc` DO migration, `worker/index.ts` routes; a `PlayerSlot` refactor of single-instance gameplay systems; enemy stable-IDs + nearest-of-two targeting; de-globalized slow-mo / non-blocking overlays; a shared-camera `CameraManager`; a co-op `GameOverState`. Single-player path stays behaviorally unchanged.

---

## 1. Summary

Add **online co-operative play for two players** to KTG. One player creates a private **room** (6-char code / invite link); a friend joins. Both fight the **same enemies and waves** in **one shared arena** under a **shared/tethered camera**, while each keeps an **independent build** (own hero, level/XP, powers, items).

The netcode is **host-authoritative**: Player 1's browser runs the existing `SurvivorsGameplayState` simulation **unmodified** and is the single source of truth for enemies, waves, collisions, drops, and damage. Player 2's browser sends **inputs** and renders **snapshots** (interpolated), predicting only its own hero locally so movement feels instant. A thin **Cloudflare Durable Object** relays bytes between the two browsers and tracks room membership — it runs **no game logic**, so it is cheap and is the same primitive that will later host public matchmaking.

The work ships as an incremental **milestone ladder** (M1 echo → M2 ghost teammate → M3 shared enemies → M4 full co-op → M5 reconnection/MM-ready), each independently demoable.

## 2. Goals & non-goals

**Goals**
- 2-player online co-op in a **private invite room** (room code + shareable link).
- **Host-authoritative** netcode that reuses the existing simulation rather than rewriting it.
- **Independent builds**, **shared enemies/waves/arena**, **shared/tethered camera**.
- **Spectate → respawn on wave clear** death model; both dead simultaneously → run over.
- A **Durable Object relay** that keeps the existing static-asset serving and D1 leaderboard working untouched, and is structured so **public matchmaking** can be layered later without rework.
- Single-player remains behaviorally identical (co-op is additive, gated by `role`/player-count).
- Pure-logic networking modules (serialization, reconciliation, target selection) unit-tested with Vitest like `PlayerStats`/`RunItems`.

**Non-goals (this spec)**
- Public matchmaking, ranked play, parties >2, voice/chat.
- Server-side anti-cheat (friends-only co-op; host trust is acceptable).
- Cross-progression/account persistence of co-op runs (leaderboard write rules for co-op are a small follow-up, see §11).
- Reworking gameplay balance for two players beyond what shared enemies require (enemy HP/spawn scaling tuning is a fast-follow, not a blocker).

## 3. Locked design decisions

| Decision | Choice |
|---|---|
| Room model | **Private invite rooms now** (6-char code/link); public matchmaking layered later behind the same room-join interface. |
| Player count | **2 max.** |
| Camera | **Shared / tethered** — one framing fits both heroes; players are soft-leashed together. |
| Netcode authority | **Host-authoritative.** Host (room creator) simulates; guest sends input, renders snapshots, predicts own hero. |
| Server role | **Durable Object = byte relay + room registry** (no game logic). Later becomes the matchmaking queue. |
| Progression | **Independent builds** — each hero has its own level/XP/powers/items. Enemies/waves/arena shared. Each player earns their own XP. |
| Death | **Spectate → respawn on next wave clear.** Both dead at once → **run over** (co-op game-over). |
| Transport | **Abstracted behind a `NetTransport` interface.** Ship M1–M4 on a `WebSocketTransport` through the DO. A `WebRtcTransport` (WS-signaled P2P, unreliable+reliable DataChannels, TURN fallback) is a documented **drop-in** for later — built only on measured latency need or a PvP pivot (see §9.1). |
| Wire encoding | **JSON for M1–M2; binary snapshots introduced at M3** (when shared-enemy volume makes size matter). |
| Tick rates | **Input ~30 Hz up, snapshot ~20 Hz down**, guest interpolates over a ~100 ms buffer. Tunable. |
| Global slow-mo | **De-globalized** in co-op: item-pickup slow-mo dropped (or local-cosmetic only); power-choice overlay becomes per-player & non-blocking; `timeScale` is host-authoritative via snapshot. |

## 4. Architecture overview

```
 Player 1 browser (HOST)              Cloudflare              Player 2 browser (GUEST)
 ┌─────────────────────────┐        ┌──────────┐        ┌──────────────────────────┐
 │ Full SurvivorsGameplay  │        │  Room    │        │ Guest SurvivorsGameplay  │
 │ sim (enemies/waves/      │ ──SNAP─▶│  Durable │──SNAP─▶│ • own hero predicted     │
 │ contact/drops) — AUTHORITY│       │  Object  │        │ • everything else applied│
 │ + own hero               │◀─INPUT─│ (byte    │◀─INPUT─│   from snapshots          │
 │ + P2 hero from input     │        │  relay)  │        │                          │
 └─────────────────────────┘        └──────────┘        └──────────────────────────┘
```

- **Host** runs the unmodified simulation and authors a snapshot at the end of each frame.
- **Relay (DO)** forwards bytes between the two sockets; tracks role + capacity; never parses snapshots.
- **Guest** predicts its own hero (instant feel), applies host snapshots for enemies/teammate/drops with interpolation, and reconciles its prediction against the host via `ackSeq`.

New client module layout (proposed):
```
src/net/
  NetTransport.ts     interface: send(channel, bytes), onMessage(cb), role, close — transport-agnostic
  WebSocketTransport.ts  NetTransport over one WebSocket through the DO (M1–M4 implementation)
  WebRtcTransport.ts  (LATER, optional) NetTransport over WebRTC DataChannels, WS-signaled — see §9.1
  NetClient.ts        connection lifecycle on top of a NetTransport: role, sequence/ack, reconnect
  Protocol.ts         message tags + encode/decode (JSON now, binary later) — PURE, unit-tested
  Snapshot.ts         Snapshot/Input/Event type defs + interpolation buffer — PURE where possible
  HostAuthority.ts    host: authorSnapshot(), applyGuestInput()
  GuestView.ts        guest: applySnapshot() (lerp enemies/heroes/drops), prediction + reconcile
  CameraManager.ts    shared/tethered two-hero framing (also usable in single-player as 1-hero)
```

The game layer (`HostAuthority`/`GuestView`/`Protocol`) talks only to `NetTransport`, never to a concrete socket — so the WebSocket→WebRTC swap is invisible above the transport line.

## 5. Update-loop seam (host vs guest)

The host runs `SurvivorsGameplayState.update(deltaTime)` exactly as today. We add a field `role: 'solo' | 'host' | 'guest'` and gate four steps. Real tick order is `SurvivorsGameplayState.ts:1219-1342`.

| # | Line | Subsystem | Host | Guest |
|---|------|-----------|------|-------|
| 0 | `1198-1201` | early-out guards (`!heroController`, `isPausedForOverlay()`) | keep | keep, but overlay-pause must NOT block the network read (see §8) |
| 1 | `1203` | `dt = deltaTime * timeScale` | authors `timeScale` | **applies** `timeScale` from snapshot |
| 2 | `1219` | `heroController.update(dt)` (own hero) | run | **run** (client-side prediction) |
| 3 | `1220` | `hero.update(dt)` (own Champion) | run | **run** (own hero) |
| 3b | *(new)* | remote-hero apply | author into snapshot | **apply** snapshot (interpolate pos/rot/anim) |
| 4 | `1225-1231` | `waveBreatherRemaining` countdown → `startNextWave()` | **host only** | **skip** — driven by `wave-clear`/`wave-start` events |
| 5 | `1236-1268` | grass torch + influencers (cosmetic) | run | run (reads local hero + snapshot enemy positions) |
| 6 | `1272` | `waveManager.update(dt)` | **host only** | **skip** |
| 7 | `1274` | `enemyManager.update(dt)` (AI/melee/death) | **host only** | **skip** → apply `SNAPSHOT` (lerp pos/hp/anim, remove dead) |
| 8 | `1278` | `applyContactDamage(dt)` (`:1998`) | **host only** (both heroes) | **skip** — hero HP is snapshot-authoritative |
| 9 | `1282` | `powerSlots.update(dt)` (auto-fire) | host runs P1; runs P2 from injected input | runs **own** locally (prediction); damage host-confirmed |
| 10 | `1287` | `hero.updateElementVisuals()` | run | run (own hero) |
| 11 | `1292` | `abilityManager.update(dt)` (ults) | host fires; P2 ults via injected trigger | runs **own** for VFX/cooldown UI; host confirms effect |
| 12 | `1298-1316` | power/item drops tick + swap-pop | **host authors** drop list | **apply** `drops[]` snapshot; pickup host-decided |
| 13 | `1318` | `damageNumbers.update(dt)` | run | run (cosmetic; driven by `damage` events) |
| 14 | `1330` | `hud.update(...)` | run (own stats) | run (own stats local; teammate via snapshot) |
| 15 | `1341` | `offscreenIndicators.update()` | run | run |

- **Host authors the snapshot at the END of `update()`** (after line 1342) so it reflects the fully-ticked frame. Authoring before `enemyManager.update` would ship stale positions.
- **Guest reads remote input at the TOP** (before step 2) and feeds P2's `HeroController.setExternalInput()` + ability triggers — but on the *host*, that injection is what runs; on the guest it's the local hero being predicted.
- The guest's whole divergence is one `if (this.role === 'guest')` branch gating steps 4/6/7/8 and adding 3b.

**Key anchors:** input injection `HeroController.ts:171` + `:517-522`; velocity apply `Champion.setPlayerVelocity` (`Champion.ts:192`) via `HeroController.ts:557`; enemy authority `EnemyManager.update:613` / `Enemy.update:593`; ult/dash triggers `SurvivorsGameplayState.ts:752-756, 774-780`.

## 6. Wire protocol

Two logical **channels**: **tick messages** (`channel:'tick'` — last-wins, loss-tolerant) and **reliable events** (`channel:'event'` — sequence-numbered + acked). `NetTransport.send(channel, bytes)` takes the channel so each transport maps it natively: the `WebSocketTransport` multiplexes both onto its single stream (events carry seq+ack to recover from the shared ordering); a future `WebRtcTransport` maps `tick`→an unreliable+unordered DataChannel and `event`→a reliable+ordered DataChannel (a cleaner fit — no shared head-of-line blocking). The application code is identical either way. **Use JSON for M1–M2; introduce binary snapshots (DataView) at M3**, when shared-enemy volume makes size matter. Byte budgets below assume the eventual binary form.

### 6.1 GUEST → HOST: `INPUT` (~30 Hz)
```ts
interface GuestInput {
  t: 0;            // tag
  seq: number;     // u32 monotonic — host keeps last only
  frame: number;   // u32 guest local frame (prediction reconciliation)
  dx: number;      // f32 -1..1  → HeroController.setExternalInput(dx,dz)
  dz: number;      // f32 -1..1
  buttons: number; // u8 bitfield: dash, ult0, ult1, basicHeld, ability2, ability3
  aimX: number;    // f32 ground-target for click abilities (Meteor)
  aimZ: number;    // f32
}
```
~26 B; ~0.8 KB/s up.

### 6.2 HOST → GUEST: `SNAPSHOT` (~20 Hz)
```ts
interface Snapshot {
  t: 1; tick: number; ackSeq: number;  // ackSeq = last guest input consumed
  timeScale: number;                    // host-authoritative clock
  wave: { n: number; alive: number; inProgress: 0|1; breather: number };
  heroes: HeroState[];   // [P1(host), P2(guest)]
  enemies: EnemyState[]; // live only; deaths via DEATH event
  drops: DropState[];
}
interface HeroState {  // Champion.getPosition() + HeroController health/level
  id: 0|1; x:number; y:number; z:number; ry:number;   // y matters: procedural y=2.0+pos.y vs GLB y=pos.y
  hp:number; hpMax:number;
  flags:number;        // bit0 invuln(dash/shield), bit1 isDead(spectating), bit2 attacking
  level:number; xpProg:number; anim:number; // anim enum {idle,run,attack,dash,dead}
}                      // ~33 B
interface EnemyState {
  id:number;           // STABLE host-assigned id (see §7)
  type:number;         // enum incl. red variants + mini (EnemyManager.ts:515-550)
  x:number; z:number;  // y only for flyers
  hp:number;           // hpMax delivered once in SPAWN event
  status:number;       // bitfield: burn,chill,curse,fragile,frozen,stunned,confused (Enemy.ts:197-209)
  anim:number;         // meleeState enum {idle,run,windup,strike,cooldown}
}                      // ~19 B
```
**Budget:** ~81 B header+heroes; 19 B/enemy → 30 live ≈ 0.6 KB, 60-peak ≈ 1.1 KB; drops ≈ 0.16 KB. **Typical ≈ 0.8 KB/tick, peak ≈ 1.4 KB → ~16–28 KB/s down.** Never tie snapshot rate to render rate.

### 6.3 Reliable EVENTS (sequenced + acked; JSON)
| Event | Trigger (file:line) | Payload |
|---|---|---|
| `run-started` | host finishes `startRun()` (`:365`) | `{seed, p1Champ, p2Champ, arenaRadius}` |
| `spawn` | `spawnSurvivorsEnemy` (`:482`) | `{id, type, x, z, hpMax, isElite, eliteElement?, tier?}` |
| `death` | `Enemy.die` (`:1378`) | `{id, x, z, isElite, element?}` |
| `damage` | `Enemy.takeDamage` cb (`:1193`) | `{id, dmg, isCrit, element?}` |
| `status` | `applyStatusEffect` (`:889`) | `{id, effect, strength, durS}` |
| `elite-loot` | `setOnEliteDeath` cb (`:213`) | `{x, z, element}` |
| `pickup` | `PowerDrop.onPickup`/`onItemPickup` (`:995`) | `{who, kind:'orb'|'item', element?/itemId}` |
| `power-choice` | host builds cards | `{who, cards:[...]}` (host rolls; both render identical) |
| `power-commit` | card picked | `{who, slot, powerId, action:'add'|'fuse'|'levelup'}` |
| `wave-clear` | `setOnWaveCleared` (`:670`) | `{wave, breather}` |
| `wave-start` | `startNextWave` (`:699`) | `{wave}` |
| `levelup` | `LevelSystem.addXp` > 0 (`:74`) | `{who, level}` |
| `revive`/`player-down`/`run-over` | `HeroController` death/revive (`setOnDeath :462`) | `{who, x?, z?}` / `{who}` / `{}` |

### 6.4 Guest prediction & reconciliation
Guest predicts its own hero from local input each frame. Each snapshot carries `ackSeq`; on receipt the guest compares the predicted position at that ack to the authoritative one: **hard-snap on large divergence** (knockback/dash/teleport), **smooth-lerp small drift**. Start simple (threshold snap), tune after playtest (`HeroController` knockback/pull at `:536-555` is the stress case).

## 7. Single → two-player refactor

Single-instance systems are wrapped in a `PlayerSlot` aggregate and stored as `players: PlayerSlot[]`, with `players[0]` wired **exactly as today** so single-player is unchanged.

```ts
interface PlayerSlot {
  stats: PlayerStats;          // PlayerStats.ts:35  — per player
  level: LevelSystem;          // LevelSystem.ts:38  — per player, own XP
  slots: PowerSlotManager;     // PowerSlotManager.ts:11 — own powers, wired to own stats mult
  hero: Champion;              // controlMode 'player'
  controller: HeroController;  // local: input-wired; remote: no input wiring
  isLocal: boolean;
}
```

| Module | File | Change |
|---|---|---|
| `PlayerStats` | `PlayerStats.ts:35` | 2 instances; each `setXpSink` → own `LevelSystem`; only owner's events mutate gold/XP; damage-mult provider references the owning slot. |
| `LevelSystem` | `LevelSystem.ts:38` | 2 instances; independent XP/level; `levelup` event carries `who`. |
| `PowerSlotManager` | `PowerSlotManager.ts:11` | 2 instances, each wired to its own `PlayerStats.powerDamageMultiplier`; per-manager `def.init`/`tick` hooks (e.g. Whirling Blades) run per player — guard slot-id sync before fuse/replace to avoid duplicate init meshes. |
| `Champion` | `Champion.ts` | 2 instances; both `controlMode:'player'`. Remote driven by `setPlayerVelocity()` (host) or snapshot copy (guest). Y must be explicit in snapshot (procedural `y=2.0+pos.y` vs GLB `y=pos.y`, `Champion.ts:1120`). |
| `HeroController` | `HeroController.ts:464` | 2 instances; local wired to input, remote constructed without input wiring. Arena clamp (`:560-575`) runs host-side only; guest receives pre-clamped positions (no double-clamp). Camera follow (`:578-584`) moves to `CameraManager`. |
| `Hud` | `Hud.ts:171` | `update()` gains optional teammate `{hp, level, progress}` (small teammate strip); local player's powers/cooldowns stay primary. |
| `GameOverState` | `GameOverState.ts:37` | `setSurvivorsSummary` accepts a co-op variant (two columns). |

**Shared (single instance, host-owned):** `EnemyManager`, `WaveManager`, arena, `timeScale`, drops list.

### 7.1 Stable enemy IDs (do this FIRST)
`EnemyManager` removes via swap-pop (`:684`), so array indices churn — unusable as network identity. Add `enemy.id` from a host-side counter assigned in `spawnSurvivorsEnemy` (`:482`); **all snapshots/events key on `id`.** Everything else in §6 depends on this.

### 7.2 Nearest-of-two targeting (CRITICAL)
`configureSurvivorsMode` takes a single `heroProvider` (`EnemyManager.ts:124-133`) and every enemy hardcodes `seekTarget = heroProvider`. Change:
- `configureSurvivorsMode(heroProviders: HeroProvider[], arenaRadius)`.
- `Enemy` stores `seekTargets: HeroProvider[]`; in `update` (`:593-650`) and `updateMeleeAttack` (`:821-871`) it picks the **nearest living** hero each frame. A downed/spectating hero is excluded.
- Mini-split (`:145-155`) and boss-clone (`:166-207`) handlers assign the multi-target resolver; clone "reflect across hero" geometry uses the nearest hero.
- Guest does **not** compute targeting (read-only). Behind a flag so the single-player path (one provider) is unchanged.

## 8. The slow-mo / pause hazard

Global `timeScale` + overlay-pause currently freeze the entire `update()` (`isPausedForOverlay()` hard-`return` at `:1201`). In co-op the shared sim must never freeze for one player.

| Site | File:line | Today | Co-op handling |
|---|---|---|---|
| Power-choice overlay | `onOrbPickup :1368` → `isPausedForOverlay :1357` blocks `update :1201` | full sim freeze | **Per-player, non-blocking.** Host rolls cards → `power-choice` event; shared sim keeps running; only the *picking* player's own power-fire pauses. |
| Item-pickup punch | `onItemPickup :995-1011` sets `timeScale=0.6` 300 ms | global slow-mo | **Dropped in co-op** (or local camera-only cosmetic). No host-fast/guest-slow split. |
| Wave breather | `:1225-1231` (raw `deltaTime`) | auto-advance timer | **Host-only.** Guest driven by `wave-clear`/`wave-start`; `breather` snapshot is display-only. |
| Champion select | `enter() :281-362` gates `startRun` | pre-run gate | **Gate on both picks** → host fires `run-started`, then both unblock. |
| Global pause screen | `PauseScreen.ts` | full halt | In co-op, a client pausing must not halt the host sim — local UI dim only (or disabled in co-op). |

**Rule:** in co-op the only authority over `dt`/`timeScale` is the host, carried in the snapshot. No client-local mutation of the shared clock. Overlays become non-blocking per-player UI.

## 9. Durable Object + Worker plumbing

Current Worker (`worker/index.ts`) has only `ASSETS` + `DB`; `wrangler.jsonc:16-22` has no `durable_objects`. Add a thin relay DO; assets + D1 leaderboard stay untouched.

**`wrangler.jsonc`:**
```jsonc
{
  // ...existing name/main/assets/d1...
  "durable_objects": { "bindings": [{ "name": "ROOMS", "class_name": "Room" }] },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["Room"] }]
}
```
Keep `compatibility_date: "2025-09-27"` (hibernatable WebSockets are GA). Add `ROOMS: DurableObjectNamespace` to `Env` (`worker/index.ts:4`).

**Routing** (insert before the `/api/scores` block at `index.ts:78-93`; WS upgrade must be top-level `fetch`, not delegated to `ASSETS`):
```ts
// POST /room → create, return code
// GET /ws/:code (Upgrade: websocket) → env.ROOMS.get(idFromName(code)).fetch(request)
// then existing /api/* ; fallthrough env.ASSETS.fetch(request)
```
Set `Cache-Control: no-store` on `/room` and `/ws/`.

**`worker/rooms/Room.ts`** — hibernatable relay + registry, **no game logic**:
- `fetch`: handle `/init` (set capacity=2); on WS upgrade, reject if `getWebSockets().length >= 2` (423 full); `ctx.acceptWebSocket(server)`; assign role (`peers.length===0 ? 'host':'guest'`); `server.serializeAttachment({role})` (survives hibernation); reply `hello{role}`; return `101`.
- `webSocketMessage(ws, msg)`: relay `msg` to the other peer (pure passthrough — never deserialize).
- `webSocketClose`/`webSocketError`: notify the remaining peer `peer-left`.

The DO is a byte relay (near-zero CPU). Rooms are **transient** — no D1 table. Later, matchmaking adds a queue DO (`idFromName('mm-global')`) and `/room` becomes `/queue`; reconnection uses `serializeAttachment` role on re-accept.

### 9.1 Transport rationale & alternatives considered (WebSocket vs WebRTC)

**Decision: WebSocket now, behind a `NetTransport` interface, with WebRTC documented as a drop-in.** Browsers cannot open raw UDP sockets, so "UDP for games" here means **WebRTC DataChannel** (SCTP/DTLS over UDP) or **WebTransport** (QUIC) — and Cloudflare's Workers/DO runtime can natively relay **only WebSocket** (hibernatable). WebRTC is peer-to-peer (needs STUN/TURN + a signaling channel and bypasses the DO data path); WebTransport isn't served by Workers. Routing through the DO is foundational to this design (room identity, observability, future matchmaking), so WebSocket is the practical optimum.

The UDP advantage — no TCP head-of-line blocking on loss — is **largely neutralized here**: this is co-op **PvE** (no PvP fairness to protect), the guest's own hero is **client-side predicted** (input feel is local, untouched by transport latency), and the **~100 ms interpolation buffer** absorbs a single retransmit at 20 Hz. The only real sacrifice is that the two logical channels (§6) share one TCP stream under WebSocket.

**Genuine points in WebRTC's favor (why we keep it as a clean drop-in, not a closed door):**
- **Two real channels** — `tick` (unreliable+unordered) and `event` (reliable+ordered) become separate DataChannels, eliminating cross-channel head-of-line blocking. This maps to §6 *better* than a single WS.
- **P2P removes the relay triangle** (guest→edge→host→edge→guest becomes guest↔host direct) — real ms savings for same-region friends.

**Why not build it now:** TURN fallback is mandatory or ~10–20% of friend-pairs (symmetric NAT, corporate/mobile) can't connect — that's a separate product (Cloudflare Realtime TURN) with setup + bandwidth cost, and it re-introduces a relay hop. It also roughly doubles the netcode surface (signaling, ICE, DTLS, channel setup, fallback) and debugging burden, for a payoff that prediction + interpolation already mostly deliver in PvE.

**Trigger to revisit:** a measured, felt latency problem in playtests, a pivot to competitive/PvP, or native (Steam) packaging (where real UDP / GameNetworkingSockets becomes available). Because the game layer only touches `NetTransport`, adding `WebRtcTransport` is additive — it reuses the existing DO WebSocket purely as the **signaling** channel and changes nothing in `HostAuthority`/`GuestView`/`Protocol`.

## 10. Non-determinism inventory

Host-authority makes **all RNG irrelevant on the guest** — the guest never rolls; it receives results. Only the host's RNG runs.

| Source | File:line | Why guest-irrelevant |
|---|---|---|
| Enemy spawn theta | `spawnSurvivorsEnemy :490` | host rolls → `spawn` carries `x,z` |
| Mini-split offsets | `configureSurvivorsMode :145` | host-only; snapshot positions |
| Confused-direction reroll | enemy status update `:683` | host-only AI |
| Crit roll | `Enemy.takeDamage` (critProvider) | host computes hp delta; guest reads hp + `damage` |
| Wildcard/perk card pick | `buildWildcardCard`/`buildPerkCard` | host rolls → `power-choice` carries list |
| Power-drop element | `onEliteDeath :213` | host → `elite-loot` |
| Item tier on boss death | RunItems drop | host → `pickup` |
| Ability-cooldown-on-kill | `onKillCallback` | host-only; guest reads own cooldown |
| Death/particle/camera-shake variance | `createDeathEffect`/`HeroController:591` | local cosmetic, unsynced |
| `performance.now()` FX timing | various | use `engine.getDeltaTime()` for authoritative timing; wall-clock drives local FX only |

The **only** true non-determinism that must cross the wire is **human input** (the guest's own hero), which cannot be re-simulated.

## 11. Open follow-ups (not blockers)
- **Leaderboard in co-op:** decide whether co-op runs write to the D1 leaderboard (and under whose name) or are excluded. Small Worker/UI follow-up; default for v1 = co-op runs do **not** write the solo leaderboard.
- **Two-player balance tuning:** enemy HP / spawn-count scaling for two heroes; iterate after M3.
- **Mobile co-op:** joystick + two-hero camera on small screens; revisit at M2 once the camera exists.

## 12. Risks & mitigations (ranked)

1. **No stable enemy ID** (swap-pop churns indices, `EnemyManager:684`). → Add `enemy.id` counter in `spawnSurvivorsEnemy` first; everything keys on it.
2. **Single-hero `seekTarget` baked everywhere** (`Enemy.update:600-650`, `configureSurvivorsMode:124`). → Multi-target resolver picking nearest-alive, behind a flag; single-player path unchanged.
3. **Overlay pause freezes the shared sim** (`:1201`). → Non-blocking per-player overlays; host owns `timeScale`; drop global item slow-mo.
4. **Per-player instance refactor is invasive.** → `PlayerSlot` aggregate; migrate references behind it; `players[0]` identical to today.
5. **Async `startRun` divergence** (`:365`, GLB loads). → Host completes `startRun` first, broadcasts `run-started`; guest blocks `update()` until received.
6. **Prediction reconciliation feel under knockback/pull** (`HeroController:536-555`). → `ackSeq` snap+replay; start with threshold hard-snap; playtest-tune.
7. **Shared camera tether unknown** (no `CameraManager`; follow lerp `*6` assumes 60 Hz, `:578-584`). → New `CameraManager.frameBoth(h1,h2,dt)` bounding-box + dynamic height; tune zoom-out limits.
8. **Revive/extra-life authority** (`HeroController.revive`, host-only). → Host decides lethal→revive, broadcasts `revive`; ties into spectate→respawn-on-`wave-start`.
9. **DO config foot-guns** (missing migration/binding = Worker init failure; WS can't go through `ASSETS`). → Land DO binding + migration + `Room` export in one commit; `wrangler dev` smoke test before touching game code.

## 13. Milestone ladder (incremental delivery)

Each rung is independently demoable and de-risks the next. **Each milestone gets its own implementation plan** so M2 (visible teammate) ships without committing to M4.

- **M1 — Echo connection (infra only).** `Room` DO + `wrangler.jsonc` migration + `/room` and `/ws/:code` routes. Client: the `NetTransport` interface + `WebSocketTransport` implementation (so all later milestones sit on the abstraction), plus a debug page that creates a room, connects both browsers, and relays ping/pong. Leaderboard + assets still work. *Demo: two tabs exchange relayed pings; reconnect logs `peer-left`.*
- **M2 — Ghost teammate (cosmetic, no shared state).** Both run normal single-player sims; each sends `HeroState` at 20 Hz; each renders the other as an interpolated ghost Champion. Validates wire format, interpolation, second-Champion spawn, and the tethered `CameraManager`. *Demo: your friend's hero walks around your arena.*
- **M3 — Shared enemies/waves (host world).** Stable enemy IDs; host owns `EnemyManager`/`WaveManager`; guest skips steps 4/6/7/8, applies `SNAPSHOT` + `spawn`/`death`/`damage`; nearest-of-two targeting; host-only contact damage. *Demo: both fight the same waves with consistent HP/positions.*
- **M4 — Full co-op.** Per-player `PlayerStats`/`LevelSystem`/`PowerSlotManager`; guest input drives host's P2 hero w/ prediction + reconciliation; non-blocking per-player power-choice; independent XP/powers/items; de-globalized slow-mo; spectate→respawn-on-clear; both-dead→`run-over`; 2-column co-op game-over. *Demo: a complete 2-player run.*
- **M5 — Reconnection & matchmaking-ready.** `serializeAttachment` role recovery on reconnect; "peer-left → pause + rejoin window"; snapshot delta-compression + jitter-buffer tuning; room-join behind an interface so a `/queue` matchmaking DO can replace `/room`. *Demo: drop & rejoin mid-run; stub public queue.*
- **(Optional, post-M5) — `WebRtcTransport`.** Only if playtests show a felt latency problem or the game pivots to PvP. Implement `NetTransport` over WebRTC DataChannels (`tick`→unreliable/unordered, `event`→reliable/ordered), using the existing DO WebSocket as the signaling channel, with TURN fallback. No changes above the transport line (§9.1). *Demo: same co-op run, P2P data path, WS used only for signaling.*

## 14. Testing strategy

- **Vitest (pure logic, no Babylon)** — matches existing `tests/*.spec.ts`:
  - `Protocol` encode/decode round-trip (input bitfield pack/unpack, snapshot fields).
  - Guest interpolation buffer (ordering, dropped/late ticks).
  - Prediction reconciliation math (snap-vs-lerp threshold).
  - Nearest-of-two target selection (incl. excluding downed hero).
  - Enemy-ID assignment uniqueness across spawn/despawn churn.
  - A **`FakeTransport`** (in-memory `NetTransport` that loops host↔guest with injectable latency/loss) drives host/guest integration tests with no real network — exercises the interface contract and makes the WebRTC swap testable later.
- **Local two-tab integration** against `wrangler dev` (DO relay, role assignment, capacity 423, reconnect).
- **Manual playtest** for prediction feel, camera tether, and balance, starting at M3.

## 15. File anchors (quick reference)
- Update-loop tick order: `SurvivorsGameplayState.ts:1219-1342`
- Overlay-pause hazard: `:1201` + `isPausedForOverlay :1357`; item slow-mo `:995-1011`; wave breather `:1225-1231`; drops `:1298-1316`
- Input injection: `HeroController.ts:171`, `:517-522`; velocity apply `Champion.setPlayerVelocity Champion.ts:192` via `HeroController.ts:557`; camera follow `:578-584`
- Enemy authority: `EnemyManager.update:613`, `Enemy.update:593`; targeting `configureSurvivorsMode:124-133`, `updateMeleeAttack:821-871`; swap-pop `:684`; spawn `:482`
- Champion-select/startRun: `enter() :281-362`, `startRun :365`; game-over `GameOverState.ts:37`; HUD `Hud.ts:171`
- Worker routing: `worker/index.ts:78-93`, `Env :4`; DO config gap `wrangler.jsonc:16-22`
