// Leak-safe, composable effect primitives + screen-FX for powers/fusions/ultimates.
// THE single chokepoint enforcing CLAUDE.md leak rules: every material via
// getCachedMaterial with a bounded (element) key; transient meshes fade via
// setMeshOpacity and are disposed with the update token removed; projectiles pool.
import { Mesh, Vector3 } from 'three';
import type { SceneHost, UpdateToken } from '../../engine/three/SceneHost';
import { createDisc, createSphere, createTorus, disposeMesh } from '../../engine/three/primitives';
import { BoltField } from './BoltField';
import { setMeshOpacity } from '../../engine/rendering/LowPolyMaterial';
import { headingToYaw } from '../../engine/three/math';
import { getCachedMaterial } from '../../engine/rendering/MaterialCache';
import { acquireProjectile, releaseProjectile } from '../../engine/rendering/ProjectilePool';
import { ELEMENT_COLOR } from '../ElementColors';
import { buildArrowMesh, ARROW_FLIGHT_HEIGHT } from './ArrowMesh';
import { StatusEffect } from '../GameTypes';
import { getReaction } from './StatusReactions';
import { Enemy } from '../enemies/Enemy';
import { emitCoopFx, isCoopFxActive, isReplayingFx } from '../coop/CoopFx';
import type { PowerElement, ChampionType } from './PowerDefinitions';
import type { RichStatusKind } from './StatusModel';

/** Optional status to apply to every enemy a primitive damages. */
export interface EffectStatus {
    effect: StatusEffect;
    durationS: number;
    strength: number;
}

const RICH_KINDS: RichStatusKind[] = ['burn', 'chill', 'curse', 'fragile'];

// ── horde-scan scratch ───────────────────────────────────────────────────────
// The primitives below walk the whole live enemy list, several times per call for
// the chaining ones, and the maxed barbarian loadout runs them ~8 times per frame
// on top of the per-frame ones (volley collision, zone ticks, vortex pull). That
// is ~62,000 iterations per frame at a ~270-enemy horde, so the inner loop is
// written for the JIT: index loops over `enemies[i]`, DIRECT `e.alive` / `e.position`
// reads rather than the megamorphic `isAlive()` / `getPosition()` calls (~5.2 ns vs
// ~10.5 ns per iteration, measured in-page on the real horde), and no per-iteration
// Set lookup or allocation. Semantics are untouched: same visit order, same
// comparison operators, so the same enemy is picked including on exact ties.
/** chainHit's per-call working set: an "already chained to" marker indexed by slot
 *  in the caller's enemies array (replaces a per-hop `Set.has(e)`, ~7 ns per
 *  iteration) plus a flat frontier (parallel arrays instead of a node object per
 *  branch — a split chain pushes up to 2^hops of them per call).
 *  Held as a DEPTH-INDEXED stack, not a single scratch: a hit can kill, a death can
 *  fire the shatter hook and an ascension kill hook, and nothing in those paths is
 *  statically guaranteed never to reach another chain. Depth 0 is the only one that
 *  ever exists in practice; the stack just makes re-entry correct instead of silently
 *  clobbering the outer chain's frontier. */
interface ChainScratch { mask: Uint8Array; fx: number[]; fz: number[]; fdmg: number[]; fhops: number[]; }
const _chainScratch: ChainScratch[] = [];
let _chainDepth = 0;
const _boltFrom = new Vector3();
const _boltTo = new Vector3();

// ── co-op FX replication ('pe' = primitive effect) ───────────────────────────
// Every VISIBLE primitive below broadcasts a compact 'pe' message at its entry
// point so the teammate replays the SAME primitive (SurvivorsGameplayState.
// playRemoteFx) with enemies=[] and zero damage — pure cosmetics, nothing routes
// through the guest damage/status redirects. Double-gated so:
//  • single-player pays nothing — isCoopFxActive() is a null check and the JSON
//    hint is only built once it passes,
//  • a replayed primitive never re-emits (isReplayingFx()) — no echo loop.
function shouldEmitFx(): boolean { return isCoopFxActive() && !isReplayingFx(); }

