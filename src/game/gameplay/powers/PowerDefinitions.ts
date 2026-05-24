import { Scene, Vector3, MeshBuilder, Color3 } from '@babylonjs/core';
import { Enemy } from '../enemies/Enemy';
import { StatusEffect } from '../GameTypes';
import { getCachedMaterial } from '../../rendering/MaterialCache';
import { acquireProjectile, releaseProjectile } from '../../rendering/ProjectilePool';

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

        const proj = acquireProjectile(ctx.scene, 'fireball_proj', () =>
            MeshBuilder.CreateSphere('fireballProj', { diameter: 0.5 }, ctx.scene));
        proj.position.copyFrom(ctx.heroPosition);
        proj.position.y = 1;
        proj.material = getCachedMaterial(ctx.scene, 'fireball_proj_mat', m => {
            m.emissiveColor = new Color3(1, 0.3, 0);
        });

        const target = best;
        const damage = mageFireDef.damageFor(state) * ctx.damageMultiplier;
        const speed = 18;
        const observer = ctx.scene.onBeforeRenderObservable.add(() => {
            if (!target.isAlive()) {
                releaseProjectile('fireball_proj', proj);
                ctx.scene.onBeforeRenderObservable.remove(observer);
                return;
            }
            const tp = target.getPosition().clone(); tp.y = 1;
            const dir = tp.subtract(proj.position);
            const dist = dir.length();
            if (dist < 0.5) {
                target.takeDamage(damage);
                target.applyStatusEffect(StatusEffect.BURNING, 3, 3.0);
                releaseProjectile('fireball_proj', proj);
                ctx.scene.onBeforeRenderObservable.remove(observer);
                return;
            }
            const dt = ctx.scene.getEngine().getDeltaTime() / 1000;
            proj.position.addInPlace(dir.normalize().scale(Math.min(dist, speed * dt)));
        });
        setTimeout(() => {
            releaseProjectile('fireball_proj', proj);
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

        const proj = acquireProjectile(ctx.scene, 'frost_proj', () =>
            MeshBuilder.CreateSphere('frostProj', { diameter: 0.4 }, ctx.scene));
        proj.position.copyFrom(ctx.heroPosition);
        proj.position.y = 1;
        proj.material = getCachedMaterial(ctx.scene, 'frost_proj_mat', m => {
            m.emissiveColor = new Color3(0.3, 0.7, 1.0);
        });

        const target = best;
        const damage = mageIceDef.damageFor(state) * ctx.damageMultiplier;
        const speed = 20;
        const observer = ctx.scene.onBeforeRenderObservable.add(() => {
            if (!target.isAlive()) {
                releaseProjectile('frost_proj', proj);
                ctx.scene.onBeforeRenderObservable.remove(observer);
                return;
            }
            const tp = target.getPosition().clone(); tp.y = 1;
            const dir = tp.subtract(proj.position);
            const dist = dir.length();
            if (dist < 0.4) {
                target.takeDamage(damage);
                target.applyStatusEffect(StatusEffect.SLOWED, 2, 0.5);
                releaseProjectile('frost_proj', proj);
                ctx.scene.onBeforeRenderObservable.remove(observer);
                return;
            }
            const dt = ctx.scene.getEngine().getDeltaTime() / 1000;
            proj.position.addInPlace(dir.normalize().scale(Math.min(dist, speed * dt)));
        });
        setTimeout(() => {
            releaseProjectile('frost_proj', proj);
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
        const blades = state.data['blades'] as { mesh: ReturnType<typeof MeshBuilder.CreateBox>; angle: number }[] | undefined;
        if (!blades) return;

        const orbitRadius = (state.data['orbitRadius'] as number) ?? magePhysicalDef.baseRange;
        const rotateSpeed = 2.5;
        const tickDt = ctx.scene.getEngine().getDeltaTime() / 1000;
        const damage = magePhysicalDef.damageFor(state) * ctx.damageMultiplier;

        for (const blade of blades) {
            blade.angle += rotateSpeed * tickDt;
            blade.mesh.position.set(
                ctx.heroPosition.x + Math.cos(blade.angle) * orbitRadius,
                1.0,
                ctx.heroPosition.z + Math.sin(blade.angle) * orbitRadius,
            );
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

        for (const seg of hitOrder) {
            const mid = seg.from.add(seg.to).scale(0.5);
            const len = Vector3.Distance(seg.from, seg.to);
            if (len < 0.1) continue;
            const line = MeshBuilder.CreateBox(`lightning_${Math.random()}`, {
                width: 0.08, height: 0.08, depth: len,
            }, ctx.scene);
            line.position.copyFrom(mid);
            line.position.y = 1;
            const dir = seg.to.subtract(seg.from).normalize();
            line.rotation.y = Math.atan2(dir.x, dir.z);
            line.material = getCachedMaterial(ctx.scene, 'lightning_mat', m => {
                m.emissiveColor = new Color3(0.7, 0.7, 1.0);
            });
            setTimeout(() => { if (!line.isDisposed()) line.dispose(); }, 200);
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

        const proj = acquireProjectile(ctx.scene, 'fire_arrow_proj', () =>
            MeshBuilder.CreateSphere('fireArrowProj', { diameter: 0.3 }, ctx.scene));
        proj.position.copyFrom(ctx.heroPosition);
        proj.position.y = 1;
        proj.material = getCachedMaterial(ctx.scene, 'fire_arrow_proj_mat', m => {
            m.emissiveColor = new Color3(1, 0.5, 0.1);
        });

        const target = best;
        const damage = rangerFireDef.damageFor(state) * ctx.damageMultiplier;
        const aoeRadius = 2.5;
        const speed = 22;
        const enemies = ctx.enemies;

        const observer = ctx.scene.onBeforeRenderObservable.add(() => {
            if (!target.isAlive()) {
                // Explode at last position
                explodeFireArrow(proj.position.clone(), damage, aoeRadius, enemies, ctx.scene);
                releaseProjectile('fire_arrow_proj', proj);
                ctx.scene.onBeforeRenderObservable.remove(observer);
                return;
            }
            const tp = target.getPosition().clone(); tp.y = 1;
            const dir = tp.subtract(proj.position);
            const dist = dir.length();
            if (dist < 0.5) {
                explodeFireArrow(proj.position.clone(), damage, aoeRadius, enemies, ctx.scene);
                releaseProjectile('fire_arrow_proj', proj);
                ctx.scene.onBeforeRenderObservable.remove(observer);
                return;
            }
            const dt = ctx.scene.getEngine().getDeltaTime() / 1000;
            proj.position.addInPlace(dir.normalize().scale(Math.min(dist, speed * dt)));
        });
        setTimeout(() => {
            explodeFireArrow(proj.position.clone(), damage, aoeRadius, enemies, ctx.scene);
            releaseProjectile('fire_arrow_proj', proj);
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

        const proj = acquireProjectile(ctx.scene, 'frost_arrow_proj', () =>
            MeshBuilder.CreateSphere('frostArrowProj', { diameter: 0.3 }, ctx.scene));
        proj.position.copyFrom(ctx.heroPosition);
        proj.position.y = 1;
        proj.material = getCachedMaterial(ctx.scene, 'frost_arrow_proj_mat', m => {
            m.emissiveColor = new Color3(0.3, 0.8, 1.0);
        });

        const damage = rangerIceDef.damageFor(state) * ctx.damageMultiplier;
        const speed = 26;
        const maxPierces = 2;
        let pierceCount = 0;
        let traveledDist = 0;
        const hitEnemies = new Set<Enemy>();

        const observer = ctx.scene.onBeforeRenderObservable.add(() => {
            const dt = ctx.scene.getEngine().getDeltaTime() / 1000;
            const step = speed * dt;
            traveledDist += step;
            proj.position.addInPlace(direction.scale(step));

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
                releaseProjectile('frost_arrow_proj', proj);
                ctx.scene.onBeforeRenderObservable.remove(observer);
            }
        });
        setTimeout(() => {
            releaseProjectile('frost_arrow_proj', proj);
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

        const proj = acquireProjectile(ctx.scene, 'seek_arrow_proj', () =>
            MeshBuilder.CreateSphere('seekArrowProj', { diameter: 0.3 }, ctx.scene));
        proj.position.copyFrom(ctx.heroPosition);
        proj.position.y = 1;
        proj.material = getCachedMaterial(ctx.scene, 'seek_arrow_proj_mat', m => {
            m.emissiveColor = new Color3(0.7, 0.3, 1.0);
        });

        const target = best;
        const damage = rangerArcaneDef.damageFor(state) * ctx.damageMultiplier;
        const speed = 18;
        const turnSpeed = 4.0; // how fast it curves (radians/sec)
        let velDir = target.getPosition().subtract(ctx.heroPosition);
        velDir.y = 0;
        velDir.normalize();

        const observer = ctx.scene.onBeforeRenderObservable.add(() => {
            if (!target.isAlive()) {
                releaseProjectile('seek_arrow_proj', proj);
                ctx.scene.onBeforeRenderObservable.remove(observer);
                return;
            }
            const tp = target.getPosition().clone(); tp.y = 1;
            const toTarget = tp.subtract(proj.position);
            const dist = toTarget.length();
            if (dist < 0.5) {
                target.takeDamage(damage);
                releaseProjectile('seek_arrow_proj', proj);
                ctx.scene.onBeforeRenderObservable.remove(observer);
                return;
            }
            const dt = ctx.scene.getEngine().getDeltaTime() / 1000;
            const desired = toTarget.normalize();
            // Lerp velocity direction toward target
            velDir = Vector3.Lerp(velDir, desired, Math.min(1, turnSpeed * dt));
            velDir.y = 0;
            velDir.normalize();
            proj.position.addInPlace(velDir.scale(speed * dt));
        });
        setTimeout(() => {
            releaseProjectile('seek_arrow_proj', proj);
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

        const proj = acquireProjectile(ctx.scene, 'pierce_proj', () =>
            MeshBuilder.CreateSphere('pierceProj', { diameter: 0.3 }, ctx.scene));
        proj.position.copyFrom(ctx.heroPosition);
        proj.position.y = 1;
        proj.material = getCachedMaterial(ctx.scene, 'pierce_proj_mat', m => {
            m.emissiveColor = new Color3(0.9, 0.9, 0.9);
        });

        const damage = rangerPhysicalDef.damageFor(state) * ctx.damageMultiplier;
        const speed = 28;
        const hitEnemies = new Set<Enemy>();
        let traveledDist = 0;

        const observer = ctx.scene.onBeforeRenderObservable.add(() => {
            const dt = ctx.scene.getEngine().getDeltaTime() / 1000;
            const step = speed * dt;
            traveledDist += step;
            proj.position.addInPlace(direction.scale(step));

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
                releaseProjectile('pierce_proj', proj);
                ctx.scene.onBeforeRenderObservable.remove(observer);
            }
        });
        setTimeout(() => {
            releaseProjectile('pierce_proj', proj);
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

        const proj = acquireProjectile(ctx.scene, 'lightning_arrow_proj', () =>
            MeshBuilder.CreateSphere('lightningArrowProj', { diameter: 0.3 }, ctx.scene));
        proj.position.copyFrom(ctx.heroPosition);
        proj.position.y = 1;
        proj.material = getCachedMaterial(ctx.scene, 'lightning_arrow_proj_mat', m => {
            m.emissiveColor = new Color3(0.7, 0.7, 1.0);
        });

        const target = best;
        const damage = rangerStormDef.damageFor(state) * ctx.damageMultiplier;
        const speed = 24;
        const allEnemies = ctx.enemies;

        const observer = ctx.scene.onBeforeRenderObservable.add(() => {
            if (!target.isAlive()) {
                chainLightning(target.getPosition(), damage, allEnemies, target, ctx.scene);
                releaseProjectile('lightning_arrow_proj', proj);
                ctx.scene.onBeforeRenderObservable.remove(observer);
                return;
            }
            const tp = target.getPosition().clone(); tp.y = 1;
            const dir = tp.subtract(proj.position);
            const dist = dir.length();
            if (dist < 0.5) {
                target.takeDamage(damage);
                chainLightning(target.getPosition(), damage, allEnemies, target, ctx.scene);
                releaseProjectile('lightning_arrow_proj', proj);
                ctx.scene.onBeforeRenderObservable.remove(observer);
                return;
            }
            const dt = ctx.scene.getEngine().getDeltaTime() / 1000;
            proj.position.addInPlace(dir.normalize().scale(Math.min(dist, speed * dt)));
        });
        setTimeout(() => {
            releaseProjectile('lightning_arrow_proj', proj);
            ctx.scene.onBeforeRenderObservable.remove(observer);
        }, 4000);
    },
};

function chainLightning(fromPos: Vector3, damage: number, enemies: Enemy[], exclude: Enemy, scene: Scene): void {
    const chainRadius = 4;
    const chainDamage = damage * 0.6;
    let origin = fromPos;
    let excluded = exclude;

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
        // Brief arc visual
        const from = origin.clone(); from.y = 1;
        const to = nearest.getPosition().clone(); to.y = 1;
        const mid = from.add(to).scale(0.5);
        const len = Vector3.Distance(from, to);
        if (len > 0.1) {
            const arc = MeshBuilder.CreateBox(`lArrow_chain_${Math.random()}`, { width: 0.06, height: 0.06, depth: len }, scene);
            arc.position.copyFrom(mid);
            arc.rotation.y = Math.atan2(to.x - from.x, to.z - from.z);
            arc.material = getCachedMaterial(scene, 'lightning_arc_mat', m => {
                m.emissiveColor = new Color3(0.6, 0.6, 1.0);
            });
            setTimeout(() => { if (!arc.isDisposed()) arc.dispose(); }, 180);
        }
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
            // Arc visual
            const from = origin.clone(); from.y = 1;
            const to = nearest.getPosition().clone(); to.y = 1;
            const mid = from.add(to).scale(0.5);
            const len = Vector3.Distance(from, to);
            if (len > 0.1) {
                const arc = MeshBuilder.CreateBox(`shockChain_${Math.random()}`, { width: 0.06, height: 0.06, depth: len }, ctx.scene);
                arc.position.copyFrom(mid);
                arc.rotation.y = Math.atan2(to.x - from.x, to.z - from.z);
                arc.material = getCachedMaterial(ctx.scene, 'shock_chain_mat', m => {
                    m.emissiveColor = new Color3(0.9, 0.9, 0.3);
                });
                setTimeout(() => { if (!arc.isDisposed()) arc.dispose(); }, 150);
            }
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
