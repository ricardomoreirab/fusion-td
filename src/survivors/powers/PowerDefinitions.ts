import { Scene, Vector3, MeshBuilder, Color3, StandardMaterial, Mesh } from '@babylonjs/core';
import { Enemy } from '../enemies/Enemy';
import { StatusEffect } from '../GameTypes';
import { getCachedMaterial } from '../../engine/rendering/MaterialCache';
import { acquireProjectile, releaseProjectile } from '../../engine/rendering/ProjectilePool';

export type PowerElement = 'fire' | 'ice' | 'arcane' | 'physical' | 'storm';
export type ChampionType = 'barbarian' | 'ranger' | 'mage';

export interface PowerRuntimeState {
    level: number;
    cooldownRemaining: number;
    /** Optional persistent data for powers like Whirling Blades */
    data?: Record<string, unknown>;
}

export interface PowerContext {
    scene: Scene;
    heroPosition: Vector3;
    enemies: Enemy[];
    /** Combined damage multiplier from run perks + shop upgrades */
    damageMultiplier: number;
}

/** Called on each basic-attack hit for passive enchantment powers. */
export interface EnchantmentHitContext {
    scene: Scene;
    heroPosition: Vector3;
    enemies: Enemy[];
    /** Base damage of the basic attack (before multipliers). */
    baseDamage: number;
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
    /** Optional hook called once when the power is added to a slot */
    init?: (state: PowerRuntimeState, ctx: PowerContext) => void;
    /** Required for autocast; omitted for passive powers. */
    cast?: (state: PowerRuntimeState, ctx: PowerContext) => void;
    /** Required for passive enchantments; called on each basic-attack hit. */
    onHit?: (enemy: Enemy, level: number, ctx: EnchantmentHitContext) => void;
    /** For passive powers that add range to the melee swing (Heavy Strike). */
    rangeBonus?: (level: number) => number;
    cooldownFor: (state: PowerRuntimeState) => number;
    damageFor: (state: PowerRuntimeState) => number;
}

// =============================================================================
// VISUAL HELPERS
// =============================================================================

/**
 * Spawns a small fading trail particle behind a moving projectile.
 * Uses a low-poly sphere that fades out in `duration` seconds.
 */
function spawnTrailParticle(
    scene: Scene,
    position: Vector3,
    color: Color3,
    size: number = 0.15,
    duration: number = 0.3,
): void {
    const part = MeshBuilder.CreateSphere(
        `trail_${performance.now()}_${Math.random()}`,
        { diameter: size, segments: 3 },
        scene,
    ) as Mesh;
    part.position.copyFrom(position);
    // Share the trail material across every in-flight trail of the same color.
    // The previous code allocated a new StandardMaterial per call (~20 Hz per
    // projectile, several projectiles in flight) — that allocation churn was
    // the dominant GC pressure during sustained power use.
    const matKey = `trailMat_${color.r.toFixed(2)}_${color.g.toFixed(2)}_${color.b.toFixed(2)}`;
    part.material = getCachedMaterial(scene, matKey, m => {
        m.emissiveColor = color;
        m.diffuseColor = new Color3(0, 0, 0);
        m.alpha = 0.7;
    });
    const startScale = 1;
    let elapsed = 0;
    const obs = scene.onBeforeRenderObservable.add(() => {
        const dt = scene.getEngine().getDeltaTime() / 1000;
        elapsed += dt;
        const t = Math.min(elapsed / duration, 1);
        // Fade via mesh scale only (per-instance) — sharing the material means
        // we can no longer mutate alpha per particle.
        part.scaling.setAll(startScale * (1 - t));
        if (t >= 1) {
            part.dispose();
            scene.onBeforeRenderObservable.remove(obs);
        }
    });
}

// =============================================================================
// BOLT SEGMENT POOL — 30 pre-allocated unit-depth boxes (5 segs × 6 bolts).
// Boxes are created with depth=1.0; callers set scaling.z = segLen per use.
// =============================================================================

const BOLT_POOL_SIZE = 30;
const boltPool: Mesh[] = [];
let boltPoolInitialized = false;

function acquireBoltSegment(scene: Scene): Mesh {
    if (!boltPoolInitialized) {
        for (let i = 0; i < BOLT_POOL_SIZE; i++) {
            const box = MeshBuilder.CreateBox(
                `boltSeg${i}`,
                { width: 0.07, height: 0.07, depth: 1.0 },
                scene,
            ) as Mesh;
            box.setEnabled(false);
            boltPool.push(box);
        }
        boltPoolInitialized = true;
    }
    for (const b of boltPool) {
        if (!b.isEnabled()) {
            b.setEnabled(true);
            return b;
        }
    }
    // Fallback: pool exhausted — create one that will be disposed normally.
    return MeshBuilder.CreateBox(
        `boltSegX${performance.now()}`,
        { width: 0.07, height: 0.07, depth: 1.0 },
        scene,
    ) as Mesh;
}

