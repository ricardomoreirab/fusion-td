import { BufferGeometry, Color, DoubleSide, Float32BufferAttribute, Group, Mesh, MeshPhongMaterial, type Object3D, Vector3 } from 'three';
import type { ParticleSystemConfig } from '@newkrok/three-particles';
import type { SceneHost } from '../../engine/three/SceneHost';
import { createBox, disposeMesh, isMeshDisposed } from '../../engine/three/primitives';
import { createLowPolyMaterial } from '../../engine/rendering/LowPolyMaterial';
import { headingToYaw } from '../../engine/three/math';
import { Enemy } from '../enemies/Enemy';
import { StatusEffect } from '../GameTypes';
import { getCachedMaterial } from '../../engine/rendering/MaterialCache';
import { buildArrowMesh } from './ArrowMesh';
import { ParticleEffect } from '../../engine/three/particles/ParticleEffect';
import {
    elementFlashConfig,
    elementImpactConfig,
    elementNovaConfig,
    elementProjectileHeadConfig,
    elementProjectileTrailConfig,
    fireSmokePuffConfig,
} from '../fx/ElementParticles';

export type PowerElement = 'fire' | 'ice' | 'arcane' | 'physical' | 'storm';
export type ChampionType = 'barbarian' | 'ranger' | 'mage';

export interface PowerRuntimeState {
    level: number;
    cooldownRemaining: number;
    /** Optional persistent data for powers like Whirling Blades */
    data?: Record<string, unknown>;
}

export interface PowerContext {
    scene: SceneHost;
    heroPosition: Vector3;
    enemies: Enemy[];
    /** Combined damage multiplier from run perks + shop upgrades */
    damageMultiplier: number;
    /** Element of the casting power — colors the damage numbers it produces. */
    element: PowerElement;
}

/** Called on each basic-attack hit for passive enchantment powers. */
export interface EnchantmentHitContext {
    scene: SceneHost;
    heroPosition: Vector3;
    enemies: Enemy[];
    /** Base damage of the basic attack (before multipliers). */
    baseDamage: number;
    /** Element of the active enchantment — colors its proc damage numbers. */
    element: PowerElement;
}

export interface PowerDefinition {
    id: string;
    name: string;
    element: PowerElement;
    /** Emoji or fallback letter for HUD display */
    icon: string;
    baseCooldown: number;
    baseDamage: number;
    baseRange: number;
    maxLevel: number;
    /**
     * 'autocast' — fires on cooldown via PowerSlotManager (Ranger/Mage powers).
     * 'passive'  — no cast loop; takes effect via onHit() on basic-attack contact.
     */
    mode: 'autocast' | 'passive';
    /** Progression tier. Absent ⇒ treated as 'base'. */
    tier?: 'base' | 'fusion' | 'ultimate';
    /** Owning class — set on fusion/ultimate defs (base ids encode it as `<class>_…`). */
    championType?: ChampionType;
    /** Parent def ids for fusion/ultimate defs. */
    parents?: [string, string];
    /** All constituent elements (fusion: 2; ultimate: representative set). */
    elements?: PowerElement[];
    /** Optional cleanup hook for persistent slot data (meshes). Called on remove/fuse/dispose. */
    dispose?: (state: PowerRuntimeState) => void;
    /** Optional hook called once when the power is added to a slot */
    init?: (state: PowerRuntimeState, ctx: PowerContext) => void;
    /** Required for autocast; omitted for passive powers. */
    cast?: (state: PowerRuntimeState, ctx: PowerContext) => void;
    /**
     * Persistent per-frame update, called EVERY frame regardless of cooldown or
     * whether any enemy is in range, and never triggers the hero attack animation.
     * Used by always-on effects like Whirling Blades' orbiting blades. `dt` is the
     * real frame delta in seconds.
     */
    tick?: (state: PowerRuntimeState, ctx: PowerContext, dt: number) => void;
    /** Required for passive enchantments; called on each basic-attack hit. */
    onHit?: (enemy: Enemy, level: number, ctx: EnchantmentHitContext) => void;
    /** For passive powers that add range to the melee swing (Heavy Strike). */
    rangeBonus?: (level: number) => number;
    cooldownFor: (state: PowerRuntimeState) => number;
    damageFor: (state: PowerRuntimeState) => number;
    /**
     * Human-readable per-level effect summary used by PowerChoiceOverlay.
     * Required for passive enchantments (where damage/cooldown read as 0 and
     * would be meaningless to display). Optional for autocast spells.
     */
    description?: (level: number) => string;
}

// =============================================================================
// VISUAL HELPERS - all power FX run on @newkrok/three-particles via
// ParticleEffect. No hand-animated mesh sprites remain in this file; the only
// meshes left are gameplay-readable bodies (arrows, shurikens, lightning bolts).
// =============================================================================

/** One-shot particle burst at a world position; auto-disposes on completion. */
function spawnFx(scene: SceneHost, name: string, config: ParticleSystemConfig, position: Vector3): void {
    new ParticleEffect(name, scene, config, { autoDispose: true }).object.position.copy(position);
}

/**
 * Attaches the element's projectile-body cloud (LOCAL-space head riding the
 * carrier) + hanging wake trail (WORLD-space) to a moving carrier object.
 * Returns the disposer to call when the projectile dies.
 */
function attachProjectileFx(scene: SceneHost, name: string, element: PowerElement, carrier: Object3D): () => void {
    const head = new ParticleEffect(`${name}Head`, scene, elementProjectileHeadConfig(element), { follow: carrier });
    const trail = new ParticleEffect(`${name}Trail`, scene, elementProjectileTrailConfig(element), { follow: carrier });
    return () => {
        head.dispose();
        trail.dispose();
    };
}

/**
 * Invisible carrier for the mage projectiles whose visible body is ENTIRELY
 * particles (no primitive mesh at all). Move/aim the returned group like the
 * old projectile mesh; dispose() tears down the fx and detaches the group.
 */
function createParticleProjectile(
    scene: SceneHost, name: string, element: PowerElement, start: Vector3,
): { carrier: Group; dispose: () => void } {
    const carrier = new Group();
    carrier.name = name;
    carrier.position.copy(start);
    scene.scene.add(carrier);
    const disposeFx = attachProjectileFx(scene, name, element, carrier);
    return {
        carrier,
        dispose: () => {
            disposeFx();
            carrier.removeFromParent();
        },
    };
}

// =============================================================================
// BOLT SEGMENT POOL — 30 pre-allocated unit-depth boxes (5 segs × 6 bolts).
// Boxes are created with depth=1.0; callers set scale.z = segLen per use.
// Each pooled segment OWNS its material (bounded: one per pool slot) so its
// emissive color + fading opacity can be mutated per use without ever touching
// a shared cached material.
// =============================================================================

const BOLT_POOL_SIZE = 30;
const boltPool: Mesh[] = [];
let boltPoolInitialized = false;

function makeBoltSegment(name: string, scene: SceneHost): Mesh {
    const box = createBox(name, { width: 0.07, height: 0.07, depth: 1.0 }, scene);
    const mat = createLowPolyMaterial('boltSegMat', new Color(0, 0, 0));
    mat.transparent = true;
    box.material = mat;
    box.userData.ownedMaterial = true; // disposeMesh frees it with the segment
    return box;
}

