# Co-op M3 — Host-Authoritative Shared Enemies & Waves (Design)

- **Date:** 2026-06-07
- **Status:** Approved-to-implement (autonomous: decisions taken on the design author's recommendation; user reviews the result)
- **Branch:** `feat/online-coop` (continues the M1+M2 work)
- **Builds on:** M1 relay (`src/net/**`, `worker/rooms/Room.ts`), M2 ghost teammate (`CoopSession`, `coopGhost: Champion`, JSON `encode/decode` in `Protocol.ts`).
- **Parent spec:** `docs/superpowers/specs/2026-06-06-online-coop-design.md` (this sharpens its M3 line against the real code).

## 1. Goal & demo

Both players fight the **same** enemies and waves, consistent across screens. The **guest stops simulating** the shared world (enemy AI, waves, contact, death) and instead **renders host-authoritative state** (snapshot + events), while continuing to predict its own hero locally (M2). Both players can **damage** shared enemies.

**M3 demo:** two tabs, host + guest, both see identical enemies/waves with consistent positions and HP; both players' **basic attacks** kill shared enemies; both heroes take contact damage; wave counter + "X/Y remaining" match; 10+ waves with the resource watchdog clean on both sides.

## 2. Locked decisions (taken on recommendation)

| Decision | Choice | Why |
|---|---|---|
| Host/guest split | Guest skips `enemyManager.update`, `waveManager.update`, wave-breather, `applyContactDamage`, and `Enemy.takeDamage` on shared enemies; runs a render-only apply path instead. Keyed on `coopSession.role`. | Movement/targeting/death/waves are host-deterministic; guest re-running them diverges. |
| Guest enemy representation | **(A) Reuse real `Enemy` subclasses** in a network-driven render mode. | The visual surface (GLB skeletons, 11 types + 4 boss tiers, melee FSM, status particles, elite auras, tiered health bars, death clips) already lives in the subclasses; a parallel ghost class would be a second copy of the most leak-prone code and look worse. |
| Guest combat authority | **(B) client-reports-hits** — guest emits `damage` events; host validates (id exists, loosely in range) + applies (host rolls crit) + broadcasts result. **Scoped to basic attacks** for M3. | Real "both fight" demo without the full M4 `PlayerSlot`/loadout-on-host refactor. Trust is fine for friends-only private rooms. Powers/ultimates need id-targeting + loadout sync → M4. |
| Contact damage | **Host computes for both heroes** (it has both positions: local hero + ghost). Both HPs ship in the snapshot; guest hero HP is snapshot-authoritative. | Single authority for hero HP; guest never runs `applyContactDamage`. |
| Wire encoding | **JSON-first** (unblocks codec round-trip tests + the apply pipeline), **binary DataView snapshot before the demo** (100-enemy JSON ≈ 120–200 KB/s is dev-only; binary ≈ 16–28 KB/s). | Sequences risk; the parent spec mandates binary at M3. |
| Targeting | **Nearest-of-two** — `Enemy.seekTargets[]` + nearest-alive resolver; host passes `[localHero, ghostProvider]`. Downed hero excluded. | Both heroes are valid targets; the M2 ghost already carries the guest hero's networked position. |
| Stable IDs | `Enemy.id` assigned from `EnemyManager.nextEnemyId++` at the single push point; per-run reset; all snapshots/events key on id. | `Enemy` has no id; swap-pop churns indices. Hard prerequisite for everything. |
| Disposal | Guest removes enemies via **`disposeCorpse()`** (frees GLB skeleton bone-matrix texture, anim groups, per-instance materials, shadow-renderlist, health-bar textures). Never plain `mesh.dispose()`. Honor `MAX_CORPSES=16` / `MAX_ACTIVE_DEATH_BURSTS=18`; reuse the shared status-effect texture. | Networked spawn/despawn churn hits the project's worst leak class; the wave-clear watchdog is the gate on both sides. |

**Explicit M3/M4 boundary:** basic-attack damage routing is M3; **power/ultimate damage routing, per-player progression (`PlayerStats`/`LevelSystem`/`PowerSlotManager` per player), full guest input authority + prediction-reconciliation, revive/respawn, and the 2-column game-over are M4.** M3 keeps M2's local own-hero prediction and per-client power firing (powers still hit only the firer's *local* view until M4 — see §7 risk).