function releaseBoltSegment(mesh: Mesh): void {
    if (boltPool.indexOf(mesh) >= 0) {
        mesh.setEnabled(false);
        mesh.scaling.setAll(1);
        mesh.rotation.set(0, 0, 0);
    } else {
        mesh.dispose();
    }
}

/**
 * Spawns a jagged (zigzag) lightning bolt between two positions using
 * 5 short box segments with random perpendicular offsets.
 * Segments are drawn from the module-level bolt pool to avoid per-bolt
 * mesh allocation churn.
 */
function spawnJaggedBolt(scene: Scene, from: Vector3, to: Vector3, color: Color3, duration: number = 0.2): void {
    const segments = 5;
    const meshes: Mesh[] = [];
    const dir = to.subtract(from);
    const length = dir.length();
    if (length < 0.1) return;
    const perp = new Vector3(-dir.z, 0, dir.x).normalize();
    const matKey = `jaggedBoltMat_${color.r.toFixed(1)}_${color.b.toFixed(1)}`;
    for (let i = 0; i < segments; i++) {
        const tStart = i / segments;
        const tEnd = (i + 1) / segments;
        const startP = from.add(dir.scale(tStart));
        const endP = from.add(dir.scale(tEnd));
        // Offset midpoint perpendicular (except endpoints)
        if (i > 0) startP.addInPlace(perp.scale((Math.random() - 0.5) * length * 0.15));
        if (i < segments - 1) endP.addInPlace(perp.scale((Math.random() - 0.5) * length * 0.15));
        const segMid = Vector3.Center(startP, endP);
        const segLen = Vector3.Distance(startP, endP);
        const segDir = endP.subtract(startP);
        const seg = acquireBoltSegment(scene);
        seg.scaling.z = segLen;
        seg.scaling.x = 1;
        seg.scaling.y = 1;
        seg.position.copyFrom(segMid);
        seg.rotation.y = Math.atan2(segDir.x, segDir.z);
        seg.material = getCachedMaterial(scene, matKey, m => {
            m.emissiveColor = color;
            m.alpha = 0.95;
        });
        meshes.push(seg);
    }
    let elapsed = 0;
    const obs = scene.onBeforeRenderObservable.add(() => {
        const dt = scene.getEngine().getDeltaTime() / 1000;
        elapsed += dt;
        const t = Math.min(elapsed / duration, 1);
        for (const m of meshes) {
            const mMat = m.material as StandardMaterial | null;
            if (mMat) mMat.alpha = 0.95 * (1 - t);
        }
        if (t >= 1) {
            for (const m of meshes) releaseBoltSegment(m);
            scene.onBeforeRenderObservable.remove(obs);
        }
    });
}

/**
 * Builds an arrow mesh: shaft cylinder + tip cone + fletch box,
 * all parented under the shaft. The shaft's rotation.x = PI/2 so
 * "forward" is the +Z axis (matching atan2 orientation in the observers).
 */
