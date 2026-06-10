# Co-op M3 — Shared Enemies & Waves Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`. Keep `npx tsc --noEmit` + `npm test` + `npm run build` green at every task; single-player behavior must stay identical (additive or gated on `coopSession.role`).

**Goal:** Both players fight the same host-authoritative enemies/waves; guest renders snapshots/events instead of simulating; both basic-attack shared enemies.

**Design:** `docs/superpowers/specs/2026-06-07-coop-m3-shared-enemies-design.md`. Builds on M1+M2 (`src/net/**`, `CoopSession`, `coopGhost`).

**Order:** pure-logic core first (1–4, fully unit-tested), then scene wiring (5–10), binary (11), leak gate (12).

---

## Conventions
- Pure modules under `src/net/**` and pure helpers must NOT import `@babylonjs/core` (Vitest is node-only). Tests flat in `tests/*.spec.ts`.
- Scene tasks (touch `Enemy.ts`/`EnemyManager.ts`/`SurvivorsGameplayState.ts`) are verified by `tsc`+`build`+`npm test` (no regressions) and left for the user's two-tab visual demo.
- Co-op is active when `this.coopSession` is set (host or guest); role via `this.coopSession.role`.

---

### Task 1 — Stable enemy IDs

**Files:** `src/survivors/enemies/Enemy.ts`, `src/survivors/enemies/EnemyManager.ts`, test `tests/enemyIds.spec.ts`

The implementer must read `EnemyManager.ts` around `spawnSurvivorsEnemy` (~:482, push ~:580), the mini-split handler (~:141), and boss-clone handler (~:166) to place id assignment at every push point.

- [ ] **Step 1: Add the field.** In `Enemy.ts` add `public id: number = -1;` near the other public fields (~:120).
- [ ] **Step 2: Add the counter + assignment.** In `EnemyManager.ts` add `private nextEnemyId = 0;`. Assign `enemy.id = this.nextEnemyId++;` immediately before EACH push of a survivors enemy into the live array: the main `spawnSurvivorsEnemy` push, the mini-split push, and the boss-clone push. Reset `this.nextEnemyId = 0` wherever per-run enemy state resets (in `configureSurvivorsMode`).
- [ ] **Step 3: Expose a test seam.** Ensure `spawnSurvivorsEnemy` returns the `Enemy` (it already returns `Enemy | null`) so ids are observable. No new API needed if `getEnemies()`/equivalent exists; otherwise add `public getEnemies(): Enemy[]` returning the live array (read-only use).
- [ ] **Step 4: Test (pure-ish — constructs EnemyManager without a full scene if feasible; otherwise test the id-assignment logic in isolation).** If `EnemyManager`/`Enemy` construction requires Babylon, instead extract the counter logic is unnecessary — write `tests/enemyIds.spec.ts` asserting a tiny pure helper OR, if construction is Babylon-bound, SKIP the unit test and verify via tsc+a code-read, noting it. Prefer: assert that ids are monotonic and unique across a spawn sequence and that swap-pop removal does not change surviving ids. If Babylon blocks construction in node, document that and rely on the scene demo.
- [ ] **Step 5: Verify** `npx tsc --noEmit` clean, `npm test` green, `npm run build` ok.
- [ ] **Step 6: Commit** `feat(coop-m3): stable enemy ids (Enemy.id + EnemyManager counter)`

> NOTE for implementer: if `Enemy`/`EnemyManager` cannot be unit-tested in the node harness (Babylon import at module load), do NOT force it — report that and rely on the integration demo + tsc. Do not add a fake just to have a test.

---

### Task 2 — Snapshot/Event types + JSON codec (PURE, TDD)

**Files:** extend `src/net/Protocol.ts`; test `tests/netM3Protocol.spec.ts`

Add message types and a status/flag bitfield helper. Keep the existing `encode`/`decode` boundary and `KNOWN_TAGS`.