## 3. The host/guest split (update loop)

Keyed on `this.coopSession?.role`. Single-player and **host** run `SurvivorsGameplayState.update()` unchanged. **Guest** branches:

| Loop step | Host | Guest |
|---|---|---|
| `heroController.update` / `hero.update` (own hero) | run | **run** (M2 prediction) |
| remote-hero (ghost) apply | author into snapshot | **apply** snapshot hero pose (M2) |
| wave-breather countdown / `waveManager.update` | run | **skip** — driven by `wave-start`/`wave-clear` events |
| `enemyManager.update` (AI/melee/death/swap-pop) | run → **author enemy snapshot** at end of frame | **skip** → `applyEnemySnapshot()` (lerp pos/hp/flags, id-diff removal) + apply `spawn`/`death`/`damage` events |
| `applyContactDamage` | run **for both heroes** | **skip** (hero HP snapshot-authoritative) |
| `powerSlots` / `abilityManager` | run | run **own** locally (M2; cosmetic vs shared enemies until M4) |
| cosmetic readers (grass torch, off-screen indicators, camera) | run | run (read snapshot-driven positions) |

Host authors the snapshot at the **end** of `update()` (after the existing tick), reflecting the fully-ticked frame. Guest's `enemyManager` becomes a **registry of render-only enemies keyed by id**; its `update()` is never called.

## 4. Stable enemy IDs (prerequisite)

- Add `public id: number = -1;` to `Enemy`.
- Add `private nextEnemyId = 0;` to `EnemyManager`; assign `enemy.id = this.nextEnemyId++` at the single push point in `spawnSurvivorsEnemy` (and the mini-split + boss-clone push points, which flow through the same code or their own pushes — assign before each push).
- Reset per-run (alongside the rest of the run reset).
- Guest keeps `Map<number, Enemy>`; all lookups by id, never index/reference. ID persists through the corpse phase.
- Split/clone: host assigns ids in spawn order and emits one `spawn` event per child **in that order**; guest never derives ids.

## 5. Guest render-only enemy mode

Construct via the existing leaf constructors so `createMesh()`/`_initEnemyVisuals()` build the correct mesh+skeleton+health-bar. Then **guard host-only behavior**:

- `seekTargets` stays empty; `EnemyManager.update()` never runs on the guest, so no AI/movement/contact.
- **Skip shadow registration** on the guest (`_shadowGenerators` stays empty → `disposeCorpse` shadow-removal is a safe no-op).
- A new **`Enemy.applyNetworkState(state)`** method mutates `position`, `rotation.y`, `health`/`maxHealth`, status flags, and selects the anim (idle/walk/attack from `meleeState`) in one guarded, testable place.
- Required visibility changes: expose `meleeState`/`meleeTimer` display (e.g. `getMeleeDisplay()` / accept via `applyNetworkState`); add `serializeStacks()`/`applyStacks()` for status round-trip. Keep single-player behavior byte-identical (additive methods only).

## 6. Wire additions (over M2)

Behind the same `encode/decode` boundary. **Snapshot** (`channel:'tick'`, ~20 Hz, last-wins):
```ts
interface SnapshotMsg {
  t: 'snapshot'; tick: number; ackSeq: number; timeScale: number;
  heroes: { id: 0|1; x: number; y: number; z: number; ry: number; hp: number; anim: number }[];
  enemies: { id: number; x: number; z: number; y?: number; ry: number; hp: number; flags: number; anim: number }[];
  wave: { n: number; alive: number; inProgress: 0|1; breather: number };
}
```
`flags` packs frozen/stunned/confused/flying/elite + 2-bit melee phase; rich status stacks ride a compact sub-array only when present. `maxHealth` ships once in the `spawn` event (authoritative post-scaling value).

