import { Color, DoubleSide, Mesh, MeshBasicMaterial, MeshPhongMaterial, Vector3 } from 'three';
import { LifeTimeCurve, Shape, SimulationSpace } from '@newkrok/three-particles';
import { SceneHost } from '../../engine/three/SceneHost';
import { fxRenderer, fxSize, ParticleEffect } from '../../engine/three/particles/ParticleEffect';
import { headingToYaw } from '../../engine/three/math';
import { tween } from '../../engine/three/tween';
import {
    createCylinder, createDisc, createIcoSphere, createTorus,
    disposeMesh, isMeshDisposed,
} from '../../engine/three/primitives';
import { createEmissiveMaterial, setMeshOpacity } from '../../engine/rendering/LowPolyMaterial';
import { getCachedMaterial } from '../../engine/rendering/MaterialCache';

/**
 * Manual-ultimate VISUALS, extracted from AbilityManager (M6 C2) so the exact same
 * meshes/particles can be built in two places:
 *   - the local cast (AbilityManager applies damage/CC separately, then calls these),
 *   - the co-op replay (SurvivorsGameplayState.playRemoteFx / the cosmetic ult
 *     channels), which calls them with NO gameplay code at all.
 *
 * Everything here is pure cosmetics: no Enemy access, no damage, and NO emitCoopFx —
 * fx emission stays at the AbilityManager cast sites, so replays can call these
 * directly without an echo loop (no withFxReplay needed).
 *
 * Leak rules (CLAUDE.md): cached materials use BOUNDED keys ('whirlwindRingMat',
 * 'coopVolleyArrowMat'); meshes that own a unique animated material are flagged
 * userData.ownedMaterial and freed via disposeMesh(); cached/shared materials
 * survive a plain disposeMesh() and are freed by clearMaterialCache() on run
 * teardown.
 */

// =============================================================================
// WHIRLWIND RING POOL — 8 pre-allocated torus meshes reused across ring spawns.
// Material is cached once (shared); alpha fade is done via scale-only so the
// shared material isn't mutated per-instance.
// =============================================================================

const WHIRLWIND_POOL_SIZE = 8;
const whirlwindPool: Mesh[] = [];
let whirlwindPoolInit = false;

function acquireWhirlwindRing(host: SceneHost): Mesh {
    // The pool is module-level so it survives state exits, but Game.cleanupScene()
    // disposes every scene mesh between states. On the next run the pool would
    // hold disposed (or other-scene) meshes — re-enabling those renders nothing.
    // Detect stale entries and rebuild the pool from scratch.
    if (whirlwindPoolInit && whirlwindPool.some(r => isMeshDisposed(r) || r.parent !== host.scene)) {
        for (const r of whirlwindPool) {
            if (!isMeshDisposed(r)) disposeMesh(r); // cached/shared material — keep it
        }
        whirlwindPool.length = 0;
        whirlwindPoolInit = false;
    }
    if (!whirlwindPoolInit) {
        for (let i = 0; i < WHIRLWIND_POOL_SIZE; i++) {
            const t = createTorus(
                `whirlwindRing${i}`,
                { diameter: 1.0, thickness: 0.08, tessellation: 16 },
                host,
            );
            t.visible = false;
            t.material = getCachedMaterial('whirlwindRingMat', m => {
                m.emissive = new Color(0.5, 0.8, 1.0);
                m.color = new Color(0, 0, 0);
                m.transparent = true;
                m.opacity = 0.85;
            });
            whirlwindPool.push(t);
        }
        whirlwindPoolInit = true;
    }
    for (const r of whirlwindPool) {
        if (!r.visible) {
            r.visible = true;
            return r;
        }
    }
    // Fallback: pool exhausted — allocate fresh, will be disposed on completion.
    return createTorus(
        `whirlwindRingX${performance.now()}`,
        { diameter: 1.0, thickness: 0.08, tessellation: 16 },
        host,
    );
}

/** One expanding whirlwind ground ring at `center` (pooled; scale-only fade).
 *  `tint` recolors the ring to the caster's blended power elements — cached per
 *  blend hex (bounded: element subsets are finite). */
