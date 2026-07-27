/**
 * The one straight-flying enemy projectile.
 *
 * Both wizard tiers fire it (the blue mage's weak chip bolt and the red wizard's
 * heavier one), so the flight loop, the pooling, the hit test and — most
 * importantly — the disposal path exist exactly once.
 *
 * Leak contract (see CLAUDE.md "Transient-FX materials must never leak"): the
 * mesh comes from `ProjectilePool` keyed by `spec.key` and its material from
 * `getCachedMaterial` under the SAME key, so a run creates one material per bolt
 * VARIANT — never one per shot. `spec.key` must therefore be a module constant,
 * never anything derived from an instance id.
 *
 * Deliberately imports no Enemy: the owner is passed as an `isOwnerAlive`
 * predicate plus a source position, which keeps this free of the enemy class
 * graph (and of a HealerEnemy → EnemyBolt → Enemy import cycle).
 */

import { Color, Vector3 } from 'three';
import { acquireProjectile, releaseProjectile } from '../../engine/rendering/ProjectilePool';
import { getCachedMaterial } from '../../engine/rendering/MaterialCache';
import { createCylinder, createSphere, isMeshDisposed } from '../../engine/three/primitives';
import { headingToYaw } from '../../engine/three/math';
import type { SceneHost, UpdateToken } from '../../engine/three/SceneHost';
import type { HeroProvider } from './nearestTarget';

/** One bolt VARIANT. Module-level + frozen at every call site: `key` is a
 *  material-cache and mesh-pool key and must be bounded. */
export interface EnemyBoltSpec {
    key: string;
    color: Color;
    diameter: number;
    /** World units per second. */
    speed: number;
    /** Distance to the hero that counts as a hit. */
    hitRadius: number;
    /** Flight is abandoned after this long, so a bolt aimed at a hero who then
     *  outran it never lives forever. */
    maxFlightS: number;
    /**
     * How the bolt flies, which IS the counterplay:
     *
     * `'straight'` locks a velocity at launch and never re-aims, so it is beaten
     * by moving after the muzzle flash (the artillery lance).
     *
     * `'homing'` re-aims at the hero every frame and connects, exactly like a
     * champion's own basic attack — there is nothing to dodge, so the answer is
     * to out-heal or kill the caster (the mage bolt). It only actually lands if
     * it out-runs the hero, so `speed` must clear a fully-levelled move speed;
     * `assertHomingOutrunsHero` in the tests pins that.
     */
    flight: 'straight' | 'homing';
    /** Orb = a cast projectile; lance = a long shaft aimed along its travel. */
    shape: 'orb' | 'lance';
    /** Lance only: length along the travel axis. */
    length?: number;
}

/**
 * Fastest a hero can actually travel: base 7 u/s × the level-100 move-speed
 * bonus (`applyLevelBonuses` sets moveSpeedMultiplier = 1 + 2 × bonusFraction,
 * i.e. ×2 at cap) × ascension and run-perk multipliers on top.
 *
 * A `'homing'` bolt that does not clear this cannot close on a running hero, so
 * "always hits" would quietly become "hits people who stand still". Asserted in
 * tests/enemyBolt.spec.ts rather than left to a comment.
 */
export const HERO_MAX_MOVE_SPEED = 20;

/**
 * Every enemy projectile variant in the game, in one place.
 *
 * This registry IS the bounded-key guarantee: `spec.key` is both a mesh-pool and
 * a material-cache key, and the rule that they must be finite (CLAUDE.md) is
 * enforced by there being a closed record of them rather than by each call site
 * remembering to hoist a module constant.
 */
export type EnemyBoltVariant = 'mage' | 'redWizard' | 'lance';

export const ENEMY_BOLTS: Record<EnemyBoltVariant, EnemyBoltSpec> = {
    /** The blue mage's chip bolt: small, guaranteed, out-heal-able. */
    mage: Object.freeze({
        key: 'mage-bolt',
        color: new Color(0.45, 0.95, 0.65),
        diameter: 0.34,
        speed: 26,
        hitRadius: 0.6,
        maxFlightS: 3,
        flight: 'homing',
        shape: 'orb',
    }),
    /** The red wizard's: the same guaranteed hit, hitting harder and faster. */
    redWizard: Object.freeze({
        key: 'red-wizard-bolt',
        color: new Color(0.95, 0.18, 0.12),
        diameter: 0.4,
        speed: 28,
        hitRadius: 0.6,
        maxFlightS: 3,
        flight: 'homing',
        shape: 'orb',
    }),
    /** The artillery carriage's lance: a shaft loosed down a fixed line. The one
     *  enemy projectile you beat with footwork rather than with healing. */
    lance: Object.freeze({
        key: 'carriage-lance',
        color: new Color(1.0, 0.82, 0.35),
        diameter: 0.22,
        length: 1.5,
        speed: 18,
        hitRadius: 0.55,
        maxFlightS: 2.5,
        flight: 'straight',
        shape: 'lance',
    }),
};

