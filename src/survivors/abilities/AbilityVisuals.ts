import { Vector3, Color3, Color4, MeshBuilder, ParticleSystem, Animation, Scene, Mesh, StandardMaterial } from '@babylonjs/core';
import { createEmissiveMaterial } from '../../engine/rendering/LowPolyMaterial';
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
 * 'hurricaneFunnelMat', 'coopVolleyArrowMat'); meshes that own a unique animated
 * material free it with dispose(false, true); cached/shared materials survive a
 * plain dispose() and are freed by clearMaterialCache() on run teardown.
 */

// =============================================================================
// WHIRLWIND RING POOL — 8 pre-allocated torus meshes reused across ring spawns.
// Material is cached once (shared); alpha fade is done via scale-only so the
// shared material isn't mutated per-instance.
// =============================================================================

const WHIRLWIND_POOL_SIZE = 8;
const whirlwindPool: Mesh[] = [];
let whirlwindPoolInit = false;

function acquireWhirlwindRing(scene: Scene): Mesh {
    // The pool is module-level so it survives state exits, but Game.cleanupScene()
    // disposes every scene mesh between states. On the next run the pool would
    // hold disposed (or other-scene) meshes — re-enabling those renders nothing.
    // Detect stale entries and rebuild the pool from scratch.
    if (whirlwindPoolInit && whirlwindPool.some(r => r.isDisposed() || r.getScene() !== scene)) {
        for (const r of whirlwindPool) {
            if (!r.isDisposed()) r.dispose(); // cached/shared material — keep it
        }
        whirlwindPool.length = 0;
        whirlwindPoolInit = false;
    }
    if (!whirlwindPoolInit) {
        for (let i = 0; i < WHIRLWIND_POOL_SIZE; i++) {
            const t = MeshBuilder.CreateTorus(
                `whirlwindRing${i}`,
                { diameter: 1.0, thickness: 0.08, tessellation: 16 },
                scene,
            ) as Mesh;
            t.setEnabled(false);
            t.material = getCachedMaterial(scene, 'whirlwindRingMat', m => {
                m.emissiveColor = new Color3(0.5, 0.8, 1.0);
                m.diffuseColor = new Color3(0, 0, 0);
                m.alpha = 0.85;
            });
            whirlwindPool.push(t);
        }
        whirlwindPoolInit = true;
    }
    for (const r of whirlwindPool) {
        if (!r.isEnabled()) {
            r.setEnabled(true);
            return r;
        }
    }
    // Fallback: pool exhausted — allocate fresh, will be disposed on completion.
    return MeshBuilder.CreateTorus(
        `whirlwindRingX${performance.now()}`,
        { diameter: 1.0, thickness: 0.08, tessellation: 16 },
        scene,
    ) as Mesh;
}