export function spawnWhirlwindRing(host: SceneHost, center: Vector3, radius: number, tint?: Color): void {
    const ring = acquireWhirlwindRing(host);
    const isPooled = whirlwindPool.indexOf(ring) >= 0;

    ring.material = tint
        ? getCachedMaterial(`whirlwindRingMat_${tint.getHexString()}`, m => {
            m.emissive = tint.clone().multiplyScalar(1.15);
            m.color = new Color(0, 0, 0);
            m.transparent = true;
            m.opacity = 0.85;
        })
        : getCachedMaterial('whirlwindRingMat', m => {
            m.emissive = new Color(0.5, 0.8, 1.0);
            m.color = new Color(0, 0, 0);
            m.transparent = true;
            m.opacity = 0.85;
        });

    // Diameter stored as scaling; pool torus has diameter=1.0, so scale by target.
    const targetScale = radius * 0.6;
    ring.position.set(center.x, center.y + 0.3, center.z);
    // Start small, expand to targetScale over the duration (scale-only fade).
    ring.scale.set(targetScale * 0.3, 1, targetScale * 0.3);

    const duration = 0.4; // seconds (~12 frames at 30 fps, matching original)
    let elapsed = 0;
    const obs = host.onBeforeRender.add(() => {
        elapsed += host.deltaSeconds;
        const t = Math.min(elapsed / duration, 1);
        const s = targetScale * (0.3 + 0.7 * t);
        ring.scale.set(s, 1 - t, s); // shrink vertically to "vanish"
        if (t >= 1) {
            host.onBeforeRender.remove(obs);
            if (isPooled) {
                ring.visible = false;
                ring.scale.set(1, 1, 1);
            } else {
                disposeMesh(ring);
            }
        }
    });
}

// =============================================================================
// Whirlwind hurricane (updraft particles + spinning funnel cloud)
// =============================================================================

/**
 * The whirlwind hurricane body: a tall storm-grey updraft particle column plus a
 * spinning funnel of stacked rings, both following `getCenter()` each frame for
 * `durationS` (the funnel envelope fades itself in/out over that window).
 * Returns a dispose handle — the caller (local whirlwind onEnd, or the co-op
 * channel teardown) MUST call it; it is idempotent and removes both observers.
 */
