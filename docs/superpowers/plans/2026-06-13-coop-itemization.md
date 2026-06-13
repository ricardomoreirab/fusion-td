# Co-op Itemization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring full single-player itemization (equipment, shop, item effects, unique sets, mythic weapons) to 2-player online co-op, per `docs/superpowers/specs/2026-06-13-coop-itemization-design.md`.

**Architecture:** Each client owns its hero's items end-to-end; the host stays the single authority for enemy HP via the three existing redirect statics. The wire carries only final numbers + cosmetic hints. Crit is rolled on the acting client and sent as `amount` (post-crit) + `isCrit`; the host applies it without re-rolling. Single-player stays byte-identical (every change is gated by `coopSession` presence or sits behind per-`PlayerSlot` accessors).

**Tech Stack:** TypeScript, BabylonJS, Vitest. Build `npm run build`; type-check `npx tsc --noEmit`; tests `npm test`.

**Branch:** `feat/coop-itemization`. **Do NOT merge to main** — leave for user review.

---

## File map

| File | Change |
|---|---|
| `src/net/Protocol.ts` | `DamageReportMsg += isCrit?: boolean`; new `RewardMsg`; new FX `kind`s documented |
| `src/survivors/enemies/Enemy.ts` | `takeDamage(amount, element?, reportedCrit?)`; roll crit before the guest redirect; `guestDamageRedirect` signature += `isCrit` |
| `src/survivors/SurvivorsGameplayState.ts` | Lift the `if (solo)` block to co-op; role-aware `buildEffectContext`; crit-aware `onDamageReport`; redirect closures send `isCrit`; combat-hook wiring; kill attribution + reward delta; move-speed→ghost; cosmetic emits; non-blocking shop |
| `src/survivors/champions/HeroBasicAttack.ts` | Split the `if (!this.damageRouter)` guard so the hook fires on the guest; roll crit client-side for the routed number |
| `src/survivors/HeroController.ts` | Wire `setOnHurt` in co-op |
| `src/survivors/coop/CoopSession.ts` | `sendReward`/`onReward`; (re)send mythic-aura on `requestState` |
| `src/survivors/coop/CoopFx.ts` | New `kind`s replay: `ring`, `beam`, `mythicAura` |
| `src/survivors/items/ItemEffectRuntime.ts` | `EffectFx.ring/beam` impls in the adapter also `emitCoopFx` (done in the state adapter, not here) |
| `tests/coopItems*.spec.ts` (new) | crit-as-number routing, reward attribution, no-double-apply/echo, role-aware reads |

**Verified ground truth (line numbers as of branch base):** solo gate `SurvivorsGameplayState.ts:1207-1225`; crit provider def `:836-839`; `Enemy.takeDamage` crit roll `Enemy.ts:1413-1419`; guest redirect `Enemy.ts:1404-1408`; redirect closures `:1987-2035`; `onDamageReport` `:2070-2098`; `onDamageCallback`/`onRewardCallback` `:942-971`; `damageMultiplierProvider` folds item dmg `:1034-1039`; `activeAttackEnemies` role-aware `:1029,1138,4040`; `isPausedForOverlay` `:3333`; `_driveGuestGhostFromInput` `:1618`; `buildEffectContext` `:3768`.

---

## Phase 1 — Lift the gate (flat stats work in co-op)

Construct the item systems for each co-op client; flat stats (damage/lifesteal/regen/gold/cooldown/defense/attack-speed) then work immediately because they fold into the local `PlayerStats` and the guest's locally-computed attack number, which the host already trusts. Combat-event hooks are deferred to Phase 4 (they're inert/guarded until then).

### Task 1.1: Construct item systems for co-op clients

**Files:**
- Modify: `src/survivors/SurvivorsGameplayState.ts:1207-1225`

- [ ] **Step 1: Read the current `if (solo)` block (`:1204-1225`)** to see exactly what it constructs (`equipment`, `equipTracker`, `equipMaxHpApplied`, `rageGlow`, `itemEffects`, `shopOverlay`, `goblinPortrait`, `characterProfile`, the HUD horn/character hooks, `updateInventoryHud`, and the two combat-event hooks).

