// Babylon-aware fusion archetype implementations. Each authored archetype gives a
// fused power EMERGENT behavior (not just its two parents combined). Registers into
// the Babylon-free FusionArchetypeRegistry at module load; a side-effect import in
// SurvivorsGameplayState ensures registration runs before any fusion is cast.
import { StatusEffect } from '../GameTypes';
import { dealElementalHit, aoeBurst } from './PowerEffects';
import { registerAutocastArchetype, registerPassiveArchetype, archetypeKey } from './FusionArchetypeRegistry';
import type { Enemy } from '../enemies/Enemy';
import type { PowerElement, PowerContext, EnchantmentHitContext } from './PowerDefinitions';

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

registerAutocastArchetype(archetypeKey('fire', 'ice'), (_state, ctx, damage) => {
    const target = nearestEnemy(ctx.enemies, ctx.heroPosition.x, ctx.heroPosition.z, FROSTFIRE_RANGE);
    if (!target) return;
    applyFrostfire(ctx.scene, ctx.enemies, target, damage, ctx.element);
    // Small frost-fire splash around the impact for feel + minor AoE.
    const p = target.getPosition();
    aoeBurst(ctx.scene, ctx.enemies, p.x, p.z, { radius: 1.8, damage: damage * 0.4, element: ctx.element });
});

registerPassiveArchetype(archetypeKey('fire', 'ice'), (enemy, level, ctx: EnchantmentHitContext) => {
    const damage = ctx.baseDamage * (0.3 + 0.2 * level);
    applyFrostfire(ctx.scene, ctx.enemies, enemy, damage, ctx.element);
});
