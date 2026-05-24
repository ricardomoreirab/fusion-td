import { Scene, Vector3, MeshBuilder, StandardMaterial, Color3 } from '@babylonjs/core';
import { Enemy } from '../enemies/Enemy';
import { StatusEffect } from '../towers/Tower';

export type PowerElement = 'fire' | 'ice' | 'arcane' | 'physical' | 'storm';

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
    /** Optional hook called once when the power is added to a slot */
    init?: (state: PowerRuntimeState, ctx: PowerContext) => void;
    cast: (state: PowerRuntimeState, ctx: PowerContext) => void;
    cooldownFor: (state: PowerRuntimeState) => number;
    damageFor: (state: PowerRuntimeState) => number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Fireball — fire projectile
// ─────────────────────────────────────────────────────────────────────────────
const fireballDef: PowerDefinition = {
    id: 'fireball',
    name: 'Fireball',
    element: 'fire',
    icon: 'F',
    baseCooldown: 1.4,
    baseDamage: 14,
    baseRange: 12,
    maxLevel: 5,
    cooldownFor: (s) => fireballDef.baseCooldown * Math.pow(0.92, s.level - 1),
    damageFor:   (s) => fireballDef.baseDamage  * Math.pow(1.25, s.level - 1),
    cast: (state, ctx) => {
        let best: Enemy | null = null;
        let bestDist2 = fireballDef.baseRange * fireballDef.baseRange;
        for (const e of ctx.enemies) {
            if (!e.isAlive()) continue;
            const dx = e.getPosition().x - ctx.heroPosition.x;
            const dz = e.getPosition().z - ctx.heroPosition.z;
            const d2 = dx * dx + dz * dz;
            if (d2 < bestDist2) { bestDist2 = d2; best = e; }
        }
        if (!best) return;

        const proj = MeshBuilder.CreateSphere('fireballProj', { diameter: 0.5 }, ctx.scene);
        proj.position.copyFrom(ctx.heroPosition);
        proj.position.y = 1;
        const mat = new StandardMaterial('fireballMat', ctx.scene);
        mat.emissiveColor = new Color3(1, 0.3, 0);
        proj.material = mat;

        const target = best;
        const damage = fireballDef.damageFor(state) * ctx.damageMultiplier;
        const speed = 18;
        const observer = ctx.scene.onBeforeRenderObservable.add(() => {
            if (!target.isAlive()) {
                proj.dispose();
                ctx.scene.onBeforeRenderObservable.remove(observer);
                return;
            }
            const tp = target.getPosition().clone(); tp.y = 1;
            const dir = tp.subtract(proj.position);
            const dist = dir.length();
            if (dist < 0.5) {
                target.takeDamage(damage);
                // Apply burn DoT
                target.applyStatusEffect(StatusEffect.BURNING, 3, 3.0);
                proj.dispose();
                ctx.scene.onBeforeRenderObservable.remove(observer);
                return;
            }
            const dt = ctx.scene.getEngine().getDeltaTime() / 1000;
            proj.position.addInPlace(dir.normalize().scale(Math.min(dist, speed * dt)));
        });
        // Safety disposal after 4s
        setTimeout(() => {
            if (!proj.isDisposed()) proj.dispose();
            ctx.scene.onBeforeRenderObservable.remove(observer);
        }, 4000);
    },
};