- [ ] **Step 1: Write the failing test** `tests/netM3Protocol.spec.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { encode, decode, type NetMessage } from '../src/net/Protocol';
import { packEnemyFlags, unpackEnemyFlags } from '../src/net/EnemyFlags';

describe('M3 protocol', () => {
  it('round-trips a snapshot', () => {
    const msg: NetMessage = {
      t: 'snapshot', tick: 5, ackSeq: 3, timeScale: 1,
      heroes: [{ id: 0, x: 1, y: 0, z: 2, ry: 0.5, hp: 90, anim: 1 }],
      enemies: [{ id: 7, x: 3, z: -4, ry: 1.2, hp: 20, flags: 0b101, anim: 2 }],
      wave: { n: 3, alive: 12, inProgress: 1, breather: 0 },
    };
    expect(decode(encode(msg))).toEqual(msg);
  });
  it('round-trips spawn/death/damage/wave events', () => {
    const msgs: NetMessage[] = [
      { t: 'spawn', id: 1, type: 'basic', x: 0, z: 0, maxHealth: 30 },
      { t: 'death', id: 1, x: 0, z: 0, isElite: false, isClone: false, reward: 10 },
      { t: 'damageReport', enemyId: 1, amount: 12, element: 'fire', sourceHeroId: 1 },
      { t: 'damageResult', enemyId: 1, amount: 12, isCrit: false, element: 'fire', x: 0, z: 0 },
      { t: 'wave-start', wave: 4 },
      { t: 'wave-clear', wave: 3 },
    ];
    for (const m of msgs) expect(decode(encode(m))).toEqual(m);
  });
  it('packs/unpacks the enemy flag bitfield', () => {
    const f = { frozen: true, stunned: false, confused: true, flying: false, elite: true, meleePhase: 2 };
    expect(unpackEnemyFlags(packEnemyFlags(f))).toEqual(f);
  });
});
```
Run `npm test -- netM3Protocol` → FAIL.
- [ ] **Step 2: Implement** a new `src/net/EnemyFlags.ts` (pure) with `packEnemyFlags`/`unpackEnemyFlags` (bits 0..2 frozen/stunned/confused, bit3 flying, bit4 elite, bits 5–6 meleePhase 0..3). Extend `Protocol.ts` with the interfaces (`SnapshotMsg`, `SpawnMsg`, `DeathMsg`, `DamageReportMsg`, `DamageResultMsg`, `WaveStartMsg`, `WaveClearMsg`), add them to the `NetMessage` union and `KNOWN_TAGS` (`snapshot, spawn, death, damageReport, damageResult, wave-start, wave-clear`).
- [ ] **Step 3: Run** `npm test -- netM3Protocol` → PASS.
- [ ] **Step 4: Verify** tsc clean, full `npm test` green.
- [ ] **Step 5: Commit** `feat(coop-m3): M3 wire messages + enemy flag bitfield`

---

### Task 3 — Enemy serialize/apply (PURE codec + visibility)

**Files:** `src/net/EnemySnapshot.ts` (pure mapping between an `EnemyState` plain object and the snapshot entry), small visibility additions to `Enemy.ts`; tests `tests/enemySnapshot.spec.ts`

Keep the PURE part (the plain-object ⇄ wire mapping) separate from the Babylon `Enemy` so it's unit-testable. The Babylon side (reading from / writing to a real `Enemy`) is a thin adapter verified in the scene tasks.

- [ ] **Step 1: Write the failing test** asserting a plain `EnemyState` (`{id,x,z,ry,hp,maxHealth,flags,anim,stacks}`) round-trips through `toEntry`/`fromEntry` losslessly, including the optional status-stack sub-array.
- [ ] **Step 2: Implement** `src/net/EnemySnapshot.ts`: `interface EnemyState`, `toEntry(s)`, `fromEntry(e)` (and a `diffRemovedIds(prevIds, nextIds)` helper for id-diff removal). Pure.
- [ ] **Step 3:** Add to `Enemy.ts` (additive, no single-player change): `public getMeleeDisplay(): { phase: number; progress: number }` and `public applyNetworkState(s: EnemyState): void` (mutates position/rotation.y/health/maxHealth/status flags + selects anim). `applyNetworkState` is the ONE place the guest pokes enemy fields. Also `serializeStacks()/applyStacks()` if status stacks are synced.
- [ ] **Step 4: Run/verify** pure tests pass, tsc clean, build ok.
- [ ] **Step 5: Commit** `feat(coop-m3): pure enemy snapshot codec + Enemy.applyNetworkState`

---

### Task 4 — Nearest-of-two targeting resolver (PURE + Enemy wiring)

**Files:** `Enemy.ts`; pure helper `src/survivors/enemies/nearestTarget.ts`; test `tests/nearestTarget.spec.ts`