export interface EnemyBoltOptions {
    spec: EnemyBoltSpec;
    /** Muzzle position. Copied, not retained. */
    origin: Vector3;
    /** Where the hero was AT LAUNCH. A `'straight'` bolt flies at this point and
     *  never re-aims, which is what makes it dodgeable; a `'homing'` one only
     *  uses it to leave the muzzle pointing the right way. */
    aimAt: { x: number; z: number };
    /** Who it can hit. Held by reference; the flight loop re-checks isAlive(). */
    target: HeroProvider;
    /** False once the shooter is dead/disposed — cancels the bolt in flight. */
    isOwnerAlive: () => boolean;
    /** Damage source position for the hero's hit reaction (knockback direction). */
    sourcePosition: Vector3;
    /** Impact handler. Single-target damage is the caller's job so a subclass can
     *  splash instead (RedSuperWizard). `at` is the impact point. */
    onHit: (target: HeroProvider, at: Vector3) => void;
}

export function fireEnemyBolt(scene: SceneHost, opts: EnemyBoltOptions): void {
    const { spec, origin, aimAt, target, isOwnerAlive, onHit } = opts;

    let dirX = aimAt.x - origin.x;
    let dirZ = aimAt.z - origin.z;
    const len = Math.hypot(dirX, dirZ) || 1;
    dirX /= len;
    dirZ /= len;

    const bolt = acquireProjectile(spec.key, () => {
        const m = spec.shape === 'lance'
            ? createCylinder(spec.key, {
                height: spec.length ?? 1.2,
                diameterTop: 0,
                diameterBottom: spec.diameter,
                tessellation: 6,
            }, scene)
            : createSphere(spec.key, { diameter: spec.diameter, segments: 6 }, scene);
        m.material = getCachedMaterial(spec.key, mat => {
            mat.emissive = spec.color.clone();
            mat.color = spec.color.clone();
        });
        return m;
    });
    bolt.position.copy(origin);
    bolt.visible = true;

    // A lance is a shaft, so it has to point where it is going. The cylinder's
    // own axis is +Y; YXZ order applies the yaw first and then tips that axis
    // into the ground plane along it (same trick as the dash telegraph).
    const aimLance = (ax: number, az: number): void => {
        bolt.rotation.order = 'YXZ';
        bolt.rotation.y = headingToYaw(ax, az);
        bolt.rotation.x = Math.PI / 2;
    };
    if (spec.shape === 'lance') aimLance(dirX, dirZ);

    const startTime = performance.now();
    const timeoutMs = spec.maxFlightS * 1000;
    const hitR2 = spec.hitRadius * spec.hitRadius;

    // Hoisted above the observer: declared INSIDE the callback it would allocate
    // a fresh closure per bolt per frame. `observer` is assigned right after, and
    // cleanup only ever runs from inside the callback (so it is always set).
    let observer: UpdateToken;
    const cleanup = (): void => {
        scene.onBeforeRender.remove(observer);
        releaseProjectile(spec.key, bolt);
    };

    observer = scene.onBeforeRender.add(host => {
        if (isMeshDisposed(bolt) || !isOwnerAlive()
            || target.isAlive?.() === false
            || performance.now() - startTime > timeoutMs) {
            cleanup();
            return;
        }

        const dt = host.deltaSeconds;
        const hp = target.getPosition();

        if (spec.flight === 'homing') {
            // Re-aim every frame and step toward the hero, exactly like a
            // champion's basic attack: the bolt cannot be out-manoeuvred, only
            // out-run — and its speed is set so it cannot be out-run either.
            let hx = hp.x - bolt.position.x;
            let hz = hp.z - bolt.position.z;
            const d = Math.hypot(hx, hz);
            if (d <= spec.hitRadius) {
                onHit(target, bolt.position);
                cleanup();
                return;
            }
            hx /= d;
            hz /= d;
            const step = Math.min(d, spec.speed * dt);
            bolt.position.x += hx * step;
            bolt.position.z += hz * step;
            if (spec.shape === 'lance') aimLance(hx, hz);
            return;
        }

        bolt.position.x += dirX * spec.speed * dt;
        bolt.position.z += dirZ * spec.speed * dt;

        // Hit test against the hero's CURRENT position — the bolt does not steer
        // toward it, but running into one still counts.
        const sx = hp.x - bolt.position.x;
        const sz = hp.z - bolt.position.z;
        if (sx * sx + sz * sz < hitR2) {
            onHit(target, bolt.position);
            cleanup();
        }
    });
}