export function spawnHurricaneVisual(
    host: SceneHost,
    getCenter: () => Vector3 | null,
    durationS: number,
    radius: number,
    tint?: Color,
): { dispose: () => void } {
    const start = getCenter() ?? new Vector3(0, 0, 0);

    // ── Storm updraft ───────────────────────────────────────────────────
    // A tall, fast column of pale storm-grey debris spiralling upward — the
    // airborne body of the hurricane. The effect stays at the scene root
    // (WORLD sim) and its transform is repositioned each frame to track the
    // hero, matching the old Vector3-emitter follow pattern.
    const startColorRange = tint
        ? {
            min: { r: tint.r * 0.7, g: tint.g * 0.7, b: tint.b * 0.7 },
            max: {
                r: Math.min(1, tint.r * 1.2 + 0.15),
                g: Math.min(1, tint.g * 1.2 + 0.15),
                b: Math.min(1, tint.b * 1.2 + 0.15),
            },
        }
        : {
            min: { r: 0.55, g: 0.62, b: 0.72 }, // grey-blue
            max: { r: 0.85, g: 0.90, b: 0.97 }, // pale storm white
        };
    const deadColor = tint
        ? { r: tint.r * 0.25, g: tint.g * 0.25, b: tint.b * 0.25 }
        : { r: 0.30, g: 0.34, b: 0.40 };
    const vortexPs = new ParticleEffect('whirlwindVortex', host, {
        transform: {
            position: new Vector3(start.x, start.y + 0.2, start.z),
            rotation: new Vector3(-Math.PI / 2, 0, 0),
        },
        simulationSpace: SimulationSpace.WORLD,
        looping: true,
        duration: 2,
        maxParticles: 240,
        emission: { rateOverTime: 252 },
        shape: { shape: Shape.CIRCLE, circle: { radius: Math.max(0.05, radius * 0.5), radiusThickness: 1, arc: 360 } },
        startLifetime: { min: 1.0, max: 2.0 },
        startSpeed: { min: 15.3, max: 30.6 },
        startSize: { min: fxSize(0.08), max: fxSize(0.30) },
        startColor: startColorRange,
        startOpacity: 0.9,
        colorOverLifetime: {
            isActive: true,
            r: { type: LifeTimeCurve.EASING, curveFunction: (t: number) => 1 - t * (1 - deadColor.r / startColorRange.max.r) },
            g: { type: LifeTimeCurve.EASING, curveFunction: (t: number) => 1 - t * (1 - deadColor.g / startColorRange.max.g) },
            b: { type: LifeTimeCurve.EASING, curveFunction: (t: number) => 1 - t * (1 - deadColor.b / startColorRange.max.b) },
        },
        opacityOverLifetime: { isActive: true, lifetimeCurve: { type: LifeTimeCurve.EASING, curveFunction: (t: number) => 1 - t } },
        // Old gravity.set(0, 3, 0) was an updraft (positive Y accel); the lib's
        // gravity is a downward scalar, so a negative value reproduces the lift.
        gravity: -1.08,
        renderer: fxRenderer('normal'),
    });

    const emitterObs = host.onBeforeRender.add(() => {
        const pos = getCenter();
        if (!pos) return;
        vortexPs.object.position.set(pos.x, pos.y + 0.2, pos.z);
    });

    // ── Funnel cloud ────────────────────────────────────────────────────
    // A vertical stack of rings that flares wide at the top and narrows at the
    // base, spinning fast and swaying on a helix so it reads as a hurricane
    // funnel from the top-down camera. Dedicated meshes (NOT the pooled ground
    // rings), each owning its OWN material copy so the per-ring opacity fade
    // never touches a shared/cached material; disposeMesh in dispose() frees
    // mesh + owned material together (userData.ownedMaterial).
    const FUNNEL_RINGS = 7;
    const FUNNEL_HEIGHT = 4.5;
    const funnelLife = durationS;
    const makeFunnelMat = (): MeshPhongMaterial => {
        const m = new MeshPhongMaterial();
        m.name = 'hurricaneFunnelMat';
        m.color = new Color(0, 0, 0);
        m.emissive = tint
            ? tint.clone().multiplyScalar(1.1)
            : new Color(0.7, 0.85, 1.0); // pale storm-blue
        m.transparent = true;
        m.opacity = 0.5;
        m.side = DoubleSide;
        return m;
    };
    const funnelRings: Mesh[] = [];
    for (let i = 0; i < FUNNEL_RINGS; i++) {
        const ring = createTorus(
            `hurricaneRing${i}`,
            { diameter: 1.0, thickness: 0.06, tessellation: 20 },
            host,
        );
        ring.material = makeFunnelMat();
        ring.userData.ownedMaterial = true;
        setMeshOpacity(ring, 0);
        funnelRings.push(ring);
    }

    let funnelT = 0;
    const funnelObs = host.onBeforeRender.add(() => {
        const pos = getCenter();
        if (!pos) return;
        funnelT += host.deltaSeconds;
        const spin = funnelT * 7.0; // fast rotation (rad/s)
        // Envelope: spin up over 0.4s, taper out over the last 0.6s.
        const fadeIn = Math.min(funnelT / 0.4, 1);
        const fadeOut = Math.min(Math.max((funnelLife - funnelT) / 0.6, 0), 1);
        const envelope = fadeIn * fadeOut;
        for (let i = 0; i < FUNNEL_RINGS; i++) {
            const f = i / (FUNNEL_RINGS - 1);          // 0 base → 1 top
            const ring = funnelRings[i];
            // Funnel profile: narrow at the base, flaring wide at the top,
            // with a per-ring turbulent pulse (phase-offset by height).
            const ringScale = radius * (0.25 + 0.95 * f) *
                (1 + 0.08 * Math.sin(funnelT * 9 + i * 1.7));
            // Helix sway — higher rings drift further off the axis.
            const drift = 0.18 * radius * f;
            const driftAngle = spin * 0.5 + f * 2.2;
            ring.position.set(
                pos.x + Math.cos(driftAngle) * drift,
                pos.y + 0.2 + f * FUNNEL_HEIGHT,
                pos.z + Math.sin(driftAngle) * drift,
            );
            ring.scale.set(ringScale, 1, ringScale);
            ring.rotation.y = spin + i * 0.4;
            ring.rotation.x = 0.12 * Math.sin(funnelT * 4 + i);
            ring.rotation.z = 0.12 * Math.cos(funnelT * 4 + i);
            // Wispier toward the top; fade with the global envelope. Each ring
            // owns its material, so the fade never mutates a shared one.
            setMeshOpacity(ring, envelope * (0.7 - 0.4 * f));
        }
    });

    let disposed = false;
    return {
        dispose: () => {
            if (disposed) return;
            disposed = true;
            host.onBeforeRender.remove(emitterObs);
            host.onBeforeRender.remove(funnelObs);
            // Dispose the funnel meshes; each owns its material (ownedMaterial),
            // so disposeMesh frees both.
            for (const r of funnelRings) {
                try { disposeMesh(r); } catch { /* ignore */ }
            }
            try { vortexPs.stop(); } catch { /* ignore */ }
            setTimeout(() => {
                try { vortexPs.dispose(); } catch { /* ignore */ }
            }, 700);
        },
    };
}

