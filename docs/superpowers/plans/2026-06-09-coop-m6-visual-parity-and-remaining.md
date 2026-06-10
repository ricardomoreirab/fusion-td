# Co-op M6 — Visual Parity + Remaining Work — Implementation Plan

> **STATUS:** Implemented overnight 2026-06-10 — ALL tasks below are done and all automated
> gates are green (`npx tsc --noEmit`, `npm test`, `npm run build`). Steps that called for
> two-tab manual validation are ticked as implemented but remain
> **(pending manual two-tab validation)**.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the remaining co-op gaps so both players see the same world — the transient
animations/FX events that are still caster-/host-local — plus finish reconnection and the
deferred performance work.

**Architecture:** Extend the **cosmetic-FX event channel** already shipped
(`src/net/Protocol.ts` `FxMsg` + `src/survivors/coop/CoopFx.ts` `emitCoopFx`/`playRemoteFx`):
a combat-visual site calls `emitCoopFx(...)`; the gameplay broadcasts it; the teammate replays
it with **zero gameplay effect** (damage/CC are authoritative via `damageReport`/snapshot).
Enemy visuals extend the snapshot (`SnapshotEnemy.anim`/`flags`) the guest already applies in
`Enemy.applyNetworkState`. Single-player must stay byte-identical (every hook is null/guarded
outside co-op).

**Tech Stack:** TypeScript, BabylonJS, Vitest (pure-logic only), webpack. Host-authoritative
co-op over a Cloudflare Durable-Object WebSocket relay.

**Reference:** the 86-item gap catalogue is `docs/superpowers/specs/2026-06-08-coop-share-coverage-audit.md`.

**Verify gate at EVERY task:** `npx tsc --noEmit` clean (ignore the pre-existing `*.spec.ts`
module-resolution IDE noise), `npm test` green, `npm run build` ok. Scene-coupled tasks are
ALSO flagged for two-tab manual validation (`?host` / `?join`) — they can't be unit-tested.

---

## Phases (each independently shippable; do P0 first)

- **Phase A — P0 fairness** (the guest can't react to what it can't see): boss telegraphs, ranged-enemy bolts, shield state, guest-FX-must-not-move-host-enemies, knockback routing.
- **Phase B — Enemy/boss visual parity**: death `_dead` animation + boss skill clips + procedural-enemy limb motion on the guest.
- **Phase C — Exact hero power/ult FX** (turn the generic cast burst into the real spell).
- **Phase D — Reconnection completion (M5-5 transparent rejoin)**.
- **Phase E — Deferred performance/quality** (binary snapshot codec, input-replay reconciliation, curse-tick coalescing).

---

## File Structure

- `src/net/Protocol.ts` — extend `FxMsg` (already exists) for enemy projectiles; widen `SnapshotEnemy.anim` to a skill index; add `shield` to enemy flags or a field.
- `src/net/EnemyFlags.ts` — pack/unpack the widened flags (pure, unit-tested).
- `src/survivors/coop/CoopFx.ts` — add cosmetic spawners (`spawnCosmeticEnemyProjectile`, telegraph ring, per-power replay dispatch).
- `src/survivors/enemies/Enemy.ts` — guest-side: `_dead` clip on death, skill-clip selection from the snapshot, procedural limb anim from interpolated speed, shield-dome state from the snapshot.
- `src/survivors/coop/GuestEnemies.ts` — play death anim + linger before disposing (instead of instant `disposeCorpse`).
- `src/survivors/powers/PowerEffects.ts` — make the 8 shared primitives broadcast a cosmetic `fx` when in co-op (covers all fusions at once).
- `src/survivors/SurvivorsGameplayState.ts` — host: emit enemy projectile/telegraph fx; encode skill index + shield in `buildSnapshot`; guest: dispatch new `fx` kinds in `playRemoteFx`.
- `src/survivors/abilities/AbilityManager.ts` — knockback-as-host-event for guest-cast Smash.
- Reconnection: `src/net/WebSocketTransport.ts`, `src/survivors/SurvivorsGameplayState.ts` (extract `wireCoopSession`), `src/net/SnapshotBinary.ts` (new, Phase E).

---

# PHASE A — P0 fairness

### Task A1: Ranged-enemy bolt is visible to the guest (RedWizard)

**Why:** The guest is damaged by an invisible bolt — `RedWizard` fires a projectile + plays a
cast clip only on the host. (`src/survivors/enemies/RedWizard.ts:53-110`.)