function buildArrowMesh(scene: Scene, key: string, color: Color3): Mesh {
    const shaft = MeshBuilder.CreateCylinder(
        `${key}_shaft`,
        { height: 0.6, diameterTop: 0.05, diameterBottom: 0.05, tessellation: 6 },
        scene,
    ) as Mesh;
    const tip = MeshBuilder.CreateCylinder(
        `${key}_tip`,
        { height: 0.18, diameterTop: 0, diameterBottom: 0.12, tessellation: 6 },
        scene,
    ) as Mesh;
    tip.position.y = 0.39;
    tip.parent = shaft;
    const fletch = MeshBuilder.CreateBox(
        `${key}_fletch`,
        { width: 0.13, height: 0.13, depth: 0.03 },
        scene,
    ) as Mesh;
    fletch.position.y = -0.30;
    fletch.parent = shaft;
    shaft.rotation.x = Math.PI / 2;
    const mat = getCachedMaterial(scene, `${key}_mat`, m => {
        m.emissiveColor = color;
        m.diffuseColor = new Color3(0, 0, 0);
    });
    shaft.material = mat;
    tip.material = mat;
    fletch.material = mat;
    return shaft;
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

        // Flame-shaped projectile: stretched outer cone + bright inner sphere
        const outerCone = MeshBuilder.CreateCylinder('fireballOuter', {
            height: 0.7, diameterTop: 0, diameterBottom: 0.4, tessellation: 8,
        }, ctx.scene) as Mesh;
        outerCone.position.copyFrom(ctx.heroPosition);
        outerCone.position.y = 1;
        outerCone.material = getCachedMaterial(ctx.scene, 'fireball_outer_mat', m => {
            m.emissiveColor = new Color3(1, 0.45, 0.05);
            m.diffuseColor = new Color3(0, 0, 0);
        });
        const innerSphere = MeshBuilder.CreateSphere('fireballInner', { diameter: 0.22, segments: 4 }, ctx.scene) as Mesh;
        innerSphere.material = getCachedMaterial(ctx.scene, 'fireball_inner_mat', m => {
            m.emissiveColor = new Color3(1, 0.85, 0.4);
            m.diffuseColor = new Color3(0, 0, 0);
        });
        innerSphere.parent = outerCone;

        const proj = outerCone;

        const target = best;
        const damage = mageFireDef.damageFor(state) * ctx.damageMultiplier;
        const speed = 18;
        const trailColor = new Color3(1, 0.25, 0);
        let lastTrailTime = 0;
        let flameTime = 0;

        const cleanup = () => {
            innerSphere.parent = null;
            innerSphere.dispose();
            outerCone.dispose();
        };

        const observer = ctx.scene.onBeforeRenderObservable.add(() => {
            if (!target.isAlive()) {
                cleanup();
                ctx.scene.onBeforeRenderObservable.remove(observer);
                return;
            }
            const dt = ctx.scene.getEngine().getDeltaTime() / 1000;
            flameTime += dt;
            lastTrailTime += dt;

            const tp = target.getPosition().clone(); tp.y = 1;
            const dir = tp.subtract(proj.position);
            const dist = dir.length();

            // Orient cone toward travel direction
            const dirN = dir.normalize();
            proj.rotation.y = Math.atan2(dirN.x, dirN.z);
            // Tip of cone points forward; cone is built along Y; rotate so Y aligns with dir
            proj.rotation.x = -Math.PI / 2;

            // Flame wobble on scale
            proj.scaling.y = 0.9 + 0.2 * Math.sin(flameTime * 40);

            // Trail particle
            if (lastTrailTime >= 0.05) {
                spawnTrailParticle(ctx.scene, proj.position.clone(), trailColor, 0.18, 0.3);
                lastTrailTime = 0;
            }

            if (dist < 0.5) {
                target.takeDamage(damage);
                target.applyStatusEffect(StatusEffect.BURNING, 3, 3.0);
                cleanup();
                ctx.scene.onBeforeRenderObservable.remove(observer);
                return;
            }
            proj.position.addInPlace(dirN.scale(Math.min(dist, speed * dt)));
        });
        setTimeout(() => {
            cleanup();
            ctx.scene.onBeforeRenderObservable.remove(observer);
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

        // Ice crystal: octahedron (polyhedron type 1) stretched along Y to look like an ice spear
        const proj = MeshBuilder.CreatePolyhedron('frostCrystal', { type: 1, size: 0.2 }, ctx.scene) as Mesh;
        proj.scaling.set(0.4, 1.5, 0.4);
        proj.position.copyFrom(ctx.heroPosition);
        proj.position.y = 1;
        proj.material = getCachedMaterial(ctx.scene, 'frost_proj_mat', m => {
            m.emissiveColor = new Color3(0.4, 0.8, 1.0);
            m.diffuseColor = new Color3(0, 0, 0);
        });

        const target = best;
        const damage = mageIceDef.damageFor(state) * ctx.damageMultiplier;
        const speed = 20;
        const trailColor = new Color3(0.5, 0.85, 1.0);
        let lastTrailTime = 0;
        let spinTime = 0;

        const observer = ctx.scene.onBeforeRenderObservable.add(() => {
            if (!target.isAlive()) {
                proj.dispose();
                ctx.scene.onBeforeRenderObservable.remove(observer);
                return;
            }
            const dt = ctx.scene.getEngine().getDeltaTime() / 1000;
            spinTime += dt;
            lastTrailTime += dt;

            const tp = target.getPosition().clone(); tp.y = 1;
            const dir = tp.subtract(proj.position);
            const dist = dir.length();

            // Rotate around long axis
            proj.rotation.y = spinTime * 5;

            // Trail particle
            if (lastTrailTime >= 0.05) {
                spawnTrailParticle(ctx.scene, proj.position.clone(), trailColor, 0.08, 0.3);
                lastTrailTime = 0;
            }

            if (dist < 0.4) {
                target.takeDamage(damage);
                target.applyStatusEffect(StatusEffect.SLOWED, 2, 0.5);
                proj.dispose();
                ctx.scene.onBeforeRenderObservable.remove(observer);
                return;
            }
            proj.position.addInPlace(dir.normalize().scale(Math.min(dist, speed * dt)));
        });
        setTimeout(() => {
            proj.dispose();
            ctx.scene.onBeforeRenderObservable.remove(observer);
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
                e.takeDamage(damage);
            }
        }

        const ring = MeshBuilder.CreateTorus('novaRing', {
            diameter: radius * 2,
            thickness: 0.25,
            tessellation: 32,
        }, ctx.scene);
        ring.position.copyFrom(ctx.heroPosition);
        ring.position.y = 0.3;
        ring.material = getCachedMaterial(ctx.scene, 'nova_ring_mat', m => {
            m.emissiveColor = new Color3(0.8, 0.3, 1.0);
            m.alpha = 0.7;
        });
        setTimeout(() => { if (!ring.isDisposed()) ring.dispose(); }, 350);

        // Swirling purple particles launched outward from ring edge
        const particleCount = 7;
        const purpleColor = new Color3(0.7, 0.2, 1.0);
        for (let i = 0; i < particleCount; i++) {
            const angle = (i / particleCount) * Math.PI * 2;
            const startX = ctx.heroPosition.x + Math.cos(angle) * radius;
            const startZ = ctx.heroPosition.z + Math.sin(angle) * radius;
            const startPos = new Vector3(startX, 0.3, startZ);

            const particle = MeshBuilder.CreateSphere(
                `arcaneNova_part_${i}_${Math.random()}`,
                { diameter: 0.18, segments: 3 },
                ctx.scene,
            ) as Mesh;
            particle.position.copyFrom(startPos);
            const pMat = new StandardMaterial(`arcaneNova_pMat_${i}_${Math.random()}`, ctx.scene);
            pMat.emissiveColor = purpleColor;
            pMat.diffuseColor = new Color3(0, 0, 0);
            pMat.alpha = 0.85;
            particle.material = pMat;

            const outDir = new Vector3(Math.cos(angle), 0, Math.sin(angle));
            const duration = 0.35;
            const outSpeed = radius * 1.5;
            let elapsed = 0;
            const pObs = ctx.scene.onBeforeRenderObservable.add(() => {
                const dt = ctx.scene.getEngine().getDeltaTime() / 1000;
                elapsed += dt;
                const t = Math.min(elapsed / duration, 1);
                particle.position.addInPlace(outDir.scale(outSpeed * dt));
                pMat.alpha = 0.85 * (1 - t);
                particle.scaling.setAll(1 - t * 0.5);
                if (t >= 1) {
                    particle.dispose();
                    pMat.dispose();
                    ctx.scene.onBeforeRenderObservable.remove(pObs);
                }
            });
        }
    },
};

// ─────────────────────────────────────────────────────────────────────────────
// Whirling Blades — persistent orbiting blades
// ─────────────────────────────────────────────────────────────────────────────
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
        const bladeCount = state.level >= 3 ? 3 : 2;
        const blades: { mesh: ReturnType<typeof MeshBuilder.CreateBox>; angle: number }[] = [];
        const bladeMat = getCachedMaterial(ctx.scene, 'whirling_blade_mat', m => {
            m.emissiveColor = new Color3(0.7, 0.7, 0.9);
        });
        for (let i = 0; i < bladeCount; i++) {
            const blade = MeshBuilder.CreateBox(`wbBlade_${i}`, { width: 0.2, height: 0.1, depth: 0.6 }, ctx.scene);
            blade.material = bladeMat;
            blades.push({ mesh: blade, angle: (i / bladeCount) * Math.PI * 2 });
        }
        if (!state.data) state.data = {};
        state.data['blades'] = blades;
        state.data['orbitRadius'] = magePhysicalDef.baseRange;
    },
    cast: (state, ctx) => {
        if (!state.data) return;
        const blades = state.data['blades'] as { mesh: ReturnType<typeof MeshBuilder.CreateBox>; angle: number; lastTrail?: number }[] | undefined;
        if (!blades) return;

        const orbitRadius = (state.data['orbitRadius'] as number) ?? magePhysicalDef.baseRange;
        const rotateSpeed = 2.5;
        const tickDt = ctx.scene.getEngine().getDeltaTime() / 1000;
        const damage = magePhysicalDef.damageFor(state) * ctx.damageMultiplier;
        const sparkleColor = new Color3(0.8, 0.8, 1.0);

        for (const blade of blades) {
            blade.angle += rotateSpeed * tickDt;
            blade.mesh.position.set(
                ctx.heroPosition.x + Math.cos(blade.angle) * orbitRadius,
                1.0,
                ctx.heroPosition.z + Math.sin(blade.angle) * orbitRadius,
            );
            // Sparkle trail every ~0.1s
            if (blade.lastTrail === undefined) blade.lastTrail = 0;
            blade.lastTrail += tickDt;
            if (blade.lastTrail >= 0.1) {
                spawnTrailParticle(ctx.scene, blade.mesh.position.clone(), sparkleColor, 0.1, 0.25);
                blade.lastTrail = 0;
            }
        }

        const hitSet = new Set<Enemy>();
        for (const blade of blades) {
            for (const e of ctx.enemies) {
                if (!e.isAlive() || hitSet.has(e)) continue;
                const dx = e.getPosition().x - blade.mesh.position.x;
                const dz = e.getPosition().z - blade.mesh.position.z;
                if (Math.hypot(dx, dz) < 0.8) {
                    e.takeDamage(damage);
                    hitSet.add(e);
                }
            }
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
        current.takeDamage(damage);
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
            next.takeDamage(damage * 0.75);
            hitSet.add(next);
            current = next;
        }

        const boltColor = new Color3(0.7, 0.7, 1.0);
        for (const seg of hitOrder) {
            const from = seg.from.clone(); from.y = 1;
            const to = seg.to.clone(); to.y = 1;
            spawnJaggedBolt(ctx.scene, from, to, boltColor, 0.2);
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

        // Fire arrow: orange arrow with two small flame cones parented to shaft
        const arrowColor = new Color3(1, 0.4, 0.05);
        const proj = buildArrowMesh(ctx.scene, `fire_arrow_${Math.random()}`, arrowColor);
        proj.position.copyFrom(ctx.heroPosition);
        proj.position.y = 1;

        // Add two small flame cones flanking the tip
        const flameColor = new Color3(1, 0.6, 0.0);
        const flameMat = getCachedMaterial(ctx.scene, 'fire_arrow_flame_mat', m => {
            m.emissiveColor = flameColor;
            m.diffuseColor = new Color3(0, 0, 0);
        });
        for (let f = 0; f < 2; f++) {
            const flameC = MeshBuilder.CreateCylinder(`fire_arrow_flame_${f}_${Math.random()}`, {
                height: 0.25, diameterTop: 0, diameterBottom: 0.1, tessellation: 5,
            }, ctx.scene) as Mesh;
            flameC.material = flameMat;
            flameC.position.y = 0.22;
            flameC.position.x = (f === 0 ? 0.07 : -0.07);
            flameC.parent = proj;
        }

        const target = best;
        const damage = rangerFireDef.damageFor(state) * ctx.damageMultiplier;
        const aoeRadius = 2.5;
        const speed = 22;
        const enemies = ctx.enemies;
        const trailColor = new Color3(1, 0.3, 0);
        let lastTrailTime = 0;

        const cleanup = () => {
            // dispose children first
            proj.getChildMeshes().forEach(c => c.dispose());
            proj.dispose();
        };

        const observer = ctx.scene.onBeforeRenderObservable.add(() => {
            const dt = ctx.scene.getEngine().getDeltaTime() / 1000;
            lastTrailTime += dt;

            if (!target.isAlive()) {
                explodeFireArrow(proj.position.clone(), damage, aoeRadius, enemies, ctx.scene);
                cleanup();
                ctx.scene.onBeforeRenderObservable.remove(observer);
                return;
            }
            const tp = target.getPosition().clone(); tp.y = 1;
            const dir = tp.subtract(proj.position);
            const dist = dir.length();
            const dirN = dir.normalize();

            // Orient arrow toward travel direction
            proj.rotation.y = Math.atan2(dirN.x, dirN.z);

            // Trail
            if (lastTrailTime >= 0.05) {
                spawnTrailParticle(ctx.scene, proj.position.clone(), trailColor, 0.14, 0.3);
                lastTrailTime = 0;
            }

            if (dist < 0.5) {
                explodeFireArrow(proj.position.clone(), damage, aoeRadius, enemies, ctx.scene);
                cleanup();
                ctx.scene.onBeforeRenderObservable.remove(observer);
                return;
            }
            proj.position.addInPlace(dirN.scale(Math.min(dist, speed * dt)));
        });
        setTimeout(() => {
            explodeFireArrow(proj.position.clone(), damage, aoeRadius, enemies, ctx.scene);
            cleanup();
            ctx.scene.onBeforeRenderObservable.remove(observer);
        }, 4000);
    },
};

