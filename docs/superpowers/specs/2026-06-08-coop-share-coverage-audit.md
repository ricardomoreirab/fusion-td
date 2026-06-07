# Co-op "Share Concept" Coverage — Audit + Plan (2026-06-08)

**Branch:** `feat/online-coop`. Written autonomously overnight per the user's request:
"give an overview of all things in the game missing this share concept; then an overview
of everything that can be improved and do the quick wins."

## TL;DR

Co-op replicates **state** (enemy positions/HP/flags at 20 Hz, hero poses, damage numbers,
spawn/death) but **not the transient EVENTS** that drive animations and visual FX. So each
player only sees *their own* attacks, casts, ultimates, projectiles, and enemy death/skill
animations. A 6-agent audit catalogued **86 animated/visual elements: 61 not-shared, 13
partial, 12 already-shared.**

This session added the missing **event channel** + fixed the highest-value gaps (commit
`adfd23f`). What remains is mostly "more emitters on the same channel" plus a few
gameplay-fairness gaps that deserve priority.

---

## The sharing model (how things cross the wire today)

| Channel | Carries | Direction |
|---|---|---|
| `snapshot` (20 Hz) | enemy pos/HP/flags + coarse anim (1 walk / 2 attack); both hero poses/HP/alive | host → guest |
| `heroState` (per frame) | local hero pose + **anim code 1/2/3** (idle-run / attack / **special-ult**) | both ways |
| `input` (per frame) | guest movement axes (host simulates the guest hero) | guest → host |
| `damageReport` / `damageResult` | guest→host hit + **CC/DoT status**; host→guest echoed number | both ways |
| `spawn` / `death` | enemy lifecycle (+ reward, eliteElement) | host → guest |
| **`fx` (NEW this session)** | **cosmetic combat visuals** (projectiles, swings, casts, ults) | both ways |

**The new `fx` channel** (`src/net/Protocol.ts` `FxMsg`, `src/survivors/coop/CoopFx.ts`):
a combat-visual site calls `emitCoopFx(kind, x, z, tx?, tz?, hint?)`; the gameplay broadcasts
it; the teammate replays it with **zero gameplay effect** (damage/CC are already authoritative).
No-op in single-player.

---

## ✅ Fixed this session (commit `adfd23f`)

| Item | Before | Now |
|---|---|---|
| Hero **special / ultimate body pose** | only basic-attack (anim 2) crossed | `anim=3` (any power-slot cast or ult) → ghost `triggerSpecial` |
| Hero basic-attack body pose | partial (edge-only) | unchanged but now rising-edge handles 2 **and** 3 |
| **Basic-attack projectiles** (arrow/bolt/orb) | caster-only | replicated — cosmetic projectile flies on the teammate's screen |
| **Barbarian melee swing arc** | caster-only | replicated (cosmetic gold torus) |
| **Power casts** | caster-only | element-coloured burst at the caster (generic placeholder for exact FX) |
| **Ultimate casts** | caster-only | element burst (body pose via anim=3) |
| Enemy **death** on guest | enemies vanished silently | gold reward float + small death poof |
| Enemy **hit-flash** on guest | none | render-only flash when net HP drops in a snapshot |
| Guest **CC/DoT** (freeze/burn/curse) | inert on shared enemies | routed to host (review fix `7a8aff9`) |

---

## ❌ Remaining gaps, prioritized

### P0 — Gameplay-fairness gaps (not just cosmetic — the guest can't react to what it can't see)
1. **Boss dash/pull telegraph** (`MilestoneBoss` red ground rectangle / pull warning) — *not-shared*. The guest sees the boss slide and get hit with **no warning**; it can't dodge. → snapshot a `meleePhase`/telegraph state + render the ring on the guest.
2. **RedWizard ranged bolt** — *not-shared, large*. The guest is damaged by an **invisible** magic bolt (no cast anim, no projectile). → emit an `fx` 'enemyProj' on host-side enemy ranged attacks; replay on guest.
3. **ShieldEnemy shield dome** — *not-shared*. Guest sees a stale shield (never drains/breaks/regens), misreading whether the enemy is shielded. → carry shield/maxShield in the snapshot flags or a small field.
4. **`gatherVortex` / `persistentZone` mutate enemy positions locally on the guest** — desyncs render copies (they fight the snapshot). → guest power FX must be **render-only** (never move host-authoritative enemies).
5. **Guest-cast AoE ult freeze/knockback** — Frost Nova freeze now routes (CC fix), but **Smash/knockback displacement** still only moves the guest's local copies. → route knockback as a host event.