function acquireBoltSegment(scene: SceneHost): Mesh {
    // The pool is module-level so it survives state exits, but the engine's
    // scene cleanup disposes every scene mesh between states. On the next run
    // the pool would hold disposed (or other-scene) meshes — re-enabling those
    // renders nothing. Detect stale entries and rebuild the pool from scratch.
    if (boltPoolInitialized && boltPool.some(b => isMeshDisposed(b) || b.parent !== scene.scene)) {
        for (const b of boltPool) {
            if (!isMeshDisposed(b)) disposeMesh(b); // owned material freed with the segment
        }
        boltPool.length = 0;
        boltPoolInitialized = false;
    }
    if (!boltPoolInitialized) {
        for (let i = 0; i < BOLT_POOL_SIZE; i++) {
            const box = makeBoltSegment(`boltSeg${i}`, scene);
            box.visible = false;
            boltPool.push(box);
        }
        boltPoolInitialized = true;
    }
    for (const b of boltPool) {
        if (!b.visible) {
            b.visible = true;
            return b;
        }
    }
    // Fallback: pool exhausted — create one that will be disposed normally.
    return makeBoltSegment(`boltSegX${performance.now()}`, scene);
}

function releaseBoltSegment(mesh: Mesh): void {
    if (boltPool.indexOf(mesh) >= 0) {
        mesh.visible = false;
        mesh.scale.setScalar(1);
        mesh.rotation.set(0, 0, 0);
    } else {
        disposeMesh(mesh); // owned material freed with the segment
    }
}

/**
 * Spawns a jagged (zigzag) lightning bolt between two positions using
 * 5 short box segments with random perpendicular offsets.
 * Segments are drawn from the module-level bolt pool to avoid per-bolt
 * mesh allocation churn.
 */
function spawnJaggedBolt(scene: SceneHost, from: Vector3, to: Vector3, color: Color, duration: number = 0.2): void {
    const segments = 5;
    const meshes: Mesh[] = [];
    const dir = new Vector3().subVectors(to, from);
    const length = dir.length();
    if (length < 0.1) return;
    const perp = new Vector3(-dir.z, 0, dir.x).normalize();
    for (let i = 0; i < segments; i++) {
        const tStart = i / segments;
        const tEnd = (i + 1) / segments;
        const startP = from.clone().addScaledVector(dir, tStart);
        const endP = from.clone().addScaledVector(dir, tEnd);
        // Offset midpoint perpendicular (except endpoints)
        if (i > 0) startP.addScaledVector(perp, (Math.random() - 0.5) * length * 0.15);
        if (i < segments - 1) endP.addScaledVector(perp, (Math.random() - 0.5) * length * 0.15);
        const segMid = new Vector3().lerpVectors(startP, endP, 0.5);
        const segLen = startP.distanceTo(endP);
        const segDir = new Vector3().subVectors(endP, startP);
        const seg = acquireBoltSegment(scene);
        seg.scale.z = segLen;
        seg.scale.x = 1;
        seg.scale.y = 1;
        seg.position.copy(segMid);
        seg.rotation.y = headingToYaw(segDir.x, segDir.z);
        const segMat = seg.material as MeshPhongMaterial; // segment-owned — safe to mutate
        segMat.emissive.copy(color);
        segMat.opacity = 0.95;
        meshes.push(seg);
    }
    let elapsed = 0;
    const token = scene.onBeforeRender.add(() => {
        const dt = scene.deltaSeconds;
        elapsed += dt;
        const t = Math.min(elapsed / duration, 1);
        for (const m of meshes) {
            const mMat = m.material as MeshPhongMaterial | null;
            if (mMat) mMat.opacity = 0.95 * (1 - t);
        }
        if (t >= 1) {
            for (const m of meshes) releaseBoltSegment(m);
            scene.onBeforeRender.remove(token);
        }
    });
}

// =============================================================================
// MAGE SPELLS (autocast)
// =============================================================================

// ─────────────────────────────────────────────────────────────────────────────
// Fireball — fire projectile
// ─────────────────────────────────────────────────────────────────────────────
const mageFireDef: PowerDefinition = {
    id: 'mage_fire',
    name: 'Fireball',
    element: 'fire',
    icon: 'F',
    baseCooldown: 1.4,
    baseDamage: 14,
    baseRange: 12,
    maxLevel: 5,
    mode: 'autocast',
    cooldownFor: (s) => mageFireDef.baseCooldown * Math.pow(0.92, s.level - 1),
    damageFor:   (s) => mageFireDef.baseDamage  * Math.pow(1.25, s.level - 1),
    cast: (state, ctx) => {
        let best: Enemy | null = null;
        let bestDist2 = mageFireDef.baseRange * mageFireDef.baseRange;
        for (const e of ctx.enemies) {
            if (!e.isAlive()) continue;
            const dx = e.getPosition().x - ctx.heroPosition.x;
            const dz = e.getPosition().z - ctx.heroPosition.z;
            const d2 = dx * dx + dz * dz;
            if (d2 < bestDist2) { bestDist2 = d2; best = e; }
        }
        if (!best) return;

        // The fireball IS its particles: a roiling LOCAL-space flame head on an
        // invisible carrier, with a WORLD-space ember wake hanging behind it.
        const start = ctx.heroPosition.clone(); start.y = 1;
        const projectile = createParticleProjectile(ctx.scene, 'fireball', 'fire', start);
        const proj = projectile.carrier;

        const target = best;
        const damage = mageFireDef.damageFor(state) * ctx.damageMultiplier;
        const speed = 18;

        const observer = ctx.scene.onBeforeRender.add(() => {
            if (!target.isAlive()) {
                projectile.dispose();
                ctx.scene.onBeforeRender.remove(observer);
                return;
            }
            const dt = ctx.scene.deltaSeconds;

            const tp = target.getPosition().clone(); tp.y = 1;
            const dir = new Vector3().subVectors(tp, proj.position);
            const dist = dir.length();
            const dirN = dir.normalize();

            if (dist < 0.5) {
                target.takeDamage(damage, ctx.element);
                target.applyStatusEffect(StatusEffect.BURNING, 3, 3.0);
                // Impact stack: ember mesh burst + bright bloom + ground scorch
                // ring + rising smoke.
                spawnFx(ctx.scene, 'fireballImpact', elementImpactConfig('fire', 1.2), proj.position);
                spawnFx(ctx.scene, 'fireballFlash', elementFlashConfig('fire', 1.4), proj.position);
                const ground = proj.position.clone(); ground.y = 0.3;
                spawnFx(ctx.scene, 'fireballScorch', elementNovaConfig('fire', 1.1), ground);
                spawnFx(ctx.scene, 'fireballSmoke', fireSmokePuffConfig(1), ground);
                projectile.dispose();
                ctx.scene.onBeforeRender.remove(observer);
                return;
            }
            proj.position.addScaledVector(dirN, Math.min(dist, speed * dt));
        });
        setTimeout(() => {
            projectile.dispose();
            ctx.scene.onBeforeRender.remove(observer);
        }, 4000);
    },
};