**Files:**
- Modify: `src/survivors/enemies/RedWizard.ts` (the fire site)
- Modify: `src/survivors/coop/CoopFx.ts` (add `spawnCosmeticEnemyProjectile`)
- Modify: `src/survivors/SurvivorsGameplayState.ts` (`playRemoteFx` dispatch)

- [x] **Step 1: Read** `src/survivors/enemies/RedWizard.ts` to find where the bolt mesh is spawned + the target position. Note the method (e.g. `fireBolt(targetPos)`).

- [x] **Step 2: Emit on the host.** At the bolt-spawn site in RedWizard, add (the host is the only one that runs enemy AI, so this only fires host-side):

```ts
import { emitCoopFx } from '../coop/CoopFx';
// ...at the moment the bolt is fired, with hero target (tx,tz):
emitCoopFx('enemyProj', this.position.x, this.position.z, targetX, targetZ, 'wizard');
```

- [x] **Step 3: Add the cosmetic spawner** to `src/survivors/coop/CoopFx.ts` (mirror `spawnCosmeticProjectile`, magenta/arcane orb, slower speed ~14):

```ts
export function spawnCosmeticEnemyProjectile(scene: Scene, fromX: number, fromZ: number, toX: number, toZ: number): void {
    spawnCosmeticProjectile(scene, 'mageBolt', fromX, fromZ, toX, toZ, 'arcane');
}
```

- [x] **Step 4: Dispatch on the guest.** In `SurvivorsGameplayState.playRemoteFx`, add a case:

```ts
case 'enemyProj':
    spawnCosmeticEnemyProjectile(this.scene, m.x, m.z, m.tx ?? m.x, m.tz ?? m.z);
    break;
```
(import `spawnCosmeticEnemyProjectile` alongside the others).

- [x] **Step 5: Verify** `npx tsc --noEmit` clean, `npm test` green, `npm run build` ok. **Two-tab:** as guest, let a RedWizard attack — a bolt should now fly at you. Commit `feat(coop): replicate ranged-enemy bolts to the guest`.

---

### Task A2: Boss dash/pull telegraph is visible to the guest

**Why:** `MilestoneBoss` shows a red ground telegraph before a dash/grab; the guest sees none
and can't dodge. (`src/survivors/enemies/MilestoneBoss.ts` LungeState; `telegraphRing`.)

**Files:** Modify `src/survivors/enemies/MilestoneBoss.ts`, `src/survivors/coop/CoopFx.ts`, `src/survivors/SurvivorsGameplayState.ts`.

- [x] **Step 1: Read** the LungeState telegraph in `MilestoneBoss.ts` — find where `telegraphRing` is created and the dash target/direction.

- [x] **Step 2: Emit on the host** at the telegraph-start site:
```ts
emitCoopFx('telegraph', this.position.x, this.position.z, dashTargetX, dashTargetZ, 'dash');
```

- [x] **Step 3: Add `spawnCosmeticTelegraph(scene, fromX, fromZ, toX, toZ)`** to `CoopFx.ts` — a red ground-plane rectangle/line from origin to target, fading over the telegraph window (~0.8s). Use a cached red material, fade via `mesh.visibility`.

- [x] **Step 4: Dispatch** in `playRemoteFx`: `case 'telegraph': spawnCosmeticTelegraph(...); break;`.

- [x] **Step 5: Verify** + two-tab (as guest, watch a boss telegraph before it dashes). Commit `feat(coop): replicate boss dash/pull telegraphs to the guest`.

---

### Task A3: ShieldEnemy shield state crosses the wire

**Why:** The guest shows a stale shield dome (never drains/breaks/regens) — misreads whether
the enemy is shielded. (`src/survivors/enemies/ShieldEnemy.ts updateShieldVisual`.)

**Files:** `src/net/Protocol.ts`, `src/net/EnemyFlags.ts`, `tests/netM3Protocol.spec.ts`, `src/survivors/SurvivorsGameplayState.ts` (`buildSnapshot`), `src/survivors/enemies/Enemy.ts` / `ShieldEnemy.ts` (`applyNetworkState`).

- [x] **Step 1: Decide the encoding.** `SnapshotEnemy` is f32-light; add `shield?: number` (0..1 fraction of maxShield, omitted when not a shield enemy). Write the failing round-trip test in `tests/netM3Protocol.spec.ts` asserting a snapshot with `enemies:[{...,shield:0.5}]` survives `decode(encode())`.

