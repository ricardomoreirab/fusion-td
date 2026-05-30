// Babylon-aware fusion archetype implementations. Each authored archetype gives a
// fused power EMERGENT behavior (not just its two parents combined). Registers into
// the Babylon-free FusionArchetypeRegistry at module load; a side-effect import in
// SurvivorsGameplayState ensures registration runs before any fusion is cast.
import { Vector3 } from '@babylonjs/core';
import { StatusEffect } from '../GameTypes';
import { dealElementalHit, aoeBurst, chainHit, gatherVortex, persistentZone, omniVolley, deliverAutocast } from './PowerEffects';
import { registerAutocastArchetype, registerPassiveArchetype, archetypeKey } from './FusionArchetypeRegistry';
import type { Enemy } from '../enemies/Enemy';
import type { PowerElement, PowerContext, EnchantmentHitContext, ChampionType } from './PowerDefinitions';

/** Nearest live enemy to a point within `range` (or null). */
function nearestEnemy(enemies: Enemy[], x: number, z: number, range: number): Enemy | null {
    let best: Enemy | null = null;
    let bestD2 = range * range;
    for (const e of enemies) {
        if (!e.isAlive()) continue;
        const p = e.getPosition();
        const dx = p.x - x, dz = p.z - z;
        const d2 = dx * dx + dz * dz;
        if (d2 <= bestD2) { bestD2 = d2; best = e; }
    }
    return best;
}

// ── Frostfire (fire+ice) — Shatter-Burn ─────────────────────────────────────
// Applies Chill (stacks → Freeze) + Burn, and primes a BURNING shatter so an
// enemy that dies while frozen erupts in a burning nova (re-applying burn to
// neighbours). The emergent loop: freeze sets up the kill, the kill spreads fire.
const FROSTFIRE_RANGE = 12;

function applyFrostfire(scene: PowerContext['scene'], enemies: Enemy[], target: Enemy, damage: number, element: PowerElement): void {
    dealElementalHit(scene, enemies, target, damage, element);
    if (!target.isAlive()) return;
    target.applyStatusEffect(StatusEffect.CHILL, 2.5, 2);                 // +2 chill stacks (→ freeze at 7)
    target.applyStatusEffect(StatusEffect.BURNING, 2.5, damage * 0.15);  // burn DoT (0.15·dmg per 0.5s stack)
    // On a frozen death, erupt: burning nova that re-applies burn to neighbours.
    target.primeShatter(damage * 0.6, 2.8, 'fire',
        { effect: StatusEffect.BURNING, durationS: 2, strength: damage * 0.1 });
}

registerAutocastArchetype(archetypeKey('fire', 'ice'), (_state, ctx, damage, championType) => {
    const target = nearestEnemy(ctx.enemies, ctx.heroPosition.x, ctx.heroPosition.z, FROSTFIRE_RANGE);
    if (!target) return;
    deliverAutocast(ctx, championType, target, ctx.element, (x, z) => {
        applyFrostfire(ctx.scene, ctx.enemies, target, damage, ctx.element);
        aoeBurst(ctx.scene, ctx.enemies, x, z, { radius: 1.8, damage: damage * 0.4, element: ctx.element });
    });
});

registerPassiveArchetype(archetypeKey('fire', 'ice'), (enemy, level, ctx: EnchantmentHitContext) => {
    const damage = ctx.baseDamage * (0.3 + 0.2 * level);
    applyFrostfire(ctx.scene, ctx.enemies, enemy, damage, ctx.element);
});

// ── Tempest Ember (fire+storm) — Overload ───────────────────────────────────
// Plant/refresh burn, then a STORM hit detonates the accumulated burn via the
// storm→burn 'overload' cross-reaction in dealElementalHit. Repeated casts build
// the burn and pop it for an AoE — the overload loop.
function applyTempest(scene: PowerContext['scene'], enemies: Enemy[], target: Enemy, damage: number): void {
    target.applyStatusEffect(StatusEffect.BURNING, 3, damage * 0.2); // plant/refresh a burn stack
    dealElementalHit(scene, enemies, target, damage, 'storm');       // storm → detonates burn (overload)
}
registerAutocastArchetype(archetypeKey('fire', 'storm'), (_state, ctx, damage, championType) => {
    const target = nearestEnemy(ctx.enemies, ctx.heroPosition.x, ctx.heroPosition.z, 12);
    if (!target) return;
    deliverAutocast(ctx, championType, target, ctx.element, () => {
        applyTempest(ctx.scene, ctx.enemies, target, damage);
    });
});
registerPassiveArchetype(archetypeKey('fire', 'storm'), (enemy, level, ctx: EnchantmentHitContext) => {
    applyTempest(ctx.scene, ctx.enemies, enemy, ctx.baseDamage * (0.3 + 0.2 * level));
});

