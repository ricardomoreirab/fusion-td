import { MeshBuilder, Color3 } from '@babylonjs/core';
import { getCachedMaterial } from '../../../engine/rendering/MaterialCache';
import { StatusEffect } from '../../GameTypes';
import type { Scene } from '@babylonjs/core';
import type { Enemy } from '../../enemies/Enemy';
import type { PowerDefinition } from '../PowerDefinitions';

const ALL_ELEMENTS: PowerDefinition['elements'] = ['fire', 'ice', 'arcane', 'physical', 'storm'];

/** An expanding, fading ring on the ground. Self-disposing. */
function spawnShockRing(scene: Scene, x: number, z: number, maxRadius: number, color: Color3, lifeS: number): void {
    const ring = MeshBuilder.CreateTorus('ult_ring', { diameter: maxRadius * 2, thickness: 0.3, tessellation: 36 }, scene);
    ring.position.set(x, 0.3, z);
    // Cache by colour (bounded set). A Math.random() name defeated the cache and
    // recompiled a shader per ring; fade via mesh.visibility, not the frozen mat's alpha.
    ring.material = getCachedMaterial(scene, `ult_ring_mat_${color.r.toFixed(2)}_${color.g.toFixed(2)}_${color.b.toFixed(2)}`, m => {
        m.emissiveColor = color;
        m.diffuseColor = new Color3(0, 0, 0);
        m.disableLighting = true;
        m.alpha = 0.85;
    });
    ring.scaling.setAll(0.1);
    ring.visibility = 0.85;
    let elapsed = 0;
    const obs = scene.onBeforeRenderObservable.add(() => {
        const dt = scene.getEngine().getDeltaTime() / 1000;
        elapsed += dt;
        const t = Math.min(elapsed / lifeS, 1);
        ring.scaling.setAll(0.1 + 0.9 * t);
        ring.visibility = 0.85 * (1 - t);
        if (t >= 1) {
            ring.dispose(); // keeps the cached/shared material
            scene.onBeforeRenderObservable.remove(obs);
        }
    });
}

/** A brief falling fire streak + AOE burn impact. */
function meteorImpact(scene: Scene, x: number, z: number, damage: number, radius: number, enemies: Enemy[]): void {
    for (const e of enemies) {
        if (!e.isAlive()) continue;
        const dx = e.getPosition().x - x;
        const dz = e.getPosition().z - z;
        if (Math.hypot(dx, dz) <= radius) {
            e.takeDamage(damage);
            e.applyStatusEffect(StatusEffect.BURNING, 3, damage * 0.1);
        }
    }
    spawnShockRing(scene, x, z, radius, new Color3(1, 0.4, 0.05), 0.32);
    const streak = MeshBuilder.CreateCylinder('ult_meteor', { height: 6, diameterTop: 0.1, diameterBottom: 0.5, tessellation: 6 }, scene);
    streak.position.set(x, 3.2, z);
    streak.material = getCachedMaterial(scene, 'ult_meteor_mat', m => {
        m.emissiveColor = new Color3(1, 0.5, 0.1);
        m.diffuseColor = new Color3(0, 0, 0);
    });
    setTimeout(() => { if (!streak.isDisposed()) streak.dispose(); }, 150);
}

// ── Cataclysm — rolling meteor storm ────────────────────────────────────────
const mageCataclysm: PowerDefinition = {
    id: 'mage_ult_cataclysm',
    name: 'Cataclysm',
    element: 'fire',
    championType: 'mage',
    tier: 'ultimate',
    elements: ALL_ELEMENTS,
    icon: '✪',
    baseCooldown: 6,
    baseDamage: 60,
    baseRange: 14,
    maxLevel: 5,
    mode: 'autocast',
    cooldownFor: (s) => 6 * Math.pow(0.94, s.level - 1),
    damageFor:   (s) => 60 * Math.pow(1.25, s.level - 1),
    cast: (state, ctx) => {
        const strikes = 4 + state.level;
        const dmg = mageCataclysm.damageFor(state) * ctx.damageMultiplier;
        for (let i = 0; i < strikes; i++) {
            setTimeout(() => {
                const alive = ctx.enemies.filter(e => e.isAlive());
                let x: number, z: number;
                if (alive.length > 0) {
                    const p = alive[Math.floor(Math.random() * alive.length)].getPosition();
                    x = p.x; z = p.z;
                } else {
                    const ang = Math.random() * Math.PI * 2;
                    const r = Math.random() * mageCataclysm.baseRange;
                    x = ctx.heroPosition.x + Math.cos(ang) * r;
                    z = ctx.heroPosition.z + Math.sin(ang) * r;
                }
                meteorImpact(ctx.scene, x, z, dmg, 3, ctx.enemies);
            }, i * 90);
        }
    },
};