**Events** (`channel:'event'`, reliable, seq+ack, JSON):
| Event | Dir | Payload |
|---|---|---|
| `spawn` | host→guest | `id, type, x, z, eliteElement?, maxHealth, isClone?, enrageOriginId?` |
| `death` | host→guest | `id, x, z, isElite, eliteElement?, isClone, reward` |
| `damageReport` | guest→host | `enemyId, amount, element, sourceHeroId` |
| `damageResult` | host→guest | `enemyId, amount, isCrit, element, x, z` |
| `wave-start` | host→guest | `wave` |
| `wave-clear` | host→guest | `wave` |

Spawn/death/damage are **events** (reliable) so a dropped one can't leave a permanently-invisible enemy or a ghost corpse. Encoding: JSON shapes first; **binary DataView for the snapshot** before the demo (events stay JSON).

## 7. Risks & guardrails

- **Powers vs shared enemies (M3/M4 seam):** in M3 the guest's **powers/ultimates** still damage only its local view (which, for shared enemies on the guest, is render-only and host-authoritative — so guest power damage is effectively cosmetic until M4 routes it). **Basic attacks** are routed via `DamageRouter`. This is the honest M3 limitation; the demo claim is "both **basic-attack** the same enemies."
- **Leak class:** guest churns enemies at host spawn rate. Mandatory `disposeCorpse()`, honor caps, shared status texture, `ParticleSystem.dispose(false)`. **Hard exit criterion:** 10+ waves two-tab, `checkResourceBudget()` clean on both sides.
- **Determinism:** host owns all RNG (spawn theta, split offsets, crit, clone-reflect geometry) and ships computed positions/results in events; guest never re-rolls.
- **Float reflect (boss clone):** host computes clone position, ships it in `spawn`; guest never recomputes.
- **Single-player safety:** every change is additive or gated on `coopSession.role`; `configureSurvivorsMode([hero])` keeps the single-provider path; no behavior change without co-op params.

## 8. Task breakdown (ordered; pure-logic first)

| # | Task | Type |
|---|---|---|
| 1 | `Enemy.id` + `EnemyManager.nextEnemyId` assign-at-push + per-run reset | pure-ish (unit: ids 0..N-1, swap-pop preserves) |
| 2 | Snapshot/Event types + JSON codec in `Protocol.ts` (snapshot, spawn, death, damageReport/Result, wave-start/clear) + flag bitfield pack/unpack | **pure** (round-trip tests) |
| 3 | `serializeEnemy(enemy)` / `applyEnemyState(enemy, entry)` + status-stack serialize/apply (visibility changes) | **pure** (lossless round-trip) |
| 4 | Nearest-of-two resolver: `Enemy.seekTargets[]` + `resolveSeekTarget()` (nearest alive, excludes downed) | **pure** |
| 5 | `configureSurvivorsMode(heroProviders[])` refactor + wire 4 assignment sites; single-player passes `[hero]` | scene |
| 6 | Guest render-only enemy mode: construct subclasses, guard side-effects, `applyNetworkState()` | scene (manual) |
| 7 | Host snapshot authoring + guest apply (skip §3 steps; lerp + id-diff removal; spawn/death events) | scene (manual) |
| 8 | `DamageRouter` + guest→host `damageReport` (basic-attack seam) + host validate/apply + `damageResult` | mixed (router logic pure-testable) |
| 9 | Contact damage for both heroes (`applyContactDamage` iterates `[localHero, ghostProvider]`) | scene |
| 10 | Wave events (`wave-start`/`wave-clear`); guest disables wave update + breather, drives HUD from events | scene |
| 11 | Binary snapshot codec (DataView) behind `encode/decode`; events stay JSON | **pure** (reuse round-trip tests) |
| 12 | Leak/perf pass: `disposeCorpse()`, caps, shared texture; 10+ waves two-tab, watchdog clean both sides | manual + watchdog |

## 9. Testing

- **Vitest (pure):** id assignment + swap-pop; snapshot/event codec round-trips incl. flag pack/unpack; enemy serialize/apply losslessness; nearest-of-two (2 providers, downed excluded, 0-alive→null); DamageRouter validate/apply; binary codec round-trip identity.
- **Manual two-tab:** render parity, shared kills (basic attack), contact damage both heroes, wave sync, and the 10-wave watchdog gate.
- Keep `npx tsc --noEmit` + `npm test` + `npm run build` green at every task; single-player unchanged.