// ─────────────────────────────────────────────────────────────────────────────
// Frost Shards — ice projectile + slow
// ─────────────────────────────────────────────────────────────────────────────
const mageIceDef: PowerDefinition = {
    id: 'mage_ice',
    name: 'Frost Shards',
    element: 'ice',
    icon: 'I',
    baseCooldown: 1.2,
    baseDamage: 9,
    baseRange: 11,
    maxLevel: 5,
    mode: 'autocast',
    cooldownFor: (s) => mageIceDef.baseCooldown * Math.pow(0.92, s.level - 1),
    damageFor:   (s) => mageIceDef.baseDamage  * Math.pow(1.25, s.level - 1),
    cast: (state, ctx) => {
        let best: Enemy | null = null;
        let bestDist2 = mageIceDef.baseRange * mageIceDef.baseRange;
        for (const e of ctx.enemies) {
            if (!e.isAlive()) continue;
            const dx = e.getPosition().x - ctx.heroPosition.x;
            const dz = e.getPosition().z - ctx.heroPosition.z;
            const d2 = dx * dx + dz * dz;
            if (d2 < bestDist2) { bestDist2 = d2; best = e; }
        }
        if (!best) return;

        // The shard cluster IS its particles: tumbling octahedron MESH shards
        // in a LOCAL-space cloud on an invisible carrier + a frost-mist wake.
        const start = ctx.heroPosition.clone(); start.y = 1;
        const projectile = createParticleProjectile(ctx.scene, 'frostShard', 'ice', start);
        const proj = projectile.carrier;

        const target = best;
        const damage = mageIceDef.damageFor(state) * ctx.damageMultiplier;
        const speed = 20;

        const observer = ctx.scene.onBeforeRender.add(() => {
            if (!target.isAlive()) {
                projectile.dispose();
                ctx.scene.onBeforeRender.remove(observer);
                return;
            }
            const dt = ctx.scene.deltaSeconds;

            const tp = target.getPosition().clone(); tp.y = 1;
            const dir = new Vector3().subVectors(tp, proj.position);
            const dist = dir.length();

            if (dist < 0.4) {
                target.takeDamage(damage, ctx.element);
                target.applyStatusEffect(StatusEffect.SLOWED, 2, 0.5);
                // Shatter: shard mesh burst + icy bloom + frost ring on the ground
                spawnFx(ctx.scene, 'frostShardImpact', elementImpactConfig('ice', 1), proj.position);
                spawnFx(ctx.scene, 'frostShardFlash', elementFlashConfig('ice', 1.1), proj.position);
                const ground = proj.position.clone(); ground.y = 0.3;
                spawnFx(ctx.scene, 'frostShardRing', elementNovaConfig('ice', 0.8), ground);
                projectile.dispose();
                ctx.scene.onBeforeRender.remove(observer);
                return;
            }
            proj.position.addScaledVector(dir.normalize(), Math.min(dist, speed * dt));
        });
        setTimeout(() => {
            projectile.dispose();
            ctx.scene.onBeforeRender.remove(observer);
        }, 4000);
    },
};

// ─────────────────────────────────────────────────────────────────────────────
// Arcane Nova — AOE pulse around hero
// ─────────────────────────────────────────────────────────────────────────────
const mageArcaneDef: PowerDefinition = {
    id: 'mage_arcane',
    name: 'Arcane Nova',
    element: 'arcane',
    icon: 'A',
    baseCooldown: 3.0,
    baseDamage: 18,
    baseRange: 4.5,
    maxLevel: 5,
    mode: 'autocast',
    cooldownFor: (s) => mageArcaneDef.baseCooldown * Math.pow(0.92, s.level - 1),
    damageFor:   (s) => mageArcaneDef.baseDamage  * Math.pow(1.25, s.level - 1),
    cast: (state, ctx) => {
        const radius = state.level >= 4
            ? mageArcaneDef.baseRange * 1.4
            : mageArcaneDef.baseRange;
        const damage = mageArcaneDef.damageFor(state) * ctx.damageMultiplier;

        for (const e of ctx.enemies) {
            if (!e.isAlive()) continue;
            const dx = e.getPosition().x - ctx.heroPosition.x;
            const dz = e.getPosition().z - ctx.heroPosition.z;
            if (Math.hypot(dx, dz) <= radius) {
                e.takeDamage(damage, ctx.element);
            }
        }

        // Fully particle-driven nova: two staggered expanding ring waves from a
        // single system, a bright center bloom, and swirling orbital motes.
        const ground = ctx.heroPosition.clone(); ground.y = 0.3;
        spawnFx(ctx.scene, 'arcaneNovaRing', elementNovaConfig('arcane', radius, 2), ground);
        const flashPos = ctx.heroPosition.clone(); flashPos.y = 1.2;
        spawnFx(ctx.scene, 'arcaneNovaFlash', elementFlashConfig('arcane', 2.2), flashPos);
        spawnFx(ctx.scene, 'arcaneNovaImpact', elementImpactConfig('arcane', 1.3), flashPos);
    },
};

// ─────────────────────────────────────────────────────────────────────────────
// Whirling Blades — persistent orbiting blades
// ─────────────────────────────────────────────────────────────────────────────
type WhirlingBlade = { mesh: Mesh; angle: number; fx: ParticleEffect };

/** Blade count: 2 at level 1, +1 per level thereafter. */
function whirlingBladeCount(level: number): number {
    return level + 1;
}

// Shuriken (throwing-star) geometry — a flat N-pointed star in the XZ plane with a
// little thickness, that spins around its own vertical axis as it orbits the hero.
const SHURIKEN_POINTS = 4;       // 4-pointed ninja star
const SHURIKEN_OUTER = 0.42;     // tip radius
const SHURIKEN_INNER = 0.16;     // valley radius between tips
const SHURIKEN_HALF_THICK = 0.05;
const SHURIKEN_SPIN = 16;        // rad/s self-spin (fast, reads as a thrown star)

/**
 * Build a solid N-pointed star mesh lying flat in the XZ plane (thickness along Y).
 * Vertices: a top rim + bottom rim of 2N points (alternating outer tip / inner valley)
 * plus a top & bottom center; triangulated as two fans joined by side walls.
 */