// ── Absolute Zero — mass freeze burst ───────────────────────────────────────
const mageAbsoluteZero: PowerDefinition = {
    id: 'mage_ult_absolute_zero',
    name: 'Absolute Zero',
    element: 'ice',
    championType: 'mage',
    tier: 'ultimate',
    elements: ALL_ELEMENTS,
    icon: '✪',
    baseCooldown: 7,
    baseDamage: 70,
    baseRange: 9,
    maxLevel: 5,
    mode: 'autocast',
    cooldownFor: (s) => 7 * Math.pow(0.94, s.level - 1),
    damageFor:   (s) => 70 * Math.pow(1.25, s.level - 1),
    cast: (state, ctx) => {
        const radius = mageAbsoluteZero.baseRange + state.level * 0.4;
        const dmg = mageAbsoluteZero.damageFor(state) * ctx.damageMultiplier;
        for (const e of ctx.enemies) {
            if (!e.isAlive()) continue;
            const dx = e.getPosition().x - ctx.heroPosition.x;
            const dz = e.getPosition().z - ctx.heroPosition.z;
            if (Math.hypot(dx, dz) <= radius) {
                e.takeDamage(dmg);
                e.applyStatusEffect(StatusEffect.FROZEN, 2 + state.level * 0.3, 1);
            }
        }
        spawnShockRing(ctx.scene, ctx.heroPosition.x, ctx.heroPosition.z, radius, new Color3(0.5, 0.85, 1), 0.45);
    },
};

// ── Singularity — gravity vortex + implosion ────────────────────────────────
const mageSingularity: PowerDefinition = {
    id: 'mage_ult_singularity',
    name: 'Singularity',
    element: 'arcane',
    championType: 'mage',
    tier: 'ultimate',
    elements: ALL_ELEMENTS,
    icon: '✪',
    baseCooldown: 8,
    baseDamage: 50,
    baseRange: 6,
    maxLevel: 5,
    mode: 'autocast',
    cooldownFor: (s) => 8 * Math.pow(0.94, s.level - 1),
    damageFor:   (s) => 50 * Math.pow(1.25, s.level - 1),
    cast: (state, ctx) => {
        let cx = ctx.heroPosition.x;
        let cz = ctx.heroPosition.z;
        let best: Enemy | null = null;
        let bestD2 = Infinity;
        for (const e of ctx.enemies) {
            if (!e.isAlive()) continue;
            const dx = e.getPosition().x - ctx.heroPosition.x;
            const dz = e.getPosition().z - ctx.heroPosition.z;
            const d2 = dx * dx + dz * dz;
            if (d2 < bestD2) { bestD2 = d2; best = e; }
        }
        if (best) { cx = best.getPosition().x; cz = best.getPosition().z; }

        const radius = mageSingularity.baseRange;
        // Ticks are the primary damage: 8 ticks over 1.6s at 25% each = ~2× damageFor,
        // and the implosion adds a final 1× burst (~3:1 tick:burst total). Tunable.
        const tickDmg = mageSingularity.damageFor(state) * ctx.damageMultiplier * 0.25;
        const burstDmg = mageSingularity.damageFor(state) * ctx.damageMultiplier;

        const orb = MeshBuilder.CreateSphere('ult_singularity', { diameter: 1.2, segments: 8 }, ctx.scene);
        orb.position.set(cx, 1, cz);
        orb.material = getCachedMaterial(ctx.scene, 'ult_singularity_mat', m => {
            m.emissiveColor = new Color3(0.35, 0.05, 0.55);
            m.diffuseColor = new Color3(0, 0, 0);
        });

        const lifeS = 1.6;
        let elapsed = 0;
        let tickAcc = 0;
        const obs = ctx.scene.onBeforeRenderObservable.add(() => {
            const dt = ctx.scene.getEngine().getDeltaTime() / 1000;
            elapsed += dt;
            tickAcc += dt;
            orb.rotation.y += dt * 6;
            orb.scaling.setAll(1 + 0.3 * Math.sin(elapsed * 10));
            if (tickAcc >= 0.2) {
                tickAcc = 0;
                for (const e of ctx.enemies) {
                    if (!e.isAlive()) continue;
                    const dx = e.getPosition().x - cx;
                    const dz = e.getPosition().z - cz;
                    if (Math.hypot(dx, dz) <= radius) {
                        e.takeDamage(tickDmg);
                        e.applyStatusEffect(StatusEffect.SLOWED, 0.4, 0.3);
                    }
                }
            }
            if (elapsed >= lifeS) {
                for (const e of ctx.enemies) {
                    if (!e.isAlive()) continue;
                    const dx = e.getPosition().x - cx;
                    const dz = e.getPosition().z - cz;
                    if (Math.hypot(dx, dz) <= radius) e.takeDamage(burstDmg);
                }
                spawnShockRing(ctx.scene, cx, cz, radius, new Color3(0.6, 0.2, 1), 0.3);
                orb.dispose();
                ctx.scene.onBeforeRenderObservable.remove(obs);
            }
        });
    },
};

export const MAGE_ULTIMATES: PowerDefinition[] = [mageCataclysm, mageAbsoluteZero, mageSingularity];
