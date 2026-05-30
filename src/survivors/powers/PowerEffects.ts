// Leak-safe, composable effect primitives + screen-FX for powers/fusions/ultimates.
// THE single chokepoint enforcing CLAUDE.md leak rules: every material via
// getCachedMaterial with a bounded (element) key; transient meshes fade via
// mesh.visibility and are disposed with the observer removed; projectiles pool.
import { Scene, Vector3, Color3, MeshBuilder } from '@babylonjs/core';
import type { Observer } from '@babylonjs/core';
import { getCachedMaterial } from '../../engine/rendering/MaterialCache';
import { acquireProjectile, releaseProjectile } from '../../engine/rendering/ProjectilePool';
import { ELEMENT_COLOR } from '../ElementColors';
import { buildArrowMesh } from './ArrowMesh';
import { StatusEffect } from '../GameTypes';
import { getReaction } from './StatusReactions';
import type { Enemy } from '../enemies/Enemy';
import type { PowerElement, ChampionType } from './PowerDefinitions';
import type { RichStatusKind } from './StatusModel';

/** Optional status to apply to every enemy a primitive damages. */
export interface EffectStatus {
    effect: StatusEffect;
    durationS: number;
    strength: number;
}

const RICH_KINDS: RichStatusKind[] = ['burn', 'chill', 'curse', 'fragile'];

// ── active-effect registry ───────────────────────────────────────────────────
// Lets resetPowerEffects() tear down any IN-FLIGHT effect (render observer + mesh)
// at run exit, so a long-lived effect can't bleed damage or orphan a mesh/material
// into the next run on the persistent scene (the project's historic freeze class).
interface ActiveFx { scene: Scene; obs: Observer<Scene>; cleanup: () => void; }
const _activeEffects = new Set<ActiveFx>();

/** End an effect: drop it from the registry, remove its observer, run cleanup. Idempotent. */
function endFx(fx: ActiveFx): void {
    if (!_activeEffects.delete(fx)) return; // already ended
    fx.scene.onBeforeRenderObservable.remove(fx.obs);
    try { fx.cleanup(); } catch { /* mesh/material may already be disposed */ }
}

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
    let fx: ActiveFx;
    const obs = scene.onBeforeRenderObservable.add(() => {
        elapsed += scene.getEngine().getDeltaTime() / 1000;
        const t = Math.min(elapsed / lifeS, 1);
        ring.scaling.set(maxRadius * t, 1, maxRadius * t); // diameter 2 → grows to 2·maxRadius·t
        ring.visibility = 1 - t;
        if (t >= 1) endFx(fx);
    });
    fx = { scene, obs: obs!, cleanup: () => ring.dispose() }; // dispose(false,false) keeps the cached material
    _activeEffects.add(fx);
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
    // Tear down any in-flight effect so it can't bleed into the next run.
    for (const fx of Array.from(_activeEffects)) endFx(fx);
    _activeEffects.clear();
    _cameraShakeHook = null;
    _hitstopHook = null;
    if (_flashEl) { _flashEl.remove(); _flashEl = null; }
}

// ── chainHit — bouncing chain, optional split-on-hop ────────────────────────
/** A fading line bolt between two points. LinesMesh owns its colour (no shared
 *  material to leak); disposed with the observer removed. */
function spawnBolt(scene: Scene, from: Vector3, to: Vector3, element: PowerElement, lifeS = 0.18): void {
    const lines = MeshBuilder.CreateLines('fx_bolt', { points: [from, to] }, scene);
    lines.color = ELEMENT_COLOR[element];
    lines.isPickable = false;
    let elapsed = 0;
    let fx: ActiveFx;
    const obs = scene.onBeforeRenderObservable.add(() => {
        elapsed += scene.getEngine().getDeltaTime() / 1000;
        lines.alpha = Math.max(0, 1 - elapsed / lifeS);
        if (elapsed >= lifeS) endFx(fx);
    });
    fx = { scene, obs: obs!, cleanup: () => lines.dispose() };
    _activeEffects.add(fx);
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
    let fx: ActiveFx;
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
            endFx(fx);
        }
    });
    fx = { scene, obs: obs!, cleanup: () => orb.dispose() };
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
    let fx: ActiveFx;
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
        if (elapsed >= opts.durationS) endFx(fx);
    });
    fx = { scene, obs: obs!, cleanup: () => disc.dispose() };
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
    let fx: ActiveFx;
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
        if (liveCount === 0) endFx(fx);
    });
    fx = { scene, obs: obs!, cleanup: () => {
        for (const s of shots) { if (!s.done) { s.done = true; releaseProjectile('fx_volley', s.mesh); } }
    } };
    _activeEffects.add(fx);
}

