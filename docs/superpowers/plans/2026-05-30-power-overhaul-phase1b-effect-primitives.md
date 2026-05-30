# Power Overhaul — Phase 1b: Effect-Primitive Library + FX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a leak-safe, composable effect-primitive library (`PowerEffects.ts`) — AoE burst, chain, gather-vortex, persistent zone, omni-volley — plus a single damage chokepoint (`dealElementalHit`) that fires status cross-reactions, screen-FX helpers, and the wiring that makes the Phase 1a shatter hook + storm→burn overload reaction live.

**Architecture:** A new Babylon-aware `PowerEffects.ts` is the single chokepoint that enforces the project's leak rules (every material via `getCachedMaterial` with a bounded key; meshes pooled or self-disposed via a removed `onBeforeRenderObservable`; transient meshes fade via `mesh.visibility`, never by mutating a shared/frozen material's alpha). `dealElementalHit` wraps `Enemy.takeDamage` and consults the `StatusReactions` registry (Phase 1a) to fire combos (storm hit on a burning enemy → detonate the burn as a fire AoE). Two tiny additions expose what reactions need: `StatusStacks.detonate(kind)` (pure, tested) and public `Enemy.hasRichStatus`/`detonateRichStatus`. The gameplay state wires `Enemy.onShatterCallback` → `aoeBurst` and the camera-shake hook → the existing `HeroController.triggerScreenShake`.

**Tech Stack:** TypeScript, BabylonJS, Vitest (node, pure-logic only).

**Context:** Phase 1b of the overhaul (spec: `docs/superpowers/specs/2026-05-30-power-system-fusion-ultimate-overhaul-design.md`; Phase 1a done — `StatusStacks`/`StatusReactions` exist, `Enemy` routes burn/chill/curse/fragile through the model, `Enemy.onShatterCallback` is declared but unwired). Branch: `feat/power-fusion-ultimate-overhaul`.

**Important — verification reality:** No power *applies* the new statuses or *calls* these primitives until Phase 2 (fusions). So this phase is verified by **unit tests (the pure `detonate` math), `tsc`, `npm run build`, and code review** — plus a smoke check that the app still loads and a fresh run shows no errors / no `[resource-watchdog]` fire. Full in-game exercise of the primitives lands in Phase 2.

**Environment notes for implementers:**
- Trust `npx tsc --noEmit` (exit 0) + `npm run build`, NOT the IDE (it reports stale false "cannot find module" + pre-existing unused-import warnings).
- Run unit tests with `npx vitest run <file>`; full suite `npm test`.
- `PowerEffects.ts` is Babylon-aware (it MAY import `@babylonjs/core`). `StatusModel.ts` must stay Babylon-free.

---

## File Structure

- **Modify** `src/survivors/powers/StatusModel.ts` — add `StatusStacks.detonate(kind): number` (pure).
- **Modify** `tests/StatusModel.spec.ts` — add `detonate` tests.
- **Modify** `src/survivors/enemies/Enemy.ts` — add public `hasRichStatus` / `detonateRichStatus`.
- **Create** `src/survivors/powers/PowerEffects.ts` — the primitive library + FX helpers + module hooks.
- **Modify** `src/survivors/SurvivorsGameplayState.ts` — wire `Enemy.onShatterCallback` + camera-shake hook in `enter()`; tear down in `exit()`.