// =============================================================================
// Meteor Strike
// =============================================================================

const METEOR_COUNT = 5;

/**
 * The meteor-barrage pattern shared by the local cast and the co-op replay:
 * METEOR_COUNT strikes — the first dead-on `position` (synchronously), the rest
 * scattered on a ring around it, staggered 120ms apart. `strike` is the per-impact
 * action: damage + visual locally, visual-only on the replay side.
 */
export function scheduleMeteorBarrage(position: Vector3, strike: (target: Vector3) => void): void {
    const scatter = 4; // how far the secondary meteors land from the target (u)
    for (let i = 0; i < METEOR_COUNT; i++) {
        // First meteor lands dead-on the target; the rest scatter on a ring
        // around it so the barrage blankets the area.
        let target: Vector3;
        if (i === 0) {
            target = position.clone();
        } else {
            const angle = (i / (METEOR_COUNT - 1)) * Math.PI * 2 + Math.random() * 0.6;
            const dist = scatter * (0.5 + Math.random() * 0.5);
            target = new Vector3(
                position.x + Math.cos(angle) * dist,
                position.y,
                position.z + Math.sin(angle) * dist,
            );
        }
        // Stagger impacts so they rain in rather than landing as one.
        const delayMs = i * 120;
        if (delayMs === 0) {
            strike(target);
        } else {
            setTimeout(() => strike(target), delayMs);
        }
    }
}

/** One falling meteor + impact ring + spark burst at `position`. */
export function createMeteorVisual(host: SceneHost, position: Vector3, radius: number): void {
    const fireball = createIcoSphere('meteorBall', {
        radius: 0.8, subdivisions: 1
    }, host);
    fireball.position.set(position.x, position.y + 15, position.z);
    fireball.material = createEmissiveMaterial('meteorMat', new Color(1, 0.3, 0), 0.9);
    fireball.userData.ownedMaterial = true;

    // Descent: y from position.y+15 to position.y+0.5 over 12 frames (0.4s).
    const yFrom = position.y + 15;
    const yTo = position.y + 0.5;
    tween(host, 12 / 30, t => {
        fireball.position.y = yFrom + (yTo - yFrom) * t;
    }, {
        onEnd: () => {
            disposeMesh(fireball);

            const ring = createTorus('meteorRing', {
                diameter: 0.5, thickness: 0.3, tessellation: 16
            }, host);
            ring.position.set(position.x, position.y + 0.1, position.z);
            const ringMat = createEmissiveMaterial('meteorRingMat', new Color(1, 0.5, 0), 0.8);
            ringMat.transparent = true;
            ringMat.opacity = 0.8;
            ring.material = ringMat;
            ring.userData.ownedMaterial = true;

            // Expand 1 → radius*2 (XZ) + fade 0.8 → 0 over 20 frames (0.667s).
            tween(host, 20 / 30, t => {
                const s = 1 + (radius * 2 - 1) * t;
                ring.scale.set(s, 1, s);
                setMeshOpacity(ring, 0.8 * (1 - t));
            }, { onEnd: () => disposeMesh(ring) });

            const ps = new ParticleEffect('meteorImpact', host, {
                transform: {
                    position: new Vector3(position.x, position.y + 0.5, position.z),
                    rotation: new Vector3(-Math.PI / 2, 0, 0),
                },
                simulationSpace: SimulationSpace.WORLD,
                looping: true,
                duration: 1.433,
                maxParticles: 60,
                emission: { rateOverTime: 120 },
                shape: { shape: Shape.CONE, cone: { angle: 60, radius: 0.5, radiusThickness: 1, arc: 360 } },
                startLifetime: { min: 0.5, max: 1.333 },
                startSpeed: { min: 5.04, max: 12.6 },
                startSize: { min: fxSize(0.3), max: fxSize(0.8) },
                startColor: {
                    min: { r: 1, g: 0.2, b: 0 },
                    max: { r: 1, g: 0.5, b: 0 },
                },
                startOpacity: 1,
                opacityOverLifetime: { isActive: true, lifetimeCurve: { type: LifeTimeCurve.EASING, curveFunction: (t: number) => 1 - t } },
                gravity: 2.88,
                renderer: fxRenderer('additive'),
            }, { autoDispose: true });
            setTimeout(() => {
                try { ps.stop(); } catch { /* already disposed */ }
            }, 200);
        },
    });
}

