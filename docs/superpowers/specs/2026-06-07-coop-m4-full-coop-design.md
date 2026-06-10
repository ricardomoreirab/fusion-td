# Co-op M4 — Full Co-op (Design + Plan)

- **Date:** 2026-06-07
- **Status:** Design approved (autonomous, on recommendation). **Pure cores implemented + tested; scene tasks planned for two-tab execution.**
- **Branch:** `feat/online-coop` (continues M1–M3)
- **Builds on:** M3 host-authoritative shared enemies + basic-attack `DamageRouter` + contact-both + nearest-of-two.
- **Mapping:** workflow `coop-m4-map` (5 agents, verified against source).

## 1. Goal

Per-player independent builds; full guest **input authority** (host simulates the guest hero from input; guest predicts + reconciles); **power/ultimate** damage routing (extend M3's `DamageRouter`); **non-blocking per-player power-choice**; **death → spectate → respawn on wave clear**, both-dead → run-over; **2-column co-op game-over**.

## 2. Verified deltas from M3 (the map corrected my assumptions)
- `applyContactDamage(deltaTime, reductionMult)` already does the ghost-HP loop (M3). M4 only inverts who *moves* the ghost (input vs pose-copy).
- `SnapshotMsg` already has `ackSeq`/`timeScale` but `ackSeq` is stubbed `0` — M4 wires it.
- `SnapshotHero` has no `dx/dz`, no `alive`, no `level/xp` — M4 adds them.
- Ghost is **pose-copied** today (`CoopSession.sendLocalPose` → `getRemotePose`). M4 replaces with `InputMsg`.

## 3. Locked decisions (taken on recommendation)

| Topic | Decision |
|---|---|
| Per-player aggregate | `PlayerSlot { id, isLocal, stats, level, slots, abilities, items, hero, controller, runPerks, baseMaxHealth, appliedMaxHpBonus, reviveShield*, inputSeq }`; `players: PlayerSlot[]`; `local()` accessor. **Shared stays flat** (enemyManager, waveManager, arena, timeScale, camera, drops, damageNumbers). Single-player = `players=[slot0]`, `localId=0`, no `players[1]`. |
| Migration | Mechanical rename of `this.playerStats/levelSystem/heroController/powerSlots/abilityManager/runItems` → `this.local().<field>` getters; construction moved into `buildPlayerSlot(id,isLocal,champType)`. **Win condition: tsc green + SP byte-identical before any `players[1]`.** |
| Input authority | Guest sends `InputMsg{seq,dx,dz,buttons}` (replaces `sendLocalPose`); guest consumes input THEN sends (prediction ordering). Host drives `players[1]` via `setExternalInput`+`controller.update()` **before** enemy/contact ticks. Ghost becomes input-driven, never pose-copy (coasts on last input on packet loss). |
| Reconciliation | Snapshot carries `ackSeq` + `SnapshotHero.{dx,dz,alive}`. Guest: `dist(localPos, snapPos)` → **hard-snap if > 0.5u**, else **lerp 0.2**. HP stays host-authoritative (M3). |
| Power routing | Per-player `PowerSlotManager`/`AbilityManager` wired to own `PlayerStats`. Guest power/ability hits route through the **same `DamageRouter`** (target-by-id, not by-reference); host resolves id→authoritative enemy, applies, echoes `DamageResultMsg`. `DamageReportMsg += status?` for CC. Guest never mutates render-only stubs / never flashes local damage. |
| Power-choice | **Non-blocking + per-player** in co-op: `isPausedForOverlay()` gated on `!coopSession`; overlay does NOT touch `timeScale` or early-return the loop. Host rolls the 3-card offer → per-player pick → reliable `PowerCardMsg` so host tracks each loadout. SP keeps its blocking slow-mo. |
| Death/respawn | Death callback branches: teammate alive → `enterSpectate` (gray mesh, disable input, camera follows teammate, snapshot `hp=0,alive=false`); both dead → `buildAndSendRunSummary`. Respawn at `onWaveCleared`: restore HP+pos (after `Champion.update`), re-enable input, `alive=true`. Guest gates spectate on `alive` flag, not `hp>0`. Revive charges (Extra Life) unaffected by respawn. |
| Game-over | `SurvivorsRunSummary { waveReached, timeSurvivedSec, goldCollected, heroes: SurvivorsHeroSummary[] }`; capture each hero's summary **at death time**. `GameOverState.createUI` renders 2 columns (1 in SP). |
| Orb/item contention | Host-authoritative exclusive claim — orb despawns on first pickup, gold routes through that owner's xpSink only. |

## 4. Wire additions over M3
- `InputMsg{seq,dx,dz,buttons}` guest→host (replaces pose).
- `SnapshotHero += {dx, dz, alive, level, xp}`; real `ackSeq`.
- `DamageReportMsg += status?:{kind,duration,magnitude}`.
- `PowerCardMsg{heroId, offer?, pickIndex?}` (reliable/acked).
- `RespawnMsg` — prefer folding into snapshot `alive` flip + position; add explicit only if 50ms jitter shows.

## 5. Risks (ranked; mitigations in §3/§7 of the map)
1. **PlayerSlot blast radius** — pure mechanical rename, tsc+SP-byte-identical gate, commit alone.
2. **Prediction feel under knockback/pull** — host owns enemy positions; send knockback as host event not derived from stale guest data; tune `SNAP_THRESHOLD`.
3. **Power closure-by-reference** (`ctx.enemies` live array) — target-by-id + report; host resolves.
4. **Overlay-pause freezes shared sim** — gate on `!coopSession`; non-blocking overlay.
5. **Respawn HP/pos race** — `alive` flag; write pose after `Champion.update`.
6. **xpSink closure capture** — build sink inside `buildPlayerSlot` closing over `slot.level`.
7. **Power-choice desync** — reliable/acked card events.
8. **Guest spectate double-fire** — death callback checks role + live count.

## 6. Task breakdown

### Pure (Vitest — IMPLEMENTED in this milestone)
1. **Per-player progression core** — two `PlayerStats`+`LevelSystem` with independent xpSinks; gold→player-0 raises only player-0's level. (`PlayerStats`/`LevelSystem` are Babylon-free.)
2. **`InputMsg` codec** + buttons bitfield pack/unpack — round-trip + unknown-tag.
3. **`SnapshotHero` extension** (`dx,dz,alive,level,xp`) + real `ackSeq` in the snapshot codec — round-trip.
4. **Reconciliation math** — `reconcilePosition(localPos, snapPos, snapThreshold, lerpFraction) → {x,z}` returning snap-or-lerp result; the single most valuable unit test.
5. **`DamageReportMsg += status` + `validateDamageReport`** unchanged range gate; status round-trips.
6. **Run-over predicate + summary aggregation** — `aliveCount(slots)`, `buildCoopSummary(...)`; 1-dead→spectate, 2-dead→run-over, SP length-1.

### Scene (two-tab manual — PLANNED, ready to execute with the contracts above)
7. PlayerSlot migration in `SurvivorsGameplayState` (highest blast radius; SP byte-identical gate).
8. Input-driven ghost + guest prediction/reconcile (riskiest blind — feel/jitter needs two tabs).
9. Power/ability routing through `DamageRouter` on guest + host validate/echo.
10. Non-blocking per-player power-choice (`isPausedForOverlay` decouple).
11. Death→spectate→respawn + camera retarget.
12. 2-column `GameOverState.createUI`.

**Honesty:** tasks 1–6 are headless-verifiable and implemented + tested here. Tasks 7–12 are scene-coupled; per CLAUDE.md Vitest is pure-logic only, so they require the two-tab manual loop. The two most dangerous to implement without visual testing are **#8 (input prediction feel)** and **#10 (overlay non-blocking)** — timing/feel across two clients. They are specified precisely above for execution with live validation.