**Leak discipline (every PowerEffects mesh/material MUST follow — CLAUDE.md):**
1. Materials via `getCachedMaterial(scene, key, setup)` with a **bounded** key (element name) — never `Math.random()`/instance ids. Set `alpha < 1` at creation so the (frozen) material is in the transparent pass.
2. Fade transient meshes via `mesh.visibility` (NOT by mutating the shared/frozen material's `.alpha`).
3. Dispose meshes that use a **cached** material with plain `mesh.dispose()` (default `dispose(false,false)` keeps the shared material — correct; never dispose a cached material). Pooled meshes go back via `releaseProjectile`.
4. ALWAYS remove the `onBeforeRenderObservable` observer when the effect ends.

---

## Task 1: `StatusStacks.detonate(kind)` (TDD)

**Files:**
- Modify: `src/survivors/powers/StatusModel.ts`
- Test: `tests/StatusModel.spec.ts`

- [ ] **Step 1: Write the failing tests** — append to `tests/StatusModel.spec.ts` (new describe block at end):

```typescript
describe('StatusStacks — detonate', () => {
    it('returns the burn burst (stacks×strength×overflowFactor) and clears burn', () => {
        const s = new StatusStacks();
        s.apply('burn', 5, 2, 4); // 4 stacks, 2 dmg/stack
        const burst = s.detonate('burn');
        expect(burst).toBeCloseTo(4 * 2 * STATUS_TUNING.burn.overflowFactor, 5);
        expect(s.has('burn')).toBe(false);
    });

    it('returns 0 for an absent kind and for non-burn kinds', () => {
        const s = new StatusStacks();
        expect(s.detonate('burn')).toBe(0);
        s.apply('chill', 5, 0, 3);
        expect(s.detonate('chill')).toBe(0); // no burst value defined for chill
        expect(s.has('chill')).toBe(false);  // still cleared
    });

    it('resets the burn accumulator so a later burn does not phantom-tick', () => {
        const s = new StatusStacks();
        s.apply('burn', 5, 2, 1);
        s.tick(0.3, 100);       // acc = 0.3
        s.detonate('burn');     // clears burn + acc
        s.apply('burn', 5, 2, 1);
        expect(s.tick(0.3, 100).burnDamage).toBe(0); // 0.3 < 0.5; would fire if acc carried
    });
});
```

- [ ] **Step 2: Run → expect FAIL** — Run: `npx vitest run tests/StatusModel.spec.ts` → FAIL ("detonate is not a function").

- [ ] **Step 3: Implement** — add this method to the `StatusStacks` class in `src/survivors/powers/StatusModel.ts`, immediately before `clear(kind?)`:

```typescript
    /**
     * Remove a status and return its "burst" damage for a reaction (e.g. Overload
     * detonating burn). Currently only burn yields a burst
     * (stacks × strength × overflowFactor); other kinds return 0 but are still cleared.
     */
    detonate(kind: RichStatusKind): number {
        const t = this.tracks.get(kind);
        if (!t) return 0;
        const burst = kind === 'burn' ? t.stacks * t.strength * STATUS_TUNING.burn.overflowFactor : 0;
        this.tracks.delete(kind);
        if (kind === 'burn') this.burnTickAcc = 0;
        return burst;
    }
```

- [ ] **Step 4: Run → expect PASS** — Run: `npx vitest run tests/StatusModel.spec.ts` → PASS (all green, including the 3 new).
- [ ] **Step 5: Type-check** — Run: `npx tsc --noEmit` → exit 0.
- [ ] **Step 6: Commit**

```bash
git add src/survivors/powers/StatusModel.ts tests/StatusModel.spec.ts
git commit -m "feat(status): StatusStacks.detonate(kind) for cross-reactions + tests"
```

---

## Task 2: Public rich-status accessors on `Enemy`

**Files:**
- Modify: `src/survivors/enemies/Enemy.ts`

No unit test (Babylon-coupled); verified by `tsc`. These let `PowerEffects.dealElementalHit` query/consume rich statuses without touching the `protected statuses` field.

- [ ] **Step 1: Add the import for the type**

`Enemy.ts` already imports `{ StatusStacks, STATUS_TUNING } from '../powers/StatusModel'`. Change that import to also bring the kind type:

```typescript
import { StatusStacks, STATUS_TUNING, type RichStatusKind } from '../powers/StatusModel';
```

- [ ] **Step 2: Add the two public methods**

Immediately after the `primeShatter(...)` method (added in Phase 1a), add:

```typescript
    /** True if this enemy currently has the given rich status (burn/chill/curse/fragile). */
    public hasRichStatus(kind: RichStatusKind): boolean {
        return this.statuses.has(kind);
    }

    /** Consume a rich status and return its reaction burst damage (0 if none). */
    public detonateRichStatus(kind: RichStatusKind): number {
        return this.statuses.detonate(kind);
    }
```

- [ ] **Step 3: Type-check + build** — `npx tsc --noEmit` → exit 0; `npm run build` → success (pre-existing entrypoint-size warnings OK).
- [ ] **Step 4: Commit**

```bash
git add src/survivors/enemies/Enemy.ts
git commit -m "feat(status): public Enemy.hasRichStatus / detonateRichStatus accessors"
```

---

## Task 3: `PowerEffects.ts` core — scaffold, ring helper, `dealElementalHit`, `aoeBurst`

**Files:**
- Create: `src/survivors/powers/PowerEffects.ts`

No unit test (Babylon-coupled); verified by `tsc` + build. This task creates the module with the core damage chokepoint + the AoE primitive used by shatter and overload.

- [ ] **Step 1: Create `src/survivors/powers/PowerEffects.ts`**

```typescript
// Leak-safe, composable effect primitives + screen-FX for powers/fusions/ultimates.
// THE single chokepoint enforcing CLAUDE.md leak rules: every material via
// getCachedMaterial with a bounded (element) key; transient meshes fade via
// mesh.visibility and are disposed with the observer removed; projectiles pool.
import { Scene, Vector3, Color3, MeshBuilder } from '@babylonjs/core';
import { getCachedMaterial } from '../../engine/rendering/MaterialCache';
import { acquireProjectile, releaseProjectile } from '../../engine/rendering/ProjectilePool';
import { ELEMENT_COLOR } from '../ElementColors';
import { StatusEffect } from '../GameTypes';
import { getReaction } from './StatusReactions';
import type { Enemy } from '../enemies/Enemy';
import type { PowerElement } from './PowerDefinitions';
import type { RichStatusKind } from './StatusModel';

/** Optional status to apply to every enemy a primitive damages. */
export interface EffectStatus {
    effect: StatusEffect;
    durationS: number;
    strength: number;
}

const RICH_KINDS: RichStatusKind[] = ['burn', 'chill', 'curse', 'fragile'];

// ── leak-safe shared visual: expanding, fading ring ─────────────────────────
/** Expanding ground ring that fades and self-disposes. Cached frozen material
 *  per element; faded via mesh.visibility (never the shared material's alpha). */
function spawnExpandingRing(scene: Scene, x: number, z: number, maxRadius: number, element: PowerElement, lifeS: number): void {
    const ring = MeshBuilder.CreateTorus('fx_ring', { diameter: 2, thickness: 0.28, tessellation: 28 }, scene);
    ring.position.set(x, 0.25, z);
    ring.material = getCachedMaterial(scene, `fx_ring_${element}`, m => {
        m.emissiveColor = ELEMENT_COLOR[element];
        m.diffuseColor = Color3.Black();
        m.disableLighting = true;
        m.alpha = 0.8; // <1 so the frozen material renders in the transparent pass
    });
    let elapsed = 0;
    const obs = scene.onBeforeRenderObservable.add(() => {
        elapsed += scene.getEngine().getDeltaTime() / 1000;
        const t = Math.min(elapsed / lifeS, 1);
        ring.scaling.set(maxRadius * t, 1, maxRadius * t); // diameter 2 → grows to 2·maxRadius·t
        ring.visibility = 1 - t;
        if (t >= 1) {
            ring.dispose(); // default dispose(false,false): keeps the cached/shared material
            scene.onBeforeRenderObservable.remove(obs);
        }
    });
}

function applyStatus(e: Enemy, status: EffectStatus | undefined): void {
    if (status && e.isAlive()) e.applyStatusEffect(status.effect, status.durationS, status.strength);
}

// ── dealElementalHit — the damage chokepoint that fires cross-reactions ──────
/** Apply a direct elemental hit to one enemy, then fire any status cross-reaction
 *  (e.g. storm on a burning enemy → detonate burn as a fire AoE). Use this for the
 *  PRIMARY target of a power; AoE splash uses takeDamage directly (no nested reactions). */
export function dealElementalHit(scene: Scene, enemies: Enemy[], target: Enemy, damage: number, element: PowerElement): void {
    const died = target.takeDamage(damage, element);
    if (died) return;
    for (const kind of RICH_KINDS) {
        if (!target.hasRichStatus(kind)) continue;
        const reaction = getReaction(element, kind);
        if (!reaction) continue;
        if (reaction.kind === 'overload') {
            const burst = target.detonateRichStatus('burn');
            if (burst > 0) {
                const p = target.getPosition();
                aoeBurst(scene, enemies, p.x, p.z, { radius: 2.5, damage: burst, element: 'fire' });
            }
        }
    }
}

// ── aoeBurst — instant radial damage + expanding ring ───────────────────────
export interface AoeOpts {
    radius: number;
    damage: number;
    element: PowerElement;
    status?: EffectStatus;
    /** ring lifetime seconds (default 0.35) */
    ringLifeS?: number;
}
/** Radial damage to every live enemy within radius + an expanding ring. AoE splash
 *  uses takeDamage directly (reactions fire only on direct hits, not splash). */
export function aoeBurst(scene: Scene, enemies: Enemy[], x: number, z: number, opts: AoeOpts): void {
    const r2 = opts.radius * opts.radius;
    for (const e of enemies) {
        if (!e.isAlive()) continue;
        const p = e.getPosition();
        const dx = p.x - x, dz = p.z - z;
        if (dx * dx + dz * dz <= r2) {
            e.takeDamage(opts.damage, opts.element);
            applyStatus(e, opts.status);
        }
    }
    spawnExpandingRing(scene, x, z, opts.radius, opts.element, opts.ringLifeS ?? 0.35);
}
```

- [ ] **Step 2: Type-check** — `npx tsc --noEmit` → exit 0. (`aoeBurst` is referenced by `dealElementalHit` before its declaration — that's fine for function declarations, which hoist.)
- [ ] **Step 3: Build** — `npm run build` → success.
- [ ] **Step 4: Commit**

```bash
git add src/survivors/powers/PowerEffects.ts
git commit -m "feat(fx): PowerEffects core — dealElementalHit + aoeBurst + ring helper"
```

---

## Task 4: `PowerEffects` screen-FX helpers (cameraShake, screenFlash, hitstop) + hooks

**Files:**
- Modify: `src/survivors/powers/PowerEffects.ts`

- [ ] **Step 1: Append the FX helpers + hooks** to `PowerEffects.ts`:

```typescript
// ── screen FX ────────────────────────────────────────────────────────────────
// cameraShake/hitstop are host-driven (the gameplay state owns the camera + the
// game-loop time scale), so they call a registered hook; no-op until wired.
let _cameraShakeHook: ((durationS: number) => void) | null = null;
let _hitstopHook: ((ms: number) => void) | null = null;

export function setCameraShakeHook(fn: ((durationS: number) => void) | null): void { _cameraShakeHook = fn; }
export function setHitstopHook(fn: ((ms: number) => void) | null): void { _hitstopHook = fn; }

/** Shake the camera (via the registered host hook). */
export function cameraShake(durationS = 0.3): void { _cameraShakeHook?.(durationS); }
/** Brief gameplay freeze for impact (via the registered host hook; wired in Phase 3). */
export function hitstop(ms = 60): void { _hitstopHook?.(ms); }

// Full-screen colour flash via ONE reused DOM overlay (leak-free; removed on exit).
let _flashEl: HTMLDivElement | null = null;
/** Flash the screen with `colorCss` (e.g. 'rgba(255,80,40,0.5)') fading over durationMs. */
export function screenFlash(colorCss: string, durationMs = 220): void {
    if (typeof document === 'undefined' || typeof requestAnimationFrame === 'undefined') return;
    if (!_flashEl) {
        _flashEl = document.createElement('div');
        _flashEl.style.cssText =
            'position:fixed;inset:0;pointer-events:none;z-index:9990;opacity:0;';
        document.body.appendChild(_flashEl);
    }
    const el = _flashEl;
    el.style.background = colorCss;
    el.style.transition = 'none';
    el.style.opacity = '1';
    requestAnimationFrame(() => {
        if (_flashEl !== el) return;
        el.style.transition = `opacity ${durationMs}ms ease-out`;
        el.style.opacity = '0';
    });
}

/** Tear down all PowerEffects host hooks + the flash overlay (call from exit()). */
export function resetPowerEffects(): void {
    _cameraShakeHook = null;
    _hitstopHook = null;
    if (_flashEl) { _flashEl.remove(); _flashEl = null; }
}
```

- [ ] **Step 2: Type-check + build** — `npx tsc --noEmit` → exit 0; `npm run build` → success.
- [ ] **Step 3: Commit**

```bash
git add src/survivors/powers/PowerEffects.ts
git commit -m "feat(fx): PowerEffects screen-FX (cameraShake/hitstop hooks, screenFlash) + reset"
```

---

## Task 5: `chainHit` primitive

**Files:**
- Modify: `src/survivors/powers/PowerEffects.ts`

- [ ] **Step 1: Append `chainHit` + its bolt visual** to `PowerEffects.ts`:

```typescript
// ── chainHit — bouncing chain, optional split-on-hop ────────────────────────
/** A fading line bolt between two points. LinesMesh owns its colour (no shared
 *  material to leak); disposed with the observer removed. */
function spawnBolt(scene: Scene, from: Vector3, to: Vector3, element: PowerElement, lifeS = 0.18): void {
    const lines = MeshBuilder.CreateLines('fx_bolt', { points: [from, to] }, scene);
    lines.color = ELEMENT_COLOR[element];
    lines.isPickable = false;
    let elapsed = 0;
    const obs = scene.onBeforeRenderObservable.add(() => {
        elapsed += scene.getEngine().getDeltaTime() / 1000;
        lines.alpha = Math.max(0, 1 - elapsed / lifeS);
        if (elapsed >= lifeS) { lines.dispose(); scene.onBeforeRenderObservable.remove(obs); }
    });
}

export interface ChainOpts {
    hops: number;
    radius: number;
    damage: number;
    element: PowerElement;
    /** per-hop damage multiplier (default 0.75) */
    falloff?: number;
    status?: EffectStatus;
    /** if true, each hop forks into 2 branches (capped by the de-dup set) */
    split?: boolean;
}
/** Chain from `origin` to the nearest live, unhit enemy within `radius`, repeating
 *  `hops` times (falloff per hop). With `split`, each hop forks into 2 branches; the
 *  shared hit-set guarantees each enemy is hit at most once, bounding total work. */
export function chainHit(scene: Scene, enemies: Enemy[], origin: Vector3, opts: ChainOpts): void {
    const falloff = opts.falloff ?? 0.75;
    const r2 = opts.radius * opts.radius;
    const hit = new Set<Enemy>();
    const frontier: { x: number; z: number; dmg: number; hopsLeft: number }[] =
        [{ x: origin.x, z: origin.z, dmg: opts.damage, hopsLeft: opts.hops }];
    while (frontier.length > 0) {
        const node = frontier.shift()!;
        if (node.hopsLeft <= 0) continue;
        let best: Enemy | null = null;
        let bestD2 = r2;
        for (const e of enemies) {
            if (!e.isAlive() || hit.has(e)) continue;
            const p = e.getPosition();
            const dx = p.x - node.x, dz = p.z - node.z;
            const d2 = dx * dx + dz * dz;
            if (d2 <= bestD2) { bestD2 = d2; best = e; }
        }
        if (!best) continue;
        hit.add(best);
        const bp = best.getPosition();
        spawnBolt(scene, new Vector3(node.x, 1, node.z), new Vector3(bp.x, 1, bp.z), opts.element);
        best.takeDamage(node.dmg, opts.element);
        applyStatus(best, opts.status);
        const branches = opts.split ? 2 : 1;
        for (let b = 0; b < branches; b++) {
            frontier.push({ x: bp.x, z: bp.z, dmg: node.dmg * falloff, hopsLeft: node.hopsLeft - 1 });
        }
    }
}
```

- [ ] **Step 2: Type-check + build** — `npx tsc --noEmit` → exit 0; `npm run build` → success.
- [ ] **Step 3: Commit**

```bash
git add src/survivors/powers/PowerEffects.ts
git commit -m "feat(fx): PowerEffects.chainHit (bounce + optional split)"
```

---

## Task 6: `gatherVortex` primitive

**Files:**
- Modify: `src/survivors/powers/PowerEffects.ts`

- [ ] **Step 1: Append `gatherVortex`** to `PowerEffects.ts`:

```typescript
// ── gatherVortex — pull enemies in, tick, then implode ──────────────────────
export interface VortexOpts {
    radius: number;
    durationS: number;
    /** inward pull speed fraction per second (0..1), e.g. 0.6 */
    pull: number;
    tickDamage: number;
    /** seconds between damage ticks (default 0.2) */
    tickIntervalS?: number;
    element: PowerElement;
    status?: EffectStatus;
    /** AoE damage when the vortex implodes (default 0 = none) */
    finalBurst?: number;
}
/** A vortex orb at (x,z): pulls live enemies inward each frame, ticks damage, then
 *  emits a final burst. Self-disposing (orb mesh + observer). */
export function gatherVortex(scene: Scene, enemies: Enemy[], x: number, z: number, opts: VortexOpts): void {
    const tickInterval = opts.tickIntervalS ?? 0.2;
    const r2 = opts.radius * opts.radius;
    const orb = MeshBuilder.CreateSphere('fx_vortex', { diameter: 1.0, segments: 8 }, scene);
    orb.position.set(x, 1, z);
    orb.material = getCachedMaterial(scene, `fx_vortex_${opts.element}`, m => {
        m.emissiveColor = ELEMENT_COLOR[opts.element];
        m.diffuseColor = Color3.Black();
        m.disableLighting = true;
        m.alpha = 0.85;
    });
    let elapsed = 0;
    let tickAcc = 0;
    const obs = scene.onBeforeRenderObservable.add(() => {
        const dt = scene.getEngine().getDeltaTime() / 1000;
        elapsed += dt;
        tickAcc += dt;
        orb.rotation.y += dt * 6;
        const doTick = tickAcc >= tickInterval;
        if (doTick) tickAcc -= tickInterval;
        for (const e of enemies) {
            if (!e.isAlive()) continue;
            const p = e.getPosition();
            const dx = x - p.x, dz = z - p.z;
            if (dx * dx + dz * dz > r2) continue;
            // Pull inward (mutates the by-ref position; enemy.update copies it to the mesh).
            p.x += dx * opts.pull * dt;
            p.z += dz * opts.pull * dt;
            if (doTick) {
                e.takeDamage(opts.tickDamage, opts.element);
                applyStatus(e, opts.status);
            }
        }
        if (elapsed >= opts.durationS) {
            if (opts.finalBurst && opts.finalBurst > 0) {
                aoeBurst(scene, enemies, x, z, { radius: opts.radius, damage: opts.finalBurst, element: opts.element });
            }
            orb.dispose();
            scene.onBeforeRenderObservable.remove(obs);
        }
    });
}
```

- [ ] **Step 2: Type-check + build** — `npx tsc --noEmit` → exit 0; `npm run build` → success.
- [ ] **Step 3: Commit**

```bash
git add src/survivors/powers/PowerEffects.ts
git commit -m "feat(fx): PowerEffects.gatherVortex (pull + tick + implode)"
```

---

## Task 7: `persistentZone` primitive

**Files:**
- Modify: `src/survivors/powers/PowerEffects.ts`

- [ ] **Step 1: Append `persistentZone`** to `PowerEffects.ts`:

```typescript
// ── persistentZone — lingering hazard field, optionally creeping ────────────
export interface ZoneOpts {
    radius: number;
    durationS: number;
    /** seconds between damage ticks (default 0.5) */
    tickIntervalS?: number;
    tickDamage: number;
    element: PowerElement;
    status?: EffectStatus;
    /** if set, the zone creeps toward this point at `crawlSpeed` u/s */
    crawlToward?: { x: number; z: number };
    /** units/second the zone center moves toward crawlToward (default 1.5) */
    crawlSpeed?: number;
}
/** A flat ground disc that ticks damage to enemies inside it for `durationS`, and
 *  can creep toward a point. Cached frozen material; faded via visibility; self-disposing. */
export function persistentZone(scene: Scene, enemies: Enemy[], x: number, z: number, opts: ZoneOpts): void {
    const tickInterval = opts.tickIntervalS ?? 0.5;
    const crawlSpeed = opts.crawlSpeed ?? 1.5;
    let cx = x, cz = z;
    const disc = MeshBuilder.CreateDisc('fx_zone', { radius: opts.radius, tessellation: 32 }, scene);
    disc.rotation.x = Math.PI / 2; // lay flat on the ground
    disc.position.set(cx, 0.06, cz);
    disc.isPickable = false;
    disc.material = getCachedMaterial(scene, `fx_zone_${opts.element}`, m => {
        m.emissiveColor = ELEMENT_COLOR[opts.element];
        m.diffuseColor = Color3.Black();
        m.disableLighting = true;
        m.alpha = 0.32;
    });
    disc.visibility = 0.7;
    const r2 = opts.radius * opts.radius;
    let elapsed = 0;
    let tickAcc = 0;
    const obs = scene.onBeforeRenderObservable.add(() => {
        const dt = scene.getEngine().getDeltaTime() / 1000;
        elapsed += dt;
        tickAcc += dt;
        if (opts.crawlToward) {
            const dx = opts.crawlToward.x - cx, dz = opts.crawlToward.z - cz;
            const d = Math.hypot(dx, dz);
            if (d > 0.01) {
                const step = Math.min(d, crawlSpeed * dt);
                cx += (dx / d) * step; cz += (dz / d) * step;
                disc.position.set(cx, 0.06, cz);
            }
        }
        // gentle alpha pulse via visibility (never the shared material's alpha)
        disc.visibility = 0.55 + 0.2 * Math.sin(elapsed * 6);
        if (tickAcc >= tickInterval) {
            tickAcc -= tickInterval;
            for (const e of enemies) {
                if (!e.isAlive()) continue;
                const p = e.getPosition();
                const dx = p.x - cx, dz = p.z - cz;
                if (dx * dx + dz * dz <= r2) {
                    e.takeDamage(opts.tickDamage, opts.element);
                    applyStatus(e, opts.status);
                }
            }
        }
        if (elapsed >= opts.durationS) {
            disc.dispose();
            scene.onBeforeRenderObservable.remove(obs);
        }
    });
}
```

- [ ] **Step 2: Type-check + build** — `npx tsc --noEmit` → exit 0; `npm run build` → success.
- [ ] **Step 3: Commit**

```bash
git add src/survivors/powers/PowerEffects.ts
git commit -m "feat(fx): PowerEffects.persistentZone (lingering + creeping hazard)"
```

---

## Task 8: `omniVolley` primitive

**Files:**
- Modify: `src/survivors/powers/PowerEffects.ts`

- [ ] **Step 1: Append `omniVolley`** to `PowerEffects.ts`:

```typescript
// ── omniVolley — multi-directional projectile spray (pooled) ────────────────
export interface VolleyOpts {
    count: number;
    speed: number;       // units/second
    damage: number;
    element: PowerElement;
    /** max travel seconds before a projectile is recycled (default 1.2) */
    lifeS?: number;
    /** hit radius for a projectile-enemy collision (default 0.6) */
    hitRadius?: number;
    status?: EffectStatus;
}
/** Fire `count` projectiles outward in evenly-spaced directions from (x,z). Each
 *  damages the first live enemy it touches, then is recycled. Pooled via ProjectilePool. */
export function omniVolley(scene: Scene, enemies: Enemy[], x: number, z: number, opts: VolleyOpts): void {
    const lifeS = opts.lifeS ?? 1.2;
    const hr2 = (opts.hitRadius ?? 0.6) ** 2;
    interface Shot { mesh: import('@babylonjs/core').Mesh; vx: number; vz: number; t: number; done: boolean; }
    const shots: Shot[] = [];
    for (let i = 0; i < opts.count; i++) {
        const ang = (i / opts.count) * Math.PI * 2;
        const mesh = acquireProjectile(scene, 'fx_volley', () =>
            MeshBuilder.CreateSphere('fx_volley', { diameter: 0.3, segments: 6 }, scene));
        mesh.position.set(x, 1, z);
        mesh.material = getCachedMaterial(scene, `fx_volley_${opts.element}`, m => {
            m.emissiveColor = ELEMENT_COLOR[opts.element];
            m.diffuseColor = Color3.Black();
            m.disableLighting = true;
        });
        shots.push({ mesh, vx: Math.cos(ang) * opts.speed, vz: Math.sin(ang) * opts.speed, t: 0, done: false });
    }
    const obs = scene.onBeforeRenderObservable.add(() => {
        const dt = scene.getEngine().getDeltaTime() / 1000;
        let liveCount = 0;
        for (const s of shots) {
            if (s.done) continue;
            s.t += dt;
            s.mesh.position.x += s.vx * dt;
            s.mesh.position.z += s.vz * dt;
            let hitEnemy: Enemy | null = null;
            for (const e of enemies) {
                if (!e.isAlive()) continue;
                const p = e.getPosition();
                const dx = p.x - s.mesh.position.x, dz = p.z - s.mesh.position.z;
                if (dx * dx + dz * dz <= hr2) { hitEnemy = e; break; }
            }
            if (hitEnemy) {
                hitEnemy.takeDamage(opts.damage, opts.element);
                applyStatus(hitEnemy, opts.status);
                s.done = true;
                releaseProjectile('fx_volley', s.mesh);
            } else if (s.t >= lifeS) {
                s.done = true;
                releaseProjectile('fx_volley', s.mesh);
            } else {
                liveCount++;
            }
        }
        if (liveCount === 0) scene.onBeforeRenderObservable.remove(obs);
    });
}
```

- [ ] **Step 2: Type-check + build** — `npx tsc --noEmit` → exit 0; `npm run build` → success.
- [ ] **Step 3: Commit**

```bash
git add src/survivors/powers/PowerEffects.ts
git commit -m "feat(fx): PowerEffects.omniVolley (pooled multi-directional spray)"
```

---

## Task 9: Wire shatter + camera-shake into the gameplay state

**Files:**
- Modify: `src/survivors/SurvivorsGameplayState.ts`

- [ ] **Step 1: Import the PowerEffects entry points**

Add to the imports near the other `survivors/powers` imports in `SurvivorsGameplayState.ts`:

```typescript
import { aoeBurst, setCameraShakeHook, resetPowerEffects } from './powers/PowerEffects';
```

- [ ] **Step 2: Wire the hooks in `enter()`**

In `enter()`, find the existing `Enemy.onDamageCallback = …` / `Enemy.onRewardCallback = …` block (≈lines 494-499). Immediately after it, add:

```typescript
        // Frozen/marked enemies erupt on death (Phase 1a primed the hook).
        Enemy.onShatterCallback = (position, damage, radius) => {
            const enemies = this.enemyManager?.getEnemies() ?? [];
            aoeBurst(this.scene, enemies, position.x, position.z, { radius, damage, element: 'ice' });
        };
        // PowerEffects.cameraShake → the existing HeroController screen shake.
        setCameraShakeHook((durationS) => this.heroController?.triggerScreenShake(durationS));
```

> Note: `this.heroController` is assigned later in `enter()` than this block; the hook closes over `this`, so it resolves `this.heroController` at shake time (after assignment) — correct. If a lint/type error says `heroController` may be undefined, the `?.` guard already handles it.

- [ ] **Step 3: Tear down in `exit()`**

In `exit()`, find the `Enemy.onDamageCallback = null;` / `Enemy.onRewardCallback = null;` teardown (≈lines 929-930). Add directly after:

```typescript
        Enemy.onShatterCallback = null;
        resetPowerEffects();
```

(`clearMaterialCache()` + `clearProjectilePools()` already run later in `exit()` and will free the cached FX materials + pooled volley meshes.)

- [ ] **Step 4: Type-check + build** — `npx tsc --noEmit` → exit 0; `npm run build` → success.
- [ ] **Step 5: Commit**

```bash
git add src/survivors/SurvivorsGameplayState.ts
git commit -m "feat(fx): wire shatter→aoeBurst + cameraShake hook; reset on exit"
```

---

## Task 10: Full verification

**Files:** none.

- [ ] **Step 1: Full unit suite** — `npm test` → all pass (StatusModel now includes the `detonate` tests).
- [ ] **Step 2: Type-check** — `npx tsc --noEmit` → exit 0.
- [ ] **Step 3: Build** — `npm run build` → success (pre-existing entrypoint-size warnings only).
- [ ] **Step 4: Smoke (dev server)** — `npm start`, play into a wave or two and clear a wave (open the shop).
  Expected: game loads and plays normally (these primitives aren't called by any power yet, so no visible new effect); **no console errors** referencing `PowerEffects`; **no `[resource-watchdog] LEAK SUSPECTED`** at wave clear; `materials`/`textures` stay near baseline (the FX materials are created lazily only when a primitive first runs, which won't happen until Phase 2).
- [ ] **Step 5: Final commit (if needed)**

```bash
git add -A && git commit -m "test(fx): Phase 1b verification pass" || echo "nothing to commit"
```

---

## Notes for the implementer

- **`dealElementalHit` recursion is bounded:** the only reaction (`overload`) emits an `aoeBurst` with `element:'fire'`, and `aoeBurst` damages via `takeDamage` directly (not `dealElementalHit`). Fire has no reaction, so there is no re-entry.
- **Don't dispose cached materials.** Ring/vortex/zone/volley meshes use `getCachedMaterial` (frozen, shared by element); dispose only the MESH (`mesh.dispose()` / `releaseProjectile`). `clearMaterialCache()` in `exit()` frees the shared materials.
- **`hitstop` is intentionally inert** this phase (no host hook wired) — Phase 3 wires it to the game-loop time scale once that API is mapped.
- **No in-game exercise yet:** Phase 2 (fusion archetypes) is the first caller of these primitives; that's where each is verified visually.