// ── deliverAutocast — class-aware effect delivery ────────────────────────────
export function deliverAutocast(
    ctx: { scene: Scene; heroPosition: { x: number; z: number } },
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

/** Fire an arrow from (fromX,fromZ) toward `target`; on impact (or target death /
 *  timeout) call onImpact(x,z) exactly once. The arrow mesh (cached material by
 *  element) is disposed on impact, and the flight observer is torn down cross-run
 *  via the active-effect registry. onImpact is NOT called on cross-run teardown. */
export function arrowStrike(scene: Scene, fromX: number, fromZ: number, target: Enemy, element: PowerElement, onImpact: (x: number, z: number) => void): void {
    const proj = buildArrowMesh(scene, `fx_arrow_${element}`, ELEMENT_COLOR[element]);
    proj.position.set(fromX, 1, fromZ);
    let elapsed = 0;
    let fired = false;
    let fx: ActiveFx;
    const fire = (x: number, z: number) => { if (fired) return; fired = true; try { onImpact(x, z); } catch { /* ignore */ } };
    const obs = scene.onBeforeRenderObservable.add(() => {
        const dt = scene.getEngine().getDeltaTime() / 1000;
        elapsed += dt;
        const tp = target.isAlive() ? target.getPosition() : null;
        if (tp) {
            const dx = tp.x - proj.position.x, dz = tp.z - proj.position.z;
            const dist = Math.hypot(dx, dz);
            if (dist > 0.001) proj.rotation.y = Math.atan2(dx, dz);
            if (dist < 0.6 || elapsed >= ARROW_MAX_TRAVEL_S) { fire(proj.position.x, proj.position.z); endFx(fx); return; }
            const step = Math.min(dist, ARROW_SPEED * dt);
            proj.position.x += (dx / dist) * step;
            proj.position.z += (dz / dist) * step;
        } else {
            fire(proj.position.x, proj.position.z); endFx(fx);
        }
    });
    fx = { scene, obs: obs!, cleanup: () => { proj.getChildMeshes().forEach(c => c.dispose()); proj.dispose(); } };
    _activeEffects.add(fx);
}

// ── repeatStrikes — registry-tracked time-staggered repeat ──────────────────
/** Fire `count` strikes spaced `intervalS` apart (registry-tracked, so it tears
 *  down cross-run). `onStrike(i)` runs each tick; the first fires immediately. */
export function repeatStrikes(scene: Scene, count: number, intervalS: number, onStrike: (i: number) => void): void {
    if (count <= 0) return;
    let fired = 0;
    let acc = intervalS; // fire #0 on the first frame
    let fx: ActiveFx;
    const obs = scene.onBeforeRenderObservable.add(() => {
        acc += scene.getEngine().getDeltaTime() / 1000;
        while (acc >= intervalS && fired < count) {
            acc -= intervalS;
            try { onStrike(fired); } catch { /* ignore */ }
            fired++;
        }
        if (fired >= count) endFx(fx);
    });
    fx = { scene, obs: obs!, cleanup: () => { /* no mesh; onStrike effects self-manage */ } };
    _activeEffects.add(fx);
}

// ── ultimateImpact — FX layer for ultimate casts ─────────────────────────────
/** The "this is an ultimate" punch: camera shake + an element-tinted screen flash. */
export function ultimateImpact(element: PowerElement): void {
    cameraShake(0.4);
    const c = ELEMENT_COLOR[element];
    screenFlash(`rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},0.35)`, 260);
}