- [ ] **Step 1: Failing test** for `pickNearestAlive(fromX, fromZ, providers)` where a provider is `{ getPosition(): {x,z}; isAlive(): boolean }`: returns nearest **alive**; excludes `isAlive()===false`; returns null when none alive; ties resolve deterministically (first).
- [ ] **Step 2: Implement** `src/survivors/enemies/nearestTarget.ts` (pure; operates on `{x,z}` + provider list).
- [ ] **Step 3: Wire** `Enemy`: replace the single `seekTarget` with `public seekTargets: HeroProvider[] = []` plus a `protected resolveSeekTarget()` using `pickNearestAlive`. Update the seek branch in `update()` and `updateMeleeAttack()` to use the resolver. **Single-player passes a one-element array** → identical behavior. Keep a back-compat path if other code reads `seekTarget`.
- [ ] **Step 4: Verify** pure tests pass; tsc clean; `npm test` green; play single-player mentally/by build (no behavior change with one provider).
- [ ] **Step 5: Commit** `feat(coop-m3): nearest-of-two seek-target resolver`

---

### Task 5 — `configureSurvivorsMode(heroProviders[])`

**Files:** `EnemyManager.ts`, `SurvivorsGameplayState.ts`

- [ ] **Step 1:** Change `configureSurvivorsMode(heroProvider, arenaRadius)` → `configureSurvivorsMode(heroProviders: HeroProvider[], arenaRadius)`. Store the array; assign `enemy.seekTargets = this.heroProviders` at every spawn/split/clone assignment site. Boss-clone reflect geometry uses the **nearest** hero.
- [ ] **Step 2:** In `SurvivorsGameplayState`, single-player + host call site passes `[localHeroProvider]` for now (the ghost provider is added in Task 9). Guest passes `[]` (it never targets).
- [ ] **Step 3: Verify** tsc clean, tests green, build ok; single-player unchanged.
- [ ] **Step 4: Commit** `refactor(coop-m3): configureSurvivorsMode takes hero-provider array`

---

### Task 6 — Guest render-only enemy mode

**Files:** `src/survivors/coop/GuestEnemies.ts` (new — guest-side registry), `Enemy.ts` (guard hooks if needed), `EnemyManager` (a way to construct an enemy without spawning/registering — or `GuestEnemies` constructs leaf subclasses directly).

- [ ] **Step 1:** Implement `GuestEnemies` (Babylon, manual-verified): a `Map<number, Enemy>` with `spawn(spawnMsg, scene/game)` (construct the right leaf subclass by `type`, set `id`, `maxHealth`, position; do NOT register shadows; leave `seekTargets` empty), `applyState(entry)` (calls `enemy.applyNetworkState`), `remove(id)` (`enemy.disposeCorpse()`), `removeMissing(liveIdSet)`, `clear()`.
- [ ] **Step 2:** Map enemy `type` string → leaf constructor (reuse the same switch `spawnSurvivorsEnemy` uses; factor a shared `createEnemyOfType(type, game, pos)` if clean).
- [ ] **Step 3: Verify** tsc clean, build ok, tests green (no unit test for the Babylon class; logic-only helpers like the type→ctor map can be tested if pure).
- [ ] **Step 4: Commit** `feat(coop-m3): guest render-only enemy registry`

---

### Task 7 — Host snapshot authoring + guest apply

**Files:** `src/survivors/coop/CoopSession.ts` (extend: snapshot send/receive buffer for enemies), `SurvivorsGameplayState.ts` (role branch in `update()`)

- [ ] **Step 1:** Extend `CoopSession` (pure-testable parts): host `authorSnapshot(...)` builds a `SnapshotMsg` from enemy states + hero states + wave; guest buffers the latest snapshot and exposes `getEnemySnapshot()`/applies via `GuestEnemies`. Add unit tests for the buffer/latest-wins logic where pure.
- [ ] **Step 2:** In `SurvivorsGameplayState.update()`, add the role branch: **host** runs the existing loop, then authors + sends a snapshot at ~20 Hz (throttle). **guest** skips `enemyManager.update`, `waveManager.update`, wave-breather, `applyContactDamage`; instead applies the latest snapshot to `GuestEnemies` (lerp via the existing interpolation approach or direct set + smoothing) and processes spawn/death events.
- [ ] **Step 3:** Wire `spawn`/`death` events: host emits on `spawnSurvivorsEnemy` and `Enemy.die`/elite-death; guest applies via `GuestEnemies.spawn`/`remove`.
- [ ] **Step 4: Verify** tsc clean, tests green, build ok.
- [ ] **Step 5: Commit** `feat(coop-m3): host snapshot authoring + guest enemy apply`

---

### Task 8 — DamageRouter (guest→host basic-attack damage)

**Files:** `src/survivors/coop/DamageRouter.ts` (pure logic + thin seam), `HeroBasicAttack.ts` (intercept the hit), `SurvivorsGameplayState.ts`/`CoopSession` (host apply); tests `tests/damageRouter.spec.ts`