// ─────────────────────────────────────────────────────────────────────────────
// Frost Shards — ice projectile + slow
// ─────────────────────────────────────────────────────────────────────────────
const frostShardsDef: PowerDefinition = {
    id: 'frost_shards',
    name: 'Frost Shards',
    element: 'ice',
    icon: 'I',
    baseCooldown: 1.2,
    baseDamage: 9,
    baseRange: 11,
    maxLevel: 5,
    cooldownFor: (s) => frostShardsDef.baseCooldown * Math.pow(0.92, s.level - 1),
    damageFor:   (s) => frostShardsDef.baseDamage  * Math.pow(1.25, s.level - 1),
    cast: (state, ctx) => {
        let best: Enemy | null = null;
        let bestDist2 = frostShardsDef.baseRange * frostShardsDef.baseRange;
        for (const e of ctx.enemies) {
            if (!e.isAlive()) continue;
            const dx = e.getPosition().x - ctx.heroPosition.x;
            const dz = e.getPosition().z - ctx.heroPosition.z;
            const d2 = dx * dx + dz * dz;
            if (d2 < bestDist2) { bestDist2 = d2; best = e; }
        }
        if (!best) return;

        const proj = MeshBuilder.CreateSphere('frostProj', { diameter: 0.4 }, ctx.scene);
        proj.position.copyFrom(ctx.heroPosition);
        proj.position.y = 1;
        const mat = new StandardMaterial('frostMat', ctx.scene);
        mat.emissiveColor = new Color3(0.3, 0.7, 1.0);
        proj.material = mat;

        const target = best;
        const damage = frostShardsDef.damageFor(state) * ctx.damageMultiplier;
        const speed = 20;
        const observer = ctx.scene.onBeforeRenderObservable.add(() => {
            if (!target.isAlive()) {
                proj.dispose();
                ctx.scene.onBeforeRenderObservable.remove(observer);
                return;
            }
            const tp = target.getPosition().clone(); tp.y = 1;
            const dir = tp.subtract(proj.position);
            const dist = dir.length();
            if (dist < 0.4) {
                target.takeDamage(damage);
                // Apply slow: 50% speed for 2 seconds
                target.applyStatusEffect(StatusEffect.SLOWED, 2, 0.5);
                proj.dispose();
                ctx.scene.onBeforeRenderObservable.remove(observer);
                return;
            }
            const dt = ctx.scene.getEngine().getDeltaTime() / 1000;
            proj.position.addInPlace(dir.normalize().scale(Math.min(dist, speed * dt)));
        });
        setTimeout(() => {
            if (!proj.isDisposed()) proj.dispose();
            ctx.scene.onBeforeRenderObservable.remove(observer);
        }, 4000);
    },
};

// ─────────────────────────────────────────────────────────────────────────────
// Arcane Nova — AOE pulse around hero
// ─────────────────────────────────────────────────────────────────────────────
const arcaneNovaDef: PowerDefinition = {
    id: 'arcane_nova',
    name: 'Arcane Nova',
    element: 'arcane',
    icon: 'A',
    baseCooldown: 3.0,
    baseDamage: 18,
    baseRange: 4.5,
    maxLevel: 5,
    cooldownFor: (s) => arcaneNovaDef.baseCooldown * Math.pow(0.92, s.level - 1),
    damageFor:   (s) => arcaneNovaDef.baseDamage  * Math.pow(1.25, s.level - 1),
    cast: (state, ctx) => {
        // Level 4+ perk: expanded radius
        const radius = state.level >= 4
            ? arcaneNovaDef.baseRange * 1.4
            : arcaneNovaDef.baseRange;

        const damage = arcaneNovaDef.damageFor(state) * ctx.damageMultiplier;

        // Damage all enemies in radius
        for (const e of ctx.enemies) {
            if (!e.isAlive()) continue;
            const dx = e.getPosition().x - ctx.heroPosition.x;
            const dz = e.getPosition().z - ctx.heroPosition.z;
            const dist = Math.hypot(dx, dz);
            if (dist <= radius) {
                e.takeDamage(damage);
            }
        }

        // Visual: expanding ring that fades out
        const ring = MeshBuilder.CreateTorus('novaRing', {
            diameter: radius * 2,
            thickness: 0.25,
            tessellation: 32,
        }, ctx.scene);
        ring.position.copyFrom(ctx.heroPosition);
        ring.position.y = 0.3;
        const mat = new StandardMaterial('novaMat', ctx.scene);
        mat.emissiveColor = new Color3(0.8, 0.3, 1.0);
        mat.alpha = 0.7;
        ring.material = mat;

        // Dispose after 0.35s
        setTimeout(() => { if (!ring.isDisposed()) ring.dispose(); }, 350);
    },
};