// ── active-effect registry ───────────────────────────────────────────────────
// Lets resetPowerEffects() tear down any IN-FLIGHT effect (update token + mesh)
// at run exit, so a long-lived effect can't bleed damage or orphan a mesh/material
// into the next run on the persistent scene (the project's historic freeze class).
interface ActiveFx { scene: SceneHost; token: UpdateToken; cleanup: () => void; }
const _activeEffects = new Set<ActiveFx>();

/** End an effect: drop it from the registry, remove its update token, run cleanup. Idempotent. */
function endFx(fx: ActiveFx): void {
    if (!_activeEffects.delete(fx)) return; // already ended
    fx.scene.onBeforeRender.remove(fx.token);
    try { fx.cleanup(); } catch { /* mesh/material may already be disposed */ }
}

// ── leak-safe shared visual: expanding, fading ring ─────────────────────────
/** Expanding ground ring that fades and self-disposes. Cached shared material
 *  per element; faded via setMeshOpacity (never the shared material's opacity). */
function spawnExpandingRing(scene: SceneHost, x: number, z: number, maxRadius: number, element: PowerElement, lifeS: number): void {
    const ring = createTorus('fx_ring', { diameter: 2, thickness: 0.28, tessellation: 28 }, scene);
    ring.position.set(x, 0.25, z);
    ring.material = getCachedMaterial(`fx_ring_${element}`, m => {
        m.emissive.copy(ELEMENT_COLOR[element]);
        m.color.set(0, 0, 0);
        m.opacity = 0.8;
        m.transparent = true; // render in the transparent pass, like Babylon alpha<1
    });
    let elapsed = 0;
    let fx: ActiveFx;
    const token = scene.onBeforeRender.add(() => {
        elapsed += scene.deltaSeconds;
        const t = Math.min(elapsed / lifeS, 1);
        ring.scale.set(maxRadius * t, 1, maxRadius * t); // diameter 2 → grows to 2·maxRadius·t
        setMeshOpacity(ring, 0.8 * (1 - t)); // Babylon visibility × mat.alpha(0.8)
        if (t >= 1) endFx(fx);
    });
    fx = { scene, token, cleanup: () => disposeMesh(ring) }; // cached material survives; owned fade clone freed
    _activeEffects.add(fx);
}

function applyStatus(e: Enemy, status: EffectStatus | undefined): void {
    if (status && e.isAlive()) e.applyStatusEffect(status.effect, status.durationS, status.strength);
}

// ── dealElementalHit — the damage chokepoint that fires cross-reactions ──────
/** Apply a direct elemental hit to one enemy, then fire any status cross-reaction
 *  (e.g. storm on a burning enemy → detonate burn as a fire AoE). Use this for the
 *  PRIMARY target of a power; AoE splash uses takeDamage directly (no nested reactions). */