// =============================================================================
// Frost Nova
// =============================================================================

/** Arena-wide expanding frost disc + rising ice particles. */
export function createFrostNovaVisual(host: SceneHost): void {
    const center = new Vector3(20, 0.1, 20);

    const ring = createDisc('frostRing', {
        radius: 0.5, tessellation: 32
    }, host);
    ring.position.copy(center);
    ring.rotation.x = Math.PI / 2;
    // Babylon disableLighting rendered emissive only → unlit basic material.
    const ringMat = new MeshBasicMaterial({
        color: new Color(0.3, 0.5, 0.8),
        transparent: true,
        opacity: 0.5,
        side: DoubleSide,
    });
    ringMat.name = 'frostRingMat';
    ring.material = ringMat;
    ring.userData.ownedMaterial = true;

    // Expand 1 → 80 (disc plane) + fade 0.5 → 0 over 30 frames (1s).
    tween(host, 30 / 30, t => {
        const s = 1 + 79 * t;
        ring.scale.set(s, s, 1);
        setMeshOpacity(ring, 0.5 * (1 - t));
    }, { onEnd: () => disposeMesh(ring) });

    const ps = new ParticleEffect('frostParticles', host, {
        transform: {
            position: center.clone(),
            rotation: new Vector3(-Math.PI / 2, 0, 0),
        },
        simulationSpace: SimulationSpace.WORLD,
        looping: true,
        duration: 2.8,
        maxParticles: 100,
        emission: { rateOverTime: 120 },
        shape: { shape: Shape.BOX, box: { scale: { x: 40, y: 0.5, z: 40 } } },
        startLifetime: { min: 0.833, max: 2.5 },
        startSpeed: { min: 0.51, max: 1.53 },
        startSize: { min: fxSize(0.1), max: fxSize(0.3) },
        startColor: {
            min: { r: 0.4, g: 0.6, b: 1 },
            max: { r: 0.7, g: 0.9, b: 1 },
        },
        startOpacity: 1,
        opacityOverLifetime: { isActive: true, lifetimeCurve: { type: LifeTimeCurve.EASING, curveFunction: (t: number) => 1 - t } },
        renderer: fxRenderer('additive'),
    }, { autoDispose: true });
    setTimeout(() => {
        try { ps.stop(); } catch { /* already disposed */ }
    }, 300);
}

// =============================================================================
// Smash
// =============================================================================

/** Expanding orange shockwave ring at `center`. */
export function spawnSmashShockwave(host: SceneHost, center: Vector3): void {
    const ring = createTorus('smashRing', {
        diameter: 2, thickness: 0.5, tessellation: 24,
    }, host);
    ring.position.set(center.x, center.y + 0.2, center.z);
    const mat = createEmissiveMaterial('smashMat', new Color(1.0, 0.65, 0.1), 0.9);
    mat.transparent = true;
    mat.opacity = 0.85;
    ring.material = mat;
    ring.userData.ownedMaterial = true;

    // Expand 1 → 12 (XZ) + fade 0.85 → 0 over 15 frames (0.5s).
    tween(host, 15 / 30, t => {
        const s = 1 + 11 * t;
        ring.scale.set(s, 1, s);
        setMeshOpacity(ring, 0.85 * (1 - t));
    }, { onEnd: () => disposeMesh(ring) });
}