// ─────────────────────────────────────────────────────────────────────────────
// Piercing Arrow — long-range pierce projectile
// ─────────────────────────────────────────────────────────────────────────────
const piercingArrowDef: PowerDefinition = {
    id: 'piercing_arrow',
    name: 'Piercing Arrow',
    element: 'physical',
    icon: 'P',
    baseCooldown: 1.6,
    baseDamage: 22,
    baseRange: 18,
    maxLevel: 5,
    cooldownFor: (s) => piercingArrowDef.baseCooldown * Math.pow(0.92, s.level - 1),
    damageFor:   (s) => piercingArrowDef.baseDamage  * Math.pow(1.25, s.level - 1),
    cast: (state, ctx) => {
        // Find nearest enemy to determine direction
        let best: Enemy | null = null;
        let bestDist2 = piercingArrowDef.baseRange * piercingArrowDef.baseRange;
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

        const proj = MeshBuilder.CreateSphere('arrowProj', { diameter: 0.3 }, ctx.scene);
        proj.position.copyFrom(ctx.heroPosition);
        proj.position.y = 1;
        const mat = new StandardMaterial('arrowMat', ctx.scene);
        mat.emissiveColor = new Color3(0.9, 0.9, 0.9);
        proj.material = mat;

        const damage = piercingArrowDef.damageFor(state) * ctx.damageMultiplier;
        const speed = 28;
        const maxTravel = piercingArrowDef.baseRange;
        const hitEnemies = new Set<Enemy>();
        let traveledDist = 0;

        const observer = ctx.scene.onBeforeRenderObservable.add(() => {
            const dt = ctx.scene.getEngine().getDeltaTime() / 1000;
            const step = speed * dt;
            traveledDist += step;
            proj.position.addInPlace(direction.scale(step));

            // Check enemies for pierce hit
            for (const e of ctx.enemies) {
                if (!e.isAlive() || hitEnemies.has(e)) continue;
                const dx = e.getPosition().x - proj.position.x;
                const dz = e.getPosition().z - proj.position.z;
                if (Math.hypot(dx, dz) < 0.6) {
                    e.takeDamage(damage);
                    hitEnemies.add(e);
                }
            }

            if (traveledDist >= maxTravel) {
                proj.dispose();
                ctx.scene.onBeforeRenderObservable.remove(observer);
            }
        });
        setTimeout(() => {
            if (!proj.isDisposed()) proj.dispose();
            ctx.scene.onBeforeRenderObservable.remove(observer);
        }, 3000);
    },
};