export function dealElementalHit(scene: SceneHost, enemies: Enemy[], target: Enemy, damage: number, element: PowerElement): void {
    const died = target.takeDamage(damage, element);
    if (died) return;
    for (const kind of RICH_KINDS) {
        if (!target.hasRichStatus(kind)) continue;
        const reaction = getReaction(element, kind);
        if (!reaction) continue;
        if (reaction.kind === 'overload') {
            const burst = target.detonateRichStatus(kind);
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
export function aoeBurst(scene: SceneHost, enemies: Enemy[], x: number, z: number, opts: AoeOpts): void {
    if (shouldEmitFx()) {
        emitCoopFx('pe', x, z, undefined, undefined,
            JSON.stringify({ p: 'aoeBurst', e: opts.element, r: opts.radius, l: opts.ringLifeS }));
    }
    const r2 = opts.radius * opts.radius;
    for (let i = 0; i < enemies.length; i++) {
        const e = enemies[i];
        if (!e.alive) continue;
        const p = e.position;
        const dx = p.x - x, dz = p.z - z;
        if (dx * dx + dz * dz <= r2) {
            e.takeDamage(opts.damage, opts.element);
            applyStatus(e, opts.status);
        }
    }
    spawnExpandingRing(scene, x, z, opts.radius, opts.element, opts.ringLifeS ?? 0.35);
}

// ── screen FX ────────────────────────────────────────────────────────────────
// cameraShake/hitstop are host-driven (the gameplay state owns the camera + the
// game-loop time scale), so they call a registered hook; no-op until wired.
let _cameraShakeHook: ((durationS: number) => void) | null = null;
let _hitstopHook: ((ms: number) => void) | null = null;

/** Ascension's Forked Lightning bonus, applied to EVERY chain in the run.
 *  Module-level like the other host hooks, so it MUST be nulled in
 *  resetPowerEffects() or the next run inherits the previous run's chains. */
export interface ChainBonus { extraHops: number; radiusBonus: number; split: boolean; }
let _chainBonus: (() => ChainBonus) | null = null;
export function setChainBonusProvider(fn: (() => ChainBonus) | null): void { _chainBonus = fn; }

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
    // Tear down any in-flight effect so it can't bleed into the next run.
    for (const fx of Array.from(_activeEffects)) endFx(fx);
    _activeEffects.clear();
    // The bolt field holds an onBeforeRender token + a scene object; it is not an
    // ActiveFx, so it needs its own teardown here or it survives into the next run.
    _boltField?.dispose();
    _boltField = null;
    _boltFieldScene = null;
    _cameraShakeHook = null;
    _hitstopHook = null;
    _chainBonus = null;
    if (_flashEl) { _flashEl.remove(); _flashEl = null; }
}

// ── chainHit — bouncing chain, optional split-on-hop ────────────────────────
// ── batched bolt field ──────────────────────────────────────────────────────
// Every live bolt is a segment of ONE LineSegments rather than a scene object of
// its own — see BoltField for the measurement and the identical-output argument.
// Lazily built on first use so a run with no chain power never allocates it, and
// rebuilt if the host scene ever changes under us.
let _boltField: BoltField | null = null;
let _boltFieldScene: SceneHost | null = null;
function boltField(scene: SceneHost): BoltField {
    if (_boltField && _boltFieldScene === scene) return _boltField;
    _boltField?.dispose();
    _boltFieldScene = scene;
    _boltField = new BoltField(scene);
    return _boltField;
}

/** A fading line bolt between two points, rendered as one segment of the shared
 *  BoltField (a maxed chain fusion puts hundreds on screen at once, and a scene
 *  object each cost ~4 µs/frame apiece).
 *  Co-op: chainHit's whole visual is composed of these bolts, and its hop targets
 *  are enemy-dependent (the teammate can't recompute them), so the 'pe' broadcast
 *  happens HERE per bolt — the receiver replays each segment verbatim, giving the
 *  exact chain shape. Bolt count is bounded by chainHit's hit-set de-dup.
 *  Exported for the co-op replay path only. */
export function spawnBolt(scene: SceneHost, from: Vector3, to: Vector3, element: PowerElement, lifeS = 0.18): void {
    if (shouldEmitFx()) {
        emitCoopFx('pe', from.x, from.z, to.x, to.z, JSON.stringify({ p: 'bolt', e: element }));
    }
    boltField(scene).spawn(from, to, ELEMENT_COLOR[element], lifeS);
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
export function chainHit(scene: SceneHost, enemies: Enemy[], origin: Vector3, opts: ChainOpts): void {
    const falloff = opts.falloff ?? 0.75;
    // Read ONCE per chain, never per hop. The shared hit-marker below still bounds
    // total work, so extra hops + split cannot revisit an enemy.
    const cb = _chainBonus ? _chainBonus() : null;
    const chainRadius = opts.radius + (cb ? cb.radiusBonus : 0);
    const chainSplit = opts.split || (cb ? cb.split : false);
    const r2 = chainRadius * chainRadius;
    let s = _chainScratch[_chainDepth];
    if (!s) s = _chainScratch[_chainDepth] = { mask: new Uint8Array(64), fx: [], fz: [], fdmg: [], fhops: [] };
    _chainDepth++;
    try {
        const { fx, fz, fdmg, fhops } = s;
        // Hit marker indexed by slot in `enemies`. A live enemy only ever leaves that
        // array in EnemyManager's own sweep (never from takeDamage), and a mid-chain
        // SplittingEnemy death APPENDS its minis, so an index captured here stays
        // valid and an appended enemy is correctly unmarked for later hops — exactly
        // what the Set did. `cleared` tracks how much of the marker is known zero, so
        // a list that grows mid-chain only pays for the new tail.
        let cleared = 0;
        fx.length = 0; fz.length = 0; fdmg.length = 0; fhops.length = 0;
        fx.push(origin.x); fz.push(origin.z);
        fdmg.push(opts.damage); fhops.push(opts.hops + (cb ? cb.extraHops : 0));
        for (let head = 0; head < fx.length; head++) {
            const nodeHops = fhops[head];
            if (nodeHops <= 0) continue;
            const nodeX = fx[head], nodeZ = fz[head], nodeDmg = fdmg[head];
            const n = enemies.length;
            if (n > cleared) {
                if (s.mask.length < n) {
                    const grown = new Uint8Array(Math.max(n, s.mask.length * 2));
                    grown.set(s.mask.subarray(0, cleared));
                    s.mask = grown;
                }
                s.mask.fill(0, cleared, n);
                cleared = n;
            }
            const mask = s.mask;
            let best = -1;
            let bestD2 = r2;
            for (let i = 0; i < n; i++) {
                if (mask[i]) continue;
                const e = enemies[i];
                if (!e.alive) continue;
                const p = e.position;
                const dx = p.x - nodeX, dz = p.z - nodeZ;
                const d2 = dx * dx + dz * dz;
                if (d2 <= bestD2) { bestD2 = d2; best = i; }
            }
            if (best < 0) continue;
            mask[best] = 1;
            const bestEnemy = enemies[best];
            const bp = bestEnemy.position;
            // spawnBolt only READS its endpoints (emitCoopFx takes x/z, BoltField
            // copies into its buffer), so scratch vectors are safe here and save two
            // allocations per hop. Read before the hit, as the original did.
            _boltFrom.set(nodeX, 1, nodeZ);
            _boltTo.set(bp.x, 1, bp.z);
            spawnBolt(scene, _boltFrom, _boltTo, opts.element);
            bestEnemy.takeDamage(nodeDmg, opts.element);
            applyStatus(bestEnemy, opts.status);
            const branches = chainSplit ? 2 : 1;
            // Branch origins are read AFTER the hit, exactly as the object frontier
            // did: `bp` is the enemy's live Vector3, so anything the hit moved
            // (knockback out of a shatter reaction) shifts where the next hop starts.
            for (let b = 0; b < branches; b++) {
                fx.push(bp.x); fz.push(bp.z);
                fdmg.push(nodeDmg * falloff); fhops.push(nodeHops - 1);
            }
        }
    } finally {
        _chainDepth--;
    }
}

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
 *  emits a final burst. Self-disposing (orb mesh + update token). */
export function gatherVortex(scene: SceneHost, enemies: Enemy[], x: number, z: number, opts: VortexOpts): void {
    if (shouldEmitFx()) {
        emitCoopFx('pe', x, z, undefined, undefined,
            JSON.stringify({ p: 'vortex', e: opts.element, r: opts.radius, d: opts.durationS }));
    }
    // Captured ONCE at creation: the per-frame callback below outlives the
    // synchronous withFxReplay() window, so reading isReplayingFx() per frame
    // would wrongly report false. A replayed vortex must NEVER move enemies —
    // on the HOST the guest-redirect guard below is null, so without this a
    // replayed teammate vortex would pull the host's real enemies.
    const isReplay = isReplayingFx();
    const tickInterval = opts.tickIntervalS ?? 0.2;
    const r2 = opts.radius * opts.radius;
    const orb = createSphere('fx_vortex', { diameter: 1.0, segments: 8 }, scene);
    orb.position.set(x, 1, z);
    orb.material = getCachedMaterial(`fx_vortex_${opts.element}`, m => {
        m.emissive.copy(ELEMENT_COLOR[opts.element]);
        m.color.set(0, 0, 0);
        m.opacity = 0.85;
        m.transparent = true;
    });
    let elapsed = 0;
    let tickAcc = 0;
    let fx: ActiveFx;
    const token = scene.onBeforeRender.add(() => {
        const dt = scene.deltaSeconds;
        elapsed += dt;
        tickAcc += dt;
        orb.rotation.y += dt * 6;
        const doTick = tickAcc >= tickInterval;
        if (doTick) tickAcc -= tickInterval;
        // Co-op guest (redirect set): enemies are host-authoritative render copies —
        // never move them locally or the pull fights the snapshot. Damage/status
        // below still run (they route to the host via the redirects). A cosmetic
        // REPLAY (isReplay) must not move enemies on either role.
        const canMoveEnemies = !Enemy.guestDamageRedirect && !isReplay;
        for (let i = 0; i < enemies.length; i++) {
            const e = enemies[i];
            if (!e.alive) continue;
            const p = e.position;
            const dx = x - p.x, dz = z - p.z;
            if (dx * dx + dz * dz > r2) continue;
            if (canMoveEnemies) {
                // Pull inward (mutates the by-ref position; enemy.update copies it to the mesh).
                p.x += dx * opts.pull * dt;
                p.z += dz * opts.pull * dt;
            }
            if (doTick) {
                e.takeDamage(opts.tickDamage, opts.element);
                applyStatus(e, opts.status);
            }
        }
        if (elapsed >= opts.durationS) {
            if (opts.finalBurst && opts.finalBurst > 0) {
                aoeBurst(scene, enemies, x, z, { radius: opts.radius, damage: opts.finalBurst, element: opts.element });
            }
            endFx(fx);
        }
    });
    fx = { scene, token, cleanup: () => disposeMesh(orb) };
    _activeEffects.add(fx);
}

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
 *  can creep toward a point. Cached shared material; faded via setMeshOpacity; self-disposing. */
export function persistentZone(scene: SceneHost, enemies: Enemy[], x: number, z: number, opts: ZoneOpts): void {
    if (shouldEmitFx()) {
        emitCoopFx('pe', x, z, undefined, undefined, JSON.stringify({
            p: 'zone', e: opts.element, r: opts.radius, d: opts.durationS,
            cx: opts.crawlToward?.x, cz: opts.crawlToward?.z, cs: opts.crawlSpeed,
        }));
    }
    const tickInterval = opts.tickIntervalS ?? 0.5;
    const crawlSpeed = opts.crawlSpeed ?? 1.5;
    let cx = x, cz = z;
    const disc = createDisc('fx_zone', { radius: opts.radius, tessellation: 32 }, scene);
    disc.rotation.x = -Math.PI / 2; // lay flat facing up (+Y); sign flips with the RH handedness
    disc.position.set(cx, 0.06, cz);
    disc.material = getCachedMaterial(`fx_zone_${opts.element}`, m => {
        m.emissive.copy(ELEMENT_COLOR[opts.element]);
        m.color.set(0, 0, 0);
        m.opacity = 0.32;
        m.transparent = true;
    });
    setMeshOpacity(disc, 0.32 * 0.7); // Babylon visibility(0.7) × mat.alpha(0.32)
    const r2 = opts.radius * opts.radius;
    let elapsed = 0;
    let tickAcc = 0;
    let fx: ActiveFx;
    const token = scene.onBeforeRender.add(() => {
        const dt = scene.deltaSeconds;
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
        // gentle alpha pulse via the mesh-owned fade clone (never the shared material)
        setMeshOpacity(disc, 0.32 * (0.55 + 0.2 * Math.sin(elapsed * 6)));
        if (tickAcc >= tickInterval) {
            tickAcc -= tickInterval;
            for (let i = 0; i < enemies.length; i++) {
                const e = enemies[i];
                if (!e.alive) continue;
                const p = e.position;
                const dx = p.x - cx, dz = p.z - cz;
                if (dx * dx + dz * dz <= r2) {
                    e.takeDamage(opts.tickDamage, opts.element);
                    applyStatus(e, opts.status);
                }
            }
        }
        if (elapsed >= opts.durationS) endFx(fx);
    });
    fx = { scene, token, cleanup: () => disposeMesh(disc) };
    _activeEffects.add(fx);
}

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
export function omniVolley(scene: SceneHost, enemies: Enemy[], x: number, z: number, opts: VolleyOpts): void {
    if (shouldEmitFx()) {
        emitCoopFx('pe', x, z, undefined, undefined,
            JSON.stringify({ p: 'volley', e: opts.element, c: opts.count, s: opts.speed, l: opts.lifeS }));
    }
    const lifeS = opts.lifeS ?? 1.2;
    const hr2 = (opts.hitRadius ?? 0.6) ** 2;
    interface Shot { mesh: Mesh; vx: number; vz: number; t: number; done: boolean; }
    const shots: Shot[] = [];
    for (let i = 0; i < opts.count; i++) {
        const ang = (i / opts.count) * Math.PI * 2;
        const mesh = acquireProjectile('fx_volley', () =>
            createSphere('fx_volley', { diameter: 0.3, segments: 6 }, scene));
        mesh.position.set(x, 1, z);
        mesh.material = getCachedMaterial(`fx_volley_${opts.element}`, m => {
            m.emissive.copy(ELEMENT_COLOR[opts.element]);
            m.color.set(0, 0, 0);
        });
        shots.push({ mesh, vx: Math.cos(ang) * opts.speed, vz: Math.sin(ang) * opts.speed, t: 0, done: false });
    }
    let fx: ActiveFx;
    const token = scene.onBeforeRender.add(() => {
        const dt = scene.deltaSeconds;
        let liveCount = 0;
        for (const s of shots) {
            if (s.done) continue;
            s.t += dt;
            s.mesh.position.x += s.vx * dt;
            s.mesh.position.z += s.vz * dt;
            let hitEnemy: Enemy | null = null;
            const sx = s.mesh.position.x, sz = s.mesh.position.z;
            for (let i = 0; i < enemies.length; i++) {
                const e = enemies[i];
                if (!e.alive) continue;
                const p = e.position;
                const dx = p.x - sx, dz = p.z - sz;
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
        if (liveCount === 0) endFx(fx);
    });
    fx = { scene, token, cleanup: () => {
        for (const s of shots) { if (!s.done) { s.done = true; releaseProjectile('fx_volley', s.mesh); } }
    } };
    _activeEffects.add(fx);
}

// ── deliverAutocast — class-aware effect delivery ────────────────────────────
export function deliverAutocast(
    ctx: { scene: SceneHost; heroPosition: { x: number; z: number } },
    championType: ChampionType,
    target: Enemy,
    element: PowerElement,
    effectAt: (x: number, z: number) => void,
): void {
    if (championType === 'ranger') {
        arrowStrike(ctx.scene, ctx.heroPosition.x, ctx.heroPosition.z, target, element, effectAt);
    } else {
        const p = target.getPosition();
        effectAt(p.x, p.z);
    }
}

// ── arrowStrike — ranger-class delivery: fly an arrow to a target, fire onImpact ──
const ARROW_SPEED = 26;
const ARROW_MAX_TRAVEL_S = 2.0;

/** Minimal target surface for arrow flight. Enemy satisfies it structurally; the
 *  co-op replay passes a fixed point (the target's position at emit time) so the
 *  cosmetic arrow needs no Enemy at all. */
export interface ArrowFlightTarget {
    isAlive(): boolean;
    getPosition(): { x: number; z: number };
}

/** Fire an arrow from (fromX,fromZ) toward `target`; on impact (or target death /
 *  timeout) call onImpact(x,z) exactly once. The arrow mesh (cached material by
 *  element) is disposed on impact, and the flight callback is torn down cross-run
 *  via the active-effect registry. onImpact is NOT called on cross-run teardown.
 *  Co-op: the replayed arrow flies to the target's position AT EMIT TIME (a fixed
 *  point — close enough over a ~0.5s flight); its impact FX arrives as the
 *  impacted primitive's own 'pe' message, so the replay onImpact is a no-op. */
export function arrowStrike(scene: SceneHost, fromX: number, fromZ: number, target: ArrowFlightTarget, element: PowerElement, onImpact: (x: number, z: number) => void): void {
    if (shouldEmitFx()) {
        const tp0 = target.getPosition();
        emitCoopFx('pe', fromX, fromZ, tp0.x, tp0.z, JSON.stringify({ p: 'arrow', e: element }));
    }
    const proj = buildArrowMesh(scene, `fx_arrow_${element}`, ELEMENT_COLOR[element]);
    proj.position.set(fromX, ARROW_FLIGHT_HEIGHT, fromZ);
    let elapsed = 0;
    let fired = false;
    let fx: ActiveFx;
    const fire = (x: number, z: number) => { if (fired) return; fired = true; try { onImpact(x, z); } catch { /* ignore */ } };
    const token = scene.onBeforeRender.add(() => {
        const dt = scene.deltaSeconds;
        elapsed += dt;
        const tp = target.isAlive() ? target.getPosition() : null;
        if (tp) {
            const dx = tp.x - proj.position.x, dz = tp.z - proj.position.z;
            const dist = Math.hypot(dx, dz);
            if (dist > 0.001) proj.rotation.y = headingToYaw(dx, dz);
            if (dist < 0.6 || elapsed >= ARROW_MAX_TRAVEL_S) { fire(proj.position.x, proj.position.z); endFx(fx); return; }
            const step = Math.min(dist, ARROW_SPEED * dt);
            proj.position.x += (dx / dist) * step;
            proj.position.z += (dz / dist) * step;
        } else {
            fire(proj.position.x, proj.position.z); endFx(fx);
        }
    });
    fx = { scene, token, cleanup: () => disposeMesh(proj) }; // disposes the whole arrow subtree
    _activeEffects.add(fx);
}

// ── repeatStrikes — registry-tracked time-staggered repeat ──────────────────
/** Fire `count` strikes spaced `intervalS` apart (registry-tracked, so it tears
 *  down cross-run). `onStrike(i)` runs each tick; the first fires immediately. */
export function repeatStrikes(scene: SceneHost, count: number, intervalS: number, onStrike: (i: number) => void): void {
    if (count <= 0) return;
    let fired = 0;
    let acc = intervalS; // fire #0 on the first frame
    let fx: ActiveFx;
    const token = scene.onBeforeRender.add(() => {
        acc += scene.deltaSeconds;
        while (acc >= intervalS && fired < count) {
            acc -= intervalS;
            try { onStrike(fired); } catch { /* ignore */ }
            fired++;
        }
        if (fired >= count) endFx(fx);
    });
    fx = { scene, token, cleanup: () => { /* no mesh; onStrike effects self-manage */ } };
    _activeEffects.add(fx);
}

// ── ultimateImpact — FX layer for ultimate casts ─────────────────────────────
/** The "this is an ultimate" punch: camera shake + an element-tinted screen flash. */
export function ultimateImpact(element: PowerElement): void {
    cameraShake(0.4);
    const c = ELEMENT_COLOR[element];
    screenFlash(`rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},0.35)`, 260);
}