- [ ] **Step 2: Split the block.** Construct the item systems for **all** clients (solo OR co-op), but keep the two combat-event hooks (`setOnHurt` / `getBasicAttack().setOnHit`) **solo-only for now** (Phase 4 makes them co-op-safe). Replace the block with:

```ts
        // ── Itemization + merchant shop ──────────────────────────────────────
        // Per-client: each player owns its own equipment/effects/shop. Construct
        // for solo AND co-op (every system resolves through the per-PlayerSlot
        // accessors). Combat-event hooks are wired below — solo immediately,
        // co-op in the guest-safe form (Phase 4).
        this.equipment = new Equipment(this.playerStats);
        this.equipTracker = newEquipFoldTracker();
        this.equipMaxHpApplied = 0;
        this.rageGlow = new RageGlow(this.scene, () => this.hero?.getPosition() ?? null);
        this.itemEffects = new ItemEffectRuntime(this.buildEffectContext());
        this.shopOverlay = new ShopOverlay(this.gameUI!.layer('overlay'));
        this.goblinPortrait = getGoblinPortrait();
        this.characterProfile = new CharacterProfile(this.gameUI!.layer('overlay'));
        this.hud.setOnHorn(() => this.soundHorn());
        this.hud.setOnOpenCharacter(() => this.openCharacter());
        this.updateInventoryHud();

        if (solo) {
            this.heroController.setOnHurt((amount) => this.itemEffects?.onHeroHurt(amount));
            this.heroController.getBasicAttack()?.setOnHit((enemy, dmg) =>
                this.itemEffects?.onBasicHit(enemy, dmg));
        }
```