- [ ] **Step 1: Failing test** for the pure router: `report(enemyId, amount, element, heroId)` queues a `damageReport`; host-side `apply(reports, lookupEnemy, applyDamage)` validates the id exists + (loosely) in range and calls `applyDamage`, dropping reports for missing ids; returns the applied results for broadcast.
- [ ] **Step 2: Implement** `DamageRouter` (pure). 
- [ ] **Step 3: Seam:** in `HeroBasicAttack` hit application, when `coopSession?.role==='guest'`, route `enemyId, amount, element` to the router (emit `damageReport`) instead of calling `enemy.takeDamage` on the shared enemy; fire the local damage-number VFX immediately (predicted). Host receives `damageReport`, validates, calls real `takeDamage` (host rolls crit), and the result flows back via snapshot HP + `damageResult` event (guest shows the number/death FX).
- [ ] **Step 4: Verify** pure tests pass; tsc clean; build ok; single-player path unchanged (router only engaged for `role==='guest'`).
- [ ] **Step 5: Commit** `feat(coop-m3): basic-attack damage routing (guest reports, host applies)`

---

### Task 9 — Contact damage for both heroes

**Files:** `SurvivorsGameplayState.ts` (`applyContactDamage`, host-only in co-op), add the ghost as a hero provider to targeting

- [ ] **Step 1:** Change `applyContactDamage` to, in co-op-host mode, iterate `[localHero, ghostHeroProvider]` (the ghost = guest hero position), applying contact DPS + melee-strike damage to each. Both HPs ship in the snapshot `heroes[]`. Single-player keeps the one-hero path.
- [ ] **Step 2:** Add the ghost provider to `configureSurvivorsMode` targeting on the host (now `[localHero, ghostProvider]`), with `isAlive()` from the guest hero's networked alive flag.
- [ ] **Step 3:** Guest applies its own hero HP from the snapshot (snapshot-authoritative); skip local `applyContactDamage`.
- [ ] **Step 4: Verify** tsc clean, tests green, build ok.
- [ ] **Step 5: Commit** `feat(coop-m3): host-authoritative contact damage for both heroes`

---

### Task 10 — Wave events

**Files:** `WaveManager.ts`/`SurvivorsGameplayState.ts` (host emits), guest disables wave update + breather

- [ ] **Step 1:** Host emits `wave-start` on `startNextWave` and `wave-clear` on wave-cleared. Guest does NOT run `waveManager.update` or the breather countdown; it updates its HUD wave/remaining from the snapshot `wave{}` + these events.
- [ ] **Step 2: Verify** tsc clean, tests green, build ok.
- [ ] **Step 3: Commit** `feat(coop-m3): host wave events drive guest HUD`

---

### Task 11 — Binary snapshot codec (PURE)

**Files:** `src/net/SnapshotBinary.ts` (DataView encode/decode for `SnapshotMsg`), wire it behind the snapshot path; tests `tests/snapshotBinary.spec.ts`

- [ ] **Step 1: Failing test** asserting `decodeSnapshot(encodeSnapshot(msg))` deep-equals the snapshot (within f32 tolerance) for 0/1/many enemies + 2 heroes + wave, incl. flags.
- [ ] **Step 2: Implement** binary encode/decode (ArrayBuffer/DataView). Keep events JSON. Route the snapshot through binary when `channel:'tick'`.
- [ ] **Step 3: Verify** pure tests pass; tsc clean; build ok.
- [ ] **Step 4: Commit** `perf(coop-m3): binary DataView snapshot codec`

---

### Task 12 — Leak/perf pass (gate)

- [ ] **Step 1:** Audit the guest path: every enemy removal uses `disposeCorpse()` (never `mesh.dispose()`); status particles use the shared texture + `dispose(false)`; caps honored.
- [ ] **Step 2:** Confirm `checkResourceBudget()` runs on both clients; document the manual gate (run 10+ waves two-tab, watchdog clean on both sides) for the user demo.
- [ ] **Step 3: Verify** tsc clean, tests green, build ok.
- [ ] **Step 4: Commit** `chore(coop-m3): guest enemy leak/perf guardrails`

---

## Self-review (run after all tasks)
- Every M3 design §2 decision has a task. Single-player path unchanged (gated/additive). Pure-logic core unit-tested. Scene tasks compile + build + no test regressions, flagged for the two-tab visual demo (render parity, shared basic-attack kills, contact damage both heroes, wave sync, 10-wave watchdog gate).