- [x] **Step 2: Add `shield?: number`** to `SnapshotEnemy` in `Protocol.ts`. Run the test → PASS.

- [x] **Step 3: Author it (host).** In `buildSnapshot` enemy loop, set `shield: e.getShieldFraction?.()` (add a `getShieldFraction()` to ShieldEnemy returning `shield/maxShield`, undefined elsewhere).

- [x] **Step 4: Apply it (guest).** In `ShieldEnemy.applyNetworkState` override (or base, gated on a `shield` field), drive `updateShieldVisual()` from `s.shield`.

- [x] **Step 5: Verify** + two-tab (shoot a shield enemy as host; the guest's dome should drain/break/regen). Commit `feat(coop): sync ShieldEnemy shield state to the guest`.

---

### Task A4: Guest power FX must never move host-authoritative enemies

**Why:** `gatherVortex`/`persistentZone` mutate enemy positions locally; on the guest those are
render-only host-authoritative copies, so the FX fights the snapshot (flicker/desync).

**Files:** Modify `src/survivors/powers/PowerEffects.ts`.

- [x] **Step 1: Read** `gatherVortex` + `persistentZone` in `PowerEffects.ts` — find the per-frame `enemy.position` / `applyKnockback` writes.

- [x] **Step 2: Guard the position mutation** behind "is this enemy locally authoritative?". The simplest signal: `Enemy.guestDamageRedirect !== null` means we're the guest (render-only enemies). Add at the top of the position-moving block:
```ts
import { Enemy } from '../enemies/Enemy';
if (Enemy.guestDamageRedirect) return; // guest: never move host-authoritative enemies (the pull is applied host-side via the routed status/damage)
```
(Damage/pull still route to the host via the existing redirect; only the LOCAL position write is skipped on the guest.)

- [x] **Step 3: Verify** + two-tab (cast a vortex/zone as guest; shared enemies shouldn't jitter). Commit `fix(coop): guest power FX no longer moves host-authoritative enemies`.

---

### Task A5: Guest-cast knockback (Smash) reaches the host

**Why:** A guest Smash moves only the guest's local copies; the host enemies aren't pushed.
(Freeze/slow already route via `guestStatusRedirect`; knockback does not.)

**Files:** `src/net/Protocol.ts` (`DamageReportMsg`), `src/survivors/enemies/Enemy.ts` (`applyKnockback` redirect), `src/survivors/SurvivorsGameplayState.ts` (host apply + guest wire).

- [x] **Step 1:** Add an optional `knockback?: { dx: number; dz: number; magnitude: number }` to `DamageReportMsg` in `Protocol.ts`. Round-trip test in `tests/coopDamageReportStatus.spec.ts`.

- [x] **Step 2:** Add `Enemy.guestKnockbackRedirect` (mirror `guestStatusRedirect`) and early-return in `Enemy.applyKnockback` when set: report `{enemyId, dx, dz, magnitude}` and apply nothing locally.

- [x] **Step 3:** Wire it on the guest (next to `guestStatusRedirect`) → `sendDamageReport({...,amount:0, knockback:{...}})`; clear in `exit()`. In the host `onDamageReport`, after status: `if (m.knockback) e.applyKnockback(m.knockback.dx, m.knockback.dz, m.knockback.magnitude)`.

- [x] **Step 4: Verify** + two-tab. Commit `feat(coop): route guest-cast knockback to the host`.

---

# PHASE B — Enemy/boss visual parity

### Task B1: Enemy/boss `_dead` death animation on the guest

**Why:** Enemies/bosses pop out of existence on the guest (`GuestEnemies.death` → instant
`disposeCorpse`). The host plays the GLB `_dead` clip + lingers.

**Files:** `src/survivors/coop/GuestEnemies.ts`, `src/survivors/enemies/Enemy.ts`.

- [x] **Step 1: Read** `Enemy.die`/`_beginDeathSequence` (`Enemy.ts:~1467-1560`) — note how it finds the `_dead` clip (see the "enemy GLB clip names" gotcha: `<prefix>_dead`) and lingers before `_releaseMeshAndAnimations`.

- [x] **Step 2: Add a guest-only `playDeathAnimThenDispose()` to `Enemy`** that plays the `_dead` clip (reuse the clip-locating helper `die()` uses), then disposes via `disposeCorpse()` after the clip length (or a fixed ~1.2s linger). It must NOT run host-side death logic (no reward, no callbacks — those came via `DeathMsg`). Guard: only meaningful when `glbAnimationGroups.length > 0`; else dispose immediately.

- [x] **Step 3: Call it from `GuestEnemies.death(id)`** instead of `e.disposeCorpse()` directly:
```ts
const e = this.byId.get(id);
this.byId.delete(id); this.buffers.delete(id); // stop driving it from snapshots immediately
if (e) e.playDeathAnimThenDispose(); // plays _dead then frees (leak-safe disposeCorpse inside)
```
(Removing from `byId` first ensures the dying corpse is no longer position-driven / re-targeted while it lingers.)

- [x] **Step 4: Leak check.** Confirm the lingering corpse's eventual `disposeCorpse()` still frees the GLB skeleton RawTexture + anim groups (per the "GLB skeleton + lifecycle leaks" gotcha). Run 10 waves two-tab and confirm `[resource-watchdog]` stays quiet on the guest.

- [x] **Step 5: Verify** + two-tab. Commit `feat(coop): play enemy/boss death animation on the guest`.

---

### Task B2: Distinct boss/elite skill clips on the guest

**Why:** The snapshot anim is 1-bit (walk/attack); a boss with `_skill1/2/3` only ever plays
one fallback clip on the guest.

**Files:** `src/net/Protocol.ts`, `src/survivors/enemies/Enemy.ts` (`getMeleeDisplay` + `_applyNetworkAnim`), `src/survivors/SurvivorsGameplayState.ts` (`buildSnapshot`), `tests/netM3Protocol.spec.ts`.

- [x] **Step 1:** Widen `SnapshotEnemy.anim` semantics: keep `0/1/2` (idle/walk/attack) and add `10+skillIndex` for a skill clip (e.g. 11 = skill1). Document in `Protocol.ts`. Round-trip test stays valid (it's still a number).

- [x] **Step 2:** Add `Enemy.getNetAnimCode(): number` that returns `0/1/2` from the melee FSM as today, OR `10+n` when a named skill clip is currently playing (read the enemy's `glbCurrentAnim` name; match `_skillN`). Use it in `buildSnapshot` instead of the inline `md.phase>0?2:1`.

- [x] **Step 3:** In `Enemy._applyNetworkAnim(anim)`, when `anim >= 10`, select the matching `_skillN` group (categorise skill groups lazily alongside walk/attack); else walk/attack as today.

- [x] **Step 4: Verify** + two-tab (watch a boss do its named skills on the guest). Commit `feat(coop): replicate boss/elite skill animations to the guest`.

---

### Task B3: Procedural-enemy limb animation on the guest

**Why:** Non-GLB enemies (procedural Boss/Fast/fallback) are frozen statues on the guest —
`_applyNetworkAnim` early-returns when there are no GLB groups, and the guest never ticks AI.

**Files:** `src/survivors/coop/GuestEnemies.ts`, `src/survivors/enemies/Enemy.ts`.

- [x] **Step 1: Read** the procedural part-animation methods (`animateHumanoid`/`animateParts` in `Enemy.ts` / subclasses) — they're driven by a walk phase + speed.

- [x] **Step 2: Add `Enemy.tickNetworkProceduralAnim(dt, speed)`** that advances the existing procedural limb animation from a speed estimate (the guest already computes interpolated movement; pass the per-frame displacement / dt). No-op for GLB enemies.

- [x] **Step 3: Call it from `GuestEnemies.interpolate`/`tickVisuals`** with each enemy's interpolated speed (derive from the buffer sample delta).

- [x] **Step 4: Verify** + two-tab. Commit `feat(coop): animate procedural enemies on the guest from interpolated speed`.

---

# PHASE C — Exact hero power/ult FX

### Task C1: Make the 8 PowerEffects primitives broadcast a cosmetic `fx` (covers all fusions)

**Why:** Every base power + all 10 fusions compose `aoeBurst`/`chainHit`/`gatherVortex`/
`persistentZone`/`omniVolley`/`spawnExpandingRing`/`spawnBolt`/`arrowStrike`. Broadcasting at
the PRIMITIVE level replicates every power's signature visual with one change set.

**Approach:** Each primitive, when called by the LOCAL hero in co-op, emits an `fx` describing
itself; the receiver replays the SAME primitive with `enemies=[]` (no damage). Use a re-entrancy
guard so a replayed primitive doesn't re-broadcast.

**Files:** `src/survivors/powers/PowerEffects.ts`, `src/survivors/coop/CoopFx.ts`, `src/survivors/SurvivorsGameplayState.ts` (`playRemoteFx`).

- [x] **Step 1: Add a replay flag** to `CoopFx.ts`:
```ts
let _replaying = false;
export function isReplayingFx(): boolean { return _replaying; }
export function withFxReplay(fn: () => void): void { _replaying = true; try { fn(); } finally { _replaying = false; } }
```

- [x] **Step 2: Emit in each primitive.** At the top of `aoeBurst`, `gatherVortex`, `persistentZone`, `omniVolley`, `chainHit`, `spawnExpandingRing` (and the arrow strike), add (skip while replaying so the receiver doesn't echo):
```ts
import { emitCoopFx, isReplayingFx } from '../coop/CoopFx';
if (!isReplayingFx()) emitCoopFx('pe', x, z, /*target*/ tx, tz, JSON.stringify({ p: 'aoeBurst', element, radius: opts.radius }));
```
(Encode the primitive name + the visually-relevant params in `hint` as compact JSON. `tx,tz` for directional ones like `chainHit`/`omniVolley`.)

- [x] **Step 3: Replay on the guest.** In `playRemoteFx`, add `case 'pe':` that parses `hint`, and calls the named primitive with `enemies=[]` and `damage:0` inside `withFxReplay(() => ...)`. Map `p` → the imported primitive.

- [x] **Step 4: Remove the placeholder.** The generic `case 'power'`/`'ult'` element burst from `adfd23f` becomes redundant for powers that emit `pe`; keep it as a fallback for casts that don't (or delete once all primitives emit).

- [x] **Step 5: Verify** + two-tab (cast Fireball, Arcane Nova, a fusion vortex as each role; the teammate sees the real FX). Commit `feat(coop): replicate exact power FX via the shared PowerEffects primitives`.

---

### Task C2: Exact ultimate FX + body clip

**Why:** Meteor/Frost-Nova/Whirlwind/Multishot/etc. show only a generic burst; the body plays a
generic special pose, not the specific ult clip.

**Files:** `src/survivors/abilities/AbilityManager.ts`, `src/survivors/SurvivorsGameplayState.ts`, `src/survivors/champions/Champion.ts` (ghost `playAbilityClip`).

- [x] **Step 1:** For the non-persistent ults (Meteor, Frost Nova, Explosive Arrow, Smash), have their visual spawners reuse the Task-C1 primitive-emit (Meteor ring = `spawnExpandingRing`, etc.) so they cross for free; for bespoke meshes, add an `fx` 'ult' with an ability id and replay a parameterised cosmetic in `playRemoteFx`.

- [x] **Step 2: Body clip.** Add an `fx` 'abilityClip' carrying `{ suffix, duration, speed }` (the three `playAbilityClip` args). Emit it where `setOnActivate` plays the clip (`SurvivorsGameplayState.ts:~1125`). In `playRemoteFx`, call `coopGhost.playAbilityClip(suffix, duration, speed)`.

- [x] **Step 3: Persistent ults** (Whirlwind/Multishot 5s channels, Whirling Blades orbiters): send a START `fx` and a STOP `fx` (or a duration); the receiver spawns/owns the cosmetic for the duration. Track active cosmetic channels in a `Map` keyed by a channel id so STOP can dispose them. (This is the one piece that needs more than a one-shot — design the start/stop pair carefully.)

- [x] **Step 4: Verify** + two-tab. Commit `feat(coop): replicate ultimate FX + body clips to the teammate`.

---

# PHASE D — Reconnection completion (M5-5 transparent rejoin)

**Why:** Today a dropped peer triggers only the grace-window fallback (host-solo / guest-run-over).
True transparent rejoin (resume → live session re-wire → resync) was deferred because the wiring
extraction is risky and needs induced-disconnect testing.

**Files:** `src/survivors/SurvivorsGameplayState.ts`, `src/net/WebSocketTransport.ts` (resume option already exists).

- [x] **Step 1: Extract `wireCoopSession(transport, localChamp)`** — cut the CoopSession creation + ALL callback wiring (the `if guest {…} else {…}` block) into one method. Guard one-time scene state: `if (!this.guestEnemies) this.guestEnemies = …`. Dispose any prior `coopSession` first. Re-set `transport.onClose` + `coopSession.onPeerLeft` + the `fx`/run-summary hooks. **This is the risky extraction that previously tangled — do it as its own commit and verify SP + a fresh two-tab connect still work before adding reconnect.**

- [x] **Step 2: On my own `onConnectionLost`,** attempt resume within the window: in `_updateReconnect`, while `reconnecting`, every ~1s try `await this._roomService.connect(this._roomCode, { resume: { role } })`; on success call `wireCoopSession(newTransport, localChamp)`, `connMachine.onPeerRejoined()`, hide the overlay, and (guest) `sendRequestState()` to resync enemies; the next keyframe (M5-7) restores the snapshot base.

- [x] **Step 3: Detect the OTHER peer's rejoin** (when their traffic resumes after a peer-left): on any incoming snapshot/heroState/input while `reconnecting`, call `connMachine.onPeerRejoined()` + hide the overlay.

- [x] **Step 4: Verify** + two-tab WITH induced disconnects (kill one tab's network / refresh within 30s; it should rejoin and resync). Commit `feat(coop-m5): transparent reconnect — resume + session re-wire + resync`.

---

# PHASE E — Deferred performance/quality

### Task E1: Binary snapshot codec

**Why:** Snapshots are JSON (fine on localhost; over budget on a real link). M5-7 delta-compression
is wired; binary is the other half.

**Files:** Create `src/net/SnapshotBinary.ts`; `tests/snapshotBinary.spec.ts`; wire behind the `tick` channel in `NetClient`.

- [x] **Step 1: Failing test** — `decodeSnapshot(encodeSnapshot(msg))` deep-equals (within f32 tolerance) for 0/1/many enemies + 2 heroes + wave + flags. (See the original M3 plan Task 11 contract.)
- [x] **Step 2:** Implement `ArrayBuffer`/`DataView` encode/decode; keep events JSON. Route the snapshot + delta through binary when `channel:'tick'`.
- [x] **Step 3:** Verify pure tests pass; tsc/build ok. Commit `perf(coop): binary DataView snapshot codec`.

### Task E2: Input-replay reconciliation (smoother guest prediction)

**Why:** The guest reconciles against a stale authoritative pos with a dead-zone; correct
client-prediction replays unacknowledged inputs after snapping to `ackSeq`. (Review finding #6.)

**Files:** `src/survivors/coop/CoopSession.ts` (input history ring), `src/survivors/HeroController.ts` (extract a pure `integrateMove` helper), `src/survivors/SurvivorsGameplayState.ts` (reconcile), `tests/coopReconcile.spec.ts`.

- [x] **Step 1:** Record `{seq,dx,dz,dt}` per `sendLocalInput` in a bounded ring; add `pruneInputHistory(ackSeq)`.
- [x] **Step 2:** Extract the movement integration from `HeroController.update` into a pure `integrateMove(pos, dir, speed, dt, arenaRadius)` shared by live update + replay; unit-test it.
- [x] **Step 3:** On snapshot apply: prune acked inputs, set base = authoritative `heroes[1]`, replay the unacked inputs through `integrateMove`, THEN dead-zone/lerp between the current predicted pos and the replayed pos.
- [x] **Step 4:** Verify + two-tab (movement should feel tight with no steady lag/stop-tug). Commit `feat(coop): input-replay reconciliation`.

### Task E3: Coalesce per-frame curse DoT (network + damage-number spam)

**Why:** Curse ticks per frame → the host broadcasts a `damageResult` per frame per cursed enemy.
(Review finding #8 — changing the shared StatusModel risks SP balance, so do it carefully + test.)

**Files:** `src/survivors/enemies/StatusModel.ts`.

- [x] **Step 1:** Add a `curseTickAcc` accumulator mirroring `burnTickAcc`; emit curse damage on a ~0.5s interval instead of per-frame (matches burn). Verify SP curse DPS is unchanged over a full duration (integrate to the same total).
- [x] **Step 2:** Verify (`tests/StatusReactions.spec.ts` if it covers curse) + manual SP balance check. Commit `perf(coop): coalesce curse DoT to a 0.5s tick`.

---

## Self-review notes

- Every Phase-A/B/C/D task is gated on tsc+test+build AND two-tab manual (scene-coupled, can't be unit-tested — same constraint as M3–M5).
- The `fx` channel + `Enemy.guest*Redirect`/`applyNetworkState` patterns are already shipped; new tasks extend them, so SP stays byte-identical (hooks null/guarded outside co-op).
- P0 (fairness) before P1/P2 (cosmetic) — those affect playability, not just looks.
- The full gap catalogue with file:line for every item is in `docs/superpowers/specs/2026-06-08-coop-share-coverage-audit.md`; this plan implements the not-shared/partial items in priority order.