/** One expanding whirlwind ground ring at `center` (pooled; scale-only fade). */
export function spawnWhirlwindRing(scene: Scene, center: Vector3, radius: number): void {
    const ring = acquireWhirlwindRing(scene);
    const isPooled = whirlwindPool.indexOf(ring) >= 0;

    // Diameter stored as scaling; pool torus has diameter=1.0, so scale by target.
    const targetScale = radius * 0.6;
    ring.position.set(center.x, center.y + 0.3, center.z);
    // Start small, expand to targetScale over the duration (scale-only fade).
    ring.scaling.set(targetScale * 0.3, 1, targetScale * 0.3);

    const duration = 0.4; // seconds (~12 frames at 30 fps, matching original)
    let elapsed = 0;
    const obs = scene.onBeforeRenderObservable.add(() => {
        const dt = scene.getEngine().getDeltaTime() / 1000;
        elapsed += dt;
        const t = Math.min(elapsed / duration, 1);
        const s = targetScale * (0.3 + 0.7 * t);
        ring.scaling.set(s, 1 - t, s); // shrink vertically to "vanish"
        if (t >= 1) {
            scene.onBeforeRenderObservable.remove(obs);
            if (isPooled) {
                ring.setEnabled(false);
                ring.scaling.setAll(1);
            } else {
                ring.dispose();
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
    scene: Scene,
    getCenter: () => Vector3 | null,
    durationS: number,
    radius: number,
): { dispose: () => void } {
    const start = getCenter() ?? new Vector3(0, 0, 0);

    // ── Storm updraft ───────────────────────────────────────────────────
    // A tall, fast column of pale storm-grey debris spiralling upward — the
    // airborne body of the hurricane. Emitter is a Vector3 we move each frame
    // so the PS tracks the hero.
    const vortexEmitter = start.clone();
    const vortexPs = new ParticleSystem('whirlwindVortex', 240, scene);
    vortexPs.emitter = vortexEmitter;
    vortexPs.minEmitBox = new Vector3(-radius * 0.5, 0, -radius * 0.5);
    vortexPs.maxEmitBox = new Vector3(radius * 0.5, 0.3, radius * 0.5);
    vortexPs.color1 = new Color4(0.85, 0.90, 0.97, 0.9); // pale storm white
    vortexPs.color2 = new Color4(0.55, 0.62, 0.72, 0.8); // grey-blue
    vortexPs.colorDead = new Color4(0.30, 0.34, 0.40, 0);
    vortexPs.minSize = 0.08;
    vortexPs.maxSize = 0.30;
    vortexPs.minLifeTime = 0.6;
    vortexPs.maxLifeTime = 1.2;
    vortexPs.emitRate = 420;
    vortexPs.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    // Wide tangential spread + strong updraft so the swarm reads as a tall,
    // churning funnel rather than a flat ground swirl.
    vortexPs.direction1 = new Vector3(-5, 3.0, -5);
    vortexPs.direction2 = new Vector3(5, 6.0, 5);
    vortexPs.minEmitPower = 3;
    vortexPs.maxEmitPower = 6;
    vortexPs.gravity = new Vector3(0, 3.0, 0); // strong updraft → tall column
    vortexPs.start();

    const emitterObs = scene.onBeforeRenderObservable.add(() => {
        const pos = getCenter();
        if (!pos) return;
        vortexEmitter.copyFrom(pos);
        vortexEmitter.y += 0.2;
    });

    // ── Funnel cloud ────────────────────────────────────────────────────
    // A vertical stack of rings that flares wide at the top and narrows at the
    // base, spinning fast and swaying on a helix so it reads as a hurricane
    // funnel from the top-down camera. Dedicated meshes (NOT the pooled ground
    // rings) sharing ONE cached material; the meshes are disposed in dispose()
    // and the shared material is preserved (clearMaterialCache frees it on teardown).
    const FUNNEL_RINGS = 7;
    const FUNNEL_HEIGHT = 4.5;
    const funnelLife = durationS;
    const funnelMat = getCachedMaterial(scene, 'hurricaneFunnelMat', m => {
        m.emissiveColor = new Color3(0.7, 0.85, 1.0); // pale storm-blue
        m.diffuseColor = new Color3(0, 0, 0);
        m.alpha = 0.5;
        m.backFaceCulling = false;
    });
    const funnelRings: Mesh[] = [];
    for (let i = 0; i < FUNNEL_RINGS; i++) {
        const ring = MeshBuilder.CreateTorus(
            `hurricaneRing${i}`,
            { diameter: 1.0, thickness: 0.06, tessellation: 20 },
            scene,
        ) as Mesh;
        ring.material = funnelMat;
        ring.isPickable = false;
        ring.visibility = 0;
        funnelRings.push(ring);
    }

    let funnelT = 0;
    const funnelObs = scene.onBeforeRenderObservable.add(() => {
        const pos = getCenter();
        if (!pos) return;
        const dt = scene.getEngine().getDeltaTime() / 1000;
        funnelT += dt;
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
            ring.scaling.set(ringScale, 1, ringScale);
            ring.rotation.y = spin + i * 0.4;
            ring.rotation.x = 0.12 * Math.sin(funnelT * 4 + i);
            ring.rotation.z = 0.12 * Math.cos(funnelT * 4 + i);
            // Wispier toward the top; fade with the global envelope. visibility
            // is per-mesh so the shared cached material is never mutated.
            ring.visibility = envelope * (0.7 - 0.4 * f);
        }
    });

    let disposed = false;
    return {
        dispose: () => {
            if (disposed) return;
            disposed = true;
            scene.onBeforeRenderObservable.remove(emitterObs);
            scene.onBeforeRenderObservable.remove(funnelObs);
            // Dispose the funnel meshes; the cached material is shared and
            // preserved (freed by clearMaterialCache on run teardown).
            for (const r of funnelRings) {
                try { r.dispose(); } catch { /* ignore */ }
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
export function createMeteorVisual(scene: Scene, position: Vector3, radius: number): void {
    const fireball = MeshBuilder.CreateIcoSphere('meteorBall', {
        radius: 0.8, subdivisions: 1
    }, scene);
    fireball.position = new Vector3(position.x, position.y + 15, position.z);
    fireball.material = createEmissiveMaterial('meteorMat', new Color3(1, 0.3, 0), 0.9, scene);

    const descentAnim = new Animation('meteorDescent', 'position.y', 30,
        Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CONSTANT);
    descentAnim.setKeys([
        { frame: 0, value: position.y + 15 },
        { frame: 12, value: position.y + 0.5 }
    ]);
    fireball.animations = [descentAnim];

    scene.beginAnimation(fireball, 0, 12, false, 1, () => {
        fireball.dispose(false, true);

        const ring = MeshBuilder.CreateTorus('meteorRing', {
            diameter: 0.5, thickness: 0.3, tessellation: 16
        }, scene);
        ring.position = new Vector3(position.x, position.y + 0.1, position.z);
        ring.material = createEmissiveMaterial('meteorRingMat', new Color3(1, 0.5, 0), 0.8, scene);
        (ring.material as StandardMaterial).alpha = 0.8;

        const expandAnim = new Animation('ringExpand', 'scaling', 30,
            Animation.ANIMATIONTYPE_VECTOR3, Animation.ANIMATIONLOOPMODE_CONSTANT);
        expandAnim.setKeys([
            { frame: 0, value: new Vector3(1, 1, 1) },
            { frame: 20, value: new Vector3(radius * 2, 1, radius * 2) }
        ]);
        const fadeAnim = new Animation('ringFade', 'material.alpha', 30,
            Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CONSTANT);
        fadeAnim.setKeys([
            { frame: 0, value: 0.8 },
            { frame: 20, value: 0 }
        ]);
        ring.animations = [expandAnim, fadeAnim];
        scene.beginAnimation(ring, 0, 20, false, 1, () => ring.dispose(false, true));

        const ps = new ParticleSystem('meteorImpact', 60, scene);
        ps.emitter = new Vector3(position.x, position.y + 0.5, position.z);
        ps.minEmitBox = new Vector3(-0.5, 0, -0.5);
        ps.maxEmitBox = new Vector3(0.5, 0, 0.5);
        ps.color1 = new Color4(1, 0.5, 0, 1);
        ps.color2 = new Color4(1, 0.2, 0, 1);
        ps.colorDead = new Color4(0.3, 0, 0, 0);
        ps.minSize = 0.3;
        ps.maxSize = 0.8;
        ps.minLifeTime = 0.3;
        ps.maxLifeTime = 0.8;
        ps.emitRate = 200;
        ps.blendMode = ParticleSystem.BLENDMODE_ONEONE;
        ps.direction1 = new Vector3(-2, 2, -2);
        ps.direction2 = new Vector3(2, 4, 2);
        ps.minEmitPower = 2;
        ps.maxEmitPower = 5;
        ps.gravity = new Vector3(0, -8, 0);
        ps.start();
        setTimeout(() => {
            try { ps.stop(); } catch { /* already disposed */ }
            setTimeout(() => {
                try { ps.dispose(); } catch { /* already disposed */ }
            }, 800);
        }, 200);
    });
}

// =============================================================================
// Frost Nova
// =============================================================================

/** Arena-wide expanding frost disc + rising ice particles. */
export function createFrostNovaVisual(scene: Scene): void {
    const center = new Vector3(20, 0.1, 20);

    const ring = MeshBuilder.CreateDisc('frostRing', {
        radius: 0.5, tessellation: 32
    }, scene);
    ring.position = center;
    ring.rotation.x = Math.PI / 2;
    const ringMat = new StandardMaterial('frostRingMat', scene);
    ringMat.diffuseColor = new Color3(0.5, 0.8, 1);
    ringMat.emissiveColor = new Color3(0.3, 0.5, 0.8);
    ringMat.alpha = 0.5;
    ringMat.disableLighting = true;
    ring.material = ringMat;

    const expandAnim = new Animation('frostExpand', 'scaling', 30,
        Animation.ANIMATIONTYPE_VECTOR3, Animation.ANIMATIONLOOPMODE_CONSTANT);
    expandAnim.setKeys([
        { frame: 0, value: new Vector3(1, 1, 1) },
        { frame: 30, value: new Vector3(80, 80, 1) }
    ]);
    const fadeAnim = new Animation('frostFade', 'material.alpha', 30,
        Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CONSTANT);
    fadeAnim.setKeys([
        { frame: 0, value: 0.5 },
        { frame: 30, value: 0 }
    ]);
    ring.animations = [expandAnim, fadeAnim];
    scene.beginAnimation(ring, 0, 30, false, 1, () => ring.dispose(false, true));

    const ps = new ParticleSystem('frostParticles', 100, scene);
    ps.emitter = center;
    ps.minEmitBox = new Vector3(-20, 0, -20);
    ps.maxEmitBox = new Vector3(20, 0.5, 20);
    ps.color1 = new Color4(0.7, 0.9, 1, 1);
    ps.color2 = new Color4(0.4, 0.6, 1, 1);
    ps.colorDead = new Color4(0.2, 0.3, 0.5, 0);
    ps.minSize = 0.1;
    ps.maxSize = 0.3;
    ps.minLifeTime = 0.5;
    ps.maxLifeTime = 1.5;
    ps.emitRate = 200;
    ps.blendMode = ParticleSystem.BLENDMODE_ONEONE;
    ps.direction1 = new Vector3(-0.5, 1, -0.5);
    ps.direction2 = new Vector3(0.5, 2, 0.5);
    ps.minEmitPower = 0.5;
    ps.maxEmitPower = 1.5;
    ps.start();
    setTimeout(() => {
        try { ps.stop(); } catch { /* already disposed */ }
        setTimeout(() => {
            try { ps.dispose(); } catch { /* already disposed */ }
        }, 1500);
    }, 300);
}

// =============================================================================
// Smash
// =============================================================================

/** Expanding orange shockwave ring at `center`. */
export function spawnSmashShockwave(scene: Scene, center: Vector3): void {
    const ring = MeshBuilder.CreateTorus('smashRing', {
        diameter: 2, thickness: 0.5, tessellation: 24,
    }, scene);
    ring.position = new Vector3(center.x, center.y + 0.2, center.z);
    const mat = createEmissiveMaterial('smashMat', new Color3(1.0, 0.65, 0.1), 0.9, scene);
    (mat as StandardMaterial).alpha = 0.85;
    ring.material = mat;

    const expandAnim = new Animation('smashExpand', 'scaling', 30,
        Animation.ANIMATIONTYPE_VECTOR3, Animation.ANIMATIONLOOPMODE_CONSTANT);
    expandAnim.setKeys([
        { frame: 0,  value: new Vector3(1, 1, 1) },
        { frame: 15, value: new Vector3(12, 1, 12) },
    ]);
    const fadeAnim = new Animation('smashFade', 'material.alpha', 30,
        Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CONSTANT);
    fadeAnim.setKeys([
        { frame: 0,  value: 0.85 },
        { frame: 15, value: 0.0 },
    ]);
    ring.animations = [expandAnim, fadeAnim];
    scene.beginAnimation(ring, 0, 15, false, 1, () => ring.dispose(false, true));
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
export function spawnMultishotAura(scene: Scene, getCenter: () => Vector3 | null): { dispose: () => void } {
    const start = getCenter() ?? new Vector3(0, 0, 0);
    const ring = MeshBuilder.CreateTorus('multishotAuraRing', {
        diameter: 2.4, thickness: 0.18, tessellation: 24,
    }, scene);
    ring.position.set(start.x, start.y + 0.2, start.z);
    const mat = createEmissiveMaterial('multishotAuraMat', new Color3(0.5, 1.0, 0.4), 0.9, scene);
    (mat as StandardMaterial).alpha = 0.7;
    ring.material = mat;

    const auraEmitter = start.clone();
    const followObs = scene.onBeforeRenderObservable.add(() => {
        const p = getCenter();
        if (!p) return;
        ring.position.set(p.x, p.y + 0.2, p.z);
        auraEmitter.copyFrom(p);
    });

    const ps = new ParticleSystem('multishotAuraPs', 40, scene);
    ps.emitter = auraEmitter;
    ps.minEmitBox = new Vector3(-0.8, 0, -0.8);
    ps.maxEmitBox = new Vector3(0.8, 0.1, 0.8);
    ps.color1 = new Color4(0.5, 1.0, 0.4, 1);
    ps.color2 = new Color4(0.8, 1.0, 0.6, 1);
    ps.colorDead = new Color4(0.2, 0.4, 0.1, 0);
    ps.minSize = 0.06;
    ps.maxSize = 0.16;
    ps.minLifeTime = 0.3;
    ps.maxLifeTime = 0.6;
    ps.emitRate = 60;
    ps.blendMode = ParticleSystem.BLENDMODE_ONEONE;
    ps.direction1 = new Vector3(-0.5, 1.5, -0.5);
    ps.direction2 = new Vector3(0.5, 2.5, 0.5);
    ps.minEmitPower = 0.5;
    ps.maxEmitPower = 1.2;
    ps.gravity = new Vector3(0, -1.5, 0);
    ps.start();

    let disposed = false;
    return {
        dispose: () => {
            if (disposed) return;
            disposed = true;
            scene.onBeforeRenderObservable.remove(followObs);
            try { ps.stop(); } catch { /* ignore */ }
            if (!ring.isDisposed()) {
                const fade = new Animation('multishotAuraFade', 'material.alpha', 30,
                    Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CONSTANT);
                fade.setKeys([{ frame: 0, value: 0.7 }, { frame: 12, value: 0 }]);
                ring.animations = [fade];
                scene.beginAnimation(ring, 0, 12, false, 1, () => ring.dispose(false, true));
            }
            setTimeout(() => { try { ps.dispose(); } catch { /* ignore */ } }, 700);
        },
    };
}

/**
 * Cosmetic-only volley arrow for the co-op Multishot channel: the same green
 * arrow look as the local volley but flying a fixed direction (no homing, no
 * damage). Leak-safe: material cached by a BOUNDED key, plain dispose() leaves it.
 */
export function spawnCosmeticVolleyArrow(scene: Scene, from: Vector3, dirX: number, dirZ: number): void {
    const arrow = MeshBuilder.CreateCylinder('coopVolleyArrow', {
        height: 0.6, diameter: 0.08, tessellation: 5,
    }, scene);
    arrow.position.set(from.x, from.y + 1.0, from.z);
    arrow.material = getCachedMaterial(scene, 'coopVolleyArrowMat', m => {
        m.emissiveColor = new Color3(0.6, 1.0, 0.4);
        m.diffuseColor = new Color3(0, 0, 0);
        m.disableLighting = true;
    });
    arrow.rotation.y = Math.atan2(dirX, dirZ);
    arrow.rotation.x = Math.PI / 2; // lay the cylinder flat along its flight line

    const speed = 22;   // matches the local volley arrow
    const maxDist = 14; // a touch past the typical homing kill distance
    let traveled = 0;
    const observer = scene.onBeforeRenderObservable.add(() => {
        const dt = scene.getEngine().getDeltaTime() / 1000;
        const step = speed * dt;
        traveled += step;
        arrow.position.x += dirX * step;
        arrow.position.z += dirZ * step;
        if (traveled >= maxDist) {
            arrow.dispose(); // cached/shared material — keep it
            scene.onBeforeRenderObservable.remove(observer);
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
    scene: Scene,
    from: Vector3,
    targetPos: Vector3,
    onImpact: (impactPos: Vector3) => void,
): void {
    const arrow = MeshBuilder.CreateCylinder('expArrow', {
        height: 0.8, diameter: 0.12, tessellation: 5,
    }, scene);
    arrow.position = new Vector3(from.x, from.y + 1.0, from.z);

    const mat = createEmissiveMaterial('expArrowMat', new Color3(1.0, 0.55, 0.1), 0.9, scene);
    (mat as StandardMaterial).alpha = 0.95;
    arrow.material = mat;

    arrow.lookAt(targetPos);
    arrow.rotation.x += Math.PI / 2;

    const speed = 14;
    let observer: any = null;
    observer = scene.onBeforeRenderObservable.add(() => {
        if (arrow.isDisposed()) {
            scene.onBeforeRenderObservable.remove(observer);
            return;
        }
        const dt = scene.getEngine().getDeltaTime() / 1000;
        const toTarget = targetPos.subtract(arrow.position);
        const dist = toTarget.length();
        if (dist < 0.5) {
            const impactPos = arrow.position.clone();
            arrow.dispose(false, true);
            scene.onBeforeRenderObservable.remove(observer);
            onImpact(impactPos);
            return;
        }
        arrow.position.addInPlace(toTarget.normalize().scale(speed * dt));
    });
}

/** The explosive-arrow blast: expanding orange ring + ember burst at `position`. */
export function spawnExplosionVisual(scene: Scene, position: Vector3, radius: number): void {
    const ring = MeshBuilder.CreateTorus('expRing', {
        diameter: 1.0, thickness: 0.4, tessellation: 20,
    }, scene);
    ring.position = new Vector3(position.x, position.y, position.z);
    const mat = createEmissiveMaterial('expRingMat', new Color3(1.0, 0.4, 0.0), 0.9, scene);
    (mat as StandardMaterial).alpha = 0.85;
    ring.material = mat;

    const targetScale = radius * 2;
    const expandAnim = new Animation('expExpand', 'scaling', 30,
        Animation.ANIMATIONTYPE_VECTOR3, Animation.ANIMATIONLOOPMODE_CONSTANT);
    expandAnim.setKeys([
        { frame: 0,  value: new Vector3(0.5, 1, 0.5) },
        { frame: 12, value: new Vector3(targetScale, 1, targetScale) },
    ]);
    const fadeAnim = new Animation('expFade', 'material.alpha', 30,
        Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CONSTANT);
    fadeAnim.setKeys([
        { frame: 0,  value: 0.85 },
        { frame: 12, value: 0.0 },
    ]);
    ring.animations = [expandAnim, fadeAnim];
    scene.beginAnimation(ring, 0, 12, false, 1, () => ring.dispose(false, true));

    // Particle burst
    const ps = new ParticleSystem('expBurst', 40, scene);
    ps.emitter = new Vector3(position.x, position.y + 0.5, position.z);
    ps.minEmitBox = new Vector3(-0.3, 0, -0.3);
    ps.maxEmitBox = new Vector3(0.3, 0, 0.3);
    ps.color1 = new Color4(1, 0.6, 0.1, 1);
    ps.color2 = new Color4(1, 0.3, 0, 1);
    ps.colorDead = new Color4(0.4, 0.1, 0, 0);
    ps.minSize = 0.2;
    ps.maxSize = 0.6;
    ps.minLifeTime = 0.2;
    ps.maxLifeTime = 0.6;
    ps.emitRate = 150;
    ps.blendMode = ParticleSystem.BLENDMODE_ONEONE;
    ps.direction1 = new Vector3(-2, 2, -2);
    ps.direction2 = new Vector3(2, 4, 2);
    ps.minEmitPower = 2;
    ps.maxEmitPower = 5;
    ps.gravity = new Vector3(0, -6, 0);
    ps.start();
    setTimeout(() => {
        try { ps.stop(); } catch { /* already disposed */ }
        setTimeout(() => {
            try { ps.dispose(); } catch { /* already disposed */ }
        }, 600);
    }, 150);
}