- [ ] **Step 3: Verify the shop opens without pausing in co-op.** Read `setOnWaveCleared` (`:1083-1120`) — today the shop open is `soloNow`-gated (`:1112`). Change the gate so co-op also opens the shop, but never sets the pause flag. Read `openShop` + `isPausedForOverlay` (`:3333`) and confirm `isPausedForOverlay()` already returns `false` for co-op (so opening the overlay won't freeze the shared sim). Keep solo's pause behavior unchanged. (If the shop-open path forces a pause for solo only, leave that branch; just allow the co-op branch to open non-blocking.)

- [ ] **Step 4: Type-check + build + manual sanity (co-op smoke).**

Run: `npx tsc --noEmit && npm test`
Expected: clean; all existing tests pass (no behavior change to pure-logic modules).

- [ ] **Step 5: Commit.**

```bash
git add src/survivors/SurvivorsGameplayState.ts
git commit -m "feat(coop-items): construct per-client item systems in co-op (flat stats)"
```

---

## Phase 2 — Role-aware effect context

Item effects (Phase 4) query `enemiesNear`/`tryExecuteBelow`. On the guest `enemyManager.getEnemies()` is empty — these must use the role-aware `activeAttackEnemies()` so they hit the render registry, and an execute must route as damage (never a local kill).

### Task 2.1: Make `buildEffectContext` enemy reads role-aware

**Files:**
- Modify: `src/survivors/SurvivorsGameplayState.ts:3768-3833` (`buildEffectContext`)

- [ ] **Step 1: Read `buildEffectContext` (`:3768-3833`) and `activeAttackEnemies` (`:4040`).** Confirm `activeAttackEnemies()` returns the host's `enemyManager` enemies on the host and the render registry on the guest.

- [ ] **Step 2: Replace the `enemiesNear` body** to iterate `this.activeAttackEnemies()` instead of `this.enemyManager?.getEnemies()`:

```ts
            enemiesNear: (x, z, radius) => {
                const out: EffectEnemy[] = [];
                const rSq = radius * radius;
                for (const e of this.activeAttackEnemies()) {
                    if (!e.isAlive()) continue;
                    const p = e.getPosition();
                    const dx = p.x - x, dz = p.z - z;
                    if (dx * dx + dz * dz <= rSq) out.push(e);
                }
                return out;
            },
```

- [ ] **Step 3: Make `tryExecuteBelow` guest-safe.** On the guest, `(e as Enemy).takeDamage(hp, …)` already redirects (the guest's `takeDamage` redirects before mutating), so the execute routes to the host as a normal report — correct, no local kill. Confirm by reading `Enemy.takeDamage` (`:1396-1408`): the `guestDamageRedirect` early-return means the guest's execute becomes a damage report. No code change needed beyond a comment; leave `tryExecuteBelow` as-is.

- [ ] **Step 4: Type-check + commit.**

Run: `npx tsc --noEmit && npm test`
Expected: clean.

```bash
git add src/survivors/SurvivorsGameplayState.ts
git commit -m "feat(coop-items): role-aware effect enemy reads (render registry on guest)"
```

---

## Phase 3 — Crit per-source (RISKY CORE 1)

Move crit off the single host-global provider. The acting client rolls crit and sends the post-crit `amount` + `isCrit`; the host applies it verbatim and does not re-roll redirected reports.

### Task 3.1: Add `isCrit` to the wire + the redirect signature

**Files:**
- Modify: `src/net/Protocol.ts:62-73`
- Modify: `src/survivors/enemies/Enemy.ts:175-181` (the `guestDamageRedirect` static type)
- Test: `tests/coopItemsCrit.spec.ts` (new)

- [ ] **Step 1: Write the failing protocol round-trip test.** Create `tests/coopItemsCrit.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { encode, decode, DamageReportMsg } from '../src/net/Protocol';

describe('DamageReportMsg.isCrit', () => {
    it('round-trips the isCrit flag', () => {
        const msg: DamageReportMsg = {
            t: 'damageReport', enemyId: 7, amount: 120, element: 'fire',
            sourceHeroId: 1, isCrit: true,
        };
        const back = decode(encode(msg)) as DamageReportMsg;
        expect(back.isCrit).toBe(true);
    });
    it('omitting isCrit decodes as undefined', () => {
        const msg: DamageReportMsg = { t: 'damageReport', enemyId: 1, amount: 10, element: 'physical', sourceHeroId: 1 };
        const back = decode(encode(msg)) as DamageReportMsg;
        expect(back.isCrit).toBeUndefined();
    });
});
```

- [ ] **Step 2: Run → FAIL** (`isCrit` not on the type — TS compile error in the test).

Run: `npm test -- coopItemsCrit`
Expected: FAIL.

- [ ] **Step 3: Add `isCrit?: boolean` to `DamageReportMsg`** (`Protocol.ts:62-73`), after `sourceHeroId`:

```ts
    sourceHeroId: number;
    /** Post-crit damage flag: the ACTING client rolls crit and sends amount
     *  already multiplied; the host applies it without re-rolling. */
    isCrit?: boolean;
```

- [ ] **Step 4: Extend the `guestDamageRedirect` static signature** (`Enemy.ts:175`):

```ts
    public static guestDamageRedirect: ((enemyId: number, amount: number, element?: PowerElement, isCrit?: boolean) => void) | null = null;
```

- [ ] **Step 5: Run → PASS.** `npm test -- coopItemsCrit`. Commit.

```bash
git add src/net/Protocol.ts src/survivors/enemies/Enemy.ts tests/coopItemsCrit.spec.ts
git commit -m "feat(coop-items): DamageReportMsg.isCrit + redirect signature"
```

### Task 3.2: Roll crit before the guest redirect; host applies without re-rolling

**Files:**
- Modify: `src/survivors/enemies/Enemy.ts:1396-1450` (`takeDamage`)
- Test: `tests/coopItemsCrit.spec.ts`

- [ ] **Step 1: Write the failing behavior test** (add to `coopItemsCrit.spec.ts`). This drives a fake enemy through `takeDamage` with a redirect installed, asserting the redirect receives the **post-crit** amount + `isCrit`, and that a host applying `reportedCrit` does **not** multiply again. Use the real `Enemy` with a minimal mesh-free path if available; otherwise assert via the redirect static:

```ts
import { Enemy } from '../src/survivors/enemies/Enemy';
// Note: Enemy needs a scene; if these require Babylon NullEngine, mirror the
// existing enemy-bearing spec setup (see tests that import Enemy). If Enemy
// cannot be unit-constructed, assert the crit math via a pure helper extracted
// in Step 3 instead (rollCrit()).
```

If `Enemy` is not unit-constructable in the harness, **extract a pure helper** and test that:

```ts
import { rollCrit } from '../src/survivors/enemies/critRoll';
describe('rollCrit', () => {
    it('multiplies on a hit and reports isCrit', () => {
        const r = rollCrit(100, { chance: 1, damageMult: 2 }, () => 0);
        expect(r).toEqual({ amount: 200, isCrit: true });
    });
    it('no crit when roll fails', () => {
        const r = rollCrit(100, { chance: 0.5, damageMult: 2 }, () => 0.9);
        expect(r).toEqual({ amount: 100, isCrit: false });
    });
    it('passes a reported crit through without re-rolling', () => {
        const r = rollCrit(200, { chance: 1, damageMult: 2 }, () => 0, /*reported*/ true);
        expect(r).toEqual({ amount: 200, isCrit: true });
    });
});
```

- [ ] **Step 2: Run → FAIL** (`critRoll` missing).

- [ ] **Step 3: Create `src/survivors/enemies/critRoll.ts`** (pure, testable):

```ts
export interface CritParams { chance: number; damageMult: number; }
/** Roll (or accept) crit. `reported` (a host applying a client's post-crit
 *  report) bypasses the roll: amount is already final, isCrit is the report's. */
export function rollCrit(
    amount: number, cp: CritParams | undefined, rng: () => number, reported?: boolean,
): { amount: number; isCrit: boolean } {
    if (reported !== undefined) return { amount, isCrit: reported };
    if (cp && cp.chance > 0 && rng() < cp.chance) return { amount: amount * cp.damageMult, isCrit: true };
    return { amount, isCrit: false };
}
```

- [ ] **Step 4: Rework `Enemy.takeDamage`** (`:1396-1450`) to roll crit BEFORE the redirect (so the guest crits at ITS rate) and accept a `reportedCrit`:

```ts
    public takeDamage(amount: number, element?: PowerElement, reportedCrit?: boolean): boolean {
        if (!this.alive) return false;

        // Roll (or accept) crit FIRST. On the co-op guest critProvider reads the
        // GUEST's stats, so the guest crits at its own rate; the post-crit number
        // is what gets redirected to the host (which applies it via reportedCrit).
        const cp = Enemy.critProvider?.() ?? undefined;
        const rolled = rollCrit(amount, cp, Math.random, reportedCrit);
        let actualDamage = rolled.amount;
        const isCrit = rolled.isCrit;

        // Co-op guest: redirect the POST-crit amount + isCrit; apply nothing local.
        const redirect = Enemy.guestDamageRedirect;
        if (redirect) {
            redirect(this.id, actualDamage, element, isCrit);
            return false;
        }

        // host/solo: resistance + amplifier (host-authoritative enemy props).
        if (this.damageResistance && this.damageResistance > 0) actualDamage *= (1 - this.damageResistance);
        actualDamage *= this.statuses.damageAmplifier();
        this.health -= actualDamage;
        this.updateHealthBar();
        this.flashHit();
        const dmgCb = Enemy.onDamageCallback;
        if (dmgCb) dmgCb(this.position, actualDamage, isCrit, element);
        if (this.health <= 0) { this.health = 0; this.die(); return true; }
        return false;
    }
```

Add `import { rollCrit } from './critRoll';` at the top of `Enemy.ts`.

- [ ] **Step 5: Update the redirect closures to forward `isCrit`** (`SurvivorsGameplayState.ts:1987-2009`). The basic-attack router (`:1987`) and `guestDamageRedirect` (`:2001`) gain the param:

```ts
                ba.damageRouter = (enemy, amount, element, isCrit) => {
                    this.coopSession?.sendDamageReport({
                        t: 'damageReport', enemyId: enemy.id, amount, element,
                        sourceHeroId: 1, isCrit,
                    });
                };
            }
            Enemy.guestDamageRedirect = (enemyId, amount, element, isCrit) => {
                this.coopSession?.sendDamageReport({
                    t: 'damageReport', enemyId, amount, element: element ?? 'physical',
                    sourceHeroId: 1, isCrit,
                });
            };
```

(The `damageRouter` type on `HeroBasicAttack` must gain the `isCrit` param — see Task 3.3.)

- [ ] **Step 6: Host applies without re-rolling** (`onDamageReport`, `:2084`). Change `e.takeDamage(m.amount, m.element)` to pass the reported crit:

```ts
                    if (m.amount > 0) e.takeDamage(m.amount, m.element as PowerElement, m.isCrit ?? false);
```

- [ ] **Step 7: Run → PASS** (`npm test -- coopItemsCrit`), `npx tsc --noEmit`. Commit.

```bash
git add src/survivors/enemies/Enemy.ts src/survivors/enemies/critRoll.ts src/survivors/SurvivorsGameplayState.ts tests/coopItemsCrit.spec.ts
git commit -m "feat(coop-items): client-side crit roll; host applies reported crit verbatim"
```

### Task 3.3: Route basic-attack crit client-side

**Files:**
- Modify: `src/survivors/champions/HeroBasicAttack.ts` (the `damageRouter` field type + the routed call)

- [ ] **Step 1: Read `HeroBasicAttack.ts:130-160, 340-380, 740-776`.** Find: the `damageRouter` field declaration, where `effectiveDamage` is computed (`:134-136`), and the two `applyHit` sites that call `damageRouter` vs `takeDamage` (`:348, 747-751`).

- [ ] **Step 2: Update the `damageRouter` field type** to include `isCrit`:

```ts
    public damageRouter: ((enemy: Enemy, amount: number, element: PowerElement, isCrit: boolean) => void) | null = null;
```

- [ ] **Step 3: Roll crit at the routed site.** Where `applyHit` currently does `if (this.damageRouter) { this.damageRouter(enemy, effectiveDamage, element); return; }`, roll crit first using the same global provider so the number matches the solo path:

```ts
        if (this.damageRouter) {
            const cp = Enemy.critProvider?.();
            const rolled = rollCrit(effectiveDamage, cp ?? undefined, Math.random);
            this.damageRouter(enemy, rolled.amount, element, rolled.isCrit);
            return;
        }
```

Import `rollCrit` from `../enemies/critRoll` and `Enemy` (already imported). Apply at BOTH router call-sites (`:348` and `:747-751`).

- [ ] **Step 4: Type-check + commit.**

Run: `npx tsc --noEmit && npm test`
Expected: clean.

```bash
git add src/survivors/champions/HeroBasicAttack.ts
git commit -m "feat(coop-items): guest basic attacks roll crit client-side"
```

---

## Phase 4 — Combat-hook wiring on the guest (RISKY CORE 2)

Make `onBasicHit`/`onHeroHurt` fire on the guest so per-client item effects trigger, while the **primary** hit still routes via the redirect. Effect secondary damage/status/knockback continue through the existing redirects (one HP-mutation site).

### Task 4.1: Split the `damageRouter` guard so the hook fires

**Files:**
- Modify: `src/survivors/champions/HeroBasicAttack.ts:348-372, 740-776`

- [ ] **Step 1: Read the two `applyHit` paths (`:340-380, 740-776`).** Today: `if (!this.damageRouter) { onHitCallback?.(enemy, dmg); }` — so the hook is skipped when routing (co-op guest). The routed branch now (Phase 3.3) rolls crit + routes.

- [ ] **Step 2: Fire the hook in BOTH branches with the post-crit damage.** In the routed branch, after routing, call the hook with the post-crit number:

```ts
        if (this.damageRouter) {
            const cp = Enemy.critProvider?.();
            const rolled = rollCrit(effectiveDamage, cp ?? undefined, Math.random);
            this.damageRouter(enemy, rolled.amount, element, rolled.isCrit);
            this.onHitCallback?.(enemy, rolled.amount); // item effects fire on the guest too
            return;
        }
        // solo/host: takeDamage rolls crit; report the pre-crit number (existing behavior).
        const killed = enemy.takeDamage(effectiveDamage, element);
        this.onHitCallback?.(enemy, effectiveDamage);
```

(Keep the existing host/solo branch semantics; only ADD the hook call to the routed branch. Mirror at the second site `:747-751`.)

- [ ] **Step 3: Type-check.** `npx tsc --noEmit`.

### Task 4.2: Wire `setOnHit`/`setOnHurt` in co-op

**Files:**
- Modify: `src/survivors/SurvivorsGameplayState.ts` (the block from Task 1.1)

- [ ] **Step 1: Remove the `if (solo)` wrapper around the two combat-event hooks** (from Task 1.1 Step 2) so they wire for co-op too:

```ts
        this.heroController.setOnHurt((amount) => this.itemEffects?.onHeroHurt(amount));
        this.heroController.getBasicAttack()?.setOnHit((enemy, dmg) =>
            this.itemEffects?.onBasicHit(enemy, dmg));
```

- [ ] **Step 2: Confirm effect secondary damage routes correctly.** Item effects call `ctx.damage` → `Enemy.takeDamage` → (guest) `guestDamageRedirect` → host. `ctx.stun`/`burn` → `applyStatusEffect` → must also redirect on the guest. Read `Enemy.applyStatusEffect` (`:1090`, the `guestStatusRedirect` use) and confirm guest status routes. `ctx.tryExecuteBelow` routes as damage (Phase 2). No new code if the redirects already cover these paths; if `applyStatusEffect` does NOT redirect for effect-origin calls, ensure it does.

- [ ] **Step 3: Type-check + build.** `npx tsc --noEmit && npm run build`.

- [ ] **Step 4: Commit Phase 4.**

```bash
git add src/survivors/champions/HeroBasicAttack.ts src/survivors/SurvivorsGameplayState.ts
git commit -m "feat(coop-items): fire item-effect combat hooks on the guest (primary hit still routed)"
```

---

## Phase 5 — Per-player economy + XP

The guest earns no gold today (rewards fire host-only, `:960-971`). Attribute each kill to the killing-blow's `sourceHeroId` and send a reward delta so the guest's `PlayerStats`/`xpSink`/`levelSystem` advance.

### Task 5.1: Track the last damager per enemy

**Files:**
- Modify: `src/survivors/enemies/Enemy.ts`, `src/survivors/SurvivorsGameplayState.ts`

- [ ] **Step 1: Record the attributed hero on the host.** In `onDamageReport` (`:2070-2098`), before `takeDamage`, stamp the enemy with the reporting `sourceHeroId` (e.g. `(e as any)._lastDamagerHeroId = m.sourceHeroId`). The host's own hero attacks stamp `0` (add the stamp in the host's basic-attack/power path, or default to `0`). Keep it a simple field on `Enemy` (`public lastDamagerHeroId = 0`).

- [ ] **Step 2: Attribute the kill.** In the death/reward flow (`Enemy.onRewardCallback` `:960` and `EnemyManager`'s gold credit — read `EnemyManager` to find where `reward × goldGainMultiplier` is credited to `PlayerStats`), credit the **killer's** slot: if `lastDamagerHeroId === local`, credit locally as today; if it's the partner, send a `RewardMsg`.

### Task 5.2: `RewardMsg` + apply on the guest

**Files:**
- Modify: `src/net/Protocol.ts`, `src/survivors/coop/CoopSession.ts`, `src/survivors/SurvivorsGameplayState.ts`
- Test: `tests/coopItemsReward.spec.ts` (new)

- [ ] **Step 1: Failing test — protocol round-trip.**

```ts
import { describe, expect, it } from 'vitest';
import { encode, decode } from '../src/net/Protocol';
describe('RewardMsg', () => {
    it('round-trips a per-hero gold delta', () => {
        const back = decode(encode({ t: 'reward', heroId: 1, gold: 42 } as any)) as any;
        expect(back).toMatchObject({ t: 'reward', heroId: 1, gold: 42 });
    });
});
```

- [ ] **Step 2: Run → FAIL** (`reward` not a known tag).

- [ ] **Step 3: Add `RewardMsg`** to `Protocol.ts`: the interface, the `NetMessage` union, and `KNOWN_TAGS`:

```ts
export interface RewardMsg { t: 'reward'; heroId: number; gold: number }
```
Add `| RewardMsg` to `NetMessage` and `'reward'` to `KNOWN_TAGS`.

- [ ] **Step 4: Run → PASS.** Commit the protocol piece.

- [ ] **Step 5: Wire `CoopSession.sendReward`/`onReward`** mirroring `sendDamageResult`/`onDamageResult` (read `CoopSession.ts` for the pattern). Host calls `sendReward` for partner-attributed kills; the receiving client applies `this.playerStats.addGold(gold)` (which feeds `xpSink` → leveling).

- [ ] **Step 6: Populate `SnapshotHero.level/xp`** (currently hardcoded `1,0` in the snapshot builder — find it via `grep -n "level: 1" src/survivors/SurvivorsGameplayState.ts` and the binary codec) from `this.levelSystem`.

- [ ] **Step 7: Type-check + test + commit.**

```bash
git add -A && git commit -m "feat(coop-items): per-player gold attribution + reward delta + snapshot level/xp"
```

---

## Phase 6 — Move-speed into the ghost integrator

### Task 6.1: Feed the guest's move-speed multiplier to the host ghost

**Files:**
- Modify: `src/survivors/SurvivorsGameplayState.ts:1618` (`_driveGuestGhostFromInput`), `src/survivors/integrateMove.ts`

- [ ] **Step 1: Read `_driveGuestGhostFromInput` (`:1618-1660`) and `integrateMove.ts`.** Confirm the host integrates the guest ghost from raw input without a per-run move multiplier (comment `~:1615-1627`).

- [ ] **Step 2: Sync the scalar.** Add the guest's `moveSpeedMultiplier` to the per-tick guest→host channel. Smallest change: piggyback on `InputMsg` (add `moveMult?: number`) OR send it on equip change. Apply it in `_driveGuestGhostFromInput` so the ghost integrates at the correct speed. (Read `InputMsg` `Protocol.ts:81`; if extending it, update the binary input codec if one exists, else it's JSON.)

- [ ] **Step 3: Type-check + commit.**

```bash
git add -A && git commit -m "feat(coop-items): guest move-speed equipment drives the host ghost integrator"
```

---

## Phase 7 — Cosmetics replicated to the teammate

Replicate item-effect FX (`ring`/`beam`/`shockwave`) and the mythic weapon aura to the partner via the existing `emitCoopFx`/`playRemoteFx` channel; attach the aura to the `coopGhost`.

### Task 7.1: Emit + replay ring/beam/mythic-aura

**Files:**
- Modify: `src/survivors/SurvivorsGameplayState.ts` (the `fx.ring`/`fx.beam` adapter + `setMythicAura` drive + `playRemoteFx` `:2301`), `src/survivors/coop/CoopFx.ts`, `src/survivors/champions/Champion.ts`

- [ ] **Step 1: Emit on produce.** In `buildEffectContext().fx.ring`/`beam` (added in the SP feature), after spawning locally, also broadcast when co-op + not replaying:

```ts
                ring: (x, z, colorHex, radius) => {
                    if (this.scene) spawnExpandingRing(this.scene, x, z, colorHex, radius);
                    if (isCoopFxActive() && !isReplayingFx()) emitCoopFx('ring', x, z, undefined, undefined, JSON.stringify({ c: colorHex, r: radius }));
                },
                beam: (x0, z0, x1, z1, colorHex) => {
                    if (this.scene) spawnTrail(this.scene, x0, z0, x1, z1, colorHex);
                    if (isCoopFxActive() && !isReplayingFx()) emitCoopFx('beam', x0, z0, x1, z1, colorHex);
                },
```

- [ ] **Step 2: Replay in `playRemoteFx`** (`:2301`). Add cases (wrap in `withFxReplay`):

```ts
            case 'ring': {
                const { c, r } = JSON.parse(m.hint ?? '{}');
                if (this.scene && typeof c === 'string') withFxReplay(() => spawnExpandingRing(this.scene!, m.x, m.z, c, r ?? 2));
                break;
            }
            case 'beam':
                if (this.scene && m.hint && m.tx !== undefined && m.tz !== undefined)
                    withFxReplay(() => spawnTrail(this.scene!, m.x, m.z, m.tx!, m.tz!, m.hint!));
                break;
            case 'mythicAura': {
                const cfg = m.hint ? JSON.parse(m.hint) : null;
                this.coopGhost?.setMythicAura(cfg); // null tears down
                break;
            }
```

- [ ] **Step 3: Emit the mythic-aura toggle.** In `applyLevelBonuses` where `this.hero?.setMythicAura(mythicFx)` runs, also broadcast in co-op:

```ts
            this.hero?.setMythicAura(mythicFx);
            if (isCoopFxActive()) emitCoopFx('mythicAura', 0, 0, undefined, undefined, mythicFx ? JSON.stringify(mythicFx) : undefined);
```

- [ ] **Step 4: Re-emit on rejoin.** In the host/guest `onRequestState` path, re-broadcast the current `mythicFx` so a rejoining partner re-syncs the aura. (Read `:2108` host + the guest send at `:2060`.)

- [ ] **Step 5: Type-check + build + commit.**

```bash
git add -A && git commit -m "feat(coop-items): replicate item FX + mythic aura to the teammate ghost"
```

---

## Phase 8 — Non-blocking shop polish

### Task 8.1: Ensure the co-op shop never freezes the sim

**Files:**
- Modify: `src/survivors/SurvivorsGameplayState.ts` (shop open path)

- [ ] **Step 1: Confirm `isPausedForOverlay()` returns false in co-op (`:3333`)** and that opening `shopOverlay` in co-op does not call any pause. Read `openShop` and the wave-clear shop trigger. If the shop-open sets a pause flag unconditionally, gate that flag `if (solo)`.
- [ ] **Step 2: Verify the wave still auto-advances during co-op shopping** (the breather timer keeps running). No ready-up gating.
- [ ] **Step 3: Manual co-op smoke (host+guest via `?host`/`?join`), then commit.**

```bash
git add -A && git commit -m "feat(coop-items): non-blocking independent co-op shop"
```

---

## Phase 9 — Desync/echo test suite + full verification

### Task 9.1: No-double-apply / no-echo routing suite

**Files:**
- Create: `tests/coopItemsRouting.spec.ts`

- [ ] **Step 1: Write the suite** asserting the invariants (use `FakeTransport` like the existing co-op net specs — read `tests/netFakeTransport.spec.ts` / `tests/coopRunState.spec.ts` for the harness):
  - A guest effect proc that calls `ctx.damage` produces exactly ONE `damageReport` on the wire (via `guestDamageRedirect`), applies nothing locally.
  - The host applying that report calls `takeDamage` exactly once and emits exactly one `damageResult` (no per-report echo, matching the `:2082-2084` comment).
  - A reported crit (`isCrit:true`) is applied without re-multiplication (assert via `rollCrit(amount, cp, rng, true)` returning `amount` unchanged).
  - A guest `tryExecuteBelow` routes as a damage report (never a local kill).

- [ ] **Step 2: Run → PASS.** `npm test -- coopItems`.

- [ ] **Step 3: Full gate.**

Run: `npx tsc --noEmit && npm test && npm run build`
Expected: tsc clean, all suites pass (incl. the existing co-op net suite), build OK.

- [ ] **Step 4: Manual two-client playtest** (`?host` in one tab, `?join` in another): each player reaches a shop, buys items, sees their own stats apply; the guest earns gold from its own kills; item effects proc for each player; a mythic weapon's aura is visible on the partner. No desync (enemy HP consistent across clients), no `[resource-watchdog] LEAK SUSPECTED`.

- [ ] **Step 5: Commit + STOP for user review (do not merge to main).**

```bash
git add -A && git commit -m "test(coop-items): no-double-apply/echo routing suite + full verification"
```

---

## Self-review notes (author)

- **Spec coverage:** §5.1 lift gate → P1; §5.2 client-local stats → P1 (fold) + P3.3 (basic crit); §5.3 crit → P3; §5.4 effects → P2 (reads) + P4 (hooks); §5.5 economy/XP → P5; §5.6 cosmetics → P7; §5.7 move-speed → P6; §5.9 shop → P1.3 + P8; §6 protocol → P3.1 + P5.2; §7 de-risk → P9; §8 testing → P3/P5/P9.
- **Type consistency:** `rollCrit(amount, cp, rng, reported?)` identical in `critRoll.ts`, `Enemy.takeDamage`, `HeroBasicAttack`. `guestDamageRedirect`/`damageRouter` both gain `isCrit` (P3.1/3.3) used in P3.5. `DamageReportMsg.isCrit` (P3.1) read in `onDamageReport` (P3.2 Step 6). `RewardMsg {t,heroId,gold}` consistent P5.2. FX kinds `ring`/`beam`/`mythicAura` emitted P7.1 Step1/3, replayed Step2.
- **Riskiest:** P3+P4 (crit + hooks). De-risked by `rollCrit` as a pure tested unit, one HP-mutation site, and the P9 routing suite. If a subagent is uncertain on P3.2/P4.1 internals, the orchestrator implements those directly.
- **Known:** stale LSP false-positives on `setOnHit`/`setOnHurt` — trust `tsc`.