// ── Rimecaster (ice+arcane) — Glacial Vortex ────────────────────────────────
// A gravity well that pulls enemies in, chilling (→ freeze) them, then implodes.
registerAutocastArchetype(archetypeKey('ice', 'arcane'), (_state, ctx, damage, championType) => {
    const target = nearestEnemy(ctx.enemies, ctx.heroPosition.x, ctx.heroPosition.z, 12);
    if (!target) return;
    deliverAutocast(ctx, championType, target, ctx.element, (x, z) => {
        gatherVortex(ctx.scene, ctx.enemies, x, z, {
            radius: 4, durationS: 1.4, pull: 0.9, tickDamage: damage * 0.2, tickIntervalS: 0.2,
            element: ctx.element, status: { effect: StatusEffect.CHILL, durationS: 1.5, strength: 2 },
            finalBurst: damage * 0.9,
        });
    });
});
registerPassiveArchetype(archetypeKey('ice', 'arcane'), (enemy, level, ctx: EnchantmentHitContext) => {
    const dmg = ctx.baseDamage * (0.3 + 0.2 * level);
    dealElementalHit(ctx.scene, ctx.enemies, enemy, dmg, ctx.element);
    if (enemy.isAlive()) enemy.applyStatusEffect(StatusEffect.CHILL, 1.5, 2);
    if (Math.random() < 0.15) { // occasional vortex proc on a basic hit
        const p = enemy.getPosition();
        gatherVortex(ctx.scene, ctx.enemies, p.x, p.z, {
            radius: 3, durationS: 1.0, pull: 0.9, tickDamage: dmg * 0.2, tickIntervalS: 0.2,
            element: ctx.element, status: { effect: StatusEffect.CHILL, durationS: 1.5, strength: 2 },
            finalBurst: dmg * 0.6,
        });
    }
});

// ── Molten Edge (fire+physical) — Magma Trail ───────────────────────────────
// Leaves a burning lava pool on the ground.
registerAutocastArchetype(archetypeKey('fire', 'physical'), (_state, ctx, damage, championType) => {
    const target = nearestEnemy(ctx.enemies, ctx.heroPosition.x, ctx.heroPosition.z, 12);
    if (!target) return;
    deliverAutocast(ctx, championType, target, 'fire', (x, z) => {
        persistentZone(ctx.scene, ctx.enemies, x, z, {
            radius: 3, durationS: 3, tickIntervalS: 0.5, tickDamage: damage * 0.25,
            element: 'fire', status: { effect: StatusEffect.BURNING, durationS: 2, strength: damage * 0.1 },
        });
    });
});
registerPassiveArchetype(archetypeKey('fire', 'physical'), (enemy, level, ctx: EnchantmentHitContext) => {
    const dmg = ctx.baseDamage * (0.3 + 0.2 * level);
    dealElementalHit(ctx.scene, ctx.enemies, enemy, dmg, ctx.element);
    if (Math.random() < 0.2) {
        const p = enemy.getPosition();
        persistentZone(ctx.scene, ctx.enemies, p.x, p.z, {
            radius: 2.5, durationS: 2.5, tickIntervalS: 0.5, tickDamage: dmg * 0.25,
            element: 'fire', status: { effect: StatusEffect.BURNING, durationS: 2, strength: dmg * 0.1 },
        });
    }
});

// ── Voltaic Rune (arcane+storm) — Arc Split ─────────────────────────────────
// Chain lightning that forks into two each hop, applying Fragile (amp) to every
// enemy it touches.
registerAutocastArchetype(archetypeKey('arcane', 'storm'), (_state, ctx, damage, championType) => {
    const target = nearestEnemy(ctx.enemies, ctx.heroPosition.x, ctx.heroPosition.z, 12);
    if (!target) return;
    deliverAutocast(ctx, championType, target, 'storm', (x, z) => {
        chainHit(ctx.scene, ctx.enemies, new Vector3(x, 1, z), {
            hops: 4, radius: 5, damage, element: 'storm', falloff: 0.8, split: true,
            status: { effect: StatusEffect.FRAGILE, durationS: 3, strength: 0 },
        });
    });
});
registerPassiveArchetype(archetypeKey('arcane', 'storm'), (enemy, level, ctx: EnchantmentHitContext) => {
    const dmg = ctx.baseDamage * (0.3 + 0.2 * level);
    const p = enemy.getPosition();
    chainHit(ctx.scene, ctx.enemies, new Vector3(p.x, 1, p.z), {
        hops: 3, radius: 4.5, damage: dmg, element: 'storm', falloff: 0.75, split: true,
        status: { effect: StatusEffect.FRAGILE, durationS: 3, strength: 0 },
    });
});

// ── Runeblade (arcane+physical) — Rune Burst ────────────────────────────────
// A burst of rune-shots fired outward in all directions, applying Fragile.
registerAutocastArchetype(archetypeKey('arcane', 'physical'), (_state, ctx, damage, championType) => {
    const target = nearestEnemy(ctx.enemies, ctx.heroPosition.x, ctx.heroPosition.z, 12);
    if (!target) return;
    deliverAutocast(ctx, championType, target, ctx.element, (x, z) => {
        omniVolley(ctx.scene, ctx.enemies, x, z, {
            count: 6, speed: 16, damage: damage * 0.7, element: ctx.element,
            status: { effect: StatusEffect.FRAGILE, durationS: 3, strength: 0 },
        });
    });
});
registerPassiveArchetype(archetypeKey('arcane', 'physical'), (enemy, level, ctx: EnchantmentHitContext) => {
    const dmg = ctx.baseDamage * (0.3 + 0.2 * level);
    dealElementalHit(ctx.scene, ctx.enemies, enemy, dmg, ctx.element);
    if (enemy.isAlive()) enemy.applyStatusEffect(StatusEffect.FRAGILE, 3, 0);
    if (Math.random() < 0.15) {
        const p = enemy.getPosition();
        omniVolley(ctx.scene, ctx.enemies, p.x, p.z, {
            count: 5, speed: 16, damage: dmg * 0.6, element: ctx.element,
            status: { effect: StatusEffect.FRAGILE, durationS: 3, strength: 0 },
        });
    }
});