// =============================================================================
// Multishot aura (green ring + sparks following the caster)
// =============================================================================

/**
 * The Multishot channel aura: a green torus + rising sparks following
 * `getCenter()` each frame. Returns a dispose handle (idempotent) that removes
 * the follow observer, fades the ring out, and tears down the particles —
 * exactly what the local onEnd used to do inline.
 */
export function spawnMultishotAura(host: SceneHost, getCenter: () => Vector3 | null): { dispose: () => void } {
    const start = getCenter() ?? new Vector3(0, 0, 0);
    const ring = createTorus('multishotAuraRing', {
        diameter: 2.4, thickness: 0.18, tessellation: 24,
    }, host);
    ring.position.set(start.x, start.y + 0.2, start.z);
    const mat = createEmissiveMaterial('multishotAuraMat', new Color(0.5, 1.0, 0.4), 0.9);
    mat.transparent = true;
    mat.opacity = 0.7;
    ring.material = mat;
    ring.userData.ownedMaterial = true;

    const ps = new ParticleEffect('multishotAuraPs', host, {
        transform: {
            position: start.clone(),
            rotation: new Vector3(-Math.PI / 2, 0, 0),
        },
        simulationSpace: SimulationSpace.WORLD,
        looping: true,
        duration: 1.1,
        maxParticles: 40,
        emission: { rateOverTime: 36 },
        shape: { shape: Shape.CONE, cone: { angle: 30, radius: 0.8, radiusThickness: 1, arc: 360 } },
        startLifetime: { min: 0.5, max: 1.0 },
        startSpeed: { min: 0.63, max: 1.512 },
        startSize: { min: fxSize(0.06), max: fxSize(0.16) },
        startColor: {
            min: { r: 0.5, g: 1.0, b: 0.4 },
            max: { r: 0.8, g: 1.0, b: 0.6 },
        },
        startOpacity: 1,
        opacityOverLifetime: { isActive: true, lifetimeCurve: { type: LifeTimeCurve.EASING, curveFunction: (t: number) => 1 - t } },
        gravity: 0.54,
        renderer: fxRenderer('additive'),
    });

    const followObs = host.onBeforeRender.add(() => {
        const p = getCenter();
        if (!p) return;
        ring.position.set(p.x, p.y + 0.2, p.z);
        ps.object.position.set(p.x, p.y, p.z);
    });

    let disposed = false;
    return {
        dispose: () => {
            if (disposed) return;
            disposed = true;
            host.onBeforeRender.remove(followObs);
            try { ps.stop(); } catch { /* ignore */ }
            if (!isMeshDisposed(ring)) {
                // Fade 0.7 → 0 over 12 frames (0.4s), then free mesh + owned material.
                tween(host, 12 / 30, t => {
                    setMeshOpacity(ring, 0.7 * (1 - t));
                }, { onEnd: () => disposeMesh(ring) });
            }
            setTimeout(() => { try { ps.dispose(); } catch { /* ignore */ } }, 700);
        },
    };
}

/**
 * Cosmetic-only volley arrow for the co-op Multishot channel: the same green
 * arrow look as the local volley but flying a fixed direction (no homing, no
 * damage). Leak-safe: material cached by a BOUNDED key, plain disposeMesh() leaves it.
 */
export function spawnCosmeticVolleyArrow(host: SceneHost, from: Vector3, dirX: number, dirZ: number): void {
    const arrow = createCylinder('coopVolleyArrow', {
        height: 0.6, diameter: 0.08, tessellation: 5,
    }, host);
    arrow.position.set(from.x, from.y + 1.0, from.z);
    // Emissive with black diffuse reads unlit (Babylon disableLighting parity).
    arrow.material = getCachedMaterial('coopVolleyArrowMat', m => {
        m.emissive = new Color(0.6, 1.0, 0.4);
        m.color = new Color(0, 0, 0);
    });
    arrow.rotation.y = headingToYaw(dirX, dirZ);
    arrow.rotation.x = Math.PI / 2; // lay the cylinder flat along its flight line

    const speed = 22;   // matches the local volley arrow
    const maxDist = 14; // a touch past the typical homing kill distance
    let traveled = 0;
    const observer = host.onBeforeRender.add(() => {
        const step = speed * host.deltaSeconds;
        traveled += step;
        arrow.position.x += dirX * step;
        arrow.position.z += dirZ * step;
        if (traveled >= maxDist) {
            disposeMesh(arrow); // cached/shared material — keep it
            host.onBeforeRender.remove(observer);
        }
    });
}

