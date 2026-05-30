import { Vector3 } from '@babylonjs/core';
import { StatusEffect } from '../GameTypes';
import {
    aoeBurst, chainHit, gatherVortex, omniVolley, deliverAutocast, repeatStrikes, ultimateImpact,
} from './PowerEffects';
import type { Enemy } from '../enemies/Enemy';
import type { PowerElement, PowerContext, ChampionType } from './PowerDefinitions';

function randomAliveEnemy(enemies: Enemy[]): Enemy | null {
    const alive = enemies.filter(e => e.isAlive());
    return alive.length ? alive[Math.floor(Math.random() * alive.length)] : null;
}

export type UltimateArchetype = (ctx: PowerContext, damage: number, championType: ChampionType) => void;

export const ULTIMATE_ARCHETYPES: Record<PowerElement, UltimateArchetype> = {
    // FIRE — Cataclysm: a rolling meteor storm. 6 strikes, each an AoE burst + burn
    // at a random enemy (ranger: each meteor is delivered by an arrow).
    fire: (ctx, damage, cls) => {
        ultimateImpact('fire');
        repeatStrikes(ctx.scene, 6, 0.12, () => {
            const t = randomAliveEnemy(ctx.enemies);
            if (!t) return;
            deliverAutocast(ctx, cls, t, 'fire', (x, z) => {
                aoeBurst(ctx.scene, ctx.enemies, x, z, {
                    radius: 3.2, damage, element: 'fire',
                    status: { effect: StatusEffect.BURNING, durationS: 3, strength: damage * 0.1 },
                });
            });
        });
    },

    // ICE — Absolute Zero: arena-wide freeze burst from the hero; frozen enemies are
    // shatter-primed (their death erupts in an ice nova).
    ice: (ctx, damage, _cls) => {
        ultimateImpact('ice');
        const radius = 9;
        aoeBurst(ctx.scene, ctx.enemies, ctx.heroPosition.x, ctx.heroPosition.z, {
            radius, damage, element: 'ice',
            status: { effect: StatusEffect.CHILL, durationS: 3, strength: 7 }, // 7 chill stacks → freeze
            ringLifeS: 0.5,
        });
        for (const e of ctx.enemies) {
            if (!e.isAlive()) continue;
            const p = e.getPosition();
            const dx = p.x - ctx.heroPosition.x, dz = p.z - ctx.heroPosition.z;
            if (dx * dx + dz * dz <= radius * radius) e.primeShatter(damage * 0.6, 3, 'ice');
        }
    },

    // ARCANE — Singularity: a large, strong, long gravity vortex that implodes.
    arcane: (ctx, damage, cls) => {
        ultimateImpact('arcane');
        const t = randomAliveEnemy(ctx.enemies);
        const cx = t ? t.getPosition().x : ctx.heroPosition.x;
        const cz = t ? t.getPosition().z : ctx.heroPosition.z;
        const spawn = (x: number, z: number) => gatherVortex(ctx.scene, ctx.enemies, x, z, {
            radius: 7, durationS: 2.2, pull: 1.4, tickDamage: damage * 0.25, tickIntervalS: 0.2,
            element: 'arcane', status: { effect: StatusEffect.SLOWED, durationS: 0.5, strength: 0.5 },
            finalBurst: damage * 1.2,
        });
        if (cls === 'ranger' && t) deliverAutocast(ctx, cls, t, 'arcane', spawn);
        else spawn(cx, cz);
    },

    // PHYSICAL — Maelstrom: repeated radial shrapnel bursts (blade storm) around the hero.
    physical: (ctx, damage, cls) => {
        ultimateImpact('physical');
        repeatStrikes(ctx.scene, 5, 0.14, () => {
            const originEnemy = randomAliveEnemy(ctx.enemies);
            const ox = originEnemy ? originEnemy.getPosition().x : ctx.heroPosition.x;
            const oz = originEnemy ? originEnemy.getPosition().z : ctx.heroPosition.z;
            const burst = (x: number, z: number) => omniVolley(ctx.scene, ctx.enemies, x, z, {
                count: 10, speed: 17, damage: damage * 0.4, element: 'physical',
                status: { effect: StatusEffect.FRAGILE, durationS: 3, strength: 0 },
            });
            if (cls === 'ranger' && originEnemy) deliverAutocast(ctx, cls, originEnemy, 'physical', burst);
            else burst(ox, oz);
        });
    },

    // STORM — Thunderstorm: rapid chain-lightning strikes that fork across the arena.
    storm: (ctx, damage, cls) => {
        ultimateImpact('storm');
        repeatStrikes(ctx.scene, 8, 0.1, () => {
            const t = randomAliveEnemy(ctx.enemies);
            if (!t) return;
            const strike = (x: number, z: number) => chainHit(ctx.scene, ctx.enemies, new Vector3(x, 1, z), {
                hops: 5, radius: 6, damage: damage * 0.6, element: 'storm', falloff: 0.85, split: true,
                status: { effect: StatusEffect.FRAGILE, durationS: 3, strength: 0 },
            });
            if (cls === 'ranger') deliverAutocast(ctx, cls, t, 'storm', strike);
            else { const p = t.getPosition(); strike(p.x, p.z); }
        });
    },
};