// ─────────────────────────────────────────────────────────────────────────────
// Whirling Blades — persistent orbiting blades
// ─────────────────────────────────────────────────────────────────────────────
const whirlingBladesDef: PowerDefinition = {
    id: 'whirling_blades',
    name: 'Whirling Blades',
    element: 'physical',
    icon: 'W',
    baseCooldown: 0.25,   // damage-tick interval
    baseDamage: 4,
    baseRange: 2.5,       // orbit radius
    maxLevel: 5,
    cooldownFor: (s) => whirlingBladesDef.baseCooldown * Math.pow(0.92, s.level - 1),
    damageFor:   (s) => whirlingBladesDef.baseDamage  * Math.pow(1.25, s.level - 1),
    /** On add: spawn the orbiting blade meshes and attach them to state.data */
    init: (state, ctx) => {
        // Level 3+ perk: 3 blades, otherwise 2
        const bladeCount = state.level >= 3 ? 3 : 2;
        const blades: { mesh: ReturnType<typeof MeshBuilder.CreateBox>; angle: number }[] = [];
        for (let i = 0; i < bladeCount; i++) {
            const blade = MeshBuilder.CreateBox(`wbBlade_${i}`, { width: 0.2, height: 0.1, depth: 0.6 }, ctx.scene);
            const mat = new StandardMaterial(`wbBladeMat_${i}`, ctx.scene);
            mat.emissiveColor = new Color3(0.7, 0.7, 0.9);
            blade.material = mat;
            blades.push({ mesh: blade, angle: (i / bladeCount) * Math.PI * 2 });
        }
        if (!state.data) state.data = {};
        state.data['blades'] = blades;
        state.data['orbitRadius'] = whirlingBladesDef.baseRange;
    },
    cast: (state, ctx) => {
        if (!state.data) return;
        const blades = state.data['blades'] as { mesh: ReturnType<typeof MeshBuilder.CreateBox>; angle: number }[] | undefined;
        if (!blades) return;

        const orbitRadius = (state.data['orbitRadius'] as number) ?? whirlingBladesDef.baseRange;
        const rotateSpeed = 2.5; // radians per second
        const tickDt = ctx.scene.getEngine().getDeltaTime() / 1000;
        const damage = whirlingBladesDef.damageFor(state) * ctx.damageMultiplier;

        for (const blade of blades) {
            blade.angle += rotateSpeed * tickDt;
            blade.mesh.position.set(
                ctx.heroPosition.x + Math.cos(blade.angle) * orbitRadius,
                1.0,
                ctx.heroPosition.z + Math.sin(blade.angle) * orbitRadius,
            );
        }

        // Damage tick: enemies near any blade
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
const lightningChainDef: PowerDefinition = {
    id: 'lightning_chain',
    name: 'Lightning Chain',
    element: 'storm',
    icon: 'L',
    baseCooldown: 2.2,
    baseDamage: 16,
    baseRange: 10,
    maxLevel: 5,
    cooldownFor: (s) => lightningChainDef.baseCooldown * Math.pow(0.92, s.level - 1),
    damageFor:   (s) => lightningChainDef.baseDamage  * Math.pow(1.25, s.level - 1),
    cast: (state, ctx) => {
        // Find nearest enemy in range
        let first: Enemy | null = null;
        let firstDist2 = lightningChainDef.baseRange * lightningChainDef.baseRange;
        for (const e of ctx.enemies) {
            if (!e.isAlive()) continue;
            const dx = e.getPosition().x - ctx.heroPosition.x;
            const dz = e.getPosition().z - ctx.heroPosition.z;
            const d2 = dx * dx + dz * dz;
            if (d2 < firstDist2) { firstDist2 = d2; first = e; }
        }
        if (!first) return;

        const damage = lightningChainDef.damageFor(state) * ctx.damageMultiplier;
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
            next.takeDamage(damage * 0.75); // Reduced chain damage
            hitSet.add(next);
            current = next;
        }

        // Draw brief line meshes between hit points
        for (const seg of hitOrder) {
            const mid = seg.from.add(seg.to).scale(0.5);
            const len = Vector3.Distance(seg.from, seg.to);
            if (len < 0.1) continue;
            const line = MeshBuilder.CreateBox(`lightning_${Math.random()}`, {
                width: 0.08,
                height: 0.08,
                depth: len,
            }, ctx.scene);
            line.position.copyFrom(mid);
            line.position.y = 1;
            const dir = seg.to.subtract(seg.from).normalize();
            line.rotation.y = Math.atan2(dir.x, dir.z);
            const mat = new StandardMaterial('lightningMat', ctx.scene);
            mat.emissiveColor = new Color3(0.7, 0.7, 1.0);
            line.material = mat;
            setTimeout(() => { if (!line.isDisposed()) line.dispose(); }, 200);
        }
    },
};

// ─────────────────────────────────────────────────────────────────────────────
// Registry
// ─────────────────────────────────────────────────────────────────────────────
export const POWER_DEFS: Record<string, PowerDefinition> = {
    fireball:        fireballDef,
    frost_shards:    frostShardsDef,
    arcane_nova:     arcaneNovaDef,
    piercing_arrow:  piercingArrowDef,
    whirling_blades: whirlingBladesDef,
    lightning_chain: lightningChainDef,
};

const ELEMENT_TO_POWER: Record<PowerElement, string> = {
    fire:     'fireball',
    ice:      'frost_shards',
    arcane:   'arcane_nova',
    physical: 'whirling_blades',
    storm:    'lightning_chain',
};

export function getPowerByElement(element: PowerElement): PowerDefinition {
    return POWER_DEFS[ELEMENT_TO_POWER[element]];
}