function explodeFireArrow(pos: Vector3, damage: number, radius: number, enemies: Enemy[], scene: Scene): void {
    for (const e of enemies) {
        if (!e.isAlive()) continue;
        const dx = e.getPosition().x - pos.x;
        const dz = e.getPosition().z - pos.z;
        if (Math.hypot(dx, dz) <= radius) {
            e.takeDamage(damage);
            e.applyStatusEffect(StatusEffect.BURNING, 2.5, 2.5);
        }
    }
    // Burst ring visual
    const ring = MeshBuilder.CreateTorus('fireExplosion', { diameter: radius * 2, thickness: 0.3, tessellation: 16 }, scene);
    ring.position.copyFrom(pos);
    ring.position.y = 0.3;
    ring.material = getCachedMaterial(scene, 'fire_explosion_mat', m => {
        m.emissiveColor = new Color3(1, 0.4, 0);
        m.alpha = 0.8;
    });
    setTimeout(() => { if (!ring.isDisposed()) ring.dispose(); }, 250);
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

        const direction = best.getPosition().subtract(ctx.heroPosition);
        direction.y = 0;
        direction.normalize();

        // Frost arrow: cyan arrow with a small ice crystal parented behind the tip
        const arrowColor = new Color3(0.4, 0.85, 1.0);
        const proj = buildArrowMesh(ctx.scene, `frost_arrow_${Math.random()}`, arrowColor);
        proj.position.copyFrom(ctx.heroPosition);
        proj.position.y = 1;

        // Small octahedron crystal attached near the tip
        const crystal = MeshBuilder.CreatePolyhedron(
            `frost_arrow_crystal_${Math.random()}`,
            { type: 1, size: 0.07 },
            ctx.scene,
        ) as Mesh;
        crystal.material = getCachedMaterial(ctx.scene, 'frost_arrow_crystal_mat', m => {
            m.emissiveColor = new Color3(0.6, 0.9, 1.0);
            m.diffuseColor = new Color3(0, 0, 0);
        });
        crystal.position.y = 0.25;
        crystal.parent = proj;

        // Orient arrow toward travel direction from the start
        proj.rotation.y = Math.atan2(direction.x, direction.z);

        const damage = rangerIceDef.damageFor(state) * ctx.damageMultiplier;
        const speed = 26;
        const maxPierces = 2;
        let pierceCount = 0;
        let traveledDist = 0;
        let lastTrailTime = 0;
        const hitEnemies = new Set<Enemy>();
        const trailColor = new Color3(0.5, 0.9, 1.0);

        const cleanup = () => {
            proj.getChildMeshes().forEach(c => c.dispose());
            proj.dispose();
        };

        const observer = ctx.scene.onBeforeRenderObservable.add(() => {
            const dt = ctx.scene.getEngine().getDeltaTime() / 1000;
            const step = speed * dt;
            traveledDist += step;
            lastTrailTime += dt;
            proj.position.addInPlace(direction.scale(step));

            // Spin the crystal
            crystal.rotation.y += dt * 6;

            // Trail
            if (lastTrailTime >= 0.05) {
                spawnTrailParticle(ctx.scene, proj.position.clone(), trailColor, 0.1, 0.3);
                lastTrailTime = 0;
            }

            for (const e of ctx.enemies) {
                if (!e.isAlive() || hitEnemies.has(e)) continue;
                const dx = e.getPosition().x - proj.position.x;
                const dz = e.getPosition().z - proj.position.z;
                if (Math.hypot(dx, dz) < 0.6) {
                    e.takeDamage(damage);
                    e.applyStatusEffect(StatusEffect.SLOWED, 1.5, 0.5);
                    hitEnemies.add(e);
                    pierceCount++;
                }
            }

            if (traveledDist >= rangerIceDef.baseRange || pierceCount >= maxPierces) {
                cleanup();
                ctx.scene.onBeforeRenderObservable.remove(observer);
            }
        });
        setTimeout(() => {
            cleanup();
            ctx.scene.onBeforeRenderObservable.remove(observer);
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

        // Seeking arrow: purple arrow with a small orbiting purple sphere
        const arrowColor = new Color3(0.7, 0.3, 1.0);
        const proj = buildArrowMesh(ctx.scene, `seek_arrow_${Math.random()}`, arrowColor);
        proj.position.copyFrom(ctx.heroPosition);
        proj.position.y = 1;

        // Small orbiting purple sphere attached to shaft
        const orb = MeshBuilder.CreateSphere(`seek_orb_${Math.random()}`, { diameter: 0.12, segments: 4 }, ctx.scene) as Mesh;
        orb.material = getCachedMaterial(ctx.scene, 'seek_orb_mat', m => {
            m.emissiveColor = new Color3(0.9, 0.4, 1.0);
            m.diffuseColor = new Color3(0, 0, 0);
        });
        orb.parent = proj;

        const target = best;
        const damage = rangerArcaneDef.damageFor(state) * ctx.damageMultiplier;
        const speed = 18;
        const turnSpeed = 4.0;
        let velDir = target.getPosition().subtract(ctx.heroPosition);
        velDir.y = 0;
        velDir.normalize();
        let orbAngle = 0;
        let lastTrailTime = 0;
        const trailColor = new Color3(0.6, 0.2, 1.0);

        const cleanup = () => {
            proj.getChildMeshes().forEach(c => c.dispose());
            proj.dispose();
        };

        const observer = ctx.scene.onBeforeRenderObservable.add(() => {
            const dt = ctx.scene.getEngine().getDeltaTime() / 1000;
            lastTrailTime += dt;
            orbAngle += dt * 8;

            if (!target.isAlive()) {
                cleanup();
                ctx.scene.onBeforeRenderObservable.remove(observer);
                return;
            }
            const tp = target.getPosition().clone(); tp.y = 1;
            const toTarget = tp.subtract(proj.position);
            const dist = toTarget.length();

            // Orient arrow toward velocity
            proj.rotation.y = Math.atan2(velDir.x, velDir.z);

            // Orbit the sphere around shaft
            orb.position.x = Math.cos(orbAngle) * 0.22;
            orb.position.z = Math.sin(orbAngle) * 0.22;
            orb.position.y = 0;

            // Trail
            if (lastTrailTime >= 0.05) {
                spawnTrailParticle(ctx.scene, proj.position.clone(), trailColor, 0.12, 0.3);
                lastTrailTime = 0;
            }

            if (dist < 0.5) {
                target.takeDamage(damage);
                cleanup();
                ctx.scene.onBeforeRenderObservable.remove(observer);
                return;
            }
            const desired = toTarget.normalize();
            // Lerp velocity direction toward target
            velDir = Vector3.Lerp(velDir, desired, Math.min(1, turnSpeed * dt));
            velDir.y = 0;
            velDir.normalize();
            proj.position.addInPlace(velDir.scale(speed * dt));
        });
        setTimeout(() => {
            cleanup();
            ctx.scene.onBeforeRenderObservable.remove(observer);
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

        const direction = best.getPosition().subtract(ctx.heroPosition);
        direction.y = 0;
        direction.normalize();

        // Piercing Shot: large bright white-silver arrow (scale 1.3), clean and fast
        const arrowColor = new Color3(0.95, 0.95, 0.95);
        const proj = buildArrowMesh(ctx.scene, `pierce_arrow_${Math.random()}`, arrowColor);
        proj.scaling.setAll(1.3);
        proj.position.copyFrom(ctx.heroPosition);
        proj.position.y = 1;

        // Orient arrow to face travel direction
        proj.rotation.y = Math.atan2(direction.x, direction.z);

        const damage = rangerPhysicalDef.damageFor(state) * ctx.damageMultiplier;
        const speed = 28;
        const hitEnemies = new Set<Enemy>();
        let traveledDist = 0;
        let lastTrailTime = 0;
        const trailColor = new Color3(0.85, 0.85, 1.0);

        const cleanup = () => {
            proj.getChildMeshes().forEach(c => c.dispose());
            proj.dispose();
        };

        const observer = ctx.scene.onBeforeRenderObservable.add(() => {
            const dt = ctx.scene.getEngine().getDeltaTime() / 1000;
            const step = speed * dt;
            traveledDist += step;
            lastTrailTime += dt;
            proj.position.addInPlace(direction.scale(step));

            // Subtle silver trail
            if (lastTrailTime >= 0.05) {
                spawnTrailParticle(ctx.scene, proj.position.clone(), trailColor, 0.12, 0.2);
                lastTrailTime = 0;
            }

            for (const e of ctx.enemies) {
                if (!e.isAlive() || hitEnemies.has(e)) continue;
                const dx = e.getPosition().x - proj.position.x;
                const dz = e.getPosition().z - proj.position.z;
                if (Math.hypot(dx, dz) < 0.6) {
                    e.takeDamage(damage);
                    hitEnemies.add(e);
                }
            }

            if (traveledDist >= rangerPhysicalDef.baseRange) {
                cleanup();
                ctx.scene.onBeforeRenderObservable.remove(observer);
            }
        });
        setTimeout(() => {
            cleanup();
            ctx.scene.onBeforeRenderObservable.remove(observer);
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

        // Lightning Arrow: yellow arrow with a small flickering zigzag bolt above the shaft
        const arrowColor = new Color3(1.0, 0.95, 0.4);
        const proj = buildArrowMesh(ctx.scene, `lightning_arrow_${Math.random()}`, arrowColor);
        proj.position.copyFrom(ctx.heroPosition);
        proj.position.y = 1;

        // Small decorative zigzag box above the shaft representing stored electricity
        const staticBolt = MeshBuilder.CreateBox(`lightning_arrow_bolt_${Math.random()}`, {
            width: 0.06, height: 0.06, depth: 0.35,
        }, ctx.scene) as Mesh;
        staticBolt.material = getCachedMaterial(ctx.scene, 'lightning_arrow_bolt_mat', m => {
            m.emissiveColor = new Color3(0.8, 1.0, 0.4);
            m.diffuseColor = new Color3(0, 0, 0);
        });
        staticBolt.position.y = 0.12;
        staticBolt.position.z = 0;
        staticBolt.parent = proj;

        const target = best;
        const damage = rangerStormDef.damageFor(state) * ctx.damageMultiplier;
        const speed = 24;
        const allEnemies = ctx.enemies;
        const trailColor = new Color3(1.0, 0.9, 0.3);
        let lastTrailTime = 0;
        let boltFlicker = 0;

        const cleanup = () => {
            proj.getChildMeshes().forEach(c => c.dispose());
            proj.dispose();
        };

        const observer = ctx.scene.onBeforeRenderObservable.add(() => {
            const dt = ctx.scene.getEngine().getDeltaTime() / 1000;
            lastTrailTime += dt;
            boltFlicker += dt;

            // Flicker the decorative bolt's scale
            staticBolt.scaling.x = 0.8 + 0.4 * Math.sin(boltFlicker * 35);

            if (!target.isAlive()) {
                chainLightning(target.getPosition(), damage, allEnemies, target, ctx.scene);
                cleanup();
                ctx.scene.onBeforeRenderObservable.remove(observer);
                return;
            }
            const tp = target.getPosition().clone(); tp.y = 1;
            const dir = tp.subtract(proj.position);
            const dist = dir.length();
            const dirN = dir.normalize();

            // Orient arrow toward travel direction
            proj.rotation.y = Math.atan2(dirN.x, dirN.z);

            // Trail
            if (lastTrailTime >= 0.05) {
                spawnTrailParticle(ctx.scene, proj.position.clone(), trailColor, 0.13, 0.25);
                lastTrailTime = 0;
            }

            if (dist < 0.5) {
                target.takeDamage(damage);
                chainLightning(target.getPosition(), damage, allEnemies, target, ctx.scene);
                cleanup();
                ctx.scene.onBeforeRenderObservable.remove(observer);
                return;
            }
            proj.position.addInPlace(dirN.scale(Math.min(dist, speed * dt)));
        });
        setTimeout(() => {
            cleanup();
            ctx.scene.onBeforeRenderObservable.remove(observer);
        }, 4000);
    },
};

function chainLightning(fromPos: Vector3, damage: number, enemies: Enemy[], exclude: Enemy, scene: Scene): void {
    const chainRadius = 4;
    const chainDamage = damage * 0.6;
    let origin = fromPos;
    let excluded = exclude;
    const chainBoltColor = new Color3(0.6, 0.6, 1.0);

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
        nearest.takeDamage(chainDamage);
        // Jagged arc visual
        const from = origin.clone(); from.y = 1;
        const to = nearest.getPosition().clone(); to.y = 1;
        spawnJaggedBolt(scene, from, to, chainBoltColor, 0.18);
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
    onHit: (enemy, level, ctx) => {
        const dotStrength = ctx.baseDamage * 0.3 * level;
        enemy.applyStatusEffect(StatusEffect.BURNING, 2, dotStrength);
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
    onHit: (enemy, level) => {
        const slowMult = Math.max(0.4, 0.65 - level * 0.05);
        enemy.applyStatusEffect(StatusEffect.SLOWED, 1.5, slowMult);
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
    onHit: (enemy, level, ctx) => {
        const bonusDamage = ctx.baseDamage * 0.20 * level;
        enemy.takeDamage(bonusDamage);
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
    onHit: (enemy, level, ctx) => {
        const bonusDamage = ctx.baseDamage * 0.25 * level;
        enemy.takeDamage(bonusDamage);
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
            nearest.takeDamage(chainDamage);
            // Jagged arc visual
            const from = origin.clone(); from.y = 1;
            const to = nearest.getPosition().clone(); to.y = 1;
            spawnJaggedBolt(ctx.scene, from, to, new Color3(0.9, 0.9, 0.3), 0.15);
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