### P1 — High-value cosmetic (the "I can't see my teammate" complaints)
6. **Enemy/boss `_dead` death animation on guest** — *not-shared, medium*. Bosses pop out of existence. → on `DeathMsg`, play the GLB `_dead` clip + linger before disposing (mirror host `die()`), instead of instant `disposeCorpse()`.
7. **Boss/elite skill clips** (`_skill1/2/3`: whirlwind, smash, slam, wizard cast) — *partial, large*. Guest plays one fallback attack clip. → widen the snapshot enemy anim from 1-bit to a small skill index; `GuestEnemies` plays the matching clip.
8. **Procedural-enemy limb animation on guest** — *not-shared, large*. Non-GLB enemies (procedural Boss/Fast/fallback) are frozen statues sliding around (`_applyNetworkAnim` early-returns with no GLB groups). → drive procedural part animation from interpolated speed locally on the guest.
9. **Exact per-power FX** (16 base powers + 10 fusions) — *not-shared*. Currently a generic element burst. → emit `fx` 'power' with power id + target; replay the real `PowerEffects` primitive (`aoeBurst`/`chainHit`/`gatherVortex`/`spawnExpandingRing`/…) cosmetically (enemies=[]). Fixing the 8 shared primitives covers all fusions.
10. **Exact per-ult FX** (Meteor barrage, Frost Nova ring, Whirlwind tornado, Multishot volley, Explosive Arrow) — *not-shared, large*. Generic burst today. → emit richer `fx` 'ult' (ability id + target) and replay the real visual cosmetically; **persistent** ones (Whirling Blades orbiters, Whirlwind/Multishot 5s channels) need a start/stop pair, not a one-shot.
11. **Per-class ultimate body clip** (`playAbilityClip` — Aulus whirlwind/smash, etc.) — *not-shared*. The ghost plays a generic special pose, not the specific ult clip. → send the clip suffix+duration in an 'ability' event; ghost calls `playAbilityClip`.
12. **Enemy status particles on guest** (burning/slowed/frozen/stunned/confused) — *partial*. Flags arrive but particles never spawn. → spawn the status particle FX in `applyNetworkState` from the flags.
13. **Whirling Blades persistent orbiters** — *not-shared, large*. A teammate's perpetual orbiting shurikens are invisible. → needs a persistent-FX start/stop (not a one-shot event); tie to the teammate's active-power set.

### P2 — Polish (cosmetic, low severity)
14. Element **weapon decorations** on the ghost (needs the teammate's active-element set shared). 15. Barbarian **spin FX / axe trails** on the ghost. 16. Hero **hit-flash / blood burst** on the ghost (derive from ghost HP drop). 17. Hero **death particle burst** on the ghost (fade already shares). 18. **Revive-shield bubble + "EXTRA LIFE!"** on the ghost. 19. **"LEVEL UP!"** float for the teammate. 20. **FastEnemy motion trail**, **HealerEnemy heal-pulse ring**, **shatter/frozen-erupt burst** on the guest. 21. **ItemDrop** (milestone-boss gem) — guest sees no gem and has no item path (per-player items are an open M4 follow-up). 22. **PowerDrop orb** — each player only sees its own (by design; per-player orbs).

### Correctly local (no action — listed so they're not mistaken for gaps)
Camera shake, low-HP vignette, HUD flash/pulse classes, off-screen indicators, footstep dust,
lights/shadows. These are first-person feedback and should stay per-client.

---

## Quick-win status

Of the 20 audit-flagged "quick" gaps, this session shipped: hero special pose, basic-attack
projectiles, melee swing arc, power/ult cast bursts, enemy death poof + reward float, enemy
hit-flash. Remaining quick wins (small, same `fx`/`DeathMsg` channels): enemy status particles
from flags (#12), shatter burst on guest, hero hit-flash/blood on ghost, "LEVEL UP!" float.

## Recommended next milestone ("M6 — visual parity")
1. **P0 fairness first** (telegraphs, ranged bolts, shield state, render-only-guest-FX) — these
   affect *playability*, not just looks.
2. **Enemy `_dead` + skill-clip index** (#6/#7) — biggest cosmetic payoff, bosses especially.
3. **Real per-power/ult FX replay** via the `fx` channel (#9/#10/#11) — turn the generic burst
   into the actual spell visual; do the 8 `PowerEffects` primitives once to cover all fusions.
4. Persistent-FX start/stop for channels/orbiters (#13).