// =============================================================================
// Explosive Arrow (flight + blast)
// =============================================================================

/**
 * Flies the orange explosive arrow from `from` to the FIXED `targetPos` (the
 * local cast already locks the target position at spawn time, so the co-op
 * replay with the same two points is exact), then calls `onImpact` with the
 * impact position: damage + visual locally, visual-only on the replay side.
 */
export function spawnExplosiveArrowFlight(
    host: SceneHost,
    from: Vector3,
    targetPos: Vector3,
    onImpact: (impactPos: Vector3) => void,
): void {
    const arrow = createCylinder('expArrow', {
        height: 0.8, diameter: 0.12, tessellation: 5,
    }, host);
    arrow.position.set(from.x, from.y + 1.0, from.z);

    const mat = createEmissiveMaterial('expArrowMat', new Color(1.0, 0.55, 0.1), 0.9);
    mat.transparent = true;
    mat.opacity = 0.95;
    arrow.material = mat;
    arrow.userData.ownedMaterial = true;

    arrow.lookAt(targetPos);
    arrow.rotation.x += Math.PI / 2;

    const speed = 14;
    const toTarget = new Vector3();
    const observer = host.onBeforeRender.add(() => {
        if (isMeshDisposed(arrow)) {
            host.onBeforeRender.remove(observer);
            return;
        }
        const dt = host.deltaSeconds;
        toTarget.subVectors(targetPos, arrow.position);
        const dist = toTarget.length();
        if (dist < 0.5) {
            const impactPos = arrow.position.clone();
            disposeMesh(arrow);
            host.onBeforeRender.remove(observer);
            onImpact(impactPos);
            return;
        }
        arrow.position.addScaledVector(toTarget.normalize(), speed * dt);
    });
}

/** The explosive-arrow blast: expanding orange ring + ember burst at `position`. */
export function spawnExplosionVisual(host: SceneHost, position: Vector3, radius: number): void {
    const ring = createTorus('expRing', {
        diameter: 1.0, thickness: 0.4, tessellation: 20,
    }, host);
    ring.position.set(position.x, position.y, position.z);
    const mat = createEmissiveMaterial('expRingMat', new Color(1.0, 0.4, 0.0), 0.9);
    mat.transparent = true;
    mat.opacity = 0.85;
    ring.material = mat;
    ring.userData.ownedMaterial = true;

    const targetScale = radius * 2;
    // Expand 0.5 → targetScale (XZ) + fade 0.85 → 0 over 12 frames (0.4s).
    tween(host, 12 / 30, t => {
        const s = 0.5 + (targetScale - 0.5) * t;
        ring.scale.set(s, 1, s);
        setMeshOpacity(ring, 0.85 * (1 - t));
    }, { onEnd: () => disposeMesh(ring) });

    // Particle burst
    const ps = new ParticleEffect('expBurst', host, {
        transform: {
            position: new Vector3(position.x, position.y + 0.5, position.z),
            rotation: new Vector3(-Math.PI / 2, 0, 0),
        },
        simulationSpace: SimulationSpace.WORLD,
        looping: true,
        duration: 1.1,
        maxParticles: 40,
        emission: { rateOverTime: 90 },
        shape: { shape: Shape.CONE, cone: { angle: 60, radius: 0.3, radiusThickness: 1, arc: 360 } },
        startLifetime: { min: 0.333, max: 1.0 },
        startSpeed: { min: 5.04, max: 12.6 },
        startSize: { min: fxSize(0.2), max: fxSize(0.6) },
        startColor: {
            min: { r: 1, g: 0.3, b: 0 },
            max: { r: 1, g: 0.6, b: 0.1 },
        },
        startOpacity: 1,
        opacityOverLifetime: { isActive: true, lifetimeCurve: { type: LifeTimeCurve.EASING, curveFunction: (t: number) => 1 - t } },
        gravity: 2.16,
        renderer: fxRenderer('additive'),
    }, { autoDispose: true });
    setTimeout(() => {
        try { ps.stop(); } catch { /* already disposed */ }
    }, 150);
}