function createShurikenMesh(name: string, scene: SceneHost, material: MeshPhongMaterial): Mesh {
    const rim = SHURIKEN_POINTS * 2;
    const positions: number[] = [];
    const indices: number[] = [];
    const ring = (y: number) => {
        for (let i = 0; i < rim; i++) {
            const ang = (i / rim) * Math.PI * 2;
            const r = i % 2 === 0 ? SHURIKEN_OUTER : SHURIKEN_INNER;
            positions.push(Math.cos(ang) * r, y, Math.sin(ang) * r);
        }
    };
    ring(SHURIKEN_HALF_THICK);    // top rim: indices 0..rim-1
    ring(-SHURIKEN_HALF_THICK);   // bottom rim: indices rim..2*rim-1
    const topCenter = positions.length / 3; positions.push(0, SHURIKEN_HALF_THICK, 0);
    const botCenter = positions.length / 3; positions.push(0, -SHURIKEN_HALF_THICK, 0);
    for (let i = 0; i < rim; i++) {
        const a = i, b = (i + 1) % rim;
        indices.push(topCenter, a, b);                // top face fan
        indices.push(botCenter, rim + b, rim + a);    // bottom face fan (reversed)
        indices.push(a, b, rim + b);                  // side wall
        indices.push(a, rim + b, rim + a);
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(positions, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const mesh = new Mesh(geo, material);
    mesh.name = name;
    scene.scene.add(mesh);
    return mesh;
}

/**
 * Reconcile the live blade meshes to `desired`: spawn/dispose as needed and re-space
 * the survivors evenly around the orbit. Cheap no-op when the count already matches,
 * so tick() can call it every frame to react to level-ups (which only bump
 * state.level and never re-run init).
 */
function ensureWhirlingBlades(state: PowerRuntimeState, scene: SceneHost, desired: number): WhirlingBlade[] {
    if (!state.data) state.data = {};
    let blades = state.data['blades'] as WhirlingBlade[] | undefined;
    if (!blades) { blades = []; state.data['blades'] = blades; }
    if (blades.length === desired) return blades;

    const bladeMat = getCachedMaterial('whirling_blade_mat', m => {
        m.emissive.copy(new Color(0.78, 0.80, 0.86)); // steel sheen
        m.color.set(0.25, 0.27, 0.32);
        // Procedural star: render both faces so a flipped winding can never make a
        // tip vanish as it spins edge-on to the camera.
        m.side = DoubleSide;
    });
    while (blades.length < desired) {
        const blade = createShurikenMesh(`wbBlade_${blades.length}`, scene, bladeMat);
        // Per-blade steel-glint wake (WORLD-space, hangs behind the spinning star).
        const fx = new ParticleEffect(`wbBladeTrail_${blades.length}`, scene,
            elementProjectileTrailConfig('physical'), { follow: blade });
        blades.push({ mesh: blade, angle: 0, fx });
    }
    while (blades.length > desired) {
        const extra = blades.pop();
        if (extra) {
            extra.fx.dispose();
            try { disposeMesh(extra.mesh); } catch { /* ignore */ }
        }
    }
    // Re-space evenly (only runs when the count changed, i.e. on level-up).
    for (let i = 0; i < blades.length; i++) {
        blades[i].angle = (i / blades.length) * Math.PI * 2;
    }
    return blades;
}

const magePhysicalDef: PowerDefinition = {
    id: 'mage_physical',
    name: 'Whirling Blades',
    element: 'physical',
    icon: 'W',
    baseCooldown: 0.25,
    baseDamage: 4,
    baseRange: 2.5,
    maxLevel: 5,
    mode: 'autocast',
    cooldownFor: (s) => magePhysicalDef.baseCooldown * Math.pow(0.92, s.level - 1),
    damageFor:   (s) => magePhysicalDef.baseDamage  * Math.pow(1.25, s.level - 1),
    init: (state, ctx) => {
        ensureWhirlingBlades(state, ctx.scene, whirlingBladeCount(state.level));
        state.data!['orbitRadius'] = magePhysicalDef.baseRange;
        // Persistent hero-following steel-spark wake for the activation window
        // (init..dispose is the one clean activation boundary this tick-driven
        // power has - the orbiting blades themselves stay untouched as the
        // readable core mechanic, this only adds an ambient spark layer).
        const sparkFx = new ParticleEffect('whirlingBladeSparks', ctx.scene, elementProjectileTrailConfig('physical'));
        sparkFx.object.position.copy(ctx.heroPosition);
        state.data!['sparkFx'] = sparkFx;
    },
    // Persistent passive: the blades orbit the hero EVERY frame (smooth, always-on,
    // no enemy required) and never play the hero attack animation. Damage is applied
    // on a level-scaled cadence so the always-on spin doesn't multiply DPS by framerate.
    tick: (state, ctx, dt) => {
        // Reconcile blade count to the current level every frame (cheap when unchanged),
        // so a level-up adds a blade without re-running init.
        const blades = ensureWhirlingBlades(state, ctx.scene, whirlingBladeCount(state.level));
        const sparkFx = state.data?.['sparkFx'] as ParticleEffect | undefined;
        if (sparkFx) sparkFx.object.position.copy(ctx.heroPosition);
        if (blades.length === 0) return;

        const orbitRadius = (state.data!['orbitRadius'] as number) ?? magePhysicalDef.baseRange;
        // Mage Whirling Blades spin 3× faster than the base orbit speed.
        const rotateSpeed = 7.5;

        for (const blade of blades) {
            blade.angle += rotateSpeed * dt;
            blade.mesh.position.set(
                ctx.heroPosition.x + Math.cos(blade.angle) * orbitRadius,
                1.0,
                ctx.heroPosition.z + Math.sin(blade.angle) * orbitRadius,
            );
            // Spin the shuriken fast around its own vertical axis (like a thrown star),
            // independent of its slower orbit around the hero. The glint wake is
            // a per-blade ParticleEffect following the mesh - no per-frame work.
            blade.mesh.rotation.y += SHURIKEN_SPIN * dt;
        }

        // Damage cadence: one sweep per cooldownFor(state) seconds (the same per-level
        // attack rate the old autocast used), preserving the ~4 dmg / 0.25s balance.
        let hitTimer = (state.data!['hitTimer'] as number) ?? 0;
        hitTimer += dt;
        // 3× more damage ticks: fire the sweep three times as often as the base cadence.
        if (hitTimer >= magePhysicalDef.cooldownFor(state) / 3) {
            hitTimer = 0;
            const damage = magePhysicalDef.damageFor(state) * ctx.damageMultiplier;
            const hitSet = new Set<Enemy>();
            for (const blade of blades) {
                for (const e of ctx.enemies) {
                    if (!e.isAlive() || hitSet.has(e)) continue;
                    const dx = e.getPosition().x - blade.mesh.position.x;
                    const dz = e.getPosition().z - blade.mesh.position.z;
                    if (Math.hypot(dx, dz) < 0.8) {
                        e.takeDamage(damage, ctx.element);
                        hitSet.add(e);
                    }
                }
            }
        }
        state.data!['hitTimer'] = hitTimer;
    },
    dispose: (state) => {
        const blades = state.data?.['blades'] as WhirlingBlade[] | undefined;
        if (blades) {
            for (const b of blades) {
                b.fx.dispose();
                try { disposeMesh(b.mesh); } catch { /* ignore */ }
            }
        }
        const sparkFx = state.data?.['sparkFx'] as ParticleEffect | undefined;
        if (sparkFx) {
            sparkFx.stop();
            sparkFx.dispose();
        }
    },
};

// ─────────────────────────────────────────────────────────────────────────────
// Lightning Chain — strike nearest + chain
// ─────────────────────────────────────────────────────────────────────────────
const mageStormDef: PowerDefinition = {
    id: 'mage_storm',
    name: 'Lightning Chain',
    element: 'storm',
    icon: 'L',
    baseCooldown: 2.2,
    baseDamage: 16,
    baseRange: 10,
    maxLevel: 5,
    mode: 'autocast',
    cooldownFor: (s) => mageStormDef.baseCooldown * Math.pow(0.92, s.level - 1),
    damageFor:   (s) => mageStormDef.baseDamage  * Math.pow(1.25, s.level - 1),
    cast: (state, ctx) => {
        let first: Enemy | null = null;
        let firstDist2 = mageStormDef.baseRange * mageStormDef.baseRange;
        for (const e of ctx.enemies) {
            if (!e.isAlive()) continue;
            const dx = e.getPosition().x - ctx.heroPosition.x;
            const dz = e.getPosition().z - ctx.heroPosition.z;
            const d2 = dx * dx + dz * dz;
            if (d2 < firstDist2) { firstDist2 = d2; first = e; }
        }
        if (!first) return;

        const damage = mageStormDef.damageFor(state) * ctx.damageMultiplier;
        const chainRadius = 4;
        const maxChains = 3;

        const hitOrder: { from: Vector3; to: Vector3 }[] = [];
        const hitSet = new Set<Enemy>();
        let current: Enemy = first;
        hitSet.add(current);
        current.takeDamage(damage, ctx.element);
        hitOrder.push({ from: ctx.heroPosition.clone(), to: current.getPosition().clone() });

        for (let chain = 0; chain < maxChains; chain++) {
            let next: Enemy | null = null;
            let nextDist2 = chainRadius * chainRadius;
            for (const e of ctx.enemies) {
                if (!e.isAlive() || hitSet.has(e)) continue;
                const dx = e.getPosition().x - current.getPosition().x;
                const dz = e.getPosition().z - current.getPosition().z;
                const d2 = dx * dx + dz * dz;
                if (d2 < nextDist2) { nextDist2 = d2; next = e; }
            }
            if (!next) break;
            hitOrder.push({ from: current.getPosition().clone(), to: next.getPosition().clone() });
            next.takeDamage(damage * 0.75, ctx.element);
            hitSet.add(next);
            current = next;
        }

        const boltColor = new Color(0.7, 0.7, 1.0);
        for (const seg of hitOrder) {
            const from = seg.from.clone(); from.y = 1;
            const to = seg.to.clone(); to.y = 1;
            spawnJaggedBolt(ctx.scene, from, to, boltColor, 0.2);
            // Bright strike bloom + spark crackle where each chain lands
            spawnFx(ctx.scene, 'lightningChainFlash', elementFlashConfig('storm', 1.2), to);
            spawnFx(ctx.scene, 'lightningChainImpact', elementImpactConfig('storm'), to);
        }
    },
};

// =============================================================================
// RANGER ARROWS (autocast)
// =============================================================================

// ─────────────────────────────────────────────────────────────────────────────
// Fire Arrow — exploding projectile with AOE burn
// ─────────────────────────────────────────────────────────────────────────────
const rangerFireDef: PowerDefinition = {
    id: 'ranger_fire',
    name: 'Fire Arrow',
    element: 'fire',
    icon: 'F',
    baseCooldown: 1.3,
    baseDamage: 12,
    baseRange: 14,
    maxLevel: 5,
    mode: 'autocast',
    cooldownFor: (s) => rangerFireDef.baseCooldown * Math.pow(0.92, s.level - 1),
    damageFor:   (s) => rangerFireDef.baseDamage  * Math.pow(1.25, s.level - 1),
    cast: (state, ctx) => {
        let best: Enemy | null = null;
        let bestDist2 = rangerFireDef.baseRange * rangerFireDef.baseRange;
        for (const e of ctx.enemies) {
            if (!e.isAlive()) continue;
            const dx = e.getPosition().x - ctx.heroPosition.x;
            const dz = e.getPosition().z - ctx.heroPosition.z;
            const d2 = dx * dx + dz * dz;
            if (d2 < bestDist2) { bestDist2 = d2; best = e; }
        }
        if (!best) return;

        // Fire arrow: orange arrow shaft wrapped in a burning particle sheath
        // (LOCAL-space flame head riding the arrow + hanging ember wake).
        const arrowColor = new Color(1, 0.4, 0.05);
        const proj = buildArrowMesh(ctx.scene, `fire_arrow_${Math.random()}`, arrowColor);
        proj.position.copy(ctx.heroPosition);
        proj.position.y = 1;
        const disposeFx = attachProjectileFx(ctx.scene, 'fireArrow', 'fire', proj);

        const target = best;
        const damage = rangerFireDef.damageFor(state) * ctx.damageMultiplier;
        const aoeRadius = 2.5;
        const speed = 22;
        const enemies = ctx.enemies;

        const cleanup = () => {
            disposeFx();
            disposeMesh(proj);
        };

        const observer = ctx.scene.onBeforeRender.add(() => {
            const dt = ctx.scene.deltaSeconds;

            if (!target.isAlive()) {
                explodeFireArrow(proj.position.clone(), damage, aoeRadius, enemies, ctx.scene);
                cleanup();
                ctx.scene.onBeforeRender.remove(observer);
                return;
            }
            const tp = target.getPosition().clone(); tp.y = 1;
            const dir = new Vector3().subVectors(tp, proj.position);
            const dist = dir.length();
            const dirN = dir.normalize();

            // Orient arrow toward travel direction
            proj.rotation.y = headingToYaw(dirN.x, dirN.z);

            if (dist < 0.5) {
                explodeFireArrow(proj.position.clone(), damage, aoeRadius, enemies, ctx.scene, ctx.element);
                cleanup();
                ctx.scene.onBeforeRender.remove(observer);
                return;
            }
            proj.position.addScaledVector(dirN, Math.min(dist, speed * dt));
        });
        setTimeout(() => {
            if (isMeshDisposed(proj)) return;
            explodeFireArrow(proj.position.clone(), damage, aoeRadius, enemies, ctx.scene, ctx.element);
            cleanup();
            ctx.scene.onBeforeRender.remove(observer);
        }, 4000);
    },
};

function explodeFireArrow(pos: Vector3, damage: number, radius: number, enemies: Enemy[], scene: SceneHost, element: PowerElement = 'fire'): void {
    for (const e of enemies) {
        if (!e.isAlive()) continue;
        const dx = e.getPosition().x - pos.x;
        const dz = e.getPosition().z - pos.z;
        if (Math.hypot(dx, dz) <= radius) {
            e.takeDamage(damage, element);
            e.applyStatusEffect(StatusEffect.BURNING, 2.5, 2.5);
        }
    }
    // Explosion stack: expanding fire ring across the AOE radius + ember mesh
    // burst + bright bloom + rising smoke, all particle-driven.
    const ground = pos.clone(); ground.y = 0.3;
    spawnFx(scene, 'fireArrowRing', elementNovaConfig('fire', radius), ground);
    spawnFx(scene, 'fireArrowImpact', elementImpactConfig('fire', radius / 2.5), pos);
    spawnFx(scene, 'fireArrowFlash', elementFlashConfig('fire', radius / 2), pos);
    spawnFx(scene, 'fireArrowSmoke', fireSmokePuffConfig(radius / 2.5), ground);
}

// ─────────────────────────────────────────────────────────────────────────────
// Frost Arrow — pierce 2 enemies, slow on hit
// ─────────────────────────────────────────────────────────────────────────────
const rangerIceDef: PowerDefinition = {
    id: 'ranger_ice',
    name: 'Frost Arrow',
    element: 'ice',
    icon: 'I',
    baseCooldown: 1.4,
    baseDamage: 10,
    baseRange: 15,
    maxLevel: 5,
    mode: 'autocast',
    cooldownFor: (s) => rangerIceDef.baseCooldown * Math.pow(0.92, s.level - 1),
    damageFor:   (s) => rangerIceDef.baseDamage  * Math.pow(1.25, s.level - 1),
    cast: (state, ctx) => {
        let best: Enemy | null = null;
        let bestDist2 = rangerIceDef.baseRange * rangerIceDef.baseRange;
        for (const e of ctx.enemies) {
            if (!e.isAlive()) continue;
            const dx = e.getPosition().x - ctx.heroPosition.x;
            const dz = e.getPosition().z - ctx.heroPosition.z;
            const d2 = dx * dx + dz * dz;
            if (d2 < bestDist2) { bestDist2 = d2; best = e; }
        }
        if (!best) return;

        const direction = best.getPosition().clone().sub(ctx.heroPosition);
        direction.y = 0;
        direction.normalize();

        // Frost arrow: cyan arrow wrapped in a tumbling ice-shard particle
        // cloud (MESH shards riding the shaft) + frost-mist wake.
        const arrowColor = new Color(0.4, 0.85, 1.0);
        const proj = buildArrowMesh(ctx.scene, `frost_arrow_${Math.random()}`, arrowColor);
        proj.position.copy(ctx.heroPosition);
        proj.position.y = 1;
        const disposeFx = attachProjectileFx(ctx.scene, 'frostArrow', 'ice', proj);

        // Orient arrow toward travel direction from the start
        proj.rotation.y = headingToYaw(direction.x, direction.z);

        const damage = rangerIceDef.damageFor(state) * ctx.damageMultiplier;
        const speed = 26;
        const maxPierces = 2;
        let pierceCount = 0;
        let traveledDist = 0;
        const hitEnemies = new Set<Enemy>();

        const cleanup = () => {
            disposeFx();
            disposeMesh(proj);
        };

        const observer = ctx.scene.onBeforeRender.add(() => {
            const dt = ctx.scene.deltaSeconds;
            const step = speed * dt;
            traveledDist += step;
            proj.position.addScaledVector(direction, step);

            for (const e of ctx.enemies) {
                if (!e.isAlive() || hitEnemies.has(e)) continue;
                const dx = e.getPosition().x - proj.position.x;
                const dz = e.getPosition().z - proj.position.z;
                if (Math.hypot(dx, dz) < 0.6) {
                    e.takeDamage(damage, ctx.element);
                    e.applyStatusEffect(StatusEffect.SLOWED, 1.5, 0.5);
                    hitEnemies.add(e);
                    pierceCount++;
                    spawnFx(ctx.scene, 'frostArrowImpact', elementImpactConfig('ice'), proj.position);
                }
            }

            if (traveledDist >= rangerIceDef.baseRange || pierceCount >= maxPierces) {
                cleanup();
                ctx.scene.onBeforeRender.remove(observer);
            }
        });
        setTimeout(() => {
            if (isMeshDisposed(proj)) return;
            cleanup();
            ctx.scene.onBeforeRender.remove(observer);
        }, 3500);
    },
};

// ─────────────────────────────────────────────────────────────────────────────
// Seeking Arrow — homing projectile
// ─────────────────────────────────────────────────────────────────────────────
const rangerArcaneDef: PowerDefinition = {
    id: 'ranger_arcane',
    name: 'Seeking Arrow',
    element: 'arcane',
    icon: 'A',
    baseCooldown: 1.5,
    baseDamage: 14,
    baseRange: 16,
    maxLevel: 5,
    mode: 'autocast',
    cooldownFor: (s) => rangerArcaneDef.baseCooldown * Math.pow(0.92, s.level - 1),
    damageFor:   (s) => rangerArcaneDef.baseDamage  * Math.pow(1.25, s.level - 1),
    cast: (state, ctx) => {
        let best: Enemy | null = null;
        let bestDist2 = rangerArcaneDef.baseRange * rangerArcaneDef.baseRange;
        for (const e of ctx.enemies) {
            if (!e.isAlive()) continue;
            const dx = e.getPosition().x - ctx.heroPosition.x;
            const dz = e.getPosition().z - ctx.heroPosition.z;
            const d2 = dx * dx + dz * dz;
            if (d2 < bestDist2) { bestDist2 = d2; best = e; }
        }
        if (!best) return;

        // Seeking arrow: purple arrow wrapped in orbiting arcane motes (the
        // particle head's orbital velocity replaces the old hand-animated orb).
        const arrowColor = new Color(0.7, 0.3, 1.0);
        const proj = buildArrowMesh(ctx.scene, `seek_arrow_${Math.random()}`, arrowColor);
        proj.position.copy(ctx.heroPosition);
        proj.position.y = 1;
        const disposeFx = attachProjectileFx(ctx.scene, 'seekArrow', 'arcane', proj);

        const target = best;
        const damage = rangerArcaneDef.damageFor(state) * ctx.damageMultiplier;
        const speed = 18;
        const turnSpeed = 4.0;
        const velDir = target.getPosition().clone().sub(ctx.heroPosition);
        velDir.y = 0;
        velDir.normalize();

        const cleanup = () => {
            disposeFx();
            disposeMesh(proj);
        };

        const observer = ctx.scene.onBeforeRender.add(() => {
            const dt = ctx.scene.deltaSeconds;

            if (!target.isAlive()) {
                cleanup();
                ctx.scene.onBeforeRender.remove(observer);
                return;
            }
            const tp = target.getPosition().clone(); tp.y = 1;
            const toTarget = new Vector3().subVectors(tp, proj.position);
            const dist = toTarget.length();

            // Orient arrow toward velocity
            proj.rotation.y = headingToYaw(velDir.x, velDir.z);

            if (dist < 0.5) {
                target.takeDamage(damage, ctx.element);
                spawnFx(ctx.scene, 'seekArrowImpact', elementImpactConfig('arcane'), proj.position);
                spawnFx(ctx.scene, 'seekArrowFlash', elementFlashConfig('arcane', 0.9), proj.position);
                cleanup();
                ctx.scene.onBeforeRender.remove(observer);
                return;
            }
            const desired = toTarget.normalize();
            // Lerp velocity direction toward target
            velDir.lerp(desired, Math.min(1, turnSpeed * dt));
            velDir.y = 0;
            velDir.normalize();
            proj.position.addScaledVector(velDir, speed * dt);
        });
        setTimeout(() => {
            if (isMeshDisposed(proj)) return;
            cleanup();
            ctx.scene.onBeforeRender.remove(observer);
        }, 4000);
    },
};

// ─────────────────────────────────────────────────────────────────────────────
// Piercing Shot — long-range pierce (all enemies)
// ─────────────────────────────────────────────────────────────────────────────
const rangerPhysicalDef: PowerDefinition = {
    id: 'ranger_physical',
    name: 'Piercing Shot',
    element: 'physical',
    icon: 'P',
    baseCooldown: 1.6,
    baseDamage: 22,
    baseRange: 18,
    maxLevel: 5,
    mode: 'autocast',
    cooldownFor: (s) => rangerPhysicalDef.baseCooldown * Math.pow(0.92, s.level - 1),
    damageFor:   (s) => rangerPhysicalDef.baseDamage  * Math.pow(1.25, s.level - 1),
    cast: (state, ctx) => {
        let best: Enemy | null = null;
        let bestDist2 = rangerPhysicalDef.baseRange * rangerPhysicalDef.baseRange;
        for (const e of ctx.enemies) {
            if (!e.isAlive()) continue;
            const dx = e.getPosition().x - ctx.heroPosition.x;
            const dz = e.getPosition().z - ctx.heroPosition.z;
            const d2 = dx * dx + dz * dz;
            if (d2 < bestDist2) { bestDist2 = d2; best = e; }
        }
        if (!best) return;

        const direction = best.getPosition().clone().sub(ctx.heroPosition);
        direction.y = 0;
        direction.normalize();

        // Piercing Shot: large bright white-silver arrow (scale 1.3) wrapped in
        // a tight silver-glint particle sheath + dust wake.
        const arrowColor = new Color(0.95, 0.95, 0.95);
        const proj = buildArrowMesh(ctx.scene, `pierce_arrow_${Math.random()}`, arrowColor);
        proj.scale.setScalar(1.3);
        proj.position.copy(ctx.heroPosition);
        proj.position.y = 1;
        const disposeFx = attachProjectileFx(ctx.scene, 'pierceArrow', 'physical', proj);

        // Orient arrow to face travel direction
        proj.rotation.y = headingToYaw(direction.x, direction.z);

        const damage = rangerPhysicalDef.damageFor(state) * ctx.damageMultiplier;
        const speed = 28;
        const hitEnemies = new Set<Enemy>();
        let traveledDist = 0;

        const cleanup = () => {
            disposeFx();
            disposeMesh(proj); // recurses into the tip/fletch children
        };

        const observer = ctx.scene.onBeforeRender.add(() => {
            const dt = ctx.scene.deltaSeconds;
            const step = speed * dt;
            traveledDist += step;
            proj.position.addScaledVector(direction, step);

            for (const e of ctx.enemies) {
                if (!e.isAlive() || hitEnemies.has(e)) continue;
                const dx = e.getPosition().x - proj.position.x;
                const dz = e.getPosition().z - proj.position.z;
                if (Math.hypot(dx, dz) < 0.6) {
                    e.takeDamage(damage, ctx.element);
                    hitEnemies.add(e);
                    spawnFx(ctx.scene, 'pierceArrowImpact', elementImpactConfig('physical', 0.7), proj.position);
                }
            }

            if (traveledDist >= rangerPhysicalDef.baseRange) {
                cleanup();
                ctx.scene.onBeforeRender.remove(observer);
            }
        });
        setTimeout(() => {
            if (isMeshDisposed(proj)) return;
            cleanup();
            ctx.scene.onBeforeRender.remove(observer);
        }, 3000);
    },
};

// ─────────────────────────────────────────────────────────────────────────────
// Lightning Arrow — chains to 2 nearby on hit
// ─────────────────────────────────────────────────────────────────────────────
const rangerStormDef: PowerDefinition = {
    id: 'ranger_storm',
    name: 'Lightning Arrow',
    element: 'storm',
    icon: 'L',
    baseCooldown: 2.0,
    baseDamage: 14,
    baseRange: 14,
    maxLevel: 5,
    mode: 'autocast',
    cooldownFor: (s) => rangerStormDef.baseCooldown * Math.pow(0.92, s.level - 1),
    damageFor:   (s) => rangerStormDef.baseDamage  * Math.pow(1.25, s.level - 1),
    cast: (state, ctx) => {
        let best: Enemy | null = null;
        let bestDist2 = rangerStormDef.baseRange * rangerStormDef.baseRange;
        for (const e of ctx.enemies) {
            if (!e.isAlive()) continue;
            const dx = e.getPosition().x - ctx.heroPosition.x;
            const dz = e.getPosition().z - ctx.heroPosition.z;
            const d2 = dx * dx + dz * dz;
            if (d2 < bestDist2) { bestDist2 = d2; best = e; }
        }
        if (!best) return;

        // Lightning Arrow: yellow arrow wrapped in a crackling spark sheath
        // (the particle head's flicker replaces the old scaled zigzag box).
        const arrowColor = new Color(1.0, 0.95, 0.4);
        const proj = buildArrowMesh(ctx.scene, `lightning_arrow_${Math.random()}`, arrowColor);
        proj.position.copy(ctx.heroPosition);
        proj.position.y = 1;
        const disposeFx = attachProjectileFx(ctx.scene, 'lightningArrow', 'storm', proj);

        const target = best;
        const damage = rangerStormDef.damageFor(state) * ctx.damageMultiplier;
        const speed = 24;
        const allEnemies = ctx.enemies;

        const cleanup = () => {
            disposeFx();
            disposeMesh(proj);
        };

        const observer = ctx.scene.onBeforeRender.add(() => {
            const dt = ctx.scene.deltaSeconds;

            if (!target.isAlive()) {
                chainLightning(target.getPosition(), damage, allEnemies, target, ctx.scene, ctx.element);
                cleanup();
                ctx.scene.onBeforeRender.remove(observer);
                return;
            }
            const tp = target.getPosition().clone(); tp.y = 1;
            const dir = new Vector3().subVectors(tp, proj.position);
            const dist = dir.length();
            const dirN = dir.normalize();

            // Orient arrow toward travel direction
            proj.rotation.y = headingToYaw(dirN.x, dirN.z);

            if (dist < 0.5) {
                target.takeDamage(damage, ctx.element);
                spawnFx(ctx.scene, 'lightningArrowImpact', elementImpactConfig('storm'), proj.position);
                spawnFx(ctx.scene, 'lightningArrowFlash', elementFlashConfig('storm', 1.1), proj.position);
                chainLightning(target.getPosition(), damage, allEnemies, target, ctx.scene, ctx.element);
                cleanup();
                ctx.scene.onBeforeRender.remove(observer);
                return;
            }
            proj.position.addScaledVector(dirN, Math.min(dist, speed * dt));
        });
        setTimeout(() => {
            if (isMeshDisposed(proj)) return;
            cleanup();
            ctx.scene.onBeforeRender.remove(observer);
        }, 4000);
    },
};

function chainLightning(fromPos: Vector3, damage: number, enemies: Enemy[], exclude: Enemy, scene: SceneHost, element: PowerElement = 'storm'): void {
    const chainRadius = 4;
    const chainDamage = damage * 0.6;
    let origin = fromPos;
    let excluded = exclude;
    const chainBoltColor = new Color(0.6, 0.6, 1.0);

    for (let i = 0; i < 2; i++) {
        let nearest: Enemy | null = null;
        let nearestDist2 = chainRadius * chainRadius;
        for (const e of enemies) {
            if (!e.isAlive() || e === excluded) continue;
            const dx = e.getPosition().x - origin.x;
            const dz = e.getPosition().z - origin.z;
            const d2 = dx * dx + dz * dz;
            if (d2 < nearestDist2) { nearestDist2 = d2; nearest = e; }
        }
        if (!nearest) break;
        nearest.takeDamage(chainDamage, element);
        // Jagged arc visual
        const from = origin.clone(); from.y = 1;
        const to = nearest.getPosition().clone(); to.y = 1;
        spawnJaggedBolt(scene, from, to, chainBoltColor, 0.18);
        spawnFx(scene, 'chainLightningImpact', elementImpactConfig('storm'), to);
        origin = nearest.getPosition();
        excluded = nearest;
    }
}

// =============================================================================
// BARBARIAN ENCHANTMENTS (passive)
// =============================================================================

// ─────────────────────────────────────────────────────────────────────────────
// Flaming Edge — burn DoT on hit
// ─────────────────────────────────────────────────────────────────────────────
const barbarianFireDef: PowerDefinition = {
    id: 'barbarian_fire',
    name: 'Flaming Edge',
    element: 'fire',
    icon: '🔥',
    baseCooldown: 0,
    baseDamage: 0,
    baseRange: 0,
    maxLevel: 5,
    mode: 'passive',
    cooldownFor: () => 0,
    damageFor:   () => 0,
    description: (lvl) => `On hit: burn for ${Math.round(30 * lvl)}% weapon dmg/s over 2s`,
    onHit: (enemy, level, ctx) => {
        const dotStrength = ctx.baseDamage * 0.3 * level;
        enemy.applyStatusEffect(StatusEffect.BURNING, 2, dotStrength);
        spawnFx(ctx.scene, 'flamingEdgeImpact', elementImpactConfig('fire', 0.6), enemy.getPosition());
    },
};

// ─────────────────────────────────────────────────────────────────────────────
// Frostbite — slow on hit
// ─────────────────────────────────────────────────────────────────────────────
const barbarianIceDef: PowerDefinition = {
    id: 'barbarian_ice',
    name: 'Frostbite',
    element: 'ice',
    icon: '❄️',
    baseCooldown: 0,
    baseDamage: 0,
    baseRange: 0,
    maxLevel: 5,
    mode: 'passive',
    cooldownFor: () => 0,
    damageFor:   () => 0,
    description: (lvl) => {
        const slowMult = Math.max(0.4, 0.65 - lvl * 0.05);
        const pct = Math.round((1 - slowMult) * 100);
        return `On hit: slow target ${pct}% for 1.5s`;
    },
    onHit: (enemy, level, ctx) => {
        const slowMult = Math.max(0.4, 0.65 - level * 0.05);
        enemy.applyStatusEffect(StatusEffect.SLOWED, 1.5, slowMult);
        spawnFx(ctx.scene, 'frostbiteImpact', elementImpactConfig('ice', 0.6), enemy.getPosition());
    },
};

// ─────────────────────────────────────────────────────────────────────────────
// Arcane Bite — bonus arcane damage on hit
// ─────────────────────────────────────────────────────────────────────────────
const barbarianArcaneDef: PowerDefinition = {
    id: 'barbarian_arcane',
    name: 'Arcane Bite',
    element: 'arcane',
    icon: '✦',
    baseCooldown: 0,
    baseDamage: 0,
    baseRange: 0,
    maxLevel: 5,
    mode: 'passive',
    cooldownFor: () => 0,
    damageFor:   () => 0,
    description: (lvl) => `On hit: +${Math.round(20 * lvl)}% bonus arcane damage`,
    onHit: (enemy, level, ctx) => {
        const bonusDamage = ctx.baseDamage * 0.20 * level;
        enemy.takeDamage(bonusDamage, ctx.element);
        spawnFx(ctx.scene, 'arcaneBiteImpact', elementImpactConfig('arcane', 0.6), enemy.getPosition());
    },
};

// ─────────────────────────────────────────────────────────────────────────────
// Heavy Strike — bonus physical damage + expanded swing radius
// ─────────────────────────────────────────────────────────────────────────────
const barbarianPhysicalDef: PowerDefinition = {
    id: 'barbarian_physical',
    name: 'Heavy Strike',
    element: 'physical',
    icon: '⚔️',
    baseCooldown: 0,
    baseDamage: 0,
    baseRange: 0,
    maxLevel: 5,
    mode: 'passive',
    cooldownFor: () => 0,
    damageFor:   () => 0,
    rangeBonus: (level) => level * 0.3,
    description: (lvl) => `+${Math.round(25 * lvl)}% damage and +${(0.3 * lvl).toFixed(1)}u swing reach`,
    onHit: (enemy, level, ctx) => {
        const bonusDamage = ctx.baseDamage * 0.25 * level;
        enemy.takeDamage(bonusDamage, ctx.element);
        spawnFx(ctx.scene, 'heavyStrikeImpact', elementImpactConfig('physical', 0.6), enemy.getPosition());
    },
};

// ─────────────────────────────────────────────────────────────────────────────
// Shock Chain — 30% damage to a nearby enemy per level (max 3)
// ─────────────────────────────────────────────────────────────────────────────
const barbarianStormDef: PowerDefinition = {
    id: 'barbarian_storm',
    name: 'Shock Chain',
    element: 'storm',
    icon: '⚡',
    baseCooldown: 0,
    baseDamage: 0,
    baseRange: 0,
    maxLevel: 5,
    mode: 'passive',
    cooldownFor: () => 0,
    damageFor:   () => 0,
    description: (lvl) => `On hit: chain to ${Math.min(lvl, 3)} nearby enemies for 30% weapon dmg`,
    onHit: (enemy, level, ctx) => {
        const chainCount = Math.min(level, 3);
        const chainDamage = ctx.baseDamage * 0.30;
        const chainRadius = 4;
        let origin = enemy.getPosition();
        let excluded = enemy;
        for (let i = 0; i < chainCount; i++) {
            let nearest: Enemy | null = null;
            let nearestDist2 = chainRadius * chainRadius;
            for (const e of ctx.enemies) {
                if (!e.isAlive() || e === excluded) continue;
                const dx = e.getPosition().x - origin.x;
                const dz = e.getPosition().z - origin.z;
                const d2 = dx * dx + dz * dz;
                if (d2 < nearestDist2) { nearestDist2 = d2; nearest = e; }
            }
            if (!nearest) break;
            nearest.takeDamage(chainDamage, ctx.element);
            // Jagged arc visual
            const from = origin.clone(); from.y = 1;
            const to = nearest.getPosition().clone(); to.y = 1;
            spawnJaggedBolt(ctx.scene, from, to, new Color(0.9, 0.9, 0.3), 0.15);
            spawnFx(ctx.scene, 'shockChainImpact', elementImpactConfig('storm', 0.6), to);
            origin = nearest.getPosition();
            excluded = nearest;
        }
    },
};

// =============================================================================
// Registry
// =============================================================================

export const POWER_DEFS: Record<string, PowerDefinition> = {
    // Mage spells (keep legacy ids for startPower references)
    mage_fire:     mageFireDef,
    mage_ice:      mageIceDef,
    mage_arcane:   mageArcaneDef,
    mage_physical: magePhysicalDef,
    mage_storm:    mageStormDef,
    // Ranger arrows
    ranger_fire:     rangerFireDef,
    ranger_ice:      rangerIceDef,
    ranger_arcane:   rangerArcaneDef,
    ranger_physical: rangerPhysicalDef,
    ranger_storm:    rangerStormDef,
    // Barbarian enchantments
    barbarian_fire:     barbarianFireDef,
    barbarian_ice:      barbarianIceDef,
    barbarian_arcane:   barbarianArcaneDef,
    barbarian_physical: barbarianPhysicalDef,
    barbarian_storm:    barbarianStormDef,
};

// ─────────────────────────────────────────────────────────────────────────────
// Class-keyed power map
// ─────────────────────────────────────────────────────────────────────────────

const POWER_MAP: Record<ChampionType, Record<PowerElement, string>> = {
    barbarian: {
        fire:     'barbarian_fire',
        ice:      'barbarian_ice',
        arcane:   'barbarian_arcane',
        physical: 'barbarian_physical',
        storm:    'barbarian_storm',
    },
    ranger: {
        fire:     'ranger_fire',
        ice:      'ranger_ice',
        arcane:   'ranger_arcane',
        physical: 'ranger_physical',
        storm:    'ranger_storm',
    },
    mage: {
        fire:     'mage_fire',
        ice:      'mage_ice',
        arcane:   'mage_arcane',
        physical: 'mage_physical',
        storm:    'mage_storm',
    },
};

export function getPowerByElementAndClass(element: PowerElement, type: ChampionType): PowerDefinition {
    return POWER_DEFS[POWER_MAP[type][element]];
}

/** @deprecated Use getPowerByElementAndClass instead. */
export function getPowerByElement(element: PowerElement): PowerDefinition {
    return POWER_DEFS[POWER_MAP['mage'][element]];
}

export function getPowerMapForClass(type: ChampionType): Record<PowerElement, string> {
    return POWER_MAP[type];
}
